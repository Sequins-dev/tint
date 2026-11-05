const pi = 3.141592653589793;
/** atan reduction bounds the alternating series by tan(pi/8). */
export function numberAtan(value: number): number {
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
export function numberAtan2(y: number, x: number): number {
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
    result = numberAtan(Math.abs(y / x));
    if (negativeX) result = pi - result;
  }
  return negativeY ? -result : result;
}
export function numberAsin(value: number): number {
  if (value === 0 || value !== value) return value;
  if (value < -1 || value > 1) return NaN;
  return numberAtan2(value, Math.sqrt((1 - value) * (1 + value)));
}
export function numberAcos(value: number): number {
  if (value !== value) return value;
  if (value < -1 || value > 1) return NaN;
  return numberAtan2(Math.sqrt((1 - value) * (1 + value)), value);
}
