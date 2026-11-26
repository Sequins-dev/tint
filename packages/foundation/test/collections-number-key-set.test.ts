import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSet,
  hasSet,
  addSet,
  deleteSet,
  clearSet,
  sizeSet,
  cloneSet,
  createSetCursor,
  advanceSetCursor,
  readSetCursor,
} from "@tint/foundation/collections/number-key-set";

test("number-key-set follows SameValueZero and normalizes -0 to +0", () => {
  const set = createSet();
  assert.equal(sizeSet(set), 0);
  assert.equal(hasSet(set, 0), false);
  assert.equal(deleteSet(set, 0), false);

  assert.equal(addSet(set, -0), true);
  assert.equal(addSet(set, 0), false);
  assert.equal(hasSet(set, -0), true);
  assert.equal(hasSet(set, 0), true);

  assert.equal(addSet(set, NaN), true);
  assert.equal(addSet(set, NaN), false);
  assert.equal(hasSet(set, NaN), true);

  const specials = [
    Infinity,
    -Infinity,
    -1,
    1.5,
    -0.25,
    4294967296,
    4294967297,
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
    Number.MIN_VALUE,
  ];
  for (const value of specials) {
    assert.equal(addSet(set, value), true);
    assert.equal(addSet(set, value), false);
    assert.equal(hasSet(set, value), true);
  }
  assert.equal(sizeSet(set), 2 + specials.length);

  const cursor = createSetCursor(set);
  assert.equal(advanceSetCursor(cursor), true);
  assert.ok(Object.is(readSetCursor(cursor), 0));
  assert.equal(advanceSetCursor(cursor), true);
  assert.ok(Number.isNaN(readSetCursor(cursor)));
  for (const value of specials) {
    assert.equal(advanceSetCursor(cursor), true);
    assert.equal(readSetCursor(cursor), value);
  }
  assert.equal(advanceSetCursor(cursor), false);
  assert.throws(() => readSetCursor(cursor));

  assert.equal(deleteSet(set, -0), true);
  assert.equal(hasSet(set, 0), false);
  assert.equal(deleteSet(set, NaN), true);
  assert.equal(hasSet(set, NaN), false);
});

test("number-key-set live cursors survive deletion, compaction, shrinking and clear", () => {
  const actual = createSet(),
    expected = new Set<number>();
  function put(key: number) {
    addSet(actual, key);
    expected.add(key);
  }
  function remove(key: number) {
    assert.equal(deleteSet(actual, key), expected.delete(key));
  }
  for (let i = 0; i < 40; i++) put(i);
  const cursor = createSetCursor(actual),
    iterator = expected.values();
  function next() {
    const wanted = iterator.next();
    assert.equal(advanceSetCursor(cursor), !wanted.done);
    if (!wanted.done) assert.equal(readSetCursor(cursor), wanted.value);
  }
  next(); // 0
  next(); // 1
  // Delete almost everything to trigger shrinking compaction while cursor is live.
  for (let i = 2; i < 36; i++) remove(i);
  // Re-insert an earlier key at the tail.
  put(5);
  next(); // 36
  remove(37);
  next(); // 38
  // Grow again across rebuild.
  for (let i = 100; i < 160; i++) put(i);
  next(); // 39
  next(); // 5
  // Clear then re-add before next() so live cursor sees post-clear items.
  clearSet(actual);
  expected.clear();
  put(999);
  next(); // 999
  next(); // exhausted
  put(1000);
  next(); // stays exhausted
  assert.equal(cursor.set, undefined);
});

test("number-key-set cloneSet copies live entries independently in insertion order", () => {
  const source = createSet();
  for (let i = 0; i < 30; i++) addSet(source, i);
  for (let i = 0; i < 20; i += 2) deleteSet(source, i);
  addSet(source, 4);
  const copy = cloneSet(source);
  assert.equal(sizeSet(copy), sizeSet(source));

  const readAll = (set: ReturnType<typeof createSet>): number[] => {
    const cursor = createSetCursor(set),
      out: number[] = [];
    while (advanceSetCursor(cursor)) out.push(readSetCursor(cursor));
    return out;
  };
  const before = readAll(source);
  assert.deepEqual(readAll(copy), before);

  addSet(copy, 777);
  deleteSet(source, 1);
  assert.equal(hasSet(source, 777), false);
  assert.equal(hasSet(copy, 1), true);
  assert.equal(sizeSet(cloneSet(createSet())), 0);
});

test("number-key-set deterministic mutations and cursors match JavaScript Set", () => {
  const actual = createSet(),
    expected = new Set<number>();
  const pool = [
    -0,
    0,
    NaN,
    1,
    2,
    3,
    -7,
    1.25,
    4294967296,
    4294967297,
    Infinity,
    -Infinity,
  ];
  for (let i = 10; i < 50; i++) pool.push(i);
  let seed = 4242;
  let cursor = createSetCursor(actual);
  let iterator = expected.values();
  for (let step = 0; step < 1200; step++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const key = pool[seed % pool.length]!;
    const op = (seed >>> 8) % 6;
    if (op === 0 || op === 1) {
      const added = !expected.has(key);
      expected.add(key);
      assert.equal(addSet(actual, key), added);
    } else if (op === 2 || op === 3) {
      assert.equal(deleteSet(actual, key), expected.delete(key));
    } else if (op === 4) {
      const wanted = iterator.next();
      const got = advanceSetCursor(cursor);
      assert.equal(got, !wanted.done);
      if (got) assert.ok(Object.is(readSetCursor(cursor), wanted.value));
      if (!got) {
        cursor = createSetCursor(actual);
        iterator = expected.values();
      }
    } else if (step % 41 === 0) {
      clearSet(actual);
      expected.clear();
    }
    assert.equal(sizeSet(actual), expected.size);
    if (step % 25 === 0) {
      for (const k of pool) assert.equal(hasSet(actual, k), expected.has(k));
      const c = createSetCursor(actual),
        got: number[] = [];
      while (advanceSetCursor(c)) got.push(readSetCursor(c));
      assert.deepEqual(got, [...expected]);
    }
  }
});
