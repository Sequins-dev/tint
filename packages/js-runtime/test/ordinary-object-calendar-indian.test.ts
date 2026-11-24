import assert from "node:assert/strict";
import test from "node:test";
import * as calendar from "../src/objects/calendar.ts";
import { gregorianFromEpochDay } from "@tint/foundation/chrono/gregorian-calendar";
import {
  createTemporalObjectFixture as fixture,
  type ObjectValue,
} from "./ordinary-object-temporal-fixture.ts";
import { exoticSlots } from "../src/objects/operations.ts";
test("Indian new year and Chaitra leap days follow the associated Gregorian year", () => {
  for (const [iso, expected] of [
    [{ year: 2023, month: 3, day: 21 }, [1944, 12, 30]],
    [{ year: 2023, month: 3, day: 22 }, [1945, 1, 1]],
    [{ year: 2024, month: 3, day: 21 }, [1946, 1, 1]],
    [{ year: 2024, month: 4, day: 20 }, [1946, 1, 31]],
    [{ year: 2024, month: 4, day: 21 }, [1946, 2, 1]],
  ] as const) {
    const fields = calendar.calendarFieldsFromISO("indian", iso);
    assert.deepEqual(fields, {
      year: expected[0],
      month: expected[1],
      day: expected[2],
      era: "shaka",
      eraYear: expected[0],
    });
  }
  assert.equal(calendar.calendarDaysInMonth("indian", 1822, 1), 30);
  assert.equal(calendar.calendarDaysInMonth("indian", 1922, 1), 31);
});
test("Indian field resolution retains signed Shaka years, month codes and range validation", () => {
  const d = calendar.calendarDateFromFields(
    "indian",
    {
      era: "shaka",
      eraYear: 1946,
      monthCode: { month: 1, leap: false },
      day: 31,
    },
    "date",
    "reject",
  );
  assert.deepEqual(d, {
    error: "none",
    value: { year: 2024, month: 4, day: 20 },
  });
  assert.equal(
    calendar.calendarDateFromFields(
      "indian",
      { year: 1945, month: 1, day: 31 },
      "date",
      "reject",
    ).error,
    "range",
  );
  assert.equal(
    calendar.calendarDateFromFields(
      "indian",
      { month: 1, day: 1 },
      "date",
      "constrain",
    ).error,
    "type",
  );
  for (const year of [-1, 0, 1]) {
    const r = calendar.calendarDateFromFields(
      "indian",
      { year, month: 1, day: 1 },
      "date",
      "reject",
    );
    assert.ok(r.value);
    assert.equal(
      calendar.calendarFieldsFromISO("indian", r.value)?.eraYear,
      year,
    );
  }
});
test("Indian conversions cover a Gregorian century cycle and the date-domain endpoints", () => {
  assert.equal(calendar.calendarAlgorithmsAvailable("indian"), true);
  for (let epoch = -25567; epoch < 14610; epoch += 17) {
    const iso = gregorianFromEpochDay(epoch)!;
    const f = calendar.calendarFieldsFromISO("indian", iso);
    assert.ok(f);
    assert.deepEqual(
      calendar.calendarDateFromFields(
        "indian",
        { year: f.year, month: f.month, day: f.day },
        "date",
        "reject",
      ).value,
      iso,
    );
  }
  for (const epoch of [-100000001, 100000000]) {
    const iso = gregorianFromEpochDay(epoch)!;
    const f = calendar.calendarFieldsFromISO("indian", iso);
    assert.ok(f);
    assert.deepEqual(
      calendar.calendarDateFromFields(
        "indian",
        { year: f.year, month: f.month, day: f.day },
        "date",
        "reject",
      ).value,
      iso,
    );
  }
});
test("Indian month-day references choose matching dates around the ISO year boundary", () => {
  for (const [month, day, iso] of [
    [1, 31, { year: 1972, month: 4, day: 20 }],
    [10, 11, { year: 1972, month: 1, day: 1 }],
    [12, 30, { year: 1972, month: 3, day: 20 }],
  ] as const)
    assert.deepEqual(
      calendar.calendarDateFromFields(
        "indian",
        { monthCode: { month, leap: false }, day },
        "month-day",
        "reject",
      ).value,
      iso,
    );
});
test("Indian public calendar operations preserve Shaka metadata and constrain final month days", () => {
  const f = fixture(),
    d = f.from(
      "PlainDate",
      f.bag({ calendar: "indian", year: 1946, month: 1, day: 31 }),
    );
  assert.equal(f.get(d, "daysInYear"), 366);
  assert.equal(f.get(d, "era"), "shaka");
  const next = f.call(d, "add", [f.bag({ years: 1 })]) as ObjectValue;
  assert.equal(f.get(next, "day"), 30);
  assert.equal(f.get(next, "year"), 1947);
  const ym = f.call(d, "toPlainYearMonth") as ObjectValue;
  assert.equal(f.get(ym, "month"), 1);
  assert.equal(f.get(ym, "daysInMonth"), 31);
  const md = f.call(d, "toPlainMonthDay") as ObjectValue;
  assert.deepEqual(exoticSlots(md).internalTemporalPlainMonthDay, {
    year: 1972,
    month: 4,
    day: 20,
  });
});
test("Indian Duration context counts exact Chaitra days for plain and zoned references", () => {
  const f = fixture(),
    d = f.construct("Duration", [0, 1]);
  for (const timeZone of [undefined, "UTC", "+00:00"]) {
    const relativeTo = f.bag({
      calendar: "indian",
      year: 1946,
      month: 1,
      day: 1,
      timeZone,
    });
    assert.equal(f.call(d, "total", [f.bag({ unit: "day", relativeTo })]), 31);
    const rounded = f.call(d, "round", [
      f.bag({ smallestUnit: "day", largestUnit: "day", relativeTo }),
    ]) as ObjectValue;
    assert.equal(f.get(rounded, "days"), 31);
  }
});
