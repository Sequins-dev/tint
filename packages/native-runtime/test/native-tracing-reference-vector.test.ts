import assert from "node:assert/strict";
import test from "node:test";
import { scanNativeObject } from "../src/tracing/scan.ts";
import { nativeObjectExtent } from "../src/tracing/extent.ts";
import { createNurseryEvacuator } from "../src/tracing/nursery.ts";
import { writeStackRoots } from "./fixtures/stack-roots.ts";
import { nativeHeaderFlagUnit } from "@tint/abi/host";
// Header (marker 6), capacity, a reserved zero word, then the slots.
function vector() {
  return new Map<number, number>([
    [256, 6],
    [264, 3],
    [272, 0],
    [280, 512],
    [288, 0],
    [296, 256],
  ]);
}
test("packed reference vectors expose exact payload slots and aligned extents", () => {
  const words = vector(),
    read = (a: number) => words.get(a),
    seen: number[][] = [];
  assert.equal(nativeObjectExtent(read, 256, 304), 48);
  assert.equal(
    scanNativeObject(read, 256, 48, (address, slot) => {
      seen.push([address, slot]);
      return true;
    }),
    "complete",
  );
  assert.deepEqual(seen, [
    [512, 280],
    [256, 296],
  ]);
});
test("reference vector metadata, capacities, edges and traversal limits fail closed", () => {
  for (const [slot, value] of [
    [256, 6 + nativeHeaderFlagUnit],
    [256, 6 + 2 * nativeHeaderFlagUnit],
    [264, -1],
    [264, 0.5],
    [264, 0xffffffff],
    [272, 1],
  ]) {
    const words = vector();
    words.set(slot!, value!);
    const read = (a: number) => words.get(a);
    assert.equal(nativeObjectExtent(read, 256, 304), undefined);
    assert.equal(
      scanNativeObject(read, 256, 48, () => true),
      "invalid",
    );
  }
  const words = vector(),
    read = (a: number) => words.get(a);
  assert.equal(nativeObjectExtent(read, 256, 303), undefined);
  assert.equal(
    scanNativeObject(read, 256, 40, () => true),
    "invalid",
  );
  assert.equal(
    scanNativeObject(read, 256, 48, () => true, 2),
    "limit",
  );
  assert.equal(
    scanNativeObject(read, 256, 48, () => false),
    "visitor",
  );
  words.set(280, 513);
  assert.equal(
    scanNativeObject(read, 256, 48, () => true),
    "invalid",
  );
  words.delete(280);
  assert.equal(
    scanNativeObject(read, 256, 48, () => true),
    "read",
  );
  words.set(264, 0);
  assert.equal(nativeObjectExtent(read, 256, 288), 32);
  assert.equal(
    scanNativeObject(read, 256, 32, () => {
      throw Error("empty vector edge");
    }),
    "complete",
  );
});
test("evacuation moves vector cycles and repairs payload references without derived pointers", () => {
  const words = vector();
  words.set(280, 304);
  words.set(304, 6);
  words.set(312, 1);
  words.set(320, 0);
  words.set(328, 256);
  // One stack root points at the first vector.
  words.set(8208, 256);
  const head = writeStackRoots(
    (address, value) => {
      words.set(address, value);
    },
    [{ sp: 8192, references: [16] }],
    4096,
  );
  const summary = new Uint32Array(3),
    collector = createNurseryEvacuator({
      base: 256,
      byteLength: 128,
      targetBase: 512,
      targetLength: 128,
      starts: new Uint32Array([0b1001]),
      forwarding: new Uint32Array(8),
      sources: new Uint32Array(8),
      sizes: new Uint32Array(8),
      destinations: new Uint32Array(8),
      slots: new Float64Array(16),
      values: new Float64Array(16),
      summary,
      read: (a) => words.get(a),
      isExternal: (a) => a >= 4096,
      scanRemembered: () => true,
      canWrite: (a) => (a >= 512 && a < 640) || a === 8208,
      copy: (dest, source, size) => {
        for (let i = 0; i < size; i += 8)
          words.set(dest + i, words.get(source + i) ?? 0);
        return true;
      },
      write: (a, v) => {
        words.set(a, v);
        return true;
      },
      publish: (count, bytes) => count === 2 && bytes === 80,
    });
  assert.ok(collector);
  assert.equal(collector.prepare(80, head), true);
  assert.equal(words.get(8208), 256);
  assert.equal(collector.commit(), true);
  assert.equal(words.get(8208), 512);
  assert.equal(words.get(536), 560);
  assert.equal(words.get(552), 512);
  assert.equal(words.get(584), 512);
  assert.equal(words.get(528), 0);
  assert.equal(words.get(576), 0);
  assert.deepEqual(Array.from(summary).slice(0, 2), [2, 80]);
});
