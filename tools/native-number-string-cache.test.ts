// The number-string cache behind numberToString natively
// (nativeNumberStringCacheWord in @tint/abi/host): repeated conversions of
// numbers whose bits share and miss table slots, read before and after
// collections that drop the table. Every string must equal Node's.
import test from "node:test";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const values: number[] = [];
for (let i = 1; i < 700; i++) values.push(i, -i, i * 977, i / 8);
values.push(
  0.1,
  1e21,
  1e-7,
  123456789012345680000,
  9007199254740991,
  -9007199254740991,
  2 ** 53,
  5e-324,
  1.7976931348623157e308,
  -0,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
);
const literal = (value: number): string =>
  Object.is(value, -0)
    ? "-0"
    : Number.isNaN(value)
      ? "0 / 0"
      : value === Number.POSITIVE_INFINITY
        ? "1 / 0"
        : value === Number.NEGATIVE_INFINITY
          ? "-1 / 0"
          : String(value);

const source = `const values: number[] = [${values.map(literal).join(", ")}];
const expected: string[] = [${values.map((value) => JSON.stringify(String(value))).join(", ")}];
/** Allocation pressure: strings that die young, so collections run. */
function churn(rounds: number): number {
  let total = 0;
  for (let round = 0; round < rounds; round++) {
    const parts: string[] = [];
    for (let i = 0; i < 64; i++) parts.push("x" + String(i + round));
    total += parts.join(",").length;
  }
  return total;
}
export function run(): number {
  for (let round = 0; round < 6; round++) {
    for (let i = 0; i < values.length; i++) {
      const value = values[i] ?? 0,
        text = expected[i] ?? "";
      // A miss (or a hit), then a hit.
      if (String(value) !== text) return 1 + round * 10;
      if (String(value) !== text) return 2 + round * 10;
      if (\`<\${value}>\` !== "<" + text + ">") return 3 + round * 10;
    }
    if (churn(400 * (round + 1)) <= 0) return 4 + round * 10;
  }
  return 42;
}
`;

test("numbers convert through the cache across collections", () => {
  verifyHostedFixture(
    source,
    "number-string-cache",
    [],
    [],
    [],
    [],
    // A small heap, so the churn collects many times.
    {
      managedBytes: 8388608,
      allocationCapacity: 65536,
      runtimeEntry: "initializeGenerationalRuntime",
    },
  );
});
