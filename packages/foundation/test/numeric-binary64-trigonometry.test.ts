import assert from "node:assert/strict";
import { test } from "node:test";
import {
  sine,
  cosine,
  tangent,
} from "../src/numeric/binary64-trigonometry/index.ts";
for (const [name, operation] of [
  ["sin", sine],
  ["cos", cosine],
  ["tan", tangent],
] as const) {
  test(`${name} handles special values and quadrant boundaries`, () => {
    for (const value of [
      NaN,
      Infinity,
      -Infinity,
      0,
      -0,
      Number.MIN_VALUE,
      -Number.MIN_VALUE,
      Math.PI / 4,
      Math.PI / 2,
      Math.PI,
      2 * Math.PI,
      -Math.PI,
      1e20,
      1e100,
      1e300,
      Number.MAX_VALUE,
    ]) {
      const actual = operation(value),
        expected = Math[name](value);
      if (!Number.isFinite(expected) || expected === 0)
        assert.ok(Object.is(actual, expected), `${name}(${value})`);
      else
        assert.ok(
          Math.abs(actual - expected) <=
            8 * Number.EPSILON * Math.abs(expected) + Number.MIN_VALUE,
          `${name}(${value}): ${actual} vs ${expected}`,
        );
    }
  });
  test(`${name} spans binary64 magnitudes without losing quadrant information`, () => {
    let seed = 0x12345678;
    for (let exponent = -1074; exponent <= 1023; exponent++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const value = (1 + seed / 4294967296) * 2 ** exponent;
      const actual = operation(value),
        expected = Math[name](value);
      assert.ok(
        Math.abs(actual - expected) <=
          8 * Number.EPSILON * Math.abs(expected) + Number.MIN_VALUE,
        `${name}(${value}): ${actual} vs ${expected}`,
      );
      assert.ok(
        Object.is(operation(-value), name === "cos" ? actual : -actual),
      );
    }
  });
}
