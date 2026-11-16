// Collection storage sizing: dense reference lists allocate their first
// vector at the creation hint (literals, map, collect) or from a minimum
// capacity and double from there; number lists allocate no buffer until
// their first write; Map and Set tables grow and rebuild with deletes. None
// of this is observable: lists pushed across every small capacity boundary,
// exact-size literals and maps that are then pushed, aliases, writes past the
// end, emptied and refilled lists, throws while a list is being built, and
// Map/Set resize boundaries with deletes must all behave as in ECMAScript.
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

const source = `interface Item {
  readonly value: number;
}
function mix(total: number, value: number): number {
  return (total * 31 + value + 7) % 1000003;
}
function value(item: Item | undefined, absent: number): number {
  return item === undefined ? absent : item.value;
}
function digest(items: Item[]): number {
  let total = items.length;
  for (let i = -1; i <= items.length; i++) total = mix(total, value(items[i], 5));
  return total;
}
function digestHoley(items: (Item | undefined)[]): number {
  let total = items.length;
  for (let i = -1; i <= items.length; i++) total = mix(total, value(items[i], 6));
  return total;
}
function numbers(list: number[]): number {
  let total = list.length;
  for (let i = -1; i <= list.length; i++) {
    const n = list[i];
    total = mix(total, n === undefined ? 3 : n + 1);
  }
  return total;
}
function words(list: string[]): number {
  let total = list.length;
  for (let i = 0; i <= list.length; i++) {
    const word = list[i];
    total = mix(total, word === undefined ? 9 : word.length + word.charCodeAt(0));
  }
  return total;
}
// Push across every capacity boundary up to 70, checking every prefix.
function pushes(): number {
  let total = 0;
  const items: Item[] = [];
  for (let i = 0; i < 70; i++) {
    items.push({ value: i * 3 });
    total = mix(total, digest(items));
  }
  return total;
}
// Exact-size literals and maps, then grown, overwritten and aliased.
function literals(): number {
  let total = 0;
  const one: Item[] = [{ value: 1 }];
  const two: Item[] = [{ value: 2 }, { value: 3 }];
  const three: Item[] = [{ value: 4 }, { value: 5 }, { value: 6 }];
  const five: Item[] = [{ value: 7 }, { value: 8 }, { value: 4 }, { value: 5 }, { value: 6 }];
  const empty: Item[] = [];
  for (const list of [one, two, three, five, empty]) {
    if (list === undefined) continue;
    total = mix(total, digest(list));
    const alias = list;
    for (let i = 0; i < 9; i++) {
      alias.push({ value: i + 100 });
      total = mix(total, digest(list));
    }
    list[list.length + 2] = { value: 77 };
    total = mix(total, digest(alias));
  }
  const mapped = five.map((item): Item => ({ value: item.value * 2 }));
  total = mix(total, digest(mapped));
  mapped.push({ value: 1 });
  total = mix(total, digest(mapped));
  const filtered = five.filter((item) => item.value % 2 === 0);
  filtered.push({ value: 2 });
  total = mix(total, digest(filtered));
  const sliced = five.slice(1, 4);
  sliced.push({ value: 3 });
  total = mix(total, digest(sliced));
  const holey: (Item | undefined)[] = [{ value: 1 }, , { value: 3 }, undefined];
  holey.push({ value: 4 });
  total = mix(total, digestHoley(holey));
  // Mutation inside a loop over the list being grown.
  const growing: Item[] = [{ value: 1 }, { value: 2 }];
  for (let i = 0; i < growing.length && i < 40; i++)
    growing.push({ value: value(growing[i], 0) + i });
  total = mix(total, digest(growing));
  // Emptied lists refill from the minimum capacity.
  while (growing.length > 0) growing.pop();
  total = mix(total, digest(growing));
  for (let i = 0; i < 6; i++) growing.push({ value: -i });
  total = mix(total, digest(growing));
  const strings: string[] = ["a", "bc", "def"];
  for (let i = 0; i < 6; i++) strings.push("w" + String(i));
  total = mix(total, words(strings));
  const noStrings: string[] = [];
  noStrings.push("x");
  total = mix(total, words(noStrings));
  return total;
}
function failAt(item: Item, at: number): Item {
  if (item.value === at) throw "stop";
  return { value: item.value + 1 };
}
// Abrupt completion while a pre-sized list is being filled.
function throwing(): number {
  let total = 0;
  const source: Item[] = [];
  for (let i = 0; i < 12; i++) source.push({ value: i });
  for (const at of [0, 5, 11, 99]) {
    if (at === undefined) continue;
    let built: Item[] = [];
    try {
      built = source.map((item) => failAt(item, at));
    } catch (error) {
      total = mix(total, at + 1000);
    }
    total = mix(total, digest(built));
    try {
      built = [{ value: 1 }, failAt({ value: at }, 5), { value: 3 }];
    } catch (error) {
      total = mix(total, at + 2000);
    }
    total = mix(total, digest(built));
  }
  return total;
}
// Number lists: created empty (no buffer), then read, tested, written past
// the end, pushed, popped and sorted.
function numberLists(): number {
  let total = 0;
  const empty: number[] = [];
  total = mix(total, numbers(empty));
  total = mix(total, empty.indexOf(0));
  total = mix(total, empty.pop() === undefined ? 1 : 2);
  const pushed: number[] = [];
  for (let i = 0; i < 20; i++) {
    pushed.push(i * 7 - 30);
    total = mix(total, numbers(pushed));
  }
  pushed.sort((a, b) => a - b);
  total = mix(total, numbers(pushed));
  const written: number[] = [];
  written[3] = 4;
  total = mix(total, numbers(written));
  written.push(5);
  total = mix(total, numbers(written));
  const literal: number[] = [1, 2, 3];
  literal.push(4);
  literal.push(5);
  total = mix(total, numbers(literal));
  const drained: number[] = [8, 9];
  drained.pop();
  drained.pop();
  drained.push(10);
  total = mix(total, numbers(drained));
  const sorted: number[] = [];
  sorted.sort((a, b) => a - b);
  total = mix(total, numbers(sorted));
  return total;
}
// Map and Set tables across the linear limit and bucket rebuilds, with
// deletes, re-insertion and iteration order.
function tables(): number {
  let total = 0;
  const map = new Map<string, number>();
  const set = new Set<number>();
  const objects = new Map<Item, number>();
  const keys: Item[] = [];
  for (let i = 0; i < 300; i++) {
    map.set("k" + String(i), i);
    set.add(i * 3);
    const key = { value: i };
    keys.push(key);
    objects.set(key, i);
    if (i % 3 === 0) {
      map.delete("k" + String(i >> 1));
      set.delete((i >> 1) * 3);
      const old = keys[i >> 1];
      if (old !== undefined) objects.delete(old);
    }
    if (i === 7 || i === 8 || i === 9 || i === 16 || i === 17 || i === 33 || i === 64 || i === 65 || i === 129) {
      let order = 0;
      for (const [k, v] of map) order = mix(order, v + k.length);
      for (const v of set) order = mix(order, v);
      for (const [k, v] of objects) order = mix(order, v + k.value);
      total = mix(total, order + map.size + set.size + objects.size);
    }
  }
  for (let i = 0; i < 300; i++) {
    total = mix(total, map.get("k" + String(i)) ?? -1);
    total = mix(total, set.has(i) ? 1 : 0);
    const key = keys[i];
    total = mix(total, key === undefined ? -2 : (objects.get(key) ?? -1));
  }
  // Shrink to empty, then refill past the linear limit again.
  for (let i = 0; i < 300; i++) {
    map.delete("k" + String(i));
    set.delete(i * 3);
  }
  total = mix(total, map.size + set.size);
  for (let i = 0; i < 20; i++) {
    map.set("r" + String(i), i);
    set.add(-i);
  }
  for (const [k, v] of map) total = mix(total, v + k.length);
  for (const v of set) total = mix(total, v);
  map.clear();
  set.clear();
  map.set("after", 1);
  set.add(2);
  return mix(total, map.size + set.size + (map.get("after") ?? 0));
}
export function checksum(): number {
  let total = pushes();
  total = mix(total, literals());
  total = mix(total, throwing());
  total = mix(total, numberLists());
  return mix(total, tables());
}
`;

async function expectedChecksum(text: string): Promise<number> {
  const directory = mkdtempSync(join(tmpdir(), "tint-list-capacity-"));
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

test("list, number-list and Map/Set storage sizing is unobservable", async () => {
  const expected = await expectedChecksum(source);
  assert.equal(typeof expected, "number");
  verifyHostedFixture(
    source +
      `export function run(): number { return checksum() === ${expected} ? 42 : 1; }\n`,
    "list-capacity",
    [],
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
