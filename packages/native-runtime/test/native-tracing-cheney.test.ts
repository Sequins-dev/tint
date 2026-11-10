import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCheneyCollector,
  cheneyForwarded,
  type CheneyMemory,
} from "../src/tracing/cheney.ts";

/** A word-addressed simulated address space: an image area for descriptors,
 * a stack area for root frames, and two 4 KiB semispaces. */
const image = 0x1000,
  stack = 0x4000,
  managed = 0x10000,
  semispace = 0x1000,
  from = managed,
  to = managed + semispace;
function heap() {
  const words = new Map<number, number>();
  const memory: CheneyMemory = {
    read: (address) => {
      assert.equal(address % 8, 0, "aligned read");
      return words.get(address) ?? 0;
    },
    write: (address, value) => {
      assert.equal(address % 8, 0, "aligned write");
      words.set(address, value);
    },
    move: (destination, source, size) => {
      const copied: number[] = [];
      for (let offset = 0; offset < size; offset += 8)
        copied.push(words.get(source + offset) ?? 0);
      copied.forEach((value, index) =>
        words.set(destination + index * 8, value),
      );
    },
  };
  let top = from,
    descriptorTop = image;
  function allocate(size: number, wordsOf: readonly number[]): number {
    const address = top;
    top += Math.ceil(size / 16) * 16;
    wordsOf.forEach((value, index) => words.set(address + index * 8, value));
    return address;
  }
  /** Record descriptor: extent, references, generals (offsets from header). */
  function descriptor(
    extent: number,
    references: readonly number[],
    generals: readonly number[] = [],
  ): number {
    const address = descriptorTop,
      layout = [
        extent,
        references.length,
        ...references,
        generals.length,
        ...generals,
      ];
    descriptorTop += layout.length * 8;
    layout.forEach((value, index) => words.set(address + index * 8, value));
    return address;
  }
  /** One root frame at the stack base holding the given reference slots. */
  function roots(values: readonly number[]): number {
    const layout = values.map((_, index) => 16 + index * 8);
    const rootDescriptor = descriptorTop;
    [layout.length, ...layout, 0].forEach((value, index) =>
      words.set(rootDescriptor + index * 8, value),
    );
    descriptorTop += (layout.length + 2) * 8;
    words.set(stack, 0);
    words.set(stack + 8, rootDescriptor);
    values.forEach((value, index) => words.set(stack + 16 + index * 8, value));
    return stack;
  }
  function root(index: number): number {
    return words.get(stack + 16 + index * 8) ?? 0;
  }
  function collect(head: number, starts = new Uint32Array(semispace / 512)) {
    const bytes = createCheneyCollector(managed, 2 * semispace, memory).collect(
      from,
      top - from,
      to,
      0,
      semispace,
      head,
      starts,
      to,
      undefined,
    );
    return { bytes, starts };
  }
  return {
    words,
    allocate,
    descriptor,
    roots,
    root,
    collect,
    read: memory.read,
  };
}

test("reachable records move once, keep sharing and cycles, and drop garbage", () => {
  const h = heap();
  // A pair record: two references at 16 and 24.
  const pair = h.descriptor(32, [16, 24]);
  const garbage = h.allocate(32, [pair, 0, 0, 0]);
  const leaf = h.allocate(32, [pair, 0, 0, 0]);
  const node = h.allocate(32, [pair, 0, leaf, 0]);
  h.words.set(node + 24, node); // cycle back to itself
  const { bytes, starts } = h.collect(h.roots([node, leaf, node]));
  assert.equal(bytes, 64, "garbage is not copied");
  const movedNode = h.root(0),
    movedLeaf = h.root(1);
  assert.equal(h.root(2), movedNode, "shared root resolves once");
  assert.ok(movedNode >= to && movedLeaf >= to);
  assert.equal(h.read(movedNode + 16), movedLeaf);
  assert.equal(h.read(movedNode + 24), movedNode, "cycle follows the copy");
  assert.equal(h.read(node + 8), cheneyForwarded);
  assert.equal(h.read(garbage + 8), 0, "garbage is untouched");
  for (const address of [movedNode, movedLeaf]) {
    const unit = (address - to) / 16;
    assert.notEqual(starts[unit >>> 5]! & (1 << (unit & 31)), 0);
  }
});

test("general fields trace only reference tags", () => {
  const h = heap();
  const box = h.descriptor(48, [], [16, 32]);
  const target = h.allocate(32, [h.descriptor(32, []), 0, 0, 0]);
  // Tag 3 (object) payload is a reference; tag 1 payload is a number.
  const holder = h.allocate(48, [box, 0, 3, target, 1, target]);
  h.collect(h.roots([holder]));
  const moved = h.root(0);
  const movedTarget = h.read(moved + 24);
  assert.notEqual(movedTarget, target);
  assert.ok(movedTarget >= to);
  assert.equal(
    h.read(moved + 40),
    target,
    "numeric payload is not a reference",
  );
});

test("strings and reference vectors size and trace correctly", () => {
  const h = heap();
  const text = h.allocate(32, [1, 0, 3]); // 3 code units → 30 → 32 bytes
  const vector = h.allocate(48, [6, 0, 2, 0, text, 0]);
  const { bytes } = h.collect(h.roots([vector]));
  assert.equal(bytes, 48 + 32);
  const moved = h.root(0);
  const movedText = h.read(moved + 32);
  assert.ok(movedText >= to);
  assert.equal(h.read(movedText + 16), 3);
  assert.equal(h.read(moved + 40), 0, "null element stays null");
});

test("array data pointers follow inline backing, borrowed backing, and views", () => {
  const h = heap();
  // Uint8Array (marker 2) with 16 inline bytes: data = self + 32.
  const backing = h.allocate(48, [2, 0, 16, 0]);
  h.words.set(backing + 24, backing + 32);
  // A view over bytes 4..11 of backing, and a view of that view.
  const view = h.allocate(48, [2, 2, 8, backing + 36, backing]);
  const inner = h.allocate(48, [2, 2, 4, backing + 38, view]);
  const borrowed = h.allocate(32, [2, 1, 8, 0x9000]);
  h.collect(h.roots([inner, borrowed]));
  const movedInner = h.root(0),
    movedView = h.read(movedInner + 32),
    movedBacking = h.read(movedView + 32);
  assert.equal(h.read(movedBacking + 24), movedBacking + 32);
  assert.equal(h.read(movedView + 24), movedBacking + 36);
  assert.equal(h.read(movedInner + 24), movedBacking + 38);
  assert.equal(h.read(h.root(1) + 24), 0x9000, "borrowed data stays");
});

test("weak cells and ephemerons keep live keys and clear dead ones", () => {
  const h = heap();
  const leafDescriptor = h.descriptor(32, []);
  const liveKey = h.allocate(32, [leafDescriptor, 0, 0, 0]);
  const deadKey = h.allocate(32, [leafDescriptor, 0, 0, 0]);
  const liveValue = h.allocate(32, [leafDescriptor, 0, 0, 0]);
  const deadValue = h.allocate(32, [leafDescriptor, 0, 0, 0]);
  // Weak slot: marker 7, flags (0 weak, 1 ephemeron), key pair, value pair.
  const weakLive = h.allocate(48, [7, 0, 3, liveKey, 3, liveValue]);
  const weakDead = h.allocate(48, [7, 0, 3, deadKey, 0, 0]);
  const ephLive = h.allocate(48, [7, 1, 3, liveKey, 3, liveValue]);
  const ephDead = h.allocate(48, [7, 1, 3, deadKey, 3, deadValue]);
  const { bytes } = h.collect(
    h.roots([weakLive, weakDead, ephLive, ephDead, liveKey]),
  );
  const wl = h.root(0),
    wd = h.root(1),
    el = h.root(2),
    ed = h.root(3),
    key = h.root(4);
  assert.equal(h.read(wl + 24), key, "weak cell key follows its copy");
  assert.equal(h.read(wl + 32), 0, "weak cell value pair is dropped");
  assert.equal(h.read(wd + 16), 0, "dead weak key is cleared");
  const movedValue = h.read(el + 40);
  assert.ok(movedValue >= to, "a live ephemeron keeps its value");
  assert.equal(h.read(el + 8), 1, "scratch flag is restored");
  assert.equal(h.read(ed + 16), 0);
  assert.equal(h.read(ed + 32), 0, "a dead ephemeron drops its value");
  // Copied: four slots, the live key and the live value only.
  assert.equal(bytes, 4 * 48 + 32 + 32);
});

test("ephemeron chains reach a fixpoint", () => {
  const h = heap();
  const leafDescriptor = h.descriptor(32, []);
  const a = h.allocate(32, [leafDescriptor, 0, 0, 0]);
  const b = h.allocate(32, [leafDescriptor, 0, 0, 0]);
  const c = h.allocate(32, [leafDescriptor, 0, 0, 0]);
  // b is reachable only as the value of a's ephemeron; c only through b's.
  const second = h.allocate(48, [7, 1, 3, b, 3, c]);
  const first = h.allocate(48, [7, 1, 3, a, 3, b]);
  h.collect(h.roots([second, first, a]));
  const movedSecond = h.root(0),
    movedFirst = h.root(1);
  const movedB = h.read(movedFirst + 40);
  assert.ok(movedB >= to);
  assert.equal(h.read(movedSecond + 24), movedB);
  assert.ok(h.read(movedSecond + 40) >= to, "c survives through b");
});

test("remembered objects outside the source are updated in place", () => {
  const h = heap();
  const pair = h.descriptor(32, [16, 24]);
  const young = h.allocate(32, [pair, 0, 0, 0]);
  // An old object outside both windows referring into the source window.
  const old = 0x8000;
  [pair, 0, young, 0].forEach((value, index) =>
    h.words.set(old + index * 8, value),
  );
  const bytes = createCheneyCollector(managed, 2 * semispace, {
    read: (address) => h.words.get(address) ?? 0,
    write: (address, value) => void h.words.set(address, value),
    move: (destination, source, size) => {
      for (let offset = 0; offset < size; offset += 8)
        h.words.set(destination + offset, h.words.get(source + offset) ?? 0);
    },
  }).collect(from, 32, to, 0, semispace, 0, new Uint32Array(8), to, (scan) =>
    scan(old),
  );
  assert.equal(bytes, 32);
  assert.equal(h.words.get(old + 16), to);
});

test("a destination that cannot hold the survivors is an invariant failure", () => {
  const h = heap();
  const leafDescriptor = h.descriptor(32, []);
  const object = h.allocate(32, [leafDescriptor, 0, 0, 0]);
  const collector = createCheneyCollector(managed, 2 * semispace, {
    read: (address) => h.words.get(address) ?? 0,
    write: (address, value) => void h.words.set(address, value),
    move: () => {},
  });
  assert.throws(
    () =>
      collector.collect(
        from,
        32,
        to,
        0,
        16,
        h.roots([object]),
        new Uint32Array(8),
        to,
        undefined,
      ),
    (error) => error === "CHENEY_OVERFLOW",
  );
});
