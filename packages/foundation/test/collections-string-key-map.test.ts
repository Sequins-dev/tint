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
} from "@tint/foundation/collections/string-key-map";

test("string-key-map distinguishes stored undefined and preserves special strings", () => {
  const map = createMap<number | undefined>();
  assert.equal(sizeMap(map), 0);
  assert.equal(hasMap(map, ""), false);
  assert.equal(getMap(map, ""), undefined);
  assert.equal(deleteMap(map, ""), false);

  const specials = ["", "a\0b", "\ud800", "😀", "__proto__", "constructor"];
  for (let i = 0; i < specials.length; i++) {
    const key = specials[i]!;
    assert.equal(setMap(map, key, i % 2 === 0 ? undefined : i), true);
    assert.equal(hasMap(map, key), true);
    assert.equal(getMap(map, key), i % 2 === 0 ? undefined : i);
  }
  assert.equal(setMap(map, "", 99), false);
  assert.equal(getMap(map, ""), 99);

  // Trigger growth and shrinking compaction while preserving stored undefined.
  for (let i = 0; i < 32; i++)
    setMap(map, "k" + i, i % 4 === 0 ? undefined : i);
  for (let i = 0; i < 28; i++)
    if (i % 4 !== 0) assert.equal(deleteMap(map, "k" + i), true);

  assert.equal(hasMap(map, "k0"), true);
  assert.equal(getMap(map, "k0"), undefined);
  assert.equal(hasMap(map, "\ud800"), true);
  assert.equal(getMap(map, "\ud800"), undefined);
  assert.equal(getMap(map, "k31"), 31);
});

test("string-key-map live cursors survive deletion, compaction, shrinking and clear", () => {
  const actual = createMap<number>(),
    expected = new Map<string, number>();
  function put(key: string, value: number) {
    setMap(actual, key, value);
    expected.set(key, value);
  }
  for (let i = 0; i < 40; i++) put("k" + i, i * 3);
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
    assert.equal(deleteMap(actual, "k" + i), expected.delete("k" + i));
  put("k38", 3800);
  put("k5", 500);
  next();
  next();
  for (let i = 100; i < 160; i++) put("n" + i, i);
  next();
  clearMap(actual);
  expected.clear();
  put("after", 1);
  next();
  next();
  put("exhausted", 2);
  next();
  assert.equal(cursor.map, undefined);
  assert.throws(() => readMapCursorKey(cursor));
  assert.throws(() => readMapCursorValue(cursor));
});

test("string-key-map deterministic mutations and cursors match JavaScript Map", () => {
  const actual = createMap<number | undefined>(),
    expected = new Map<string, number | undefined>();
  const pool = ["", "a\0", "\ud800", "😀", "__proto__", "constructor"];
  for (let i = 0; i < 40; i++) pool.push("key" + i);
  let seed = 9191;
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
      if (got)
        assert.deepEqual(
          [readMapCursorKey(cursor), readMapCursorValue(cursor)],
          wanted.value,
        );
      else {
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
        got: [string, number | undefined][] = [];
      while (advanceMapCursor(c))
        got.push([readMapCursorKey(c), readMapCursorValue(c)]);
      assert.deepEqual(got, [...expected]);
    }
  }
});
