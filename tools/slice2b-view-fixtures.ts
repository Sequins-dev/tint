export const nativeCallablePropertySource = `export function run(): number {
  let total = 0;
  const increment = (by: number): number => { total += by; return total; };
  const table: Record<string, unknown> = {};
  table.first = increment;
  table.second = increment;
  const callable = table.first;
  if (callable !== table.second || typeof callable !== "function") return 1;
  if (callable(38) !== 38) return 2;
  const arrays: Record<string, number[]> = { values: [2, 2] };
  const values = arrays.values;
  if (values === undefined) return 3;
  const mapped = values.map(increment);
  return mapped[0] === 40 && mapped[1] === 42 && total === 42 ? 42 : 4;
}`;
