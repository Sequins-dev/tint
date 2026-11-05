import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeObjectExtent } from "../src/tracing/extent.ts";
import {
  scanNativeObject,
  scanNativeObjectWithVerifiedDescriptor,
} from "../src/tracing/scan.ts";
import { createNurseryEvacuator } from "../src/tracing/nursery.ts";
function fixture(verified = false, fixupCapacity = 128) {
  const memory = new Map<number, number>([
    [4096, 32],
    [4104, 1],
    [4112, 16],
    [4120, 0],
  ]);
  const starts = new Uint32Array(2),
    forwarding = new Uint32Array(64),
    summary = new Uint32Array(3);
  let used = 0,
    copies = 0,
    writes = 0,
    published = 0;
  function allocate(words: number[]) {
    const size = words.length * 8,
      address = 256 + used;
    assert.equal(size % 16, 0);
    used += size;
    assert.ok(used <= 1024);
    const unit = (address - 256) / 16;
    starts[unit >>> 5] = (starts[unit >>> 5] ?? 0) | (1 << (unit & 31));
    for (let i = 0; i < words.length; i++)
      memory.set(address + i * 8, words[i]!);
    return address;
  }
  const object = (reference = 0) => allocate([4096, 0, reference, 0]);
  const cell = (key: number, value = 0, ephemeron = false) =>
    allocate([7, ephemeron ? 1 : 0, 5, key, value === 0 ? 0 : 5, value]);
  function roots(values: number[]) {
    memory.set(8192, 0);
    memory.set(8200, 4160);
    memory.set(4160, values.length);
    for (let i = 0; i < values.length; i++) {
      memory.set(4168 + i * 8, 16 + i * 8);
      memory.set(8208 + i * 8, values[i]!);
    }
    memory.set(4168 + values.length * 8, 0);
  }
  const candidate = createNurseryEvacuator({
    base: 256,
    byteLength: 1024,
    targetBase: 2048,
    targetLength: 1024,
    starts,
    forwarding,
    sources: new Uint32Array(64),
    sizes: new Uint32Array(64),
    destinations: new Uint32Array(64),
    slots: new Float64Array(fixupCapacity),
    values: new Float64Array(fixupCapacity),
    summary,
    verifiedDescriptors: verified,
    read: (address) => memory.get(address),
    isExternal: (address) => address >= 4096,
    scanRemembered: () => true,
    canWrite: (slot) =>
      (slot >= 2048 && slot < 3072) || (slot >= 8208 && slot < 8464),
    copy: (target, source, size) => {
      copies++;
      for (let i = 0; i < size; i += 8)
        memory.set(target + i, memory.get(source + i) ?? 0);
      return true;
    },
    write: (slot, value) => {
      writes++;
      memory.set(slot, value);
      return true;
    },
    publish: () => {
      published++;
      return true;
    },
  });
  assert.ok(candidate);
  const collector = candidate;
  function prepare() {
    return collector.prepare(used, 8192);
  }
  function collect(values: number[]) {
    roots(values);
    const before = new Map(memory);
    assert.equal(prepare(), true);
    assert.deepEqual(
      memory,
      before,
      "prepare must leave source, target and roots unchanged",
    );
    assert.equal(collector.commit(), true);
  }
  return {
    memory,
    object,
    cell,
    roots,
    prepare,
    collect,
    collector,
    summary,
    forwarding,
    root: (index = 0) => memory.get(8208 + index * 8)!,
    stats: () => ({ copies, writes, published }),
  };
}
test("weak-slot extents and strong/deferred scanners share one validated header contract", () => {
  const f = fixture(),
    key = f.object(),
    value = f.object(),
    cell = f.cell(key, value, true),
    read = (a: number) => f.memory.get(a),
    classification = new Uint8Array(1);
  assert.equal(nativeObjectExtent(read, cell, cell + 48, classification), 48);
  assert.equal(classification[0], 7);
  for (const scan of [
    scanNativeObject,
    scanNativeObjectWithVerifiedDescriptor,
  ]) {
    const edges: number[] = [];
    assert.equal(
      scan(read, cell, 48, (address) => {
        edges.push(address);
        return true;
      }),
      "complete",
    );
    assert.deepEqual(edges, [key, value]);
    assert.equal(
      scan(
        read,
        cell,
        48,
        () => {
          throw Error("deferred edges must not be traced strongly");
        },
        2,
        false,
      ),
      "complete",
    );
    assert.equal(
      scan(read, cell, 32, () => true),
      "invalid",
    );
  }
  for (const flags of [2, 3, -1]) {
    f.memory.set(cell + 8, flags);
    assert.equal(nativeObjectExtent(read, cell, cell + 48), undefined);
    assert.equal(
      scanNativeObject(read, cell, 48, () => true),
      "invalid",
    );
  }
});
test("weak-only targets die without discovering their graph; cleared copies contain no dangling payload", () => {
  for (const verified of [false, true]) {
    const f = fixture(verified),
      key = f.object(),
      cell = f.cell(key);
    f.collect([cell]);
    const copied = f.root();
    assert.equal(f.summary[0], 1);
    assert.equal(f.summary[1], 48);
    assert.deepEqual(
      [16, 24, 32, 40].map((offset) => f.memory.get(copied + offset)),
      [0, 0, 0, 0],
    );
    assert.equal(f.forwarding[(key - 256) / 16], 0);
  }
});
test("strongly rooted weak targets retain identity after forwarding", () => {
  const f = fixture(),
    key = f.object(),
    cell = f.cell(key);
  f.collect([cell, key]);
  assert.equal(f.memory.get(f.root() + 16), 5);
  assert.equal(f.memory.get(f.root() + 24), f.root(1));
  assert.equal(f.summary[0], 2);
});
test("ephemeron values become reachable only at the key-liveness fixed point", () => {
  for (const rooted of [true, false]) {
    const f = fixture(),
      key1 = f.object(),
      key2 = f.object(),
      value = f.object(),
      first = f.cell(key1, key2, true),
      second = f.cell(key2, value, true);
    f.collect(rooted ? [second, first, key1] : [second, first]);
    if (rooted) {
      assert.equal(f.summary[0], 5);
      assert.equal(f.memory.get(f.root(1) + 40), f.memory.get(f.root(0) + 24));
      assert.ok(f.forwarding[(value - 256) / 16]! > 0);
    } else {
      assert.equal(f.summary[0], 2);
      for (const i of [0, 1])
        assert.deepEqual(
          [16, 24, 32, 40].map((offset) => f.memory.get(f.root(i) + offset)),
          [0, 0, 0, 0],
        );
    }
  }
});
test("a value-to-key cycle cannot make its own ephemeron key live", () => {
  const f = fixture(),
    key = f.object(),
    value = f.object(key),
    cell = f.cell(key, value, true);
  f.collect([cell]);
  assert.equal(f.summary[0], 1);
  assert.equal(f.memory.get(f.root() + 40), 0);
});
test("permanent external keys keep ephemeron values live", () => {
  const f = fixture(),
    value = f.object(),
    cell = f.cell(12288, value, true);
  f.collect([cell]);
  assert.equal(f.memory.get(f.root() + 24), 12288);
  assert.ok(f.forwarding[(value - 256) / 16]! > 0);
  assert.equal(f.summary[0], 2);
});
test("invalid weak pointers and exhausted clearing-fixup storage fail transactionally", () => {
  for (const bad of [8, 16]) {
    const f = fixture(),
      key = f.object(),
      cell = f.cell(key + bad);
    f.roots([cell]);
    const before = new Map(f.memory);
    assert.equal(f.prepare(), false);
    assert.deepEqual(f.memory, before);
    assert.deepEqual(f.stats(), { copies: 0, writes: 0, published: 0 });
  }
  const f = fixture(false, 2),
    key = f.object(),
    cell = f.cell(key, key, true);
  f.roots([cell]);
  const before = new Map(f.memory);
  assert.equal(f.prepare(), false);
  assert.deepEqual(f.memory, before);
  assert.deepEqual(f.stats(), { copies: 0, writes: 0, published: 0 });
});
test("ephemeron discovery scans new weak cells before resolving their keys", () => {
  const f = fixture(),
    key = f.object(),
    last = f.object(),
    inner = f.cell(key, last, true),
    outer = f.cell(key, inner, true);
  f.collect([outer, key]);
  const innerCopy = f.memory.get(f.root() + 40)!;
  assert.equal(f.memory.get(innerCopy + 24), f.root(1));
  assert.ok(f.forwarding[(last - 256) / 16]! > 0);
  assert.equal(f.summary[0], 4);
});
test("immediate ephemeron keys preserve opaque scalar payloads", () => {
  for (const tag of [1, 2, 4]) {
    const f = fixture(),
      value = f.object(),
      cell = f.cell(0, value, true);
    f.memory.set(cell + 16, tag);
    f.memory.delete(cell + 24);
    f.collect([cell]);
    assert.equal(f.memory.get(f.root() + 16), tag);
    assert.ok(f.forwarding[(value - 256) / 16]! > 0);
  }
});
test("cleared cells and malformed tagged edges have deterministic transactional outcomes", () => {
  const cleared = fixture(),
    cell = cleared.cell(0);
  cleared.memory.set(cell + 16, 0);
  cleared.collect([cell]);
  assert.deepEqual(
    [16, 24, 32, 40].map((offset) =>
      cleared.memory.get(cleared.root() + offset),
    ),
    [0, 0, 0, 0],
  );
  for (const offset of [16, 32])
    for (const tag of [-1, 8, 0.5]) {
      const f = fixture(),
        key = f.object(),
        cell = f.cell(key, key, true);
      f.memory.set(cell + offset, tag);
      f.roots([cell, key]);
      const before = new Map(f.memory);
      assert.equal(f.prepare(), false);
      assert.deepEqual(f.memory, before);
      assert.deepEqual(f.stats(), { copies: 0, writes: 0, published: 0 });
    }
});
