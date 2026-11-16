import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// The compactor calls the trusted memory leaves directly; in Node they are
// redirected to a simulated word memory.
const simulated = new URL("./fixtures/simulated-memory.ts", import.meta.url)
  .href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    return resolved.url.endsWith("/src/intrinsics/memory.ts")
      ? { ...resolved, url: simulated }
      : resolved;
  },
});
const { createCompactor } = await import("../src/tracing/cheney.ts");
const { nativeHeaderFlagUnit } = await import("@tint/abi/host");
const { simulate } = await import("./fixtures/simulated-memory.ts");
const { writeStackRoots } = await import("./fixtures/stack-roots.ts");

/** A word-addressed simulated address space: an image area for descriptors,
 * stack-map metadata, a stack area for frames, and a 4 KiB region. */
const image = 0x1000,
  stackMaps = 0x3000,
  stack = 0x4000,
  region = 0x10000,
  regionBytes = 0x1000;
function heap(stackCapacity = 1024) {
  const words = new Map<number, number>();
  simulate(words);
  const read = (address: number): number => words.get(address) ?? 0;
  const starts = new Uint32Array(regionBytes / 256);
  let top = region,
    descriptorTop = image;
  function allocate(size: number, wordsOf: readonly number[]): number {
    const address = top,
      unit = (address - region) / 8;
    starts[unit >>> 5] = (starts[unit >>> 5]! | (1 << (unit & 31))) >>> 0;
    top += Math.ceil(size / 8) * 8;
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
  function roots(values: readonly number[]): number {
    values.forEach((value, index) => words.set(stack + 16 + index * 8, value));
    return writeStackRoots(
      (address, value) => words.set(address, value),
      [{ sp: stack, references: values.map((_, index) => 16 + index * 8) }],
      stackMaps,
    );
  }
  const root = (index: number): number => read(stack + 16 + index * 8);
  function collect(head: number): number {
    return createCompactor(region, regionBytes).collect(
      region,
      top - region,
      head,
      starts,
      new Uint32Array(regionBytes / 256),
      new Uint32Array(regionBytes / 256),
      new Uint32Array(stackCapacity),
    );
  }
  /** Object starts after a collection. */
  function startList(): number[] {
    const list: number[] = [];
    for (let unit = 0; unit < regionBytes / 8; unit++)
      if ((starts[unit >>> 5]! & (1 << (unit & 31))) !== 0)
        list.push(region + unit * 8);
    return list;
  }
  return { words, read, allocate, descriptor, roots, root, collect, startList };
}

test("live records slide down in order, keeping sharing and cycles", () => {
  const h = heap();
  const pair = h.descriptor(24, [8, 16]);
  const garbage = h.allocate(24, [pair, 0, 0]);
  const leaf = h.allocate(24, [pair, 0, 0]);
  h.allocate(40, [pair, 0, 0]); // more garbage between survivors
  const node = h.allocate(24, [pair, leaf, 0]);
  h.words.set(node + 16, node); // a cycle back to itself
  const bytes = h.collect(h.roots([node, leaf, node]));
  assert.equal(bytes, 48, "only the two survivors remain");
  const movedLeaf = h.root(1),
    movedNode = h.root(0);
  assert.equal(movedLeaf, 0x10000, "address order is kept");
  assert.equal(movedNode, 0x10018);
  assert.equal(h.root(2), movedNode, "shared roots agree");
  assert.equal(h.read(movedNode + 8), movedLeaf);
  assert.equal(h.read(movedNode + 16), movedNode, "the cycle follows");
  assert.equal(h.read(movedNode), pair, "headers are unchanged");
  assert.deepEqual(h.startList(), [movedLeaf, movedNode]);
  assert.notEqual(garbage, movedLeaf + 1);
});

test("general fields trace only reference tags", () => {
  const h = heap();
  const holder = h.descriptor(24, [], [8]);
  const leafDescriptor = h.descriptor(16, []);
  h.allocate(16, [leafDescriptor, 0]);
  const leaf = h.allocate(16, [leafDescriptor, 7]);
  const object = h.allocate(24, [holder, 5, leaf]);
  const number = h.allocate(24, [holder, 1, leaf]); // tag 1: a number payload
  h.collect(h.roots([object, number]));
  const movedObject = h.root(0),
    movedNumber = h.root(1),
    movedLeaf = h.read(movedObject + 16);
  assert.equal(movedLeaf, 0x10000);
  assert.equal(h.read(movedLeaf + 8), 7);
  assert.equal(h.read(movedNumber + 16), leaf, "a number payload is not moved");
});

test("array data pointers follow inline backing, borrowed backing, and views", () => {
  const h = heap();
  const leafDescriptor = h.descriptor(16, []);
  h.allocate(64, [leafDescriptor, 0]); // garbage, so every array moves
  // Uint8Array (marker 2) with 16 inline bytes: data = self + 24.
  const backing = h.allocate(40, [2, 16, 0, 0x0102030405060708]);
  h.words.set(backing + 16, backing + 24);
  // A view over bytes 4..11 of backing, and a view of that view (flag 2).
  const viewHeader = 2 + 2 * nativeHeaderFlagUnit;
  const view = h.allocate(40, [viewHeader, 8, backing + 28, backing]);
  const inner = h.allocate(40, [viewHeader, 4, backing + 30, view]);
  const borrowed = h.allocate(24, [2 + nativeHeaderFlagUnit, 8, 0x9000]);
  h.collect(h.roots([inner, borrowed]));
  const movedInner = h.root(0),
    movedView = h.read(movedInner + 24),
    movedBacking = h.read(movedView + 24);
  assert.equal(movedBacking, 0x10000);
  assert.equal(h.read(movedBacking + 16), movedBacking + 24);
  assert.equal(h.read(movedBacking + 24), 0x0102030405060708, "data moves");
  assert.equal(h.read(movedView + 16), movedBacking + 28);
  assert.equal(h.read(movedInner + 16), movedBacking + 30);
  assert.equal(h.read(movedInner), viewHeader);
  assert.equal(h.read(h.root(1) + 16), 0x9000, "borrowed data stays");
});

test("strings and reference vectors size and trace correctly", () => {
  const h = heap();
  const leafDescriptor = h.descriptor(16, []);
  h.allocate(16, [leafDescriptor, 0]);
  // A string of 5 units (at least four units' extent): 16 + 10 -> 32 bytes.
  const text = h.allocate(32, [1, 5, 0x0041004200430044, 0x45]);
  const leaf = h.allocate(16, [leafDescriptor, 3]);
  // A vector of capacity 3: a hole, the leaf, and itself (present undefined).
  const vector = h.allocate(48, [6, 3, 0, 0, leaf, 0]);
  h.words.set(vector + 40, vector);
  const bytes = h.collect(h.roots([text, vector]));
  assert.equal(bytes, 32 + 16 + 48);
  const movedText = h.root(0),
    movedVector = h.root(1);
  assert.equal(movedText, 0x10000);
  assert.equal(h.read(movedText + 16), 0x0041004200430044);
  const movedLeaf = h.read(movedVector + 32);
  assert.equal(h.read(movedLeaf + 8), 3);
  assert.equal(h.read(movedVector + 24), 0, "holes stay empty");
  assert.equal(h.read(movedVector + 40), movedVector, "self marks follow");
});

test("a mark stack overflow rescans marked objects until the closure is complete", () => {
  const h = heap(1);
  const fan = h.descriptor(40, [8, 16, 24, 32]);
  const leafDescriptor = h.descriptor(16, []);
  const leaves: number[] = [];
  for (let i = 0; i < 12; i++) {
    h.allocate(16, [leafDescriptor, 0]); // interleaved garbage
    leaves.push(h.allocate(16, [leafDescriptor, i]));
  }
  let tree = h.allocate(40, [
    fan,
    leaves[0]!,
    leaves[1]!,
    leaves[2]!,
    leaves[3]!,
  ]);
  for (let i = 4; i < 12; i += 4)
    tree = h.allocate(40, [
      fan,
      tree,
      leaves[i]!,
      leaves[i + 1]!,
      leaves[i + 2]!,
    ]);
  h.collect(h.roots([tree]));
  const seen = new Set<number>();
  const visit = (address: number): void => {
    const header = h.read(address);
    if (header === leafDescriptor) {
      seen.add(h.read(address + 8));
      return;
    }
    for (let field = 8; field <= 32; field += 8) visit(h.read(address + field));
  };
  visit(h.root(0));
  assert.deepEqual(
    [...seen].sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5, 6, 8, 9, 10],
  );
});
