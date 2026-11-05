import assert from "node:assert/strict";
import { test } from "node:test";
import { numberExp, numberExpm1 } from "../src/objects/number-exp.ts";

test("exponential functions preserve zeros and exceptional values", () => {
  for (const value of [NaN, Infinity, -Infinity, 0, -0, 1, -1, 710, -746]) {
    for (const [actual, expected] of [
      [numberExp(value), Math.exp(value)],
      [numberExpm1(value), Math.expm1(value)],
    ]) {
      if (!Number.isFinite(expected) || expected === 0)
        assert.ok(Object.is(actual, expected), String(value));
      else
        assert.ok(
          Math.abs(actual! - expected!) <=
            4 * Number.EPSILON * Math.abs(expected!),
          String(value),
        );
    }
  }
});
test("exp range reduction covers overflow and the subnormal tail", () => {
  for (let i = -74500; i <= 70978; i += 7) {
    const value = i / 100,
      expected = Math.exp(value),
      actual = numberExp(value);
    assert.ok(
      Math.abs(actual - expected) <=
        4 * Number.EPSILON * expected + Number.MIN_VALUE,
      `${value}: ${actual} vs ${expected}`,
    );
  }
});
test("expm1 retains tiny input precision and avoids cancellation", () => {
  for (let exponent = -1074; exponent <= 5; exponent++)
    for (const sign of [-1, 1]) {
      const value = sign * 2 ** exponent,
        expected = Math.expm1(value),
        actual = numberExpm1(value);
      assert.ok(
        Math.abs(actual - expected) <=
          4 * Number.EPSILON * Math.abs(expected) + Number.MIN_VALUE,
        `${value}: ${actual} vs ${expected}`,
      );
    }
});
