import { test } from "node:test";
import assert from "node:assert/strict";
import * as bytes from "../src/binary/bytes.ts";

test("floating encodings match IEEE rounding, subnormal and signed-zero boundaries", () => {
  const values = [
    0,
    -0,
    1,
    -2.5,
    Infinity,
    -Infinity,
    NaN,
    Number.MIN_VALUE,
    Number.MAX_VALUE,
    2 ** -24,
    2 ** -25,
    3 * 2 ** -25,
    2 ** -14,
    65504,
    65520,
    1 + 2 ** -11,
    1 + 2 ** -11 + 2 ** -30,
    1 + 2 ** -11 - 2 ** -30,
    1 + 3 * 2 ** -11,
    2 ** -149,
    2 ** -150,
    3 * 2 ** -150,
    2 ** -126,
    1 + 2 ** -24,
    1 + 3 * 2 ** -24,
    (2 - 2 ** -23) * 2 ** 127,
    2.2250738585072014e-308,
  ];
  for (const width of [2, 4, 8] as const)
    for (const endian of ["little", "big"] as const)
      for (const value of values) {
        const data = new Uint8Array(width),
          reference = new Uint8Array(width);
        const view = new DataView(reference.buffer),
          little = endian === "little";
        if (width === 2) view.setFloat16(0, value, little);
        else if (width === 4) view.setFloat32(0, value, little);
        else view.setFloat64(0, value, little);
        assert.deepEqual(bytes.writeFloat(data, 0, width, value, endian), {
          ok: true,
          value: undefined,
        });
        if (!Number.isNaN(value))
          assert.deepEqual(data, reference, `${width} ${endian} ${value}`);
        const decoded = bytes.readFloat(data, 0, width, endian);
        assert.ok(decoded.ok);
        const expected =
          width === 2
            ? view.getFloat16(0, little)
            : width === 4
              ? view.getFloat32(0, little)
              : view.getFloat64(0, little);
        assert.ok(
          Object.is(decoded.value, expected),
          `${width} ${endian} ${value}`,
        );
      }
});
test("binary64 word reads preserve both halves and reject invalid ranges", () => {
  const data = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8);
  assert.deepEqual(bytes.readWord64(data, 0, "big"), {
    ok: true,
    value: { hi: 0x01020304, lo: 0x05060708 },
  });
  assert.deepEqual(bytes.readWord64(data, 0, "little"), {
    ok: true,
    value: { lo: 0x04030201, hi: 0x08070605 },
  });
  assert.deepEqual(bytes.readFloat(data, 1, 8, "big"), {
    ok: false,
    error: "OUT_OF_BOUNDS",
  });
  assert.deepEqual(bytes.writeFloat(data, 2, 8, 1, "big"), {
    ok: false,
    error: "OUT_OF_BOUNDS",
  });
});

test("all binary16 payloads decode and re-encode without losing finite bits", () => {
  const data = new Uint8Array(2),
    out = new Uint8Array(2);
  const reference = new DataView(data.buffer);
  for (let word = 0; word < 65536; word++) {
    reference.setUint16(0, word);
    const result = bytes.readFloat(data, 0, 2, "big");
    assert.ok(result.ok);
    assert.ok(Object.is(result.value, reference.getFloat16(0)), String(word));
    assert.ok(bytes.writeFloat(out, 0, 2, result.value, "big").ok);
    if (!Number.isNaN(result.value)) assert.deepEqual(out, data, String(word));
  }
});
test("binary64 payload samples round consistently into smaller float formats", () => {
  const input = new Uint8Array(8),
    view = new DataView(input.buffer);
  let seed = 0x12345678;
  for (let index = 0; index < 1024; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    view.setUint32(0, seed);
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    view.setUint32(4, seed);
    const value = view.getFloat64(0),
      decoded = bytes.readFloat(input, 0, 8, "big");
    assert.ok(decoded.ok);
    assert.ok(Object.is(decoded.value, value));
    for (const width of [2, 4] as const) {
      const output = new Uint8Array(width),
        expected = new Uint8Array(width),
        target = new DataView(expected.buffer);
      if (width === 2) target.setFloat16(0, value);
      else target.setFloat32(0, value);
      assert.ok(bytes.writeFloat(output, 0, width, value, "big").ok);
      if (!Number.isNaN(value)) assert.deepEqual(output, expected);
    }
  }
});
