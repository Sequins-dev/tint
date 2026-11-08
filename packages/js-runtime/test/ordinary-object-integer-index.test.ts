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

test("canonical numeric keys agree with the shortest-digits round-trip", async () => {
  const { stringToNumber, numberToString } =
    await import("@tint/foundation/numeric/number-text");
  const reference = (key: string): number | undefined => {
    if (key === "-0") return -0;
    const index = stringToNumber(key);
    return numberToString(index) === key ? index : undefined;
  };
  const keys = [
    "",
    "0",
    "00",
    "-0",
    "-00",
    "7",
    "07",
    "10",
    "999999999999999",
    "1000000000000000",
    "9999999999999999",
    "123456789012345678901",
    "4294967295",
    "4294967294",
    "-1",
    "-01",
    "1.5",
    "1.50",
    "1e21",
    "1e+21",
    "NaN",
    "nan",
    "Infinity",
    "-Infinity",
    "Infinityx",
    "N",
    "I",
    "-",
    "--1",
    " 1",
    "1 ",
    "+1",
    "0x1F",
    "length",
    "٠",
    "١",
    "1\u0000",
  ];
  let seed = 3;
  const alphabet = "0123456789-.e+ INax";
  for (let n = 0; n < 3000; n++) {
    let key = "";
    const size = n % 24;
    for (let i = 0; i < size; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      key += alphabet[(seed >>> 8) % (i === 0 ? alphabet.length : 10)];
    }
    keys.push(key);
  }
  for (const key of keys)
    assert.ok(
      Object.is(canonicalNumericIndex(key), reference(key)),
      JSON.stringify(key),
    );
});
