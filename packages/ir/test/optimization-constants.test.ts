import assert from "node:assert/strict";
import { test } from "node:test";
import { binary } from "../src/optimization/constants.ts";

test("imul folds with Math.imul semantics, including ToInt32 operand wrapping", () => {
  const cases: [number, number][] = [
    [3, 4],
    [-1, 8],
    [0xffffffff, 5],
    [0x85ebca6b, 0xc2b2ae35],
    [2 ** 53, 3],
    [1.9, -2.9],
    [NaN, 7],
    [Infinity, 2],
  ];
  for (const [left, right] of cases)
    assert.equal(binary("imul", left, right), Math.imul(left, right));
  assert.equal(binary("imul", 1, true), undefined);
});
test("min and max fold with Math.min/Math.max semantics", () => {
  const values = [0, -0, 1, -1, 2.5, NaN, Infinity, -Infinity];
  for (const left of values)
    for (const right of values) {
      assert.ok(Object.is(binary("min", left, right), Math.min(left, right)));
      assert.ok(Object.is(binary("max", left, right), Math.max(left, right)));
    }
  assert.equal(binary("min", 1, true), undefined);
});
