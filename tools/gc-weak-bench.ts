// A weak-heavy collector benchmark (docs/parallel-gc.md#weak-slots): a
// program whose every collection meets weak slots, as one using WeakMap
// side tables and WeakRefs does. It builds the program on the generational
// runtime through the trusted weak-slot operations (the storage WeakMap,
// WeakRef and FinalizationRegistry use), confirms it under LLDB (exit 42),
// then measures it directly:
//   node tools/gc-weak-bench.ts [rounds=5] [scale=1]
// Reports each round's wall time, cycles and peak RSS, then the minimum.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { measureProcess } from "./host-tools.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const weak = "packages/native-runtime/src/intrinsics/weak.ts";
/** Records with ephemeron side-table entries (key: the record, value: its
 * metadata, reachable only through the entry), weak references to every
 * eighth record, and a sliding window of live records linked into lists.
 * Cleared entries are swept from the table as a WeakMap's backing store
 * is. The checksum reads live records only. */
export function weakBenchSource(scale: number): string {
  return `import {createWeakSlot,weakSlotKey,weakSlotValue} from "weak";
interface Meta { readonly id: number; readonly label: string; readonly sizes: number[]; }
interface Entry { readonly id: number; readonly next: Entry | undefined; }
function meta(id: number): Meta {
  return { id, label: "m" + String(id), sizes: [id & 7, id & 15, id & 31] };
}
export function run(): number {
  let table: unknown[] = [];
  let references: unknown[] = [];
  let live: Entry[] = [];
  let liveEntries: unknown[] = [];
  let previous: Entry | undefined = undefined;
  const rounds = ${String(400 * scale)};
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < 4096; i++) {
      const id = round * 4096 + i;
      const entry: Entry = { id, next: i % 4 === 0 ? previous : undefined };
      const cell = createWeakSlot(entry, meta(id), true);
      table.push(cell);
      if (i % 8 === 0) references.push(createWeakSlot(entry, undefined, false));
      if (i % 16 === 0) {
        live.push(entry);
        liveEntries.push(cell);
        previous = entry;
      }
    }
    if (live.length > 65536) {
      live = live.slice(32768);
      liveEntries = liveEntries.slice(32768);
    }
    // Sweep cleared entries, as a WeakMap's backing store does.
    if (table.length > 262144) {
      const kept: unknown[] = [];
      for (let i = 0; i < table.length; i++)
        if (weakSlotKey(table[i]) !== undefined) kept.push(table[i]);
      table = kept;
      const references2: unknown[] = [];
      for (let i = 0; i < references.length; i++)
        if (weakSlotKey(references[i]) !== undefined) references2.push(references[i]);
      references = references2;
    }
  }
  let total = 0;
  for (let i = 0; i < live.length; i++) {
    const entry = live[i];
    if (entry === undefined || weakSlotKey(liveEntries[i]) !== entry) return 1;
    if (weakSlotValue(liveEntries[i]) === undefined) return 2;
    total = (total + entry.id) | 0;
  }
  return live.length > 0 && total !== 0 && previous !== undefined ? 42 : 3;
}
`;
}
export function buildWeakBench(scale: number): string {
  const saved = process.env.TINT_BUILD_ONLY;
  process.env.TINT_BUILD_ONLY = "1";
  try {
    return verifyHostedFixture(
      weakBenchSource(scale),
      "gc-weak-bench",
      [["weak", weak]],
      [],
      [],
      [{ module: weak, namespace: "weak-storage" }],
      {
        runtimeEntry: "initializeGenerationalRuntime",
        managedBytes: 268435456,
        allocationCapacity: 8388608,
        rootCapacity: 65536,
        stackBytes: 8388608,
        weakBindings: [
          { module: weak, name: "createWeakSlot", operation: "new" },
          { module: weak, name: "weakSlotKey", operation: "key" },
          { module: weak, name: "weakSlotValue", operation: "value" },
        ],
      },
    );
  } finally {
    if (saved === undefined) delete process.env.TINT_BUILD_ONLY;
    else process.env.TINT_BUILD_ONLY = saved;
  }
}

const rounds = Number(process.argv[2] ?? "5"),
  scale = Number(process.argv[3] ?? "1");
const image = buildWeakBench(scale);
try {
  const confirmed = spawnSync(
    "lldb",
    ["--no-lldbinit", "--batch", "-o", "process launch", image],
    { encoding: "utf8" },
  );
  if (!/exited with status = 42 /.test(confirmed.stdout))
    throw Error("weak benchmark failed:\n" + confirmed.stdout.slice(-2000));
  let best = { wall: Infinity, cycles: Infinity, rss: Infinity };
  for (let round = 0; round < rounds; round++) {
    const run = measureProcess(image, [], {
      env: { ...process.env, TZ: "UTC" },
    });
    if (run.status !== 42) throw Error("weak benchmark exited " + run.status);
    const cycles = run.cycles ?? Number.NaN;
    console.log(
      JSON.stringify({
        round,
        wall: run.wallSeconds,
        cycles,
        rss: run.maxResidentBytes,
      }),
    );
    best = {
      wall: Math.min(best.wall, run.wallSeconds),
      cycles: Math.min(best.cycles, cycles),
      rss: Math.min(best.rss, run.maxResidentBytes),
    };
  }
  console.log(JSON.stringify({ best }));
} finally {
  if (process.env.TINT_KEEP_NATIVE !== "1")
    rmSync(dirname(image), { recursive: true, force: true });
}
