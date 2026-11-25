// Safe-for-space stack maps: a guarded read (record, record-cell or cell
// terminator reading into a slot) writes its slot only on success, so the
// slot's previous value is dead before it unless the failure edge reads it.
// Precise stack maps and register roots no longer report such dead values,
// which frees them at the next collection instead of keeping them alive
// until the later read overwrites their slot.
//
// The first fixture checks closure semantics around field reads under
// collection pressure (a dropped live root would read a moved or freed
// object): reassigned captured lets seen by sibling closures, hoisted
// helpers reading lets declared after them, closures created in loops, recursive helpers, closures escaping through
// returned values and abrupt completion. Node runs the same source for the
// expected checksum; the native image runs under LLDB.
//
// The second fixture proves the dead value is collectable: a forced full
// collection clears a weak slot keyed by a list left in a guarded read's
// destination slot, while a list still read after the collection survives.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const closures = `interface Node {
  readonly label: string;
  readonly next: Node | undefined;
  readonly weight: number;
}
interface Counter {
  readonly bump: () => number;
  readonly read: () => number;
}
function chain(length: number, seed: number): Node | undefined {
  let head: Node | undefined = undefined;
  for (let i = 0; i < length; i++)
    head = { label: "n" + String((seed + i) % 97), next: head, weight: i };
  return head;
}
function churn(rounds: number): number {
  // Allocation pressure: collections happen while callers hold references.
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    const node = chain(8, i);
    total = (total + (node === undefined ? 0 : node.weight)) % 1000003;
  }
  return total;
}
function counter(start: number): Counter {
  let count = start;
  function bump(): number {
    count = count + 1;
    return count;
  }
  function read(): number {
    return count;
  }
  return { bump, read };
}
function siblings(): number {
  // A reassigned captured let: each sibling sees the other's writes.
  let shared = chain(3, 1);
  function replace(seed: number): void {
    shared = chain(4, seed);
  }
  function weigh(): number {
    let total = 0,
      node = shared;
    while (node !== undefined) {
      total += node.weight + node.label.length;
      node = node.next;
    }
    return total;
  }
  let sum = weigh();
  churn(200);
  replace(5);
  sum = sum * 31 + weigh();
  churn(200);
  replace(9);
  return (sum * 31 + weigh()) % 1000003;
}
function hoisted(): number {
  // A hoisted helper captures a let declared after it; it is called only
  // once the let is initialized (typed native traps a TDZ read), and sees
  // later reassignments.
  let total = 0;
  function early(): number {
    return late.weight + late.label.length;
  }
  let late: Node = { label: "late", next: undefined, weight: 7 };
  total = early();
  churn(100);
  late = { label: "later", next: late, weight: 11 };
  return total * 100 + early();
}
function loops(): number {
  // Each iteration's closure captures its own binding.
  const readers: (() => number)[] = [];
  for (let i = 0; i < 20; i++) {
    const node = chain(2, i);
    readers.push(() => (node === undefined ? -1 : node.weight + i));
    if (i % 4 === 0) churn(50);
  }
  let total = 0;
  for (const reader of readers)
    if (reader !== undefined) total = (total * 7 + reader()) % 1000003;
  return total;
}
function recursive(depth: number): number {
  // A recursive helper capturing a list and a counter.
  const seen: number[] = [];
  let calls = 0;
  function walk(node: Node | undefined, level: number): number {
    calls++;
    if (node === undefined || level > depth) return 0;
    seen.push(node.weight);
    if (level % 3 === 0) churn(20);
    return node.label.length + walk(node.next, level + 1);
  }
  const length = walk(chain(12, depth), 0);
  return length * 1000 + calls * 10 + seen.length;
}
function escaping(): number {
  // Closures escape through returned records and survive collections.
  const counters: Counter[] = [];
  for (let i = 0; i < 6; i++) counters.push(counter(i * 10));
  churn(300);
  let total = 0;
  for (const c of counters) {
    if (c === undefined) continue;
    c.bump();
    churn(10);
    total = total * 13 + c.bump() + c.read();
  }
  return total % 1000003;
}
function abrupt(): number {
  // A throw from inside a helper leaves captured state consistent.
  let state = chain(2, 3);
  function fail(limit: number): number {
    let steps = 0,
      node = state;
    while (node !== undefined) {
      steps++;
      if (steps > limit) throw node.label;
      node = node.next;
    }
    return steps;
  }
  let result = 0;
  try {
    state = chain(6, 4);
    churn(100);
    result = fail(3);
  } catch (error) {
    result = typeof error === "string" ? 500 + error.length : 1;
  }
  return result * 10 + fail(10);
}
export function checksum(): number {
  let total = 0;
  for (const part of [
    siblings(),
    hoisted(),
    loops(),
    recursive(9),
    escaping(),
    abrupt(),
  ])
    if (part !== undefined) total = (total * 1009 + part) % 1000003;
  return total;
}
`;

async function expectedChecksum(text: string): Promise<number> {
  const directory = mkdtempSync(join(tmpdir(), "tint-safe-for-space-"));
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

test("closures around guarded reads keep ECMAScript semantics under collection", async () => {
  const expected = await expectedChecksum(closures);
  assert.equal(typeof expected, "number");
  verifyHostedFixture(
    closures +
      `export function run(): number { return checksum() === ${expected} ? 42 : 1; }\n`,
    "safe-for-space-closures",
    [],
    [],
    [],
    [],
    {
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes: 1048576,
      allocationCapacity: 65536,
      rootCapacity: 65536,
    },
  );
});

const weak = "packages/native-runtime/src/intrinsics/weak.ts",
  memory = "packages/native-runtime/src/intrinsics/memory.ts";
// Each round reads `box.items` with a guarded read (two record layouts
// implement Holder) into the same slot. At the next round's collection that
// slot still holds the previous round's list, which nothing reads again.
// Before precise guarded reads, the stack map kept the slot (and round 0's
// large list) alive across collectGarbage() until the read overwrote it.
const collectable = `import {createWeakSlot,weakSlotKey} from "weak";
import {collectGarbage} from "memory";
interface Holder {
  readonly items: string[];
}
function large(prefix: string): string[] {
  const items: string[] = [];
  for (let i = 0; i < 2000; i++) items.push(prefix + String(i));
  return items;
}
function holder(round: number): Holder {
  if (round % 2 === 0)
    return { items: round === 0 ? large("dead-") : ["even" + String(round)] };
  const odd = { round, items: ["odd" + String(round)] };
  return odd;
}
function watch(): number {
  const kept: string[] = large("kept-");
  const keptCell = createWeakSlot(kept, undefined, false);
  let cell: unknown = undefined;
  let total = 0;
  for (let round = 0; round < 4; round++) {
    collectGarbage();
    if (round > 0 && weakSlotKey(cell) !== undefined) return 10 + round;
    const items = holder(round).items;
    if (round === 0) cell = createWeakSlot(items, undefined, false);
    total += items.length;
  }
  if (weakSlotKey(keptCell) !== kept || kept[1999] !== "kept-1999") return 3;
  return total === 2003 ? 42 : 4;
}
export function run(): number {
  return watch();
}
`;

test("a dead value in a guarded read's slot is collected at the next full collection", () => {
  verifyHostedFixture(
    collectable,
    "safe-for-space-collectable",
    [
      ["weak", weak],
      ["memory", memory],
    ],
    [],
    [],
    [
      { module: weak, namespace: "weak-storage" },
      { module: memory, namespace: "native-memory" },
    ],
    {
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes: 4194304,
      allocationCapacity: 65536,
      rootCapacity: 8192,
      stackBytes: 2097152,
      hostBindings: [
        {
          module: memory,
          name: "collectGarbage",
          operation: "collect-garbage",
        },
      ],
      weakBindings: [
        { module: weak, name: "createWeakSlot", operation: "new" },
        { module: weak, name: "weakSlotKey", operation: "key" },
      ],
    },
  );
});
