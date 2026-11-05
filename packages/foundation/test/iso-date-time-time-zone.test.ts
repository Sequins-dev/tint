import assert from "node:assert/strict";
import test from "node:test";
import * as iso from "../src/chrono/iso-date-time/index.ts";
test("time-zone strings select annotations before Z and raw minute offsets", () => {
  for (const [input, expected] of [
    ["UTC", "UTC"],
    ["America/New_York", "America/New_York"],
    ["+0146", "+0146"],
    ["2021-08-19T17:30:45.123456789-12:12[+01:46]", "+01:46"],
    ["2021-08-19T17:30Z[+01]", "+01"],
    ["2021-08-19T17:30Z", "UTC"],
    ["T17:30-01:46", "-01:46"],
    ["2021-08[UTC]", "UTC"],
    ["--08-19[UTC]", "UTC"],
    ["2021-08-19T17:30-12:12:59.9[UTC]", "UTC"],
  ])
    assert.equal(iso.parseISOTimeZoneString(input!), expected, input);
  for (const input of [
    "Z",
    "z",
    "",
    "-12:12:00",
    "2021-08-19T17:30-12:12:00",
    "2021-08-19",
    "T17:30",
    "2021-08-19T17:30Z[+01:23:45]",
    "2021-08-19T17:30Z[!x-foo=bar]",
  ])
    assert.equal(iso.parseISOTimeZoneString(input), undefined, input);
});
