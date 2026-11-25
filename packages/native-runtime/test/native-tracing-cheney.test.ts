import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// The evacuator calls the trusted memory leaves directly; in Node they are
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
const { createCheneyCollector } = await import("../src/tracing/cheney.ts");
const { nativeHeaderForwarded, nativeHeaderFlagUnit } =
  await import("@tint/abi/host");
const { nativeTypedArrayKinds } = await import("@tint/abi/typed-array");
const { simulate } = await import("./fixtures/simulated-memory.ts");
const { writeStackRoots } = await import("./fixtures/stack-roots.ts");

/** A word-addressed simulated address space: an image area for descriptors,
 * stack-map metadata, a stack area for frames, and two 4 KiB semispaces. */
const image = 0x1000,
  stackMaps = 0x3000,
  stack = 0x4000,
  managed = 0x10000,
  semispace = 0x1000,
  from = managed,
  to = managed + semispace;
function heap() {
  const words = new Map<number, number>();
  // Every collector below reads and writes this heap's words.
  simulate(words);
  const memory = { read: (address: number): number => words.get(address) ?? 0 };
  let top = from,
    descriptorTop = image;
  function allocate(size: number, wordsOf: readonly number[]): number {
    const address = top;
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
  /** One managed frame at the stack base whose safepoint map lists the given
   * reference slots; returns the stack-map registry (the root head). */
  function roots(values: readonly number[]): number {
    values.forEach((value, index) => words.set(stack + 16 + index * 8, value));
    return writeStackRoots(
      (address, value) => words.set(address, value),
      [{ sp: stack, references: values.map((_, index) => 16 + index * 8) }],
      stackMaps,
    );
  }
  function root(index: number): number {
    return words.get(stack + 16 + index * 8) ?? 0;
  }
  function collect(head: number, starts = new Uint32Array(semispace / 256)) {
    const bytes = createCheneyCollector(managed, 2 * semispace).collect(
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
  // A pair record: two references at 8 and 16.
  const pair = h.descriptor(24, [8, 16]);
  const garbage = h.allocate(24, [pair, 0, 0]);
  const leaf = h.allocate(24, [pair, 0, 0]);
  const node = h.allocate(24, [pair, leaf, 0]);
  h.words.set(node + 16, node); // cycle back to itself
  const { bytes, starts } = h.collect(h.roots([node, leaf, node]));
  assert.equal(bytes, 48, "garbage is not copied");
  const movedNode = h.root(0),
    movedLeaf = h.root(1);
  assert.equal(h.root(2), movedNode, "shared root resolves once");
  assert.ok(movedNode >= to && movedLeaf >= to);
  assert.equal(h.read(movedNode + 8), movedLeaf);
  assert.equal(h.read(movedNode + 16), movedNode, "cycle follows the copy");
  assert.equal(h.read(node), movedNode + nativeHeaderForwarded);
  assert.equal(h.read(garbage), pair, "garbage is untouched");
  for (const address of [movedNode, movedLeaf]) {
    const unit = (address - to) / 8;
    assert.notEqual(starts[unit >>> 5]! & (1 << (unit & 31)), 0);
  }
});

test("odd-word objects pack on the 8-byte granule and keep their contents", () => {
  const h = heap();
  // 16- and 32-byte records and strings of every length mod 8 leave every
  // other object at 8 mod 16. Strings span at least four units.
  const single = h.descriptor(16, [8]),
    triple = h.descriptor(32, [8, 16, 24]);
  const objects: number[] = [];
  const expected: number[] = [];
  for (let length = 0; length <= 9; length++) {
    const size = Math.ceil((16 + Math.max(length, 4) * 2) / 8) * 8;
    const text = h.allocate(size, [1, length]);
    // The simulated memory is word-addressed: one value per payload word.
    for (let word = 0; word * 4 < length; word++)
      h.words.set(text + 16 + word * 8, 0x100 * length + word);
    objects.push(text);
    expected.push(size);
  }
  const leaf = h.allocate(16, [single, 0]);
  const holder = h.allocate(32, [triple, leaf, objects[3]!, leaf]);
  expected.push(16, 32);
  const { bytes, starts } = h.collect(h.roots([...objects, holder]));
  assert.equal(
    bytes,
    expected.reduce((sum, size) => sum + size, 0),
    "extents round to 8 bytes, not 16",
  );
  let cursor = to;
  for (let index = 0; index < objects.length; index++) {
    const moved = h.root(index);
    assert.equal(moved, cursor, "copies are packed in evacuation order");
    assert.equal(moved % 8, 0);
    assert.equal(h.read(moved), 1);
    assert.equal(h.read(moved + 8), index);
    for (let word = 0; word * 4 < index; word++)
      assert.equal(h.read(moved + 16 + word * 8), 0x100 * index + word);
    const offset = (moved - to) / 8;
    assert.notEqual(starts[offset >>> 5]! & (1 << (offset & 31)), 0);
    cursor += expected[index]!;
  }
  assert.ok(
    objects.some((_, index) => h.root(index) % 16 === 8),
    "some copies start at 8 mod 16",
  );
  const movedHolder = h.root(objects.length),
    movedLeaf = h.read(movedHolder + 8);
  assert.equal(h.read(movedHolder + 24), movedLeaf, "shared leaf moves once");
  assert.equal(h.read(movedHolder + 16), h.root(3));
  assert.equal(h.read(movedLeaf), single);
});

test("general fields trace only reference tags", () => {
  const h = heap();
  const box = h.descriptor(40, [], [8, 24]);
  const target = h.allocate(16, [h.descriptor(16, []), 0]);
  // Tag 3 (object) payload is a reference; tag 1 payload is a number.
  const holder = h.allocate(40, [box, 3, target, 1, target]);
  h.collect(h.roots([holder]));
  const moved = h.root(0);
  const movedTarget = h.read(moved + 16);
  assert.notEqual(movedTarget, target);
  assert.ok(movedTarget >= to);
  assert.equal(
    h.read(moved + 32),
    target,
    "numeric payload is not a reference",
  );
});

test("strings and reference vectors size and trace correctly", () => {
  const h = heap();
  const text = h.allocate(24, [1, 3]); // 3 code units: at least 4 → 24 bytes
  // One-byte strings (kind flag 1): 16 + length, at least 8 data bytes.
  const oneByte = 1 + nativeHeaderFlagUnit;
  const short = h.allocate(24, [oneByte, 3]),
    long = h.allocate(32, [oneByte, 11]);
  const vector = h.allocate(56, [6, 4, 0, text, short, long, 0]);
  const { bytes } = h.collect(h.roots([vector]));
  assert.equal(bytes, 56 + 24 + 24 + 32);
  const moved = h.root(0);
  const movedText = h.read(moved + 24);
  assert.ok(movedText >= to);
  assert.equal(h.read(movedText + 8), 3);
  for (const [slot, length] of [
    [32, 3],
    [40, 11],
  ]) {
    const movedString = h.read(moved + slot!);
    assert.ok(movedString >= to);
    assert.equal(h.read(movedString), oneByte, "one-byte header is kept");
    assert.equal(h.read(movedString + 8), length);
  }
  assert.equal(h.read(moved + 48), 0, "null element stays null");
});

test("array data pointers follow inline backing, borrowed backing, and views", () => {
  // Every typed-array kind is pointer-free; only its data pointer and a
  // view's owner move.
  for (const { marker, elementBytes } of nativeTypedArrayKinds) {
    const h = heap();
    // 16 inline bytes: data = self + 24.
    const backing = h.allocate(40, [marker, 16 / elementBytes, 0]);
    h.words.set(backing + 16, backing + 24);
    // A view over bytes 4.. of backing, and a view of that view (flag 2).
    const viewHeader = marker + 2 * nativeHeaderFlagUnit;
    const view = h.allocate(40, [viewHeader, 1, backing + 28, backing]);
    const inner = h.allocate(40, [viewHeader, 1, backing + 30, view]);
    const borrowed = h.allocate(24, [marker + nativeHeaderFlagUnit, 8, 0x9000]);
    h.collect(h.roots([inner, borrowed]));
    const movedInner = h.root(0),
      movedView = h.read(movedInner + 24),
      movedBacking = h.read(movedView + 24);
    assert.equal(h.read(movedBacking), marker);
    assert.equal(h.read(movedBacking + 16), movedBacking + 24);
    assert.equal(h.read(movedView + 16), movedBacking + 28);
    assert.equal(h.read(movedInner + 16), movedBacking + 30);
    assert.equal(h.read(movedInner), viewHeader, "view header is restored");
    assert.equal(h.read(h.root(1) + 16), 0x9000, "borrowed data stays");
  }
});

test("sliced strings keep their flat parents through their parent slots", () => {
  const h = heap();
  // A one-byte flat string of 40 units (16 + 40 bytes) and a two-byte one
  // of 20 units (16 + 40 bytes).
  const oneByte = h.allocate(56, [1 + nativeHeaderFlagUnit, 40]),
    twoByte = h.allocate(56, [1, 20]);
  // Slices: marker 1, flags 3 (one-byte) or 2 (two-byte); length, the
  // first unit's byte offset in the parent's units, the parent.
  const slicedOne = h.allocate(32, [
    1 + 3 * nativeHeaderFlagUnit,
    13,
    7,
    oneByte,
  ]);
  const slicedTwo = h.allocate(32, [
    1 + 2 * nativeHeaderFlagUnit,
    15,
    2 * 5,
    twoByte,
  ]);
  // Only the slices are roots: they keep their parents alive.
  const { bytes } = h.collect(h.roots([slicedOne, slicedTwo]));
  const one = h.root(0),
    two = h.root(1),
    oneParent = h.read(one + 24),
    twoParent = h.read(two + 24);
  assert.ok(oneParent >= to && twoParent >= to, "parents are copied");
  assert.equal(h.read(oneParent), 1 + nativeHeaderFlagUnit);
  assert.equal(h.read(twoParent), 1);
  assert.equal(h.read(one + 16), 7, "offsets are position-independent");
  assert.equal(h.read(two + 16), 10);
  assert.equal(h.read(one + 8), 13);
  assert.equal(h.read(one), 1 + 3 * nativeHeaderFlagUnit);
  assert.equal(bytes, 2 * 32 + 2 * 56);
});

test("weak cells and ephemerons keep live keys and clear dead ones", () => {
  const h = heap();
  const leafDescriptor = h.descriptor(16, []);
  const liveKey = h.allocate(16, [leafDescriptor, 0]);
  const deadKey = h.allocate(16, [leafDescriptor, 0]);
  const liveValue = h.allocate(16, [leafDescriptor, 0]);
  const deadValue = h.allocate(16, [leafDescriptor, 0]);
  // Weak slot: marker 7 with kind flags (0 weak, 1 ephemeron), key pair,
  // value pair.
  const ephemeron = 7 + nativeHeaderFlagUnit;
  const weakLive = h.allocate(40, [7, 3, liveKey, 3, liveValue]);
  const weakDead = h.allocate(40, [7, 3, deadKey, 0, 0]);
  const ephLive = h.allocate(40, [ephemeron, 3, liveKey, 3, liveValue]);
  const ephDead = h.allocate(40, [ephemeron, 3, deadKey, 3, deadValue]);
  const { bytes } = h.collect(
    h.roots([weakLive, weakDead, ephLive, ephDead, liveKey]),
  );
  const wl = h.root(0),
    wd = h.root(1),
    el = h.root(2),
    ed = h.root(3),
    key = h.root(4);
  assert.equal(h.read(wl + 16), key, "weak cell key follows its copy");
  assert.equal(h.read(wl + 24), 0, "weak cell value pair is dropped");
  assert.equal(h.read(wd + 8), 0, "dead weak key is cleared");
  const movedValue = h.read(el + 32);
  assert.ok(movedValue >= to, "a live ephemeron keeps its value");
  assert.equal(h.read(el), ephemeron, "scratch flag is restored");
  assert.equal(h.read(ed + 8), 0);
  assert.equal(h.read(ed + 24), 0, "a dead ephemeron drops its value");
  // Copied: four slots, the live key and the live value only.
  assert.equal(bytes, 4 * 40 + 16 + 16);
});

test("ephemeron chains reach a fixpoint", () => {
  const h = heap();
  const leafDescriptor = h.descriptor(16, []);
  const a = h.allocate(16, [leafDescriptor, 0]);
  const b = h.allocate(16, [leafDescriptor, 0]);
  const c = h.allocate(16, [leafDescriptor, 0]);
  // b is reachable only as the value of a's ephemeron; c only through b's.
  const ephemeron = 7 + nativeHeaderFlagUnit;
  const second = h.allocate(40, [ephemeron, 3, b, 3, c]);
  const first = h.allocate(40, [ephemeron, 3, a, 3, b]);
  h.collect(h.roots([second, first, a]));
  const movedSecond = h.root(0),
    movedFirst = h.root(1);
  const movedB = h.read(movedFirst + 32);
  assert.ok(movedB >= to);
  assert.equal(h.read(movedSecond + 16), movedB);
  assert.ok(h.read(movedSecond + 32) >= to, "c survives through b");
});

test("remembered objects outside the source are updated in place", () => {
  const h = heap();
  const pair = h.descriptor(24, [8, 16]);
  const young = h.allocate(24, [pair, 0, 0]);
  // An old object outside both windows referring into the source window.
  const old = 0x8000;
  [pair, young, 0].forEach((value, index) =>
    h.words.set(old + index * 8, value),
  );
  const bytes = createCheneyCollector(managed, 2 * semispace).collect(
    from,
    24,
    to,
    0,
    semispace,
    0,
    new Uint32Array(8),
    to,
    (scan) => scan(old),
  );
  assert.equal(bytes, 24);
  assert.equal(h.words.get(old + 8), to);
});

test("a destination that cannot hold the survivors is an invariant failure", () => {
  const h = heap();
  const leafDescriptor = h.descriptor(16, []);
  const object = h.allocate(16, [leafDescriptor, 0]);
  const collector = createCheneyCollector(managed, 2 * semispace);
  assert.throws(
    () =>
      collector.collect(
        from,
        32,
        to,
        0,
        8,
        h.roots([object]),
        new Uint32Array(8),
        to,
        undefined,
      ),
    (error) => error === "CHENEY_OVERFLOW",
  );
});
