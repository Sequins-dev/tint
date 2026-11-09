import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareTypedArrayNumbers,
  sortTypedArrayNumbers,
  countingSortIntegers,
} from "../src/objects/typed-array-sort-kernels.ts";

/** Reference: the specified default comparison over a copy. */
function reference(values: readonly number[]): number[] {
  return values.slice().sort(compareTypedArrayNumbers);
}
function pseudoRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

test("default typed-array comparison orders NaN last and -0 before +0", () => {
  assert.equal(compareTypedArrayNumbers(NaN, 1), 1);
  assert.equal(compareTypedArrayNumbers(1, NaN), -1);
  assert.equal(compareTypedArrayNumbers(NaN, NaN), 0);
  assert.equal(compareTypedArrayNumbers(-0, 0), -1);
  assert.equal(compareTypedArrayNumbers(0, -0), 1);
  assert.equal(compareTypedArrayNumbers(-Infinity, -1e308), -1);
});

test("numeric merge sort matches the specified order at every run boundary", () => {
  const next = pseudoRandom(7);
  for (const length of [0, 1, 2, 15, 16, 17, 31, 32, 33, 100, 1000, 4099]) {
    const values: number[] = [];
    for (let i = 0; i < length; i++) {
      const r = next() % 13;
      values.push(
        r === 0
          ? NaN
          : r === 1
            ? -0
            : r === 2
              ? 0
              : r === 3
                ? Infinity
                : r === 4
                  ? -Infinity
                  : (next() % 2001) - 1000 + (r === 5 ? 0.5 : 0),
      );
    }
    const expected = reference(values);
    sortTypedArrayNumbers(values);
    assert.equal(values.length, expected.length);
    for (let i = 0; i < length; i++)
      assert.ok(Object.is(values[i], expected[i]), `length ${length} at ${i}`);
  }
});

test("counting sort covers the full 8- and 16-bit element ranges", () => {
  const next = pseudoRandom(11);
  for (const [minimum, range, length] of [
    [-128, 256, 1000],
    [0, 256, 3],
    [-32768, 65536, 262144],
    [0, 65536, 5000],
  ] as const) {
    const values: number[] = [];
    for (let i = 0; i < length; i++) values.push(minimum + (next() % range));
    values[0] = minimum;
    values[length - 1] = minimum + range - 1;
    const expected = reference(values);
    countingSortIntegers(values, minimum, range);
    assert.deepEqual(values, expected);
  }
});
