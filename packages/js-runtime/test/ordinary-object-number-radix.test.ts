import { test } from "node:test";
import assert from "node:assert/strict";
import { numberRadixText } from "../src/objects/number-radix.ts";
test("integer radix formatting agrees with Number for exact supported values", () => {
  for (let radix = 2; radix <= 36; radix++)
    for (const value of [
      0,
      -0,
      1,
      -1,
      255,
      65535,
      123456789,
      Number.MAX_SAFE_INTEGER,
      -Number.MAX_SAFE_INTEGER,
    ])
      assert.equal(numberRadixText(value, radix), value.toString(radix));
  for (const radix of [2, 4, 8, 16, 32])
    for (const value of [1e20, Number.MAX_VALUE, -Number.MAX_VALUE])
      assert.equal(numberRadixText(value, radix), value.toString(radix));
  assert.equal(numberRadixText(1.5, 16), "1.8");
  assert.equal(numberRadixText(1e20, 36), undefined);
});

test("power-of-two radices preserve fractional binary64 bits", () => {
  for (const radix of [2, 4, 8, 16, 32])
    for (const value of [
      0.1,
      -0.1,
      0.5,
      1.5,
      Number.MIN_VALUE,
      1e-300,
      Math.PI,
      Number.MAX_VALUE,
    ])
      assert.equal(numberRadixText(value, radix), value.toString(radix));
});
