import assert from "node:assert/strict";
import test from "node:test";
import * as duration from "../src/chrono/temporal-duration/index.ts";
test("default largest duration unit follows the first nonzero field and zero uses nanoseconds", () => {
  for (const [fields, expected] of [
    [[], "nanosecond"],
    [[1], "year"],
    [[0, 2], "month"],
    [[0, 0, 1], "week"],
    [[0, 0, 0, 1], "day"],
    [[0, 0, 0, 0, -5], "hour"],
    [[0, 0, 0, 0, 0, 0, 0, 0, 1], "microsecond"],
  ] as const) {
    const data = duration.createDuration(fields);
    assert.ok(data);
    assert.equal(duration.durationLargestUnit(data), expected);
  }
});
