// Truncated sums natively: `Math.imul(h, k) + u` read only through bitwise
// operators becomes a 32-bit add of an unextended product (aarch64 scalar
// truncatedSums). Hash loops over code units, wide and negative addends,
// each bitwise consumer, immediate addends (plain, negative and shifted),
// addends near 2^53 (whose double sums round, so they keep the 64-bit
// path) and sums with a full-width use as well, against Node.
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const kernelSource = `function kernel(): number {
  const text = "the quick brown fox jumps over the lazy dog 狐 犬 0123456789";
  let h = 0,
    g = 7,
    w = 0,
    c = 5,
    total = 0;
  for (let round = 0; round < 50; round++)
    for (let i = 0; i < text.length; i++) {
      const u = text.charCodeAt(i);
      h = (Math.imul(h, 31) + u) | 0;
      g = (Math.imul(g, -1640531535) + u) >>> 0;
      w = (Math.imul(w ^ u, 16777619) + (u << 20)) ^ i;
      w = (Math.imul(w, 3) + round * 1000003) & 0x7fffffff;
      c = (Math.imul(c ^ u, 33) + 7) | 0;
      c = (Math.imul(c, 17) + -4095) | 0;
      c = (Math.imul(c, 9) + 8192) ^ i;
      // A sum with a full-width use too keeps every bit.
      const s = Math.imul(h, 5) + 4294967296 * (i & 3);
      total = (total + (s % 1000003)) | 0;
      h = (s + u) | 0;
    }
  let negative = -123456;
  for (let i = 0; i < 1000; i++)
    negative = (Math.imul(negative, 7) + (i - 500) * 65537) | 0;
  // Sums of int32 products with addends above 2^53 - 2^31 may round.
  let wide = 99;
  for (let i = 0; i < 1000; i++) {
    wide = (Math.imul(wide, 31) + 9007199254740000) | 0;
    wide = (Math.imul(wide, 7) + (i & 3) * 3002399751580330) | 0;
    // Addends computed before the product, too.
    const big = (i & 3) * 3002399751580330,
      exact = (i & 3) * 2251799813685248;
    wide = (big + Math.imul(wide, 3)) | 0;
    wide = (exact + Math.imul(wide, 5)) ^ i;
    // A bounded integer (below 2^53 - 2^21) that is int64 storage.
    const high = ~i >>> 0,
      near = high * 2097151 + high;
    wide = (near + Math.imul(wide, 9)) | 0;
  }
  return (((h ^ g ^ w ^ c) + total) | 0) ^ negative ^ wide;
}`;
// Node runs the same text (types stripped) for the expected checksum.
const kernel = new Function(
  stripTypeScriptTypes(kernelSource) + "\nreturn kernel();",
) as () => number;
const expected = kernel();

test("truncated sums of products hash like Node", () => {
  verifyHostedFixture(
    `${kernelSource}
export function run(): number {
  return kernel() === ${expected} ? 42 : 1;
}
`,
    "truncated-sums",
    [],
    [],
    [],
    [],
  );
});

// A double addend (a fraction, NaN from an out-of-range charCodeAt, an
// infinity or an integer near and beyond 2^52 and 2^63) keeps the product's
// sign extension and ToInt32 of the double sum: every result folds into a
// checksum that never resets.
const doublesSource = `function doubles(): number {
  const addends: number[] = [
    0, -0, 1, -1, 0.5, -0.5, 1.5, -2.75, 65535, 2147483647, 2147483648,
    -2147483649, 4294967297, 4503599627370495, 4503599627370496,
    -4503599627370496, -4503599627370497, 9007199254740991, 9007199254740992,
    9007199254740993, 18014398509481984, 9223372036854775807,
    -9223372036854775808, 1e21, -1e21, 5e-324,
  ];
  addends.push(1 / 0, -1 / 0, 0 / 0);
  const seeds: number[] = [0, 1, 3, -7, 31, 123456789, -2000000001, 2147483647];
  const text = "abcdef";
  let checksum = 0;
  for (let i = 0; i < addends.length; i++)
    for (let j = 0; j < seeds.length; j++) {
      const d = addends[i] ?? 0,
        p = seeds[j] ?? 0;
      const r = (Math.imul(p, 31) + d) | 0;
      const s = (Math.imul(p, -3) + d * 3) ^ 5;
      const u = (Math.imul(p, 7) + text.charCodeAt(j)) >>> 0;
      checksum = (Math.imul(checksum, 33) + (r ^ (s >>> 1) ^ u)) | 0;
    }
  return checksum;
}`;
const doubles = new Function(
  stripTypeScriptTypes(doublesSource) + "\nreturn doubles();",
) as () => number;
const doublesExpected = doubles();

test("products plus double addends convert like Node", () => {
  verifyHostedFixture(
    `${doublesSource}
export function run(): number {
  return doubles() === ${doublesExpected} ? 42 : 1;
}
`,
    "truncated-double-sums",
    [],
    [],
    [],
    [],
  );
});
