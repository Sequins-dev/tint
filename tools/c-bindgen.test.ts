// The C binding generator (docs/native-ffi.md, "Binding generator"):
// emission rules on synthetic facts, the checked-in modules (determinism,
// TypeScript, parity with the hand-written bindings), and on hosts with
// clang the facts, the layout and prototype oracle, every unsupported C
// shape, and a native fixture through a freshly generated binding.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import type { CScalar } from "@tint/abi/c";
import { parseForeignDeclarations } from "@tint/compiler/native";
import {
  factsMeaning,
  generatedFile,
  loadSpecs,
  readFacts,
  semanticDifferences,
} from "./c-bindgen.ts";
import { emitBinding, SpecError } from "./c-bindgen/emit.ts";
import { clangCommand, extractFacts, hostTarget } from "./c-bindgen/extract.ts";
import type {
  FieldFact,
  RecordFact,
  TargetFacts,
  TypeFact,
} from "./c-bindgen/facts.ts";
import { layoutOracle, prototypeOracle } from "./c-bindgen/oracle.ts";
import { bindingDifferences } from "./c-bindgen/parity.ts";
import {
  cTargetOf,
  type BindingSpec,
  type TargetName,
} from "./c-bindgen/spec.ts";
import {
  verifyGeneralBindingImport,
  verifyGeneratedZlibAllocatorFixture,
  verifySampleFixture,
} from "./c-bindgen-fixtures.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";

const host = hostTarget();
const clang =
  host === undefined
    ? {
        skip: "clang facts and the oracle run on darwin-arm64 and linux-arm64 hosts",
      }
    : spawnSync(clangCommand(), ["--version"]).status === 0
      ? {}
      : { skip: "clang is not installed (dev-time generator and test oracle)" };
const bindings = new URL("../packages/native-runtime/src/c/", import.meta.url);

// Synthetic facts for emission rules (no clang needed).
function scalar(name: CScalar, aliases: readonly string[] = []): TypeFact {
  return { kind: "scalar", scalar: name, aliases };
}
function functionType(
  parameters: readonly TypeFact[],
  result: TypeFact,
  name?: string,
): TypeFact & { kind: "function" } {
  return {
    kind: "function",
    parameters,
    result,
    variadic: false,
    ...(name === undefined ? {} : { name }),
  };
}
function pointer(pointee: TypeFact, constPointee = false): TypeFact {
  return { kind: "pointer", pointee, constPointee };
}
function record(
  name: string,
  size: number,
  align: number,
  fields: readonly FieldFact[],
  union = false,
): RecordFact {
  return {
    name,
    c: "struct " + name,
    union,
    packed: false,
    alignment: 0,
    size,
    align,
    fields,
  };
}
function facts(target: TargetName, parts: Partial<TargetFacts>): TargetFacts {
  return {
    spec: "unit",
    target,
    clang: "clang version 0",
    aliases: [],
    types: [],
    records: [],
    functions: [],
    constants: [],
    skipped: [],
    ...parts,
  };
}
function unitSpec(parts: Partial<BindingSpec>): BindingSpec {
  return {
    library: "unit",
    summary: ["Unit."],
    targets: ["darwin-arm64", "linux-arm64"],
    headers: [],
    ...parts,
  };
}
async function emitUnit(
  spec: BindingSpec,
  darwin: Partial<TargetFacts>,
  linux: Partial<TargetFacts> = darwin,
) {
  return emitBinding(
    spec,
    new Map([
      ["darwin-arm64", facts("darwin-arm64", darwin)],
      ["linux-arm64", facts("linux-arm64", linux)],
    ]),
    { specPath: "unit" },
  );
}

test("targets that differ merge with ByTarget; shared aliases stay aliases", async () => {
  const mode = (scalarName: CScalar, aliases: readonly string[]) =>
    scalar(scalarName, aliases);
  const emission = await emitUnit(
    unitSpec({
      aliases: ["mode_t"],
      records: ["pair"],
      constants: ["FLAG", "SAME"],
      functions: [{ name: "chmodish", result: "OrErrno" }],
    }),
    {
      aliases: [{ name: "mode_t", type: mode("u16", ["mode_t"]) }],
      records: [
        record("pair", 8, 4, [
          { name: "a", type: mode("u16", ["mode_t"]), offset: 0 },
          { name: "b", type: scalar("u32"), offset: 4 },
        ]),
      ],
      functions: [
        {
          name: "chmodish",
          parameters: [{ name: "__mode", type: mode("u16", ["mode_t"]) }],
          result: scalar("i32"),
          variadic: false,
        },
      ],
      constants: [
        { name: "FLAG", value: "4096" },
        { name: "SAME", value: "2" },
      ],
    },
    {
      aliases: [{ name: "mode_t", type: mode("u32", ["mode_t", "__mode_t"]) }],
      records: [
        record("pair", 8, 4, [
          { name: "a", type: mode("u32", ["__mode_t"]), offset: 0 },
          { name: "b", type: scalar("u32"), offset: 4 },
        ]),
      ],
      functions: [
        {
          name: "chmodish",
          parameters: [{ name: "__mode", type: mode("u32", ["__mode_t"]) }],
          result: scalar("i32"),
          variadic: false,
        },
      ],
      constants: [
        { name: "FLAG", value: "32" },
        { name: "SAME", value: "2" },
      ],
    },
  );
  assert.deepEqual(emission.report, []);
  assert.match(
    emission.text,
    /type mode_t = ByTarget<\{ "darwin-arm64": u16; "linux-arm64": u32 \}>;/,
  );
  assert.match(emission.text, /a: mode_t;/);
  assert.match(
    emission.text,
    /export function chmodish\(mode: mode_t\): OrErrno<i32>;/,
  );
  assert.match(
    emission.text,
    /FLAG: ByTarget<\{ "darwin-arm64": 0x1000; "linux-arm64": 32 \}>/,
  );
  assert.match(emission.text, /export const SAME: 2;/);
  assert.match(
    emission.text,
    /^\/\/ clang: clang version 0 \(darwin-arm64\), clang version 0 \(linux-arm64\)\.$/m,
  );
});

test("emission is deterministic and verified against the facts' layouts", async () => {
  const spec = unitSpec({ records: ["pair"] });
  const darwin = {
    records: [
      record("pair", 16, 8, [
        { name: "a", type: scalar("u8"), offset: 0 },
        { name: "b", type: scalar("f64"), offset: 8 },
      ]),
    ],
  };
  const first = await emitUnit(spec, darwin);
  assert.equal((await emitUnit(spec, darwin)).text, first.text);
  // Facts whose layout the declaration syntax does not reproduce never
  // become a module.
  await assert.rejects(
    emitUnit(spec, {
      records: [
        record("pair", 16, 8, [
          { name: "a", type: scalar("u8"), offset: 0 },
          { name: "b", type: scalar("f64"), offset: 4 },
        ]),
      ],
    }),
    /generated record pair lays out as 16 8 0 8 on darwin-arm64, clang as 16 8 0 4/,
  );
});

test("unsupported shapes are reported and left out, with their dependents", async () => {
  const callback = pointer(functionType([scalar("i32")], scalar("i32")));
  const emission = await emitUnit(
    unitSpec({
      records: ["shape", "outer", { name: "hook", opaque: ["fn"] }, "hooks"],
      functions: [
        "listen",
        { name: "listen", variant: "opaque", parameters: { 0: "Address" } },
        "vprint",
        "print",
        { name: "print", variant: "int", variadic: ["int"] },
      ],
    }),
    {
      records: [
        record("shape", 4, 4, [{ name: "a", type: scalar("i32"), offset: 0 }]),
        record("outer", 4, 4, [
          { name: "inner", type: { kind: "record", name: "shape" }, offset: 0 },
        ]),
        record("hook", 8, 8, [{ name: "fn", type: callback, offset: 0 }]),
        record("hooks", 8, 8, [{ name: "fn", type: callback, offset: 0 }]),
      ],
      types: [{ name: "int", type: scalar("i32") }],
      functions: [
        {
          name: "listen",
          parameters: [{ name: "fn", type: callback }],
          result: { kind: "void" },
          variadic: false,
        },
        {
          name: "vprint",
          parameters: [
            { name: "list", type: { kind: "unsupported", reason: "va_list" } },
          ],
          result: scalar("i32"),
          variadic: false,
        },
        {
          name: "print",
          parameters: [{ name: "format", type: pointer(scalar("char"), true) }],
          result: scalar("i32"),
          variadic: true,
        },
      ],
    },
    {
      records: [
        record("shape", 8, 4, [
          { name: "a", type: scalar("i32"), offset: 0 },
          { name: "b", type: scalar("i32"), offset: 4 },
        ]),
        record("outer", 8, 4, [
          { name: "inner", type: { kind: "record", name: "shape" }, offset: 0 },
        ]),
        record("hook", 8, 8, [{ name: "fn", type: callback, offset: 0 }]),
        record("hooks", 8, 8, [{ name: "fn", type: callback, offset: 0 }]),
      ],
      types: [{ name: "int", type: scalar("i32") }],
      functions: [
        {
          name: "listen",
          parameters: [{ name: "fn", type: callback }],
          result: { kind: "void" },
          variadic: false,
        },
        {
          name: "vprint",
          parameters: [
            { name: "list", type: { kind: "unsupported", reason: "va_list" } },
          ],
          result: scalar("i32"),
          variadic: false,
        },
        {
          name: "print",
          parameters: [{ name: "format", type: pointer(scalar("char"), true) }],
          result: scalar("i32"),
          variadic: true,
        },
      ],
    },
  );
  assert.deepEqual(emission.report, [
    "record shape: differs between targets beyond member types (members, packing or alignment): bind it in per-target specs",
    "record outer: member inner holds record shape by value, which is not emitted",
    "function vprint: parameter list: va_list",
    "function print: is variadic: give each call shape's argument types in `variadic` (one spec entry per shape, `variant` names them)",
  ]);
  assert.match(emission.text, /interface hook \{\s*fn: Address<void>;\s*\}/);
  assert.match(
    emission.text,
    /function listen\$opaque\(fn: Address<void>\): void;/,
  );
  assert.match(
    emission.text,
    /function print\$int\(format: CString, variadic0: Variadic<i32>\): i32;/,
  );
  assert.match(emission.text, /^\/\/ Not bound:$/m);
  assert.doesNotMatch(emission.text, /interface (shape|outer)\b/);
  assert.deepEqual(emission.opaque, []);
});

test("function pointers become callback types, opaque only where no callback fits", async () => {
  const allocator = functionType(
    [pointer({ kind: "void" }), scalar("u32", ["uInt"])],
    pointer({ kind: "void" }),
    "alloc_func",
  );
  const compare = functionType(
    [pointer({ kind: "void" }, true), pointer({ kind: "void" }, true)],
    scalar("i32"),
  );
  const byValue = functionType([{ kind: "record", name: "pair" }], {
    kind: "void",
  });
  const many = functionType(
    Array.from({ length: 8 }, () => scalar("i32")),
    { kind: "void" },
  );
  const parts: Partial<TargetFacts> = {
    aliases: [{ name: "uInt", type: scalar("u32", ["uInt"]) }],
    records: [
      record("pair", 8, 4, [
        { name: "a", type: scalar("i32"), offset: 0 },
        { name: "b", type: scalar("i32"), offset: 4 },
      ]),
      record("hooks", 40, 8, [
        { name: "alloc", type: pointer(allocator), offset: 0 },
        { name: "notify", type: pointer(compare), offset: 8 },
        { name: "raw", type: pointer(compare), offset: 16 },
        { name: "visit", type: pointer(byValue), offset: 24 },
        {
          name: "variadic",
          type: pointer({ ...compare, variadic: true }),
          offset: 32,
        },
      ]),
    ],
    functions: [
      {
        name: "sort",
        parameters: [
          { name: "base", type: pointer({ kind: "void" }) },
          { name: "compare", type: pointer(compare) },
        ],
        result: { kind: "void" },
        variadic: false,
      },
      {
        name: "install",
        parameters: [{ name: "hook", type: pointer(allocator) }],
        result: pointer(allocator),
        variadic: false,
      },
      {
        name: "wide",
        parameters: [{ name: "hook", type: pointer(many) }],
        result: scalar("i32"),
        variadic: false,
      },
    ],
  };
  const emission = await emitUnit(
    unitSpec({
      aliases: ["uInt"],
      records: ["pair", { name: "hooks", opaque: ["raw"] }],
      functions: [
        "sort",
        { name: "sort", variant: "raw", parameters: { compare: "Address" } },
        "install",
        "wide",
      ],
    }),
    parts,
  );
  assert.deepEqual(emission.report, []);
  assert.deepEqual(emission.opaque, [
    "member hooks_visit: parameter 0 passes record pair by value",
    "member hooks_variadic: a variadic prototype",
    "the result: a returned function pointer is an address",
    "parameter hook: callbacks take at most seven parameters",
  ]);
  const text = emission.text;
  for (const fragment of [
    // The typedef's name, or <record>_<member>, registers C-kept callbacks.
    /export type alloc_func = Callback<\s*\(arg0: Address<void>, arg1: uInt\) => Address<void>\s*>;/,
    /export type hooks_notify = Callback<\s*\(arg0: Address<void>, arg1: Address<void>\) => i32\s*>;/,
    /interface hooks \{\s*alloc: alloc_func;\s*notify: hooks_notify;\s*raw: Address<void>;\s*visit: Address<void>;\s*variadic: Address<void>;\s*\}/,
    // A parameter's anonymous prototype is an inline, scoped callback.
    /function sort\(\s*base: Ptr<void>,\s*compare: Callback<\(arg0: Address<void>, arg1: Address<void>\) => i32>,\s*\): void;/,
    /function sort\$raw\(base: Ptr<void>, compare: Address<void>\): void;/,
    /function install\(hook: alloc_func\): Address<void>;/,
    /function wide\(hook: Address<void>\): i32;/,
    /^\/\/ Function pointers bound as addresses:$/m,
  ])
    assert.match(text, fragment);
  // The parser reads the callback types and makes their users may-callback.
  const parsed = parseForeignDeclarations(text, cTargetOf("linux-arm64"));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  assert.deepEqual(
    (parsed.value.callbackTypes ?? []).map((item) => item.name),
    ["alloc_func", "hooks_notify"],
  );
  const callClass = (name: string) =>
    parsed.value.functions.find((fn) => fn.name === name)?.signature.callClass;
  assert.equal(callClass("sort"), "may-callback");
  assert.equal(callClass("install"), "may-callback");
  assert.equal(callClass("sort$raw"), "leaf");
  assert.equal(callClass("wide"), "leaf");
  await assert.rejects(
    emitUnit(
      unitSpec({
        functions: [{ name: "sort", parameters: { compare: "Ptr" } }],
      }),
      parts,
    ),
    /a function pointer is a Callback or, with `as: "Address"`, an opaque address/,
  );
  await assert.rejects(
    emitUnit(unitSpec({ records: ["pair"], functions: ["pair"] }), {
      ...parts,
      functions: [
        {
          name: "pair",
          parameters: [
            { name: "hook", type: pointer({ ...compare, name: "pair" }) },
          ],
          result: { kind: "void" },
          variadic: false,
        },
      ],
    }),
    /callback type pair collides with another declaration/,
  );
});

test("functions handing C a record with callbacks are may-callback unless the spec says leaf", async () => {
  const hook = pointer(functionType([scalar("i32")], scalar("i32"), "hook_t"));
  const takes = (name: string, type: TypeFact) => ({
    name,
    parameters: [{ name: "it", type }],
    result: scalar("i32"),
    variadic: false,
  });
  const emission = await emitUnit(
    unitSpec({
      records: [
        "stream",
        "outer",
        "holder",
        "plain",
        { name: "masked", opaque: ["fn"] },
      ],
      functions: [
        "direct",
        "nested",
        "behind",
        "byValue",
        "usePlain",
        "useMasked",
        { name: "direct", variant: "documented", callClass: "leaf" },
        { name: "usePlain", variant: "forced", callClass: "may-callback" },
      ],
    }),
    {
      records: [
        record("stream", 8, 8, [{ name: "fn", type: hook, offset: 0 }]),
        record("outer", 8, 8, [
          {
            name: "inner",
            type: { kind: "record", name: "stream" },
            offset: 0,
          },
        ]),
        record("holder", 8, 8, [
          {
            name: "next",
            type: pointer({ kind: "record", name: "outer" }),
            offset: 0,
          },
        ]),
        record("plain", 4, 4, [{ name: "a", type: scalar("i32"), offset: 0 }]),
        record("masked", 8, 8, [{ name: "fn", type: hook, offset: 0 }]),
      ],
      functions: [
        takes("direct", pointer({ kind: "record", name: "stream" })),
        takes("nested", pointer({ kind: "record", name: "outer" })),
        takes("behind", pointer({ kind: "record", name: "holder" })),
        takes("byValue", { kind: "record", name: "outer" }),
        takes("usePlain", pointer({ kind: "record", name: "plain" })),
        takes("useMasked", pointer({ kind: "record", name: "masked" })),
      ],
    },
  );
  const parsed = parseForeignDeclarations(
    emission.text,
    cTargetOf("darwin-arm64"),
  );
  assert.ok(parsed.ok, JSON.stringify(parsed));
  assert.deepEqual(
    Object.fromEntries(
      parsed.value.functions.map((fn) => [fn.name, fn.signature.callClass]),
    ),
    {
      direct: "may-callback",
      nested: "may-callback",
      behind: "may-callback",
      byValue: "may-callback",
      usePlain: "leaf",
      useMasked: "leaf",
      direct$documented: "leaf",
      usePlain$forced: "may-callback",
    },
  );
});

test("spec choices that contradict the C declaration fail explicitly", async () => {
  const base = {
    records: [
      record("word", 8, 4, [
        { name: "low", type: scalar("u32"), offset: 0 },
        { name: "high", type: scalar("u32"), offset: 4 },
      ]),
      record("real", 8, 8, [{ name: "value", type: scalar("f64"), offset: 0 }]),
      record("pairs", 8, 4, [
        {
          name: "values",
          type: { kind: "array", element: scalar("i32"), length: 2 },
          offset: 0,
        },
      ]),
    ],
    functions: [
      {
        name: "f",
        parameters: [
          { name: "count", type: scalar("u32") },
          { name: "bytes", type: pointer(scalar("u8")) },
          { name: "values", type: pointer(scalar("i32")) },
          { name: "handle", type: pointer({ kind: "void" }) },
        ],
        result: scalar("u32"),
        variadic: false,
      },
    ],
  } satisfies Partial<TargetFacts>;
  const records = ["word", "real", "pairs"];
  const cases: [NonNullable<BindingSpec["functions"]>, RegExp][] = [
    [
      [{ name: "f", parameters: { count: "Address" } }],
      /parameter count is not a pointer/,
    ],
    [
      [{ name: "f", parameters: { values: "CString" } }],
      /CString needs a char pointer/,
    ],
    [
      [{ name: "f", parameters: { bytes: { pointee: "pairs" } } }],
      /record pairs is not an array of the C pointee \(u8\)/,
    ],
    [
      [{ name: "f", parameters: { handle: { record: "real" } } }],
      /record real must be 8 bytes without floating-point members/,
    ],
    [
      [{ name: "f", parameters: { count: { record: "word" } } }],
      /only a pointer or 64-bit integer passes as record word/,
    ],
    [
      [{ name: "f", result: "OrErrno" }],
      /OrErrno needs a signed 32\/64-bit or pointer result/,
    ],
    [[{ name: "f", variadic: ["int"] }], /f is not variadic/],
    [
      [{ name: "f", parameters: { missing: "Ptr" } }],
      /f has no parameter missing/,
    ],
  ];
  for (const [functions, message] of cases)
    await assert.rejects(
      emitUnit(unitSpec({ records, functions }), base),
      (error: unknown) => {
        assert.ok(error instanceof SpecError, String(error));
        assert.match(error.message, message);
        return true;
      },
    );
  const accepted = await emitUnit(
    unitSpec({
      records,
      functions: [
        {
          name: "f",
          parameters: {
            values: { pointee: "pairs" },
            handle: { record: "word" },
          },
        },
      ],
    }),
    base,
  );
  assert.match(
    accepted.text,
    /f\(\s*count: u32,\s*bytes: Ptr<u8>,\s*values: Ptr<pairs>,\s*handle: word,\s*\): u32;/,
  );
  await assert.rejects(
    emitUnit(
      unitSpec({ records: [{ name: "word", opaque: ["missing"] }] }),
      base,
    ),
    /record word has no member missing/,
  );
});

test("call classes and optional libraries", async () => {
  const fn = {
    name: "f",
    parameters: [],
    result: scalar("i32"),
    variadic: false,
  };
  const emission = await emitUnit(
    unitSpec({
      optional: true,
      functions: [
        { name: "f", callClass: "may-callback" },
        { name: "f", variant: "two" },
      ],
      availability: [{ name: "hasF", function: "f" }],
    }),
    { functions: [fn] },
  );
  assert.match(emission.text, /export function f\(\): MayCallback<i32>;/);
  assert.match(emission.text, /export function hasF\(\): Available<"f">;/);
  assert.match(
    emission.text,
    /export function hasF_two\(\): Available<"f\$two">;/,
  );
  const parsed = parseForeignDeclarations(
    emission.text,
    cTargetOf("darwin-arm64"),
  );
  assert.ok(parsed.ok);
  assert.equal(parsed.value.functions[0]?.signature.callClass, "may-callback");
  assert.deepEqual(
    parsed.value.availability.map((query) => query.symbol),
    ["f", "f"],
  );
  await assert.rejects(
    emitUnit(
      unitSpec({
        functions: ["f"],
        availability: [{ name: "hasG", function: "g" }],
      }),
      { functions: [fn] },
    ),
    /availability query hasG names undeclared function g/,
  );
});

// The checked-in specs, facts and modules.
const specs = await loadSpecs();

test("checked-in modules are emitted byte-identically from the checked-in facts", async () => {
  assert.deepEqual(
    specs.map((item) => item.name),
    [
      "commoncrypto",
      "darwin-os",
      "dl",
      "libsystem",
      "linux-os",
      "memory",
      "zlib",
    ],
  );
  for (const loaded of specs) {
    const emission = await emitBinding(loaded.spec, readFacts(loaded), {
      specPath: loaded.path,
    });
    assert.equal(
      emission.text,
      readFileSync(generatedFile(loaded.name), "utf8"),
      loaded.name,
    );
    assert.deepEqual(emission.report, [], loaded.name);
  }
});

test("generated modules type-check against tint:ffi", () => {
  const ffi = new URL("ffi.d.ts", bindings).pathname;
  for (const loaded of specs) {
    const program = ts.createProgram(
      [ffi, generatedFile(loaded.name).pathname],
      {
        noEmit: true,
        strict: true,
        types: [],
        lib: ["lib.es2023.d.ts"],
      },
    );
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n"));
    assert.deepEqual(diagnostics, [], loaded.name);
  }
});

test("every tint:c binding is generated from a spec", () => {
  // The generated modules are the bindings: no hand-written tint:c module
  // remains beside them.
  const modules = readdirSync(bindings)
    .filter((file) => file.endsWith(".d.ts"))
    .filter((file) =>
      /^(\/\/[^\n]*\n)*declare module "tint:c\//.test(
        readFileSync(new URL(file, bindings), "utf8"),
      ),
    )
    .map((file) => file.slice(0, -".d.ts".length))
    .sort();
  assert.deepEqual(
    modules,
    specs.map((item) => item.name),
  );
  for (const name of modules)
    assert.match(
      readFileSync(new URL(`${name}.d.ts`, bindings), "utf8"),
      new RegExp(
        `^// Generated by tools/c-bindgen.ts from tools/c-bindgen/specs/${name}.ts; do not edit.\n`,
      ),
    );
});

test("bindgen check describes what a regeneration would change", () => {
  const current = readFileSync(generatedFile("zlib"), "utf8");
  assert.deepEqual(semanticDifferences(current, current, "linux-arm64"), []);
  assert.deepEqual(
    semanticDifferences(
      current.replace("avail_in: uInt;", "avail_in: uLong;"),
      current,
      "darwin-arm64",
    ),
    ["record z_stream member avail_in: u64 vs u32"],
  );
});

test("parity reports differing layouts, signatures and constants", () => {
  const target = cTargetOf("darwin-arm64");
  const read = (text: string) => {
    const parsed = parseForeignDeclarations(
      `declare module "tint:c/libsystem" {\n  import type { i32, i64, u8, Ptr, OrErrno } from "tint:ffi";\n${text}\n}\n`,
      target,
    );
    assert.ok(parsed.ok, JSON.stringify(parsed));
    return parsed.value;
  };
  assert.deepEqual(
    bindingDifferences(
      read(
        `  export interface R { a: u8; b: i32 }\n  export const K: 1;\n  export function f(r: Ptr<R>): i32;`,
      ),
      read(
        `  export interface R { a: u8; b: i64 }\n  export const K: 2;\n  export function f(r: Ptr<R>): OrErrno<i32>;\n  export function g(): i32;`,
      ),
      target,
    ),
    [
      "record R: layout size 8 align 4 offsets [0, 4] vs size 16 align 8 offsets [0, 8]",
      "record R member b: i32 vs i64",
      "function f: f (*R bytes) fixed 1 i32 number none leaf vs f (*R bytes) fixed 1 i32 number negated-result leaf",
      "function g: only generated",
      "constant K: 1 vs 2",
    ],
  );
});

// Clang on this host: facts, the oracle, unsupported shapes, native code.

test("SDK parameter spelling can differ while the C signature stays the same", () => {
  const declaration = (name: string, type: CScalar) =>
    facts("darwin-arm64", {
      functions: [
        {
          name: "close",
          parameters: [{ name, type: scalar(type) }],
          result: scalar("i32"),
          variadic: false,
        },
      ],
    });
  const original = declaration("arg0", "i32");
  const renamed = declaration("__fd", "i32");
  const spec = unitSpec({
    functions: [{ name: "close", parameters: { 0: { name: "fd" } } }],
  });
  assert.equal(factsMeaning(original, spec), factsMeaning(renamed, spec));
  assert.notEqual(
    factsMeaning(original, spec),
    factsMeaning(declaration("__fd", "u32"), spec),
  );
  const byName = unitSpec({
    functions: [{ name: "close", parameters: { arg0: { name: "fd" } } }],
  });
  assert.notEqual(
    factsMeaning(original, byName),
    factsMeaning(renamed, byName),
  );
});

test("this host's headers still produce the checked-in facts", clang, () => {
  for (const loaded of specs) {
    if (!loaded.spec.targets.includes(host!)) continue;
    const current = readFacts(loaded).get(host!);
    assert.ok(current !== undefined, loaded.name);
    assert.equal(
      factsMeaning(extractFacts(loaded.spec, host!), loaded.spec),
      factsMeaning(current, loaded.spec),
      loaded.name,
    );
  }
});

test(
  "the bindings match clang's layouts and prototypes, callbacks included (oracle)",
  clang,
  () => {
    for (const loaded of specs) {
      if (!loaded.spec.targets.includes(host!)) continue;
      const cTarget = cTargetOf(host!);
      const spellings = new Map(
        readFacts(loaded)
          .get(host!)!
          .records.map((item) => [item.name, item.c]),
      );
      for (const text of [readFileSync(generatedFile(loaded.name), "utf8")]) {
        const parsed = parseForeignDeclarations(text, cTarget);
        assert.ok(parsed.ok, loaded.name);
        const checked = parsed.value.records.filter((item) =>
          spellings.has(item.name),
        );
        assert.ok(
          checked.length > 0 || parsed.value.records.length === 0,
          loaded.name,
        );
        assert.deepEqual(
          layoutOracle(loaded.spec, host!, cTarget, parsed.value, spellings),
          [],
          loaded.name,
        );
        assert.deepEqual(
          prototypeOracle(loaded.spec, host!, cTarget, parsed.value),
          [],
          loaded.name,
        );
      }
    }
  },
);

test("the oracle catches wrong widths, offsets and pointees", clang, () => {
  const loaded = specs.find((item) => item.name === "zlib")!;
  const cTarget = cTargetOf(host!);
  const spellings = new Map(
    readFacts(loaded)
      .get(host!)!
      .records.map((item) => [item.name, item.c]),
  );
  const text = readFileSync(generatedFile("zlib"), "utf8")
    .replace("next_in: Address<u8>;", "next_in: u32;")
    .replace(
      "export function deflate(strm: Ptr<z_stream>, flush: i32)",
      "export function deflate(strm: Ptr<u8>, flush: u64)",
    )
    .replace(
      "export function zlibVersion(): Address<char>;",
      "export function zlibVersion(): u32;",
    );
  const parsed = parseForeignDeclarations(text, cTarget);
  assert.ok(parsed.ok);
  const layout = layoutOracle(
    loaded.spec,
    host!,
    cTarget,
    parsed.value,
    spellings,
  );
  assert.equal(layout.length, 1);
  assert.match(
    layout[0]!,
    /^record z_stream: declared z_stream 104 8 0 4 8 16 24 32 40 48 56 64 72 80 88 96, clang z_stream 112 8 0 8 16 24 32 40 48 56 64 72 80 88 96 104$/,
  );
  assert.deepEqual(
    prototypeOracle(loaded.spec, host!, cTarget, parsed.value).map((line) =>
      line.replace(/: declared .*, C /, ": C "),
    ),
    [
      "function zlibVersion result: C p:c1",
      // Every view of the mislaid record is too short for C's.
      "function deflateInit2_ parameter strm: C p:r112",
      "function deflate parameter strm: C p:r112",
      "function deflate parameter flush: C i4",
      "function deflateEnd parameter strm: C p:r112",
      "function inflateInit2_ parameter strm: C p:r112",
      "function inflate parameter strm: C p:r112",
      "function inflateReset parameter strm: C p:r112",
      "function inflateEnd parameter strm: C p:r112",
    ],
  );
});

/** Every C shape the generator meets, from a prelude of C declarations. */
const syntheticSpec: BindingSpec = {
  library: "synthetic",
  summary: ["Every C shape the generator meets."],
  targets: ["darwin-arm64", "linux-arm64"],
  headers: ["stdarg.h"],
  prelude: `
struct sample_bits { int a : 3; int b; };
struct sample_flex { int n; char data[]; };
struct sample_hook { int (*callback)(int); void *context; };
struct sample_hooks { int (*callback)(int); };
struct __attribute__((packed)) sample_packed { char tag; int value; };
struct __attribute__((aligned(16))) sample_aligned { int value; };
union sample_number { long long whole; double real; };
struct sample_nested {
  struct { int x; } point;
  union { int i; float f; } either;
  struct sample_packed packed[2];
};
struct sample_anonymous { int kind; union { int i; float f; }; };
struct sample_float_pair { float x; float y; };
struct sample_long_double { long double value; };
struct sample_holder { struct sample_bits bits; };
struct sample_list { struct sample_list *next; struct sample_opaque *data; };
typedef enum { SAMPLE_NEGATIVE = -1, SAMPLE_ZERO } sample_signed;
enum sample_color { SAMPLE_RED, SAMPLE_GREEN = 5 };
typedef unsigned short sample_word;
typedef sample_word sample_wide_word;
#define SAMPLE_FLAG 0x40
#define SAMPLE_BIG 0x123456789
#define SAMPLE_HUGE 0xFFFFFFFFFFFFFFFFull
#define SAMPLE_NEGATIVE_DEFINE (-3)
#define SAMPLE_POINTER ((void *)-1)
#define SAMPLE_REAL 1.5
static inline int sample_inline(int x) { return x; }
#ifdef __APPLE__
int sample_renamed(int) __asm__("_sample_other");
#else
int sample_renamed(int) __asm__("sample_other");
#endif
int sample_vprint(const char *format, va_list arguments);
int sample_print(const char *format, ...);
struct sample_float_pair sample_pair(struct sample_float_pair p, enum sample_color c, sample_signed s, sample_wide_word w);
int (*sample_lookup(const char *name))(int);
void sample_register(int (*callback)(int), void *context);
_Bool sample_flagged(const unsigned char *bytes, char *buffer, long double *wide);
`,
  aliases: ["sample_word", "sample_missing_alias"],
  records: [
    "sample_bits",
    "sample_flex",
    { name: "sample_hook", opaque: ["callback"] },
    "sample_hooks",
    "sample_packed",
    "sample_aligned",
    "sample_number",
    "sample_nested",
    "sample_anonymous",
    "sample_float_pair",
    "sample_long_double",
    "sample_holder",
    "sample_list",
    "sample_missing",
  ],
  constants: [
    "SAMPLE_FLAG",
    "SAMPLE_BIG",
    "SAMPLE_HUGE",
    "SAMPLE_NEGATIVE_DEFINE",
    "SAMPLE_POINTER",
    "SAMPLE_REAL",
    "SAMPLE_GREEN",
    "SAMPLE_NEGATIVE",
    "SAMPLE_UNDEFINED",
  ],
  functions: [
    "sample_inline",
    "sample_renamed",
    "sample_vprint",
    "sample_print",
    {
      name: "sample_print",
      variant: "two",
      variadic: ["sample_word", "float"],
    },
    "sample_pair",
    "sample_lookup",
    "sample_register",
    {
      name: "sample_register",
      variant: "opaque",
      parameters: { callback: "Address" },
    },
    "sample_flagged",
    "sample_missing",
  ],
};

test(
  "clang's view of every C shape: bound exactly or reported",
  clang,
  async () => {
    const facts = extractFacts(syntheticSpec, host!);
    const emission = await emitBinding(
      syntheticSpec,
      new Map([[host!, facts]]),
      {
        specPath: "synthetic",
        targets: [host!],
      },
    );
    assert.deepEqual(emission.report, [
      "record sample_missing: not declared by the headers",
      "function sample_inline: a static or inline header function has no symbol to bind",
      "function sample_renamed: the header binds it to symbol sample_other (asm label)",
      "function sample_missing: not declared by the headers",
      "constant SAMPLE_POINTER: static assertion failed: SAMPLE_POINTER is not an integer",
      "constant SAMPLE_REAL: static assertion failed: SAMPLE_REAL is not an integer",
      "constant SAMPLE_UNDEFINED: use of undeclared identifier 'SAMPLE_UNDEFINED'",
      "record sample_bits: member a is a bitfield",
      "record sample_flex: member data: flexible array char[]",
      "record sample_anonymous: an anonymous member (C11) has no member name",
      "record sample_long_double: member value: long double has no binding type",
      "record sample_holder: member bits: record sample_bits: member a is a bitfield",
      "alias sample_missing_alias: typedef sample_missing_alias is not declared by the headers",
      "function sample_vprint: parameter arguments: va_list",
      "function sample_print: is variadic: give each call shape's argument types in `variadic` (one spec entry per shape, `variant` names them)",
      `constant SAMPLE_HUGE: exceeds 2^53 on ${host} (18446744073709551615)`,
      `constant SAMPLE_NEGATIVE_DEFINE: is negative on ${host} (-3); constants are non-negative literals`,
    ]);
    assert.deepEqual(emission.opaque, [
      "the result: a returned function pointer is an address",
    ]);
    const text = emission.text;
    for (const fragment of [
      // Function pointers: an anonymous member's callback type, an inline
      // scoped callback, a returned function pointer as an address.
      /export type sample_hooks_callback = Callback<\(arg0: i32\) => i32>;/,
      /interface sample_hooks \{\s*callback: sample_hooks_callback;\s*\}/,
      /sample_register\(\s*callback: Callback<\(arg0: i32\) => i32>,\s*context: Ptr<void>,\s*\): void;/,
      /sample_lookup\(name: CString\): Address<void>;/,
      /type sample_word = u16;/,
      /export const SAMPLE_FLAG: 64;/,
      /export const SAMPLE_BIG: 0x123456789;/,
      /export const SAMPLE_GREEN: 5;/,
      /interface sample_hook \{\s*callback: Address<void>;\s*context: Address<void>;\s*\}/,
      /interface sample_packed extends Packed \{\s*tag: char;\s*value: i32;\s*\}/,
      /interface sample_aligned extends Aligned<16> \{\s*value: i32;\s*\}/,
      /interface sample_number extends Union \{\s*whole: i64;\s*real: f64;\s*\}/,
      /interface sample_nested \{\s*point: sample_nested_point;\s*either: sample_nested_either;\s*packed: FixedArray<sample_packed, 2>;\s*\}/,
      /interface sample_nested_either extends Union \{\s*i: i32;\s*f: f32;\s*\}/,
      // A self-reference is typed; an incomplete record is opaque.
      /interface sample_list \{\s*next: Address<sample_list>;\s*data: Address<void>;\s*\}/,
      /sample_print\$two\(\s*format: CString,\s*variadic0: Variadic<i32>,\s*variadic1: Variadic<f64>,\s*\): i32;/,
      // Enums take clang's width and signedness; typedef chains keep the
      // listed alias.
      /sample_pair\(\s*p: sample_float_pair,\s*c: u32,\s*s: i32,\s*w: sample_word,\s*\): sample_float_pair;/,
      /sample_register\$opaque\(\s*callback: Address<void>,\s*context: Ptr<void>,\s*\): void;/,
      /sample_flagged\(\s*bytes: Ptr<u8>,\s*buffer: Ptr<char>,\s*wide: Ptr<void>,\s*\): bool;/,
    ])
      assert.match(text, fragment);
    // Everything emitted matches clang again, through the oracle.
    const cTarget = cTargetOf(host!);
    const parsed = parseForeignDeclarations(text, cTarget);
    assert.ok(parsed.ok);
    const spellings = new Map(facts.records.map((item) => [item.name, item.c]));
    assert.deepEqual(
      layoutOracle(syntheticSpec, host!, cTarget, parsed.value, spellings),
      [],
    );
    assert.deepEqual(
      prototypeOracle(syntheticSpec, host!, cTarget, parsed.value),
      [],
    );
    // A callback whose prototype differs from C's function pointer.
    const wrong = parseForeignDeclarations(
      text.replace(
        "callback: Callback<(arg0: i32) => i32>",
        "callback: Callback<(arg0: i64, arg1: i32) => void>",
      ),
      cTarget,
    );
    assert.ok(wrong.ok);
    assert.deepEqual(
      prototypeOracle(syntheticSpec, host!, cTarget, wrong.value).map((line) =>
        line.replace(/declared .*, C /, "C "),
      ),
      [
        "function sample_register parameter callback: the callback takes 2 parameters, C passes 1",
        "function sample_register parameter callback callback parameter 0: C i4",
        "function sample_register parameter callback callback result: C i4",
      ],
    );
  },
);

test(
  "a freshly generated binding calls libc natively (LLDB)",
  clang,
  async () => {
    await verifySampleFixture();
  },
);

test("a registered allocator runs inside the generated zlib binding's may-callback calls (generational, LLDB)", () => {
  verifyGeneratedZlibAllocatorFixture();
});
test(
  "a registered allocator runs inside the generated zlib binding's may-callback calls (copying, LLDB)",
  {
    skip:
      nativeFixtureTarget().arch === "x86_64" &&
      "linux-x86_64 does not implement initializeCopyingRuntime",
  },
  () => {
    verifyGeneratedZlibAllocatorFixture("initializeCopyingRuntime");
  },
);

test("general code imports a generated binding where its exports cross a checked boundary (LLDB)", () => {
  const { general, blocked } = verifyGeneralBindingImport();
  assert.deepEqual(general, ["fixture"]);
  assert.match(
    blocked,
    /general code uses deflate of the trusted module fixture\/zlib-generated\.d\.ts, whose types cannot cross a checked boundary/,
  );
});
