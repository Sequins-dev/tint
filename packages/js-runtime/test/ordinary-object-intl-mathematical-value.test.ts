import assert from "node:assert/strict";
import test from "node:test";
import * as objects from "../src/objects/index.ts";

test("Intl string mathematical values preserve exact coefficients after range classification", () => {
  assert.equal(typeof objects.intlStringMathematicalValue, "function");
  for (const [source, digits, exponent, negative] of [
    [" 9007199254740993 ", "9007199254740993", 0, false],
    ["1.005", "1005", -3, false],
    ["0x20000000000001", "9007199254740993", 0, false],
    ["0b101", "5", 0, false],
    ["0o77", "63", 0, false],
    ["", "0", 0, false],
    ["\u00a0\ufeff", "0", 0, false],
    ["-0", "0", 0, true],
    ["-1e-90000", "0", 0, true],
    ["2.4703282292062328e-324", "24703282292062328", -340, false],
  ] as const)
    assert.deepEqual(objects.intlStringMathematicalValue(source), {
      kind: "finite",
      negative,
      digits,
      exponent,
    });
  assert.equal(objects.intlStringMathematicalValue("1e90000").kind, "infinity");
  assert.equal(objects.intlStringMathematicalValue("-Infinity").negative, true);
  for (const source of ["NaN", "1_0", "1n", "-0x1", "0x", "1e", "∞"])
    assert.equal(
      objects.intlStringMathematicalValue(source).kind,
      "nan",
      source,
    );
});
