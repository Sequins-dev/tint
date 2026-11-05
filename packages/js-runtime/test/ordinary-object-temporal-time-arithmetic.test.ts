import assert from "node:assert/strict";
import test from "node:test";
import {
  parseInteger,
  formatInteger,
} from "@tint/foundation/numeric/big-integer";
import {
  splitClockNanoseconds,
  clockNanoseconds,
} from "../src/objects/temporal-time-arithmetic.ts";
test("clock splitting floors arbitrary signed totals and retains an exact bounded clock", () => {
  const day = 86400000000000n;
  for (const value of [
    -1n,
    0n,
    1n,
    day - 1n,
    day,
    day + 1n,
    -day,
    -day - 1n,
    9007199254740991999999999n,
    -9007199254740991999999999n,
    1n << 256n,
    -(1n << 256n),
  ]) {
    const split = splitClockNanoseconds(parseInteger(String(value), 10)!);
    let quotient = value / day,
      remainder = value % day;
    if (remainder < 0n) {
      quotient--;
      remainder += day;
    }
    assert.equal(formatInteger(split.days, 10), String(quotient));
    assert.equal(
      formatInteger(clockNanoseconds(split.time), 10),
      String(remainder),
    );
    assert.ok(split.time.hour >= 0 && split.time.hour < 24);
  }
});
