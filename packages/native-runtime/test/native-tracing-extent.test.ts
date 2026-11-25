import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeHeaderFlagUnit } from "@tint/abi/host";
import { nativeTypedArrayKinds } from "@tint/abi/typed-array";
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
  // Two-byte strings: 16 + 2 * length; one-byte strings (flag 1): 16 +
  // length. Both have at least eight data bytes; other flags are invalid.
  for (const [flags, length, extent] of [
    [0, 0, 32],
    [0, 5, 32],
    [0, 9, 48],
    [1, 0, 32],
    [1, 5, 32],
    [1, 9, 32],
    [1, 16, 32],
    [1, 17, 48],
  ]) {
    header(1, flags!, length!);
    assert.equal(nativeObjectExtent(read, 256, 4096), extent);
  }
  // Sliced strings (flags 2, or 3 for one-byte) are 32 bytes whatever
  // their length; other string flags are invalid.
  const classification = new Uint8Array(1);
  for (const flags of [2, 3]) {
    header(1, flags, 5);
    assert.equal(nativeObjectExtent(read, 256, 4096, classification), 32);
    assert.equal(classification[0], 9);
    header(1, flags, 1000);
    assert.equal(nativeObjectExtent(read, 256, 4096), 32);
  }
  for (const flags of [4, 7]) {
    header(1, flags, 5);
    assert.equal(nativeObjectExtent(read, 256, 4096), undefined);
  }
  // Every typed-array kind: pointer-free elements sized by the marker's
  // width class, classified by that class (plus 8 for views).
  for (const { marker, elementBytes } of nativeTypedArrayKinds) {
    header(marker, 0, 17);
    assert.equal(
      nativeObjectExtent(read, 256, 4096, classification),
      Math.ceil((24 + 17 * elementBytes) / 16) * 16,
    );
    assert.equal(classification[0], marker & 7);
    header(marker, 2, 17);
    assert.equal(nativeObjectExtent(read, 256, 4096, classification), 48);
    assert.equal(classification[0], (marker & 7) + 8);
    header(marker, 1, 17);
    assert.equal(nativeObjectExtent(read, 256, 4096), 32);
  }
  // Built-in markers outside the typed-array classes are not records.
  for (const marker of [8, 14, 15, 16, 24, 31]) {
    header(marker, 0, 17);
    assert.equal(nativeObjectExtent(read, 256, 4096), undefined);
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
  words.set(256, 1 + 4 * nativeHeaderFlagUnit);
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
    for (const flags of marker === 1
      ? [0, 1, 2, 3]
      : marker <= 5
        ? [0, 1, 2]
        : [0]) {
      words.set(256, marker + flags * nativeHeaderFlagUnit);
      assert.notEqual(nativeObjectExtent(read, 256, 4096, kind), undefined);
      // Views (array views and sliced strings) classify as marker + 8.
      assert.equal(kind[0], marker <= 6 ? marker + (flags >= 2 ? 8 : 0) : 0);
    }
  }
  kind[0] = 255;
  words.set(256, 1 + 4 * nativeHeaderFlagUnit);
  assert.equal(nativeObjectExtent(read, 256, 4096, kind), undefined);
  assert.equal(kind[0], 255);
});
