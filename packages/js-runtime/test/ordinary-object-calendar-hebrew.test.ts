import assert from "node:assert/strict";
import test from "node:test";
import * as calendar from "../src/objects/calendar.ts";
import { gregorianFromEpochDay } from "@tint/foundation/chrono/gregorian-calendar";
import {
  createTemporalObjectFixture as fixture,
  objects,
  type ObjectValue,
} from "./ordinary-object-temporal-fixture.ts";
test("Hebrew dates expose variable year lengths and the inserted Adar ordinal", () => {
  for (const [iso, year, month, day] of [
    [{ year: 2023, month: 9, day: 16 }, 5784, 1, 1],
    [{ year: 2024, month: 2, day: 10 }, 5784, 6, 1],
    [{ year: 2024, month: 3, day: 11 }, 5784, 7, 1],
    [{ year: 2024, month: 4, day: 9 }, 5784, 8, 1],
  ] as const)
    assert.deepEqual(calendar.calendarFieldsFromISO("hebrew", iso), {
      year,
      month,
      day,
      era: "am",
      eraYear: year,
    });
  assert.equal(calendar.calendarMonthsInYear("hebrew", 5783), 12);
  assert.equal(calendar.calendarMonthsInYear("hebrew", 5784), 13);
  assert.equal(calendar.calendarDaysInYear("hebrew", 5783), 355);
  assert.equal(calendar.calendarDaysInYear("hebrew", 5784), 383);
  assert.equal(calendar.calendarDaysInMonth("hebrew", 5783, 2), 30);
  assert.equal(calendar.calendarDaysInMonth("hebrew", 5784, 2), 29);
  assert.equal(calendar.calendarDaysInMonth("hebrew", 5784, 3), 29);
});
test("Hebrew month-code resolution preserves M05L and constrains it to M06 in common years", () => {
  assert.deepEqual(
    calendar.calendarDateFromFields(
      "hebrew",
      { year: 5784, monthCode: { month: 5, leap: true }, day: 1 },
      "date",
      "reject",
    ).value,
    { year: 2024, month: 2, day: 10 },
  );
  assert.equal(
    calendar.calendarDateFromFields(
      "hebrew",
      { year: 5783, monthCode: { month: 5, leap: true }, day: 1 },
      "date",
      "reject",
    ).error,
    "range",
  );
  assert.deepEqual(
    calendar.calendarDateFromFields(
      "hebrew",
      { year: 5783, monthCode: { month: 5, leap: true }, day: 30 },
      "date",
      "constrain",
    ).value,
    { year: 2023, month: 3, day: 22 },
  );
  for (const monthCode of [
    { month: 4, leap: true },
    { month: 13, leap: false },
  ])
    assert.equal(
      calendar.calendarDateFromFields(
        "hebrew",
        { year: 5784, monthCode, day: 1 },
        "date",
        "constrain",
      ).error,
      "range",
    );
});
test("Hebrew month-day references retain the leap code and distinguish rare thirty-day months", () => {
  for (const [monthCode, day, referenceYear] of [
    [{ month: 5, leap: true }, 30, 1970],
    [{ month: 2, leap: false }, 30, 1971],
    [{ month: 3, leap: false }, 30, 1971],
    [{ month: 6, leap: false }, 29, 1972],
  ] as const) {
    const d = calendar.calendarDateFromFields(
      "hebrew",
      { monthCode, day },
      "month-day",
      "reject",
    );
    assert.equal(d.value?.year, referenceYear);
    assert.ok(d.value);
    assert.equal(calendar.calendarFieldsFromISO("hebrew", d.value)?.day, day);
  }
});
test("Hebrew date conversion roundtrips a Metonic cycle and both supported date limits", () => {
  assert.equal(calendar.calendarAlgorithmsAvailable("hebrew"), true);
  for (let epoch = 17897; epoch < 24837; epoch += 3) {
    const iso = gregorianFromEpochDay(epoch)!;
    const f = calendar.calendarFieldsFromISO("hebrew", iso);
    assert.ok(f);
    assert.deepEqual(
      calendar.calendarDateFromFields(
        "hebrew",
        { year: f.year, month: f.month, day: f.day },
        "date",
        "reject",
      ).value,
      iso,
    );
  }
  for (const epoch of [-100000001, -2092590, 0, 100000000]) {
    const iso = gregorianFromEpochDay(epoch)!;
    const f = calendar.calendarFieldsFromISO("hebrew", iso);
    assert.ok(f);
    assert.deepEqual(
      calendar.calendarDateFromFields(
        "hebrew",
        { year: f.year, month: f.month, day: f.day },
        "date",
        "reject",
      ).value,
      iso,
    );
  }
});
test("Hebrew public arithmetic retains stable month codes when ordinal positions change", () => {
  const f = fixture();
  const d = f.from(
    "PlainDate",
    f.bag({ calendar: "hebrew", year: 5784, monthCode: "M05L", day: 30 }),
  );
  assert.equal(f.get(d, "month"), 6);
  assert.equal(f.get(d, "monthCode"), "M05L");
  const common = f.call(d, "add", [f.bag({ years: 1 })]) as ObjectValue;
  assert.equal(f.get(common, "monthCode"), "M06");
  assert.equal(f.get(common, "day"), 29);
  assert.throws(
    () =>
      f.call(d, "add", [f.bag({ years: 1 }), f.bag({ overflow: "reject" })]),
    (error) =>
      objects.viewObjectValue(error, f.root)?.prototype ===
      f.realm.prototypes.get("range"),
  );
  const nisan = f.from(
      "PlainDate",
      f.bag({ calendar: "hebrew", year: 5784, monthCode: "M07", day: 1 }),
    ),
    changed = f.call(nisan, "with", [f.bag({ year: 5783 })]) as ObjectValue;
  assert.equal(f.get(changed, "month"), 7);
  assert.equal(f.get(changed, "monthCode"), "M07");
});
test("Hebrew partial conversions preserve month codes across reference and supplied years", () => {
  const f = fixture(),
    d = f.from(
      "PlainDate",
      f.bag({ calendar: "hebrew", year: 5784, monthCode: "M08", day: 2 }),
    );
  const ym = f.call(d, "toPlainYearMonth") as ObjectValue,
    md = f.call(d, "toPlainMonthDay") as ObjectValue;
  assert.equal(f.get(ym, "monthCode"), "M08");
  assert.equal(f.get(md, "monthCode"), "M08");
  const p = f.call(md, "toPlainDate", [f.bag({ year: 5783 })]) as ObjectValue;
  assert.equal(f.get(p, "monthCode"), "M08");
  assert.equal(f.get(p, "month"), 8);
  assert.equal(f.get(p, "day"), 2);
});
test("Hebrew Duration context counts thirteen months and exact days in a leap year", () => {
  const f = fixture();
  for (const timeZone of [undefined, "UTC", "+00:00"]) {
    const relativeTo = f.bag({
        calendar: "hebrew",
        year: 5784,
        month: 1,
        day: 1,
        timeZone,
      }),
      d = f.construct("Duration", [1]);
    assert.equal(f.call(d, "total", [f.bag({ unit: "day", relativeTo })]), 383);
    assert.equal(
      f.call(d, "total", [f.bag({ unit: "month", relativeTo })]),
      13,
    );
    const rounded = f.call(f.construct("Duration", [0, 13]), "round", [
      f.bag({ largestUnit: "year", smallestUnit: "month", relativeTo }),
    ]) as ObjectValue;
    assert.equal(f.get(rounded, "years"), 1);
    assert.equal(f.get(rounded, "months"), 0);
  }
});

test("Hebrew addition balances the target year's month sequence and rejects a missing leap code", () => {
  const f = fixture(),
    common = f.from(
      "PlainDate",
      f.bag({ calendar: "hebrew", year: 5783, monthCode: "M08", day: 2 }),
    );
  const annual = f.call(common, "add", [f.bag({ years: 1 })]) as ObjectValue;
  assert.equal(f.get(annual, "monthCode"), "M08");
  assert.equal(f.get(annual, "month"), 9);
  const leap = f.from(
    "PlainDate",
    f.bag({ calendar: "hebrew", year: 5784, monthCode: "M05L", day: 1 }),
  );
  assert.throws(
    () =>
      f.call(leap, "add", [f.bag({ years: 1 }), f.bag({ overflow: "reject" })]),
    (error) =>
      objects.viewObjectValue(error, f.root)?.prototype ===
      f.realm.prototypes.get("range"),
  );
  const origin = f.from(
    "PlainDate",
    f.bag({ calendar: "hebrew", year: 5784, month: 1, day: 1 }),
  );
  const mixed = f.call(origin, "add", [
    f.bag({ years: 1, months: 13 }),
  ]) as ObjectValue;
  assert.equal(f.get(mixed, "year"), 5786);
  assert.equal(f.get(mixed, "month"), 2);
});

test("Hebrew calendar differences retain years before counting actual intervening leap months", () => {
  const f = fixture(),
    one = f.from(
      "PlainDate",
      f.bag({ calendar: "hebrew", year: 5783, monthCode: "M06", day: 1 }),
    ),
    two = f.from(
      "PlainDate",
      f.bag({ calendar: "hebrew", year: 5784, monthCode: "M05L", day: 1 }),
    );
  const forward = f.call(one, "until", [
    two,
    f.bag({ largestUnit: "year" }),
  ]) as ObjectValue;
  assert.equal(f.get(forward, "years"), 0);
  assert.equal(f.get(forward, "months"), 12);
  const backward = f.call(two, "until", [
    one,
    f.bag({ largestUnit: "year" }),
  ]) as ObjectValue;
  // CompareSurpasses checks the original M05L before constraining it to M06.
  assert.equal(f.get(backward, "years"), 0);
  assert.equal(f.get(backward, "months"), -12);
});

test("Hebrew conjunction boundary years and epoch years have valid month and year lengths", () => {
  for (const year of [-114911, -102335, -3839, 88370, 186866, 193151])
    assert.ok(
      [353, 354, 355, 383, 384, 385].includes(
        calendar.calendarDaysInYear("hebrew", year)!,
      ),
    );
  const cheshvan = [29, 30, 30, 29, 29, 30, 30, 29, 29, 30, 29],
    kislev = [30, 30, 30, 29, 30, 30, 30, 30, 29, 30, 30];
  for (let year = 0; year <= 10; year++) {
    assert.equal(
      calendar.calendarDaysInMonth("hebrew", year, 2),
      cheshvan[year],
    );
    assert.equal(calendar.calendarDaysInMonth("hebrew", year, 3), kislev[year]);
  }
});

test("Hebrew calendar differences reconstruct full-domain endpoints without walking years", () => {
  const f = fixture(),
    lo = f.construct("PlainDate", [-271821, 4, 19, "hebrew"]),
    hi = f.construct("PlainDate", [275760, 9, 13, "hebrew"]);
  for (const pair of [
    [lo, hi],
    [hi, lo],
  ] as const) {
    const one = pair[0],
      two = pair[1];
    const delta = f.call(one, "until", [
      two,
      f.bag({ largestUnit: "year" }),
    ]) as ObjectValue;
    const reconstructed = f.call(one, "add", [delta]) as ObjectValue;
    assert.equal(f.call(reconstructed, "equals", [two]), true);
  }
});

test("Hebrew differences distinguish calendar years from actual intervening month counts", () => {
  const f = fixture();
  for (const [aYear, aCode, bYear, bCode, years, months, totalMonths] of [
    [5783, "M05", 5784, "M05", 1, 0, 12],
    [5784, "M05", 5785, "M05", 1, 0, 13],
    [5783, "M06", 5784, "M06", 1, 0, 13],
    [5784, "M06", 5785, "M06", 1, 0, 12],
    [5783, "M05", 5784, "M05L", 1, 1, 13],
    [5784, "M05L", 5785, "M05", 0, 12, 12],
    [5783, "M06", 5784, "M05L", 0, 12, 12],
    [5784, "M05L", 5785, "M06", 1, 0, 13],
    [5785, "M05", 5784, "M05", -1, 0, -13],
    [5785, "M06", 5784, "M05L", -1, -1, -13],
  ] as const) {
    const a = f.from(
        "PlainDate",
        f.bag({ calendar: "hebrew", year: aYear, monthCode: aCode, day: 1 }),
      ),
      b = f.from(
        "PlainDate",
        f.bag({ calendar: "hebrew", year: bYear, monthCode: bCode, day: 1 }),
      );
    const y = f.call(a, "until", [
        b,
        f.bag({ largestUnit: "year" }),
      ]) as ObjectValue,
      m = f.call(a, "until", [
        b,
        f.bag({ largestUnit: "month" }),
      ]) as ObjectValue;
    assert.deepEqual(
      [f.get(y, "years"), f.get(y, "months"), f.get(y, "days")],
      [years, months, 0],
    );
    assert.equal(f.get(m, "months"), totalMonths);
  }
});

test("Hebrew YearMonth, date-time and zoned methods share month-code-aware arithmetic", () => {
  const f = fixture();
  for (const name of ["PlainYearMonth", "PlainDateTime", "ZonedDateTime"]) {
    const a = f.from(
        name,
        f.bag({
          calendar: "hebrew",
          year: 5783,
          monthCode: "M08",
          day: 2,
          hour: 12,
          timeZone: "UTC",
        }),
      ),
      b = f.call(a, "add", [f.bag({ years: 1 })]) as ObjectValue;
    assert.equal(f.get(b, "monthCode"), "M08");
    assert.equal(f.get(b, "month"), 9);
    assert.equal(f.get(b, "calendarId"), "hebrew");
    const delta = f.call(a, "until", [
      b,
      f.bag({ largestUnit: "year" }),
    ]) as ObjectValue;
    assert.equal(f.get(delta, "years"), 1);
    assert.equal(f.get(delta, "months"), 0);
  }
});
