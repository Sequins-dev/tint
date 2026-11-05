import { test } from "node:test";
import assert from "node:assert/strict";
import * as values from "../src/objects/bigints.ts";
function value(text: string) {
  const result = values.bigIntFromString(text);
  assert.ok(result);
  return result;
}
function text(value: values.BigIntValue) {
  return values.bigIntToString(value, 10);
}
test("StringToBigInt accepts ECMAScript whitespace and unsigned radix prefixes", () => {
  for (const spelling of [
    "",
    " \t\r\n",
    "\uFEFF\u2028123\u2029",
    "+00123",
    "-00123",
    "0xabcdef",
    "0XFF",
    "0b1010",
    "0B1010",
    "0o777",
    "0O777",
  ])
    assert.equal(text(value(spelling)), String(BigInt(spelling)));
  for (const spelling of [
    "+0x1",
    "-0x1",
    "0x+1",
    "0x-1",
    "1n",
    "1_0",
    "1.0",
    "1e2",
    "Infinity",
    "NaN",
    "+",
    "0x",
    "0b2",
    "1 2",
  ]) {
    assert.throws(() => BigInt(spelling), SyntaxError);
    assert.equal(values.bigIntFromString(spelling), undefined, spelling);
  }
});
test("BigInt operator dispatch preserves integer semantics and reports language errors", () => {
  const a = value("-12345678901234567890"),
    b = value("123456789");
  const operations: [string, bigint][] = [
    ["+", -12345678901234567890n + 123456789n],
    ["-", -12345678901234567890n - 123456789n],
    ["*", -12345678901234567890n * 123456789n],
    ["/", -12345678901234567890n / 123456789n],
    ["%", -12345678901234567890n % 123456789n],
    ["&", -12345678901234567890n & 123456789n],
    ["|", -12345678901234567890n | 123456789n],
    ["^", -12345678901234567890n ^ 123456789n],
  ];
  for (const [op, expected] of operations) {
    const result = values.bigIntBinaryOperation(op, a, b, 64);
    assert.equal(result.error, "none");
    assert.ok(result.value);
    assert.equal(text(result.value), String(expected));
  }
  for (const op of ["/", "%"]) {
    assert.equal(
      values.bigIntBinaryOperation(op, a, value("0"), 64).error,
      "range",
    );
  }
  assert.equal(
    values.bigIntBinaryOperation("**", b, value("-1"), 64).error,
    "range",
  );
  assert.equal(values.bigIntBinaryOperation(">>>", a, b, 64).error, "type");
  assert.equal(
    values.bigIntBinaryOperation("<<", value("1"), value("26"), 1).error,
    "range",
  );
  for (const [op, expected] of [
    ["<<", -12n],
    [">>", -1n],
    ["**", 9n],
  ] as const) {
    const r = values.bigIntBinaryOperation(op, value("-3"), value("2"), 8);
    assert.ok(r.value);
    assert.equal(text(r.value), String(expected));
  }
});
test("BigInt unary plus rejects and unary minus/complement preserve exact results", () => {
  const a = value("9007199254740993");
  assert.equal(values.bigIntUnaryOperation("+", a, 64).error, "type");
  for (const [op, expected] of [
    ["-", "-9007199254740993"],
    ["~", "-9007199254740994"],
  ]) {
    const r = values.bigIntUnaryOperation(op!, a, 64);
    assert.ok(r.value);
    assert.equal(text(r.value), expected);
  }
});
test("BigInt comparisons preserve precision, unordered values and string grammar", () => {
  const a = value("9007199254740993");
  assert.equal(values.compareBigIntValues(a, value("9007199254740993")), 0);
  assert.equal(values.compareBigIntValues(a, value("9007199254740994")), -1);
  for (const n of [
    0,
    -0,
    0.5,
    -0.5,
    9007199254740992,
    Infinity,
    -Infinity,
    NaN,
  ]) {
    const expected = Number.isNaN(n)
      ? undefined
      : 9007199254740993n < n
        ? -1
        : 9007199254740993n > n
          ? 1
          : 0;
    assert.equal(values.compareBigIntNumber(a, n), expected);
  }
  assert.equal(values.compareBigIntString(a, "9007199254740993"), 0);
  assert.equal(values.compareBigIntString(a, "9007199254740993.0"), undefined);
  assert.equal(values.compareBigIntString(value("0"), " \t"), 0);
  assert.equal(values.compareBigIntString(value("16"), "0x10"), 0);
  assert.equal(values.compareBigIntString(value("-1"), "-0x1"), undefined);
});
test("BigInt boolean conversion treats only zero as false", () => {
  for (const spelling of ["0", "-0", "+000", "", "0x0"])
    assert.equal(values.bigIntToBoolean(value(spelling)), false);
  for (const spelling of ["1", "-1", "9007199254740993"])
    assert.equal(values.bigIntToBoolean(value(spelling)), true);
});
