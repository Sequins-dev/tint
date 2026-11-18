// Callback microbenchmark (docs/native-ffi.md, "Callbacks"): libc's qsort
// with a TypeScript comparator against Node's Array.prototype.sort and C's
// qsort with a C comparator, plus the cost of a may-callback call that
// calls back once against a leaf call. Native loops time themselves with
// the monotonic clock; the image runs under LLDB (stopped at entry, exit
// status 42 asserted). Needs clang. Run under
//   lockf /Users/stephenbelanger/.t3/tint-timing.lock node tools/ffi-callback-microbench.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  verifyHostedFixture,
  type FixtureForeignDeclaration,
} from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";

const clock = "packages/native-runtime/src/intrinsics/clock.ts";
const elements = Number(process.env.CALLBACK_BENCH_N ?? "100000"),
  rounds = Number(process.env.CALLBACK_BENCH_ROUNDS ?? "20"),
  calls = Number(process.env.CALLBACK_BENCH_CALLS ?? "20000000");

/** Park–Miller keys: every product stays below 2^53, so C, Node and Tint
 * sort the same input. */
const keys = `let seed = 1;
function nextKey(): number {
  seed = (seed * 48271) % 2147483647;
  return seed % 1000000;
}`;
const librarySource = `#include <stdint.h>
int32_t bench_leaf(int32_t x) { return x + 1; }
int32_t bench_leaf0(void) { return 1; }
int32_t bench_once(int32_t (*f)(int32_t), int32_t x) { return f(x); }
`;
const cSource = `#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
typedef struct { int32_t key, tag; } Item;
static uint64_t seed = 1;
static int32_t next_key(void) {
  seed = (seed * 48271) % 2147483647;
  return (int32_t)(seed % 1000000);
}
static long compares;
static int compare(const void *a, const void *b) {
  compares++;
  return ((const Item *)a)->key - ((const Item *)b)->key;
}
static double now(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec * 1e3 + t.tv_nsec / 1e6;
}
int main(void) {
  Item *items = malloc(sizeof(Item) * ${elements});
  double elapsed = 0;
  for (int round = 0; round < ${rounds}; round++) {
    for (int i = 0; i < ${elements}; i++) items[i] = (Item){next_key(), i};
    double start = now();
    qsort(items, ${elements}, sizeof(Item), compare);
    elapsed += now() - start;
  }
  printf("C qsort, C comparator: %.3f ms/sort, %.2f ns/compare\\n",
         elapsed / ${rounds}, elapsed * 1e6 / compares);
  return 0;
}
`;

function declarations(library: string): FixtureForeignDeclaration[] {
  const image = (name: string) => ({
    darwin: {
      name,
      optional: false,
      currentVersion: 0x10000,
      compatibilityVersion: 0x10000,
    },
    linux: {
      name,
      optional: false,
      currentVersion: 0,
      compatibilityVersion: 0,
    },
  });
  return [
    {
      id: "bench/callback-bench.d.ts",
      text: `declare module "tint:c/callback-bench" {
  import type { i32, Callback } from "tint:ffi";
  export function bench_leaf(x: i32): i32;
  export function bench_leaf0(): i32;
  export function bench_once(f: Callback<(x: i32) => i32>, x: i32): i32;
}
`,
      manifest: [{ module: "tint:c/callback-bench", ...image(library) }],
    },
    {
      id: "bench/sorting.d.ts",
      text: `declare module "tint:c/libsystem" {
  import type { i32, usize, Ptr, Address, Layout, Callback } from "tint:ffi";
  export interface Item { key: i32; tag: i32 }
  export const Item: Layout<Item>;
  export function getpid(): i32;
  export function qsort(base: Ptr<Item>, count: usize, size: usize, compare: Callback<(a: Ptr<Item>, b: Ptr<Item>) => i32>): void;
  export function qsort$address(base: Ptr<Item>, count: usize, size: usize, compare: Callback<(a: Address<Item>, b: Address<Item>) => i32>): void;
}
`,
    },
  ];
}
const tintSource = `import { monotonicMilliseconds } from "clock";
import { allocate, address, type View } from "tint:ffi";
import { arrayAt } from "tint:ffi/unsafe";
import { Item, getpid, qsort, qsort$address } from "sorting";
import { bench_leaf, bench_leaf0, bench_once } from "bench";
${keys}
function report(name: string, elapsed: number, count: number, unit: string): void {
  console.log(name + " " + String(elapsed * 1000000 / count) + " ns/" + unit);
}
export function run(): number {
  {
    let sum = 0;
    const start = monotonicMilliseconds();
    for (let i = 0; i < ${calls}; i++) sum += getpid();
    report("tint leaf call getpid()", monotonicMilliseconds() - start, ${calls}, "call");
    if (sum === 0) return 1;
  }
  {
    let sum = 0;
    const start = monotonicMilliseconds();
    for (let i = 0; i < ${calls}; i++) sum += bench_leaf0();
    report("tint leaf call bench_leaf0()", monotonicMilliseconds() - start, ${calls}, "call");
    if (sum === 0) return 1;
  }
  {
    let sum = 0;
    const start = monotonicMilliseconds();
    for (let i = 0; i < ${calls}; i++) sum += bench_leaf(7);
    report("tint leaf call bench_leaf(7)", monotonicMilliseconds() - start, ${calls}, "call");
    if (sum === 0) return 1;
  }
  {
    let sum = 0;
    const start = monotonicMilliseconds();
    for (let i = 0; i < ${calls}; i++) sum += bench_leaf(i);
    report("tint leaf call bench_leaf(i)", monotonicMilliseconds() - start, ${calls}, "call");
    if (sum === 0) return 1;
  }
  {
    let sum = 0;
    const increment = (x: number): number => x + 1;
    const start = monotonicMilliseconds();
    for (let i = 0; i < ${calls}; i++) sum += bench_once(increment, i);
    report("tint may-callback call + one callback", monotonicMilliseconds() - start, ${calls}, "call");
    if (sum === 0) return 2;
  }
  const block = allocate(Item.size * ${elements});
  const base = address(block);
  const items: View<Item>[] = arrayAt(Item, base, ${elements});
  function fill(): void {
    for (let i = 0; i < ${elements}; i++) {
      const item = items[i];
      if (item !== undefined) {
        item.key = nextKey();
        item.tag = i;
      }
    }
  }
  function sorted(): boolean {
    for (let i = 1; i < ${elements}; i++)
      if ((items[i - 1]?.key ?? 0) > (items[i]?.key ?? 0)) return false;
    return true;
  }
  {
    seed = 1;
    let compares = 0, elapsed = 0;
    for (let round = 0; round < ${rounds}; round++) {
      fill();
      const start = monotonicMilliseconds();
      qsort(block, ${elements}, Item.size, (a: View<Item>, b: View<Item>): number => {
        compares++;
        return a.key - b.key;
      });
      elapsed += monotonicMilliseconds() - start;
      if (!sorted()) return 3;
    }
    console.log("tint qsort, View<Item> comparator: " + String(elapsed / ${rounds}) + " ms/sort");
    report("tint qsort, View<Item> comparator:", elapsed, compares, "compare");
  }
  {
    seed = 1;
    let compares = 0, elapsed = 0;
    for (let round = 0; round < ${rounds}; round++) {
      fill();
      const start = monotonicMilliseconds();
      qsort$address(block, ${elements}, Item.size, (a: number, b: number): number => {
        compares++;
        return (items[(a - base) / 8]?.key ?? 0) - (items[(b - base) / 8]?.key ?? 0);
      });
      elapsed += monotonicMilliseconds() - start;
      if (!sorted()) return 4;
    }
    console.log("tint qsort, address comparator: " + String(elapsed / ${rounds}) + " ms/sort");
    report("tint qsort, address comparator:", elapsed, compares, "compare");
  }
  return 42;
}
`;
const nodeSource = `${keys.replace(": number", "")}
const numbers = new Array(${elements}), records = new Array(${elements});
for (const [name, array, fill, compare] of [
  ["node Array.prototype.sort, numbers:", numbers, (i) => (numbers[i] = nextKey()), (a, b) => a - b],
  ["node Array.prototype.sort, {key, tag} records:", records, (i) => (records[i] = { key: nextKey(), tag: i }), (a, b) => a.key - b.key],
]) {
  seed = 1;
  let elapsed = 0, compares = 0;
  const counted = (a, b) => (compares++, compare(a, b));
  for (let round = 0; round < ${rounds}; round++) {
    for (let i = 0; i < ${elements}; i++) fill(i);
    const start = process.hrtime.bigint();
    array.sort(counted);
    elapsed += Number(process.hrtime.bigint() - start) / 1e6;
  }
  console.log(name + " " + elapsed / ${rounds} + " ms/sort, " + (elapsed * 1e6) / compares + " ns/compare");
}
`.replace("function nextKey(): number", "function nextKey()");

function runNative(path: string): string {
  const result = spawnSync(
    "lldb",
    [
      "--no-lldbinit",
      "--batch",
      "-o",
      "process launch --stop-at-entry",
      "-o",
      "script assert lldb.process.GetState() == lldb.eStateStopped",
      "-o",
      "continue",
      "-o",
      "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 42",
      path,
    ],
    { encoding: "utf8", timeout: 1200000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /exited with status = 42 /, result.stdout);
  return result.stdout
    .split("\n")
    .filter((line) => line.startsWith("tint "))
    .join("\n");
}

const directory = mkdtempSync(join(tmpdir(), "tint-callback-bench-"));
try {
  const library = join(
    directory,
    nativeFixtureTarget().os === "darwin"
      ? "libtint-callback-bench.dylib"
      : "libtint-callback-bench.so",
  );
  writeFileSync(join(directory, "bench.c"), librarySource);
  writeFileSync(join(directory, "qsort.c"), cSource);
  for (const args of [
    ["-O2", "-shared", "-fPIC", "-o", library, join(directory, "bench.c")],
    ["-O2", "-o", join(directory, "qsort"), join(directory, "qsort.c")],
  ]) {
    const built = spawnSync("clang", args, { encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);
  }
  const [bench, sorting] = declarations(library);
  if (bench === undefined || sorting === undefined) throw Error("declarations");
  process.env.TINT_BUILD_ONLY = "1";
  const image = verifyHostedFixture(
    tintSource,
    "ffi-callback-microbench",
    [
      ["clock", clock],
      ["tint:ffi", "packages/native-runtime/src/ffi/index.ts"],
      ["tint:ffi/unsafe", "packages/native-runtime/src/ffi/unsafe.ts"],
      ["sorting", sorting.id],
      ["bench", bench.id],
    ],
    [],
    [],
    [
      {
        module: clock,
        namespace: "bench-clock",
        retainedExports: ["monotonicMilliseconds"],
      },
    ],
    {
      managedBytes: 67108864,
      allocationCapacity: 1048576,
      hostBindings: [
        {
          module: clock,
          name: "monotonicMilliseconds",
          operation: "monotonic-time",
        },
      ],
      foreignDeclarations: [bench, sorting],
    },
  );
  console.log("image " + image);
  console.log(runNative(image));
  const c = spawnSync(join(directory, "qsort"), [], { encoding: "utf8" });
  assert.equal(c.status, 0, c.stderr);
  console.log(c.stdout.trim());
  writeFileSync(join(directory, "sort.mjs"), nodeSource);
  const node = spawnSync(process.execPath, [join(directory, "sort.mjs")], {
    encoding: "utf8",
  });
  assert.equal(node.status, 0, node.stderr);
  console.log(node.stdout.trim());
} finally {
  // CALLBACK_BENCH_KEEP=1 keeps the C library and programs for profiling
  // (the image's own directory is kept by TINT_KEEP_NATIVE=1).
  if (process.env.CALLBACK_BENCH_KEEP === "1") console.log("kept " + directory);
  else rmSync(directory, { recursive: true, force: true });
}
