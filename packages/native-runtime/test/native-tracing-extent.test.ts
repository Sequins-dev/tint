import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeHeaderFlagUnit } from "@tint/abi/host";
import { nativeObjectExtent } from "../src/tracing/extent.ts";

// One header word (marker + kind flags * 2^48), then the length word.
test("object extents come from layouts without an allocation inventory", () => {
  const words = new Map<number, number>();
  const read = (address: number) => words.get(address);
  function header(marker: number, flags: number, length: number) {
    words.set(256, marker + flags * nativeHeaderFlagUnit);
    words.set(264, length);
  }
  header(4096, 0, 0);
  words.set(4096, 40);
  assert.equal(nativeObjectExtent(read, 256, 4096), 48);
  // Strings: 16 + 2 * length (at least four units).
  header(1, 0, 5);
  assert.equal(nativeObjectExtent(read, 256, 4096), 32);
  header(1, 0, 0);
  assert.equal(nativeObjectExtent(read, 256, 4096), 32);
  for (const [marker, width] of [
    [2, 1],
    [3, 2],
    [4, 4],
    [5, 8],
  ]) {
    header(marker!, 0, 17);
    assert.equal(
      nativeObjectExtent(read, 256, 4096),
      Math.ceil((24 + 17 * width!) / 16) * 16,
    );
    header(marker!, 2, 17);
    assert.equal(nativeObjectExtent(read, 256, 4096), 48);
    header(marker!, 1, 17);
    assert.equal(nativeObjectExtent(read, 256, 4096), 32);
  }
});

test("extent decoding rejects invalid headers, truncation and overflowing sizes", () => {
  const words = new Map<number, number>([
    [256, 4],
    [264, 4],
  ]);
  const reads: number[] = [];
  const read = (address: number) => {
    reads.push(address);
    return words.get(address);
  };
  assert.equal(nativeObjectExtent(read, 256, 304), 48);
  assert.equal(nativeObjectExtent(read, 256, 303), undefined);
  reads.length = 0;
  assert.equal(nativeObjectExtent(read, 256, 272), undefined);
  assert.ok(reads.every((address) => address < 272));
  for (const address of [0, 257, NaN, Infinity, Number.MAX_SAFE_INTEGER - 15])
    assert.equal(nativeObjectExtent(read, address, 4096), undefined);
  for (const marker of [0, 1.5, 9, NaN, Infinity]) {
    words.set(256, marker);
    assert.equal(nativeObjectExtent(read, 256, 4096), undefined);
  }
  words.set(256, 4);
  for (const length of [-1, 0.5, NaN, Infinity, 4294967295]) {
    words.set(264, length);
    assert.equal(nativeObjectExtent(read, 256, 4096), undefined);
  }
  words.set(264, 4);
  words.set(256, 4 + 3 * nativeHeaderFlagUnit);
  assert.equal(nativeObjectExtent(read, 256, 4096), undefined);
  words.set(256, 1 + 2 * nativeHeaderFlagUnit);
  assert.equal(nativeObjectExtent(read, 256, 4096), undefined);
  words.set(256, 4096);
  for (const size of [undefined, 0, 7, 15, 16.5, 4294967295]) {
    if (size === undefined) words.delete(4096);
    else words.set(4096, size);
    assert.equal(nativeObjectExtent(read, 256, 4096), undefined);
  }
});

test("extent classification publishes only successfully validated immutable headers", () => {
  const words = new Map<number, number>([
    [256, 1],
    [264, 4],
    [272, 0],
    [4096, 32],
  ]);
  const kind = new Uint8Array([255]),
    read = (address: number) => words.get(address);
  for (const marker of [1, 2, 3, 4, 5, 6, 4096]) {
    for (const flags of marker >= 2 && marker <= 5 ? [0, 1, 2] : [0]) {
      words.set(256, marker + flags * nativeHeaderFlagUnit);
      assert.notEqual(nativeObjectExtent(read, 256, 4096, kind), undefined);
      assert.equal(kind[0], marker <= 6 ? marker + (flags === 2 ? 8 : 0) : 0);
    }
  }
  kind[0] = 255;
  words.set(256, 1 + 2 * nativeHeaderFlagUnit);
  assert.equal(nativeObjectExtent(read, 256, 4096, kind), undefined);
  assert.equal(kind[0], 255);
});
