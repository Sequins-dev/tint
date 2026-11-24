// Remainders by loop-invariant divisors natively (versionNonzeroDivisors):
// a loop taking `x % d` by an integer slot `d` it never writes runs a
// version reading `d` from a nonzero slot when `d > 0`, where codegen
// divides as int64s with integer results, and a cold copy otherwise.
// Positive, unit, large, zero (NaN), negative and 33-bit divisors, divisors
// computed from lengths, non-negative and negative dividends (-0 for
// multiples), results flowing into further arithmetic, slots and string
// slices, and loop-local values the cold copy renames, against Node.
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const kernelSource = `function mix(checksum: number, value: number): number {
  return (Math.imul(checksum, 31) + (value === value ? value | 0 : 77)) | 0;
}
function remainders(values: number[], divisor: number, rounds: number): number {
  const d = divisor | 0;
  let checksum = 0;
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < values.length; i++) {
      const v = values[i] ?? 0;
      // A non-negative dividend: an integer remainder below d.
      const k = (round * 7 + i * 61) % d;
      // Negative dividends: -0 for multiples of d.
      const n = ((i - 40) * 3) % d;
      const shifted = k + 8 + (i & 31);
      checksum = mix(checksum, k);
      checksum = mix(checksum, 1 / n === -Infinity ? 7 : n);
      checksum = mix(checksum, shifted * 3 + v);
    }
  }
  return checksum;
}
function wide(divisor: number, rounds: number): number {
  // A 33-bit divisor: a safe integer slot.
  const d = (divisor | 0) * 4096;
  let checksum = 0;
  for (let i = 0; i < rounds; i++) {
    const k = (i * 1099511627 + 12345) % d;
    checksum = mix(checksum, k % 1000003);
    checksum = mix(checksum, k > 1073741824 ? 1 : 2);
  }
  return checksum;
}
function slices(text: string, rounds: number): number {
  // As string-bench's slice kernel: the divisor comes from a length.
  let checksum = 0;
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < 32; i++) {
      const begin = (round * 7 + i * 61) % (text.length - 64);
      const part = text.slice(begin, begin + 8 + (i & 31));
      const tail = text.substring(begin + 32);
      checksum = mix(checksum, part.length + part.charCodeAt(3));
      checksum = mix(checksum, tail.length);
    }
  }
  return checksum;
}
function kernel(): number {
  const values: number[] = [];
  for (let i = 0; i < 90; i++) values.push((i * 37) % 101);
  let checksum = 0;
  const divisors: number[] = [7, 1, 2147483647, 0, -5, -1, 3.5, 1000003];
  for (let k = 0; k < divisors.length; k++) {
    const divisor = divisors[k] ?? 1;
    checksum = mix(checksum, remainders(values, divisor, 6));
    checksum = mix(checksum, wide(divisor, 400));
  }
  let text = "";
  for (let i = 0; i < 40; i++) text += "line " + String(i) + ": the quick brown fox\\n";
  checksum = mix(checksum, slices(text, 50));
  checksum = mix(checksum, slices(text.slice(0, 70), 5));
  checksum = mix(checksum, slices(text.slice(0, 64), 3));
  checksum = mix(checksum, slices(text.slice(0, 40), 3));
  return checksum;
}`;
// Node runs the same text (types stripped) for the expected checksum.
const kernel = new Function(
  stripTypeScriptTypes(kernelSource) + "\nreturn kernel();",
) as () => number;
const expected = kernel();

test("remainders by loop-invariant divisors compute like Node", () => {
  verifyHostedFixture(
    `${kernelSource}
export function run(): number {
  return kernel() === ${expected} ? 42 : 1;
}
`,
    "divisor-versions",
    [],
    [],
    [],
    [],
  );
});
