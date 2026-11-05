import assert from "node:assert/strict";
import test from "node:test";
import { numberPower } from "../src/objects/number-power.ts";

test("fractional powers cover finite magnitudes, subnormal roots and range boundaries", () => {
  for (const base of [
    Number.MIN_VALUE,
    1e-300,
    0.01,
    0.5,
    1 - Number.EPSILON / 2,
    1 + Number.EPSILON,
    2,
    9,
    1e100,
    Number.MAX_VALUE,
  ]) {
    for (const exponent of [
      -100.25, -2.5, -0.5, -0.125, 0.125, 0.5, 1.5, 10.75, 100.25,
    ]) {
      const expected = base ** exponent,
        actual = numberPower(base, exponent);
      assert.notEqual(actual, undefined, `${base} ** ${exponent}`);
      if (!Number.isFinite(expected) || expected === 0)
        assert.equal(actual, expected);
      else
        assert.ok(
          Math.abs(actual! - expected) <=
            2e-12 * Math.abs(expected) + Number.MIN_VALUE,
          `${base} ** ${exponent}: ${actual} != ${expected}`,
        );
    }
  }
  for (const value of [Number.MIN_VALUE, 0.25, 9, Number.MAX_VALUE]) {
    assert.equal(numberPower(value, 0.5), Math.sqrt(value));
  }
});

test("power special cases preserve the ECMAScript ordering and signs", () => {
  for (const base of [NaN, -Infinity, -2, -1, -0, 0, 1, 2, Infinity]) {
    for (const exponent of [
      NaN,
      -Infinity,
      -3,
      -2,
      -0.5,
      -0,
      0,
      0.5,
      2,
      3,
      Infinity,
    ]) {
      const actual = numberPower(base, exponent),
        expected = base ** exponent;
      if (base > 0 && Number.isFinite(base) && Math.abs(exponent) === 0.5)
        assert.ok(Math.abs(actual - expected) <= 2e-15 * Math.abs(expected));
      else assert.ok(Object.is(actual, expected), `${base} ** ${exponent}`);
    }
  }
});

test("fractional powers stay within the approximation budget across binary exponents", () => {
  let state = 0x12345678;
  for (let i = 0; i < 12000; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const scale = (state % 2098) - 1074;
    const base = (1 + (state >>> 12) / 1048576) * 2 ** scale;
    const exponent = (((state >>> 4) % 4096) - 2048) / 128 + 1 / 256;
    const expected = base ** exponent,
      actual = numberPower(base, exponent);
    if (!Number.isFinite(expected) || expected === 0)
      assert.equal(actual, expected);
    else
      assert.ok(
        Math.abs(actual - expected) <=
          2e-12 * Math.abs(expected) + Number.MIN_VALUE,
        `${base} ** ${exponent}: ${actual} != ${expected}`,
      );
  }
});
