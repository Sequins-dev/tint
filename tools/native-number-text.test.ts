// Native number↔string conversions (foundation number-text), on the typed
// path: decimal and prefixed strings through Number() on both sides of the
// exact fast paths (15 significant digits, |exponent| 22, integers below
// 2^53) and the bignum paths beyond them. (parseInt and parseFloat do not
// link in typed code yet; Node unit tests and Test262 cover them.)
// Expected values come from Node and reach the fixture as numeric literals,
// which the Node-hosted compiler parses with V8, independently of the
// native runtime under test. Built natively and run under LLDB.
import test from "node:test";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

function literal(value: number): string {
  if (Object.is(value, -0)) return "-0";
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
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

const texts = decimalTexts();
const source = `const texts: string[] = [${texts.map((text) => JSON.stringify(text)).join(", ")}];
const numbers: number[] = [${texts.map((text) => literal(Number(text))).join(", ")}];
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
  return 42;
}
`;

test("native number-text conversions agree with Node across the fast-path bounds", () => {
  verifyHostedFixture(source, "number-text", [], [], [], [], {
    managedBytes: 16777216,
    allocationCapacity: 262144,
  });
});
