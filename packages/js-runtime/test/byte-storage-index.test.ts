import { test } from "node:test";
import assert from "node:assert/strict";
import * as storage from "../src/bytes/index.ts";

function create(length = 4, maximum = 8, resizable = true, limit = 16) {
  const result = storage.createByteStorage(length, maximum, resizable, limit);
  assert.ok(result.ok);
  return result.value;
}
test("growth preserves bytes and shrinking discards truncated contents", () => {
  const buffer = create();
  assert.deepEqual([...storage.byteStorageData(buffer)!], [0, 0, 0, 0]);
  storage.byteStorageData(buffer, "write")!.set([1, 2, 3, 4]);
  assert.equal(storage.resizeByteStorage(buffer, 6), "none");
  assert.deepEqual([...storage.byteStorageData(buffer)!], [1, 2, 3, 4, 0, 0]);
  assert.equal(storage.resizeByteStorage(buffer, 2), "none");
  assert.equal(storage.resizeByteStorage(buffer, 4), "none");
  assert.deepEqual([...storage.byteStorageData(buffer)!], [1, 2, 0, 0]);
});
test("failed resize leaves data and state unchanged", () => {
  const buffer = create(4, 20, true, 8);
  const before = storage.byteStorageData(buffer);
  for (const length of [-1, 1.5, NaN, Infinity, 21])
    assert.equal(storage.resizeByteStorage(buffer, length), "invalid-length");
  assert.equal(storage.resizeByteStorage(buffer, 10), "allocation-limit");
  assert.equal(storage.byteStorageData(buffer), before);
  assert.equal(
    storage.resizeByteStorage(create(4, 4, false), 4),
    "fixed-length",
  );
});
test("detachment is idempotent and distinct from an empty live buffer", () => {
  const buffer = create(0);
  assert.ok(storage.byteStorageData(buffer));
  storage.detachByteStorage(buffer);
  storage.detachByteStorage(buffer);
  assert.equal(storage.byteStorageData(buffer), undefined);
  assert.equal(storage.resizeByteStorage(buffer, 0), "detached");
  assert.deepEqual(storage.transferByteStorage(buffer, 0, "fixed-length"), {
    ok: false,
    error: "detached",
  });
});
test("transfer commits detachment only after successful destination creation", () => {
  const buffer = create(4, 8, true, 16);
  storage.byteStorageData(buffer, "write")!.set([1, 2, 3, 4]);
  assert.deepEqual(
    storage.transferByteStorage(buffer, 9, "preserve-resizability"),
    {
      ok: false,
      error: "invalid-length",
    },
  );
  assert.deepEqual(storage.transferByteStorage(buffer, 17, "fixed-length"), {
    ok: false,
    error: "allocation-limit",
  });
  assert.equal(storage.byteStorageData(buffer)!.length, 4);
  const moved = storage.transferByteStorage(buffer, 6, "preserve-resizability");
  assert.ok(moved.ok);
  assert.equal(storage.byteStorageData(buffer), undefined);
  assert.equal(moved.value.resizable, true);
  assert.equal(moved.value.maxByteLength, 8);
  assert.deepEqual(
    [...storage.byteStorageData(moved.value)!],
    [1, 2, 3, 4, 0, 0],
  );
  const fixed = storage.transferByteStorage(moved.value, 10, "fixed-length");
  assert.ok(fixed.ok);
  assert.equal(fixed.value.resizable, false);
  assert.equal(fixed.value.maxByteLength, 10);
  assert.equal(storage.byteStorageData(moved.value), undefined);
});
test("invalid creation never allocates storage", () => {
  for (const length of [-1, 0.5, NaN, Infinity])
    assert.deepEqual(storage.createByteStorage(length, 8, true, 16), {
      ok: false,
      error: "invalid-length",
    });
  assert.deepEqual(storage.createByteStorage(4, 3, true, 16), {
    ok: false,
    error: "invalid-length",
  });
  assert.deepEqual(storage.createByteStorage(4, 8, false, 16), {
    ok: false,
    error: "invalid-length",
  });
  assert.deepEqual(storage.createByteStorage(8, 8, false, 4), {
    ok: false,
    error: "allocation-limit",
  });
});

test("range copy checks bounds and preserves overlapping bytes", () => {
  const source = create(6),
    target = create(6);
  storage.byteStorageData(source, "write")!.set([1, 2, 3, 4, 5, 6]);
  assert.equal(storage.copyByteStorage(source, target, 1, 2, 3), "none");
  assert.deepEqual([...storage.byteStorageData(target)!], [0, 0, 2, 3, 4, 0]);
  assert.equal(storage.copyByteStorage(source, source, 0, 1, 5), "none");
  assert.deepEqual([...storage.byteStorageData(source)!], [1, 1, 2, 3, 4, 5]);
  assert.equal(storage.copyByteStorage(source, source, 1, 0, 5), "none");
  assert.deepEqual([...storage.byteStorageData(source)!], [1, 2, 3, 4, 5, 5]);
  assert.equal(storage.copyByteStorage(source, target, 6, 6, 0), "none");
  assert.equal(
    storage.copyByteStorage(source, target, 0, 4, 3),
    "invalid-length",
  );
  assert.equal(
    storage.copyByteStorage(source, target, -1, 0, 0),
    "invalid-length",
  );
  storage.detachByteStorage(source);
  assert.equal(storage.copyByteStorage(source, target, 0, 0, 0), "detached");
});

test("element windows track resize, trailing bytes, recovery and detachment", () => {
  const created = storage.createByteStorage(10, 20, true, 20);
  assert.ok(created.ok);
  const value = created.value;
  assert.equal(storage.byteStorageWindow(value, 2, undefined, 4)?.length, 2);
  assert.equal(storage.byteStorageWindow(value, 2, 2, 4)?.length, 2);
  assert.equal(storage.resizeByteStorage(value, 9), "none");
  assert.equal(storage.byteStorageWindow(value, 2, undefined, 4)?.length, 1);
  assert.equal(storage.byteStorageWindow(value, 2, 2, 4), undefined);
  assert.equal(storage.byteStorageWindow(value, 10, undefined, 1), undefined);
  assert.equal(storage.resizeByteStorage(value, 10), "none");
  assert.equal(storage.byteStorageWindow(value, 2, 2, 4)?.length, 2);
  assert.equal(storage.byteStorageWindow(value, 10, 0, 8)?.length, 0);
  assert.equal(storage.byteStorageWindow(value, -1, 0, 1), undefined);
  assert.equal(storage.byteStorageWindow(value, 0, undefined, 0), undefined);
  storage.detachByteStorage(value);
  assert.equal(storage.byteStorageWindow(value, 0, 0, 1), undefined);
});

test("a buffer keeps its backing allocation policy through resize and transfer", () => {
  const allocations: number[] = [];
  const created = storage.createByteStorage(4, 16, true, 16, (length) => {
    allocations.push(length);
    return length === 12 ? undefined : new Uint8Array(length);
  });
  assert.ok(created.ok);
  storage.byteStorageData(created.value, "write")?.set([10, 20, 30, 40]);
  assert.equal(storage.resizeByteStorage(created.value, 8), "none");
  assert.equal(
    storage.resizeByteStorage(created.value, 12),
    "allocation-limit",
  );
  const transfer = storage.transferByteStorage(
    created.value,
    6,
    "fixed-length",
  );
  assert.ok(transfer.ok);
  assert.deepEqual(allocations, [4, 8, 12, 6]);
  assert.deepEqual(
    storage.byteStorageData(transfer.value),
    Uint8Array.of(10, 20, 30, 40, 0, 0),
  );
  assert.equal(storage.byteStorageData(created.value), undefined);
});

test("immutable transfer publishes independent fixed bytes and rejects later mutation", () => {
  const source = create(4, 8, true, 16);
  const original = storage.byteStorageData(source, "write")!;
  original.set([19, 23, 42, 7]);
  const moved = storage.transferByteStorage(source, 6, "immutable");
  assert.ok(moved.ok);
  assert.equal(moved.value.immutable, true);
  assert.equal(moved.value.resizable, false);
  assert.equal(moved.value.maxByteLength, 6);
  assert.equal(storage.byteStorageData(source), undefined);
  original[0] = 99;
  assert.deepEqual(
    [...storage.byteStorageData(moved.value)!],
    [19, 23, 42, 7, 0, 0],
  );
  assert.equal(storage.byteStorageData(moved.value, "write"), undefined);
  assert.equal(
    storage.byteStorageWindow(moved.value, 0, undefined, 1, "write"),
    undefined,
  );
  assert.equal(storage.resizeByteStorage(moved.value, 0), "immutable");
  assert.equal(storage.detachByteStorage(moved.value), "immutable");
  assert.deepEqual(
    storage.transferByteStorage(moved.value, 0, "fixed-length"),
    {
      ok: false,
      error: "immutable",
    },
  );
  assert.equal(
    storage.copyByteStorage(source, moved.value, 0, 0, 0),
    "immutable",
  );
  assert.equal(storage.byteStorageData(moved.value)!.length, 6);
});

test("immutable range copies preserve sources and allow resolved empty ranges", () => {
  const source = create(4);
  storage.byteStorageData(source, "write")!.set([19, 23, 42, 7]);
  const copied = storage.copyImmutableByteStorage(source, 1, 2, 3);
  assert.ok(copied.ok);
  assert.equal(copied.value.immutable, true);
  assert.deepEqual([...storage.byteStorageData(copied.value)!], [23, 42, 0]);
  assert.equal(storage.byteStorageData(source)!.length, 4);
  assert.equal(
    storage.copyByteStorage(source, copied.value, 0, 0, 0),
    "immutable",
  );
  storage.resizeByteStorage(source, 0);
  const empty = storage.copyImmutableByteStorage(source, 4, 0, 0);
  assert.ok(empty.ok);
  assert.equal(storage.byteStorageData(empty.value)!.length, 0);
  assert.deepEqual(storage.copyImmutableByteStorage(source, 0, 1, 1), {
    ok: false,
    error: "invalid-length",
  });
  storage.detachByteStorage(source);
  assert.deepEqual(storage.copyImmutableByteStorage(source, 0, 0, 0), {
    ok: false,
    error: "detached",
  });
});

test("failed immutable transfer preserves the source before detachment", () => {
  const source = create(4, 8, true, 8);
  storage.byteStorageData(source)![0] = 42;
  assert.deepEqual(storage.transferByteStorage(source, 9, "immutable"), {
    ok: false,
    error: "allocation-limit",
  });
  assert.equal(storage.byteStorageData(source)![0], 42);
  assert.equal(source.immutable, false);
});

test("immutable copies survive source mutation and failed destination allocation", () => {
  const source = create(2, 2, false, 4);
  const before = storage.byteStorageData(source, "write")!;
  before.set([19, 42]);
  const copied = storage.copyImmutableByteStorage(source, 0, 2, 2);
  assert.ok(copied.ok);
  before[1] = 99;
  assert.deepEqual([...storage.byteStorageData(copied.value)!], [19, 42]);
  assert.deepEqual(storage.copyImmutableByteStorage(source, 0, 2, 5), {
    ok: false,
    error: "allocation-limit",
  });
  assert.equal(storage.byteStorageData(source), before);
  assert.deepEqual([...before], [19, 99]);
  const empty = storage.copyImmutableByteStorage(
    source,
    Number.MAX_SAFE_INTEGER,
    0,
    0,
  );
  assert.ok(empty.ok);
  assert.equal(storage.byteStorageWindow(empty.value, 0, 0, 1)?.length, 0);
  assert.equal(
    storage.byteStorageWindow(empty.value, 0, 0, 1, "write"),
    undefined,
  );
});
