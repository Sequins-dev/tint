import { binaryExponent, powerOfTwo } from "./number-scale.ts";
/** Logarithms reduced by exact powers of two to a short atanh series. */
export function numberLog(value: number, base: 0 | 2 | 10): number {
  if (value !== value || value === Infinity) return value;
  if (value === 0) return -Infinity;
  if (value < 0) return NaN;
  let reduced = value;
  let exponent = 0;
  while (reduced >= 1.4142135623730951) {
    reduced *= 0.5;
    exponent++;
  }
  while (reduced < 0.7071067811865476) {
    reduced *= 2;
    exponent--;
  }
  const z = (reduced - 1) / (reduced + 1);
  const square = z * z;
  let power = z,
    sum = z,
    correction = 0;
  // |z| <= 0.172. The omitted tail is below binary64 precision after 20 terms.
  for (let denominator = 3; denominator < 41; denominator += 2) {
    power *= square;
    const term = power / denominator - correction;
    const next = sum + term;
    correction = next - sum - term;
    sum = next;
  }
  const fraction = 2 * sum;
  if (base === 2) return exponent + fraction * 1.4426950408889634;
  // Split ln(2) keeps the exponent product exact before the small correction.
  const natural =
    exponent * 0.6931471803691238 +
    (fraction + exponent * 1.9082149292705877e-10);
  return base === 10 ? natural * 0.4342944819032518 : natural;
}

/** log(1+x): fdlibm's s_log1p.c (as shipped by V8 and SpiderMonkey). 1+x is
 * reduced to 2^k * (1+f) with sqrt(2)/2 <= 1+f < sqrt(2), keeping the low
 * part lost in forming 1+x as a correction c; log(1+f) uses
 * s = f/(2+f) and a degree-14 Remez polynomial in s^2. Bit-level tests of
 * fdlibm become comparisons with the doubles whose high words they name. */
export function numberLog1p(value: number): number {
  if (value !== value || value === Infinity) return value;
  let exponent = 1,
    f = 0,
    c = 0,
    highFraction = 1;
  if (value < 0.4142136573791504) {
    // x < sqrt(2) - 1 (high word below 0x3fda827a, or negative).
    if (value <= -1) return value === -1 ? -Infinity : NaN;
    const magnitude = value < 0 ? -value : value;
    if (magnitude < 1.862645149230957e-9) {
      // |x| < 2^-29
      if (magnitude < 5.551115123125783e-17) return value; // |x| < 2^-54
      return value - value * value * 0.5;
    }
    if (value > 0 || magnitude < 0.2928934097290039) {
      // -0.2929 < x < 0.41422 (high word of |x| at most 0x3fd2bec3)
      exponent = 0;
      f = value;
    }
  }
  if (exponent !== 0) {
    let u = value;
    if (value < 9007199254740992) {
      u = 1 + value;
      exponent = binaryExponent(u);
      c = exponent > 0 ? 1 - (u - value) : value - (u - 1);
      c /= u;
    } else exponent = binaryExponent(u);
    // Scale u to [1, 2): the top 20 fraction bits are highFraction.
    const normalized = u * powerOfTwo(-exponent);
    highFraction = Math.floor((normalized - 1) * 1048576);
    if (highFraction < 0x6a09e) f = normalized - 1;
    else {
      exponent += 1;
      f = normalized * 0.5 - 1;
      highFraction = Math.floor((0x100000 - highFraction) / 4);
    }
  }
  const halfSquare = 0.5 * f * f;
  if (highFraction === 0) {
    // |f| < 2^-20
    if (f === 0) {
      if (exponent === 0) return 0;
      return (
        exponent * 6.9314718036912381649e-1 +
        (c + exponent * 1.90821492927058770002e-10)
      );
    }
    const r = halfSquare * (1 - 0.66666666666666666 * f);
    if (exponent === 0) return f - r;
    return (
      exponent * 6.9314718036912381649e-1 -
      (r - (exponent * 1.90821492927058770002e-10 + c) - f)
    );
  }
  const s = f / (2 + f),
    z = s * s;
  const r =
    z *
    (6.66666666666673513e-1 +
      z *
        (3.999999999940941908e-1 +
          z *
            (2.857142874366239149e-1 +
              z *
                (2.222219843214978396e-1 +
                  z *
                    (1.818357216161805012e-1 +
                      z *
                        (1.531383769920937332e-1 +
                          z * 1.479819860511658591e-1))))));
  if (exponent === 0) return f - (halfSquare - s * (halfSquare + r));
  return (
    exponent * 6.9314718036912381649e-1 -
    (halfSquare -
      (s * (halfSquare + r) + (exponent * 1.90821492927058770002e-10 + c)) -
      f)
  );
}
