// Chains of string tests against literals (`switch` cases, `||` and
// else-if chains) dispatch on the tested string's length before comparing
// contents. Every literal and every near miss (same length, one unit
// changed, prefixes, empty, non-ASCII, repeated cases, `!==` tests) must
// select the same branch as in ECMAScript. The same source runs in Node for
// the expected checksum and natively under LLDB.
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

const source = `function cases(kind: string): number {
  switch (kind) {
    case "add":
      return 1;
    case "sub":
      return 2;
    case "store":
      return 3;
    case "":
      return 4;
    case "sub":
      return 5;
    case "branch":
      return 6;
    case "caf\\u00e9":
      return 7;
    case "array-write":
      return 8;
    case "array-store":
      return 9;
    case "reference-vector-write":
      return 10;
    default:
      return 0;
  }
}
interface Op {
  readonly kind: string;
  readonly id: number;
}
function result(op: Op): number {
  if (
    op.kind === "store" ||
    op.kind === "array-write" ||
    op.kind === "array-store" ||
    op.kind === "weak-slot-clear" ||
    op.kind === "string-write"
  )
    return -1;
  return op.id;
}
function negated(kind: string): number {
  if (kind !== "load" && kind !== "store" && kind !== "move" && kind !== "x")
    return 1;
  return 2;
}
function chained(kind: string): number {
  if (kind === "jump") return 1;
  else if (kind === "branch") return 2;
  else if (kind === "return") return 3;
  else if (kind === "trap") return 4;
  else if (kind === "throw") return 5;
  return 0;
}
function variants(text: string): string[] {
  const out: string[] = [text, text + "x", text.slice(1)];
  if (text.length > 0) out.push(text.slice(0, text.length - 1));
  for (let at = 0; at < text.length; at++)
    out.push(
      text.slice(0, at) +
        String.fromCharCode(text.charCodeAt(at) + 1) +
        text.slice(at + 1),
    );
  return out;
}
export function checksum(): number {
  const words: string[] = [
    "add", "sub", "store", "", "branch", "caf\\u00e9", "cafe", "array-write",
    "array-store", "reference-vector-write", "weak-slot-clear", "string-write",
    "load", "move", "x", "jump", "return", "trap", "throw", "ldr", "y",
  ];
  let total = 0;
  for (let n = 0; n < words.length; n++) {
    const word = words[n];
    if (word === undefined) throw "word";
    const all = variants(word);
    for (let v = 0; v < all.length; v++) {
      const text = all[v];
      if (text === undefined) throw "variant";
      total = (total * 31 + cases(text)) % 1000003;
      total = (total * 31 + result({ kind: text, id: v }) + 2) % 1000003;
      total = (total * 31 + negated(text)) % 1000003;
      total = (total * 31 + chained(text)) % 1000003;
    }
  }
  return total;
}
`;

test("string literal chains dispatch like ECMAScript comparisons", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-string-dispatch-"));
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
    "string-dispatch",
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
