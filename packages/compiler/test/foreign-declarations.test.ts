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
} from "@tint/abi/c";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import {
  parseForeignDeclarations,
  prepareForeignLibrary,
  foreignDeclarationInput,
  expandForeignInputs,
  foreignViews,
} from "../src/native/foreign/index.ts";

const root = new URL("../../native-runtime/src/c/", import.meta.url);
const commonCrypto = readFileSync(new URL("commoncrypto.d.ts", root), "utf8");
const libSystem = readFileSync(new URL("libsystem.d.ts", root), "utf8");

function parsed(text: string): CLibraryDeclaration {
  const result = parseForeignDeclarations(text);
  if (!result.ok) assert.fail(JSON.stringify(result.error));
  return result.value;
}
function rejected(text: string, message: RegExp): void {
  const result = parseForeignDeclarations(text);
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
  const callback = prepareForeignLibrary(
    "x.d.ts",
    module(`  export function f(): MayCallback<i32>;`, "i32, MayCallback"),
    darwinArm64CTarget,
  );
  assert.equal(callback.ok, false);
  if (!callback.ok) assert.match(callback.error, /only leaf calls/);
  const other = prepareForeignLibrary(
    "x.d.ts",
    `declare module "tint:c/libunknown" {}`,
    darwinArm64CTarget,
  );
  assert.equal(other.ok, false);
  if (!other.ok) assert.match(other.error, /not in the C library manifest/);
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
      const compiled = spawnSync("clang", ["-o", binary, source], {
        encoding: "utf8",
      });
      assert.equal(compiled.status, 0, compiled.stderr);
      const run = spawnSync(binary, [], { encoding: "utf8" });
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
      process.platform !== "darwin"
        ? "the zlib binding targets Darwin's system zlib"
        : clang.status !== 0
          ? "clang is not installed (test-only layout oracle)"
          : false,
  },
  () => {
    const zlib = readFileSync(new URL("zlib.d.ts", root), "utf8");
    const record = parsed(zlib).records.find(
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
      const compiled = spawnSync("clang", ["-o", binary, source], {
        encoding: "utf8",
      });
      assert.equal(compiled.status, 0, compiled.stderr);
      const run = spawnSync(binary, [], { encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
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
