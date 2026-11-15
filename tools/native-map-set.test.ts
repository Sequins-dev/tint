// Native Map and Set (linked-map, linked-set and the number/string key maps)
// and number lists
// must behave as in ECMAScript: insertion order, deletion during iteration,
// live iterators that see later additions (also across growth, compaction,
// shrinking and clear()), SameValueZero (NaN, +0 and -0), string keys
// compared by content, stored undefined keys and values, and iteration ended
// early by break or an exception. A small nursery makes collections move
// entries' keys and values while tables and cursors hold them. The same
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

const source = `interface Item {
  readonly value: number;
}
let total = 0;
function mix(value: number): void {
  total = (total * 31 + value) % 1000003;
}
function text(value: string): void {
  for (let i = 0; i < value.length; i++) mix(value.charCodeAt(i));
  mix(value.length);
}
/** Allocation pressure so minor collections move live entries. */
function churn(count: number): number {
  let kept = 0;
  for (let i = 0; i < count; i++) {
    const garbage: Item[] = [{ value: i }, { value: i + 1 }];
    const first = garbage[0];
    kept += first === undefined ? 0 : first.value & 1;
  }
  return kept;
}
function key(i: number): string {
  // Built at run time, so equal keys are distinct string objects.
  return "k" + String(i % 97) + "-" + String(i % 5);
}
function numberSets(): void {
  const set = new Set<number>();
  for (let i = 0; i < 300; i++) set.add((i * 37) % 211);
  mix(set.size);
  // SameValueZero: NaN equals NaN, -0 equals +0.
  set.add(NaN);
  set.add(NaN);
  set.add(-0);
  set.add(0);
  mix(set.size);
  mix(set.has(NaN) ? 1 : 2);
  mix(set.has(0) ? 3 : 4);
  mix(set.has(-0) ? 5 : 6);
  mix(set.has(0.5) ? 7 : 8);
  // Deleting the current and later members while iterating, and adding new
  // ones that the live iterator must visit (past several regrowths).
  let visits = 0;
  for (const value of set) {
    visits++;
    if (value !== value) mix(999);
    else mix(value);
    if (visits % 3 === 0) set.delete(value);
    if (visits % 4 === 0) set.delete((value * 37 + 1) % 211);
    if (visits < 400 && visits % 2 === 0) set.add(1000 + visits);
    if (visits % 50 === 0) churn(200);
  }
  mix(visits);
  mix(set.size);
  // Delete nearly everything (shrinking compaction) under an open iterator.
  let steps = 0;
  for (const value of set) {
    steps++;
    mix(value !== value ? 31 : value);
    if (steps === 1) {
      const victims: number[] = [];
      for (const other of set) if (other !== value) victims.push(other);
      for (let i = 0; i + 3 < victims.length; i++) {
        const victim = victims[i];
        if (victim !== undefined) set.delete(victim);
      }
      churn(500);
    }
  }
  mix(steps);
  mix(set.size);
  // clear() keeps live iterators: later additions are visited.
  steps = 0;
  for (const value of set) {
    steps++;
    mix(value !== value ? 32 : value + 100);
    if (steps === 1) {
      set.clear();
      mix(set.size);
      set.add(5);
      set.add(6);
    }
  }
  mix(steps);
  mix(set.size);
}
function stringSets(): void {
  const set = new Set<string>();
  for (let i = 0; i < 400; i++) set.add(key(i));
  mix(set.size);
  mix(set.has("k3-3") ? 1 : 2);
  mix(set.has(key(3)) ? 3 : 4);
  mix(set.has("k3-4") ? 5 : 6);
  let seen = 0;
  for (const value of set) {
    seen++;
    if (seen % 5 === 0) set.delete(value);
    if (seen === 40) break;
  }
  churn(300);
  for (const value of set) text(value);
  mix(set.size);
}
function objectSets(): void {
  const items: Item[] = [];
  for (let i = 0; i < 60; i++) items.push({ value: i });
  const set = new Set<Item>();
  for (const item of items) if (item !== undefined) set.add(item);
  for (const item of items) if (item !== undefined) set.add(item);
  mix(set.size);
  // Identity, not structure.
  mix(set.has({ value: 3 }) ? 1 : 2);
  const third = items[3];
  if (third !== undefined) mix(set.has(third) ? 3 : 4);
  churn(1000);
  for (const item of set) {
    mix(item.value);
    if (item.value % 4 === 0) set.delete(item);
  }
  mix(set.size);
  const copy = new Set<Item>(set);
  set.clear();
  mix(copy.size);
  for (const item of copy) mix(item.value);
}
function optionalSets(): void {
  const set = new Set<number | undefined>();
  set.add(undefined);
  set.add(1);
  set.add(undefined);
  mix(set.size);
  for (let i = 0; i < 20; i++) set.add(i);
  for (const value of set) mix(value === undefined ? 77 : value);
  set.delete(undefined);
  mix(set.has(undefined) ? 1 : 2);
  set.add(undefined);
  for (const value of set) mix(value === undefined ? 78 : value);
}
function numberMaps(): void {
  const map = new Map<number, string>();
  for (let i = 0; i < 300; i++) map.set((i * 13) % 257, key(i));
  mix(map.size);
  map.set(NaN, "nan");
  map.set(NaN, "nan2");
  map.set(-0, "zero");
  mix(map.size);
  const zero = map.get(0);
  text(zero === undefined ? "missing" : zero);
  const nan = map.get(NaN);
  text(nan === undefined ? "missing" : nan);
  let visits = 0;
  for (const [k, v] of map) {
    visits++;
    mix(k !== k ? 4242 : k);
    text(v);
    if (visits % 3 === 0) map.delete(k);
    // Replacing a value keeps the entry's position.
    if (visits % 5 === 0) map.set((k * 13) % 257, "replaced");
    if (visits < 200 && visits % 2 === 0) map.set(5000 + visits, "added");
    if (visits % 64 === 0) churn(300);
  }
  mix(visits);
  mix(map.size);
  let steps = 0;
  for (const [k, v] of map) {
    steps++;
    mix(k !== k ? 33 : k);
    text(v);
    if (steps === 1) {
      map.clear();
      map.set(1, "after clear");
      map.set(2, "again");
    }
  }
  mix(steps);
}
function stringMaps(): void {
  const counts = new Map<string, number>();
  for (let i = 0; i < 2000; i++) {
    const word = key(i * 7);
    counts.set(word, (counts.get(word) ?? 0) + 1);
    if (i % 250 === 0) churn(400);
  }
  mix(counts.size);
  for (const [word, count] of counts) {
    text(word);
    mix(count);
  }
  for (let i = 0; i < 2000; i += 3) counts.delete(key(i));
  mix(counts.size);
  // Stored undefined values are present.
  const optional = new Map<string, number | undefined>();
  optional.set("a", undefined);
  optional.set(key(1), 1);
  mix(optional.has("a") ? 1 : 2);
  mix(optional.get("a") === undefined ? 3 : 4);
  mix(optional.has("b") ? 5 : 6);
  for (const [k, v] of optional) {
    text(k);
    mix(v === undefined ? 55 : v);
  }
}
function objectMaps(): void {
  const items: Item[] = [];
  for (let i = 0; i < 100; i++) items.push({ value: i * 2 });
  const map = new Map<Item, Item[]>();
  for (const item of items)
    if (item !== undefined) map.set(item, [item, { value: -item.value }]);
  churn(2000);
  let sum = 0;
  for (const [item, pair] of map) {
    const second = pair[1];
    sum += item.value + (second === undefined ? 0 : second.value * 3);
    if (item.value % 6 === 0) map.delete(item);
  }
  mix(sum % 1000003);
  mix(map.size);
  // An exception leaves the map and a fresh iteration consistent.
  try {
    for (const [item] of map) {
      if (item.value > 50) throw "stop";
      map.set({ value: 1000 + item.value }, []);
    }
  } catch (error) {
    mix(error === "stop" ? 1 : 2);
  }
  mix(map.size);
  for (const [item, pair] of map) mix(item.value + pair.length);
}
/** Number lists start dense with no presence storage; holes, stored
 * undefined and growth by length make them holey; emptying makes them dense. */
function numberLists(): void {
  for (let round = 0; round < 3; round++) {
    const empty: number[] = [];
    mix(empty.length);
    mix(empty[0] === undefined ? 1 : 2);
    const dense: number[] = [];
    for (let i = 0; i < 40; i++) dense.push(i * 0.5 + round);
    const holey: (number | undefined)[] = [1, 2];
    holey[6] = 7;
    holey.push(undefined);
    holey[1] = undefined;
    churn(100);
    for (let i = -1; i < 10; i++) {
      const value = holey[i];
      mix(value === undefined ? 61 : value);
    }
    holey.length = 3;
    holey.length = 5;
    for (let i = 0; i < 6; i++) {
      const value = holey[i];
      mix(value === undefined ? 63 : value);
    }
    holey.length = 0;
    holey.push(9);
    mix(holey.length + (holey[0] ?? 0));
    let sum = 0;
    for (const value of dense) sum += value === undefined ? 0 : value;
    mix(sum);
    dense.length = 10;
    dense.length = 12;
    mix(dense[11] === undefined ? 65 : 66);
    mix(dense[9] ?? 67);
    const popped = dense.pop();
    mix(popped === undefined ? 69 : popped);
  }
}
export function checksum(): number {
  total = 0;
  numberLists();
  numberSets();
  stringSets();
  objectSets();
  optionalSets();
  numberMaps();
  stringMaps();
  objectMaps();
  return total;
}
`;

test("native Map and Set follow ECMAScript order, mutation and equality under moving collection", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-map-set-"));
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
    "map-set",
    [],
    [],
    [],
    [],
    {
      runtimeEntry: "initializeGenerationalRuntime",
      // A small heap: many minor and major collections move everything the
      // tables and cursors hold.
      managedBytes: 4194304,
      allocationCapacity: 1048576,
      rootCapacity: 65536,
    },
  );
});
