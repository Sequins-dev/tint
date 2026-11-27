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
} from "@tint/foundation/collections/compact-number-map";

test("compact-number-map handles object, bigint, undefined, and NaN keys", () => {
  const map = createMap<unknown>();
  const a = { id: 1 };
  const b = { id: 2 };
  assert.equal(setMap(map, a, 10), true);
  assert.equal(setMap(map, b, -0), true);
  assert.equal(setMap(map, 1n << 100n, 42.5), true);
  assert.equal(setMap(map, undefined, 7), true);
  assert.equal(setMap(map, Number.NaN, 99), true);
  assert.equal(setMap(map, Number.NaN, 100), false);
  assert.equal(setMap(map, a, 11), false);
  assert.equal(sizeMap(map), 5);
  assert.equal(hasMap(map, b), true);
  assert.equal(Object.is(getMap(map, b), -0), true);
  assert.equal(getMap(map, a), 11);
  assert.equal(getMap(map, 1n << 100n), 42.5);
  assert.equal(getMap(map, undefined), 7);
  assert.equal(getMap(map, Number.NaN), 100);
  assert.equal(deleteMap(map, b), true);
  assert.equal(hasMap(map, b), false);
  assert.equal(sizeMap(map), 4);
});

test("compact-number-map live cursors survive deletion, compaction, shrinking and clear", () => {
  const map = createMap<{ id: number }>();
  const keys = Array.from({ length: 32 }, (_, id) => ({ id }));
  for (let i = 0; i < keys.length; i++) setMap(map, keys[i]!, i * 10);
  const cursor = createMapCursor(map);
  const seen: number[] = [];
  assert.equal(advanceMapCursor(cursor), true);
  seen.push(readMapCursorKey(cursor).id);
  for (let i = 1; i < 28; i++) deleteMap(map, keys[i]!);
  setMap(map, keys[2]!, 999);
  while (advanceMapCursor(cursor)) {
    seen.push(readMapCursorKey(cursor).id);
    if (readMapCursorKey(cursor).id === 29) {
      assert.equal(readMapCursorValue(cursor), 290);
    }
  }
  assert.deepEqual(seen, [0, 28, 29, 30, 31, 2]);
  clearMap(map);
  assert.equal(sizeMap(map), 0);
});

test("compact-number-map deterministic mutations match JavaScript Map", () => {
  const actual = createMap<bigint>();
  const expected = new Map<bigint, number>();
  let state = 0x7654321;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  for (let step = 0; step < 300; step++) {
    const key = (1n << 80n) + BigInt(next() % 48);
    const op = next() % 10;
    if (op < 5) {
      const had = expected.has(key);
      expected.set(key, step);
      assert.equal(setMap(actual, key, step), !had);
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
    const entries: [bigint, number][] = [];
    const cursor = createMapCursor(actual);
    while (advanceMapCursor(cursor))
      entries.push([readMapCursorKey(cursor), readMapCursorValue(cursor)]);
    assert.deepEqual(entries, [...expected.entries()]);
  }
});
