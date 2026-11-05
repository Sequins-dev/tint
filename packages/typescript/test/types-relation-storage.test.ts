import assert from "node:assert/strict";
import test from "node:test";
import { growRelationStorage } from "../src/types/relation-storage.ts";
test("dense relation storage grows geometrically and preserves signed sentinels", () => {
  const old = new Float64Array([-1, 9007199254740991, 0, 17]);
  assert.equal(growRelationStorage(old, 4), old);
  const next = growRelationStorage(old, 5);
  assert.equal(next.length, 64);
  assert.deepEqual([...next.subarray(0, 4)], [...old]);
  assert.ok([...next.subarray(4)].every((x) => x === 0));
  next[0] = 7;
  assert.equal(old[0], -1);
  assert.equal(growRelationStorage(next, 65).length, 128);
});
test("invalid dense relation capacity is rejected before allocation", () => {
  for (const size of [-1, 0.5, NaN, Infinity, 536870907])
    assert.throws(() => growRelationStorage(new Float64Array(0), size));
});
