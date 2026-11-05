import { numberLog } from "./number-log.ts";
import { numberExp } from "./number-exp.ts";

/** Number exponentiation: specified special cases, integer products and
 * implementation-approximated positive fractional powers. */
export function numberPower(base: number, exponent: number): number {
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
    // The direct root avoids losing exact squares and tiny roots through log/exp.
    if (exponent === 0.5) return Math.sqrt(base);
    return numberExp(exponent * numberLog(base, 0));
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
