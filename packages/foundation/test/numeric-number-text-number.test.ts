import assert from "node:assert/strict";
import { test } from "node:test";
import { stringToNumber } from "../src/numeric/number-text/index.ts";
function check(text: string): void {
  assert.ok(Object.is(stringToNumber(text), Number(text)), text);
}
test("numeric strings preserve grammar, signed zero and boundary rounding", () => {
  for (const text of [
    "",
    " ",
    "-0",
    "+0",
    ".5",
    "1.",
    "1e-3",
    "Infinity",
    "-Infinity",
    "+Infinity",
    "inf",
    "NaN",
    "1_0",
    "1n",
    "1e",
    ".",
    "+",
    "0x",
    "0xFF",
    "0b101",
    "0o77",
    "-0x1",
    "+0b1",
    "0b2",
    "1 2",
    "1\u0000",
    "\uFEFF\u20281\u3000",
    "\u00851",
    "5e-324",
    "2.4703282292062327e-324",
    "2.4703282292062328e-324",
    "2.2250738585072014e-308",
    "1.7976931348623157e308",
    "1.7976931348623159e308",
    "9007199254740993",
    "9007199254740995",
    "1.00000000000000011102230246251565404236316680908203125",
    "1e9999999",
    "-1e-9999999",
    "0e9999999",
    "0x20000000000001",
  ])
    check(text);
});
test("decimal and radix conversions agree with the host on deterministic inputs", () => {
  let state = 123;
  for (let i = 0; i < 1000; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    check(`${state}${(state ^ 12345) >>> 0}e${(i % 700) - 350}`);
    check(`0x${state.toString(16)}${((state ^ 12345) >>> 0).toString(16)}`);
  }
  for (const radix of [2, 8, 16])
    for (const length of [1, 53, 54, 100, 1024]) {
      const digits = (radix - 1).toString(radix).repeat(length);
      check((radix === 2 ? "0b" : radix === 8 ? "0o" : "0x") + digits);
    }
});
test("long significands and exponents cancel without premature overflow", () => {
  check("1" + "0".repeat(1000) + "e-1000");
  check("0." + "0".repeat(1000) + "1e1001");
  check("1." + "0".repeat(1000) + "1");
});

test("finite binary64 round trips retain all bits", () => {
  const data = new DataView(new ArrayBuffer(8));
  let seed = 444;
  for (let i = 0; i < 1000; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data.setUint32(0, seed);
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data.setUint32(4, seed);
    const value = data.getFloat64(0);
    if (!Number.isFinite(value)) continue;
    assert.ok(Object.is(stringToNumber(String(value)), value), String(value));
  }
});
