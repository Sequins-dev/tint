import { test } from "node:test";
import assert from "node:assert/strict";
import * as object from "@tint/js-runtime/objects";

test("Function prototype installs the fixed ordinary hasInstance method", () => {
  const hooks: object.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => {
      throw new Error("unexpected hook call");
    },
  };
  const root = object.createObject<object.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = object.createErrorRealm(root, hooks);
  object.installFunctionIntrinsics(root, realm, hooks);
  const descriptor = object.getOwnProperty(
    realm.functionPrototype,
    object.wellKnownSymbol(realm.symbolRegistry, "hasInstance"),
  );
  assert.ok(descriptor);
  assert.equal(descriptor.writable, false);
  assert.equal(descriptor.configurable, false);
  assert.equal(descriptor.enumerable, false);
});
