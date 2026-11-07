import assert from "node:assert/strict";
import test from "node:test";
import {
  epochDayFromGregorian,
  gregorianFromEpochDay,
} from "@tint/foundation/chrono/gregorian-calendar";
import type { GregorianDate } from "@tint/foundation/chrono/gregorian-calendar";
import * as calendar from "../src/objects/calendar.ts";
const families = [
  ["coptic", 1740, "am", 1740],
  ["ethiopic", 2016, "am", 2016],
  ["ethioaa", 7516, "aa", 7516],
] as const;
const good = (year: number, month: number, day: number) => ({
  value: { year, month, day },
  error: "none",
});
test("Coptic and Ethiopic calendars share a 13-month date reckoning with distinct year epochs", () => {
  for (const [id, year, era, eraYear] of families)
    assert.deepEqual(
      calendar.calendarFieldsFromISO(id, { year: 2023, month: 9, day: 12 }),
      { year, month: 1, day: 1, era, eraYear },
    );
  assert.deepEqual(
    calendar.calendarFieldsFromISO("coptic", { year: 284, month: 8, day: 29 }),
    { year: 1, month: 1, day: 1, era: "am", eraYear: 1 },
  );
  assert.deepEqual(
    calendar.calendarFieldsFromISO("ethiopic", { year: 8, month: 8, day: 27 }),
    { year: 1, month: 1, day: 1, era: "am", eraYear: 1 },
  );
});
test("epagomenal leap days use the fourth year and retain correct lengths at year zero", () => {
  assert.equal(typeof calendar.calendarDaysInMonth, "function");
  for (const [id, year] of families) {
    assert.equal(calendar.calendarMonthsInYear(id, year), 13);
    assert.equal(calendar.calendarDaysInMonth(id, year - 1, 13), 6);
    assert.equal(calendar.calendarDaysInMonth(id, year, 13), 5);
    assert.equal(calendar.calendarDaysInYear(id, year - 1), 366);
    assert.equal(
      calendar.calendarDayOfYear(id, { year: 2023, month: 9, day: 11 }),
      366,
    );
  }
  assert.equal(calendar.calendarDaysInMonth("coptic", -1, 13), 6);
  assert.equal(calendar.calendarDaysInMonth("coptic", 0, 13), 5);
});
test("calendar field conversion constrains epagomenal days and rejects leap month codes", () => {
  for (const [id, year] of families) {
    assert.deepEqual(
      calendar.calendarDateFromFields(
        id,
        { year: year - 1, monthCode: { month: 13, leap: false }, day: 6 },
        "date",
        "reject",
      ),
      good(2023, 9, 11),
    );
    assert.deepEqual(
      calendar.calendarDateFromFields(
        id,
        { year, month: 13, day: 6 },
        "date",
        "constrain",
      ),
      good(2024, 9, 10),
    );
    assert.equal(
      calendar.calendarDateFromFields(
        id,
        { year, month: 13, day: 6 },
        "date",
        "reject",
      ).error,
      "range",
    );
    assert.equal(
      calendar.calendarDateFromFields(
        id,
        { year, monthCode: { month: 13, leap: true }, day: 1 },
        "date",
        "constrain",
      ).error,
      "range",
    );
  }
});
test("nonpositive Ethiopic era years preserve arithmetic-year and canonical-era distinctions", () => {
  for (const [era, eraYear, year, resultEra, resultEraYear] of [
    ["am", 0, 0, "aa", 5500],
    ["am", -1, -1, "aa", 5499],
    ["aa", 0, -5500, "aa", 0],
    ["aa", -1, -5501, "aa", -1],
  ] as const) {
    const result = calendar.calendarDateFromFields(
      "ethiopic",
      { era, eraYear, month: 1, day: 1 },
      "date",
      "reject",
    );
    assert.equal(result.error, "none");
    assert.ok(result.value);
    const fields = calendar.calendarFieldsFromISO("ethiopic", result.value);
    assert.equal(fields?.year, year);
    assert.equal(fields?.era, resultEra);
    assert.equal(fields?.eraYear, resultEraYear);
  }
});
test("month-day reference dates use the latest matching ISO date before 1973, including epagomenal leap days", () => {
  for (const [id, year] of families) {
    assert.deepEqual(
      calendar.calendarDateFromFields(
        id,
        { monthCode: { month: 13, leap: false }, day: 6 },
        "month-day",
        "reject",
      ),
      good(1971, 9, 11),
    );
    assert.deepEqual(
      calendar.calendarDateFromFields(
        id,
        { monthCode: { month: 13, leap: false }, day: 5 },
        "month-day",
        "reject",
      ),
      good(1972, 9, 10),
    );
    assert.deepEqual(
      calendar.calendarDateFromFields(
        id,
        { year, month: 13, day: 6 },
        "month-day",
        "constrain",
      ),
      good(1972, 9, 10),
    );
  }
});
test("13-month arithmetic balances years and months before constraining the day", () => {
  assert.equal(typeof calendar.calendarDateAdd, "function");
  for (const [id] of families) {
    const one = { year: 2023, month: 9, day: 11 };
    assert.deepEqual(
      calendar.calendarDateAdd(id, one, 0, 1, 0, 0, "constrain"),
      { year: 2023, month: 9, day: 17 },
    );
    assert.deepEqual(
      calendar.calendarDateAdd(id, one, 1, 0, 0, 0, "constrain"),
      { year: 2024, month: 9, day: 10 },
    );
    assert.equal(
      calendar.calendarDateAdd(id, one, 1, 0, 0, 0, "reject"),
      undefined,
    );
    assert.deepEqual(calendar.calendarDateAdd(id, one, 1, 1, 0, 0, "reject"), {
      year: 2024,
      month: 9,
      day: 16,
    });
  }
});
test("calendar differences count thirteen months per year and exact epoch days", () => {
  assert.equal(typeof calendar.calendarDateUntil, "function");
  const one = { year: 2022, month: 9, day: 11 },
    two = { year: 2023, month: 9, day: 12 };
  for (const [id] of families) {
    assert.deepEqual(calendar.calendarDateUntil(id, one, two, "year"), {
      years: 1,
      months: 0,
      weeks: 0,
      days: 0,
    });
    assert.deepEqual(calendar.calendarDateUntil(id, one, two, "month"), {
      years: 0,
      months: 13,
      weeks: 0,
      days: 0,
    });
    assert.deepEqual(calendar.calendarDateUntil(id, one, two, "day"), {
      years: 0,
      months: 0,
      weeks: 0,
      days: 366,
    });
  }
});
test("Coptic-family conversion roundtrips an entire leap cycle and both Temporal date limits", () => {
  const first = epochDayFromGregorian(2022, 9, 11);
  assert.notEqual(first, undefined);
  for (const [id] of families) {
    for (let day = first!; day < first! + 1461; day++) {
      const iso = gregorianFromEpochDay(day);
      assert.ok(iso);
      const fields = calendar.calendarFieldsFromISO(id, iso);
      assert.ok(fields);
      assert.deepEqual(
        calendar.calendarDateFromFields(
          id,
          { year: fields.year, month: fields.month, day: fields.day },
          "date",
          "reject",
        ),
        { value: iso, error: "none" },
      );
    }
    for (const day of [-100000001, -100000000, -1, 0, 1, 100000000]) {
      const iso = gregorianFromEpochDay(day);
      assert.ok(iso);
      const fields = calendar.calendarFieldsFromISO(id, iso);
      assert.ok(fields);
      assert.deepEqual(
        calendar.calendarDateFromFields(
          id,
          { year: fields.year, month: fields.month, day: fields.day },
          "date",
          "reject",
        ),
        { value: iso, error: "none" },
      );
    }
  }
});
test("calendar differences across the full date domain reconstruct endpoints without a year walk", () => {
  const lo = gregorianFromEpochDay(-100000001),
    hi = gregorianFromEpochDay(100000000);
  assert.ok(lo);
  assert.ok(hi);
  const endpoints: readonly (readonly [GregorianDate, GregorianDate])[] = [
    [lo, hi],
    [hi, lo],
  ];
  for (const [id] of families)
    for (const pair of endpoints) {
      const one: GregorianDate = pair[0],
        two: GregorianDate = pair[1];
      assert.ok(one);
      assert.ok(two);
      const difference = calendar.calendarDateUntil(id, one, two, "year");
      assert.ok(difference);
      assert.deepEqual(
        calendar.calendarDateAdd(
          id,
          one,
          difference.years,
          difference.months,
          difference.weeks,
          difference.days,
          "constrain",
        ),
        two,
      );
    }
  for (const [id] of families) {
    assert.equal(
      calendar.calendarDateFromFields(
        id,
        { year: 1e100, month: 1, day: 1 },
        "date",
        "constrain",
      ).error,
      "range",
    );
    assert.equal(
      calendar.calendarDateAdd(id, hi, 0, 1e10, 0, 0, "constrain"),
      undefined,
    );
  }
});
