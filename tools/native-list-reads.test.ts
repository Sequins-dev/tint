// Element reads in loops use a vector cached ahead of the loop
// (cacheListVectors). Dense, sparse, holey and empty lists must read as in
// ECMAScript, including indexes out of range, lists that grow between loops,
// and loops that grow and overwrite the list they read. In a loop with calls,
// a call (directly, through another function or in a nested loop) may
// replace the root on some iterations: reads after it in the iteration and
// reads in later iterations must see the new root. The same source runs in
// Node for the expected checksum and natively under LLDB.
//
// Loops with calls and allocations keep their caches too, refreshed after
// each call that may write a list header: the second fixture grows, shrinks
// and replaces roots directly, through called functions and closures and
// through aliases, reads holes and stored undefined, allocates enough to move
// the lists during the loop, and throws out of loops mid-iteration.
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
function occasionally(items: Item[], other: Item[]): number {
  let total = 0;
  for (let i = 0; i < 400; i++) {
    const a = items[i % (items.length + 2)];
    const b = other[i >> 1];
    total =
      (total * 5 + (a === undefined ? 3 : a.value) + (b === undefined ? 9 : b.value)) %
      1000003;
    // Growth reallocates the roots on some iterations.
    if (i % 7 === 0) {
      items.push({ value: i });
      other.push({ value: -i });
    }
    if (i % 11 === 0) items[i % items.length] = { value: i * 3 };
  }
  return total;
}
function extend(items: Item[], count: number): void {
  for (let i = 0; i < count; i++) items.push({ value: items.length * 2 });
}
function indirectly(items: Item[]): number {
  let total = 0;
  for (let i = 0; i < 300; i++) {
    const before = items[i];
    if (i % 5 === 0) extend(items, 3);
    // Read after the call in the same iteration.
    const after = items[i + 1];
    total =
      (total * 7 +
        (before === undefined ? 1 : before.value) +
        (after === undefined ? 2 : after.value)) %
      1000003;
  }
  return total;
}
function nested(items: Item[]): number {
  let total = 0;
  for (let i = 0; i < 60; i++) {
    const item = items[i * 3];
    total = (total * 3 + (item === undefined ? 4 : item.value)) % 1000003;
    for (let j = 0; j < 4; j++) if ((i + j) % 9 === 0) items.push({ value: i * j });
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
  total = (total * 31 + grow([{ value: 3 }])) % 1000003;
  total = (total * 31 + occasionally([{ value: 1 }], [{ value: 2 }])) % 1000003;
  total = (total * 31 + indirectly([{ value: 5 }, { value: 6 }])) % 1000003;
  return (total * 31 + nested([{ value: 8 }])) % 1000003;
}
`;

const mutating = `interface Item {
  readonly value: number;
}
interface Holder {
  list: Item[];
}
function value(item: Item | undefined, missing: number): number {
  return item === undefined ? missing : item.value;
}
function mix(total: number, part: number): number {
  return (total * 7 + part + 1000003) % 1000003;
}
// Allocates on every iteration (a safepoint), so the cached vector must
// survive collections that move the list's root. Writes to other kinds of
// list do not refresh it; an occasional push to it does.
function churn(items: Item[], rounds: number): number {
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    const garbage: number[] = [i, i + 1];
    const boxed = { value: garbage.length + i };
    total = mix(total, value(items[i % (items.length + 1)], 5) + boxed.value);
    if (i % 4999 === 0) items.push(boxed);
  }
  return total;
}
function shrink(items: Item[]): void {
  items.length = items.length >> 1;
}
function grow(items: Item[], count: number): void {
  for (let i = 0; i < count; i++) items.push({ value: items.length * 3 });
}
// Grown, shrunk and resized directly and through calls, on some iterations.
function resize(items: Item[]): number {
  let total = 0;
  for (let i = 0; i < 600; i++) {
    total = mix(total, value(items[i % 37], 2));
    if (i % 13 === 0) grow(items, 9);
    total = mix(total, value(items[(i * 5) % 41], 3));
    if (i % 29 === 0) shrink(items);
    if (i % 31 === 0) items.length = 0;
    if (i % 43 === 0) items.length = 50;
    if (i % 17 === 0) items.pop();
    if (i % 19 === 0) items.splice(1, 2, { value: -i });
    total = mix(total, value(items[i % 23], 4) + items.length);
    // Several reads per iteration: more than the write sites.
    total = mix(
      total,
      value(items[i % 3], 0) +
        value(items[i % 5], 1) +
        value(items[i % 7], 2) +
        value(items[i % 11], 3) +
        value(items[i % 13], 4) +
        value(items[i % 17], 5) +
        value(items[i % 19], 6) +
        value(items[i % 23], 7),
    );
    total = mix(
      total,
      value(items[(i + 1) % 3], 0) +
        value(items[(i + 1) % 5], 1) +
        value(items[(i + 1) % 7], 2) +
        value(items[(i + 1) % 11], 3) +
        value(items[(i + 1) % 13], 4) +
        value(items[(i + 1) % 17], 5) +
        value(items[(i + 1) % 19], 6) +
        value(items[(i + 1) % 23], 7),
    );
    total = mix(
      total,
      value(items[(i + 2) % 3], 0) +
        value(items[(i + 2) % 5], 1) +
        value(items[(i + 2) % 7], 2) +
        value(items[(i + 2) % 11], 3) +
        value(items[(i + 2) % 13], 4) +
        value(items[(i + 2) % 17], 5) +
        value(items[(i + 2) % 19], 6) +
        value(items[(i + 2) % 23], 7),
    );
  }
  return total;
}
// The list is changed through a closure and through a holder field that
// aliases it.
function closures(items: Item[]): number {
  const holder: Holder = { list: items };
  const add = (n: number): void => {
    for (let k = 0; k < n; k++) holder.list.push({ value: k * 11 });
  };
  const clear = (): void => {
    items.length = 0;
  };
  let total = 0;
  for (let i = 0; i < 400; i++) {
    total = mix(total, value(items[i % 19], 6));
    if (i % 7 === 0) add(5);
    if (i % 53 === 0) clear();
    // Replaces the holder's list: later adds no longer reach items.
    if (i === 300) holder.list = [];
    total = mix(total, value(items[(i * 3) % 29], 7));
  }
  return total;
}
// Two names for one list: writes through one, reads through the other.
function aliased(items: Item[], alias: Item[]): number {
  let total = 0;
  for (let i = 0; i < 300; i++) {
    total = mix(total, value(items[i % 31], 8));
    if (i % 5 === 0) alias.push({ value: i * 2 });
    if (i % 41 === 0) alias.length = 3;
    if (i % 3 === 0) alias[i % 7] = { value: i };
    // Several reads per iteration: more than the write sites.
    total = mix(
      total,
      value(items[i % 3], 0) +
        value(items[i % 5], 1) +
        value(items[i % 7], 2) +
        value(items[i % 11], 3) +
        value(items[i % 13], 4) +
        value(items[i % 17], 5) +
        value(items[i % 19], 6) +
        value(items[i % 23], 7),
    );
    total = mix(total, value(items[(i + 3) % 17], 9) + value(alias[i % 13], 1));
  }
  return total;
}
// Holes, stored undefined and indexes past the end.
function holes(items: (Item | undefined)[]): number {
  let total = 0;
  for (let i = 0; i < 300; i++) {
    const before = items[i % 40];
    if (i % 3 === 0) items[i % 40] = undefined;
    if (i % 4 === 0) items[(i * 7) % 45] = { value: i };
    if (i % 11 === 0) items.push({ value: items.length });
    const after = items[i % 40];
    // Several reads per iteration: more than the write sites.
    total = mix(
      total,
      ((items[i % 3] ?? { value: 0 }).value) +
        ((items[i % 5] ?? { value: 1 }).value) +
        ((items[i % 7] ?? { value: 2 }).value) +
        ((items[i % 11] ?? { value: 3 }).value) +
        ((items[i % 13] ?? { value: 4 }).value) +
        ((items[i % 17] ?? { value: 5 }).value) +
        ((items[i % 19] ?? { value: 6 }).value) +
        ((items[i % 23] ?? { value: 7 }).value),
    );
    total = mix(
      total,
      (before === undefined ? 1 : before.value) +
        (after === undefined ? 2 : after.value) +
        (i % 40 < items.length ? 3 : 0),
    );
  }
  return total;
}
function failing(items: Item[], at: number): void {
  items.push({ value: at });
  if (at % 9 === 4) throw "stop " + String(at);
}
function check(at: number): void {
  if (at % 13 === 6) throw "check " + String(at);
}
// Exceptions thrown from the loop, after a header write or not, caught
// outside the loop and inside it.
function throwing(items: Item[]): number {
  let total = 0;
  for (let round = 0; round < 8; round++) {
    try {
      for (let i = 0; i < 50; i++) {
        total = mix(total, value(items[i % 11], 12));
        if (i % 4 === round % 4) failing(items, round * 50 + i);
        check(round * 50 + i + 1);
        total = mix(total, value(items[items.length - 1], 13));
      }
    } catch (error) {
      total = mix(total, items.length + value(items[round], 14));
    }
  }
  for (let i = 0; i < 40; i++) {
    total = mix(total, value(items[i % 13], 15));
    try {
      if (i % 2 === 0) failing(items, i);
    } catch (error) {
      total = mix(total, value(items[items.length - 1], 16));
    }
    total = mix(total, value(items[items.length - 1], 17));
  }
  return total;
}
function list(count: number): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < count; i++) items.push({ value: i });
  return items;
}
export function checksum(): number {
  let total = churn(list(64), 60000);
  total = mix(total, resize(list(40)));
  total = mix(total, closures(list(10)));
  const shared = list(12);
  total = mix(total, aliased(shared, shared));
  total = mix(total, aliased(list(12), list(4)));
  const holey: (Item | undefined)[] = [];
  holey[5] = { value: 50 };
  holey[30] = undefined;
  total = mix(total, holes(holey));
  const dense: (Item | undefined)[] = [];
  for (let i = 0; i < 40; i++) dense.push({ value: i });
  total = mix(total, holes(dense));
  return mix(total, throwing(list(5)));
}
`;

async function expectedChecksum(text: string): Promise<number> {
  const directory = mkdtempSync(join(tmpdir(), "tint-list-reads-"));
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

test("cached list vectors stay current across calls, aliases, collections and throws", async () => {
  const expected = await expectedChecksum(mutating);
  assert.equal(typeof expected, "number");
  verifyHostedFixture(
    mutating +
      `export function run(): number { return checksum() === ${expected} ? 42 : 1; }\n`,
    "list-reads-mutating",
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

test("cached list vectors read dense, sparse, holey and empty lists like ECMAScript", async () => {
  const expected = await expectedChecksum(source);
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
