import assert from "node:assert/strict";
import { test } from "node:test";
import * as calendar from "../src/chrono/gregorian-calendar/index.ts";

test("Gregorian conversion covers a complete 400-year leap cycle", () => {
  for (let epochDay = -25567; epochDay < -25567 + 146097; epochDay++) {
    const reference = new Date(epochDay * 86400000);
    const expected = {
      year: reference.getUTCFullYear(),
      month: reference.getUTCMonth() + 1,
      day: reference.getUTCDate(),
    };
    assert.deepEqual(calendar.gregorianFromEpochDay(epochDay), expected);
    assert.equal(
      calendar.epochDayFromGregorian(
        expected.year,
        expected.month,
        expected.day,
      ),
      epochDay,
    );
  }
});

test("Gregorian conversion covers negative years, epoch and Date limits", () => {
  for (const epochDay of [
    -100000000, -99999999, -719529, -719528, -719527, -1, 0, 1, 11016,
    100000000,
  ]) {
    const reference = new Date(epochDay * 86400000);
    const expected = {
      year: reference.getUTCFullYear(),
      month: reference.getUTCMonth() + 1,
      day: reference.getUTCDate(),
    };
    assert.deepEqual(calendar.gregorianFromEpochDay(epochDay), expected);
    assert.equal(
      calendar.epochDayFromGregorian(
        expected.year,
        expected.month,
        expected.day,
      ),
      epochDay,
    );
  }
  for (const epochDay of [-100000001, 100000001]) {
    const date = calendar.gregorianFromEpochDay(epochDay)!;
    assert.equal(
      calendar.epochDayFromGregorian(date.year, date.month, date.day),
      epochDay,
    );
  }
});

test("Gregorian helpers reject invalid dates without normalizing them", () => {
  for (const year of [-400, 0, 1600, 2000])
    assert.equal(calendar.daysInGregorianMonth(year, 2), 29);
  for (const year of [-100, 1900, 2001, 2100])
    assert.equal(calendar.daysInGregorianMonth(year, 2), 28);
  for (const [year, month, day] of [
    [1900, 2, 29],
    [2000, 2, 30],
    [2024, 0, 1],
    [2024, 13, 1],
    [2024, 1, 0],
    [2024, 1, 1.5],
    [NaN, 1, 1],
    [Infinity, 1, 1],
    [300000, 1, 1],
  ])
    assert.equal(
      calendar.epochDayFromGregorian(year!, month!, day!),
      undefined,
    );
  for (const day of [NaN, Infinity, -Infinity, 0.5, -100000002, 100000002])
    assert.equal(calendar.gregorianFromEpochDay(day), undefined);
});

test("ISO week dates agree across a Gregorian 400-year cycle", () => {
  assert.equal(typeof calendar.isoWeekFromEpochDay, "function");
  for (let day = 0; day < 146097; day++) {
    const date = new Date(day * 86400000);
    const weekday = ((date.getUTCDay() + 6) % 7) + 1;
    date.setUTCDate(date.getUTCDate() + 4 - weekday);
    const year = date.getUTCFullYear();
    const first = new Date(0);
    first.setUTCFullYear(year, 0, 1);
    first.setUTCHours(0, 0, 0, 0);
    const week = Math.ceil(
      ((date.getTime() - first.getTime()) / 86400000 + 1) / 7,
    );
    assert.deepEqual(calendar.isoWeekFromEpochDay(day), {
      year,
      week,
      weekday,
    });
  }
});

test("ISO week years handle boundaries, negative years and the calendar limits", () => {
  for (const [year, month, day, weekYear, week] of [
    [2016, 1, 1, 2015, 53],
    [2021, 1, 1, 2020, 53],
    [2019, 12, 30, 2020, 1],
    [2000, 1, 1, 1999, 52],
  ]) {
    const epoch = calendar.epochDayFromGregorian(year!, month!, day!)!;
    const value = calendar.isoWeekFromEpochDay(epoch)!;
    assert.equal(value.year, weekYear);
    assert.equal(value.week, week);
  }
  for (const day of [
    -100000001, -100000000, -719528, -1, 0, 100000000, 100000001,
  ]) {
    const shifted = day < 0 ? day + 146097 : day - 146097;
    const a = calendar.isoWeekFromEpochDay(day)!,
      b = calendar.isoWeekFromEpochDay(shifted)!;
    assert.equal(a.week, b.week);
    assert.equal(a.weekday, b.weekday);
    assert.equal(a.year - b.year, day < 0 ? -400 : 400);
  }
  for (const value of [NaN, Infinity, -Infinity, 0.5, 100000002, -100000002])
    assert.equal(calendar.isoWeekFromEpochDay(value), undefined);
});
