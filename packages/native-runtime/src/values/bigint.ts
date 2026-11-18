/** Typed BigInt operations (docs/unified-pipeline.md, slice 4a).
 *
 * Typed code represents a `bigint` as a reference to js-runtime's
 * `BigIntValue` record, the same value general code creates, so a typed
 * BigInt crosses to `unknown` (and back, through a checked downcast) without
 * conversion. The compiler lowers BigInt syntax in typed code to these
 * functions; their RangeError messages follow V8. */
import {
  add,
  bitwise,
  bitwiseNot,
  compare,
  compareNumber,
  divide,
  formatInteger,
  fromNumber as integerFromNumber,
  multiply,
  negate,
  parseInteger,
  power,
  shift,
  subtract,
  toNumber as integerToNumber,
  truncateInteger,
  type Integer,
} from "@tint/foundation/numeric/big-integer";
import {
  createBigIntValue,
  type BigIntValue,
} from "@tint/js-runtime/bigints";

/** Digits are base 2^26; a value is limited to 2^30 bits, V8's limit. */
const maxDigits = 41297762;

function finish(value: Integer | undefined): BigIntValue {
  if (value === undefined || value.digits.length > maxDigits)
    throw new RangeError("Maximum BigInt size exceeded");
  return createBigIntValue(value);
}
/** A source literal: the parser supplies validated canonical decimal text. */
export function literal(text: string): BigIntValue {
  const integer = parseInteger(text, 10);
  if (integer === undefined) throw "BIGINT_LITERAL_INVARIANT";
  return createBigIntValue(integer);
}
export function addBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  return finish(add(a.integer, b.integer));
}
export function subtractBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  return finish(subtract(a.integer, b.integer));
}
export function multiplyBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  const x = a.integer.digits.length,
    y = b.integer.digits.length;
  if (x !== 0 && y !== 0 && x + y - 1 > maxDigits)
    throw new RangeError("Maximum BigInt size exceeded");
  return finish(multiply(a.integer, b.integer));
}
function division(
  a: BigIntValue,
  b: BigIntValue,
  quotient: boolean,
): BigIntValue {
  const result = divide(a.integer, b.integer);
  if (result === undefined) throw new RangeError("Division by zero");
  return finish(quotient ? result.quotient : result.remainder);
}
export function divideBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  return division(a, b, true);
}
export function remainderBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  return division(a, b, false);
}
export function exponentiateBigInt(
  a: BigIntValue,
  b: BigIntValue,
): BigIntValue {
  if (b.integer.negative)
    throw new RangeError("Exponent must be non-negative");
  return finish(power(a.integer, b.integer, maxDigits));
}
export function andBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  return finish(bitwise(a.integer, b.integer, "&"));
}
export function orBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  return finish(bitwise(a.integer, b.integer, "|"));
}
export function xorBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  return finish(bitwise(a.integer, b.integer, "^"));
}
export function leftShiftBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  return finish(shift(a.integer, b.integer, maxDigits));
}
export function rightShiftBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  return finish(shift(a.integer, negate(b.integer), maxDigits));
}
export function negateBigInt(value: BigIntValue): BigIntValue {
  return createBigIntValue(negate(value.integer));
}
export function notBigInt(value: BigIntValue): BigIntValue {
  return finish(bitwiseNot(value.integer));
}
/** -1, 0 or 1. */
export function compareBigInt(a: BigIntValue, b: BigIntValue): number {
  return compare(a.integer, b.integer);
}
/** -1, 0 or 1 exactly (no rounding through binary64); NaN for a NaN number,
 * which every relational operator treats as unordered. */
export function compareBigIntNumber(a: BigIntValue, b: number): number {
  const order = compareNumber(a.integer, b);
  return order === undefined ? NaN : order;
}
export function equalBigInt(a: BigIntValue, b: BigIntValue): boolean {
  return compare(a.integer, b.integer) === 0;
}
export function truthyBigInt(value: BigIntValue): boolean {
  return value.integer.digits.length !== 0;
}
export function bigIntToString(value: BigIntValue): string {
  const text = formatInteger(value.integer, 10);
  if (text === undefined) throw "BIGINT_FORMAT_INVARIANT";
  return text;
}
/** Number(bigint): the nearest binary64, ties to even. */
export function bigIntToNumber(value: BigIntValue): number {
  return integerToNumber(value.integer);
}
/** BigInt(number): exact for integral values, else a RangeError. */
export function bigIntFromNumber(value: number): BigIntValue {
  const integer = integerFromNumber(value);
  if (integer === undefined)
    throw new RangeError(
      "The number " +
        String(value) +
        " cannot be converted to a BigInt because it is not an integer",
    );
  return createBigIntValue(integer);
}
export function bigIntFromBoolean(value: boolean): BigIntValue {
  return createBigIntValue(
    value ? { negative: false, digits: [1] } : { negative: false, digits: [] },
  );
}
/** BigInt.asUintN / BigInt.asIntN: ToIndex on the width, then wrap. */
export function bigIntAsWidth(
  bits: number,
  value: BigIntValue,
  signed: boolean,
): BigIntValue {
  const index = bits !== bits ? 0 : Math.trunc(bits);
  if (!(index >= 0 && index <= 9007199254740991))
    throw new RangeError("Invalid value: not (convertible to) a safe integer");
  const result = truncateInteger(value.integer, index, signed, maxDigits);
  if (result === undefined)
    throw new RangeError("Maximum BigInt size exceeded");
  return createBigIntValue(result);
}
