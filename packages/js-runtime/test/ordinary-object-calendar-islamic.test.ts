import assert from "node:assert/strict";
import test from "node:test";
import * as calendar from "../src/objects/calendar.ts";
import { gregorianFromEpochDay } from "@tint/foundation/chrono/gregorian-calendar";
import {
  createTemporalObjectFixture as fixture,
  objects,
  type ObjectValue,
} from "./ordinary-object-temporal-fixture.ts";
import { exoticSlots } from "../src/objects/operations.ts";
const families = ["islamic-civil", "islamic-tbla", "islamic-umalqura"] as const;
test("Islamic civil and Thursday epochs differ by one day and Umm al-Qura uses its complete month data", () => {
  for (const [id, day] of [
    ["islamic-civil", 19],
    ["islamic-tbla", 18],
    ["islamic-umalqura", 19],
  ] as const)
    assert.deepEqual(
      calendar.calendarDateFromFields(
        id,
        { year: 1, month: 1, day: 1 },
        "date",
        "reject",
      ).value,
      { year: 622, month: 7, day },
    );
  for (const [id, day] of [
    ["islamic-civil", 8],
    ["islamic-tbla", 7],
    ["islamic-umalqura", 7],
  ] as const)
    assert.deepEqual(
      calendar.calendarDateFromFields(
        id,
        { year: 1446, month: 1, day: 1 },
        "date",
        "reject",
      ).value,
      { year: 2024, month: 7, day },
    );
  assert.equal(calendar.calendarDaysInYear("islamic-civil", 1445), 355);
  assert.equal(calendar.calendarDaysInYear("islamic-umalqura", 1445), 354);
});
test("Islamic era fields normalize nonpositive AH and BH years without changing arithmetic years", () => {
  for (const id of families)
    for (const [era, eraYear, year, resultEra, resultEraYear] of [
      ["ah", 0, 0, "bh", 1],
      ["ah", -1, -1, "bh", 2],
      ["bh", 0, 1, "ah", 1],
      ["bh", -1, 2, "ah", 2],
    ] as const) {
      const r = calendar.calendarDateFromFields(
        id,
        { era, eraYear, month: 1, day: 1 },
        "date",
        "reject",
      );
      assert.ok(r.value);
      const f = calendar.calendarFieldsFromISO(id, r.value);
      assert.equal(f?.year, year);
      assert.equal(f?.era, resultEra);
      assert.equal(f?.eraYear, resultEraYear);
    }
});
test("tabular month lengths and leap-year lengths are consistent across a full thirty-year cycle", () => {
  for (const id of families.slice(0, 2)) {
    assert.equal(calendar.calendarAlgorithmsAvailable(id), true);
    for (let epoch = 19000; epoch < 29631; epoch++) {
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
    assert.equal(calendar.calendarDaysInMonth(id, 1445, 2), 29);
    assert.equal(calendar.calendarDaysInMonth(id, 1445, 12), 30);
  }
});
test("Umm al-Qura conversion roundtrips every pinned table year and both fallback boundaries", () => {
  for (let year = 1299; year <= 1601; year++) {
    const first = calendar.calendarDateFromFields(
      "islamic-umalqura",
      { year, month: 1, day: 1 },
      "date",
      "reject",
    );
    assert.ok(first.value);
    assert.equal(
      calendar.calendarFieldsFromISO("islamic-umalqura", first.value)?.year,
      year,
    );
    for (const month of [1, 2, 11, 12]) {
      const day = calendar.calendarDaysInMonth("islamic-umalqura", year, month);
      assert.ok(day);
      const last = calendar.calendarDateFromFields(
        "islamic-umalqura",
        { year, month, day },
        "date",
        "reject",
      );
      assert.ok(last.value);
      const fields = calendar.calendarFieldsFromISO(
        "islamic-umalqura",
        last.value,
      );
      assert.equal(fields?.month, month);
      assert.equal(fields?.day, day);
    }
  }
  for (const id of families)
    for (const epoch of [-100000001, 100000000]) {
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
});
test("Islamic public calendar arithmetic, partial dates and Duration context retain their own month lengths", () => {
  const f = fixture();
  for (const id of families) {
    const date = f.from(
      "PlainDate",
      f.bag({ calendar: id, year: 1445, month: 9, day: 1 }),
    );
    assert.equal(f.get(date, "monthsInYear"), 12);
    const added = f.call(date, "add", [f.bag({ months: 1 })]) as ObjectValue;
    assert.equal(f.get(added, "month"), 10);
    const ym = f.call(date, "toPlainYearMonth") as ObjectValue;
    assert.equal(f.get(ym, "month"), 9);
    const md = f.call(date, "toPlainMonthDay") as ObjectValue;
    assert.equal(f.get(md, "monthCode"), "M09");
    for (const timeZone of [undefined, "UTC", "+00:00"]) {
      const relativeTo = f.bag({
          calendar: id,
          year: 1445,
          month: 9,
          day: 1,
          timeZone,
        }),
        duration = f.construct("Duration", [0, 1]);
      assert.equal(
        f.call(duration, "total", [f.bag({ unit: "day", relativeTo })]),
        30,
      );
    }
  }
});
test("Islamic Temporal leap-year metadata reflects 355 days rather than solar year lengths", () => {
  const f = fixture();
  for (const [calendar, expected] of [
    ["islamic-civil", true],
    ["islamic-tbla", true],
    ["islamic-umalqura", false],
  ] as const) {
    const date = f.from(
      "PlainDate",
      f.bag({ calendar, year: 1445, month: 1, day: 1 }),
    );
    assert.equal(f.get(date, "inLeapYear"), expected);
  }
});
test("islamicc canonicalizes to civil arithmetic without changing Intl calendar vocabulary", () => {
  const f = fixture();
  const date = f.from(
    "PlainDate",
    f.bag({ calendar: "ISLAMICC", year: 1445, month: 9, day: 1 }),
  );
  assert.equal(f.get(date, "calendarId"), "islamic-civil");
  assert.deepEqual(exoticSlots(date).internalTemporalPlainDate, {
    year: 2024,
    month: 3,
    day: 11,
  });
  assert.equal(calendar.canonicalCalendarIdentifier("islamic"), "islamic");
  assert.equal(
    calendar.canonicalCalendarIdentifier("islamic-rgsa"),
    "islamic-rgsa",
  );
});
test("Temporal rejects Intl-only Islamic fallback identifiers with RangeError before unsupported execution", () => {
  for (const id of ["islamic", "islamic-rgsa", "ISLAMIC", "ISLAMIC-RGSA"])
    for (const name of [
      "PlainDate",
      "PlainDateTime",
      "PlainYearMonth",
      "PlainMonthDay",
      "ZonedDateTime",
    ]) {
      const f = fixture();
      assert.throws(
        () =>
          f.from(
            name,
            f.bag({
              calendar: id,
              year: 1500,
              month: 1,
              day: 1,
              timeZone: "UTC",
            }),
          ),
        (error) =>
          objects.viewObjectValue(error, f.root)?.prototype ===
          f.realm.prototypes.get("range"),
      );
      assert.equal(f.realm.unsupported, false);
    }
});
