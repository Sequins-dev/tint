import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalNumericIndex } from "../src/objects/integer-index.ts";
test("canonical numeric keys retain negative zero and reject alternate spellings", () => {
  for (const key of [
    "",
    " 0",
    "0 ",
    "+0",
    "+Infinity",
    "01",
    "1.0",
    "1e0",
    "0x10",
    "-00",
    "1e21",
    "1e-6",
    "9007199254740993",
  ])
    assert.equal(canonicalNumericIndex(key), undefined, key);
  for (const key of [
    "0",
    "-0",
    "-1",
    "1.5",
    "NaN",
    "Infinity",
    "-Infinity",
    "1e+21",
    "0.000001",
    "1e-7",
    "9007199254740992",
  ])
    assert.ok(Object.is(canonicalNumericIndex(key), Number(key)), key);
});
test("canonical numeric key spelling follows Number formatting across exponents", () => {
  for (let exponent = -300; exponent <= 300; exponent++)
    for (const sign of [-1, 1]) {
      const value = sign * 1.23456789 * 10 ** exponent;
      assert.ok(
        Object.is(canonicalNumericIndex(String(value)), value),
        String(value),
      );
    }
});
