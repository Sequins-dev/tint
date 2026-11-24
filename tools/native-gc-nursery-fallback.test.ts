// A generational nursery keeps no object-start bits: it is bump-allocated
// without gaps. When a nursery's survivors cannot fit what the old prefix has
// left, the collection compacts old and young together, and the compactor
// records the nursery's object starts by walking it (recordObjectStarts in
// tracing/cheney.ts). These fixtures force that path:
// 1. blocks retained up to about 0.6 of the capacity are promoted;
// 2. every other one is dropped, leaving garbage in the old prefix;
// 3. a nursery full of fresh survivors (about 0.35 of the capacity in all)
//    cannot fit the old prefix's remaining room, so the collection compacts
//    in place, freeing the garbage;
// 4. garbage churn runs more minor and major collections over the
//    compacted data.
// Every retained block must read back exactly. The small heap compacts with
// serial marking; the large one marks on the collector pool. The same source
// runs in Node for the expected checksum.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { verifyHostedFixture } from "./hosted-fixture.ts";

/** A block: an owned Float64Array of 32 elements, 280 bytes on the heap. */
const blockBytes = 280;

function source(managedBytes: number): string {
  // The generational runtime's capacity is half the managed bytes; the old
  // prefix is three quarters of it and the nursery one quarter.
  const capacity = Math.floor(managedBytes / 1024) * 512,
    first = Math.floor((capacity * 0.6) / blockBytes),
    young = Math.floor((capacity * 0.35) / blockBytes);
  return `function block(seed: number): Float64Array {
  const values = new Float64Array(32);
  for (let i = 0; i < 32; i++) values[i] = (seed * 31 + i) % 9973;
  return values;
}
function sum(list: Float64Array[]): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    const values = list[i];
    if (values !== undefined)
      total = (total * 7 + (values[i % 32] ?? 0) + (values[31] ?? 0)) % 1000003;
  }
  return total;
}
/** Promotes ${first} blocks, then keeps every other one. */
function promoted(): Float64Array[] {
  const all: Float64Array[] = [];
  for (let i = 0; i < ${first}; i++) all.push(block(i));
  const kept: Float64Array[] = [];
  for (let i = 0; i < all.length; i += 2) {
    const values = all[i];
    if (values !== undefined) kept.push(values);
  }
  return kept;
}
export function checksum(): number {
  const kept = promoted();
  let total = sum(kept);
  const young: Float64Array[] = [];
  for (let i = 0; i < ${young}; i++) young.push(block(${first} + i));
  total = (total * 11 + sum(kept) + sum(young)) % 1000003;
  for (let round = 0; round < 3; round++)
    for (let i = 0; i < ${young}; i++) {
      const junk = block(i + round);
      total = (total + (junk[i % 32] ?? 0)) % 1000003;
    }
  return (total * 13 + sum(kept) + sum(young)) % 1000003;
}
`;
}

async function expectedChecksum(text: string): Promise<number> {
  const directory = mkdtempSync(join(tmpdir(), "tint-gc-fallback-"));
  try {
    const file = join(directory, "fixture.ts");
    writeFileSync(file, text);
    const module = (await import(pathToFileURL(file).href)) as {
      checksum(): number;
    };
    return module.checksum();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function verify(name: string, managedBytes: number): Promise<void> {
  const text = source(managedBytes);
  const expected = await expectedChecksum(text);
  assert.equal(typeof expected, "number");
  verifyHostedFixture(
    text +
      `export function run(): number { return checksum() === ${expected} ? 42 : 1; }\n`,
    name,
    [],
    [],
    [],
    [],
    {
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes,
      allocationCapacity: Math.max(262144, managedBytes / 64),
      rootCapacity: 65536,
    },
  );
}

test("a nursery that cannot fit the old prefix compacts with serial marking", async () => {
  await verify("gc-nursery-fallback-serial", 4194304);
});

test("a nursery that cannot fit the old prefix compacts with pool marking", async () => {
  await verify("gc-nursery-fallback-parallel", 33554432);
});
