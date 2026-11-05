import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";
test("URI globals have non-enumerable standard function metadata", () => {
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
  for (const name of [
    "encodeURI",
    "encodeURIComponent",
    "decodeURI",
    "decodeURIComponent",
    "escape",
    "unescape",
  ]) {
    const descriptor = objects.getOwnProperty(root, name);
    assert.ok(descriptor, name);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.writable, true);
    assert.equal(descriptor.configurable, true);
    const method = descriptor.value as objects.OrdinaryObject<
      objects.ScriptPropertyKey,
      unknown
    >;
    assert.equal(objects.getOwnProperty(method, "name")?.value, name);
    assert.equal(objects.getOwnProperty(method, "length")?.value, 1);
    assert.equal(method.internalConstruct, undefined);
  }
});
