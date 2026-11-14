// String lists store each string's word directly in the dense vector (a
// stored undefined is the vector itself, a hole is null) instead of boxing
// it in a cell. Empty strings, stored undefined, holes, growth, sparse
// migration, copies, sorting and joins must read as in ECMAScript. The same
// source runs in Node for the expected checksum and natively under LLDB.
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

const source = `function score(text: string | undefined): number {
  if (text === undefined) return 7;
  const value: string = text;
  let total = value.length * 31 + 3;
  for (let i = 0; i < value.length; i++)
    total = (total * 33 + value.charCodeAt(i)) % 1000003;
  return total;
}
function sum(items: string[], extra: number): number {
  let total = items.length;
  for (let i = -1; i < items.length + extra; i++)
    total = (total * 3 + score(items[i])) % 1000003;
  return total;
}
function sumOptional(items: (string | undefined)[], extra: number): number {
  let total = items.length;
  for (let i = -1; i < items.length + extra; i++)
    total = (total * 3 + score(items[i])) % 1000003;
  return total;
}
export function checksum(): number {
  const words: string[] = [];
  for (let i = 0; i < 100; i++) words.push(i % 5 === 0 ? "" : "w" + i);
  let total = sum(words, 2);
  // Empty strings are present elements, not holes or undefined.
  let empties = 0;
  for (let i = 0; i < words.length; i++) if (words[i] === "") empties++;
  total = (total * 31 + empties) % 1000003;
  const optional: (string | undefined)[] = ["a", undefined, "", "b"];
  optional[6] = "far";
  optional[1] = "set";
  optional[2] = undefined;
  total = (total * 31 + sumOptional(optional, 2)) % 1000003;
  // A write far past the length makes the list sparse; it keeps reading.
  const sparse: string[] = ["x", "", "y"];
  sparse[2000000] = "z";
  sparse[1] = "q";
  total = (total * 31 + score(sparse[2000000]) + score(sparse[1]) + score(sparse[5]) + sparse.length) % 1000003;
  // Copies, sorting, joins and pops.
  const copy = words.slice(10, 30);
  copy.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  total = (total * 31 + score(copy.join(","))) % 1000003;
  const mapped = words.map((word) => word + "!");
  total = (total * 31 + score(mapped.join(""))) % 1000003;
  const popped = words.pop();
  total = (total * 31 + score(popped) + words.length) % 1000003;
  const filtered = words.filter((word) => word.length > 2);
  total = (total * 31 + filtered.length + score(filtered[3])) % 1000003;
  words.length = 3;
  words.length = 6;
  total = (total * 31 + sum(words, 1)) % 1000003;
  return total;
}
`;

test("direct string lists read like ECMAScript arrays", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-string-lists-"));
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
    "string-lists",
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
