import assert from "node:assert/strict";
import test from "node:test";
import * as iso from "../src/chrono/iso-date-time/index.ts";

test("ISO date/time parsing retains calendar, offset and nanosecond information", () => {
  assert.equal(typeof iso.parseISODateTime, "function");
  for (const text of [
    "2000-05-02",
    "20000502",
    "2000-05-02T12:34:56.123456789+02:30",
    "20000502t123456,123456789+0230",
    "2000-05-02 12:34[Asia/Kolkata][u-ca=iso8601]",
    "2000-05-02[!UTC][!u-ca=iso8601]",
    "2000-05-02[foo=Ignore-This-999999999999]",
    "2000-05-02[u-ca=iso8601][u-ca=discord]",
  ]) {
    const result = iso.parseISODateTime(text);
    assert.equal(result.error, "none", text);
    assert.deepEqual(result.value!.date, { year: 2000, month: 5, day: 2 });
  }
  const result = iso.parseISODateTime(
    "2000-05-02T12:34:56.123456789+02:30",
  ).value!;
  assert.equal(result.nanosecond, 123456789);
  assert.equal(result.offsetNanoseconds, 9000000000000);
  assert.equal(result.utc, false);
  assert.equal(result.hasTime, true);
  assert.equal(iso.parseISODateTime("2016-12-31T23:59:60").value!.second, 59);
  assert.equal(iso.parseISODateTime("2000-05-02T00Z").value!.utc, true);
});

test("ISO grammar rejects malformed dates, clocks, offsets and annotations", () => {
  for (const text of [
    "",
    "2000-02-30",
    "2000-5-02",
    "2000-0502",
    "-000000-01-01",
    "2000-05-02T24:00",
    "2000-05-02T12:60",
    "2000-05-02T12:34:61",
    "2000-05-02T12.5",
    "2000-05-02T12:3456",
    "2000-05-02T12:34:56.1234567890",
    "2000-05-02Z",
    "2000-05-02+00:00",
    "2000-05-02T12:34+24:00",
    "2000-05-02T12:34−02:00",
    "2000-05-02[U-CA=iso8601]",
    "2000-05-02[!foo=bar]",
    "2000-05-02[u-ca=iso8601][!u-ca=iso8601]",
    "2000-05-02[!u-ca=iso8601][u-ca=iso8601]",
    "2000-05-02[UTC][UTC]",
    "2000-05-02[UTC]junk",
  ])
    assert.equal(iso.parseISODateTime(text).error, "invalid", text);
});

test("clock fractions and signed offsets stay on the exact nanosecond grid", () => {
  for (const [suffix, expected] of [
    ["+00:00:01.123456789", 1123456789],
    ["-23:59:59.999999999", -86399999999999],
    ["+000001,000000001", 1000000001],
  ] as const) {
    const result = iso.parseISODateTime(
      "2000-01-01T00:00:00.000000001" + suffix,
    );
    assert.equal(result.error, "none");
    assert.equal(result.value!.nanosecond, 1);
    assert.equal(result.value!.offsetNanoseconds, expected);
  }
  for (const text of [
    "2000-01-01T00:00+00:00:60",
    "2000-01-01T00:00Z+00:00",
    "2000-01-01[u-ca=]",
    "2000-01-01[America/../X]",
    "2000-01-01[u-ca=iso8601][UTC]",
  ])
    assert.equal(iso.parseISODateTime(text).error, "invalid", text);
});

test("ISO field formatting preserves extended years and trims fractional zeros", () => {
  assert.equal(typeof iso.formatISODate, "function");
  assert.equal(typeof iso.formatISOTime, "function");
  for (const [text, date, time] of [
    ["2000-05-02T12:34:56.123400000", "2000-05-02", "12:34:56.1234"],
    ["-000001-01-01T00", "-000001-01-01", "00:00:00"],
    ["+010000-01-01T00:00:00.000000001", "+010000-01-01", "00:00:00.000000001"],
  ]) {
    const value = iso.parseISODateTime(text!).value!;
    assert.equal(iso.formatISODate(value.date), date);
    assert.equal(iso.formatISOTime(value), time);
  }
});

test("numeric time-zone annotations accept hour-only, basic and extended minute offsets", () => {
  for (const zone of ["+00", "-00", "+12", "-23", "+0130", "-01:30"]) {
    const text = "1976-11-18T15:23:30.123456789Z[" + zone + "]";
    const parsed = iso.parseISODateTime(text);
    assert.equal(parsed.error, "none", zone);
    assert.equal(parsed.value!.timeZone, zone);
  }
  for (const zone of ["+24", "-24", "+01:00:00", "+1", "+01:60"])
    assert.equal(
      iso.parseISODateTime("2000-01-01T00:00[" + zone + "]").error,
      "invalid",
      zone,
    );
});

test("offset syntax preserves explicit seconds independently of their numeric value", () => {
  for (const [suffix, expected] of [
    ["", false],
    ["Z", false],
    ["+01", false],
    ["+0130", false],
    ["+01:30", false],
    ["+013000", true],
    ["+01:30:00", true],
    ["-01:30:00.001", true],
  ] as const) {
    const result = iso.parseISODateTime("1880-01-01T12:00" + suffix);
    assert.equal(result.error, "none");
    assert.equal(result.offsetHasSeconds, expected, suffix);
  }
});
