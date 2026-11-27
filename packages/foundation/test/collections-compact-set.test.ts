import test from "node:test";
import assert from "node:assert/strict";
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
} from "@tint/foundation/collections/compact-set";

test("compact-set handles object, bigint, undefined, and NaN members", () => {
  const set = createSet<unknown>();
  const a = { id: 1 };
  const b = { id: 2 };
  assert.equal(addSet(set, a), true);
  assert.equal(addSet(set, b), true);
  assert.equal(addSet(set, a), false);
  assert.equal(addSet(set, 1n << 90n), true);
  assert.equal(addSet(set, undefined), true);
  assert.equal(addSet(set, Number.NaN), true);
  assert.equal(addSet(set, Number.NaN), false);
  assert.equal(sizeSet(set), 5);
  assert.equal(hasSet(set, a), true);
  assert.equal(hasSet(set, 1n << 90n), true);
  assert.equal(hasSet(set, undefined), true);
  assert.equal(deleteSet(set, b), true);
  assert.equal(hasSet(set, b), false);
  assert.equal(sizeSet(set), 4);
});

test("compact-set cloneSet and live cursors preserve insertion order", () => {
  const set = createSet<{ id: number }>();
  const items = Array.from({ length: 24 }, (_, id) => ({ id }));
  for (const item of items) addSet(set, item);
  const copy = cloneSet(set);
  const cursor = createSetCursor(set);
  const seen: number[] = [];
  assert.equal(advanceSetCursor(cursor), true);
  seen.push(readSetCursor(cursor).id);
  for (let i = 1; i < 20; i++) deleteSet(set, items[i]!);
  addSet(set, items[3]!);
  while (advanceSetCursor(cursor)) seen.push(readSetCursor(cursor).id);
  assert.deepEqual(seen, [0, 20, 21, 22, 23, 3]);
  // Clone is unaffected by source mutations.
  assert.equal(sizeSet(copy), 24);
  const copyIds: number[] = [];
  const copyCursor = createSetCursor(copy);
  while (advanceSetCursor(copyCursor))
    copyIds.push(readSetCursor(copyCursor).id);
  assert.deepEqual(
    copyIds,
    items.map((x) => x.id),
  );
  clearSet(set);
  assert.equal(sizeSet(set), 0);
});

test("compact-set deterministic mutations match JavaScript Set", () => {
  const actual = createSet<bigint>();
  const expected = new Set<bigint>();
  let state = 0x9e3779b9;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  for (let step = 0; step < 300; step++) {
    const val = (1n << 80n) + BigInt(next() % 40);
    const op = next() % 10;
    if (op < 5) {
      const had = expected.has(val);
      expected.add(val);
      assert.equal(addSet(actual, val), !had);
    } else if (op < 8) {
      assert.equal(deleteSet(actual, val), expected.delete(val));
    } else if (op === 8) {
      assert.equal(hasSet(actual, val), expected.has(val));
    } else {
      clearSet(actual);
      expected.clear();
    }
    assert.equal(sizeSet(actual), expected.size);
    const values: bigint[] = [];
    const cursor = createSetCursor(actual);
    while (advanceSetCursor(cursor)) values.push(readSetCursor(cursor));
    assert.deepEqual(values, [...expected.values()]);
  }
});
