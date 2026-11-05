import assert from "node:assert/strict";
import test from "node:test";
import { decimalFromString } from "@tint/foundation/numeric/number-text";
import * as numeric from "../src/objects/intl-number-options.ts";
function reader(values: Record<string, unknown>, log: string[] = []) {
  return {
    read: (key: string): unknown => {
      log.push("get:" + key);
      return values[key];
    },
    number: (value: unknown): number => {
      log.push("number:" + String(value));
      return Number(value);
    },
    string: (value: unknown): string => {
      log.push("string:" + String(value));
      return String(value);
    },
    reject: (kind: "range" | "type"): never => {
      if (kind === "range") throw new RangeError();
      throw new TypeError();
    },
  };
}
function options(
  values: Record<string, unknown> = {},
  notation: numeric.NumberNotation = "standard",
) {
  return numeric.resolveNumberFormatDigitOptions(
    reader(values),
    0,
    3,
    notation,
  );
}
function formatted(
  source: string,
  values: Record<string, unknown> = {},
  notation: numeric.NumberNotation = "standard",
) {
  const quantity = decimalFromString(source);
  assert.ok(quantity);
  const result = numeric.formatIntlDecimal(quantity, options(values, notation));
  assert.ok(result);
  return result;
}
test("digit options apply ordinary and compact defaults without conflating absence", () => {
  assert.equal(typeof numeric.resolveNumberFormatDigitOptions, "function");
  const normal = options();
  assert.equal(normal.roundingType, "fraction-digits");
  assert.equal(normal.minimumFractionDigits, 0);
  assert.equal(normal.maximumFractionDigits, 3);
  assert.equal(normal.minimumSignificantDigits, undefined);
  const compact = options({}, "compact");
  assert.equal(compact.roundingType, "more-precision");
  assert.equal(compact.roundingPriority, "morePrecision");
  assert.equal(compact.minimumFractionDigits, 0);
  assert.equal(compact.maximumFractionDigits, 0);
  assert.equal(compact.minimumSignificantDigits, 1);
  assert.equal(compact.maximumSignificantDigits, 2);
  assert.equal(
    options({ maximumFractionDigits: 2 }, "compact").roundingType,
    "fraction-digits",
  );
  assert.equal(
    options({ maximumSignificantDigits: 3 }).maximumFractionDigits,
    undefined,
  );
});
test("raw getters precede deferred numeric coercions in specification order", () => {
  const log: string[] = [];
  numeric.resolveNumberFormatDigitOptions(
    reader(
      {
        minimumIntegerDigits: 2,
        minimumFractionDigits: 1,
        maximumFractionDigits: 2,
        minimumSignificantDigits: 3,
        maximumSignificantDigits: 4,
        roundingIncrement: 1,
        roundingMode: "halfEven",
        roundingPriority: "morePrecision",
        trailingZeroDisplay: "auto",
      },
      log,
    ),
    0,
    3,
    "standard",
  );
  assert.deepEqual(log, [
    "get:minimumIntegerDigits",
    "number:2",
    "get:minimumFractionDigits",
    "get:maximumFractionDigits",
    "get:minimumSignificantDigits",
    "get:maximumSignificantDigits",
    "get:roundingIncrement",
    "number:1",
    "get:roundingMode",
    "string:halfEven",
    "get:roundingPriority",
    "string:morePrecision",
    "get:trailingZeroDisplay",
    "string:auto",
    "number:3",
    "number:4",
    "number:1",
    "number:2",
  ]);
});
test("unused digit families are read but never numerically coerced", () => {
  const sentinel = {
    valueOf() {
      throw 1;
    },
  };
  const settings = options({
    minimumFractionDigits: sentinel,
    maximumFractionDigits: sentinel,
    maximumSignificantDigits: 3,
  });
  assert.equal(settings.maximumSignificantDigits, 3);
  const log: string[] = [];
  const access = reader({ roundingIncrement: 3 }, log);
  assert.throws(
    () => numeric.resolveNumberFormatDigitOptions(access, 0, 3, "standard"),
    RangeError,
  );
  assert.equal(log.at(-1), "number:3");
});
test("abrupt getter and conversion completion stops subsequent observation", () => {
  const sentinel = {};
  const log: string[] = [];
  const access = reader({}, log);
  access.read = (key) => {
    log.push(key);
    if (key === "maximumFractionDigits") throw sentinel;
    return undefined;
  };
  assert.throws(
    () => numeric.resolveNumberFormatDigitOptions(access, 0, 3, "standard"),
    (e) => e === sentinel,
  );
  assert.deepEqual(log, [
    "minimumIntegerDigits",
    "minimumFractionDigits",
    "maximumFractionDigits",
  ]);
  const conversion = reader({ minimumIntegerDigits: 1 });
  conversion.number = () => {
    throw sentinel;
  };
  assert.throws(
    () => numeric.resolveNumberFormatDigitOptions(conversion, 0, 3, "standard"),
    (e) => e === sentinel,
  );
});
test("digit bounds check before flooring and respect dependency defaults", () => {
  assert.equal(options({ minimumIntegerDigits: 2.9 }).minimumIntegerDigits, 2);
  assert.equal(options({ roundingIncrement: 2.9 }).roundingIncrement, 2);
  assert.equal(options({ minimumFractionDigits: 5 }).maximumFractionDigits, 5);
  assert.equal(options({ maximumFractionDigits: 1 }).minimumFractionDigits, 0);
  const currency = numeric.resolveNumberFormatDigitOptions(
    reader({ maximumFractionDigits: 1 }),
    2,
    2,
    "standard",
  );
  assert.equal(currency.minimumFractionDigits, 1);
  for (const value of [0.9, 22, NaN, Infinity, -Infinity])
    assert.throws(() => options({ minimumIntegerDigits: value }), RangeError);
  for (const values of [
    { minimumFractionDigits: 3, maximumFractionDigits: 2 },
    { minimumSignificantDigits: 3, maximumSignificantDigits: 2 },
    { maximumFractionDigits: 101 },
    { maximumSignificantDigits: 22 },
  ])
    assert.throws(() => options(values), RangeError);
});
test("rounding increments require fraction-only equal precision", () => {
  for (const increment of [
    1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000,
  ])
    assert.equal(
      options({
        roundingIncrement: increment,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).roundingIncrement,
      increment,
    );
  for (const increment of [0, 3, 4, 6, 5001, NaN])
    assert.throws(() => options({ roundingIncrement: increment }), RangeError);
  assert.throws(
    () => options({ roundingIncrement: 5, maximumSignificantDigits: 2 }),
    TypeError,
  );
  assert.throws(
    () => options({ roundingIncrement: 5, roundingPriority: "morePrecision" }),
    TypeError,
  );
  assert.throws(() => options({ roundingIncrement: 5 }, "compact"), TypeError);
  assert.throws(
    () =>
      options({
        roundingIncrement: 5,
        minimumFractionDigits: 1,
        maximumFractionDigits: 2,
      }),
    RangeError,
  );
  assert.equal(options({ roundingIncrement: 5 }).maximumFractionDigits, 0);
});
test("string options reject invalid values after string conversion", () => {
  for (const [key, value] of [
    ["roundingMode", "bad"],
    ["roundingPriority", "bad"],
    ["trailingZeroDisplay", "bad"],
  ])
    assert.throws(() => options({ [key!]: value }), RangeError);
  assert.equal(
    options({ roundingMode: { toString: () => "halfTrunc" } }).roundingMode,
    "halfTrunc",
  );
});
test("presentation separates signed quantity, visible zeroes and integer padding", () => {
  const result = formatted("-0.001", {
    minimumIntegerDigits: 3,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  assert.equal(result.text, "000.00");
  assert.equal(result.quantity.negative, true);
  assert.equal(
    formatted("1.001", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      trailingZeroDisplay: "stripIfInteger",
    }).text,
    "1",
  );
  assert.equal(
    formatted("1.201", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      trailingZeroDisplay: "stripIfInteger",
    }).text,
    "1.20",
  );
  assert.equal(
    formatted("1", { minimumSignificantDigits: 3, minimumIntegerDigits: 3 })
      .text,
    "001.00",
  );
});
test("priority uses post-carry magnitudes and specification tie preference", () => {
  const digits = {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    minimumSignificantDigits: 3,
    maximumSignificantDigits: 3,
  };
  assert.equal(
    formatted("1", { ...digits, roundingPriority: "morePrecision" }).text,
    "1.00",
  );
  assert.equal(
    formatted("1", {
      ...digits,
      minimumSignificantDigits: 2,
      roundingPriority: "morePrecision",
    }).text,
    "1.0",
  );
  assert.equal(
    formatted("1", {
      ...digits,
      minimumSignificantDigits: 2,
      roundingPriority: "lessPrecision",
    }).text,
    "1.00",
  );
  assert.equal(
    formatted("99.99", {
      maximumFractionDigits: 0,
      maximumSignificantDigits: 3,
      roundingPriority: "morePrecision",
    }).text,
    "100",
  );
  assert.equal(
    formatted("1234.56", {
      maximumFractionDigits: 1,
      maximumSignificantDigits: 2,
      roundingPriority: "lessPrecision",
    }).text,
    "1200",
  );
  assert.equal(
    formatted("1234.56", {
      maximumFractionDigits: 1,
      maximumSignificantDigits: 2,
      roundingPriority: "morePrecision",
    }).text,
    "1234.6",
  );
});

test("resolved digit settings and finite standard presentation match shared Intl behavior", () => {
  const cases: Intl.NumberFormatOptions[] = [
    {},
    { minimumFractionDigits: 2 },
    { maximumFractionDigits: 0, roundingMode: "floor" },
    { minimumSignificantDigits: 3, maximumSignificantDigits: 4 },
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      roundingIncrement: 25,
      roundingMode: "halfEven",
    },
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
      minimumSignificantDigits: 2,
      maximumSignificantDigits: 3,
      roundingPriority: "morePrecision",
    },
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
      minimumSignificantDigits: 2,
      maximumSignificantDigits: 3,
      roundingPriority: "lessPrecision",
    },
    {
      minimumIntegerDigits: 5,
      minimumFractionDigits: 2,
      trailingZeroDisplay: "stripIfInteger",
    },
  ];
  for (const values of cases) {
    const reference = new Intl.NumberFormat("en", {
      ...values,
      useGrouping: false,
      signDisplay: "never",
    });
    const settings = options(values as Record<string, unknown>);
    const resolved = reference.resolvedOptions();
    for (const key of [
      "minimumIntegerDigits",
      "minimumFractionDigits",
      "maximumFractionDigits",
      "minimumSignificantDigits",
      "maximumSignificantDigits",
      "roundingIncrement",
      "roundingMode",
      "roundingPriority",
      "trailingZeroDisplay",
    ] as const)
      assert.equal(settings[key], resolved[key], key);
    for (const source of [
      "-0",
      "-0.001",
      "-2.375",
      "1",
      "1.005",
      "9.99",
      "99.99",
      "1234.56",
      "0.00012345",
      "9007199254740993",
    ]) {
      const quantity = decimalFromString(source)!;
      assert.equal(
        numeric.formatIntlDecimal(quantity, settings)?.text,
        reference.format(source as Intl.StringNumericLiteral),
        `${source}/${JSON.stringify(values)}`,
      );
    }
  }
});
