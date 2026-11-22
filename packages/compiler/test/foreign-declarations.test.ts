import { buildNativeFixture } from "../../../tools/gate/native-fixture.ts";
import { runDarwinFixture } from "../../../tools/native-admission.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cLayout,
  cLibraryDescriptor,
  darwinArm64CTarget,
  linuxArm64CTarget,
  type CLibraryDeclaration,
  type CTarget,
} from "@tint/abi/c";
import { createSourceText, createSourceTextView } from "@tint/source/text";
import { dynamicCallFrame } from "@tint/ir/scalar";
import { parseModule, rewriteModule } from "@tint/typescript/syntax";
import { loadSourceGraph } from "@tint/typescript/modules";
import { linuxX86_64CTarget } from "@tint/abi/c/sysv";
import {
  parseForeignDeclarations,
  prepareForeignLibrary,
  foreignDeclarationInput,
  expandForeignInputs,
  foreignViews,
  foreignViewRegistry,
  foreignRuntimeBindings,
  foreignRuntimeModules,
} from "../src/native/foreign/index.ts";

import {
  addFixedFfiPlans,
  fixedFfiCallArities,
  makeStaticFfiModule,
  recognizeStaticFfi,
} from "../src/native/foreign/static-ffi.ts";

const root = new URL("../../native-runtime/src/c/", import.meta.url);
const commonCrypto = readFileSync(new URL("commoncrypto.d.ts", root), "utf8");
const libSystem = readFileSync(new URL("libsystem.d.ts", root), "utf8");

test("the application resolver grants native Node FFI only on supported targets", () => {
  const entry = "application/main.ts";
  const ffi = "packages/native-runtime/src/node/ffi.ts";
  const buffer = "packages/native-runtime/src/node/buffer.ts";
  const encoder = new TextEncoder();
  const inputs = [
    {
      id: entry,
      packageId: "application",
      bytes: encoder.encode(
        'import { dlopen } from "node:ffi"; import { Buffer } from "node:buffer";',
      ),
    },
    {
      id: ffi,
      packageId: "native-runtime",
      bytes: encoder.encode("export const dlopen = 1;"),
    },
    {
      id: buffer,
      packageId: "native-runtime",
      bytes: encoder.encode("export const Buffer = 1;"),
    },
  ];
  for (const target of [
    darwinArm64CTarget,
    linuxArm64CTarget,
    linuxX86_64CTarget,
  ]) {
    const expanded = expandForeignInputs(inputs, target);
    assert.ok(expanded.ok);
    const loaded = loadSourceGraph(
      expanded.value.inputs,
      expanded.value.mappings,
      [entry],
    );
    assert.ok(loaded.ok, JSON.stringify(loaded));
    assert.deepEqual(
      loaded.value.find((module) => module.id === entry)?.dependencies,
      new Map([
        ["node:ffi", ffi],
        ["node:buffer", buffer],
      ]),
    );
  }
  const unsupported = expandForeignInputs(inputs, {
    ...linuxArm64CTarget,
    name: "other",
  });
  assert.ok(unsupported.ok);
  const rejected = loadSourceGraph(
    unsupported.value.inputs,
    unsupported.value.mappings,
    [entry],
  );
  assert.equal(rejected.ok, false);
});

function parsed(
  text: string,
  target: CTarget = darwinArm64CTarget,
): CLibraryDeclaration {
  const result = parseForeignDeclarations(text, target);
  if (!result.ok) assert.fail(JSON.stringify(result.error));
  return result.value;
}
function rejected(
  text: string,
  message: RegExp,
  target: CTarget = darwinArm64CTarget,
): void {
  const result = parseForeignDeclarations(text, target);
  assert.equal(result.ok, false, text);
  if (!result.ok) assert.match(result.error.message, message);
}
function module(body: string, imports = "i32, u8, u32, f32, f64, Ptr"): string {
  return `declare module "tint:c/libsystem" {\n  import type { ${imports} } from "tint:ffi";\n${body}\n}\n`;
}

test("binding declarations read interfaces as C records and functions as prototypes", () => {
  const library = parsed(commonCrypto);
  assert.equal(library.module, "tint:c/commoncrypto");
  assert.deepEqual(library.layouts, ["CC_SHA256_CTX"]);
  assert.deepEqual(
    library.functions.map((fn) => [
      fn.name,
      fn.symbol,
      fn.parameterForms,
      fn.resultForm,
      fn.signature.callClass,
    ]),
    [
      ["CC_SHA256_Init", "CC_SHA256_Init", ["bytes"], "number", "leaf"],
      [
        "CC_SHA256_Update",
        "CC_SHA256_Update",
        ["bytes", "bytes", "number"],
        "number",
        "leaf",
      ],
      [
        "CC_SHA256_Final",
        "CC_SHA256_Final",
        ["bytes", "bytes"],
        "number",
        "leaf",
      ],
    ],
  );
  const update = library.functions[1]!;
  assert.deepEqual(update.signature.parameters[2], {
    kind: "scalar",
    scalar: "u32",
  });
  const system = parsed(libSystem);
  const close = system.functions.find((fn) => fn.name === "close")!;
  assert.equal(close.signature.errno, "negated-result");
  const unlink = system.functions.find((fn) => fn.name === "unlink")!;
  assert.deepEqual(unlink.parameterForms, ["terminated-bytes"]);
});

test("record markers, variants, variadics and by-value records parse into the model", () => {
  const library = parsed(
    module(
      `  type pid = i32;
  export interface P extends Packed { a: u8; b: u32 }
  export interface U extends Union { f: f32; i: i32 }
  export interface A extends Aligned<16> { x: f64 }
  export interface Pair { quot: i32; rem: i32 }
  export function div(n: i32, d: i32): Pair;
  export function snprintf$two(buf: Ptr<u8>, size: u32, format: CString, a: Variadic<i32>, b: Variadic<f64>): i32;
  export function kill$self(pid: pid, signal: i32): i32;`,
      "i32, u8, u32, f32, f64, Ptr, Packed, Union, Aligned, CString, Variadic",
    ),
  );
  const [packed, union, aligned] = library.records;
  assert.deepEqual(
    [packed, union, aligned].map((record) =>
      record?.type.kind === "record"
        ? [record.type.packed, record.type.union, record.type.alignment]
        : undefined,
    ),
    [
      [true, false, 0],
      [false, true, 0],
      [false, false, 16],
    ],
  );
  const [div, snprintf, kill] = library.functions;
  assert.equal(div?.resultForm, "record");
  assert.equal(snprintf?.symbol, "snprintf");
  assert.equal(snprintf?.signature.fixedParameters, 3);
  assert.deepEqual(snprintf?.parameterForms, [
    "bytes",
    "number",
    "string",
    "number",
    "number",
  ]);
  assert.equal(kill?.symbol, "kill");
  assert.deepEqual(kill?.signature.parameters[0], {
    kind: "scalar",
    scalar: "i32",
  });
});

test("unsupported C shapes and malformed declarations fail explicitly", () => {
  rejected(`declare module "zlib" {}`, /tint:c\//);
  rejected(module(`  export function f(...rest: i32): i32;`), /Variadic/);
  rejected(module(`  export function f(a?: i32): i32;`), /optional/);
  rejected(module(`  export function f(): Ptr<u8>;`), /use Address<T>/);
  rejected(module(`  export function f(a: i64): i32;`), /must be imported/);
  rejected(module(`  export function f(a: Missing): i32;`), /unknown C type/);
  rejected(module(`  export interface R { r: R }`), /contains itself/);
  rejected(module(`  export interface R { p: Ptr<u8> }`), /use Address<T>/);
  rejected(module(`  export function f(a: i32 | u32): i32;`), /named C types/);
  rejected(module(`  export function f(): i32 { }`), /no body/);
  rejected(module(`  export let x: i32;`), /expected an import/);
  rejected(module(`  import type { Nope } from "tint:ffi";`), /no type Nope/);
  rejected(
    module(
      `  export function f(a: Variadic<i32>, b: i32): i32;`,
      "i32, Variadic",
    ),
    /variadic too/,
  );
  rejected(
    module(`  export function f(): i32;\n  export function f(): i32;`),
    /duplicate/,
  );
  rejected(
    module(`  export function f(): OrErrno<u32>;`, "u32, OrErrno"),
    /OrErrno needs/,
  );
  // May-callback calls are bound; async calls are not yet.
  assert.ok(
    prepareForeignLibrary(
      "x.d.ts",
      module(`  export function f(): MayCallback<i32>;`, "i32, MayCallback"),
      darwinArm64CTarget,
    ).ok,
  );
  const asynchronous = prepareForeignLibrary(
    "x.d.ts",
    module(`  export function f(): Async<i32>;`, "i32, Async"),
    darwinArm64CTarget,
  );
  assert.equal(asynchronous.ok, false);
  if (!asynchronous.ok) assert.match(asynchronous.error, /is a async call/);
  const other = prepareForeignLibrary(
    "x.d.ts",
    `declare module "tint:c/libunknown" {}`,
    darwinArm64CTarget,
  );
  assert.equal(other.ok, false);
  if (!other.ok) assert.match(other.error, /not in the C library manifest/);
});

test("ByTarget declarations and header constants resolve for the build target", () => {
  const text = module(
    `  type mode_t = ByTarget<{ "darwin-arm64": u16; "linux-arm64": u32 }>;
  export const PROT_WRITE: 2;
  export const MAP_ANONYMOUS: ByTarget<{ "darwin-arm64": 0x1000, "linux-arm64": 0x20 }>;
  export function fchmod(fd: i32, mode: mode_t): i32;
  export function wrapped(p: Ptr<ByTarget<{ "darwin-arm64": u8; "linux-arm64": u16 }>>): i32;`,
    "ByTarget, i32, u8, u16, u32, Ptr",
  );
  const darwin = parsed(text, darwinArm64CTarget),
    linux = parsed(text, linuxArm64CTarget);
  assert.deepEqual(darwin.constants, [
    { name: "PROT_WRITE", value: 2 },
    { name: "MAP_ANONYMOUS", value: 4096 },
  ]);
  assert.deepEqual(linux.constants, [
    { name: "PROT_WRITE", value: 2 },
    { name: "MAP_ANONYMOUS", value: 32 },
  ]);
  const mode = (library: CLibraryDeclaration) =>
    library.functions[0]!.signature.parameters[1];
  assert.deepEqual(mode(darwin), { kind: "scalar", scalar: "u16" });
  assert.deepEqual(mode(linux), { kind: "scalar", scalar: "u32" });
  // `>>` closes a choice nested in another argument list.
  const pointee = (library: CLibraryDeclaration) =>
    library.functions[1]!.signature.parameters[0];
  assert.deepEqual(pointee(darwin), {
    kind: "pointer",
    pointee: { kind: "scalar", scalar: "u8" },
  });
  assert.deepEqual(pointee(linux), {
    kind: "pointer",
    pointee: { kind: "scalar", scalar: "u16" },
  });
  // The generated module exports each constant with its target's value.
  for (const [target, value] of [
    [darwinArm64CTarget, 4096],
    [linuxArm64CTarget, 32],
  ] as const) {
    const prepared = prepareForeignLibrary("c.d.ts", text, target);
    if (!prepared.ok) assert.fail(prepared.error);
    assert.match(
      prepared.value.text,
      new RegExp("export const MAP_ANONYMOUS = " + value + ";"),
    );
    assert.match(prepared.value.text, /export const PROT_WRITE = 2;/);
  }
  // Every target needs a choice, a target is needed to choose, and the
  // marker must be imported.
  rejected(
    module(
      `  export const X: ByTarget<{ "darwin-arm64": 1 }>;`,
      "ByTarget, i32",
    ),
    /no choice for linux-arm64/,
    linuxArm64CTarget,
  );
  const untargeted = parseForeignDeclarations(
    module(`  export const X: ByTarget<{ "darwin-arm64": 1 }>;`, "ByTarget"),
  );
  assert.equal(untargeted.ok, false);
  if (!untargeted.ok)
    assert.match(untargeted.error.message, /read for a target/);
  rejected(
    module(`  export const X: ByTarget<{ "darwin-arm64": 1 }>;`),
    /ByTarget must be imported/,
  );
  rejected(
    module(
      `  export const X: ByTarget<{ "darwin-arm64": 1; "darwin-arm64": 2 }>;`,
      "ByTarget",
    ),
    /duplicate ByTarget choice/,
  );
  rejected(
    module(`  export const X: ByTarget<{ darwin: 1 }>;`, "ByTarget"),
    /target names/,
  );
  rejected(module(`  export const X: 1.5;`), /integers/);
  rejected(module(`  export const X: i32;`), /integer literals or Layout/);
  rejected(
    module(`  export const f: 1;\n  export function f(): i32;`),
    /duplicate declaration f/,
  );
});

test("expansion generates an ordinary TypeScript module with layout constants and bound stubs", () => {
  const prepared = prepareForeignLibrary(
    "packages/native-runtime/src/c/commoncrypto.d.ts",
    commonCrypto,
    darwinArm64CTarget,
  );
  if (!prepared.ok) assert.fail(prepared.error);
  const text = prepared.value.text;
  assert.match(
    text,
    /export const CC_SHA256_CTX = \{ size: 104, alignment: 4, offsets: \{ count: 0, hash: 8, wbuf: 40 \} \};/,
  );
  assert.deepEqual(
    prepared.value.library.stubs.map((stub) => [
      stub.name,
      stub.call?.symbol,
      stub.call?.operands,
      stub.call?.result,
    ]),
    [
      ["CC_SHA256_Init", "CC_SHA256_Init", ["bytes"], "number"],
      [
        "CC_SHA256_Update",
        "CC_SHA256_Update",
        ["bytes", "bytes", "number"],
        "number",
      ],
      ["CC_SHA256_Final", "CC_SHA256_Final", ["bytes", "bytes"], "number"],
    ],
  );
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  assert.ok(parseModule(source.value).ok);
  const wrapped = prepareForeignLibrary(
    "w.d.ts",
    module(
      `  export interface Pair { quot: i32; rem: i32 }
  export function div(n: i32, d: i32): Pair;
  export function puts(s: CString): i32;`,
      "i32, CString",
    ),
    darwinArm64CTarget,
  );
  if (!wrapped.ok) assert.fail(wrapped.error);
  assert.deepEqual(
    wrapped.value.library.stubs.map((stub) => [
      stub.name,
      stub.call?.operands,
      stub.call?.result,
    ]),
    [
      ["div$c", ["number", "number"], "record"],
      ["puts$c", ["terminated-bytes"], "number"],
    ],
  );
  assert.match(
    wrapped.value.text,
    /export function div\(n: number, d: number\): Pair \{/,
  );
  assert.match(wrapped.value.text, /return puts\$c\(cString\$\(s\)\);/);
});

test("the same declarations yield node:ffi definitions and layout descriptors", () => {
  const descriptor = cLibraryDescriptor(
    parsed(commonCrypto),
    darwinArm64CTarget,
  );
  if (!descriptor.ok) assert.fail(descriptor.error);
  assert.deepEqual(descriptor.value.definitions, [
    {
      name: "CC_SHA256_Init",
      symbol: "CC_SHA256_Init",
      arguments: ["buffer"],
      result: "int32",
    },
    {
      name: "CC_SHA256_Update",
      symbol: "CC_SHA256_Update",
      arguments: ["buffer", "buffer", "uint32"],
      result: "int32",
    },
    {
      name: "CC_SHA256_Final",
      symbol: "CC_SHA256_Final",
      arguments: ["buffer", "buffer"],
      result: "int32",
    },
  ]);
  assert.equal(descriptor.value.layouts[0]?.size, 104);
  const system = cLibraryDescriptor(parsed(libSystem), darwinArm64CTarget);
  if (!system.ok) assert.fail(system.error);
  assert.deepEqual(system.value.unsupported, [
    "close: node:ffi has no errno capture",
    "unlink: node:ffi has no errno capture",
    "fchmod: node:ffi has no errno capture",
    "rename: node:ffi has no errno capture",
  ]);
});

/** node:ffi arrived in Node 26; the workspace's pinned Node 24 skips. */
let nodeFfi: any;
try {
  nodeFfi = createRequire(import.meta.url)("node:ffi");
} catch {
  nodeFfi = undefined;
}
test(
  "the generated node:ffi definitions call CommonCrypto under Node",
  {
    skip:
      nodeFfi === undefined
        ? "node:ffi is unavailable in this Node (" + process.version + ")"
        : process.platform !== "darwin"
          ? "CommonCrypto is a Darwin library"
          : false,
  },
  () => {
    const descriptor = cLibraryDescriptor(
      parsed(commonCrypto),
      darwinArm64CTarget,
    );
    if (!descriptor.ok) assert.fail(descriptor.error);
    const definitions: Record<string, { arguments: string[]; return: string }> =
      {};
    for (const definition of descriptor.value.definitions)
      definitions[definition.symbol] = {
        arguments: [...definition.arguments],
        return: definition.result,
      };
    const { lib, functions } = nodeFfi.dlopen(null, definitions);
    try {
      const context = new Uint8Array(descriptor.value.layouts[0]!.size),
        digest = new Uint8Array(32),
        message = new TextEncoder().encode("abc");
      functions.CC_SHA256_Init(context);
      functions.CC_SHA256_Update(context, message, message.length);
      functions.CC_SHA256_Final(digest, context);
      assert.equal(
        Buffer.from(digest).toString("hex"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
    } finally {
      lib.close();
    }
  },
);

test("only .d.ts modules declaring tint:c/ bindings are expanded", () => {
  assert.equal(
    foreignDeclarationInput("a.d.ts", "// x\n/* y */\n" + libSystem),
    true,
  );
  assert.equal(
    foreignDeclarationInput("ffi.d.ts", 'declare module "tint:ffi" {}'),
    false,
  );
  assert.equal(foreignDeclarationInput("a.ts", libSystem), false);
  const encoder = new TextEncoder();
  const expanded = expandForeignInputs(
    [
      {
        id: "p/src/c/libsystem.d.ts",
        packageId: "p",
        bytes: encoder.encode(libSystem),
      },
      { id: "p/src/x.ts", packageId: "p", bytes: encoder.encode("export {};") },
    ],
    darwinArm64CTarget,
  );
  if (!expanded.ok) assert.fail(expanded.error);
  assert.deepEqual(expanded.value.mappings, [
    {
      packageId: "p",
      specifier: "tint:c/libsystem",
      target: "p/src/c/libsystem.d.ts",
    },
  ]);
  assert.equal(expanded.value.libraries.length, 1);
  assert.match(
    new TextDecoder().decode(expanded.value.inputs[0]!.bytes),
    /export function close\(fd: number\): number/,
  );
});

const clang = spawnSync("clang", ["--version"], { encoding: "utf8" });
test(
  "the CC_SHA256_CTX declaration matches the system header's layout (clang oracle)",
  {
    skip:
      process.platform !== "darwin"
        ? "CommonCrypto is a Darwin library"
        : clang.status !== 0
          ? "clang is not installed (test-only layout oracle)"
          : false,
  },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "tint-commoncrypto-layout-"));
    try {
      const source = join(directory, "layout.c"),
        binary = join(directory, "layout");
      writeFileSync(
        source,
        `#include <stdio.h>
#include <stddef.h>
#include <CommonCrypto/CommonDigest.h>
int main(void) {
  printf("%zu %zu %zu %zu %zu", sizeof(CC_SHA256_CTX), _Alignof(CC_SHA256_CTX),
    offsetof(CC_SHA256_CTX, count), offsetof(CC_SHA256_CTX, hash), offsetof(CC_SHA256_CTX, wbuf));
  return 0;
}
`,
      );
      buildNativeFixture(binary, () => {
        const compiled = spawnSync("clang", ["-o", binary, source], {
          encoding: "utf8",
        });
        assert.equal(compiled.status, 0, compiled.stderr);
        return binary;
      });
      const run = runDarwinFixture(binary, () =>
        spawnSync(binary, [], { encoding: "utf8" }),
      );
      assert.equal(run.status, 0, run.stderr);
      const record = parsed(commonCrypto).records[0]!;
      const layout = cLayout(record.type, darwinArm64CTarget);
      if (!layout.ok) assert.fail(layout.error);
      assert.equal(
        run.stdout,
        [
          layout.value.size,
          layout.value.alignment,
          ...layout.value.offsets,
        ].join(" "),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("raw addresses are numbers in results, members and arguments", () => {
  const library = parsed(
    module(
      `  export interface Node { next: Address<Node>; value: i32 }
  export function head(): Address<Node>;
  export function link(node: Address<Node>, view: Ptr<Node>): void;
  export function pass(node: Node): Node;`,
      "i32, Ptr, Address",
    ),
  );
  const [head, link, pass] = library.functions;
  assert.equal(head?.resultForm, "number");
  assert.deepEqual(head?.signature.result, {
    kind: "pointer",
    pointee: library.records[0]?.type,
  });
  // A self-referential member points to opaque memory.
  const node = library.records[0]?.type;
  assert.deepEqual(node?.kind === "record" ? node.fields[0]?.type : undefined, {
    kind: "pointer",
    pointee: { kind: "void" },
  });
  assert.deepEqual(link?.parameterForms, ["number", "bytes"]);
  // By-value records may carry addresses (as numbers in the object).
  assert.deepEqual(pass?.parameterForms, ["record"]);
  const prepared = prepareForeignLibrary(
    "a.d.ts",
    module(
      `  export interface Pair { p: Address<u8>; n: i32 }
  export function swap(pair: Pair): Pair;`,
      "i32, u8, Address",
    ),
    darwinArm64CTarget,
  );
  if (!prepared.ok) assert.fail(prepared.error);
  assert.match(prepared.value.text, /export interface Pair \{\n  p: number;/);
  assert.match(
    prepared.value.text,
    /writeInteger\$\(bytes, offset \+ 0, 8, value\.p, 0, 9007199254740991\);/,
  );
});

test("view shapes and layout descriptors come from one layout computation", () => {
  const text = module(
    `  export interface Inner { x: i32; flag: bool }
  export interface S { a: u8; b: u32; c: Address<u8>; d: f64; inner: Inner; words: FixedArray<u16, 3>; grid: FixedArray<FixedArray<i8, 2>, 2> }
  export const S: Layout<S>;`,
    "u8, u16, i8, i32, u32, f64, bool, Address, Layout, FixedArray",
  );
  const library = parsed(text);
  const views = foreignViews(library, darwinArm64CTarget);
  if (!views.ok) assert.fail(views.error);
  const byKey = new Map(views.value.map((view) => [view.key, view]));
  const s = byKey.get("tint:c/libsystem#S");
  assert.equal(s?.record, "S");
  assert.equal(s?.shape.size, 48);
  assert.deepEqual(
    s?.shape.members.map((member) => [
      member.name,
      member.offset,
      member.size,
      member.value,
      member.scalar,
      member.view,
    ]),
    [
      ["a", 0, 1, "number", "u8", ""],
      ["b", 4, 4, "number", "u32", ""],
      ["c", 8, 8, "number", "pointer", ""],
      ["d", 16, 8, "number", "f64", ""],
      ["inner", 24, 8, "view", "", "tint:c/libsystem#Inner"],
      ["words", 32, 6, "view", "", "tint:c/libsystem#S.words"],
      ["grid", 38, 4, "view", "", "tint:c/libsystem#S.grid"],
    ],
  );
  const words = byKey.get("tint:c/libsystem#S.words")?.shape;
  assert.equal(words?.length, 3);
  assert.deepEqual([words?.element?.size, words?.element?.scalar], [2, "u16"]);
  const grid = byKey.get("tint:c/libsystem#S.grid")?.shape;
  assert.equal(grid?.element?.view, "tint:c/libsystem#S.grid[]");
  const row = byKey.get("tint:c/libsystem#S.grid[]")?.shape;
  assert.deepEqual([row?.length, row?.element?.scalar], [2, "i8"]);
  assert.equal(
    byKey.get("tint:c/libsystem#Inner")?.shape.members[1]?.value,
    "boolean",
  );
  // The runtime descriptor of the same interface agrees with the view.
  const descriptor = cLibraryDescriptor(library, darwinArm64CTarget);
  if (!descriptor.ok) assert.fail(descriptor.error);
  const layout = descriptor.value.layouts.find((item) => item.name === "S");
  assert.equal(layout?.size, s?.shape.size);
  assert.deepEqual(
    layout?.fields.map((field) => [field.name, field.offset, field.size]),
    s?.shape.members.map((member) => [member.name, member.offset, member.size]),
  );
  // The generated module keeps the record interface and Layout constant.
  const prepared = prepareForeignLibrary("s.d.ts", text, darwinArm64CTarget);
  if (!prepared.ok) assert.fail(prepared.error);
  assert.equal(prepared.value.library.views.length, views.value.length);
  assert.match(prepared.value.text, /export const S = \{ size: 48,/);
  // Field accessors are gone: properties replace them.
  rejected(
    module(
      `  export interface S { a: u8 }\n  export function S$a(s: Ptr<S>): Field<S, "a">;`,
      "u8, Ptr, Field",
    ),
    /tint:ffi has no type Field/,
  );
});

test("the view registry maps linked names, with or without tint:ffi", () => {
  const text = module(
    `  export interface P { x: i32 }\n  export const P: Layout<P>;`,
    "i32, Layout",
  );
  const prepared = prepareForeignLibrary("p.d.ts", text, darwinArm64CTarget);
  if (!prepared.ok) assert.fail(prepared.error);
  const exports = [
    { module: "p.d.ts", namespace: "type", name: "P", linkedName: "@1:type:P" },
    {
      module: "p.d.ts",
      namespace: "value",
      name: "P",
      linkedName: "@1:value:3",
    },
  ];
  // R.view(bytes) works in a program that never names View<R>.
  const bare = foreignViewRegistry([prepared.value.library], exports);
  assert.equal(bare?.viewType, "");
  assert.equal(bare?.layouts.get("@1:value:3"), "tint:c/libsystem#P");
  assert.equal(bare?.records.get("@1:type:P"), "tint:c/libsystem#P");
  const withFfi = foreignViewRegistry(
    [prepared.value.library],
    [
      ...exports,
      {
        module: "packages/native-runtime/src/ffi/index.ts",
        namespace: "type",
        name: "View",
        linkedName: "@2:type:View",
      },
    ],
  );
  assert.equal(withFfi?.viewType, "@2:type:View");
  assert.equal(withFfi?.foreign.size, 0);
  // tint:ffi/unsafe's record views at addresses, when the program loads it.
  const unsafe = foreignViewRegistry(
    [prepared.value.library],
    [
      ...exports,
      ...["viewAt", "arrayAt", "bytesAt"].map((name) => ({
        module: "packages/native-runtime/src/ffi/unsafe.ts",
        namespace: "value",
        name,
        linkedName: "@3:value:" + name,
      })),
    ],
  );
  assert.deepEqual(
    [...(unsafe?.foreign ?? [])],
    [
      ["@3:value:viewAt", "view"],
      ["@3:value:arrayAt", "array"],
    ],
  );
  assert.equal(foreignViewRegistry([], exports), undefined);
});

test("availability queries name a declared function's symbol", () => {
  const text = module(
    `  export function inflateBack$fast(s: Ptr<u8>): i32;
  export function inflateBack(s: Ptr<u8>): i32;
  export function hasInflateBack(): Available<"inflateBack$fast">;`,
    "i32, u8, Ptr, Available",
  );
  const library = parsed(text);
  assert.deepEqual(library.availability, [
    { name: "hasInflateBack", symbol: "inflateBack" },
  ]);
  assert.deepEqual(
    library.functions.map((fn) => fn.name),
    ["inflateBack$fast", "inflateBack"],
  );
  const prepared = prepareForeignLibrary("a.d.ts", text, darwinArm64CTarget);
  if (!prepared.ok) assert.fail(prepared.error);
  const stub = prepared.value.library.stubs.find(
    (item) => item.name === "hasInflateBack",
  );
  assert.deepEqual(stub?.memory, {
    operation: "available",
    type: { kind: "void" },
    offset: 0,
    minimum: 0,
    symbol: "inflateBack",
  });
  assert.match(
    prepared.value.text,
    /export function hasInflateBack\(\): boolean \{/,
  );
  const query = (body: string) =>
    module(
      `  export function f(): i32;\n  export interface S { a: i32 }\n${body}`,
      "i32, Ptr, Available",
    );
  rejected(query(`  export function q(): Available<"g">;`), /undeclared/);
  rejected(query(`  export function q(): Available<f>;`), /function name/);
  rejected(
    query(`  export function q(x: i32): Available<"f">;`),
    /no parameters/,
  );
  rejected(
    query(
      `  export function q(): Available<"f">;\n  export function r(): Available<"q">;`,
    ),
    /C function declaration/,
  );
  rejected(query(`  export function q(x: Available<"f">): i32;`), /only query/);
  rejected(
    module(
      `  export function f(): i32;\n  export function q(): Available<"f">;`,
      "i32",
    ),
    /must be imported/,
  );
});

test("the library manifest maps binding modules to each target's images", () => {
  const zlib = prepareForeignLibrary(
    "z.d.ts",
    `declare module "tint:c/zlib" {}`,
    darwinArm64CTarget,
  );
  if (!zlib.ok) assert.fail(zlib.error);
  assert.equal(zlib.value.library.image.name, "/usr/lib/libz.1.dylib");
  assert.equal(zlib.value.library.image.optional, false);
  const memory = prepareForeignLibrary(
    "m.d.ts",
    `declare module "tint:c/memory" {}`,
    darwinArm64CTarget,
  );
  if (!memory.ok) assert.fail(memory.error);
  assert.equal(memory.value.library.image.name, "/usr/lib/libSystem.B.dylib");
  // A build may add entries (an optional library here).
  const extra = prepareForeignLibrary(
    "x.d.ts",
    `declare module "tint:c/extra" {}`,
    darwinArm64CTarget,
    [
      {
        module: "tint:c/extra",
        darwin: {
          name: "/usr/lib/libextra.dylib",
          optional: true,
          currentVersion: 0x10000,
          compatibilityVersion: 0x10000,
        },
      },
    ],
  );
  if (!extra.ok) assert.fail(extra.error);
  assert.equal(extra.value.library.image.optional, true);
  assert.equal(
    prepareForeignLibrary(
      "x.d.ts",
      `declare module "tint:c/commoncrypto" {}`,
      linuxArm64CTarget,
    ).ok,
    false,
  );
});

test(
  "the z_stream declaration matches the system zlib header's layout (clang oracle)",
  {
    skip:
      process.arch !== "arm64" ||
      (process.platform !== "darwin" && process.platform !== "linux")
        ? "the layout oracle runs on darwin-arm64 and linux-arm64 hosts"
        : clang.status !== 0
          ? "clang is not installed (test-only layout oracle)"
          : false,
  },
  () => {
    const target =
      process.platform === "linux" ? linuxArm64CTarget : darwinArm64CTarget;
    const zlib = readFileSync(new URL("zlib.d.ts", root), "utf8");
    const record = parsed(zlib, target).records.find(
      (item) => item.name === "z_stream",
    );
    assert.ok(record !== undefined && record.type.kind === "record");
    const fields = record.type.fields.map((field) => field.name);
    const directory = mkdtempSync(join(tmpdir(), "tint-zlib-layout-"));
    try {
      const source = join(directory, "layout.c"),
        binary = join(directory, "layout");
      writeFileSync(
        source,
        `#include <stdio.h>
#include <stddef.h>
#include <zlib.h>
int main(void) {
  printf("%zu %zu", sizeof(z_stream), _Alignof(z_stream));
${fields.map((name) => `  printf(" %zu", offsetof(z_stream, ${name}));`).join("\n")}
  return 0;
}
`,
      );
      buildNativeFixture(binary, () => {
        const compiled = spawnSync("clang", ["-o", binary, source], {
          encoding: "utf8",
        });
        assert.equal(compiled.status, 0, compiled.stderr);
        return binary;
      });
      const run = runDarwinFixture(binary, () =>
        spawnSync(binary, [], { encoding: "utf8" }),
      );
      assert.equal(run.status, 0, run.stderr);
      const layout = cLayout(record.type, target);
      if (!layout.ok) assert.fail(layout.error);
      assert.equal(
        run.stdout,
        [
          layout.value.size,
          layout.value.alignment,
          ...layout.value.offsets,
        ].join(" "),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test(
  "the darwin-os records match the system headers' layouts (clang oracle)",
  {
    skip:
      process.platform !== "darwin"
        ? "the darwin-os binding describes Darwin's records"
        : clang.status !== 0
          ? "clang is not installed (test-only layout oracle)"
          : false,
  },
  () => {
    const darwinOs = parsed(
      readFileSync(new URL("darwin-os.d.ts", root), "utf8"),
    );
    const names = [
      "passwd",
      "sockaddr",
      "sockaddr_in",
      "sockaddr_in6",
      "sockaddr_dl",
      "ifaddrs",
    ];
    const lines: string[] = [],
      expected: string[] = [];
    for (const name of names) {
      const record = darwinOs.records.find((item) => item.name === name);
      assert.ok(record !== undefined && record.type.kind === "record", name);
      const layout = cLayout(record.type, darwinArm64CTarget);
      if (!layout.ok) assert.fail(layout.error);
      expected.push(
        [
          name,
          layout.value.size,
          layout.value.alignment,
          ...layout.value.offsets,
        ].join(" "),
      );
      lines.push(
        `  printf("${name} %zu %zu", sizeof(struct ${name}), _Alignof(struct ${name}));`,
        ...record.type.fields.map(
          (field) =>
            `  printf(" %zu", offsetof(struct ${name}, ${field.name}));`,
        ),
        '  printf("\\n");',
      );
    }
    const directory = mkdtempSync(join(tmpdir(), "tint-darwin-os-layout-"));
    try {
      const source = join(directory, "layout.c"),
        binary = join(directory, "layout");
      writeFileSync(
        source,
        `#include <stdio.h>
#include <stddef.h>
#include <pwd.h>
#include <ifaddrs.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <net/if_dl.h>
int main(void) {
${lines.join("\n")}
  return 0;
}
`,
      );
      buildNativeFixture(binary, () => {
        const compiled = spawnSync("clang", ["-o", binary, source], {
          encoding: "utf8",
        });
        assert.equal(compiled.status, 0, compiled.stderr);
        return binary;
      });
      const run = runDarwinFixture(binary, () =>
        spawnSync(binary, [], { encoding: "utf8" }),
      );
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout, expected.map((line) => line + "\n").join(""));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
test(
  "the linux-os records match glibc's headers' layouts (clang oracle)",
  {
    skip:
      process.platform !== "linux"
        ? "the linux-os binding describes glibc's records"
        : clang.status !== 0
          ? "clang is not installed (test-only layout oracle)"
          : false,
  },
  () => {
    const darwinOs = parsed(
      readFileSync(new URL("linux-os.d.ts", root), "utf8"),
    );
    const names = [
      "passwd",
      "sockaddr",
      "sockaddr_in",
      "sockaddr_in6",
      "sockaddr_ll",
      "ifaddrs",
    ];
    const lines: string[] = [],
      expected: string[] = [];
    for (const name of names) {
      const record = darwinOs.records.find((item) => item.name === name);
      assert.ok(record !== undefined && record.type.kind === "record", name);
      const layout = cLayout(record.type, linuxArm64CTarget);
      if (!layout.ok) assert.fail(layout.error);
      expected.push(
        [
          name,
          layout.value.size,
          layout.value.alignment,
          ...layout.value.offsets,
        ].join(" "),
      );
      lines.push(
        `  printf("${name} %zu %zu", sizeof(struct ${name}), _Alignof(struct ${name}));`,
        ...record.type.fields.map(
          (field) =>
            `  printf(" %zu", offsetof(struct ${name}, ${field.name}));`,
        ),
        '  printf("\\n");',
      );
    }
    const directory = mkdtempSync(join(tmpdir(), "tint-linux-os-layout-"));
    try {
      const source = join(directory, "layout.c"),
        binary = join(directory, "layout");
      writeFileSync(
        source,
        `#include <stdio.h>
#include <stddef.h>
#include <pwd.h>
#include <ifaddrs.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <linux/if_packet.h>
int main(void) {
${lines.join("\n")}
  return 0;
}
`,
      );
      buildNativeFixture(binary, () => {
        const compiled = spawnSync("clang", ["-o", binary, source], {
          encoding: "utf8",
        });
        assert.equal(compiled.status, 0, compiled.stderr);
        return binary;
      });
      const run = runDarwinFixture(binary, () =>
        spawnSync(binary, [], { encoding: "utf8" }),
      );
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout, expected.map((line) => line + "\n").join(""));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("the dl binding's DynamicFrame is the universal trampoline's frame", () => {
  const dl = parsed(readFileSync(new URL("dl.d.ts", root), "utf8"));
  const frame = dl.records.find((item) => item.name === "DynamicFrame");
  assert.ok(frame !== undefined && frame.type.kind === "record");
  for (const target of [darwinArm64CTarget, linuxArm64CTarget]) {
    const layout = cLayout(frame.type, target);
    if (!layout.ok) assert.fail(layout.error);
    const offset = (name: string): number => {
      const index =
        frame.type.kind === "record"
          ? frame.type.fields.findIndex((field) => field.name === name)
          : -1;
      return layout.value.offsets[index] ?? -1;
    };
    const f = dynamicCallFrame;
    assert.equal(layout.value.size, f.size);
    assert.deepEqual(
      [
        offset("x"),
        offset("d"),
        offset("x8"),
        offset("stackBytes"),
        offset("patchCount"),
        offset("bases"),
        offset("patchTargets"),
        offset("patchBases"),
        offset("patchAddends"),
        offset("stack"),
        offset("scratch"),
      ],
      [
        f.registers,
        f.floats,
        f.indirect,
        f.stackBytes,
        f.patchCount,
        f.bases,
        f.patches,
        f.patches + f.patchArray,
        f.patches + 2 * f.patchArray,
        f.stack,
        f.scratch,
      ],
    );
    // Bases: the frame, the byte operands, then the callback thunks.
    assert.equal(
      f.bases + 8 * (1 + f.byteOperands + f.callbackOperands),
      f.patches,
    );
    assert.equal(f.patchArray, 8 * f.patchCapacity);
    assert.equal(f.stack + f.stackCapacity, f.scratch);
    assert.equal(f.scratch + f.scratchCapacity, f.size);
  }
});

test("optional libraries load lazily on linux-arm64 and weakly on darwin-arm64", () => {
  const text = `declare module "tint:c/optional-q" {
  import type { i32, u8, Ptr, Available } from "tint:ffi";
  export function q_sum(bytes: Ptr<u8>, count: i32): i32;
  export function q_sum$twice(bytes: Ptr<u8>, count: i32): i32;
  export function hasSum(): Available<"q_sum">;
}
`;
  const optional = (name: string) => ({
    name,
    optional: true,
    currentVersion: 0,
    compatibilityVersion: 0,
  });
  const manifest = [
    {
      module: "tint:c/optional-q",
      darwin: optional("/usr/lib/libq.dylib"),
      linux: optional("libq.so.1"),
    },
  ];
  // ELF: dlopen/dlsym at first use, calls through the resolved address.
  const linux = prepareForeignLibrary(
    "q.d.ts",
    text,
    linuxArm64CTarget,
    manifest,
  );
  if (!linux.ok) assert.fail(linux.error);
  const lazy = linux.value.text;
  assert.match(lazy, /import \{ optionalSymbol \} from "tint:ffi\/unsafe";/);
  // One cache per symbol, shared by its variants.
  assert.equal(lazy.split("let at$q_sum = 0;").length, 2);
  assert.match(lazy, /at\$q_sum = optionalSymbol\("libq\.so\.1", "q_sum"\);/);
  assert.match(
    lazy,
    /export function hasSum\(\): boolean \{\n {2}return address\$q_sum\(\) > 0;\n\}/,
  );
  assert.match(
    lazy,
    /export function q_sum\$c\(target\$: number, bytes: Uint8Array, count: number\): number/,
  );
  assert.match(
    lazy,
    /throw new TypeError\("optional C function q_sum is not available"\)/,
  );
  assert.match(lazy, /return q_sum\$c\(target\$, bytes, count\);/);
  const stubs = linux.value.library.stubs;
  assert.deepEqual(
    stubs.map((stub) => [stub.name, stub.call?.indirect]),
    [
      ["q_sum$c", true],
      ["q_sum$twice$c", true],
    ],
  );
  // Mach-O: weak imports and an import-slot availability query.
  const darwin = prepareForeignLibrary(
    "q.d.ts",
    text,
    darwinArm64CTarget,
    manifest,
  );
  if (!darwin.ok) assert.fail(darwin.error);
  assert.doesNotMatch(darwin.value.text, /optionalSymbol/);
  assert.deepEqual(
    darwin.value.library.stubs.map((stub) => [stub.name, stub.call?.indirect]),
    [
      ["hasSum", undefined],
      ["q_sum", undefined],
      ["q_sum$twice", undefined],
    ],
  );
});

test("callback parameters make may-callback calls; callback types register functions", () => {
  const text = module(
    `  export interface Item { key: i32; tag: i32 }
  export const Item: Layout<Item>;
  export type visit_func = Callback<(item: Ptr<Item>, last: bool) => bool>;
  export function qsort(
    base: Ptr<Item>,
    count: usize,
    size: usize,
    compare: Callback<(a: Ptr<Item>, b: Ptr<Item>) => i32>,
  ): void;
  export function walk(items: Ptr<Item>, visit: visit_func): MayCallback<i32>;`,
    "i32, bool, usize, Ptr, Layout, Callback, MayCallback",
  );
  const library = parsed(text);
  const qsort = library.functions.find((fn) => fn.name === "qsort");
  assert.equal(qsort?.signature.callClass, "may-callback");
  assert.deepEqual(qsort?.parameterForms, [
    "bytes",
    "number",
    "number",
    "callback",
  ]);
  const compare = qsort?.callbacks?.[3];
  assert.deepEqual(compare?.parameterRecords, ["Item", "Item"]);
  assert.deepEqual(compare?.parameterForms, ["number", "number"]);
  assert.deepEqual(compare?.signature.result, {
    kind: "scalar",
    scalar: "i32",
  });
  assert.deepEqual(
    library.callbackTypes?.map((item) => [
      item.name,
      item.callback.parameterRecords,
      item.callback.resultForm,
    ]),
    [["visit_func", ["Item", ""], "boolean"]],
  );
  const prepared = prepareForeignLibrary("a.d.ts", text, darwinArm64CTarget);
  if (!prepared.ok) assert.fail(prepared.error);
  const generated = prepared.value.text;
  // Record parameters arrive as foreign views; the wrapper adapts, checks
  // pointer arguments are stable and rethrows after the call.
  assert.match(
    generated,
    /compare: \(a: View\$<Item>, b: View\$<Item>\) => number/,
  );
  // qsort's comparator (numbers and record views in, a number out) is
  // direct: C's thunk calls it with one view per record parameter, made
  // once per call and parked at the guard once C returns; failures arrive
  // through the call's notes.
  assert.match(
    generated,
    /const view\$compare\$0 = viewAt\$\(Item, guard\$compare\);/,
  );
  assert.match(
    generated,
    /qsort\$c\(state\$, callbackDispatcher\$\(\), base, count, size, compare, onThrow\$, onInvalid\$, view\$compare\$0, view\$compare\$1\);\n {2}retargetCallbackView\$\(view\$compare\$0, guard\$compare\);/,
  );
  assert.match(generated, /if \(failed\$\) throw error\$;/);
  // walk's visitor takes a bool, so it goes through an adapter.
  assert.match(generated, /retargetCallbackView\$\(view\$visit\$0, item\);/);
  assert.match(generated, /stableBytes\$\(base\)/);
  assert.match(
    generated,
    /export type visit_func = \(item: View\$<Item>, last: boolean\) => boolean;/,
  );
  assert.match(
    generated,
    /export function visit_func\(fn: visit_func\): number/,
  );
  const call = prepared.value.library.stubs.find((item) =>
    item.name.startsWith("qsort"),
  )?.call;
  assert.equal(call?.mayCallback, true);
  assert.deepEqual(call?.operands.slice(0, 2), ["bytes", "callback"]);
  // The comparator's two record views; two notes and two views follow the
  // prototype's operands.
  assert.deepEqual(call?.directCallbacks, [
    undefined,
    undefined,
    undefined,
    [0, 1],
  ]);
  assert.equal(call?.operands.length, 2 + 4 + 2 + 2);
  assert.equal(
    prepared.value.library.stubs.filter((item) =>
      item.name.startsWith("thunk$visit_func$"),
    ).length,
    16,
  );
  // Explicit errors.
  const callback = (signature: string, imports = "") =>
    module(
      `  export interface Item { key: i32 }\n  export function f(c: Callback<${signature}>): void;`,
      "i32, u8, Ptr, Address, Callback" + imports,
    );
  rejected(callback("(a: Ptr<u8>) => i32"), /Ptr<R> of a record/);
  rejected(callback("(a: Ptr<Item>) => i32"), /needs R's Layout constant/);
  rejected(callback("(a: Item) => i32"), /callback parameters are C scalars/);
  rejected(callback("(a: i32) => Item"), /callback results are C scalars/);
  rejected(
    callback(
      "(a: i32, b: i32, c: i32, d: i32, e: i32, f: i32, g: i32, h: i32) => i32",
    ),
    /at most seven/,
  );
  rejected(
    module(
      `  export function f(c: Callback<(a: i32) => i32>): Async<i32>;`,
      "i32, Callback, Async",
    ),
    /async calls take no callbacks/,
  );
});

test("literal Node FFI definitions contribute canonical static ABI plans", () => {
  const parsed = parseModule(
    createSourceTextView(
      `import { dlopen as open } from "node:ffi";
import ffi from "node:ffi";
const names = ["i32"];
open(null, {
  first: { arguments: ["ptr", "float"], return: "int8" },
  same: { arguments: ["string", "f32"], return: "i8" },
  dynamic: { arguments: names, return: "i32" },
  get lazy() { return { arguments: ["uint64"] }; },
  ["computed"]: { arguments: ["uint8"] },
});

ffi.dlopen(null, { no_args: {}, char: { return: "char" } });`,
    ),
  );
  assert.ok(parsed.ok, !parsed.ok ? parsed.error.message : undefined);
  const plans = recognizeStaticFfi(
    [
      {
        id: "fixture",
        module: parsed.value,
        dependencies: new Map([
          ["node:ffi", "packages/native-runtime/src/node/ffi.ts"],
        ]),
      },
    ],
    false,
  );
  assert.deepEqual(
    plans.map((plan) => plan.key),
    ["i8(pointer,f32)", "void()", "u8()"],
  );
  assert.deepEqual(plans[0]?.signature, {
    parameters: [
      { kind: "pointer", pointee: { kind: "void" } },
      { kind: "scalar", scalar: "f32" },
    ],
    result: { kind: "scalar", scalar: "i8" },
    fixedParameters: 2,
    callClass: "leaf",
    errno: "none",
  });
});

test("typed FFI calls enroll fixed arities without literal definitions", () => {
  const parsed = parseModule(
    createSourceTextView(`
export function consume(fn: Function, args: number[]): number {
  fn(...args);
  fn?.(1);
  fn();
  return fn(1, 2) as number;
}`),
  );
  assert.ok(parsed.ok);
  const arities = fixedFfiCallArities([
    { id: "consumer", module: parsed.value, dependencies: new Map() },
  ]);
  assert.deepEqual(arities, [0, 2]);
  const generated = makeStaticFfiModule([], true, arities);
  const entries = generated.module.statements.flatMap((statement) =>
    statement?.kind === "function" && statement.name.startsWith("tryFixedFfi")
      ? [[statement.name, statement.parameters.length]]
      : [],
  );
  assert.deepEqual(entries, [
    ["tryFixedFfi0", 1],
    ["tryFixedFfi2", 3],
  ]);
});

test("runtime i32 definitions get direct typed entries without replacing the generic adapter", () => {
  const plans = addFixedFfiPlans([], [0, 2]);
  assert.deepEqual(
    plans.map(({ signature, typedOnly }) => [
      signature.parameters.length,
      signature.result,
      typedOnly,
    ]),
    [
      [0, { kind: "scalar", scalar: "i32" }, true],
      [2, { kind: "scalar", scalar: "i32" }, true],
    ],
  );
  assert.deepEqual(addFixedFfiPlans(plans, [2]), plans);
  const generated = makeStaticFfiModule(plans, true, [0, 2]);
  const emitted = generated.module.statements.flatMap((statement) =>
    statement?.kind === "function" ? [statement.name] : [],
  );
  assert.ok(emitted.includes("callStaticFfiNumber0"));
  assert.ok(emitted.includes("callStaticFfiNumber1"));
  assert.ok(emitted.includes("typedFfiIndex"));
  assert.ok(emitted.includes("invokeTryFixedFfi0Frame"));
  assert.ok(emitted.includes("invokeTryFixedFfi2Frame"));
  assert.ok(emitted.includes("invokeTryMixedFfi2Frame"));
  // General callers whose runtime signature matches reach the same entries.
  assert.ok(emitted.includes("invokecallStaticFfiNumber0"));
  assert.ok(emitted.includes("invokecallStaticFfiNumber1"));
  assert.ok(!emitted.includes("callStaticFfi0"));
  const numbers = generated.module.statements.find(
    (statement) =>
      statement?.kind === "function" &&
      statement.name === "staticFfiNumberCall",
  );
  const returned = new Set<string>();
  if (numbers !== undefined)
    rewriteModule(
      { ...generated.module, statements: [numbers] },
      {
        expression: (expression) => {
          if (expression.kind === "identifier") returned.add(expression.name);
          return expression;
        },
      },
    );
  assert.ok(
    returned.has("invokecallStaticFfiNumber0") &&
      returned.has("invokecallStaticFfiNumber1"),
  );
  const guards = new Set<string>();
  rewriteModule(generated.module, {
    expression: (expression) => {
      if (expression.kind === "member") guards.add(expression.property);
      return expression;
    },
  });
  assert.ok(
    guards.has("lifetime") &&
      guards.has("nodeCallbacks") &&
      guards.has("nativeCallbacks") &&
      guards.has("pointerI32Callback") &&
      guards.has("typedView"),
  );
  // Entries read the stable view; they never call `typedRecord`.
  assert.ok(!guards.has("typedRecord"));
});

test("Node FFI binds a precompiled runtime-registered i32 callback prototype", () => {
  const modules = foreignRuntimeModules;
  const bindings = foreignRuntimeBindings(
    new Set([modules.primitives, modules.nodeFfi, modules.callbackStubs]),
  );
  const binding = bindings.memoryBindings.find(
    (entry) => entry.name === "runtimeI32CallbackAddress",
  );
  assert.equal(binding?.operation, "runtime-callback-address");
  assert.deepEqual(binding?.staticSignature, {
    parameters: [{ kind: "scalar", scalar: "i32" }],
    result: { kind: "scalar", scalar: "i32" },
    fixedParameters: 1,
    callClass: "leaf",
    errno: "none",
  });
});

test("fixed unary Buffer calls can borrow a stable backing through a typed entry", () => {
  const plans = addFixedFfiPlans([], [1]);
  const bytePlan = plans.find(
    (plan) => plan.signature.parameters[0]?.kind === "pointer",
  );
  assert.equal(bytePlan?.typedOnly, true);
  const generated = makeStaticFfiModule(plans, true, [1]);
  assert.ok(
    generated.module.statements.some(
      (statement) =>
        statement?.kind === "function" &&
        statement.name === "staticFfiBytesCall",
    ),
  );
});
