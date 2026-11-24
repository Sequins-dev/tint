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
  // A string that is the canonical decimal of an array index may carry it.
  const cached = cachedArrayIndex(text);
  if (cached >= 0) return cached;
  // The common case first, in one pass: the whole text an optionally
  // negative decimal of at most 15 significant digits and 22 fraction
  // digits, with no exponent, whitespace or other sign. Its digits
  // accumulate as an exact integer, below 10^15 < 2^53, and 10^0 through
  // 10^22 are exact, so one correctly rounded division gives the correctly
  // rounded value (Clinger's fast path, as the general path takes it). A
  // radix prefix, "Infinity" and every other form stop the scan.
  const length = text.length,
    begin = text.charCodeAt(0) === 45 ? 1 : 0;
  let point = -1,
    mantissa = 0,
    index: number = begin;
  for (; index < length; index++) {
    const value = text.charCodeAt(index) - 48;
    if (value >>> 0 <= 9) mantissa = mantissa * 10 + value;
    else if (value === -2 && point < 0) point = index;
    else break;
  }
  if (index === length && length - begin !== (point < 0 ? 0 : 1)) {
    // Leading zeros, and a point among them, are not significant.
    let first: number = begin;
    while (first < length && (first === point || text.charCodeAt(first) === 48))
      first++;
    const fraction = point < 0 ? 0 : length - point - 1;
    if (length - first - (point > first ? 1 : 0) <= 15 && fraction <= 22) {
      // A canonical array index (digits only, no leading zero but "0"
      // itself) below 2^20 caches its value in the string.
      if (
        point < 0 &&
        begin === 0 &&
        mantissa < 1048576 &&
        (length === 1 || text.charCodeAt(0) !== 48)
      )
        cacheArrayIndex(text, mantissa);
      let power = 1;
      for (let i = 0; i < fraction; i++) power *= 10;
      const result = mantissa / power;
      return begin === 1 ? -result : result;
    }
  }
  return generalStringToNumber(text);
}
/** stringToNumber's general path: whitespace, signs, radix prefixes,
 * Infinity, exponents and long digit strings, rounded exactly. */
function generalStringToNumber(text: string): number {
  // StrWhiteSpaceChar ends are rare; a code unit at or below the space or
  // above 0x7F may be one, and only then is trimming needed.
  const first = text.charCodeAt(0),
    last = text.charCodeAt(text.length - 1);
  if (first <= 32 || first > 126 || last <= 32 || last > 126)
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
  // Clinger's fast path: at most 15 significant digits are an exact
  // integer, and 10^0 through 10^22 are exact, so one correctly rounded
  // multiplication or division gives the correctly rounded result.
  if (significant <= 15 && exponent >= -22 && exponent <= 22) {
    let mantissa = 0;
    for (let i = start; i < mantissaEnd; i++) {
      const code = text.charCodeAt(i);
      if (code !== 46) mantissa = mantissa * 10 + (code - 48);
    }
    let power = 1;
    for (let i = exponent < 0 ? -exponent : exponent; i > 0; i--) power *= 10;
    const result = exponent < 0 ? mantissa / power : mantissa * power;
    return negative ? -result : result;
  }
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
// Digit extraction divides by multiplying: for every integer v in [0, 10^5),
// Math.floor(v * 0.1) is Math.floor(v / 10), and for every v in [0, 10^8),
// Math.floor(v * 0.0001) is Math.floor(v / 10000) (checked exhaustively).
// Each double constant is slightly above its exact reciprocal, so an exact
// multiple never rounds below its quotient, and the gap below the next
// integer, at least the reciprocal itself, dwarfs the rounding error.
/** Digits of a nonnegative safe integer. A value below 10^8 allocates
 * once; larger ones join groups of up to eight digits. */
function decimalInteger(value: number): string {
  if (value < 10000) return leadingDigits(value);
  if (value < 100000000) return eightOrFewerDigits(value);
  const high = Math.floor(value / 100000000),
    low = value - high * 100000000;
  return decimalInteger(high).concat(eightDigits(low));
}
/** The digits of a value in [10^4, 10^8), as one string of five to eight
 * code units. */
function eightOrFewerDigits(value: number): string {
  const high = Math.floor(value * 0.0001),
    low = value - high * 10000;
  const tens = Math.floor(low * 0.1),
    hundreds = Math.floor(tens * 0.1),
    thousands = Math.floor(hundreds * 0.1);
  const d4 = 48 + thousands,
    d5 = 48 + hundreds - thousands * 10,
    d6 = 48 + tens - hundreds * 10,
    d7 = 48 + low - tens * 10;
  const highTens = Math.floor(high * 0.1),
    highHundreds = Math.floor(highTens * 0.1),
    highThousands = Math.floor(highHundreds * 0.1);
  const d3 = 48 + high - highTens * 10;
  if (high < 10) return String.fromCharCode(d3, d4, d5, d6, d7);
  const d2 = 48 + highTens - highHundreds * 10;
  if (high < 100) return String.fromCharCode(d2, d3, d4, d5, d6, d7);
  const d1 = 48 + highHundreds - highThousands * 10;
  if (high < 1000) return String.fromCharCode(d1, d2, d3, d4, d5, d6, d7);
  return String.fromCharCode(48 + highThousands, d1, d2, d3, d4, d5, d6, d7);
}
/** Eight digits of a value in [0, 10^8), with leading zeros. */
function eightDigits(value: number): string {
  const high = Math.floor(value * 0.0001);
  return fourDigits(high).concat(fourDigits(value - high * 10000));
}
/** The digits of a value in [0, 10000), without leading zeros. */
function leadingDigits(value: number): string {
  if (value < 10) return String.fromCharCode(48 + value);
  const tens = Math.floor(value * 0.1),
    ones = value - tens * 10;
  if (value < 100) return String.fromCharCode(48 + tens, 48 + ones);
  const hundreds = Math.floor(tens * 0.1),
    second = tens - hundreds * 10;
  if (value < 1000)
    return String.fromCharCode(48 + hundreds, 48 + second, 48 + ones);
  const thousands = Math.floor(hundreds * 0.1);
  return String.fromCharCode(
    48 + thousands,
    48 + hundreds - thousands * 10,
    48 + second,
    48 + ones,
  );
}
/** Four digits of a value in [0, 10000), with leading zeros. */
function fourDigits(value: number): string {
  const tens = Math.floor(value * 0.1),
    hundreds = Math.floor(tens * 0.1),
    thousands = Math.floor(hundreds * 0.1);
  return String.fromCharCode(
    48 + thousands,
    48 + hundreds - thousands * 10,
    48 + tens - hundreds * 10,
    48 + value - tens * 10,
  );
}
/** Exactly `count` digits of a value in [0, 10^count), with leading zeros. */
function paddedDigits(value: number, count: number): string {
  if (count === 1) return String.fromCharCode(48 + value);
  if (count === 2) {
    const tens = Math.floor(value * 0.1);
    return String.fromCharCode(48 + tens, 48 + value - tens * 10);
  }
  if (count === 3) {
    const tens = Math.floor(value * 0.1),
      hundreds = Math.floor(tens * 0.1);
    return String.fromCharCode(
      48 + hundreds,
      48 + tens - hundreds * 10,
      48 + value - tens * 10,
    );
  }
  if (count === 4) return fourDigits(value);
  const digits = decimalInteger(value);
  return digits.length === count
    ? digits
    : "0".repeat(count - digits.length) + digits;
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
/** Whether the product of `a` and `b` is exactly their rounded product
 * `product` (Dekker's two-product error term without a fused multiply-add;
 * operands and product are finite and normal). */
function exactProduct(a: number, b: number, product: number): boolean {
  const ca = 134217729 * a,
    ah = ca - (ca - a),
    al = a - ah;
  const cb = 134217729 * b,
    bh = cb - (cb - b),
    bl = b - bh;
  return ah * bh - product + ah * bl + al * bh + al * bl === 0;
}
/** The shortest decimal text of a positive finite non-integer `value`
 * whose exact decimal expansion has at most 15 significant digits, else "".
 * Every decimal of at most 15 significant digits round-trips through
 * binary64 (DBL_DIG), so two such decimals never denote the same double:
 * the exact expansion is then the unique shortest one. The smallest k with
 * value * 10^k an exact integer gives its digits, without trailing zeros. */
function shortExactDecimal(value: number): string {
  let scale = 1;
  for (let k = 1; k <= 22; k++) {
    scale *= 10;
    const scaled = value * scale;
    if (scaled >= 1e15) return "";
    if (Math.floor(scaled) === scaled && exactProduct(value, scale, scaled)) {
      // From 1 up, the integer digits, the point and k fraction digits, the
      // last nonzero as k is least: whole * scale is at most scaled, so
      // both it and the fraction's units are exact integers.
      if (value >= 1) {
        const whole = Math.floor(value);
        return (
          decimalInteger(whole) + "." + paddedDigits(scaled - whole * scale, k)
        );
      }
      const digits = decimalInteger(scaled);
      return decimalLayout(digits, digits.length - k);
    }
  }
  return "";
}
/** Number::toString(10): from the number-string cache when it holds
 * `value`, else formatted and cached. */
export function numberToString(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === 0) return "0";
  const cached = numberStringCached(value);
  if (cached !== "") return cached;
  return numberToStringMissed(value);
}
/** Number::toString(10) after the number-string cache missed `value`:
 * formatted and cached. Typed code looks the cache up inline and calls
 * this on a miss, so a miss is not looked up twice. */
export function numberToStringMissed(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === 0) return "0";
  // Positive integers below 10^8 (the common case) format directly.
  const text =
    value > 0 && value < 100000000 && Math.floor(value) === value
      ? value < 10000
        ? leadingDigits(value)
        : eightOrFewerDigits(value)
      : formatNumber(value);
  cacheNumberString(value, text);
  // An integer string is the canonical decimal of its value.
  if (value > 0 && value < 1048576 && Math.floor(value) === value)
    cacheArrayIndex(text, value);
  return text;
}
/** Shortest decimal conversion using exact expansion and round-trip selection. */
function formatNumber(value: number): string {
  if (value < 0) return "-" + numberToString(-value);
  if (value === 1 / 0) return "Infinity";
  if (value <= 9007199254740991 && Math.floor(value) === value)
    return decimalInteger(value);
  const short = shortExactDecimal(value);
  if (short !== "") return short;
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
import {
  cacheNumberString,
  numberStringCached,
  cachedArrayIndex,
  cacheArrayIndex,
} from "../number-string-cache.ts";
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
