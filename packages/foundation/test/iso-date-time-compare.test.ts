import assert from "node:assert/strict";
import test from "node:test";
import {
  parseISODateTime,
  compareISOTime,
  compareISODateTime,
} from "../src/chrono/iso-date-time/index.ts";
test("ISO comparison orders date and clock fields lexicographically through nanoseconds", () => {
  const early = parseISODateTime("1999-12-31T23:59:59.999999999").value!,
    late = parseISODateTime("2000-01-01T00:00").value!;
  assert.equal(compareISODateTime(early, late), -1);
  assert.equal(compareISOTime(early, late), 1);
  const next = parseISODateTime("2000-01-01T00:00:00.000000001").value!;
  assert.equal(compareISODateTime(late, next), -1);
  assert.equal(compareISODateTime(next, late), 1);
  assert.equal(compareISODateTime(next, next), 0);
  assert.equal(compareISOTime(next, next), 0);
});
