import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";
type ObjectValue = objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
const hooks: objects.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => {
    throw new Error("unexpected user code during intrinsic installation");
  },
};
test("RegExp constructor and accessors have standard descriptors without invoking user code", () => {
  const global = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(global, hooks);
  objects.installRegExpIntrinsics(global, realm, hooks);
  const constructor = objects.getOwnProperty(global, "RegExp")!
    .value as ObjectValue;
  assert.equal(objects.getOwnProperty(constructor, "name")?.value, "RegExp");
  assert.equal(objects.getOwnProperty(constructor, "length")?.value, 2);
  const prototype = objects.getOwnProperty(constructor, "prototype")!;
  assert.equal(prototype.value, realm.regexpPrototype);
  assert.equal(prototype.writable, false);
  assert.equal(prototype.configurable, false);
  for (const name of [
    "source",
    "flags",
    "global",
    "hasIndices",
    "ignoreCase",
    "multiline",
    "dotAll",
    "unicode",
    "unicodeSets",
    "sticky",
  ]) {
    const descriptor = objects.getOwnProperty(realm.regexpPrototype, name)!;
    assert.equal(descriptor.accessor, true);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.configurable, true);
    assert.equal(descriptor.set, undefined);
    const getter = descriptor.get as ObjectValue;
    assert.equal(objects.getOwnProperty(getter, "name")?.value, "get " + name);
    assert.equal(objects.getOwnProperty(getter, "length")?.value, 0);
  }
  for (const name of ["exec", "test", "toString"]) {
    const descriptor = objects.getOwnProperty(realm.regexpPrototype, name)!;
    assert.equal(descriptor.writable, true);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.configurable, true);
  }
  assert.equal(
    objects.exoticSlots(realm.regexpPrototype).internalRegExpData,
    undefined,
  );
});

test("RegExp source spelling preserves escaped delimiters and line terminators", async () => {
  const { regexpSource } = await import("../src/objects/regexp-runtime.ts");
  for (const source of [
    "",
    "/",
    "[/]",
    String.raw`\/`,
    String.raw`\\/`,
    "\n",
    "\r",
    "\u2028",
    "\u2029",
    "\\\n",
    "\\\r",
    "[\n]",
    "a/b",
    String.raw`\n`,
  ]) {
    assert.equal(
      regexpSource(source),
      new RegExp(source).source,
      JSON.stringify(source),
    );
  }
});

test("RegExp search is a nonconstructable symbol method with standard metadata", () => {
  const global = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(global, hooks);
  objects.installRegExpIntrinsics(global, realm, hooks);
  const key = objects.wellKnownSymbol(realm.symbolRegistry, "search");
  const descriptor = objects.getOwnProperty(realm.regexpPrototype, key);
  assert.ok(descriptor);
  const method = descriptor.value as ObjectValue;
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.configurable, true);
  assert.equal(
    objects.getOwnProperty(method, "name")?.value,
    "[Symbol.search]",
  );
  assert.equal(objects.getOwnProperty(method, "length")?.value, 1);
  assert.equal(method.internalRareSlots?.internalConstruct, undefined);
});

test("RegExp match is installed with its symbol name and arity", () => {
  const global = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(global, hooks);
  objects.installRegExpIntrinsics(global, realm, hooks);
  const method = objects.getOwnProperty(
    realm.regexpPrototype,
    objects.wellKnownSymbol(realm.symbolRegistry, "match"),
  )?.value as ObjectValue;
  assert.ok(method);
  assert.equal(objects.getOwnProperty(method, "name")?.value, "[Symbol.match]");
  assert.equal(objects.getOwnProperty(method, "length")?.value, 1);
});

test("String RegExp protocol entrypoints expose standard method arities", () => {
  const global = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(global, hooks);
  objects.installPrimitiveIntrinsics(global, realm, hooks);
  for (const name of [
    "match",
    "matchAll",
    "search",
    "replace",
    "replaceAll",
    "split",
  ]) {
    const descriptor = objects.getOwnProperty(realm.stringPrototype, name);
    assert.ok(descriptor, name);
    const method = descriptor.value as ObjectValue;
    assert.equal(
      objects.getOwnProperty(method, "length")?.value,
      name.startsWith("replace") || name === "split" ? 2 : 1,
    );
    assert.equal(descriptor.enumerable, false);
  }
});

test("RegExp split is a symbol method with two formal parameters", () => {
  const global = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(global, hooks);
  objects.installRegExpIntrinsics(global, realm, hooks);
  const method = objects.getOwnProperty(
    realm.regexpPrototype,
    objects.wellKnownSymbol(realm.symbolRegistry, "split"),
  )?.value as ObjectValue;
  assert.ok(method);
  assert.equal(objects.getOwnProperty(method, "name")?.value, "[Symbol.split]");
  assert.equal(objects.getOwnProperty(method, "length")?.value, 2);
});

test("RegExp matchAll is installed with its standard symbol metadata", () => {
  const global = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(global, hooks);
  objects.installRegExpIntrinsics(global, realm, hooks);
  const method = objects.getOwnProperty(
    realm.regexpPrototype,
    objects.wellKnownSymbol(realm.symbolRegistry, "matchAll"),
  )?.value as ObjectValue;
  assert.ok(method);
  assert.equal(
    objects.getOwnProperty(method, "name")?.value,
    "[Symbol.matchAll]",
  );
  assert.equal(objects.getOwnProperty(method, "length")?.value, 1);
});
