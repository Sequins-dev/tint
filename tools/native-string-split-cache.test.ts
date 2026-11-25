// The string-split cache behind String.prototype.split natively
// (nativeStringSplitCacheWord in @tint/abi/host): repeated splits return
// isolated fresh arrays, mutations never leak into cached snapshots, GC
// drops the table cleanly, different separators and two-argument limits stay
// distinct, and splits exceeding the cache cap (>256 elements) bypass the cache.
import test from "node:test";

process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const source = `const words = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
const csv = "10,20,30,40,50,60,70,80";
const wide = "café\\u2603alpha\\u2603beta\\u2603γ\\u2603delta";

function churn(rounds: number): number {
  let total = 0;
  for (let round = 0; round < rounds; round++) {
    const parts: string[] = [];
    for (let i = 0; i < 64; i++) parts.push("x" + String(i + round));
    total += parts.join(",").length;
  }
  return total;
}

function makeLarge(count: number): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i++) parts.push("w" + String(i));
  return parts.join(" ");
}

export function run(): number {
  const large = makeLarge(300);
  for (let round = 0; round < 5; round++) {
    // Miss, then hit, with mutation isolation on both sides.
    const a = words.split(" ");
    if (a.length !== 10 || a[0] !== "alpha" || a[9] !== "kappa") return 1;
    a[0] = "MUTATED_A";
    a.push("EXTRA");

    const b = words.split(" ");
    if (b.length !== 10 || b[0] !== "alpha" || b[9] !== "kappa") return 2;
    b[1] = "MUTATED_B";

    const c = words.split(" ");
    if (c.length !== 10 || c[0] !== "alpha" || c[1] !== "beta") return 3;

    // Different separators on the same string never collide.
    const byA = words.split("a");
    if (byA.length !== 13 || byA[0] !== "" || byA[1] !== "lph") return 4;
    const bySpace = words.split(" ");
    if (bySpace.length !== 10 || bySpace[0] !== "alpha") return 5;

    // Empty separator and empty string edge cases.
    const emptyChars = "".split("");
    if (emptyChars.length !== 0) return 6;
    const chars1 = "abcd".split("");
    chars1[0] = "Z";
    const chars2 = "abcd".split("");
    if (chars2.length !== 4 || chars2[0] !== "a" || chars2[3] !== "d") return 7;

    // Two-argument limit bypasses cache and respects limit.
    const lim = words.split(" ", 3);
    if (lim.length !== 3 || lim[2] !== "gamma") return 8;
    const full = words.split(" ");
    if (full.length !== 10 || full[9] !== "kappa") return 9;

    // Multiple strings and two-byte strings in cache simultaneously.
    const cols1 = csv.split(",");
    cols1[0] = "999";
    const cols2 = csv.split(",");
    if (cols2.length !== 8 || cols2[0] !== "10" || cols2[7] !== "80") return 10;

    const w1 = wide.split("\\u2603");
    w1[0] = "bad";
    const w2 = wide.split("\\u2603");
    if (w2.length !== 5 || w2[0] !== "café" || w2[3] !== "γ" || w2[4] !== "delta")
      return 11;

    // Over cache cap (> 256 elements) works and stays isolated.
    const big1 = large.split(" ");
    big1[0] = "NOPE";
    const big2 = large.split(" ");
    if (big2.length !== 300 || big2[0] !== "w0" || big2[299] !== "w299") return 12;

    if (churn(350 * (round + 1)) <= 0) return 13;
  }
  return 42;
}
`;

test("string split cache preserves isolation across collections", () => {
  verifyHostedFixture(source, "string-split-cache", [], [], [], [], {
    managedBytes: 8388608,
    allocationCapacity: 65536,
    runtimeEntry: "initializeGenerationalRuntime",
  });
});
