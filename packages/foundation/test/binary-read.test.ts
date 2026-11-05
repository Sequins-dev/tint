import { test } from "node:test";
import assert from "node:assert/strict";
import * as bytes from "../src/binary/bytes.ts";
test("integer reads decode both endiannesses and signed boundaries", () => {
  const data = Uint8Array.of(0x12, 0x34, 0x80, 0xff);
  assert.deepEqual(bytes.readUnsigned(data, 0, 2, "big"), {
    ok: true,
    value: 0x1234,
  });
  assert.deepEqual(bytes.readUnsigned(data, 0, 2, "little"), {
    ok: true,
    value: 0x3412,
  });
  assert.deepEqual(bytes.readUnsigned(data, 0, 4, "big"), {
    ok: true,
    value: 0x123480ff,
  });
  assert.deepEqual(bytes.readSigned(data, 2, 1, "big"), {
    ok: true,
    value: -128,
  });
  assert.deepEqual(bytes.readSigned(data, 2, 2, "little"), {
    ok: true,
    value: -128,
  });
  assert.deepEqual(
    bytes.readSigned(Uint8Array.of(0x80, 0, 0, 0), 0, 4, "big"),
    { ok: true, value: -2147483648 },
  );
});
test("reads reject invalid ranges and formats without clamping", () => {
  const data = new Uint8Array(4);
  assert.deepEqual(bytes.readUnsigned(data, 1, 4, "big"), {
    ok: false,
    error: "OUT_OF_BOUNDS",
  });
  assert.deepEqual(bytes.readSigned(data, -1, 1, "little"), {
    ok: false,
    error: "INVALID_OFFSET",
  });
  assert.deepEqual(bytes.readUnsigned(data, 0.5, 1, "big"), {
    ok: false,
    error: "INVALID_OFFSET",
  });
  assert.deepEqual(bytes.readUnsigned(data, 0, 3 as bytes.Width, "big"), {
    ok: false,
    error: "INVALID_ENCODING",
  });
});
