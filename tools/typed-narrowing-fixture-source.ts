// Assignment narrowing and `??=` on optional records in typed code
// (docs/unified-pipeline.md, slice 4a). `run` returns 42 when every check
// holds, else the number of the first failing check.
// tools/build-typed-narrowing-fixture.ts runs it natively on the typed path;
// tools/typed-narrowing-fixture.test.ts runs it under Node.
export const typedNarrowingSource = `interface Item {
  readonly value: number;
}
function find(id: number): Item | undefined {
  return id > 0 ? { value: id } : undefined;
}
let made = 0;
function make(value: number): Item {
  made++;
  return { value };
}
export function run(): number {
  let a = find(0);
  a = a === undefined ? { value: 40 } : a;
  if (a.value !== 40) return 1;
  let b = find(5);
  b = b === undefined ? { value: 0 } : b;
  if (b.value !== 5) return 2;
  let c = find(0);
  if (c === undefined) c = { value: 3 };
  if (c.value !== 3) return 3;
  let d = find(0);
  d ??= make(2);
  if (d.value !== 2 || made !== 1) return 4;
  // Present: the right operand is not evaluated.
  let e = find(7);
  e ??= make(9);
  if (e.value !== 7 || made !== 1) return 5;
  // The expression's value is the binding's new value.
  let f = find(0);
  const g = (f ??= make(11));
  if (g.value !== 11 || f.value !== 11 || made !== 2) return 6;
  // Reassignment of a possibly absent value un-narrows; a test narrows again.
  let h = find(1);
  h = { value: 1 };
  h = find(0);
  if (h !== undefined) return 7;
  return 42;
}
`;
