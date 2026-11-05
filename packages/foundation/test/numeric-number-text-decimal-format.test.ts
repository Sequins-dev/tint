import assert from "node:assert/strict";
import test from "node:test";
import * as decimal from "../src/numeric/number-text/index.ts";

test("fraction formatting keeps presentation zeroes separate from mathematical identity", () => {
  assert.equal(typeof decimal.formatDecimalFraction, "function");
  for (const [source, min, max, increment, expected] of [
    ["1.005", 2, 2, 1, "1.01"],
    ["1", 2, 3, 1, "1.00"],
    ["1.2000", 0, 3, 1, "1.2"],
    ["-0.0001", 2, 2, 1, "-0.00"],
    ["999.95", 0, 1, 1, "1000"],
    ["2.375", 2, 2, 25, "2.50"],
  ] as const) {
    const result = decimal.formatDecimalFraction(
      decimal.decimalFromString(source)!,
      min,
      max,
      increment,
      "halfExpand",
    )!;
    assert.equal(result.text, expected);
    assert.equal(result.roundingMagnitude, -max);
  }
  assert.equal(
    decimal.formatDecimalFraction(
      decimal.decimalFromNumber(1),
      3,
      2,
      1,
      "halfExpand",
    ),
    undefined,
  );
  assert.equal(
    decimal.formatDecimalFraction(
      decimal.decimalFromNumber(Infinity),
      0,
      2,
      1,
      "halfExpand",
    ),
    undefined,
  );
});

test("significant formatting handles carries, small values and minimum precision", () => {
  assert.equal(typeof decimal.formatDecimalPrecision, "function");
  for (const [source, min, max, expected, magnitude] of [
    ["9.99", 1, 2, "10", 0],
    ["9.99", 3, 3, "9.99", -2],
    ["99.99", 3, 3, "100", 0],
    ["0.001234", 3, 3, "0.00123", -5],
    ["0.001", 3, 3, "0.00100", -5],
    ["0", 3, 3, "0.00", -2],
    ["-0", 2, 3, "-0.0", -2],
    ["12345", 1, 3, "12300", 2],
    ["1", 1, 3, "1", -2],
    ["1", 3, 3, "1.00", -2],
  ] as const) {
    const result = decimal.formatDecimalPrecision(
      decimal.decimalFromString(source)!,
      min,
      max,
      "halfExpand",
    )!;
    assert.equal(result.text, expected, source);
    assert.equal(result.roundingMagnitude, magnitude);
  }
  assert.equal(
    decimal.formatDecimalPrecision(
      decimal.decimalFromNumber(1),
      0,
      2,
      "halfExpand",
    ),
    undefined,
  );
});

test("decimal presentation agrees with Intl for shared standard digit options", () => {
  const modes = [
    "ceil",
    "floor",
    "expand",
    "trunc",
    "halfCeil",
    "halfFloor",
    "halfExpand",
    "halfTrunc",
    "halfEven",
  ] as const;
  let state = 0x87654321;
  for (let sample = 0; sample < 120; sample++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const source = (sample % 2 ? "-" : "") + state + "e" + ((sample % 31) - 15);
    const value = decimal.decimalFromString(source)!;
    const minimum = sample % 4,
      maximum = minimum + (sample % 5);
    for (const mode of modes) {
      const fixed = new Intl.NumberFormat("en", {
        useGrouping: false,
        minimumFractionDigits: minimum,
        maximumFractionDigits: maximum,
        roundingMode: mode,
      });
      assert.equal(
        decimal.formatDecimalFraction(value, minimum, maximum, 1, mode)?.text,
        fixed.format(source as Intl.StringNumericLiteral),
        `${source}/fixed/${mode}`,
      );
      const significant = new Intl.NumberFormat("en", {
        useGrouping: false,
        minimumSignificantDigits: minimum + 1,
        maximumSignificantDigits: maximum + 1,
        roundingMode: mode,
      });
      assert.equal(
        decimal.formatDecimalPrecision(value, minimum + 1, maximum + 1, mode)
          ?.text,
        significant.format(source as Intl.StringNumericLiteral),
        `${source}/precision/${mode}`,
      );
    }
  }
});
