import assert from "node:assert/strict";
import test from "node:test";
import {
  createDateTimeCalendarProfile,
  dateTimeCalendarValue,
  dateTimeCalendarEntries,
} from "../src/objects/date-time-calendar.ts";
import { numberFormatLocaleRows } from "../src/objects/number-format-data.ts";
import {
  parseDateTimePattern,
  dateTimePatternFields,
} from "../src/objects/date-time-pattern.ts";

function profile(locale: string, calendar = "gregory") {
  const result = createDateTimeCalendarProfile(locale, calendar);
  assert.ok(result, locale + "/" + calendar);
  return result;
}
test("calendar profiles resolve locale inheritance and LDML format aliases", () => {
  const en = profile("en-US-u-ca-buddhist", "buddhist");
  assert.equal(en.locale, "en-US");
  assert.equal(dateTimeCalendarValue(en, "months", "format.wide.1"), "January");
  assert.equal(
    dateTimeCalendarValue(profile("en-GB"), "styles", "D.short"),
    "dd/MM/y",
  );
  assert.equal(
    dateTimeCalendarValue(profile("en"), "styles", "A.long"),
    "{1} 'at' {0}",
  );
  assert.equal(
    dateTimeCalendarValue(profile("en"), "styles", "A.short"),
    "{1}, {0}",
  );
  assert.equal(createDateTimeCalendarProfile("zz-ZZ", "gregory"), undefined);
  assert.equal(createDateTimeCalendarProfile("en", "unknown"), undefined);
});
test("calendar names retain leap identities, eras and cyclic years", () => {
  assert.equal(
    dateTimeCalendarValue(profile("en"), "appendItems", "label.Second"),
    "second",
  );
  const he = profile("en", "hebrew");
  assert.equal(dateTimeCalendarValue(he, "months", "format.wide.6"), "Adar I");
  assert.equal(
    dateTimeCalendarValue(he, "months", "format.wide.7leap"),
    "Adar II",
  );
  assert.equal(
    dateTimeCalendarValue(profile("en", "coptic"), "eras", "abbreviated.1"),
    "AM",
  );
  assert.equal(
    dateTimeCalendarValue(
      profile("en", "islamic-civil"),
      "eras",
      "abbreviated.1",
    ),
    "BH",
  );
  assert.equal(
    dateTimeCalendarValue(profile("ja", "japanese"), "eras", "wide.236"),
    "令和",
  );
  assert.equal(
    dateTimeCalendarValue(
      profile("zh", "chinese"),
      "leapMonths",
      "format.wide",
    ),
    "闰{0}",
  );
  assert.equal(
    dateTimeCalendarValue(profile("zh", "chinese"), "cyclicYears", "wide.1"),
    "甲子",
  );
});
test("all advertised locales have complete styles and month/day names for every calendar", () => {
  const calendars = [
    "gregory",
    "iso8601",
    "buddhist",
    "japanese",
    "roc",
    "coptic",
    "ethiopic",
    "ethioaa",
    "indian",
    "persian",
    "islamic-civil",
    "islamic-tbla",
    "islamic-umalqura",
    "hebrew",
    "chinese",
    "dangi",
  ];
  for (const row of numberFormatLocaleRows.split("\n")) {
    const locale = row.slice(0, row.indexOf("|"));
    for (const calendar of calendars) {
      const data = profile(locale, calendar);
      for (const style of ["full", "long", "medium", "short"]) {
        assert.ok(dateTimeCalendarValue(data, "styles", "D." + style));
        assert.ok(dateTimeCalendarValue(data, "styles", "T." + style));
        assert.ok(dateTimeCalendarValue(data, "styles", "C." + style));
      }
      assert.ok(dateTimeCalendarValue(data, "intervals", "fallback"));
      for (const width of ["wide", "abbreviated", "narrow"]) {
        assert.ok(
          dateTimeCalendarValue(data, "months", "format." + width + ".1"),
        );
        assert.ok(
          dateTimeCalendarValue(data, "days", "format." + width + ".sun"),
        );
      }
    }
  }
});
test("generated available formats preserve supported fields and fresh entry arrays", () => {
  const data = profile("en");
  const first = dateTimeCalendarEntries(data, "patterns");
  assert.ok(first.length > 20);
  assert.notEqual(first, dateTimeCalendarEntries(data, "patterns"));
  for (const entry of first) {
    const tokens = parseDateTimePattern(entry.value);
    assert.ok(tokens, entry.key);
    assert.ok(dateTimePatternFields(tokens), entry.key + ": " + entry.value);
  }
  assert.equal(dateTimeCalendarValue(data, "patterns", "missing"), undefined);
});
