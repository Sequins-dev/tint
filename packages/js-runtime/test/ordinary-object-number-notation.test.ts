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

function formatWithDigits(
  notation: NumberNotation,
  value: string,
  values: Record<string, unknown>,
) {
  const formatter = numbers.createDecimalNumberFormatter(
    "en-US",
    undefined,
    digitOptions(notation, values),
    notation === "compact" ? "min2" : "auto",
    "auto",
    "decimal",
    "short",
    undefined,
    "percent",
    notation,
    "short",
  );
  assert.ok(formatter);
  return numbers.formatDecimalNumber(
    formatter,
    intlStringMathematicalValue(value),
  );
}

test("ComputeExponent rounds the absolute value before formatting the signed mantissa", () => {
  // ECMA-402 ComputeExponent step 2 replaces x by -x before rounding, so
  // directed modes choose the exponent from |x|. PartitionNumberPattern then
  // rounds the signed x * 10^-exponent with the same mode, which can yield a
  // negative zero mantissa or a mantissa that no longer has one integer digit.
  // https://tc39.es/ecma402/#sec-computeexponent
  const cases: [NumberNotation, string, string, string][] = [
    // Scientific: |9.1| rounds up to 10 under ceil/expand, selecting E1.
    ["scientific", "ceil", "9.1", "1E1"],
    ["scientific", "ceil", "-9.1", "-0E1"],
    ["scientific", "floor", "9.1", "9E0"],
    ["scientific", "floor", "-9.1", "-10E0"],
    ["scientific", "halfCeil", "9.5", "1E1"],
    ["scientific", "halfCeil", "-9.5", "-1E1"],
    ["scientific", "halfCeil", "-9.1", "-9E0"],
    ["scientific", "halfFloor", "9.5", "9E0"],
    ["scientific", "halfFloor", "-9.5", "-10E0"],
    ["scientific", "halfFloor", "-9.6", "-1E1"],
    ["scientific", "expand", "9.1", "1E1"],
    ["scientific", "expand", "-9.1", "-1E1"],
    ["scientific", "trunc", "9.9", "9E0"],
    ["scientific", "trunc", "-9.9", "-9E0"],
    ["scientific", "halfExpand", "9.99", "1E1"],
    ["scientific", "halfExpand", "-9.99", "-1E1"],
    // Engineering: |999.1| carries to 1000 under ceil/expand, selecting E3.
    ["engineering", "ceil", "999.1", "1E3"],
    ["engineering", "ceil", "-999.1", "-0E3"],
    ["engineering", "floor", "999.1", "999E0"],
    ["engineering", "floor", "-999.1", "-1,000E0"],
    ["engineering", "halfCeil", "999.5", "1E3"],
    ["engineering", "halfCeil", "-999.5", "-1E3"],
    ["engineering", "halfFloor", "999.5", "999E0"],
    ["engineering", "halfFloor", "-999.5", "-1,000E0"],
    ["engineering", "expand", "-999.1", "-1E3"],
    ["engineering", "trunc", "-999.9", "-999E0"],
    ["engineering", "halfExpand", "-999.99", "-1E3"],
  ];
  for (const [notation, roundingMode, value, expected] of cases) {
    assert.equal(
      formatWithDigits(notation, value, {
        maximumFractionDigits: 0,
        roundingMode,
      }),
      expected,
      `${notation} ${roundingMode} ${value}`,
    );
  }
  for (const notation of ["scientific", "engineering"] as const)
    for (const roundingMode of [
      "ceil",
      "floor",
      "halfCeil",
      "halfFloor",
      "expand",
      "trunc",
    ])
      assert.equal(
        formatWithDigits(notation, "-0", {
          maximumFractionDigits: 0,
          roundingMode,
        }),
        "-0E0",
        `${notation} ${roundingMode} -0`,
      );
  // Compact notation shares ComputeExponent: |-999.9| floors to 999, so the
  // magnitude-2 pattern formats the signed value, which floors to -1000.
  assert.equal(
    formatWithDigits("compact", "-999.9", { roundingMode: "floor" }),
    "-1000",
  );
  assert.equal(
    formatWithDigits("compact", "999.9", { roundingMode: "floor" }),
    "999",
  );
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

function compact(
  locale: string,
  display: "short" | "long",
  value: string,
  style: numbers.DecimalNumberStyle = "decimal",
) {
  const formatter = numbers.createDecimalNumberFormatter(
    locale,
    undefined,
    digitOptions("compact"),
    "min2",
    "auto",
    style,
    "short",
    undefined,
    "percent",
    "compact",
    display,
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

test("compact notation uses CLDR patterns, compact rounding and min2 grouping", () => {
  const table: [string, "short" | "long", [string, string][]][] = [
    [
      "en-US",
      "short",
      [
        ["987654321", "988M"],
        ["98765432", "99M"],
        ["98765", "99K"],
        ["9876", "9.9K"],
        ["159", "159"],
        ["15.9", "16"],
        ["1.59", "1.6"],
        ["0.00159", "0.0016"],
        ["-Infinity", "-∞"],
      ],
    ],
    [
      "en-US",
      "long",
      [
        ["987654321", "988 million"],
        ["98765", "99 thousand"],
        ["9876", "9.9 thousand"],
      ],
    ],
    [
      "de-DE",
      "short",
      [
        ["987654321", "988 Mio."],
        ["98765", "98.765"],
        ["9876", "9876"],
        ["1.59", "1,6"],
      ],
    ],
    [
      "de-DE",
      "long",
      [
        ["987654321", "988 Millionen"],
        ["98765", "99 Tausend"],
        ["9876", "9,9 Tausend"],
      ],
    ],
    [
      "ja-JP",
      "short",
      [
        ["987654321", "9.9億"],
        ["98765432", "9877万"],
        ["98765", "9.9万"],
        ["9876", "9876"],
      ],
    ],
  ];
  for (const [locale, display, cases] of table)
    for (const [value, expected] of cases)
      assert.equal(
        compact(locale, display, value).text,
        expected,
        `${locale} ${display} ${value}`,
      );
});

test("compact parts separate the compact symbol from spacing literals", () => {
  assert.equal(
    compact("en-US", "short", "9876").types,
    "integer,decimal,fraction,compact",
  );
  assert.equal(
    compact("en-US", "long", "98765").types,
    "integer,literal,compact",
  );
  assert.equal(
    compact("ja-JP", "short", "98765").types,
    "integer,decimal,fraction,compact",
  );
  assert.equal(compact("en-US", "short", "-98765").text, "-99K");
  assert.equal(compact("en-US", "short", "999999").text, "1M");
});
