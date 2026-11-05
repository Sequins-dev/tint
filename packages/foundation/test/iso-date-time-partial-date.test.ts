import assert from "node:assert/strict";
import test from "node:test";
import {
  parseISOYearMonthString,
  parseISOMonthDayString,
} from "../src/chrono/iso-date-time/index.ts";
test("partial ISO dates parse basic/extended components and preserve full reference dates", () => {
  for (const text of [
    "1976-11",
    "197611",
    "+00197611",
    "1976-11[u-ca=iso8601]",
  ])
    assert.deepEqual(parseISOYearMonthString(text).value!.date, {
      year: 1976,
      month: 11,
      day: 1,
    });
  assert.deepEqual(parseISOYearMonthString("-271821-04-01T12:34").value!.date, {
    year: -271821,
    month: 4,
    day: 1,
  });
  for (const text of ["02-29", "0229", "--02-29", "--0229"])
    assert.deepEqual(parseISOMonthDayString(text).value!.date, {
      year: 1972,
      month: 2,
      day: 29,
    });
  assert.deepEqual(parseISOMonthDayString("2000-02-29T12:34").value!.date, {
    year: 2000,
    month: 2,
    day: 29,
  });
});
test("partial ISO dates reject malformed forms without accepting time-only strings", () => {
  for (const text of [
    "1976-13",
    "1976-1",
    "-000000-01",
    "1976-11Z",
    "1976-11+00:00",
    "T12:34",
    "1976-11junk",
  ])
    assert.equal(parseISOYearMonthString(text).error, "invalid", text);
  for (const text of [
    "02-30",
    "2-29",
    "--02-29Z",
    "02-29+00:00",
    "12:34",
    "0229junk",
  ])
    assert.equal(parseISOMonthDayString(text).error, "invalid", text);
});

test("abbreviated partial dates require an ISO calendar, with ASCII case folding", () => {
  assert.equal(
    parseISOYearMonthString("1976-11[u-ca=hebrew]").error,
    "invalid",
  );
  assert.equal(parseISOMonthDayString("02-29[u-ca=chinese]").error, "invalid");
  assert.equal(parseISOYearMonthString("1976-11[u-ca=ISO8601]").error, "none");
  assert.equal(parseISOMonthDayString("02-29[u-ca=ISO8601]").error, "none");
  // Full ISO dates retain calendar metadata for their semantic adapter.
  assert.equal(
    parseISOYearMonthString("1976-11-01[u-ca=hebrew]").error,
    "none",
  );
});
