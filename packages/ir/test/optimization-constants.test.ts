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
