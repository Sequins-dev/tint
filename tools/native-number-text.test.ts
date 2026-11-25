// Native number↔string conversions (foundation number-text), on the typed
// path: decimal and prefixed strings through Number() on both sides of the
// exact fast paths (15 significant digits, |exponent| 22, integers below
// 2^53) and the bignum paths beyond them; numbers through String() and
// template literals around the integer formatter's 10^8 split, the safe
// integer limit, and shortest-decimal fractions whose text joins integer
// digits, a point, and zero-padded fraction digits. Every result must equal
// Node's, bit for bit. Built natively and run under LLDB.
import test from "node:test";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

function literal(value: number): string {
  if (Object.is(value, -0)) return "-0";
  if (Number.isNaN(value)) return "0 / 0";
  if (value === Infinity) return "1 / 0";
  if (value === -Infinity) return "-1 / 0";
  return String(value);
}

function decimalTexts(): string[] {
  const texts = [
    "0",
    "-0",
    "7",
    "-42",
    "123456789012345",
    "1234567890123456",
    "9007199254740991",
    "9007199254740992",
    "9007199254740993",
    "000000000000000000123",
    "1.230000000000000",
    "1.2300000000000000",
    "0.1",
    "0.3",
    "-4.35",
    "123.456e-7",
    "1e22",
    "1e23",
    "1e-22",
    "1e-23",
    "999999999999999e22",
    "999999999999999e-22",
    "9999999999999999e22",
    "123456789012345e-37",
    "0.000000000000000000000001",
    "-0.0e5",
    " 12 ",
    "1_0",
    "1e",
    ".5",
    "5.",
    "0x1fffffffffffff",
    "0x20000000000001",
    "0b" + "1".repeat(54),
    "0o777",
    "Infinity",
    "2.2250738585072014e-308",
    "1.7976931348623157e308",
  ];
  let state = 2026;
  for (let i = 0; i < 400; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const digits = String(state * 1000 + (i % 1000)).slice(0, 1 + (i % 17));
    const point = state % (digits.length + 1);
    const exponent = ((state >>> 8) % 61) - 30;
    texts.push(`${digits.slice(0, point)}.${digits.slice(point)}e${exponent}`);
  }
  return texts;
}

function formattedValues(): number[] {
  const values = [0, -0, 1, -1, 9, 10, 99, 100, 4294967295, 0.5, -1.25e-7];
  values.push(1e21, 1e-7, 123456789.125, Number.MAX_VALUE, Number.MIN_VALUE);
  for (let exponent = 1; exponent <= 15; exponent++)
    values.push(10 ** exponent - 1, 10 ** exponent, -(10 ** exponent + 1));
  for (let delta = 0; delta < 4; delta++)
    values.push(
      Number.MAX_SAFE_INTEGER - delta,
      Number.MAX_SAFE_INTEGER + delta,
    );
  for (const high of [1, 9, 10, 12345678, 90071991, 90071992])
    for (const low of [-1, 0, 1, 99999999])
      if (high * 100000000 + low <= Number.MAX_SAFE_INTEGER)
        values.push(high * 100000000 + low);
  let state = 47;
  for (let i = 0; i < 300; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    values.push((state % 2 ** (i % 22)) * 2 ** (i % 32) + (state & 1023));
  }
  return values;
}

const texts = decimalTexts();
const values = formattedValues();
const fastPathSource = `const texts: string[] = [${texts.map((text) => JSON.stringify(text)).join(", ")}];
const numbers: number[] = [${texts.map((text) => literal(Number(text))).join(", ")}];
const values: number[] = [${values.map(literal).join(", ")}];
const formatted: string[] = [${values.map((value) => JSON.stringify(String(value))).join(", ")}];
function same(actual: number, expected: number): boolean {
  if (actual !== actual) return expected !== expected;
  return actual === expected && (actual !== 0 || 1 / actual === 1 / expected);
}
export function run(): number {
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (text === undefined) return 2;
    if (!same(Number(text), numbers[i] ?? 0.5)) return 3;
  }
  for (let i = 0; i < values.length; i++) {
    const value = values[i] ?? 0.5;
    const expected = formatted[i];
    if (expected === undefined) return 6;
    if (String(value) !== expected) return 4;
    if (\`<\${value}>\` !== "<" + expected + ">") return 5;
  }
  return 42;
}
`;

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
const fractionTexts: string[] = [
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
  fractionTexts.push(
    digits.slice(0, point) + "." + digits.slice(point),
    "-" + digits,
  );
}
const fractionValues: number[] = [
  1.05, 3.0001, 12.000000001, 48862.125, 0.5, 0.05, 1.5e-7, 99999999999.99,
  123456.7890123,
];
for (let i = 0; i < 300; i++) {
  const scale = 10 ** (1 + (next() % 9));
  fractionValues.push((next() % 100000000) / scale + (next() % 100000));
}

const fractionSource = `const texts: string[] = [${fractionTexts.map((text) => JSON.stringify(text)).join(", ")}];
const parsed: number[] = [${fractionTexts.map((text) => literal(Number(text))).join(", ")}];
const values: number[] = [${fractionValues.map(literal).join(", ")}];
const formatted: string[] = [${fractionValues.map((value) => JSON.stringify(String(value))).join(", ")}];
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

test("native number-text conversions agree with Node across the fast-path bounds", () => {
  verifyHostedFixture(fastPathSource, "number-text", [], [], [], [], {
    managedBytes: 16777216,
    allocationCapacity: 262144,
  });
});

test("decimal texts and fractions convert like Node natively", () => {
  verifyHostedFixture(fractionSource, "number-text-fractions", [], [], [], []);
});
