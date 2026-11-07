import type { ScriptPropertyKey } from "@tint/js-runtime/objects";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";
const hooks: objects.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => undefined,
};
test("primitive constructors have realm-local prototypes and readonly Number constants", () => {
  assert.equal(typeof objects.installPrimitiveIntrinsics, "function");
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(root, hooks);
  objects.installPrimitiveIntrinsics(root, realm, hooks);
  for (const name of ["Boolean", "Number", "String"]) {
    const constructor = objects.getOwnProperty(root, name)!
      .value as objects.OrdinaryObject<ScriptPropertyKey, unknown>;
    assert.equal(objects.getOwnProperty(constructor, "length")?.value, 1);
    assert.equal(objects.getOwnProperty(constructor, "name")?.value, name);
    const prototype = objects.getOwnProperty(constructor, "prototype")!;
    assert.equal(prototype.writable, false);
    assert.equal(prototype.configurable, false);
    const object = prototype.value as objects.OrdinaryObject<
      ScriptPropertyKey,
      unknown
    >;
    assert.equal(
      objects.getOwnProperty(object, "constructor")?.value,
      constructor,
    );
    assert.equal(object.internalPrimitiveData?.kind, name.toLowerCase());
  }
  const number = objects.getOwnProperty(root, "Number")!
    .value as objects.OrdinaryObject<ScriptPropertyKey, unknown>;
  const maximum = objects.getOwnProperty(number, "MAX_SAFE_INTEGER")!;
  assert.equal(maximum.value, Number.MAX_SAFE_INTEGER);
  assert.equal(maximum.writable, false);
  assert.equal(maximum.configurable, false);
});
test("primitive wrapper payloads are internal and strings expose immutable UTF-16 indices", () => {
  assert.equal(typeof objects.createPrimitiveObject, "function");
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const box = objects.createPrimitiveObject(
    "string",
    "a\uD83D\uDE00",
    root,
    hooks,
  );
  assert.deepEqual(box.internalPrimitiveData, {
    kind: "string",
    value: "a\uD83D\uDE00",
  });
  assert.deepEqual(objects.ownKeys(box, objects.scriptPropertyKeyOrder), [
    "0",
    "1",
    "2",
    "length",
  ]);
  const index = objects.getOwnProperty(box, "1")!;
  assert.equal(index.value, "\uD83D");
  assert.equal(index.enumerable, true);
  assert.equal(index.writable, false);
  assert.equal(index.configurable, false);
  assert.equal(objects.getOwnProperty(box, "length")?.value, 3);
  assert.equal(objects.getOwnProperty(box, "length")?.enumerable, false);
  assert.equal(objects.deleteProperty(box, "0"), false);
  const number = objects.createPrimitiveObject("number", -0, root, hooks);
  assert.ok(Object.is(number.internalPrimitiveData?.value, -0));
  assert.equal(number.properties.size, 0);
});

test("String code point construction is an ordinary nonconstructor builtin", () => {
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(root, hooks);
  objects.installPrimitiveIntrinsics(root, realm, hooks);
  const constructor = objects.getOwnProperty(root, "String")!
    .value as objects.OrdinaryObject<ScriptPropertyKey, unknown>;
  const descriptor = objects.getOwnProperty(constructor, "fromCodePoint");
  assert.ok(descriptor);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.configurable, true);
  assert.equal(descriptor.enumerable, false);
  const method = descriptor.value as objects.OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  assert.equal(objects.getOwnProperty(method, "name")?.value, "fromCodePoint");
  assert.equal(objects.getOwnProperty(method, "length")?.value, 1);
  assert.equal(objects.getOwnProperty(method, "prototype"), undefined);
});

test("String.fromCharCode exposes the standard builtin descriptor", () => {
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(root, hooks);
  objects.installPrimitiveIntrinsics(root, realm, hooks);
  const constructor = objects.getOwnProperty(root, "String")!
    .value as objects.OrdinaryObject<ScriptPropertyKey, unknown>;
  const descriptor = objects.getOwnProperty(constructor, "fromCharCode");
  assert.ok(descriptor);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.configurable, true);
  const method = descriptor.value as objects.OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  assert.equal(objects.getOwnProperty(method, "length")?.value, 1);
  assert.equal(objects.getOwnProperty(method, "name")?.value, "fromCharCode");
  assert.equal(objects.getOwnProperty(method, "prototype"), undefined);
});

test("String.prototype.charCodeAt is a writable nonconstructor builtin", () => {
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(root, hooks);
  objects.installPrimitiveIntrinsics(root, realm, hooks);
  const descriptor = objects.getOwnProperty(
    realm.stringPrototype,
    "charCodeAt",
  );
  assert.ok(descriptor);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.configurable, true);
  const method = descriptor.value as objects.OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  assert.equal(objects.getOwnProperty(method, "length")?.value, 1);
  assert.equal(objects.getOwnProperty(method, "name")?.value, "charCodeAt");
  assert.equal(objects.getOwnProperty(method, "prototype"), undefined);
});

test("String.prototype.charAt has standard builtin metadata", () => {
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(root, hooks);
  objects.installPrimitiveIntrinsics(root, realm, hooks);
  const descriptor = objects.getOwnProperty(realm.stringPrototype, "charAt");
  assert.ok(descriptor);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.configurable, true);
  const method = descriptor.value as objects.OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  assert.equal(objects.getOwnProperty(method, "length")?.value, 1);
  assert.equal(objects.getOwnProperty(method, "name")?.value, "charAt");
  assert.equal(objects.getOwnProperty(method, "prototype"), undefined);
});
for (const name of ["substring", "slice"] as const)
  test(`String.prototype.${name} preserves bounds and UTF-16 units`, () => {
    const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
    const realm = objects.createErrorRealm(root, hooks);
    objects.installPrimitiveIntrinsics(root, realm, hooks);
    const descriptor = objects.getOwnProperty(realm.stringPrototype, name);
    assert.ok(descriptor);
    const method = descriptor.value as objects.OrdinaryObject<
      ScriptPropertyKey,
      unknown
    >;
    assert.equal(objects.getOwnProperty(method, "length")?.value, 2);
    assert.equal(objects.getOwnProperty(method, "name")?.value, name);
    assert.equal(objects.getOwnProperty(method, "prototype"), undefined);
    assert.ok(method.internalCall);
    for (const text of ["abc", "A\ud83d\ude00Z", ""])
      for (const args of [
        [],
        [1],
        [2, 1],
        [-2],
        [NaN, Infinity],
        [-Infinity, 2],
        [1.9, 3.9],
        [1, undefined],
      ] as const)
        assert.equal(
          method.internalCall(text, args),
          text[name](args[0] as number, args[1]),
          JSON.stringify({ text, args }),
        );
  });
for (const name of ["indexOf", "lastIndexOf"] as const)
  test(`String.prototype.${name} converts searches and clamps positions`, () => {
    const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
    const realm = objects.createErrorRealm(root, hooks);
    objects.installPrimitiveIntrinsics(root, realm, hooks);
    const descriptor = objects.getOwnProperty(realm.stringPrototype, name);
    assert.ok(descriptor);
    const method = descriptor.value as objects.OrdinaryObject<
      ScriptPropertyKey,
      unknown
    >;
    assert.equal(objects.getOwnProperty(method, "length")?.value, 1);
    assert.ok(method.internalCall);
    for (const search of ["a", "", "missing", undefined, null, 42])
      for (const position of [
        undefined,
        NaN,
        Infinity,
        -Infinity,
        -1,
        -0.9,
        -0,
        0,
        0.9,
        1.9,
        99,
      ])
        assert.equal(
          method.internalCall("aba42undefinednull", [search, position]),
          "aba42undefinednull"[name](String(search), position),
        );
  });

test("String search, trimming and repetition methods expose standard descriptors", () => {
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(root, hooks);
  objects.installPrimitiveIntrinsics(root, realm, hooks);
  for (const name of [
    "startsWith",
    "endsWith",
    "includes",
    "concat",
    "repeat",
    "padStart",
    "padEnd",
    "at",
    "codePointAt",
    "trim",
    "trimStart",
    "trimEnd",
  ]) {
    const descriptor = objects.getOwnProperty(realm.stringPrototype, name);
    assert.ok(descriptor, name);
    assert.equal(descriptor.enumerable, false);
    const method = descriptor.value as objects.OrdinaryObject<
      ScriptPropertyKey,
      unknown
    >;
    assert.equal(
      objects.getOwnProperty(method, "length")?.value,
      name.startsWith("trim") ? 0 : 1,
    );
    assert.equal(objects.getOwnProperty(method, "name")?.value, name);
    assert.equal(method.internalConstruct, undefined);
  }
  assert.equal(
    objects.getOwnProperty(realm.stringPrototype, "trimLeft")?.value,
    objects.getOwnProperty(realm.stringPrototype, "trimStart")?.value,
  );
  assert.equal(
    objects.getOwnProperty(realm.stringPrototype, "trimRight")?.value,
    objects.getOwnProperty(realm.stringPrototype, "trimEnd")?.value,
  );
});

test("String.raw exposes standard metadata", () => {
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(root, hooks);
  objects.installPrimitiveIntrinsics(root, realm, hooks);
  const constructor = objects.getOwnProperty(root, "String")!
    .value as objects.OrdinaryObject<ScriptPropertyKey, unknown>;
  const descriptor = objects.getOwnProperty(constructor, "raw");
  assert.ok(descriptor);
  assert.equal(descriptor.enumerable, false);
  const method = descriptor.value as objects.OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  assert.equal(objects.getOwnProperty(method, "length")?.value, 1);
  assert.equal(method.internalConstruct, undefined);
  assert.ok(method.internalCall);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.configurable, true);
  assert.equal(objects.getOwnProperty(method, "name")?.value, "raw");
  // Object views are native build bindings; coercion/order cases live in
  // tools/verify-test262-native-string-raw.ts.
});

test("String.substr clamps UTF-16 offsets and lengths independently", () => {
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(root, hooks);
  objects.installPrimitiveIntrinsics(root, realm, hooks);
  const descriptor = objects.getOwnProperty(realm.stringPrototype, "substr");
  assert.ok(descriptor);
  const method = descriptor.value as objects.OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  assert.ok(method.internalCall);
  assert.equal(objects.getOwnProperty(method, "length")?.value, 2);
  for (const value of ["", "abc", "a😀z"])
    for (const start of [
      undefined,
      NaN,
      -Infinity,
      -9,
      -1.9,
      -0,
      1.9,
      9,
      Infinity,
    ])
      for (const length of [undefined, NaN, -Infinity, -1, 0, 1.9, 9, Infinity])
        assert.equal(
          method.internalCall(value, [start, length]),
          value.substr(start ?? 0, length),
        );
});
