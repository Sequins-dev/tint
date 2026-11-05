import assert from "node:assert/strict";
import test from "node:test";
import { scanNativeObject } from "../src/tracing/scan.ts";
import { nativeObjectExtent } from "../src/tracing/extent.ts";
import { createNurseryEvacuator } from "../src/tracing/nursery.ts";
function vector() {
  return new Map<number, number>([
    [256, 6],
    [264, 0],
    [272, 3],
    [280, 0],
    [288, 512],
    [296, 0],
    [304, 256],
    [312, 0],
  ]);
}
test("packed reference vectors expose exact payload slots and aligned extents", () => {
  const words = vector(),
    read = (a: number) => words.get(a),
    seen: number[][] = [];
  assert.equal(nativeObjectExtent(read, 256, 320), 64);
  assert.equal(
    scanNativeObject(read, 256, 64, (address, slot) => {
      seen.push([address, slot]);
      return true;
    }),
    "complete",
  );
  assert.deepEqual(seen, [
    [512, 288],
    [256, 304],
  ]);
});
test("reference vector metadata, capacities, edges and traversal limits fail closed", () => {
  for (const [slot, value] of [
    [264, 1],
    [264, 2],
    [272, -1],
    [272, 0.5],
    [272, 0xffffffff],
    [280, 1],
  ]) {
    const words = vector();
    words.set(slot!, value!);
    const read = (a: number) => words.get(a);
    assert.equal(nativeObjectExtent(read, 256, 320), undefined);
    assert.equal(
      scanNativeObject(read, 256, 64, () => true),
      "invalid",
    );
  }
  const words = vector(),
    read = (a: number) => words.get(a);
  assert.equal(nativeObjectExtent(read, 256, 319), undefined);
  assert.equal(
    scanNativeObject(read, 256, 48, () => true),
    "invalid",
  );
  assert.equal(
    scanNativeObject(read, 256, 64, () => true, 2),
    "limit",
  );
  assert.equal(
    scanNativeObject(read, 256, 64, () => false),
    "visitor",
  );
  words.set(288, 513);
  assert.equal(
    scanNativeObject(read, 256, 64, () => true),
    "invalid",
  );
  words.delete(288);
  assert.equal(
    scanNativeObject(read, 256, 64, () => true),
    "read",
  );
  words.set(272, 0);
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
  words.set(288, 320);
  words.set(320, 6);
  words.set(328, 0);
  words.set(336, 1);
  words.set(344, 0);
  words.set(352, 256);
  words.set(360, 0);
  // One stack root points at the first vector.
  words.set(8192, 0);
  words.set(8200, 4096);
  words.set(8208, 256);
  words.set(4096, 1);
  words.set(4104, 16);
  words.set(4112, 0);
  const summary = new Uint32Array(3),
    collector = createNurseryEvacuator({
      base: 256,
      byteLength: 128,
      targetBase: 512,
      targetLength: 128,
      starts: new Uint32Array([0b10001]),
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
      publish: (count, bytes) => count === 2 && bytes === 112,
    });
  assert.ok(collector);
  assert.equal(collector.prepare(112, 8192), true);
  assert.equal(words.get(8208), 256);
  assert.equal(collector.commit(), true);
  assert.equal(words.get(8208), 512);
  assert.equal(words.get(544), 576);
  assert.equal(words.get(560), 512);
  assert.equal(words.get(608), 512);
  assert.equal(words.get(536), 0);
  assert.equal(words.get(600), 0);
  assert.deepEqual(Array.from(summary).slice(0, 2), [2, 112]);
});
