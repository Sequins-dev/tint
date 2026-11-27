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
  divideQuotient,
  divideRemainder,
  formatInteger,
  fromNumber as integerFromNumber,
  multiply,
  negate,
  parseInteger,
  power,
  shiftSigned,
  subtract,
  toNumber as integerToNumber,
  truncateInteger,
  type Integer,
} from "@tint/foundation/numeric/big-integer";
import { createBigIntValue, type BigIntValue } from "@tint/js-runtime/bigints";

/** Digits are base 2^26; a value is limited to 2^30 bits, V8's limit. */
const maxDigits = 41297762;

function finish(value: Integer | undefined): BigIntValue {
  if (value === undefined || value.len > maxDigits)
    throw new RangeError("Maximum BigInt size exceeded");
  return createBigIntValue(value);
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
    integer: {
      negative: len === 0 ? false : negative,
      len,
      d0,
      d1,
      d2,
      d3,
      digits: undefined,
    },
  };
}
export function addBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  const ai = a.integer,
    bi = b.integer,
    aLen = ai.len,
    bLen = bi.len;
  if (aLen === 0) return b;
  if (bLen === 0) return a;
  if (aLen <= 3 && bLen <= 3) {
    if (ai.negative === bi.negative) {
      let s0 = ai.d0 + bi.d0,
        c0 = 0;
      if (s0 >= 67108864) {
        s0 -= 67108864;
        c0 = 1;
      }
      let s1 = ai.d1 + bi.d1 + c0,
        c1 = 0;
      if (s1 >= 67108864) {
        s1 -= 67108864;
        c1 = 1;
      }
      let s2 = ai.d2 + bi.d2 + c1,
        c2 = 0;
      if (s2 >= 67108864) {
        s2 -= 67108864;
        c2 = 1;
      }
      const len = c2 !== 0 ? 4 : s2 !== 0 ? 3 : s1 !== 0 ? 2 : 1;
      return {
        bigintBrand: "bigint",
        integer: {
          negative: ai.negative,
          len,
          d0: s0,
          d1: s1,
          d2: s2,
          d3: c2,
          digits: undefined,
        },
      };
    }
    let cmp = aLen !== bLen ? (aLen > bLen ? 1 : -1) : 0;
    if (cmp === 0) {
      if (ai.d2 !== bi.d2) cmp = ai.d2 > bi.d2 ? 1 : -1;
      else if (ai.d1 !== bi.d1) cmp = ai.d1 > bi.d1 ? 1 : -1;
      else if (ai.d0 !== bi.d0) cmp = ai.d0 > bi.d0 ? 1 : -1;
    }
    if (cmp === 0)
      return {
        bigintBrand: "bigint",
        integer: {
          negative: false,
          len: 0,
          d0: 0,
          d1: 0,
          d2: 0,
          d3: 0,
          digits: undefined,
        },
      };
    const big = cmp > 0 ? ai : bi,
      small = cmp > 0 ? bi : ai;
    let r0 = big.d0 - small.d0,
      b0 = 0;
    if (r0 < 0) {
      r0 += 67108864;
      b0 = 1;
    }
    let r1 = big.d1 - small.d1 - b0,
      b1 = 0;
    if (r1 < 0) {
      r1 += 67108864;
      b1 = 1;
    }
    const r2 = big.d2 - small.d2 - b1;
    const len = r2 !== 0 ? 3 : r1 !== 0 ? 2 : 1;
    return {
      bigintBrand: "bigint",
      integer: {
        negative: cmp > 0 ? ai.negative : bi.negative,
        len,
        d0: r0,
        d1: r1,
        d2: r2,
        d3: 0,
        digits: undefined,
      },
    };
  }
  return finish(add(ai, bi));
}
export function subtractBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  const ai = a.integer,
    bi = b.integer,
    aLen = ai.len,
    bLen = bi.len;
  if (bLen === 0) return a;
  if (aLen === 0)
    return {
      bigintBrand: "bigint",
      integer: {
        negative: !bi.negative,
        len: bLen,
        d0: bi.d0,
        d1: bi.d1,
        d2: bi.d2,
        d3: bi.d3,
        digits: bi.digits,
      },
    };
  if (aLen <= 3 && bLen <= 3) {
    if (ai.negative !== bi.negative) {
      let s0 = ai.d0 + bi.d0,
        c0 = 0;
      if (s0 >= 67108864) {
        s0 -= 67108864;
        c0 = 1;
      }
      let s1 = ai.d1 + bi.d1 + c0,
        c1 = 0;
      if (s1 >= 67108864) {
        s1 -= 67108864;
        c1 = 1;
      }
      let s2 = ai.d2 + bi.d2 + c1,
        c2 = 0;
      if (s2 >= 67108864) {
        s2 -= 67108864;
        c2 = 1;
      }
      const len = c2 !== 0 ? 4 : s2 !== 0 ? 3 : s1 !== 0 ? 2 : 1;
      return {
        bigintBrand: "bigint",
        integer: {
          negative: ai.negative,
          len,
          d0: s0,
          d1: s1,
          d2: s2,
          d3: c2,
          digits: undefined,
        },
      };
    }
    let cmp = aLen !== bLen ? (aLen > bLen ? 1 : -1) : 0;
    if (cmp === 0) {
      if (ai.d2 !== bi.d2) cmp = ai.d2 > bi.d2 ? 1 : -1;
      else if (ai.d1 !== bi.d1) cmp = ai.d1 > bi.d1 ? 1 : -1;
      else if (ai.d0 !== bi.d0) cmp = ai.d0 > bi.d0 ? 1 : -1;
    }
    if (cmp === 0)
      return {
        bigintBrand: "bigint",
        integer: {
          negative: false,
          len: 0,
          d0: 0,
          d1: 0,
          d2: 0,
          d3: 0,
          digits: undefined,
        },
      };
    const big = cmp > 0 ? ai : bi,
      small = cmp > 0 ? bi : ai;
    let r0 = big.d0 - small.d0,
      b0 = 0;
    if (r0 < 0) {
      r0 += 67108864;
      b0 = 1;
    }
    let r1 = big.d1 - small.d1 - b0,
      b1 = 0;
    if (r1 < 0) {
      r1 += 67108864;
      b1 = 1;
    }
    const r2 = big.d2 - small.d2 - b1;
    const len = r2 !== 0 ? 3 : r1 !== 0 ? 2 : 1;
    return {
      bigintBrand: "bigint",
      integer: {
        negative: cmp > 0 ? ai.negative : !bi.negative,
        len,
        d0: r0,
        d1: r1,
        d2: r2,
        d3: 0,
        digits: undefined,
      },
    };
  }
  return finish(subtract(ai, bi));
}
export function multiplyBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  const x = a.integer.len,
    y = b.integer.len;
  if (x !== 0 && y !== 0 && x + y - 1 > maxDigits)
    throw new RangeError("Maximum BigInt size exceeded");
  return finish(multiply(a.integer, b.integer));
}
export function divideBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  const result = divideQuotient(a.integer, b.integer);
  if (result === undefined) throw new RangeError("Division by zero");
  return finish(result);
}
export function remainderBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  const result = divideRemainder(a.integer, b.integer);
  if (result === undefined) throw new RangeError("Division by zero");
  return finish(result);
}
export function exponentiateBigInt(
  a: BigIntValue,
  b: BigIntValue,
): BigIntValue {
  if (b.integer.negative) throw new RangeError("Exponent must be non-negative");
  return finish(power(a.integer, b.integer, maxDigits));
}
export function andBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  const ai = a.integer,
    bi = b.integer;
  if (!bi.negative && bi.len <= 2) {
    if (bi.len === 0 || ai.len === 0)
      return {
        bigintBrand: "bigint",
        integer: {
          negative: false,
          len: 0,
          d0: 0,
          d1: 0,
          d2: 0,
          d3: 0,
          digits: undefined,
        },
      };
    let a0 = ai.d0,
      a1 = ai.d1;
    if (ai.negative) {
      const carry = a0 === 0 ? 1 : 0;
      a0 = -a0 & 67108863;
      a1 = (~a1 + carry) & 67108863;
    }
    const r0 = a0 & bi.d0,
      r1 = a1 & bi.d1;
    return {
      bigintBrand: "bigint",
      integer: {
        negative: false,
        len: r1 !== 0 ? 2 : r0 !== 0 ? 1 : 0,
        d0: r0,
        d1: r1,
        d2: 0,
        d3: 0,
        digits: undefined,
      },
    };
  }
  if (!ai.negative && !bi.negative && bi.len <= 4) {
    const r0 = ai.d0 & bi.d0,
      r1 = ai.d1 & bi.d1,
      r2 = ai.d2 & bi.d2,
      r3 = ai.d3 & bi.d3;
    const len = r3 !== 0 ? 4 : r2 !== 0 ? 3 : r1 !== 0 ? 2 : r0 !== 0 ? 1 : 0;
    return {
      bigintBrand: "bigint",
      integer: {
        negative: false,
        len,
        d0: r0,
        d1: r1,
        d2: r2,
        d3: r3,
        digits: undefined,
      },
    };
  }
  return finish(bitwise(ai, bi, "&"));
}
export function orBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  const ai = a.integer,
    bi = b.integer;
  if (!ai.negative && !bi.negative && ai.len <= 4 && bi.len <= 4) {
    const r0 = ai.d0 | bi.d0,
      r1 = ai.d1 | bi.d1,
      r2 = ai.d2 | bi.d2,
      r3 = ai.d3 | bi.d3;
    const len = r3 !== 0 ? 4 : r2 !== 0 ? 3 : r1 !== 0 ? 2 : r0 !== 0 ? 1 : 0;
    return {
      bigintBrand: "bigint",
      integer: {
        negative: false,
        len,
        d0: r0,
        d1: r1,
        d2: r2,
        d3: r3,
        digits: undefined,
      },
    };
  }
  return finish(bitwise(ai, bi, "|"));
}
export function xorBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  const ai = a.integer,
    bi = b.integer;
  if (!ai.negative && !bi.negative && ai.len <= 4 && bi.len <= 4) {
    const r0 = ai.d0 ^ bi.d0,
      r1 = ai.d1 ^ bi.d1,
      r2 = ai.d2 ^ bi.d2,
      r3 = ai.d3 ^ bi.d3;
    const len = r3 !== 0 ? 4 : r2 !== 0 ? 3 : r1 !== 0 ? 2 : r0 !== 0 ? 1 : 0;
    return {
      bigintBrand: "bigint",
      integer: {
        negative: false,
        len,
        d0: r0,
        d1: r1,
        d2: r2,
        d3: r3,
        digits: undefined,
      },
    };
  }
  return finish(bitwise(ai, bi, "^"));
}
export function leftShiftBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  const ai = a.integer,
    bi = b.integer;
  if (!bi.negative && bi.len === 1 && bi.d0 < 26 && ai.len <= 3) {
    if (ai.len === 0) return a;
    const s = bi.d0,
      rem = 26 - s;
    const r0 = (ai.d0 << s) & 67108863;
    const r1 = ((ai.d1 << s) | (ai.d0 >>> rem)) & 67108863;
    const r2 = ((ai.d2 << s) | (ai.d1 >>> rem)) & 67108863;
    const r3 = ai.d2 >>> rem;
    const len = r3 !== 0 ? 4 : r2 !== 0 ? 3 : r1 !== 0 ? 2 : 1;
    return {
      bigintBrand: "bigint",
      integer: {
        negative: ai.negative,
        len,
        d0: r0,
        d1: r1,
        d2: r2,
        d3: r3,
        digits: undefined,
      },
    };
  }
  return finish(shiftSigned(ai, bi, false, maxDigits));
}
export function rightShiftBigInt(a: BigIntValue, b: BigIntValue): BigIntValue {
  const ai = a.integer,
    bi = b.integer;
  if (!ai.negative && !bi.negative && bi.len === 1 && ai.len <= 4) {
    const count = bi.d0;
    if (count < 26) {
      const rem = 26 - count;
      const r0 = ((ai.d0 >>> count) | (ai.d1 << rem)) & 67108863;
      const r1 = ((ai.d1 >>> count) | (ai.d2 << rem)) & 67108863;
      const r2 = ((ai.d2 >>> count) | (ai.d3 << rem)) & 67108863;
      const r3 = ai.d3 >>> count;
      const len = r3 !== 0 ? 4 : r2 !== 0 ? 3 : r1 !== 0 ? 2 : r0 !== 0 ? 1 : 0;
      return {
        bigintBrand: "bigint",
        integer: {
          negative: false,
          len,
          d0: r0,
          d1: r1,
          d2: r2,
          d3: r3,
          digits: undefined,
        },
      };
    }
    if (count < 52) {
      const s = count - 26;
      let r0 = ai.d1,
        r1 = ai.d2,
        r2 = ai.d3;
      if (s !== 0) {
        const rem = 26 - s;
        r0 = ((ai.d1 >>> s) | (ai.d2 << rem)) & 67108863;
        r1 = ((ai.d2 >>> s) | (ai.d3 << rem)) & 67108863;
        r2 = ai.d3 >>> s;
      }
      const len = r2 !== 0 ? 3 : r1 !== 0 ? 2 : r0 !== 0 ? 1 : 0;
      return {
        bigintBrand: "bigint",
        integer: {
          negative: false,
          len,
          d0: r0,
          d1: r1,
          d2: r2,
          d3: 0,
          digits: undefined,
        },
      };
    }
  }
  return finish(shiftSigned(ai, bi, true, maxDigits));
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
  return value.integer.len !== 0;
}
export function bigIntToString(value: BigIntValue): string {
  const text = formatInteger(value.integer, 10);
  if (text === undefined) throw "BIGINT_FORMAT_INVARIANT";
  return text;
}
/** Number(bigint): the nearest binary64, ties to even. */
export function bigIntToNumber(value: BigIntValue): number {
  const integer = value.integer;
  const len = integer.len;
  if (len === 0) return 0;
  if (len === 1) return integer.negative ? -integer.d0 : integer.d0;
  if (len === 2) {
    const magnitude = integer.d0 + integer.d1 * 67108864;
    return integer.negative ? -magnitude : magnitude;
  }
  return integerToNumber(integer);
}
/** BigInt(number): exact for integral values, else a RangeError. */
export function bigIntFromNumber(value: number): BigIntValue {
  if (value >= -67108863 && value <= 67108863 && Math.trunc(value) === value) {
    if (value === 0)
      return {
        bigintBrand: "bigint",
        integer: {
          negative: false,
          len: 0,
          d0: 0,
          d1: 0,
          d2: 0,
          d3: 0,
          digits: undefined,
        },
      };
    const negative = value < 0;
    return {
      bigintBrand: "bigint",
      integer: {
        negative,
        len: 1,
        d0: negative ? -value : value,
        d1: 0,
        d2: 0,
        d3: 0,
        digits: undefined,
      },
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
    integer: {
      negative: false,
      len: value ? 1 : 0,
      d0: value ? 1 : 0,
      d1: 0,
      d2: 0,
      d3: 0,
      digits: undefined,
    },
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
  const integer = value.integer;
  const d0 = integer.d0,
    d1 = integer.d1,
    d2 = integer.d2;
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
    return {
      bigintBrand: "bigint",
      integer: {
        negative: false,
        len: 0,
        d0: 0,
        d1: 0,
        d2: 0,
        d3: 0,
        digits: undefined,
      },
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
  const d0 = lo & 67108863;
  const d1 = (lo >>> 26) | ((hi & 1048575) << 6);
  const d2 = hi >>> 20;
  return {
    bigintBrand: "bigint",
    integer: {
      negative,
      len: d2 !== 0 ? 3 : d1 !== 0 ? 2 : 1,
      d0,
      d1,
      d2,
      d3: 0,
      digits: undefined,
    },
  };
}
/** Stable value-based 32-bit FNV-1a hash of a BigIntValue (zero allocations;
 * equal BigInts across distinct heap allocations produce identical hashes). */
export function hashBigInt(value: BigIntValue): number {
  const integer = value.integer,
    len = integer.len;
  let hash = integer.negative && len !== 0 ? 0x811c9dc5 : 0x9e3779b1;
  if (len <= 4) {
    if (len >= 1) hash = Math.imul(hash ^ integer.d0, 0x01000193) >>> 0;
    if (len >= 2) hash = Math.imul(hash ^ integer.d1, 0x01000193) >>> 0;
    if (len >= 3) hash = Math.imul(hash ^ integer.d2, 0x01000193) >>> 0;
    if (len >= 4) hash = Math.imul(hash ^ integer.d3, 0x01000193) >>> 0;
    return hash;
  }
  const digits = integer.digits;
  if (digits !== undefined) {
    for (let i = 0; i < digits.length; i++)
      hash = Math.imul(hash ^ (digits[i] ?? 0), 0x01000193) >>> 0;
  }
  return hash;
}
