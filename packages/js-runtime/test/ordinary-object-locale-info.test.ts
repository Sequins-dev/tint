import * as localeInfo from "../src/objects/locale-info.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  localeHourCycles,
  localeTextDirection,
  localeWeekInfo,
  localeTimeZones,
} from "../src/objects/locale-info.ts";
import { localeTerritoryTimeZones } from "../src/objects/locale-data.ts";

test("hour-cycle preferences use language/region data and preserve explicit hour-cycle values", () => {
  assert.deepEqual(localeHourCycles("en-US"), ["h12", "h23"]);
  assert.deepEqual(localeHourCycles("en-GB"), ["h23", "h12"]);
  assert.deepEqual(localeHourCycles("en-US-u-hc-h24"), ["h24"]);
  assert.deepEqual(localeHourCycles("en-u-hc-foo"), ["foo"]);
  assert.deepEqual(localeHourCycles("en-u-rg-gbzzzz"), ["h23", "h12"]);
  assert.deepEqual(localeHourCycles("qaa"), ["h23", "h12"]);
});

test("text direction uses explicit scripts or actual likely-subtag data", () => {
  for (const [tag, expected] of [
    ["en", "ltr"],
    ["ar", "rtl"],
    ["en-Arab", "rtl"],
    ["und-Adlm", "rtl"],
    ["en-Thai", "ltr"],
  ])
    assert.equal(localeTextDirection(tag!), expected, tag);
  assert.equal(localeTextDirection("qaa"), undefined);
  assert.equal(localeTextDirection("en-Zzzz"), undefined);
});

test("week preferences apply region, subdivision and valid overrides in specification order", () => {
  assert.deepEqual(localeWeekInfo("en-US"), { firstDay: 7, weekend: [6, 7] });
  assert.deepEqual(localeWeekInfo("en-GB"), { firstDay: 1, weekend: [6, 7] });
  assert.deepEqual(localeWeekInfo("ar-AF"), { firstDay: 6, weekend: [4, 5] });
  assert.deepEqual(localeWeekInfo("en-u-sd-afkab"), {
    firstDay: 6,
    weekend: [4, 5],
  });
  assert.deepEqual(localeWeekInfo("en-US-u-sd-afkab"), {
    firstDay: 7,
    weekend: [6, 7],
  });
  assert.deepEqual(localeWeekInfo("en-GB-u-rg-afzzzz-fw-mon"), {
    firstDay: 1,
    weekend: [4, 5],
  });
  assert.deepEqual(localeWeekInfo("en-US-u-fw-100"), {
    firstDay: 7,
    weekend: [6, 7],
  });
});

test("time-zone information uses explicit region and canonical common-use catalog", () => {
  assert.equal(localeTimeZones("fr"), undefined);
  assert.equal(localeTimeZones("en-u-rg-uszzzz"), undefined);
  assert.deepEqual(localeTimeZones("fr-FR"), ["Europe/Paris"]);
  assert.deepEqual(localeTimeZones("en-GB"), ["Europe/London"]);
  assert.deepEqual(localeTimeZones("en-ZZ"), []);
  const zones = localeTimeZones("en-US");
  assert.ok(zones?.includes("America/New_York"));
  assert.deepEqual(zones, [...new Set(zones)].sort());
});

test("the complete territory catalog contains sorted unique nonempty canonical zone names", () => {
  let count = 0;
  for (const row of localeTerritoryTimeZones.split("\n")) {
    const [region, value] = row.split("|");
    assert.ok(region && value, row);
    const names = value.split(",");
    for (const name of names)
      assert.ok(name.includes("/") || name === "UTC", region + ": " + name);
    assert.deepEqual(names, [...new Set(names)].sort(), region);
    count++;
  }
  assert.equal(count, 248);
});

test("numbering-system queries use explicit slots or the real formatter default", () => {
  assert.equal(typeof localeInfo.localeNumberingSystems, "function");
  assert.deepEqual(localeInfo.localeNumberingSystems("en"), ["latn"]);
  assert.deepEqual(localeInfo.localeNumberingSystems("ar-EG"), ["arab"]);
  assert.deepEqual(localeInfo.localeNumberingSystems("en-u-nu-arab"), ["arab"]);
  assert.deepEqual(localeInfo.localeNumberingSystems("en-u-nu-foobar"), [
    "foobar",
  ]);
  assert.deepEqual(localeInfo.localeNumberingSystems("en-u-nu"), [""]);
  assert.deepEqual(localeInfo.localeNumberingSystems("zxx"), ["latn"]);
});

test("calendar preferences honor explicit keywords and region, subdivision, likely and override precedence", () => {
  assert.equal(typeof localeInfo.localeCalendars, "function");
  assert.deepEqual(localeInfo.localeCalendars("en-US"), ["gregory"]);
  assert.deepEqual(localeInfo.localeCalendars("th-TH"), [
    "buddhist",
    "gregory",
  ]);
  assert.deepEqual(
    localeInfo.localeCalendars("th"),
    localeInfo.localeCalendars("th-TH"),
  );
  assert.deepEqual(
    localeInfo.localeCalendars("en-u-sd-th10"),
    localeInfo.localeCalendars("en-TH"),
  );
  assert.deepEqual(localeInfo.localeCalendars("en-US-u-sd-th10"), ["gregory"]);
  assert.deepEqual(localeInfo.localeCalendars("en-US-u-rg-thzzzz"), [
    "buddhist",
    "gregory",
  ]);
  assert.deepEqual(localeInfo.localeCalendars("en-u-ca-foobar-rg-thzzzz"), [
    "foobar",
  ]);
  assert.deepEqual(localeInfo.localeCalendars("en-u-ca"), [""]);
  assert.deepEqual(localeInfo.localeCalendars("en-ZZ"), ["gregory"]);
});
test("calendar catalogs are canonical and independent fresh arrays", () => {
  const available = localeInfo.availableLocaleCalendars();
  assert.deepEqual(available, [...new Set(available)].sort());
  assert.ok(available.includes("gregory") && available.includes("iso8601"));
  assert.equal(available.includes("islamicc"), false);
  assert.equal(available.includes("gregorian"), false);
  const first = localeInfo.localeCalendars("fa-IR");
  assert.equal(first[0], "persian");
  for (const name of first) assert.ok(available.includes(name));
  const second = localeInfo.localeCalendars("fa-IR");
  assert.notEqual(first, second);
});

test("collation metadata uses canonical sorted inherited types without maximizing unknown languages", () => {
  assert.deepEqual(localeInfo.localeCollations("de-DE"), [
    "emoji",
    "eor",
    "phonebk",
  ]);
  assert.deepEqual(localeInfo.localeCollations("es-MX"), [
    "emoji",
    "eor",
    "trad",
  ]);
  assert.deepEqual(localeInfo.localeCollations("qaa"), ["emoji", "eor"]);
  assert.deepEqual(localeInfo.localeCollations("und-DE"), ["emoji", "eor"]);
  assert.deepEqual(
    localeInfo.localeCollations("zh-Hant"),
    localeInfo.localeCollations("zh"),
  );
  assert.deepEqual(
    localeInfo.localeCollations("yue"),
    localeInfo.localeCollations("zh-Hant"),
  );
  assert.ok(localeInfo.localeCollations("zh").includes("pinyin"));
  assert.ok(!localeInfo.localeCollations("zh").includes("private-unihan"));
  assert.ok(!localeInfo.localeCollations("en").includes("standard"));
  assert.ok(!localeInfo.localeCollations("en").includes("search"));
});
test("collation metadata preserves explicit unsupported and empty keywords with fresh lists", () => {
  for (const [tag, value] of [
    ["en-u-co", ""],
    ["en-u-co-foobar", "foobar"],
    ["de-u-co-phonebk", "phonebk"],
  ])
    assert.deepEqual(localeInfo.localeCollations(tag!), [value]);
  const first = localeInfo.localeCollations("de"),
    second = localeInfo.localeCollations("de");
  first[0] = "changed";
  assert.deepEqual(second, ["emoji", "eor", "phonebk"]);
});
