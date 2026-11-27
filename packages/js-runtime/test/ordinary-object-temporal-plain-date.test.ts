import assert from "node:assert/strict";
import test from "node:test";
import * as objects from "../src/objects/index.ts";
test("Temporal.PlainDate exposes constructor and branded calendar accessors", () => {
  assert.equal(typeof objects.installTemporalIntrinsics, "function");
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
  const constructor = objects.getOwnProperty(temporal, "PlainDate")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  assert.equal(objects.getOwnProperty(constructor, "length")!.value, 3);
  assert.equal(objects.getOwnProperty(constructor, "name")!.value, "PlainDate");
  for (const name of ["from", "compare"]) {
    const descriptor = objects.getOwnProperty(constructor, name);
    assert.ok(descriptor, name);
  }
  for (const name of ["add", "subtract", "toZonedDateTime", "until", "since"])
    assert.ok(
      objects.getOwnProperty(realm.temporalPlainDatePrototype, name),
      name,
    );
  for (const name of [
    "year",
    "month",
    "monthCode",
    "day",
    "calendarId",
    "dayOfWeek",
    "dayOfYear",
    "weekOfYear",
    "yearOfWeek",
    "daysInWeek",
    "daysInMonth",
    "daysInYear",
    "monthsInYear",
    "inLeapYear",
  ]) {
    const descriptor = objects.getOwnProperty(
      realm.temporalPlainDatePrototype,
      name,
    )!;
    assert.ok(descriptor, name);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.configurable, true);
    assert.equal(descriptor.set, undefined);
  }
});

test("Temporal.PlainDate supplies slot-based equality, calendar copy and partial-date conversions", () => {
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
  for (const [name, length] of [
    ["equals", 1],
    ["with", 1],
    ["withCalendar", 1],
    ["toPlainYearMonth", 0],
    ["toPlainMonthDay", 0],
    ["toPlainDateTime", 0],
  ] as const) {
    const descriptor = objects.getOwnProperty(
      realm.temporalPlainDatePrototype,
      name,
    );
    assert.ok(descriptor, name);
    const fn = descriptor.value as objects.OrdinaryObject<
      objects.ScriptPropertyKey,
      unknown
    >;
    assert.equal(objects.getOwnProperty(fn, "length")!.value, length);
    assert.equal(fn.internalRareSlots?.internalConstruct, undefined);
  }
});
