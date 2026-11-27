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
const baseMask = 67108863;
// Exact IEEE 754 binary64 value of 2^-26 (1 / 67108864), written as a literal
// so single-module runtimes without module init stay constant-folded.
const invBase = 0.000000014901161193847656;
const twoLimbLimit = 4503599627370496;

function canonical(negative: boolean, digits: number[]): Integer {
  while (digits.length !== 0 && digits[digits.length - 1] === 0) digits.pop();
  return { negative: negative && digits.length !== 0, digits };
}
function fromMagnitude(negative: boolean, magnitude: number): Integer {
  if (magnitude === 0) return { negative: false, digits: [] };
  if (magnitude < base) return { negative, digits: [magnitude] };
  const hi = Math.floor(magnitude * invBase);
  const lo = magnitude - hi * base;
  if (hi < base) return { negative, digits: [lo, hi] };
  const d2 = Math.floor(hi * invBase);
  return { negative, digits: [lo, hi - d2 * base, d2] };
}
function magnitudeCompare(a: readonly number[], b: readonly number[]): number {
  const aLen = a.length,
    bLen = b.length;
  if (aLen !== bLen) return aLen < bLen ? -1 : 1;
  for (let i = aLen - 1; i >= 0; i--) {
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
  const aLen = a.length,
    bLen = b.length,
    maxLen = aLen > bLen ? aLen : bLen;
  const digits: number[] = [];
  let carry = 0;
  for (let i = 0; i < maxLen; i++) {
    const sum = (a[i] ?? 0) + (b[i] ?? 0) + carry;
    digits.push(sum & baseMask);
    carry = sum >>> 26;
  }
  if (carry !== 0) digits.push(carry);
  return digits;
}
/** Requires |a| >= |b|. */
function magnitudeSubtract(
  a: readonly number[],
  b: readonly number[],
): number[] {
  const aLen = a.length;
  const digits: number[] = [];
  let borrow = 0;
  for (let i = 0; i < aLen; i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0) - borrow;
    if (difference < 0) {
      digits.push(difference + base);
      borrow = 1;
    } else {
      digits.push(difference);
      borrow = 0;
    }
  }
  return digits;
}
export function negate(value: Integer): Integer {
  return {
    negative: value.digits.length !== 0 && !value.negative,
    digits: value.digits,
  };
}
function addWithSign(a: Integer, b: Integer, bNeg: boolean): Integer {
  const aDigits = a.digits,
    bDigits = b.digits,
    aLen = aDigits.length,
    bLen = bDigits.length;
  if (aLen === 0) {
    if (bLen === 0) return { negative: false, digits: [] };
    return bNeg === b.negative ? b : { negative: bNeg, digits: bDigits };
  }
  if (bLen === 0) return a;
  if (aLen <= 2 && bLen <= 2) {
    const am = (aDigits[0] ?? 0) + (aLen === 2 ? (aDigits[1] ?? 0) * base : 0);
    const bm = (bDigits[0] ?? 0) + (bLen === 2 ? (bDigits[1] ?? 0) * base : 0);
    if (a.negative === bNeg) return fromMagnitude(a.negative, am + bm);
    if (am === bm) return { negative: false, digits: [] };
    return am > bm
      ? fromMagnitude(a.negative, am - bm)
      : fromMagnitude(bNeg, bm - am);
  }
  if (a.negative === bNeg) {
    if (aLen <= 3 && bLen <= 3) {
      const s0 = (aDigits[0] ?? 0) + (bDigits[0] ?? 0);
      const r0 = s0 & baseMask;
      const s1 = (aDigits[1] ?? 0) + (bDigits[1] ?? 0) + (s0 >>> 26);
      const r1 = s1 & baseMask;
      const s2 = (aDigits[2] ?? 0) + (bDigits[2] ?? 0) + (s1 >>> 26);
      const r2 = s2 & baseMask;
      const c2 = s2 >>> 26;
      const digits =
        c2 !== 0
          ? [r0, r1, r2, c2]
          : r2 !== 0
            ? [r0, r1, r2]
            : r1 !== 0
              ? [r0, r1]
              : [r0];
      return { negative: a.negative, digits };
    }
    return canonical(a.negative, magnitudeAdd(aDigits, bDigits));
  }
  const cmp = magnitudeCompare(aDigits, bDigits);
  if (cmp === 0) return { negative: false, digits: [] };
  return cmp > 0
    ? canonical(a.negative, magnitudeSubtract(aDigits, bDigits))
    : canonical(bNeg, magnitudeSubtract(bDigits, aDigits));
}
export function add(a: Integer, b: Integer): Integer {
  return addWithSign(a, b, b.negative);
}
export function subtract(a: Integer, b: Integer): Integer {
  return addWithSign(a, b, !b.negative);
}
export function multiply(a: Integer, b: Integer): Integer {
  const aDigits = a.digits,
    bDigits = b.digits,
    aLen = aDigits.length,
    bLen = bDigits.length;
  if (aLen === 0 || bLen === 0) return { negative: false, digits: [] };
  const negative = a.negative !== b.negative;
  if (aLen === 1 && bLen === 1) {
    const product = (aDigits[0] ?? 0) * (bDigits[0] ?? 0);
    const hi = Math.floor(product * invBase);
    const lo = product - hi * base;
    return { negative, digits: hi !== 0 ? [lo, hi] : [lo] };
  }
  const totalLen = aLen + bLen;
  const digits: number[] = [];
  for (let i = 0; i < totalLen; i++) digits.push(0);
  for (let i = 0; i < aLen; i++) {
    const ai = aDigits[i] ?? 0;
    if (ai === 0) continue;
    let carry = 0;
    for (let j = 0; j < bLen; j++) {
      const product = ai * (bDigits[j] ?? 0) + (digits[i + j] ?? 0) + carry;
      const hi = Math.floor(product * invBase);
      digits[i + j] = product - hi * base;
      carry = hi;
    }
    digits[i + bLen] = carry;
  }
  return canonical(negative, digits);
}
/** Mutate `digits` in place: `digits = digits * factor + carry`. */
function scaleAndAddInPlace(
  digits: number[],
  factor: number,
  carry: number,
): void {
  const len = digits.length;
  for (let i = 0; i < len; i++) {
    const product = (digits[i] ?? 0) * factor + carry;
    const hi = Math.floor(product * invBase);
    digits[i] = product - hi * base;
    carry = hi;
  }
  while (carry !== 0) {
    const hi = Math.floor(carry * invBase);
    digits.push(carry - hi * base);
    carry = hi;
  }
}
/** Mutate `a` in place: `a -= b`, requiring `a >= b`. */
function subtractInPlace(a: number[], b: readonly number[]): void {
  const aLen = a.length;
  let borrow = 0;
  for (let i = 0; i < aLen; i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0) - borrow;
    if (difference < 0) {
      a[i] = difference + base;
      borrow = 1;
    } else {
      a[i] = difference;
      borrow = 0;
    }
  }
  while (a.length !== 0 && a[a.length - 1] === 0) a.pop();
}
function divideDigit(value: readonly number[], divisor: number): Division {
  const len = value.length;
  const digits: number[] = [];
  for (let i = 0; i < len; i++) digits.push(0);
  let remainder = 0;
  for (let i = len - 1; i >= 0; i--) {
    const dividend = remainder * base + (value[i] ?? 0);
    const digit = Math.floor(dividend / divisor);
    digits[i] = digit;
    remainder = dividend - digit * divisor;
  }
  return {
    quotient: canonical(false, digits),
    remainder:
      remainder === 0
        ? { negative: false, digits: [] }
        : { negative: false, digits: [remainder] },
  };
}
/** Divide `work` in place by `divisor`, returning the remainder. */
function divideInPlace(work: number[], divisor: number): number {
  let remainder = 0;
  for (let i = work.length - 1; i >= 0; i--) {
    const dividend = remainder * base + (work[i] ?? 0);
    const digit = Math.floor(dividend / divisor);
    work[i] = digit;
    remainder = dividend - digit * divisor;
  }
  while (work.length !== 0 && work[work.length - 1] === 0) work.pop();
  return remainder;
}
/** Truncates toward zero; undefined denotes division by zero. */
export function divide(a: Integer, b: Integer): Division | undefined {
  const aDigits = a.digits,
    bDigits = b.digits,
    aLen = aDigits.length,
    bLen = bDigits.length;
  if (bLen === 0) return undefined;
  const qNeg = a.negative !== b.negative;
  if (aLen === 0)
    return {
      quotient: { negative: false, digits: [] },
      remainder: { negative: false, digits: [] },
    };
  if (aLen <= 2 && bLen <= 2) {
    const av = (aDigits[0] ?? 0) + (aLen === 2 ? (aDigits[1] ?? 0) * base : 0);
    const bv = (bDigits[0] ?? 0) + (bLen === 2 ? (bDigits[1] ?? 0) * base : 0);
    const q = Math.floor(av / bv);
    const r = av - q * bv;
    return {
      quotient: fromMagnitude(qNeg, q),
      remainder: fromMagnitude(a.negative, r),
    };
  }
  let result: Division;
  if (bLen === 1) {
    result = divideDigit(aDigits, bDigits[0] ?? 1);
  } else {
    const cmp = magnitudeCompare(aDigits, bDigits);
    if (cmp < 0)
      return {
        quotient: { negative: false, digits: [] },
        remainder: a,
      };
    if (cmp === 0)
      return {
        quotient: { negative: qNeg, digits: [1] },
        remainder: { negative: false, digits: [] },
      };
    const digits: number[] = [];
    for (let i = 0; i < aLen; i++) digits.push(0);
    const rem: number[] = [];
    for (let i = aLen - 1; i >= 0; i--) {
      const digit = aDigits[i] ?? 0;
      let quotientDigit = 0;
      for (let shiftBit = 25; shiftBit >= 0; shiftBit--) {
        let carry = (digit >>> shiftBit) & 1;
        for (let k = 0; k < rem.length; k++) {
          const doubled = ((rem[k] ?? 0) << 1) | carry;
          rem[k] = doubled & baseMask;
          carry = doubled >>> 26;
        }
        if (carry !== 0) rem.push(carry);
        if (magnitudeCompare(rem, bDigits) >= 0) {
          subtractInPlace(rem, bDigits);
          quotientDigit |= 1 << shiftBit;
        }
      }
      digits[i] = quotientDigit;
    }
    result = {
      quotient: canonical(false, digits),
      remainder: canonical(false, rem),
    };
  }
  return {
    quotient: qNeg ? negate(result.quotient) : result.quotient,
    remainder: a.negative ? negate(result.remainder) : result.remainder,
  };
}
function validRadix(radix: number): boolean {
  return radix >= 2 && radix <= 36 && Math.floor(radix) === radix;
}
function charToDigit(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 90) return code - 55;
  if (code >= 97 && code <= 122) return code - 87;
  return -1;
}
/** Plain signed radix text; no prefixes, whitespace, separators or suffixes.
 * Language adapters apply their own lexical and StringToBigInt grammar. */
export function parseInteger(text: string, radix: number): Integer | undefined {
  const length = text.length;
  if (!validRadix(radix) || length === 0) return undefined;
  const firstCode = text.charCodeAt(0);
  const negative = firstCode === 45;
  let index = negative || firstCode === 43 ? 1 : 0;
  if (index === length) return undefined;
  // Skip leading zeros so short numbers with padding hit fast paths.
  while (index < length && text.charCodeAt(index) === 48) index++;
  if (index === length) return { negative: false, digits: [] };
  const remaining = length - index;
  if (
    (radix === 10 && remaining <= 15) ||
    (radix === 16 && remaining <= 13) ||
    (radix === 8 && remaining <= 17) ||
    (radix === 2 && remaining <= 52)
  ) {
    let acc = 0;
    for (; index < length; index++) {
      const digit = charToDigit(text.charCodeAt(index));
      if (digit < 0 || digit >= radix) return undefined;
      acc = acc * radix + digit;
    }
    return fromMagnitude(negative, acc);
  }
  if (radix === 2) {
    // Validate all characters and pack 26 bits per limb directly from right to left.
    for (let i = index; i < length; i++) {
      const c = text.charCodeAt(i);
      if (c !== 48 && c !== 49) return undefined;
    }
    const digits: number[] = [];
    let end = length;
    while (end > index) {
      const start = end - 26 > index ? end - 26 : index;
      let limb = 0;
      for (let i = start; i < end; i++) {
        limb = (limb << 1) | (text.charCodeAt(i) - 48);
      }
      digits.push(limb);
      end = start;
    }
    return canonical(negative, digits);
  }
  // Choose the largest chunk factor <= base so limb * chunkFactor < 2^52.
  let chunkDigits = 1;
  let chunkFactor = radix;
  while (chunkFactor * radix <= base) {
    chunkFactor *= radix;
    chunkDigits++;
  }
  const digits: number[] = [];
  while (index < length) {
    const chunkEnd =
      index + chunkDigits <= length ? index + chunkDigits : length;
    let chunkVal = 0;
    let factor = 1;
    for (; index < chunkEnd; index++) {
      const digit = charToDigit(text.charCodeAt(index));
      if (digit < 0 || digit >= radix) return undefined;
      chunkVal = chunkVal * radix + digit;
      factor *= radix;
    }
    scaleAndAddInPlace(digits, factor, chunkVal);
  }
  return canonical(negative, digits);
}
export function formatInteger(
  value: Integer,
  radix: number,
): string | undefined {
  if (!validRadix(radix)) return undefined;
  const src = value.digits,
    len = src.length;
  if (len === 0) return "0";
  if (radix === 10) {
    if (len === 1) {
      const text = String(src[0] ?? 0);
      return value.negative ? "-" + text : text;
    }
    if (len === 2) {
      const n = (src[0] ?? 0) + (src[1] ?? 0) * base;
      const text = String(n);
      return value.negative ? "-" + text : text;
    }
    const work: number[] = [];
    for (let i = 0; i < len; i++) work.push(src[i] ?? 0);
    const chunks: number[] = [];
    while (work.length !== 0) {
      chunks.push(divideInPlace(work, 10000000));
    }
    const parts: string[] = [];
    if (value.negative) parts.push("-");
    const top = chunks.length - 1;
    parts.push(String(chunks[top] ?? 0));
    for (let i = top - 1; i >= 0; i--) {
      const s = String(chunks[i] ?? 0);
      const pad = 7 - s.length;
      if (pad === 1) parts.push("0");
      else if (pad === 2) parts.push("00");
      else if (pad === 3) parts.push("000");
      else if (pad === 4) parts.push("0000");
      else if (pad === 5) parts.push("00000");
      else if (pad === 6) parts.push("000000");
      parts.push(s);
    }
    return parts.join("");
  }
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const work: number[] = [];
  for (let i = 0; i < len; i++) work.push(src[i] ?? 0);
  const characters: string[] = [];
  while (work.length !== 0) {
    const rem = divideInPlace(work, radix);
    characters.push(alphabet.charAt(rem));
  }
  const parts: string[] = [];
  if (value.negative) parts.push("-");
  for (let i = characters.length - 1; i >= 0; i--) {
    const ch = characters[i];
    if (ch !== undefined) parts.push(ch);
  }
  return parts.join("");
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
    const next = (complement ? baseMask - digit : digit) + carry;
    digits.push(next & baseMask);
    carry = next >>> 26;
  }
  return digits;
}
export function bitwise(
  a: Integer,
  b: Integer,
  operator: "&" | "|" | "^",
): Integer {
  const aDigits = a.digits,
    bDigits = b.digits,
    aLen = aDigits.length,
    bLen = bDigits.length;
  const aNeg = a.negative,
    bNeg = b.negative;
  if (!aNeg && !bNeg) {
    if (operator === "&") {
      const len = aLen < bLen ? aLen : bLen;
      if (len === 0) return { negative: false, digits: [] };
      if (len === 1) {
        const r0 = (aDigits[0] ?? 0) & (bDigits[0] ?? 0);
        return { negative: false, digits: r0 !== 0 ? [r0] : [] };
      }
      if (len === 2) {
        const r0 = (aDigits[0] ?? 0) & (bDigits[0] ?? 0);
        const r1 = (aDigits[1] ?? 0) & (bDigits[1] ?? 0);
        return {
          negative: false,
          digits: r1 !== 0 ? [r0, r1] : r0 !== 0 ? [r0] : [],
        };
      }
      if (len === 3) {
        const r0 = (aDigits[0] ?? 0) & (bDigits[0] ?? 0);
        const r1 = (aDigits[1] ?? 0) & (bDigits[1] ?? 0);
        const r2 = (aDigits[2] ?? 0) & (bDigits[2] ?? 0);
        return {
          negative: false,
          digits:
            r2 !== 0
              ? [r0, r1, r2]
              : r1 !== 0
                ? [r0, r1]
                : r0 !== 0
                  ? [r0]
                  : [],
        };
      }
      const digits: number[] = [];
      for (let i = 0; i < len; i++)
        digits.push((aDigits[i] ?? 0) & (bDigits[i] ?? 0));
      return canonical(false, digits);
    }
    const len = aLen > bLen ? aLen : bLen;
    if (len === 0) return { negative: false, digits: [] };
    if (operator === "|") {
      if (len === 1) {
        const r0 = (aDigits[0] ?? 0) | (bDigits[0] ?? 0);
        return { negative: false, digits: r0 !== 0 ? [r0] : [] };
      }
      if (len === 2) {
        const r0 = (aDigits[0] ?? 0) | (bDigits[0] ?? 0);
        const r1 = (aDigits[1] ?? 0) | (bDigits[1] ?? 0);
        return {
          negative: false,
          digits: r1 !== 0 ? [r0, r1] : r0 !== 0 ? [r0] : [],
        };
      }
      if (len === 3) {
        const r0 = (aDigits[0] ?? 0) | (bDigits[0] ?? 0);
        const r1 = (aDigits[1] ?? 0) | (bDigits[1] ?? 0);
        const r2 = (aDigits[2] ?? 0) | (bDigits[2] ?? 0);
        return {
          negative: false,
          digits:
            r2 !== 0
              ? [r0, r1, r2]
              : r1 !== 0
                ? [r0, r1]
                : r0 !== 0
                  ? [r0]
                  : [],
        };
      }
      const digits: number[] = [];
      for (let i = 0; i < len; i++)
        digits.push((aDigits[i] ?? 0) | (bDigits[i] ?? 0));
      return canonical(false, digits);
    }
    if (len === 1) {
      const r0 = (aDigits[0] ?? 0) ^ (bDigits[0] ?? 0);
      return { negative: false, digits: r0 !== 0 ? [r0] : [] };
    }
    if (len === 2) {
      const r0 = (aDigits[0] ?? 0) ^ (bDigits[0] ?? 0);
      const r1 = (aDigits[1] ?? 0) ^ (bDigits[1] ?? 0);
      return {
        negative: false,
        digits: r1 !== 0 ? [r0, r1] : r0 !== 0 ? [r0] : [],
      };
    }
    if (len === 3) {
      const r0 = (aDigits[0] ?? 0) ^ (bDigits[0] ?? 0);
      const r1 = (aDigits[1] ?? 0) ^ (bDigits[1] ?? 0);
      const r2 = (aDigits[2] ?? 0) ^ (bDigits[2] ?? 0);
      return {
        negative: false,
        digits:
          r2 !== 0 ? [r0, r1, r2] : r1 !== 0 ? [r0, r1] : r0 !== 0 ? [r0] : [],
      };
    }
    const digits: number[] = [];
    for (let i = 0; i < len; i++)
      digits.push((aDigits[i] ?? 0) ^ (bDigits[i] ?? 0));
    return canonical(false, digits);
  }
  const width = (aLen > bLen ? aLen : bLen) + 1;
  const negative =
    operator === "&"
      ? aNeg && bNeg
      : operator === "|"
        ? aNeg || bNeg
        : aNeg !== bNeg;
  let carryA = aNeg ? 1 : 0;
  let carryB = bNeg ? 1 : 0;
  let carryOut = negative ? 1 : 0;
  const digits: number[] = [];
  for (let i = 0; i < width; i++) {
    const ad = aDigits[i] ?? 0;
    let x = aNeg ? baseMask - ad + carryA : ad;
    carryA = x >>> 26;
    x &= baseMask;
    const bd = bDigits[i] ?? 0;
    let y = bNeg ? baseMask - bd + carryB : bd;
    carryB = y >>> 26;
    y &= baseMask;
    let r = operator === "&" ? x & y : operator === "|" ? x | y : x ^ y;
    if (negative) {
      r = baseMask - r + carryOut;
      carryOut = r >>> 26;
      r &= baseMask;
    }
    digits.push(r);
  }
  return canonical(negative, digits);
}
export function bitwiseNot(value: Integer): Integer {
  return addWithSign(negate(value), { negative: false, digits: [1] }, true);
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
  if (bits === 0 || value.digits.length === 0)
    return { negative: false, digits: [] };
  const magnitude = magnitudeBits(value.digits);
  if (
    (signed && bits > magnitude) ||
    (!signed && !value.negative && bits >= magnitude)
  )
    return withinCapacity(value, maxDigits);
  const partial = bits % 26;
  const width = Math.floor(bits / 26) + (partial === 0 ? 0 : 1);
  if (width > maxDigits) return undefined;
  const mask = partial === 0 ? baseMask : (1 << partial) - 1;
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
    if (count > Math.floor((limit - digit) * invBase)) return undefined;
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
  const vDigits = value.digits,
    vLen = vDigits.length;
  if (vLen === 0) return { negative: false, digits: [] };
  const cDigits = count.digits,
    cLen = cDigits.length;
  if (cLen === 0) return withinCapacity(value, maxDigits);
  const limit = (count.negative ? vLen : maxDigits) * 26;
  let distance: number | undefined;
  if (cLen === 1) {
    const d0 = cDigits[0] ?? 0;
    distance = d0 <= limit ? d0 : undefined;
  } else {
    distance = boundedCount(cDigits, limit);
  }
  if (distance === undefined) {
    if (!count.negative) return undefined;
    return withinCapacity(
      value.negative
        ? { negative: true, digits: [1] }
        : { negative: false, digits: [] },
      maxDigits,
    );
  }
  const whole = Math.floor(distance / 26),
    partial = distance - whole * 26;
  if (!count.negative) {
    if (partial === 0) {
      if (vLen + whole > maxDigits) return undefined;
      const digits: number[] = [];
      for (let i = 0; i < whole; i++) digits.push(0);
      for (let i = 0; i < vLen; i++) digits.push(vDigits[i] ?? 0);
      return { negative: value.negative, digits };
    }
    const shiftRight = 26 - partial;
    const top = vDigits[vLen - 1] ?? 0;
    const overflow = top >>> shiftRight !== 0 ? 1 : 0;
    if (vLen + whole + overflow > maxDigits) return undefined;
    if (whole === 0 && vLen === 1) {
      const d0 = vDigits[0] ?? 0;
      const lo = (d0 << partial) & baseMask;
      const hi = d0 >>> shiftRight;
      return {
        negative: value.negative,
        digits: hi !== 0 ? [lo, hi] : [lo],
      };
    }
    const digits: number[] = [];
    for (let i = 0; i < whole; i++) digits.push(0);
    let carry = 0;
    for (let i = 0; i < vLen; i++) {
      const d = vDigits[i] ?? 0;
      digits.push(((d << partial) & baseMask) | carry);
      carry = d >>> shiftRight;
    }
    if (carry !== 0) digits.push(carry);
    return canonical(value.negative, digits);
  }
  if (vLen - whole - 1 > maxDigits) return undefined;
  let discarded = false;
  if (value.negative) {
    for (let i = 0; i < whole && i < vLen; i++)
      if ((vDigits[i] ?? 0) !== 0) {
        discarded = true;
        break;
      }
  }
  const digits: number[] = [];
  if (partial === 0) {
    for (let i = whole; i < vLen; i++) digits.push(vDigits[i] ?? 0);
  } else {
    const shiftLeft = 26 - partial;
    const lowMask = (1 << partial) - 1;
    if (value.negative && !discarded && whole < vLen) {
      if (((vDigits[whole] ?? 0) & lowMask) !== 0) discarded = true;
    }
    for (let i = whole; i < vLen; i++) {
      const low = vDigits[i] ?? 0,
        high = vDigits[i + 1] ?? 0;
      digits.push((low >>> partial) | ((high & lowMask) << shiftLeft));
    }
  }
  const truncated = canonical(value.negative, digits);
  // Magnitude truncation needs one additional unit for negative nonintegral results.
  const result =
    value.negative && discarded
      ? addWithSign(truncated, { negative: false, digits: [1] }, true)
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
  if (value.digits.length === 0) return { negative: false, digits: [] };
  if (value.digits.length === 1 && value.digits[0] === 1)
    return withinCapacity(
      value.negative && ((exponent.digits[0] ?? 0) & 1) !== 0
        ? negate(one)
        : one,
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
  if (value === 0) return { negative: false, digits: [] };
  const negative = value < 0;
  let remaining = negative ? -value : value;
  if (remaining < base) return { negative, digits: [remaining] };
  if (remaining < twoLimbLimit) {
    const hi = Math.floor(remaining * invBase);
    return { negative, digits: [remaining - hi * base, hi] };
  }
  const digits: number[] = [];
  while (remaining !== 0) {
    const hi = Math.floor(remaining * invBase);
    digits.push(remaining - hi * base);
    remaining = hi;
  }
  return canonical(negative, digits);
}
function magnitudeBits(value: readonly number[]): number {
  if (value.length === 0) return 0;
  let top = value[value.length - 1] ?? 0,
    bits = (value.length - 1) * 26;
  while (top !== 0) {
    top >>>= 1;
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
  const digits = value.digits,
    len = digits.length;
  if (len === 0) return 0;
  if (len === 1) {
    const n = digits[0] ?? 0;
    return value.negative ? -n : n;
  }
  if (len === 2) {
    const n = (digits[0] ?? 0) + (digits[1] ?? 0) * base;
    return value.negative ? -n : n;
  }
  const bits = magnitudeBits(digits);
  if (bits > 1024) return value.negative ? -Infinity : Infinity;
  const discard = Math.max(0, bits - 53);
  const whole = Math.floor(discard / 26),
    partial = discard - whole * 26;
  const shiftLeft = 26 - partial;
  const lowMask = (1 << partial) - 1;
  let retained = 0;
  for (let i = len - 1; i >= whole; i--) {
    const low = digits[i] ?? 0;
    const high = digits[i + 1] ?? 0;
    const digit =
      partial === 0 ? low : (low >>> partial) | ((high & lowMask) << shiftLeft);
    retained = retained * base + digit;
  }
  if (discard !== 0) {
    const guardWord = Math.floor((discard - 1) / 26);
    const guardBit = discard - 1 - guardWord * 26;
    const guardDigit = digits[guardWord] ?? 0;
    let sticky = (guardDigit & ((1 << guardBit) - 1)) !== 0;
    for (let i = 0; i < guardWord && !sticky; i++)
      if ((digits[i] ?? 0) !== 0) sticky = true;
    if (((guardDigit >>> guardBit) & 1) !== 0 && (sticky || retained % 2 !== 0))
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
  const digits = value.digits,
    len = digits.length;
  if (len <= 2 && number > -twoLimbLimit && number < twoLimbLimit) {
    const mag =
      len === 0
        ? 0
        : (digits[0] ?? 0) + (len === 2 ? (digits[1] ?? 0) * base : 0);
    const av = value.negative ? -mag : mag;
    return av < number ? -1 : av > number ? 1 : 0;
  }
  const floor = Math.floor(number);
  const integer = fromNumber(floor);
  if (integer === undefined) throw "INTEGER_NUMBER_COMPARISON_INVARIANT";
  const order = compare(value, integer);
  return order !== 0 ? order : number === floor ? 0 : -1;
}
