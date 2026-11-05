import assert from "node:assert/strict";
import test from "node:test";
import * as decimal from "../src/numeric/number-text/index.ts";

test("decimal quantities preserve exact digits, decimal scale and negative zero", () => {
  assert.equal(typeof decimal.decimalFromString, "function");
  for (const [source, digits, exponent, negative] of [
    ["001.2300e+4", "123", 2, false],
    ["-.0001200", "12", -5, true],
    ["-0e9000", "0", 0, true],
    ["9007199254740993", "9007199254740993", 0, false],
    ["1e-900000", "1", -900000, false],
  ] as const)
    assert.deepEqual(decimal.decimalFromString(source), {
      kind: "finite",
      negative,
      digits,
      exponent,
    });
  for (const invalid of [
    "",
    " ",
    " 1",
    "1 ",
    "0x10",
    "1_0",
    "1n",
    "1e",
    "+",
    ".",
    "1e9007199254740992",
  ])
    assert.equal(decimal.decimalFromString(invalid), undefined, invalid);
});

test("number input uses shortest decimal spelling instead of binary expansion", () => {
  assert.equal(typeof decimal.decimalFromNumber, "function");
  const value = decimal.decimalFromNumber(1.005);
  assert.deepEqual(value, {
    kind: "finite",
    negative: false,
    digits: "1005",
    exponent: -3,
  });
  assert.equal(decimal.decimalFromNumber(-0).negative, true);
  assert.equal(decimal.decimalFromNumber(Infinity).kind, "infinity");
  assert.equal(decimal.decimalFromNumber(NaN).kind, "nan");
  assert.equal(
    decimal.decimalToString(decimal.roundDecimal(value, -2, 1, "halfExpand")!),
    "1.01",
  );
});

test("decimal rounding uses signed modes, exact ties and increment-multiple parity", () => {
  assert.equal(typeof decimal.roundDecimal, "function");
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
  const positive = [
    "2.5",
    "2.25",
    "2.5",
    "2.25",
    "2.5",
    "2.25",
    "2.5",
    "2.25",
    "2.5",
  ];
  const negative = [
    "-2.25",
    "-2.5",
    "-2.5",
    "-2.25",
    "-2.25",
    "-2.5",
    "-2.5",
    "-2.25",
    "-2.5",
  ];
  for (let i = 0; i < modes.length; i++)
    for (const sign of [false, true]) {
      const value = decimal.decimalFromString(sign ? "-2.375" : "2.375")!;
      assert.equal(
        decimal.decimalToString(
          decimal.roundDecimal(value, -2, 25, modes[i]!)!,
        ),
        (sign ? negative : positive)[i],
      );
    }
  for (const [input, expected] of [
    ["2.25", "2"],
    ["2.75", "3"],
    ["3.25", "3"],
    ["-2.25", "-2"],
  ]) {
    assert.equal(
      decimal.decimalToString(
        decimal.roundDecimal(
          decimal.decimalFromString(input!)!,
          -1,
          5,
          "halfEven",
        )!,
      ),
      expected,
    );
  }
  assert.equal(
    decimal.decimalToString(
      decimal.roundDecimal(
        decimal.decimalFromString("999.95")!,
        -1,
        1,
        "halfExpand",
      )!,
    ),
    "1000",
  );
  assert.equal(
    decimal.decimalToString(
      decimal.roundDecimal(
        decimal.decimalFromString("-0.001")!,
        -2,
        1,
        "trunc",
      )!,
    ),
    "-0",
  );
});

test("sparse exponents round without expanding the discarded zeroes", () => {
  const tiny = decimal.decimalFromString("-1e-900000")!;
  assert.equal(
    decimal.decimalToString(decimal.roundDecimal(tiny, -2, 25, "floor")!),
    "-0.25",
  );
  assert.equal(
    decimal.decimalToString(decimal.roundDecimal(tiny, -2, 25, "halfExpand")!),
    "-0",
  );
  const huge = decimal.decimalFromString("1e900000")!;
  assert.deepEqual(decimal.roundDecimal(huge, 0, 25, "halfEven"), huge);
  assert.equal(decimal.roundDecimal(huge, 0, 0, "halfEven"), undefined);
  assert.equal(decimal.roundDecimal(huge, 0, 1.5, "halfEven"), undefined);
});

test("all rounding increments and modes agree with an independent integer oracle", () => {
  const increments = [
    1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000,
  ];
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
  let state = 0xface;
  for (let sample = 0; sample < 64; sample++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const coefficient = BigInt(state),
      exponent = (sample % 17) - 8,
      quantum = (sample % 13) - 6,
      negative = sample % 2 !== 0;
    const input = decimal.decimalFromString(
      (negative ? "-" : "") + coefficient + "e" + exponent,
    )!;
    for (const increment of increments)
      for (const mode of modes) {
        const delta = exponent - quantum;
        const numerator = coefficient * 10n ** BigInt(Math.max(delta, 0));
        const denominator =
          BigInt(increment) * 10n ** BigInt(Math.max(-delta, 0));
        const lower = numerator / denominator,
          remainder = numerator % denominator;
        let multiple = lower;
        if (remainder !== 0n) {
          if (
            mode === "expand" ||
            (mode === "ceil" && !negative) ||
            (mode === "floor" && negative)
          )
            multiple++;
          else if (mode.startsWith("half")) {
            if (remainder * 2n > denominator) multiple++;
            else if (
              remainder * 2n === denominator &&
              (mode === "halfExpand" ||
                (mode === "halfCeil" && !negative) ||
                (mode === "halfFloor" && negative) ||
                (mode === "halfEven" && lower % 2n === 1n))
            )
              multiple++;
          }
        }
        const expected = decimal.decimalFromString(
          (negative ? "-" : "") + multiple * BigInt(increment) + "e" + quantum,
        )!;
        assert.deepEqual(
          decimal.roundDecimal(input, quantum, increment, mode),
          expected,
          `${sample}/${increment}/${mode}`,
        );
      }
  }
});

test("unsafe canonical magnitude exponents are rejected", () => {
  assert.equal(decimal.decimalFromString("99e9007199254740991"), undefined);
});

test("safe exponent boundary digits do not round during lexical accumulation", () => {
  assert.deepEqual(decimal.decimalFromString("1e9007199254740991"), {
    kind: "finite",
    negative: false,
    digits: "1",
    exponent: 9007199254740991,
  });
  assert.equal(
    decimal.decimalFromString("1e9007199254740990")?.exponent,
    9007199254740990,
  );
});
