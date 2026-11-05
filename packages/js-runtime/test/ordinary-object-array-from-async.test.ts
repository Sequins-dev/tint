import assert from "node:assert/strict";
import test from "node:test";
import * as objects from "../src/objects/index.ts";
test("Array.fromAsync exposes intrinsic factory metadata without being constructible", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
      undefined,
    ),
    realm = objects.createErrorRealm(root, hooks);
  objects.installArrayIntrinsics(root, realm, hooks);
  const array = objects.getOwnProperty(root, "Array")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  const property = objects.getOwnProperty(array, "fromAsync");
  assert.ok(property);
  assert.equal(property.writable, true);
  assert.equal(property.configurable, true);
  assert.equal(property.enumerable, false);
  const fn = property.value as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  assert.equal(objects.getOwnProperty(fn, "name")?.value, "fromAsync");
  assert.equal(objects.getOwnProperty(fn, "length")?.value, 1);
  assert.equal(fn.internalConstruct, undefined);
  assert.equal(objects.getOwnProperty(fn, "prototype"), undefined);
});
