/** Canonical signed magnitude: little-endian base-2^26 limbs, no leading zero.
 * Zero has len === 0 and is never negative. Values up to 4 limbs (104 bits,
 * covering all signed/unsigned 64-bit values and 96-bit arithmetic) store all
 * limbs inline in d0..d3 with `digits: undefined` (zero array or typed-array
 * allocation). Multi-limb values (len >= 5) also mirror their low 4 limbs into
 * d0..d3 so low-word extraction never branches on len. */
export interface Integer {
  readonly negative: boolean;
  readonly len: number;
  readonly d0: number;
  readonly d1: number;
  readonly d2: number;
  readonly d3: number;
  readonly digits: readonly number[] | undefined;
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

export function integerZero(): Integer {
  return {
    negative: false,
    len: 0,
    d0: 0,
    d1: 0,
    d2: 0,
    d3: 0,
    digits: undefined,
  };
}
export function integerOne(): Integer {
  return {
    negative: false,
    len: 1,
    d0: 1,
    d1: 0,
    d2: 0,
    d3: 0,
    digits: undefined,
  };
}

export function createInlineInteger(
  negative: boolean,
  len: number,
  d0: number,
  d1: number,
  d2: number,
  d3: number,
): Integer {
  if (len === 0) return integerZero();
  return { negative, len, d0, d1, d2, d3, digits: undefined };
}
function inline1(negative: boolean, d0: number): Integer {
  if (d0 === 0) return integerZero();
  return { negative, len: 1, d0, d1: 0, d2: 0, d3: 0, digits: undefined };
}
function inline2(negative: boolean, d0: number, d1: number): Integer {
  if (d1 !== 0)
    return { negative, len: 2, d0, d1, d2: 0, d3: 0, digits: undefined };
  if (d0 !== 0)
    return { negative, len: 1, d0, d1: 0, d2: 0, d3: 0, digits: undefined };
  return integerZero();
}
function inline3(
  negative: boolean,
  d0: number,
  d1: number,
  d2: number,
): Integer {
  if (d2 !== 0)
    return { negative, len: 3, d0, d1, d2, d3: 0, digits: undefined };
  if (d1 !== 0)
    return { negative, len: 2, d0, d1, d2: 0, d3: 0, digits: undefined };
  if (d0 !== 0)
    return { negative, len: 1, d0, d1: 0, d2: 0, d3: 0, digits: undefined };
  return integerZero();
}
function inline4(
  negative: boolean,
  d0: number,
  d1: number,
  d2: number,
  d3: number,
): Integer {
  if (d3 !== 0) return { negative, len: 4, d0, d1, d2, d3, digits: undefined };
  if (d2 !== 0)
    return { negative, len: 3, d0, d1, d2, d3: 0, digits: undefined };
  if (d1 !== 0)
    return { negative, len: 2, d0, d1, d2: 0, d3: 0, digits: undefined };
  if (d0 !== 0)
    return { negative, len: 1, d0, d1: 0, d2: 0, d3: 0, digits: undefined };
  return integerZero();
}
export function integerLength(value: Integer): number {
  return value.len;
}
export function integerDigit(value: Integer, index: number): number {
  if (index === 0) return value.d0;
  if (index === 1) return value.d1;
  if (index === 2) return value.d2;
  if (index === 3) return value.d3;
  const digits = value.digits;
  return digits === undefined ? 0 : (digits[index] ?? 0);
}
export function integerTopDigit(value: Integer): number {
  const len = value.len;
  if (len === 0) return 0;
  return integerDigit(value, len - 1);
}
export function integerHash(value: Integer): number {
  const len = value.len;
  let hash = value.negative ? 0x811c9dc5 : 0x9e3779b1;
  if (len === 0) return hash;
  hash = Math.imul(hash ^ value.d0, 0x01000193) >>> 0;
  if (len === 1) return hash;
  hash = Math.imul(hash ^ value.d1, 0x01000193) >>> 0;
  if (len === 2) return hash;
  hash = Math.imul(hash ^ value.d2, 0x01000193) >>> 0;
  if (len === 3) return hash;
  hash = Math.imul(hash ^ value.d3, 0x01000193) >>> 0;
  if (len === 4) return hash;
  const digits = value.digits;
  if (digits !== undefined) {
    for (let i = 4; i < len; i++) {
      hash = Math.imul(hash ^ (digits[i] ?? 0), 0x01000193) >>> 0;
    }
  }
  return hash;
}
export function integerFromDigits(
  negative: boolean,
  digits: number[],
): Integer {
  while (digits.length !== 0 && digits[digits.length - 1] === 0) digits.pop();
  const len = digits.length;
  if (len === 0) return integerZero();
  const d0 = digits[0] ?? 0,
    d1 = digits[1] ?? 0,
    d2 = digits[2] ?? 0,
    d3 = digits[3] ?? 0;
  if (len <= 4) return { negative, len, d0, d1, d2, d3, digits: undefined };
  return { negative, len, d0, d1, d2, d3, digits };
}
function canonical(negative: boolean, digits: number[]): Integer {
  return integerFromDigits(negative, digits);
}
function fromMagnitude(negative: boolean, magnitude: number): Integer {
  if (magnitude === 0) return integerZero();
  if (magnitude < base)
    return {
      negative,
      len: 1,
      d0: magnitude,
      d1: 0,
      d2: 0,
      d3: 0,
      digits: undefined,
    };
  const hi = Math.floor(magnitude * invBase);
  const lo = magnitude - hi * base;
  if (hi < base)
    return {
      negative,
      len: 2,
      d0: lo,
      d1: hi,
      d2: 0,
      d3: 0,
      digits: undefined,
    };
  const d2 = Math.floor(hi * invBase);
  return {
    negative,
    len: 3,
    d0: lo,
    d1: hi - d2 * base,
    d2,
    d3: 0,
    digits: undefined,
  };
}
function magnitudeCompare(a: Integer, b: Integer): number {
  const aLen = a.len,
    bLen = b.len;
  if (aLen !== bLen) return aLen < bLen ? -1 : 1;
  if (aLen === 0) return 0;
  if (aLen <= 4) {
    if (aLen === 4 && a.d3 !== b.d3) return a.d3 < b.d3 ? -1 : 1;
    if (aLen >= 3 && a.d2 !== b.d2) return a.d2 < b.d2 ? -1 : 1;
    if (aLen >= 2 && a.d1 !== b.d1) return a.d1 < b.d1 ? -1 : 1;
    return a.d0 === b.d0 ? 0 : a.d0 < b.d0 ? -1 : 1;
  }
  const ad = a.digits,
    bd = b.digits;
  if (ad === undefined || bd === undefined) return 0;
  for (let i = aLen - 1; i >= 0; i--) {
    const x = ad[i] ?? 0,
      y = bd[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
function arrayMagnitudeCompare(a: readonly number[], b: Integer): number {
  const aLen = a.length,
    bLen = b.len;
  if (aLen !== bLen) return aLen < bLen ? -1 : 1;
  for (let i = aLen - 1; i >= 0; i--) {
    const x = a[i] ?? 0,
      y = integerDigit(b, i);
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
export function compare(a: Integer, b: Integer): number {
  if (a.negative !== b.negative) return a.negative ? -1 : 1;
  const order = magnitudeCompare(a, b);
  return order === 0 ? 0 : a.negative ? -order : order;
}
function magnitudeAdd(a: Integer, b: Integer): number[] {
  const aLen = a.len,
    bLen = b.len,
    maxLen = aLen > bLen ? aLen : bLen;
  const digits: number[] = [];
  let carry = 0;
  for (let i = 0; i < maxLen; i++) {
    const sum = integerDigit(a, i) + integerDigit(b, i) + carry;
    digits.push(sum & baseMask);
    carry = sum >>> 26;
  }
  if (carry !== 0) digits.push(carry);
  return digits;
}
/** Requires |a| >= |b|. */
function magnitudeSubtract(a: Integer, b: Integer): number[] {
  const aLen = a.len;
  const digits: number[] = [];
  let borrow = 0;
  for (let i = 0; i < aLen; i++) {
    const difference = integerDigit(a, i) - integerDigit(b, i) - borrow;
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
  if (value.len === 0) return integerZero();
  return {
    negative: !value.negative,
    len: value.len,
    d0: value.d0,
    d1: value.d1,
    d2: value.d2,
    d3: value.d3,
    digits: value.digits,
  };
}
function addWithSign(a: Integer, b: Integer, bNeg: boolean): Integer {
  const aLen = a.len,
    bLen = b.len;
  if (aLen === 0) {
    if (bLen === 0) return integerZero();
    return bNeg === b.negative
      ? b
      : {
          negative: bNeg,
          len: bLen,
          d0: b.d0,
          d1: b.d1,
          d2: b.d2,
          d3: b.d3,
          digits: b.digits,
        };
  }
  if (bLen === 0) return a;
  if (aLen <= 2 && bLen <= 2) {
    const am = a.d0 + (aLen === 2 ? a.d1 * base : 0);
    const bm = b.d0 + (bLen === 2 ? b.d1 * base : 0);
    if (a.negative === bNeg) return fromMagnitude(a.negative, am + bm);
    if (am === bm) return integerZero();
    return am > bm
      ? fromMagnitude(a.negative, am - bm)
      : fromMagnitude(bNeg, bm - am);
  }
  if (aLen <= 4 && bLen <= 4) {
    if (a.negative === bNeg) {
      const s0 = a.d0 + b.d0;
      const r0 = s0 & baseMask;
      const s1 = a.d1 + b.d1 + (s0 >>> 26);
      const r1 = s1 & baseMask;
      const s2 = a.d2 + b.d2 + (s1 >>> 26);
      const r2 = s2 & baseMask;
      const s3 = a.d3 + b.d3 + (s2 >>> 26);
      const r3 = s3 & baseMask;
      const c3 = s3 >>> 26;
      if (c3 === 0) return inline4(a.negative, r0, r1, r2, r3);
      return {
        negative: a.negative,
        len: 5,
        d0: r0,
        d1: r1,
        d2: r2,
        d3: r3,
        digits: [r0, r1, r2, r3, c3],
      };
    }
    const cmp = magnitudeCompare(a, b);
    if (cmp === 0) return integerZero();
    const hi = cmp > 0 ? a : b;
    const lo = cmp > 0 ? b : a;
    const neg = cmp > 0 ? a.negative : bNeg;
    let d0 = hi.d0 - lo.d0;
    let borrow = 0;
    if (d0 < 0) {
      d0 += base;
      borrow = 1;
    }
    let d1 = hi.d1 - lo.d1 - borrow;
    if (d1 < 0) {
      d1 += base;
      borrow = 1;
    } else borrow = 0;
    let d2 = hi.d2 - lo.d2 - borrow;
    if (d2 < 0) {
      d2 += base;
      borrow = 1;
    } else borrow = 0;
    const d3 = hi.d3 - lo.d3 - borrow;
    return inline4(neg, d0, d1, d2, d3);
  }
  if (a.negative === bNeg) return canonical(a.negative, magnitudeAdd(a, b));
  const cmp = magnitudeCompare(a, b);
  if (cmp === 0) return integerZero();
  return cmp > 0
    ? canonical(a.negative, magnitudeSubtract(a, b))
    : canonical(bNeg, magnitudeSubtract(b, a));
}
export function add(a: Integer, b: Integer): Integer {
  return addWithSign(a, b, b.negative);
}
export function subtract(a: Integer, b: Integer): Integer {
  return addWithSign(a, b, !b.negative);
}
function multiplyInlineByOne(
  negative: boolean,
  a: Integer,
  factor: number,
): Integer {
  const p0 = a.d0 * factor;
  const c0 = Math.floor(p0 * invBase);
  const r0 = p0 - c0 * base;
  const p1 = a.d1 * factor + c0;
  const c1 = Math.floor(p1 * invBase);
  const r1 = p1 - c1 * base;
  const p2 = a.d2 * factor + c1;
  const c2 = Math.floor(p2 * invBase);
  const r2 = p2 - c2 * base;
  const p3 = a.d3 * factor + c2;
  const c3 = Math.floor(p3 * invBase);
  const r3 = p3 - c3 * base;
  if (c3 === 0) return inline4(negative, r0, r1, r2, r3);
  return {
    negative,
    len: 5,
    d0: r0,
    d1: r1,
    d2: r2,
    d3: r3,
    digits: [r0, r1, r2, r3, c3],
  };
}
export function multiply(a: Integer, b: Integer): Integer {
  const aLen = a.len,
    bLen = b.len;
  if (aLen === 0 || bLen === 0) return integerZero();
  const negative = a.negative !== b.negative;
  if (aLen === 1 && bLen === 1) {
    const product = a.d0 * b.d0;
    const hi = Math.floor(product * invBase);
    return inline2(negative, product - hi * base, hi);
  }
  if (bLen === 1 && aLen <= 4) return multiplyInlineByOne(negative, a, b.d0);
  if (aLen === 1 && bLen <= 4) return multiplyInlineByOne(negative, b, a.d0);
  if (aLen <= 2 && bLen <= 2) {
    const p00 = a.d0 * b.d0;
    const c0 = Math.floor(p00 * invBase);
    const r0 = p00 - c0 * base;
    const p01 = a.d0 * b.d1 + c0;
    const c01 = Math.floor(p01 * invBase);
    const t1 = p01 - c01 * base;
    const p10 = a.d1 * b.d0 + t1;
    const c10 = Math.floor(p10 * invBase);
    const r1 = p10 - c10 * base;
    const p11 = a.d1 * b.d1 + c01 + c10;
    const r3 = Math.floor(p11 * invBase);
    const r2 = p11 - r3 * base;
    return inline4(negative, r0, r1, r2, r3);
  }
  if (aLen <= 4 && bLen <= 4) {
    const a0 = a.d0,
      a1 = a.d1,
      a2 = a.d2,
      a3 = a.d3;
    const b0 = b.d0,
      b1 = b.d1,
      b2 = b.d2,
      b3 = b.d3;
    // Row 0: a0 * b[0..3]
    let t = a0 * b0;
    let c = Math.floor(t * invBase);
    const r0 = t - c * base;
    t = a0 * b1 + c;
    c = Math.floor(t * invBase);
    let r1 = t - c * base;
    t = a0 * b2 + c;
    c = Math.floor(t * invBase);
    let r2 = t - c * base;
    t = a0 * b3 + c;
    let r4 = Math.floor(t * invBase);
    let r3 = t - r4 * base;
    // Row 1: a1 * b[0..3]
    let r5 = 0,
      r6 = 0,
      r7 = 0;
    if (a1 !== 0) {
      t = a1 * b0 + r1;
      c = Math.floor(t * invBase);
      r1 = t - c * base;
      t = a1 * b1 + r2 + c;
      c = Math.floor(t * invBase);
      r2 = t - c * base;
      t = a1 * b2 + r3 + c;
      c = Math.floor(t * invBase);
      r3 = t - c * base;
      t = a1 * b3 + r4 + c;
      r5 = Math.floor(t * invBase);
      r4 = t - r5 * base;
    }
    // Row 2: a2 * b[0..3]
    if (a2 !== 0) {
      t = a2 * b0 + r2;
      c = Math.floor(t * invBase);
      r2 = t - c * base;
      t = a2 * b1 + r3 + c;
      c = Math.floor(t * invBase);
      r3 = t - c * base;
      t = a2 * b2 + r4 + c;
      c = Math.floor(t * invBase);
      r4 = t - c * base;
      t = a2 * b3 + r5 + c;
      r6 = Math.floor(t * invBase);
      r5 = t - r6 * base;
    }
    // Row 3: a3 * b[0..3]
    if (a3 !== 0) {
      t = a3 * b0 + r3;
      c = Math.floor(t * invBase);
      r3 = t - c * base;
      t = a3 * b1 + r4 + c;
      c = Math.floor(t * invBase);
      r4 = t - c * base;
      t = a3 * b2 + r5 + c;
      c = Math.floor(t * invBase);
      r5 = t - c * base;
      t = a3 * b3 + r6 + c;
      r7 = Math.floor(t * invBase);
      r6 = t - r7 * base;
    }
    if (r7 !== 0)
      return {
        negative,
        len: 8,
        d0: r0,
        d1: r1,
        d2: r2,
        d3: r3,
        digits: [r0, r1, r2, r3, r4, r5, r6, r7],
      };
    if (r6 !== 0)
      return {
        negative,
        len: 7,
        d0: r0,
        d1: r1,
        d2: r2,
        d3: r3,
        digits: [r0, r1, r2, r3, r4, r5, r6],
      };
    if (r5 !== 0)
      return {
        negative,
        len: 6,
        d0: r0,
        d1: r1,
        d2: r2,
        d3: r3,
        digits: [r0, r1, r2, r3, r4, r5],
      };
    if (r4 !== 0)
      return {
        negative,
        len: 5,
        d0: r0,
        d1: r1,
        d2: r2,
        d3: r3,
        digits: [r0, r1, r2, r3, r4],
      };
    return inline4(negative, r0, r1, r2, r3);
  }
  const totalLen = aLen + bLen;
  const digits: number[] = [];
  for (let i = 0; i < totalLen; i++) digits.push(0);
  for (let i = 0; i < aLen; i++) {
    const ai = integerDigit(a, i);
    if (ai === 0) continue;
    let carry = 0;
    for (let j = 0; j < bLen; j++) {
      const product = ai * integerDigit(b, j) + (digits[i + j] ?? 0) + carry;
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
function subtractInPlace(a: number[], b: Integer): void {
  const aLen = a.length;
  let borrow = 0;
  for (let i = 0; i < aLen; i++) {
    const difference = (a[i] ?? 0) - integerDigit(b, i) - borrow;
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
function divideDigit(value: Integer, divisor: number): Division {
  const len = value.len;
  if (len <= 4) {
    let rem = 0;
    let q3 = 0;
    if (len >= 4) {
      const div3 = value.d3;
      q3 = Math.floor(div3 / divisor);
      rem = div3 - q3 * divisor;
    }
    let q2 = 0;
    if (len >= 3) {
      const div2 = rem * base + value.d2;
      q2 = Math.floor(div2 / divisor);
      rem = div2 - q2 * divisor;
    }
    let q1 = 0;
    if (len >= 2) {
      const div1 = rem * base + value.d1;
      q1 = Math.floor(div1 / divisor);
      rem = div1 - q1 * divisor;
    }
    const div0 = rem * base + value.d0;
    const q0 = Math.floor(div0 / divisor);
    rem = div0 - q0 * divisor;
    return {
      quotient: inline4(false, q0, q1, q2, q3),
      remainder: inline1(false, rem),
    };
  }
  const digits: number[] = [];
  for (let i = 0; i < len; i++) digits.push(0);
  let remainder = 0;
  for (let i = len - 1; i >= 0; i--) {
    const dividend = remainder * base + integerDigit(value, i);
    const digit = Math.floor(dividend / divisor);
    digits[i] = digit;
    remainder = dividend - digit * divisor;
  }
  return {
    quotient: canonical(false, digits),
    remainder: inline1(false, remainder),
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
  const aLen = a.len,
    bLen = b.len;
  if (bLen === 0) return undefined;
  const qNeg = a.negative !== b.negative;
  if (aLen === 0) return { quotient: integerZero(), remainder: integerZero() };
  if (aLen <= 2 && bLen <= 2) {
    const av = a.d0 + (aLen === 2 ? a.d1 * base : 0);
    const bv = b.d0 + (bLen === 2 ? b.d1 * base : 0);
    const q = Math.floor(av / bv);
    const r = av - q * bv;
    return {
      quotient: fromMagnitude(qNeg, q),
      remainder: fromMagnitude(a.negative, r),
    };
  }
  let result: Division;
  if (bLen === 1) {
    result = divideDigit(a, b.d0);
  } else {
    const cmp = magnitudeCompare(a, b);
    if (cmp < 0) return { quotient: integerZero(), remainder: a };
    if (cmp === 0)
      return {
        quotient: inline1(qNeg, 1),
        remainder: integerZero(),
      };
    const digits: number[] = [];
    for (let i = 0; i < aLen; i++) digits.push(0);
    const rem: number[] = [];
    for (let i = aLen - 1; i >= 0; i--) {
      const digit = integerDigit(a, i);
      let quotientDigit = 0;
      for (let shiftBit = 25; shiftBit >= 0; shiftBit--) {
        let carry = (digit >>> shiftBit) & 1;
        for (let k = 0; k < rem.length; k++) {
          const doubled = ((rem[k] ?? 0) << 1) | carry;
          rem[k] = doubled & baseMask;
          carry = doubled >>> 26;
        }
        if (carry !== 0) rem.push(carry);
        if (arrayMagnitudeCompare(rem, b) >= 0) {
          subtractInPlace(rem, b);
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
/** Quotient-only division, avoiding remainder/Division allocations on 1-limb divisors. */
export function divideQuotient(a: Integer, b: Integer): Integer | undefined {
  const aLen = a.len,
    bLen = b.len;
  if (bLen === 0) return undefined;
  if (aLen === 0) return integerZero();
  const qNeg = a.negative !== b.negative;
  if (aLen <= 2 && bLen <= 2) {
    const av = a.d0 + (aLen === 2 ? a.d1 * base : 0);
    const bv = b.d0 + (bLen === 2 ? b.d1 * base : 0);
    return fromMagnitude(qNeg, Math.floor(av / bv));
  }
  if (bLen === 1) {
    const divisor = b.d0;
    if (aLen <= 4) {
      let rem = 0;
      let q3 = 0;
      if (aLen >= 4) {
        q3 = Math.floor(a.d3 / divisor);
        rem = a.d3 - q3 * divisor;
      }
      let q2 = 0;
      if (aLen >= 3) {
        const div2 = rem * base + a.d2;
        q2 = Math.floor(div2 / divisor);
        rem = div2 - q2 * divisor;
      }
      let q1 = 0;
      if (aLen >= 2) {
        const div1 = rem * base + a.d1;
        q1 = Math.floor(div1 / divisor);
        rem = div1 - q1 * divisor;
      }
      const q0 = Math.floor((rem * base + a.d0) / divisor);
      return inline4(qNeg, q0, q1, q2, q3);
    }
    const digits: number[] = [];
    for (let i = 0; i < aLen; i++) digits.push(0);
    let rem = 0;
    for (let i = aLen - 1; i >= 0; i--) {
      const dividend = rem * base + integerDigit(a, i);
      const q = Math.floor(dividend / divisor);
      digits[i] = q;
      rem = dividend - q * divisor;
    }
    return canonical(qNeg, digits);
  }
  const result = divide(a, b);
  return result === undefined ? undefined : result.quotient;
}
/** Remainder-only division, avoiding quotient array allocations on 1-limb divisors. */
export function divideRemainder(a: Integer, b: Integer): Integer | undefined {
  const aLen = a.len,
    bLen = b.len;
  if (bLen === 0) return undefined;
  if (aLen === 0) return integerZero();
  if (aLen <= 2 && bLen <= 2) {
    const av = a.d0 + (aLen === 2 ? a.d1 * base : 0);
    const bv = b.d0 + (bLen === 2 ? b.d1 * base : 0);
    const q = Math.floor(av / bv);
    return fromMagnitude(a.negative, av - q * bv);
  }
  if (bLen === 1) {
    const divisor = b.d0;
    if (aLen <= 4) {
      let rem = 0;
      if (aLen >= 4) {
        rem = a.d3 - Math.floor(a.d3 / divisor) * divisor;
      }
      if (aLen >= 3) {
        const div2 = rem * base + a.d2;
        rem = div2 - Math.floor(div2 / divisor) * divisor;
      }
      if (aLen >= 2) {
        const div1 = rem * base + a.d1;
        rem = div1 - Math.floor(div1 / divisor) * divisor;
      }
      const div0 = rem * base + a.d0;
      rem = div0 - Math.floor(div0 / divisor) * divisor;
      return inline1(a.negative, rem);
    }
    let rem = 0;
    for (let i = aLen - 1; i >= 0; i--) {
      const dividend = rem * base + integerDigit(a, i);
      rem = dividend - Math.floor(dividend / divisor) * divisor;
    }
    return inline1(a.negative, rem);
  }
  const result = divide(a, b);
  return result === undefined ? undefined : result.remainder;
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
/** Plain signed radix text over `text[start..end)`; no prefixes, whitespace,
 * separators or suffixes. */
export function parseIntegerSlice(
  text: string,
  start: number,
  end: number,
  radix: number,
): Integer | undefined {
  if (!validRadix(radix) || start >= end) return undefined;
  const firstCode = text.charCodeAt(start);
  const negative = firstCode === 45;
  let index = negative || firstCode === 43 ? start + 1 : start;
  if (index === end) return undefined;
  // Skip leading zeros so short numbers with padding hit fast paths.
  while (index < end && text.charCodeAt(index) === 48) index++;
  if (index === end) return integerZero();
  const remaining = end - index;
  if (
    (radix === 10 && remaining <= 15) ||
    (radix === 16 && remaining <= 13) ||
    (radix === 8 && remaining <= 17) ||
    (radix === 2 && remaining <= 52)
  ) {
    let acc = 0;
    for (; index < end; index++) {
      const digit = charToDigit(text.charCodeAt(index));
      if (digit < 0 || digit >= radix) return undefined;
      acc = acc * radix + digit;
    }
    return fromMagnitude(negative, acc);
  }
  if (radix === 10 && remaining <= 31) {
    // Up to 31 decimal digits (< 10^31 < 2^104) fit in 4 inline 26-bit limbs.
    let d0 = 0,
      d1 = 0,
      d2 = 0,
      d3 = 0;
    while (index < end) {
      const chunkEnd = index + 7 <= end ? index + 7 : end;
      let chunkVal = 0;
      let factor = 1;
      for (; index < chunkEnd; index++) {
        const c = text.charCodeAt(index);
        if (c < 48 || c > 57) return undefined;
        chunkVal = chunkVal * 10 + (c - 48);
        factor *= 10;
      }
      const p0 = d0 * factor + chunkVal;
      const c0 = Math.floor(p0 * invBase);
      d0 = p0 - c0 * base;
      const p1 = d1 * factor + c0;
      const c1 = Math.floor(p1 * invBase);
      d1 = p1 - c1 * base;
      const p2 = d2 * factor + c1;
      const c2 = Math.floor(p2 * invBase);
      d2 = p2 - c2 * base;
      d3 = d3 * factor + c2;
    }
    return inline4(negative, d0, d1, d2, d3);
  }
  if (radix === 16) {
    if (remaining <= 26) {
      // Up to 104 bits packed directly into 4 inline 26-bit limbs (zero arrays).
      let d0 = 0,
        d1 = 0,
        d2 = 0,
        d3 = 0;
      let bitPos = 0;
      for (let i = end - 1; i >= index; i--) {
        const nib = charToDigit(text.charCodeAt(i));
        if (nib < 0 || nib >= 16) return undefined;
        const limb = Math.floor(bitPos / 26);
        const shiftBits = bitPos - limb * 26;
        const loPart = (nib << shiftBits) & baseMask;
        const hiPart = shiftBits > 22 ? nib >>> (26 - shiftBits) : 0;
        if (limb === 0) {
          d0 |= loPart;
          if (hiPart !== 0) d1 |= hiPart;
        } else if (limb === 1) {
          d1 |= loPart;
          if (hiPart !== 0) d2 |= hiPart;
        } else if (limb === 2) {
          d2 |= loPart;
          if (hiPart !== 0) d3 |= hiPart;
        } else {
          d3 |= loPart;
        }
        bitPos += 4;
      }
      return inline4(negative, d0, d1, d2, d3);
    }
    // Pack arbitrary hex directly into 26-bit limbs from right to left (zero division).
    const digits: number[] = [];
    let limb = 0;
    let bits = 0;
    for (let i = end - 1; i >= index; i--) {
      const nib = charToDigit(text.charCodeAt(i));
      if (nib < 0 || nib >= 16) return undefined;
      limb |= (nib << bits) & baseMask;
      bits += 4;
      if (bits >= 26) {
        digits.push(limb);
        bits -= 26;
        limb = bits > 0 ? nib >>> (4 - bits) : 0;
      }
    }
    if (limb !== 0) digits.push(limb);
    return canonical(negative, digits);
  }
  if (radix === 8 && remaining <= 34) {
    // Up to 102 bits packed directly into 4 inline 26-bit limbs (zero arrays).
    let d0 = 0,
      d1 = 0,
      d2 = 0,
      d3 = 0;
    let bitPos = 0;
    for (let i = end - 1; i >= index; i--) {
      const c = text.charCodeAt(i);
      if (c < 48 || c > 55) return undefined;
      const oct = c - 48;
      const limb = Math.floor(bitPos / 26);
      const shiftBits = bitPos - limb * 26;
      const loPart = (oct << shiftBits) & baseMask;
      const hiPart = shiftBits > 23 ? oct >>> (26 - shiftBits) : 0;
      if (limb === 0) {
        d0 |= loPart;
        if (hiPart !== 0) d1 |= hiPart;
      } else if (limb === 1) {
        d1 |= loPart;
        if (hiPart !== 0) d2 |= hiPart;
      } else if (limb === 2) {
        d2 |= loPart;
        if (hiPart !== 0) d3 |= hiPart;
      } else {
        d3 |= loPart;
      }
      bitPos += 3;
    }
    return inline4(negative, d0, d1, d2, d3);
  }
  if (radix === 2) {
    if (remaining <= 104) {
      let d0 = 0,
        d1 = 0,
        d2 = 0,
        d3 = 0;
      let bitPos = 0;
      for (let i = end - 1; i >= index; i--) {
        const c = text.charCodeAt(i);
        if (c !== 48 && c !== 49) return undefined;
        if (c === 49) {
          const limb = Math.floor(bitPos / 26);
          const bit = 1 << (bitPos - limb * 26);
          if (limb === 0) d0 |= bit;
          else if (limb === 1) d1 |= bit;
          else if (limb === 2) d2 |= bit;
          else d3 |= bit;
        }
        bitPos++;
      }
      return inline4(negative, d0, d1, d2, d3);
    }
    // Validate all characters and pack 26 bits per limb directly from right to left.
    for (let i = index; i < end; i++) {
      const c = text.charCodeAt(i);
      if (c !== 48 && c !== 49) return undefined;
    }
    const digits: number[] = [];
    let pos = end;
    while (pos > index) {
      const chunkStart = pos - 26 > index ? pos - 26 : index;
      let limb = 0;
      for (let i = chunkStart; i < pos; i++) {
        limb = (limb << 1) | (text.charCodeAt(i) - 48);
      }
      digits.push(limb);
      pos = chunkStart;
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
  while (index < end) {
    const chunkEnd = index + chunkDigits <= end ? index + chunkDigits : end;
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
/** Plain signed radix text; no prefixes, whitespace, separators or suffixes.
 * Language adapters apply their own lexical and StringToBigInt grammar. */
export function parseInteger(text: string, radix: number): Integer | undefined {
  return parseIntegerSlice(text, 0, text.length, radix);
}
export function formatInteger(
  value: Integer,
  radix: number,
): string | undefined {
  if (!validRadix(radix)) return undefined;
  const len = value.len;
  if (len === 0) return "0";
  if (radix === 10) {
    if (len === 1) {
      const text = String(value.d0);
      return value.negative ? "-" + text : text;
    }
    if (len === 2) {
      const n = value.d0 + value.d1 * base;
      const text = String(n);
      return value.negative ? "-" + text : text;
    }
    const work: number[] = [];
    for (let i = 0; i < len; i++) work.push(integerDigit(value, i));
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
  for (let i = 0; i < len; i++) work.push(integerDigit(value, i));
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
  value: Integer,
  complement: boolean,
  width: number,
): number[] {
  const digits: number[] = [];
  let carry = complement ? 1 : 0;
  for (let i = 0; i < width; i++) {
    const digit = integerDigit(value, i);
    const next = (complement ? baseMask - digit : digit) + carry;
    digits.push(next & baseMask);
    carry = next >>> 26;
  }
  return digits;
}
function extendArrayComplement(
  value: readonly number[],
  width: number,
): number[] {
  const digits: number[] = [];
  let carry = 1;
  for (let i = 0; i < width; i++) {
    const digit = value[i] ?? 0;
    const next = baseMask - digit + carry;
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
  const aLen = a.len,
    bLen = b.len;
  const aNeg = a.negative,
    bNeg = b.negative;
  if (!aNeg && !bNeg) {
    if (operator === "&") {
      const len = aLen < bLen ? aLen : bLen;
      if (len === 0) return integerZero();
      if (len <= 4) {
        const r0 = a.d0 & b.d0;
        if (len === 1) return inline1(false, r0);
        const r1 = a.d1 & b.d1;
        if (len === 2) return inline2(false, r0, r1);
        const r2 = a.d2 & b.d2;
        if (len === 3) return inline3(false, r0, r1, r2);
        return inline4(false, r0, r1, r2, a.d3 & b.d3);
      }
      const digits: number[] = [];
      for (let i = 0; i < len; i++)
        digits.push(integerDigit(a, i) & integerDigit(b, i));
      return canonical(false, digits);
    }
    const len = aLen > bLen ? aLen : bLen;
    if (len === 0) return integerZero();
    if (len <= 4) {
      if (operator === "|") {
        const r0 = a.d0 | b.d0;
        if (len === 1) return inline1(false, r0);
        const r1 = a.d1 | b.d1;
        if (len === 2) return inline2(false, r0, r1);
        const r2 = a.d2 | b.d2;
        if (len === 3) return inline3(false, r0, r1, r2);
        return inline4(false, r0, r1, r2, a.d3 | b.d3);
      }
      const r0 = a.d0 ^ b.d0;
      if (len === 1) return inline1(false, r0);
      const r1 = a.d1 ^ b.d1;
      if (len === 2) return inline2(false, r0, r1);
      const r2 = a.d2 ^ b.d2;
      if (len === 3) return inline3(false, r0, r1, r2);
      return inline4(false, r0, r1, r2, a.d3 ^ b.d3);
    }
    const digits: number[] = [];
    if (operator === "|") {
      for (let i = 0; i < len; i++)
        digits.push(integerDigit(a, i) | integerDigit(b, i));
    } else {
      for (let i = 0; i < len; i++)
        digits.push(integerDigit(a, i) ^ integerDigit(b, i));
    }
    return canonical(false, digits);
  }
  const negative =
    operator === "&"
      ? aNeg && bNeg
      : operator === "|"
        ? aNeg || bNeg
        : aNeg !== bNeg;
  if (aLen <= 4 && bLen <= 4) {
    let carryA = aNeg ? 1 : 0;
    let carryB = bNeg ? 1 : 0;
    let carryOut = negative ? 1 : 0;
    let x = aNeg ? baseMask - a.d0 + carryA : a.d0;
    carryA = x >>> 26;
    x &= baseMask;
    let y = bNeg ? baseMask - b.d0 + carryB : b.d0;
    carryB = y >>> 26;
    y &= baseMask;
    let r0 = operator === "&" ? x & y : operator === "|" ? x | y : x ^ y;
    if (negative) {
      r0 = baseMask - r0 + carryOut;
      carryOut = r0 >>> 26;
      r0 &= baseMask;
    }
    x = aNeg ? baseMask - a.d1 + carryA : a.d1;
    carryA = x >>> 26;
    x &= baseMask;
    y = bNeg ? baseMask - b.d1 + carryB : b.d1;
    carryB = y >>> 26;
    y &= baseMask;
    let r1 = operator === "&" ? x & y : operator === "|" ? x | y : x ^ y;
    if (negative) {
      r1 = baseMask - r1 + carryOut;
      carryOut = r1 >>> 26;
      r1 &= baseMask;
    }
    x = aNeg ? baseMask - a.d2 + carryA : a.d2;
    carryA = x >>> 26;
    x &= baseMask;
    y = bNeg ? baseMask - b.d2 + carryB : b.d2;
    carryB = y >>> 26;
    y &= baseMask;
    let r2 = operator === "&" ? x & y : operator === "|" ? x | y : x ^ y;
    if (negative) {
      r2 = baseMask - r2 + carryOut;
      carryOut = r2 >>> 26;
      r2 &= baseMask;
    }
    x = aNeg ? baseMask - a.d3 + carryA : a.d3;
    carryA = x >>> 26;
    x &= baseMask;
    y = bNeg ? baseMask - b.d3 + carryB : b.d3;
    carryB = y >>> 26;
    y &= baseMask;
    let r3 = operator === "&" ? x & y : operator === "|" ? x | y : x ^ y;
    if (negative) {
      r3 = baseMask - r3 + carryOut;
      carryOut = r3 >>> 26;
      r3 &= baseMask;
    }
    x = aNeg ? (baseMask + carryA) & baseMask : 0;
    y = bNeg ? (baseMask + carryB) & baseMask : 0;
    let r4 = operator === "&" ? x & y : operator === "|" ? x | y : x ^ y;
    if (negative) {
      r4 = (baseMask - r4 + carryOut) & baseMask;
    }
    if (r4 === 0) return inline4(negative, r0, r1, r2, r3);
    return {
      negative,
      len: 5,
      d0: r0,
      d1: r1,
      d2: r2,
      d3: r3,
      digits: [r0, r1, r2, r3, r4],
    };
  }
  const width = (aLen > bLen ? aLen : bLen) + 1;
  let carryA = aNeg ? 1 : 0;
  let carryB = bNeg ? 1 : 0;
  let carryOut = negative ? 1 : 0;
  const digits: number[] = [];
  for (let i = 0; i < width; i++) {
    const ad = integerDigit(a, i);
    let x = aNeg ? baseMask - ad + carryA : ad;
    carryA = x >>> 26;
    x &= baseMask;
    const bd = integerDigit(b, i);
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
  return addWithSign(negate(value), integerOne(), true);
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
  if (bits === 0 || value.len === 0) return integerZero();
  const magnitude = magnitudeBits(value);
  if (
    (signed && bits > magnitude) ||
    (!signed && !value.negative && bits >= magnitude)
  )
    return withinCapacity(value, maxDigits);
  const partial = bits % 26;
  const width = Math.floor(bits / 26) + (partial === 0 ? 0 : 1);
  if (width > maxDigits) return undefined;
  const mask = partial === 0 ? baseMask : (1 << partial) - 1;
  const digits = extendOrComplement(value, value.negative, width);
  digits[width - 1] = (digits[width - 1] ?? 0) & mask;
  const negative =
    signed &&
    (digits[width - 1] ?? 0) >= 1 << (partial === 0 ? 25 : partial - 1);
  if (!negative) return canonical(false, digits);
  const absolute = extendArrayComplement(digits, width);
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
function boundedCount(value: Integer, limit: number): number | undefined {
  let count = 0;
  for (let i = value.len - 1; i >= 0; i--) {
    const digit = integerDigit(value, i);
    if (count > Math.floor((limit - digit) * invBase)) return undefined;
    count = count * base + digit;
  }
  return count <= limit ? count : undefined;
}
function withinCapacity(
  value: Integer,
  maxDigits: number,
): Integer | undefined {
  return value.len <= maxDigits ? value : undefined;
}
/** Shift by `count` (or `-count` when `negateCount` is true) without allocating
 * a negated `Integer` on right shifts. */
export function shiftSigned(
  value: Integer,
  count: Integer,
  negateCount: boolean,
  maxDigits: number,
): Integer | undefined {
  if (!validCapacity(maxDigits)) return undefined;
  const vLen = value.len;
  if (vLen === 0) return integerZero();
  const cLen = count.len;
  if (cLen === 0) return withinCapacity(value, maxDigits);
  const isRight = negateCount ? !count.negative : count.negative;
  const limit = (isRight ? vLen : maxDigits) * 26;
  let distance: number | undefined;
  if (cLen === 1) {
    const d0 = count.d0;
    distance = d0 <= limit ? d0 : undefined;
  } else {
    distance = boundedCount(count, limit);
  }
  if (distance === undefined) {
    if (!isRight) return undefined;
    return withinCapacity(
      value.negative ? inline1(true, 1) : integerZero(),
      maxDigits,
    );
  }
  const whole = Math.floor(distance / 26),
    partial = distance - whole * 26;
  if (!isRight) {
    if (vLen <= 4 && whole === 0 && partial !== 0) {
      const sr = 26 - partial;
      const r0 = (value.d0 << partial) & baseMask;
      const r1 = ((value.d1 << partial) & baseMask) | (value.d0 >>> sr);
      const r2 = ((value.d2 << partial) & baseMask) | (value.d1 >>> sr);
      const r3 = ((value.d3 << partial) & baseMask) | (value.d2 >>> sr);
      const r4 = value.d3 >>> sr;
      if (r4 === 0) {
        const outLen = r3 !== 0 ? 4 : r2 !== 0 ? 3 : r1 !== 0 ? 2 : 1;
        if (outLen > maxDigits) return undefined;
        return {
          negative: value.negative,
          len: outLen,
          d0: r0,
          d1: r1,
          d2: r2,
          d3: r3,
          digits: undefined,
        };
      }
      if (5 > maxDigits) return undefined;
      return {
        negative: value.negative,
        len: 5,
        d0: r0,
        d1: r1,
        d2: r2,
        d3: r3,
        digits: [r0, r1, r2, r3, r4],
      };
    }
    if (partial === 0) {
      if (vLen + whole > maxDigits) return undefined;
      if (vLen + whole <= 4) {
        if (whole === 1)
          return inline4(value.negative, 0, value.d0, value.d1, value.d2);
        if (whole === 2)
          return inline4(value.negative, 0, 0, value.d0, value.d1);
        return inline4(value.negative, 0, 0, 0, value.d0);
      }
      const digits: number[] = [];
      for (let i = 0; i < whole; i++) digits.push(0);
      for (let i = 0; i < vLen; i++) digits.push(integerDigit(value, i));
      return canonical(value.negative, digits);
    }
    const shiftRight = 26 - partial;
    const top = integerDigit(value, vLen - 1);
    const overflow = top >>> shiftRight !== 0 ? 1 : 0;
    if (vLen + whole + overflow > maxDigits) return undefined;
    const digits: number[] = [];
    for (let i = 0; i < whole; i++) digits.push(0);
    let carry = 0;
    for (let i = 0; i < vLen; i++) {
      const d = integerDigit(value, i);
      digits.push(((d << partial) & baseMask) | carry);
      carry = d >>> shiftRight;
    }
    if (carry !== 0) digits.push(carry);
    return canonical(value.negative, digits);
  }
  if (vLen - whole - 1 > maxDigits) return undefined;
  if (vLen <= 4 && whole < 4) {
    let discarded = false;
    if (value.negative) {
      if (whole >= 1 && value.d0 !== 0) discarded = true;
      if (whole >= 2 && value.d1 !== 0) discarded = true;
      if (whole >= 3 && value.d2 !== 0) discarded = true;
    }
    let s0 =
      whole === 0
        ? value.d0
        : whole === 1
          ? value.d1
          : whole === 2
            ? value.d2
            : value.d3;
    let s1 =
      whole === 0
        ? value.d1
        : whole === 1
          ? value.d2
          : whole === 2
            ? value.d3
            : 0;
    let s2 = whole === 0 ? value.d2 : whole === 1 ? value.d3 : 0;
    let s3 = whole === 0 ? value.d3 : 0;
    if (partial !== 0) {
      const sl = 26 - partial;
      const lowMask = (1 << partial) - 1;
      if (value.negative && !discarded && (s0 & lowMask) !== 0)
        discarded = true;
      s0 = (s0 >>> partial) | ((s1 & lowMask) << sl);
      s1 = (s1 >>> partial) | ((s2 & lowMask) << sl);
      s2 = (s2 >>> partial) | ((s3 & lowMask) << sl);
      s3 = s3 >>> partial;
    }
    if (value.negative && discarded) {
      const a0 = s0 + 1;
      s0 = a0 & baseMask;
      const a1 = s1 + (a0 >>> 26);
      s1 = a1 & baseMask;
      const a2 = s2 + (a1 >>> 26);
      s2 = a2 & baseMask;
      s3 = s3 + (a2 >>> 26);
    }
    return withinCapacity(inline4(value.negative, s0, s1, s2, s3), maxDigits);
  }
  let discarded = false;
  if (value.negative) {
    for (let i = 0; i < whole && i < vLen; i++)
      if (integerDigit(value, i) !== 0) {
        discarded = true;
        break;
      }
  }
  const digits: number[] = [];
  if (partial === 0) {
    for (let i = whole; i < vLen; i++) digits.push(integerDigit(value, i));
  } else {
    const shiftLeft = 26 - partial;
    const lowMask = (1 << partial) - 1;
    if (value.negative && !discarded && whole < vLen) {
      if ((integerDigit(value, whole) & lowMask) !== 0) discarded = true;
    }
    for (let i = whole; i < vLen; i++) {
      const low = integerDigit(value, i),
        high = i + 1 < vLen ? integerDigit(value, i + 1) : 0;
      digits.push((low >>> partial) | ((high & lowMask) << shiftLeft));
    }
  }
  const truncated = canonical(value.negative, digits);
  // Magnitude truncation needs one additional unit for negative nonintegral results.
  const result =
    value.negative && discarded
      ? addWithSign(truncated, integerOne(), true)
      : truncated;
  return withinCapacity(result, maxDigits);
}
/** Positive counts shift left; negative counts shift right with sign extension.
 * The caller supplies its result allocation limit in base-2^26 digits. */
export function shift(
  value: Integer,
  count: Integer,
  maxDigits: number,
): Integer | undefined {
  return shiftSigned(value, count, false, maxDigits);
}
function boundedMultiply(
  a: Integer,
  b: Integer,
  maxDigits: number,
): Integer | undefined {
  if (a.len + b.len - 1 > maxDigits) return undefined;
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
  if (exponent.len === 0) return withinCapacity(integerOne(), maxDigits);
  if (value.len === 0) return integerZero();
  if (value.len === 1 && value.d0 === 1)
    return withinCapacity(
      value.negative && (exponent.d0 & 1) !== 0
        ? negate(integerOne())
        : integerOne(),
      maxDigits,
    );
  const count = boundedCount(exponent, maxDigits * 26 - 1);
  if (count === undefined || value.len > maxDigits) return undefined;
  let remaining = count;
  let result = integerOne(),
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
  if (value === 0) return integerZero();
  const negative = value < 0;
  let remaining = negative ? -value : value;
  if (remaining < base) return inline1(negative, remaining);
  if (remaining < twoLimbLimit) {
    const hi = Math.floor(remaining * invBase);
    return inline2(negative, remaining - hi * base, hi);
  }
  const digits: number[] = [];
  while (remaining !== 0) {
    const hi = Math.floor(remaining * invBase);
    digits.push(remaining - hi * base);
    remaining = hi;
  }
  return canonical(negative, digits);
}
function magnitudeBits(value: Integer): number {
  const len = value.len;
  if (len === 0) return 0;
  let top = integerDigit(value, len - 1),
    bits = (len - 1) * 26;
  while (top !== 0) {
    top >>>= 1;
    bits++;
  }
  return bits;
}
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
/** Binary64 rounding to nearest, ties to even. Discarded bits are examined before
 * converting the retained 53 bits, avoiding repeated limb-accumulation rounding. */
export function toNumber(value: Integer): number {
  const len = value.len;
  if (len === 0) return 0;
  if (len === 1) return value.negative ? -value.d0 : value.d0;
  if (len === 2) {
    const n = value.d0 + value.d1 * base;
    return value.negative ? -n : n;
  }
  const bits = magnitudeBits(value);
  if (bits > 1024) return value.negative ? -Infinity : Infinity;
  const discard = Math.max(0, bits - 53);
  const whole = Math.floor(discard / 26),
    partial = discard - whole * 26;
  const shiftLeft = 26 - partial;
  const lowMask = (1 << partial) - 1;
  let retained = 0;
  for (let i = len - 1; i >= whole; i--) {
    const low = integerDigit(value, i);
    const high = i + 1 < len ? integerDigit(value, i + 1) : 0;
    const digit =
      partial === 0 ? low : (low >>> partial) | ((high & lowMask) << shiftLeft);
    retained = retained * base + digit;
  }
  if (discard !== 0) {
    const guardWord = Math.floor((discard - 1) / 26);
    const guardBit = discard - 1 - guardWord * 26;
    const guardDigit = integerDigit(value, guardWord);
    let sticky = (guardDigit & ((1 << guardBit) - 1)) !== 0;
    for (let i = 0; i < guardWord && !sticky; i++)
      if (integerDigit(value, i) !== 0) sticky = true;
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
  if (denominator.len === 0) return undefined;
  if (numerator.len === 0) return 0;
  const negative = numerator.negative !== denominator.negative;
  const n = numerator.negative ? negate(numerator) : numerator,
    d = denominator.negative ? negate(denominator) : denominator;
  let exponent = magnitudeBits(n) - magnitudeBits(d);
  if (exponent > 1024) return negative ? -Infinity : Infinity;
  if (exponent < -1075) return negative ? -0 : 0;
  const capacity = Math.max(n.len, d.len) + 43;
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
  const len = value.len;
  if (len <= 2 && number > -twoLimbLimit && number < twoLimbLimit) {
    const mag = len === 0 ? 0 : value.d0 + (len === 2 ? value.d1 * base : 0);
    const av = value.negative ? -mag : mag;
    return av < number ? -1 : av > number ? 1 : 0;
  }
  const floor = Math.floor(number);
  const integer = fromNumber(floor);
  if (integer === undefined) throw "INTEGER_NUMBER_COMPARISON_INVARIANT";
  const order = compare(value, integer);
  return order !== 0 ? order : number === floor ? 0 : -1;
}
