import { parseRoundingMode, type RoundingMode } from "../integer-rounding.ts";

/** Exact decimal magnitude. Finite coefficients have no leading/trailing zeroes;
 * zero has digits="0", exponent=0. Its sign is retained independently. */
export interface DecimalQuantity {
  readonly kind: "finite" | "infinity" | "nan";
  readonly negative: boolean;
  readonly digits: string;
  readonly exponent: number;
}
function finite(
  negative: boolean,
  digits: string,
  exponent: number,
): DecimalQuantity {
  let first = 0,
    end = digits.length;
  while (first < end && digits.charCodeAt(first) === 48) first++;
  if (first === end)
    return { kind: "finite", negative, digits: "0", exponent: 0 };
  while (end > first && digits.charCodeAt(end - 1) === 48) {
    end--;
    exponent++;
  }
  return {
    kind: "finite",
    negative,
    digits: digits.slice(first, end),
    exponent,
  };
}
/** Decimal lexical input only: callers own whitespace, radix prefixes, coercion
 * and Intl's overflow/underflow policy. Unsafe exponent arithmetic is rejected. */
export function decimalFromString(text: string): DecimalQuantity | undefined {
  let index = 0,
    negative = false;
  if (text.charAt(index) === "-" || text.charAt(index) === "+") {
    negative = text.charAt(index) === "-";
    index++;
  }
  const start = index;
  let digits = "",
    fraction = 0,
    point = false;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code >= 48 && code <= 57) {
      digits += text.charAt(index);
      if (point) fraction++;
      index++;
    } else if (code === 46 && !point) {
      point = true;
      index++;
    } else break;
  }
  if (index === start || digits.length === 0) return undefined;
  let exponent = 0;
  if (text.charAt(index) === "e" || text.charAt(index) === "E") {
    index++;
    let minus = false;
    if (text.charAt(index) === "-" || text.charAt(index) === "+") {
      minus = text.charAt(index) === "-";
      index++;
    }
    const exponentStart = index;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code < 48 || code > 57) break;
      exponent = exponent * 10 + (code - 48);
      if (!Number.isSafeInteger(exponent)) return undefined;
      index++;
    }
    if (index === exponentStart) return undefined;
    if (minus) exponent = -exponent;
  }
  if (index !== text.length || !Number.isSafeInteger(exponent - fraction))
    return undefined;
  const result = finite(negative, digits, exponent - fraction);
  return Number.isSafeInteger(result.exponent) &&
    Number.isSafeInteger(result.exponent + (result.digits.length - 1))
    ? result
    : undefined;
}
/** Accepted ECMA-402 rounding increments. Each divides 10^4, so an already
 * integral sparse magnitude never needs to expand its implicit trailing zeroes. */
function validIncrement(value: number): boolean {
  return (
    value === 1 ||
    value === 2 ||
    value === 5 ||
    value === 10 ||
    value === 20 ||
    value === 25 ||
    value === 50 ||
    value === 100 ||
    value === 200 ||
    value === 250 ||
    value === 500 ||
    value === 1000 ||
    value === 2000 ||
    value === 2500 ||
    value === 5000
  );
}
function incrementDigits(digits: string): string {
  let end = digits.length;
  while (end > 0 && digits.charCodeAt(end - 1) === 57) end--;
  let result =
    end === 0
      ? "1"
      : digits.slice(0, end - 1) +
        String.fromCharCode(digits.charCodeAt(end - 1) + 1);
  for (let i = end; i < digits.length; i++) result += "0";
  return result;
}
function multiplyDigits(digits: string, factor: number): string {
  let result = "",
    carry = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    const value = (digits.charCodeAt(i) - 48) * factor + carry;
    result = String.fromCharCode(48 + (value % 10)) + result;
    carry = Math.floor(value / 10);
  }
  while (carry > 0) {
    result = String.fromCharCode(48 + (carry % 10)) + result;
    carry = Math.floor(carry / 10);
  }
  return result;
}
/** Round to k*increment*10^quantumExponent using exact decimal remainder and
 * quotient parity. Padding/presentation precision is deliberately separate. */
export function roundDecimal(
  value: DecimalQuantity,
  quantumExponent: number,
  increment: number,
  mode: RoundingMode,
): DecimalQuantity | undefined {
  if (
    !Number.isSafeInteger(quantumExponent) ||
    !validIncrement(increment) ||
    parseRoundingMode(mode) === undefined
  )
    return undefined;
  if (value.kind !== "finite" || value.digits === "0") return value;
  const delta = value.exponent - quantumExponent;
  if (delta >= 4) return value;
  // Split at the requested quantum. A negative cut is an implicit leading-zero
  // fraction; handle it symbolically rather than allocating discarded zeroes.
  const cut = value.digits.length + delta;
  let integer = cut <= 0 ? "0" : value.digits.slice(0, cut);
  for (let i = value.digits.length; i < cut; i++) integer += "0";
  let quotient = "",
    remainder = 0;
  for (let i = 0; i < integer.length; i++) {
    const dividend = remainder * 10 + integer.charCodeAt(i) - 48;
    const digit = Math.floor(dividend / increment);
    if (digit !== 0 || quotient.length !== 0)
      quotient += String.fromCharCode(48 + digit);
    remainder = dividend - digit * increment;
  }
  if (quotient.length === 0) quotient = "0";
  const fractional = cut < value.digits.length;
  const inexact = remainder !== 0 || fractional;
  if (!inexact) return value;
  const difference = increment - 2 * remainder;
  let halfway = difference < 0 ? 1 : -1;
  if (difference === 0) halfway = fractional ? 1 : 0;
  else if (difference === 1 && fractional && cut >= 0) {
    const first = value.digits.charCodeAt(cut) - 48;
    halfway =
      first < 5 ? -1 : first > 5 ? 1 : cut + 1 < value.digits.length ? 1 : 0;
  }
  const negative = value.negative;
  let away =
    mode === "ceil"
      ? !negative
      : mode === "floor"
        ? negative
        : mode === "expand";
  if (
    mode !== "ceil" &&
    mode !== "floor" &&
    mode !== "expand" &&
    mode !== "trunc"
  )
    away =
      halfway > 0 ||
      (halfway === 0 &&
        (mode === "halfCeil"
          ? !negative
          : mode === "halfFloor"
            ? negative
            : mode === "halfExpand"
              ? true
              : mode === "halfTrunc"
                ? false
                : (quotient.charCodeAt(quotient.length - 1) - 48) % 2 !== 0));
  if (away) quotient = incrementDigits(quotient);
  const result = finite(
    negative,
    multiplyDigits(quotient, increment),
    quantumExponent,
  );
  return Number.isSafeInteger(result.exponent) &&
    Number.isSafeInteger(result.exponent + (result.digits.length - 1))
    ? result
    : undefined;
}
/** Compact canonical decimal spelling; no expansion proportional to exponent. */
export function decimalToString(value: DecimalQuantity): string {
  if (value.kind === "nan") return "NaN";
  const sign = value.negative ? "-" : "";
  if (value.kind === "infinity") return sign + "Infinity";
  const digits = value.digits,
    magnitude = value.exponent + (digits.length - 1),
    point = magnitude + 1;
  if (digits === "0") return sign + "0";
  if (point > 0 && point <= 21) {
    let text = digits.slice(0, point);
    if (point < digits.length) text += "." + digits.slice(point);
    else for (let i = digits.length; i < point; i++) text += "0";
    return sign + text;
  }
  if (point <= 0 && point > -6) {
    let text = "0.";
    for (let i = 0; i < -point; i++) text += "0";
    return sign + text + digits;
  }
  const exponent = magnitude;
  return (
    sign +
    digits.charAt(0) +
    (digits.length > 1 ? "." + digits.slice(1) : "") +
    "e" +
    (exponent >= 0 ? "+" : "") +
    String(exponent)
  );
}
