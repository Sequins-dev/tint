import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createNurseryEvacuator,
  type NurseryOptions,
} from "../src/tracing/nursery.ts";
import { writeStackRoots } from "./fixtures/stack-roots.ts";
import { nativeHeaderFlagUnit } from "@tint/abi/host";
function fixture(
  capacity = 128,
  fixupCapacity = 32,
  overrides: Partial<NurseryOptions> = {},
) {
  const memory = new Map<number, number>([
    [4096, 32],
    [4104, 1],
    [4112, 16],
    [4120, 0],
    [8208, 288],
    [9008, 352],
  ]);
  // One managed frame (sp 8192) whose map lists the word at 8208.
  const head = writeStackRoots(
    (address, value) => {
      memory.set(address, value);
    },
    [{ sp: 8192, references: [16] }],
    6144,
  );
  // A dead invalid header is deliberately present: minor tracing must not scan it.
  for (let i = 0; i < 4; i++) {
    memory.set(256 + i * 32, i % 2 ? 4096 : 0);
    memory.set(264 + i * 32, 0);
    memory.set(272 + i * 32, i === 1 ? 352 : i === 3 ? 288 : 0);
    memory.set(280 + i * 32, 0);
  }
  const starts = new Uint32Array([0b01010101]),
    forwarding = new Uint32Array(8),
    sources = new Uint32Array(8),
    sizes = new Uint32Array(8),
    destinations = new Uint32Array(8),
    slots = new Float64Array(fixupCapacity),
    values = new Float64Array(fixupCapacity),
    summary = new Uint32Array(3);
  let reads = 0,
    published = 0,
    copies = 0;
  const collector = createNurseryEvacuator({
    base: 256,
    byteLength: 128,
    targetBase: 512,
    targetLength: capacity,
    starts,
    forwarding,
    sources,
    sizes,
    destinations,
    slots,
    values,
    summary,
    read: (a: number) => {
      reads++;
      return memory.get(a);
    },
    isExternal: (a: number) => a >= 4096,
    scanRemembered: (visit: (address: number, slot: number) => boolean) =>
      visit(memory.get(9008)!, 9008),
    canWrite: (a: number) =>
      (a >= 512 && a < 512 + capacity) || a === 8208 || a === 9008,
    copy: (destination: number, source: number, size: number) => {
      copies++;
      for (let i = 0; i < size; i += 8)
        memory.set(destination + i, memory.get(source + i) ?? 0);
      return true;
    },
    write: (a: number, v: number) => {
      memory.set(a, v);
      return true;
    },
    publish: (count: number, bytes: number) => {
      assert.equal(count, 2);
      assert.equal(bytes, 64);
      published++;
      return true;
    },
    ...overrides,
  });
  assert.ok(collector);
  return {
    collector,
    head,
    memory,
    sources,
    sizes,
    destinations,
    summary,
    forwarding,
    slots,
    values,
    starts,
    stats: () => ({ reads, published, copies }),
  };
}
test("one evacuator promotes a nursery subrange and then performs a whole-window collection", () => {
  let phase = 0;
  const f = fixture(128, 32, {
    isExternal: (address) => address === 288 || address >= 4096,
    scanRemembered: (visit) =>
      phase === 0 ? visit(f.memory.get(304)!, 304) : true,
    canWrite: (slot) =>
      (slot >= 256 && slot < 288) ||
      slot === 304 ||
      slot === 8208 ||
      (slot >= 512 && slot < 640),
    publish: (count, bytes) => {
      assert.equal(count, phase === 0 ? 1 : 2);
      assert.equal(bytes, phase === 0 ? 32 : 64);
      f.starts[0] = 0b0101;
      return true;
    },
  });
  f.memory.set(8208, 352);
  assert.equal(f.collector.prepareRange(320, 64, 256, 32, 64, f.head), true);
  assert.equal(f.collector.commit(), true);
  assert.equal(f.memory.get(8208), 256);
  assert.equal(f.memory.get(304), 256);
  assert.equal(f.memory.get(272), 288);
  phase = 1;
  assert.equal(f.collector.prepare(64, f.head), true);
  assert.equal(f.collector.commit(), true);
  assert.equal(f.memory.get(8208), 512);
  assert.equal(f.memory.get(528), 544);
  assert.equal(f.memory.get(560), 512);
});
test("evacuation subranges reject overlap, foreign windows and invalid alignment before reading", () => {
  const f = fixture(),
    before = new Map(f.memory);
  for (const args of [
    [320, 64, 336, 32],
    [768, 32, 512, 32],
    [320, 64, 640, 32],
    [321, 32, 512, 32],
    [320, 80, 512, 32],
    [320, 64, 512, 0],
  ])
    assert.equal(
      f.collector.prepareRange(
        args[0]!,
        args[1]!,
        args[2]!,
        args[3]!,
        32,
        f.head,
      ),
      false,
    );
  assert.deepEqual(f.memory, before);
  assert.equal(f.stats().reads, 0);
  assert.equal(f.collector.commit(), false);
});
test("nursery evacuation visits survivors once, fixes cycles and old edges, and never inventories dead objects", () => {
  const f = fixture(),
    before = new Map(f.memory);
  assert.equal(f.collector.prepare(128, f.head), true);
  assert.deepEqual(f.memory, before);
  assert.deepEqual([...f.summary], [2, 64, 4]);
  assert.deepEqual([...f.sources.slice(0, 2)], [32, 96]);
  assert.equal(f.collector.commit(), true);
  assert.equal(f.memory.get(8208), 512);
  assert.equal(f.memory.get(9008), 544);
  assert.equal(f.memory.get(528), 544);
  assert.equal(f.memory.get(560), 512);
  assert.deepEqual(f.stats().published, 1);
  assert.equal(f.stats().copies, 2);
  assert.equal(f.collector.commit(), false);
});
test("evacuation preflight rejects insufficient space, fixup capacity, interior and unallocated pointers without writes", () => {
  for (const [capacity, fixups] of [
    [48, 32],
    [128, 1],
  ]) {
    const f = fixture(capacity, fixups),
      before = new Map(f.memory);
    assert.equal(f.collector.prepare(128, f.head), false);
    assert.equal(f.collector.commit(), false);
    assert.deepEqual(f.memory, before);
    assert.equal(f.stats().copies, 0);
  }
  for (const address of [304, 296, 384]) {
    const f = fixture();
    f.memory.set(8208, address);
    const before = new Map(f.memory);
    assert.equal(f.collector.prepare(128, f.head), false);
    assert.deepEqual(f.memory, before);
  }
});
test("retry clears only the prior discovered forwarding entries", () => {
  const f = fixture();
  f.memory.set(336, NaN); // unrelated dead storage
  assert.equal(f.collector.prepare(128, f.head), true);
  const first = [...f.summary];
  assert.equal(f.collector.prepare(128, f.head), true);
  assert.deepEqual([...f.summary], first);
  assert.equal(f.collector.commit(), true);
});

test("nested typed-array views preserve owners and derived data after breadth-first evacuation", () => {
  const f = fixture(256, 32, {
    byteLength: 256,
    forwarding: new Uint32Array(16),
    publish: () => true,
  });
  f.starts[0] = (1 << 0) | (1 << 4) | (1 << 8);
  // An owned Uint32Array (data inline at +24), a view of it and a view of
  // the view (kind flag 2, owner at +24).
  const view = 4 + 2 * nativeHeaderFlagUnit;
  f.memory.set(256, 4);
  f.memory.set(264, 4);
  f.memory.set(272, 280);
  f.memory.set(280, 42);
  f.memory.set(288, 73);
  f.memory.set(320, view);
  f.memory.set(328, 3);
  f.memory.set(336, 284);
  f.memory.set(344, 256);
  f.memory.set(384, view);
  f.memory.set(392, 2);
  f.memory.set(400, 288);
  f.memory.set(408, 320);
  f.memory.set(8208, 384);
  f.memory.set(9008, 320);
  assert.equal(f.collector.prepare(176, f.head), true);
  assert.deepEqual([...f.summary], [3, 144, 7]);
  assert.equal(f.collector.commit(), true);
  assert.equal(f.memory.get(8208), 512);
  assert.equal(f.memory.get(9008), 560);
  assert.equal(f.memory.get(536), 560);
  assert.equal(f.memory.get(584), 608);
  assert.equal(f.memory.get(528), 640);
  assert.equal(f.memory.get(576), 636);
  assert.equal(f.memory.get(624), 632);
  assert.equal(f.memory.get(632), 42);
  assert.equal(f.memory.get(640), 73);
});

test("sliced strings keep their flat parents through their parent slots", () => {
  const f = fixture(256, 32, {
    byteLength: 256,
    forwarding: new Uint32Array(16),
    publish: () => true,
  });
  f.starts[0] = (1 << 0) | (1 << 3);
  // A two-byte flat string of 12 units (16 + 24 bytes, in 48) at 256 and a
  // 9-unit slice from unit 2 at 304 (marker 1, flags 2; length, first
  // unit's byte offset, parent). The collector does not check the slice's
  // minimum length. Only the slice is a root.
  f.memory.set(256, 1);
  f.memory.set(264, 12);
  f.memory.set(272, 0x0041004200430044);
  f.memory.set(304, 1 + 2 * nativeHeaderFlagUnit);
  f.memory.set(312, 9);
  f.memory.set(320, 4);
  f.memory.set(328, 256);
  f.memory.set(8208, 304);
  // The remembered slot holds an external address, and nothing else is in
  // the nursery.
  f.memory.set(9008, 5000);
  for (let address = 336; address < 384; address += 8) f.memory.delete(address);
  assert.equal(f.collector.prepare(80, f.head), true);
  assert.equal(f.summary[0], 2);
  assert.equal(f.summary[1], 80);
  assert.equal(f.collector.commit(), true);
  const sliced = f.memory.get(8208) ?? 0,
    parent = f.memory.get(sliced + 24) ?? 0;
  assert.notEqual(sliced, 304);
  assert.notEqual(parent, 256);
  assert.equal(f.memory.get(parent), 1);
  assert.equal(f.memory.get(parent + 16), 0x0041004200430044);
  assert.equal(f.memory.get(sliced + 16), 4);
  assert.equal(f.memory.get(sliced + 8), 9);
});

test("minor tracing read cost does not scale with dead nursery capacity", () => {
  const small = fixture();
  assert.equal(small.collector.prepare(128, small.head), true);
  const big = fixture(128, 32, {
    byteLength: 2048,
    targetBase: 2097152,
    starts: new Uint32Array(4).fill(0xffffffff),
    forwarding: new Uint32Array(128),
    canWrite: () => true,
  });
  assert.equal(big.collector.prepare(2048, big.head), true);
  assert.equal(big.stats().reads, small.stats().reads);
  assert.deepEqual([...big.summary], [2, 64, 4]);
});

test("empty survivors publish an empty target and commit failures permanently reject reuse", () => {
  const empty = fixture(128, 32, {
    scanRemembered: () => true,
    publish: (count, bytes) => count === 0 && bytes === 0,
  });
  assert.equal(empty.collector.prepare(128, 0), true);
  assert.deepEqual([...empty.summary], [0, 0, 0]);
  assert.equal(empty.collector.commit(), true);
  assert.equal(empty.stats().copies, 0);
  for (const overrides of [
    { copy: () => false },
    { write: () => false },
    { publish: () => false },
  ]) {
    const f = fixture(128, 32, overrides);
    assert.equal(f.collector.prepare(128, f.head), true);
    assert.throws(
      () => f.collector.commit(),
      (e) => e === "NURSERY_COMMIT_FAILED",
    );
    assert.equal(f.collector.prepare(128, f.head), false);
    assert.equal(f.collector.commit(), false);
  }
});

test("successive collections exchange spaces while reusing bounded scratch", () => {
  const f = fixture(128, 32, {
    canWrite: (slot) =>
      (slot >= 256 && slot < 384) ||
      (slot >= 512 && slot < 640) ||
      slot === 8208 ||
      slot === 9008,
  });
  assert.equal(f.collector.prepare(128, f.head), true);
  assert.equal(f.collector.commit(), true);
  f.starts[0] = 5; // published survivor starts at offsets 0 and 32
  assert.equal(f.collector.prepare(64, f.head, true), true);
  assert.equal(f.collector.commit(), true);
  assert.equal(f.memory.get(8208), 256);
  assert.equal(f.memory.get(9008), 288);
  assert.equal(f.memory.get(272), 288);
  assert.equal(f.memory.get(304), 256);
});

test("verified compiler descriptors preserve nursery relocation and roots", () => {
  const checked = fixture(),
    verified = fixture(128, 32, { verifiedDescriptors: true });
  for (const f of [checked, verified]) {
    assert.equal(f.collector.prepare(128, f.head), true);
    assert.equal(f.collector.commit(), true);
  }
  assert.deepEqual(verified.memory, checked.memory);
  assert.deepEqual(verified.summary, checked.summary);
  assert.deepEqual(verified.forwarding, checked.forwarding);
});

test("evacuation validates each discovered reference against the start bitmap once", () => {
  let reads = 0;
  const starts = new Proxy(new Uint32Array([0b01010101]), {
    get(target, key) {
      if (key === "0") reads++;
      return Reflect.get(target, key, target);
    },
  });
  const f = fixture(128, 32, { starts });
  assert.equal(f.collector.prepare(128, f.head), true);
  assert.equal(reads, 4, "new survivors must not repeat the lookup validation");
  assert.deepEqual(Array.from(f.summary), [2, 64, 4]);
});

test("pointer-free survivors reuse extent classification instead of rescanning headers", () => {
  let headers = 0;
  const f = fixture(128, 32, {
    scanRemembered: () => true,
    publish: (count, bytes) => count === 1 && bytes === 32,
    read: (address) => {
      if (address === 288) headers++;
      return f.memory.get(address);
    },
  });
  f.memory.set(288, 1);
  f.memory.set(296, 0);
  f.memory.set(304, 4);
  assert.equal(f.collector.prepare(128, f.head), true);
  assert.equal(headers, 1, "string header must be decoded only once");
  assert.deepEqual([...f.summary], [1, 32, 1]);
  assert.equal(f.sizes[0], 32, "published extents must not retain kind bits");
  assert.equal(f.collector.commit(), true);
  assert.equal(f.memory.get(8208), 512);
});
