import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";
const hooks: objects.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => {
    throw "getter must not run";
  },
};
function property(
  object: objects.OrdinaryObject<string, unknown>,
  key: string,
  enumerable = true,
) {
  assert.equal(
    objects.defineOwnProperty(
      object,
      key,
      {
        fields: 51,
        value: 42,
        writable: true,
        enumerable,
        configurable: true,
        get: undefined,
        set: undefined,
      },
      hooks,
    ),
    "accepted",
  );
}
function drain(
  iterator: objects.PropertyEnumeration<string, unknown>,
): string[] {
  const keys: string[] = [];
  for (;;) {
    const key = objects.nextEnumerableProperty(iterator);
    if (key === undefined) return keys;
    keys.push(key);
  }
}
test("enumeration orders indices before strings and filters inherited shadows", () => {
  assert.equal(typeof objects.createPropertyEnumeration, "function");
  const parent = objects.createObject<string, unknown>(undefined),
    child = objects.createObject<string, unknown>(parent);
  for (const key of ["hidden", "own", "inherited", "1"]) property(parent, key);
  for (const key of ["own", "10", "2", "01"]) property(child, key);
  property(child, "hidden", false);
  const iterator = objects.createPropertyEnumeration(
    child,
    objects.stringPropertyKeyOrder,
  );
  assert.deepEqual(drain(iterator), ["2", "10", "own", "01", "1", "inherited"]);
  assert.equal(objects.nextEnumerableProperty(iterator), undefined);
});
test("enumeration checks current descriptors without invoking getters", () => {
  const parent = objects.createObject<string, unknown>(undefined),
    child = objects.createObject<string, unknown>(parent);
  for (const key of ["removed", "visited"]) property(parent, key);
  for (const key of ["visited", "removed", "hidden"]) property(child, key);
  const iterator = objects.createPropertyEnumeration(
    child,
    objects.stringPropertyKeyOrder,
  );
  assert.equal(objects.nextEnumerableProperty(iterator), "visited");
  objects.deleteProperty(child, "visited");
  objects.deleteProperty(child, "removed");
  property(child, "hidden", false);
  property(child, "added");
  property(parent, "later");
  objects.defineOwnProperty(
    child,
    "accessor",
    {
      fields: 60,
      value: undefined,
      writable: false,
      enumerable: true,
      configurable: true,
      get: () => {
        throw 1;
      },
      set: undefined,
    },
    hooks,
  );
  assert.deepEqual(drain(iterator), ["removed", "later"]);
  const fresh = objects.createPropertyEnumeration(
    child,
    objects.stringPropertyKeyOrder,
  );
  assert.deepEqual(drain(fresh), [
    "added",
    "accessor",
    "removed",
    "visited",
    "later",
  ]);
});
test("key classification recognizes canonical array indices only", () => {
  for (const key of [
    "",
    "00",
    "-0",
    "1.0",
    "1e0",
    "4294967295",
    "Infinity",
    "NaN",
    "01",
    "+1",
    " 1",
    "1\n",
    "0x10",
    "1e9",
    "１２",
    "4294967296",
    "10000000000",
  ])
    assert.equal(objects.stringPropertyKeyOrder(key), -1, key);
  for (const key of ["0", "1", "10", "1000000000", "4294967293", "4294967294"])
    assert.equal(objects.stringPropertyKeyOrder(key), Number(key));
});
test("enumeration omits symbol keys and remains exhausted", () => {
  const symbol = Symbol("hidden");
  const object = objects.createObject<string | symbol, unknown>(undefined);
  const descriptor = {
    fields: 51,
    value: 42,
    writable: true,
    enumerable: true,
    configurable: true,
    get: undefined,
    set: undefined,
  };
  objects.defineOwnProperty(object, symbol, descriptor, hooks);
  objects.defineOwnProperty(object, "visible", descriptor, hooks);
  const iterator = objects.createPropertyEnumeration(object, (key) =>
    typeof key === "symbol" ? -2 : objects.stringPropertyKeyOrder(key),
  );
  assert.equal(objects.nextEnumerableProperty(iterator), "visible");
  assert.equal(objects.nextEnumerableProperty(iterator), undefined);
  objects.defineOwnProperty(object, "later", descriptor, hooks);
  assert.equal(objects.nextEnumerableProperty(iterator), undefined);
});

test("fast-snapshot enumeration observes mid-loop deletion and prototype mutations", () => {
  const proto = objects.createObject<string, unknown>(undefined);
  property(proto, "hiddenProto", false);
  const obj = objects.createObject<string, unknown>(proto);
  property(obj, "a");
  property(obj, "b");
  property(obj, "c");

  // Mid-loop deletion of unvisited key must skip the deleted key.
  const it1 = objects.createPropertyEnumeration(
    obj,
    objects.stringPropertyKeyOrder,
  );
  assert.equal(objects.nextEnumerableProperty(it1), "a");
  assert.equal(objects.deleteProperty(obj, "b"), true);
  assert.equal(objects.nextEnumerableProperty(it1), "c");
  assert.equal(objects.nextEnumerableProperty(it1), undefined);

  // Mid-loop addition of an enumerable property on the prototype must be observed,
  // while already-yielded keys must not repeat.
  const obj2 = objects.createObject<string, unknown>(proto);
  property(obj2, "x");
  property(obj2, "y");
  const it2 = objects.createPropertyEnumeration(
    obj2,
    objects.stringPropertyKeyOrder,
  );
  assert.equal(objects.nextEnumerableProperty(it2), "x");
  property(proto, "x", true);
  property(proto, "z", true);
  assert.equal(objects.nextEnumerableProperty(it2), "y");
  assert.equal(objects.nextEnumerableProperty(it2), "z");
  assert.equal(objects.nextEnumerableProperty(it2), undefined);
});
