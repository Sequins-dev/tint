import { test } from "node:test";
import assert from "node:assert/strict";
import { roundFloat } from "../src/binary/bytes.ts";
test("binary16 rounding is direct from binary64, including ties and double-rounding boundaries", () => {
  const f16round = (Math as unknown as { f16round(value: number): number })
    .f16round;
  for (const value of [
    0,
    -0,
    NaN,
    Infinity,
    -Infinity,
    65504,
    65519,
    65520,
    1.00048828125,
    1.0004882812500002,
    1.00146484375,
    2 ** -25,
    2 ** -24,
    Number.MIN_VALUE,
    Number.MAX_VALUE,
  ]) {
    assert.ok(Object.is(roundFloat(value, 2), f16round(value)), String(value));
    assert.ok(
      Object.is(roundFloat(-value, 2), f16round(-value)),
      String(-value),
    );
  }
});
test("binary32 rounding matches the standard reference across exponent ranges", () => {
  let seed = 42;
  for (let i = 0; i < 5000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const value = (seed / 4294967296 - 0.5) * 2 ** ((i % 2200) - 1100);
    assert.ok(
      Object.is(roundFloat(value, 4), Math.fround(value)),
      String(value),
    );
  }
});
