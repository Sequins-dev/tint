import { syntaxShapeJSON } from "./syntax-shape.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createSourceTextView } from "@tint/source/text";
import {
  parseScript,
  parseModule,
  parseDynamicFunction,
  rewriteModule,
  type Module,
  type Expression,
} from "@tint/typescript/syntax";
import * as lowering from "../src/lowering/index.ts";
function parse(source: string, module = false) {
  const result = module
    ? parseModule(createSourceTextView(source))
    : parseScript(createSourceTextView(source));
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
function lower(source: string, module = false) {
  const result = module
    ? lowering.lowerSourceTextModule(parse(source, true), source)
    : lowering.lowerScript(parse(source), source);
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
function calls(module: Module, name: string) {
  const result: Extract<Expression, { kind: "call" }>[] = [];
  rewriteModule(module, {
    expression(node) {
      if (
        node.kind === "call" &&
        node.callee.kind === "identifier" &&
        node.callee.name === name
      )
        result.push(node);
      return node;
    },
  });
  return result;
}

test("proposal import phases lower through Script, module, eval and Function entries", () => {
  for (const phase of ["source", "defer"]) {
    const source = "import." + phase + '("x");';
    const script = parse(source),
      parsed = parseDynamicFunction("normal", [], source);
    assert.ok(parsed.ok);
    const results = [
      lowering.lowerEvalScript(script, source),
      lowering.lowerDirectEvalScript(script, source, 0, {
        privateEnvironment: false,
        fieldInitializer: false,
      }),
      lowering.lowerDynamicFunctionImplementation(parsed.value),
      lowering.lowerScript(script, source),
      lowering.lowerSourceTextModule(parse(source, true), source),
    ];
    for (const result of results) {
      assert.ok(result.ok, JSON.stringify(result));
      const value = calls(result.value, "evaluateImportCall")[0]?.arguments[4];
      assert.equal(value?.kind, "string");
      if (value?.kind === "string") assert.equal(value.value, phase);
    }
  }
});
test("import-free lowering retains the caller-policy output contract", () => {
  const cases: [string, boolean, string][] = [
    ["42;", false, "1701798523d466c0"],
    ["function f(){ return a?.b(c); }", false, "c2ba37a6668f2c36"],
    [
      "async function g(){ await x; } function* k(){ yield 1; }",
      false,
      "74032e704242b891",
    ],
    ["new (f())(1); x = y ?? z;", false, "fc437856b61975c4"],
    ['eval("1");', false, "a127bc5b4136865d"],
    ["{ using r = null; }", false, "a814d3fc647f1bec"],
    [
      "export let a = 1; export function f(){ return a; }",
      true,
      "e696ad297742b294",
    ],
    ['import {x} from "./x"; export default x;', true, "ee255721ef820054"],
    ["export async function g(){ await 1; }", true, "5048934726531477"],
    ["export const o = {a(){ return this?.b; }};", true, "60eecb9bf5dd536f"],
  ];
  for (const [source, module, hash] of cases) {
    const result = module
      ? lowering.lowerSourceTextModule(parse(source, true), source)
      : lowering.lowerScript(parse(source), source);
    assert.equal(
      createHash("sha256")
        .update(module ? JSON.stringify(result) : syntaxShapeJSON(result))
        .digest("hex")
        .slice(0, 16),
      hash,
      source,
    );
  }
});
test("import operands are pinned in order and the runtime returns a plain value", () => {
  for (const module of [false, true]) {
    const output = lower("import(spec, options);", module),
      found = calls(output, "evaluateImportCall");
    assert.equal(found.length, 1);
    const call = found[0]!;
    assert.equal(call.arguments.length, 4);
    assert.equal(call.arguments[0]?.kind, "identifier");
    assert.equal(call.arguments[1]?.kind, "identifier");
    assert.notEqual(
      JSON.stringify(call.arguments[0]),
      JSON.stringify(call.arguments[1]),
    );
    assert.equal(call.arguments[2]?.kind, "member");
    assert.equal(call.arguments[3]?.kind, "identifier");
    if (call.arguments[3]?.kind === "identifier")
      assert.equal(call.arguments[3].name, "$errors");
    assert.equal(
      output.imports.filter((i) => i.specifier === "@tint/js-runtime/modules")
        .length,
      1,
    );
    const omitted = calls(
      lower("import(spec);", module),
      "evaluateImportCall",
    )[0]!;
    assert.equal(omitted.arguments[1]?.kind, "identifier");
    if (omitted.arguments[1]?.kind === "identifier")
      assert.equal(omitted.arguments[1].name, "undefined");
  }
});
test("module import.meta reads the active record without threading a module argument", () => {
  const output = lower(
    'export function f(){return import("x");} export const g=()=>import.meta;',
    true,
  );
  assert.equal(calls(output, "evaluateImportCall").length, 1);
  const meta = calls(output, "getActiveImportMeta");
  assert.equal(meta.length, 1);
  assert.equal(meta[0]?.arguments.length, 1);
  assert.ok(!JSON.stringify(output).includes('"name":"$module"'));
  const both = lower("import(import.meta);", true);
  assert.equal(calls(both, "getActiveImportMeta").length, 1);
  assert.equal(calls(both, "evaluateImportCall").length, 1);
});
test("dynamic import lowers through optional chains, callee positions and continuations", () => {
  for (const source of [
    'a?.[import("x")];',
    'import("x")?.p();',
    'new (import("x"))(1);',
    'import("x")();',
    "async function g(){return await import(await x);}",
    "function* h(){yield import(yield); }",
  ])
    for (const module of [false, true])
      assert.equal(
        calls(lower(source, module), "evaluateImportCall").length,
        1,
        source,
      );
  assert.equal(
    calls(
      lower(
        'class C { f=import.meta; static { import("x"); } m(){return import("x");}}',
        true,
      ),
      "evaluateImportCall",
    ).length,
    2,
  );
});
test("runtime vocabulary flags add only requested helpers and preserve the managed surface", () => {
  const span = { start: 0, end: 0 };
  const count = (imports: ReturnType<typeof lowering.scriptRuntimeImports>) =>
    imports.flatMap((i) => i.bindings).length;
  const script = lowering.scriptRuntimeImports(span),
    module = lowering.scriptRuntimeImports(span, false, false, false, "module");
  assert.equal(count(script), 114);
  assert.equal(count(module), 118);
  assert.equal(lowering.scriptRuntimeSurface().length, 136);
  assert.ok(
    lowering
      .scriptRuntimeSurface()
      .some((i) => i.specifier === "@tint/js-runtime/modules"),
  );
  assert.equal(
    count(
      lowering.scriptRuntimeImports(
        span,
        false,
        false,
        false,
        "script",
        false,
        true,
      ),
    ),
    115,
  );
  assert.equal(
    count(
      lowering.scriptRuntimeImports(
        span,
        false,
        false,
        false,
        "module",
        false,
        true,
        true,
      ),
    ),
    120,
  );
  for (const mode of [
    "indirect-eval",
    "direct-eval",
    "function",
    "all",
  ] as const) {
    const imports = lowering.scriptRuntimeImports(
      span,
      false,
      false,
      false,
      mode,
      false,
      true,
    );
    assert.ok(
      imports.some(
        (declaration) =>
          declaration.specifier === "@tint/js-runtime/modules" &&
          declaration.bindings.some(
            (binding) => binding.imported === "evaluateImportCall",
          ),
      ),
    );
  }
  for (const mode of [
    "script",
    "indirect-eval",
    "direct-eval",
    "function",
    "all",
  ] as const)
    assert.throws(
      () =>
        lowering.scriptRuntimeImports(
          span,
          false,
          false,
          false,
          mode,
          false,
          false,
          true,
        ),
      (error) => error === "SCRIPT_IMPORT_INVARIANT",
    );
});

test("eval and dynamic function entries import through their active Script or module", () => {
  const source = "import(spec(), options());";
  const parsed = parseDynamicFunction("normal", [], source);
  assert.ok(parsed.ok);
  const results = [
    lowering.lowerEvalScript(parse(source), source),
    lowering.lowerDirectEvalScript(parse(source), source, 0, {
      privateEnvironment: false,
      fieldInitializer: false,
    }),
    lowering.lowerDynamicFunctionImplementation(parsed.value),
  ];
  for (const result of results) {
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(calls(result.value, "evaluateImportCall").length, 1);
    assert.ok(
      result.value.imports.some(
        (declaration) =>
          declaration.specifier === "@tint/js-runtime/modules" &&
          declaration.bindings.some(
            (binding) => binding.imported === "evaluateImportCall",
          ),
      ),
    );
    assert.equal(calls(result.value, "callObjectValue").length, 2);
    const imported = calls(result.value, "evaluateImportCall")[0]!;
    assert.equal(imported.arguments.length, 4);
    assert.notDeepEqual(imported.arguments[0], imported.arguments[1]);
  }
});

test("source import lowering pins operands and passes the source phase to the shared helper", () => {
  for (const module of [false, true]) {
    const output = lower("import.source(spec, options);", module);
    const found = calls(output, "evaluateImportCall");
    assert.equal(found.length, 1);
    assert.equal(found[0]?.arguments.length, 5);
    const phase = found[0]?.arguments[4];
    assert.equal(phase?.kind, "string");
    if (phase?.kind === "string") assert.equal(phase.value, "source");
  }
});

test("native module factories retain source phases in their emitted shape", () => {
  const output = lower('import source value from "m"; export {value};', true);
  let retained = false;
  rewriteModule(output, {
    expression(node) {
      if (node.kind === "object")
        for (const property of node.properties)
          if (
            property.kind !== "spread" &&
            property.name === "phase" &&
            property.value.kind === "string" &&
            property.value.value === "source"
          )
            retained = true;
      return node;
    },
  });
  assert.equal(retained, true);
});

test("dynamic deferred imports pass their phase through Script, module and runtime-compiled entries", () => {
  for (const module of [false, true]) {
    const output = lower('import.defer("m");', module),
      found = calls(output, "evaluateImportCall");
    const phase = found[0]?.arguments[4];
    assert.equal(phase?.kind, "string");
    if (phase?.kind === "string") assert.equal(phase.value, "defer");
  }
});
