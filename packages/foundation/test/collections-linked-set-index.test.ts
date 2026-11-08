import assert from "node:assert/strict";
import { test } from "node:test";
import * as runtime from "@tint/foundation/collections/linked-set";

function members<T>(set: runtime.LinkedSet<T>): T[] {
  const out: T[] = [];
  const cursor = runtime.createSetCursor(set);
  while (runtime.advanceSetCursor(cursor))
    out.push(runtime.readSetCursor(cursor));
  // LinkedSet stores members as given; JS Set normalizes -0 to +0.
  return out.map((v) => (Object.is(v, -0) ? 0 : v) as T);
}

test("indexed sets agree with Set through mixed keys, deletion, clearing and cloning", () => {
  const objects = Array.from({ length: 12 }, (_, i) => ({ i }));
  const pool: unknown[] = [
    ...Array.from({ length: 40 }, (_, i) => "k" + (i % 23)),
    ...Array.from({ length: 30 }, (_, i) => i % 17),
    0,
    -0,
    NaN,
    0.5,
    -1,
    4294967296,
    "",
    true,
    false,
    undefined,
    null,
    ...objects,
  ];
  const actual = runtime.createSet<unknown>();
  let expected = new Set<unknown>();
  let seed = 11;
  for (let step = 0; step < 6000; step++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const value = pool[(seed >>> 8) % pool.length];
    const op = (seed >>> 24) % 10;
    if (op < 5)
      assert.equal(
        runtime.addSet(actual, value),
        !expected.has(value) && (expected.add(value), true),
      );
    else if (op < 8)
      assert.equal(runtime.deleteSet(actual, value), expected.delete(value));
    else if (op === 8)
      assert.equal(runtime.hasSet(actual, value), expected.has(value));
    else if (step % 997 === 0) {
      runtime.clearSet(actual);
      expected = new Set();
    }
    assert.equal(runtime.sizeSet(actual), expected.size);
    if (step % 211 === 0) {
      assert.deepEqual(members(actual), [...expected]);
      const copy = runtime.cloneSet(actual);
      assert.deepEqual(members(copy), [...expected]);
      for (const v of pool)
        assert.equal(runtime.hasSet(copy, v), expected.has(v));
    }
  }
  for (const v of pool)
    assert.equal(runtime.hasSet(actual, v), expected.has(v));
  assert.deepEqual(members(actual), [...expected]);
});

test("cursors stay live across indexed deletion and reinsertion", () => {
  const set = runtime.createSet<string>();
  for (let i = 0; i < 20; i++) runtime.addSet(set, "m" + i);
  const cursor = runtime.createSetCursor(set);
  const seen: string[] = [];
  while (runtime.advanceSetCursor(cursor)) {
    const value = runtime.readSetCursor(cursor);
    seen.push(value);
    if (value === "m3") {
      runtime.deleteSet(set, "m4");
      runtime.deleteSet(set, "m3");
      runtime.addSet(set, "m4");
    }
  }
  const expected = new Set(Array.from({ length: 20 }, (_, i) => "m" + i));
  const order: string[] = [];
  for (const value of expected) {
    order.push(value);
    if (value === "m3") {
      expected.delete("m4");
      expected.delete("m3");
      expected.add("m4");
    }
  }
  assert.deepEqual(seen, order);
});
