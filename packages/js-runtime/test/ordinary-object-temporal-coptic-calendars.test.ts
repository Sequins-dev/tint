import assert from "node:assert/strict";
import test from "node:test";
import {
  createTemporalObjectFixture as fixture,
  objects,
  type ObjectValue,
} from "./ordinary-object-temporal-fixture.ts";
import { exoticSlots } from "../src/objects/operations.ts";
const families = [
  ["coptic", 1739],
  ["ethiopic", 2015],
  ["ethioaa", 7515],
] as const;
test("Coptic-family public fields expose thirteen months, epagomenal days and calendar year lengths", () => {
  const f = fixture();
  for (const [calendar, year] of families) {
    const d = f.from(
      "PlainDate",
      f.bag({ calendar, year, monthCode: "M13", day: 6 }),
    );
    assert.deepEqual(exoticSlots(d).internalTemporalPlainDate, {
      year: 2023,
      month: 9,
      day: 11,
    });
    for (const [name, value] of Object.entries({
      calendarId: calendar,
      year,
      month: 13,
      monthCode: "M13",
      day: 6,
      daysInMonth: 6,
      daysInYear: 366,
      monthsInYear: 13,
      inLeapYear: true,
      dayOfYear: 366,
      dayOfWeek: 1,
    }))
      assert.equal(f.get(d, name), value, name);
    assert.equal(f.call(d, "toString"), `2023-09-11[u-ca=${calendar}]`);
  }
});
test("calendar month/year addition constrains only the final epagomenal day", () => {
  const f = fixture();
  for (const [calendar, year] of families) {
    const d = f.from("PlainDate", f.bag({ calendar, year, month: 13, day: 6 }));
    const next = f.call(d, "add", [f.bag({ months: 1 })]) as ObjectValue;
    assert.equal(f.get(next, "year"), year + 1);
    assert.equal(f.get(next, "month"), 1);
    assert.equal(f.get(next, "day"), 6);
    const constrained = f.call(d, "add", [f.bag({ years: 1 })]) as ObjectValue;
    assert.equal(f.get(constrained, "day"), 5);
    assert.throws(
      () =>
        f.call(d, "add", [f.bag({ years: 1 }), f.bag({ overflow: "reject" })]),
      (error) =>
        objects.viewObjectValue(error, f.root)?.prototype ===
        f.realm.prototypes.get("range"),
    );
    const combined = f.call(d, "add", [
      f.bag({ years: 1, months: 1 }),
      f.bag({ overflow: "reject" }),
    ]) as ObjectValue;
    assert.deepEqual(exoticSlots(combined).internalTemporalPlainDate, {
      year: 2024,
      month: 9,
      day: 16,
    });
  }
});
test("YearMonth and MonthDay operations preserve non-Gregorian reference components", () => {
  const f = fixture();
  for (const [calendar, year] of families) {
    const ym = f.from("PlainYearMonth", f.bag({ calendar, year, month: 13 }));
    assert.equal(f.get(ym, "month"), 13);
    assert.equal(f.get(ym, "daysInMonth"), 6);
    const next = f.call(ym, "add", [f.bag({ months: 1 })]) as ObjectValue;
    assert.deepEqual(exoticSlots(next).internalTemporalPlainYearMonth, {
      year: 2023,
      month: 9,
      day: 12,
    });
    assert.equal(f.get(next, "month"), 1);
    const date = f.call(ym, "toPlainDate", [f.bag({ day: 6 })]) as ObjectValue;
    assert.deepEqual(exoticSlots(date).internalTemporalPlainDate, {
      year: 2023,
      month: 9,
      day: 11,
    });
    const md = f.from(
      "PlainMonthDay",
      f.bag({ calendar, monthCode: "M13", day: 6 }),
    );
    assert.deepEqual(exoticSlots(md).internalTemporalPlainMonthDay, {
      year: 1971,
      month: 9,
      day: 11,
    });
    assert.equal(f.get(md, "monthCode"), "M13");
    const withDay = f.call(md, "with", [f.bag({ day: 5 })]) as ObjectValue;
    assert.deepEqual(exoticSlots(withDay).internalTemporalPlainMonthDay, {
      year: 1972,
      month: 9,
      day: 10,
    });
    const plain = f.call(md, "toPlainDate", [f.bag({ year })]) as ObjectValue;
    assert.deepEqual(exoticSlots(plain).internalTemporalPlainDate, {
      year: 2023,
      month: 9,
      day: 11,
    });
  }
});
test("calendar differences use thirteen-month years and reconstruct complete cycles", () => {
  const f = fixture();
  for (const [calendar, year] of families) {
    const one = f.from(
        "PlainDate",
        f.bag({ calendar, year, month: 1, day: 1 }),
      ),
      two = f.from(
        "PlainDate",
        f.bag({ calendar, year: year + 1, month: 1, day: 1 }),
      );
    for (const [largestUnit, name, value] of [
      ["year", "years", 1],
      ["month", "months", 13],
      ["day", "days", 366],
    ] as const) {
      const duration = f.call(one, "until", [
        two,
        f.bag({ largestUnit }),
      ]) as ObjectValue;
      assert.equal(f.get(duration, name), value);
    }
    const a = f.from("PlainYearMonth", f.bag({ calendar, year, month: 1 })),
      b = f.from(
        "PlainYearMonth",
        f.bag({ calendar, year: year + 1, month: 1 }),
      );
    const delta = f.call(a, "until", [
      b,
      f.bag({ largestUnit: "month" }),
    ]) as ObjectValue;
    assert.equal(f.get(delta, "months"), 13);
  }
});
test("date-time and zoned arithmetic retain calendar identity across the epagomenal boundary", () => {
  const f = fixture();
  for (const [calendar, year] of families) {
    const d = f.from(
      "PlainDateTime",
      f.bag({ calendar, year, month: 13, day: 6, hour: 23, minute: 59 }),
    );
    const added = f.call(d, "add", [f.bag({ minutes: 2 })]) as ObjectValue;
    assert.equal(f.get(added, "year"), year + 1);
    assert.equal(f.get(added, "month"), 1);
    assert.equal(f.get(added, "day"), 1);
    assert.equal(f.get(added, "calendarId"), calendar);
    const z = f.from(
      "ZonedDateTime",
      f.bag({ calendar, year, month: 13, day: 6, timeZone: "UTC" }),
    );
    const next = f.call(z, "add", [f.bag({ months: 1 })]) as ObjectValue;
    assert.equal(f.get(next, "year"), year + 1);
    assert.equal(f.get(next, "month"), 1);
    assert.equal(f.get(next, "day"), 6);
    assert.equal(f.get(next, "calendarId"), calendar);
  }
});
test("Duration relativeTo uses epagomenal month lengths in plain and zoned calculations", () => {
  const f = fixture();
  const d = f.construct("Duration", [0, 1]);
  for (const [calendar, year] of families)
    for (const zoned of [false, true]) {
      const relativeTo = f.bag(
        zoned
          ? { calendar, year, month: 13, day: 1, timeZone: "UTC" }
          : { calendar, year, month: 13, day: 1 },
      );
      assert.equal(f.call(d, "total", [f.bag({ unit: "day", relativeTo })]), 6);
      const rounded = f.call(d, "round", [
        f.bag({ largestUnit: "day", smallestUnit: "day", relativeTo }),
      ]) as ObjectValue;
      assert.equal(f.get(rounded, "days"), 6);
    }
});

test("calendar rounding and totals use the six-day month and thirteen-month year grids", () => {
  const f = fixture();
  for (const [calendar, year] of families)
    for (const zone of [undefined, "+00:00", "UTC"]) {
      const relativeTo = f.bag({
        calendar,
        year,
        month: 13,
        day: 1,
        ...(zone === undefined ? {} : { timeZone: zone }),
      });
      const half = f.construct("Duration", [0, 0, 0, 3]);
      assert.equal(
        f.call(half, "total", [f.bag({ unit: "month", relativeTo })]),
        0.5,
      );
      const rounded = f.call(half, "round", [
        f.bag({
          smallestUnit: "month",
          roundingMode: "halfExpand",
          relativeTo,
        }),
      ]) as ObjectValue;
      assert.equal(f.get(rounded, "months"), 1);
      const down = f.call(half, "round", [
        f.bag({ smallestUnit: "month", roundingMode: "halfEven", relativeTo }),
      ]) as ObjectValue;
      assert.equal(f.get(down, "months"), 0);
      const whole = f.construct("Duration", [1]);
      assert.equal(
        f.call(whole, "total", [f.bag({ unit: "month", relativeTo })]),
        13,
      );
      const annual = f.call(f.construct("Duration", [0, 13]), "round", [
        f.bag({ largestUnit: "year", smallestUnit: "month", relativeTo }),
      ]) as ObjectValue;
      assert.equal(f.get(annual, "years"), 1);
      assert.equal(f.get(annual, "months"), 0);
    }
});

test("calendar reference conversions preserve month codes when ISO months differ", () => {
  const f = fixture();
  for (const [calendar, year] of families) {
    const d = f.from("PlainDate", f.bag({ calendar, year, month: 13, day: 6 }));
    const ym = f.call(d, "toPlainYearMonth") as ObjectValue,
      md = f.call(d, "toPlainMonthDay") as ObjectValue;
    assert.deepEqual(exoticSlots(ym).internalTemporalPlainYearMonth, {
      year: 2023,
      month: 9,
      day: 6,
    });
    assert.deepEqual(exoticSlots(md).internalTemporalPlainMonthDay, {
      year: 1971,
      month: 9,
      day: 11,
    });
    assert.deepEqual(
      exoticSlots(f.from("PlainYearMonth", `2023-09-11[u-ca=${calendar}]`))
        .internalTemporalPlainYearMonth,
      exoticSlots(ym).internalTemporalPlainYearMonth,
    );
    assert.deepEqual(
      exoticSlots(f.from("PlainMonthDay", `2023-09-11[u-ca=${calendar}]`))
        .internalTemporalPlainMonthDay,
      exoticSlots(md).internalTemporalPlainMonthDay,
    );
    const changed = f.call(ym, "with", [f.bag({ month: 1 })]) as ObjectValue;
    assert.equal(f.get(changed, "year"), year);
    assert.equal(f.get(changed, "month"), 1);
  }
});

test("end-of-epagomenal-month differences retain the specified asymmetric constrained remainder", () => {
  const f = fixture();
  for (const [calendar, year] of families) {
    const common = f.from(
      "PlainDate",
      f.bag({ calendar, year: year - 1, month: 13, day: 5 }),
    );
    const leap = f.from(
      "PlainDate",
      f.bag({ calendar, year, month: 13, day: 6 }),
    );
    const next = f.from(
      "PlainDate",
      f.bag({ calendar, year: year + 1, month: 13, day: 5 }),
    );
    for (const [a, b, years, months, days] of [
      [common, leap, 1, 0, 1],
      [leap, common, -1, 0, 0],
      [leap, next, 0, 12, 29],
      [next, leap, 0, -12, -5],
    ] as const) {
      const duration = f.call(a, "until", [
        b,
        f.bag({ largestUnit: "year" }),
      ]) as ObjectValue;
      assert.deepEqual(
        [
          f.get(duration, "years"),
          f.get(duration, "months"),
          f.get(duration, "days"),
        ],
        [years, months, days],
      );
    }
  }
});
