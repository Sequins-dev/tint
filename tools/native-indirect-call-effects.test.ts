// Indirect calls in a closed program reach only the address-taken functions
// of their signature (indirectCallTargets), so list-vector caching and loop
// cell promotion union those targets' effects instead of assuming an
// indirect call writes everything. Each loop here calls closures that may
// replace a list's root or write a captured binding on some iterations,
// among closures that do not: reads after the call and in later iterations
// must see the change. Closures are called directly from locals, after
// being stored in records and lists, through generic helpers, and while
// recursing into each other; some calls throw out of the loop. The same
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
interface Hooks {
  readonly before: (items: Item[], i: number) => void;
  readonly after: (items: Item[], i: number) => void;
}
function mix(total: number, value: number): number {
  return (total * 31 + value) % 1000003;
}
function read(items: Item[], index: number): number {
  const item = items[index];
  return item === undefined ? 7 : item.value;
}
/** Applies a callback through a generic helper. */
function apply<T>(value: T, i: number, callback: (value: T, i: number) => void): void {
  callback(value, i);
}
/** A closure that grows (and so may reallocate) the list, called from a
 * local on some iterations. */
function local(items: Item[]): number {
  const grow = (list: Item[], i: number): void => {
    for (let k = 0; k < 5; k++) list.push({ value: i * 10 + k });
  };
  const keep = (list: Item[], i: number): void => {
    if (list.length < 0) list.push({ value: i });
  };
  let total = 0;
  for (let i = 0; i < 300; i++) {
    const before = read(items, i);
    (i % 4 === 0 ? grow : keep)(items, i);
    total = mix(mix(total, before), read(items, i + 3));
  }
  return mix(total, items.length);
}
/** Closures held in a record and in a list, chosen per iteration. */
function stored(items: Item[]): number {
  const hooks: Hooks = {
    before: (list, i) => {
      if (i % 9 === 0) list.push({ value: -i });
    },
    after: (list, i) => {
      if (i % 13 === 0) list[0] = { value: i * 3 };
    },
  };
  const table: ((list: Item[], i: number) => void)[] = [
    (list, i) => {
      if (list.length > 1000) list.pop();
    },
    (list, i) => {
      for (let k = 0; k < (i % 3); k++) list.push({ value: k });
    },
    hooks.after,
  ];
  let total = 0;
  for (let i = 0; i < 400; i++) {
    hooks.before(items, i);
    total = mix(total, read(items, i % (items.length + 2)));
    const pick = table[i % table.length];
    if (pick !== undefined) pick(items, i);
    total = mix(total, read(items, 0) + read(items, i >> 1));
    hooks.after(items, i);
  }
  return mix(total, items.length);
}
/** Callbacks passed through a generic helper, one of which replaces the
 * root of the very list the loop reads. */
function generic(items: Item[]): number {
  let total = 0;
  const callbacks: ((list: Item[], i: number) => void)[] = [
    (list, i) => {
      total = mix(total, list.length + i);
    },
    (list, i) => {
      if (i % 6 === 1) for (let k = 0; k < 7; k++) list.push({ value: i - k });
    },
  ];
  for (let i = 0; i < 250; i++) {
    const callback = callbacks[i % 2];
    if (callback !== undefined) apply<Item[]>(items, i, callback);
    total = mix(total, read(items, i + 1));
  }
  return mix(total, items.length);
}
/** Closures recursing into each other; only the deepest level writes. */
function recursive(items: Item[]): number {
  let depth = 0;
  const even: (list: Item[], n: number) => void = (list, n) => {
    depth++;
    if (n === 0) list.push({ value: depth });
    else odd(list, n - 1);
  };
  const odd: (list: Item[], n: number) => void = (list, n) => {
    depth++;
    if (n > 0) even(list, n - 1);
  };
  let total = 0;
  for (let i = 0; i < 200; i++) {
    (i % 2 === 0 ? even : odd)(items, i % 5);
    total = mix(total, read(items, i) + depth);
  }
  return mix(total, items.length);
}
/** A loop updating a captured binding while calling closures, one of which
 * writes the same binding: the loop must see each write. */
function captured(limit: number): number {
  let count = 0;
  let calls = 0;
  const bump = (step: number): void => {
    count += step;
  };
  const tally = (step: number): void => {
    calls += step;
  };
  const steps: ((step: number) => void)[] = [tally, bump, tally];
  const run = (): number => {
    let total = 0;
    for (let i = 0; i < limit; i++) {
      count++;
      const step = steps[i % steps.length];
      if (step !== undefined) step(i % 4);
      total = mix(total, count);
    }
    return total;
  };
  return mix(run(), mix(count, calls));
}
/** A closure throwing out of the loop after replacing the list's root. */
function throwing(items: Item[]): number {
  const grow = (list: Item[], i: number): void => {
    for (let k = 0; k < 9; k++) list.push({ value: i + k });
    if (i === 17) throw "stop";
  };
  let total = 0;
  try {
    for (let i = 0; i < 100; i++) {
      total = mix(total, read(items, i));
      if (i % 3 === 2) grow(items, i);
      total = mix(total, read(items, i + 4));
    }
  } catch {
    total = mix(total, read(items, items.length - 1));
  }
  return mix(total, items.length);
}
function list(count: number): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < count; i++) items.push({ value: i });
  return items;
}
export function checksum(): number {
  let total = mix(0, local(list(3)));
  total = mix(total, stored(list(4)));
  total = mix(total, generic(list(2)));
  total = mix(total, recursive(list(1)));
  total = mix(total, captured(97));
  return mix(total, throwing(list(5)));
}
`;

test("indirect calls that may write a list or a captured binding keep loops current", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-indirect-effects-"));
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
    "indirect-call-effects",
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
