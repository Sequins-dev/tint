import { powerOfTwo } from "./number-scale.ts";
/** exp(x)-1 on a bounded interval, keeping tiny x out of a subtractive formula. */
function expm1Series(value: number): number {
  let term = value,
    sum = value,
    correction = 0;
  for (let n = 2; n <= 20; n++) {
    term *= value / n;
    const adjusted = term - correction;
    const next = sum + adjusted;
    correction = next - sum - adjusted;
    sum = next;
  }
  return sum;
}
/** Binary64 exponential: fdlibm's e_exp.c (the algorithm V8 and SpiderMonkey
 * ship), so results match other engines bit for bit. x = k*ln2 + r with ln2
 * split into an exact high part and a small low part, a degree-5 Remez
 * rational approximation on |r| <= ln2/2, then one exact scaling by 2^k
 * (two for subnormal results, where the last multiply rounds once). fdlibm's
 * high-word range tests are expressed as comparisons with the doubles whose
 * high words they name. */
export function numberExp(value: number): number {
  if (value !== value || value === Infinity) return value;
  if (value === -Infinity) return 0;
  if (value > 7.09782712893383973096e2) return Infinity;
  if (value < -7.4513321910194110842e2) return 0;
  const magnitude = value < 0 ? -value : value;
  let hi = 0,
    lo = 0,
    exponent = 0,
    reduced = value;
  if (magnitude >= 0.3465735912322998) {
    // |x| > 0.5 ln2 (high word above 0x3fd62e42).
    if (magnitude < 1.0397205352783203) {
      // |x| < 1.5 ln2 (high word below 0x3ff0a2b2).
      if (value === 1) return 2.718281828459045;
      hi =
        value < 0
          ? value + 6.9314718036912381649e-1
          : value - 6.9314718036912381649e-1;
      lo = value < 0 ? -1.90821492927058770002e-10 : 1.90821492927058770002e-10;
      exponent = value < 0 ? -1 : 1;
    } else {
      exponent = Math.trunc(
        1.442695040888963387 * value + (value < 0 ? -0.5 : 0.5),
      );
      hi = value - exponent * 6.9314718036912381649e-1;
      lo = exponent * 1.90821492927058770002e-10;
    }
    reduced = hi - lo;
  } else if (magnitude < 3.725290298461914e-9) return 1 + value; // |x| < 2^-28
  const square = reduced * reduced;
  const c =
    reduced -
    square *
      (1.66666666666666019037e-1 +
        square *
          (-2.77777777770155933842e-3 +
            square *
              (6.61375632143793436117e-5 +
                square *
                  (-1.6533902205465251539e-6 +
                    square * 4.13813679705723846039e-8))));
  if (exponent === 0) return 1 - ((reduced * c) / (c - 2) - reduced);
  const y = 1 - (lo - (reduced * c) / (2 - c) - hi);
  if (exponent >= -1021) {
    if (exponent === 1024) return y * 2 * 8.98846567431158e307;
    return y * powerOfTwo(exponent);
  }
  return y * powerOfTwo(exponent + 1000) * 9.332636185032189e-302;
}
export function numberExpm1(value: number): number {
  if (value === 0 || value !== value || value === Infinity) return value;
  if (value >= -0.5 && value <= 0.5) return expm1Series(value);
  return numberExp(value) - 1;
}
