import { numberExp, numberExpm1 } from "./number-exp.ts";
import { numberLog, numberLog1p } from "./number-log.ts";

/** Large sinh/cosh share exp(|x|)/2 without overflowing exp(|x|) first. */
function halfExponential(value: number): number {
  const half = numberExp(value / 2);
  return half * 0.5 * half;
}
export function numberSinh(value: number): number {
  if (
    value === 0 ||
    value !== value ||
    value === Infinity ||
    value === -Infinity
  )
    return value;
  const magnitude = Math.abs(value);
  const delta = magnitude < 20 ? numberExpm1(magnitude) : 0;
  const result =
    magnitude < 20
      ? (delta + delta / (delta + 1)) * 0.5
      : halfExponential(magnitude);
  return value < 0 ? -result : result;
}
export function numberCosh(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude !== magnitude || magnitude === Infinity) return magnitude;
  if (magnitude >= 20) return halfExponential(magnitude);
  const delta = numberExpm1(magnitude);
  return 1 + (delta * delta) / (2 * (delta + 1));
}
export function numberTanh(value: number): number {
  if (value === 0 || value !== value) return value;
  const magnitude = Math.abs(value);
  const delta = magnitude < 20 ? numberExpm1(2 * magnitude) : 0;
  const result = magnitude < 20 ? delta / (delta + 2) : 1;
  return value < 0 ? -result : result;
}
export function numberAsinh(value: number): number {
  if (
    value === 0 ||
    value !== value ||
    value === Infinity ||
    value === -Infinity
  )
    return value;
  const magnitude = Math.abs(value);
  let result = 0;
  if (magnitude > 1e154) result = numberLog(magnitude, 0) + 0.6931471805599453;
  else if (magnitude >= 2)
    result = numberLog(
      2 * magnitude + 1 / (Math.sqrt(magnitude * magnitude + 1) + magnitude),
      0,
    );
  else
    result = numberLog1p(
      magnitude +
        (magnitude * magnitude) / (1 + Math.sqrt(1 + magnitude * magnitude)),
    );
  return value < 0 ? -result : result;
}
export function numberAcosh(value: number): number {
  if (value !== value || value === Infinity) return value;
  if (value < 1) return NaN;
  if (value > 1e154) return numberLog(value, 0) + 0.6931471805599453;
  const difference = value - 1;
  return numberLog1p(difference + Math.sqrt(difference * (value + 1)));
}
export function numberAtanh(value: number): number {
  if (value === 0 || value !== value) return value;
  const magnitude = Math.abs(value);
  if (magnitude > 1) return NaN;
  const result =
    magnitude === 1
      ? Infinity
      : numberLog1p((2 * magnitude) / (1 - magnitude)) * 0.5;
  return value < 0 ? -result : result;
}
