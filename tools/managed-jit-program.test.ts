import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import {
  parseModule,
  type Module,
  type Statement,
} from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import {
  reifyManagedSurfaceTypes,
  adaptManagedSurfaceEntry,
} from "@tint/compiler/native";
import { runtimeSources } from "@tint/compiler/cli";
import { workspaceModules } from "./workspace-sources.ts";
import * as program from "../packages/compiler/src/native/managed-jit-program.ts";
import { declareManagedJitRuntime } from "../packages/compiler/src/native/managed-jit-runtime.ts";
function parse(text: string): Module {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok);
  return parsed.value;
}
function adapted() {
  const checked = checkClosureModule(
    parse(
      "interface Frame{readonly $imports:unknown;readonly $argument0:number;}function add(a:number,b:number):number{return a+b;}",
    ),
  );
  assert.ok(checked.ok);
  const surface = reifyManagedSurfaceTypes(
    checked.value,
    [{ name: "add", local: "add" }],
    "$Surface",
    [{ name: "Frame", local: "Frame" }],
  );
  assert.ok(surface.ok);
  const result = adaptManagedSurfaceEntry(
    parse(
      'import {add} from "runtime";export function execute(x:number):number{return add(x,2);}',
    ),
    "execute",
    "runtime",
    surface.value,
    { frame: "Frame" },
  );
  assert.ok(result.ok);
  assert.ok(result.value.view);
  return { entry: result.value, surface: surface.value };
}
test("managed JIT preparation resolves wrapper, view and aliases in the final collection graph", () => {
  assert.equal(typeof program.prepareManagedJitProgram, "function");
  const input = adapted(),
    runtimes = runtimeSources();
  const before = JSON.stringify(input.entry.module);
  const result = program.prepareManagedJitProgram(
    input.entry.module,
    input.entry.entry,
    input.entry.view!,
    input.surface.declarations.map((s) => {
      assert.ok(s.kind === "type-alias" || s.kind === "interface");
      return s.name;
    }),
    {
      modules: workspaceModules(runtimes.map((r) => r.module)),
      runtimes,
      globals: [
        "undefined",
        "NaN",
        "Infinity",
        "Array",
        "String",
        "Boolean",
        "ArrayBuffer",
        "SharedArrayBuffer",
        "DataView",
        "Math",
        "Number",
        "Map",
        "Set",
        "Uint8Array",
        "Uint16Array",
        "Uint32Array",
        "Float64Array",
        "TextEncoder",
        "TextDecoder",
        "TypeError",
        "RangeError",
      ],
    },
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(JSON.stringify(input.entry.module), before);
  const value = result.value;
  assert.notEqual(value.entry, value.view);
  assert.ok(value.checked.bindings.functions[value.entry]);
  assert.ok(value.checked.bindings.functions[value.view]);
  assert.equal(value.aliasTypes.size, input.surface.declarations.length);
  for (const type of value.aliasTypes.values())
    assert.ok(value.checked.types[type]);
});
test("managed JIT preparation rejects missing entry and duplicate runtime namespaces", () => {
  assert.equal(typeof program.prepareManagedJitProgram, "function");
  const input = adapted();
  const missing = program.prepareManagedJitProgram(
    input.entry.module,
    "Missing",
    input.entry.view!,
    [],
    { modules: [], runtimes: [], globals: ["undefined"] },
  );
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /entry.*missing/);
  const repeated = program.prepareManagedJitProgram(
    input.entry.module,
    input.entry.entry,
    input.entry.view!,
    [],
    {
      modules: [],
      runtimes: [
        { module: "a", namespace: "sparse-list" },
        { module: "b", namespace: "sparse-list" },
      ],
      globals: ["undefined"],
    },
  );
  assert.equal(repeated.ok, false);
  if (!repeated.ok) assert.match(repeated.error, /duplicate runtime/);
});

test("managed JIT lowering retains checked identities and the managed-call ABI", () => {
  assert.equal(typeof program.lowerManagedJitProgram, "function");
  const input = adapted();
  const prepared = program.prepareManagedJitProgram(
    input.entry.module,
    input.entry.entry,
    input.entry.view!,
    [],
    { modules: [], runtimes: [], globals: ["undefined"] },
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const lowered = program.lowerManagedJitProgram(prepared.value);
  assert.ok(lowered.ok, JSON.stringify(lowered));
  const value = lowered.value,
    fn = value.module.functions[value.entry];
  assert.ok(fn);
  assert.equal(fn.returnType, "general");
  assert.equal(fn.parameters.length, 1);
  assert.equal(fn.slots[fn.parameters[0]!], "reference");
  assert.equal(value.sources[value.entry], prepared.value.entry);
  assert.ok(
    value.module.functions
      .flatMap((fn) => fn.blocks.flatMap((block) => block.instructions))
      .some((op) => op.kind === "general-record-is"),
  );
});

test("managed JIT lowering rejects a wrapper using a private scalar result ABI", () => {
  const input = adapted();
  const module = {
    ...input.entry.module,
    statements: input.entry.module.statements.map((statement) =>
      statement.kind === "function" && statement.name === input.entry.entry
        ? {
            ...statement,
            returnType: {
              start: 0,
              end: 0,
              kind: "named" as const,
              name: "number",
            },
          }
        : statement,
    ),
  };
  const prepared = program.prepareManagedJitProgram(
    module,
    input.entry.entry,
    input.entry.view!,
    [],
    { modules: [], runtimes: [], globals: ["undefined"] },
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const lowered = program.lowerManagedJitProgram(prepared.value);
  assert.equal(lowered.ok, false);
  if (!lowered.ok) assert.match(lowered.error, /managed entry ABI differs/);
});

test("managed JIT frame agreement compares exact parameter types after checking", () => {
  assert.equal(typeof program.verifyManagedJitFrame, "function");
  const input = adapted();
  const frame = input.surface.types[0]!.type;
  assert.ok(frame.kind === "named");
  const aliases = input.surface.declarations.map((statement) => {
    assert.ok(
      statement.kind === "type-alias" || statement.kind === "interface",
    );
    return statement.name;
  });
  const prepared = program.prepareManagedJitProgram(
    input.entry.module,
    input.entry.entry,
    input.entry.view!,
    aliases,
    { modules: [], runtimes: [], globals: ["undefined"] },
  );
  assert.ok(prepared.ok);
  const agreed = program.verifyManagedJitFrame(prepared.value, frame.name);
  assert.ok(agreed.ok, JSON.stringify(agreed));
  const widened = adaptManagedSurfaceEntry(
    parse("export function execute(x:number|undefined):number{return x??0;}"),
    "execute",
    "runtime",
    input.surface,
    { frame: "Frame" },
  );
  assert.ok(widened.ok);
  assert.ok(widened.value.view);
  const wideProgram = program.prepareManagedJitProgram(
    widened.value.module,
    widened.value.entry,
    widened.value.view,
    aliases,
    { modules: [], runtimes: [], globals: ["undefined"] },
  );
  assert.ok(wideProgram.ok, JSON.stringify(wideProgram));
  const rejected = program.verifyManagedJitFrame(wideProgram.value, frame.name);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.error, /entry parameter differs/);
  assert.equal(
    program.verifyManagedJitFrame(prepared.value, "Missing").ok,
    false,
  );
  assert.equal(
    program.verifyManagedJitFrame({ ...prepared.value, entry: -1 }, frame.name)
      .ok,
    false,
  );
});
test("JIT runtime declarations keep provider signatures and replace only block bodies", () => {
  const source = parse(
    "export type Pair={readonly left:number};const seed:number=4;export function make(value:number):Pair{const local:number[]=[value];return {left:local[0]??seed};}function helper(value:number):number{return value+1;}",
  );
  const runtime = {
    modules: [{ id: "provider", module: source, dependencies: new Map() }],
    runtimes: [],
    globals: ["undefined"],
  };
  const before = JSON.stringify(runtime.modules[0]?.module);
  const declared = declareManagedJitRuntime(runtime);
  assert.equal(JSON.stringify(runtime.modules[0]?.module), before);
  assert.equal(declared.runtimes, runtime.runtimes);
  assert.equal(declared.globals, runtime.globals);
  const module: Module | undefined = declared.modules[0]?.module;
  assert.ok(module);
  assert.equal(module.statements.length, source.statements.length);
  for (let index = 0; index < source.statements.length; index++) {
    const original: Statement | undefined = source.statements[index],
      result: Statement | undefined = module.statements[index];
    assert.ok(original && result);
    if (original.kind !== "function") {
      assert.equal(result, original);
      continue;
    }
    assert.ok(result.kind === "function");
    assert.equal(result.name, original.name);
    assert.equal(result.exported, original.exported);
    assert.equal(result.parameters, original.parameters);
    assert.equal(result.returnType, original.returnType);
    assert.ok(result.body.kind === "block");
    assert.deepEqual(
      result.body.statements.map(
        (statement: Statement | undefined) => statement?.kind,
      ),
      ["throw"],
    );
  }
  const checked = checkClosureModule(module);
  assert.ok(checked.ok, JSON.stringify(checked));
});
