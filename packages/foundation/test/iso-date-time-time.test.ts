import assert from "node:assert/strict";
import test from "node:test";
import { parseISOTimeString } from "../src/chrono/iso-date-time/index.ts";
test("time-string grammar preserves offsets and annotations without inventing calendar semantics", () => {
  for (const text of [
    "12:34:56.987654321",
    "T123456.987654321",
    "2000-02-29T12:34:56.987654321",
    "12:34:56.987654321-02:30[UTC][u-ca=unknown]",
  ]) {
    const result = parseISOTimeString(text);
    assert.equal(result.error, "none", text);
    assert.equal(result.value!.hour, 12);
    assert.equal(result.value!.nanosecond, 987654321);
  }
  assert.equal(parseISOTimeString("12:34Z").value!.utc, true);
  assert.equal(
    parseISOTimeString("12:34-02:30").value!.offsetNanoseconds,
    -9000000000000,
  );
  for (const text of [
    "2000-02-29",
    "24:00",
    "12:34:56.1234567890",
    " 12:34",
    "T12:34junk",
    "12:34[!unknown=value]",
  ])
    assert.equal(parseISOTimeString(text).error, "invalid", text);
});
test("bare times require T when also valid ISO year-month or month-day strings", () => {
  for (const text of ["2021-12", "202112", "1214", "0229", "1130", "12-14"]) {
    for (const suffix of ["", "[UTC][u-ca=iso8601]"]) {
      assert.equal(
        parseISOTimeString(text + suffix).error,
        "invalid",
        text + suffix,
      );
      assert.equal(
        parseISOTimeString("T" + text + suffix).error,
        "none",
        text + suffix,
      );
    }
  }
  for (const text of [
    "2021-13",
    "202113",
    "0000-00",
    "000000",
    "1314",
    "13-14",
    "1232",
    "0230",
    "0631",
    "0000",
    "00-00",
  ])
    assert.equal(parseISOTimeString(text).error, "none", text);
});
