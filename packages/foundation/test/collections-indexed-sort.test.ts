import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sortIndexed,
  type IndexedAccess,
} from "@tint/foundation/collections/indexed-sort";
function access<T>(values: (T | undefined)[]): IndexedAccess<T> {
  return {
    length: () => values.length,
    has: (i) => i in values,
    read: (i) => values[i],
    write: (i, v) => {
      values[i] = v;
    },
    remove: (i) => {
      delete values[i];
    },
  };
}
test("sort is stable and places undefined before holes without comparing either", () => {
  const a = [
    { key: 2, id: 0 },
    undefined,
    { key: 1, id: 1 },
    { key: 2, id: 2 },
    undefined,
  ];
  a.length = 7;
  delete a[4];
  const expected = a.slice();
  expected.sort((a, b) => {
    assert.ok(a !== undefined && b !== undefined);
    return a.key - b.key;
  });
  sortIndexed(access(a), (a, b) => {
    assert.notEqual(a, undefined);
    assert.notEqual(b, undefined);
    return a.key - b.key;
  });
  assert.deepEqual(a, expected);
});
test("snapshot collection precedes comparisons and writeback respects original extent", () => {
  const a = [3, 1, 2];
  let calls = 0;
  sortIndexed(access(a), (x, y) => {
    calls++;
    a[0] = 99;
    a[4] = 8;
    return x - y;
  });
  assert.ok(calls > 0);
  assert.deepEqual(a, [1, 2, 3, , 8]);
  const short = [3, 1, 2, ,];
  sortIndexed(access(short), (a, b) => {
    short.length = 0;
    return a - b;
  });
  assert.deepEqual(short, [1, 2, 3]);
});
test("empty input and NaN comparisons retain order; exceptions prevent writeback", () => {
  const empty: number[] = [];
  sortIndexed(access(empty), () => {
    throw "unexpected";
  });
  const a = [3, 2, 1];
  sortIndexed(access(a), () => NaN);
  assert.deepEqual(a, [3, 2, 1]);
  assert.throws(
    () =>
      sortIndexed(access(a), () => {
        throw new Error("comparison");
      }),
    /comparison/,
  );
  assert.deepEqual(a, [3, 2, 1]);
});
test("deterministic sparse inputs match native sort with consistent comparators", () => {
  let state = 12345;
  for (let trial = 0; trial < 300; trial++) {
    const values: (number | undefined)[] = [];
    values.length = trial % 67;
    for (let i = 0; i < values.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      if ((state >>> 24) % 5 === 0) continue;
      values[i] = (state >>> 24) % 7 === 0 ? undefined : (state % 31) - 15;
    }
    const expected = values.slice().sort((a, b) => {
      assert.ok(a !== undefined && b !== undefined);
      return a - b;
    });
    sortIndexed(access(values), (a, b) => a - b);
    assert.deepEqual(values, expected);
  }
});

test("generic array-like lengths can exceed the Array uint32 limit", () => {
  const sentinel = {};
  const access: IndexedAccess<number> = {
    length: () => 4294967296,
    has: () => {
      throw sentinel;
    },
    read: () => undefined,
    write: () => assert.fail("no writes before collection completes"),
    remove: () => assert.fail("no removals before collection completes"),
  };
  assert.throws(
    () => sortIndexed(access, (a, b) => a - b),
    (error) => error === sentinel,
  );
});
