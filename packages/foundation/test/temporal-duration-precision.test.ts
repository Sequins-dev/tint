import assert from "node:assert/strict";
import test from "node:test";
import {
  createDuration,
  durationText,
} from "../src/chrono/temporal-duration/index.ts";
test("duration text retains requested trailing zeros and explicit seconds on date-only values", () => {
  const value = createDuration([1, 2, 0, 3, 4, 5, 6, 120]);
  assert.ok(value);
  assert.equal(durationText(value, 3), "P1Y2M3DT4H5M6.120S");
  assert.equal(durationText(value, 9), "P1Y2M3DT4H5M6.120000000S");
  const date = createDuration([1]);
  assert.ok(date);
  assert.equal(durationText(date, 0), "P1YT0S");
  assert.equal(durationText(date, 2), "P1YT0.00S");
  assert.equal(durationText(date), "P1Y");
});
