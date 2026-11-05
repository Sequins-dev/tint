import assert from "node:assert/strict";
import test from "node:test";
import * as objects from "../src/objects/index.ts";
test("Temporal.ZonedDateTime exposes constructor and clock accessors", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
      undefined,
    ),
    realm = objects.createErrorRealm(root, hooks);
  objects.installTemporalIntrinsics(root, realm, hooks);
  const temporal = objects.getOwnProperty(root, "Temporal")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  for (const [name, length] of [
    ["toInstant", 0],
    ["toPlainDate", 0],
    ["toPlainTime", 0],
    ["toPlainDateTime", 0],
    ["withCalendar", 1],
    ["with", 1],
    ["add", 1],
    ["subtract", 1],
    ["round", 1],
    ["until", 1],
    ["since", 1],
    ["withTimeZone", 1],
    ["withPlainTime", 0],
    ["startOfDay", 0],
    ["getTimeZoneTransition", 1],
    ["equals", 1],
  ] as const) {
    const descriptor = objects.getOwnProperty(
      realm.temporalZonedDateTimePrototype,
      name,
    );
    assert.ok(descriptor, name);
    const method = descriptor.value as objects.OrdinaryObject<
      objects.ScriptPropertyKey,
      unknown
    >;
    assert.equal(objects.getOwnProperty(method, "length")!.value, length, name);
    assert.equal(method.internalConstruct, undefined, name);
    assert.equal(descriptor.enumerable, false, name);
    assert.equal(descriptor.writable, true, name);
    assert.equal(descriptor.configurable, true, name);
  }
  const descriptor = objects.getOwnProperty(temporal, "ZonedDateTime");
  assert.ok(descriptor);
  const constructor = descriptor.value as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  assert.equal(objects.getOwnProperty(constructor, "length")!.value, 2);
  for (const [name, length] of [
    ["from", 1],
    ["compare", 2],
  ] as const) {
    const descriptor = objects.getOwnProperty(constructor, name);
    assert.ok(descriptor);
    const fn = descriptor.value as objects.OrdinaryObject<
      objects.ScriptPropertyKey,
      unknown
    >;
    assert.equal(objects.getOwnProperty(fn, "length")!.value, length);
    assert.equal(fn.internalConstruct, undefined);
  }
  for (const name of [
    "year",
    "month",
    "day",
    "hour",
    "minute",
    "second",
    "millisecond",
    "microsecond",
    "nanosecond",
  ]) {
    const d = objects.getOwnProperty(
      realm.temporalZonedDateTimePrototype,
      name,
    )!;
    assert.ok(d, name);
    assert.equal(d.enumerable, false);
    assert.equal(d.configurable, true);
    assert.equal(d.set, undefined);
  }
});
