import assert from "node:assert/strict";
import test from "node:test";
import * as objects from "../src/objects/index.ts";

test("Temporal partial dates expose only their calendar fields", () => {
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
  const temporal = objects.getOwnProperty(root, "Temporal")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  for (const name of ["PlainYearMonth", "PlainMonthDay"]) {
    const descriptor = objects.getOwnProperty(temporal, name);
    assert.ok(descriptor, name);
    const ctor = descriptor.value as objects.OrdinaryObject<
      objects.ScriptPropertyKey,
      unknown
    >;
    assert.equal(objects.getOwnProperty(ctor, "length")!.value, 2);
    assert.ok(objects.getOwnProperty(ctor, "from"));
    const prototype = objects.getOwnProperty(ctor, "prototype")!
      .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
    for (const field of name === "PlainYearMonth"
      ? ["year", "month", "daysInMonth", "inLeapYear"]
      : ["day", "monthCode", "calendarId"])
      assert.ok(objects.getOwnProperty(prototype, field), field);
    for (const field of name === "PlainYearMonth"
      ? ["day", "dayOfWeek"]
      : ["year", "month", "daysInMonth"])
      assert.equal(objects.getOwnProperty(prototype, field), undefined, field);
    assert.ok(objects.getOwnProperty(prototype, "toJSON"));
  }
});

test("partial-date equality and year-month comparison have intrinsic method contracts", () => {
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
  const temporal = objects.getOwnProperty(root, "Temporal")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  for (const name of ["PlainYearMonth", "PlainMonthDay"]) {
    const constructor = objects.getOwnProperty(temporal, name)!
      .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
    const prototype = objects.getOwnProperty(constructor, "prototype")!
      .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
    const targets = [
      { object: prototype, name: "equals", length: 1 },
      { object: prototype, name: "toPlainDate", length: 1 },
    ];
    if (name === "PlainYearMonth")
      targets.push({ object: constructor, name: "compare", length: 2 });
    else
      assert.equal(objects.getOwnProperty(constructor, "compare"), undefined);
    for (const target of targets) {
      const descriptor = objects.getOwnProperty(target.object, target.name);
      assert.ok(descriptor, name + "." + target.name);
      assert.equal(descriptor.enumerable, false);
      assert.equal(descriptor.writable, true);
      assert.equal(descriptor.configurable, true);
      const fn = descriptor.value as objects.OrdinaryObject<
        objects.ScriptPropertyKey,
        unknown
      >;
      assert.equal(objects.getOwnProperty(fn, "length")!.value, target.length);
      assert.equal(objects.getOwnProperty(fn, "name")!.value, target.name);
      assert.equal(fn.internalConstruct, undefined);
    }
  }
});
