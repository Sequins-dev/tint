import assert from "node:assert/strict";
import test from "node:test";
import { resolveDateTimeLocale } from "../src/objects/date-time-locale.ts";
import { canonicalizeLocaleId } from "../src/objects/locale-canonicalization.ts";
import { numberFormatLocaleRows } from "../src/objects/number-format-data.ts";
import { createDateTimePartsFormatter } from "../src/objects/date-time-parts.ts";
function resolve(
  tag: string,
  calendar?: string,
  numberingSystem?: string,
  hourCycle?: string,
  hour12?: boolean,
) {
  const canonical = canonicalizeLocaleId(tag);
  assert.ok(canonical);
  return resolveDateTimeLocale(
    [canonical],
    calendar,
    numberingSystem,
    hourCycle,
    hour12,
  );
}
test("calendar negotiation retains supported extensions unless a supported option overrides them", () => {
  for (const [tag, option, locale, calendar] of [
    ["en-u-ca-iso8601", "invalid", "en-u-ca-iso8601", "iso8601"],
    ["en-u-ca-invalid", "invalid2", "en", "gregory"],
    ["en-u-ca-gregory", "iso8601", "en", "iso8601"],
    ["en-u-ca-iso8601", "iso8601", "en-u-ca-iso8601", "iso8601"],
    ["en-u-ca-islamicc", undefined, "en-u-ca-islamic-civil", "islamic-civil"],
  ]) {
    const actual = resolve(tag!, option);
    assert.equal(actual.locale, locale);
    assert.equal(actual.calendar, calendar);
  }
});
test("deprecated Islamic calendars resolve to an available arithmetic family", () => {
  for (const calendar of ["islamic", "islamic-rgsa"]) {
    assert.equal(resolve("en", calendar).calendar, "islamic-civil");
    assert.equal(resolve("en-u-ca-" + calendar).calendar, "islamic-civil");
  }
});
test("hour-cycle options override extensions and hour12 suppresses the extension", () => {
  for (const cycle of ["h11", "h12", "h23", "h24"])
    assert.equal(resolve("de-u-hc-" + cycle).hourCycle, cycle);
  assert.equal(
    resolve("en-u-hc-h12", undefined, undefined, "h23").locale,
    "en",
  );
  for (const locale of ["en", "fr", "it", "ja", "zh", "ko", "ar", "hi"]) {
    const twelve = resolve(
      locale + "-u-hc-h24",
      undefined,
      undefined,
      "h23",
      true,
    );
    assert.equal(twelve.hourCycle, locale === "ja" ? "h11" : "h12");
    assert.equal(twelve.locale, locale);
    assert.equal(
      resolve(locale, undefined, undefined, "h12", false).hourCycle,
      "h23",
    );
  }
});
test("ca/hc/nu negotiate independently and retain canonical extension order", () => {
  const actual = resolve("en-u-ca-hebrew-hc-h24-nu-arab", "invalid", "invalid");
  assert.equal(actual.locale, "en-u-ca-hebrew-hc-h24-nu-arab");
  assert.equal(actual.calendar, "hebrew");
  assert.equal(actual.numberingSystem, "arab");
  const overridden = resolve(
    "en-u-ca-hebrew-hc-h24-nu-arab",
    "iso8601",
    "latn",
  );
  assert.equal(overridden.locale, "en-u-hc-h24");
  assert.equal(overridden.numberingSystem, "latn");
});
test("lookup skips unsupported requests and every shipped locale resolves usable defaults", () => {
  assert.equal(
    resolveDateTimeLocale(
      ["qaa", "fr-CA"],
      undefined,
      undefined,
      undefined,
      undefined,
    ).dataLocale,
    "fr-CA",
  );
  assert.equal(resolve("qaa").locale, "en");
  for (const row of numberFormatLocaleRows.split("\n")) {
    const tag = row.slice(0, row.indexOf("|"));
    const actual = resolve(tag);
    assert.ok(
      createDateTimePartsFormatter(
        actual.dataLocale,
        actual.calendar,
        actual.numberingSystem,
      ),
      tag,
    );
    assert.ok(["h11", "h12", "h23", "h24"].includes(actual.hourCycle), tag);
    assert.notEqual(actual.region, "");
  }
});
