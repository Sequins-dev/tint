// Mark-compact majors: the generational heap's major collection slides live
// old and young objects down into a packed old prefix in place. None of it is
// observable: records, reference vectors, strings, owned typed arrays and
// views of views (whose data pointers follow their terminal owner), Map/Set
// storage, objects reachable only through old objects or only from the stack,
// interleaved garbage of every kind, and mutation between forced majors must
// all behave as in ECMAScript. Runs with a small heap and a large one, forcing majors by filling the old space with data that
// is promoted and then dropped.
// The same source runs in Node for the expected checksum and natively under
// LLDB.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const template = `interface Node {
  value: number;
  label: string;
  next: Node | undefined;
  items: Node[];
}
function mix(total: number, value: number): number {
  return (total * 31 + value + 7) % 1000003;
}
function node(value: number, next: Node | undefined): Node {
  return { value, label: "n" + String(value % 97), next, items: [] };
}
// Fills the old space with data that lives across several minors (so even
// an aging nursery promotes it) and then dies, forcing majors.
function collectGarbage(): void {
  const ring: Node[][] = [[], [], [], [], [], [], [], []];
  for (let round = 0; round < SCALE; round++) {
    const held: Node[] = [];
    for (let i = 0; i < HELD; i++) held.push(node(i, undefined));
    ring[round % ring.length] = held;
    let churn: Node | undefined = undefined;
    for (let i = 0; i < 2 * HELD; i++) churn = node(i, churn);
  }
}
function digest(head: Node | undefined): number {
  let total = 0;
  let current = head;
  while (current !== undefined) {
    const at: Node = current;
    total = mix(total, at.value + at.label.length);
    for (const item of at.items)
      if (item !== undefined) total = mix(total, item.value);
    current = at.next;
  }
  return total;
}
export function checksum(): number {
  let total = 0;
  let kept: Node | undefined = undefined;
  const owners: Float64Array[] = [];
  const views: Float64Array[] = [];
  const bytes: Uint8Array[] = [];
  const index = new Map<string, Node>();
  const seen = new Set<number>();
  for (let round = 0; round < 12; round++) {
    // Interleave survivors with garbage of every kind.
    for (let i = 0; i < 3000; i++) {
      const garbage = node(i, undefined);
      garbage.items.push(node(i + 1, undefined));
      if (i % 5 === 0) {
        kept = node(round * 10000 + i, kept);
        if (garbage.items.length > 0) kept.items.push(garbage);
      }
      if (i % 300 === 0) {
        const owner = new Float64Array(64);
        for (let k = 0; k < 64; k++) owner[k] = round * 100 + k;
        const view = owner.subarray(8, 56);
        // A view of a view: its elements move with the terminal owner.
        views.push(view.subarray(4, 20));
        if (i % 600 === 0) owners.push(owner);
        const raw = new Uint8Array(33);
        raw[i % 33] = round;
        bytes.push(raw);
      }
      if (i % 700 === 0) {
        index.set("k" + String(round) + "-" + String(i), node(i, kept));
        seen.add(round * 1000 + i);
      }
    }
    collectGarbage();
    // Mutate old objects so they refer to young ones, then collect again.
    let current = kept;
    for (let i = 0; current !== undefined && i < 50; i++) {
      const at: Node = current;
      at.items.push(node(-i, undefined));
      current = at.next;
    }
    if (round % 3 === 2) collectGarbage();
    total = mix(total, digest(kept));
  }
  for (const view of views) {
    if (view === undefined) continue;
    for (let k = 0; k < view.length; k++) total = mix(total, view[k] ?? -1);
    view[0] = (view[0] ?? 0) + 1;
  }
  collectGarbage();
  for (const owner of owners) {
    if (owner === undefined) continue;
    for (let k = 0; k < owner.length; k++) total = mix(total, owner[k] ?? -1);
  }
  for (const view of views) if (view !== undefined) total = mix(total, view[0] ?? -1);
  for (const raw of bytes) {
    if (raw === undefined) continue;
    for (let k = 0; k < raw.length; k++) total = mix(total, raw[k] ?? 0);
  }
  for (const [key, value] of index) total = mix(total, key.length + digest(value) % 1000);
  for (const value of seen) total = mix(total, value);
  return total;
}
`;

async function expectedChecksum(text: string): Promise<number> {
  const directory = mkdtempSync(join(tmpdir(), "tint-gc-compact-"));
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

for (const [name, managedBytes, allocationCapacity, scale, held] of [
  ["small heap", 16777216, 262144, 4, 1500],
  ["large heap", 268435456, 2097152, 24, 20000],
] as const)
  test(`mark-compact majors are unobservable (${name})`, async () => {
    const source = template
      .replaceAll("SCALE", String(scale))
      .replaceAll("HELD", String(held));
    const expected = await expectedChecksum(source);
    assert.equal(typeof expected, "number");
    verifyHostedFixture(
      source +
        `export function run(): number { return checksum() === ${expected} ? 42 : 1; }\n`,
      "gc-compact",
      [],
      [],
      [],
      [],
      {
        runtimeEntry: "initializeGenerationalRuntime",
        managedBytes,
        allocationCapacity,
        rootCapacity: 65536,
      },
    );
  });
