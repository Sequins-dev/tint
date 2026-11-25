import assert from "node:assert/strict";
import test from "node:test";
import * as objects from "../src/objects/index.ts";

test("Date exposes a realm-local constructor and unbranded prototype", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(root, hooks);
  objects.installPrimitiveIntrinsics(root, realm, hooks);
  const property = objects.getOwnProperty(root, "Date");
  assert.ok(property, "Date constructor is installed");
  const constructor = property.value as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  assert.equal(objects.getOwnProperty(constructor, "length")?.value, 7);
  assert.ok(constructor.internalConstruct);
  assert.ok(
    objects.getOwnProperty(constructor, "parse"),
    "Date.parse installed",
  );
  const prototype = objects.getOwnProperty(constructor, "prototype")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  assert.ok(
    objects.getOwnProperty(prototype, "getTimezoneOffset"),
    "local-time accessors installed",
  );
  assert.equal(objects.exoticSlots(prototype).internalDateValue, undefined);
  assert.ok(
    objects.getOwnProperty(prototype, "getYear"),
    "legacy year methods installed",
  );
  assert.ok(
    objects.getOwnProperty(prototype, "setHours"),
    "local setters installed",
  );
  assert.ok(
    objects.getOwnProperty(prototype, "toDateString"),
    "local date serialization installed",
  );
  assert.ok(
    objects.getOwnProperty(prototype, "setUTCFullYear"),
    "UTC setters installed",
  );
  assert.ok(
    objects.getOwnProperty(prototype, "toISOString"),
    "ISO date serialization installed",
  );
  const utc = objects.getOwnProperty(prototype, "getUTCFullYear")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  assert.equal(objects.getOwnProperty(utc, "length")?.value, 0);
  assert.equal(utc.internalConstruct, undefined);
});

test("Date.now reads the embedding's wall clock, independently of its receiver", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(root, hooks);
  let reads = 0;
  realm.wallClockMilliseconds = () => {
    reads++;
    return 1234;
  };
  objects.installPrimitiveIntrinsics(root, realm, hooks);
  const constructor = objects.getOwnProperty(root, "Date")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  const now = objects.getOwnProperty(constructor, "now")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  assert.equal(now.internalCall!(null, []), 1234);
  assert.equal(reads, 1);
});

test("Date toTemporalInstant exposes a zero-argument non-constructor method", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(root, hooks);
  objects.installPrimitiveIntrinsics(root, realm, hooks);
  const descriptor = objects.getOwnProperty(
    realm.datePrototype,
    "toTemporalInstant",
  );
  assert.ok(descriptor);
  const fn = descriptor.value as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  assert.equal(objects.getOwnProperty(fn, "length")?.value, 0);
  assert.equal(objects.getOwnProperty(fn, "name")?.value, "toTemporalInstant");
  assert.equal(fn.internalConstruct, undefined);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.configurable, true);
});
