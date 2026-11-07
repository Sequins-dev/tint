import assert from "node:assert/strict";
import test from "node:test";
import {
  createUnitFormatProfile,
  unitFormatPattern,
  unitFormatDigital,
  createDurationListFormatter,
} from "../src/objects/unit-format.ts";
import { formatList } from "../src/objects/list-format.ts";
import { numberFormatLocaleData } from "../src/objects/number-format-profile.ts";
import { numberFormatLocaleRows } from "../src/objects/number-format-data.ts";

function profile(locale: string) {
  const result = createUnitFormatProfile(locale);
  assert.ok(result, locale);
  return result;
}
test("time unit patterns retain plural categories, labels and locale spacing", () => {
  const en = profile("en-US-u-nu-arab");
  assert.equal(en.locale, "en-US");
  assert.equal(unitFormatPattern(en, "long", "year", "one"), "{0} year");
  assert.equal(unitFormatPattern(en, "long", "year", "other"), "{0} years");
  assert.equal(unitFormatPattern(en, "short", "month", "other"), "{0} mths");
  assert.equal(
    unitFormatPattern(profile("fr"), "long", "year", "one"),
    "{0}\u00a0an",
  );
  assert.equal(unitFormatPattern(profile("ar"), "long", "year", "one"), "سنة");
  assert.equal(
    unitFormatPattern(profile("ar"), "long", "year", "two"),
    "سنتان",
  );
});
test("digital formats resolve numbering-system separators and hour padding independently", () => {
  assert.deepEqual(unitFormatDigital(profile("en"), "latn"), {
    hourMinuteSeparator: ":",
    minuteSecondSeparator: ":",
    twoDigitHours: false,
  });
  assert.equal(
    unitFormatDigital(profile("fi"), "latn")?.hourMinuteSeparator,
    ".",
  );
  assert.equal(
    unitFormatDigital(profile("fi"), "arab")?.hourMinuteSeparator,
    ":",
  );
  assert.equal(unitFormatDigital(profile("en"), "invalid"), undefined);
});
test("duration lists reuse the shared list engine with actual inherited CLDR unit patterns", () => {
  const en = createDurationListFormatter(profile("en"), "long"),
    fr = createDurationListFormatter(profile("fr"), "long"),
    narrow = createDurationListFormatter(profile("en"), "narrow");
  assert.ok(en && fr && narrow);
  assert.equal(
    formatList(en, ["1 year", "2 months", "3 days"]),
    "1 year, 2 months, 3 days",
  );
  assert.equal(
    formatList(fr, ["1 an", "2 mois", "3 jours"]),
    "1 an, 2 mois et 3 jours",
  );
  assert.equal(formatList(narrow, ["1y", "2m"]), "1y 2m");
});
test("every numeric-service locale has all duration unit widths, digital systems and lists", () => {
  for (const row of numberFormatLocaleRows.split("\n")) {
    const locale = row.slice(0, row.indexOf("|")),
      p = profile(locale),
      numeric = numberFormatLocaleData(locale);
    assert.ok(numeric);
    for (const width of ["long", "short", "narrow"]) {
      assert.ok(createDurationListFormatter(p, width), locale + width);
      for (const unit of [
        "year",
        "month",
        "week",
        "day",
        "hour",
        "minute",
        "second",
        "millisecond",
        "microsecond",
        "nanosecond",
      ]) {
        const pattern = unitFormatPattern(p, width, unit, "other");
        assert.ok(pattern, locale + width + unit);
        assert.ok(pattern.includes("{0}"));
      }
    }
    for (const system of numeric.numberingSystems)
      assert.ok(unitFormatDigital(p, system), locale + system);
  }
});
test("unsupported inputs remain explicit rather than borrowing arbitrary unit data", () => {
  assert.equal(createUnitFormatProfile("qaa"), undefined);
  const en = profile("en");
  assert.equal(unitFormatPattern(en, "long", "meter", "one"), undefined);
  assert.equal(unitFormatPattern(en, "invalid", "year", "one"), undefined);
  assert.equal(createDurationListFormatter(en, "invalid"), undefined);
});
