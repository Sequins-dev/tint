import test from "node:test";
import assert from "node:assert/strict";
import {
  createMap,
  hasMap,
  getMap,
  setMap,
  deleteMap,
  clearMap,
  sizeMap,
  createMapCursor,
  advanceMapCursor,
  readMapCursorKey,
  readMapCursorValue,
} from "@tint/foundation/collections/compact-map";

test("compact-map handles object, bigint, undefined, and NaN keys with SameValueZero", () => {
  const map = createMap<unknown, number | undefined>();
  const a = { id: 1 };
  const b = { id: 2 };
  assert.equal(setMap(map, a, 10), true);
  assert.equal(setMap(map, b, undefined), true);
  assert.equal(setMap(map, 1n << 100n, 42), true);
  assert.equal(setMap(map, undefined, 7), true);
  assert.equal(setMap(map, Number.NaN, 99), true);
  assert.equal(setMap(map, Number.NaN, 100), false);
  assert.equal(setMap(map, a, 11), false);
  assert.equal(sizeMap(map), 5);
  assert.equal(hasMap(map, b), true);
  assert.equal(getMap(map, b), undefined);
  assert.equal(getMap(map, a), 11);
  assert.equal(getMap(map, 1n << 100n), 42);
  assert.equal(getMap(map, undefined), 7);
  assert.equal(getMap(map, Number.NaN), 100);
  assert.equal(deleteMap(map, b), true);
  assert.equal(hasMap(map, b), false);
  assert.equal(sizeMap(map), 4);
});

test("compact-map live cursors survive deletion, compaction, shrinking and clear", () => {
  const map = createMap<{ id: number }, number>();
  const keys = Array.from({ length: 24 }, (_, id) => ({ id }));
  for (let i = 0; i < keys.length; i++) setMap(map, keys[i]!, i * 10);
  const cursor = createMapCursor(map);
  const seen: number[] = [];
  assert.equal(advanceMapCursor(cursor), true);
  seen.push(readMapCursorKey(cursor).id);
  // Delete enough entries to trigger shrink/compaction mid-iteration.
  for (let i = 1; i < 20; i++) deleteMap(map, keys[i]!);
  // Re-insert an earlier deleted key; it must appear at the tail.
  setMap(map, keys[2]!, 999);
  while (advanceMapCursor(cursor)) {
    seen.push(readMapCursorKey(cursor).id);
    if (readMapCursorKey(cursor).id === 21) {
      assert.equal(readMapCursorValue(cursor), 210);
    }
  }
  assert.deepEqual(seen, [0, 20, 21, 22, 23, 2]);
  // Exhausted cursor does not observe subsequent insertions.
  setMap(map, keys[3]!, 333);
  assert.equal(advanceMapCursor(cursor), false);
  clearMap(map);
  assert.equal(sizeMap(map), 0);
});

test("compact-map deterministic mutations match JavaScript Map", () => {
  const actual = createMap<bigint, number | undefined>();
  const expected = new Map<bigint, number | undefined>();
  let state = 0x1234567;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  for (let step = 0; step < 300; step++) {
    const key = (1n << 80n) + BigInt(next() % 40);
    const op = next() % 10;
    if (op < 5) {
      const val = op === 0 ? undefined : step;
      const had = expected.has(key);
      expected.set(key, val);
      assert.equal(setMap(actual, key, val), !had);
    } else if (op < 8) {
      assert.equal(deleteMap(actual, key), expected.delete(key));
    } else if (op === 8) {
      assert.equal(hasMap(actual, key), expected.has(key));
      assert.equal(getMap(actual, key), expected.get(key));
    } else {
      clearMap(actual);
      expected.clear();
    }
    assert.equal(sizeMap(actual), expected.size);
    const entries: [bigint, number | undefined][] = [];
    const cursor = createMapCursor(actual);
    while (advanceMapCursor(cursor))
      entries.push([readMapCursorKey(cursor), readMapCursorValue(cursor)]);
    assert.deepEqual(entries, [...expected.entries()]);
  }
});
