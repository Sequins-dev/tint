// Element reads in loops that cannot replace a list's root use a vector cached
// ahead of the loop (cacheListVectors). Dense, sparse, holey and empty lists
// must read as in ECMAScript, including indexes out of range, lists that grow
// between loops, and loops that grow and overwrite the list they read (which
// must not use a cached vector). The same source runs in Node for the
// expected checksum and natively under LLDB.
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

const source = `interface Item {
  readonly value: number;
}
function sum(items: Item[], extra: number): number {
  let total = 0;
  for (let i = -2; i < items.length + extra; i++) {
    const item = items[i];
    total = (total * 3 + (item === undefined ? 7 : item.value)) % 1000003;
  }
  return total;
}
function grow(items: Item[]): number {
  let total = 0;
  for (let i = 0; i < 200; i++) {
    if (i % 3 === 0) items.push({ value: i });
    // A stale vector would still hold the element this write replaces.
    items[0] = { value: i * 5 };
    const first = items[0];
    const item = items[i >> 1];
    total =
      (total * 7 +
        (first === undefined ? 13 : first.value) +
        (item === undefined ? 11 : item.value)) %
      1000003;
  }
  return total;
}
export function checksum(): number {
  const dense: Item[] = [];
  for (let i = 0; i < 40; i++) dense.push({ value: i });
  const holey: Item[] = [];
  holey[3] = { value: 30 };
  holey[9] = { value: 90 };
  const sparse: Item[] = [];
  sparse[100000] = { value: 5 };
  sparse[7] = { value: 6 };
  const empty: Item[] = [];
  let total = sum(dense, 3);
  total = (total * 31 + sum(holey, 3)) % 1000003;
  total = (total * 31 + sum(sparse, 3)) % 1000003;
  total = (total * 31 + sum(empty, 3)) % 1000003;
  // The list grows between loops: each loop reads the current root.
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 50; i++) dense.push({ value: round * 50 + i });
    total = (total * 31 + sum(dense, 0)) % 1000003;
  }
  return (total * 31 + grow([{ value: 3 }])) % 1000003;
}
`;

test("cached list vectors read dense, sparse, holey and empty lists like ECMAScript", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-list-reads-"));
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
    "list-reads",
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
