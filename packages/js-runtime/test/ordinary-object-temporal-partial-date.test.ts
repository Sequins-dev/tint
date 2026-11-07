import assert from "node:assert/strict";
import test from "node:test";
import type {
  ObjectHooks,
  OrdinaryObject,
  ScriptPropertyKey,
} from "../src/objects/index.ts";
import {
  createTemporalObjectFixture,
  objects,
  type ObjectValue,
} from "./ordinary-object-temporal-fixture.ts";

test("Temporal partial dates expose only their calendar fields", () => {
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(root, hooks);
  objects.installTemporalIntrinsics(root, realm, hooks);
  const temporal = objects.getOwnProperty(root, "Temporal")!
    .value as OrdinaryObject<ScriptPropertyKey, unknown>;
  for (const name of ["PlainYearMonth", "PlainMonthDay"]) {
    const descriptor = objects.getOwnProperty(temporal, name);
    assert.ok(descriptor, name);
    const ctor = descriptor.value as OrdinaryObject<ScriptPropertyKey, unknown>;
    assert.equal(objects.getOwnProperty(ctor, "length")!.value, 2);
    assert.ok(objects.getOwnProperty(ctor, "from"));
    const prototype = objects.getOwnProperty(ctor, "prototype")!
      .value as OrdinaryObject<ScriptPropertyKey, unknown>;
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
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(root, hooks);
  objects.installTemporalIntrinsics(root, realm, hooks);
  const temporal = objects.getOwnProperty(root, "Temporal")!
    .value as OrdinaryObject<ScriptPropertyKey, unknown>;
  for (const name of ["PlainYearMonth", "PlainMonthDay"]) {
    const constructor = objects.getOwnProperty(temporal, name)!
      .value as OrdinaryObject<ScriptPropertyKey, unknown>;
    const prototype = objects.getOwnProperty(constructor, "prototype")!
      .value as OrdinaryObject<ScriptPropertyKey, unknown>;
    const targets = [
      { object: prototype, name: "equals", length: 1 },
      { object: prototype, name: "with", length: 1 },
      { object: prototype, name: "toPlainDate", length: 1 },
    ];
    if (name === "PlainYearMonth")
      targets.push(
        { object: constructor, name: "compare", length: 2 },
        { object: prototype, name: "add", length: 1 },
        { object: prototype, name: "subtract", length: 1 },
        { object: prototype, name: "until", length: 1 },
        { object: prototype, name: "since", length: 1 },
      );
    else
      assert.equal(objects.getOwnProperty(constructor, "compare"), undefined);
    for (const target of targets) {
      const descriptor = objects.getOwnProperty(target.object, target.name);
      assert.ok(descriptor, name + "." + target.name);
      assert.equal(descriptor.enumerable, false);
      assert.equal(descriptor.writable, true);
      assert.equal(descriptor.configurable, true);
      const fn = descriptor.value as OrdinaryObject<ScriptPropertyKey, unknown>;
      assert.equal(objects.getOwnProperty(fn, "length")!.value, target.length);
      assert.equal(objects.getOwnProperty(fn, "name")!.value, target.name);
      assert.equal(fn.internalConstruct, undefined);
    }
  }
});

for (const name of ["PlainYearMonth", "PlainMonthDay"]) {
  test(`${name}.toLocaleString owns a branded non-Intl method and ignores locale options`, () => {
    const f = createTemporalObjectFixture();
    const temporal = f.get(f.root, "Temporal") as ObjectValue;
    const constructor = f.get(temporal, name) as ObjectValue;
    const prototype = f.get(constructor, "prototype") as ObjectValue;
    const descriptor = objects.getOwnProperty(prototype, "toLocaleString");
    assert.ok(descriptor, "toLocaleString must be an own prototype method");
    assert.equal(descriptor.writable, true);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.configurable, true);
    const method = descriptor.value as ObjectValue;
    assert.equal(f.get(method, "name"), "toLocaleString");
    assert.equal(f.get(method, "length"), 0);
    assert.equal(method.internalConstruct, undefined);
    assert.ok(method.internalCall);
    const poison = objects.createExoticObject(f.root, {
      get() {
        throw new Error("locale options must not be read without Intl");
      },
    });
    const other = f.construct(
      name === "PlainYearMonth" ? "PlainMonthDay" : "PlainYearMonth",
      name === "PlainYearMonth" ? [2, 29] : [2024, 2],
    );
    for (const receiver of [
      undefined,
      null,
      true,
      "",
      1,
      objects.createSymbolValue("bad"),
      objects.createBigIntLiteral("1"),
      f.bag({}),
      constructor,
      prototype,
      other,
    ])
      assert.throws(
        () => method.internalCall!(receiver, [poison, poison]),
        (error: unknown) =>
          objects.viewObjectValue(error, f.root)?.prototype ===
          f.realm.prototypes.get("type"),
      );
    const value = f.construct(
      name,
      name === "PlainYearMonth" ? [2024, 2] : [2, 29],
    );
    const poisonedToString = objects.createCallableObject<
      ScriptPropertyKey,
      unknown
    >(f.realm.functionPrototype, () => {
      throw new Error("public toString must not be called");
    });
    assert.equal(
      objects.createDataProperty(value, "toString", poisonedToString, f.hooks),
      true,
    );
    assert.equal(
      method.internalCall(value, [poison, poison]),
      name === "PlainYearMonth" ? "2024-02" : "02-29",
    );
  });
}
