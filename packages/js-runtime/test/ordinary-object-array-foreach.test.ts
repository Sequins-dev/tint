import { test } from "node:test";
import assert from "node:assert/strict";
import * as object from "../src/objects/index.ts";

test("Array forEach is installed for unchanged Promise conformance helpers", () => {
  const hooks: object.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = object.createObject<object.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = object.createErrorRealm(root, hooks);
  object.installArrayIntrinsics(root, realm, hooks);
  const descriptor = object.getOwnProperty(realm.arrayPrototype, "forEach");
  assert.ok(descriptor);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, true);
});
