import assert from "node:assert/strict";
import test from "node:test";
import { formatInteger } from "@tint/foundation/numeric/big-integer";
import {
  createDuration,
  durationTimeNanoseconds,
} from "../src/chrono/temporal-duration/index.ts";
test("duration time totals preserve exact nanoseconds and leave calendar units to callers", () => {
  for (const fields of [
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    [-1, -2, -3, -4, -5, -6, -7, -8, -9, -10],
    [0, 0, 0, 0, 0, 0, 9007199254740991, 999, 999, 999],
  ]) {
    const d = createDuration(fields)!;
    assert.ok(d);
    const expected =
      BigInt(d.hours) * 3600000000000n +
      BigInt(d.minutes) * 60000000000n +
      BigInt(d.seconds) * 1000000000n +
      BigInt(d.milliseconds) * 1000000n +
      BigInt(d.microseconds) * 1000n +
      BigInt(d.nanoseconds);
    assert.equal(
      formatInteger(durationTimeNanoseconds(d), 10),
      String(expected),
    );
  }
});
