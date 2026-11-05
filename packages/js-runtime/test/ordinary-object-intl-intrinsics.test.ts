import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";

test("Intl.getCanonicalLocales has standard intrinsic metadata", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => {
      throw new Error("unexpected call");
    },
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(root, hooks);
  objects.installIntlIntrinsics(root, realm, hooks);
  const intl = objects.getOwnProperty(root, "Intl")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  const descriptor = objects.getOwnProperty(intl, "getCanonicalLocales");
  assert.ok(descriptor);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.configurable, true);
  assert.equal(descriptor.writable, true);
  const method = descriptor.value as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  assert.equal(
    objects.getOwnProperty(method, "name")?.value,
    "getCanonicalLocales",
  );
  assert.equal(objects.getOwnProperty(method, "length")?.value, 1);
  assert.equal(method.internalConstruct, undefined);
});

test("Intl.Locale constructor and branded prototype accessors have standard metadata", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => {
      throw new Error("unexpected call");
    },
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(root, hooks);
  objects.installIntlIntrinsics(root, realm, hooks);
  const intl = objects.getOwnProperty(root, "Intl")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  const locale = objects.getOwnProperty(intl, "Locale")?.value as
    objects.OrdinaryObject<objects.ScriptPropertyKey, unknown> | undefined;
  assert.ok(locale);
  assert.equal(objects.getOwnProperty(locale, "name")?.value, "Locale");
  assert.equal(objects.getOwnProperty(locale, "length")?.value, 1);
  assert.ok(locale.internalConstruct);
  const descriptor = objects.getOwnProperty(locale, "prototype")!;
  assert.equal(descriptor.configurable, false);
  assert.equal(descriptor.writable, false);
  const prototype = descriptor.value as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  for (const name of [
    "maximize",
    "minimize",
    "getHourCycles",
    "getTextInfo",
    "getWeekInfo",
    "getTimeZones",
  ]) {
    const descriptor = objects.getOwnProperty(prototype, name);
    assert.ok(descriptor, name);
    const method = descriptor.value as objects.OrdinaryObject<
      objects.ScriptPropertyKey,
      unknown
    >;
    assert.equal(objects.getOwnProperty(method, "name")?.value, name);
    assert.equal(objects.getOwnProperty(method, "length")?.value, 0);
    assert.equal(descriptor.writable, true);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.configurable, true);
  }
  for (const name of [
    "baseName",
    "language",
    "script",
    "region",
    "variants",
    "calendar",
    "collation",
    "firstDayOfWeek",
    "hourCycle",
    "caseFirst",
    "numeric",
    "numberingSystem",
  ]) {
    const getter = objects.getOwnProperty(prototype, name)!;
    assert.ok(getter?.accessor, name);
    assert.equal(getter.enumerable, false);
    assert.equal(getter.configurable, true);
    assert.equal(getter.set, undefined);
    const fn = getter.get as objects.OrdinaryObject<
      objects.ScriptPropertyKey,
      unknown
    >;
    assert.equal(objects.getOwnProperty(fn, "name")?.value, "get " + name);
    assert.equal(objects.getOwnProperty(fn, "length")?.value, 0);
  }
});

test("Intl.ListFormat exposes real constructor, methods and standard metadata", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => {
      throw new Error("unexpected call");
    },
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(root, hooks);
  objects.installIntlIntrinsics(root, realm, hooks);
  const intl = objects.getOwnProperty(root, "Intl")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  const constructor = objects.getOwnProperty(intl, "ListFormat")?.value as
    objects.OrdinaryObject<objects.ScriptPropertyKey, unknown> | undefined;
  assert.ok(constructor);
  assert.ok(constructor.internalConstruct);
  assert.equal(
    objects.getOwnProperty(constructor, "name")?.value,
    "ListFormat",
  );
  assert.equal(objects.getOwnProperty(constructor, "length")?.value, 0);
  const prototype = objects.getOwnProperty(constructor, "prototype")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  for (const [owner, name, length] of [
    [constructor, "supportedLocalesOf", 1],
    [prototype, "format", 1],
    [prototype, "formatToParts", 1],
    [prototype, "resolvedOptions", 0],
  ] as const) {
    const descriptor = objects.getOwnProperty(owner, name);
    assert.ok(descriptor, name);
    assert.equal(descriptor.writable, true);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.configurable, true);
    const method = descriptor.value as objects.OrdinaryObject<
      objects.ScriptPropertyKey,
      unknown
    >;
    assert.equal(objects.getOwnProperty(method, "name")?.value, name);
    assert.equal(objects.getOwnProperty(method, "length")?.value, length);
    assert.equal(method.internalConstruct, undefined);
  }
});
