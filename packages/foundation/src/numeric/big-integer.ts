/** Canonical signed magnitude: little-endian base-2^26 digits, no leading zero.
 * Zero has an empty digit array and is never negative. Treat digits as immutable;
 * construct values through this module rather than fabricating records. */
export interface Integer {
  readonly negative: boolean;
  readonly digits: readonly number[];
}
export interface Division {
  readonly quotient: Integer;
  readonly remainder: Integer;
}
// One digit product plus carry and an accumulator digit remains below 2^53.
const base = 67108864;
function canonical(negative: boolean, digits: number[]): Integer {
  while (digits.length !== 0 && digits[digits.length - 1] === 0) digits.pop();
  return { negative: negative && digits.length !== 0, digits };
}
function magnitudeCompare(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  for (let i = a.length - 1; i >= 0; i--) {
    const x = a[i] ?? 0,
      y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
export function compare(a: Integer, b: Integer): number {
  if (a.negative !== b.negative) return a.negative ? -1 : 1;
  const order = magnitudeCompare(a.digits, b.digits);
  return order === 0 ? 0 : a.negative ? -order : order;
}
function magnitudeAdd(a: readonly number[], b: readonly number[]): number[] {
  const digits: number[] = [];
  let carry = 0;
  for (let i = 0; i < a.length || i < b.length; i++) {
    const sum = (a[i] ?? 0) + (b[i] ?? 0) + carry;
    digits.push(sum % base);
    carry = Math.floor(sum / base);
  }
  if (carry !== 0) digits.push(carry);
  return digits;
}
/** Requires |a| >= |b|. */
function magnitudeSubtract(
  a: readonly number[],
  b: readonly number[],
): number[] {
  const digits: number[] = [];
  let borrow = 0;
  for (let i = 0; i < a.length; i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0) - borrow;
    digits.push(difference < 0 ? difference + base : difference);
    borrow = difference < 0 ? 1 : 0;
  }
  return digits;
}
export function negate(value: Integer): Integer {
  return {
    negative: value.digits.length !== 0 && !value.negative,
    digits: value.digits,
  };
}
export function add(a: Integer, b: Integer): Integer {
  if (a.negative === b.negative)
    return canonical(a.negative, magnitudeAdd(a.digits, b.digits));
  return magnitudeCompare(a.digits, b.digits) >= 0
    ? canonical(a.negative, magnitudeSubtract(a.digits, b.digits))
    : canonical(b.negative, magnitudeSubtract(b.digits, a.digits));
}
export function subtract(a: Integer, b: Integer): Integer {
  return add(a, negate(b));
}
export function multiply(a: Integer, b: Integer): Integer {
  if (a.digits.length === 0 || b.digits.length === 0)
    return canonical(false, []);
  const digits: number[] = [];
  for (let i = 0; i < a.digits.length + b.digits.length; i++) digits.push(0);
  for (let i = 0; i < a.digits.length; i++) {
    let carry = 0;
    for (let j = 0; j < b.digits.length; j++) {
      const product =
        (a.digits[i] ?? 0) * (b.digits[j] ?? 0) + (digits[i + j] ?? 0) + carry;
      digits[i + j] = product % base;
      carry = Math.floor(product / base);
    }
    digits[i + b.digits.length] = carry;
  }
  return canonical(a.negative !== b.negative, digits);
}
/** Small-factor multiply/add, also used when accumulating radix digits. */
function scaleAndAdd(
  value: readonly number[],
  factor: number,
  carry: number,
): Integer {
  const digits: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const product = (value[i] ?? 0) * factor + carry;
    digits.push(product % base);
    carry = Math.floor(product / base);
  }
  if (carry !== 0) digits.push(carry);
  return canonical(false, digits);
}
function divideDigit(value: readonly number[], divisor: number): Division {
  const digits: number[] = [];
  for (let i = 0; i < value.length; i++) digits.push(0);
  let remainder = 0;
  for (let i = value.length - 1; i >= 0; i--) {
    const dividend = remainder * base + (value[i] ?? 0);
    const digit = Math.floor(dividend / divisor);
    digits[i] = digit;
    remainder = dividend - digit * divisor;
  }
  return {
    quotient: canonical(false, digits),
    remainder: canonical(false, [remainder]),
  };
}
/** Truncates toward zero; undefined denotes division by zero. */
export function divide(a: Integer, b: Integer): Division | undefined {
  if (b.digits.length === 0) return undefined;
  let result: Division;
  if (b.digits.length === 1) {
    result = divideDigit(a.digits, b.digits[0] ?? 1);
  } else {
    const digits: number[] = [];
    for (let i = 0; i < a.digits.length; i++) digits.push(0);
    let remainder = canonical(false, []);
    // Binary long division supplies a simple exact baseline for multi-digit divisors.
    for (let i = a.digits.length - 1; i >= 0; i--) {
      const digit = a.digits[i] ?? 0;
      let quotientDigit = 0;
      for (let bit = base / 2; bit >= 1; bit = Math.floor(bit / 2)) {
        remainder = scaleAndAdd(
          remainder.digits,
          2,
          Math.floor(digit / bit) % 2,
        );
        if (magnitudeCompare(remainder.digits, b.digits) >= 0) {
          remainder = canonical(
            false,
            magnitudeSubtract(remainder.digits, b.digits),
          );
          quotientDigit += bit;
        }
      }
      digits[i] = quotientDigit;
    }
    result = { quotient: canonical(false, digits), remainder };
  }
  return {
    quotient:
      a.negative !== b.negative ? negate(result.quotient) : result.quotient,
    remainder: a.negative ? negate(result.remainder) : result.remainder,
  };
}
function validRadix(radix: number): boolean {
  return radix >= 2 && radix <= 36 && Math.floor(radix) === radix;
}
/** Plain signed radix text; no prefixes, whitespace, separators or suffixes.
 * Language adapters apply their own lexical and StringToBigInt grammar. */
export function parseInteger(text: string, radix: number): Integer | undefined {
  if (!validRadix(radix) || text.length === 0) return undefined;
  const negative = text.charCodeAt(0) === 45;
  let index = negative || text.charCodeAt(0) === 43 ? 1 : 0;
  if (index === text.length) return undefined;
  let result = canonical(false, []);
  for (; index < text.length; index++) {
    const code = text.charCodeAt(index);
    const digit =
      code >= 48 && code <= 57
        ? code - 48
        : code >= 65 && code <= 90
          ? code - 55
          : code >= 97 && code <= 122
            ? code - 87
            : -1;
    if (digit < 0 || digit >= radix) return undefined;
    result = scaleAndAdd(result.digits, radix, digit);
  }
  return negative ? negate(result) : result;
}
export function formatInteger(
  value: Integer,
  radix: number,
): string | undefined {
  if (!validRadix(radix)) return undefined;
  if (value.digits.length === 0) return "0";
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let remaining = value;
  const characters: string[] = [];
  while (remaining.digits.length !== 0) {
    const result = divideDigit(remaining.digits, radix);
    characters.push(alphabet.charAt(result.remainder.digits[0] ?? 0));
    remaining = result.quotient;
  }
  let text = value.negative ? "-" : "";
  for (let i = characters.length - 1; i >= 0; i--) text += characters[i] ?? "";
  return text;
}

/** Fixed-width two's complement, including one extra sign digit. */
function extendOrComplement(
  value: readonly number[],
  complement: boolean,
  width: number,
): number[] {
  const digits: number[] = [];
  let carry = complement ? 1 : 0;
  for (let i = 0; i < width; i++) {
    const digit = value[i] ?? 0;
    const next = (complement ? base - 1 - digit : digit) + carry;
    digits.push(next % base);
    carry = Math.floor(next / base);
  }
  return digits;
}
export function bitwise(
  a: Integer,
  b: Integer,
  operator: "&" | "|" | "^",
): Integer {
  const width = Math.max(a.digits.length, b.digits.length) + 1;
  const left = extendOrComplement(a.digits, a.negative, width),
    right = extendOrComplement(b.digits, b.negative, width);
  const digits: number[] = [];
  for (let i = 0; i < width; i++) {
    const x = left[i] ?? 0,
      y = right[i] ?? 0;
    digits.push(operator === "&" ? x & y : operator === "|" ? x | y : x ^ y);
  }
  const negative =
    operator === "&"
      ? a.negative && b.negative
      : operator === "|"
        ? a.negative || b.negative
        : a.negative !== b.negative;
  return canonical(
    negative,
    negative ? extendOrComplement(digits, true, width) : digits,
  );
}
export function bitwiseNot(value: Integer): Integer {
  return subtract(negate(value), { negative: false, digits: [1] });
}

/** Retain low bits with signed or unsigned interpretation. Capacity bounds the
 * temporary two's-complement representation; unchanged values need no scratch. */
export function truncateInteger(
  value: Integer,
  bits: number,
  signed: boolean,
  maxDigits: number,
): Integer | undefined {
  if (
    !validCapacity(maxDigits) ||
    !(bits >= 0 && bits <= 9007199254740991) ||
    Math.floor(bits) !== bits
  )
    return undefined;
  if (bits === 0 || value.digits.length === 0) return canonical(false, []);
  const magnitude = magnitudeBits(value.digits);
  if (
    (signed && bits > magnitude) ||
    (!signed && !value.negative && bits >= magnitude)
  )
    return withinCapacity(value, maxDigits);
  const partial = bits % 26;
  const width = Math.floor(bits / 26) + (partial === 0 ? 0 : 1);
  if (width > maxDigits) return undefined;
  const mask = partial === 0 ? base - 1 : (1 << partial) - 1;
  const digits = extendOrComplement(value.digits, value.negative, width);
  digits[width - 1] = (digits[width - 1] ?? 0) & mask;
  const negative =
    signed &&
    (digits[width - 1] ?? 0) >= 1 << (partial === 0 ? 25 : partial - 1);
  if (!negative) return canonical(false, digits);
  const absolute = extendOrComplement(digits, true, width);
  absolute[width - 1] = (absolute[width - 1] ?? 0) & mask;
  return canonical(true, absolute);
}

function validCapacity(maxDigits: number): boolean {
  return (
    maxDigits >= 0 &&
    maxDigits <= 0xffffffff &&
    Math.floor(maxDigits) === maxDigits
  );
}
/** Convert only when the nonnegative magnitude fits the supplied exact bound. */
function boundedCount(
  digits: readonly number[],
  limit: number,
): number | undefined {
  let count = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    const digit = digits[i] ?? 0;
    if (count > Math.floor((limit - digit) / base)) return undefined;
    count = count * base + digit;
  }
  return count <= limit ? count : undefined;
}
function withinCapacity(
  value: Integer,
  maxDigits: number,
): Integer | undefined {
  return value.digits.length <= maxDigits ? value : undefined;
}
/** Positive counts shift left; negative counts shift right with sign extension.
 * The caller supplies its result allocation limit in base-2^26 digits. */
export function shift(
  value: Integer,
  count: Integer,
  maxDigits: number,
): Integer | undefined {
  if (!validCapacity(maxDigits)) return undefined;
  if (value.digits.length === 0) return canonical(false, []);
  const distance = boundedCount(
    count.digits,
    (count.negative ? value.digits.length : maxDigits) * 26,
  );
  if (distance === undefined) {
    if (!count.negative) return undefined;
    return withinCapacity(
      canonical(value.negative, value.negative ? [1] : []),
      maxDigits,
    );
  }
  const whole = Math.floor(distance / 26),
    partial = distance % 26;
  const factor = 1 << partial;
  if (!count.negative) {
    const top = value.digits[value.digits.length - 1] ?? 0;
    const overflow = top * factor >= base ? 1 : 0;
    if (value.digits.length + whole + overflow > maxDigits) return undefined;
    const digits: number[] = [];
    for (let i = 0; i < whole; i++) digits.push(0);
    let carry = 0;
    for (let i = 0; i < value.digits.length; i++) {
      const next = (value.digits[i] ?? 0) * factor + carry;
      digits.push(next % base);
      carry = Math.floor(next / base);
    }
    if (carry !== 0) digits.push(carry);
    return canonical(value.negative, digits);
  }
  if (value.digits.length - whole - 1 > maxDigits) return undefined;
  let discarded = false;
  for (let i = 0; i < whole && i < value.digits.length; i++)
    if ((value.digits[i] ?? 0) !== 0) discarded = true;
  const digits: number[] = [];
  for (let i = whole; i < value.digits.length; i++) {
    const low = value.digits[i] ?? 0,
      high = value.digits[i + 1] ?? 0;
    if (i === whole && low % factor !== 0) discarded = true;
    digits.push(Math.floor(low / factor) + (high % factor) * (base / factor));
  }
  const truncated = canonical(value.negative, digits);
  // Magnitude truncation needs one additional unit for negative nonintegral results.
  const result =
    value.negative && discarded
      ? subtract(truncated, { negative: false, digits: [1] })
      : truncated;
  return withinCapacity(result, maxDigits);
}
function boundedMultiply(
  a: Integer,
  b: Integer,
  maxDigits: number,
): Integer | undefined {
  if (a.digits.length + b.digits.length - 1 > maxDigits) return undefined;
  return withinCapacity(multiply(a, b), maxDigits);
}
/** Undefined denotes a negative exponent, invalid capacity or oversized result.
 * Zero and unit bases are handled before bounding an arbitrarily large exponent. */
export function power(
  value: Integer,
  exponent: Integer,
  maxDigits: number,
): Integer | undefined {
  if (!validCapacity(maxDigits) || exponent.negative) return undefined;
  const one: Integer = { negative: false, digits: [1] };
  if (exponent.digits.length === 0) return withinCapacity(one, maxDigits);
  if (value.digits.length === 0) return canonical(false, []);
  if (value.digits.length === 1 && value.digits[0] === 1)
    return withinCapacity(
      value.negative && (exponent.digits[0] ?? 0) % 2 !== 0 ? negate(one) : one,
      maxDigits,
    );
  const count = boundedCount(exponent.digits, maxDigits * 26 - 1);
  if (count === undefined || value.digits.length > maxDigits) return undefined;
  let remaining = count;
  let result = one,
    factor = value;
  while (remaining !== 0) {
    if (remaining % 2 !== 0) {
      const product = boundedMultiply(result, factor, maxDigits);
      if (product === undefined) return undefined;
      result = product;
    }
    remaining = Math.floor(remaining / 2);
    if (remaining !== 0) {
      const squared = boundedMultiply(factor, factor, maxDigits);
      if (squared === undefined) return undefined;
      factor = squared;
    }
  }
  return result;
}

/** Accept the exact integer represented by a finite integral binary64 input. */
export function fromNumber(value: number): Integer | undefined {
  if (
    value !== value ||
    value === Infinity ||
    value === -Infinity ||
    Math.floor(value) !== value
  )
    return undefined;
  const negative = value < 0;
  let remaining = negative ? -value : value;
  const digits: number[] = [];
  while (remaining !== 0) {
    digits.push(remaining % base);
    remaining = Math.floor(remaining / base);
  }
  return canonical(negative, digits);
}
function magnitudeBits(value: readonly number[]): number {
  if (value.length === 0) return 0;
  let top = value[value.length - 1] ?? 0,
    bits = (value.length - 1) * 26;
  while (top !== 0) {
    top = Math.floor(top / 2);
    bits++;
  }
  return bits;
}
/** Binary64 rounding to nearest, ties to even. Discarded bits are examined before
 * converting the retained 53 bits, avoiding repeated limb-accumulation rounding. */
/** Exact powers used only within binary64's representable exponent range. */
function binaryPower(exponent: number): number {
  let factor = 1,
    powerOfTwo = exponent < 0 ? 0.5 : 2,
    remaining = Math.abs(exponent);
  while (remaining !== 0) {
    if (remaining % 2 !== 0) factor *= powerOfTwo;
    remaining = Math.floor(remaining / 2);
    if (remaining !== 0) powerOfTwo *= powerOfTwo;
  }
  return factor;
}
export function toNumber(value: Integer): number {
  const bits = magnitudeBits(value.digits);
  if (bits > 1024) return value.negative ? -Infinity : Infinity;
  const discard = Math.max(0, bits - 53);
  const whole = Math.floor(discard / 26),
    partial = discard % 26;
  const factor = 1 << partial;
  let retained = 0;
  for (let i = value.digits.length - 1; i >= whole; i--) {
    const digit =
      Math.floor((value.digits[i] ?? 0) / factor) +
      ((value.digits[i + 1] ?? 0) % factor) * (base / factor);
    retained = retained * base + digit;
  }
  if (discard !== 0) {
    const guardWord = Math.floor((discard - 1) / 26);
    const guardFactor = 1 << ((discard - 1) % 26);
    const guardDigit = value.digits[guardWord] ?? 0;
    let sticky = guardDigit % guardFactor !== 0;
    for (let i = 0; i < guardWord; i++)
      if ((value.digits[i] ?? 0) !== 0) sticky = true;
    if (
      Math.floor(guardDigit / guardFactor) % 2 !== 0 &&
      (sticky || retained % 2 !== 0)
    )
      retained++;
  }
  const result = retained * binaryPower(discard);
  return value.negative ? -result : result;
}
/** Correctly rounded binary64 quotient. Zero divisors return undefined; finite
 * operands are never individually converted to Number before division. */
export function divideToNumber(
  numerator: Integer,
  denominator: Integer,
): number | undefined {
  if (denominator.digits.length === 0) return undefined;
  if (numerator.digits.length === 0) return 0;
  const negative = numerator.negative !== denominator.negative;
  const n = numerator.negative ? negate(numerator) : numerator,
    d = denominator.negative ? negate(denominator) : denominator;
  let exponent = magnitudeBits(n.digits) - magnitudeBits(d.digits);
  if (exponent > 1024) return negative ? -Infinity : Infinity;
  if (exponent < -1075) return negative ? -0 : 0;
  const capacity = Math.max(n.digits.length, d.digits.length) + 43;
  function shifted(value: Integer, bits: number): Integer {
    const count = fromNumber(bits);
    if (count === undefined) throw "RATIO_SHIFT_COUNT_INVARIANT";
    const result = shift(value, count, capacity);
    if (result === undefined) throw "RATIO_SHIFT_CAPACITY_INVARIANT";
    return result;
  }
  if (
    exponent >= 0
      ? compare(n, shifted(d, exponent)) < 0
      : compare(shifted(n, -exponent), d) < 0
  )
    exponent--;
  if (exponent > 1023) return negative ? -Infinity : Infinity;
  const subnormal = exponent < -1022;
  const shiftBits = subnormal ? 1074 : 52 - exponent;
  const scaledNumerator = shiftBits >= 0 ? shifted(n, shiftBits) : n,
    scaledDenominator = shiftBits < 0 ? shifted(d, -shiftBits) : d;
  const division = divide(scaledNumerator, scaledDenominator);
  if (division === undefined) throw "RATIO_DIVISION_INVARIANT";
  let significand = toNumber(division.quotient);
  const halfway = compare(
    add(division.remainder, division.remainder),
    scaledDenominator,
  );
  if (halfway > 0 || (halfway === 0 && significand % 2 !== 0)) significand++;
  const result = significand * binaryPower(subnormal ? -1074 : exponent - 52);
  return negative ? -result : result;
}
/** Exact mixed comparison; undefined is the unordered NaN result. */
export function compareNumber(
  value: Integer,
  number: number,
): number | undefined {
  if (number !== number) return undefined;
  if (number === Infinity) return -1;
  if (number === -Infinity) return 1;
  const floor = Math.floor(number);
  const integer = fromNumber(floor);
  if (integer === undefined) throw "INTEGER_NUMBER_COMPARISON_INVARIANT";
  const order = compare(value, integer);
  return order !== 0 ? order : number === floor ? 0 : -1;
}
