// Compact key-index storage: entries live in dense insertion-ordered key,
// value and hash arrays behind an open-addressed slot table; deletion marks
// the entry's hash and a rebuild compacts. None of this is observable:
// colliding hashes, deletes interleaved with inserts across every rebuild
// boundary, tombstone reuse, stored undefined values, traversal order after
// compaction, value replacement during traversal, structural mutation
// rejected mid-traversal (an abrupt completion that must leave the index
// intact), SameValueZero keys, custom equality and clear must all agree with
// a reference Map. The same source runs in Node for the expected checksum
// and natively under LLDB.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const keyIndexModule = "packages/foundation/src/collections/key-index.ts";

const source = `import { createKeyIndex, createStringIndex } from "./key-index.ts";
interface Item {
  readonly id: number;
}
function mix(total: number, value: number): number {
  return (total * 31 + value + 7) % 1000003;
}
// Colliding hashes (every key in one of 5 buckets) with deletes interleaved
// across rebuilds; lookups and order checked against a reference Map.
function collisions(): number {
  const index = createKeyIndex<Item, number>((key: Item): number => key.id % 5);
  const reference = new Map<Item, number>();
  const items: Item[] = [];
  let total = 0;
  for (let i = 0; i < 600; i++) {
    const item: Item = { id: i };
    items.push(item);
    index.set(item, i * 2);
    reference.set(item, i * 2);
    if (i % 4 === 1) {
      const victim = items[i >> 1];
      if (victim !== undefined) {
        total = mix(total, index.delete(victim) ? 1 : 0);
        reference.delete(victim);
      }
    }
    if (i % 7 === 3) {
      // Re-insert a deleted key: it moves to the end of the order.
      const back = items[i >> 2];
      if (back !== undefined && !index.has(back)) {
        index.set(back, -i);
        reference.set(back, -i);
      }
    }
    if (i === 7 || i === 8 || i === 15 || i === 16 || i === 31 || i === 64 || i === 127 || i === 255 || i === 599) {
      let order = 0;
      index.forEach((value: number, key: Item): void => {
        order = mix(order, value + key.id);
      });
      let expected = 0;
      for (const [key, value] of reference) expected = mix(expected, value + key.id);
      total = mix(total, order === expected ? 11 : 0);
    }
  }
  for (const item of items) {
    if (item === undefined) continue;
    total = mix(total, index.get(item) ?? -1);
    total = mix(total, (reference.get(item) ?? -1) === (index.get(item) ?? -1) ? 1 : 0);
    total = mix(total, index.has({ id: item.id }) ? 5 : 3);
  }
  return total;
}
// Delete/insert churn at a constant size keeps reusing tombstones and forces
// same-capacity rebuilds.
function churn(): number {
  const index = createKeyIndex<number, number>((key: number): number => key);
  let total = 0;
  for (let i = 0; i < 20; i++) index.set(i, i);
  for (let round = 0; round < 2000; round++) {
    total = mix(total, index.delete(round) ? 1 : 2);
    index.set(round + 20, round);
    total = mix(total, index.get(round + 20) ?? -1);
    total = mix(total, index.get(round) ?? -1);
  }
  let order = 0;
  index.forEach((value: number, key: number): void => {
    order = mix(order, key * 3 + value);
  });
  return mix(total, order);
}
// Stored undefined values are present; absent keys are not.
function undefinedValues(): number {
  const index = createKeyIndex<number, number | undefined>((key: number): number => key % 3);
  let total = 0;
  for (let i = 0; i < 40; i++) index.set(i, i % 2 === 0 ? undefined : i);
  for (let i = 0; i < 40; i += 5) index.delete(i);
  for (let i = 0; i < 45; i++) {
    total = mix(total, index.has(i) ? 1 : 0);
    const value = index.get(i);
    total = mix(total, value === undefined ? 7 : value);
  }
  let visited = 0;
  index.forEach((value: number | undefined, key: number): void => {
    visited++;
    total = mix(total, key + (value === undefined ? 100 : value));
  });
  return mix(total, visited);
}
// Value replacement is allowed during traversal; insertion and deletion
// throw before changing anything, and the traversal guard unwinds.
function traversal(): number {
  const index = createStringIndex<number>();
  let total = 0;
  for (let i = 0; i < 30; i++) index.set("k" + String(i), i);
  for (let i = 0; i < 30; i += 3) index.delete("k" + String(i));
  index.replaceValues((value: number, key: string): number => value * 10 + key.length);
  index.forEach((value: number, key: string): void => {
    index.set(key, value + 1);
  });
  let thrown = 0;
  try {
    index.forEach((value: number, key: string): void => {
      if (value > 100) index.set("new" + key, value);
    });
  } catch (error) {
    thrown++;
  }
  try {
    index.forEach((value: number, key: string): void => {
      if (value > 200) index.delete(key);
    });
  } catch (error) {
    thrown++;
  }
  try {
    index.replaceValues((value: number, key: string): number => {
      if (value > 250) throw "stop";
      return value + 1;
    });
  } catch (error) {
    thrown++;
  }
  // The guard was released: structural changes work again.
  index.set("after", 1);
  index.delete("k1");
  let order = 0;
  index.forEach((value: number, key: string): void => {
    order = mix(order, value + key.charCodeAt(key.length - 1));
  });
  return mix(mix(total, thrown), order);
}
// SameValueZero identity (NaN equals NaN, -0 equals +0) and custom equality
// (keys equal when they differ only in their first character).
function equality(): number {
  const index = createKeyIndex<number, string>((key: number): number => (key !== key ? 0 : key === 0 ? 0 : 1));
  index.set(NaN, "nan");
  index.set(-0, "zero");
  index.set(0, "zero2");
  index.set(1.5, "x");
  let total = mix(0, (index.get(NaN) ?? "").length);
  total = mix(total, (index.get(0) ?? "").length);
  total = mix(total, index.has(2.5) ? 1 : 0);
  const custom = createKeyIndex<string, number>(
    (key: string): number => key.length,
    (left: string, right: string): boolean => left.slice(1) === right.slice(1),
  );
  for (let i = 0; i < 50; i++) custom.set("Key" + String(i), i);
  for (let i = 0; i < 50; i++) total = mix(total, custom.get("kEy" + String(i)) ?? -1);
  total = mix(total, custom.delete("xey7") ? 1 : 0);
  total = mix(total, custom.has("Key7") ? 1 : 0);
  custom.clear();
  total = mix(total, custom.has("yey8") ? 1 : 0);
  custom.set("ab", 4);
  return mix(total, custom.get("zb") ?? -1);
}
export function checksum(): number {
  let total = collisions();
  total = mix(total, churn());
  total = mix(total, undefinedValues());
  total = mix(total, traversal());
  return mix(total, equality());
}
`;

async function expectedChecksum(text: string): Promise<number> {
  const directory = mkdtempSync(join(tmpdir(), "tint-key-index-"));
  try {
    copyFileSync(keyIndexModule, join(directory, "key-index.ts"));
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

test("compact key-index storage is unobservable natively", async () => {
  const expected = await expectedChecksum(source);
  assert.equal(typeof expected, "number");
  verifyHostedFixture(
    source +
      `export function run(): number { return checksum() === ${expected} ? 42 : 1; }\n`,
    "key-index",
    [["./key-index.ts", keyIndexModule]],
    [],
    [],
    [],
    {
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes: 16777216,
      allocationCapacity: 262144,
      rootCapacity: 65536,
    },
  );
});
