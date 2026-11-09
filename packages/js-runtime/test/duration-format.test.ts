import test from "node:test";
import assert from "node:assert/strict";
import * as durationFormat from "../src/objects/duration-format.ts";
import { createDuration } from "@tint/foundation/chrono/temporal-duration";

function configuration(
  options: Record<string, unknown> = {},
  twoDigitHours = false,
) {
  return durationFormat.resolveDurationFormatOptions(
    {
      read: (key) => options[key],
      number: Number,
      string: String,
      reject: (kind) => {
        throw kind === "range" ? new RangeError() : new TypeError();
      },
    },
    twoDigitHours,
  );
}
function format(
  fields: Record<string, number>,
  options: Record<string, unknown> = {},
  locale = "en",
  system = "latn",
) {
  const duration = createDuration(
    [
      "years",
      "months",
      "weeks",
      "days",
      "hours",
      "minutes",
      "seconds",
      "milliseconds",
      "microseconds",
      "nanoseconds",
    ].map((unit) => fields[unit] ?? 0),
  );
  assert.ok(duration);
  const formatter = durationFormat.createDurationFormatter(
    locale,
    system,
    configuration(options),
  );
  assert.ok(formatter);
  const parts = durationFormat.durationFormatParts(formatter, duration);
  return { text: parts.map((part) => part.value).join(""), parts };
}
test("duration options default and propagate numeric styles in observable order", () => {
  const gets: string[] = [];
  const value = durationFormat.resolveDurationFormatOptions(
    {
      read(key) {
        gets.push(key);
        return key === "hours" ? "numeric" : undefined;
      },
      number: Number,
      string: String,
      reject() {
        throw new RangeError();
      },
    },
    false,
  );
  assert.equal(value.style, "short");
  assert.deepEqual(
    value.units.slice(4).map((unit) => [unit.style, unit.display]),
    [
      ["numeric", "always"],
      ["2-digit", "always"],
      ["2-digit", "always"],
      ["fractional", "auto"],
      ["fractional", "auto"],
      ["fractional", "auto"],
    ],
  );
  assert.deepEqual(gets, [
    "style",
    ...[
      "years",
      "months",
      "weeks",
      "days",
      "hours",
      "minutes",
      "seconds",
      "milliseconds",
      "microseconds",
      "nanoseconds",
    ].flatMap((unit) => [unit, unit + "Display"]),
    "fractionalDigits",
  ]);
  assert.throws(
    () => configuration({ hours: "numeric", minutes: "long" }),
    RangeError,
  );
  assert.throws(
    () =>
      configuration({ milliseconds: "numeric", millisecondsDisplay: "always" }),
    RangeError,
  );
  assert.throws(() => configuration({ fractionalDigits: 10 }), RangeError);
  assert.equal(configuration({ fractionalDigits: 3.9 }).fractionalDigits, 3);
  assert.equal(
    configuration({ style: "digital" }, true).units[4]?.style,
    "2-digit",
  );
});
test("duration unit lists retain units on number parts and omit them on list literals", () => {
  const result = format({ years: 1, months: 2, days: 3 }, { style: "long" });
  assert.equal(result.text, "1 year, 2 months, 3 days");
  assert.ok(
    result.parts
      .filter((part) => part.type === "integer")
      .every((part) => part.unit !== undefined),
  );
  assert.deepEqual(
    result.parts.filter((part) => part.value === ", "),
    [
      { type: "literal", value: ", " },
      { type: "literal", value: ", " },
    ],
  );
  assert.equal(format({ years: 0 }).text, "");
  assert.equal(format({ years: 2 }, { style: "long" }, "ar").text, "سنتان");
});
test("digital durations preserve overflow, separators, zero bridges and a single leading sign", () => {
  assert.equal(
    format(
      { hours: 1234, minutes: 1234567, seconds: 12345678 },
      { style: "digital" },
    ).text,
    "1234:1234567:12345678",
  );
  assert.equal(
    format(
      { hours: 1, seconds: 3 },
      { style: "digital", minutesDisplay: "auto" },
    ).text,
    "1:00:03",
  );
  assert.equal(format({ seconds: -3 }, { style: "digital" }).text, "-0:00:03");
  assert.equal(
    format({ hours: 1, minutes: 2, seconds: 3 }, { style: "digital" }, "fi")
      .text,
    "1.02.03",
  );
  assert.equal(
    format(
      { days: 5, hours: 1, minutes: 2, seconds: 3 },
      { minutes: "numeric", seconds: "numeric" },
    ).text,
    "5 days, 1 hr, 2:03",
  );
});
test("fractional duration arithmetic uses exact binary64 integer values and truncation", () => {
  assert.equal(
    format({ seconds: 10000000, nanoseconds: 1 }, { seconds: "numeric" }).text,
    "10000000.000000001",
  );
  assert.equal(
    format(
      {
        seconds: 1,
        milliseconds: 2,
        microseconds: 3,
        nanoseconds: Number.MAX_SAFE_INTEGER,
      },
      { seconds: "numeric" },
    ).text,
    "9007200.256743991",
  );
  assert.equal(
    format(
      {
        milliseconds: 4503599627370497_000,
        microseconds: 4503599627370495_000000,
      },
      { seconds: "numeric" },
    ).text,
    "9007199254740991.975424",
  );
  assert.equal(
    format(
      { seconds: 33, milliseconds: 111, microseconds: 222, nanoseconds: 333 },
      { style: "digital", fractionalDigits: 4 },
    ).text,
    "0:00:33.1112",
  );
  assert.equal(
    format(
      { seconds: -3, milliseconds: -444, microseconds: -55, nanoseconds: -6 },
      { microseconds: "numeric" },
    ).text,
    "-3 sec, 444.055006 ms",
  );
});
