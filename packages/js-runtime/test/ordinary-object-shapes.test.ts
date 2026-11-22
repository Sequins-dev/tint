import assert from "node:assert/strict";
import test from "node:test";
import {
  createObject,
  createDataProperty,
  createScriptPropertyCache,
  createScriptPropertyStubCache,
  defineOwnProperty,
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

/** Looks up `key` through a fresh site cache, which installs the layout. */
function read(object: OrdinaryObject<string, unknown>, key: string): unknown {
  const cell = lookupCachedScriptProperty<string, unknown>(
    object,
    key,
    createScriptPropertyCache(key),
    false,
    stubs,
  );
  return cell?.value;
}
function shape(object: OrdinaryObject<string, unknown>): unknown {
  const layout = object.internalPropertyLayout;
  assert.ok(layout !== undefined);
  return layout.shape;
}
function point(
  prototype: OrdinaryObject<string, unknown> | undefined,
  keys: readonly string[],
): OrdinaryObject<string, unknown> {
  const object = createObject<string, unknown>(prototype);
  // Install the layout first so later additions extend it incrementally.
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
  // A layout built from scratch reaches the same shape.
  const late = createObject<string, unknown>(prototype);
  for (const key of ["x", "y", "z"])
    createDataProperty<string, unknown>(late, key, 0, hooks);
  assert.equal(late.internalPropertyLayout, undefined);
  read(late, "x");
  assert.equal(shape(late), shape(a));
});

test("redefinition keeps the shape and replaces the live cell", () => {
  const prototype = createObject<string, unknown>(undefined);
  const object = point(prototype, ["x", "y"]);
  const before = shape(object),
    epoch = object.internalPropertyEpoch;
  assert.equal(
    defineOwnProperty<string, unknown>(
      object,
      "x",
      {
        ...emptyUpdate<unknown>(undefined),
        fields: valueField | writableField | enumerableField,
        value: 7,
        writable: false,
        enumerable: false,
      },
      hooks,
    ),
    "accepted",
  );
  assert.equal(shape(object), before);
  assert.ok(object.internalPropertyEpoch > epoch);
  assert.equal(read(object, "x"), 7);
  assert.equal(object.internalPropertyLayout?.cells[0]?.writable, false);
});

test("deletion and prototype changes rebuild a canonical shape", () => {
  const prototype = createObject<string, unknown>(undefined),
    other = createObject<string, unknown>(undefined);
  const object = point(prototype, ["x", "y", "z"]);
  assert.ok(deleteProperty<string, unknown>(object, "y"));
  assert.equal(object.internalPropertyLayout, undefined);
  assert.equal(read(object, "z"), 2);
  assert.equal(shape(object), shape(point(prototype, ["x", "z"])));
  assert.ok(setPrototype<string, unknown>(object, other));
  assert.equal(object.internalPropertyLayout, undefined);
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
