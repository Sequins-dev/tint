import assert from "node:assert/strict";
import test from "node:test";
import { readPosixTimeZone, type TzifZone } from "@tint/foundation/chrono/tzif";
import { createDateTimePartsFormatter } from "../src/objects/date-time-parts.ts";
import { createDateTimeZoneProfile } from "../src/objects/date-time-zone-data.ts";
import {
  dateTimeZoneName,
  type DateTimeZoneNameFormatter,
} from "../src/objects/date-time-zone-name.ts";
import type { TemporalTimeZone } from "../src/objects/temporal-time-zone.ts";
import { numberFormatLocaleRows } from "../src/objects/number-format-data.ts";
function formatter(
  locale = "en",
  region = "US",
  numberingSystem: string | undefined = undefined,
): DateTimeZoneNameFormatter {
  const data = createDateTimeZoneProfile(locale),
    parts = createDateTimePartsFormatter(locale, "gregory", numberingSystem);
  assert.ok(data && parts);
  return { data, numeric: parts.numeric, twoDigits: parts.twoDigits, region };
}
function named(identifier: string, rules: string): TemporalTimeZone {
  const parsed = readPosixTimeZone(rules, true);
  assert.ok(parsed.ok);
  const model: TzifZone = {
    data: {
      version: 0,
      transitions: [],
      types: [
        {
          offsetSeconds: 0,
          daylightSaving: false,
          designation: [],
          standard: false,
          universal: false,
        },
      ],
      footer: undefined,
    },
    transitionSeconds: [],
    future: parsed.value,
    futureStatus: "ready",
    unspecifiedOffsetPolicy: "stored",
  };
  return { kind: "named", identifier, primaryIdentifier: identifier, model };
}
const january = Date.UTC(2024, 0, 1) / 1000,
  july = Date.UTC(2024, 6, 1) / 1000;
const pacific = "PST8PDT,M3.2.0,M11.1.0";
test("specific and generic names select localized zone/metazone forms at the exact instant", () => {
  const f = formatter(),
    zone = named("America/Los_Angeles", pacific);
  assert.equal(dateTimeZoneName(f, zone, january, "short"), "PST");
  assert.equal(dateTimeZoneName(f, zone, july, "short"), "PDT");
  assert.equal(
    dateTimeZoneName(f, zone, january, "long"),
    "Pacific Standard Time",
  );
  assert.equal(
    dateTimeZoneName(f, zone, july, "long"),
    "Pacific Daylight Time",
  );
  assert.equal(dateTimeZoneName(f, zone, july, "shortGeneric"), "PT");
  assert.equal(
    dateTimeZoneName(f, zone, january, "longGeneric"),
    "Pacific Time",
  );
  assert.equal(
    dateTimeZoneName(f, named("US/Pacific", pacific), january, "short"),
    "PST",
  );
});
test("reference-zone fallbacks preserve country and city qualifiers", () => {
  const zone = named("America/Vancouver", pacific);
  assert.equal(
    dateTimeZoneName(formatter("en", "CA"), zone, july, "longGeneric"),
    "Pacific Time",
  );
  assert.equal(
    dateTimeZoneName(formatter(), zone, july, "longGeneric"),
    "Pacific Time (Canada)",
  );
  assert.equal(
    dateTimeZoneName(
      formatter(),
      named("America/Phoenix", "MST7"),
      july,
      "longGeneric",
    ),
    "Mountain Time (Phoenix)",
  );
});
test("negative seasonal adjustments retain recognizable standard and daylight names", () => {
  const f = formatter("en", "IE"),
    zone = named("Europe/Dublin", "IST-1GMT0,M10.5.0,M3.5.0/1");
  assert.equal(
    dateTimeZoneName(f, zone, january, "long"),
    "Greenwich Mean Time",
  );
  assert.equal(dateTimeZoneName(f, zone, july, "long"), "Irish Standard Time");
  assert.equal(dateTimeZoneName(f, zone, july, "longGeneric"), "Irish Time");
});
test("single-type metazones fall back to their standard name", () => {
  const zone = named("Asia/Kolkata", "IST-5:30");
  assert.equal(
    dateTimeZoneName(formatter(), zone, july, "longGeneric"),
    "India Standard Time",
  );
});
test("generic fallback inspects short seasonal changes inside the 184-day window", () => {
  const f = formatter("ast", "GB");
  assert.equal(
    dateTimeZoneName(f, named("Europe/London", "GMT0"), july, "longGeneric"),
    "Hora media de Greenwich",
  );
  for (const rules of ["GMT0BST-1,M3.1.0,M3.1.1", "GMT0BST0,M3.1.0,M3.1.1"])
    assert.equal(
      dateTimeZoneName(f, named("Europe/London", rules), july, "longGeneric"),
      "Hora de RX",
    );
  const base = named("Europe/London", "GMT0");
  assert.equal(base.kind, "named");
  if (base.kind !== "named") throw new Error("zone invariant");
  const times = [
    Date.UTC(2024, 2, 3) / 1000,
    Date.UTC(2024, 2, 4) / 1000,
    Date.UTC(2026, 0, 1) / 1000,
  ];
  const model: TzifZone = {
    ...base.model,
    data: {
      version: 0,
      transitions: times.map((at, index) => ({
        at: { hi: 0, lo: at },
        type: index === 0 ? 1 : 0,
      })),
      types: [
        {
          offsetSeconds: 0,
          daylightSaving: false,
          designation: [],
          standard: false,
          universal: false,
        },
        {
          offsetSeconds: 0,
          daylightSaving: true,
          designation: [],
          standard: false,
          universal: false,
        },
      ],
      footer: undefined,
    },
    transitionSeconds: times,
    future: undefined,
    futureStatus: "absent",
  };
  assert.equal(
    dateTimeZoneName(f, { ...base, model }, july, "longGeneric"),
    "Hora de RX",
  );
  assert.equal(
    dateTimeZoneName(
      formatter(),
      named("Africa/Bissau", "GMT0"),
      Date.UTC(1974, 0, 1) / 1000,
      "longGeneric",
    ),
    "Guinea-Bissau Time",
  );
});
test("localized offsets preserve padding, subminute seconds, signs and digits", () => {
  const f = formatter(),
    zone: TemporalTimeZone = {
      kind: "fixed",
      identifier: "+05:30",
      offsetNanoseconds: 19800e9,
    };
  assert.equal(dateTimeZoneName(f, zone, july, "shortOffset"), "GMT+5:30");
  assert.equal(dateTimeZoneName(f, zone, july, "longOffset"), "GMT+05:30");
  const seconds: TemporalTimeZone = {
    kind: "fixed",
    identifier: "-00:25:21",
    offsetNanoseconds: -1521e9,
  };
  assert.equal(
    dateTimeZoneName(f, seconds, july, "longOffset"),
    "GMT-00:25:21",
  );
  assert.equal(
    dateTimeZoneName(formatter("ar", "EG", "arab"), zone, july, "shortOffset"),
    "غرينتش+٥:٣٠",
  );
});
test("UTC names, explicit zero offsets and invalid formatter context remain distinct", () => {
  const f = formatter(),
    utc: TemporalTimeZone = {
      kind: "fixed",
      identifier: "UTC",
      offsetNanoseconds: 0,
    };
  assert.equal(dateTimeZoneName(f, utc, january, "short"), "UTC");
  assert.equal(
    dateTimeZoneName(f, utc, january, "long"),
    "Coordinated Universal Time",
  );
  assert.equal(
    dateTimeZoneName(
      f,
      { ...utc, identifier: "+00:00" },
      january,
      "shortOffset",
    ),
    "GMT+0",
  );
  assert.equal(dateTimeZoneName(f, utc, NaN, "short"), undefined);
  assert.equal(dateTimeZoneName(f, utc, january, "invalid"), undefined);
});
test("offset rendering covers every locale's hour-pattern shape", () => {
  const zone: TemporalTimeZone = {
    kind: "fixed",
    identifier: "-05:30:30",
    offsetNanoseconds: -19830e9,
  };
  for (const row of numberFormatLocaleRows.split("\n")) {
    const locale = row.slice(0, row.indexOf("|")),
      f = formatter(locale);
    for (const style of ["shortOffset", "longOffset"])
      assert.ok(dateTimeZoneName(f, zone, july, style), locale + "/" + style);
  }
});
test("specific zero-offset names use GMT while numeric offset styles retain explicit zero", () => {
  const f = formatter(),
    zone: TemporalTimeZone = {
      kind: "fixed",
      identifier: "+00:00",
      offsetNanoseconds: 0,
    };
  assert.equal(dateTimeZoneName(f, zone, january, "short"), "GMT");
  assert.equal(
    dateTimeZoneName(f, zone, january, "long"),
    "Greenwich Mean Time",
  );
  assert.equal(dateTimeZoneName(f, zone, january, "shortOffset"), "GMT+0");
  assert.equal(dateTimeZoneName(f, zone, january, "longOffset"), "GMT+00:00");
});
