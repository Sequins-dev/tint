import assert from "node:assert/strict";
import { test } from "node:test";
import {
  numberAtan,
  numberAtan2,
  numberAsin,
  numberAcos,
} from "../src/objects/number-angle.ts";

test("atan2 preserves special quadrants and signed zero", () => {
  for (const y of [NaN, -Infinity, -1, -0, 0, 1, Infinity])
    for (const x of [NaN, -Infinity, -1, -0, 0, 1, Infinity])
      assert.ok(Object.is(numberAtan2(y, x), Math.atan2(y, x)), `${y},${x}`);
});
for (const [name, operation] of [
  ["atan", numberAtan],
  ["asin", numberAsin],
  ["acos", numberAcos],
] as const) {
  test(`${name} covers domains, endpoints and reduced arguments`, () => {
    const values = [
      NaN,
      Infinity,
      -Infinity,
      -0,
      0,
      -1,
      1,
      1 - Number.EPSILON,
      -1 + Number.EPSILON,
      Number.MIN_VALUE,
      -Number.MIN_VALUE,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
    ];
    for (let i = -2000; i <= 2000; i++) values.push(i / 1999);
    for (const value of values) {
      const actual = operation(value),
        expected = Math[name](value);
      if (!Number.isFinite(expected) || expected === 0)
        assert.ok(Object.is(actual, expected), String(value));
      else
        assert.ok(
          Math.abs(actual - expected) <=
            4 * Number.EPSILON * Math.abs(expected),
          `${name}(${value}): ${actual} vs ${expected}`,
        );
    }
  });
}
test("atan2 handles ratios that overflow or underflow", () => {
  for (const y of [Number.MIN_VALUE, 1, Number.MAX_VALUE])
    for (const x of [Number.MIN_VALUE, 1, Number.MAX_VALUE])
      for (const sy of [-1, 1])
        for (const sx of [-1, 1]) {
          const actual = numberAtan2(sy * y, sx * x),
            expected = Math.atan2(sy * y, sx * x);
          assert.ok(
            Math.abs(actual - expected) <=
              4 * Number.EPSILON * Math.abs(expected) + Number.MIN_VALUE,
          );
        }
});
