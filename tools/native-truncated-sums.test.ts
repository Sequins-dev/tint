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
