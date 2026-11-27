import assert from "node:assert/strict";
import test from "node:test";
import {
  createObject,
  createDataProperty,
  createScriptPropertyCache,
  createScriptPropertyStubCache,
  cachedScriptPropertyValue,
  defineOwnProperty,
  ensureExoticSlots,
  ensureRareSlots,
  exoticSlots,
  getOwnProperty,
  getProperty,
  inlineEntryValue,
  inlineEntryShape,
  inlineEntrySlot,
  inlineSlotBits,
  inlineSpillSlotBits,
  lookupCachedScriptProperty,
  lookupCachedStringPrimitiveProperty,
  propertyCacheEntries,
  propertyInheritedCacheEntries,
  ownKeys,
  preventExtensions,
  propertyEpoch,
  setProperty,
  setPrototype,
  storeCachedScriptProperty,
  stringPrimitiveShape,
  unusedPropertyShape,
  deleteProperty,
  type ObjectHooks,
  type OrdinaryObject,
} from "../src/objects/operations.ts";
import {
  configurableField,
  emptyUpdate,
  enumerableField,
  getField,
  setField,
  valueField,
  writableField,
} from "../src/descriptors/index.ts";
import {
  createSymbolValue,
  scriptPropertyKeyOrder,
  type ScriptPropertyKey,
} from "../src/objects/symbols.ts";

type ScriptObject = OrdinaryObject<ScriptPropertyKey, unknown>;
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: (callee, receiver, args) =>
    (callee as (this: unknown, ...values: unknown[]) => unknown).apply(
      receiver,
      [...args],
    ),
};
const stubs = createScriptPropertyStubCache();

function object(prototype: ScriptObject | undefined): ScriptObject {
  return createObject<ScriptPropertyKey, unknown>(prototype);
}
/** Reads `key` through a fresh site cache. */
function read(target: ScriptObject, key: string): unknown {
  const site = createScriptPropertyCache(key);
  const holder = lookupCachedScriptProperty(target, key, site, false, stubs, 0);
  return holder === undefined
    ? getProperty<ScriptPropertyKey, unknown>(target, key, target, hooks)
    : cachedScriptPropertyValue(holder, site);
}
function shape(target: ScriptObject): unknown {
  assert.equal((target.internalFlags & 2) !== 0, false);
  const installed = target.internalShape;
  assert.ok(installed !== undefined);
  return installed;
}
function point(
  prototype: ScriptObject | undefined,
  keys: readonly string[],
): ScriptObject {
  const result = object(prototype);
  for (const [index, key] of keys.entries())
    createDataProperty<ScriptPropertyKey, unknown>(result, key, index, hooks);
  return result;
}
function keysOf(target: ScriptObject): ScriptPropertyKey[] {
  return ownKeys<ScriptPropertyKey, unknown>(target, scriptPropertyKeyOrder);
}

test("objects with one prototype and key order share one shape", () => {
  const prototype = object(undefined);
  const a = point(prototype, ["x", "y", "z"]),
    b = point(prototype, ["x", "y", "z"]);
  assert.equal(read(a, "y"), 1);
  assert.equal(read(b, "z"), 2);
  assert.equal(shape(a), shape(b));
  // Values live in the object, in key order.
  assert.deepEqual(
    [a.internalValue0, a.internalValue1, a.internalValue2, a.internalValue3],
    [0, 1, 2, undefined],
  );
  assert.equal(a.internalRareSlots?.properties, undefined);
  // A different order or prototype is a different shape.
  assert.notEqual(shape(point(prototype, ["y", "x", "z"])), shape(a));
  assert.notEqual(shape(point(object(undefined), ["x", "y", "z"])), shape(a));
});

function redefine(
  target: ScriptObject,
  key: string,
  fields: number,
  writable: boolean,
): void {
  assert.equal(
    defineOwnProperty<ScriptPropertyKey, unknown>(
      target,
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

test("attribute changes move the object to the shape that records them", () => {
  const prototype = object(undefined);
  const target = point(prototype, ["x", "y"]);
  const before = shape(target);
  // A value-only change keeps the shape.
  assert.ok(
    setProperty<ScriptPropertyKey, unknown>(
      target,
      "x",
      5,
      { object: target, value: target },
      hooks,
    ),
  );
  assert.equal(shape(target), before);
  assert.equal(target.internalValue0, 5);
  redefine(target, "x", writableField, false);
  assert.notEqual(shape(target), before);
  assert.equal(read(target, "x"), 7);
  const descriptor = getOwnProperty<ScriptPropertyKey, unknown>(target, "x");
  assert.equal(descriptor?.writable, false);
  assert.equal(descriptor?.enumerable, false);
  assert.equal(descriptor?.configurable, true);
  // The same keys and kinds from the same root are one shape again.
  const other = point(prototype, ["x", "y"]);
  redefine(other, "x", writableField, false);
  assert.equal(shape(other), shape(target));
  // A rejected write leaves the value.
  assert.equal(
    setProperty<ScriptPropertyKey, unknown>(
      target,
      "x",
      9,
      { object: target, value: target },
      hooks,
    ),
    false,
  );
  assert.equal(read(target, "x"), 7);
});

test("values past the in-place slots spill in key order", () => {
  const keys: string[] = [];
  for (let index = 0; index < 10; index++) keys.push("k" + String(index));
  const wide = point(object(undefined), keys);
  assert.equal(wide.internalValue7, 7);
  assert.equal(wide.internalValues?.v0, 8);
  assert.equal(wide.internalValues?.v1, 9);
  assert.equal(read(wide, "k9"), 9);
  assert.deepEqual(keysOf(wide), keys);
});

test("deletion, freezing and many keys move objects to dictionary mode", () => {
  const prototype = object(undefined),
    other = object(undefined);
  const target = point(prototype, ["x", "y", "z"]);
  assert.ok(deleteProperty<ScriptPropertyKey, unknown>(target, "y"));
  assert.equal((target.internalFlags & 2) !== 0, true);
  assert.equal(target.internalShape, undefined);
  assert.equal(target.internalValue0, undefined);
  assert.deepEqual(keysOf(target), ["x", "z"]);
  assert.equal(read(target, "z"), 2);
  // A prototype change replays a fast object's keys from the new root.
  const moved = point(prototype, ["x", "z"]);
  assert.ok(setPrototype<ScriptPropertyKey, unknown>(moved, other));
  assert.equal(shape(moved), shape(point(other, ["x", "z"])));
  assert.equal(read(moved, "z"), 1);
  const frozen = point(prototype, ["x"]);
  assert.ok(preventExtensions<ScriptPropertyKey, unknown>(frozen));
  assert.equal((frozen.internalFlags & 2) !== 0, true);
  assert.equal(read(frozen, "x"), 0);
  const keys: string[] = [];
  for (let index = 0; index < 129; index++) keys.push("k" + String(index));
  const large = point(prototype, keys);
  assert.equal((large.internalFlags & 2) !== 0, true);
  assert.deepEqual(keysOf(large), keys);
  assert.equal(read(large, "k128"), 128);
});

test("accessors and symbol keys stay in fast mode", () => {
  const prototype = object(undefined);
  const target = point(prototype, ["x"]);
  const symbol = createSymbolValue("s");
  createDataProperty<ScriptPropertyKey, unknown>(target, symbol, "sym", hooks);
  let stored: unknown = undefined;
  assert.equal(
    defineOwnProperty<ScriptPropertyKey, unknown>(
      target,
      "y",
      {
        ...emptyUpdate<unknown>(undefined),
        fields: getField | setField | enumerableField | configurableField,
        get: function (this: ScriptObject): unknown {
          return this === target ? "got" : "wrong";
        },
        set: (value: unknown): void => {
          stored = value;
        },
        enumerable: true,
        configurable: true,
      },
      hooks,
    ),
    "accepted",
  );
  createDataProperty<ScriptPropertyKey, unknown>(target, "z", 3, hooks);
  assert.equal((target.internalFlags & 2) !== 0, false);
  // Strings in insertion order, then symbols.
  assert.deepEqual(keysOf(target), ["x", "y", "z", symbol]);
  assert.equal(
    getOwnProperty<ScriptPropertyKey, unknown>(target, "y")?.accessor,
    true,
  );
  assert.equal(
    getProperty<ScriptPropertyKey, unknown>(target, "y", target, hooks),
    "got",
  );
  assert.equal(
    getProperty<ScriptPropertyKey, unknown>(target, symbol, target, hooks),
    "sym",
  );
  assert.ok(
    setProperty<ScriptPropertyKey, unknown>(
      target,
      "y",
      4,
      { object: target, value: target },
      hooks,
    ),
  );
  assert.equal(stored, 4);
  // A cached site never serves an accessor from a value slot.
  const site = createScriptPropertyCache("y");
  assert.equal(
    lookupCachedScriptProperty(target, "y", site, false, stubs, 0),
    undefined,
  );
  assert.equal(site.ownShape, unusedPropertyShape);
  assert.equal(read(target, "z"), 3);
  // Turning the accessor into data drops its stored descriptor.
  redefine(target, "y", writableField, true);
  assert.equal(target.internalRareSlots?.properties?.size ?? 0, 0);
  assert.equal(read(target, "y"), 7);
  // Dictionary mode keeps the key order.
  assert.ok(deleteProperty<ScriptPropertyKey, unknown>(target, "x"));
  assert.deepEqual(keysOf(target), ["y", "z", symbol]);
});

test("prototypes get private shapes and their changes bump the epoch", () => {
  const prototype = point(object(undefined), ["m"]);
  const sibling = point(object(undefined), ["m"]);
  const before = shape(prototype);
  assert.equal((prototype.internalFlags & 4) !== 0, false);
  const child = point(prototype, ["x"]);
  assert.equal((prototype.internalFlags & 4) !== 0, true);
  assert.notEqual(shape(prototype), before);
  assert.notEqual(shape(prototype), shape(sibling));
  assert.equal(read(child, "m"), 0);
  // Key additions to a prototype invalidate cached transitions.
  const epoch = propertyEpoch.value;
  createDataProperty<ScriptPropertyKey, unknown>(prototype, "n", 1, hooks);
  assert.ok(propertyEpoch.value > epoch);
  // Prototype value writes also bump the epoch so direct inherited value
  // caches invalidate.
  const after = propertyEpoch.value;
  assert.ok(
    setProperty<ScriptPropertyKey, unknown>(
      prototype,
      "m",
      2,
      { object: prototype, value: prototype },
      hooks,
    ),
  );
  assert.ok(propertyEpoch.value > after);
  assert.equal(read(child, "m"), 2);
  // An empty prototype moved to another prototype stays private.
  const empty = object(undefined);
  object(empty);
  const other = object(undefined);
  const sibling2 = point(other, ["k"]);
  assert.ok(setPrototype<ScriptPropertyKey, unknown>(empty, other));
  createDataProperty<ScriptPropertyKey, unknown>(empty, "k", 1, hooks);
  assert.notEqual(shape(empty), shape(sibling2));
});

test("null-prototype and dictionary-like objects keep private shapes", () => {
  const a = point(undefined, ["x"]),
    b = point(undefined, ["x"]);
  assert.notEqual(shape(a), shape(b));
  const prototype = object(undefined);
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

test("a site exposes its newest own and inherited entries inline", () => {
  const prototype = object(undefined);
  createDataProperty<ScriptPropertyKey, unknown>(
    prototype,
    "method",
    "m",
    hooks,
  );
  const target = point(prototype, ["x", "y"]);
  const site = createScriptPropertyCache("y");
  assert.equal(site.ownShape, unusedPropertyShape);
  assert.equal(site.inheritedShape, unusedPropertyShape);
  // Generated code reads the value's word index as raw bits: slotWord plus
  // two words per value.
  assert.equal(
    lookupCachedScriptProperty(target, "y", site, false, stubs, 10),
    target,
  );
  assert.equal(cachedScriptPropertyValue(target, site), 1);
  assert.equal(site.ownShape, shape(target));
  assert.equal(site.ownSlot, inlineSlotBits(12));
  assert.equal(site.inheritedShape, unusedPropertyShape);
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, site.ownSlot, true);
  assert.equal(bits.getBigUint64(0, true), 12n);
  // A prototype's property fills the inherited entry directly (slot === 0) and keeps the own one.
  const method = createScriptPropertyCache("method");
  assert.equal(
    lookupCachedScriptProperty(target, "method", method, false, stubs, 10),
    prototype,
  );
  assert.equal(cachedScriptPropertyValue(prototype, method), "m");
  assert.equal(method.inheritedShape, shape(target));
  assert.equal(method.inheritedValue, "m");
  assert.equal(method.inheritedEpoch, propertyEpoch.value);
  assert.equal(method.inheritedEpochs, propertyEpoch);
  assert.equal(method.inheritedSlot, 0);
  assert.equal(method.ownShape, unusedPropertyShape);
  // A newer own entry replaces the own one only.
  const own = point(prototype, ["method"]);
  lookupCachedScriptProperty(own, "method", method, false, stubs, 10);
  assert.equal(method.ownShape, shape(own));
  assert.equal(method.ownSlot, inlineSlotBits(10));
  assert.equal(method.inheritedValue, "m");
  // An empty object takes its root shape so inherited reads cache too.
  const empty = object(prototype);
  const inherited = createScriptPropertyCache("method");
  assert.equal(
    lookupCachedScriptProperty(empty, "method", inherited, false, stubs, 10),
    prototype,
  );
  assert.equal(inherited.inheritedShape, empty.internalShape);
});

test("an inherited entry holds a deeper prototype until any prototype changes structure or value", () => {
  // target -> middle -> base, where base holds the method.
  const base = object(undefined);
  createDataProperty<ScriptPropertyKey, unknown>(base, "method", "m", hooks);
  const middle = object(base);
  createDataProperty<ScriptPropertyKey, unknown>(middle, "other", 1, hooks);
  const target = point(middle, ["x"]);
  const site = createScriptPropertyCache("method");
  assert.equal(
    lookupCachedScriptProperty(target, "method", site, false, stubs, 10),
    base,
  );
  assert.equal(site.inheritedShape, shape(target));
  assert.equal(site.inheritedValue, "m");
  assert.equal(site.inheritedSlot, 0);
  const found = site.inheritedEpoch;
  assert.equal(found, propertyEpoch.value);
  // Overwriting a prototype's value advances the epoch too.
  assert.ok(
    setProperty<ScriptPropertyKey, unknown>(
      base,
      "method",
      "m2",
      { object: base, value: base },
      hooks,
    ),
  );
  assert.notEqual(propertyEpoch.value, found);
  assert.equal(
    lookupCachedScriptProperty(target, "method", site, false, stubs, 10),
    base,
  );
  assert.equal(site.inheritedValue, "m2");
  const afterValue = site.inheritedEpoch;
  // Shadowing the method on the intermediate prototype changes neither the
  // receiver's nor the holder's shape, but advances the epoch.
  createDataProperty<ScriptPropertyKey, unknown>(middle, "method", "n", hooks);
  assert.notEqual(propertyEpoch.value, afterValue);
  assert.equal(shape(target), site.inheritedShape);
  // The next lookup finds the shadowing property and refreshes the entry.
  assert.equal(
    lookupCachedScriptProperty(target, "method", site, false, stubs, 10),
    middle,
  );
  assert.equal(site.inheritedValue, "n");
  assert.equal(site.inheritedEpoch, propertyEpoch.value);
});

test("a site keeps one inline entry per receiver shape until its entries are full", () => {
  const prototype = object(undefined);
  // Five receiver shapes holding "x" at different slots (one past propertyCacheEntries = 4).
  const receivers = [
    point(prototype, ["x"]),
    point(prototype, ["a", "x"]),
    point(prototype, ["b", "x"]),
    point(prototype, ["c", "d", "x"]),
    point(prototype, ["e", "x"]),
  ];
  const site = createScriptPropertyCache("x");
  for (let index = 0; index < propertyCacheEntries; index++) {
    lookupCachedScriptProperty(receivers[index]!, "x", site, false, stubs, 10);
    assert.equal(
      inlineEntryShape(site, false, index),
      shape(receivers[index]!),
    );
  }
  assert.equal(inlineEntrySlot(site, false, 0), inlineSlotBits(10));
  assert.equal(inlineEntrySlot(site, false, 3), inlineSlotBits(14));
  // A fifth shape makes the site megamorphic: the lookup still finds it,
  // and the full entries stay as they are (rotating them through a cycle
  // of shapes would miss on every read).
  const overflow = receivers[propertyCacheEntries]!;
  assert.equal(
    lookupCachedScriptProperty(overflow, "x", site, false, stubs, 10),
    overflow,
  );
  assert.equal(site.megamorphic, true);
  for (let index = 0; index < propertyCacheEntries; index++)
    assert.equal(
      inlineEntryShape(site, false, index),
      shape(receivers[index]!),
    );
});

test("inherited entries share an epoch and clear when a newer one finds an entry", () => {
  const base = object(undefined);
  createDataProperty<ScriptPropertyKey, unknown>(base, "m", "base", hooks);
  const other = object(undefined);
  createDataProperty<ScriptPropertyKey, unknown>(other, "m", "other", hooks);
  const first = point(base, ["x"]),
    second = point(other, ["x"]);
  const site = createScriptPropertyCache("m");
  lookupCachedScriptProperty(first, "m", site, false, stubs, 10);
  lookupCachedScriptProperty(second, "m", site, false, stubs, 10);
  assert.equal(inlineEntryValue(site, 0), "base");
  assert.equal(inlineEntryValue(site, 1), "other");
  assert.equal(site.inheritedEpoch, propertyEpoch.value);
  // A prototype's structural change makes both entries stale; the next
  // entry found starts over under the new epoch.
  createDataProperty<ScriptPropertyKey, unknown>(other, "n", 1, hooks);
  assert.notEqual(site.inheritedEpoch, propertyEpoch.value);
  lookupCachedScriptProperty(first, "m", site, false, stubs, 10);
  assert.equal(site.inheritedEpoch, propertyEpoch.value);
  assert.equal(inlineEntryShape(site, true, 0), shape(first));
  assert.equal(inlineEntryValue(site, 0), "base");
  assert.equal(inlineEntryShape(site, true, 1), unusedPropertyShape);
  assert.equal(inlineEntryValue(site, 1), undefined);
});

test("a full inherited site keeps its entries until a newer epoch", () => {
  const prototype = object(undefined);
  createDataProperty<ScriptPropertyKey, unknown>(prototype, "m", "m", hooks);
  const receivers = [
    point(prototype, ["a"]),
    point(prototype, ["b"]),
    point(prototype, ["c"]),
    point(prototype, ["d"]),
    point(prototype, ["e"]),
    point(prototype, ["f"]),
    point(prototype, ["g"]),
    point(prototype, ["h"]),
    point(prototype, ["i"]),
  ];
  const site = createScriptPropertyCache("m");
  for (const receiver of receivers)
    assert.equal(
      lookupCachedScriptProperty(receiver, "m", site, false, stubs, 10),
      prototype,
    );
  // The ninth shape is past the full entries.
  for (let index = 0; index < propertyInheritedCacheEntries; index++)
    assert.equal(inlineEntryShape(site, true, index), shape(receivers[index]!));
  // A prototype's structural change makes the entries stale: the next
  // lookup starts over with its own shape.
  createDataProperty<ScriptPropertyKey, unknown>(prototype, "n", 1, hooks);
  const overflow = receivers[propertyInheritedCacheEntries]!;
  lookupCachedScriptProperty(overflow, "m", site, false, stubs, 10);
  assert.equal(site.inheritedEpoch, propertyEpoch.value);
  assert.equal(inlineEntryShape(site, true, 0), shape(overflow));
  assert.equal(inlineEntryValue(site, 0), "m");
  assert.equal(inlineEntryShape(site, true, 1), unusedPropertyShape);
});

test("a method site keeps own properties among its inherited entries with non-zero slot", () => {
  const prototype = object(undefined);
  createDataProperty<ScriptPropertyKey, unknown>(prototype, "m", "base", hooks);
  // An object literal's own method, then a prototype's.
  const literal = point(prototype, ["m"]),
    instance = point(prototype, ["x"]);
  const site = createScriptPropertyCache("m", true);
  assert.equal(site.method, true);
  assert.equal(
    lookupCachedScriptProperty(literal, "m", site, false, stubs, 10),
    literal,
  );
  assert.equal(
    lookupCachedScriptProperty(instance, "m", site, false, stubs, 10),
    prototype,
  );
  assert.equal(site.ownShape, unusedPropertyShape);
  assert.equal(inlineEntryShape(site, true, 0), shape(literal));
  assert.equal(inlineEntrySlot(site, true, 0), inlineSlotBits(10));
  assert.equal(inlineEntryShape(site, true, 1), shape(instance));
  assert.equal(inlineEntrySlot(site, true, 1), 0);
  assert.equal(inlineEntryValue(site, 1), "base");
  // A plain read site keeps own properties in its own entries.
  const plain = createScriptPropertyCache("m");
  assert.equal(plain.method, false);
  lookupCachedScriptProperty(literal, "m", plain, false, stubs, 10);
  assert.equal(plain.ownShape, shape(literal));
  assert.equal(plain.inheritedShape, unusedPropertyShape);
});

test("deep prototype chains, spilled own slots and string primitives cache inline", () => {
  // Depth-5 prototype chain with method at slot 10 (spilled on prototype).
  const root = object(undefined);
  for (let i = 0; i < 10; i++)
    createDataProperty<ScriptPropertyKey, unknown>(root, "p" + i, i, hooks);
  createDataProperty<ScriptPropertyKey, unknown>(root, "deep", "ok", hooks);
  let proto = root;
  for (let d = 0; d < 4; d++) proto = object(proto);
  const leaf = point(proto, ["x"]);
  const deepSite = createScriptPropertyCache("deep", true);
  assert.equal(
    lookupCachedScriptProperty(leaf, "deep", deepSite, false, stubs, 10),
    root,
  );
  assert.equal(deepSite.inheritedShape, shape(leaf));
  assert.equal(deepSite.inheritedSlot, 0);
  assert.equal(deepSite.inheritedValue, "ok");
  // Spilled own property encodes negative spill slot bits.
  const wide = point(
    object(undefined),
    Array.from({ length: 12 }, (_, i) => "k" + i),
  );
  const spillSite = createScriptPropertyCache("k10", false);
  assert.equal(
    lookupCachedScriptProperty(wide, "k10", spillSite, false, stubs, 10),
    wide,
  );
  assert.equal(spillSite.ownShape, shape(wide));
  assert.equal(spillSite.ownSlot, inlineSpillSlotBits(0, 6));
  // String primitive prototype method caches under stringPrimitiveShape.
  const strProto = object(undefined);
  createDataProperty<ScriptPropertyKey, unknown>(
    strProto,
    "charCodeAt",
    "fn",
    hooks,
  );
  const strSite = createScriptPropertyCache("charCodeAt", true);
  assert.equal(
    lookupCachedStringPrimitiveProperty(strProto, "charCodeAt", strSite),
    true,
  );
  assert.equal(strSite.inheritedShape, stringPrimitiveShape);
  assert.equal(strSite.inheritedSlot, 0);
  assert.equal(strSite.inheritedValue, "fn");
});

test("a site caches stores to writable properties and the transitions that add them", () => {
  const prototype = object(undefined);
  const first = object(prototype);
  const site = createScriptPropertyCache("x");
  assert.ok(storeCachedScriptProperty(first, "x", 1, site, 10));
  assert.equal(first.internalValue0, 1);
  assert.equal(
    site.storeShape,
    prototype.internalRareSlots?.internalChildShape,
  );
  assert.equal(site.storeTransition, first.internalShape);
  assert.equal(site.storeSlot, inlineSlotBits(10));
  assert.equal(site.storeEpoch, propertyEpoch.value);
  assert.equal(site.epoch, propertyEpoch);
  // An existing writable property is a store without a transition.
  const again = createScriptPropertyCache("x");
  assert.ok(storeCachedScriptProperty(first, "x", 2, again, 10));
  assert.equal(first.internalValue0, 2);
  assert.equal(again.storeShape, first.internalShape);
  assert.equal(again.storeTransition, undefined);
  // Read-only properties, inherited read-only keys and non-extensible
  // objects take the ordinary path.
  redefine(first, "x", writableField, false);
  assert.equal(
    storeCachedScriptProperty(
      first,
      "x",
      3,
      createScriptPropertyCache("x"),
      10,
    ),
    false,
  );
  // An inherited writable data property still makes [[Set]] add an own
  // one; an inherited read-only property or accessor does not.
  createDataProperty<ScriptPropertyKey, unknown>(
    prototype,
    "shadowed",
    0,
    hooks,
  );
  const shadowing = object(prototype);
  const shadowSite = createScriptPropertyCache("shadowed");
  assert.ok(
    storeCachedScriptProperty(shadowing, "shadowed", 1, shadowSite, 10),
  );
  assert.equal(shadowing.internalValue0, 1);
  assert.equal(
    shadowSite.storeShape,
    prototype.internalRareSlots?.internalChildShape,
  );
  assert.notEqual(shadowSite.storeTransition, undefined);
  defineOwnProperty<ScriptPropertyKey, unknown>(
    prototype,
    "readOnly",
    {
      ...emptyUpdate<unknown>(undefined),
      fields: valueField | writableField,
      value: 0,
      writable: false,
    },
    hooks,
  );
  assert.equal(
    storeCachedScriptProperty(
      object(prototype),
      "readOnly",
      1,
      createScriptPropertyCache("readOnly"),
      10,
    ),
    false,
  );
  const fixed = object(prototype);
  preventExtensions<ScriptPropertyKey, unknown>(fixed);
  assert.equal(
    storeCachedScriptProperty(
      fixed,
      "y",
      1,
      createScriptPropertyCache("y"),
      10,
    ),
    false,
  );
  // Prototypes add keys without caching the transition.
  const parent = object(undefined);
  object(parent);
  const added = createScriptPropertyCache("y");
  assert.ok(storeCachedScriptProperty(parent, "y", 1, added, 10));
  assert.equal(added.storeTransition, undefined);
  assert.equal(added.storeShape, unusedPropertyShape);
});

test("exotic internal slots stay unallocated until written", () => {
  const plain = object(undefined);
  const other = object(undefined);
  assert.equal(plain.internalRareSlots?.internalExoticSlots, undefined);
  assert.equal(exoticSlots(plain).internalDateValue, undefined);
  assert.equal(exoticSlots(plain).internalErrorData, false);
  assert.equal(exoticSlots(plain).internalIsHTMLDDA, false);
  assert.equal(plain.internalRareSlots?.internalExoticSlots, undefined);
  const slots = ensureExoticSlots(plain);
  assert.equal(plain.internalRareSlots?.internalExoticSlots, slots);
  assert.equal(ensureExoticSlots(plain), slots);
  slots.internalDateValue = 1234;
  slots.internalErrorData = true;
  assert.equal(exoticSlots(plain).internalDateValue, 1234);
  assert.equal(exoticSlots(plain).internalErrorData, true);
  assert.equal(other.internalRareSlots?.internalExoticSlots, undefined);
  assert.equal(exoticSlots(other).internalDateValue, undefined);
  assert.equal(exoticSlots(other).internalErrorData, false);
});

test("rare generic internal slots stay unallocated until written", () => {
  const plain = object(undefined);
  const other = object(undefined);
  assert.equal(plain.internalRareSlots === undefined, true);
  createDataProperty<ScriptPropertyKey, unknown>(plain, "a", 42, hooks);
  assert.equal(
    getProperty<ScriptPropertyKey, unknown>(plain, "a", plain, hooks),
    42,
  );
  assert.equal(plain.internalRareSlots === undefined, true);
  const rare = ensureRareSlots<ScriptPropertyKey, unknown>(plain);
  assert.equal(plain.internalRareSlots, rare);
  assert.equal(ensureRareSlots<ScriptPropertyKey, unknown>(plain), rare);
  rare.internalImmutablePrototype = true;
  assert.equal(plain.internalRareSlots?.internalImmutablePrototype, true);
  assert.equal(other.internalRareSlots, undefined);
});

test("missing properties cache undefined and invalidate on own or prototype addition", () => {
  const proto = object(undefined);
  const child = point(proto, ["a"]);
  const sibling = point(proto, ["a"]);
  const site = createScriptPropertyCache("missing");
  const holder = lookupCachedScriptProperty(
    child,
    "missing",
    site,
    false,
    stubs,
    10,
  );
  assert.notEqual(holder, undefined);
  assert.equal(site.foundIndex, -1);
  assert.equal(site.foundValue, undefined);
  assert.equal(site.inheritedShape, shape(child));
  assert.equal(site.inheritedValue, undefined);
  // Adding the property to the prototype bumps propertyEpoch and serves the new value.
  createDataProperty<ScriptPropertyKey, unknown>(proto, "missing", 99, hooks);
  const afterProto = lookupCachedScriptProperty(
    sibling,
    "missing",
    site,
    false,
    stubs,
    10,
  );
  assert.equal(afterProto, proto);
  assert.equal(site.foundValue, 99);
  // Adding the property to the object itself transitions its shape.
  const other = point(object(undefined), ["a"]);
  const ownSite = createScriptPropertyCache("late");
  assert.notEqual(
    lookupCachedScriptProperty(other, "late", ownSite, false, stubs, 10),
    undefined,
  );
  assert.equal(ownSite.foundValue, undefined);
  createDataProperty<ScriptPropertyKey, unknown>(other, "late", 7, hooks);
  assert.equal(
    lookupCachedScriptProperty(other, "late", ownSite, false, stubs, 10),
    other,
  );
  assert.equal(ownSite.foundIndex, 1);
});

test("a store site caches up to 4 polymorphic receiver shapes across overwrites and transitions", () => {
  const prototype = object(undefined);
  // Four distinct shapes: 2 existing-property overwrites + 2 shape-adding transitions.
  const s0 = point(prototype, ["x"]);
  const s1 = point(prototype, ["a", "x"]);
  const s2 = point(prototype, ["b"]);
  const s3 = point(prototype, ["c", "d"]);
  const s4 = point(prototype, ["e", "x"]);
  const s2Before = shape(s2);
  const s3Before = shape(s3);
  const site = createScriptPropertyCache("x");

  assert.ok(storeCachedScriptProperty(s0, "x", 10, site, 10));
  assert.ok(storeCachedScriptProperty(s1, "x", 20, site, 10));
  assert.ok(storeCachedScriptProperty(s2, "x", 30, site, 10));
  assert.ok(storeCachedScriptProperty(s3, "x", 40, site, 10));

  assert.equal(site.storeShape, shape(s0));
  assert.equal(site.storeTransition, undefined);
  assert.equal(site.storeShape1, shape(s1));
  assert.equal(site.storeTransition1, undefined);
  assert.equal(site.storeShape2, s2Before);
  assert.equal(site.storeTransition2, shape(s2));
  assert.equal(site.storeShape3, s3Before);
  assert.equal(site.storeTransition3, shape(s3));

  assert.equal(getProperty<ScriptPropertyKey, unknown>(s0, "x", s0, hooks), 10);
  assert.equal(getProperty<ScriptPropertyKey, unknown>(s1, "x", s1, hooks), 20);
  assert.equal(getProperty<ScriptPropertyKey, unknown>(s2, "x", s2, hooks), 30);
  assert.equal(getProperty<ScriptPropertyKey, unknown>(s3, "x", s3, hooks), 40);

  // Fifth shape succeeds via slow path without clobbering entries 0..3.
  assert.ok(storeCachedScriptProperty(s4, "x", 50, site, 10));
  assert.equal(getProperty<ScriptPropertyKey, unknown>(s4, "x", s4, hooks), 50);
  assert.equal(site.storeShape, shape(s0));
  assert.equal(site.storeShape1, shape(s1));
  assert.equal(site.storeShape2, s2Before);
  assert.equal(site.storeShape3, s3Before);
});
