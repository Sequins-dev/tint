import { test } from "node:test";
import assert from "node:assert/strict";
import * as object from "../src/objects/index.ts";

function arrayRealm() {
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
  return { root, realm };
}

for (const name of [
  "filter",
  "map",
  "forEach",
  "every",
  "some",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "reduce",
  "reduceRight",
  "indexOf",
  "lastIndexOf",
  "includes",
  "unshift",
  "at",
  "sort",
  "toSorted",
  "fill",
  "concat",
  "flatMap",
]) {
  test(`Array ${name} installs a unary nonconstructor method`, () => {
    const { realm } = arrayRealm();
    const descriptor = object.getOwnProperty(realm.arrayPrototype, name);
    assert.ok(descriptor);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.writable, true);
    assert.equal(descriptor.configurable, true);
    const method = descriptor.value as object.OrdinaryObject<
      object.ScriptPropertyKey,
      unknown
    >;
    assert.equal(object.getOwnProperty(method, "length")?.value, 1);
    assert.equal(object.getOwnProperty(method, "name")?.value, name);
    assert.equal(method.internalRareSlots?.internalConstruct, undefined);
  });
}

test("Array exposes species", () => {
  const { root, realm } = arrayRealm();
  const constructor = object.getOwnProperty(root, "Array")
    ?.value as object.OrdinaryObject<object.ScriptPropertyKey, unknown>;
  assert.ok(
    object.getOwnProperty(
      constructor,
      object.wellKnownSymbol(realm.symbolRegistry, "species"),
    )?.get,
  );
});

for (const name of ["splice", "slice", "copyWithin", "with", "toSpliced"])
  test(`Array ${name} installs a binary nonconstructor method`, () => {
    const { realm } = arrayRealm();
    const descriptor = object.getOwnProperty(realm.arrayPrototype, name);
    assert.ok(descriptor);
    assert.equal(descriptor.enumerable, false);
    const method = descriptor.value as object.OrdinaryObject<
      object.ScriptPropertyKey,
      unknown
    >;
    assert.equal(object.getOwnProperty(method, "length")?.value, 2);
    assert.equal(method.internalRareSlots?.internalConstruct, undefined);
  });

for (const name of ["pop", "shift", "reverse", "flat", "toReversed"]) {
  test(`Array ${name} installs a zero-argument nonconstructor method`, () => {
    const { realm } = arrayRealm();
    const descriptor = object.getOwnProperty(realm.arrayPrototype, name);
    assert.ok(descriptor);
    assert.equal(descriptor.enumerable, false);
    const method = descriptor.value as object.OrdinaryObject<
      object.ScriptPropertyKey,
      unknown
    >;
    assert.equal(object.getOwnProperty(method, "length")?.value, 0);
    assert.equal(method.internalRareSlots?.internalConstruct, undefined);
  });
}
