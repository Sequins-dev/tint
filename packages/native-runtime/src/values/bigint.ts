/** Typed BigInt operations (docs/unified-pipeline.md, slice 4a).
 *
 * Typed code represents a `bigint` as a reference to js-runtime's flat
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
  divideQuotient,
  divideRemainder,
  formatInteger,
  fromNumber as integerFromNumber,
  multiply,
  parseInteger,
  power,
  shiftSigned,
  subtract,
  toNumber as integerToNumber,
  truncateInteger,
  type Integer,
} from "@tint/foundation/numeric/big-integer";
import {
  bigIntInteger,
  createBigIntValue,
  type BigIntValue,
} from "@tint/js-runtime/bigints";

/** Digits are base 2^26; a value is limited to 2^30 bits, V8's limit. */
const maxDigits = 41297762;
const base = 67108864;
const baseMask = 67108863;
const invBase = 0.000000014901161193847656;

function finish(value: Integer | undefined): BigIntValue {
  if (value === undefined || value.len > maxDigits)
    throw new RangeError("Maximum BigInt size exceeded");
  return createBigIntValue(value);
}
function valueDigit(value: BigIntValue, index: number): number {
  if (index === 0) return value.d0;
  if (index === 1) return value.d1;
  if (index === 2) return value.d2;
  if (index === 3) return value.d3;
  const digits = value.digits;
  return digits === undefined ? 0 : (digits[index] ?? 0);
}
/** A source literal: the parser supplies validated canonical decimal text. */
export function literal(text: string): BigIntValue {
  const integer = parseInteger(text, 10);
  if (integer === undefined) throw "BIGINT_LITERAL_INVARIANT";
  return createBigIntValue(integer);
}
/** A compile-time-parsed inline literal (up to 4 base-2^26 limbs / 104 bits). */
export function literalInline(
  negative: boolean,
  len: number,
  d0: number,
  d1: number,
  d2: number,
  d3: number,
): BigIntValue {
  return {
    bigintBrand: "bigint",
    negative: len === 0 ? false : negative,
    len,
    d0,
    d1,
    d2,
    d3,
    digits: undefined,
  };
}
export function addBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  const aLen = a.len,
    bLen = b.len;
  if (aLen === 0) return b;
  if (bLen === 0) return a;
  if (aLen <= 3 && bLen <= 3) {
    if (a.negative === b.negative) {
      let s0 = a.d0 + b.d0,
        c0 = 0;
      if (s0 >= base) {
        s0 -= base;
        c0 = 1;
      }
      let s1 = a.d1 + b.d1 + c0,
        c1 = 0;
      if (s1 >= base) {
        s1 -= base;
        c1 = 1;
      }
      let s2 = a.d2 + b.d2 + c1,
        c2 = 0;
      if (s2 >= base) {
        s2 -= base;
        c2 = 1;
      }
      return {
        bigintBrand: "bigint",
        negative: a.negative,
        len: c2 !== 0 ? 4 : s2 !== 0 ? 3 : s1 !== 0 ? 2 : 1,
        d0: s0,
        d1: s1,
        d2: s2,
        d3: c2,
        digits: undefined,
      };
    }
    let cmp = aLen !== bLen ? (aLen > bLen ? 1 : -1) : 0;
    if (cmp === 0) {
      if (a.d2 !== b.d2) cmp = a.d2 > b.d2 ? 1 : -1;
      else if (a.d1 !== b.d1) cmp = a.d1 > b.d1 ? 1 : -1;
      else if (a.d0 !== b.d0) cmp = a.d0 > b.d0 ? 1 : -1;
    }
    if (cmp === 0)
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
    const big = cmp > 0 ? a : b,
      small = cmp > 0 ? b : a;
    let r0 = big.d0 - small.d0,
      b0 = 0;
    if (r0 < 0) {
      r0 += base;
      b0 = 1;
    }
    let r1 = big.d1 - small.d1 - b0,
      b1 = 0;
    if (r1 < 0) {
      r1 += base;
      b1 = 1;
    }
    const r2 = big.d2 - small.d2 - b1;
    return {
      bigintBrand: "bigint",
      negative: cmp > 0 ? a.negative : b.negative,
      len: r2 !== 0 ? 3 : r1 !== 0 ? 2 : 1,
      d0: r0,
      d1: r1,
      d2: r2,
      d3: 0,
      digits: undefined,
    };
  }
  if (aLen <= 6 && bLen <= 6 && a.negative === b.negative) {
    let s0 = a.d0 + b.d0,
      c = 0;
    if (s0 >= base) {
      s0 -= base;
      c = 1;
    }
    let s1 = a.d1 + b.d1 + c;
    c = 0;
    if (s1 >= base) {
      s1 -= base;
      c = 1;
    }
    let s2 = a.d2 + b.d2 + c;
    c = 0;
    if (s2 >= base) {
      s2 -= base;
      c = 1;
    }
    let s3 = a.d3 + b.d3 + c;
    c = 0;
    if (s3 >= base) {
      s3 -= base;
      c = 1;
    }
    let s4 = valueDigit(a, 4) + valueDigit(b, 4) + c;
    c = 0;
    if (s4 >= base) {
      s4 -= base;
      c = 1;
    }
    let s5 = valueDigit(a, 5) + valueDigit(b, 5) + c;
    c = 0;
    if (s5 >= base) {
      s5 -= base;
      c = 1;
    }
    if (c !== 0)
      return {
        bigintBrand: "bigint",
        negative: a.negative,
        len: 7,
        d0: s0,
        d1: s1,
        d2: s2,
        d3: s3,
        digits: [s0, s1, s2, s3, s4, s5, c],
      };
    if (s5 !== 0)
      return {
        bigintBrand: "bigint",
        negative: a.negative,
        len: 6,
        d0: s0,
        d1: s1,
        d2: s2,
        d3: s3,
        digits: [s0, s1, s2, s3, s4, s5],
      };
    if (s4 !== 0)
      return {
        bigintBrand: "bigint",
        negative: a.negative,
        len: 5,
        d0: s0,
        d1: s1,
        d2: s2,
        d3: s3,
        digits: [s0, s1, s2, s3, s4],
      };
    return {
      bigintBrand: "bigint",
      negative: a.negative,
      len: s3 !== 0 ? 4 : s2 !== 0 ? 3 : s1 !== 0 ? 2 : 1,
      d0: s0,
      d1: s1,
      d2: s2,
      d3: s3,
      digits: undefined,
    };
  }
  return finish(add(bigIntInteger(a), bigIntInteger(b)));
}
export function subtractBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  const aLen = a.len,
    bLen = b.len;
  if (bLen === 0) return a;
  if (aLen === 0)
    return {
      bigintBrand: "bigint",
      negative: !b.negative,
      len: bLen,
      d0: b.d0,
      d1: b.d1,
      d2: b.d2,
      d3: b.d3,
      digits: b.digits,
    };
  if (aLen <= 3 && bLen <= 3) {
    if (a.negative !== b.negative) {
      let s0 = a.d0 + b.d0,
        c0 = 0;
      if (s0 >= base) {
        s0 -= base;
        c0 = 1;
      }
      let s1 = a.d1 + b.d1 + c0,
        c1 = 0;
      if (s1 >= base) {
        s1 -= base;
        c1 = 1;
      }
      let s2 = a.d2 + b.d2 + c1,
        c2 = 0;
      if (s2 >= base) {
        s2 -= base;
        c2 = 1;
      }
      return {
        bigintBrand: "bigint",
        negative: a.negative,
        len: c2 !== 0 ? 4 : s2 !== 0 ? 3 : s1 !== 0 ? 2 : 1,
        d0: s0,
        d1: s1,
        d2: s2,
        d3: c2,
        digits: undefined,
      };
    }
    let cmp = aLen !== bLen ? (aLen > bLen ? 1 : -1) : 0;
    if (cmp === 0) {
      if (a.d2 !== b.d2) cmp = a.d2 > b.d2 ? 1 : -1;
      else if (a.d1 !== b.d1) cmp = a.d1 > b.d1 ? 1 : -1;
      else if (a.d0 !== b.d0) cmp = a.d0 > b.d0 ? 1 : -1;
    }
    if (cmp === 0)
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
    const big = cmp > 0 ? a : b,
      small = cmp > 0 ? b : a;
    let r0 = big.d0 - small.d0,
      b0 = 0;
    if (r0 < 0) {
      r0 += base;
      b0 = 1;
    }
    let r1 = big.d1 - small.d1 - b0,
      b1 = 0;
    if (r1 < 0) {
      r1 += base;
      b1 = 1;
    }
    const r2 = big.d2 - small.d2 - b1;
    return {
      bigintBrand: "bigint",
      negative: cmp > 0 ? a.negative : !b.negative,
      len: r2 !== 0 ? 3 : r1 !== 0 ? 2 : 1,
      d0: r0,
      d1: r1,
      d2: r2,
      d3: 0,
      digits: undefined,
    };
  }
  if (aLen <= 6 && bLen <= 6 && a.negative === b.negative) {
    const a5 = valueDigit(a, 5),
      b5 = valueDigit(b, 5),
      a4 = valueDigit(a, 4),
      b4 = valueDigit(b, 4);
    let cmp = aLen !== bLen ? (aLen > bLen ? 1 : -1) : 0;
    if (cmp === 0) {
      if (a5 !== b5) cmp = a5 > b5 ? 1 : -1;
      else if (a4 !== b4) cmp = a4 > b4 ? 1 : -1;
      else if (a.d3 !== b.d3) cmp = a.d3 > b.d3 ? 1 : -1;
      else if (a.d2 !== b.d2) cmp = a.d2 > b.d2 ? 1 : -1;
      else if (a.d1 !== b.d1) cmp = a.d1 > b.d1 ? 1 : -1;
      else if (a.d0 !== b.d0) cmp = a.d0 > b.d0 ? 1 : -1;
    }
    if (cmp === 0)
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
    const big = cmp > 0 ? a : b,
      small = cmp > 0 ? b : a,
      neg = cmp > 0 ? a.negative : !b.negative;
    let r0 = big.d0 - small.d0,
      bw = 0;
    if (r0 < 0) {
      r0 += base;
      bw = 1;
    }
    let r1 = big.d1 - small.d1 - bw;
    bw = 0;
    if (r1 < 0) {
      r1 += base;
      bw = 1;
    }
    let r2 = big.d2 - small.d2 - bw;
    bw = 0;
    if (r2 < 0) {
      r2 += base;
      bw = 1;
    }
    let r3 = big.d3 - small.d3 - bw;
    bw = 0;
    if (r3 < 0) {
      r3 += base;
      bw = 1;
    }
    let r4 = valueDigit(big, 4) - valueDigit(small, 4) - bw;
    bw = 0;
    if (r4 < 0) {
      r4 += base;
      bw = 1;
    }
    const r5 = valueDigit(big, 5) - valueDigit(small, 5) - bw;
    if (r5 !== 0)
      return {
        bigintBrand: "bigint",
        negative: neg,
        len: 6,
        d0: r0,
        d1: r1,
        d2: r2,
        d3: r3,
        digits: [r0, r1, r2, r3, r4, r5],
      };
    if (r4 !== 0)
      return {
        bigintBrand: "bigint",
        negative: neg,
        len: 5,
        d0: r0,
        d1: r1,
        d2: r2,
        d3: r3,
        digits: [r0, r1, r2, r3, r4],
      };
    return {
      bigintBrand: "bigint",
      negative: neg,
      len: r3 !== 0 ? 4 : r2 !== 0 ? 3 : r1 !== 0 ? 2 : 1,
      d0: r0,
      d1: r1,
      d2: r2,
      d3: r3,
      digits: undefined,
    };
  }
  return finish(subtract(bigIntInteger(a), bigIntInteger(b)));
}
export function multiplyBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  const aLen = a.len,
    bLen = b.len;
  if (aLen === 0 || bLen === 0)
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
  if (aLen + bLen - 1 > maxDigits)
    throw new RangeError("Maximum BigInt size exceeded");
  const negative = a.negative !== b.negative;
  if (aLen === 1 && bLen === 1) {
    const product = a.d0 * b.d0;
    const hi = Math.floor(product * invBase);
    return {
      bigintBrand: "bigint",
      negative,
      len: hi !== 0 ? 2 : 1,
      d0: product - hi * base,
      d1: hi,
      d2: 0,
      d3: 0,
      digits: undefined,
    };
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
        bigintBrand: "bigint",
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
        bigintBrand: "bigint",
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
        bigintBrand: "bigint",
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
        bigintBrand: "bigint",
        negative,
        len: 5,
        d0: r0,
        d1: r1,
        d2: r2,
        d3: r3,
        digits: [r0, r1, r2, r3, r4],
      };
    const len = r3 !== 0 ? 4 : r2 !== 0 ? 3 : r1 !== 0 ? 2 : r0 !== 0 ? 1 : 0;
    return {
      bigintBrand: "bigint",
      negative: len === 0 ? false : negative,
      len,
      d0: r0,
      d1: r1,
      d2: r2,
      d3: r3,
      digits: undefined,
    };
  }
  return finish(multiply(bigIntInteger(a), bigIntInteger(b)));
}
export function divideBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  const aLen = a.len,
    bLen = b.len;
  if (bLen === 0) throw new RangeError("Division by zero");
  if (aLen === 0)
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
  const qNeg = a.negative !== b.negative;
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
      const len = q3 !== 0 ? 4 : q2 !== 0 ? 3 : q1 !== 0 ? 2 : q0 !== 0 ? 1 : 0;
      return {
        bigintBrand: "bigint",
        negative: len === 0 ? false : qNeg,
        len,
        d0: q0,
        d1: q1,
        d2: q2,
        d3: q3,
        digits: undefined,
      };
    }
    if (aLen <= 6) {
      let rem = 0;
      let q5 = 0;
      if (aLen === 6) {
        const d5 = valueDigit(a, 5);
        q5 = Math.floor(d5 / divisor);
        rem = d5 - q5 * divisor;
      }
      const div4 = rem * base + valueDigit(a, 4);
      const q4 = Math.floor(div4 / divisor);
      rem = div4 - q4 * divisor;
      const div3 = rem * base + a.d3;
      const q3 = Math.floor(div3 / divisor);
      rem = div3 - q3 * divisor;
      const div2 = rem * base + a.d2;
      const q2 = Math.floor(div2 / divisor);
      rem = div2 - q2 * divisor;
      const div1 = rem * base + a.d1;
      const q1 = Math.floor(div1 / divisor);
      rem = div1 - q1 * divisor;
      const q0 = Math.floor((rem * base + a.d0) / divisor);
      if (q5 !== 0)
        return {
          bigintBrand: "bigint",
          negative: qNeg,
          len: 6,
          d0: q0,
          d1: q1,
          d2: q2,
          d3: q3,
          digits: [q0, q1, q2, q3, q4, q5],
        };
      if (q4 !== 0)
        return {
          bigintBrand: "bigint",
          negative: qNeg,
          len: 5,
          d0: q0,
          d1: q1,
          d2: q2,
          d3: q3,
          digits: [q0, q1, q2, q3, q4],
        };
      const len = q3 !== 0 ? 4 : q2 !== 0 ? 3 : q1 !== 0 ? 2 : q0 !== 0 ? 1 : 0;
      return {
        bigintBrand: "bigint",
        negative: len === 0 ? false : qNeg,
        len,
        d0: q0,
        d1: q1,
        d2: q2,
        d3: q3,
        digits: undefined,
      };
    }
  }
  const result = divideQuotient(bigIntInteger(a), bigIntInteger(b));
  if (result === undefined) throw new RangeError("Division by zero");
  return finish(result);
}
export function remainderBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  const aLen = a.len,
    bLen = b.len;
  if (bLen === 0) throw new RangeError("Division by zero");
  if (aLen === 0)
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
  if (bLen === 1) {
    const divisor = b.d0;
    let rem = 0;
    if (aLen <= 4) {
      if (aLen >= 4) rem = a.d3 - Math.floor(a.d3 / divisor) * divisor;
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
    } else {
      for (let i = aLen - 1; i >= 0; i--) {
        const dividend = rem * base + valueDigit(a, i);
        rem = dividend - Math.floor(dividend / divisor) * divisor;
      }
    }
    return {
      bigintBrand: "bigint",
      negative: rem === 0 ? false : a.negative,
      len: rem === 0 ? 0 : 1,
      d0: rem,
      d1: 0,
      d2: 0,
      d3: 0,
      digits: undefined,
    };
  }
  const result = divideRemainder(bigIntInteger(a), bigIntInteger(b));
  if (result === undefined) throw new RangeError("Division by zero");
  return finish(result);
}
export function exponentiateBigInt(
  a: BigIntValue,
  b: BigIntValue,
): BigIntValue {
  if (b.negative) throw new RangeError("Exponent must be non-negative");
  return finish(power(bigIntInteger(a), bigIntInteger(b), maxDigits));
}
export function andBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  if (!b.negative && b.len <= 2) {
    if (b.len === 0 || a.len === 0)
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
    let a0 = a.d0,
      a1 = a.d1;
    if (a.negative) {
      const carry = a0 === 0 ? 1 : 0;
      a0 = -a0 & baseMask;
      a1 = (~a1 + carry) & baseMask;
    }
    const r0 = a0 & b.d0,
      r1 = a1 & b.d1;
    return {
      bigintBrand: "bigint",
      negative: false,
      len: r1 !== 0 ? 2 : r0 !== 0 ? 1 : 0,
      d0: r0,
      d1: r1,
      d2: 0,
      d3: 0,
      digits: undefined,
    };
  }
  if (!a.negative && !b.negative && b.len <= 4) {
    const r0 = a.d0 & b.d0,
      r1 = a.d1 & b.d1,
      r2 = a.d2 & b.d2,
      r3 = a.d3 & b.d3;
    return {
      bigintBrand: "bigint",
      negative: false,
      len: r3 !== 0 ? 4 : r2 !== 0 ? 3 : r1 !== 0 ? 2 : r0 !== 0 ? 1 : 0,
      d0: r0,
      d1: r1,
      d2: r2,
      d3: r3,
      digits: undefined,
    };
  }
  return finish(bitwise(bigIntInteger(a), bigIntInteger(b), "&"));
}
export function orBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  if (!a.negative && !b.negative && a.len <= 4 && b.len <= 4) {
    const r0 = a.d0 | b.d0,
      r1 = a.d1 | b.d1,
      r2 = a.d2 | b.d2,
      r3 = a.d3 | b.d3;
    return {
      bigintBrand: "bigint",
      negative: false,
      len: r3 !== 0 ? 4 : r2 !== 0 ? 3 : r1 !== 0 ? 2 : r0 !== 0 ? 1 : 0,
      d0: r0,
      d1: r1,
      d2: r2,
      d3: r3,
      digits: undefined,
    };
  }
  return finish(bitwise(bigIntInteger(a), bigIntInteger(b), "|"));
}
export function xorBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  if (a.len <= 4 && b.len <= 4) {
    if (!a.negative && !b.negative) {
      const r0 = a.d0 ^ b.d0,
        r1 = a.d1 ^ b.d1,
        r2 = a.d2 ^ b.d2,
        r3 = a.d3 ^ b.d3;
      return {
        bigintBrand: "bigint",
        negative: false,
        len: r3 !== 0 ? 4 : r2 !== 0 ? 3 : r1 !== 0 ? 2 : r0 !== 0 ? 1 : 0,
        d0: r0,
        d1: r1,
        d2: r2,
        d3: r3,
        digits: undefined,
      };
    }
    // (-A) ^ (-B) === (A - 1) ^ (B - 1) >= 0 in infinite two's complement.
    if (a.negative && b.negative) {
      let a0 = a.d0 - 1,
        a1 = a.d1,
        a2 = a.d2,
        a3 = a.d3;
      if (a0 < 0) {
        a0 = baseMask;
        a1 -= 1;
        if (a1 < 0) {
          a1 = baseMask;
          a2 -= 1;
          if (a2 < 0) {
            a2 = baseMask;
            a3 -= 1;
          }
        }
      }
      let b0 = b.d0 - 1,
        b1 = b.d1,
        b2 = b.d2,
        b3 = b.d3;
      if (b0 < 0) {
        b0 = baseMask;
        b1 -= 1;
        if (b1 < 0) {
          b1 = baseMask;
          b2 -= 1;
          if (b2 < 0) {
            b2 = baseMask;
            b3 -= 1;
          }
        }
      }
      const r0 = a0 ^ b0,
        r1 = a1 ^ b1,
        r2 = a2 ^ b2,
        r3 = a3 ^ b3;
      return {
        bigintBrand: "bigint",
        negative: false,
        len: r3 !== 0 ? 4 : r2 !== 0 ? 3 : r1 !== 0 ? 2 : r0 !== 0 ? 1 : 0,
        d0: r0,
        d1: r1,
        d2: r2,
        d3: r3,
        digits: undefined,
      };
    }
  }
  return finish(bitwise(bigIntInteger(a), bigIntInteger(b), "^"));
}
export function leftShiftBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  if (!b.negative && b.len === 1 && b.d0 < 26 && a.len <= 3) {
    if (a.len === 0) return a;
    const s = b.d0,
      rem = 26 - s;
    const r0 = (a.d0 << s) & baseMask;
    const r1 = ((a.d1 << s) | (a.d0 >>> rem)) & baseMask;
    const r2 = ((a.d2 << s) | (a.d1 >>> rem)) & baseMask;
    const r3 = a.d2 >>> rem;
    return {
      bigintBrand: "bigint",
      negative: a.negative,
      len: r3 !== 0 ? 4 : r2 !== 0 ? 3 : r1 !== 0 ? 2 : 1,
      d0: r0,
      d1: r1,
      d2: r2,
      d3: r3,
      digits: undefined,
    };
  }
  return finish(
    shiftSigned(bigIntInteger(a), bigIntInteger(b), false, maxDigits),
  );
}
export function rightShiftBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  if (!b.negative && b.len === 1 && a.len <= 5) {
    const count = b.d0;
    if (count < 26 && a.len <= 4 && !a.negative) {
      const rem = 26 - count;
      const r0 = ((a.d0 >>> count) | (a.d1 << rem)) & baseMask;
      const r1 = ((a.d1 >>> count) | (a.d2 << rem)) & baseMask;
      const r2 = ((a.d2 >>> count) | (a.d3 << rem)) & baseMask;
      const r3 = a.d3 >>> count;
      return {
        bigintBrand: "bigint",
        negative: false,
        len: r3 !== 0 ? 4 : r2 !== 0 ? 3 : r1 !== 0 ? 2 : r0 !== 0 ? 1 : 0,
        d0: r0,
        d1: r1,
        d2: r2,
        d3: r3,
        digits: undefined,
      };
    }
    if (count >= 26 && count < 52) {
      const s = count - 26;
      const d4 = a.len === 5 ? valueDigit(a, 4) : 0;
      let r0 = a.d1,
        r1 = a.d2,
        r2 = a.d3,
        r3 = d4;
      if (s !== 0) {
        const rem = 26 - s;
        r0 = ((a.d1 >>> s) | (a.d2 << rem)) & baseMask;
        r1 = ((a.d2 >>> s) | (a.d3 << rem)) & baseMask;
        r2 = ((a.d3 >>> s) | (d4 << rem)) & baseMask;
        r3 = d4 >>> s;
      }
      if (a.negative) {
        const dropped =
          a.d0 !== 0 || (s !== 0 && (a.d1 & ((1 << s) - 1)) !== 0);
        if (dropped) {
          r0 += 1;
          if (r0 >= base) {
            r0 = 0;
            r1 += 1;
            if (r1 >= base) {
              r1 = 0;
              r2 += 1;
              if (r2 >= base) {
                r2 = 0;
                r3 += 1;
              }
            }
          }
        }
      }
      const len = r3 !== 0 ? 4 : r2 !== 0 ? 3 : r1 !== 0 ? 2 : r0 !== 0 ? 1 : 0;
      return {
        bigintBrand: "bigint",
        negative: len === 0 ? false : a.negative,
        len,
        d0: r0,
        d1: r1,
        d2: r2,
        d3: r3,
        digits: undefined,
      };
    }
  }
  return finish(
    shiftSigned(bigIntInteger(a), bigIntInteger(b), true, maxDigits),
  );
}
export function negateBigInt(value: BigIntValue): BigIntValue {
  if (value.len === 0) return value;
  return {
    bigintBrand: "bigint",
    negative: !value.negative,
    len: value.len,
    d0: value.d0,
    d1: value.d1,
    d2: value.d2,
    d3: value.d3,
    digits: value.digits,
  };
}
export function notBigInt(value: BigIntValue): BigIntValue {
  return finish(bitwiseNot(bigIntInteger(value)));
}
/** -1, 0 or 1. */
export function compareBigInt(a: BigIntValue, b: BigIntValue): number {
  const aLen = a.len,
    bLen = b.len;
  if (aLen === 0 && bLen === 0) return 0;
  if (a.negative !== b.negative) return a.negative ? -1 : 1;
  const sign = a.negative ? -1 : 1;
  if (aLen !== bLen) return aLen > bLen ? sign : -sign;
  if (aLen <= 4) {
    if (a.d3 !== b.d3) return a.d3 > b.d3 ? sign : -sign;
    if (a.d2 !== b.d2) return a.d2 > b.d2 ? sign : -sign;
    if (a.d1 !== b.d1) return a.d1 > b.d1 ? sign : -sign;
    if (a.d0 !== b.d0) return a.d0 > b.d0 ? sign : -sign;
    return 0;
  }
  return compare(bigIntInteger(a), bigIntInteger(b));
}
/** -1, 0 or 1 exactly (no rounding through binary64); NaN for a NaN number,
 * which every relational operator treats as unordered. */
export function compareBigIntNumber(a: BigIntValue, b: number): number {
  const order = compareNumber(bigIntInteger(a), b);
  return order === undefined ? NaN : order;
}
export function equalBigInt(a: BigIntValue, b: BigIntValue): boolean {
  return compareBigInt(a, b) === 0;
}
export function truthyBigInt(value: BigIntValue): boolean {
  return value.len !== 0;
}
export function bigIntToString(value: BigIntValue): string {
  const text = formatInteger(bigIntInteger(value), 10);
  if (text === undefined) throw "BIGINT_FORMAT_INVARIANT";
  return text;
}
/** Number(bigint): the nearest binary64, ties to even. */
export function bigIntToNumber(value: BigIntValue): number {
  const len = value.len;
  if (len === 0) return 0;
  if (len === 1) return value.negative ? -value.d0 : value.d0;
  if (len === 2) {
    const magnitude = value.d0 + value.d1 * base;
    return value.negative ? -magnitude : magnitude;
  }
  return integerToNumber(bigIntInteger(value));
}
/** BigInt(number): exact for integral values, else a RangeError. */
export function bigIntFromNumber(value: number): BigIntValue {
  if (value >= -baseMask && value <= baseMask && Math.trunc(value) === value) {
    if (value === 0)
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
    const negative = value < 0;
    return {
      bigintBrand: "bigint",
      negative,
      len: 1,
      d0: negative ? -value : value,
      d1: 0,
      d2: 0,
      d3: 0,
      digits: undefined,
    };
  }
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
  return {
    bigintBrand: "bigint",
    negative: false,
    len: value ? 1 : 0,
    d0: value ? 1 : 0,
    d1: 0,
    d2: 0,
    d3: 0,
    digits: undefined,
  };
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
  const result = truncateInteger(
    bigIntInteger(value),
    index,
    signed,
    maxDigits,
  );
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
  const d0 = value.d0,
    d1 = value.d1,
    d2 = value.d2;
  let lo = (d0 | ((d1 & 63) << 26)) >>> 0;
  let hi = ((d1 >>> 6) | ((d2 & 4095) << 20)) >>> 0;
  if (value.negative && (lo !== 0 || hi !== 0)) {
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
  let negative = false;
  if (signed && (hi & 0x80000000) !== 0) {
    negative = true;
    if (lo === 0) hi = -hi >>> 0;
    else {
      lo = -lo >>> 0;
      hi = ~hi >>> 0;
    }
  }
  const d0 = lo & baseMask;
  const d1 = (lo >>> 26) | ((hi & 1048575) << 6);
  const d2 = hi >>> 20;
  return {
    bigintBrand: "bigint",
    negative,
    len: d2 !== 0 ? 3 : d1 !== 0 ? 2 : 1,
    d0,
    d1,
    d2,
    d3: 0,
    digits: undefined,
  };
}
/** Stable value-based 32-bit FNV-1a hash of a BigIntValue (zero allocations;
 * equal BigInts across distinct heap allocations produce identical hashes). */
export function hashBigInt(value: BigIntValue): number {
  const len = value.len;
  let hash = value.negative && len !== 0 ? 0x811c9dc5 : 0x9e3779b1;
  if (len <= 4) {
    if (len >= 1) hash = Math.imul(hash ^ value.d0, 0x01000193) >>> 0;
    if (len >= 2) hash = Math.imul(hash ^ value.d1, 0x01000193) >>> 0;
    if (len >= 3) hash = Math.imul(hash ^ value.d2, 0x01000193) >>> 0;
    if (len >= 4) hash = Math.imul(hash ^ value.d3, 0x01000193) >>> 0;
    return hash;
  }
  const digits = value.digits;
  if (digits !== undefined) {
    for (let i = 0; i < digits.length; i++)
      hash = Math.imul(hash ^ (digits[i] ?? 0), 0x01000193) >>> 0;
  }
  return hash;
}
