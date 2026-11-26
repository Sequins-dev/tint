import { test } from "node:test";
import assert from "node:assert/strict";
import * as primitive from "../src/numeric/number-text/index.ts";

test("integer prefixes retain radix, whitespace, signs and rounded integer values", () => {
  assert.equal(typeof primitive.parseIntegerText, "function");
  for (const text of [
    "",
    "  ",
    "\uFEFF\u2028-0x10tail",
    "+42.9",
    "-0",
    "0b10",
    "0x",
    "Infinity",
    "10102",
    "xyz",
    "9007199254740993",
    "0x1000000000000081",
    "9007199254740991",
    "9007199254740992",
    "-9007199254740991",
    "1fffffffffffff",
    "20000000000000",
    "zzzzzzzzzz",
  ]) {
    for (const radix of [0, 2, 8, 10, 16, 36, 37, -1]) {
      if (radix === 36 && text.length > 12) continue;
      assert.ok(
        Object.is(
          primitive.parseIntegerText(text, radix),
          parseInt(text, radix),
        ),
        `${JSON.stringify(text)} / ${radix}`,
      );
    }
  }
});

test("floating prefixes stop before malformed exponents and preserve signed zero", () => {
  assert.equal(typeof primitive.parseFloatText, "function");
  for (const text of [
    "",
    " ",
    "\uFEFF\u2028-.5tail",
    "1e+tail",
    "1.25e-2end",
    "Infinityx",
    "-Infinity",
    "0x12",
    "-.e1",
    "-0e999",
    "1e309",
    "5e-324",
    "1_2",
    "  +001.25  ",
  ])
    assert.ok(
      Object.is(primitive.parseFloatText(text), parseFloat(text)),
      JSON.stringify(text),
    );
});
