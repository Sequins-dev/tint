import assert from "node:assert/strict";
import test from "node:test";
import * as calendar from "../src/chrono/gregorian-calendar/index.ts";
test("unclipped Gregorian coordinates invert the reference dates needed by calendar conversions", () => {
  const inverse = (
    calendar as unknown as {
      epochDayFromGregorianCoordinate: (
        year: number,
        month: number,
        day: number,
      ) => number | undefined;
    }
  ).epochDayFromGregorianCoordinate;
  assert.equal(typeof inverse, "function");
  assert.equal(inverse(1970, 1, 1), 0);
  assert.equal(inverse(0, 1, 1), -719528);
  assert.equal(inverse(-271821, 4, 1), -100000019);
  assert.equal(inverse(275760, 9, 30), 100000017);
  for (const date of [
    { year: -1000000000, month: 2, day: 28 },
    { year: 1000000000, month: 12, day: 31 },
    { year: 0, month: 2, day: 29 },
  ]) {
    const day = inverse(date.year, date.month, date.day);
    assert.notEqual(day, undefined);
    assert.deepEqual(calendar.gregorianCoordinateFromEpochDay(day!), date);
  }
  for (const [year, month, day] of [
    [2023, 2, 29],
    [2024, 13, 1],
    [2024, 1, 0],
    [Infinity, 1, 1],
    [Number.MAX_SAFE_INTEGER, 12, 31],
  ])
    assert.equal(inverse(year!, month!, day!), undefined);
  assert.equal(calendar.epochDayFromGregorian(-271821, 4, 1), undefined);
  assert.equal(calendar.epochDayFromGregorian(275760, 9, 30), undefined);
});
