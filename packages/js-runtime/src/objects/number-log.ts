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

export function numberLog1p(value: number): number {
  if (value === 0 || value !== value || value === Infinity) return value;
  if (value === -1) return -Infinity;
  if (value < -1) return NaN;
  const sum = 1 + value;
  if (sum === 1) return value;
  // Recover the low part lost in 1+x before evaluating the logarithm.
  const lost = value > 1 ? sum - value - 1 : sum - 1 - value;
  return numberLog(sum, 0) - lost / sum;
}
