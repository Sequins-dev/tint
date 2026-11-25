import assert from "node:assert/strict";
import { test } from "node:test";
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
} from "@tint/foundation/collections/number-key-map";

test("number-key-map distinguishes stored undefined, follows SameValueZero and normalizes -0", () => {
  const map = createMap<number | undefined>();
  assert.equal(sizeMap(map), 0);
  assert.equal(hasMap(map, 0), false);
  assert.equal(getMap(map, 0), undefined);
  assert.equal(deleteMap(map, 0), false);

  assert.equal(setMap(map, -0, undefined), true);
  assert.equal(hasMap(map, 0), true);
  assert.equal(getMap(map, 0), undefined);
  assert.equal(setMap(map, 0, 7), false);
  assert.equal(getMap(map, -0), 7);

  assert.equal(setMap(map, NaN, undefined), true);
  assert.equal(hasMap(map, NaN), true);
  assert.equal(getMap(map, NaN), undefined);
  assert.equal(setMap(map, NaN, 9), false);
  assert.equal(getMap(map, NaN), 9);

  // Trigger compaction with stored undefined values intact.
  for (let i = 1; i <= 32; i++)
    setMap(map, i, i % 3 === 0 ? undefined : i * 10);
  for (let i = 1; i <= 28; i++)
    if (i % 3 !== 0) assert.equal(deleteMap(map, i), true);

  assert.equal(hasMap(map, 3), true);
  assert.equal(getMap(map, 3), undefined);
  assert.equal(getMap(map, 31), 310);

  const cursor = createMapCursor(map);
  assert.equal(advanceMapCursor(cursor), true);
  assert.ok(Object.is(readMapCursorKey(cursor), 0));
  assert.equal(readMapCursorValue(cursor), 7);
  assert.equal(advanceMapCursor(cursor), true);
  assert.ok(Number.isNaN(readMapCursorKey(cursor)));
  assert.equal(readMapCursorValue(cursor), 9);
  assert.equal(advanceMapCursor(cursor), true);
  assert.equal(readMapCursorKey(cursor), 3);
  assert.equal(readMapCursorValue(cursor), undefined);
});

test("number-key-map live cursors survive deletion, compaction, shrinking and clear", () => {
  const actual = createMap<number>(),
    expected = new Map<number, number>();
  function put(key: number, value: number) {
    setMap(actual, key, value);
    expected.set(key, value);
  }
  for (let i = 0; i < 40; i++) put(i, i * 2);
  const cursor = createMapCursor(actual),
    iterator = expected.entries();
  function next() {
    const wanted = iterator.next();
    assert.equal(advanceMapCursor(cursor), !wanted.done);
    if (!wanted.done)
      assert.deepEqual(
        [readMapCursorKey(cursor), readMapCursorValue(cursor)],
        wanted.value,
      );
  }
  next();
  next();
  for (let i = 2; i < 36; i++)
    assert.equal(deleteMap(actual, i), expected.delete(i));
  put(38, 3800);
  put(5, 500);
  next();
  next();
  for (let i = 100; i < 160; i++) put(i, i);
  next();
  clearMap(actual);
  expected.clear();
  put(999, 1);
  next();
  next();
  put(1000, 2);
  next();
  assert.equal(cursor.map, undefined);
  assert.throws(() => readMapCursorKey(cursor));
  assert.throws(() => readMapCursorValue(cursor));
});

test("number-key-map deterministic mutations and cursors match JavaScript Map", () => {
  const actual = createMap<number | undefined>(),
    expected = new Map<number, number | undefined>();
  const pool = [-0, 0, NaN, -1, 1.5, 4294967296, 4294967297, Infinity];
  for (let i = 1; i <= 40; i++) pool.push(i);
  let seed = 7771;
  let cursor = createMapCursor(actual);
  let iterator = expected.entries();
  for (let step = 0; step < 1200; step++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const key = pool[seed % pool.length]!;
    const op = (seed >>> 8) % 6;
    const value = step % 5 === 0 ? undefined : step;
    if (op === 0 || op === 1) {
      const added = !expected.has(key);
      expected.set(key, value);
      assert.equal(setMap(actual, key, value), added);
    } else if (op === 2 || op === 3) {
      assert.equal(deleteMap(actual, key), expected.delete(key));
    } else if (op === 4) {
      const wanted = iterator.next();
      const got = advanceMapCursor(cursor);
      assert.equal(got, !wanted.done);
      if (!wanted.done) {
        assert.ok(Object.is(readMapCursorKey(cursor), wanted.value[0]));
        assert.equal(readMapCursorValue(cursor), wanted.value[1]);
      } else {
        cursor = createMapCursor(actual);
        iterator = expected.entries();
      }
    } else if (step % 43 === 0) {
      clearMap(actual);
      expected.clear();
    }
    assert.equal(sizeMap(actual), expected.size);
    if (step % 25 === 0) {
      for (const k of pool) {
        assert.equal(hasMap(actual, k), expected.has(k));
        assert.equal(getMap(actual, k), expected.get(k));
      }
      const c = createMapCursor(actual),
        got: [number, number | undefined][] = [];
      while (advanceMapCursor(c))
        got.push([readMapCursorKey(c), readMapCursorValue(c)]);
      assert.deepEqual(got, [...expected]);
    }
  }
});
