import test from "node:test";
import assert from "node:assert/strict";
import {
  nativeStringIsFlat,
  nativeFlatStringExtent,
  nativeStringTwoByteHeader,
  nativeStringOneByteHeader,
  nativeStringSlicedTwoByteHeader,
  nativeStringSlicedOneByteHeader,
} from "../src/host.ts";

test("flat string headers are the two-byte and one-byte headers", () => {
  assert.equal(nativeStringTwoByteHeader, 1);
  assert.equal(nativeStringOneByteHeader, 2 ** 48 + 1);
  assert.equal(nativeStringIsFlat(1), true);
  assert.equal(nativeStringIsFlat(2 ** 48 + 1), true);
  for (const header of [
    nativeStringSlicedTwoByteHeader,
    nativeStringSlicedOneByteHeader,
    0,
    2,
    6,
    4096,
    4 * 2 ** 48 + 1,
  ])
    assert.equal(nativeStringIsFlat(header), false, String(header));
});

test("flat string extents come from the header and length alone", () => {
  // Header and length words, at least eight data bytes, padded to eight.
  const cases: [number, number, number][] = [
    [1, 0, 24],
    [1, 4, 24],
    [1, 5, 32],
    [1, 13, 48],
    [2 ** 48 + 1, 0, 24],
    [2 ** 48 + 1, 8, 24],
    [2 ** 48 + 1, 9, 32],
    [2 ** 48 + 1, 13, 32],
    [2 ** 48 + 1, 1048576, 1048592],
    [1, 1048576, 2097168],
    [1, 0xffffffff, 16 + 2 * 0xffffffff + 2],
  ];
  for (const [header, length, extent] of cases)
    assert.equal(nativeFlatStringExtent(header, length), extent);
  assert.equal(nativeFlatStringExtent(nativeStringSlicedOneByteHeader, 20), -1);
  assert.equal(nativeFlatStringExtent(nativeStringSlicedTwoByteHeader, 20), -1);
  assert.equal(nativeFlatStringExtent(6, 4), -1);
});
