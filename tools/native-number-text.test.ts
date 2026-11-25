// Number(text) and String(value) natively for plain decimals, the forms
// that leave stringToNumber's one-pass decimal scan for its general path,
// and fractions whose shortest text joins integer digits, a point and
// zero-padded fraction digits. Every result must equal Node's, bit for bit.
import test from "node:test";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

/** A deterministic 32-bit generator (xorshift). */
function generator(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}
const next = generator(29);
const texts: string[] = [
  "",
  "0",
  "-0",
  "-0.0",
  "00012",
  "-00012.50",
  ".5",
  "-.5",
  "5.",
  ".",
  "-",
  "1.2.3",
  "+5",
  "0x1f",
  "0b101",
  "-0x1f",
  "1e5",
  "Infinity",
  "-Infinity",
  " 12",
  "12 ",
  "0." + "0".repeat(21) + "1",
  "0." + "0".repeat(22) + "1",
  "123456789012345",
  "1234567890123456",
  "9999999999999999",
  "48862.125",
];
for (let i = 0; i < 300; i++) {
  const digits = String(next() % 1000000000000000).padStart(
    1 + (next() % 18),
    "0",
  );
  const point = next() % (digits.length + 1);
  texts.push(digits.slice(0, point) + "." + digits.slice(point), "-" + digits);
}
const values: number[] = [
  1.05, 3.0001, 12.000000001, 48862.125, 0.5, 0.05, 1.5e-7, 99999999999.99,
  123456.7890123,
];
for (let i = 0; i < 300; i++) {
  const scale = 10 ** (1 + (next() % 9));
  values.push((next() % 100000000) / scale + (next() % 100000));
}
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

const source = `const texts: string[] = [${texts.map((text) => JSON.stringify(text)).join(", ")}];
const parsed: number[] = [${texts.map((text) => literal(Number(text))).join(", ")}];
const values: number[] = [${values.map(literal).join(", ")}];
const formatted: string[] = [${values.map((value) => JSON.stringify(String(value))).join(", ")}];
function same(a: number, b: number): boolean {
  if (a !== a) return b !== b;
  return a === b && (a !== 0 || 1 / a === 1 / b);
}
export function run(): number {
  for (let i = 0; i < texts.length; i++)
    if (!same(Number(texts[i] ?? ""), parsed[i] ?? 0)) return 1;
  for (let i = 0; i < values.length; i++) {
    const value = values[i] ?? 0;
    if (String(value) !== (formatted[i] ?? "")) return 2;
    if (String(-value) !== "-" + (formatted[i] ?? "")) return 3;
    if (!same(Number(String(value)), value)) return 4;
  }
  return 42;
}
`;

test("decimal texts and fractions convert like Node natively", () => {
  verifyHostedFixture(source, "number-text", [], [], [], []);
});
