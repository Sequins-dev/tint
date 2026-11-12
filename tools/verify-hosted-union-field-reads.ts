// Union field reads (packages/ts-native/src/scalar.ts, recordAccess) test
// one layout per variant; variants whose field needs the same conversion to
// the union's representation share one transfer slot and conversion block.
// Checked natively against the host engine: number, optional and possibly
// undefined fields across many variants, strings, references, repeated reads
// of one object, and reads after narrowing by the discriminant.
import { verifyHostedFixture } from "./hosted-fixture.ts";

export const source = `interface A { readonly kind: "a"; readonly v: number; readonly s: string }
interface B { readonly kind: "b"; readonly w: boolean; readonly v: number; readonly s: string }
interface C { readonly kind: "c"; readonly v?: number; readonly s?: string }
interface D { readonly kind: "d"; readonly v: number | undefined; readonly s: string | undefined }
interface E { readonly kind: "e"; readonly v: number; readonly s: string; readonly next: E | undefined }
type U = A | B | C | D | E;
function value(u: U): number {
  const v = u.v;
  return v === undefined ? -1 : v;
}
function text(u: U): string {
  return u.s ?? "none";
}
function narrowed(u: U): number {
  if (u.kind === "c" || u.kind === "d") return (u.v ?? 100) + 1000;
  return u.v * 2 + (u.kind === "e" && u.next !== undefined ? u.next.v : 0);
}
export function run(): number {
  const items: U[] = [
    { kind: "a", v: 1, s: "x" },
    { kind: "b", w: true, v: 2, s: "yy" },
    { kind: "c", v: 3 },
    { kind: "c" },
    { kind: "d", v: undefined, s: undefined },
    { kind: "d", v: 4, s: "zzz" },
    { kind: "e", v: 5, s: "e", next: { kind: "e", v: 6, s: "f", next: undefined } },
  ];
  let total = 0;
  for (let round = 0; round < 3; round++)
    for (let i = 0; i < items.length; i++) {
      const u = items[i];
      if (u === undefined) return -1;
      total = total * 7 + value(u) * 3 + narrowed(u) + text(u).length;
      total %= 1000000007;
    }
  return total;
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
          .replace(/^interface .*$/gm, "")
          .replace(/^type .*$/gm, "")
          .replace(/: U\[\]/g, "")
          .replace(/\(u: U\)/g, "(u)")
          .replace(/: (number|string)/g, "")
          .replace(/export /, "") + "\nreturn run();",
      );
      return fn() as number;
    })()} ? 42 : 1; }`,
  "union-field-reads",
  [],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeCopyingRuntime",
    managedBytes: 4194304,
    allocationCapacity: 65536,
    rootCapacity: 4096,
    stackBytes: 1048576,
  },
);
