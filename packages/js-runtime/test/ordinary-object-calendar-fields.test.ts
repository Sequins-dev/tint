import assert from "node:assert/strict";
import test from "node:test";
import { calendarDateFromFields as convert } from "../src/objects/calendar.ts";
const good = (year: number, month: number, day: number) => ({
  value: { year, month, day },
  error: "none",
});
const bad = (error: string) => ({ value: undefined, error });
test("Gregorian era fields resolve into ISO dates with calendar arithmetic-year consistency", () => {
  assert.equal(typeof convert, "function");
  assert.deepEqual(
    convert(
      "gregory",
      { era: "bc", eraYear: 44, year: -43, month: 3, day: 15 },
      "date",
      "constrain",
    ),
    good(-43, 3, 15),
  );
  assert.deepEqual(
    convert(
      "buddhist",
      { era: "be", eraYear: 2567, month: 2, day: 29 },
      "date",
      "reject",
    ),
    good(2024, 2, 29),
  );
  assert.deepEqual(
    convert(
      "roc",
      { era: "broc", eraYear: 0, month: 1, day: 1 },
      "date",
      "reject",
    ),
    good(1912, 1, 1),
  );
  assert.deepEqual(
    convert(
      "japanese",
      { era: "heisei", eraYear: 31, month: 5, day: 1 },
      "date",
      "reject",
    ),
    good(2019, 5, 1),
  );
  assert.deepEqual(
    convert(
      "gregory",
      { era: "ce", eraYear: 2024, year: 2023, month: 1, day: 1 },
      "date",
      "constrain",
    ),
    bad("range"),
  );
});
test("required-field errors precede era and month consistency errors", () => {
  assert.equal(typeof convert, "function");
  for (const fields of [
    { month: 6, monthCode: { month: 5, leap: false }, day: 1 },
    { year: 2020, day: 32 },
    { year: 2020, month: 6, monthCode: { month: 5, leap: false } },
    { year: 2020, era: "invalid", month: 1, day: 1 },
    { year: 2020, eraYear: 1, month: 1, day: 1 },
  ])
    assert.deepEqual(convert("gregory", fields, "date", "reject"), bad("type"));
  assert.deepEqual(
    convert(
      "gregory",
      { era: "invalid", eraYear: 1, month: 1, day: 1 },
      "date",
      "constrain",
    ),
    bad("range"),
  );
  assert.deepEqual(
    convert(
      "gregory",
      { year: 2024, monthCode: { month: 2, leap: true }, day: 1 },
      "date",
      "constrain",
    ),
    bad("range"),
  );
});
test("overflow follows Gregorian leap days and does not erase month-code conflicts", () => {
  assert.equal(typeof convert, "function");
  assert.deepEqual(
    convert("buddhist", { year: 2566, month: 2, day: 29 }, "date", "constrain"),
    good(2023, 2, 28),
  );
  assert.deepEqual(
    convert("buddhist", { year: 2566, month: 2, day: 29 }, "date", "reject"),
    bad("range"),
  );
  assert.deepEqual(
    convert("roc", { year: 113, month: 20, day: 40 }, "date", "constrain"),
    good(2024, 12, 31),
  );
  assert.deepEqual(
    convert(
      "gregory",
      { year: 2024, month: 13, monthCode: { month: 12, leap: false }, day: 1 },
      "date",
      "constrain",
    ),
    bad("range"),
  );
});
test("partial-date reference dates preserve Gregorian calendar reference policies and bounds", () => {
  assert.equal(typeof convert, "function");
  assert.deepEqual(
    convert("buddhist", { year: 2567, month: 2 }, "year-month", "constrain"),
    good(2024, 2, 1),
  );
  assert.deepEqual(
    convert("gregory", { year: -271821, month: 4 }, "year-month", "reject"),
    good(-271821, 4, 1),
  );
  assert.deepEqual(
    convert("gregory", { year: -271821, month: 3 }, "year-month", "constrain"),
    bad("range"),
  );
  assert.deepEqual(
    convert(
      "buddhist",
      { year: 2566, monthCode: { month: 2, leap: false }, day: 29 },
      "month-day",
      "constrain",
    ),
    good(1972, 2, 28),
  );
  assert.deepEqual(
    convert(
      "japanese",
      { monthCode: { month: 2, leap: false }, day: 29 },
      "month-day",
      "reject",
    ),
    good(1972, 2, 29),
  );
  assert.deepEqual(
    convert("gregory", { month: 2, day: 29 }, "month-day", "constrain"),
    bad("type"),
  );
});
