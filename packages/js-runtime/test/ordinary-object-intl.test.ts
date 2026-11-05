import assert from "node:assert/strict";
import test from "node:test";
import * as objects from "../src/objects/index.ts";
test("Intl owns a tagged namespace and a non-constructor supportedValuesOf method", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
      undefined,
    ),
    realm = objects.createErrorRealm(root, hooks);
  objects.installIntlIntrinsics(root, realm, hooks);
  const descriptor = objects.getOwnProperty(root, "Intl");
  assert.ok(descriptor);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.configurable, true);
  const namespace = descriptor.value as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  assert.equal(namespace.prototype, realm.objectPrototype);
  assert.equal(namespace.internalCall, undefined);
  assert.equal(namespace.internalConstruct, undefined);
  const method = objects.getOwnProperty(namespace, "supportedValuesOf")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  assert.equal(objects.getOwnProperty(method, "length")!.value, 1);
  assert.equal(
    objects.getOwnProperty(method, "name")!.value,
    "supportedValuesOf",
  );
  assert.equal(method.internalConstruct, undefined);
});

test("Intl.PluralRules exposes its constructor, branded prototype and method metadata", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
      undefined,
    ),
    realm = objects.createErrorRealm(root, hooks);
  objects.installIntlIntrinsics(root, realm, hooks);
  const intl = objects.getOwnProperty(root, "Intl")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  const constructor = objects.getOwnProperty(intl, "PluralRules")?.value as
    objects.OrdinaryObject<objects.ScriptPropertyKey, unknown> | undefined;
  assert.ok(constructor);
  assert.equal(objects.getOwnProperty(constructor, "length")?.value, 0);
  const prototype = objects.getOwnProperty(constructor, "prototype")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  assert.equal(prototype.internalPluralRulesData, undefined);
  for (const [name, length] of [
    ["resolvedOptions", 0],
    ["select", 1],
    ["selectRange", 2],
  ] as const) {
    const method = objects.getOwnProperty(prototype, name)!
      .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
    assert.equal(objects.getOwnProperty(method, "length")?.value, length);
    assert.equal(method.internalConstruct, undefined);
  }
});

test("Intl.NumberFormat exposes a real formatter constructor and bound-format accessor", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
      undefined,
    ),
    realm = objects.createErrorRealm(root, hooks);
  objects.installIntlIntrinsics(root, realm, hooks);
  const intl = objects.getOwnProperty(root, "Intl")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  const constructor = objects.getOwnProperty(intl, "NumberFormat")?.value as
    objects.OrdinaryObject<objects.ScriptPropertyKey, unknown> | undefined;
  assert.ok(constructor);
  assert.equal(objects.getOwnProperty(constructor, "length")?.value, 0);
  const prototype = objects.getOwnProperty(constructor, "prototype")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  assert.ok(objects.getOwnProperty(prototype, "format")?.accessor);
  assert.ok(objects.getOwnProperty(prototype, "formatToParts"));
});

test("Intl numbering-system enumeration reflects the implemented numeric renderer", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
      undefined,
    ),
    realm = objects.createErrorRealm(root, hooks);
  objects.installIntlIntrinsics(root, realm, hooks);
  const intl = objects.getOwnProperty(root, "Intl")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  const method = objects.getOwnProperty(intl, "supportedValuesOf")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  const first = method.internalCall!(undefined, [
    "numberingSystem",
  ]) as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  const second = method.internalCall!(undefined, [
    "numberingSystem",
  ]) as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  assert.equal(objects.getOwnProperty(first, "length")?.value, 78);
  assert.equal(objects.getOwnProperty(first, "0")?.value, "adlm");
  assert.notEqual(first, second);
  const values = Array.from(
    { length: 78 },
    (_, index) => objects.getOwnProperty(first, String(index))!.value as string,
  );
  assert.deepEqual(values, [...values].sort());
  assert.ok(values.includes("latn") && values.includes("mathdbl"));
});

test("Intl fallback symbols belong to realms even when their symbol registry is shared", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const a = objects.createErrorRealm(root, hooks),
    b = objects.createErrorRealm(root, hooks, a.symbolRegistry);
  assert.notEqual(a.intlFallbackSymbol, b.intlFallbackSymbol);
  assert.equal(a.intlFallbackSymbol.description, "IntlLegacyConstructedSymbol");
  assert.equal(a.symbolRegistry, b.symbolRegistry);
});

test("Intl.NumberFormat exposes range methods with two-argument metadata", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
      undefined,
    ),
    realm = objects.createErrorRealm(root, hooks);
  objects.installIntlIntrinsics(root, realm, hooks);
  for (const name of ["formatRange", "formatRangeToParts"]) {
    const method = objects.getOwnProperty(realm.numberFormatPrototype, name)
      ?.value as
      objects.OrdinaryObject<objects.ScriptPropertyKey, unknown> | undefined;
    assert.ok(method);
    assert.equal(objects.getOwnProperty(method, "length")?.value, 2);
    assert.equal(method.internalConstruct, undefined);
  }
});
