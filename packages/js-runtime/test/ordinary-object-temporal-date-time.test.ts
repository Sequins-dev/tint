import assert from "node:assert/strict";
import test from "node:test";
import * as objects from "../src/objects/index.ts";
test("Temporal.PlainDateTime exposes constructor and clock accessors", () => {
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
  const descriptor = objects.getOwnProperty(temporal, "PlainDateTime");
  assert.ok(descriptor);
  const constructor = descriptor.value as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  assert.equal(objects.getOwnProperty(constructor, "length")!.value, 3);
  assert.ok(objects.getOwnProperty(constructor, "from"));
  assert.ok(objects.getOwnProperty(constructor, "compare"));
  for (const name of [
    "add",
    "subtract",
    "withPlainTime",
    "with",
    "toLocaleString",
    "round",
    "until",
    "since",
  ])
    assert.ok(
      objects.getOwnProperty(realm.temporalPlainDateTimePrototype, name),
      name,
    );
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
      realm.temporalPlainDateTimePrototype,
      name,
    )!;
    assert.ok(d, name);
    assert.equal(d.enumerable, false);
    assert.equal(d.configurable, true);
    assert.equal(d.set, undefined);
  }
});

test("Temporal.PlainDateTime supplies intrinsic copy and clock/date conversion methods", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(root, hooks);
  objects.installTemporalIntrinsics(root, realm, hooks);
  for (const name of [
    "equals",
    "withCalendar",
    "toPlainDate",
    "toPlainTime",
    "toZonedDateTime",
  ])
    assert.ok(
      objects.getOwnProperty(realm.temporalPlainDateTimePrototype, name),
      name,
    );
});
