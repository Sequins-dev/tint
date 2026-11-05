import assert from "node:assert/strict";
import test from "node:test";
import { parseISODateTime } from "@tint/foundation/chrono/iso-date-time";
import * as differences from "../src/objects/temporal-date-time-difference.ts";
import { createErrorRealm } from "../src/objects/errors.ts";
import { createObject, type ObjectHooks } from "../src/objects/operations.ts";
import type { ScriptPropertyKey } from "../src/objects/symbols.ts";
import type { TemporalDifferenceSettings } from "../src/objects/temporal-time-difference.ts";
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => undefined,
};
const realm = createErrorRealm(
  createObject<ScriptPropertyKey, unknown>(undefined),
  hooks,
);
function date(text: string) {
  const parsed = parseISODateTime(text);
  assert.equal(parsed.error, "none");
  assert.ok(parsed.value);
  return parsed.value;
}
const settings: TemporalDifferenceSettings = {
  largestUnit: "day",
  smallestUnit: "nanosecond",
  increment: 1,
  mode: "trunc",
};
test("date-time differences borrow a calendar day before balancing the clock", () => {
  const a = date("2021-01-31T23:00"),
    b = date("2021-03-01T01:00");
  const d = differences.plainDateTimeDifference(
    a,
    b,
    { ...settings, largestUnit: "month" },
    false,
    realm,
  );
  assert.deepEqual([d.months, d.days, d.hours], [0, 28, 2]);
  const r = differences.plainDateTimeDifference(
    b,
    a,
    { ...settings, largestUnit: "month" },
    false,
    realm,
  );
  assert.deepEqual([r.months, r.days, r.hours], [-1, 0, -2]);
});
test("date-time clock differences preserve subnanosecond boundaries beyond Instant limits", () => {
  const a = date("+275760-09-13T23:00:00"),
    b = date("+275760-09-13T23:00:00.000000001");
  assert.equal(
    differences.plainDateTimeDifference(a, b, settings, false, realm)
      .nanoseconds,
    1,
  );
  const d = differences.plainDateTimeDifference(
    date("2020-01-01T23:00"),
    date("2020-01-03T01:00"),
    { ...settings, smallestUnit: "hour", mode: "ceil", increment: 3 },
    false,
    realm,
  );
  assert.deepEqual([d.days, d.hours], [1, 3]);
});

test("civil day rounding returns durations without constructing out-of-range dates", () => {
  const d = differences.plainDateTimeDifference(
    date("2000-05-02T00:00"),
    date("2000-05-07T00:00"),
    { ...settings, smallestUnit: "day", increment: 1000000000, mode: "expand" },
    false,
    realm,
  );
  assert.equal(d.days, 1000000000);
});

test("calendar rounding includes the fractional clock at the boundary", () => {
  const a = date("2020-01-01T12:00"),
    b = date("2020-07-02T12:00:00.000000001");
  const d = differences.plainDateTimeDifference(
    a,
    b,
    {
      ...settings,
      largestUnit: "year",
      smallestUnit: "year",
      mode: "halfEven",
    },
    false,
    realm,
  );
  assert.equal(d.years, 1);
  const r = differences.plainDateTimeDifference(
    a,
    b,
    { ...settings, largestUnit: "year", smallestUnit: "year", mode: "ceil" },
    true,
    realm,
  );
  assert.equal(r.years, 0);
});

test("rounded clock carries bubble into calendar boundaries", () => {
  const d = differences.plainDateTimeDifference(
    date("1970-01-01T00:00"),
    date("1971-12-31T23:59:59.999999999"),
    {
      ...settings,
      largestUnit: "year",
      smallestUnit: "microsecond",
      mode: "expand",
    },
    false,
    realm,
  );
  assert.deepEqual(
    [d.years, d.months, d.days, d.hours, d.microseconds, d.nanoseconds],
    [2, 0, 0, 0, 0, 0],
  );
  const m = differences.plainDateTimeDifference(
    date("2021-01-31T00:00"),
    date("2021-02-27T23:59:59.999999999"),
    {
      ...settings,
      largestUnit: "month",
      smallestUnit: "microsecond",
      mode: "expand",
    },
    false,
    realm,
  );
  assert.deepEqual([m.months, m.days, m.nanoseconds], [1, 0, 0]);
});

test("calendar prefixes retain fractional-day rounding and carry across a month boundary", () => {
  for (const [end, months, days] of [
    ["2020-02-15T12:00", 1, 15],
    ["2020-02-29T12:00", 2, 0],
  ] as const) {
    const result = differences.plainDateTimeDifference(
      date("2020-01-01T00:00"),
      date(end),
      {
        ...settings,
        largestUnit: "month",
        smallestUnit: "day",
        mode: "halfExpand",
      },
      false,
      realm,
    );
    assert.deepEqual(
      [result.months, result.days, result.hours],
      [months, days, 0],
    );
  }
});
