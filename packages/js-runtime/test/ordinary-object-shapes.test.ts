import assert from "node:assert/strict";
import test from "node:test";
import {
  createObject,
  createDataProperty,
  createScriptPropertyCache,
  createScriptPropertyStubCache,
  defineOwnProperty,
  inlineSlotBits,
  unusedPropertyShape,
  deleteProperty,
  lookupCachedScriptProperty,
  setPrototype,
  type ObjectHooks,
  type OrdinaryObject,
} from "../src/objects/operations.ts";
import {
  emptyUpdate,
  enumerableField,
  valueField,
  writableField,
} from "../src/descriptors/index.ts";

const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => undefined,
};
const stubs = createScriptPropertyStubCache();

/** Looks up `key` through a fresh site cache, which installs the shape. */
function read(object: OrdinaryObject<string, unknown>, key: string): unknown {
  const cell = lookupCachedScriptProperty<string, unknown>(
    object,
    key,
    createScriptPropertyCache(key),
    false,
    stubs,
    0,
  );
  return cell?.value;
}
function shape(object: OrdinaryObject<string, unknown>): unknown {
  const installed = object.internalShape;
  assert.ok(installed !== undefined);
  return installed;
}
function point(
  prototype: OrdinaryObject<string, unknown> | undefined,
  keys: readonly string[],
): OrdinaryObject<string, unknown> {
  const object = createObject<string, unknown>(prototype);
  // Install the shape first so later additions extend it incrementally.
  read(object, "missing");
  for (const [index, key] of keys.entries())
    createDataProperty<string, unknown>(object, key, index, hooks);
  return object;
}

test("objects with one prototype and key order share one shape", () => {
  const prototype = createObject<string, unknown>(undefined);
  const a = point(prototype, ["x", "y", "z"]),
    b = point(prototype, ["x", "y", "z"]);
  assert.equal(read(a, "y"), 1);
  assert.equal(read(b, "z"), 2);
  assert.equal(shape(a), shape(b));
  // A different order or prototype is a different shape.
  assert.notEqual(shape(point(prototype, ["y", "x", "z"])), shape(a));
  assert.notEqual(
    shape(point(createObject<string, unknown>(undefined), ["x", "y", "z"])),
    shape(a),
  );
  // A shape built from scratch is the same shape.
  const late = createObject<string, unknown>(prototype);
  for (const key of ["x", "y", "z"])
    createDataProperty<string, unknown>(late, key, 0, hooks);
  assert.equal(late.internalShape, undefined);
  read(late, "x");
  assert.equal(shape(late), shape(a));
});

function redefine(
  object: OrdinaryObject<string, unknown>,
  key: string,
  fields: number,
  writable: boolean,
): void {
  assert.equal(
    defineOwnProperty<string, unknown>(
      object,
      key,
      {
        ...emptyUpdate<unknown>(undefined),
        fields: valueField | enumerableField | fields,
        value: 7,
        writable,
        enumerable: false,
      },
      hooks,
    ),
    "accepted",
  );
}

test("a redefinition of the same kind keeps the shape and replaces the live cell", () => {
  const prototype = createObject<string, unknown>(undefined);
  const object = point(prototype, ["x", "y"]);
  const before = shape(object),
    cell = object.internalSlot0,
    epoch = object.internalPropertyEpoch;
  redefine(object, "x", 0, true);
  assert.equal(shape(object), before);
  assert.ok(object.internalPropertyEpoch > epoch);
  assert.notEqual(object.internalSlot0, cell);
  assert.equal(object.internalSlot0?.enumerable, false);
  assert.equal(read(object, "x"), 7);
});

test("a change of kind moves the object to the shape that records it", () => {
  const prototype = createObject<string, unknown>(undefined);
  const object = point(prototype, ["x", "y"]);
  const writable = shape(object);
  redefine(object, "x", writableField, false);
  assert.equal(object.internalShape, undefined);
  assert.equal(read(object, "x"), 7);
  assert.notEqual(shape(object), writable);
  assert.equal(object.internalSlot0?.writable, false);
  // The same keys and kinds from the same root are one shape again.
  const other = point(prototype, ["x", "y"]);
  redefine(other, "x", writableField, false);
  read(other, "y");
  assert.equal(shape(other), shape(object));
  // Past the in-place slots, cells extend internalCells in shape order.
  const keys: string[] = [];
  for (let index = 0; index < 10; index++) keys.push("k" + String(index));
  const wide = point(prototype, keys);
  assert.equal(wide.internalSlot7?.value, 7);
  assert.equal(wide.internalCells?.length, 2);
  assert.equal(read(wide, "k9"), 9);
});

test("deletion and prototype changes rebuild a canonical shape", () => {
  const prototype = createObject<string, unknown>(undefined),
    other = createObject<string, unknown>(undefined);
  const object = point(prototype, ["x", "y", "z"]);
  assert.ok(deleteProperty<string, unknown>(object, "y"));
  assert.equal(object.internalShape, undefined);
  assert.equal(object.internalSlot1, undefined);
  assert.equal(read(object, "z"), 2);
  assert.equal(shape(object), shape(point(prototype, ["x", "z"])));
  assert.ok(setPrototype<string, unknown>(object, other));
  assert.equal(object.internalShape, undefined);
  assert.equal(read(object, "x"), 0);
  assert.equal(shape(object), shape(point(other, ["x", "z"])));
});

test("null-prototype and dictionary-like objects keep private shapes", () => {
  const a = point(undefined, ["x"]),
    b = point(undefined, ["x"]);
  assert.notEqual(shape(a), shape(b));
  const prototype = createObject<string, unknown>(undefined);
  const keys: string[] = [];
  for (let index = 0; index < 70; index++) keys.push("k" + String(index));
  const large = point(prototype, keys),
    again = point(prototype, keys);
  assert.equal(read(large, "k69"), 69);
  assert.notEqual(shape(large), shape(again));
  // Shapes below the limit remain shared.
  assert.equal(
    shape(point(prototype, keys.slice(0, 10))),
    shape(point(prototype, keys.slice(0, 10))),
  );
  // Too many successors of one shape stop sharing the extra ones.
  const fanned: unknown[] = [];
  for (let index = 0; index < 40; index++)
    fanned.push(shape(point(prototype, ["f" + String(index)])));
  assert.notEqual(shape(point(prototype, ["f39"])), fanned[39]);
  assert.equal(shape(point(prototype, ["f0"])), fanned[0]);
});

test("a site exposes its first own or inherited entry inline", () => {
  const prototype = createObject<string, unknown>(undefined);
  createDataProperty<string, unknown>(prototype, "method", "m", hooks);
  const object = point(prototype, ["x", "y"]);
  // Generated code reads the cell's word index as raw bits: slotWord + index.
  const own = createScriptPropertyCache("y");
  assert.equal(own.inlineShape, unusedPropertyShape);
  const cell = lookupCachedScriptProperty<string, unknown>(
    object,
    "y",
    own,
    false,
    stubs,
    10,
  );
  assert.equal(cell?.value, 1);
  assert.equal(own.inlineShape, shape(object));
  assert.equal(own.inlineHolder, unusedPropertyShape);
  assert.equal(own.inlineSlot, inlineSlotBits(11));
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, own.inlineSlot, true);
  assert.equal(bits.getBigUint64(0, true), 11n);
  // An own site leaves an inherited entry to the miss path, and an
  // inherited site the reverse.
  const ownMiss = createScriptPropertyCache("method");
  lookupCachedScriptProperty<string, unknown>(
    object,
    "method",
    ownMiss,
    false,
    stubs,
    10,
  );
  assert.equal(ownMiss.inlineShape, unusedPropertyShape);
  const inherited = createScriptPropertyCache("method", true);
  assert.equal(
    lookupCachedScriptProperty<string, unknown>(
      object,
      "method",
      inherited,
      false,
      stubs,
      10,
    )?.value,
    "m",
  );
  assert.equal(inherited.inlineShape, shape(object));
  assert.equal(inherited.inlineHolder, shape(prototype));
  assert.equal(inherited.inlineSlot, inlineSlotBits(10));
  const inheritedMiss = createScriptPropertyCache("x", true);
  lookupCachedScriptProperty<string, unknown>(
    object,
    "x",
    inheritedMiss,
    false,
    stubs,
    10,
  );
  assert.equal(inheritedMiss.inlineShape, unusedPropertyShape);
});
