import { roundFloat } from "../binary/bytes.ts";
import { cosine, sine, tangent } from "./binary64-trigonometry/index.ts";

const pi = 3.141592653589793;

/** 2 ** k for integer k in [-1022, 1023]; every partial product is a normal
 * power of two, so the result is exact. */
function powerOfTwo(exponent: number): number {
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

/** floor(log2(value)) for a finite normal positive value. */
function binaryExponent(value: number): number {
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

/** Binary64 exponential matching fdlibm e_exp.c. */
export function mathExp(value: number): number {
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
    if (magnitude < 1.0397205352783203) {
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
  } else if (magnitude < 3.725290298461914e-9) return 1 + value;
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

export function mathExpm1(value: number): number {
  if (value === 0 || value !== value || value === Infinity) return value;
  if (value >= -0.5 && value <= 0.5) return expm1Series(value);
  return mathExp(value) - 1;
}

function logBase(value: number, base: 0 | 2 | 10): number {
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
  for (let denominator = 3; denominator < 41; denominator += 2) {
    power *= square;
    const term = power / denominator - correction;
    const next = sum + term;
    correction = next - sum - term;
    sum = next;
  }
  const fraction = 2 * sum;
  if (base === 2) return exponent + fraction * 1.4426950408889634;
  const natural =
    exponent * 0.6931471803691238 +
    (fraction + exponent * 1.9082149292705877e-10);
  return base === 10 ? natural * 0.4342944819032518 : natural;
}

export function mathLog(value: number): number {
  return logBase(value, 0);
}

export function mathLog2(value: number): number {
  return logBase(value, 2);
}

export function mathLog10(value: number): number {
  return logBase(value, 10);
}

export function mathLog1p(value: number): number {
  if (value !== value || value === Infinity) return value;
  let exponent = 1,
    f = 0,
    c = 0,
    highFraction = 1;
  if (value < 0.4142136573791504) {
    if (value <= -1) return value === -1 ? -Infinity : NaN;
    const magnitude = value < 0 ? -value : value;
    if (magnitude < 1.862645149230957e-9) {
      if (magnitude < 5.551115123125783e-17) return value;
      return value - value * value * 0.5;
    }
    if (value > 0 || magnitude < 0.2928934097290039) {
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

export function mathPow(base: number, exponent: number): number {
  if (exponent !== exponent) return NaN;
  if (exponent === 0) return 1;
  if (base !== base) return NaN;
  const magnitude = base < 0 ? -base : base;
  const integral = Math.floor(exponent) === exponent;
  const remainder = exponent % 2;
  const odd = integral && (remainder === 1 || remainder === -1);
  if (magnitude === Infinity) {
    if (exponent > 0) return base < 0 && odd ? -Infinity : Infinity;
    return base < 0 && odd ? -0 : 0;
  }
  if (base === 0) {
    const negative = 1 / base === -Infinity && odd;
    if (exponent > 0) return negative ? -0 : 0;
    return negative ? -Infinity : Infinity;
  }
  if (exponent === Infinity || exponent === -Infinity) {
    if (magnitude === 1) return NaN;
    return magnitude > 1 === exponent > 0 ? Infinity : 0;
  }
  if (!integral) {
    if (base < 0) return NaN;
    if (base === 1) return 1;
    if (exponent === 0.5) return Math.sqrt(base);
    return mathExp(exponent * logBase(base, 0));
  }
  let factor = exponent < 0 ? 1 / base : base;
  let remaining = exponent < 0 ? -exponent : exponent;
  let result = 1;
  while (remaining > 0) {
    if (remaining % 2 !== 0) result *= factor;
    remaining = Math.floor(remaining / 2);
    if (remaining > 0) factor *= factor;
  }
  return result;
}

export function mathCbrt(value: number): number {
  if (
    value === 0 ||
    value !== value ||
    value === Infinity ||
    value === -Infinity
  )
    return value;
  let reduced = value < 0 ? -value : value;
  let scale = 1;
  while (reduced >= 8) {
    reduced /= 8;
    scale *= 2;
  }
  while (reduced < 1) {
    reduced *= 8;
    scale /= 2;
  }
  let root = 2;
  for (let i = 0; i < 8; i++) root += (reduced / (root * root) - root) / 3;
  const result = root * scale;
  return value < 0 ? -result : result;
}

export function mathFround(value: number): number {
  return roundFloat(value, 4);
}

export function mathF16round(value: number): number {
  return roundFloat(value, 2);
}

export function mathSin(value: number): number {
  return sine(value);
}

export function mathCos(value: number): number {
  return cosine(value);
}

export function mathTan(value: number): number {
  return tangent(value);
}

export function mathAtan(value: number): number {
  if (value === 0 || value !== value) return value;
  let reduced = Math.abs(value);
  const reciprocal = reduced > 1;
  if (reciprocal) reduced = 1 / reduced;
  const shifted = reduced > 0.41421356237309503;
  if (shifted) reduced = (reduced - 1) / (reduced + 1);
  const square = -reduced * reduced;
  let power = reduced,
    sum = reduced,
    correction = 0;
  for (let denominator = 3; denominator < 51; denominator += 2) {
    power *= square;
    const term = power / denominator - correction;
    const next = sum + term;
    correction = next - sum - term;
    sum = next;
  }
  let result = shifted ? pi / 4 + sum : sum;
  if (reciprocal) result = pi / 2 - result;
  return value < 0 ? -result : result;
}

export function mathAtan2(y: number, x: number): number {
  if (y !== y || x !== x) return NaN;
  const negativeY = y < 0 || (y === 0 && 1 / y === -Infinity);
  const negativeX = x < 0 || (x === 0 && 1 / x === -Infinity);
  if (y === 0) return negativeX ? (negativeY ? -pi : pi) : y;
  if (x === 0) return negativeY ? -pi / 2 : pi / 2;
  const absoluteY = Math.abs(y),
    absoluteX = Math.abs(x);
  let result = 0;
  if (absoluteY === Infinity)
    result =
      absoluteX === Infinity ? (negativeX ? (3 * pi) / 4 : pi / 4) : pi / 2;
  else if (absoluteX === Infinity) result = negativeX ? pi : 0;
  else {
    result = mathAtan(Math.abs(y / x));
    if (negativeX) result = pi - result;
  }
  return negativeY ? -result : result;
}

export function mathAsin(value: number): number {
  if (value === 0 || value !== value) return value;
  if (value < -1 || value > 1) return NaN;
  return mathAtan2(value, Math.sqrt((1 - value) * (1 + value)));
}

export function mathAcos(value: number): number {
  if (value !== value) return value;
  if (value < -1 || value > 1) return NaN;
  return mathAtan2(Math.sqrt((1 - value) * (1 + value)), value);
}

function halfExponential(value: number): number {
  const half = mathExp(value / 2);
  return half * 0.5 * half;
}

export function mathSinh(value: number): number {
  if (
    value === 0 ||
    value !== value ||
    value === Infinity ||
    value === -Infinity
  )
    return value;
  const magnitude = Math.abs(value);
  const delta = magnitude < 20 ? mathExpm1(magnitude) : 0;
  const result =
    magnitude < 20
      ? (delta + delta / (delta + 1)) * 0.5
      : halfExponential(magnitude);
  return value < 0 ? -result : result;
}

export function mathCosh(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude !== magnitude || magnitude === Infinity) return magnitude;
  if (magnitude >= 20) return halfExponential(magnitude);
  const delta = mathExpm1(magnitude);
  return 1 + (delta * delta) / (2 * (delta + 1));
}

export function mathTanh(value: number): number {
  if (value === 0 || value !== value) return value;
  const magnitude = Math.abs(value);
  const delta = magnitude < 20 ? mathExpm1(2 * magnitude) : 0;
  const result = magnitude < 20 ? delta / (delta + 2) : 1;
  return value < 0 ? -result : result;
}

export function mathAsinh(value: number): number {
  if (
    value === 0 ||
    value !== value ||
    value === Infinity ||
    value === -Infinity
  )
    return value;
  const magnitude = Math.abs(value);
  let result = 0;
  if (magnitude > 1e154) result = logBase(magnitude, 0) + 0.6931471805599453;
  else if (magnitude >= 2)
    result = logBase(
      2 * magnitude + 1 / (Math.sqrt(magnitude * magnitude + 1) + magnitude),
      0,
    );
  else
    result = mathLog1p(
      magnitude +
        (magnitude * magnitude) / (1 + Math.sqrt(1 + magnitude * magnitude)),
    );
  return value < 0 ? -result : result;
}

export function mathAcosh(value: number): number {
  if (value !== value || value === Infinity) return value;
  if (value < 1) return NaN;
  if (value > 1e154) return logBase(value, 0) + 0.6931471805599453;
  const difference = value - 1;
  return mathLog1p(difference + Math.sqrt(difference * (value + 1)));
}

export function mathAtanh(value: number): number {
  if (value === 0 || value !== value) return value;
  const magnitude = Math.abs(value);
  if (magnitude > 1) return NaN;
  const result =
    magnitude === 1
      ? Infinity
      : mathLog1p((2 * magnitude) / (1 - magnitude)) * 0.5;
  return value < 0 ? -result : result;
}

/** Zero-allocation two-argument scaled Euclidean norm. */
export function mathHypot2(a: number, b: number): number {
  const absA = Math.abs(a),
    absB = Math.abs(b);
  if (absA === Infinity || absB === Infinity) return Infinity;
  if (absA !== absA || absB !== absB) return NaN;
  const max = absA > absB ? absA : absB;
  if (max === 0) return 0;
  const sa = absA / max,
    sb = absB / max;
  return max * Math.sqrt(sa * sa + sb * sb);
}

/** Scaled, compensated Euclidean norm over arbitrary argument counts. */
export function mathHypot(values: Float64Array): number {
  let maximum = 0,
    nan = false;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === undefined) throw "HYPOT_VALUE_INVARIANT";
    const magnitude = Math.abs(value);
    if (magnitude !== magnitude) nan = true;
    else if (magnitude > maximum) maximum = magnitude;
  }
  if (maximum === Infinity) return Infinity;
  if (nan) return NaN;
  if (maximum === 0) return 0;
  let sum = 0,
    correction = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === undefined) throw "HYPOT_VALUE_INVARIANT";
    const scaled = value / maximum;
    const term = scaled * scaled - correction;
    const next = sum + term;
    correction = next - sum - term;
    sum = next;
  }
  return maximum * Math.sqrt(sum);
}
