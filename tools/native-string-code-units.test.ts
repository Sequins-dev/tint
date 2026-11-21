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

const fromCharCodeSource = String.raw`
function unit(value: number): string {
  return String.fromCharCode(value);
}
function wordUnits(value: number): string {
  return String.fromCharCode((value & 15) | 48, value | 0, value >>> 0);
}
function wideUnit(value: number): string {
  return String.fromCharCode((value >>> 0) + 65536);
}
function ordered(value: number, trace: Uint8Array): number {
  trace[0] = ((trace[0] ?? 0) * 10) + value;
  return value;
}
function reject(trace: Uint8Array): number {
  trace[0] = 7;
  throw new RangeError("stop");
}
export function run(): number {
  const bytes = new Uint8Array(1);
  bytes[0] = 222;
  if (String.fromCharCode(((bytes[0] ?? 0) & 15) | 48) !== ">") return 1;
  if (wordUnits(-1) !== "?\uffff\uffff") return 2;
  if (wordUnits(2147483648) !== "0\u0000\u0000") return 3;
  if (wideUnit(-1) !== "\uffff") return 4;
  if (unit(9007199254740991) !== "\uffff") return 5;
  if (unit(-9007199254740991) !== "\u0001") return 6;
  if (unit(9007199254740992) !== "\u0000") return 7;
  if (unit(-1.9) !== "\uffff") return 8;
  if (unit(65537.75) !== "\u0001") return 9;
  if (unit(-0) !== "\u0000") return 10;
  if (unit(0 / 0) !== "\u0000") return 11;
  if (unit(1 / 0) !== "\u0000") return 12;
  if (unit(-1 / 0) !== "\u0000") return 13;
  const trace = new Uint8Array(1);
  if (String.fromCharCode(ordered(1, trace), ordered(2, trace)) !== "\u0001\u0002") return 14;
  if (trace[0] !== 12) return 15;
  let caught = false;
  try {
    String.fromCharCode(reject(trace), ordered(2, trace));
  } catch (error) {
    caught = error instanceof RangeError;
  }
  if (!caught || trace[0] !== 7) return 16;
  return 42;
}
`;

test("code-unit conversions agree with Node at integer and double boundaries", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-string-code-units-"));
  try {
    const file = join(directory, "fixture.ts");
    writeFileSync(file, fromCharCodeSource);
    const loaded = (await import(pathToFileURL(file).href)) as {
      run(): number;
    };
    assert.equal(loaded.run(), 42);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("typed native code units preserve conversions and evaluation order", () => {
  verifyHostedFixture(fromCharCodeSource, "string-code-unit-integer");
});

test("typed native UTF-8 encoding resumes without splitting a surrogate pair", () => {
  const text = "abé😀\ud800!\udc00\0雪";
  const expected = new TextEncoder().encode(text);
  verifyHostedFixture(
    `import { encodeUTF8Into } from "text-encoding";
     export function run(): number {
       const text = ${JSON.stringify(text)};
       const expected = new Uint8Array([${expected.join(",")}]);
       const scratch = new Uint8Array(4);
       let offset = 0;
       let written = 0;
       while (offset < text.length) {
         const chunk = encodeUTF8Into(text, scratch, offset);
         if (chunk.read === 0) return 1;
         for (let i = 0; i < chunk.written; i++) {
           if (scratch[i] !== expected[written + i]) return 2;
         }
         offset += chunk.read;
         written += chunk.written;
       }
       return written === expected.length ? 42 : 3;
     }`,
    "string-utf8-chunks",
    [["text-encoding", "packages/foundation/src/text/text-encoding/index.ts"]],
    [],
    [],
    [],
    {
      requireTyped: true,
      managedBytes: 67108864,
      allocationCapacity: 1048576,
      rootCapacity: 65536,
    },
  );
});
