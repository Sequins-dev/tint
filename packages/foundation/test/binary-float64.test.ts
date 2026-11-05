import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFloat64 as encode } from "@tint/foundation/binary/bytes";

test("binary64 encoding agrees with DataView for every exponent and randomized payloads", () => {
  const view = new DataView(new ArrayBuffer(8));
  function verify(value: number) {
    view.setFloat64(0, value, true);
    const expected = Number.isNaN(value)
      ? { lo: 0, hi: 0x7ff80000 }
      : { lo: view.getUint32(0, true), hi: view.getUint32(4, true) };
    assert.deepEqual(encode(value), expected, String(value));
  }
  for (const value of [
    0,
    -0,
    NaN,
    Infinity,
    -Infinity,
    Number.MIN_VALUE,
    Number.MAX_VALUE,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
    0.1,
    -0.1,
  ])
    verify(value);
  let state = 0x12345678;
  function random() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  }
  for (let exponent = 0; exponent < 2047; exponent++) {
    for (let sign = 0; sign < 2; sign++) {
      view.setUint32(0, random(), true);
      view.setUint32(
        4,
        sign * 0x80000000 + exponent * 0x100000 + (random() & 0xfffff),
        true,
      );
      verify(view.getFloat64(0, true));
    }
  }
});
