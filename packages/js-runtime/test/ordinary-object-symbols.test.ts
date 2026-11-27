import { test } from "node:test";
import assert from "node:assert/strict";
import * as object from "@tint/js-runtime/objects";

test("symbol identities are fresh while explicit registries share registered and well-known symbols", () => {
  assert.equal(typeof object.createSymbolValue, "function");
  const a = object.createSymbolValue("same"),
    b = object.createSymbolValue("same");
  assert.notEqual(a, b);
  const registry = object.createSymbolRegistry();
  const registered = object.registeredSymbol(registry, "same");
  assert.equal(object.registeredSymbol(registry, "same"), registered);
  assert.notEqual(registered, a);
  assert.equal(object.registeredSymbolKey(registry, registered), "same");
  assert.equal(object.registeredSymbolKey(registry, a), undefined);
  const iterator = object.wellKnownSymbol(registry, "iterator");
  assert.equal(object.wellKnownSymbol(registry, "iterator"), iterator);
  assert.equal(object.registeredSymbolKey(registry, iterator), undefined);
  assert.equal(
    object.symbolDescriptiveString(iterator),
    "Symbol(Symbol.iterator)",
  );
  assert.equal(
    object.symbolDescriptiveString(object.createSymbolValue(undefined)),
    "Symbol()",
  );
});

test("symbol property keys retain identity, order, enumeration exclusion and rest copying", () => {
  const hooks: object.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => {
      throw new Error("unexpected call");
    },
  };
  const source = object.createObject<object.ScriptPropertyKey, unknown>(
    undefined,
  );
  const a = object.createSymbolValue("key"),
    b = object.createSymbolValue("key");
  for (const [key, value] of [
    [a, 1],
    ["z", 2],
    ["2", 3],
    [b, 4],
    ["1", 5],
  ] as const)
    assert.ok(object.createDataProperty(source, key, value, hooks));
  assert.deepEqual(object.ownKeys(source, object.scriptPropertyKeyOrder), [
    "1",
    "2",
    "z",
    a,
    b,
  ]);
  assert.equal(object.getProperty(source, a, source, hooks), 1);
  assert.equal(object.getProperty(source, b, source, hooks), 4);
  const enumeration = object.createPropertyEnumeration(
    source,
    object.scriptPropertyKeyOrder,
  );
  assert.deepEqual(
    [
      object.nextEnumerableProperty(enumeration),
      object.nextEnumerableProperty(enumeration),
      object.nextEnumerableProperty(enumeration),
      object.nextEnumerableProperty(enumeration),
    ],
    ["1", "2", "z", undefined],
  );
  const copy = object.createObject<object.ScriptPropertyKey, unknown>(
    undefined,
  );
  assert.ok(
    object.copyDataProperties(
      copy,
      source,
      source,
      [a],
      object.scriptPropertyKeyOrder,
      hooks,
    ),
  );
  assert.equal(object.hasProperty(copy, a), false);
  assert.equal(object.getProperty(copy, b, copy, hooks), 4);
});

test("Symbol intrinsic has a throwing construct capability and exposes registry metadata", () => {
  const hooks: object.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => {
      throw new Error("unexpected call");
    },
  };
  const root = object.createObject<object.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = object.createErrorRealm(root, hooks);
  const global = object.createObject<object.ScriptPropertyKey, unknown>(root);
  assert.equal(typeof object.installSymbolIntrinsics, "function");
  object.installSymbolIntrinsics(global, realm, hooks);
  const constructor = object.getOwnProperty(global, "Symbol")!
    .value as object.OrdinaryObject<object.ScriptPropertyKey, unknown>;
  assert.equal(typeof constructor.internalRareSlots?.internalCall, "function");
  assert.equal(
    typeof constructor.internalRareSlots?.internalConstruct,
    "function",
  );
  assert.throws(() =>
    constructor.internalRareSlots!.internalConstruct!([], constructor),
  );
  assert.equal(object.getOwnProperty(constructor, "length")?.value, 0);
  assert.equal(
    object.getOwnProperty(constructor, "prototype")?.value,
    realm.symbolPrototype,
  );
  const a = constructor.internalRareSlots!.internalCall!(undefined, []),
    b = constructor.internalRareSlots!.internalCall!(undefined, []);
  assert.notEqual(a, b);
  for (const name of ["for", "keyFor"]) {
    const fn = object.getOwnProperty(constructor, name)!
      .value as object.OrdinaryObject<object.ScriptPropertyKey, unknown>;
    assert.equal(object.getOwnProperty(fn, "length")?.value, 1);
    assert.equal(object.getOwnProperty(fn, "name")?.value, name);
  }
});

test("realms sharing an explicit registry share registered and well-known symbols", () => {
  const hooks: object.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => {
      throw new Error("unexpected call");
    },
  };
  const registry = object.createSymbolRegistry();
  function make() {
    const root = object.createObject<object.ScriptPropertyKey, unknown>(
      undefined,
    );
    const realm = object.createErrorRealm(root, hooks, registry);
    const global = object.createObject<object.ScriptPropertyKey, unknown>(root);
    object.installSymbolIntrinsics(global, realm, hooks);
    return object.getOwnProperty(global, "Symbol")!
      .value as object.OrdinaryObject<object.ScriptPropertyKey, unknown>;
  }
  const a = make(),
    b = make();
  assert.notEqual(
    object.getOwnProperty(a, "prototype")?.value,
    object.getOwnProperty(b, "prototype")?.value,
  );
  assert.equal(
    object.getOwnProperty(a, "iterator")?.value,
    object.getOwnProperty(b, "iterator")?.value,
  );
  const af = object.getOwnProperty(a, "for")!.value as object.OrdinaryObject<
    object.ScriptPropertyKey,
    unknown
  >;
  const bf = object.getOwnProperty(b, "for")!.value as object.OrdinaryObject<
    object.ScriptPropertyKey,
    unknown
  >;
  assert.equal(
    af.internalRareSlots!.internalCall!(a, ["shared"]),
    bf.internalRareSlots!.internalCall!(b, ["shared"]),
  );
});
