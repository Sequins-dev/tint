import { test } from "node:test";
import assert from "node:assert/strict";
import { createCollectingRegion } from "../src/heap/index.ts";
import { writeStackRoots } from "./fixtures/stack-roots.ts";
/** One managed frame at `sp` whose map lists the word at sp + 16. */
function stack(memory: Map<number, number>, sp: number, metadata: number) {
  return writeStackRoots(
    (address, value) => {
      memory.set(address, value);
    },
    [{ sp, references: [16] }],
    metadata,
  );
}
function fixture(capacity = 3) {
  const memory = new Map<number, number>([
    [4096, 32],
    [4104, 1],
    [4112, 16],
    [4120, 0],
    [8208, 256],
  ]);
  const head = stack(memory, 8192, 12288);
  const heap = createCollectingRegion({
    base: 256,
    byteLength: capacity * 32,
    metadata: new Uint32Array(capacity * 3 + 99),
    offsets: new Uint32Array(capacity),
    sizes: new Uint32Array(capacity),
    starts: new Float64Array(capacity < 32 ? capacity : 256),
    marks: new Uint8Array(capacity),
    pending: new Uint32Array(capacity),
    roots: new Float64Array(3),
    readWord: (a) => memory.get(a),
    rootHead: () => head,
    isExternal: () => false,
  });
  assert.ok(heap);
  function object(offset: number, next: number) {
    memory.set(256 + offset, 4096);
    memory.set(264 + offset, 0);
    memory.set(272 + offset, next);
  }
  return { heap, memory, object };
}
test("allocation pressure collects dead cycles and reuses space while preserving live nodes", () => {
  const { heap, object, memory } = fixture();
  assert.equal(heap.allocate(32), 0);
  object(0, 256);
  assert.equal(heap.allocate(32), 32);
  object(32, 320);
  assert.equal(heap.allocate(32), 64);
  object(64, 288);
  assert.equal(heap.usedBytes(), 96);
  assert.equal(heap.allocate(48), 32);
  assert.equal(heap.usedBytes(), 80);
  object(32, 0);
  memory.set(8208, 288);
  assert.equal(heap.collect(), "complete");
  assert.equal(heap.usedBytes(), 48);
  assert.equal(heap.allocate(32), 0);
});
test("indexed high-mortality sweeps preserve live addresses across repeated inventories", () => {
  const { heap, object, memory } = fixture(32);
  for (let round = 0; round < 3; round++) {
    for (let index = round === 0 ? 0 : 1; index < 32; index++) {
      assert.equal(heap.allocate(32), index * 32);
      object(index * 32, 0);
    }
    object(0, 0);
    assert.equal(heap.collect(), "complete");
    assert.equal(heap.usedBytes(), 32);
    assert.equal(memory.get(256), 4096);
  }
  memory.set(8208, 0);
  assert.equal(heap.collect(), "complete");
  assert.equal(heap.usedBytes(), 0);
  assert.equal(heap.allocate(1024), 0);
});
test("a failed trace never frees allocations and invalid allocation requests do not collect", () => {
  const { heap, object, memory } = fixture();
  for (let i = 0; i < 3; i++) {
    assert.equal(heap.allocate(32), i * 32);
    object(i * 32, 0);
  }
  memory.set(8208, 264);
  assert.equal(heap.collect(), "read");
  assert.equal(heap.allocate(16), undefined);
  assert.equal(heap.usedBytes(), 96);
  for (const n of [0, -1, 97, 1.5, NaN])
    assert.equal(heap.allocate(n), undefined);
  assert.equal(heap.usedBytes(), 96);
});

test("post-collection allocation indexes free holes using borrowed workspaces", () => {
  const count = 1024,
    storage = new Uint32Array(8192 * 3 + 96);
  let reads = 0;
  const metadata = new Proxy(storage, {
    get(target, key) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const descriptor = 1000000000,
    frame = 1000000064;
  const memory = new Map<number, number>([
    [descriptor, 32],
    [descriptor + 8, 1],
    [descriptor + 16, 16],
    [descriptor + 24, 0],
    [frame + 16, 288],
  ]);
  const head = stack(memory, frame, 1000000256);
  const heap = createCollectingRegion({
    base: 256,
    byteLength: 16 * 1024 * 1024,
    metadata,
    offsets: new Uint32Array(8192),
    sizes: new Uint32Array(8192),
    starts: new Float64Array(16384),
    marks: new Uint8Array(8192),
    pending: new Uint32Array(8192),
    roots: new Float64Array(8),
    readWord: (address) => memory.get(address),
    rootHead: () => head,
    isExternal: () => false,
    maxSteps: 100000,
  });
  assert.ok(heap);
  for (let i = 0; i < count * 2; i++) {
    const offset: number = heap.allocate(32)!;
    assert.equal(offset, i * 32);
    memory.set(256 + offset, descriptor);
    memory.set(264 + offset, 0);
    memory.set(
      272 + offset,
      i % 2 && i < count * 2 - 1 ? 256 + (i + 2) * 32 : 0,
    );
  }
  assert.equal(heap.collect(), "complete");
  assert.equal(heap.usedBytes(), count * 32);
  reads = 0;
  for (let i = 0; i < 512; i++)
    assert.notEqual(heap.allocate(64 + (511 - i) * 16), undefined);
  assert.ok(reads < 20000, `post-collection metadata reads: ${reads}`);
});

test("large buffers occupy high addresses and are reclaimed without moving small survivors", () => {
  const { heap, object } = fixture(32768);
  assert.equal(heap.allocate(32), 0);
  object(0, 0);
  assert.equal(heap.allocate(65536), 1048576 - 65536);
  assert.equal(heap.allocate(32), 32);
  object(32, 0);
  assert.equal(heap.allocate(131072), 1048576 - 65536 - 131072);
  assert.equal(heap.collect(), "complete");
  assert.equal(heap.usedBytes(), 32);
  assert.equal(heap.allocate(131072), 1048576 - 131072);
  assert.equal(heap.allocate(32), 32);
});

test("small-object pressure cannot consume the large-buffer reserve", () => {
  const { heap, memory } = fixture(32768);
  // Invalid root makes collection fail without reclaiming the occupied range.
  memory.set(8208, 264);
  for (let i = 0; i < 48; i++) assert.equal(heap.allocate(16384), i * 16384);
  assert.equal(heap.allocate(16), undefined);
  assert.equal(heap.usedBytes(), 786432);
  assert.equal(heap.allocate(262144), 786432);
  assert.equal(heap.usedBytes(), 1048576);
});

test("large requests may borrow unused small-object space while the reserve stays protected", () => {
  const { heap } = fixture(32768);
  assert.equal(heap.allocate(524288), 524288);
  assert.equal(heap.allocate(32), 0);
});

function compactingFixture(fixupCapacity = 32) {
  const memory = new Map<number, number>([
    [4096, 32],
    [4104, 1],
    [4112, 16],
    [4120, 0],
    [8208, 288],
  ]);
  const head = stack(memory, 8192, 12288);
  const heap = createCollectingRegion({
    base: 256,
    byteLength: 128,
    metadata: new Uint32Array(32 * 3 + 96),
    offsets: new Uint32Array(16),
    sizes: new Uint32Array(16),
    starts: new Float64Array(32),
    marks: new Uint8Array(16),
    pending: new Uint32Array(16),
    roots: new Float64Array(8),
    readWord: (a) => memory.get(a),
    rootHead: () => head,
    isExternal: () => false,
    compaction: {
      offsets: new Uint32Array(16),
      live: new Uint8Array(16),
      pinned: new Uint8Array(16),
      destinations: new Uint32Array(16),
      summary: new Uint32Array(4),
      slots: new Float64Array(fixupCapacity),
      values: new Float64Array(fixupCapacity),
      publishedOffsets: new Uint32Array(16),
      publishedSizes: new Uint32Array(16),
      canWrite: (a) => (a >= 256 && a < 384) || a === 8208,
      write: (a, v) => {
        memory.set(a, v);
        return true;
      },
      move: (to, from, size) => {
        for (let i = 0; i < size; i += 8)
          memory.set(256 + to + i, memory.get(256 + from + i) ?? 0);
        return true;
      },
    },
  });
  assert.ok(heap);
  for (let i = 0; i < 4; i++) {
    assert.equal(heap.allocate(32), i * 32);
    memory.set(256 + i * 32, 4096);
    memory.set(264 + i * 32, 0);
    memory.set(272 + i * 32, i === 1 ? 352 : i === 3 ? 288 : 0);
    memory.set(280 + i * 32, 0);
  }
  return { heap, memory };
}
test("opt-in compaction rewrites rooted cycles and exposes a contiguous free tail", () => {
  const { heap, memory } = compactingFixture();
  assert.equal(heap.collect(), "complete");
  assert.equal(memory.get(8208), 256);
  assert.equal(memory.get(272), 288);
  assert.equal(memory.get(304), 256);
  assert.equal(heap.usedBytes(), 64);
  assert.equal(heap.allocate(64), 64);
});

test("failed compaction preflight retains the original graph and allocation inventory", () => {
  const { heap, memory } = compactingFixture(1),
    before = new Map(memory);
  assert.equal(heap.collect(), "relocation");
  assert.deepEqual(memory, before);
  assert.equal(heap.usedBytes(), 128);
  assert.equal(heap.allocate(64), undefined);
  assert.deepEqual(memory, before);
  assert.equal(heap.usedBytes(), 128);
});
