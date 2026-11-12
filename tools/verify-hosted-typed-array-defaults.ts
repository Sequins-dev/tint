// `typedArray[i] ?? constant` fuses the read (packages/codegen/src/aarch64/
// scalar/index.ts, fusedFallbacks): `?? +0` keeps the zero an absent read
// yields; other numeric constants are selected at the read, which leaves the
// final number in its own home. Checked natively against the host engine for
// every element type, NaN, -1, 2.5, -0, Infinity and +0 fallbacks, in-range,
// past-the-end, negative, fractional and NaN indexes, and comparisons of the
// result (the `(a[i] ?? NaN) === x` form equality folding produces).
import { verifyHostedFixture } from "./hosted-fixture.ts";

export const source = `function f8(a: Uint8Array, i: number): number { return (a[i] ?? NaN) + (a[i] ?? -1) * 3 + (a[i] ?? 0) * 5; }
function f16(a: Uint16Array, i: number): number { return (a[i] ?? 2.5) + (a[i] ?? Infinity === Infinity ? 1 : 0); }
function f32(a: Uint32Array, i: number): number { return (a[i] ?? -1) * 7 + ((a[i] ?? NaN) === 4294967295 ? 11 : 0); }
function f64(a: Float64Array, i: number): number {
  const v = a[i] ?? NaN, w = a[i] ?? -0;
  return (v !== v ? 13 : v) + (1 / w < 0 ? 17 : w);
}
function has(a: Float64Array, i: number, x: number): boolean { return (a[i] ?? NaN) === x; }
export function run(): number {
  const a8 = new Uint8Array(3), a16 = new Uint16Array(3), a32 = new Uint32Array(3), a64 = new Float64Array(3);
  for (let i = 0; i < 3; i++) { a8[i] = 254 + i; a16[i] = 65534 + i; a32[i] = 4294967293 + i; a64[i] = i === 1 ? NaN : -1.5 * i; }
  const indexes = [0, 1, 2, 3, 9, -1, 0.5, NaN, -0];
  let total = 0;
  for (let k = 0; k < indexes.length; k++) {
    const i = indexes[k] ?? 0;
    const a = f8(a8, i), b = f16(a16, i), c = f32(a32, i), d = f64(a64, i);
    total = (total * 31 + (a !== a ? 101 : a) + (b !== b ? 103 : b)) % 1000000007;
    total = (total * 37 + (c !== c ? 107 : c) + (d !== d ? 109 : d)) % 1000000007;
    total += has(a64, i, 0) ? 1 : 0;
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
          .replace(
            /: (Uint8Array|Uint16Array|Uint32Array|Float64Array|number|boolean)/g,
            "",
          )
          .replace(/export /, "") + "\nreturn run();",
      );
      return fn() as number;
    })()} ? 42 : 1; }`,
  "typed-array-defaults",
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
