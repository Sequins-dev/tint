import assert from "node:assert/strict";
import test from "node:test";
import * as objects from "../src/objects/index.ts";

test("Number formatters expose standard function and property descriptors", () => {
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
  for (const name of ["toFixed", "toPrecision", "toExponential"]) {
    const descriptor = objects.getOwnProperty(realm.numberPrototype, name);
    assert.ok(descriptor, name);
    assert.equal(descriptor.writable, true);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.configurable, true);
    const fn = descriptor.value as objects.OrdinaryObject<
      objects.ScriptPropertyKey,
      unknown
    >;
    assert.equal(objects.getOwnProperty(fn, "name")?.value, name);
    assert.equal(objects.getOwnProperty(fn, "length")?.value, 1);
    assert.equal(fn.internalConstruct, undefined);
  }
});
