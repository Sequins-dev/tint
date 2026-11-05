import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRegionAllocator,
  snapshotRegionAllocations,
} from "../src/allocators/region/index.ts";

test("aligned blocks split, reuse and coalesce in either release order", () => {
  for (const order of [
    [0, 16, 48],
    [48, 16, 0],
    [16, 0, 48],
  ]) {
    const a = createRegionAllocator(128, 16, new Uint32Array(12 + 96));
    assert.ok(a);
    assert.equal(a.allocate(1), 0);
    assert.equal(a.allocate(17), 16);
    assert.equal(a.allocate(80), 48);
    assert.equal(a.usedBytes(), 128);
    assert.equal(a.allocate(1), undefined);
    assert.equal(a.allocationSize(16), 32);
    assert.equal(a.allocationSize(17), undefined);
    for (const offset of order) assert.equal(a.release(offset), true);
    assert.equal(a.usedBytes(), 0);
    assert.equal(a.allocate(128), 0);
  }
});

test("metadata exhaustion leaves bytes and inventory unchanged; exact fit needs no split", () => {
  const metadata = new Uint32Array(6 + 96);
  const a = createRegionAllocator(64, 8, metadata);
  assert.ok(a);
  assert.equal(a.allocate(8), 0);
  const before = metadata.slice();
  assert.equal(a.allocate(8), undefined);
  assert.deepEqual(metadata, before);
  assert.equal(a.usedBytes(), 8);
  assert.equal(a.allocate(56), 8);
  assert.equal(a.release(0), true);
  assert.equal(a.allocate(8), 0);
  assert.equal(a.release(8), true);
  assert.equal(a.release(0), true);
  assert.equal(a.allocate(64), 0);
});

test("invalid requests and releases cannot mutate allocator state", () => {
  const metadata = new Uint32Array(12 + 96);
  const a = createRegionAllocator(64, 16, metadata);
  assert.ok(a);
  assert.equal(a.allocate(16), 0);
  const before = metadata.slice();
  for (const size of [0, -1, 0.5, NaN, Infinity, 0xffffffff, 2 ** 32]) {
    assert.equal(a.allocate(size), undefined);
  }
  for (const offset of [-1, 1, 16, 64, NaN, Infinity])
    assert.equal(a.release(offset), false);
  assert.deepEqual(metadata, before);
  assert.equal(a.usedBytes(), 16);
  assert.equal(a.release(0), true);
  assert.equal(a.release(0), false);
});

test("construction validates before touching borrowed metadata", () => {
  const cases: [number, number, number][] = [
    [0, 8, 3],
    [65, 8, 3],
    [64, 3, 3],
    [64, 0, 3],
    [64, 8, 2],
    [64, 8, 4],
    [2 ** 32, 8, 3],
  ];
  for (const [size, alignment, words] of cases) {
    const metadata = new Uint32Array(words + 96).fill(42);
    assert.equal(createRegionAllocator(size, alignment, metadata), undefined);
    assert.ok(metadata.every((v) => v === 42));
  }
  const a = createRegionAllocator(0xfffffff0, 16, new Uint32Array(3 + 96));
  assert.ok(a);
  assert.equal(a.allocate(0xfffffff0), 0);
  assert.equal(a.usedBytes(), 0xfffffff0);
});

test("deterministic allocation churn agrees with an independent occupancy model", () => {
  const metadata = new Uint32Array(384 + 96);
  const a = createRegionAllocator(1024, 8, metadata);
  assert.ok(a);
  const occupied = new Array<boolean>(128).fill(false);
  const live = new Map<number, number>();
  let seed = 17;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  }
  for (let step = 0; step < 10000; step++) {
    if (random() % 3 === 0 && live.size) {
      const offset = [...live.keys()][random() % live.size]!;
      const size = live.get(offset)!;
      assert.equal(a.release(offset), true);
      occupied.fill(false, offset / 8, (offset + size) / 8);
      live.delete(offset);
    } else {
      const bytes = (random() % 96) + 1,
        units = Math.ceil(bytes / 8);
      let expected: number | undefined;
      for (let start = 0; start + units <= 128; start++) {
        if (occupied.slice(start, start + units).every((v) => !v)) {
          expected = start * 8;
          break;
        }
      }
      assert.equal(a.allocate(bytes), expected);
      if (expected !== undefined) {
        live.set(expected, units * 8);
        occupied.fill(true, expected / 8, expected / 8 + units);
      }
    }
    if (step % 31 === 0) {
      const offsets = new Uint32Array(128),
        sizes = new Uint32Array(128);
      const count = snapshotRegionAllocations(metadata, 1024, offsets, sizes);
      assert.equal(count, live.size);
      assert.deepEqual(
        Array.from(offsets.subarray(0, count)),
        [...live.keys()].sort((a, b) => a - b),
      );
      for (let index = 0; index < count!; index++)
        assert.equal(sizes[index], live.get(offsets[index]!));
    }
    assert.equal(a.usedBytes(), occupied.filter(Boolean).length * 8);
    for (const [offset, size] of live)
      assert.equal(a.allocationSize(offset), size);
  }
});

test("allocation inventory snapshots exact starts without modifying allocator state", () => {
  const metadata = new Uint32Array(18 + 96),
    allocator = createRegionAllocator(128, 16, metadata)!;
  const a = allocator.allocate(17)!,
    b = allocator.allocate(16)!,
    c = allocator.allocate(32)!;
  allocator.release(b);
  const before = metadata.slice(),
    offsets = new Uint32Array(3),
    sizes = new Uint32Array(3);
  assert.equal(snapshotRegionAllocations(metadata, 128, offsets, sizes), 2);
  assert.deepEqual([...offsets.subarray(0, 2)], [a, c]);
  assert.deepEqual([...sizes.subarray(0, 2)], [32, 32]);
  assert.deepEqual(metadata, before);
  const small = new Uint32Array([99]);
  assert.equal(
    snapshotRegionAllocations(metadata, 128, small, sizes),
    undefined,
  );
  assert.equal(small[0], 99);
  assert.equal(
    snapshotRegionAllocations(metadata, 128, metadata, sizes),
    undefined,
  );
  assert.deepEqual(metadata, before);
  metadata[3] = 99;
  assert.equal(
    snapshotRegionAllocations(metadata, 128, offsets, sizes),
    undefined,
  );
});

test("first-fit selection survives exact fits, skipped small holes, and coalescing", () => {
  const allocator = createRegionAllocator(256, 16, new Uint32Array(48 + 96))!;
  const offsets = Array.from({ length: 8 }, () => allocator.allocate(32));
  assert.deepEqual(offsets, [0, 32, 64, 96, 128, 160, 192, 224]);
  allocator.release(32);
  allocator.release(96);
  allocator.release(160);
  allocator.release(224);
  assert.equal(allocator.allocate(48), undefined);
  assert.equal(allocator.allocate(32), 32);
  allocator.release(64); // Coalesces with the next hole at 96.
  assert.equal(allocator.allocate(48), 64);
  assert.equal(allocator.allocate(16), 112);
  assert.equal(allocator.allocate(16), 160);
  assert.equal(allocator.allocate(32), 224); // Leaves the smaller 176 hole first.
  assert.equal(allocator.allocate(16), 176);
  assert.equal(allocator.usedBytes(), 256);
});

test("bulk release validates the entire sorted request before changing state", () => {
  const metadata = new Uint32Array(36 + 96),
    allocator = createRegionAllocator(128, 16, metadata)!;
  for (let i = 0; i < 6; i++) assert.equal(allocator.allocate(16), i * 16);
  allocator.release(32);
  for (const offsets of [[0, 1], [0, 32], [48, 16], [16, 16], [96], [128]]) {
    const before = metadata.slice();
    assert.equal(
      allocator.releaseAll(new Uint32Array(offsets), offsets.length),
      false,
    );
    assert.deepEqual(metadata, before);
    assert.equal(allocator.usedBytes(), 80);
  }
  assert.equal(allocator.releaseAll(metadata, 1), false);
  assert.equal(allocator.releaseAll(new Uint32Array([0]), 2), false);
  assert.equal(allocator.releaseAll(new Uint32Array([0]), -1), false);
  assert.equal(allocator.releaseAll(new Uint32Array([0]), 0.5), false);
  assert.equal(allocator.releaseAll(new Uint32Array(), 0), true);
  assert.equal(allocator.releaseAll(new Uint32Array([16, 48, 80]), 3), true);
  assert.equal(allocator.usedBytes(), 32);
  assert.equal(allocator.allocationSize(0), 16);
  assert.equal(allocator.allocationSize(64), 16);
  assert.equal(allocator.allocate(48), 16);
  assert.equal(allocator.allocate(48), 80);
});

test("bulk reclamation compacts a fragmented inventory while preserving live allocations", () => {
  const count = 20000,
    metadata = new Uint32Array((count + 1) * 3 + 96);
  const allocator = createRegionAllocator((count + 1) * 16, 16, metadata)!;
  for (let i = 0; i < count; i++) assert.equal(allocator.allocate(16), i * 16);
  const dead = Uint32Array.from({ length: count / 2 }, (_, i) => i * 32);
  assert.equal(allocator.releaseAll(dead, dead.length), true);
  assert.equal(allocator.usedBytes(), count * 8);
  for (let i = 0; i < count; i++)
    assert.equal(
      allocator.allocationSize(i * 16),
      i % 2 === 0 ? undefined : 16,
    );
  const live = Uint32Array.from({ length: count / 2 }, (_, i) => i * 32 + 16);
  assert.equal(allocator.releaseAll(live, live.length), true);
  assert.equal(allocator.usedBytes(), 0);
  assert.equal(allocator.allocate((count + 1) * 16), 0);
});

test("splitting a free hole does not relocate live allocation descriptors", () => {
  const metadata = new Uint32Array(30 + 96),
    allocator = createRegionAllocator(256, 16, metadata)!;
  allocator.allocate(32);
  allocator.allocate(32);
  allocator.allocate(32);
  allocator.release(0);
  const locate = () =>
    Array.from({ length: 10 }, (_, i) => i).find(
      (i) => metadata[i * 3] === 64 && metadata[i * 3 + 1] === 32,
    );
  const before = locate();
  assert.notEqual(before, undefined);
  assert.equal(allocator.allocate(16), 0);
  assert.equal(locate(), before);
  assert.equal(allocator.allocationSize(64), 32);
});

test("snapshots reject free-chain cycles, overlapping allocations, and malformed recycled slots", () => {
  for (const corrupt of [
    (metadata: Uint32Array) => {
      metadata[2] = 1;
    },
    (metadata: Uint32Array) => {
      metadata[6] = 0;
    },
    (metadata: Uint32Array) => {
      metadata[16] = 0;
      metadata[17] = 0xffffffff;
    },
  ]) {
    const metadata = new Uint32Array(18 + 96),
      allocator = createRegionAllocator(64, 16, metadata)!;
    allocator.allocate(16);
    allocator.allocate(16);
    allocator.allocate(16);
    corrupt(metadata);
    assert.equal(
      snapshotRegionAllocations(
        metadata,
        64,
        new Uint32Array(6),
        new Uint32Array(6),
      ),
      undefined,
    );
  }
});

test("ordered allocation snapshots avoid sorting already ordered inventories", () => {
  const count = 4096;
  const metadata = new Uint32Array((count + 1) * 3 + 96);
  const allocator = createRegionAllocator((count + 1) * 16, 16, metadata);
  assert.ok(allocator);
  for (let i = 0; i < count; i++) assert.equal(allocator.allocate(16), i * 16);
  let reads = 0;
  function observe(array: Uint32Array): Uint32Array {
    return new Proxy(array, {
      get(target, key) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, target);
      },
    });
  }
  const offsets = new Uint32Array(count),
    sizes = new Uint32Array(count);
  assert.equal(
    snapshotRegionAllocations(
      observe(metadata),
      (count + 1) * 16,
      observe(offsets),
      observe(sizes),
    ),
    count,
  );
  for (let i = 0; i < count; i++) {
    assert.equal(offsets[i], i * 16);
    assert.equal(sizes[i], 16);
  }
  assert.ok(reads < count * 20, `snapshot used ${reads} word reads`);
});

test("bulk reclamation coalesces adjacent dead runs before sorting extents", () => {
  const count = 4096,
    storage = new Uint32Array((count + 1) * 3 + 96);
  let reads = 0;
  const metadata = new Proxy(storage, {
    get(target, key) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const allocator = createRegionAllocator((count + 1) * 16, 16, metadata);
  assert.ok(allocator);
  for (let i = 0; i < count; i++) assert.equal(allocator.allocate(16), i * 16);
  const dead = new Uint32Array(count - 1);
  for (let i = 0; i < dead.length; i++) dead[i] = (i + 1) * 16;
  reads = 0;
  assert.equal(allocator.releaseAll(dead, dead.length), true);
  assert.ok(reads < count * 25, `reclamation used ${reads} metadata reads`);
  assert.equal(allocator.usedBytes(), 16);
  assert.equal(allocator.allocate(count * 16), 16);
});

test("first-fit skips a known undersized prefix across interleaved small allocations", () => {
  let reads = 0;
  const storage = new Uint32Array(8192 * 3 + 96);
  const metadata = new Proxy(storage, {
    get(target, key) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const allocator = createRegionAllocator(65536, 16, metadata);
  assert.ok(allocator);
  const holes = 512;
  for (let i = 0; i < holes * 2; i++)
    assert.equal(allocator.allocate(16), i * 16);
  for (let i = 0; i < holes; i++) assert.ok(allocator.release(i * 32));
  reads = 0;
  for (let i = 0; i < holes; i++) {
    assert.equal(allocator.allocate(64), holes * 32 + i * 64);
    assert.equal(allocator.allocate(16), i * 32);
  }
  assert.ok(
    reads < holes * 100,
    `fragmented allocation used ${reads} metadata reads`,
  );
  assert.ok(allocator.release(holes * 32));
  assert.equal(allocator.allocate(64), holes * 32);
});

test("alternating request sizes retain independent first-fit search progress", () => {
  const count = 512,
    storage = new Uint32Array(8192 * 3 + 96);
  let reads = 0;
  const metadata = new Proxy(storage, {
    get(target, key) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const allocator = createRegionAllocator(131072, 16, metadata)!;
  const dead: number[] = [];
  for (let i = 0; i < count; i++) {
    dead.push(allocator.allocate(16)!);
    allocator.allocate(16);
    dead.push(allocator.allocate(48)!);
    allocator.allocate(16);
  }
  assert.ok(allocator.releaseAll(new Uint32Array(dead), dead.length));
  reads = 0;
  for (let i = 0; i < count; i++) {
    assert.equal(allocator.allocate(64), count * 96 + i * 64);
    assert.equal(allocator.allocate(48), i * 96 + 32);
  }
  assert.ok(reads < count * 100, `alternating requests used ${reads} reads`);
});

test("search-hint collisions and boundary repairs preserve first-fit placement", () => {
  const occupied = new Uint8Array(4096),
    metadata = new Uint32Array(4097 * 3 + 96),
    allocator = createRegionAllocator(65536, 16, metadata)!;
  const live = new Map<number, number>();
  const requests = [1, 3, 4, 33, 35, 36, 65];
  let seed = 52;
  function random(): number {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  }
  for (let step = 0; step < 2000; step++) {
    if (live.size > 0 && random() % 3 === 0) {
      const offset = [...live.keys()][random() % live.size]!;
      occupied.fill(0, offset / 16, offset / 16 + live.get(offset)!);
      assert.ok(allocator.release(offset));
      live.delete(offset);
      continue;
    }
    const units = requests[random() % requests.length]!;
    let run = 0,
      expected: number | undefined;
    for (let i = 0; i < occupied.length; i++) {
      run = occupied[i] === 0 ? run + 1 : 0;
      if (run === units) {
        expected = (i + 1 - units) * 16;
        break;
      }
    }
    assert.equal(allocator.allocate(units * 16), expected);
    if (expected !== undefined) {
      occupied.fill(1, expected / 16, expected / 16 + units);
      live.set(expected, units);
    }
  }
  const offsets = Uint32Array.from([...live.keys()].sort((a, b) => a - b));
  assert.ok(allocator.releaseAll(offsets, offsets.length));
  assert.equal(allocator.allocate(65536), 0);
});

test("large unordered inventories use bounded radix work with borrowed scratch", () => {
  const count = 2048,
    metadata = new Uint32Array(count * 3 + 96);
  for (let i = 0; i < count; i++) {
    metadata[i * 3] = (count - 1 - i) * 16;
    metadata[i * 3 + 1] = 16;
    metadata[i * 3 + 2] = 0xffffffff;
  }
  let writes = 0;
  function tracked(): Uint32Array {
    return new Proxy(new Uint32Array(count), {
      get(target, key) {
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
      set(target, key, value) {
        if (typeof key === "string" && /^\d+$/.test(key)) writes++;
        return Reflect.set(target, key, value, target);
      },
    });
  }
  const offsets = tracked(),
    sizes = tracked(),
    scratch = tracked(),
    buckets = new Float64Array(256);
  assert.equal(
    snapshotRegionAllocations(
      metadata,
      count * 16,
      offsets,
      sizes,
      scratch,
      buckets,
    ),
    count,
  );
  for (let i = 0; i < count; i++) {
    assert.equal(offsets[i], i * 16);
    assert.equal(sizes[i], 16);
  }
  assert.ok(writes <= count * 12, `snapshot wrote ${writes} inventory words`);
});

test("radix snapshots preserve unsigned offsets, sizes, and alias failure atomicity", () => {
  const metadata = new Uint32Array(12 + 96);
  for (const [i, offset, size] of [
    [0, 0xff000000, 0xfffff0],
    [1, 0, 0x1000000],
    [2, 0x1000000, 0x7f000000],
    [3, 0x80000000, 0x7f000000],
  ]) {
    metadata[i! * 3] = offset!;
    metadata[i! * 3 + 1] = size!;
    metadata[i! * 3 + 2] = 0xffffffff;
  }
  const offsets = new Uint32Array(4),
    sizes = new Uint32Array(4),
    scratch = new Uint32Array(4),
    buckets = new Float64Array(256);
  assert.equal(
    snapshotRegionAllocations(
      metadata,
      0xfffffff0,
      offsets,
      sizes,
      scratch,
      buckets,
    ),
    4,
  );
  assert.deepEqual([...offsets], [0, 0x1000000, 0x80000000, 0xff000000]);
  assert.deepEqual([...sizes], [0x1000000, 0x7f000000, 0x7f000000, 0xfffff0]);
  for (const [temp, counts] of [
    [offsets, buckets],
    [scratch, new Float64Array(offsets.buffer)],
    [new Uint32Array(3), buckets],
    [scratch, new Float64Array(255)],
  ] as const) {
    offsets.fill(77);
    sizes.fill(88);
    assert.equal(
      snapshotRegionAllocations(
        metadata,
        0xfffffff0,
        offsets,
        sizes,
        temp,
        counts,
      ),
      undefined,
    );
    assert.deepEqual([...offsets], [77, 77, 77, 77]);
    assert.deepEqual([...sizes], [88, 88, 88, 88]);
  }
  metadata[0] = 0x80000000;
  assert.equal(
    snapshotRegionAllocations(
      metadata,
      0xfffffff0,
      offsets,
      sizes,
      scratch,
      buckets,
    ),
    undefined,
  );
});

test("descriptor-ordered sweep merges free extents without searching the inventory", () => {
  const metadata = new Uint32Array(3 * 16 + 96),
    allocator = createRegionAllocator(256, 16, metadata);
  assert.ok(allocator);
  const allocated = Array.from({ length: 8 }, () => allocator.allocate(16));
  assert.deepEqual(allocated, [0, 16, 32, 48, 64, 80, 96, 112]);
  assert.equal(allocator.release(16), true);
  assert.equal(allocator.release(80), true);
  const offsets = new Uint32Array(16),
    sizes = new Uint32Array(16),
    ids = new Uint32Array(16),
    buckets = new Float64Array(256);
  const count = snapshotRegionAllocations(
    metadata,
    256,
    offsets,
    sizes,
    ids,
    buckets,
  );
  assert.equal(count, 6);
  for (let i = 0; i < count!; i++)
    assert.equal(metadata[ids[i]! * 3], offsets[i]);
  const dead = new Uint32Array([ids[0]!, ids[1]!, ids[3]!, ids[5]!]);
  const before = metadata.slice();
  assert.equal(
    allocator.releaseDescriptors(new Uint32Array([dead[0]!, dead[0]!]), 2),
    false,
  );
  assert.deepEqual(metadata, before);
  assert.equal(allocator.releaseDescriptors(dead, dead.length), true);
  assert.equal(allocator.usedBytes(), 32);
  assert.equal(allocator.allocationSize(48), 16);
  assert.equal(allocator.allocationSize(96), 16);
  assert.equal(allocator.allocate(48), 0);
  assert.equal(allocator.allocate(32), 64);
  assert.equal(allocator.allocate(144), 112);
});

test("descriptor sweep matches address-based reclamation through deterministic churn", () => {
  const metaA = new Uint32Array(256 * 3 + 96),
    metaB = new Uint32Array(256 * 3 + 96);
  const a = createRegionAllocator(4096, 16, metaA),
    b = createRegionAllocator(4096, 16, metaB);
  assert.ok(a && b);
  const offsets = new Uint32Array(256),
    sizes = new Uint32Array(256),
    ids = new Uint32Array(256),
    buckets = new Float64Array(256);
  let seed = 42;
  for (let round = 0; round < 100; round++) {
    for (let n = 0; n < 20; n++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const bytes = ((seed % 8) + 1) * 16;
      assert.equal(a.allocate(bytes), b.allocate(bytes));
    }
    const count = snapshotRegionAllocations(
      metaA,
      4096,
      offsets,
      sizes,
      ids,
      buckets,
    );
    assert.notEqual(count, undefined);
    const deadIds: number[] = [],
      deadOffsets: number[] = [];
    for (let i = 0; i < count!; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      if (seed % 3 !== 0) {
        deadIds.push(ids[i]!);
        deadOffsets.push(offsets[i]!);
      }
    }
    assert.equal(
      a.releaseDescriptors(new Uint32Array(deadIds), deadIds.length),
      true,
    );
    assert.equal(
      b.releaseAll(new Uint32Array(deadOffsets), deadOffsets.length),
      true,
    );
    assert.equal(a.usedBytes(), b.usedBytes());
    const outB = new Uint32Array(256),
      sizeB = new Uint32Array(256);
    const nA = snapshotRegionAllocations(metaA, 4096, offsets, sizes),
      nB = snapshotRegionAllocations(metaB, 4096, outB, sizeB);
    assert.equal(nA, nB);
    assert.deepEqual(offsets.slice(0, nA), outB.slice(0, nB));
    assert.deepEqual(sizes.slice(0, nA), sizeB.slice(0, nB));
  }
});

test("wide radix workspace halves passes for large unordered inventories", () => {
  const count = 65536,
    metadata = new Uint32Array(count * 3 + 96);
  for (let i = 0; i < count; i++) {
    metadata[i * 3] = (count - 1 - i) * 16;
    metadata[i * 3 + 1] = 16;
    metadata[i * 3 + 2] = 0xffffffff;
  }
  let writes = 0;
  function tracked(): Uint32Array {
    return new Proxy(new Uint32Array(count), {
      get(target, key) {
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
      set(target, key, value) {
        if (typeof key === "string" && /^\d+$/.test(key)) writes++;
        return Reflect.set(target, key, value, target);
      },
    });
  }
  const offsets = tracked(),
    sizes = tracked(),
    scratch = tracked(),
    buckets = new Float64Array(65536);
  assert.equal(
    snapshotRegionAllocations(
      metadata,
      count * 16,
      offsets,
      sizes,
      scratch,
      buckets,
    ),
    count,
  );
  for (let i = 0; i < count; i++) {
    assert.equal(offsets[i], i * 16);
    assert.equal(sizes[i], 16);
  }
  assert.ok(writes <= count * 8, `snapshot wrote ${writes} inventory words`);
});

test("colliding request sizes retain independent first-fit search progress", () => {
  const count = 512,
    storage = new Uint32Array(8192 * 3 + 96);
  let reads = 0;
  const metadata = new Proxy(storage, {
    get(target, key) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const allocator = createRegionAllocator(524288, 16, metadata)!;
  const dead: number[] = [];
  for (let i = 0; i < count; i++) {
    dead.push(allocator.allocate(16)!);
    allocator.allocate(16);
    dead.push(allocator.allocate(48)!);
    allocator.allocate(16);
  }
  assert.ok(allocator.releaseAll(new Uint32Array(dead), dead.length));
  reads = 0;
  for (let i = 0; i < count; i++) {
    assert.equal(allocator.allocate(64), count * 96 + i * 640);
    assert.equal(allocator.allocate(576), count * 96 + i * 640 + 64);
  }
  assert.ok(reads < count * 100, `alternating requests used ${reads} reads`);
});

test("retaining a snapshot rebuilds descriptors without moving live allocations", () => {
  const metadata = new Uint32Array(3 * 64 + 96),
    allocator = createRegionAllocator(1024, 16, metadata);
  assert.ok(allocator);
  for (let i = 0; i < 32; i++) assert.equal(allocator.allocate(16), i * 16);
  const offsets = new Uint32Array(64),
    sizes = new Uint32Array(64),
    ids = new Uint32Array(64),
    scratch = new Float64Array(256);
  assert.equal(
    snapshotRegionAllocations(metadata, 1024, offsets, sizes, ids, scratch),
    32,
  );
  const kept = new Uint32Array([ids[0]!, ids[15]!, ids[31]!]);
  const before = metadata.slice();
  assert.equal(
    allocator.retainDescriptors(
      new Uint32Array([kept[1]!, kept[1]!]),
      2,
      offsets,
      sizes,
    ),
    false,
  );
  assert.deepEqual(metadata, before);
  assert.equal(allocator.retainDescriptors(kept, 3, metadata, sizes), false);
  assert.deepEqual(metadata, before);
  assert.equal(allocator.retainDescriptors(kept, 3, offsets, sizes), true);
  assert.equal(allocator.usedBytes(), 48);
  assert.equal(snapshotRegionAllocations(metadata, 1024, offsets, sizes), 3);
  assert.deepEqual([...offsets.slice(0, 3)], [0, 240, 496]);
  for (const offset of [0, 240, 496])
    assert.equal(allocator.allocationSize(offset), 16);
  assert.equal(allocator.allocationSize(16), undefined);
  assert.equal(allocator.allocate(224), 16);
  assert.equal(allocator.allocate(240), 256);
  assert.equal(allocator.allocate(512), 512);
  assert.equal(
    allocator.retainDescriptors(new Uint32Array(0), 0, offsets, sizes),
    true,
  );
  assert.equal(allocator.usedBytes(), 0);
  assert.equal(allocator.allocate(1024), 0);
});

test("survivor rebuilding matches ordinary release across repeated allocation cycles", () => {
  const ma = new Uint32Array(256 * 3 + 96),
    mb = new Uint32Array(256 * 3 + 96),
    a = createRegionAllocator(4096, 16, ma),
    b = createRegionAllocator(4096, 16, mb);
  assert.ok(a && b);
  const offsets = new Uint32Array(256),
    sizes = new Uint32Array(256),
    ids = new Uint32Array(256),
    scratch = new Float64Array(256),
    out = new Uint32Array(256),
    lengths = new Uint32Array(256);
  let seed = 29;
  for (let round = 0; round < 50; round++) {
    for (let n = 0; n < 30; n++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const bytes = ((seed % 8) + 1) * 16;
      assert.equal(a.allocate(bytes), b.allocate(bytes));
    }
    const count = snapshotRegionAllocations(
      ma,
      4096,
      offsets,
      sizes,
      ids,
      scratch,
    );
    assert.notEqual(count, undefined);
    const keep: number[] = [],
      dead: number[] = [];
    for (let i = 0; i < count!; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      if (seed % 4 === 0) keep.push(ids[i]!);
      else dead.push(offsets[i]!);
    }
    assert.equal(
      a.retainDescriptors(new Uint32Array(keep), keep.length, offsets, sizes),
      true,
    );
    assert.equal(b.releaseAll(new Uint32Array(dead), dead.length), true);
    const ca = snapshotRegionAllocations(ma, 4096, offsets, sizes),
      cb = snapshotRegionAllocations(mb, 4096, out, lengths);
    assert.notEqual(ca, undefined);
    assert.equal(ca, cb);
    assert.deepEqual(offsets.slice(0, ca), out.slice(0, cb));
    assert.deepEqual(sizes.slice(0, ca), lengths.slice(0, cb));
    assert.equal(a.usedBytes(), b.usedBytes());
  }
});

test("new larger requests reuse proven undersized prefixes", () => {
  const count = 4096,
    storage = new Uint32Array(32768 * 3 + 96);
  let reads = 0;
  const metadata = new Proxy(storage, {
    get(target, key) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const allocator = createRegionAllocator(16 * 1024 * 1024, 16, metadata)!;
  const dead = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    dead[i] = allocator.allocate(16)!;
    allocator.allocate(16);
  }
  assert.ok(allocator.releaseAll(dead, count));
  reads = 0;
  let offset = count * 32;
  for (let i = 2; i < 514; i++) {
    assert.equal(allocator.allocate(i * 16), offset);
    offset += i * 16;
  }
  assert.ok(reads < 100000, `distinct sizes used ${reads} reads`);
});

test("indexed first-fit bounds mixed-size searches through fragmented holes", () => {
  const count = 4096,
    storage = new Uint32Array(32768 * 3 + 96);
  let reads = 0;
  const metadata = new Proxy(storage, {
    get(target, key) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const allocator = createRegionAllocator(16 * 1024 * 1024, 16, metadata)!;
  const dead = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    dead[i] = allocator.allocate(16 * (1 + (i % 64)))!;
    allocator.allocate(16);
  }
  assert.ok(allocator.releaseAll(dead, count));
  assert.equal(
    allocator.enableSearchIndex(new Uint32Array(8192), new Uint32Array(16384)),
    true,
  );
  reads = 0;
  for (let i = 0; i < 512; i++)
    assert.notEqual(allocator.allocate(2048 + (511 - i) * 16), undefined);
  assert.ok(reads < 20000, `indexed allocation metadata reads: ${reads}`);
});

test("indexed allocation preserves first-fit through reclamation and scratch reuse", () => {
  const metadata = new Uint32Array(3 * 1024 + 96),
    indexed = createRegionAllocator(65536, 16, metadata)!,
    plain = createRegionAllocator(65536, 16, new Uint32Array(metadata.length))!,
    descriptors = new Uint32Array(1024),
    maxima = new Uint32Array(2048);
  const live: number[] = [];
  let seed = 913;
  function random(n: number) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  }
  assert.ok(indexed.enableSearchIndex(descriptors, maxima));
  for (let step = 0; step < 10000; step++) {
    if (live.length && random(5) < 2) {
      const i = random(live.length),
        offset = live[i]!;
      assert.equal(indexed.release(offset), plain.release(offset));
      live.splice(i, 1);
      // Reclamation invalidates the borrowed search workspace.
      descriptors.fill(0xffffffff);
      maxima.fill(NaN);
      if (step % 3) assert.ok(indexed.enableSearchIndex(descriptors, maxima));
    } else {
      const bytes = (random(100) + 1) * 16,
        a = indexed.allocate(bytes),
        b = plain.allocate(bytes);
      assert.equal(a, b, `step ${step}`);
      if (a !== undefined) live.push(a);
    }
    assert.equal(indexed.usedBytes(), plain.usedBytes());
    if (step % 113 === 0) {
      indexed.disableSearchIndex();
      descriptors.fill(0xffffffff);
      maxima.fill(NaN);
    }
  }
  assert.equal(indexed.enableSearchIndex(metadata, maxima), false);
  assert.equal(
    indexed.enableSearchIndex(descriptors, new Uint32Array(0)),
    false,
  );
});

test("indexed repeated sizes reuse the selected leaf and avoid redundant ancestor reads", () => {
  const count = 256,
    metadata = new Uint32Array(4096 * 3 + 96),
    raw = new Uint32Array(1024);
  let reads = 0;
  const maxima = new Proxy(raw, {
    get(target, key) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const allocator = createRegionAllocator(4 * 1024 * 1024, 16, metadata)!,
    dead = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    dead[i] = allocator.allocate(16)!;
    allocator.allocate(16);
  }
  assert.ok(allocator.releaseAll(dead, count));
  assert.ok(allocator.enableSearchIndex(new Uint32Array(512), maxima));
  allocator.allocate(2048);
  reads = 0;
  for (let i = 0; i < 512; i++)
    assert.notEqual(allocator.allocate(2048), undefined);
  assert.ok(reads < 512 * 30, `repeated allocation index reads: ${reads}`);
});

test("indexed metadata exhaustion preserves failed requests and permits exact fits", () => {
  const metadata = new Uint32Array(6 + 96),
    allocator = createRegionAllocator(128, 16, metadata)!;
  assert.equal(allocator.allocate(16), 0);
  assert.ok(
    allocator.enableSearchIndex(new Uint32Array(2), new Uint32Array(4)),
  );
  const before = metadata.slice();
  assert.equal(allocator.allocate(32), undefined);
  assert.deepEqual(metadata, before);
  assert.equal(allocator.allocate(112), 16);
  assert.equal(allocator.release(0), true);
  assert.equal(allocator.allocate(16), 0);
});

test("allocator-owned snapshots scan only the initialized descriptor prefix", () => {
  const storage = new Uint32Array(3 * 100000 + 96);
  let reads = 0;
  const metadata = new Proxy(storage, {
    get(target, key) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const allocator = createRegionAllocator(4096, 16, metadata)!;
  for (let i = 0; i < 32; i++) allocator.allocate(16);
  const offsets = new Uint32Array(64),
    sizes = new Uint32Array(64),
    scratch = new Uint32Array(64),
    buckets = new Float64Array(256);
  reads = 0;
  assert.equal(
    snapshotRegionAllocations(
      metadata,
      4096,
      offsets,
      sizes,
      scratch,
      buckets,
      allocator.descriptorCount(),
    ),
    32,
  );
  assert.ok(reads < 1000, `owned snapshot metadata reads: ${reads}`);
  for (let i = 0; i < 32; i++) {
    assert.equal(offsets[i], i * 16);
    assert.equal(sizes[i], 16);
  }
  const expected = offsets.slice();
  assert.equal(
    snapshotRegionAllocations(metadata, 4096, offsets, sizes, scratch, buckets),
    32,
  );
  assert.deepEqual(offsets, expected);
});

test("high-end placement preserves ordinary first-fit and coalesces after release", () => {
  const heap = createRegionAllocator(1024, 16, new Uint32Array(64 * 3 + 96))!;
  assert.equal(heap.allocate(16), 0);
  assert.equal(heap.allocateFromEnd(64), 960);
  assert.equal(heap.allocate(32), 16);
  assert.equal(heap.allocateFromEnd(32), 928);
  assert.equal(heap.usedBytes(), 144);
  assert.equal(heap.release(960), true);
  assert.equal(heap.release(928), true);
  assert.equal(heap.allocateFromEnd(512), 512);
  assert.equal(heap.allocate(16), 48);
});

test("indexed and unindexed mixed-direction allocation match a bitmap oracle", () => {
  for (const indexed of [false, true]) {
    const heap = createRegionAllocator(
      1024,
      16,
      new Uint32Array(128 * 3 + 96),
    )!;
    const occupied = new Uint8Array(64),
      live = new Map<number, number>();
    let seed = 17;
    for (let iteration = 0; iteration < 5000; iteration++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      if ((seed >>> 25) % 3 === 0 && live.size > 0) {
        const offset = [...live.keys()][(seed >>> 8) % live.size]!;
        assert.equal(heap.release(offset), true);
        occupied.fill(0, offset / 16, offset / 16 + live.get(offset)!);
        live.delete(offset);
      } else {
        const size = ((seed >>> 8) % 8) + 1,
          high = (seed & 1) === 0;
        if (indexed && iteration % 17 === 0)
          assert.equal(
            heap.enableSearchIndex(new Uint32Array(128), new Uint32Array(256)),
            true,
          );
        let expected: number | undefined;
        for (let start = 0; start + size <= occupied.length; start++) {
          let free = true;
          for (let i = 0; i < size; i++) if (occupied[start + i]) free = false;
          if (free) {
            expected = start * 16;
            if (!high) break;
          }
        }
        const actual = high
          ? heap.allocateFromEnd(size * 16)
          : heap.allocate(size * 16);
        assert.equal(
          actual,
          expected,
          `iteration ${iteration}, high=${high}, indexed=${indexed}`,
        );
        if (actual !== undefined) {
          occupied.fill(1, actual / 16, actual / 16 + size);
          live.set(actual, size);
        }
      }
      assert.equal(
        heap.usedBytes(),
        occupied.reduce((sum, value) => sum + value * 16, 0),
      );
    }
  }
});

test("high-end failure preserves indexed metadata at descriptor exhaustion", () => {
  const metadata = new Uint32Array(99),
    heap = createRegionAllocator(1024, 16, metadata)!;
  const descriptors = new Uint32Array(1),
    maxima = new Uint32Array(2);
  assert.equal(heap.enableSearchIndex(descriptors, maxima), true);
  const before = metadata.slice(),
    tree = maxima.slice();
  assert.equal(heap.allocateFromEnd(512), undefined);
  assert.deepEqual(metadata, before);
  assert.deepEqual(maxima, tree);
  assert.equal(heap.allocateFromEnd(1024), 0);
  assert.equal(heap.usedBytes(), 1024);
});

test("bounded placement isolates opposite ends even when the free extent crosses the boundary", () => {
  for (const indexed of [false, true]) {
    const metadata = new Uint32Array(64 * 3 + 96),
      heap = createRegionAllocator(1024, 16, metadata)!;
    assert.equal(typeof heap.allocateBelow, "function");
    assert.equal(typeof heap.allocateAbove, "function");
    if (indexed)
      assert.equal(
        heap.enableSearchIndex(new Uint32Array(64), new Uint32Array(128)),
        true,
      );
    assert.equal(heap.allocateBelow(512, 768), 0);
    assert.equal(heap.allocateAbove(128, 768), 896);
    const before = metadata.slice();
    assert.equal(heap.allocateBelow(272, 768), undefined);
    assert.equal(heap.allocateAbove(144, 768), undefined);
    assert.deepEqual(metadata, before);
    assert.equal(heap.allocateBelow(256, 768), 512);
    assert.equal(heap.allocateAbove(128, 768), 768);
    for (const offset of [0, 512, 768, 896])
      assert.equal(heap.release(offset), true);
    assert.equal(heap.allocate(1024), 0);
  }
});

test("bounded searches match a bitmap oracle across changing limits and index rebuilds", () => {
  const metadata = new Uint32Array(128 * 3 + 96),
    heap = createRegionAllocator(1024, 16, metadata)!,
    occupied = new Uint8Array(64),
    live = new Map<number, number>();
  let seed = 41;
  for (let iteration = 0; iteration < 10000; iteration++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    if ((seed >>> 25) % 3 === 0 && live.size > 0) {
      const offset = [...live.keys()][(seed >>> 8) % live.size]!;
      assert.equal(heap.release(offset), true);
      occupied.fill(0, offset / 16, offset / 16 + live.get(offset)!);
      live.delete(offset);
    } else {
      const size = ((seed >>> 8) % 8) + 1,
        high = (seed & 1) === 0,
        limit = (seed >>> 16) % 1025;
      if (iteration % 17 === 0)
        assert.equal(
          heap.enableSearchIndex(new Uint32Array(128), new Uint32Array(256)),
          true,
        );
      let expected: number | undefined;
      for (let start = 0; start + size <= occupied.length; start++) {
        if (high ? start * 16 < limit : (start + size) * 16 > limit) continue;
        let free = true;
        for (let i = 0; i < size; i++) if (occupied[start + i]) free = false;
        if (free) {
          expected = start * 16;
          if (!high) break;
        }
      }
      const before = metadata.slice();
      const actual = high
        ? heap.allocateAbove(size * 16, limit)
        : heap.allocateBelow(size * 16, limit);
      assert.equal(
        actual,
        expected,
        `iteration ${iteration}, high=${high}, limit=${limit}`,
      );
      if (actual === undefined) assert.deepEqual(metadata, before);
      else {
        occupied.fill(1, actual / 16, actual / 16 + size);
        live.set(actual, size);
      }
    }
  }
  for (const limit of [-1, 1025, 1.5, NaN, Infinity]) {
    const before = metadata.slice();
    assert.equal(heap.allocateBelow(16, limit), undefined);
    assert.equal(heap.allocateAbove(16, limit), undefined);
    assert.deepEqual(metadata, before);
  }
});

test("replacement inventory publishes relocated extents and rejects malformed plans atomically", () => {
  const metadata = new Uint32Array(32 * 3 + 96);
  const heap = createRegionAllocator(1024, 16, metadata)!;
  assert.equal(typeof heap.replaceAllocations, "function");
  heap.allocate(128);
  heap.allocateFromEnd(128);
  heap.enableSearchIndex(new Uint32Array(32), new Uint32Array(64));
  const offsets = new Uint32Array([0, 64]),
    sizes = new Uint32Array([32, 64]);
  const before = metadata.slice();
  assert.equal(
    heap.replaceAllocations(new Uint32Array([0, 16]), sizes, 2),
    false,
  );
  assert.deepEqual(metadata, before);
  assert.equal(heap.replaceAllocations(offsets, sizes, 2), true);
  assert.equal(heap.usedBytes(), 96);
  assert.equal(heap.allocationSize(896), undefined);
  assert.equal(heap.allocationSize(64), 64);
  assert.equal(heap.allocate(32), 32);
  assert.equal(heap.allocateFromEnd(896), 128);
  assert.equal(heap.replaceAllocations(offsets, sizes, 0), true);
  assert.equal(heap.allocate(1024), 0);
});

test("replacement capacity and alias failures preserve an enabled search index", () => {
  const metadata = new Uint32Array(3 * 3 + 96),
    heap = createRegionAllocator(128, 16, metadata)!;
  const descriptors = new Uint32Array(4),
    maxima = new Uint32Array(8);
  assert.equal(heap.enableSearchIndex(descriptors, maxima), true);
  const before = metadata.slice(),
    tree = maxima.slice();
  assert.equal(
    heap.replaceAllocations(
      new Uint32Array([16, 64]),
      new Uint32Array([16, 16]),
      2,
    ),
    false,
  );
  assert.equal(
    heap.replaceAllocations(metadata.subarray(0, 1), new Uint32Array([16]), 1),
    false,
  );
  assert.deepEqual(metadata, before);
  assert.deepEqual(maxima, tree);
  assert.equal(heap.allocate(128), 0);
});
