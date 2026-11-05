import assert from "node:assert/strict";
import { test } from "node:test";
import { numberHypot } from "../src/objects/number-hypot.ts";
test("hypot handles signed zeros, exceptional values and scaled magnitudes", () => {
  for (const values of [
    [],
    [-0, 0],
    [3, 4],
    [-3, -4],
    [NaN, Infinity],
    [-Infinity, NaN],
    [NaN, 1],
    [3e200, 4e200],
    [3e-200, 4e-200],
    [Number.MIN_VALUE],
    [Number.MAX_VALUE, Number.MIN_VALUE],
  ]) {
    const expected = Math.hypot(...values),
      actual = numberHypot(values);
    if (!Number.isFinite(expected) || expected === 0)
      assert.ok(Object.is(actual, expected), String(values));
    else
      assert.ok(
        Math.abs(actual - expected) / expected <= Number.EPSILON * 2,
        String(values),
      );
  }
});
test("compensated accumulation retains many small square contributions", () => {
  for (const exponent of [-300, -100, 0, 100, 300]) {
    const scale = 10 ** exponent;
    const values = [
      scale,
      ...Array.from({ length: 10000 }, () => scale * 1e-8),
    ];
    const expected = Math.hypot(...values);
    assert.ok(
      Math.abs(numberHypot(values) - expected) / expected <= Number.EPSILON * 2,
    );
  }
});
