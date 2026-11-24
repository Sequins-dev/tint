import assert from "node:assert/strict";
import test from "node:test";
import {
  createObject,
  createDataProperty,
  createScriptPropertyCache,
  createScriptPropertyStubCache,
  cachedScriptPropertyValue,
  defineOwnProperty,
  getOwnProperty,
  getProperty,
  inlineEntryHolder,
  inlineEntryShape,
  inlineEntrySlot,
  inlineSlotBits,
  lookupCachedScriptProperty,
  propertyCacheEntries,
  ownKeys,
  preventExtensions,
  propertyEpoch,
  setProperty,
  setPrototype,
  storeCachedScriptProperty,
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
  assert.equal(target.internalDictionary, false);
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
  assert.equal(a.properties.size, 0);
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
  assert.deepEqual(wide.internalValues, [8, 9]);
  assert.equal(read(wide, "k9"), 9);
  assert.deepEqual(keysOf(wide), keys);
});

test("deletion, freezing and many keys move objects to dictionary mode", () => {
  const prototype = object(undefined),
    other = object(undefined);
  const target = point(prototype, ["x", "y", "z"]);
  assert.ok(deleteProperty<ScriptPropertyKey, unknown>(target, "y"));
  assert.equal(target.internalDictionary, true);
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
  assert.equal(frozen.internalDictionary, true);
  assert.equal(read(frozen, "x"), 0);
  const keys: string[] = [];
  for (let index = 0; index < 129; index++) keys.push("k" + String(index));
  const large = point(prototype, keys);
  assert.equal(large.internalDictionary, true);
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
  assert.equal(target.internalDictionary, false);
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
  assert.equal(target.properties.size, 0);
  assert.equal(read(target, "y"), 7);
  // Dictionary mode keeps the key order.
  assert.ok(deleteProperty<ScriptPropertyKey, unknown>(target, "x"));
  assert.deepEqual(keysOf(target), ["y", "z", symbol]);
});

test("prototypes get private shapes and their changes bump the epoch", () => {
  const prototype = point(object(undefined), ["m"]);
  const sibling = point(object(undefined), ["m"]);
  const before = shape(prototype);
  assert.equal(prototype.internalUsedAsPrototype, false);
  const child = point(prototype, ["x"]);
  assert.equal(prototype.internalUsedAsPrototype, true);
  assert.notEqual(shape(prototype), before);
  assert.notEqual(shape(prototype), shape(sibling));
  assert.equal(read(child, "m"), 0);
  // Key additions to a prototype invalidate cached transitions.
  const epoch = propertyEpoch.value;
  createDataProperty<ScriptPropertyKey, unknown>(prototype, "n", 1, hooks);
  assert.ok(propertyEpoch.value > epoch);
  // Value writes do not.
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
  assert.equal(propertyEpoch.value, after);
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
  // A prototype's property fills the inherited entry and keeps the own one.
  const method = createScriptPropertyCache("method");
  assert.equal(
    lookupCachedScriptProperty(target, "method", method, false, stubs, 10),
    prototype,
  );
  assert.equal(cachedScriptPropertyValue(prototype, method), "m");
  assert.equal(method.inheritedShape, shape(target));
  assert.equal(method.inheritedObject, prototype);
  assert.equal(method.inheritedEpoch, propertyEpoch.value);
  assert.equal(method.inheritedEpochs, propertyEpoch);
  assert.equal(method.inheritedSlot, inlineSlotBits(10));
  assert.equal(method.ownShape, unusedPropertyShape);
  // A newer own entry replaces the own one only.
  const own = point(prototype, ["method"]);
  lookupCachedScriptProperty(own, "method", method, false, stubs, 10);
  assert.equal(method.ownShape, shape(own));
  assert.equal(method.ownSlot, inlineSlotBits(10));
  assert.equal(method.inheritedObject, prototype);
  // An empty object takes its root shape so inherited reads cache too.
  const empty = object(prototype);
  const inherited = createScriptPropertyCache("method");
  assert.equal(
    lookupCachedScriptProperty(empty, "method", inherited, false, stubs, 10),
    prototype,
  );
  assert.equal(inherited.inheritedShape, empty.internalShape);
});

test("an inherited entry holds a deeper prototype until any prototype changes structure", () => {
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
  assert.equal(site.inheritedObject, base);
  assert.equal(site.inheritedSlot, inlineSlotBits(10));
  const found = site.inheritedEpoch;
  assert.equal(found, propertyEpoch.value);
  // Shadowing the method on the intermediate prototype changes neither the
  // receiver's nor the holder's shape, but advances the epoch.
  createDataProperty<ScriptPropertyKey, unknown>(middle, "method", "n", hooks);
  assert.notEqual(propertyEpoch.value, found);
  assert.equal(shape(target), site.inheritedShape);
  // The next lookup finds the shadowing property and refreshes the entry.
  assert.equal(
    lookupCachedScriptProperty(target, "method", site, false, stubs, 10),
    middle,
  );
  assert.equal(site.inheritedObject, middle);
  assert.equal(site.inheritedEpoch, propertyEpoch.value);
});

test("a site keeps one inline entry per receiver shape until its entries are full", () => {
  const prototype = object(undefined);
  // Five receiver shapes holding "x" at different slots.
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
  // of five shapes would miss on every read).
  assert.equal(
    lookupCachedScriptProperty(receivers[4]!, "x", site, false, stubs, 10),
    receivers[4],
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
  assert.equal(inlineEntryHolder(site, 0), base);
  assert.equal(inlineEntryHolder(site, 1), other);
  assert.equal(site.inheritedEpoch, propertyEpoch.value);
  // A prototype's structural change makes both entries stale; the next
  // entry found starts over under the new epoch.
  createDataProperty<ScriptPropertyKey, unknown>(other, "n", 1, hooks);
  assert.notEqual(site.inheritedEpoch, propertyEpoch.value);
  lookupCachedScriptProperty(first, "m", site, false, stubs, 10);
  assert.equal(site.inheritedEpoch, propertyEpoch.value);
  assert.equal(inlineEntryShape(site, true, 0), shape(first));
  assert.equal(inlineEntryHolder(site, 0), base);
  assert.equal(inlineEntryShape(site, true, 1), unusedPropertyShape);
  assert.equal(inlineEntryHolder(site, 1), undefined);
});

test("a method site keeps own properties among its inherited entries without a holder", () => {
  const prototype = object(undefined);
  createDataProperty<ScriptPropertyKey, unknown>(prototype, "m", "base", hooks);
  // An object literal's own method, then a prototype's.
  const literal = point(prototype, ["m"]),
    instance = point(prototype, ["x"]);
  const site = createScriptPropertyCache("m", true);
  assert.equal(site.method, true);
  assert.equal(
    lookupCachedScriptProperty(literal, "m", site, false, stubs, 0),
    literal,
  );
  assert.equal(
    lookupCachedScriptProperty(instance, "m", site, false, stubs, 0),
    prototype,
  );
  assert.equal(site.ownShape, unusedPropertyShape);
  assert.equal(inlineEntryShape(site, true, 0), shape(literal));
  assert.equal(inlineEntryHolder(site, 0), undefined);
  // Portable slot reads count words from the first value (slot word 0).
  assert.equal(inlineEntrySlot(site, true, 0), inlineSlotBits(0));
  assert.equal(inlineEntryShape(site, true, 1), shape(instance));
  assert.equal(inlineEntryHolder(site, 1), prototype);
  // A plain read site keeps own properties in its own entries.
  const plain = createScriptPropertyCache("m");
  assert.equal(plain.method, false);
  lookupCachedScriptProperty(literal, "m", plain, false, stubs, 0);
  assert.equal(plain.ownShape, shape(literal));
  assert.equal(plain.inheritedShape, unusedPropertyShape);
});

test("a site caches stores to writable properties and the transitions that add them", () => {
  const prototype = object(undefined);
  const first = object(prototype);
  const site = createScriptPropertyCache("x");
  assert.ok(storeCachedScriptProperty(first, "x", 1, site, 10));
  assert.equal(first.internalValue0, 1);
  assert.equal(site.storeShape, prototype.internalChildShape);
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
  assert.equal(shadowSite.storeShape, prototype.internalChildShape);
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
