import assert from "node:assert/strict";
import test from "node:test";
import { plainDateDifference } from "../src/objects/temporal-date-difference.ts";
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
const settings: TemporalDifferenceSettings = {
  largestUnit: "month",
  smallestUnit: "day",
  increment: 1,
  mode: "trunc",
};
test("date since retains the receiver's month-end anchor", () => {
  const one = { year: 2021, month: 2, day: 28 },
    two = { year: 2021, month: 3, day: 31 };
  const until = plainDateDifference(one, two, settings, false, realm);
  const since = plainDateDifference(one, two, settings, true, realm);
  const reverse = plainDateDifference(two, one, settings, false, realm);
  assert.deepEqual([until.months, until.days], [1, 3]);
  assert.deepEqual([since.months, since.days], [-1, -3]);
  assert.deepEqual([reverse.months, reverse.days], [-1, 0]);
});
test("date rounding applies signed direction and checks candidate bounds", () => {
  const one = { year: 1970, month: 1, day: 1 },
    two = { year: 1970, month: 1, day: 11 };
  const weeks = {
    ...settings,
    largestUnit: "week",
    smallestUnit: "week",
    mode: "floor",
  } as const;
  assert.equal(plainDateDifference(one, two, weeks, true, realm).weeks, -2);
  assert.equal(
    plainDateDifference(one, two, { ...weeks, mode: "ceil" }, false, realm)
      .weeks,
    2,
  );
  assert.throws(() =>
    plainDateDifference(
      { year: 275760, month: 9, day: 12 },
      { year: 275760, month: 9, day: 13 },
      weeks,
      false,
      realm,
    ),
  );
  const zero = plainDateDifference(one, one, settings, true, realm);
  assert.equal(Object.is(zero.days, 0), true);
});

test("day increments retain calendar prefixes near the date limit", () => {
  const result = plainDateDifference(
    { year: -271821, month: 5, day: 19 },
    { year: -271821, month: 5, day: 18 },
    { ...settings, largestUnit: "year", increment: 2, mode: "expand" },
    false,
    realm,
  );
  assert.deepEqual([result.years, result.months, result.days], [0, 0, -2]);
  const crossed = plainDateDifference(
    { year: 2022, month: 1, day: 1 },
    { year: 2022, month: 1, day: 31 },
    { ...settings, largestUnit: "month", increment: 32, mode: "expand" },
    false,
    realm,
  );
  assert.deepEqual([crossed.months, crossed.days], [1, 0]);
});

test("calendar rounding compares receiver-relative month and year boundaries", () => {
  const january = { year: 2019, month: 1, day: 1 },
    february = { year: 2019, month: 2, day: 15 };
  const months = {
    ...settings,
    smallestUnit: "month",
    mode: "halfExpand",
  } as const;
  assert.equal(
    plainDateDifference(january, february, months, false, realm).months,
    2,
  );
  assert.equal(
    plainDateDifference(february, january, months, false, realm).months,
    -1,
  );
  const years = {
    ...settings,
    largestUnit: "year",
    smallestUnit: "year",
    mode: "halfEven",
  } as const;
  assert.equal(
    plainDateDifference(
      { year: 2020, month: 1, day: 1 },
      { year: 2020, month: 7, day: 2 },
      years,
      false,
      realm,
    ).years,
    0,
  );
  const crossed = plainDateDifference(
    { year: 2022, month: 1, day: 1 },
    { year: 2023, month: 12, day: 25 },
    { ...months, largestUnit: "year", mode: "expand" },
    false,
    realm,
  );
  assert.deepEqual([crossed.years, crossed.months], [2, 0]);
  assert.throws(() =>
    plainDateDifference(
      january,
      february,
      { ...months, increment: 100000000 },
      false,
      realm,
    ),
  );
});

test("zero rounded weeks preserve a nonzero calendar prefix", () => {
  const d = plainDateDifference(
    { year: 2020, month: 1, day: 1 },
    { year: 2021, month: 2, day: 3 },
    {
      ...settings,
      largestUnit: "year",
      smallestUnit: "week",
      mode: "halfExpand",
    },
    false,
    realm,
  );
  assert.deepEqual([d.years, d.months, d.weeks, d.days], [1, 1, 0, 0]);
});

test("calendar half ties preserve parity and signed rounding directions", () => {
  const modes = [
    "ceil",
    "floor",
    "expand",
    "trunc",
    "halfCeil",
    "halfFloor",
    "halfExpand",
    "halfTrunc",
    "halfEven",
  ] as const;
  const positive = [2, 1, 2, 1, 2, 1, 2, 1, 2],
    negative = [-1, -2, -2, -1, -1, -2, -2, -1, -2];
  for (const [index, mode] of modes.entries()) {
    const options = { ...settings, smallestUnit: "month", mode };
    const one = { year: 2019, month: 1, day: 1 },
      two = { year: 2019, month: 2, day: 15 };
    assert.equal(
      plainDateDifference(one, two, options, false, realm).months,
      positive[index],
      mode,
    );
    assert.equal(
      plainDateDifference(one, two, options, true, realm).months,
      negative[index],
      mode,
    );
  }
  const even = plainDateDifference(
    { year: 2018, month: 12, day: 1 },
    { year: 2019, month: 2, day: 15 },
    { ...settings, smallestUnit: "month", mode: "halfEven" },
    false,
    realm,
  );
  assert.equal(even.months, 2);
});

test("uniform day rounding can produce a duration beyond date endpoints", () => {
  const d = plainDateDifference(
    { year: 2000, month: 5, day: 2 },
    { year: 2000, month: 5, day: 7 },
    { ...settings, largestUnit: "day", increment: 1000000000, mode: "expand" },
    false,
    realm,
  );
  assert.equal(d.days, 1000000000);
});
