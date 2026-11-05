import assert from "node:assert/strict";
import { test } from "node:test";
import * as objects from "../src/objects/index.ts";

test("Map intrinsics expose constructor and method metadata", () => {
  assert.equal(typeof objects.installMapIntrinsics, "function");
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(root, hooks);
  objects.installMapIntrinsics(root, realm, hooks);
  const constructor = objects.getOwnProperty(root, "Map")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  assert.equal(objects.getOwnProperty(constructor, "length")?.value, 0);
  assert.equal(
    objects.getOwnProperty(constructor, "prototype")?.value,
    realm.mapPrototype,
  );
  const grouping = objects.getOwnProperty(constructor, "groupBy")?.value as
    objects.OrdinaryObject<objects.ScriptPropertyKey, unknown> | undefined;
  assert.ok(grouping);
  assert.equal(objects.getOwnProperty(grouping, "length")?.value, 2);
  for (const [name, length] of [
    ["get", 1],
    ["getOrInsert", 2],
    ["getOrInsertComputed", 2],
    ["set", 2],
    ["has", 1],
    ["delete", 1],
    ["clear", 0],
    ["forEach", 1],
    ["keys", 0],
    ["values", 0],
    ["entries", 0],
  ] as const) {
    const descriptor = objects.getOwnProperty(realm.mapPrototype, name)!;
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
  assert.equal(
    objects.getOwnProperty(
      realm.mapPrototype,
      objects.wellKnownSymbol(realm.symbolRegistry, "iterator"),
    )?.value,
    objects.getOwnProperty(realm.mapPrototype, "entries")?.value,
  );
});
