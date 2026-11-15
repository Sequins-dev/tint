// A code unit read whose index is proven a non-negative integer below its
// string's length (`i < s.length`, directly or through a hoisted length) is
// one load yielding an integer. Reads the proof must not cover (another
// string's length, `<=`, a negative or fractional index, the index or string
// reassigned after the test) keep ECMAScript's NaN and truncation results.
// The same source runs in Node for the expected checksum and natively under
// LLDB.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const source = `function unit(code: number): number {
  return code === code ? code + 1 : 0;
}
function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}
function hoisted(value: string): number {
  let total = 0;
  const n = value.length;
  for (let i = 0; i < n; i++) total = (total * 7 + unit(value.charCodeAt(i))) % 1000003;
  return total;
}
function reversed(value: string): number {
  let total = 0;
  for (let i = 0; value.length > i; i++) total = (total * 7 + unit(value.charCodeAt(i))) % 1000003;
  return total;
}
function inclusive(value: string): number {
  let total = 0;
  for (let i = 0; i <= value.length; i++) total = (total * 7 + unit(value.charCodeAt(i))) % 1000003;
  return total;
}
function negative(value: string): number {
  let total = 0;
  for (let i = -2; i < value.length; i++) total = (total * 7 + unit(value.charCodeAt(i))) % 1000003;
  return total;
}
function fractional(value: string): number {
  let total = 0;
  for (let i = 0.5; i < value.length; i++) total = (total * 7 + unit(value.charCodeAt(i))) % 1000003;
  return total;
}
function other(a: string, b: string): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) total = (total * 7 + unit(b.charCodeAt(i))) % 1000003;
  return total;
}
function shrinking(value: string): number {
  let text = value,
    total = 0;
  for (let i = 0; i < text.length; i++) {
    text = text.slice(1);
    total = (total * 7 + unit(text.charCodeAt(i))) % 1000003;
  }
  return total;
}
function skipping(value: string): number {
  let total = 0;
  for (let i = 0; i < value.length; i++) {
    i++;
    total = (total * 7 + unit(value.charCodeAt(i))) % 1000003;
  }
  return total;
}
export function checksum(): number {
  const inputs: string[] = [
    "",
    "a",
    "hello, world",
    "caf\\u00e9 \\ud83d\\ude00 \\ud800",
    "0123456789abcdefghijklmnopqrstuvwxyz",
  ];
  let total = 0;
  for (let n = 0; n < inputs.length; n++) {
    const text = inputs[n];
    if (text === undefined) throw "input";
    const next = inputs[(n + 1) % inputs.length];
    if (next === undefined) throw "input";
    total = (total * 31 + hash(text)) % 1000003;
    total = (total * 31 + hoisted(text)) % 1000003;
    total = (total * 31 + reversed(text)) % 1000003;
    total = (total * 31 + inclusive(text)) % 1000003;
    total = (total * 31 + negative(text)) % 1000003;
    total = (total * 31 + fractional(text)) % 1000003;
    total = (total * 31 + other(text, next)) % 1000003;
    total = (total * 31 + shrinking(text)) % 1000003;
    total = (total * 31 + skipping(text)) % 1000003;
  }
  return total;
}
`;

test("string code units read like ECMAScript charCodeAt", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-code-units-"));
  let expected: number;
  try {
    const file = join(directory, "fixture.ts");
    writeFileSync(file, source);
    const module = (await import(pathToFileURL(file).href)) as {
      checksum(): number;
    };
    expected = module.checksum();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  assert.equal(typeof expected, "number");
  verifyHostedFixture(
    source +
      `export function run(): number { return checksum() === ${expected} ? 42 : 1; }\n`,
    "string-code-units",
    [],
    [],
    [],
    [],
    {
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes: 67108864,
      allocationCapacity: 1048576,
      rootCapacity: 65536,
    },
  );
});
