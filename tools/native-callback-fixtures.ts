import {
  nativeFixtureBuildOnlyMode,
  withNativeFixtureMemory,
} from "./gate/native-fixture.ts";
import { runDarwinFixture } from "./native-admission.ts";
// Native callbacks (docs/native-ffi.md, "Callbacks"): C calling back into
// TypeScript through AOT thunks during may-callback calls.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  verifyHostedFixture,
  type FixtureForeignDeclaration,
} from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";
import { nativeArtifact, runNativeBatch } from "./native-target-runner.ts";
import { lldbStartCommands } from "./lldb-launch.ts";
import { stableScratchDirectory } from "./fixture-scratch.ts";

export const callbackDeclarations: FixtureForeignDeclaration = {
  id: "fixture/callbacks.d.ts",
  text: `declare module "tint:c/libsystem" {
  import type { i32, u8, usize, Ptr, Layout, Callback } from "tint:ffi";
  export interface Item { key: i32; tag: i32 }
  export const Item: Layout<Item>;
  export function qsort(
    base: Ptr<Item>,
    count: usize,
    size: usize,
    compare: Callback<(a: Ptr<Item>, b: Ptr<Item>) => i32>,
  ): void;
}
`,
};
export function callbackFixtureSource(): string {
  return `import { allocate, release, address, type View } from "tint:ffi";
import { arrayAt } from "tint:ffi/unsafe";
import { Item, qsort } from "callbacks";
import { collectGarbage } from "gc";
let sink: number[][] = [];
function churn(): void {
  for (let round = 0; round < 16; round++) {
    const values: number[] = [];
    for (let i = 0; i < 128; i++) values.push(round * i);
    sink.push(values);
    if (sink.length > 16) sink = [];
  }
}
function throwsType(f: () => void): boolean {
  try { f(); } catch (error) { return error instanceof TypeError; }
  return false;
}
export function run(): number {
  const count = 64;
  const block = allocate(Item.size * count);
  const items: View<Item>[] = arrayAt(Item, address(block), count);
  for (let i = 0; i < count; i++) {
    const item = items[i];
    if (item === undefined) return 1;
    item.key = (i * 37) % count;
    item.tag = i;
  }
  let calls = 0;
  qsort(block, count, Item.size, (a: View<Item>, b: View<Item>): number => {
    calls++;
    return a.key - b.key;
  });
  if (calls === 0) return 2;
  for (let i = 0; i < count; i++) {
    const item = items[i];
    if (item === undefined || item.key !== i) return 3;
  }
  // Movable arrays are refused: a collection inside the comparator could
  // move them while C holds their address.
  if (!throwsType(() => { qsort(new Uint8Array(Item.size * 2), 2, Item.size, (a: View<Item>, b: View<Item>): number => 0); })) return 4;
  // Collections inside callbacks: objects the outer frames hold survive
  // and move, and C's pointers into external storage stay valid.
  const kept: number[][] = [];
  for (let i = 0; i < 64; i++) kept.push([i, i * 2, i * 3]);
  const label = "outer-" + String(count);
  for (let i = 0; i < count; i++) {
    const item = items[i];
    if (item === undefined) return 5;
    item.key = (i * 29) % count;
  }
  let churned = 0;
  qsort(block, count, Item.size, (a: View<Item>, b: View<Item>): number => {
    churn();
    churned++;
    return a.key - b.key;
  });
  if (churned === 0) return 6;
  for (let i = 0; i < count; i++) {
    const item = items[i];
    if (item === undefined || item.key !== i) return 7;
  }
  for (let i = 0; i < kept.length; i++) {
    const entry = kept[i];
    if (entry === undefined || entry[0] !== i || entry[2] !== i * 3) return 8;
  }
  if (label !== "outer-64") return 9;
  // Nested: C -> TS -> C -> TS, collections at the innermost level, two
  // transitions deep.
  const inner = allocate(Item.size * 8);
  const innerItems: View<Item>[] = arrayAt(Item, address(inner), 8);
  let innerCalls = 0;
  for (let i = 0; i < count; i++) {
    const item = items[i];
    if (item === undefined) return 10;
    item.key = count - 1 - i;
  }
  qsort(block, count, Item.size, (a: View<Item>, b: View<Item>): number => {
    for (let i = 0; i < 8; i++) {
      const item = innerItems[i];
      if (item !== undefined) item.key = (i * 5) % 8;
    }
    qsort(inner, 8, Item.size, (c: View<Item>, d: View<Item>): number => {
      churn();
      // A forced collection at the innermost callback, two transitions
      // below the outer frames.
      if (innerCalls % 7 === 0) collectGarbage();
      innerCalls++;
      return c.key - d.key;
    });
    return a.key - b.key;
  });
  if (innerCalls === 0) return 11;
  for (let i = 0; i < count; i++) {
    const item = items[i];
    if (item === undefined || item.key !== i) return 12;
  }
  for (let i = 0; i < 8; i++) {
    const item = innerItems[i];
    if (item === undefined || item.key !== i) return 13;
  }
  for (let i = 0; i < kept.length; i++) {
    const entry = kept[i];
    if (entry === undefined || entry[1] !== i * 2) return 14;
  }
  // Exceptions thrown inside callbacks never unwind through C: the call
  // completes (callbacks then return 0) and the first one is rethrown.
  let thrown = 0;
  try {
    qsort(block, count, Item.size, (a: View<Item>, b: View<Item>): number => {
      thrown++;
      if (thrown === 3) throw new RangeError("from the comparator");
      return a.key - b.key;
    });
    return 15;
  } catch (error) {
    if (!(error instanceof RangeError)) return 16;
  }
  if (thrown !== 3) return 17;
  // Nested: the inner call's exception reaches the outer callback, which
  // lets it propagate; the outer call then rethrows it.
  let caught = false;
  try {
    qsort(block, count, Item.size, (a: View<Item>, b: View<Item>): number => {
      qsort(inner, 8, Item.size, (c: View<Item>, d: View<Item>): number => {
        throw new TypeError("innermost");
      });
      return 0;
    });
  } catch (error) {
    caught = error instanceof TypeError;
  }
  if (!caught) return 18;
  // Results out of the C type's range are TypeErrors.
  if (!throwsType(() => { qsort(block, count, Item.size, (a: View<Item>, b: View<Item>): number => 2147483648); })) return 19;
  release(inner);
  release(block);
  return 42;
}
`;
}
export function verifyCallbackFixture(): string {
  return verifyHostedFixture(
    callbackFixtureSource(),
    "ffi-callbacks",
    [
      ["tint:ffi", "packages/native-runtime/src/ffi/index.ts"],
      ["tint:ffi/unsafe", "packages/native-runtime/src/ffi/unsafe.ts"],
      ["callbacks", callbackDeclarations.id],
      ["gc", "packages/native-runtime/src/intrinsics/memory.ts"],
    ],
    [],
    [],
    [],
    {
      managedBytes: 4194304,
      allocationCapacity: 65536,
      foreignDeclarations: [callbackDeclarations],
    },
  );
}

/** A may-callback call in a program with no callback (docs/native-ffi.md,
 * "Callbacks"): the call still publishes the thread's callback state under
 * the image's callback key, so the image creates the key although it has
 * no callback thunk. */
export const mayCallbackOnlyDeclarations: FixtureForeignDeclaration = {
  id: "fixture/may-callback-only.d.ts",
  text: `declare module "tint:c/libsystem" {
  import type { i32, MayCallback } from "tint:ffi";
  export function abs(value: i32): MayCallback<i32>;
}
`,
};
export function verifyMayCallbackOnlyFixture(): string {
  return verifyHostedFixture(
    `import { abs } from "may-callback-only";
export function run(): number {
  return abs(-42) === 42 && abs(7) === 7 ? 42 : 1;
}
`,
    "ffi-may-callback-only",
    [
      ["tint:ffi", "packages/native-runtime/src/ffi/index.ts"],
      ["may-callback-only", mayCallbackOnlyDeclarations.id],
    ],
    [],
    [],
    [],
    {
      managedBytes: 4194304,
      allocationCapacity: 65536,
      foreignDeclarations: [mayCallbackOnlyDeclarations],
    },
  );
}

/** A C library for callback contract tests: it keeps a callback for later
 * (as C libraries do), calls one now, calls one from a new thread, and
 * passes one a pointer to a record. */
export const callbackLibrarySource = `#include <pthread.h>
#include <stdint.h>
static int32_t (*saved)(int32_t);
void remember(int32_t (*f)(int32_t)) { saved = f; }
int32_t call_saved(int32_t x) { return saved(x); }
int32_t call_now(int32_t (*f)(int32_t), int32_t x) { return f(x); }
int32_t call_with_record(int32_t (*f)(const int32_t *), int32_t x) {
  return f(&x);
}
int32_t call_with_null(int32_t (*f)(const int32_t *)) { return f(0); }
static void *run(void *f) {
  return (void *)(intptr_t)((int32_t (*)(int32_t))f)(7);
}
int32_t call_on_thread(int32_t (*f)(int32_t)) {
  pthread_t thread;
  void *result = 0;
  if (pthread_create(&thread, 0, run, (void *)f) != 0) return -1;
  pthread_join(thread, &result);
  return (int32_t)(intptr_t)result;
}
`;
/** The scenarios: `ok` returns 42; `view-escape` (a record view kept past
 * its call, parked at the inaccessible guard) must fault on access; the
 * others must trap in the thunk. */
export type CallbackTrapScenario =
  "ok" | "leaf-later" | "leaf-inside" | "thread" | "view-escape";
function callbackTrapDeclarations(library: string): FixtureForeignDeclaration {
  return {
    id: "fixture/callback-traps.d.ts",
    text: `declare module "tint:c/callback-traps" {
  import type { i32, Ptr, Layout, Callback } from "tint:ffi";
  export interface Cell { v: i32 }
  export const Cell: Layout<Cell>;
  export function remember(f: Callback<(x: i32) => i32>): void;
  /** Declared leaf, though it calls the remembered callback. */
  export function call_saved(x: i32): i32;
  export function call_now(f: Callback<(x: i32) => i32>, x: i32): i32;
  export function call_on_thread(f: Callback<(x: i32) => i32>): i32;
  export function call_with_record(f: Callback<(p: Ptr<Cell>) => i32>, x: i32): i32;
  export function call_with_null(f: Callback<(p: Ptr<Cell>) => i32>): i32;
}
`,
    manifest: [
      {
        module: "tint:c/callback-traps",
        darwin: {
          name: library,
          optional: false,
          currentVersion: 0x10000,
          compatibilityVersion: 0x10000,
        },
        linux: {
          name: library,
          optional: false,
          currentVersion: 0,
          compatibilityVersion: 0,
        },
      },
    ],
  };
}
export function callbackTrapSource(scenario: CallbackTrapScenario): string {
  const body =
    scenario === "ok"
      ? `// A null record pointer is a TypeError, rethrown after the call.
  let threw = false;
  try {
    call_with_null((p: View<Cell>): number => p.v);
  } catch (error) {
    threw = error instanceof TypeError;
  }
  if (!threw) return 1;
  return call_now((x: number): number => x + 22, 20);`
      : scenario === "leaf-later"
        ? `remember((x: number): number => x);\n  return call_saved(1);`
        : scenario === "leaf-inside"
          ? `remember((x: number): number => x);\n  return call_now((x: number): number => call_saved(x), 1);`
          : scenario === "thread"
            ? `return call_on_thread((x: number): number => x);`
            : `const kept: View<Cell>[] = [];
  const seen = call_with_record((p: View<Cell>): number => {
    kept.push(p);
    return p.v;
  }, 5);
  const view = kept[0];
  if (seen !== 5 || view === undefined) return 1;
  return view.v;`;
  return `import type { View } from "tint:ffi";
import { remember, call_saved, call_now, call_on_thread, call_with_record, call_with_null, type Cell } from "traps";
export function run(): number {
  ${body}
}
`;
}
/** Build scenario `scenario` against `library` and run it under LLDB:
 * `ok` must exit 42; the others must stop on the thunk's trap (brk). */
export function verifyCallbackTrap(
  library: string,
  scenario: CallbackTrapScenario,
): string {
  const declarations = callbackTrapDeclarations(library);
  const previous = process.env.TINT_BUILD_ONLY;
  if (scenario !== "ok")
    process.env.TINT_BUILD_ONLY = nativeFixtureBuildOnlyMode();
  let binary: string;
  try {
    binary = verifyHostedFixture(
      callbackTrapSource(scenario),
      "ffi-callback-" + scenario,
      [
        ["traps", declarations.id],
        ["tint:ffi", "packages/native-runtime/src/ffi/index.ts"],
      ],
      [],
      [],
      [],
      {
        ...(nativeFixtureTarget().arch === "x86_64"
          ? { runtimeEntry: "initializeGenerationalRuntime" as const }
          : {}),
        managedBytes: 4194304,
        allocationCapacity: 65536,
        foreignDeclarations: [declarations],
      },
    );
  } finally {
    if (previous === undefined) delete process.env.TINT_BUILD_ONLY;
    else process.env.TINT_BUILD_ONLY = previous;
  }
  if (scenario === "ok") return binary;
  if (nativeFixtureTarget().arch === "x86_64" && previous === "1")
    return binary;
  try {
    if (nativeFixtureTarget().arch === "x86_64") {
      const [result] = runNativeBatch([
        { artifact: nativeArtifact("linux-x86_64", binary) },
      ]);
      assert.equal(result?.kind, "signaled", JSON.stringify(result));
      assert.equal(
        result.signal,
        scenario === "view-escape" ? "SIGSEGV" : "SIGILL",
      );
      return binary;
    }
    const result = runDarwinFixture(binary, () =>
      spawnSync(
        "lldb",
        [
          "--no-lldbinit",
          "--batch",
          ...lldbStartCommands(),
          "-o",
          "continue",
          "-o",
          "script assert lldb.process.GetState() == lldb.eStateStopped",
          "-o",
          "kill",
          binary,
        ],
        { encoding: "utf8", timeout: 60000 },
      ),
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(
      result.stdout,
      scenario === "view-escape"
        ? /stop reason = (EXC_BAD_ACCESS|signal SIGSEGV|signal SIGBUS)/
        : /stop reason = (EXC_BREAKPOINT|signal SIGTRAP)/,
      result.stdout,
    );
    return binary;
  } finally {
    if (process.env.TINT_KEEP_NATIVE !== "1")
      rmSync(dirname(binary), { recursive: true, force: true });
  }
}
/** Compile the callback library (clang -shared); undefined without clang. */
export function withCallbackLibrary<T>(
  body: (library: string) => T,
): T | undefined {
  if (spawnSync("clang", ["--version"]).status !== 0) return undefined;
  const directory = stableScratchDirectory("callback-library");
  try {
    const source = join(directory, "callback-traps.c"),
      library = join(
        directory,
        nativeFixtureTarget().os === "darwin"
          ? "libtint-callback-traps.dylib"
          : "libtint-callback-traps.so",
      );
    writeFileSync(source, callbackLibrarySource);
    const built = withNativeFixtureMemory(() =>
      spawnSync(
        "clang",
        ["-O1", "-shared", "-fPIC", "-pthread", "-o", library, source],
        { encoding: "utf8" },
      ),
    );
    if (built.status !== 0) throw Error("clang failed:\n" + built.stderr);
    return body(library);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** zlib with a TypeScript allocator: registered callbacks C keeps in the
 * z_stream and calls during later may-callback calls. */
export const zlibCallbackDeclarations: FixtureForeignDeclaration = {
  id: "fixture/zlib-callbacks.d.ts",
  text: `declare module "tint:c/zlib-callbacks" {
  import type { i32, u32, u64, u8, char, Ptr, Address, Layout, Callback, MayCallback } from "tint:ffi";
  export type alloc_func = Callback<(opaque: Address<void>, items: u32, size: u32) => Address<void>>;
  export type free_func = Callback<(opaque: Address<void>, address: Address<void>) => void>;
  export interface z_stream {
    next_in: Address<u8>;
    avail_in: u32;
    total_in: u64;
    next_out: Address<u8>;
    avail_out: u32;
    total_out: u64;
    msg: Address<char>;
    state: Address<void>;
    zalloc: alloc_func;
    zfree: free_func;
    opaque: Address<void>;
    data_type: i32;
    adler: u64;
    reserved: u64;
  }
  export const z_stream: Layout<z_stream>;
  export function zlibVersion(): Address<char>;
  export function deflateInit_(strm: Ptr<z_stream>, level: i32, version: Address<char>, size: i32): MayCallback<i32>;
  export function deflate(strm: Ptr<z_stream>, flush: i32): MayCallback<i32>;
  export function deflateEnd(strm: Ptr<z_stream>): MayCallback<i32>;
  export function inflateInit_(strm: Ptr<z_stream>, version: Address<char>, size: i32): MayCallback<i32>;
  export function inflate(strm: Ptr<z_stream>, flush: i32): MayCallback<i32>;
  export function inflateEnd(strm: Ptr<z_stream>): MayCallback<i32>;
}
`,
  manifest: [
    {
      module: "tint:c/zlib-callbacks",
      darwin: {
        name: "/usr/lib/libz.1.dylib",
        optional: false,
        currentVersion: 0x10000,
        compatibilityVersion: 0x10000,
      },
      linux: {
        name: "libz.so.1",
        optional: false,
        currentVersion: 0,
        compatibilityVersion: 0,
      },
    },
  ],
};
export function zlibCallbackSource(): string {
  return `import { allocate, release, address, releaseCallback, type View } from "tint:ffi";
import { z_stream, zlibVersion, deflateInit_, deflate, deflateEnd, inflateInit_, inflate, inflateEnd, alloc_func, free_func } from "zlib";
import { collectGarbage } from "gc";
let sink: number[][] = [];
function churn(): void {
  for (let round = 0; round < 8; round++) {
    const values: number[] = [];
    for (let i = 0; i < 64; i++) values.push(round * i);
    sink.push(values);
    if (sink.length > 16) sink = [];
  }
}
interface Arena { base: number; used: number; allocations: number; frees: number }
export function run(): number {
  const arena = allocate(4194304);
  const state: Arena = { base: address(arena), used: 0, allocations: 0, frees: 0 };
  // The allocator: a bump arena in external storage; collections run
  // inside it (C holds the z_stream and windows in external storage).
  const zalloc = alloc_func((opaque: number, items: number, size: number): number => {
    churn();
    if (state.allocations % 3 === 0) collectGarbage();
    state.allocations++;
    const bytes = Math.ceil((items * size) / 16) * 16;
    if (state.used + bytes > 4194304) return 0;
    const at = state.base + state.used;
    state.used += bytes;
    return at;
  });
  const zfree = free_func((opaque: number, at: number): void => {
    state.frees++;
  });
  const text: number[] = [];
  for (let i = 0; i < 20000; i++) text.push(97 + ((i * 7) % 13));
  const block = allocate(z_stream.size + 65536 * 3);
  const base = address(block);
  const input = base + z_stream.size, packed = input + 65536, output = packed + 65536;
  for (let i = 0; i < text.length; i++) block[z_stream.size + i] = text[i] ?? 0;
  const stream = z_stream.view(block);
  stream.zalloc = zalloc;
  stream.zfree = zfree;
  if (deflateInit_(block, 6, zlibVersion(), z_stream.size) !== 0) return 1;
  if (state.allocations === 0) return 2;
  stream.next_in = input;
  stream.avail_in = text.length;
  stream.next_out = packed;
  stream.avail_out = 65536;
  if (deflate(block, 4) !== 1) return 3;
  const packedBytes = stream.total_out;
  if (deflateEnd(block) !== 0) return 4;
  if (state.frees === 0) return 5;
  // Inflate it back with the same allocator.
  for (let i = 0; i < z_stream.size; i++) block[i] = 0;
  stream.zalloc = zalloc;
  stream.zfree = zfree;
  if (inflateInit_(block, zlibVersion(), z_stream.size) !== 0) return 6;
  stream.next_in = packed;
  stream.avail_in = packedBytes;
  stream.next_out = output;
  stream.avail_out = 65536;
  if (inflate(block, 4) !== 1) return 7;
  if (stream.total_out !== text.length) return 8;
  if (inflateEnd(block) !== 0) return 9;
  for (let i = 0; i < text.length; i++)
    if (block[z_stream.size + 131072 + i] !== text[i]) return 10;
  // A registered callback's exception: zlib sees a failed allocation and
  // the may-callback call rethrows it when it returns.
  const failing = alloc_func((opaque: number, items: number, size: number): number => {
    throw new RangeError("allocator failure");
  });
  for (let i = 0; i < z_stream.size; i++) block[i] = 0;
  stream.zalloc = failing;
  stream.zfree = zfree;
  let rethrown = false;
  try {
    deflateInit_(block, 6, zlibVersion(), z_stream.size);
  } catch (error) {
    rethrown = error instanceof RangeError;
  }
  if (!rethrown) return 11;
  releaseCallback(failing);
  releaseCallback(zalloc);
  releaseCallback(zfree);
  release(block);
  release(arena);
  return 42;
}
`;
}
export function verifyZlibCallbackFixture(): string {
  return verifyHostedFixture(
    zlibCallbackSource(),
    "ffi-zlib-callbacks",
    [
      ["tint:ffi", "packages/native-runtime/src/ffi/index.ts"],
      ["zlib", zlibCallbackDeclarations.id],
      ["gc", "packages/native-runtime/src/intrinsics/memory.ts"],
    ],
    [],
    [],
    [],
    {
      managedBytes: 4194304,
      allocationCapacity: 65536,
      foreignDeclarations: [zlibCallbackDeclarations],
    },
  );
}
