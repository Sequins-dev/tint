import assert from "node:assert/strict";
import test from "node:test";
import * as calendar from "../src/objects/calendar.ts";
import { gregorianFromEpochDay } from "@tint/foundation/chrono/gregorian-calendar";
import {
  createTemporalObjectFixture as fixture,
  type ObjectValue,
} from "./ordinary-object-temporal-fixture.ts";
test("Persian dates expose AP years and the thirty-three-year solar leap pattern", () => {
  for (const [iso, year, month, day] of [
    [{ year: 2024, month: 3, day: 20 }, 1403, 1, 1],
    [{ year: 2025, month: 3, day: 20 }, 1403, 12, 30],
    [{ year: 2025, month: 3, day: 21 }, 1404, 1, 1],
    [{ year: 622, month: 3, day: 21 }, 1, 1, 1],
    [{ year: 0, month: 3, day: 21 }, -621, 1, 1],
  ] as const)
    assert.deepEqual(calendar.calendarFieldsFromISO("persian", iso), {
      year,
      month,
      day,
      era: "ap",
      eraYear: year,
    });
  assert.equal(calendar.calendarDaysInYear("persian", 1403), 366);
  assert.equal(calendar.calendarDaysInYear("persian", 1404), 365);
});
test("Persian correction years move the leap day into the following year", () => {
  for (const year of [1502, 1601, 2030, 2059, 2987]) {
    assert.equal(calendar.calendarDaysInYear("persian", year), 365);
    assert.equal(calendar.calendarDaysInYear("persian", year + 1), 366);
  }
  assert.deepEqual(
    calendar.calendarDateFromFields(
      "persian",
      { year: 1503, month: 1, day: 1 },
      "date",
      "reject",
    ).value,
    { year: 2124, month: 3, day: 20 },
  );
});
test("Persian conversion roundtrips negative years, a solar cycle and both date-domain endpoints", () => {
  assert.equal(calendar.calendarAlgorithmsAvailable("persian"), true);
  for (let epoch = 18000; epoch < 31000; epoch += 13) {
    const iso = gregorianFromEpochDay(epoch)!;
    const f = calendar.calendarFieldsFromISO("persian", iso);
    assert.ok(f);
    assert.deepEqual(
      calendar.calendarDateFromFields(
        "persian",
        { year: f.year, month: f.month, day: f.day },
        "date",
        "reject",
      ).value,
      iso,
    );
  }
  for (const epoch of [-100000001, -719528, -492634, -492268, 0, 100000000]) {
    const iso = gregorianFromEpochDay(epoch)!;
    const f = calendar.calendarFieldsFromISO("persian", iso);
    assert.ok(f);
    assert.deepEqual(
      calendar.calendarDateFromFields(
        "persian",
        { year: f.year, month: f.month, day: f.day },
        "date",
        "reject",
      ).value,
      iso,
    );
  }
});
test("Persian field resolution regulates Esfand and canonical month-day references", () => {
  assert.equal(
    calendar.calendarDateFromFields(
      "persian",
      { year: 1404, monthCode: { month: 12, leap: false }, day: 30 },
      "date",
      "reject",
    ).error,
    "range",
  );
  assert.deepEqual(
    calendar.calendarDateFromFields(
      "persian",
      { era: "ap", eraYear: 1403, month: 12, day: 30 },
      "date",
      "reject",
    ).value,
    { year: 2025, month: 3, day: 20 },
  );
  assert.deepEqual(
    calendar.calendarDateFromFields(
      "persian",
      { monthCode: { month: 12, leap: false }, day: 30 },
      "month-day",
      "reject",
    ).value,
    { year: 1972, month: 3, day: 20 },
  );
});
test("Persian public arithmetic and Duration context use the actual Esfand length", () => {
  const f = fixture();
  for (const timeZone of [undefined, "UTC", "+00:00"]) {
    const relativeTo = f.bag({
        calendar: "persian",
        year: 1404,
        month: 12,
        day: 1,
        timeZone,
      }),
      d = f.construct("Duration", [0, 1]);
    assert.equal(f.call(d, "total", [f.bag({ unit: "day", relativeTo })]), 29);
    const rounded = f.call(d, "round", [
      f.bag({ smallestUnit: "day", largestUnit: "day", relativeTo }),
    ]) as ObjectValue;
    assert.equal(f.get(rounded, "days"), 29);
  }
  const d = f.from(
    "PlainDate",
    f.bag({ calendar: "persian", year: 1403, month: 12, day: 30 }),
  );
  assert.equal(f.get(d, "inLeapYear"), true);
  const added = f.call(d, "add", [f.bag({ years: 1 })]) as ObjectValue;
  assert.equal(f.get(added, "year"), 1404);
  assert.equal(f.get(added, "day"), 29);
  const ym = f.call(d, "toPlainYearMonth") as ObjectValue;
  assert.equal(f.get(ym, "daysInMonth"), 30);
});
