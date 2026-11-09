/** Exact power-of-two scaling and exponent extraction for binary64 without
 * reinterpreting bits: at most ten exact multiplications each. */

/** 2 ** k for integer k in [-1022, 1023]; every partial product is a normal
 * power of two, so the result is exact. */
export function powerOfTwo(exponent: number): number {
  let magnitude = exponent < 0 ? -exponent : exponent,
    result = 1,
    square = 2;
  while (magnitude > 0) {
    if (magnitude % 2 === 1) result *= square;
    square *= square;
    magnitude = Math.floor(magnitude / 2);
  }
  return exponent < 0 ? 1 / result : result;
}
/** floor(log2(value)) for a finite normal positive value (the unbiased
 * binary64 exponent): a binary search over exact power-of-two thresholds.
 * Each step keeps the reduced value in [2 ** (1 - b), 2) (or [2, 2 ** 2b))
 * while removing a factor 2 ** b. */
export function binaryExponent(value: number): number {
  let reduced = value,
    exponent = 0;
  if (reduced >= 2) {
    if (reduced >= 1.3407807929942597e154) {
      reduced *= 7.458340731200207e-155;
      exponent += 512;
    }
    if (reduced >= 1.157920892373162e77) {
      reduced *= 8.636168555094445e-78;
      exponent += 256;
    }
    if (reduced >= 3.402823669209385e38) {
      reduced *= 2.938735877055719e-39;
      exponent += 128;
    }
    if (reduced >= 18446744073709552000) {
      reduced *= 5.421010862427522e-20;
      exponent += 64;
    }
    if (reduced >= 4294967296) {
      reduced *= 2.3283064365386963e-10;
      exponent += 32;
    }
    if (reduced >= 65536) {
      reduced *= 0.0000152587890625;
      exponent += 16;
    }
    if (reduced >= 256) {
      reduced *= 0.00390625;
      exponent += 8;
    }
    if (reduced >= 16) {
      reduced *= 0.0625;
      exponent += 4;
    }
    if (reduced >= 4) {
      reduced *= 0.25;
      exponent += 2;
    }
    if (reduced >= 2) exponent += 1;
    return exponent;
  }
  if (reduced < 1.4916681462400413e-154) {
    reduced *= 1.3407807929942597e154;
    exponent -= 512;
  }
  if (reduced < 1.727233711018889e-77) {
    reduced *= 1.157920892373162e77;
    exponent -= 256;
  }
  if (reduced < 5.877471754111438e-39) {
    reduced *= 3.402823669209385e38;
    exponent -= 128;
  }
  if (reduced < 1.0842021724855044e-19) {
    reduced *= 18446744073709552000;
    exponent -= 64;
  }
  if (reduced < 4.656612873077393e-10) {
    reduced *= 4294967296;
    exponent -= 32;
  }
  if (reduced < 0.000030517578125) {
    reduced *= 65536;
    exponent -= 16;
  }
  if (reduced < 0.0078125) {
    reduced *= 256;
    exponent -= 8;
  }
  if (reduced < 0.125) {
    reduced *= 16;
    exponent -= 4;
  }
  if (reduced < 0.5) {
    reduced *= 4;
    exponent -= 2;
  }
  if (reduced < 1) exponent -= 1;
  return exponent;
}
