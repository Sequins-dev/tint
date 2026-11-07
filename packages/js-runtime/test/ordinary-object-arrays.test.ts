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
function array(length = 0) {
  assert.equal(typeof objects.createArrayObject, "function");
  return objects.createArrayObject<ScriptPropertyKey, unknown>(
    length,
    undefined,
    {
      lengthKey: "length",
      index: objects.scriptPropertyKeyOrder,
      toNumber: Number,
      fromNumber: (value: number): unknown => value,
      rangeError: (): unknown => new RangeError(),
    },
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
      lengthKey: "length",
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
