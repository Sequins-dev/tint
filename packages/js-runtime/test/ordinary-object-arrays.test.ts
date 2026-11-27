import type { ScriptPropertyKey } from "@tint/js-runtime/objects";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";
import {
  advanceScriptMapCursor,
  clearScriptMap,
  createScriptMap,
  createScriptMapCursor,
  deleteScriptMap,
  getScriptMap,
  hasScriptMap,
  readScriptMapCursorKey,
  readScriptMapCursorValue,
  setScriptMap,
} from "../src/objects/collection-data.ts";
import { emptyUpdate } from "@tint/js-runtime/descriptors";
const hooks: objects.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => undefined,
};
const arrayHooks: objects.ArrayObjectHooks<ScriptPropertyKey, unknown> = {
  lengthKey: "length",
  index: objects.scriptPropertyKeyOrder,
  indexKey: (index: number): ScriptPropertyKey => String(index),
  numberPayload: (value: unknown): number | undefined =>
    typeof value === "number" ? value : undefined,
  toNumber: Number,
  fromNumber: (value: number): unknown => value,
  fromGeneral: (value: unknown): unknown => value,
  rangeError: (): unknown => new RangeError(),
};
function array(
  length = 0,
  prototype?: objects.OrdinaryObject<ScriptPropertyKey, unknown>,
) {
  assert.equal(typeof objects.createArrayObject, "function");
  return objects.createArrayObject<ScriptPropertyKey, unknown>(
    length,
    prototype,
    arrayHooks,
    hooks,
  );
}
function length(object: objects.OrdinaryObject<ScriptPropertyKey, unknown>) {
  return objects.getOwnProperty(object, "length")!.value;
}
function resize(
  object: objects.OrdinaryObject<ScriptPropertyKey, unknown>,
  value: unknown,
  writable = true,
) {
  return objects.defineOwnProperty(
    object,
    "length",
    { ...emptyUpdate(undefined), fields: 3, value, writable },
    hooks,
  );
}
test("array indices extend length but named properties and deletion do not", () => {
  const a = array(2);
  assert.equal((a.internalFlags & 8) !== 0, true);
  assert.equal(objects.getOwnProperty(a, "0"), undefined);
  assert.equal(objects.createDataProperty(a, "4", 42, hooks), true);
  assert.equal(length(a), 5);
  for (const key of ["01", "-0", "4294967295"]) {
    assert.equal(objects.createDataProperty(a, key, 1, hooks), true);
    assert.equal(length(a), 5);
  }
  assert.equal(objects.deleteProperty(a, "4"), true);
  assert.equal(length(a), 5);
  const d = objects.getOwnProperty(a, "length")!;
  assert.equal(d.writable, true);
  assert.equal(d.enumerable, false);
  assert.equal(d.configurable, false);
});
test("read-only lengths allow existing indices but reject extension", () => {
  const a = array(2);
  assert.equal(resize(a, 2, false), "accepted");
  assert.equal(objects.createDataProperty(a, "1", 42, hooks), true);
  assert.equal(objects.createDataProperty(a, "2", 42, hooks), false);
  assert.equal(objects.getOwnProperty(a, "2"), undefined);
  assert.equal(resize(a, 1), "rejected");
  assert.equal(objects.deleteProperty(a, "length"), false);
});
test("failed shrinking deletes higher indices first and restores a read-only boundary", () => {
  const a = array();
  for (const key of ["4", "1", "3", "2"])
    objects.createDataProperty(a, key, 42, hooks);
  objects.defineOwnProperty(
    a,
    "2",
    { ...emptyUpdate(undefined), fields: 32, configurable: false },
    hooks,
  );
  assert.equal(resize(a, 0, false), "rejected");
  assert.equal(length(a), 3);
  assert.equal(objects.getOwnProperty(a, "4"), undefined);
  assert.equal(objects.getOwnProperty(a, "3"), undefined);
  assert.ok(objects.getOwnProperty(a, "2"));
  assert.ok(objects.getOwnProperty(a, "1"));
  assert.equal(objects.getOwnProperty(a, "length")!.writable, false);
});
test("length coercion occurs twice before reading the current length descriptor", () => {
  const a = array(3);
  let calls = 0;
  const value = {
    valueOf() {
      calls++;
      if (calls === 1) resize(a, 1, false);
      return 0;
    },
  };
  assert.equal(resize(a, value), "rejected");
  assert.equal(calls, 2);
  assert.equal(length(a), 1);
  for (const value of [-1, 1.5, NaN, Infinity, 4294967296])
    assert.throws(() => resize(array(), value), RangeError);
  const b = array();
  assert.equal(resize(b, -0), "accepted");
  assert.equal(Object.is(length(b), -0), false);
});
test("sparse shrinking handles the largest valid array index without scanning holes", () => {
  const a = array();
  objects.createDataProperty(a, "4294967294", 42, hooks);
  assert.equal(length(a), 4294967295);
  assert.equal(resize(a, 0), "accepted");
  assert.equal(length(a), 0);
  assert.equal(objects.getOwnProperty(a, "4294967294"), undefined);
});

test("rejected index definitions do not grow length, and accessors do", () => {
  const a = array();
  assert.equal(
    objects.defineOwnProperty(
      a,
      "2",
      {
        ...emptyUpdate(undefined),
        fields: 4,
        get: () => 42,
      },
      hooks,
    ),
    "accepted",
  );
  assert.equal(length(a), 3);
  objects.preventExtensions(a);
  assert.equal(objects.createDataProperty(a, "4", 42, hooks), false);
  assert.equal(length(a), 3);
  assert.equal(resize(a, 10), "accepted");
  assert.equal(length(a), 10);
});
test("abrupt length coercion leaves the old descriptor intact", () => {
  const a = array(2);
  let count = 0;
  const reason = {};
  assert.throws(
    () =>
      resize(a, {
        valueOf() {
          count++;
          throw reason;
        },
      }),
    (error) => error === reason,
  );
  assert.equal(count, 1);
  assert.equal(length(a), 2);
  for (const value of [-1, 1.5, NaN, Infinity, 4294967296])
    assert.throws(() => array(value), RangeError);
});

test("array list copies create fresh dense own elements from an argument suffix", () => {
  const realm = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  realm.cleanArrayPushEpoch = realm.propertyEpoch.value;
  const values = [1, undefined, 42];
  const result = objects.createArrayFromList(
    values,
    1,
    realm.arrayPrototype,
    realm,
    hooks,
  );
  assert.equal(result.prototype, realm.arrayPrototype);
  assert.equal(length(result), 2);
  assert.ok(objects.getOwnProperty(result, "0"));
  assert.equal(objects.getOwnProperty(result, "1")?.value, 42);
  values[2] = 0;
  assert.equal(objects.getOwnProperty(result, "1")?.value, 42);
  const empty = objects.createArrayFromList(
    values,
    10,
    realm.arrayPrototype,
    realm,
    hooks,
  );
  assert.equal(length(empty), 0);
});

test("resetting configurable array indices uses one classification pass", () => {
  let classifications = 0;
  const count = 1024;
  const a = objects.createArrayObject<ScriptPropertyKey, unknown>(
    0,
    undefined,
    {
      ...arrayHooks,
      index: (key) => {
        classifications++;
        return objects.scriptPropertyKeyOrder(key);
      },
      toNumber: Number,
      fromNumber: (value: number): unknown => value,
      rangeError: (): unknown => new RangeError(),
    },
    hooks,
  );
  for (let i = count - 1; i >= 0; i--)
    assert.equal(objects.createDataProperty(a, String(i), i, hooks), true);
  classifications = 0;
  assert.equal(resize(a, 0, false), "accepted");
  assert.ok(
    classifications <= count,
    `reset classified ${classifications} keys for ${count} indices`,
  );
  assert.deepEqual(objects.ownKeys(a, objects.scriptPropertyKeyOrder), [
    "length",
  ]);
  assert.equal(length(a), 0);
  assert.equal(objects.getOwnProperty(a, "length")!.writable, false);
  assert.equal(objects.createDataProperty(a, "0", 1, hooks), false);
});

test("reset preserves non-index properties and never invokes configurable accessors", () => {
  const a = array();
  let reads = 0;
  const getter = () => {
    reads++;
    return 42;
  };
  objects.defineOwnProperty(
    a,
    "9000",
    {
      ...emptyUpdate(undefined),
      fields: 4 | 16 | 32,
      get: getter,
      enumerable: true,
      configurable: true,
    },
    hooks,
  );
  const symbol = objects.createSymbolValue("retained");
  for (const key of ["01", "4294967295", symbol])
    objects.createDataProperty(a, key, key, hooks);
  assert.equal(resize(a, 0), "accepted");
  assert.equal(reads, 0);
  assert.equal(objects.getOwnProperty(a, "9000"), undefined);
  assert.deepEqual(objects.ownKeys(a, objects.scriptPropertyKeyOrder), [
    "length",
    "01",
    "4294967295",
    symbol,
  ]);
});

type ArrayValue = objects.OrdinaryObject<ScriptPropertyKey, unknown>;
function put(a: ArrayValue, key: ScriptPropertyKey, value: unknown) {
  return objects.setProperty(a, key, value, { value: a, object: a }, hooks);
}
function get(a: ArrayValue, key: ScriptPropertyKey) {
  return objects.getProperty(a, key, a, hooks);
}
function keys(a: ArrayValue) {
  return objects.ownKeys(a, objects.scriptPropertyKeyOrder);
}
function data(a: ArrayValue, key: ScriptPropertyKey) {
  const d = objects.getOwnProperty(a, key);
  return d === undefined
    ? undefined
    : [d.accessor, d.value, d.writable, d.enumerable, d.configurable];
}
function packed(count: number) {
  const a = array();
  for (let i = 0; i < count; i++) assert.equal(put(a, String(i), i), true);
  return a;
}
function define(
  a: ArrayValue,
  key: ScriptPropertyKey,
  fields: Partial<ReturnType<typeof emptyUpdate<unknown>>>,
) {
  return objects.defineOwnProperty(
    a,
    key,
    { ...emptyUpdate<unknown>(undefined), ...fields },
    hooks,
  );
}

test("packed elements keep array indices and length out of the property map", () => {
  const a = packed(100);
  const b = array();
  assert.notEqual(a.internalArrayElements, undefined);
  assert.equal(a.internalRareSlots?.properties, undefined);
  assert.equal(a.internalMethods, b.internalMethods);
  assert.equal(length(a), 100);
  assert.deepEqual(data(a, "42"), [false, 42, true, true, true]);
  assert.equal(get(a, "99"), 99);
  assert.equal(objects.getOwnProperty(a, "100"), undefined);
  assert.deepEqual(keys(a).slice(0, 3), ["0", "1", "2"]);
  assert.equal(keys(a).at(-1), "length");
  assert.equal(objects.createDataProperty(a, "100", 100, hooks), true);
  assert.equal(a.internalRareSlots?.properties, undefined);
});

test("storing a non-number switches number elements to values once", () => {
  const a = array();
  put(a, "0", -0);
  put(a, "1", NaN);
  put(a, "2", 2);
  const before = a.internalArrayElements!;
  assert.equal(before.generalCount, 0);
  assert.equal(before.numberCount, 3);
  const object = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  put(a, "1", object);
  put(a, "3", "three");
  const after = a.internalArrayElements!;
  assert.equal(after.numberCount, 0);
  assert.equal(after.generalCount, 4);
  assert.ok(Object.is(get(a, "0"), -0));
  assert.equal(get(a, "1"), object);
  assert.equal(get(a, "2"), 2);
  assert.equal(get(a, "3"), "three");
  put(a, "4", 4);
  assert.equal(get(a, "4"), 4);
  assert.equal(a.internalRareSlots?.properties, undefined);
  assert.equal(length(a), 5);
});

test("number elements grow in place and an emptied array starts over as numbers", () => {
  const a = array();
  for (let i = 0; i < 100; i++) put(a, String(i), i / 2);
  const elements = a.internalArrayElements!;
  assert.equal(elements.generalCount, 0);
  assert.equal(elements.numberCount, 100);
  assert.ok(elements.numbers.length >= 100);
  assert.equal(get(a, "99"), 49.5);
  put(a, "100", "text");
  assert.equal(elements.numberCount, 0);
  assert.equal(a.internalArrayElements?.generalCount, 101);
  assert.equal(get(a, "99"), 49.5);
  assert.equal(resize(a, 0), "accepted");
  assert.equal(elements.generalCount, 0);
  assert.equal(elements.numberCount, 0);
  put(a, "0", 7);
  assert.equal(elements.numberCount, 1);
  assert.equal(get(a, "0"), 7);
  assert.equal(length(a), 1);
});

test("non-default attributes and accessors convert to descriptors", () => {
  const a = packed(4);
  assert.equal(define(a, "2", { fields: 2, writable: false }), "accepted");
  assert.equal(a.internalArrayElements, undefined);
  assert.deepEqual(data(a, "2"), [false, 2, false, true, true]);
  assert.deepEqual(data(a, "3"), [false, 3, true, true, true]);
  assert.equal(put(a, "2", 9), false);
  assert.deepEqual(keys(a), ["0", "1", "2", "3", "length"]);
  const b = packed(2);
  let read = 0;
  assert.equal(
    define(b, "1", {
      fields: 4 | 16 | 32,
      get: () => ++read,
      enumerable: true,
      configurable: true,
    }),
    "accepted",
  );
  assert.equal(b.internalArrayElements, undefined);
  const d = objects.getOwnProperty(b, "1")!;
  assert.equal(d.accessor, true);
  const c = packed(2);
  assert.equal(
    define(c, "2", { fields: 1 | 2 | 16, value: 7, writable: true }),
    "accepted",
  );
  assert.equal(c.internalArrayElements, undefined);
  assert.deepEqual(data(c, "2"), [false, 7, true, false, false]);
  assert.equal(length(c), 3);
});

test("value-only redefinitions keep packed elements", () => {
  const a = packed(3);
  assert.equal(define(a, "1", { fields: 1, value: "one" }), "accepted");
  assert.equal(
    define(a, "2", {
      fields: 1 | 2 | 16 | 32,
      value: 22,
      writable: true,
      enumerable: true,
      configurable: true,
    }),
    "accepted",
  );
  assert.notEqual(a.internalArrayElements, undefined);
  assert.equal(get(a, "1"), "one");
  assert.equal(get(a, "2"), 22);
  assert.equal(define(a, "0", { fields: 0 }), "accepted");
  assert.notEqual(a.internalArrayElements, undefined);
});

test("sparse writes beyond count convert and keep every element", () => {
  const a = packed(3);
  assert.equal(put(a, "1000000", "x"), true);
  assert.equal(a.internalArrayElements, undefined);
  assert.equal(length(a), 1000001);
  assert.equal(get(a, "1000000"), "x");
  assert.equal(get(a, "2"), 2);
  assert.equal(objects.getOwnProperty(a, "3"), undefined);
  assert.deepEqual(keys(a), ["0", "1", "2", "1000000", "length"]);
  const b = packed(3);
  assert.equal(put(b, "4", 4), true);
  assert.equal(b.internalArrayElements, undefined);
  assert.equal(objects.getOwnProperty(b, "3"), undefined);
  assert.equal(length(b), 5);
});

test("deleting the last element stays packed but a middle delete converts", () => {
  const a = packed(4);
  assert.equal(objects.deleteProperty(a, "3"), true);
  assert.notEqual(a.internalArrayElements, undefined);
  assert.equal(length(a), 4);
  assert.equal(objects.getOwnProperty(a, "3"), undefined);
  assert.equal(objects.deleteProperty(a, "7"), true);
  assert.notEqual(a.internalArrayElements, undefined);
  assert.equal(objects.deleteProperty(a, "1"), true);
  assert.equal(a.internalArrayElements, undefined);
  assert.equal(objects.getOwnProperty(a, "1"), undefined);
  assert.deepEqual(keys(a), ["0", "2", "length"]);
  assert.equal(length(a), 4);
});

test("length growth keeps packed elements and shrinking truncates them", () => {
  const a = packed(5);
  assert.equal(resize(a, 10), "accepted");
  assert.notEqual(a.internalArrayElements, undefined);
  assert.equal(objects.getOwnProperty(a, "7"), undefined);
  assert.equal(put(a, "7", 7), true);
  assert.equal(a.internalArrayElements, undefined);
  const b = packed(5);
  assert.equal(resize(b, 2), "accepted");
  assert.notEqual(b.internalArrayElements, undefined);
  assert.deepEqual(keys(b), ["0", "1", "length"]);
  assert.equal(put(b, "2", "again"), true);
  assert.equal(get(b, "2"), "again");
  assert.equal(length(b), 3);
  assert.equal(resize(b, 0), "accepted");
  assert.deepEqual(keys(b), ["length"]);
  assert.equal(put(b, "0", 0), true);
  assert.notEqual(b.internalArrayElements, undefined);
});

test("non-writable length rejects appends and shrinking but allows overwrites", () => {
  const a = packed(3);
  assert.equal(resize(a, 3, false), "accepted");
  assert.notEqual(a.internalArrayElements, undefined);
  assert.equal(put(a, "3", 3), false);
  assert.equal(objects.createDataProperty(a, "3", 3, hooks), false);
  assert.equal(objects.getOwnProperty(a, "3"), undefined);
  assert.equal(put(a, "1", "one"), true);
  assert.equal(get(a, "1"), "one");
  assert.equal(resize(a, 1), "rejected");
  assert.equal(length(a), 3);
  assert.deepEqual(keys(a), ["0", "1", "2", "length"]);
  const b = packed(4);
  assert.equal(resize(b, 2, false), "accepted");
  assert.deepEqual(keys(b), ["0", "1", "length"]);
  assert.equal(objects.getOwnProperty(b, "length")!.writable, false);
});

test("non-extensible packed arrays reject appends and keep overwrites", () => {
  const a = packed(2);
  assert.equal(objects.preventExtensions(a), true);
  assert.equal(put(a, "2", 2), false);
  assert.equal(objects.getOwnProperty(a, "2"), undefined);
  assert.equal(length(a), 2);
  assert.equal(put(a, "0", "zero"), true);
  assert.equal(get(a, "0"), "zero");
  assert.equal(objects.deleteProperty(a, "1"), true);
  assert.equal(put(a, "1", 1), false);
  assert.deepEqual(keys(a), ["0", "length"]);
});

test("frozen and sealed packed arrays use ordinary descriptors", () => {
  for (const frozen of [true, false]) {
    const a = packed(3);
    assert.equal(objects.preventExtensions(a), true);
    for (const key of keys(a)) {
      const fields = frozen && key !== "length" ? 32 | 2 : 32;
      assert.equal(
        define(a, key, { fields, configurable: false, writable: false }),
        "accepted",
      );
    }
    assert.equal(a.internalArrayElements, undefined);
    assert.deepEqual(data(a, "1"), [false, 1, !frozen, true, false]);
    assert.equal(put(a, "1", 9), !frozen);
    assert.equal(objects.deleteProperty(a, "2"), false);
    assert.equal(resize(a, 0), "rejected");
    assert.equal(length(a), 3);
  }
});

test("inherited index setters and accessors intercept appends and holes", () => {
  const prototype = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const seen: unknown[] = [];
  const callHooks: objects.ObjectHooks<unknown> = {
    ...hooks,
    call: (fn, receiver, args) => (fn as (v: unknown) => unknown)(args[0]),
  };
  objects.defineOwnProperty(
    prototype,
    "2",
    {
      ...emptyUpdate<unknown>(undefined),
      fields: 8 | 16 | 32,
      set: (value: unknown) => seen.push(value),
      enumerable: true,
      configurable: true,
    },
    callHooks,
  );
  objects.defineOwnProperty(
    prototype,
    "5",
    {
      ...emptyUpdate<unknown>(undefined),
      fields: 1 | 2 | 16 | 32,
      value: "inherited",
      writable: false,
      enumerable: true,
      configurable: true,
    },
    hooks,
  );
  const a = array(0, prototype);
  for (let i = 0; i < 2; i++)
    assert.equal(
      objects.setProperty(a, String(i), i, { value: a, object: a }, callHooks),
      true,
    );
  assert.equal(
    objects.setProperty(
      a,
      "2",
      "via setter",
      { value: a, object: a },
      callHooks,
    ),
    true,
  );
  assert.deepEqual(seen, ["via setter"]);
  assert.equal(objects.getOwnProperty(a, "2"), undefined);
  assert.equal(length(a), 2);
  assert.notEqual(a.internalArrayElements, undefined);
  assert.equal(get(a, "5"), "inherited");
  assert.equal(put(a, "5", "own"), false);
  assert.equal(objects.getOwnProperty(a, "5"), undefined);
  assert.equal(objects.createDataProperty(a, "2", "own", hooks), true);
  assert.equal(get(a, "2"), "own");
  assert.notEqual(a.internalArrayElements, undefined);
});

test("own keys list packed indices, then strings, then symbols", () => {
  const a = packed(3);
  const symbol = objects.createSymbolValue("s");
  objects.createDataProperty(a, symbol, 1, hooks);
  objects.createDataProperty(a, "name", 1, hooks);
  objects.createDataProperty(a, "4294967295", 1, hooks);
  put(a, "3", 3);
  assert.notEqual(a.internalArrayElements, undefined);
  assert.deepEqual(keys(a), [
    "0",
    "1",
    "2",
    "3",
    "length",
    "name",
    "4294967295",
    symbol,
  ]);
});

test("packed arrays created with a length start empty and grow by define", () => {
  const a = array(3);
  assert.notEqual(a.internalArrayElements, undefined);
  assert.equal(objects.getOwnProperty(a, "0"), undefined);
  assert.equal(objects.createDataProperty(a, "0", "a", hooks), true);
  assert.notEqual(a.internalArrayElements, undefined);
  assert.equal(length(a), 3);
  assert.equal(objects.createDataProperty(a, "2", "c", hooks), true);
  assert.equal(a.internalArrayElements, undefined);
  assert.deepEqual(keys(a), ["0", "2", "length"]);
});

test("unpacking after expando properties keeps length before non-index string keys", () => {
  const a = packed(2);
  const symbol = objects.createSymbolValue("sym");
  assert.equal(objects.createDataProperty(a, "first", 1, hooks), true);
  assert.equal(objects.createDataProperty(a, symbol, 2, hooks), true);
  assert.equal(objects.createDataProperty(a, "second", 3, hooks), true);
  assert.notEqual(a.internalArrayElements, undefined);
  assert.deepEqual(keys(a), ["0", "1", "length", "first", "second", symbol]);
  // Truncating a packed array with expandos keeps expandos and stays packed.
  assert.equal(resize(a, 1), "accepted");
  assert.notEqual(a.internalArrayElements, undefined);
  assert.deepEqual(keys(a), ["0", "length", "first", "second", symbol]);
  // A sparse write unpacks while keeping "length" ahead of existing expandos.
  assert.equal(put(a, "10", 10), true);
  assert.equal(a.internalArrayElements, undefined);
  assert.deepEqual(keys(a), ["0", "10", "length", "first", "second", symbol]);
  assert.equal(get(a, "first"), 1);
  assert.equal(get(a, symbol), 2);
  assert.equal(get(a, "second"), 3);
});

test("inline length honors descriptor invariants, freezing, sealing, and prototype inheritance", () => {
  const empty = array();
  assert.equal(objects.ordinaryHasOwnProperty(empty, "length"), true);
  assert.equal(objects.hasProperty(empty, "length"), true);
  assert.equal(objects.deleteProperty(empty, "length"), false);
  assert.equal(
    define(empty, "length", { fields: 16, enumerable: true }),
    "rejected",
  );
  assert.equal(
    define(empty, "length", { fields: 32, configurable: true }),
    "rejected",
  );
  assert.equal(
    define(empty, "length", { fields: 4, get: () => 0 }),
    "rejected",
  );
  assert.equal(define(empty, "length", { fields: 0 }), "accepted");
  assert.equal(objects.preventExtensions(empty), true);
  assert.equal(
    define(empty, "length", { fields: 32, configurable: false }),
    "accepted",
  );
  assert.notEqual(empty.internalArrayElements, undefined);
  assert.equal(empty.internalRareSlots?.properties, undefined);
  assert.equal(
    define(empty, "length", {
      fields: 2 | 32,
      writable: false,
      configurable: false,
    }),
    "accepted",
  );
  assert.notEqual(empty.internalArrayElements, undefined);
  assert.equal(empty.internalRareSlots?.properties, undefined);
  assert.deepEqual(data(empty, "length"), [false, 0, false, false, false]);
  assert.equal(
    define(empty, "length", { fields: 2, writable: true }),
    "rejected",
  );

  // Inherited inline length on an ordinary object prototype chain.
  const proto = packed(3);
  const child = objects.createObject<ScriptPropertyKey, unknown>(proto);
  assert.equal(objects.getProperty(child, "length", child, hooks), 3);
  assert.equal(resize(proto, 3, false), "accepted");
  assert.equal(
    objects.setProperty(
      child,
      "length",
      9,
      { value: child, object: child },
      hooks,
    ),
    false,
  );
  assert.equal(objects.getOwnProperty(child, "length"), undefined);
});

test("fixed-arity small array builders produce packed number and value arrays", () => {
  const realm = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  realm.cleanArrayPushEpoch = realm.propertyEpoch.value;
  const a0 = objects.createArray0(realm);
  assert.equal(length(a0), 0);
  assert.equal(a0.prototype, realm.arrayPrototype);
  assert.equal(a0.internalRareSlots?.properties, undefined);
  assert.equal(a0.internalArrayElements?.generalCount, 0);

  const a1 = objects.createArray1(-0, realm);
  assert.equal(length(a1), 1);
  assert.equal(a1.internalArrayElements?.generalCount, 0);
  assert.ok(Object.is(get(a1, "0"), -0));

  const a2 = objects.createArray2(1, "two", realm);
  assert.equal(length(a2), 2);
  assert.equal(a2.internalArrayElements?.generalCount, 2);
  assert.equal(get(a2, "0"), 1);
  assert.equal(get(a2, "1"), "two");

  const a3 = objects.createArray3(1, NaN, 3.5, realm);
  assert.equal(length(a3), 3);
  assert.equal(a3.internalArrayElements?.generalCount, 0);
  assert.equal(Number.isNaN(get(a3, "1")), true);
  assert.equal(get(a3, "2"), 3.5);

  const marker = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const a4Num = objects.createArray4(10, 20, 30, 40, realm);
  assert.equal(length(a4Num), 4);
  assert.equal(a4Num.internalArrayElements?.generalCount, 0);
  assert.equal(get(a4Num, "3"), 40);

  const a4Mix = objects.createArray4(10, marker, undefined, 40, realm);
  assert.equal(length(a4Mix), 4);
  assert.equal(a4Mix.internalArrayElements?.generalCount, 4);
  assert.equal(get(a4Mix, "1"), marker);
  assert.equal(objects.getOwnProperty(a4Mix, "2")?.value, undefined);
});

test("fixed-arity object literal builders share fast shapes and fall back safely", () => {
  const proto = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const s1 = objects.createObjectLiteralSite(["a"]);
  const s2 = objects.createObjectLiteralSite(["x", "y"]);
  const s3 = objects.createObjectLiteralSite(["a", "b", "c"]);
  const s4 = objects.createObjectLiteralSite(["k1", "k2", "k3", "k4"]);
  const o1 = objects.createLiteralObject1(proto, s1, 1, hooks);
  const o1b = objects.createLiteralObject1(proto, s1, 2, hooks);
  assert.equal(o1.internalShape, o1b.internalShape);
  assert.equal(o1.internalRareSlots?.properties, undefined);
  assert.equal(get(o1, "a"), 1);
  assert.equal(get(o1b, "a"), 2);

  const o2 = objects.createLiteralObject2(proto, s2, 10, 20, hooks);
  const o2b = objects.createLiteralObject2(proto, s2, 30, 40, hooks);
  assert.equal(o2.internalShape, o2b.internalShape);
  assert.equal(get(o2b, "x"), 30);
  assert.equal(get(o2b, "y"), 40);

  const o3 = objects.createLiteralObject3(proto, s3, 1, 2, 3, hooks);
  const o3b = objects.createLiteralObject3(proto, s3, 4, 5, 6, hooks);
  assert.equal(o3.internalShape, o3b.internalShape);
  assert.equal(get(o3b, "c"), 6);

  const o4 = objects.createLiteralObject4(proto, s4, 1, 2, 3, 4, hooks);
  const o4b = objects.createLiteralObject4(proto, s4, 5, 6, 7, 8, hooks);
  assert.equal(o4.internalShape, o4b.internalShape);
  assert.equal(get(o4b, "k4"), 8);

  // Duplicate keys and numeric keys fall back to descriptor semantics.
  const dup = objects.createLiteralObject2(
    proto,
    objects.createObjectLiteralSite(["a", "a"]),
    1,
    2,
    hooks,
  );
  assert.equal(get(dup, "a"), 2);
  const indexed = objects.createLiteralObject2(
    proto,
    objects.createObjectLiteralSite(["0", "a"]),
    9,
    "ok",
    hooks,
  );
  assert.equal(get(indexed, "0"), 9);
  assert.equal(get(indexed, "a"), "ok");

  // Mutating the prototype invalidates the cached root shape without breaking sites.
  objects.createDataProperty(proto, "added", 99, hooks);
  const o2c = objects.createLiteralObject2(proto, s2, 70, 80, hooks);
  assert.equal(get(o2c, "x"), 70);
  assert.equal(get(o2c, "y"), 80);
  assert.equal(get(o2c, "added"), 99);
});

test("ScriptMap enforces SameValueZero, rehashes, and supports live cursors", () => {
  const map = createScriptMap();
  assert.equal(setScriptMap(map, -0, "zero"), true);
  assert.equal(hasScriptMap(map, 0), true);
  assert.equal(getScriptMap(map, 0), "zero");
  assert.equal(setScriptMap(map, 0, "updated"), false);
  assert.equal(map.size, 1);

  assert.equal(setScriptMap(map, NaN, "nan"), true);
  assert.equal(hasScriptMap(map, NaN), true);
  assert.equal(getScriptMap(map, NaN), "nan");
  assert.equal(setScriptMap(map, NaN, "nan2"), false);

  assert.equal(setScriptMap(map, 1, "num"), true);
  assert.equal(setScriptMap(map, "1", "str"), true);
  assert.equal(setScriptMap(map, Infinity, "inf"), true);
  assert.equal(setScriptMap(map, -Infinity, "ninf"), true);
  assert.equal(getScriptMap(map, 1), "num");
  assert.equal(getScriptMap(map, "1"), "str");
  assert.equal(getScriptMap(map, Infinity), "inf");
  assert.equal(getScriptMap(map, -Infinity), "ninf");

  // Grow past linearLimit (8) into hash buckets and rehash.
  for (let i = 0; i < 40; i++) {
    assert.equal(setScriptMap(map, `k${i}`, i), true);
    assert.equal(setScriptMap(map, i + 100, i * 2), true);
  }
  assert.notEqual(map.buckets, undefined);
  assert.equal(getScriptMap(map, "k39"), 39);
  assert.equal(getScriptMap(map, 139), 78);
  assert.equal(deleteScriptMap(map, "k10"), true);
  assert.equal(deleteScriptMap(map, "k10"), false);
  assert.equal(hasScriptMap(map, "k10"), false);

  // Live cursor observes deletions and re-insertions, and stops on clear.
  const live = createScriptMap();
  setScriptMap(live, "a", 1);
  setScriptMap(live, "b", 2);
  setScriptMap(live, "c", 3);
  const cursor = createScriptMapCursor(live);
  const visited: string[] = [];
  while (advanceScriptMapCursor(cursor)) {
    const k = String(readScriptMapCursorKey(cursor));
    visited.push(`${k}:${String(readScriptMapCursorValue(cursor))}`);
    if (k === "a") {
      deleteScriptMap(live, "b");
      deleteScriptMap(live, "a");
      setScriptMap(live, "a", 10);
    } else if (k === "c") {
      clearScriptMap(live);
    }
  }
  assert.deepEqual(visited, ["a:1", "c:3"]);
  assert.equal(live.size, 0);
  assert.equal(advanceScriptMapCursor(cursor), false);
});

test("flat general arrays preserve all tag kinds, allocate numbers lazily, and clear refs on shrink", () => {
  const realm = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  realm.cleanArrayPushEpoch = realm.propertyEpoch.value;
  const objA = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const objB = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const a = objects.createArray2(objA, "hello", realm);
  const elements = a.internalArrayElements;
  assert.ok(elements !== undefined);
  assert.equal(elements.generalCount, 2);
  // No number written yet -> lazy numbers Float64Array stays empty.
  assert.equal(elements.numbers.length, 0);
  const readSlot = (index: number): unknown =>
    objects.readGeneralSlot(
      elements.generalTags,
      elements.generalRefs,
      elements.numbers,
      index,
    );
  assert.equal(readSlot(0), objA);
  assert.equal(readSlot(1), "hello");

  // Push mixed tag kinds via put (grow) and scriptArrayPushFast (in-capacity).
  const pushOne = (v: unknown): number => {
    const fast = objects.scriptArrayPushFast(a, v, realm);
    if (fast >= 0) return fast;
    const idx = Number(length(a));
    assert.equal(put(a, String(idx), v), true);
    return Number(length(a));
  };
  assert.equal(pushOne(true), 3);
  // Capacity doubled to >= 4 -> next non-number push hits scriptArrayPushFast directly.
  assert.equal(objects.scriptArrayPushFast(a, false, realm), 4);
  assert.equal(pushOne(null), 5);
  assert.equal(objects.scriptArrayPushFast(a, undefined, realm), 6);
  assert.equal(elements.numbers.length, 0);
  assert.equal(pushOne(-0), 7);
  assert.ok(elements.numbers.length >= 7);
  assert.equal(objects.scriptArrayPushFast(a, NaN, realm), 8);
  assert.equal(pushOne(objB), 9);

  assert.equal(length(a), 9);
  assert.equal(elements.generalCount, 9);
  assert.equal(readSlot(0), objA);
  assert.equal(readSlot(1), "hello");
  assert.equal(readSlot(2), true);
  assert.equal(readSlot(3), false);
  assert.equal(readSlot(4), null);
  assert.equal(readSlot(5), undefined);
  assert.ok(Object.is(readSlot(6), -0));
  assert.equal(Number.isNaN(readSlot(7)), true);
  assert.equal(readSlot(8), objB);

  // Overwrite in place across tag kinds (object -> number -> boolean -> string).
  assert.equal(put(a, "0", 42.5), true);
  assert.equal(get(a, "0"), 42.5);
  assert.equal(put(a, "0", true), true);
  assert.equal(get(a, "0"), true);
  assert.equal(put(a, "0", "replaced"), true);
  assert.equal(get(a, "0"), "replaced");

  // Truncating clears stale generalRefs entries so references are not retained.
  assert.equal(resize(a, 2), "accepted");
  assert.equal(elements.generalCount, 2);
  assert.equal(elements.generalRefs.slots[8], undefined);
  assert.equal(get(a, "0"), "replaced");
  assert.equal(get(a, "1"), "hello");
});
