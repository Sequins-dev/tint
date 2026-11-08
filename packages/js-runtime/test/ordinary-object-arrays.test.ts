import type { ScriptPropertyKey } from "@tint/js-runtime/objects";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";
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
  assert.equal(a.internalArrayData, true);
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

test("packed elements keep array indices out of the property map", () => {
  const a = packed(100);
  assert.notEqual(a.internalArrayElements, undefined);
  assert.equal(a.properties.size, 1);
  assert.equal(length(a), 100);
  assert.deepEqual(data(a, "42"), [false, 42, true, true, true]);
  assert.equal(get(a, "99"), 99);
  assert.equal(objects.getOwnProperty(a, "100"), undefined);
  assert.deepEqual(keys(a).slice(0, 3), ["0", "1", "2"]);
  assert.equal(keys(a).at(-1), "length");
  assert.equal(objects.createDataProperty(a, "100", 100, hooks), true);
  assert.equal(a.properties.size, 1);
});

test("storing a non-number switches number elements to values once", () => {
  const a = array();
  put(a, "0", -0);
  put(a, "1", NaN);
  put(a, "2", 2);
  const before = a.internalArrayElements!;
  assert.notEqual(before.numbers, undefined);
  const object = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  put(a, "1", object);
  put(a, "3", "three");
  const after = a.internalArrayElements!;
  assert.equal(after.numbers, undefined);
  assert.notEqual(after.values, undefined);
  assert.ok(Object.is(get(a, "0"), -0));
  assert.equal(get(a, "1"), object);
  assert.equal(get(a, "2"), 2);
  assert.equal(get(a, "3"), "three");
  put(a, "4", 4);
  assert.equal(get(a, "4"), 4);
  assert.equal(a.properties.size, 1);
  assert.equal(length(a), 5);
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
