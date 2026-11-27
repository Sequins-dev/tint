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
import { createBigIntValue, type BigIntValue } from "@tint/js-runtime/bigints";

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
  if (b.integer.negative) throw new RangeError("Exponent must be non-negative");
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
/** Write the low 64 bits of `value` in little-endian two's-complement form
 * (matching both ToBigInt64 and ToBigUint64) into `scratch[offset..offset+1]`. */
export function bigIntToWord64(
  value: BigIntValue,
  scratch: Uint32Array,
  offset: number,
): void {
  const integer = value.integer,
    digits = integer.digits;
  const d0 = digits[0] ?? 0,
    d1 = digits[1] ?? 0,
    d2 = digits[2] ?? 0;
  let lo = (d0 | ((d1 & 63) << 26)) >>> 0;
  let hi = ((d1 >>> 6) | ((d2 & 4095) << 20)) >>> 0;
  if (integer.negative && (lo !== 0 || hi !== 0)) {
    if (lo === 0) hi = -hi >>> 0;
    else {
      lo = -lo >>> 0;
      hi = ~hi >>> 0;
    }
  }
  scratch[offset] = lo;
  scratch[offset + 1] = hi;
}
/** Construct a BigIntValue directly from little-endian 64-bit halves in
 * `scratch[0..1]`, interpreted as signed (`BigInt64Array`) or unsigned
 * (`BigUint64Array`). */
export function bigIntFromWord64(
  scratch: Uint32Array,
  signed: boolean,
): BigIntValue {
  let lo = scratch[0] ?? 0,
    hi = scratch[1] ?? 0;
  if (lo === 0 && hi === 0)
    return createBigIntValue({ negative: false, digits: [] });
  let negative = false;
  if (signed && (hi & 0x80000000) !== 0) {
    negative = true;
    if (lo === 0) hi = -hi >>> 0;
    else {
      lo = -lo >>> 0;
      hi = ~hi >>> 0;
    }
  }
  const d0 = lo & 67108863;
  const d1 = (lo >>> 26) | ((hi & 1048575) << 6);
  const d2 = hi >>> 20;
  const digits: number[] = d2 !== 0 ? [d0, d1, d2] : d1 !== 0 ? [d0, d1] : [d0];
  return createBigIntValue({ negative, digits });
}
/** Stable value-based 32-bit FNV-1a hash of a BigIntValue (zero allocations;
 * equal BigInts across distinct heap allocations produce identical hashes). */
export function hashBigInt(value: BigIntValue): number {
  const integer = value.integer,
    digits = integer.digits;
  let hash = integer.negative && digits.length !== 0 ? 0x811c9dc5 : 0x9e3779b1;
  for (let i = 0; i < digits.length; i++)
    hash = Math.imul(hash ^ (digits[i] ?? 0), 0x01000193) >>> 0;
  return hash;
}
