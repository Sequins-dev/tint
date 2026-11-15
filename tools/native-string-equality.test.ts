// Equality with a string literal compares inline: up to 8 code units as
// immediates, up to 32 against the literal's pool copy after a length test.
// Strings built at run time (distinct objects with equal contents), the
// literals themselves, equal-length strings differing in any unit, prefixes,
// odd lengths, non-ASCII units and lone surrogates must compare as in
// ECMAScript, through `===`, `!==` and `switch`. The same source runs in Node
// for the expected checksum and natively under LLDB.
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

const source = `function classify(kind: string): number {
  switch (kind) {
    case "store":
      return 1;
    case "array-write":
      return 2;
    case "array-store":
      return 3;
    case "weak-slot-set-value":
      return 4;
    case "reference-vector-write":
      return 5;
    case "abcdefghi":
      return 6;
    case "abcdefghij":
      return 7;
    case "abcdefghijklmnop":
      return 8;
    case "abcdefghijklmnopq":
      return 9;
    case "0123456789012345678901234567890":
      return 10;
    case "01234567890123456789012345678901":
      return 11;
    case "012345678901234567890123456789012":
      return 12;
    case "caf\\u00e9-cr\\u00e8me-br\\u00fbl\\u00e9e":
      return 13;
    case "emoji \\ud83d\\ude00 face":
      return 14;
    case "lone \\ud800 surrogate":
      return 15;
    default:
      return 0;
  }
}
function rebuilt(text: string): string {
  // A distinct string object with the same units.
  let out = "";
  for (let i = 0; i < text.length; i++)
    out += String.fromCharCode(text.charCodeAt(i));
  return out;
}
function mutated(text: string, at: number): string {
  let out = "";
  for (let i = 0; i < text.length; i++)
    out += String.fromCharCode(text.charCodeAt(i) + (i === at ? 1 : 0));
  return out;
}
export function checksum(): number {
  const literals: string[] = [
    "store",
    "array-write",
    "array-store",
    "weak-slot-set-value",
    "reference-vector-write",
    "abcdefghi",
    "abcdefghij",
    "abcdefghijklmnop",
    "abcdefghijklmnopq",
    "0123456789012345678901234567890",
    "01234567890123456789012345678901",
    "012345678901234567890123456789012",
    "caf\\u00e9-cr\\u00e8me-br\\u00fbl\\u00e9e",
    "emoji \\ud83d\\ude00 face",
    "lone \\ud800 surrogate",
  ];
  let total = 0;
  for (let n = 0; n < literals.length; n++) {
    const text = literals[n];
    if (text === undefined) throw "literal";
    total = (total * 31 + classify(text)) % 1000003;
    total = (total * 31 + classify(rebuilt(text))) % 1000003;
    for (let at = 0; at < text.length; at++)
      total = (total * 31 + classify(mutated(text, at))) % 1000003;
    total = (total * 31 + classify(text.slice(0, text.length - 1))) % 1000003;
    total = (total * 31 + classify(text + "x")) % 1000003;
    total = (total * 31 + classify("")) % 1000003;
  }
  const built = rebuilt("reference-vector-write");
  if (built === "reference-vector-write") total += 100;
  if (built !== "reference-vector-write") total += 1000;
  if (mutated(built, 21) !== "reference-vector-write") total += 10000;
  if ("reference-vector-write" === built) total += 7;
  return total;
}
`;

test("string equality with literals compares like ECMAScript", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-string-equality-"));
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
    "string-equality",
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
