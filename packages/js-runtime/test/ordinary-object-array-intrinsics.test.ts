import type { ScriptPropertyKey } from "@tint/js-runtime/objects";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";
const hooks: objects.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => undefined,
};
test("Array intrinsic constructs sparse lengths and dense element lists with realm identities", () => {
  assert.equal(typeof objects.installArrayIntrinsics, "function");
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(root, hooks);
  const global = objects.createObject<ScriptPropertyKey, unknown>(root);
  objects.installArrayIntrinsics(global, realm, hooks);
  const array = objects.getOwnProperty(global, "Array")!
    .value as objects.OrdinaryObject<ScriptPropertyKey, unknown>;
  assert.equal(array.prototype, realm.functionPrototype);
  assert.equal(objects.getOwnProperty(array, "name")?.value, "Array");
  assert.equal(objects.getOwnProperty(array, "length")?.value, 1);
  const prototype = objects.getOwnProperty(array, "prototype")!;
  assert.equal(prototype.value, realm.arrayPrototype);
  assert.equal(prototype.writable, false);
  assert.equal(prototype.configurable, false);
  assert.equal(
    objects.getOwnProperty(realm.arrayPrototype, "constructor")?.value,
    array,
  );
  const sparse = array.internalCall!(undefined, [3]) as objects.OrdinaryObject<
    string,
    unknown
  >;
  assert.equal((sparse.internalFlags & 8) !== 0, true);
  assert.equal(sparse.prototype, realm.arrayPrototype);
  assert.equal(objects.getOwnProperty(sparse, "length")?.value, 3);
  assert.equal(objects.getOwnProperty(sparse, "0"), undefined);
  const dense = array.internalCall!(
    undefined,
    [1, 42, 3],
  ) as objects.OrdinaryObject<ScriptPropertyKey, unknown>;
  assert.equal(objects.getOwnProperty(dense, "1")?.value, 42);
  const single = array.internalCall!(undefined, [
    "3",
  ]) as objects.OrdinaryObject<ScriptPropertyKey, unknown>;
  assert.equal(objects.getOwnProperty(single, "length")?.value, 1);
  assert.equal(objects.getOwnProperty(single, "0")?.value, "3");
});
test("Array unscopables have null prototype, standard names and specified descriptors", () => {
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(root, hooks);
  objects.installArrayIntrinsics(root, realm, hooks);
  const symbol = objects.wellKnownSymbol(realm.symbolRegistry, "unscopables");
  const property = objects.getOwnProperty(realm.arrayPrototype, symbol);
  assert.ok(property);
  assert.equal(property.writable, false);
  assert.equal(property.enumerable, false);
  assert.equal(property.configurable, true);
  const value = property.value as objects.OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  assert.equal(value.prototype, undefined);
  const names = [
    "at",
    "copyWithin",
    "entries",
    "fill",
    "find",
    "findIndex",
    "findLast",
    "findLastIndex",
    "flat",
    "flatMap",
    "includes",
    "keys",
    "toReversed",
    "toSorted",
    "toSpliced",
    "values",
  ];
  for (const name of names) {
    const entry = objects.getOwnProperty(value, name);
    assert.ok(entry, name);
    assert.equal(entry.value, true);
    assert.equal(entry.writable, true);
    assert.equal(entry.enumerable, true);
    assert.equal(entry.configurable, true);
  }
  assert.equal(objects.getOwnProperty(value, "with"), undefined);
  assert.deepEqual(
    objects.ownKeys(value, objects.scriptPropertyKeyOrder),
    names,
  );
});
