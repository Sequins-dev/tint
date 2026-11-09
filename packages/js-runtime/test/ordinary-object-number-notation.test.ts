import assert from "node:assert/strict";
import test from "node:test";
import * as numbers from "../src/objects/decimal-number-format.ts";
import { intlStringMathematicalValue } from "../src/objects/intl-mathematical-value.ts";
import {
  resolveNumberFormatDigitOptions,
  type NumberNotation,
} from "../src/objects/intl-number-options.ts";

function digitOptions(
  notation: NumberNotation,
  values: Record<string, unknown> = {},
) {
  return resolveNumberFormatDigitOptions(
    {
      read: (key) => values[key],
      number: Number,
      string: String,
      reject: (kind): never => {
        if (kind === "type") throw new TypeError();
        throw new RangeError();
      },
    },
    0,
    3,
    notation,
  );
}
function format(
  locale: string,
  notation: NumberNotation,
  value: string,
  style: numbers.DecimalNumberStyle = "decimal",
) {
  const formatter = numbers.createDecimalNumberFormatter(
    locale,
    undefined,
    digitOptions(notation),
    "auto",
    "auto",
    style,
    "short",
    undefined,
    "percent",
    notation,
  );
  assert.ok(formatter);
  const parts = numbers.decimalNumberParts(
    formatter,
    intlStringMathematicalValue(value),
  );
  return {
    text: parts.map((p) => p.value).join(""),
    types: parts.map((p) => p.type).join(","),
  };
}

test("engineering and scientific notation match ECMA-402 exponent selection", () => {
  const cases: [string, string, string][] = [
    ["0.000345", "345E-6", "3.45E-4"],
    ["0.345", "345E-3", "3.45E-1"],
    ["3.45", "3.45E0", "3.45E0"],
    ["34.5", "34.5E0", "3.45E1"],
    ["543", "543E0", "5.43E2"],
    ["5430", "5.43E3", "5.43E3"],
    ["543000", "543E3", "5.43E5"],
    ["543211.1", "543.211E3", "5.432E5"],
    ["0", "0E0", "0E0"],
    ["-0.000345", "-345E-6", "-3.45E-4"],
  ];
  for (const [value, engineering, scientific] of cases) {
    assert.equal(
      format("en-US", "engineering", value).text,
      engineering,
      value,
    );
    assert.equal(format("en-US", "scientific", value).text, scientific, value);
  }
  assert.equal(format("de-DE", "scientific", "0.000345").text, "3,45E-4");
  assert.equal(format("en-US", "scientific", "Infinity").text, "∞");
});

test("rounding that carries into the next magnitude re-selects the exponent", () => {
  assert.equal(format("en-US", "scientific", "9.9999").text, "1E1");
  assert.equal(format("en-US", "engineering", "999.9999").text, "1E3");
  assert.equal(format("en-US", "engineering", "999999.5").text, "1E6");
});

test("exponent parts follow the mantissa and are typed separately", () => {
  assert.equal(
    format("en-US", "scientific", "-0.000345").types,
    "minusSign,integer,decimal,fraction,exponentSeparator,exponentMinusSign,exponentInteger",
  );
  assert.equal(
    format("en-US", "engineering", "543").types,
    "integer,exponentSeparator,exponentInteger",
  );
  // Percent scaling happens before the exponent is computed.
  assert.equal(format("en-US", "scientific", "0.5", "percent").text, "5E1%");
});
