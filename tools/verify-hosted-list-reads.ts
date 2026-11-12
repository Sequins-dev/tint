// Dense reference-list reads take an inline vector fast path in codegen
// (packages/codegen/src/aarch64/scalar/index.ts, listReadShape); every other
// case calls the accessor. JavaScript results must hold for in-range reads,
// stored undefined, reads past the end, negative, fractional and -0 indexes,
// holes and lists whose storage became sparse. Presence tests (has) take the
// same inline path, as do writes within the vector (codegen listWriteShape).
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
  // filter visits present elements only (has): a stored undefined counts,
  // holes do not.
  const present = xs.filter(() => true).length * 100 +
    sparse.filter(() => true).length;
  // Writes: in range, undefined, at the length (extends it) and far past it.
  const ws: (Cell | undefined)[] = [{ v: 1 }, { v: 2 }, { v: 3 }];
  ws[1] = { v: 20 };
  ws[2] = undefined;
  ws[3] = { v: 40 };
  ws[10] = { v: 100 };
  let written = ws.length * 1000;
  for (let i = 0; i < 12; i++) written += at(ws, i);
  written += ws.filter(() => true).length * 100000;
  return ((total * 1000 + holes) * 10000 + present) * 10000000 + written;
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
