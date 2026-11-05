import assert from "node:assert/strict";
import test from "node:test";
import {
  parseISOTimeString,
  formatISOTimePrecision,
} from "../src/chrono/iso-date-time/index.ts";
test("clock precision formatting pads exact digits and omits seconds for minute precision", () => {
  const clock = parseISOTimeString("12:34:56.12").value!;
  for (const [digits, text] of [
    [-2, "12:34"],
    [-1, "12:34:56.12"],
    [0, "12:34:56"],
    [1, "12:34:56.1"],
    [3, "12:34:56.120"],
    [9, "12:34:56.120000000"],
  ] as const)
    assert.equal(formatISOTimePrecision(clock, digits), text);
  for (const digits of [-3, 1.5, 10, NaN])
    assert.throws(() => formatISOTimePrecision(clock, digits));
});
