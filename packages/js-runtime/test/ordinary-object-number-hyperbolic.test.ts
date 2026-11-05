import assert from "node:assert/strict";
import { test } from "node:test";
import {
  numberSinh,
  numberCosh,
  numberTanh,
  numberAsinh,
  numberAcosh,
  numberAtanh,
} from "../src/objects/number-hyperbolic.ts";

for (const [name, operation] of [
  ["sinh", numberSinh],
  ["cosh", numberCosh],
  ["tanh", numberTanh],
  ["asinh", numberAsinh],
  ["acosh", numberAcosh],
  ["atanh", numberAtanh],
] as const) {
  test(`${name} handles domains, signed zero and extreme magnitudes`, () => {
    const values = [
      NaN,
      Infinity,
      -Infinity,
      0,
      -0,
      1,
      -1,
      1 - Number.EPSILON,
      1 + Number.EPSILON,
      0.5,
      -0.5,
      2,
      -2,
      20,
      -20,
      710,
      -710,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
    ];
    for (let exponent = -1074; exponent <= 1023; exponent += 7)
      values.push(2 ** exponent, -(2 ** exponent));
    for (const value of values) {
      const expected = Math[name](value),
        actual = operation(value);
      if (!Number.isFinite(expected) || expected === 0)
        assert.ok(Object.is(actual, expected), `${name}(${value}): ${actual}`);
      else
        assert.ok(
          Math.abs(actual - expected) <=
            8 * Number.EPSILON * Math.abs(expected) + Number.MIN_VALUE,
          `${name}(${value}): ${actual} vs ${expected}`,
        );
    }
  });
}
