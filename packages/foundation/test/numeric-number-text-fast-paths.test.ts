import assert from "node:assert/strict";
import { test } from "node:test";
import {
  numberToString,
  stringToNumber,
} from "../src/numeric/number-text/index.ts";

/** A deterministic 32-bit generator (xorshift). */
function generator(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}
test("short exact decimals format like the host, and longer ones still do", () => {
  const next = generator(7);
  const values: number[] = [
    0.5,
    0.125,
    1.5,
    12.125,
    0.1,
    0.2,
    0.3,
    1 / 3,
    2 / 3,
    123.456,
    1e-7,
    1.5e-7,
    1e-6,
    1.25e-6,
    999999999999999.9,
    99999999999999.98,
    123456789012345.6,
    0.000001,
    5e-324,
    1.7976931348623157e308,
    2 ** -30,
    2 ** 60 + 0.0,
    4503599627370495.5,
    1e21,
    1.5e21,
  ];
  for (let i = 0; i < 20000; i++) {
    const numerator = next() % 10000000,
      shift = next() % 24;
    values.push(numerator / 2 ** shift, numerator / 10 ** (shift % 16));
    // Random bit patterns over a wide exponent range.
    const mantissa = next() * 2 ** 21 + (next() >>> 11);
    values.push(mantissa * 2 ** ((next() % 200) - 120));
  }
  for (const value of values) {
    assert.equal(numberToString(value), String(value), String(value));
    assert.equal(numberToString(-value), String(-value));
  }
});
test("decimal strings within Clinger's bounds parse like the host", () => {
  const next = generator(11);
  const texts: string[] = [
    "0.1",
    "1e22",
    "1e-22",
    "9007199254740993",
    "123456789012345",
    "1234567890123456",
    "999999999999999e22",
    "1e23",
    "0.000000000000001",
    "000000000000000000001.5",
    "1.50000000000000000",
    "  12.5  ",
    "\t7\n",
    " 3.25　",
    "-4.5e-3",
    "+0.0625",
  ];
  for (let i = 0; i < 20000; i++) {
    const digits = String(next() % 1000000000000000).padStart(
      1 + (next() % 15),
      "0",
    );
    const point = next() % (digits.length + 1);
    const exponent = (next() % 61) - 30;
    texts.push(
      digits.slice(0, point) + "." + digits.slice(point) + "e" + exponent,
      digits + "e" + exponent,
      "-" + digits.slice(0, point) + "." + digits.slice(point),
    );
  }
  for (const text of texts)
    assert.ok(Object.is(stringToNumber(text), Number(text)), text);
});
test("plain decimals parse in one pass like the host, and other forms fall through", () => {
  const next = generator(13);
  const texts: string[] = [
    "",
    "0",
    "-0",
    "-0.0",
    "00012",
    "-00012.50",
    ".5",
    "-.5",
    "5.",
    "-5.",
    ".",
    "-",
    "-.",
    "..5",
    "1.2.3",
    "1-2",
    "--1",
    "+5",
    "0x1f",
    "0b101",
    "0o17",
    "-0x1f",
    "1e5",
    "1E5",
    "Infinity",
    "-Infinity",
    " 12",
    "12 ",
    "1_000",
    "١٢",
    "0." + "0".repeat(21) + "1",
    "0." + "0".repeat(22) + "1",
    "123456789012345",
    "1234567890123456",
    "-999999999999999",
    "9999999999999999",
    "0.000000000000001",
    "100000000000000000000",
    "48862.125",
    "381234",
  ];
  for (let i = 0; i < 20000; i++) {
    const digits = String(next() % 1000000000000000).padStart(
      1 + (next() % 18),
      "0",
    );
    const point = next() % (digits.length + 1);
    texts.push(
      digits.slice(0, point) + "." + digits.slice(point),
      "-" + digits,
      digits.slice(0, point) +
        "." +
        digits.slice(point) +
        "0".repeat(next() % 8),
    );
  }
  for (const text of texts)
    assert.ok(Object.is(stringToNumber(text), Number(text)), text);
});
