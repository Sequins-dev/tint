import { test } from "node:test";
import assert from "node:assert/strict";
import * as relative from "../src/objects/relative-time.ts";
import { createDecimalNumberFormatter } from "../src/objects/decimal-number-format.ts";
import { resolveNumberFormatDigitOptions } from "../src/objects/intl-number-options.ts";
function formatter(
  locale = "en",
  numeric: "auto" | "always" = "always",
  style: "long" | "short" | "narrow" = "long",
  system = "latn",
) {
  const digits = resolveNumberFormatDigitOptions(
    {
      read: () => undefined,
      number: Number,
      string: String,
      reject: (kind) => {
        throw Error(kind);
      },
    },
    0,
    3,
    "standard",
  );
  const number = createDecimalNumberFormatter(
    locale,
    system,
    digits,
    "auto",
    "auto",
  );
  assert.ok(number);
  const result = relative.createRelativeTimeFormatter(number, style, numeric);
  assert.ok(result);
  return result;
}
function text(f: ReturnType<typeof formatter>, value: number, unit: string) {
  const parts = relative.relativeTimeParts(f, value, unit);
  assert.ok(parts);
  return parts.map((p) => p.value).join("");
}
test("relative time distinguishes negative zero, auto literals and canonical plural units", () => {
  const always = formatter(),
    auto = formatter("en", "auto");
  assert.equal(text(always, -1, "days"), "1 day ago");
  assert.equal(text(always, 1, "day"), "in 1 day");
  assert.equal(text(always, -0, "day"), "0 days ago");
  assert.equal(text(always, 0, "day"), "in 0 days");
  assert.equal(text(auto, -0, "day"), "today");
  assert.equal(text(auto, 0, "second"), "now");
  assert.equal(text(formatter("es", "auto"), 2, "days"), "pasado mañana");
  assert.equal(text(formatter("es", "auto"), -2, "days"), "anteayer");
});
test("relative parts attach units only to inserted number parts, including localized grouping", () => {
  const f = formatter("en-US", "always", "long", "deva"),
    parts = relative.relativeTimeParts(f, 1234.5, "days");
  assert.ok(parts);
  assert.deepEqual(parts, [
    { type: "literal", value: "in ", unit: undefined },
    { type: "integer", value: "१", unit: "day" },
    { type: "group", value: ",", unit: "day" },
    { type: "integer", value: "२३४", unit: "day" },
    { type: "decimal", value: ".", unit: "day" },
    { type: "fraction", value: "५", unit: "day" },
    { type: "literal", value: " days", unit: undefined },
  ]);
  const automatic = relative.relativeTimeParts(
    formatter("en", "auto"),
    -1,
    "day",
  );
  assert.deepEqual(automatic, [
    { type: "literal", value: "yesterday", unit: undefined },
  ]);
  const arabic = relative.relativeTimeParts(formatter("ar"), 1, "year");
  assert.ok(arabic);
  assert.ok(arabic.every((p) => p.unit === undefined));
});
test("relative formatting covers every unit/style and refuses invalid values and units", () => {
  for (const locale of ["en", "es", "ar", "fr", "ja"])
    for (const style of ["long", "short", "narrow"] as const)
      for (const unit of [
        "second",
        "minute",
        "hour",
        "day",
        "week",
        "month",
        "quarter",
        "year",
      ])
        for (const value of [-2, 0, 2])
          assert.notEqual(
            text(formatter(locale, "always", style), value, unit),
            "",
          );
  const f = formatter();
  for (const value of [NaN, Infinity, -Infinity])
    assert.equal(relative.relativeTimeParts(f, value, "day"), undefined);
  for (const unit of ["", "DAY", "dayss", "millisecond"])
    assert.equal(relative.relativeTimeParts(f, 1, unit), undefined);
});
