import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { cLayout, cPointer, cScalar, cVoid, type CScalar } from "@tint/abi/c";
import { linuxX86_64CTarget } from "@tint/abi/c/sysv";
import { emitModule } from "@tint/codegen/x86_64/scalar";
import { appendHostedEntry } from "@tint/codegen/x86_64/startup";
import { buildElfExecutable } from "@tint/image/linux/elf";
import type { Block, ForeignCall, Instruction } from "@tint/ir/scalar";
import { linuxX86_64Target } from "@tint/platform/target";
import { parseForeignDeclarations } from "@tint/compiler/native";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";
import {
  nativeArtifact,
  runNativeBatch,
  x64SshArguments,
} from "./native-target-runner.ts";
import {
  callbackLibrarySource,
  verifyCallbackFixture,
  verifyCallbackTrap,
} from "./native-callback-fixtures.ts";

const x64 = nativeFixtureTarget().name === "linux-x86_64";

test(
  "SysV static bindings call glibc with integer arguments and an SSE result",
  {
    skip: x64 ? false : "requires the linux-x86_64 fixture target",
  },
  () => {
    process.env.TINT_GENERAL_FALLBACK = "0";
    verifyHostedFixture(
      `import { difftime } from "tint:c/sysv-libc";
    export function run(): number { return difftime(84, 42); }`,
      "sysv-libc",
      [["tint:c/sysv-libc", "sysv-libc.d.ts"]],
      [],
      [],
      [],
      {
        managedBytes: 4194304,
        allocationCapacity: 65536,
        foreignDeclarations: [
          {
            id: "sysv-libc.d.ts",
            text: `declare module "tint:c/sysv-libc" {
          import type { f64, i64 } from "tint:ffi";
          export function difftime(end: i64, start: i64): f64;
        }`,
            manifest: [
              {
                module: "tint:c/sysv-libc",
                linux: {
                  name: "libc.so.6",
                  optional: false,
                  currentVersion: 0,
                  compatibilityVersion: 0,
                },
              },
            ],
          },
        ],
      },
    );
  },
);

test(
  "SysV public foreignFunction calls a glibc function",
  { skip: !x64 },
  () => {
    verifyHostedFixture(
      `import { openProgram, findSymbol, foreignFunction, setNumber, invoke, resultNumber } from "tint:ffi/unsafe";
    export function run(): number {
      const handle = openProgram();
      const fn = foreignFunction(findSymbol(handle, "difftime"), {
        parameters: [{ kind: "scalar", scalar: "i64" }, { kind: "scalar", scalar: "i64" }],
        result: { kind: "scalar", scalar: "f64" }, fixedParameters: 2, callClass: "leaf", errno: "none",
      });
      setNumber(fn, 0, 84); setNumber(fn, 1, 42); invoke(fn);
      return resultNumber(fn);
    }`,
      "sysv-dynamic",
      [["tint:ffi/unsafe", "packages/native-runtime/src/ffi/unsafe.ts"]],
      [],
      [],
      [],
      {
        requireTyped: true,
        managedBytes: 4194304,
        allocationCapacity: 65536,
        runtimeEntry: "initializeGenerationalRuntime",
      },
    );
  },
);

const oracleId = "x64-ffi-oracle.d.ts";
const oracleSpecifier = "tint:c/sysv-oracle";
const oracleDeclarations = `declare module "${oracleSpecifier}" {
  import type { Address, ByTarget, CStringBytes, Packed, Ptr, Union, Variadic, char, f32, f64, i16, i32, i64, u64, usize } from "tint:ffi";
  type CLong = ByTarget<{ "darwin-arm64": i64; "linux-arm64": i64; "linux-x86_64": i64 }>;
  export interface II { a: CLong; b: CLong; }
  export interface IS { a: CLong; b: f64; }
  export interface SI { a: f64; b: CLong; }
  export interface SS { a: f64; b: f64; }
  export interface Merge { a: f32; b: i32; c: f64; }
  export interface Padded { tag: char; value: i32; tail: i16; }
  export interface Word extends Union { f: f64; i: u64; }
  export interface Overlay { word: Word; value: f64; }
  export interface PackedImage extends Packed { tag: char; value: f64; }
  export interface Big { a: CLong; b: CLong; c: CLong; }

  export function oracle_ii(input: II): II;
  export function oracle_is(input: IS): IS;
  export function oracle_si(input: SI): SI;
  export function oracle_ss(input: SS): SS;
  export function oracle_merge(input: Merge): Merge;
  export function oracle_overlay(input: Overlay): Overlay;
  export function oracle_unaligned(input: PackedImage): PackedImage;
  export function oracle_big(input: Big, delta: CLong): Big;

  export function oracle_check_ii(value: Ptr<II>): i32;
  export function oracle_check_is(value: Ptr<IS>): i32;
  export function oracle_check_si(value: Ptr<SI>): i32;
  export function oracle_check_ss(value: Ptr<SS>): i32;
  export function oracle_check_merge(value: Ptr<Merge>): i32;
  export function oracle_check_overlay(value: Ptr<Overlay>): i32;
  export function oracle_check_unaligned(value: Ptr<PackedImage>): i32;
  export function oracle_check_big(value: Ptr<Big>): i32;

  export function oracle_layout(padded: usize, tag: usize, value: usize, tail: usize, overlay: usize, packed: usize, packedValue: usize): i32;
  export function oracle_gp_full(a: CLong, b: CLong, c: CLong, d: CLong, e: CLong, f: CLong, mixed: IS, last: f64): f64;
  export function oracle_sse_full(a: f64, b: f64, c: f64, d: f64, e: f64, f: f64, g: f64, h: f64, mixed: SI, last: CLong): CLong;
  export function oracle_variadic(named: i32, narrow: Variadic<char>, floating: Variadic<f32>, mixed: Variadic<IS>): f64;
  export function oracle_al(named: i32, a: Variadic<f64>, b: Variadic<IS>, c: Variadic<f32>): i32;
  export function dlsym(handle: Address<void>, name: CStringBytes): Address<void>;
}`;

function withOracle(
  check: (library: string, directory: string) => void,
  sourceText?: string,
): void {
  // The worktree is visible on dev and QEMU receives the absolute DSO path
  // through DT_NEEDED. No modifications to the pinned sysroot are needed.
  const parent = resolve(".tint-bootstrap", "x64-ffi-sysv");
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, "oracle-"));
  try {
    const library = join(directory, "oracle.so");
    let source = "tools/fixtures/x64-ffi-oracle.c";
    if (sourceText !== undefined) {
      source = join(directory, "oracle.c");
      writeFileSync(source, sourceText);
    }
    const built =
      process.platform === "linux" && process.arch === "x64"
        ? spawnSync(
            "clang",
            [
              "-march=x86-64-v2",
              "-O2",
              "-fPIC",
              "-fno-stack-protector",
              "-shared",
              "-Wl,-z,defs",
              "-o",
              library,
              source,
            ],
            { encoding: "utf8", timeout: 12000 },
          )
        : (() => {
            const sysroot = join(homedir(), ".t3", "tint-x64-sysroot");
            return spawnSync(
              "container",
              [
                "machine",
                "run",
                "-n",
                "dev",
                "-w",
                process.cwd(),
                "--",
                "clang",
                "--target=x86_64-linux-gnu",
                "--sysroot=" + sysroot,
                "-march=x86-64-v2",
                "--ld-path=/usr/bin/ld.lld-23",
                "-O2",
                "-fPIC",
                "-fno-stack-protector",
                "-nostdlib",
                "-shared",
                "-Wl,-z,defs",
                "-L" + join(sysroot, "lib", "x86_64-linux-gnu"),
                "-Wl,--no-as-needed",
                "-l:libc.so.6",
                "-o",
                library,
                source,
              ],
              { encoding: "utf8", timeout: 12000 },
            );
          })();
    assert.equal(built.status, 0, built.error?.message ?? built.stderr);
    if (
      process.env.TINT_NATIVE_RUNNER !== "x64-ssh" ||
      process.env.TINT_BUILD_ONLY === "1" ||
      process.env.TINT_BUILD_ONLY === "defer-admission"
    ) {
      check(library, directory);
      return;
    }
    // DT_NEEDED and dlopen both use this interpreter's path to the oracle.
    const bytes = readFileSync(library);
    const ssh = x64SshArguments();
    const uploaded = spawnSync(
      "ssh",
      [
        ...ssh,
        `set -eu
d=$(mktemp -d /tmp/tint-x64-oracle.XXXXXXXX)
trap 'rm -rf "$d"' EXIT
cat > "$d/oracle.so"
sha256sum "$d/oracle.so"
trap - EXIT`,
      ],
      { input: bytes, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(
      uploaded.status,
      0,
      uploaded.error?.message ?? uploaded.stderr,
    );
    const [digest, guest] = uploaded.stdout.trim().split(/\s+/);
    assert.ok(
      guest &&
        /^\/tmp\/tint-x64-oracle\.[a-zA-Z0-9]{8}\/oracle\.so$/.test(guest),
    );
    try {
      assert.equal(digest, createHash("sha256").update(bytes).digest("hex"));
      check(guest, directory);
    } finally {
      const cleaned = spawnSync(
        "ssh",
        [...ssh, `rm -f -- '${guest}' && rmdir -- '${dirname(guest)}'`],
        { encoding: "utf8", timeout: 30000 },
      );
      assert.equal(cleaned.status, 0, cleaned.error?.message ?? cleaned.stderr);
    }
  } finally {
    if (
      process.env.TINT_BUILD_ONLY !== "1" &&
      process.env.TINT_KEEP_NATIVE !== "1"
    )
      rmSync(directory, { recursive: true, force: true });
  }
}

function fixtureOptions(library: string) {
  return {
    managedBytes: 4194304,
    allocationCapacity: 65536,
    requireTyped: true,
    foreignDeclarations: [
      {
        id: oracleId,
        text: oracleDeclarations,
        manifest: [
          {
            module: oracleSpecifier,
            linux: {
              name: library,
              optional: false,
              currentVersion: 0,
              compatibilityVersion: 0,
            },
          },
        ],
      },
    ],
  };
}

function layoutArguments(): string {
  const parsed = parseForeignDeclarations(
    oracleDeclarations,
    linuxX86_64CTarget,
  );
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const typeLayout = (name: string) => {
    const record = parsed.value.records.find(
      (candidate) => candidate.name === name,
    );
    assert.ok(record);
    const layout = cLayout(record.type, linuxX86_64CTarget);
    assert.ok(layout.ok, JSON.stringify(layout));
    return layout.value;
  };
  const padded = typeLayout("Padded"),
    overlay = typeLayout("Overlay"),
    packed = typeLayout("PackedImage");
  return [
    padded.size,
    ...padded.offsets,
    overlay.size,
    packed.size,
    packed.offsets[1],
  ].join(", ");
}

function bytes(variable: string, image: Uint8Array): string {
  return (
    `const ${variable} = new Uint8Array(${image.length});\n` +
    [...image]
      .map((value, index) =>
        value === 0 ? "" : `${variable}[${index}] = ${value};`,
      )
      .join("\n")
  );
}

const pairs = ["ii", "is", "si", "ss"] as const;
function pairImage(name: (typeof pairs)[number]) {
  const input = Buffer.alloc(16);
  if (name[0] === "i") input.writeBigInt64LE(19n, 0);
  else input.writeDoubleLE(19, 0);
  if (name[1] === "i") input.writeBigInt64LE(21n, 8);
  else input.writeDoubleLE(21, 8);
  return input;
}

test(
  "SysV static C oracle checks aggregate registers, spills, sret, layout and variadics",
  { skip: !x64 },
  () => {
    process.env.TINT_GENERAL_FALLBACK = "0";
    const shapes = [...pairs, "merge", "overlay", "unaligned", "big"];
    const merge = Buffer.alloc(16);
    merge.writeFloatLE(7.25, 0);
    merge.writeInt32LE(21, 4);
    merge.writeDoubleLE(8.5, 8);
    const overlay = Buffer.alloc(16);
    overlay.writeBigUInt64LE(21n, 0);
    overlay.writeDoubleLE(18.25, 8);
    const unaligned = Buffer.alloc(9);
    unaligned.writeInt8(-7, 0);
    unaligned.writeDoubleLE(21.25, 1);
    const big = Buffer.alloc(24);
    big.writeBigInt64LE(19n, 0);
    big.writeBigInt64LE(23n, 8);
    big.writeBigInt64LE(14n, 16);
    const images = [...pairs.map(pairImage), merge, overlay, unaligned, big];
    // The generated static stubs exercise the C ABI directly. Building the
    // TypeScript record wrappers additionally depends on managed record
    // lowering, which is owned by slice 7.
    const cases = shapes.map((name, index) => {
      const image = images[index];
      assert.ok(image);
      return `${bytes(name, image)}
      const out_${name} = new Uint8Array(${image.length});
      oracle_${name}$c(${name}${name === "big" ? ", 2" : ""}, out_${name});
      if (oracle_check_${name}(out_${name}) !== 1) return ${index + 10};`;
    });
    withOracle((library) =>
      verifyHostedFixture(
        `import {
      ${shapes.flatMap((name) => [`oracle_${name}$c`, `oracle_check_${name}`]).join(", ")},
      oracle_layout, oracle_gp_full$c, oracle_sse_full$c, oracle_variadic$c, oracle_al$c
    } from "${oracleSpecifier}";
    export function run(): number {
      if (oracle_layout(${layoutArguments()}) !== 1) return 1;
      ${cases.join("\n")}
      if (big[0] !== 19 || big[8] !== 23 || big[16] !== 14) return 2;
      if (oracle_gp_full$c(1, 2, 3, 4, 5, 6, is, 0.5) !== 131.5) return 3;
      if (oracle_sse_full$c(1, 2, 3, 4, 5, 6, 7, 8, si, 3) !== 247) return 4;
      if (oracle_variadic$c(4, -7, 5.5, is) !== 42.5) return 5;
      if (oracle_al$c(0, 1, is, 2) !== 3) return 6;
      return 42;
    }`,
        "sysv-c-oracle",
        [[oracleSpecifier, oracleId]],
        [],
        [],
        [],
        fixtureOptions(library),
      ),
    );
  },
);

test(
  "SysV dynamic trampoline calls a symbol resolved at runtime",
  { skip: !x64 },
  () => {
    const id = "fixture-dynamic-trampoline";
    const text = `export function callForeign(
    target: number, frame: Uint8Array,
    a: Uint8Array, b: Uint8Array, c: Uint8Array, d: Uint8Array,
    e: Uint8Array, f: Uint8Array, g: Uint8Array, h: Uint8Array
  ): void { throw "HOST_UNAVAILABLE"; }`;
    const encoded = new TextEncoder().encode(text);
    const source = createSourceText(encoded, encoded.length);
    assert.ok(source.ok);
    const parsed = parseModule(source.value);
    assert.ok(parsed.ok);
    const cases = [
      [
        "oracle_dynamic",
        (frame: Buffer) => {
          frame.writeBigInt64LE(19n, 0);
          frame.writeDoubleLE(23, 64);
          frame.writeBigUInt64LE(1n, 128);
        },
        (result: Buffer) => result.writeDoubleLE(42),
      ],
      [
        "oracle_variadic",
        (frame: Buffer) => {
          frame.writeBigInt64LE(4n, 0);
          frame.writeBigInt64LE(-7n, 8);
          frame.writeBigInt64LE(19n, 16);
          frame.writeDoubleLE(5.5, 64);
          frame.writeDoubleLE(21, 72);
          frame.writeBigUInt64LE(2n, 128);
        },
        (result: Buffer) => result.writeDoubleLE(42.5),
      ],
      [
        "oracle_big",
        (frame: Buffer) => {
          frame.writeBigInt64LE(2n, 8);
          frame.writeBigInt64LE(8n, 56); // sret alignment
          frame.writeBigUInt64LE(32n, 136); // outgoing stack bytes
          frame.writeBigUInt64LE(1n, 144); // patch count
          frame.writeBigUInt64LE(1152n, 512); // GP0 = frame base + scratch
          frame.writeBigInt64LE(19n, 640);
          frame.writeBigInt64LE(23n, 648);
          frame.writeBigInt64LE(14n, 656);
        },
        (result: Buffer) => {
          result.writeBigInt64LE(21n, 0);
          result.writeBigInt64LE(23n, 8);
          result.writeBigInt64LE(12n, 16);
        },
      ],
      [
        "oracle_borrow",
        (frame: Buffer) => {
          frame.writeBigInt64LE(22n, 8);
          frame.writeBigUInt64LE(1n, 144);
          frame.writeBigUInt64LE(1n, 384); // GP0 = first borrowed operand
        },
        (result: Buffer) => result.writeBigInt64LE(42n),
      ],
    ] as const;
    const probes = cases.map(([symbol, fill, expected], index) => {
      const frame = Buffer.alloc(1664);
      frame.writeBigUInt64LE(16n, 48);
      fill(frame);
      const result = Buffer.alloc(symbol === "oracle_big" ? 24 : 8);
      expected(result);
      const base =
        symbol === "oracle_big" ? 1152 : symbol === "oracle_borrow" ? 0 : 64;
      const image = "frame" + index,
        name = "name" + index;
      const checks = [...result]
        .map((value, at) => `${image}[${base + at}] !== ${value}`)
        .join(" || ");
      return `${bytes(name, Buffer.from(symbol + "\0"))}
      ${bytes(image, frame)}
      callForeign(dlsym(0, ${name}), ${image}, borrowed, empty, empty, empty, empty, empty, empty, empty);
      if (${checks}) return ${index + 1};`;
    });
    withOracle((library) =>
      verifyHostedFixture(
        `import { dlsym } from "${oracleSpecifier}";
    import { callForeign } from "test-trampoline";
    export function run(): number {
      const empty = new Uint8Array(0);
      const borrowed = new Uint8Array(1);
      borrowed[0] = 20;
      ${probes.join("\n")}
      if (borrowed[0] !== 42) return 5;
      return 42;
    }`,
        "sysv-trampoline",
        [
          [oracleSpecifier, oracleId],
          ["test-trampoline", id],
        ],
        [{ id, module: parsed.value, dependencies: new Map() }],
        [],
        [{ module: id, namespace: "test-trampoline" }],
        {
          ...fixtureOptions(library),
          foreignMemoryBindings: [
            { module: id, name: "callForeign", operation: "call" },
          ],
        },
      ),
    );
  },
);

test(
  "SysV scoped callbacks preserve nested views, throws and moving roots",
  { skip: !x64 },
  () => {
    verifyCallbackFixture("initializeGenerationalRuntime");
  },
);

test(
  "SysV callback contracts reject stale entries, leaf reentry and the wrong thread",
  { skip: !x64 },
  () => {
    const source =
      callbackLibrarySource.replace(
        "#include <pthread.h>\n#include <stdint.h>",
        `typedef int int32_t;
typedef long intptr_t;
typedef unsigned long pthread_t;
extern int pthread_create(pthread_t *, const void *, void *(*)(void *), void *);
extern int pthread_join(pthread_t, void **);`,
      ) +
      `
void remember_address(void *callback) { remember((int32_t (*)(int32_t))callback); }
int32_t call_saved_may(int32_t x) { return call_saved(x); }
double call_mixed(double (*f)(signed char, long, int, int, int, int, int)) {
  return f(-5, 22, 1, 2, 3, 4, 15);
}
`;
    withOracle((library) => {
      for (const scenario of [
        "ok",
        "leaf-later",
        "leaf-inside",
        "thread",
        "view-escape",
      ] as const)
        console.log(scenario, verifyCallbackTrap(library, scenario));
      verifyHostedFixture(
        `import { Remembered, remember_address, call_saved_may, call_mixed } from "callbacks";
       import { releaseCallback } from "tint:ffi";
       import { collectGarbage } from "memory";
       export function run(): number {
         const retained = { offset: 23 };
         const registered = Remembered((x: number): number => {
           collectGarbage();
           return x + retained.offset;
         });
         remember_address(registered);
         const saved = call_saved_may(19);
         if (saved !== 42) return 1;
         releaseCallback(registered);
         return call_mixed((a: number, b: number, c: number, d: number, e: number,
           f: number, g: number): number => a + b + c + d + e + f + g);
       }`,
        "sysv-registered-and-mixed",
        [
          ["callbacks", "sysv-registered.d.ts"],
          ["tint:ffi", "packages/native-runtime/src/ffi/index.ts"],
          ["memory", "packages/native-runtime/src/intrinsics/memory.ts"],
        ],
        [],
        [],
        [],
        {
          managedBytes: 4194304,
          allocationCapacity: 65536,
          runtimeEntry: "initializeGenerationalRuntime",
          requireTyped: true,
          foreignDeclarations: [
            {
              id: "sysv-registered.d.ts",
              text: `declare module "tint:c/sysv-registered" {
            import type { Address, Callback, f64, i8, i32, i64, MayCallback } from "tint:ffi";
            export type Remembered = Callback<(x: i32) => i32>;
            export function remember_address(f: Address<void>): void;
            export function call_saved_may(x: i32): MayCallback<i32>;
            export function call_mixed(f: Callback<(a: i8, b: i64, c: i32, d: i32,
              e: i32, f: i32, g: i32) => f64>): f64;
          }`,
              manifest: [
                {
                  module: "tint:c/sysv-registered",
                  linux: {
                    name: library,
                    optional: false,
                    currentVersion: 0,
                    compatibilityVersion: 0,
                  },
                },
              ],
            },
          ],
        },
      );
    }, source);
  },
);

test(
  "SysV signed C view fields round trip against the C oracle",
  { skip: !x64 },
  () => {
    // Exercise the verified view IR directly. The source-level Layout object
    // still needs slice 7's managed record emission.
    const span = { start: 0, end: 0 };
    const fields = [
      { scalar: "i8", offset: 0, seed: -128, write: -17 },
      { scalar: "i16", offset: 1, seed: -32768, write: -23456 },
      { scalar: "i32", offset: 3, seed: -2147483648, write: -1234567890 },
    ] satisfies {
      scalar: CScalar;
      offset: number;
      seed: number;
      write: number;
    }[];
    const blocks: Block[] = [];
    let instructions: Instruction[] = [];
    let next = 0;
    function constant(value: number): number {
      const id = next++;
      instructions.push({ ...span, kind: "constant", id, value });
      return id;
    }
    function check(actual: number, expected: number, failure: number): void {
      const rhs = constant(expected);
      const id = next++;
      instructions.push({
        ...span,
        kind: "binary",
        id,
        operator: "===",
        left: actual,
        right: rhs,
      });
      requireCheck(id, failure);
    }
    function requireCheck(condition: number, failure: number): void {
      const current = blocks.length;
      blocks.push({
        id: current,
        instructions,
        terminator: {
          ...span,
          kind: "branch",
          condition,
          consequent: current + 2,
          alternate: current + 1,
        },
      });
      instructions = [];
      const status = constant(failure);
      blocks.push({
        id: current + 1,
        instructions,
        terminator: { ...span, kind: "return", value: status },
      });
      instructions = [];
    }
    const minimum = 7;
    const length = constant(minimum);
    const array = next++;
    instructions.push({
      ...span,
      kind: "array-new",
      id: array,
      type: "Uint8Array",
      length,
    });
    instructions.push({ ...span, kind: "store", slot: 0, value: array });
    function arrayValue(): number {
      const id = next++;
      instructions.push({ ...span, kind: "load", slot: 0, id });
      return id;
    }
    function oracle(
      symbol: string,
      result: ForeignCall["result"],
    ): number | undefined {
      const call: ForeignCall = {
        symbol,
        operands: ["bytes"],
        result,
        signature: {
          parameters: [cPointer(cVoid())],
          result: result === "void" ? cVoid() : cScalar("i32"),
          fixedParameters: 1,
          callClass: "leaf",
          errno: "none",
        },
      };
      const borrowed = arrayValue();
      const id = result === "void" ? undefined : next++;
      instructions.push({
        ...span,
        kind: "c-call",
        call,
        arguments: [borrowed],
        id,
      });
      return id;
    }
    oracle("oracle_seed_signed_fields", "void");
    for (const [index, field] of fields.entries()) {
      const access = {
        type: cScalar(field.scalar),
        offset: field.offset,
        minimum,
      };
      const read = () => {
        const borrowed = arrayValue();
        const id = next++;
        instructions.push({
          ...span,
          kind: "c-memory",
          access: { ...access, operation: "load" },
          arguments: [borrowed],
          id,
        });
        return id;
      };
      check(read(), field.seed, 10 + index);
      const value = constant(field.write);
      const fits = next++;
      instructions.push({
        ...span,
        kind: "c-memory",
        access: { operation: "fits", type: access.type, offset: 0, minimum: 0 },
        arguments: [value],
        id: fits,
      });
      requireCheck(fits, 20 + index);
      const borrowed = arrayValue();
      const stored = constant(field.write);
      instructions.push({
        ...span,
        kind: "c-memory",
        access: { ...access, operation: "store" },
        arguments: [borrowed, stored],
        id: undefined,
      });
      check(read(), field.write, 30 + index);
    }
    const verified = oracle("oracle_check_signed_fields", "number");
    assert.ok(verified !== undefined);
    check(verified, 1, 40);
    const status = constant(42);
    blocks.push({
      id: blocks.length,
      instructions,
      terminator: { ...span, kind: "return", value: status },
    });

    const target = linuxX86_64Target;
    const emitted = emitModule(
      {
        functions: [
          {
            id: 0,
            name: "signed_fields",
            exported: true,
            parameters: [],
            slots: ["Uint8Array"],
            returnType: "number",
            entry: 0,
            blocks,
          },
        ],
      },
      target.hostABI,
    );
    assert.ok(emitted.ok, JSON.stringify(emitted));
    const image = appendHostedEntry({
      native: emitted.value,
      host: target.hostABI,
      invocation: emitted.value.functions[0]!.offset,
      returnType: "number",
      stackBytes: 1048576,
      managedBytes: 4096,
      pageBytes: target.memoryPageBytes,
    });
    withOracle((library, directory) => {
      const built = buildElfExecutable({
        ...image,
        code: new Uint8Array(0),
        linux: {
          arch: target.arch,
          interpreter: target.interpreter,
          needed: [library],
          libcVersion: {
            symbol: "__libc_start_main",
            version: target.glibcStartVersion,
          },
          identifier: "tint.sysv.signed-fields",
        },
      });
      assert.ok(built.ok, JSON.stringify(built));
      const path = join(directory, "signed-fields");
      writeFileSync(path, built.value.bytes, { mode: 0o755 });
      console.log(path);
      if (process.env.TINT_BUILD_ONLY === "1") return;
      const artifact = nativeArtifact(target.name, path);
      const results = runNativeBatch([{ artifact }, { artifact }]);
      for (const result of results)
        assert.ok(
          result.kind === "exited" && result.status === 42,
          JSON.stringify(result),
        );
    });
  },
);

test(
  "SysV static ldiv returns a managed record by value",
  { skip: !x64 },
  () => {
    verifyHostedFixture(
      'import { ldiv } from "tint:c/sysv"; export function run(): number { return ldiv(85, 2).quot; }',
      "sysv-ldiv",
      [["tint:c/sysv", "sysv.d.ts"]],
      [],
      [],
      [],
      {
        managedBytes: 4194304,
        allocationCapacity: 65536,
        requireTyped: true,
        foreignDeclarations: [
          {
            id: "sysv.d.ts",
            text: 'declare module "tint:c/sysv" { import type { i64 } from "tint:ffi"; export interface Result { quot: i64; rem: i64; } export function ldiv(n: i64, d: i64): Result; }',
            manifest: [
              {
                module: "tint:c/sysv",
                linux: {
                  name: "libc.so.6",
                  optional: false,
                  currentVersion: 0,
                  compatibilityVersion: 0,
                },
              },
            ],
          },
        ],
      },
    );
  },
);

test(
  "SysV static managed records use mixed registers and sret by value",
  { skip: !x64 },
  () => {
    withOracle((library) =>
      verifyHostedFixture(
        `import { oracle_is, oracle_big, type IS, type Big } from "${oracleSpecifier}";
      export function run(): number {
        const mixed: IS = { a: 19, b: 21 };
        const big: Big = { a: 19, b: 23, c: 14 };
        const result = oracle_is(mixed);
        const large = oracle_big(big, 2);
        if (mixed.b !== 21 || big.a !== 19) return 1;
        if (result.a !== 19 || result.b !== 23) return 2;
        if (large.a !== 21 || large.b !== 23 || large.c !== 12) return 3;
        return result.a + result.b;
      }`,
        "sysv-managed-records",
        [[oracleSpecifier, oracleId]],
        [],
        [],
        [],
        fixtureOptions(library),
      ),
    );
  },
);

test(
  "SysV static C layout views and CString conversion",
  { skip: !x64 },
  () => {
    verifyHostedFixture(
      `import { Pair, strlen } from "tint:c/sysv";
     export function run(): number {
       const bytes = new Uint8Array(Pair.size);
       const view = Pair.view(bytes);
       view.a = 37;
       view.b = strlen("aé😀");
       if (Pair.size !== 8 || view.b !== 7) return 1;
       return view.a + view.b - 2;
     }`,
      "sysv-layout-and-string",
      [["tint:c/sysv", "sysv.d.ts"]],
      [],
      [],
      [],
      {
        managedBytes: 4194304,
        allocationCapacity: 65536,
        requireTyped: true,
        foreignDeclarations: [
          {
            id: "sysv.d.ts",
            text: 'declare module "tint:c/sysv" { import type { i32, i64, CString, Layout } from "tint:ffi"; export interface Pair { a: i32; b: i32; } export const Pair: Layout<Pair>; export function strlen(text: CString): i64; }',
            manifest: [
              {
                module: "tint:c/sysv",
                linux: {
                  name: "libc.so.6",
                  optional: false,
                  currentVersion: 0,
                  compatibilityVersion: 0,
                },
              },
            ],
          },
        ],
      },
    );
  },
);

test(
  "SysV public dynamic C oracle handles variadics, mixed records, sret and moved byte operands",
  { skip: !x64 },
  () => {
    const mixed = pairImage("is");
    const big = Buffer.alloc(24);
    big.writeBigInt64LE(19n, 0);
    big.writeBigInt64LE(23n, 8);
    big.writeBigInt64LE(14n, 16);
    const memory = "packages/native-runtime/src/intrinsics/memory.ts";
    withOracle((library) =>
      verifyHostedFixture(
        `import {
        openLibrary, closeLibrary, findSymbol, foreignFunction, setNumber,
        setRecord, setBytes, invoke, resultNumber, resultRecord,
        type ForeignSignature, type ForeignType, type ForeignFunction, type LibraryHandle
      } from "tint:ffi/unsafe";
      import { collectGarbage } from "memory";
      const i64: ForeignType = { kind:"scalar", scalar:"i64" };
      const i32: ForeignType = { kind:"scalar", scalar:"i32" };
      const char: ForeignType = { kind:"scalar", scalar:"char" };
      const f64: ForeignType = { kind:"scalar", scalar:"f64" };
      const f32: ForeignType = { kind:"scalar", scalar:"f32" };
      const pointer: ForeignType = { kind:"pointer", pointee:{ kind:"void" } };
      const mixedType: ForeignType = { kind:"record", name:"IS", union:false, packed:false,
        alignment:0, fields:[{name:"a", type:i64}, {name:"b", type:f64}] };
      const bigType: ForeignType = { kind:"record", name:"Big", union:false, packed:false,
        alignment:0, fields:[{name:"a", type:i64}, {name:"b", type:i64}, {name:"c", type:i64}] };
      function bind(handle: LibraryHandle, name: string, parameters: ForeignType[],
        result: ForeignType, fixedParameters: number): ForeignFunction {
        const signature: ForeignSignature = { parameters, result, fixedParameters, callClass:"leaf", errno:"none" };
        return foreignFunction(findSymbol(handle, name), signature);
      }
      export function run(): number {
        const handle = openLibrary(${JSON.stringify(library)});
        ${bytes("mixed", mixed)}
        ${bytes("big", big)}
        const pair = bind(handle, "oracle_is", [mixedType], mixedType, 1);
        const large = bind(handle, "oracle_big", [bigType, i64], bigType, 2);
        const pairResult = new Uint8Array(16);
        const largeResult = new Uint8Array(24);
        const checkPair = bind(handle, "oracle_check_is", [pointer], i32, 1);
        const checkLarge = bind(handle, "oracle_check_big", [pointer], i32, 1);
        setRecord(pair, 0, mixed);
        setRecord(large, 0, big);
        setNumber(large, 1, 2);
        setBytes(checkPair, 0, pairResult);
        setBytes(checkLarge, 0, largeResult);
        const variadic = bind(handle, "oracle_variadic", [i32, char, f32, mixedType], f64, 1);
        setNumber(variadic, 0, 4);
        setNumber(variadic, 1, -7);
        setNumber(variadic, 2, 5.5);
        setRecord(variadic, 3, mixed);
        const count = bind(handle, "oracle_al", [i32, f64, mixedType, f32], i32, 1);
        setNumber(count, 0, 0);
        setNumber(count, 1, 1);
        setRecord(count, 2, mixed);
        setNumber(count, 3, 2);
        const buffer = new Uint8Array(4);
        buffer[1] = 20;
        const borrow = bind(handle, "oracle_borrow", [pointer, i64], i64, 2);
        setBytes(borrow, 0, buffer.subarray(1, 2));
        setNumber(borrow, 1, 11);
        collectGarbage();
        for (let call = 0; call < 2; call++) {
          invoke(pair); resultRecord(pair, pairResult);
          invoke(large); resultRecord(large, largeResult);
          invoke(checkPair); invoke(checkLarge);
          if (resultNumber(checkPair) !== 1 || resultNumber(checkLarge) !== 1) return 2;
          invoke(variadic); if (resultNumber(variadic) !== 42.5) return 3;
          invoke(count); if (resultNumber(count) !== 3) return 4;
          invoke(borrow);
          if (resultNumber(borrow) !== 31 + call * 11) return 5;
          collectGarbage();
        }
        closeLibrary(handle);
        return buffer[1] ?? 0;
      }`,
        "sysv-public-c-oracle",
        [
          ["tint:ffi/unsafe", "packages/native-runtime/src/ffi/unsafe.ts"],
          ["memory", memory],
        ],
        [],
        [],
        [],
        {
          requireTyped: true,
          runtimeEntry: "initializeGenerationalRuntime",
          managedBytes: 4194304,
          allocationCapacity: 65536,
        },
      ),
    );
  },
);

test(
  "SysV loads optional C functions lazily and reports absent symbols",
  { skip: !x64 },
  () => {
    verifyHostedFixture(
      `import { getpid, hasGetpid, hasMissing } from "tint:c/optional";
    import { hasAbsent } from "tint:c/absent";
    export function run(): number {
      return hasGetpid() && getpid() > 0 && !hasMissing() && !hasAbsent() ? 42 : 1;
    }`,
      "sysv-optional",
      [
        ["tint:c/optional", "optional-sysv.d.ts"],
        ["tint:c/absent", "absent-sysv.d.ts"],
      ],
      [],
      [],
      [],
      {
        requireTyped: true,
        runtimeEntry: "initializeGenerationalRuntime",
        managedBytes: 4194304,
        allocationCapacity: 65536,
        foreignDeclarations: [
          {
            id: "optional-sysv.d.ts",
            text: 'declare module "tint:c/optional" { import type { i32, Available } from "tint:ffi"; export function getpid(): i32; export function hasGetpid(): Available<"getpid">; export function tint_sysv_missing_symbol(): i32; export function hasMissing(): Available<"tint_sysv_missing_symbol">; }',
            manifest: [
              {
                module: "tint:c/optional",
                linux: {
                  name: "libc.so.6",
                  optional: true,
                  currentVersion: 0,
                  compatibilityVersion: 0,
                },
              },
            ],
          },
          {
            id: "absent-sysv.d.ts",
            text: 'declare module "tint:c/absent" { import type { i32, Available } from "tint:ffi"; export function absent(): i32; export function hasAbsent(): Available<"absent">; }',
            manifest: [
              {
                module: "tint:c/absent",
                linux: {
                  name: "libtint-sysv-absent-fixture.so",
                  optional: true,
                  currentVersion: 0,
                  compatibilityVersion: 0,
                },
              },
            ],
          },
        ],
      },
    );
  },
);

test(
  "SysV managed FFI storage preserves borrowed data across moving collection",
  { skip: !x64 },
  () => {
    verifyHostedFixture(
      `import { allocate, address, release, stableBytes } from "tint:ffi";
     import { bytesAt, cStringAt } from "tint:ffi/unsafe";
     import { collectGarbage } from "memory";
     export function run(): number {
       const storage = allocate(16);
       storage[0] = 65;
       storage[1] = 195;
       storage[2] = 169;
       const addressBefore = address(storage);
       const borrowed = bytesAt(addressBefore + 1, 2);
       collectGarbage();
       if (!stableBytes(storage) || !stableBytes(borrowed) || addressBefore !== address(storage) ||
           borrowed[0] !== 195 || borrowed[1] !== 169 || cStringAt(addressBefore) !== "Aé") return 1;
       release(storage);
       try { address(storage); } catch (caught) {
         if (caught instanceof TypeError) return 42;
       }
       return 2;
     }`,
      "sysv-managed-storage",
      [
        ["tint:ffi", "packages/native-runtime/src/ffi/index.ts"],
        ["tint:ffi/unsafe", "packages/native-runtime/src/ffi/unsafe.ts"],
        ["memory", "packages/native-runtime/src/intrinsics/memory.ts"],
      ],
      [],
      [],
      [],
      {
        requireTyped: true,
        runtimeEntry: "initializeGenerationalRuntime",
        managedBytes: 4194304,
        allocationCapacity: 65536,
      },
    );
  },
);

test(
  "SysV dynamic callbacks sort foreign storage, collect and rethrow",
  { skip: !x64 },
  () => {
    verifyHostedFixture(
      `import { allocate, release } from "tint:ffi";
     import { bytesAt, findSymbol, foreignFunction, invoke, openProgram,
       setBytes, setCallback, setNumber, type ForeignSignature } from "tint:ffi/unsafe";
     import { collectGarbage } from "memory";
     export function run(): number {
       const signature: ForeignSignature = {
         parameters: [{ kind: "pointer", pointee: { kind: "void" } }, { kind: "scalar", scalar: "usize" },
           { kind: "scalar", scalar: "usize" }, { kind: "pointer", pointee: { kind: "void" } }],
         result: { kind: "void" }, fixedParameters: 4, callClass: "may-callback", errno: "none",
       };
       const comparison: ForeignSignature = {
         parameters: [{ kind: "pointer", pointee: { kind: "void" } }, { kind: "pointer", pointee: { kind: "void" } }], result: { kind: "scalar", scalar: "i32" },
         fixedParameters: 2, callClass: "leaf", errno: "none",
       };
       const qsort = foreignFunction(findSymbol(openProgram(), "qsort"), signature);
       const data = allocate(8);
       data[0] = 23; data[4] = 19;
       setBytes(qsort, 0, data); setNumber(qsort, 1, 2); setNumber(qsort, 2, 4);
       let called = false;
       setCallback(qsort, 3, comparison, (args: number[]): number => {
         called = true;
         collectGarbage();
         return (bytesAt(args[0] ?? 0, 4)[0] ?? 0) - (bytesAt(args[1] ?? 0, 4)[0] ?? 0);
       });
       invoke(qsort);
       if (!called || data[0] !== 19 || data[4] !== 23) return 1;
       setCallback(qsort, 3, comparison, (_args: number[]): number => { throw new RangeError("callback"); });
       try { invoke(qsort); } catch (error) {
         release(data);
         if (error instanceof RangeError && error.message === "callback") return 42;
       }
       return 2;
     }`,
      "sysv-dynamic-callbacks",
      [
        ["tint:ffi", "packages/native-runtime/src/ffi/index.ts"],
        ["tint:ffi/unsafe", "packages/native-runtime/src/ffi/unsafe.ts"],
        ["memory", "packages/native-runtime/src/intrinsics/memory.ts"],
      ],
      [],
      [],
      [],
      {
        requireTyped: true,
        runtimeEntry: "initializeGenerationalRuntime",
        managedBytes: 4194304,
        allocationCapacity: 65536,
      },
    );
  },
);
