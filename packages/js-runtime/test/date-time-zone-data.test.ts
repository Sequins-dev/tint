import assert from "node:assert/strict";
import test from "node:test";
import {
  createDateTimeZoneProfile,
  dateTimeZoneValue,
  dateTimeZoneMetazone,
  dateTimeZoneCanonicalName,
  dateTimeZoneReference,
  dateTimeZoneTerritory,
  dateTimeZonePrimary,
  dateTimeDayPeriod,
} from "../src/objects/date-time-zone-data.ts";
import { numberFormatLocaleRows } from "../src/objects/number-format-data.ts";
function profile(locale: string) {
  const result = createDateTimeZoneProfile(locale);
  assert.ok(result);
  return result;
}
test("time-zone names retain localized metazones and source aliases", () => {
  assert.equal(dateTimeZoneValue(profile("en"), "countries", "GB.short"), "UK");
  const en = profile("en-US-u-nu-latn");
  assert.equal(en.locale, "en-US");
  assert.equal(
    dateTimeZoneValue(en, "metazones", "America_Pacific.long.standard"),
    "Pacific Standard Time",
  );
  assert.equal(
    dateTimeZoneValue(en, "metazones", "America_Pacific.short.daylight"),
    "PDT",
  );
  assert.equal(
    dateTimeZoneValue(profile("fr"), "zones", "Europe/London.city"),
    "Londres",
  );
  assert.equal(dateTimeZoneCanonicalName("aSiA/kOlKaTa"), "Asia/Calcutta");
  assert.equal(dateTimeZoneCanonicalName("US/Pacific"), "America/Los_Angeles");
  assert.equal(dateTimeZoneCanonicalName("UTC"), "Etc/UTC");
  assert.equal(dateTimeZoneCanonicalName("Unknown/Zone"), undefined);
});
test("metazone histories use half-open UTC boundaries without extrapolating missing periods", () => {
  const before = Date.UTC(1991, 9, 27, 7) / 1000;
  assert.equal(
    dateTimeZoneMetazone("America/Indiana/Knox", before - 1),
    "America_Central",
  );
  assert.equal(
    dateTimeZoneMetazone("America/Indiana/Knox", before),
    "America_Eastern",
  );
  assert.equal(
    dateTimeZoneMetazone(
      "America/Indiana/Knox",
      Date.UTC(2006, 3, 2, 7) / 1000,
    ),
    "America_Central",
  );
  assert.equal(
    dateTimeZoneMetazone("Africa/Bissau", Date.UTC(1974, 0, 1) / 1000),
    undefined,
  );
  assert.equal(dateTimeZoneMetazone("Asia/Kolkata", 0), "India");
  const monrovia = Date.UTC(1972, 0, 7, 0, 44, 30) / 1000;
  assert.equal(
    dateTimeZoneMetazone("Africa/Monrovia", monrovia - 1),
    undefined,
  );
  assert.equal(dateTimeZoneMetazone("Africa/Monrovia", monrovia), "GMT");
  assert.equal(
    dateTimeZoneReference("America_Pacific", "CA"),
    "America/Vancouver",
  );
  assert.equal(
    dateTimeZoneReference("America_Pacific", "ZZ"),
    "America/Los_Angeles",
  );
  assert.equal(dateTimeZoneTerritory("US/Pacific"), "US");
  assert.equal(dateTimeZoneTerritory("Europe/Belgrade"), "RS");
  assert.equal(dateTimeZonePrimary("DE"), "Europe/Berlin");
});
test("flexible day periods resolve locale parents, exact instants and midnight-spanning rules", () => {
  const en = profile("en-GB");
  for (const [seconds, name] of [
    [0, "midnight"],
    [0.1, "morning1"],
    [43200, "noon"],
    [43200.1, "afternoon1"],
    [64800, "evening1"],
    [75600, "night1"],
  ] as const)
    assert.equal(dateTimeDayPeriod(en, seconds), name);
  assert.equal(dateTimeDayPeriod(profile("fr"), 3600), "night1");
  assert.equal(dateTimeDayPeriod(profile("zh"), 9 * 3600), "morning2");
  assert.equal(dateTimeDayPeriod(en, 86400), undefined);
  assert.equal(dateTimeDayPeriod(en, NaN), undefined);
});
test("every supported locale has required zone patterns and day-period coverage", () => {
  for (const row of numberFormatLocaleRows.split("\n")) {
    const locale = row.slice(0, row.indexOf("|")),
      data = profile(locale);
    for (const name of [
      "hourFormat",
      "gmtFormat",
      "regionFormat",
      "fallbackFormat",
      "regionFormat.standard",
      "regionFormat.daylight",
    ])
      assert.ok(dateTimeZoneValue(data, "formats", name), locale + "/" + name);
    for (let hour = 0; hour < 24; hour++)
      assert.equal(
        typeof dateTimeDayPeriod(data, hour * 3600 + 1),
        "string",
        locale + "/" + hour,
      );
  }
});
