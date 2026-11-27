import {
  parseInteger,
  parseIntegerSlice,
  formatInteger,
  add,
  subtract,
  multiply,
  divideQuotient,
  divideRemainder,
  negate,
  bitwise,
  bitwiseNot,
  shiftSigned,
  power,
  compare,
  compareNumber,
  type Integer,
} from "@tint/foundation/numeric/big-integer";

/** A Script primitive value, distinct from ordinary objects and boxed BigInts.
 * Stores the canonical base-2^26 Integer fields flat in a single heap record. */
export interface BigIntValue {
  readonly bigintBrand: "bigint";
  readonly negative: boolean;
  readonly len: number;
  readonly d0: number;
  readonly d1: number;
  readonly d2: number;
  readonly d3: number;
  readonly digits: readonly number[] | undefined;
}
export interface BigIntOperationResult {
  readonly error: "none" | "type" | "range" | "unsupported";
  readonly value: BigIntValue | undefined;
}
export function createBigIntValue(integer: Integer): BigIntValue {
  return {
    bigintBrand: "bigint",
    negative: integer.negative,
    len: integer.len,
    d0: integer.d0,
    d1: integer.d1,
    d2: integer.d2,
    d3: integer.d3,
    digits: integer.digits,
  };
}
export function bigIntInteger(value: BigIntValue): Integer {
  return {
    negative: value.negative,
    len: value.len,
    d0: value.d0,
    d1: value.d1,
    d2: value.d2,
    d3: value.d3,
    digits: value.digits,
  };
}
/** Native-only checked view, authorized explicitly by the embedding build. */
export function viewBigIntValue(value: unknown): BigIntValue | undefined {
  throw "UNBOUND_BIGINT_VIEW";
}
function isAsciiWhitespace(code: number): boolean {
  return (
    code === 32 ||
    code === 9 ||
    code === 10 ||
    code === 13 ||
    code === 11 ||
    code === 12
  );
}
/** StringIntegerLiteral grammar. Unlike source literals, separators and suffixes
 * are forbidden, decimal leading zeros are allowed, and empty text denotes zero. */
export function bigIntFromString(input: string): BigIntValue | undefined {
  let text = input;
  let start = 0;
  let end = text.length;
  while (start < end && isAsciiWhitespace(text.charCodeAt(start))) start++;
  while (end > start && isAsciiWhitespace(text.charCodeAt(end - 1))) end--;
  if (
    start < end &&
    (text.charCodeAt(start) > 127 || text.charCodeAt(end - 1) > 127)
  ) {
    text = text.trim();
    start = 0;
    end = text.length;
  }
  const length = end - start;
  if (length === 0)
    return {
      bigintBrand: "bigint",
      negative: false,
      len: 0,
      d0: 0,
      d1: 0,
      d2: 0,
      d3: 0,
      digits: undefined,
    };
  let radix = 10;
  if (length >= 2 && text.charCodeAt(start) === 48) {
    const prefix = text.charCodeAt(start + 1);
    if (prefix === 120 || prefix === 88) radix = 16;
    else if (prefix === 98 || prefix === 66) radix = 2;
    else if (prefix === 111 || prefix === 79) radix = 8;
    if (radix !== 10) {
      start += 2;
      if (start >= end) return undefined;
      const first = text.charCodeAt(start);
      if (first === 43 || first === 45) return undefined;
    }
  }
  const value = parseIntegerSlice(text, start, end, radix);
  if (value === undefined) return undefined;
  return {
    bigintBrand: "bigint",
    negative: value.negative,
    len: value.len,
    d0: value.d0,
    d1: value.d1,
    d2: value.d2,
    d3: value.d3,
    digits: value.digits,
  };
}
export function bigIntToString(
  value: BigIntValue,
  radix: number,
): string | undefined {
  return formatInteger(bigIntInteger(value), radix);
}
export function bigIntToBoolean(value: BigIntValue): boolean {
  return value.len !== 0;
}
/** The parser supplies a validated, canonical decimal literal. */
export function createBigIntLiteral(text: string): BigIntValue {
  const integer = parseInteger(text, 10);
  if (integer === undefined) throw "BIGINT_LITERAL_INVARIANT";
  return createBigIntValue(integer);
}
export function compareBigIntValues(
  left: BigIntValue,
  right: BigIntValue,
): number {
  return compare(bigIntInteger(left), bigIntInteger(right));
}
/** Mixed numeric comparisons must not round the BigInt through binary64. */
export function compareBigIntNumber(
  left: BigIntValue,
  right: number,
): number | undefined {
  return compareNumber(bigIntInteger(left), right);
}
/** Invalid StringIntegerLiteral text is unordered, rather than a numeric NaN cast. */
export function compareBigIntString(
  left: BigIntValue,
  right: string,
): number | undefined {
  const parsed = bigIntFromString(right);
  return parsed === undefined ? undefined : compareBigIntValues(left, parsed);
}
function finish(
  value: Integer | undefined,
  maxDigits: number,
): BigIntOperationResult {
  if (value === undefined || value.len > maxDigits)
    return { error: "range", value: undefined };
  return { error: "none", value: createBigIntValue(value) };
}
function validCapacity(maxDigits: number): boolean {
  return (
    maxDigits >= 0 &&
    maxDigits <= 0xffffffff &&
    Math.floor(maxDigits) === maxDigits
  );
}
/** Both operands have already undergone ToNumeric. Mixed Number/BigInt rejection
 * and observable operand-conversion order belong to the outer operator adapter. */
export function bigIntBinaryOperation(
  operator: string,
  left: BigIntValue,
  right: BigIntValue,
  maxDigits: number,
): BigIntOperationResult {
  if (!validCapacity(maxDigits)) return { error: "range", value: undefined };
  const a = bigIntInteger(left),
    b = bigIntInteger(right);
  if (operator === "+") return finish(add(a, b), maxDigits);
  if (operator === "-") return finish(subtract(a, b), maxDigits);
  if (operator === "*") {
    if (a.len !== 0 && b.len !== 0 && a.len + b.len - 1 > maxDigits)
      return { error: "range", value: undefined };
    return finish(multiply(a, b), maxDigits);
  }
  if (operator === "/") return finish(divideQuotient(a, b), maxDigits);
  if (operator === "%") return finish(divideRemainder(a, b), maxDigits);
  if (operator === "&") return finish(bitwise(a, b, "&"), maxDigits);
  if (operator === "|") return finish(bitwise(a, b, "|"), maxDigits);
  if (operator === "^") return finish(bitwise(a, b, "^"), maxDigits);
  if (operator === "<<" || operator === ">>")
    return finish(shiftSigned(a, b, operator === ">>", maxDigits), maxDigits);
  if (operator === "**") return finish(power(a, b, maxDigits), maxDigits);
  if (operator === ">>>") return { error: "type", value: undefined };
  return { error: "unsupported", value: undefined };
}
export function bigIntUnaryOperation(
  operator: string,
  value: BigIntValue,
  maxDigits: number,
): BigIntOperationResult {
  if (operator === "+") return { error: "type", value: undefined };
  if (!validCapacity(maxDigits)) return { error: "range", value: undefined };
  if (operator === "-") return finish(negate(bigIntInteger(value)), maxDigits);
  if (operator === "~")
    return finish(bitwiseNot(bigIntInteger(value)), maxDigits);
  return { error: "unsupported", value: undefined };
}
