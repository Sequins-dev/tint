import assert from "node:assert/strict";
import test from "node:test";
import {
  createTemporalObjectFixture as fixture,
  objects,
  type ObjectValue,
} from "./ordinary-object-temporal-fixture.ts";
import { exoticSlots } from "../src/objects/operations.ts";

test("Gregorian-family PlainDate conversion preserves calendar identity and era fields", () => {
  const f = fixture();
  for (const [calendar, year, era, eraYear] of [
    ["gregory", 2024, "ce", 2024],
    ["japanese", 2024, "reiwa", 6],
    ["buddhist", 2567, "be", 2567],
    ["roc", 113, "roc", 113],
  ] as const) {
    const value = f.from(
      "PlainDate",
      f.bag({ calendar, year, era, eraYear, month: 2, day: 29 }),
    );
    assert.deepEqual(exoticSlots(value).internalTemporalPlainDate, {
      year: 2024,
      month: 2,
      day: 29,
    });
    assert.equal(f.get(value, "calendarId"), calendar);
    assert.equal(f.get(value, "year"), year);
    assert.equal(f.get(value, "era"), era);
    assert.equal(f.get(value, "eraYear"), eraYear);
    assert.equal(f.get(value, "daysInYear"), 366);
    assert.equal(f.get(value, "weekOfYear"), undefined);
    const clone = f.from("PlainDate", value);
    assert.equal(f.get(clone, "calendarId"), calendar);
    assert.notEqual(clone, value);
  }
});
test("calendar-bearing constructors interpret their date arguments as ISO coordinates", () => {
  const f = fixture();
  for (const calendar of ["gregory", "japanese", "buddhist", "roc"]) {
    const date = f.construct("PlainDate", [2024, 2, 29, calendar]);
    assert.equal(f.get(date, "calendarId"), calendar);
    assert.equal(f.get(date, "month"), 2);
    assert.equal(f.get(date, "day"), 29);
    assert.equal(f.call(date, "toString"), `2024-02-29[u-ca=${calendar}]`);
    assert.equal(
      f.call(date, "toString", [f.bag({ calendarName: "never" })]),
      "2024-02-29",
    );
    assert.equal(
      f.call(date, "toString", [f.bag({ calendarName: "critical" })]),
      `2024-02-29[!u-ca=${calendar}]`,
    );
  }
});
test("calendar copying, ISO comparison and equality use distinct identity rules", () => {
  const f = fixture();
  const iso = f.construct("PlainDate", [2024, 2, 29]);
  const greg = f.call(iso, "withCalendar", ["gregory"]) as ObjectValue;
  const buddhist = f.call(greg, "withCalendar", ["buddhist"]) as ObjectValue;
  assert.equal(f.get(greg, "year"), 2024);
  assert.equal(f.get(buddhist, "year"), 2567);
  assert.equal(f.call(greg, "equals", [buddhist]), false);
  assert.equal(f.call(greg, "equals", [f.from("PlainDate", greg)]), true);
  assert.equal(
    f.call(f.construct("PlainDate", [2024, 2, 29]), "equals", [iso]),
    true,
  );
  const compare = objects.getOwnProperty(
    objects.getOwnProperty(
      objects.getOwnProperty(f.root, "Temporal")!.value as ObjectValue,
      "PlainDate",
    )!.value as ObjectValue,
    "compare",
  )!.value as ObjectValue;
  assert.equal(
    compare.internalRareSlots!.internalCall!(undefined, [greg, buddhist]),
    0,
  );
  assert.throws(
    () => f.call(greg, "until", [buddhist]),
    (error) =>
      objects.viewObjectValue(error, f.root)?.prototype ===
      f.realm.prototypes.get("range"),
  );
});
test("Gregorian-family arithmetic and replacement retain identity across era transitions", () => {
  const f = fixture();
  const date = f.from(
    "PlainDate",
    f.bag({ calendar: "japanese", year: 2019, month: 4, day: 30 }),
  );
  const next = f.call(date, "add", [f.bag({ days: 1 })]) as ObjectValue;
  assert.equal(f.get(next, "era"), "reiwa");
  assert.equal(f.get(next, "eraYear"), 1);
  assert.equal(f.get(next, "calendarId"), "japanese");
  const withMonth = f.call(date, "with", [f.bag({ month: 5 })]) as ObjectValue;
  assert.equal(f.get(withMonth, "era"), "reiwa");
  assert.equal(f.get(withMonth, "year"), 2019);
  const withYear = f.call(next, "with", [
    f.bag({ year: 1989, month: 1, day: 7 }),
  ]) as ObjectValue;
  assert.equal(f.get(withYear, "era"), "showa");
  assert.equal(f.get(withYear, "eraYear"), 64);
  const bud = f.from(
    "PlainDate",
    f.bag({ calendar: "buddhist", year: 2566, month: 1, day: 31 }),
  );
  const feb = f.call(bud, "add", [f.bag({ months: 1 })]) as ObjectValue;
  assert.deepEqual(exoticSlots(feb).internalTemporalPlainDate, {
    year: 2023,
    month: 2,
    day: 28,
  });
  assert.equal(f.get(feb, "year"), 2566);
  assert.equal(f.get(feb, "calendarId"), "buddhist");
});
test("Gregorian-family PlainDateTime operations preserve calendar slots and ISO clock arithmetic", () => {
  const f = fixture();
  for (const [calendar, year] of [
    ["gregory", 2024],
    ["japanese", 2024],
    ["buddhist", 2567],
    ["roc", 113],
  ] as const) {
    const value = f.from(
      "PlainDateTime",
      f.bag({ calendar, year, month: 2, day: 29, hour: 23, minute: 59 }),
    );
    assert.equal(f.get(value, "calendarId"), calendar);
    assert.equal(f.get(value, "year"), year);
    assert.equal(
      f.call(value, "toString"),
      `2024-02-29T23:59:00[u-ca=${calendar}]`,
    );
    const added = f.call(value, "add", [f.bag({ minutes: 2 })]) as ObjectValue;
    assert.equal(f.get(added, "calendarId"), calendar);
    assert.equal(f.get(added, "month"), 3);
    assert.equal(f.get(added, "minute"), 1);
    const rounded = f.call(value, "round", [
      f.bag({ smallestUnit: "day", roundingMode: "ceil" }),
    ]) as ObjectValue;
    assert.equal(f.get(rounded, "calendarId"), calendar);
    assert.equal(f.get(rounded, "month"), 3);
    const date = f.call(added, "toPlainDate") as ObjectValue;
    assert.equal(f.get(date, "calendarId"), calendar);
    const midnight = f.call(value, "withPlainTime") as ObjectValue;
    assert.equal(f.get(midnight, "calendarId"), calendar);
    assert.equal(f.get(midnight, "hour"), 0);
  }
  const greg = f.from("PlainDateTime", "2024-02-29T00:00[u-ca=gregory]");
  const bud = f.call(greg, "withCalendar", ["buddhist"]) as ObjectValue;
  assert.equal(f.get(bud, "year"), 2567);
  assert.equal(f.call(greg, "equals", [bud]), false);
  assert.throws(
    () => f.call(greg, "until", [bud]),
    (error) =>
      objects.viewObjectValue(error, f.root)?.prototype ===
      f.realm.prototypes.get("range"),
  );
});
test("Gregorian-family partial dates preserve arithmetic years and canonical reference dates", () => {
  const f = fixture();
  for (const [calendar, year] of [
    ["gregory", 2024],
    ["japanese", 2024],
    ["buddhist", 2567],
    ["roc", 113],
  ] as const) {
    const ym = f.from("PlainYearMonth", f.bag({ calendar, year, month: 2 }));
    assert.equal(f.get(ym, "calendarId"), calendar);
    assert.equal(f.get(ym, "year"), year);
    assert.equal(f.call(ym, "toString"), `2024-02-01[u-ca=${calendar}]`);
    const next = f.call(ym, "add", [f.bag({ years: 1 })]) as ObjectValue;
    assert.equal(f.get(next, "calendarId"), calendar);
    assert.equal(f.get(next, "year"), year + 1);
    const date = f.call(ym, "toPlainDate", [f.bag({ day: 29 })]) as ObjectValue;
    assert.deepEqual(exoticSlots(date).internalTemporalPlainDate, {
      year: 2024,
      month: 2,
      day: 29,
    });
    assert.equal(f.get(date, "calendarId"), calendar);
    const md = f.from(
      "PlainMonthDay",
      f.bag({ calendar, monthCode: "M02", day: 29 }),
    );
    assert.equal(f.get(md, "calendarId"), calendar);
    assert.equal(f.call(md, "toString"), `1972-02-29[u-ca=${calendar}]`);
    const plain = f.call(md, "toPlainDate", [f.bag({ year })]) as ObjectValue;
    assert.deepEqual(exoticSlots(plain).internalTemporalPlainDate, {
      year: 2024,
      month: 2,
      day: 29,
    });
    assert.equal(f.get(plain, "calendarId"), calendar);
  }
});
test("Gregorian-family zoned conversions and copies retain calendar identity", () => {
  const f = fixture();
  for (const [calendar, year] of [
    ["gregory", 1970],
    ["japanese", 1970],
    ["buddhist", 2513],
    ["roc", 59],
  ] as const) {
    const value = f.from(
      "ZonedDateTime",
      `1970-01-01T00:00[UTC][u-ca=${calendar}]`,
    );
    assert.equal(f.get(value, "calendarId"), calendar);
    assert.equal(f.get(value, "year"), year);
    assert.equal(
      f.call(value, "toString"),
      `1970-01-01T00:00:00+00:00[UTC][u-ca=${calendar}]`,
    );
    const added = f.call(value, "add", [f.bag({ days: 1 })]) as ObjectValue;
    assert.equal(f.get(added, "calendarId"), calendar);
    assert.equal(f.get(added, "day"), 2);
    const rounded = f.call(value, "round", [
      f.bag({ smallestUnit: "day" }),
    ]) as ObjectValue;
    assert.equal(f.get(rounded, "calendarId"), calendar);
    for (const method of ["toPlainDate", "toPlainDateTime"])
      assert.equal(
        f.get(f.call(value, method) as ObjectValue, "calendarId"),
        calendar,
      );
    assert.equal(
      f.get(f.call(value, "withPlainTime") as ObjectValue, "calendarId"),
      calendar,
    );
  }
});
test("Duration relativeTo uses Gregorian-family arithmetic years and era preparation", () => {
  const f = fixture();
  const duration = f.construct("Duration", [0, 1]);
  for (const [calendar, year] of [
    ["gregory", 2024],
    ["japanese", 2024],
    ["buddhist", 2567],
    ["roc", 113],
  ] as const) {
    const relativeTo = f.bag({ calendar, year, month: 1, day: 1 });
    assert.equal(
      f.call(duration, "total", [f.bag({ unit: "day", relativeTo })]),
      31,
    );
  }
});
test("non-ISO month-day replacement requires a year for ordinal months and preserves month codes otherwise", () => {
  const f = fixture();
  for (const calendar of ["gregory", "japanese", "buddhist", "roc"]) {
    const value = f.from(
      "PlainMonthDay",
      f.bag({ calendar, monthCode: "M01", day: 15 }),
    );
    assert.throws(
      () => f.call(value, "with", [f.bag({ month: 12 })]),
      (error) =>
        objects.viewObjectValue(error, f.root)?.prototype ===
        f.realm.prototypes.get("type"),
    );
    const withCode = f.call(value, "with", [
      f.bag({ monthCode: "M12" }),
    ]) as ObjectValue;
    assert.equal(f.get(withCode, "monthCode"), "M12");
    assert.equal(f.get(withCode, "day"), 15);
    const withDay = f.call(value, "with", [f.bag({ day: 24 })]) as ObjectValue;
    assert.equal(f.get(withDay, "monthCode"), "M01");
    assert.equal(f.get(withDay, "day"), 24);
  }
});
test("non-ISO MonthDay.toPlainDate accepts an era/year pair without reading unrelated fields", () => {
  const f = fixture();
  for (const [calendar, era, eraYear] of [
    ["gregory", "ad", 2024],
    ["japanese", "reiwa", 6],
    ["buddhist", "be", 2567],
    ["roc", "roc", 113],
  ] as const) {
    const md = f.from(
      "PlainMonthDay",
      f.bag({ calendar, monthCode: "M02", day: 29 }),
    );
    const date = f.call(md, "toPlainDate", [
      f.bag({ era, eraYear }),
    ]) as ObjectValue;
    assert.deepEqual(exoticSlots(date).internalTemporalPlainDate, {
      year: 2024,
      month: 2,
      day: 29,
    });
    assert.equal(f.get(date, "calendarId"), calendar);
  }
});
