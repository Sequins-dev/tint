import assert from "node:assert/strict";
import test from "node:test";
import {
  dateLocalCalendarText,
  dateLocalClockText,
} from "../src/objects/date-format.ts";
import { parseDateText } from "../src/objects/date-parse.ts";

test("local clock text retains a precise, readable historical offset", () => {
  assert.equal(
    dateLocalClockText(-17762000, -17762000),
    "19:03:58 GMT-0456 (UTC-04:56:02)",
  );
  assert.equal(dateLocalClockText(19800000, 19800000), "05:30:00 GMT+0530");
  assert.equal(dateLocalClockText(0, 0), "00:00:00 GMT+0000");
});

test("local Date serialization round trips second offsets across epoch limits", () => {
  for (const value of [
    -8640000000000000, -62198755200000, -1000, 0, 1000, 8640000000000000,
  ]) {
    for (const seconds of [
      -90000, -57368, -17762, -1, 0, 1, 19800, 29040, 50400, 90000,
    ]) {
      const local = value + seconds * 1000;
      const text =
        dateLocalCalendarText(local) +
        " " +
        dateLocalClockText(local, seconds * 1000);
      assert.equal(parseDateText(text).value, value, text);
    }
  }
});
