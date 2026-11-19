import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { cLayout } from "@tint/abi/c";
import { linuxX86_64CTarget } from "@tint/abi/c/sysv";
import { parseForeignDeclarations } from "@tint/compiler/native";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const x64 = process.env.TINT_NATIVE_TARGET === "linux-x86_64";

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
  "SysV foreignFunction invokes a dynamic scalar binding",
  {
    skip: !x64,
    todo: "the shared dynamic runtime requires slice 7 managed emission",
  },
  () => {
    process.env.TINT_GENERAL_FALLBACK = "0";
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

function withOracle(check: (library: string) => void): void {
  // The worktree is visible on dev and QEMU receives the absolute DSO path
  // through DT_NEEDED. No modifications to the pinned sysroot are needed.
  const parent = resolve(".tint-bootstrap", "x64-ffi-sysv");
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, "oracle-"));
  try {
    const library = join(directory, "oracle.so");
    const sysroot = join(homedir(), ".t3", "tint-x64-sysroot");
    const built = spawnSync(
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
        "tools/fixtures/x64-ffi-oracle.c",
      ],
      { encoding: "utf8", timeout: 12000 },
    );
    assert.equal(built.status, 0, built.error?.message ?? built.stderr);
    check(library);
  } finally {
    if (process.env.TINT_BUILD_ONLY !== "1")
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
  "SysV rejects a may-callback declaration explicitly",
  { skip: !x64 },
  () => {
    assert.throws(
      () =>
        verifyHostedFixture(
          `import { getpid } from "tint:c/libsystem";
      export function run(): number { return getpid(); }`,
          "sysv-callback-rejected",
          [["tint:c/libsystem", "sysv-callback.d.ts"]],
          [],
          [],
          [],
          {
            managedBytes: 4194304,
            allocationCapacity: 65536,
            requireTyped: true,
            foreignDeclarations: [
              {
                id: "sysv-callback.d.ts",
                text: `declare module "tint:c/libsystem" {
            import type { i32, MayCallback } from "tint:ffi";
            export function getpid(): MayCallback<i32>;
          }`,
              },
            ],
          },
        ),
      /C callbacks are not supported on linux-x86_64/,
    );
  },
);
