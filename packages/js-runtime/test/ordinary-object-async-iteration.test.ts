import { test } from "node:test";
import assert from "node:assert/strict";
import * as object from "@tint/js-runtime/objects";

test("async-from-sync objects retain a private iterator and shared methods", () => {
  const root = object.createObject<object.ScriptPropertyKey, unknown>(
    undefined,
  );
  const hooks: object.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call() {
      assert.fail("unexpected call");
    },
  };
  const realm = object.createErrorRealm(root, hooks);
  assert.equal(typeof object.createAsyncFromSyncIterator, "function");
  const sync = object.createObject<object.ScriptPropertyKey, unknown>(root);
  const record = { iterator: sync, nextMethod: 42, done: false };
  const result = object.createAsyncFromSyncIterator(record, realm, hooks);
  const wrapper = result.record.iterator as object.OrdinaryObject<
    object.ScriptPropertyKey,
    unknown
  >;
  assert.ok(wrapper.internalSyncIteratorData === record);
  assert.ok(wrapper.prototype === realm.asyncFromSyncIteratorPrototype);
  assert.ok(
    realm.asyncFromSyncIteratorPrototype.prototype ===
      realm.asyncIteratorPrototype,
  );
  assert.equal(wrapper.properties.size, 0);
  assert.equal(
    realm.asyncFromSyncIteratorPrototype.internalSyncIteratorData,
    undefined,
  );
  for (const name of ["next", "return", "throw"]) {
    const descriptor = object.getOwnProperty(
      realm.asyncFromSyncIteratorPrototype,
      name,
    );
    assert.ok(descriptor);
    assert.equal(descriptor.writable, true);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.configurable, true);
    const method = descriptor.value as object.OrdinaryObject<
      object.ScriptPropertyKey,
      unknown
    >;
    assert.equal(object.getOwnProperty(method, "length")?.value, 1);
    assert.equal(object.getOwnProperty(method, "name")?.value, name);
    if (name === "next") assert.ok(result.record.nextMethod === method);
  }
});

test("async iterator disposal has standard method metadata", () => {
  const root = object.createObject<object.ScriptPropertyKey, unknown>(
    undefined,
  );
  const hooks: object.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const realm = object.createErrorRealm(root, hooks);
  const descriptor = object.getOwnProperty(
    realm.asyncIteratorPrototype,
    object.wellKnownSymbol(realm.symbolRegistry, "asyncDispose"),
  );
  assert.ok(descriptor);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.configurable, true);
  const method = descriptor.value as object.OrdinaryObject<
    object.ScriptPropertyKey,
    unknown
  >;
  assert.equal(
    object.getOwnProperty(method, "name")?.value,
    "[Symbol.asyncDispose]",
  );
  assert.equal(object.getOwnProperty(method, "length")?.value, 0);
  assert.equal(method.internalConstruct, undefined);
});
