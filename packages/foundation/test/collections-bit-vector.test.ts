import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createBits,
  copyBits,
  copyBitRange,
  hasBit,
  setBit,
  intersectBits,
  intersectBitRange,
  intersectBitWindows,
  equalBits,
} from "@tint/foundation/collections/bit-vector";
test("bit vectors preserve word boundaries and reject invalid writes", () => {
  const bits = createBits(65, false);
  assert.equal(bits.length, 3);
  for (const bit of [0, 31, 32, 63, 64]) setBit(bits, bit);
  for (let bit = 0; bit < 96; bit++)
    assert.equal(hasBit(bits, bit), [0, 31, 32, 63, 64].includes(bit));
  for (const bit of [-1, 0.5, 96, NaN, Infinity]) {
    assert.equal(hasBit(bits, bit), false);
    assert.throws(() => setBit(bits, bit));
  }
  assert.throws(() => createBits(-1, false));
  assert.throws(() => createBits(0.5, false));
});
test("intersection and equality operate on caller-owned storage", () => {
  const a = createBits(65, true),
    b = createBits(65, false);
  setBit(b, 31);
  setBit(b, 64);
  assert.equal(equalBits(a, b), false);
  intersectBits(a, b);
  assert.equal(equalBits(a, b), true);
  assert.equal(equalBits(a, createBits(32, false)), false);
  assert.throws(() => intersectBits(a, new Uint32Array(1)));
  assert.equal(equalBits(a, b), true);
  assert.equal(equalBits(createBits(0, true), createBits(0, false)), true);
});

test("copying a vector owns independent word storage", () => {
  const original = createBits(65, false);
  setBit(original, 64);
  const copy = copyBits(original);
  assert.ok(equalBits(copy, original));
  setBit(copy, 31);
  assert.equal(hasBit(original, 31), false);
});

test("range intersection adds one incoming bit without changing other words", () => {
  for (const added of [-1, 0, 31, 32, 63, 64, 95]) {
    for (let seed = 0; seed < 40; seed++) {
      const target = Uint32Array.of(
        (seed * 134775813) >>> 0,
        0x80000001 ^ seed,
        0xffffffff - seed,
      );
      const source = Uint32Array.of(
        123,
        seed * 7919,
        0xffffffff,
        0x80000000,
        456,
      );
      const before = target.slice(),
        saved = source.slice();
      const expected = before.map(
        (word, i) =>
          word &
          ((source[i + 1] ?? 0) |
            (added >= 0 && added >>> 5 === i ? 1 << (added & 31) : 0)),
      );
      intersectBitRange(target, source, 1, added);
      assert.deepEqual(target, expected);
      assert.deepEqual(source, saved);
    }
  }
  const same = Uint32Array.of(0x80000000, 7);
  intersectBitRange(same, same, 0, 0);
  assert.deepEqual(same, Uint32Array.of(0x80000000, 7));
  intersectBitRange(new Uint32Array(0), new Uint32Array(0), 0);
});
test("invalid bit ranges fail before mutating their destination", () => {
  for (const [offset, added] of [
    [-1, -1],
    [0.5, -1],
    [NaN, -1],
    [1, -1],
    [0, -2],
    [0, 32],
    [0, 0.5],
    [0, NaN],
  ]) {
    const target = Uint32Array.of(123);
    assert.throws(() =>
      intersectBitRange(target, Uint32Array.of(7), offset!, added!),
    );
    assert.equal(target[0], 123);
  }
});

test("range copy replaces old facts and adds the edge bit without mutating its source", () => {
  for (const added of [-1, 0, 31, 32, 63]) {
    const source = Uint32Array.of(123, 0x80000000, 7, 456);
    const target = Uint32Array.of(0x12345678, 0);
    copyBitRange(target, source, 1, added);
    const expected = Uint32Array.of(0x80000000, 7);
    if (added >= 0) setBit(expected, added);
    assert.deepEqual(target, expected);
    assert.deepEqual(source, Uint32Array.of(123, 0x80000000, 7, 456));
  }
  const same = Uint32Array.of(0, 7);
  copyBitRange(same, same, 0, 31);
  assert.deepEqual(same, Uint32Array.of(0x80000000, 7));
  copyBitRange(new Uint32Array(0), new Uint32Array(0), 0);
  for (const [offset, bit] of [
    [-1, -1],
    [0.5, -1],
    [NaN, -1],
    [1, -1],
    [0, -2],
    [0, 32],
    [0, 0.5],
    [0, NaN],
  ]) {
    const target = Uint32Array.of(123);
    assert.throws(() => copyBitRange(target, Uint32Array.of(7), offset!, bit!));
    assert.equal(target[0], 123);
  }
});

test("range meets report whether any fact survives, including the preserved edge bit", () => {
  assert.equal(
    intersectBitRange(Uint32Array.of(1, 0), Uint32Array.of(0, 1), 0),
    false,
  );
  assert.equal(
    intersectBitRange(
      Uint32Array.of(0x80000000, 0),
      Uint32Array.of(0, 0),
      0,
      31,
    ),
    true,
  );
  assert.equal(
    intersectBitRange(Uint32Array.of(0, 0), Uint32Array.of(0, 0), 0, 31),
    false,
  );
  assert.equal(copyBitRange(Uint32Array.of(9), Uint32Array.of(0), 0), false);
  assert.equal(copyBitRange(Uint32Array.of(9), Uint32Array.of(0), 0, 31), true);
  assert.equal(
    intersectBitRange(new Uint32Array(0), new Uint32Array(0), 0),
    false,
  );
  assert.equal(copyBitRange(new Uint32Array(0), new Uint32Array(0), 0), false);
});

test("window intersection reports changes and preserves unrelated matrix rows", () => {
  const target = Uint32Array.of(123, 0xffffffff, 0xffffffff, 456);
  const source = Uint32Array.of(789, 0, 3, 999);
  assert.equal(intersectBitWindows(target, 1, source, 1, 2, 31), true);
  assert.deepEqual(target, Uint32Array.of(123, 0x80000000, 3, 456));
  assert.equal(intersectBitWindows(target, 1, source, 1, 2, 31), false);
  assert.deepEqual(source, Uint32Array.of(789, 0, 3, 999));
  assert.equal(intersectBitWindows(target, 1, target, 1, 2), false);
  assert.equal(intersectBitWindows(target, 4, source, 4, 0), false);
  for (const args of [
    [-1, 0, 1, -1],
    [0, -1, 1, -1],
    [0, 0, -1, -1],
    [0, 0, 5, -1],
    [0, 0, 1, 32],
    [0.5, 0, 1, -1],
    [0, NaN, 1, -1],
  ]) {
    const saved = target.slice();
    assert.throws(() =>
      intersectBitWindows(
        target,
        args[0]!,
        source,
        args[1]!,
        args[2]!,
        args[3]!,
      ),
    );
    assert.deepEqual(target, saved);
  }
});
