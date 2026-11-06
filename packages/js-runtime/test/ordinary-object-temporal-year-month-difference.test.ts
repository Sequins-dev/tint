import assert from "node:assert/strict";
import test from "node:test";
import * as differences from "../src/objects/temporal-date-difference.ts";
import {
  normalizeTemporalDifferenceSettings,
  type TemporalDifferenceSettings,
} from "../src/objects/temporal-time-difference.ts";
import { createErrorRealm } from "../src/objects/errors.ts";
import { createObject, type ObjectHooks } from "../src/objects/operations.ts";
import type { ScriptPropertyKey } from "../src/objects/symbols.ts";
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => undefined,
};
const realm = createErrorRealm(
  createObject<ScriptPropertyKey, unknown>(undefined),
  hooks,
);
const settings: TemporalDifferenceSettings = {
  largestUnit: "year",
  smallestUnit: "month",
  increment: 1,
  mode: "trunc",
};
test("YearMonth differences ignore reference days after full-date equality", () => {
  assert.equal(typeof differences.plainYearMonthDifference, "function");
  const one = { year: 2020, month: 1, day: 31 },
    two = { year: 2021, month: 3, day: 5 };
  for (const since of [false, true]) {
    const value = differences.plainYearMonthDifference(
        one,
        two,
        settings,
        since,
        realm,
      ),
      sign = since ? -1 : 1;
    assert.deepEqual(
      [value.years, value.months, value.days],
      [sign, sign * 2, 0],
    );
  }
  const lo = { year: -271821, month: 4, day: 30 };
  assert.equal(
    differences.plainYearMonthDifference(lo, lo, settings, false, realm).years,
    0,
  );
  assert.throws(() =>
    differences.plainYearMonthDifference(
      lo,
      { ...lo, day: 1 },
      settings,
      false,
      realm,
    ),
  );
  const hi = { year: 275760, month: 9, day: 30 };
  assert.equal(
    differences.plainYearMonthDifference(
      { ...hi, month: 8 },
      hi,
      settings,
      false,
      realm,
    ).months,
    1,
  );
});
test("YearMonth rounding uses exact day distances and signed rounding directions", () => {
  assert.equal(typeof differences.plainYearMonthDifference, "function");
  const one = { year: 2020, month: 1, day: 31 },
    two = { year: 2021, month: 7, day: 15 };
  const rounded = {
    ...settings,
    smallestUnit: "year",
    mode: "halfExpand",
  } as const;
  assert.equal(
    differences.plainYearMonthDifference(one, two, rounded, false, realm).years,
    1,
  );
  assert.equal(
    differences.plainYearMonthDifference(
      one,
      two,
      { ...rounded, mode: "ceil" },
      false,
      realm,
    ).years,
    2,
  );
  assert.equal(
    differences.plainYearMonthDifference(
      one,
      two,
      { ...rounded, mode: "floor" },
      true,
      realm,
    ).years,
    -2,
  );
  assert.equal(
    differences.plainYearMonthDifference(
      one,
      two,
      { ...settings, largestUnit: "month", increment: 5 },
      false,
      realm,
    ).months,
    15,
  );
});
test("YearMonth difference options admit only years and months", () => {
  assert.deepEqual(
    normalizeTemporalDifferenceSettings(
      "auto",
      "months",
      "year",
      "year-month",
      1,
      "trunc",
      realm,
    ),
    settings,
  );
  for (const unit of [
    "week",
    "day",
    "hour",
    "minute",
    "second",
    "millisecond",
    "microsecond",
    "nanosecond",
  ]) {
    assert.throws(() =>
      normalizeTemporalDifferenceSettings(
        "auto",
        unit,
        "year",
        "year-month",
        1,
        "trunc",
        realm,
      ),
    );
    assert.throws(() =>
      normalizeTemporalDifferenceSettings(
        unit,
        "month",
        "year",
        "year-month",
        1,
        "trunc",
        realm,
      ),
    );
  }
});
