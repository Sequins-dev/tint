import assert from "node:assert/strict";
import { test } from "node:test";
import { reserveLinear } from "../src/allocators/linear/index.ts";

test("reservations align starts and extents without partial mutation on exhaustion", () => {
  const state = new Uint32Array([0, 128]);
  assert.equal(reserveLinear(state, 17, 16), 0);
  assert.equal(reserveLinear(state, 1, 16), 32);
  assert.equal(reserveLinear(state, 80, 16), 48);
  assert.deepEqual([...state], [128, 128]);
  assert.equal(reserveLinear(state, 1, 16), undefined);
  assert.deepEqual([...state], [128, 128]);
});
test("invalid requests and unsigned boundary exhaustion do not wrap or mutate", () => {
  for (const bytes of [0, -1, 0.5, NaN, Infinity, 4294967296]) {
    const state = new Uint32Array([16, 64]);
    const before = state.slice();
    assert.equal(reserveLinear(state, bytes, 16), undefined);
    assert.deepEqual(state, before);
  }
  for (const alignment of [0, -1, 3, 1.5, NaN, Infinity, 4294967296]) {
    const state = new Uint32Array([16, 64]);
    assert.equal(reserveLinear(state, 16, alignment), undefined);
    assert.deepEqual([...state], [16, 64]);
  }
  assert.equal(reserveLinear(new Uint32Array(1), 16, 16), undefined);
  const reversed = new Uint32Array([32, 16]);
  assert.equal(reserveLinear(reversed, 1, 16), undefined);
  const edge = new Uint32Array([4294967264, 4294967295]);
  assert.equal(reserveLinear(edge, 16, 16), 4294967264);
  assert.equal(reserveLinear(edge, 16, 16), undefined);
  assert.equal(edge[0], 4294967280);
});
test("mixed reservations match a byte occupancy oracle", () => {
  let seed = 731;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let trial = 0; trial < 200; trial++) {
    const limit = 1 + (random() % 2048),
      state = new Uint32Array([0, limit]);
    let cursor = 0;
    const occupied = new Uint8Array(limit);
    for (let i = 0; i < 100; i++) {
      const alignment = 2 ** (random() % 7),
        bytes = 1 + (random() % 128);
      const start = Math.ceil(cursor / alignment) * alignment,
        size = Math.ceil(bytes / alignment) * alignment;
      const expected = start + size <= limit ? start : undefined;
      const before = state[0],
        actual = reserveLinear(state, bytes, alignment);
      assert.equal(actual, expected);
      if (actual === undefined) assert.equal(state[0], before);
      else {
        for (let j = actual; j < actual + size; j++) {
          assert.equal(occupied[j], 0);
          occupied[j] = 1;
        }
        cursor = actual + size;
        assert.equal(state[0], cursor);
      }
    }
  }
});
