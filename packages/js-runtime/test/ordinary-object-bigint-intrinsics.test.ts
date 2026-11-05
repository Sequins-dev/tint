import assert from "node:assert/strict";
import test from "node:test";
import * as objects from "../src/objects/index.ts";

test("BigInt toString exposes zero required parameters and standard descriptors", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(root, hooks);
  objects.installPrimitiveIntrinsics(root, realm, hooks);
  const property = objects.getOwnProperty(realm.bigIntPrototype, "toString");
  assert.ok(property);
  assert.equal(property.writable, true);
  assert.equal(property.enumerable, false);
  assert.equal(property.configurable, true);
  const method = property.value as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  assert.ok(method);
  const length = objects.getOwnProperty(method, "length");
  assert.ok(length);
  assert.equal(length.value, 0);
  assert.equal(length.writable, false);
  assert.equal(length.enumerable, false);
  assert.equal(length.configurable, true);
  assert.equal(objects.getOwnProperty(method, "name")?.value, "toString");
  assert.equal(method.internalConstruct, undefined);
});
