/** Scaled, compensated Euclidean norm. Callers perform observable coercions first. */
export function numberHypot(values: readonly number[]): number {
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
