import { test } from "node:test";
import assert from "node:assert/strict";
import * as object from "../src/objects/index.ts";
test("Function apply installs a configurable non-enumerable binary method", () => {
  const hooks: object.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = object.createObject<object.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = object.createErrorRealm(root, hooks);
  object.installFunctionIntrinsics(root, realm, hooks);
  const descriptor = object.getOwnProperty(realm.functionPrototype, "apply");
  assert.ok(descriptor);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.configurable, true);
  const method = descriptor.value as object.OrdinaryObject<
    object.ScriptPropertyKey,
    unknown
  >;
  assert.equal(object.getOwnProperty(method, "length")?.value, 2);
});
