import assert from "node:assert/strict";
import test from "node:test";
import * as calendar from "../src/objects/calendar.ts";
import { gregorianFromEpochDay } from "@tint/foundation/chrono/gregorian-calendar";
import {
  createTemporalObjectFixture as fixture,
  objects,
  type ObjectValue,
} from "./ordinary-object-temporal-fixture.ts";
const families = ["chinese", "dangi"] as const;
test("East Asian calendars expose arithmetic years and repeated leap-month codes", () => {
  for (const id of families) {
    for (const [iso, year, month, day] of [
      [{ year: 2023, month: 1, day: 22 }, 2023, 1, 1],
      [{ year: 2023, month: 3, day: 22 }, 2023, 3, 1],
      [{ year: 2023, month: 4, day: 20 }, 2023, 4, 1],
      [{ year: 2024, month: 2, day: 10 }, 2024, 1, 1],
    ] as const)
      assert.deepEqual(calendar.calendarFieldsFromISO(id, iso), {
        year,
        month,
        day,
        era: undefined,
        eraYear: undefined,
      });
    assert.equal(calendar.calendarMonthsInYear(id, 2023), 13);
    assert.equal(calendar.calendarMonthsInYear(id, 2024), 12);
    assert.equal(calendar.calendarDaysInYear(id, 2023), 384);
  }
});
test("Chinese and Dangi month-code resolution constrains missing leap months backward", () => {
  for (const id of families) {
    assert.deepEqual(
      calendar.calendarDateFromFields(
        id,
        { year: 2023, monthCode: { month: 2, leap: true }, day: 1 },
        "date",
        "reject",
      ).value,
      { year: 2023, month: 3, day: 22 },
    );
    assert.equal(
      calendar.calendarDateFromFields(
        id,
        { year: 2024, monthCode: { month: 2, leap: true }, day: 1 },
        "date",
        "reject",
      ).error,
      "range",
    );
    const regular = calendar.calendarDateFromFields(
      id,
      { year: 2024, monthCode: { month: 2, leap: false }, day: 1 },
      "date",
      "reject",
    );
    assert.deepEqual(
      calendar.calendarDateFromFields(
        id,
        { year: 2024, monthCode: { month: 2, leap: true }, day: 1 },
        "date",
        "constrain",
      ),
      regular,
    );
  }
});
test("East Asian month-day references follow the fixed rare-month table", () => {
  for (const id of families) {
    for (const [code, day, year] of [
      [{ month: 2, leap: true }, 29, 1947],
      [{ month: 5, leap: true }, 30, 1952],
      [{ month: 11, leap: true }, 1, 2033],
      [{ month: 11, leap: true }, 11, 2034],
      [{ month: 3, leap: false }, 30, id === "chinese" ? 1966 : 1968],
    ] as const) {
      const d = calendar.calendarDateFromFields(
        id,
        { monthCode: code, day },
        "month-day",
        "reject",
      );
      assert.equal(d.error, "none");
      assert.equal(d.value?.year, year);
    }
    for (const month of [1, 12]) {
      assert.equal(
        calendar.calendarDateFromFields(
          id,
          { monthCode: { month, leap: true }, day: 29 },
          "month-day",
          "reject",
        ).error,
        "range",
      );
      assert.deepEqual(
        calendar.calendarDateFromFields(
          id,
          { monthCode: { month, leap: true }, day: 29 },
          "month-day",
          "constrain",
        ),
        calendar.calendarDateFromFields(
          id,
          { monthCode: { month, leap: false }, day: 29 },
          "month-day",
          "constrain",
        ),
      );
    }
  }
});
test("East Asian date conversion roundtrips modern cycles and both supported date limits", () => {
  for (const id of families) {
    assert.equal(calendar.calendarAlgorithmsAvailable(id), true);
    for (const epoch of [
      -100000001, -100000000, -719528, -30000, 0, 10000, 19616, 30000,
      100000000,
    ]) {
      const iso = gregorianFromEpochDay(epoch)!;
      const f = calendar.calendarFieldsFromISO(id, iso);
      assert.ok(f);
      assert.deepEqual(
        calendar.calendarDateFromFields(
          id,
          { year: f.year, month: f.month, day: f.day },
          "date",
          "reject",
        ).value,
        iso,
      );
    }
  }
});
test("East Asian year differences test original leap codes before target-year constraining", () => {
  const f = fixture();
  for (const calendar of families) {
    const a = f.from(
        "PlainDate",
        f.bag({ calendar, year: 2023, monthCode: "M02L", day: 1 }),
      ),
      b = f.from(
        "PlainDate",
        f.bag({ calendar, year: 2024, monthCode: "M02", day: 1 }),
      );
    const duration = f.call(a, "until", [
      b,
      f.bag({ largestUnit: "year" }),
    ]) as ObjectValue;
    assert.equal(f.get(duration, "years"), 0);
    assert.equal(f.get(duration, "months"), 12);
    const annual = f.call(a, "add", [f.bag({ years: 1 })]) as ObjectValue;
    assert.equal(f.get(annual, "monthCode"), "M02");
    assert.throws(
      () =>
        f.call(a, "add", [f.bag({ years: 1 }), f.bag({ overflow: "reject" })]),
      (error) =>
        objects.viewObjectValue(error, f.root)?.prototype ===
        f.realm.prototypes.get("range"),
    );
  }
});
test("East Asian public partial-date conversion retains leap month identity", () => {
  const f = fixture();
  for (const calendar of families) {
    const a = f.from(
        "PlainDate",
        f.bag({ calendar, year: 2023, monthCode: "M02L", day: 1 }),
      ),
      ym = f.call(a, "toPlainYearMonth") as ObjectValue,
      md = f.call(a, "toPlainMonthDay") as ObjectValue;
    assert.equal(f.get(a, "monthCode"), "M02L");
    assert.equal(f.get(ym, "monthCode"), "M02L");
    assert.equal(f.get(md, "monthCode"), "M02L");
    const b = f.call(md, "toPlainDate", [f.bag({ year: 2023 })]) as ObjectValue;
    assert.equal(f.get(b, "monthCode"), "M02L");
    assert.equal(f.get(b, "month"), 3);
  }
});
test("East Asian Duration context uses actual leap-month and year lengths", () => {
  const f = fixture();
  for (const calendar of families)
    for (const timeZone of [undefined, "UTC", "+00:00"]) {
      const relativeTo = f.bag({
          calendar,
          year: 2023,
          month: 1,
          day: 1,
          timeZone,
        }),
        d = f.construct("Duration", [1]);
      assert.equal(
        f.call(d, "total", [f.bag({ unit: "day", relativeTo })]),
        384,
      );
      assert.equal(
        f.call(d, "total", [f.bag({ unit: "month", relativeTo })]),
        13,
      );
    }
});

test("published East Asian calendar years override approximate conjunction boundaries", () => {
  const chinese = calendar.calendarDateAt("chinese", 1917, 3, 1)!;
  assert.deepEqual(calendar.calendarMonthCode("chinese", chinese), {
    month: 2,
    leap: true,
  });
  assert.equal(calendar.calendarDaysInMonth("dangi", 2017, 1), 29);
  assert.equal(calendar.calendarDaysInMonth("dangi", 2017, 2), 30);
  assert.deepEqual(calendar.calendarDateAt("dangi", 2027, 1, 1), {
    year: 2027,
    month: 2,
    day: 7,
  });
});
