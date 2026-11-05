import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";

test("immutable ArrayBuffer APIs have standard intrinsic metadata", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => {
      throw new Error("unexpected call");
    },
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(root, hooks);
  objects.installArrayBufferIntrinsics(root, realm, hooks);
  for (const [name, length] of [
    ["transferToImmutable", 0],
    ["sliceToImmutable", 2],
  ] as const) {
    const descriptor = objects.getOwnProperty(realm.arrayBufferPrototype, name);
    assert.ok(descriptor, name);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.configurable, true);
    assert.equal(descriptor.writable, true);
    const method = descriptor.value as objects.OrdinaryObject<
      objects.ScriptPropertyKey,
      unknown
    >;
    assert.equal(objects.getOwnProperty(method, "name")?.value, name);
    assert.equal(objects.getOwnProperty(method, "length")?.value, length);
    assert.equal(method.internalConstruct, undefined);
  }
  const descriptor = objects.getOwnProperty(
    realm.arrayBufferPrototype,
    "immutable",
  );
  assert.ok(descriptor?.accessor);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.configurable, true);
  assert.equal(descriptor.set, undefined);
  const getter = descriptor.get as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  assert.equal(objects.getOwnProperty(getter, "name")?.value, "get immutable");
  assert.equal(objects.getOwnProperty(getter, "length")?.value, 0);
});
