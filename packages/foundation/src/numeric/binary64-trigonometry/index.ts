import { encodeFloat64 } from "../../binary/bytes.ts";
import {
  fromNumber,
  parseInteger,
  toNumber,
  multiply,
  subtract,
  negate,
  compare,
  shift,
  type Integer,
} from "../big-integer.ts";
import { twoOverPiHex, twoOverPiBits } from "./constant.ts";
function integer(value: number): Integer {
  const result = fromNumber(value);
  if (result === undefined) throw "TRIG_INTEGER_INVARIANT";
  return result;
}
function constant(): Integer {
  const result = parseInteger(twoOverPiHex, 16);
  if (result === undefined) throw "TRIG_CONSTANT_INVARIANT";
  return result;
}
function shifted(value: Integer, count: number): Integer {
  const capacity = value.digits.length + Math.ceil(Math.max(0, count) / 26) + 1;
  const result = shift(value, integer(count), capacity);
  if (result === undefined) throw "TRIG_SHIFT_INVARIANT";
  return result;
}
/** Round a signed fixed-point fraction once before exact power-of-two scaling. */
function fraction(value: Integer, denominatorBits: number): number {
  const magnitude = value.negative ? negate(value) : value;
  let top = magnitude.digits[magnitude.digits.length - 1] ?? 0;
  let bits = Math.max(0, magnitude.digits.length - 1) * 26;
  while (top !== 0) {
    bits++;
    top = Math.floor(top / 2);
  }
  const discard = Math.max(0, bits - 53);
  const quotient = shifted(magnitude, -discard);
  let result = toNumber(quotient);
  if (discard > 0) {
    const remainder = subtract(magnitude, shifted(quotient, discard));
    const order = compare(remainder, shifted(integer(1), discard - 1));
    if (order > 0 || (order === 0 && result % 2 !== 0)) result++;
  }
  let exponent = discard - denominatorBits;
  while (exponent < 0) {
    result *= 0.5;
    exponent++;
  }
  return value.negative ? -result : result;
}
interface ReducedAngle {
  readonly quadrant: number;
  readonly angle: number;
}
/** Integer Payne-Hanek-style reduction retains quadrant bits for all finite
 * binary64 inputs. 2304 fixed-point bits leave over 1200 bits after the largest
 * input exponent, placing constant truncation below the binary64 subnormal range. */
function reduce(value: number): ReducedAngle {
  if (value <= 0.7853981633974483) return { quadrant: 0, angle: value };
  const word = encodeFloat64(value);
  const exponent = Math.floor(word.hi / 1048576) % 2048;
  const mantissa =
    (word.hi % 1048576) * 4294967296 + word.lo + 4503599627370496;
  const denominatorBits = twoOverPiBits - (exponent - 1075);
  const product = multiply(integer(mantissa), constant());
  const whole = shifted(product, -denominatorBits);
  let remainder = subtract(product, shifted(whole, denominatorBits));
  let quadrant = (whole.digits[0] ?? 0) % 4;
  if (compare(remainder, shifted(integer(1), denominatorBits - 1)) >= 0) {
    remainder = subtract(remainder, shifted(integer(1), denominatorBits));
    quadrant = (quadrant + 1) % 4;
  }
  return {
    quadrant,
    angle: fraction(remainder, denominatorBits) * 1.5707963267948966,
  };
}
interface Pair {
  readonly sine: number;
  readonly cosine: number;
}
function boundedPair(value: number): Pair {
  const square = -value * value;
  let sin = value,
    cos = 1,
    sinTerm = value,
    cosTerm = 1,
    sinCorrection = 0,
    cosCorrection = 0;
  for (let n = 1; n <= 12; n++) {
    sinTerm *= square / (2 * n * (2 * n + 1));
    const sinAdjusted = sinTerm - sinCorrection;
    const sinNext = sin + sinAdjusted;
    sinCorrection = sinNext - sin - sinAdjusted;
    sin = sinNext;
    cosTerm *= square / (2 * n * (2 * n - 1));
    const cosAdjusted = cosTerm - cosCorrection;
    const cosNext = cos + cosAdjusted;
    cosCorrection = cosNext - cos - cosAdjusted;
    cos = cosNext;
  }
  return { sine: sin, cosine: cos };
}
function trigonometric(value: number, operation: 0 | 1 | 2): number {
  if (value !== value || value === Infinity || value === -Infinity) return NaN;
  if (value === 0) return operation === 1 ? 1 : value;
  const reduced = reduce(Math.abs(value));
  const pair = boundedPair(reduced.angle);
  const quadrant = reduced.quadrant;
  if (operation === 1)
    return quadrant === 0
      ? pair.cosine
      : quadrant === 1
        ? -pair.sine
        : quadrant === 2
          ? -pair.cosine
          : pair.sine;
  const result =
    operation === 2
      ? quadrant % 2 === 0
        ? pair.sine / pair.cosine
        : -pair.cosine / pair.sine
      : quadrant === 0
        ? pair.sine
        : quadrant === 1
          ? pair.cosine
          : quadrant === 2
            ? -pair.sine
            : -pair.cosine;
  return value < 0 ? -result : result;
}
export function sine(value: number): number {
  return trigonometric(value, 0);
}
export function cosine(value: number): number {
  return trigonometric(value, 1);
}
export function tangent(value: number): number {
  return trigonometric(value, 2);
}
