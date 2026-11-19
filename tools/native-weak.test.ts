import { nativeFixtureBuildOnlyMode } from "./gate/native-fixture.ts";
import { runDarwinFixture } from "./native-admission.ts";
// Weak cells under every collector (docs/memory-and-lifetimes.md, "Weak
// cells"): weak references and ephemerons whose targets die young, survive
// minor collections (promoted), die old or stay reachable, and ephemeron
// values stored into promoted cells (the generational barrier), executed
// natively under LLDB with each runtime entry.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import test from "node:test";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const weak = "packages/native-runtime/src/intrinsics/weak.ts",
  memory = "packages/native-runtime/src/intrinsics/memory.ts";
/** `churn` fills the nursery several times (minor collections under the
 * generational runtime, whole collections elsewhere); `collectGarbage` is a
 * forced full (major) collection. Targets carry an id so a moved target is
 * recognisably the same object. */
const source = `import {createWeakSlot,weakSlotKey,weakSlotValue,setWeakSlotValue,clearWeakSlot} from "weak";
import {collectGarbage} from "memory";
interface Target { readonly id: number; readonly payload: number[]; }
let sink: number[][] = [];
function churn(rounds: number): void {
  for (let round = 0; round < rounds; round++) {
    const values: number[] = [];
    for (let i = 0; i < 512; i++) values.push(round * i);
    sink.push(values);
    if (sink.length > 8) sink = [];
  }
}
function target(id: number): Target {
  const payload: number[] = [];
  for (let i = 0; i < 4; i++) payload.push(id * 10 + i);
  return { id, payload };
}
function intact(t: Target | undefined, id: number): boolean {
  return t !== undefined && t.id === id && t.payload.length === 4 && t.payload[3] === id * 10 + 3;
}
/** A fresh heap string, reachable only where it is stored. */
function text(id: number): string {
  return "value-" + String(id);
}
export function run(): number {
  // Young targets that die young: cleared by the next (minor) collection.
  const young: unknown[] = [];
  const youngPairs: unknown[] = [];
  for (let i = 0; i < 32; i++) {
    young.push(createWeakSlot(target(i), undefined, false));
    youngPairs.push(createWeakSlot(target(100 + i), text(100 + i), true));
  }
  churn(1024);
  for (let i = 0; i < 32; i++) {
    if (weakSlotKey(young[i]) !== undefined) return 1;
    if (weakSlotKey(youngPairs[i]) !== undefined || weakSlotValue(youngPairs[i]) !== undefined) return 2;
  }
  // Reachable targets survive minors (promoted, moved) and majors; an
  // ephemeron's value, reachable only through it, survives with its key.
  const kept: Target[] = [];
  const keptCells: unknown[] = [];
  const keptPairs: unknown[] = [];
  for (let i = 0; i < 32; i++) {
    const t = target(200 + i);
    kept.push(t);
    keptCells.push(createWeakSlot(t, undefined, false));
    keptPairs.push(createWeakSlot(t, text(300 + i), true));
  }
  churn(1024);
  for (let i = 0; i < 32; i++) {
    if (weakSlotKey(keptCells[i]) !== kept[i] || !intact(kept[i], 200 + i)) return 3;
    if (weakSlotKey(keptPairs[i]) !== kept[i] || weakSlotValue(keptPairs[i]) !== text(300 + i)) return 4;
  }
  collectGarbage();
  for (let i = 0; i < 32; i++) {
    if (weakSlotKey(keptCells[i]) !== kept[i] || !intact(kept[i], 200 + i)) return 5;
    if (weakSlotValue(keptPairs[i]) !== text(300 + i)) return 6;
  }
  // Promoted targets that then die are cleared by a major collection; an
  // ephemeron's value goes with its key.
  const survivors: Target[] = [];
  for (let i = 1; i < 32; i += 2) {
    const t = kept[i];
    if (t === undefined) return 7;
    survivors.push(t);
  }
  for (let i = 0; i < 32; i++) kept[i] = target(-1);
  churn(256);
  collectGarbage();
  for (let i = 0; i < 32; i++) {
    const alive = i % 2 === 1,
      key = weakSlotKey(keptCells[i]);
    if (alive !== (key !== undefined)) return 8;
    if (alive && (key !== survivors[(i - 1) / 2] || !intact(survivors[(i - 1) / 2], 200 + i))) return 9;
    if (alive !== (weakSlotValue(keptPairs[i]) === text(300 + i))) return 10;
    if (!alive && weakSlotValue(keptPairs[i]) !== undefined) return 11;
  }
  // A young value stored into a promoted ephemeron (the generational write
  // barrier remembers the cell) survives minors while its key lives, and
  // dies with it.
  const keys: Target[] = [];
  const late: unknown[] = [];
  for (let i = 0; i < 16; i++) {
    const key = target(400 + i);
    keys.push(key);
    late.push(createWeakSlot(key, undefined, true));
  }
  churn(1024);
  for (let i = 0; i < 16; i++) setWeakSlotValue(late[i], text(500 + i));
  churn(1024);
  for (let i = 0; i < 16; i++)
    if (weakSlotValue(late[i]) !== text(500 + i)) return 12;
  collectGarbage();
  for (let i = 0; i < 16; i++)
    if (weakSlotValue(late[i]) !== text(500 + i)) return 13;
  for (let i = 0; i < 16; i++) keys[i] = target(-1);
  collectGarbage();
  for (let i = 0; i < 16; i++)
    if (weakSlotKey(late[i]) !== undefined || weakSlotValue(late[i]) !== undefined) return 14;
  // Ephemeron chains: a value that is another ephemeron's key keeps that
  // one alive (the fixpoint); a cleared cell stays cleared and releases it.
  const root = target(600);
  const first = createWeakSlot(root, text(601), true);
  const second = createWeakSlot(weakSlotValue(first), text(602), true);
  churn(1024);
  collectGarbage();
  if (weakSlotValue(first) !== text(601) || weakSlotValue(second) !== text(602)) return 15;
  if (weakSlotKey(second) !== weakSlotValue(first)) return 16;
  clearWeakSlot(first);
  churn(1024);
  collectGarbage();
  if (weakSlotKey(first) !== undefined || weakSlotKey(second) !== undefined) return 17;
  if (!intact(root, 600)) return 18;
  for (let i = 0; i < survivors.length; i++)
    if (!intact(survivors[i], 201 + 2 * i)) return 19;
  return 42;
}
`;
const fixtureModules: [string, string][] = [
    ["weak", weak],
    ["memory", memory],
  ],
  fixtureNamespaces = [
    { module: weak, namespace: "weak-storage" },
    { module: memory, namespace: "native-memory" },
  ];
function fixtureOptions(
  runtimeEntry: "initializeGenerationalRuntime" | "initializeCopyingRuntime",
  managedBytes: number,
) {
  return {
    managedBytes,
    allocationCapacity: managedBytes / 16,
    rootCapacity: 16384,
    stackBytes: 2097152,
    hostBindings: [
      {
        module: memory,
        name: "collectGarbage",
        operation: "collect-garbage" as const,
      },
    ],
    runtimeEntry,
    weakBindings: [
      { module: weak, name: "createWeakSlot", operation: "new" as const },
      { module: weak, name: "weakSlotKey", operation: "key" as const },
      { module: weak, name: "weakSlotValue", operation: "value" as const },
      {
        module: weak,
        name: "setWeakSlotValue",
        operation: "set-value" as const,
      },
      { module: weak, name: "clearWeakSlot", operation: "clear" as const },
    ],
  };
}
function verify(
  name: string,
  runtimeEntry: "initializeGenerationalRuntime" | "initializeCopyingRuntime",
  managedBytes: number = 8388608,
  churnScale: number = 1,
): void {
  verifyHostedFixture(
    churnScale === 1
      ? source
      : source.replace(
          "for (let round = 0; round < rounds; round++) {",
          "for (let round = 0; round < rounds * " +
            String(churnScale) +
            "; round++) {",
        ),
    name,
    fixtureModules,
    [],
    [],
    fixtureNamespaces,
    fixtureOptions(runtimeEntry, managedBytes),
  );
}

/** Weak slots on the collector pool (docs/parallel-gc.md#weak-slots). A
 * 128 MiB heap has a 16 MiB nursery, so every minor evacuates in parallel,
 * and majors mark in parallel. Tens of thousands of cells and ephemerons
 * are spread over many small arrays, so different workers copy and mark
 * them; ephemeron chains, whose links are reachable only through the
 * previous link's value, and ephemeron cycles cross workers; padding
 * between them has odd word counts. */
const parallelSource = `import {createWeakSlot,weakSlotKey,weakSlotValue,setWeakSlotValue,clearWeakSlot} from "weak";
import {collectGarbage} from "memory";
interface Item { readonly id: number; readonly tag: string; }
interface Pad1 { readonly a: number; }
interface Pad3 { readonly a: number; readonly b: number; readonly c: string; }
let sink: (Pad1 | Pad3 | string)[] = [];
/** About 2 MiB of short-lived objects of odd word counts per unit. */
function churn(units: number): void {
  for (let unit = 0; unit < units * 6; unit++) {
    const batch: (Pad1 | Pad3 | string)[] = [];
    for (let i = 0; i < 8192; i++)
      batch.push(i % 3 === 0 ? { a: i } : i % 3 === 1 ? { a: i, b: unit, c: "p" } : "s" + String(i));
    sink = batch;
  }
}
function item(id: number): Item {
  return { id, tag: "item-" + String(id) };
}
function intact(t: Item | undefined, id: number): boolean {
  return t !== undefined && t.id === id && t.tag === "item-" + String(id);
}
/** A fresh heap string (odd lengths among them), reachable only where it
 * is stored. */
function text(id: number): string {
  return "value-" + String(id);
}
/** Cells in groups of eight, so the pool's workers share them out. */
function grouped(count: number): unknown[][] {
  const groups: unknown[][] = [];
  for (let i = 0; i < count; i += 8) groups.push([]);
  return groups;
}
function at(groups: unknown[][], index: number): unknown {
  const group = groups[index >>> 3];
  return group === undefined ? undefined : group[index & 7];
}
function put(groups: unknown[][], index: number, cell: unknown): void {
  const group = groups[index >>> 3];
  if (group !== undefined) group.push(cell);
}
/** \`chains\` chains of \`length\` ephemeron links from fresh heads: link j's
 * key is node j and its value node j + 1, reachable only through it; tag j
 * maps node j + 1 to its id's text. */
function chain(heads: Item[], links: unknown[][], tags: unknown[][], chains: number, length: number, base: number): void {
  for (let c = 0; c < chains; c++) {
    let key = item(base + c * 100);
    heads.push(key);
    for (let j = 0; j < length; j++) {
      const next = item(base + c * 100 + j + 1);
      put(links, c * length + j, createWeakSlot(key, next, true));
      put(tags, c * length + j, createWeakSlot(next, text(base + c * 100 + j + 1), true));
      key = next;
    }
  }
}
/** Chains whose head is the original one are complete (each link's value
 * is the next link's key, every tag intact); \`mode\` 1 expects every chain
 * live, otherwise a replaced head (id -1) must have cleared its chain. */
function chainsIntact(heads: Item[], links: unknown[][], tags: unknown[][], chains: number, length: number, base: number, mode: number): boolean {
  for (let c = 0; c < chains; c++) {
    const head = heads[c];
    if (head === undefined) return false;
    const alive = head.id !== -1;
    if (mode === 1 && !alive) return false;
    for (let j = 0; j < length; j++) {
      const link = at(links, c * length + j), tag = at(tags, c * length + j);
      if (alive) {
        if (j === 0 ? weakSlotKey(link) !== head || !intact(head, base + c * 100) : weakSlotKey(link) !== weakSlotValue(at(links, c * length + j - 1))) return false;
        if (weakSlotValue(link) === undefined || weakSlotKey(tag) !== weakSlotValue(link)) return false;
        if (weakSlotValue(tag) !== text(base + c * 100 + j + 1)) return false;
      } else if (weakSlotKey(link) !== undefined || weakSlotValue(link) !== undefined || weakSlotKey(tag) !== undefined || weakSlotValue(tag) !== undefined) return false;
    }
  }
  return true;
}
export function run(): number {
  // 1. Young cells and ephemerons: half of their keys stay reachable.
  const count = 24000;
  const cells = grouped(count), pairs = grouped(count);
  const kept: Item[] = [];
  for (let i = 0; i < count; i++) {
    const t = item(i);
    if (i % 2 === 0) kept.push(t);
    put(cells, i, createWeakSlot(t, undefined, false));
    put(pairs, i, createWeakSlot(t, text(100000 + i), true));
    if (i % 3000 === 0) churn(1);
  }
  churn(24);
  for (let i = 0; i < count; i++) {
    const alive = i % 2 === 0;
    const key = weakSlotKey(at(cells, i));
    if (alive ? key !== kept[i / 2] || !intact(kept[i / 2], i) : key !== undefined) return 1;
    if (weakSlotValue(at(cells, i)) !== undefined) return 2;
    const value = weakSlotValue(at(pairs, i));
    if (alive ? value !== text(100000 + i) : value !== undefined) return 3;
    if (!alive && weakSlotKey(at(pairs, i)) !== undefined) return 4;
  }
  // 2. Ephemeron chains: link j's value is link j + 1's key, reachable
  // only through it. Chains with a reachable head survive minors and
  // majors; the others clear link by link to the fixpoint.
  // Each link also tags its value with a string (an ephemeron keyed by
  // it), whose survival shows the value's.
  const chains = 96, length = 48;
  const heads: Item[] = [];
  const links = grouped(chains * length), tags = grouped(chains * length);
  chain(heads, links, tags, chains, length, 200000);
  churn(24);
  if (!chainsIntact(heads, links, tags, chains, length, 200000, 1)) return 5;
  for (let c = 1; c < chains; c += 2) heads[c] = item(-1);
  collectGarbage();
  churn(8);
  collectGarbage();
  if (!chainsIntact(heads, links, tags, chains, length, 200000, 2)) return 6;
  // Young chains through minors: unreachable heads die with the nursery.
  const youngHeads: Item[] = [];
  const youngLinks = grouped(chains * 8), youngTags = grouped(chains * 8);
  chain(youngHeads, youngLinks, youngTags, chains, 8, 400000);
  for (let c = 0; c < chains; c += 3) youngHeads[c] = item(-1);
  churn(24);
  if (!chainsIntact(youngHeads, youngLinks, youngTags, chains, 8, 400000, 3)) return 9;
  // 3. Ephemeron cycles: a reachable member keeps its cycle, unreachable
  // cycles clear.
  const cycles = grouped(4000);
  const anchors: Item[] = [];
  for (let i = 0; i < 2000; i++) {
    const x = item(500000 + 2 * i), y = item(500001 + 2 * i);
    if (i % 4 === 0) anchors.push(x);
    put(cycles, 2 * i, createWeakSlot(x, y, true));
    put(cycles, 2 * i + 1, createWeakSlot(y, x, true));
  }
  churn(24);
  collectGarbage();
  for (let i = 0; i < 2000; i++) {
    const alive = i % 4 === 0;
    const forward = at(cycles, 2 * i), backward = at(cycles, 2 * i + 1);
    const first = weakSlotValue(forward), second = weakSlotValue(backward);
    if (alive) {
      if (second !== anchors[i / 4] || weakSlotKey(forward) !== second || !intact(anchors[i / 4], 500000 + 2 * i)) return 10;
      if (first === undefined || weakSlotKey(backward) !== first) return 10;
    } else if (first !== undefined || second !== undefined || weakSlotKey(forward) !== undefined) return 10;
  }
  // 4. Young values stored into promoted ephemerons (remembered by the
  // barrier, scanned strongly by parallel minors), then their keys die.
  const lateKeys: Item[] = [];
  const late = grouped(4096);
  for (let i = 0; i < 4096; i++) {
    const key = item(600000 + i);
    lateKeys.push(key);
    put(late, i, createWeakSlot(key, undefined, true));
  }
  churn(24);
  for (let i = 0; i < 4096; i++) setWeakSlotValue(at(late, i), text(700000 + i));
  churn(24);
  for (let i = 0; i < 4096; i++) if (weakSlotValue(at(late, i)) !== text(700000 + i)) return 11;
  for (let i = 0; i < 4096; i += 2) lateKeys[i] = item(-1);
  collectGarbage();
  for (let i = 0; i < 4096; i++) {
    const value = weakSlotValue(at(late, i));
    if (i % 2 === 1 ? value !== text(700000 + i) || !intact(lateKeys[i], 600000 + i) : value !== undefined || weakSlotKey(at(late, i)) !== undefined) return 12;
  }
  // 5. An explicit clear stays cleared and releases its chain.
  clearWeakSlot(at(links, 0));
  collectGarbage();
  if (weakSlotKey(at(links, 1)) !== undefined || weakSlotValue(at(links, length - 1)) !== undefined) return 13;
  if (weakSlotValue(at(tags, length - 1)) !== undefined) return 13;
  if (weakSlotValue(at(tags, 2 * length + length - 1)) !== text(200000 + 200 + length)) return 14;
  // The heads stay reachable until here (stack maps are precise).
  if (!intact(heads[2], 200200)) return 15;
  return 42;
}
`;
/** LLDB breakpoint hits (auto-continued) per function of a debug image that
 * must exit with status 42. */
function functionHits(
  image: string,
  functions: readonly string[],
): Map<string, number> {
  const args = ["--no-lldbinit", "--batch"];
  for (const name of functions)
    args.push(
      "-o",
      "breakpoint set -G true -r '" + name.replaceAll(".", "\\.") + " '",
    );
  args.push(
    "-o",
    "process launch",
    "-o",
    "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 42",
    "-o",
    "breakpoint list",
    image,
  );
  const result = runDarwinFixture(image, () =>
    spawnSync("lldb", args, {
      encoding: "utf8",
      timeout: 600000,
    }),
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /exited with status = 42 /, result.stdout);
  const hits = new Map<string, number>();
  for (const [index, name] of functions.entries()) {
    const match = new RegExp(
      "^" + String(index + 1) + ": regex = .*hit count = (\\d+)",
      "m",
    ).exec(result.stdout);
    assert.ok(match, "no breakpoint for " + name + ":\n" + result.stdout);
    hits.set(name, Number(match[1]));
  }
  return hits;
}
test("weak cells clear and survive exactly under the generational collector", () => {
  verify("weak-cells-generational", "initializeGenerationalRuntime");
});
test("weak cells take the parallel collector paths in a large generational heap", () => {
  // A 64 MiB heap has an 8 MiB nursery and majors above the 4 MiB parallel
  // threshold.
  verify(
    "weak-cells-generational-large",
    "initializeGenerationalRuntime",
    67108864,
    8,
  );
});
test("weak cells clear and survive exactly under the copying collector", () => {
  verify("weak-cells-copying", "initializeCopyingRuntime");
});
test("weak slots, chains and cycles across parallel workers", () => {
  verifyHostedFixture(
    parallelSource,
    "weak-cells-parallel",
    fixtureModules,
    [],
    [],
    fixtureNamespaces,
    fixtureOptions("initializeGenerationalRuntime", 134217728),
  );
  // A debug build of the same program, run with its weak paths counted:
  // parallel minors and majors met weak slots and ran ephemeron rounds.
  const saved = {
    build: process.env.TINT_BUILD_ONLY,
    debug: process.env.TINT_DEBUG_SYMBOLS,
  };
  process.env.TINT_BUILD_ONLY = nativeFixtureBuildOnlyMode();
  process.env.TINT_DEBUG_SYMBOLS = "1";
  let image: string;
  try {
    image = verifyHostedFixture(
      parallelSource,
      "weak-cells-parallel-debug",
      fixtureModules,
      [],
      [],
      fixtureNamespaces,
      fixtureOptions("initializeGenerationalRuntime", 134217728),
    );
  } finally {
    if (saved.build === undefined) delete process.env.TINT_BUILD_ONLY;
    else process.env.TINT_BUILD_ONLY = saved.build;
    if (saved.debug === undefined) delete process.env.TINT_DEBUG_SYMBOLS;
    else process.env.TINT_DEBUG_SYMBOLS = saved.debug;
  }
  try {
    const parallel = "packages/native-runtime/src/tracing/parallel.ts:";
    const hits = functionHits(image, [
      parallel + "finishCopiedWeak",
      parallel + "traceCopiedEphemerons",
      parallel + "finishCopiedList",
      parallel + "finishMarkedWeak",
      parallel + "traceMarkedEphemerons",
    ]);
    console.log(JSON.stringify(Object.fromEntries(hits)));
    for (const [name, count] of hits)
      assert.ok(count > 0, name + " never ran: " + JSON.stringify([...hits]));
  } finally {
    if (process.env.TINT_KEEP_NATIVE !== "1")
      rmSync(dirname(image), { recursive: true, force: true });
  }
});
