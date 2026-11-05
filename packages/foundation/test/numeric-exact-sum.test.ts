import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createExactSum,
  addExactSum,
  finishExactSum,
} from "../src/numeric/exact-sum.ts";
function sum(values: readonly number[]): number {
  const state = createExactSum();
  for (const value of values) addExactSum(state, value);
  return finishExactSum(state);
}
test("exact sum preserves cancellation before its single final rounding", () => {
  const cases: [number[], number][] = [
    [[1e20, 1, -1e20], 1],
    [[1, 1e100, 1, -1e100], 2],
    [[Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE], Number.MAX_VALUE],
    [[Number.MAX_VALUE, Number.MAX_VALUE], Infinity],
    [[Number.MIN_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE], Number.MIN_VALUE],
    [[1, 2 ** -53], 1],
    [[1, 2 ** -53, Number.MIN_VALUE], 1 + Number.EPSILON],
    [[1 + Number.EPSILON, 2 ** -53], 1 + 2 * Number.EPSILON],
    [[Number.MAX_VALUE, 2 ** 970], Infinity],
  ];
  for (const [values, expected] of cases) {
    assert.ok(Object.is(sum(values), expected), String(values));
    assert.ok(Object.is(sum(values.toReversed()), expected), String(values));
    assert.ok(Object.is(sum(values.map((x) => -x)), -expected), String(values));
  }
});
test("empty/all-negative-zero, cancellation and exceptional states", () => {
  for (const [values, expected] of [
    [[], -0],
    [[-0, -0], -0],
    [[-0, 0], 0],
    [[1, -1], 0],
    [[NaN], NaN],
    [[Infinity, NaN], NaN],
    [[Infinity, -Infinity], NaN],
    [[Infinity, 1], Infinity],
    [[-Infinity, 1], -Infinity],
  ] as [number[], number][])
    assert.ok(Object.is(sum(values), expected));
});

test("reading the rounded sum does not consume its exact residual", () => {
  const state = createExactSum();
  addExactSum(state, 1);
  addExactSum(state, 2 ** -53);
  assert.equal(finishExactSum(state), 1);
  assert.equal(finishExactSum(state), 1);
  addExactSum(state, Number.MIN_VALUE);
  assert.equal(finishExactSum(state), 1 + Number.EPSILON);
  addExactSum(state, -1);
  addExactSum(state, -(2 ** -53));
  assert.equal(finishExactSum(state), Number.MIN_VALUE);
});
