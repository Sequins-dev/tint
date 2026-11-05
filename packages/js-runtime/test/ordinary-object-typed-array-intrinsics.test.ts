import { test } from "node:test";
import assert from "node:assert/strict";
import * as o from "../src/objects/index.ts";
function installedRealm() {
  const hooks: o.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const global = o.createObject<o.ScriptPropertyKey, unknown>(undefined),
    realm = o.createErrorRealm(global, hooks);
  o.installArrayIntrinsics(global, realm, hooks);
  o.installTypedArrayIntrinsics(global, realm, hooks, "little");
  return { global, realm };
}
test("typed-array constructors share an abstract base and per-kind prototypes", () => {
  assert.equal(typeof o.installTypedArrayIntrinsics, "function");
  const { global, realm } = installedRealm();
  let base: o.OrdinaryObject<o.ScriptPropertyKey, unknown> | undefined;
  for (const [name, width] of [
    ["Int8", 1],
    ["Uint8Clamped", 1],
    ["Uint16", 2],
    ["Int32", 4],
    ["Float16", 2],
    ["Float64", 8],
    ["BigInt64", 8],
  ] as const) {
    const constructor = o.getOwnProperty(global, name + "Array")!
      .value as o.OrdinaryObject<o.ScriptPropertyKey, unknown>;
    const prototype = o.getOwnProperty(constructor, "prototype")!
      .value as o.OrdinaryObject<o.ScriptPropertyKey, unknown>;
    assert.ok(constructor.internalConstruct);
    assert.ok(constructor.internalCall);
    assert.equal(o.getOwnProperty(constructor, "length")?.value, 3);
    assert.equal(o.getOwnProperty(constructor, "name")?.value, name + "Array");
    assert.equal(
      o.getOwnProperty(constructor, "BYTES_PER_ELEMENT")?.value,
      width,
    );
    assert.equal(
      o.getOwnProperty(prototype, "BYTES_PER_ELEMENT")?.value,
      width,
    );
    assert.equal(
      o.getOwnProperty(prototype, "constructor")?.value,
      constructor,
    );
    assert.equal(prototype.prototype, realm.typedArrayPrototype);
    if (base === undefined) base = constructor.prototype;
    else assert.equal(constructor.prototype, base);
  }
  assert.equal(o.getOwnProperty(base!, "name")?.value, "TypedArray");
  assert.equal(
    o.getOwnProperty(base!, "prototype")?.value,
    realm.typedArrayPrototype,
  );
});
test("TypedArray.from and of are inherited nonconstructible builtins", () => {
  const { global } = installedRealm();
  const constructor = o.getOwnProperty(global, "Uint8Array")!
    .value as o.OrdinaryObject<o.ScriptPropertyKey, unknown>;
  for (const [name, length] of [
    ["from", 1],
    ["of", 0],
  ] as const) {
    const descriptor = o.getOwnProperty(constructor.prototype!, name);
    assert.ok(descriptor, `${name} exists`);
    const method = descriptor.value as o.OrdinaryObject<
      o.ScriptPropertyKey,
      unknown
    >;
    assert.equal(o.getOwnProperty(method, "length")?.value, length);
    assert.equal(o.getOwnProperty(method, "name")?.value, name);
    assert.equal(method.internalConstruct, undefined);
  }
});
const prototypeMethods = [
  ["slice", 2],
  ["subarray", 2],
  ["sort", 1],
  ["toSorted", 1],
  ["with", 2],
  ["toReversed", 0],
  ["map", 1],
  ["filter", 1],
  ["at", 1],
  ["includes", 1],
  ["indexOf", 1],
  ["lastIndexOf", 1],
  ["set", 1],
  ["join", 1],
  ["reverse", 0],
  ["fill", 1],
  ["copyWithin", 2],
  ["every", 1],
  ["some", 1],
  ["forEach", 1],
  ["find", 1],
  ["findIndex", 1],
  ["findLast", 1],
  ["findLastIndex", 1],
  ["reduce", 1],
  ["reduceRight", 1],
] as const;
for (const [name, length] of prototypeMethods) {
  test(`typed-array ${name} exposes standard builtin metadata`, () => {
    const { realm } = installedRealm();
    const descriptor = o.getOwnProperty(realm.typedArrayPrototype, name);
    assert.ok(descriptor);
    assert.equal(descriptor.writable, true);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.configurable, true);
    const method = descriptor.value as o.OrdinaryObject<
      o.ScriptPropertyKey,
      unknown
    >;
    assert.equal(o.getOwnProperty(method, "length")?.value, length);
    assert.equal(o.getOwnProperty(method, "name")?.value, name);
    assert.equal(method.internalConstruct, undefined);
  });
}
test("typed-array toString shares the Array intrinsic", () => {
  const { realm } = installedRealm();
  assert.equal(
    o.getOwnProperty(realm.typedArrayPrototype, "toString")?.value,
    o.getOwnProperty(realm.arrayPrototype, "toString")?.value,
  );
});

test("hex codecs belong to the concrete Uint8Array with standard metadata", () => {
  const { global, realm } = installedRealm();
  const constructor = o.getOwnProperty(global, "Uint8Array")!
    .value as o.OrdinaryObject<o.ScriptPropertyKey, unknown>;
  const prototype = realm.typedArrayPrototypes.get("Uint8")!;
  for (const [owner, name, length] of [
    [constructor, "fromHex", 1],
    [prototype, "toHex", 0],
    [prototype, "setFromHex", 1],
  ] as const) {
    const property = o.getOwnProperty(owner, name);
    assert.ok(property, name);
    assert.equal(property.writable, true);
    assert.equal(property.enumerable, false);
    assert.equal(property.configurable, true);
    const fn = property.value as o.OrdinaryObject<o.ScriptPropertyKey, unknown>;
    assert.equal(o.getOwnProperty(fn, "name")?.value, name);
    assert.equal(o.getOwnProperty(fn, "length")?.value, length);
    assert.equal(fn.internalConstruct, undefined);
    assert.equal(o.getOwnProperty(realm.typedArrayPrototype, name), undefined);
  }
  assert.equal(o.getOwnProperty(constructor.prototype!, "fromHex"), undefined);
});

test("base64 codecs expose concrete Uint8Array metadata without shared inheritance", () => {
  const { global, realm } = installedRealm();
  const constructor = o.getOwnProperty(global, "Uint8Array")!
    .value as o.OrdinaryObject<o.ScriptPropertyKey, unknown>;
  const prototype = realm.typedArrayPrototypes.get("Uint8")!;
  for (const [owner, name, length] of [
    [constructor, "fromBase64", 1],
    [prototype, "setFromBase64", 1],
    [prototype, "toBase64", 0],
  ] as const) {
    const property = o.getOwnProperty(owner, name);
    assert.ok(property, name);
    assert.equal(property.writable, true);
    assert.equal(property.enumerable, false);
    assert.equal(property.configurable, true);
    const fn = property.value as o.OrdinaryObject<o.ScriptPropertyKey, unknown>;
    assert.equal(o.getOwnProperty(fn, "length")?.value, length);
    assert.equal(o.getOwnProperty(fn, "name")?.value, name);
    assert.equal(fn.internalConstruct, undefined);
    assert.equal(o.getOwnProperty(realm.typedArrayPrototype, name), undefined);
  }
});
