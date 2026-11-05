/** Cube root with exact power-of-eight range reduction. The Newton iteration
 * stays in [1, 2], avoiding overflow and underflow even for subnormal inputs. */
export function numberCbrt(value: number): number {
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
  // Eight steps exceed the precision needed from this bounded starting point.
  // A fixed count also avoids termination depending on rounding oscillations.
  for (let i = 0; i < 8; i++) root += (reduced / (root * root) - root) / 3;
  const result = root * scale;
  return value < 0 ? -result : result;
}
