// Dense reference-list reads take an inline vector fast path in codegen
// (packages/codegen/src/aarch64/scalar/index.ts, listReadShape); every other
// case calls the accessor. JavaScript results must hold for in-range reads,
// stored undefined, reads past the end, negative, fractional and -0 indexes,
// holes and lists whose storage became sparse.
import { verifyHostedFixture } from "./hosted-fixture.ts";

export const source = `interface Cell { readonly v: number }
function at(xs: (Cell | undefined)[], i: number): number {
  const cell = xs[i];
  return cell === undefined ? -1 : cell.v;
}
export function run(): number {
  const xs: (Cell | undefined)[] = [];
  for (let i = 0; i < 6; i++) xs.push(i === 3 ? undefined : { v: i * 10 });
  let total = 0;
  for (let i = -2; i < 9; i++) total += at(xs, i);
  total += at(xs, 1.5) + at(xs, -0) * 2 + at(xs, 4294967296) + at(xs, NaN);
  const sparse: (Cell | undefined)[] = [];
  sparse[40] = { v: 7 };
  sparse[2] = { v: 5 };
  let holes = 0;
  for (let i = 0; i < 45; i++) holes += at(sparse, i);
  return total * 1000 + holes;
}`;

verifyHostedFixture(
  source.replace(
    "export function run(): number {",
    "function compute(): number {",
  ) +
    `
export function run(): number { return compute() === ${(() => {
      const fn = new Function(
        source
          .replace(/interface Cell \{[^}]*\}\n/, "")
          .replace(/: \(Cell \| undefined\)\[\]/g, "")
          .replace(/: number/g, "")
          .replace(/export /, "") + "\nreturn run();",
      );
      return fn() as number;
    })()} ? 42 : 1; }`,
  "list-reads",
  [],
  [],
  [],
  [],
  { managedBytes: 67108864, allocationCapacity: 1048576 },
);
