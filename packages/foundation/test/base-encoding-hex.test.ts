import assert from "node:assert/strict";
import test from "node:test";
import { decodeHexInto, encodeHex } from "../src/text/base-encoding/index.ts";

test("hex encodes bytes in lowercase and decodes both ASCII cases", () => {
  const bytes = new Uint8Array([0, 1, 15, 16, 127, 128, 255]);
  assert.equal(encodeHex(bytes, 0, bytes.length), "00010f107f80ff");
  const decoded = new Uint8Array(bytes.length);
  assert.deepEqual(
    decodeHexInto("00010F107f80FF", decoded, 0, decoded.length),
    { read: 14, written: 7, error: "none" },
  );
  assert.deepEqual(decoded, bytes);
  assert.equal(encodeHex(bytes, 2, 3), "0f107f");
  assert.equal(encodeHex(bytes, bytes.length, 0), "");
});

test("hex writes only complete valid pairs in the requested target window", () => {
  const bytes = new Uint8Array([9, 9, 9, 9]);
  assert.deepEqual(decodeHexInto("aAbBcc", bytes, 1, 2), {
    read: 4,
    written: 2,
    error: "none",
  });
  assert.deepEqual([...bytes], [9, 170, 187, 9]);
  assert.deepEqual(decodeHexInto("ffag", bytes, 1, 2), {
    read: 2,
    written: 1,
    error: "syntax",
  });
  assert.deepEqual([...bytes], [9, 255, 187, 9]);
  assert.deepEqual(decodeHexInto("00xx", bytes, 0, 1), {
    read: 2,
    written: 1,
    error: "none",
  });
});

test("odd input fails before writes even when target capacity is zero", () => {
  for (const capacity of [0, 1, 2]) {
    const bytes = new Uint8Array([9, 9]);
    assert.deepEqual(decodeHexInto("aaa", bytes, 0, capacity), {
      read: 0,
      written: 0,
      error: "syntax",
    });
    assert.deepEqual([...bytes], [9, 9]);
  }
  assert.deepEqual(decodeHexInto("xx", new Uint8Array(0), 0, 0), {
    read: 0,
    written: 0,
    error: "none",
  });
});

test("hex rejects whitespace, non-ASCII digits and invalid windows without writes", () => {
  for (const text of [" a", "a ", "０１", "é0", "\ud8000", "g0", "0g", "0x"]) {
    const bytes = new Uint8Array([9]);
    assert.equal(decodeHexInto(text, bytes, 0, 1).error, "syntax", text);
    assert.equal(bytes[0], 9);
  }
  for (const [offset, length] of [
    [-1, 1],
    [0.5, 1],
    [0, -1],
    [0, 0.5],
    [2, 1],
    [NaN, 0],
    [0, Infinity],
  ]) {
    const bytes = new Uint8Array([9, 9]);
    assert.equal(
      decodeHexInto("aabb", bytes, offset!, length!).error,
      "bounds",
    );
    assert.equal(encodeHex(bytes, offset!, length!), undefined);
    assert.deepEqual([...bytes], [9, 9]);
  }
});

test("hex round trips every byte and deterministic multi-byte inputs", () => {
  let state = 1234567;
  for (let length = 0; length < 256; length++) {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index++) {
      state = (state * 1664525 + 1013904223) >>> 0;
      bytes[index] = state >>> 24;
    }
    const encoded = encodeHex(bytes, 0, length);
    assert.equal(encoded, Buffer.from(bytes).toString("hex"));
    assert.ok(encoded !== undefined);
    const decoded = new Uint8Array(length);
    assert.equal(decodeHexInto(encoded, decoded, 0, length).error, "none");
    assert.deepEqual(decoded, bytes);
  }
});
