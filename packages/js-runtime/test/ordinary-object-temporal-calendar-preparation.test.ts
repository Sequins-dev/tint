import assert from "node:assert/strict";
import test from "node:test";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
import type { OrdinaryObject, ObjectHooks } from "../src/objects/operations.ts";
import type { ScriptPropertyKey } from "../src/objects/symbols.ts";
bindHostRecordViews();
const { createObject, createCallableObject, createDataProperty } =
  await import("../src/objects/operations.ts");
const { createErrorRealm } = await import("../src/objects/errors.ts");
const { builtinAccessor } = await import("../src/objects/intrinsics.ts");
const { callObject } = await import("../src/objects/call.ts");
const { readTemporalDateFields } =
  await import("../src/objects/temporal-date-fields.ts");
const { readTemporalRelativeTo } =
  await import("../src/objects/temporal-relative-to.ts");
const { plainDateFrom } =
  await import("../src/objects/temporal-plain-date-conversion.ts");
const { plainDateTimeFrom } =
  await import("../src/objects/temporal-date-time-conversion.ts");
const { partialDateFrom } =
  await import("../src/objects/temporal-partial-date-conversion.ts");
const { zonedDateTimeFrom } =
  await import("../src/objects/temporal-zoned-conversion.ts");
type ObjectValue = OrdinaryObject<ScriptPropertyKey, unknown>;
function fixture() {
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call(callee, receiver, args) {
      const result = callObject<ScriptPropertyKey, unknown>(
        callee as ObjectValue,
        receiver,
        args,
        undefined,
      );
      assert.equal(result.error, "none");
      return result.value;
    },
  };
  const root = createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = createErrorRealm(root, hooks);
  const object = () => createObject<ScriptPropertyKey, unknown>(root);
  const data = (target: ObjectValue, name: string, value: unknown) => {
    assert.equal(createDataProperty(target, name, value, hooks), true);
  };
  const getter = (target: ObjectValue, name: string, read: () => unknown) =>
    builtinAccessor(
      target,
      name,
      createCallableObject<ScriptPropertyKey, unknown>(
        realm.functionPrototype,
        () => read(),
      ),
      undefined,
      hooks,
    );
  return { realm, hooks, object, data, getter };
}
function caught(action: () => unknown): unknown {
  let threw = false,
    result: unknown;
  try {
    action();
  } catch (error) {
    threw = true;
    result = error;
  }
  assert.equal(threw, true);
  return result;
}
const conversions = [
  (f: ReturnType<typeof fixture>, bag: ObjectValue) =>
    readTemporalRelativeTo(bag, f.realm, f.hooks),
  (f: ReturnType<typeof fixture>, bag: ObjectValue) =>
    plainDateFrom(bag, undefined, f.realm, f.hooks),
  (f: ReturnType<typeof fixture>, bag: ObjectValue) =>
    plainDateTimeFrom(bag, undefined, f.realm, f.hooks),
  (f: ReturnType<typeof fixture>, bag: ObjectValue) =>
    partialDateFrom(bag, undefined, true, f.realm, f.hooks),
  (f: ReturnType<typeof fixture>, bag: ObjectValue) =>
    partialDateFrom(bag, undefined, false, f.realm, f.hooks),
  (f: ReturnType<typeof fixture>, bag: ObjectValue) =>
    zonedDateTimeFrom(bag, undefined, f.realm, f.hooks),
];
test("calendar-bearing conversions coerce eraYear before calendar arithmetic", () => {
  for (const convert of conversions)
    for (const calendar of ["gregory", "japanese"])
      for (const infinity of [Infinity, -Infinity]) {
        const f = fixture(),
          bag = f.object();
        for (const [name, value] of Object.entries({
          calendar,
          era: calendar === "gregory" ? "ad" : "reiwa",
          eraYear: infinity,
          month: 5,
          day: 2,
          timeZone: "UTC",
        }))
          f.data(bag, name, value);
        const error = caught(() => convert(f, bag));
        assert.equal(
          f.realm.unsupported,
          false,
          "field coercion precedes unavailable calendar arithmetic",
        );
        assert.equal(
          (error as ObjectValue).prototype,
          f.realm.prototypes.get("range"),
        );
      }
});
test("eraYear reads valueOf once and abrupt coercion suppresses later fields", () => {
  for (const convert of conversions) {
    const f = fixture(),
      bag = f.object(),
      value = f.object(),
      calls: string[] = [];
    f.data(bag, "calendar", "gregory");
    f.data(bag, "era", "ad");
    f.getter(bag, "eraYear", () => {
      calls.push("get eraYear");
      return value;
    });
    f.getter(value, "valueOf", () => {
      calls.push("get valueOf");
      return createCallableObject<ScriptPropertyKey, unknown>(
        f.realm.functionPrototype,
        () => {
          calls.push("call valueOf");
          return Infinity;
        },
      );
    });
    for (const name of ["hour", "month", "year"])
      f.getter(bag, name, () => {
        throw Error("later field " + name);
      });
    const error = caught(() => convert(f, bag));
    assert.equal(f.realm.unsupported, false);
    assert.equal(
      (error as ObjectValue).prototype,
      f.realm.prototypes.get("range"),
    );
    assert.deepEqual(calls, ["get eraYear", "get valueOf", "call valueOf"]);
  }
});
test("relative calendar fields are read in lexical order before interpretation", () => {
  const f = fixture(),
    bag = f.object(),
    calls: string[] = [],
    sentinel = {};
  f.getter(bag, "calendar", () => {
    calls.push("calendar");
    return "gregory";
  });
  const names = [
    "day",
    "era",
    "eraYear",
    "hour",
    "microsecond",
    "millisecond",
    "minute",
    "month",
    "monthCode",
    "nanosecond",
    "offset",
    "second",
    "timeZone",
    "year",
  ];
  const values: Record<string, unknown> = {
    day: 2,
    era: "ad",
    eraYear: 2020,
    month: 5,
  };
  for (const name of names)
    f.getter(bag, name, () => {
      calls.push(name);
      if (name === "year") throw sentinel;
      return values[name];
    });
  assert.equal(
    caught(() => readTemporalRelativeTo(bag, f.realm, f.hooks)),
    sentinel,
  );
  assert.equal(f.realm.unsupported, false);
  assert.deepEqual(calls, ["calendar", ...names]);
});
test("ISO preparation ignores era fields and keeps existing date conversion", () => {
  const f = fixture(),
    bag = f.object();
  for (const [name, value] of Object.entries({ year: 2020, month: 5, day: 2 }))
    f.data(bag, name, value);
  for (const name of ["era", "eraYear"])
    f.getter(bag, name, () => {
      throw Error("ISO era read");
    });
  assert.deepEqual(readTemporalRelativeTo(bag, f.realm, f.hooks), {
    kind: "plain",
    date: { year: 2020, month: 5, day: 2 },
  });
});

test("era fields use string coercion and truncate finite year values", () => {
  for (const calendar of ["gregory", "japanese"]) {
    const f = fixture(),
      bag = f.object(),
      era = f.object(),
      calls: string[] = [];
    f.data(
      era,
      "toString",
      createCallableObject<ScriptPropertyKey, unknown>(
        f.realm.functionPrototype,
        () => {
          calls.push("toString");
          return "ad";
        },
      ),
    );
    f.data(
      era,
      "valueOf",
      createCallableObject<ScriptPropertyKey, unknown>(
        f.realm.functionPrototype,
        () => {
          throw Error("wrong string hint");
        },
      ),
    );
    f.data(bag, "era", era);
    f.data(bag, "eraYear", -12.9);
    const fields = readTemporalDateFields(
      bag,
      bag,
      "date",
      f.realm,
      f.hooks,
      undefined,
      calendar,
    );
    assert.equal(fields.era, "ad");
    assert.equal(fields.eraYear, -12);
    assert.equal(fields.present, true);
    assert.deepEqual(calls, ["toString"]);
  }
});
test("date conversion reads overflow after all era fields and before calendar interpretation", () => {
  const f = fixture(),
    bag = f.object(),
    options = f.object(),
    sentinel = {},
    calls: string[] = [];
  for (const [name, value] of Object.entries({
    calendar: "gregory",
    era: "ad",
    eraYear: 2020,
    month: 5,
    day: 2,
  }))
    f.data(bag, name, value);
  f.getter(bag, "year", () => {
    calls.push("year");
    return undefined;
  });
  f.getter(options, "overflow", () => {
    calls.push("overflow");
    throw sentinel;
  });
  assert.equal(
    caught(() => plainDateFrom(bag, options, f.realm, f.hooks)),
    sentinel,
  );
  assert.deepEqual(calls, ["year", "overflow"]);
  assert.equal(f.realm.unsupported, false);
});
