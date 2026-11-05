import assert from "node:assert/strict";
import { test } from "node:test";
import {
  planCompaction as plan,
  type CompactionInput,
} from "../src/relocation/index.ts";
function planCompaction(input: CompactionInput, destinations: Uint32Array) {
  const summary = new Uint32Array(4);
  if (!plan(input, destinations, summary)) return undefined;
  return {
    liveCount: summary[0],
    liveBytes: summary[1],
    movedBytes: summary[2],
    largestFreeExtent: summary[3],
  };
}
function input(
  offsets: number[],
  sizes: number[],
  live: number[],
  pinned = live.map(() => 0),
): CompactionInput {
  return {
    byteLength: 256,
    alignment: 16,
    count: offsets.length,
    offsets: new Uint32Array(offsets),
    sizes: new Uint32Array(sizes),
    live: new Uint8Array(live),
    pinned: new Uint8Array(pinned),
  };
}
test("compacts surviving allocations in order and leaves inputs unchanged", () => {
  const request = input([0, 48, 96, 160], [32, 32, 48, 32], [0, 1, 1, 1]);
  const before = structuredClone(request),
    output = new Uint32Array(6).fill(123);
  assert.deepEqual(planCompaction(request, output), {
    liveCount: 3,
    liveBytes: 112,
    movedBytes: 112,
    largestFreeExtent: 144,
  });
  assert.deepEqual([...output], [0xffffffff, 0, 32, 80, 123, 123]);
  assert.deepEqual(request, before);
});
test("pinned survivors remain fixed and divide the compacted ranges", () => {
  const request = input(
    [16, 80, 112, 208],
    [32, 16, 32, 32],
    [1, 1, 0, 1],
    [0, 1, 0, 0],
  );
  const output = new Uint32Array(4);
  assert.deepEqual(planCompaction(request, output), {
    liveCount: 3,
    liveBytes: 80,
    movedBytes: 64,
    largestFreeExtent: 128,
  });
  assert.deepEqual([...output], [0, 80, 0xffffffff, 96]);
});
test("invalid inventory, budgets, marks and aliases never write destinations", () => {
  const valid = input([0, 48], [32, 32], [1, 1]);
  const cases: CompactionInput[] = [
    { ...valid, byteLength: 255 },
    { ...valid, alignment: 3 },
    { ...valid, alignment: 0 },
    { ...valid, count: 3 },
    { ...valid, count: -1 },
    { ...valid, count: 1.5 },
    { ...valid, offsets: new Uint32Array([16, 32]) },
    { ...valid, sizes: new Uint32Array([0, 16]) },
    { ...valid, sizes: new Uint32Array([17, 16]) },
    { ...valid, offsets: new Uint32Array([0, 240]) },
    { ...valid, live: new Uint8Array([1, 2]) },
    { ...valid, pinned: new Uint8Array([0, 2]) },
    { ...valid, live: new Uint8Array([0, 1]), pinned: new Uint8Array([1, 0]) },
    { ...valid, sizes: new Uint32Array(1) },
  ];
  for (const request of cases) {
    const output = new Uint32Array(2).fill(99);
    assert.equal(planCompaction(request, output), undefined);
    assert.deepEqual([...output], [99, 99]);
  }
  const output = new Uint32Array(1).fill(42);
  assert.equal(planCompaction(valid, output), undefined);
  assert.equal(output[0], 42);
  for (const key of ["offsets", "sizes", "live", "pinned"] as const) {
    const view = valid[key],
      before = new Uint8Array(view.buffer).slice();
    const aliased = new Uint32Array(
      view.buffer,
      0,
      Math.floor(view.byteLength / 4),
    );
    assert.equal(planCompaction(valid, aliased), undefined);
    assert.deepEqual(new Uint8Array(view.buffer), before);
  }
});
test("empty and uint32-boundary inventories preserve exact offsets", () => {
  const output = new Uint32Array(2).fill(7);
  assert.deepEqual(planCompaction(input([], [], []), output), {
    liveCount: 0,
    liveBytes: 0,
    movedBytes: 0,
    largestFreeExtent: 256,
  });
  assert.deepEqual([...output], [7, 7]);
  const request = {
    ...input([0xffffffe0], [16], [1], [1]),
    byteLength: 0xfffffff0,
  };
  assert.deepEqual(planCompaction(request, output), {
    liveCount: 1,
    liveBytes: 16,
    movedBytes: 0,
    largestFreeExtent: 0xffffffe0,
  });
  assert.equal(output[0], 0xffffffe0);
});

test("planned moves preserve bytes and non-overlap across fragmented inventories", () => {
  let seed = 19;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let round = 0; round < 300; round++) {
    const offsets: number[] = [],
      sizes: number[] = [],
      live: number[] = [],
      pins: number[] = [];
    let cursor = 0;
    while (cursor < 1024) {
      cursor += (random() % 3) * 8;
      const size = (1 + (random() % 5)) * 8;
      if (cursor + size > 1024) break;
      offsets.push(cursor);
      sizes.push(size);
      const alive = random() % 3 === 0 ? 0 : 1;
      live.push(alive);
      pins.push(alive && random() % 7 === 0 ? 1 : 0);
      cursor += size;
    }
    const request = {
      ...input(offsets, sizes, live, pins),
      byteLength: 1024,
      alignment: 8,
    };
    const destinations = new Uint32Array(offsets.length),
      summary = planCompaction(request, destinations);
    assert.ok(summary);
    const bytes = Uint8Array.from({ length: 1024 }, () => random() % 256),
      before = bytes.slice(),
      occupied = new Uint8Array(1024);
    let liveBytes = 0,
      movedBytes = 0;
    for (let i = 0; i < offsets.length; i++) {
      if (!live[i]) {
        assert.equal(destinations[i], 0xffffffff);
        continue;
      }
      const old = offsets[i]!,
        destination = destinations[i]!,
        size = sizes[i]!;
      assert.ok(destination <= old);
      assert.equal(destination % 8, 0);
      if (pins[i]) assert.equal(destination, old);
      for (let j = destination; j < destination + size; j++) {
        assert.equal(occupied[j], 0);
        occupied[j] = 1;
      }
      bytes.copyWithin(destination, old, old + size);
      liveBytes += size;
      if (destination !== old) movedBytes += size;
    }
    for (let i = 0; i < offsets.length; i++)
      if (live[i])
        assert.deepEqual(
          bytes.slice(destinations[i], destinations[i]! + sizes[i]!),
          before.slice(offsets[i], offsets[i]! + sizes[i]!),
        );
    let run = 0,
      largest = 0;
    for (const used of occupied) {
      run = used ? 0 : run + 1;
      largest = Math.max(largest, run);
    }
    assert.deepEqual(summary, {
      liveCount: live.filter(Boolean).length,
      liveBytes,
      movedBytes,
      largestFreeExtent: largest,
    });
  }
});

test("partial output aliases with sufficiently sized input views are rejected", () => {
  for (const key of ["offsets", "sizes", "live", "pinned"] as const) {
    const storage = new ArrayBuffer(64),
      request = input([16, 48], [16, 16], [1, 1]);
    const shared =
      key === "offsets" || key === "sizes"
        ? new Uint32Array(storage, 0, 4)
        : new Uint8Array(storage, 0, 16);
    shared.set(request[key]);
    const aliased = { ...request, [key]: shared },
      output = new Uint32Array(storage, 4, 4),
      before = new Uint8Array(storage).slice();
    assert.equal(planCompaction(aliased, output), undefined);
    assert.deepEqual(new Uint8Array(storage), before);
  }
});

test("caller-owned summary is bounded and disjoint before any output writes", () => {
  const request = input([16], [32], [1]),
    output = new Uint32Array(4).fill(77);
  const short = new Uint32Array(3).fill(88);
  assert.equal(plan(request, output, short), false);
  assert.deepEqual([...short], [88, 88, 88]);
  assert.deepEqual([...output], [77, 77, 77, 77]);
  assert.equal(plan(request, output, output), false);
  assert.deepEqual([...output], [77, 77, 77, 77]);
  const summary = new Uint32Array(6).fill(88);
  assert.equal(plan(request, output, summary), true);
  assert.deepEqual([...summary], [1, 32, 32, 224, 88, 88]);
});

test("forwarding preserves aliases and cycles while rejecting dead and interior references", async () => {
  const api = await import("../src/relocation/index.ts");
  assert.equal(typeof api.forwardOffset, "function");
  const offsets = new Uint32Array([32, 80, 128, 208]);
  const destinations = new Uint32Array([0, 0xffffffff, 32, 208]);
  for (const [old, expected] of [
    [32, 0],
    [80, undefined],
    [128, 32],
    [208, 208],
    [40, undefined],
    [0, undefined],
    [224, undefined],
  ] as const)
    assert.equal(api.forwardOffset(offsets, destinations, 4, old), expected);
  // Both aliases of B resolve identically; A -> B -> A remains a cycle.
  assert.deepEqual(
    [128, 128, 32].map((p) => api.forwardOffset(offsets, destinations, 4, p)),
    [32, 32, 0],
  );
  for (const n of [-1, NaN, Infinity, 1.5, 0x100000000])
    assert.equal(api.forwardOffset(offsets, destinations, 4, n), undefined);
  assert.equal(api.forwardOffset(offsets, destinations, 5, 32), undefined);
  assert.equal(api.forwardOffset(offsets, destinations, 0, 32), undefined);
});
