import assert from "node:assert/strict";
import { test } from "node:test";
import * as objects from "../src/objects/index.ts";

test("Set intrinsics expose metadata and shared values aliases", () => {
  assert.equal(typeof objects.installSetIntrinsics, "function");
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(root, hooks);
  objects.installSetIntrinsics(root, realm, hooks);
  const constructor = objects.getOwnProperty(root, "Set")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  assert.equal(objects.getOwnProperty(constructor, "length")?.value, 0);
  assert.equal(
    objects.getOwnProperty(constructor, "prototype")?.value,
    realm.setPrototype,
  );
  for (const [name, length] of [
    ["add", 1],
    ["has", 1],
    ["delete", 1],
    ["clear", 0],
    ["forEach", 1],
    ["values", 0],
    ["entries", 0],
    ["difference", 1],
    ["intersection", 1],
    ["isSubsetOf", 1],
    ["isSupersetOf", 1],
    ["isDisjointFrom", 1],
    ["union", 1],
    ["symmetricDifference", 1],
  ] as const) {
    const descriptor = objects.getOwnProperty(realm.setPrototype, name)!;
    assert.ok(descriptor, name);
    assert.equal(descriptor.enumerable, false);
    const method = descriptor.value as objects.OrdinaryObject<
      objects.ScriptPropertyKey,
      unknown
    >;
    assert.equal(objects.getOwnProperty(method, "name")?.value, name);
    assert.equal(objects.getOwnProperty(method, "length")?.value, length);
    assert.equal(method.internalConstruct, undefined);
  }
  const values = objects.getOwnProperty(realm.setPrototype, "values")?.value;
  assert.equal(
    objects.getOwnProperty(realm.setPrototype, "keys")?.value,
    values,
  );
  assert.equal(
    objects.getOwnProperty(
      realm.setPrototype,
      objects.wellKnownSymbol(realm.symbolRegistry, "iterator"),
    )?.value,
    values,
  );
});
