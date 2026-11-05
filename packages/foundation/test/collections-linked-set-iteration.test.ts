import assert from "node:assert/strict";
import { test } from "node:test";
import * as runtime from "../src/collections/linked-set.ts";

test("set cursors follow live insertion order and remain exhausted", () => {
  assert.ok("createSetCursor" in runtime, "missing set cursor");
  assert.ok("advanceSetCursor" in runtime);
  assert.ok("readSetCursor" in runtime);
  const create = runtime.createSetCursor,
    advance = runtime.advanceSetCursor,
    read = runtime.readSetCursor;
  if (
    typeof create !== "function" ||
    typeof advance !== "function" ||
    typeof read !== "function"
  )
    throw new Error("missing cursor functions");
  const set = runtime.createSet<number>();
  for (const value of [1, 2, 3]) runtime.addSet(set, value);
  const cursor = create(set);
  assert.throws(() => read(cursor));
  assert.equal(advance(cursor), true);
  assert.equal(read(cursor), 1);
  runtime.deleteSet(set, 2);
  runtime.deleteSet(set, 1);
  runtime.addSet(set, 1);
  assert.equal(advance(cursor), true);
  assert.equal(read(cursor), 3);
  assert.equal(advance(cursor), true);
  assert.equal(read(cursor), 1);
  runtime.clearSet(set);
  runtime.addSet(set, 4);
  assert.equal(advance(cursor), true);
  assert.equal(read(cursor), 4);
  assert.equal(advance(cursor), false);
  assert.throws(() => read(cursor));
  runtime.addSet(set, 5);
  assert.equal(advance(cursor), false);
});

test("independent set cursors match JavaScript under deterministic mutations", () => {
  assert.ok("createSetCursor" in runtime, "missing set cursor");
  assert.ok("advanceSetCursor" in runtime);
  assert.ok("readSetCursor" in runtime);
  const create = runtime.createSetCursor,
    advance = runtime.advanceSetCursor,
    read = runtime.readSetCursor;
  if (
    typeof create !== "function" ||
    typeof advance !== "function" ||
    typeof read !== "function"
  )
    throw new Error("missing cursor functions");
  const actual = runtime.createSet<number>(),
    expected = new Set<number>();
  let a = create(actual),
    b = create(actual),
    x = expected.values(),
    y = expected.values(),
    seed = 1234;
  for (let i = 0; i < 1000; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const value = (seed >>> 8) % 13,
      operation = (seed >>> 24) % 8;
    switch (operation) {
      case 0:
      case 1:
        runtime.addSet(actual, value);
        expected.add(value);
        break;
      case 2:
        runtime.deleteSet(actual, value);
        expected.delete(value);
        break;
      case 3:
        runtime.clearSet(actual);
        expected.clear();
        break;
      case 4:
        a = create(actual);
        x = expected.values();
        break;
      case 5:
        b = create(actual);
        y = expected.values();
        break;
      default: {
        const first = operation === 6,
          cursor = first ? a : b,
          want = (first ? x : y).next();
        const has = advance(cursor);
        assert.equal(has, !want.done);
        if (has) assert.equal(read(cursor), want.value);
      }
    }
  }
});

test("cursor state distinguishes stored undefined and bounds sequence exhaustion", () => {
  const set = runtime.createSet<undefined>();
  runtime.addSet(set, undefined);
  const cursor = runtime.createSetCursor(set);
  assert.equal(runtime.advanceSetCursor(cursor), true);
  assert.equal(runtime.readSetCursor(cursor), undefined);
  assert.equal(runtime.advanceSetCursor(cursor), false);
  assert.equal(cursor.set, undefined);
  assert.equal(cursor.current, undefined);
  // Seed the internal counter to exercise the otherwise impractical resource boundary.
  set.order = Number.MAX_SAFE_INTEGER;
  assert.equal(runtime.addSet(set, undefined), false);
  runtime.clearSet(set);
  assert.throws(
    () => runtime.addSet(set, undefined),
    (error) => error === "SET_ORDER_LIMIT",
  );
  assert.equal(set.size, 0);
  assert.equal(set.head, undefined);
});

test("unchanged insertion-order traversal performs linear entry work", () => {
  const count = 512,
    set = runtime.createSet<number>();
  for (let i = 0; i < count; i++) runtime.addSet(set, i);
  let reads = 0,
    entry = set.head;
  while (entry !== undefined) {
    const order = entry.order;
    Object.defineProperty(entry, "order", {
      get() {
        reads++;
        return order;
      },
    });
    entry = entry.next;
  }
  const cursor = runtime.createSetCursor(set);
  for (let i = 0; i < count; i++) {
    assert.ok(runtime.advanceSetCursor(cursor));
    assert.equal(runtime.readSetCursor(cursor), i);
  }
  assert.equal(runtime.advanceSetCursor(cursor), false);
  assert.ok(reads <= count * 3, `traversal read ${reads} sequence numbers`);
});
