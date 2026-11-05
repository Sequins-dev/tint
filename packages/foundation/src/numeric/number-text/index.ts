// Exact unsigned base-2^16 arithmetic, private to numeric text conversion.
interface Natural {
  limbs: Uint32Array;
  length: number;
}
function natural(capacity: number, value: number): Natural {
  const limbs = new Uint32Array(capacity);
  limbs[0] = value;
  return { limbs, length: 1 };
}
function multiplyAdd(a: Natural, factor: number, carry: number): void {
  for (let i = 0; i < a.length; i++) {
    const value = (a.limbs[i] ?? 0) * factor + carry;
    a.limbs[i] = value % 65536;
    carry = Math.floor(value / 65536);
  }
  if (carry !== 0) {
    a.limbs[a.length] = carry;
    a.length = a.length + 1;
  }
}
function bits(a: Natural): number {
  return (a.length - 1) * 16 + 32 - Math.clz32(a.limbs[a.length - 1] ?? 0);
}
function shift(a: Natural, count: number): Natural {
  const words = Math.floor(count / 16),
    remainder = count % 16;
  const result = natural(a.length + words + 1, 0);
  result.length = a.length + words;
  let factor = 1;
  for (let i = 0; i < remainder; i++) factor *= 2;
  let carry = 0;
  for (let i = 0; i < a.length; i++) {
    const value = (a.limbs[i] ?? 0) * factor + carry;
    result.limbs[i + words] = value % 65536;
    carry = Math.floor(value / 65536);
  }
  if (carry !== 0) {
    result.limbs[result.length] = carry;
    result.length = result.length + 1;
  }
  return result;
}
function compare(a: Natural, b: Natural): number {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  for (let i = a.length - 1; i >= 0; i--) {
    const x = a.limbs[i] ?? 0,
      y = b.limbs[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
function subtract(a: Natural, b: Natural): void {
  let borrow = 0;
  for (let i = 0; i < a.length; i++) {
    let value =
      (a.limbs[i] ?? 0) - (i < b.length ? (b.limbs[i] ?? 0) : 0) - borrow;
    borrow = value < 0 ? 1 : 0;
    if (borrow !== 0) value += 65536;
    a.limbs[i] = value;
  }
  while (a.length > 1 && a.limbs[a.length - 1] === 0) a.length = a.length - 1;
}
function roundedRatio(numerator: Natural, denominator: Natural): number {
  if (bits(numerator) === 0) return 0;
  let exponent = bits(numerator) - bits(denominator);
  if (exponent >= 0) {
    if (compare(numerator, shift(denominator, exponent)) < 0) exponent--;
  } else if (compare(shift(numerator, -exponent), denominator) < 0) exponent--;
  if (exponent > 1023) return 1 / 0;
  if (exponent < -1075) return 0;
  const scale = exponent < -1022 ? -1074 : exponent - 52;
  const remainder = shift(numerator, scale < 0 ? -scale : 0);
  const divisor = shift(denominator, scale > 0 ? scale : 0);
  let quotient = 0;
  for (let i = 53; i >= 0; i--) {
    quotient *= 2;
    const candidate = shift(divisor, i);
    if (compare(remainder, candidate) >= 0) {
      subtract(remainder, candidate);
      quotient++;
    }
  }
  const halfway = compare(shift(remainder, 1), divisor);
  if (halfway > 0 || (halfway === 0 && quotient % 2 !== 0)) quotient++;
  // These powers of two are exact, including the final subnormal result.
  if (scale < 0) for (let i = 0; i < -scale; i++) quotient /= 2;
  else for (let i = 0; i < scale; i++) quotient *= 2;
  return quotient;
}
function digit(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 90) return code - 55;
  if (code >= 97 && code <= 122) return code - 87;
  return -1;
}
/** StringNumericLiteral conversion; no Number(), parseFloat(), BigInt or host parser. */
export function stringToNumber(text: string): number {
  text = text.trim();
  let start = 0;
  const end = text.length;
  if (start === end) return 0;
  let negative = false,
    signed = false;
  const sign = text.charCodeAt(start);
  if (sign === 43 || sign === 45) {
    signed = true;
    negative = sign === 45;
    start++;
  }
  if (end - start === 8 && text.startsWith("Infinity", start))
    return negative ? -Infinity : Infinity;
  if (start === end) return NaN;
  let radix = 10;
  if (!signed && text.charCodeAt(start) === 48 && start + 1 < end) {
    const prefix = text.charCodeAt(start + 1);
    if (prefix === 120 || prefix === 88) radix = 16;
    else if (prefix === 98 || prefix === 66) radix = 2;
    else if (prefix === 111 || prefix === 79) radix = 8;
  }
  if (radix !== 10) {
    start += 2;
    if (start === end) return NaN;
    const integer = natural(Math.ceil(((end - start) * 4) / 16) + 1, 0);
    for (let i = start; i < end; i++) {
      const value = digit(text.charCodeAt(i));
      if (value < 0 || value >= radix) return NaN;
      multiplyAdd(integer, radix, value);
    }
    return roundedRatio(integer, natural(1, 1));
  }
  let index = start,
    fraction = 0,
    digits = 0,
    significant = 0,
    nonzero = false;
  while (
    index < end &&
    digit(text.charCodeAt(index)) >= 0 &&
    digit(text.charCodeAt(index)) < 10
  ) {
    if (text.charCodeAt(index) !== 48) nonzero = true;
    if (nonzero) significant++;
    digits++;
    index++;
  }
  if (text.charCodeAt(index) === 46) {
    index++;
    while (
      index < end &&
      digit(text.charCodeAt(index)) >= 0 &&
      digit(text.charCodeAt(index)) < 10
    ) {
      if (text.charCodeAt(index) !== 48) nonzero = true;
      if (nonzero) significant++;
      digits++;
      fraction++;
      index++;
    }
  }
  if (digits === 0) return NaN;
  const mantissaEnd = index;
  let exponent = 0;
  if (
    index < end &&
    (text.charCodeAt(index) === 101 || text.charCodeAt(index) === 69)
  ) {
    index++;
    let exponentNegative = false;
    if (text.charCodeAt(index) === 43 || text.charCodeAt(index) === 45) {
      exponentNegative = text.charCodeAt(index) === 45;
      index++;
    }
    const exponentStart = index,
      limit = text.length + 400;
    while (index < end) {
      const value = digit(text.charCodeAt(index));
      if (value < 0 || value >= 10) return NaN;
      exponent = Math.min(limit, exponent * 10 + value);
      index++;
    }
    if (index === exponentStart) return NaN;
    if (exponentNegative) exponent = -exponent;
  }
  if (index !== end) return NaN;
  if (!nonzero) return negative ? -0 : 0;
  exponent -= fraction;
  const magnitude = significant + exponent - 1;
  if (magnitude > 309) return negative ? -Infinity : Infinity;
  if (magnitude < -325) return negative ? -0 : 0;
  const capacity = Math.ceil(((digits + Math.abs(exponent)) * 4) / 16) + 150;
  const numerator = natural(capacity, 0),
    denominator = natural(capacity, 1);
  for (let i = start; i < mantissaEnd; i++) {
    const code = text.charCodeAt(i);
    if (code !== 46) multiplyAdd(numerator, 10, code - 48);
  }
  if (exponent >= 0)
    for (let i = 0; i < exponent; i++) multiplyAdd(numerator, 10, 0);
  else for (let i = 0; i < -exponent; i++) multiplyAdd(denominator, 10, 0);
  const result = roundedRatio(numerator, denominator);
  return negative ? -result : result;
}

/** parseInt after ToString/ToNumber, with prefix scanning and exact rounding. */
export function parseIntegerText(text: string, radix: number): number {
  text = text.trimStart();
  let start = 0;
  const sign = text.charCodeAt(0),
    negative = sign === 45;
  if (sign === 43 || sign === 45) start++;
  radix = radix | 0;
  const stripPrefix = radix === 0 || radix === 16;
  if (radix === 0) radix = 10;
  if (radix < 2 || radix > 36) return NaN;
  if (
    stripPrefix &&
    text.charCodeAt(start) === 48 &&
    (text.charCodeAt(start + 1) === 120 || text.charCodeAt(start + 1) === 88)
  ) {
    start += 2;
    radix = 16;
  }
  let end = start;
  while (end < text.length) {
    const value = digit(text.charCodeAt(end));
    if (value < 0 || value >= radix) break;
    end++;
  }
  if (end === start) return NaN;
  const integer = natural(Math.ceil(((end - start) * 6) / 16) + 1, 0);
  for (let index = start; index < end; index++)
    multiplyAdd(integer, radix, digit(text.charCodeAt(index)));
  const result = roundedRatio(integer, natural(1, 1));
  return negative ? -result : result;
}
/** parseFloat's longest decimal prefix, sharing StringNumericLiteral rounding. */
export function parseFloatText(text: string): number {
  text = text.trimStart();
  let index = 0;
  const sign = text.charCodeAt(0);
  if (sign === 43 || sign === 45) index++;
  if (text.startsWith("Infinity", index))
    return sign === 45 ? -Infinity : Infinity;
  let count = 0;
  while (
    index < text.length &&
    digit(text.charCodeAt(index)) >= 0 &&
    digit(text.charCodeAt(index)) < 10
  ) {
    index++;
    count++;
  }
  if (text.charCodeAt(index) === 46) {
    index++;
    while (
      index < text.length &&
      digit(text.charCodeAt(index)) >= 0 &&
      digit(text.charCodeAt(index)) < 10
    ) {
      index++;
      count++;
    }
  }
  if (count === 0) return NaN;
  let end = index;
  if (text.charCodeAt(index) === 101 || text.charCodeAt(index) === 69) {
    index++;
    if (text.charCodeAt(index) === 43 || text.charCodeAt(index) === 45) index++;
    const exponentStart = index;
    while (
      index < text.length &&
      digit(text.charCodeAt(index)) >= 0 &&
      digit(text.charCodeAt(index)) < 10
    )
      index++;
    if (index > exponentStart) end = index;
  }
  return stringToNumber(text.slice(0, end));
}

// Nonnegative safe integers, without recursive formatting or rounded candidates.
function decimalInteger(value: number): string {
  let text = "";
  do {
    text = String.fromCharCode(48 + (value % 10)) + text;
    value = Math.floor(value / 10);
  } while (value !== 0);
  return text;
}
function decimalLayout(digits: string, point: number): string {
  while (digits.length > 1 && digits.charCodeAt(digits.length - 1) === 48)
    digits = digits.slice(0, digits.length - 1);
  const length = digits.length;
  if (point > 0 && point <= 21) {
    if (length <= point) return digits.padEnd(point, "0");
    return digits.slice(0, point).concat(".", digits.slice(point));
  }
  if (point > -6 && point <= 0) {
    return "0." + digits.padStart(length - point, "0");
  }
  const exponent = point - 1;
  const mantissa =
    length === 1 ? digits : digits.charAt(0).concat(".", digits.slice(1));
  return (
    mantissa + (exponent < 0 ? "e-" : "e+") + decimalInteger(Math.abs(exponent))
  );
}
function incrementDecimal(digits: string): string {
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
/** Shortest decimal conversion using exact expansion and round-trip selection. */
export function numberToString(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === 0) return "0";
  if (value < 0) return "-" + numberToString(-value);
  if (value === 1 / 0) return "Infinity";
  if (value <= 9007199254740991 && Math.floor(value) === value)
    return decimalInteger(value);
  const expanded = exactDecimal(value);
  const digits = expanded.digits,
    point = expanded.point;
  for (let count = 1; count <= 17 && count < digits.length; count++) {
    const lower = digits.slice(0, count),
      upper = incrementDecimal(lower);
    const lowText = decimalLayout(lower, point);
    const highText = decimalLayout(upper, point + upper.length - lower.length);
    const next = digits.charCodeAt(count);
    let aboveHalf = false;
    for (let i = count + 1; i < digits.length; i++)
      if (digits.charCodeAt(i) !== 48) aboveHalf = true;
    const up =
      next > 53 ||
      (next === 53 &&
        (aboveHalf || (lower.charCodeAt(count - 1) - 48) % 2 !== 0));
    const nearest = up ? highText : lowText,
      other = up ? lowText : highText;
    if (stringToNumber(nearest) === value) return nearest;
    if (stringToNumber(other) === value) return other;
  }
  return decimalLayout(digits, point);
}

/** Exact positive finite decimal expansion, before any presentation rounding. */
function exactDecimal(value: number): {
  readonly digits: string;
  readonly point: number;
} {
  if (value === 0) return { digits: "0", point: 1 };
  let significand = value,
    exponent = 0;
  while (significand > 9007199254740991) {
    significand /= 2;
    exponent++;
  }
  while (Math.floor(significand) !== significand) {
    significand *= 2;
    exponent--;
  }
  while (significand % 2 === 0) {
    significand /= 2;
    exponent++;
  }
  // At most 53 + 1074*log2(5) bits: 164 base-2^16 limbs suffice.
  const integer = natural(164, 0);
  integer.length = 0;
  while (significand !== 0) {
    integer.limbs[integer.length] = significand % 65536;
    integer.length = integer.length + 1;
    significand = Math.floor(significand / 65536);
  }
  const scale = exponent < 0 ? -exponent : 0;
  for (let i = 0; i < scale; i++) multiplyAdd(integer, 5, 0);
  for (let i = 0; i < exponent; i++) multiplyAdd(integer, 2, 0);
  let digits = "";
  while (integer.length > 0) {
    let remainder = 0;
    for (let i = integer.length - 1; i >= 0; i--) {
      const limb = remainder * 65536 + (integer.limbs[i] ?? 0);
      integer.limbs[i] = Math.floor(limb / 10);
      remainder = limb % 10;
    }
    digits = String.fromCharCode(48 + remainder) + digits;
    while (integer.length > 0 && integer.limbs[integer.length - 1] === 0)
      integer.length = integer.length - 1;
  }
  return { digits, point: digits.length - scale };
}

/** Decimal presentation rounds halfway away from zero, unlike shortest conversion. */
function roundedDecimal(digits: string, count: number): string {
  if (count < 0) return "0";
  if (count === 0) return digits.charCodeAt(0) >= 53 ? "1" : "0";
  if (count >= digits.length) return digits.padEnd(count, "0");
  const prefix = digits.slice(0, count);
  return digits.charCodeAt(count) >= 53 ? incrementDecimal(prefix) : prefix;
}
function scientificLayout(digits: string, point: number): string {
  const exponent = point - 1;
  return (
    digits.charAt(0) +
    (digits.length > 1 ? "." + digits.slice(1) : "") +
    (exponent < 0 ? "e-" : "e+") +
    decimalInteger(Math.abs(exponent))
  );
}
function significantDecimal(
  value: number,
  precision: number,
): { readonly digits: string; readonly point: number } {
  const expanded = exactDecimal(value);
  let digits = roundedDecimal(expanded.digits, precision),
    point = expanded.point;
  if (digits.length > precision) {
    digits = digits.slice(0, precision);
    point++;
  }
  return { digits, point };
}
/** Caller supplies an integer fraction count in [0,100]. */
export function numberToFixed(value: number, fraction: number): string {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e21)
    return numberToString(value);
  const negative = value < 0;
  const expanded = exactDecimal(negative ? -value : value);
  const digits = roundedDecimal(
    expanded.digits,
    expanded.point + fraction,
  ).padStart(fraction + 1, "0");
  const point = digits.length - fraction;
  return (
    (negative ? "-" : "") +
    digits.slice(0, point) +
    (fraction === 0 ? "" : "." + digits.slice(point))
  );
}
/** Caller supplies undefined or an integer precision in [1,100]. */
export function numberToPrecision(
  value: number,
  precision: number | undefined,
): string {
  if (precision === undefined || !Number.isFinite(value))
    return numberToString(value);
  const negative = value < 0;
  const expanded = significantDecimal(negative ? -value : value, precision);
  const digits = expanded.digits,
    point = expanded.point;
  let text: string;
  if (point - 1 < -6 || point - 1 >= precision)
    text = scientificLayout(digits, point);
  else if (point <= 0)
    text = "0." + digits.padStart(digits.length - point, "0");
  else
    text =
      digits.slice(0, point) +
      (point < digits.length ? "." + digits.slice(point) : "");
  return (negative ? "-" : "") + text;
}
/** Caller supplies undefined (shortest) or an integer fraction count in [0,100]. */
export function numberToExponential(
  value: number,
  fraction: number | undefined,
): string {
  if (!Number.isFinite(value)) return numberToString(value);
  const negative = value < 0,
    magnitude = negative ? -value : value;
  if (fraction !== undefined) {
    const expanded = significantDecimal(magnitude, fraction + 1);
    return (
      (negative ? "-" : "") + scientificLayout(expanded.digits, expanded.point)
    );
  }
  const shortest = numberToString(magnitude);
  const exponentIndex = shortest.indexOf("e");
  if (exponentIndex >= 0) return (negative ? "-" : "") + shortest;
  const dot = shortest.indexOf(".");
  let point = dot < 0 ? shortest.length : dot;
  let digits =
    dot < 0 ? shortest : shortest.slice(0, dot) + shortest.slice(dot + 1);
  while (digits.length > 1 && digits.charAt(0) === "0") {
    digits = digits.slice(1);
    point--;
  }
  while (digits.length > 1 && digits.charAt(digits.length - 1) === "0")
    digits = digits.slice(0, -1);
  return (negative ? "-" : "") + scientificLayout(digits, point);
}

export {
  decimalFromString,
  decimalToString,
  roundDecimal,
  type DecimalQuantity,
} from "./decimal.ts";
import { decimalFromString, type DecimalQuantity } from "./decimal.ts";
/** Intl Number inputs use shortest decimal spelling, retaining negative zero. */
export function decimalFromNumber(value: number): DecimalQuantity {
  const negative = value < 0 || (value === 0 && 1 / value < 0);
  if (Number.isNaN(value))
    return { kind: "nan", negative: false, digits: "0", exponent: 0 };
  if (!Number.isFinite(value))
    return { kind: "infinity", negative, digits: "0", exponent: 0 };
  const result = decimalFromString(
    negative && value === 0 ? "-0" : numberToString(value),
  );
  if (result === undefined) throw "DECIMAL_NUMBER_INVARIANT";
  return result;
}
export {
  formatDecimalFraction,
  formatDecimalPrecision,
  type DecimalFormatResult,
} from "./decimal-format.ts";
