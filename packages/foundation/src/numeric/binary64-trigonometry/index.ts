import { encodeFloat64 } from "../../binary/bytes.ts";
import {
  fromNumber,
  toNumber,
  multiply,
  subtract,
  negate,
  compare,
  shift,
  type Integer,
} from "../big-integer.ts";
import { twoOverPiDigits, twoOverPiBits } from "./constant.ts";

// Thresholds for fast-path evaluation and Cody-Waite range reduction.
const tinyThreshold = 7.450580596923828e-9; // 2^-27
const piOver4 = 0.7853981633974483; // pi / 4
const codyWaiteLimit = 823549.0; // < 2^19 * (pi / 2), so |n| <= 2^19

// fdlibm 33-bit-split constants for pi/2 (each product n * pio2_k is exact
// in binary64 for |n| <= 2^19, giving >150 bits of reduction precision).
const invPio2 = 0.6366197723675814; // 2 / pi (0x3fe45f306dc9c883)
const pio2_1 = 1.5707963267341256; // 0x3ff921fb54400000
const pio2_1t = 6.077100506506192e-11; // 0x3dd0b4611a626331
const pio2_2 = 6.077100506303966e-11; // 0x3dd0b4611a600000
const pio2_2t = 2.0222662487959506e-21; // 0x3ba3198a2e037073
const pio2_3 = 2.0222662487111665e-21; // 0x3ba3198a2e000000
const pio2_3t = 8.4784276603689e-32; // 0x397b839a252049c1

function integer(value: number): Integer {
  const result = fromNumber(value);
  if (result === undefined) throw "TRIG_INTEGER_INVARIANT";
  return result;
}
function constant(): Integer {
  return { negative: false, digits: twoOverPiDigits() };
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
  readonly tail: number;
}
/** Integer Payne-Hanek-style reduction retains quadrant bits for all finite
 * binary64 inputs beyond the Cody-Waite threshold. 2304 fixed-point bits leave
 * over 1200 bits after the largest input exponent, placing constant truncation
 * below the binary64 subnormal range. */
function reduceLarge(value: number): ReducedAngle {
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
  const scaled = fraction(remainder, denominatorBits);
  const hi = scaled * pio2_1;
  const lo = scaled * pio2_1t;
  const angle = hi + lo;
  return { quadrant, angle, tail: hi - angle + lo };
}

/** fdlibm kernel sin(x + y) for |x| <= pi/4 and |y| << |x|. */
function kernelSin(x: number, y: number): number {
  const s1 = -1.66666666666666324348e-1;
  const s2 = 8.33333333332248946124e-3;
  const s3 = -1.98412698298579493134e-4;
  const s4 = 2.75573137070700676789e-6;
  const s5 = -2.50507602534068634195e-8;
  const s6 = 1.58969099521155010221e-10;
  const z = x * x;
  const v = z * x;
  const r = s2 + z * (s3 + z * (s4 + z * (s5 + z * s6)));
  if (y === 0) return x + v * (s1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * s1);
}
/** fdlibm kernel cos(x + y) for |x| <= pi/4 and |y| << |x|. */
function kernelCos(x: number, y: number): number {
  const c1 = 4.16666666666666019037e-2;
  const c2 = -1.38888888888741095749e-3;
  const c3 = 2.48015872894767294178e-5;
  const c4 = -2.75573143513906633035e-7;
  const c5 = 2.0875723212981748279e-9;
  const c6 = -1.13596475577881948265e-11;
  const z = x * x;
  const r = z * (c1 + z * (c2 + z * (c3 + z * (c4 + z * (c5 + z * c6)))));
  const hz = 0.5 * z;
  const w = 1 - hz;
  return w + (1 - w - hz + (z * r - x * y));
}

function evaluateQuadrant(
  quadrant: number,
  y0: number,
  y1: number,
  operation: 0 | 1 | 2,
): number {
  if (operation === 0) {
    if (quadrant === 0) return kernelSin(y0, y1);
    if (quadrant === 1) return kernelCos(y0, y1);
    if (quadrant === 2) return -kernelSin(y0, y1);
    return -kernelCos(y0, y1);
  }
  if (operation === 1) {
    if (quadrant === 0) return kernelCos(y0, y1);
    if (quadrant === 1) return -kernelSin(y0, y1);
    if (quadrant === 2) return -kernelCos(y0, y1);
    return kernelSin(y0, y1);
  }
  const s = kernelSin(y0, y1),
    c = kernelCos(y0, y1);
  return (quadrant & 1) === 0 ? s / c : -c / s;
}

/** Reduce a positive angle `absValue > pi/4` via 3-stage Cody-Waite (up to
 * `codyWaiteLimit`) or Payne-Hanek (for larger angles) and evaluate the
 * requested trigonometric function with zero fast-path allocations. */
function reducedEvaluate(absValue: number, operation: 0 | 1 | 2): number {
  if (absValue <= codyWaiteLimit) {
    const fn = Math.floor(absValue * invPio2 + 0.5);
    let r = absValue - fn * pio2_1;
    let w = fn * pio2_1t;
    let y0 = r - w;
    if (Math.abs(y0) < 1e-4 * absValue) {
      const t2 = r;
      w = fn * pio2_2;
      r = t2 - w;
      w = fn * pio2_2t - (t2 - r - w);
      y0 = r - w;
      if (Math.abs(y0) < 1e-9 * absValue) {
        const t3 = r;
        w = fn * pio2_3;
        r = t3 - w;
        w = fn * pio2_3t - (t3 - r - w);
        y0 = r - w;
      }
    }
    const y1 = r - y0 - w;
    return evaluateQuadrant(fn & 3, y0, y1, operation);
  }
  const reduced = reduceLarge(absValue);
  return evaluateQuadrant(
    reduced.quadrant,
    reduced.angle,
    reduced.tail,
    operation,
  );
}

export function sine(value: number): number {
  const absValue = value < 0 ? -value : value;
  if (absValue <= piOver4) {
    if (absValue < tinyThreshold) return value;
    return kernelSin(value, 0);
  }
  if (value !== value || absValue === Infinity) return NaN;
  const result = reducedEvaluate(absValue, 0);
  return value < 0 ? -result : result;
}
export function cosine(value: number): number {
  const absValue = value < 0 ? -value : value;
  if (absValue <= piOver4) {
    if (absValue < tinyThreshold) return 1;
    return kernelCos(absValue, 0);
  }
  if (value !== value || absValue === Infinity) return NaN;
  return reducedEvaluate(absValue, 1);
}
export function tangent(value: number): number {
  const absValue = value < 0 ? -value : value;
  if (absValue <= piOver4) {
    if (absValue < tinyThreshold) return value;
    return kernelSin(value, 0) / kernelCos(value, 0);
  }
  if (value !== value || absValue === Infinity) return NaN;
  const result = reducedEvaluate(absValue, 2);
  return value < 0 ? -result : result;
}
