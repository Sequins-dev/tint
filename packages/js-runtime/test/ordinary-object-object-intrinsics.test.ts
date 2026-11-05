import type { ScriptPropertyKey } from "@tint/js-runtime/objects";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";
const hooks: objects.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => undefined,
};
test("Object intrinsic exposes constructor and reflection method metadata", () => {
  assert.equal(typeof objects.installObjectIntrinsics, "function");
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(root, hooks);
  const global = objects.createObject<ScriptPropertyKey, unknown>(root);
  objects.installObjectIntrinsics(global, realm, hooks);
  const constructor = objects.getOwnProperty(global, "Object")!
    .value as objects.OrdinaryObject<ScriptPropertyKey, unknown>;
  assert.equal(objects.getOwnProperty(constructor, "prototype")?.value, root);
  assert.equal(objects.getOwnProperty(root, "constructor")?.value, constructor);
  assert.equal(objects.getOwnProperty(constructor, "length")?.value, 1);
  for (const [name, length] of [
    ["defineProperty", 3],
    ["getOwnPropertyDescriptor", 2],
    ["defineProperties", 2],
    ["create", 2],
    ["getOwnPropertyNames", 1],
    ["getOwnPropertySymbols", 1],
    ["keys", 1],
    ["values", 1],
    ["entries", 1],
    ["fromEntries", 1],
    ["groupBy", 2],
    ["assign", 2],
    ["hasOwn", 2],
    ["getOwnPropertyDescriptors", 1],
    ["getPrototypeOf", 1],
    ["setPrototypeOf", 2],
    ["preventExtensions", 1],
    ["isExtensible", 1],
    ["seal", 1],
    ["freeze", 1],
    ["isSealed", 1],
    ["isFrozen", 1],
  ] as const) {
    const descriptor = objects.getOwnProperty(constructor, name)!;
    assert.ok(descriptor, name);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.writable, true);
    assert.equal(descriptor.configurable, true);
    const fn = descriptor.value as objects.OrdinaryObject<
      ScriptPropertyKey,
      unknown
    >;
    assert.equal(objects.getOwnProperty(fn, "length")?.value, length);
    assert.equal(objects.getOwnProperty(fn, "name")?.value, name);
  }
  const fresh = constructor.internalCall!(
    undefined,
    [],
  ) as objects.OrdinaryObject<ScriptPropertyKey, unknown>;
  assert.equal(fresh.prototype, root);
  assert.notEqual(fresh, constructor.internalCall!(undefined, [null]));
});
test("Object prototype exposes generic locale and prototype queries", () => {
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  objects.createErrorRealm(root, hooks);
  for (const [name, length] of [
    ["toLocaleString", 0],
    ["isPrototypeOf", 1],
    ["__defineGetter__", 2],
    ["__defineSetter__", 2],
    ["__lookupGetter__", 1],
    ["__lookupSetter__", 1],
  ] as const) {
    const descriptor = objects.getOwnProperty(root, name);
    assert.ok(descriptor, name);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.writable, true);
    assert.equal(descriptor.configurable, true);
    const fn = descriptor.value as objects.OrdinaryObject<
      ScriptPropertyKey,
      unknown
    >;
    assert.equal(objects.getOwnProperty(fn, "length")?.value, length);
    assert.equal(objects.getOwnProperty(fn, "name")?.value, name);
    assert.equal(fn.internalConstruct, undefined);
  }
});
test("Object prototype exposes the legacy prototype accessor", () => {
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  objects.createErrorRealm(root, hooks);
  const descriptor = objects.getOwnProperty(root, "__proto__");
  assert.ok(descriptor);
  assert.equal(descriptor.accessor, true);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.configurable, true);
  for (const [value, name, length] of [
    [descriptor.get, "get __proto__", 0],
    [descriptor.set, "set __proto__", 1],
  ] as const) {
    const fn = value as objects.OrdinaryObject<ScriptPropertyKey, unknown>;
    assert.equal(objects.getOwnProperty(fn, "name")?.value, name);
    assert.equal(objects.getOwnProperty(fn, "length")?.value, length);
    assert.equal(fn.internalConstruct, undefined);
  }
});
