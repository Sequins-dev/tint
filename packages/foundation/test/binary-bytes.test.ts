import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alignUp,
  writeUnsigned,
  writeSigned,
  writeWord64,
} from "@tint/foundation/binary/bytes";

test("alignment is checked integer arithmetic, including non-power-of-two", () => {
  for (const [offset, alignment, value] of [
    [0, 16, 0],
    [16, 16, 16],
    [17, 16, 32],
    [10, 3, 12],
  ])
    assert.deepEqual(alignUp(offset!, alignment!), { ok: true, value });
  for (const a of [0, -1, 0.5, Infinity]) assert.equal(alignUp(0, a).ok, false);
  for (const o of [-1, NaN, 0.5, 2 ** 53])
    assert.equal(alignUp(o, 8).ok, false);
  assert.deepEqual(alignUp(Number.MAX_SAFE_INTEGER, 2), {
    ok: false,
    error: "OVERFLOW",
  });
});
test("writes hand-calculated endian and signed encodings", () => {
  const bytes = new Uint8Array(16);
  assert.equal(writeUnsigned(bytes, 0, 4, 0x12345678, "little").ok, true);
  assert.equal(writeUnsigned(bytes, 4, 4, 0x12345678, "big").ok, true);
  assert.equal(writeSigned(bytes, 8, 2, -2, "little").ok, true);
  assert.equal(writeSigned(bytes, 10, 2, -32768, "big").ok, true);
  assert.equal(writeSigned(bytes, 12, 4, -2147483648, "big").ok, true);
  assert.deepEqual(
    [...bytes],
    [
      0x78, 0x56, 0x34, 0x12, 0x12, 0x34, 0x56, 0x78, 0xfe, 0xff, 0x80, 0, 0x80,
      0, 0, 0,
    ],
  );
});
test("exact wide writes honor sliced views and unaligned offsets", () => {
  const backing = new Uint8Array(22).fill(0xaa),
    bytes = backing.subarray(2, 20);
  const word = { lo: 0x89abcdef, hi: 0x01234567 };
  assert.equal(writeWord64(bytes, 1, word, "little").ok, true);
  assert.equal(writeWord64(bytes, 9, word, "big").ok, true);
  assert.deepEqual(
    [...backing],
    [
      0xaa, 0xaa, 0xaa, 0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 1, 1, 0x23,
      0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0xaa, 0xaa, 0xaa,
    ],
  );
});
test("invalid writes leave all destination bytes untouched", () => {
  const bytes = new Uint8Array(8).fill(0xa5);
  const failures = [
    writeUnsigned(bytes, 0, 1, 256, "little"),
    writeUnsigned(bytes, 0, 4, -1, "big"),
    writeSigned(bytes, 0, 1, 128, "little"),
    writeSigned(bytes, 0, 1, -129, "big"),
    writeUnsigned(bytes, 0, 2, NaN, "little"),
    writeUnsigned(bytes, -1, 4, 1, "big"),
    writeWord64(bytes, 1, { lo: 1, hi: 0 }, "little"),
    writeWord64(bytes, 0, { lo: 1, hi: 2 ** 32 }, "little"),
    writeSigned(bytes, 7, 2, 1, "little"),
    writeUnsigned(bytes, 0.5, 1, 1, "big"),
  ];
  assert.equal(
    failures.every((r) => !r.ok),
    true,
  );
  assert.deepEqual([...bytes], Array(8).fill(0xa5));
});
test("one-byte boundaries and unsigned maxima are accepted", () => {
  const b = new Uint8Array(8);
  assert.equal(writeSigned(b, 0, 1, -128, "little").ok, true);
  assert.equal(writeUnsigned(b, 1, 1, 255, "big").ok, true);
  assert.equal(writeUnsigned(b, 2, 2, 65535, "little").ok, true);
  assert.equal(writeUnsigned(b, 4, 4, 0xffffffff, "big").ok, true);
  assert.deepEqual([...b], [128, 255, 255, 255, 255, 255, 255, 255]);
});
