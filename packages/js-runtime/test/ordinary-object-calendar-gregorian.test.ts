import { gregorianCalendarFields } from "../src/objects/calendar-gregorian.ts";
import assert from "node:assert/strict";
import test from "node:test";
import * as calendar from "../src/objects/calendar.ts";
test("Gregorian-family calendars expose arithmetic years and canonical eras", () => {
  assert.equal(typeof calendar.calendarFieldsFromISO, "function");
  const iso = { year: 2024, month: 2, day: 29 };
  for (const [id, year, era, eraYear] of [
    ["iso8601", 2024, undefined, undefined],
    ["gregory", 2024, "ce", 2024],
    ["buddhist", 2567, "be", 2567],
    ["roc", 113, "roc", 113],
    ["japanese", 2024, "reiwa", 6],
  ] as const)
    assert.deepEqual(calendar.calendarFieldsFromISO(id, iso), {
      year,
      month: 2,
      day: 29,
      era,
      eraYear,
    });
});
test("Japanese era assignment uses exact boundaries and the 1873 Gregorian cutoff", () => {
  assert.equal(typeof calendar.calendarFieldsFromISO, "function");
  for (const [year, month, day, era, eraYear] of [
    [1872, 12, 31, "ce", 1872],
    [1873, 1, 1, "meiji", 6],
    [1912, 7, 29, "meiji", 45],
    [1912, 7, 30, "taisho", 1],
    [1926, 12, 24, "taisho", 15],
    [1926, 12, 25, "showa", 1],
    [1989, 1, 7, "showa", 64],
    [1989, 1, 8, "heisei", 1],
    [2019, 4, 30, "heisei", 31],
    [2019, 5, 1, "reiwa", 1],
    [-99, 1, 1, "bce", 100],
  ] as const) {
    const fields = calendar.calendarFieldsFromISO("japanese", {
      year,
      month,
      day,
    });
    assert.equal(fields?.era, era);
    assert.equal(fields?.eraYear, eraYear);
  }
});
test("era arithmetic normalizes non-positive and out-of-era years without rejecting them", () => {
  assert.equal(typeof calendar.calendarYearForEra, "function");
  for (const [id, era, eraYear, expected] of [
    ["gregory", "ad", 0, 0],
    ["gregory", "bc", 0, 1],
    ["japanese", "heisei", 100, 2088],
    ["japanese", "meiji", 1, 1868],
    ["japanese", "reiwa", -1, 2017],
    ["buddhist", "be", -1, -1],
    ["roc", "broc", 0, 1],
    ["roc", "roc", -1, -1],
  ] as const)
    assert.equal(calendar.calendarYearForEra(id, era, eraYear), expected);
  for (const [id, era] of [
    ["gregory", "AD"],
    ["gregory", "reiwa"],
    ["roc", "ce"],
    ["iso8601", "ce"],
  ] as const)
    assert.equal(calendar.calendarYearForEra(id, era, 1), undefined);
});
test("Gregorian-family field extraction validates dates and preserves year-zero eras", () => {
  assert.equal(typeof calendar.calendarFieldsFromISO, "function");
  for (const id of ["gregory", "japanese"])
    assert.deepEqual(
      calendar.calendarFieldsFromISO(id, { year: 0, month: 1, day: 1 }),
      { year: 0, month: 1, day: 1, era: "bce", eraYear: 1 },
    );
  assert.deepEqual(
    calendar.calendarFieldsFromISO("roc", { year: 1911, month: 1, day: 1 }),
    { year: 0, month: 1, day: 1, era: "broc", eraYear: 1 },
  );
  for (const date of [
    { year: 2023, month: 2, day: 29 },
    { year: 2024, month: 13, day: 1 },
    { year: 2024, month: 1, day: 0 },
  ])
    assert.equal(calendar.calendarFieldsFromISO("gregory", date), undefined);
  assert.equal(
    gregorianCalendarFields("hebrew", { year: 2024, month: 1, day: 1 }),
    undefined,
  );
});

test("calendar field extraction includes legal YearMonth ISO reference days outside PlainDate bounds", () => {
  assert.equal(typeof calendar.calendarFieldsFromISO, "function");
  assert.deepEqual(
    calendar.calendarFieldsFromISO("gregory", {
      year: -271821,
      month: 4,
      day: 1,
    }),
    { year: -271821, month: 4, day: 1, era: "bce", eraYear: 271822 },
  );
  assert.deepEqual(
    calendar.calendarFieldsFromISO("japanese", {
      year: 275760,
      month: 9,
      day: 30,
    }),
    { year: 275760, month: 9, day: 30, era: "reiwa", eraYear: 273742 },
  );
  for (const id of ["gregory", "roc", "japanese"])
    assert.equal(
      calendar.calendarYearForEra(
        id,
        id === "roc" ? "broc" : "bce",
        -Number.MAX_SAFE_INTEGER,
      ),
      undefined,
    );
});
