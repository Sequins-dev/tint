// The binding generator's native fixture (docs/native-ffi.md, "Binding
// generator"): libc calls through a binding generated fresh from this
// host's headers, compiled by Tint and run under LLDB.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { darwinSystemLibrary } from "@tint/abi/c";
import { emitBinding } from "./c-bindgen/emit.ts";
import { extractFacts, hostTarget } from "./c-bindgen/extract.ts";
import type { BindingSpec } from "./c-bindgen/spec.ts";
import { stableScratchPath } from "./fixture-scratch.ts";
import {
  verifyHostedFixture,
  type FixtureForeignDeclaration,
} from "./hosted-fixture.ts";

/** Records with nested records, fixed arrays and aliases (`struct stat`,
 * `struct utsname`), a variadic call shape (`open` with a mode), errno
 * results and constants. `struct stat` has different members on the two
 * targets, so the fixture binds the host's alone. */
export const sampleSpec: BindingSpec = {
  library: "bindgen-sample",
  summary: ["libc calls bound fresh from this host's headers."],
  targets: ["darwin-arm64", "linux-arm64"],
  headers: ["sys/stat.h", "sys/utsname.h", "fcntl.h", "unistd.h", "errno.h"],
  aliases: ["mode_t", "off_t"],
  constants: ["O_WRONLY", "O_CREAT", "O_TRUNC", "S_IFMT", "S_IFREG", "ENOENT"],
  records: ["stat", "utsname"],
  functions: [
    {
      name: "open",
      variant: "create",
      variadic: ["mode_t"],
      result: "OrErrno",
    },
    { name: "write", result: "OrErrno" },
    { name: "fstat", result: "OrErrno" },
    { name: "close", result: "OrErrno" },
    { name: "unlink", result: "OrErrno" },
    { name: "uname", result: "OrErrno" },
    "getpid",
  ],
};

/** The fixture's binding for this host, generated now. */
export async function sampleBinding(): Promise<string> {
  const target = hostTarget();
  if (target === undefined) throw new Error("no native target on this host");
  const facts = extractFacts(sampleSpec, target);
  const emission = await emitBinding(sampleSpec, new Map([[target, facts]]), {
    specPath: "tools/c-bindgen-fixtures.ts",
    targets: [target],
  });
  if (emission.report.length !== 0)
    throw new Error(
      "the sample binding left out: " + emission.report.join("; "),
    );
  return emission.text;
}

export function sampleFixtureSource(path: string, machine: string): string {
  const codes = [...machine].map((character) => character.charCodeAt(0));
  return `import {
  stat,
  utsname,
  open$create,
  write,
  fstat,
  close,
  unlink,
  uname,
  getpid,
  O_WRONLY,
  O_CREAT,
  O_TRUNC,
  S_IFMT,
  S_IFREG,
  ENOENT,
} from "sample";
const machine: number[] = ${JSON.stringify(codes)};
export function run(): number {
  // uname fills a record of fixed char arrays; read one through a view.
  const names = new Uint8Array(utsname.size);
  if (uname(names) !== 0) return 1;
  const system = utsname.view(names);
  for (let i = 0; i < machine.length; i++)
    if (system.machine[i] !== machine[i]) return 2;
  if (system.machine[machine.length] !== 0) return 3;
  // A variadic open, a write and fstat's nested record.
  const path = ${JSON.stringify(path)};
  const fd = open$create(path, O_WRONLY | O_CREAT | O_TRUNC, 420);
  if (fd < 0) return 4;
  const data = new Uint8Array(1234);
  for (let i = 0; i < data.length; i++) data[i] = i & 255;
  if (write(fd, data, data.length) !== 1234) return 5;
  const bytes = new Uint8Array(stat.size);
  if (fstat(fd, bytes) !== 0) return 6;
  const info = stat.view(bytes);
  if (info.st_size !== 1234) return 7;
  if ((info.st_mode & S_IFMT) !== S_IFREG) return 8;
  if ((info.st_mode & 511) !== 420) return 9;
  if (close(fd) !== 0) return 10;
  if (close(fd) !== -9) return 11;
  if (unlink(path) !== 0) return 12;
  if (unlink(path) !== -ENOENT) return 13;
  if (getpid() <= 0) return 14;
  return 42;
}
`;
}

/** Builds the fixture against a fresh binding and runs it under LLDB. */
export async function verifySampleFixture(): Promise<string> {
  const text = await sampleBinding();
  const machine = process.platform === "darwin" ? "arm64" : "aarch64";
  // The program creates and unlinks this file.
  const path = stableScratchPath("bindgen-sample-probe");
  mkdirSync(dirname(path), { recursive: true });
  const declaration = {
    id: "fixture/bindgen-sample.d.ts",
    text,
    manifest: [
      {
        module: "tint:c/bindgen-sample",
        darwin: {
          name: darwinSystemLibrary,
          optional: false,
          currentVersion: 0x10000,
          compatibilityVersion: 0x10000,
        },
        linux: {
          name: "libc.so.6",
          optional: false,
          currentVersion: 0,
          compatibilityVersion: 0,
        },
      },
    ],
  };
  return verifyHostedFixture(
    sampleFixtureSource(path, machine),
    "bindgen-sample",
    [["sample", declaration.id]],
    [],
    [],
    [],
    {
      managedBytes: 4194304,
      allocationCapacity: 65536,
      foreignDeclarations: [declaration],
    },
  );
}

/** The checked-in generated zlib binding as a fixture declaration (a
 * fixture cannot import `tint:c/zlib` itself, which only the runtime
 * package is granted): the same text under another module name. */
export function generatedZlibDeclarations(): FixtureForeignDeclaration {
  const text = readFileSync(
    new URL("../packages/native-runtime/src/c/zlib.d.ts", import.meta.url),
    "utf8",
  );
  if (!text.includes('declare module "tint:c/zlib" {'))
    throw new Error("the generated zlib binding moved");
  return {
    id: "fixture/zlib-generated.d.ts",
    text: text.replace(
      'declare module "tint:c/zlib" {',
      'declare module "tint:c/zlib-generated" {',
    ),
    manifest: [
      {
        module: "tint:c/zlib-generated",
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
}

/** node:zlib's call pattern (deflateInit2_/inflateInit2_ with gzip window
 * bits, output in small windows until one is not exhausted, inflateReset)
 * with a TypeScript allocator registered in the z_stream: the generated
 * binding's may-callback calls let zlib call it, with collections inside;
 * a throwing allocator is rethrown after the call. */
export function generatedZlibAllocatorSource(): string {
  return `import { allocate, release, address, releaseCallback } from "tint:ffi";
import {
  z_stream,
  zlibVersion,
  deflateInit2_,
  deflate,
  deflateEnd,
  inflateInit2_,
  inflate,
  inflateReset,
  inflateEnd,
  alloc_func,
  free_func,
} from "zlib";
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
const window = 64;
export function run(): number {
  const arena = allocate(4194304);
  const state: Arena = { base: address(arena), used: 0, allocations: 0, frees: 0 };
  const zalloc = alloc_func((opaque: number, items: number, size: number): number => {
    churn();
    if (state.allocations % 2 === 0) collectGarbage();
    state.allocations++;
    const bytes = Math.ceil((items * size) / 16) * 16;
    if (state.used + bytes > 4194304) return 0;
    const at = state.base + state.used;
    state.used += bytes;
    return at;
  });
  const zfree = free_func((opaque: number, at: number): void => {
    churn();
    state.frees++;
  });
  const length = 30000;
  const block = allocate(z_stream.size + 3 * 65536);
  const base = address(block);
  const input = z_stream.size, packed = input + 65536, output = packed + 65536;
  for (let i = 0; i < length; i++) block[input + i] = 97 + ((i * 7) % 13);
  const stream = z_stream.view(block);
  stream.zalloc = zalloc;
  stream.zfree = zfree;
  // gzip (windowBits 15 + 16), level 6, Z_DEFLATED, memLevel 8, default strategy.
  if (deflateInit2_(block, 6, 8, 31, 8, 0, zlibVersion(), z_stream.size) !== 0) return 1;
  if (state.allocations === 0) return 2;
  stream.next_in = base + input;
  stream.avail_in = length;
  // Node's processChunkSync: Z_FINISH with output windows until one is
  // not exhausted.
  let produced = 0, status = 0;
  for (;;) {
    stream.next_out = base + packed + produced;
    stream.avail_out = window;
    status = deflate(block, 4);
    produced += window - stream.avail_out;
    if (stream.avail_out !== 0) break;
  }
  if (status !== 1 || produced !== stream.total_out) return 3;
  if (deflateEnd(block) !== 0) return 4;
  if (state.frees === 0) return 5;
  // Inflate twice (automatic header detection, windowBits 15 + 32), with
  // inflateReset between, through the same allocator.
  for (let i = 0; i < z_stream.size; i++) block[i] = 0;
  stream.zalloc = zalloc;
  stream.zfree = zfree;
  const before = state.allocations;
  if (inflateInit2_(block, 47, zlibVersion(), z_stream.size) !== 0) return 6;
  for (let round = 0; round < 2; round++) {
    if (round === 1 && inflateReset(block) !== 0) return 7;
    stream.next_in = base + packed;
    stream.avail_in = produced;
    let restored = 0;
    for (;;) {
      stream.next_out = base + output + restored;
      stream.avail_out = window;
      status = inflate(block, 0);
      restored += window - stream.avail_out;
      if (status !== 0 || stream.avail_out !== 0) break;
    }
    if (status !== 1 || restored !== length) return 8 + round * 10;
    for (let i = 0; i < length; i++)
      if (block[output + i] !== block[input + i]) return 9 + round * 10;
  }
  if (state.allocations === before) return 30;
  if (inflateEnd(block) !== 0) return 31;
  // An allocator that throws: zlib sees a failed allocation and the
  // may-callback call rethrows the error when it returns.
  const failing = alloc_func((opaque: number, items: number, size: number): number => {
    throw new RangeError("allocator failure");
  });
  for (let i = 0; i < z_stream.size; i++) block[i] = 0;
  stream.zalloc = failing;
  stream.zfree = zfree;
  let rethrown = false;
  try {
    deflateInit2_(block, 6, 8, 31, 8, 0, zlibVersion(), z_stream.size);
  } catch (error) {
    rethrown = error instanceof RangeError;
  }
  if (!rethrown) return 32;
  releaseCallback(failing);
  releaseCallback(zalloc);
  releaseCallback(zfree);
  release(block);
  release(arena);
  return 42;
}
`;
}
export function verifyGeneratedZlibAllocatorFixture(
  runtimeEntry?: "initializeCopyingRuntime",
): string {
  const declarations = generatedZlibDeclarations();
  return verifyHostedFixture(
    generatedZlibAllocatorSource(),
    runtimeEntry === undefined
      ? "bindgen-zlib-allocator"
      : "bindgen-zlib-allocator-copying",
    [
      ["tint:ffi", "packages/native-runtime/src/ffi/index.ts"],
      ["zlib", declarations.id],
      ["gc", "packages/native-runtime/src/intrinsics/memory.ts"],
    ],
    [],
    [],
    [],
    {
      ...(runtimeEntry === undefined ? {} : { runtimeEntry }),
      managedBytes: 4194304,
      allocationCapacity: 65536,
      foreignDeclarations: [declarations],
    },
  );
}

/** General (untyped) code importing a generated binding, a trusted module
 * (docs/unified-pipeline.md, slice 2a): exports whose types cross a checked
 * boundary are called natively; one taking a byte view (`Ptr`) is a named
 * build error. Returns the general modules and the blocked build's error. */
export function verifyGeneralBindingImport(): {
  readonly general: readonly string[];
  readonly blocked: string;
} {
  const declarations = generatedZlibDeclarations();
  const options = {
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    foreignDeclarations: [declarations],
  };
  const general: string[] = [];
  verifyHostedFixture(
    `import { zlibVersion } from "zlib";
function check() {
  const version = zlibVersion();
  return [typeof version === "number", version > 0].every((ok) => ok);
}
export function run() { return check() ? 42 : 1; }`,
    "bindgen-general-import",
    [["zlib", declarations.id]],
    [],
    [],
    [],
    {
      ...options,
      onGeneralFallback: (modules: readonly string[]) =>
        general.push(...modules),
    },
  );
  let blocked = "";
  try {
    verifyHostedFixture(
      `import { deflate } from "zlib";
function check() { return [deflate].every((f) => f !== undefined); }
export function run() { return check() ? 42 : 1; }`,
      "bindgen-general-import-blocked",
      [["zlib", declarations.id]],
      [],
      [],
      [],
      options,
    );
  } catch (error) {
    blocked = String(error);
  }
  return { general, blocked };
}
