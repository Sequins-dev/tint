import { test } from "node:test";
import assert from "node:assert/strict";
import { createNativeCollector } from "../src/tracing/collector.ts";
import { writeStackRoots } from "./fixtures/stack-roots.ts";
/** One managed frame at `sp` whose map lists `references`; stack-map
 * metadata at 12288. Returns the root head. */
function stack(
  words: Map<number, number>,
  sp: number,
  references: readonly number[],
  metadata = 12288,
): number {
  return writeStackRoots(
    (address, value) => {
      words.set(address, value);
    },
    [{ sp, references }],
    metadata,
  );
}
function fixture() {
  const words = new Map<number, number>([
    [256, 4096],
    [264, 0],
    [272, 512],
    [512, 4096],
    [520, 0],
    [528, 256],
    [768, 4096],
    [776, 0],
    [784, 768],
    [4096, 32],
    [4104, 1],
    [4112, 16],
    [4120, 0],
    [8208, 256],
  ]);
  const head = stack(words, 8192, [16]);
  const starts = new Float64Array([256, 512, 768]),
    sizes = new Uint32Array([32, 32, 32]),
    marks = new Uint8Array(3);
  const collector = createNativeCollector(
    (a) => words.get(a),
    starts,
    sizes,
    marks,
    new Uint32Array(3),
    new Float64Array(3),
    (p) => p === 16384,
  );
  return { words, head, starts, sizes, marks, collector };
}
test("native heap marking retains reachable cycles and identifies unreachable allocations", () => {
  const f = fixture();
  assert.equal(f.collector.mark(3, f.head), "complete");
  assert.deepEqual([...f.marks], [2, 2, 0]);
  f.words.set(8208, 16384);
  assert.equal(f.collector.mark(3, f.head), "complete");
  assert.deepEqual([...f.marks], [0, 0, 0]);
  f.words.set(8208, 768);
  assert.equal(f.collector.mark(3, f.head), "complete");
  assert.deepEqual([...f.marks], [0, 0, 2]);
});
test("invalid references, corrupt inventory and failed scans never authorize sweep", () => {
  const f = fixture();
  f.words.set(528, 520);
  assert.equal(f.collector.mark(3, f.head), "read");
  assert.deepEqual([...f.marks], [0, 0, 0]);
  f.words.set(528, 256);
  f.starts[1] = 256;
  assert.equal(f.collector.mark(3, f.head), "invalid-graph");
  assert.deepEqual([...f.marks], [0, 0, 0]);
  f.starts[1] = 512;
  // An unreadable safepoint table.
  f.words.set(f.head + 48, 9992);
  assert.equal(f.collector.mark(3, f.head), "read");
  assert.deepEqual([...f.marks], [0, 0, 0]);
});

test("marking scans a wide allocation once instead of rescanning for every edge", () => {
  const fields = 128,
    words = new Map<number, number>();
  const object = 256,
    descriptor = 4096,
    rootsAt = 8192;
  words.set(object, descriptor);
  words.set(object + 8, 0);
  words.set(descriptor, 16 + fields * 8);
  words.set(descriptor + 8, fields);
  for (let i = 0; i < fields; i++) {
    words.set(descriptor + 16 + i * 8, 16 + i * 8);
    words.set(object + 16 + i * 8, object);
  }
  words.set(descriptor + 16 + fields * 8, 0);
  words.set(rootsAt + 16, object);
  const head = stack(words, rootsAt, [16]);
  let reads = 0;
  const marks = new Uint8Array(1);
  const collector = createNativeCollector(
    (a) => {
      reads++;
      return words.get(a);
    },
    new Float64Array([object]),
    new Uint32Array([16 + fields * 8]),
    marks,
    new Uint32Array(1),
    new Float64Array(1),
    () => false,
  );
  assert.equal(collector.mark(1, head), "complete");
  assert.deepEqual([...marks], [2]);
  assert.ok(reads < fields * 4, `wide allocation required ${reads} reads`);
});

test("external roots outside the inventory do not binary-search every allocation", () => {
  const count = 1024,
    fields = 128,
    words = new Map<number, number>();
  for (let index = 0; index < fields; index++)
    words.set(8208 + index * 8, index % 2 === 0 ? 16384 : 1048576);
  const head = stack(
    words,
    8192,
    Array.from({ length: fields }, (_, index) => 16 + index * 8),
  );
  let indexedReads = 0;
  const starts = new Proxy(
    Float64Array.from({ length: count }, (_, index) => 65536 + index * 32),
    {
      get(target, key) {
        if (typeof key === "string" && /^\d+$/.test(key)) indexedReads++;
        return Reflect.get(target, key, target);
      },
    },
  );
  const marks = new Uint8Array(count);
  const collector = createNativeCollector(
    (address) => words.get(address),
    starts,
    new Uint32Array(count).fill(32),
    marks,
    new Uint32Array(count),
    new Float64Array(fields),
    (address) => address === 16384 || address === 1048576,
  );
  assert.equal(collector.mark(count, head), "complete");
  assert.ok(marks.every((value) => value === 0));
  assert.ok(
    indexedReads <= count + 4,
    `external roots performed ${indexedReads - count} extra inventory reads`,
  );
});

test("borrowed inventory tail bounds exact lookup to an address page", () => {
  const count = 4096,
    rootCount = 8192,
    address = 65536 + (count - 1) * 32;
  function run(capacity: number) {
    const words = new Map<number, number>([
      [address, 2],
      [address + 8, 0],
      [address + 16, 0],
    ]);
    // Frame words above the heap's addresses, metadata above them.
    for (let index = 0; index < rootCount; index++)
      words.set(2097168 + index * 8, address);
    const head = stack(
      words,
      2097152,
      Array.from({ length: rootCount }, (_, index) => 16 + index * 8),
      3145728,
    );
    let reads = 0;
    const data = new Float64Array(capacity);
    for (let index = 0; index < count; index++)
      data[index] = 65536 + index * 32;
    const prefix = data.slice(0, count);
    const starts = new Proxy(data, {
      get(target, key) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, target);
      },
    });
    const marks = new Uint8Array(count);
    const collector = createNativeCollector(
      (p) => words.get(p),
      starts,
      new Uint32Array(count).fill(32),
      marks,
      new Uint32Array(count),
      new Float64Array(rootCount),
      () => false,
    );
    assert.equal(collector.mark(count, head), "complete");
    assert.deepEqual(
      data.slice(0, count),
      prefix,
      "live inventory is immutable",
    );
    assert.equal(marks[count - 1], 2);
    assert.equal(marks.filter((mark) => mark !== 0).length, 1);
    return reads;
  }
  const baseline = run(count),
    indexed = run(count + 64);
  assert.ok(
    indexed < baseline * 0.85,
    `indexed ${indexed} reads vs baseline ${baseline}`,
  );
});

test("page indexing preserves exact starts across boundaries, gaps and repeated collections", () => {
  const addresses = [65536, 69600, 69632, 73728, 82000],
    starts = new Float64Array(32);
  starts.set(addresses);
  const words = new Map<number, number>();
  const head = stack(words, 8192, [16]);
  for (const address of addresses) {
    words.set(address, 2);
    words.set(address + 8, 0);
    words.set(address + 16, 0);
  }
  const marks = new Uint8Array(addresses.length);
  const collector = createNativeCollector(
    (address) => words.get(address),
    starts,
    new Uint32Array(addresses.length).fill(32),
    marks,
    new Uint32Array(addresses.length),
    new Float64Array(1),
    () => false,
  );
  for (let index = 0; index < addresses.length; index++) {
    words.set(8208, addresses[index]!);
    assert.equal(collector.mark(addresses.length, head), "complete");
    assert.deepEqual(
      [...marks],
      addresses.map((_, i) => (i === index ? 2 : 0)),
    );
    words.set(8208, addresses[index]! + 16);
    assert.equal(collector.mark(addresses.length, head), "read");
    assert.ok(marks.every((mark) => mark === 0));
  }
  assert.deepEqual([...starts.slice(0, addresses.length)], addresses);
});
