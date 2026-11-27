import {
  parseInteger,
  formatInteger,
  add,
  subtract,
  multiply,
  divide,
  negate,
  bitwise,
  bitwiseNot,
  shift,
  power,
  compare,
  compareNumber,
  type Integer,
} from "@tint/foundation/numeric/big-integer";

/** A Script primitive value, distinct from ordinary objects and boxed BigInts. */
export interface BigIntValue {
  readonly bigintBrand: "bigint";
  readonly integer: Integer;
}
export interface BigIntOperationResult {
  readonly error: "none" | "type" | "range" | "unsupported";
  readonly value: BigIntValue | undefined;
}
export function createBigIntValue(integer: Integer): BigIntValue {
  return { bigintBrand: "bigint", integer };
}
/** Native-only checked view, authorized explicitly by the embedding build. */
export function viewBigIntValue(value: unknown): BigIntValue | undefined {
  throw "UNBOUND_BIGINT_VIEW";
}
/** StringIntegerLiteral grammar. Unlike source literals, separators and suffixes
 * are forbidden, decimal leading zeros are allowed, and empty text denotes zero. */
export function bigIntFromString(input: string): BigIntValue | undefined {
  const text = input.trim();
  const length = text.length;
  if (length === 0) return createBigIntValue({ negative: false, digits: [] });
  let radix = 10;
  let digits = text;
  if (length >= 2 && text.charCodeAt(0) === 48) {
    const prefix = text.charCodeAt(1);
    if (prefix === 120 || prefix === 88) radix = 16;
    else if (prefix === 98 || prefix === 66) radix = 2;
    else if (prefix === 111 || prefix === 79) radix = 8;
    if (radix !== 10) {
      digits = text.slice(2);
      const first = digits.charCodeAt(0);
      if (first === 43 || first === 45) return undefined;
    }
  }
  const value = parseInteger(digits, radix);
  return value === undefined ? undefined : createBigIntValue(value);
}
export function bigIntToString(
  value: BigIntValue,
  radix: number,
): string | undefined {
  return formatInteger(value.integer, radix);
}
export function bigIntToBoolean(value: BigIntValue): boolean {
  return value.integer.digits.length !== 0;
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
  return compare(left.integer, right.integer);
}
/** Mixed numeric comparisons must not round the BigInt through binary64. */
export function compareBigIntNumber(
  left: BigIntValue,
  right: number,
): number | undefined {
  return compareNumber(left.integer, right);
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
  if (value === undefined || value.digits.length > maxDigits)
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
  const a = left.integer,
    b = right.integer;
  if (operator === "+") return finish(add(a, b), maxDigits);
  if (operator === "-") return finish(subtract(a, b), maxDigits);
  if (operator === "*") {
    if (
      a.digits.length !== 0 &&
      b.digits.length !== 0 &&
      a.digits.length + b.digits.length - 1 > maxDigits
    )
      return { error: "range", value: undefined };
    return finish(multiply(a, b), maxDigits);
  }
  if (operator === "/" || operator === "%") {
    const result = divide(a, b);
    return finish(
      result === undefined
        ? undefined
        : operator === "/"
          ? result.quotient
          : result.remainder,
      maxDigits,
    );
  }
  if (operator === "&") return finish(bitwise(a, b, "&"), maxDigits);
  if (operator === "|") return finish(bitwise(a, b, "|"), maxDigits);
  if (operator === "^") return finish(bitwise(a, b, "^"), maxDigits);
  if (operator === "<<" || operator === ">>")
    return finish(
      shift(a, operator === "<<" ? b : negate(b), maxDigits),
      maxDigits,
    );
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
  if (operator === "-") return finish(negate(value.integer), maxDigits);
  if (operator === "~") return finish(bitwiseNot(value.integer), maxDigits);
  return { error: "unsupported", value: undefined };
}
