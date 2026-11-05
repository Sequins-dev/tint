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
/** Binary64 exponential with split-ln(2) reduction and one subnormal rounding. */
export function numberExp(value: number): number {
  if (value !== value || value === Infinity) return value;
  if (value > 710) return Infinity;
  if (value < -746) return 0;
  const exponent = Math.round(value * 1.4426950408889634);
  const reduced =
    value - exponent * 0.6931471803691238 - exponent * 1.9082149292705877e-10;
  let result = 1 + expm1Series(reduced);
  let remaining = exponent;
  // Keep scaling normal until the final operation, avoiding repeated rounding
  // while traversing the subnormal range and intermediate overflow at 2^1024.
  if (remaining < -1022) {
    remaining += 1022;
    while (remaining < 0) {
      result *= 0.5;
      remaining++;
    }
    return result * 2.2250738585072014e-308;
  }
  while (remaining > 0) {
    result *= 2;
    remaining--;
  }
  while (remaining < 0) {
    result *= 0.5;
    remaining++;
  }
  return result;
}
export function numberExpm1(value: number): number {
  if (value === 0 || value !== value || value === Infinity) return value;
  if (value >= -0.5 && value <= 0.5) return expm1Series(value);
  return numberExp(value) - 1;
}
