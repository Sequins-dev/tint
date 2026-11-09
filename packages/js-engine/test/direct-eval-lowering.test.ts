import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import {
  parseEvalScript,
  rewriteModule,
  type Module,
  type Expression,
} from "@tint/typescript/syntax";
import * as lowering from "../src/lowering/index.ts";
function lower(source: string, flags = 2) {
  const parsed = parseEvalScript(createSourceTextView(source), {
    strict: (flags & 1) !== 0,
    newTarget: (flags & 2) !== 0,
    superProperty: (flags & 4) !== 0,
    superCall: (flags & 8) !== 0,
  });
  assert.ok(parsed.ok, JSON.stringify(parsed));
  assert.equal(typeof lowering.lowerDirectEvalScript, "function");
  const result = lowering.lowerDirectEvalScript(parsed.value, source, flags, {
    privateEnvironment: (flags & 64) !== 0,
    fieldInitializer: (flags & 32) !== 0,
  });
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
function calls(module: Module, name: string) {
  const found: Extract<Expression, { kind: "call" }>[] = [];
  rewriteModule(module, {
    expression(node) {
      if (
        node.kind === "call" &&
        node.callee.kind === "identifier" &&
        node.callee.name === name
      )
        found.push(node);
      return node;
    },
  });
  return found;
}
function variables(value: unknown): any[] {
  if (Array.isArray(value)) return value.flatMap(variables);
  if (value === null || typeof value !== "object") return [];
  const x = value as Record<string, any>;
  return [
    ...(x.kind === "variable" ? x.declarations : []),
    ...Object.values(x).flatMap(variables),
  ];
}
test("direct eval views the caller site before entering its catchable body", () => {
  const module = lower("var v=40;let local=2;v+local");
  const entry = module.statements.find(
    (x) => x.kind === "function" && x.name === "execute",
  );
  assert.ok(entry?.kind === "function" && entry.body.kind === "block");
  const view = calls(module, "viewDirectEvalSite");
  assert.equal(view.length, 1);
  assert.equal(view[0]?.arguments[0]?.kind, "member");
  const names = variables(entry.body).map((x) => x.name);
  assert.ok(names.includes("$site"));
  assert.equal(entry.body.statements[1]?.kind, "variable");
  assert.equal(entry.body.statements[2]?.kind, "if");
  const declarations = calls(module, "instantiateDirectEvalDeclarations");
  assert.equal(declarations.length, 1);
  assert.equal(declarations[0]?.arguments.length, 5);
  assert.equal(calls(module, "instantiateEvalDeclarations").length, 0);
  assert.equal(calls(module, "instantiateGlobalDeclarations").length, 0);
});
test("sloppy direct eval layers fresh lexical storage over the caller scopes", () => {
  const module = lower("var v=1;eval(7);this;new.target");
  const vars = variables(module);
  const scope = vars.find((x) => x.name === "$scope");
  assert.equal(scope.initializer.callee.name, "createDeclarativeScope");
  assert.equal(scope.initializer.arguments[0].object.name, "$site");
  assert.equal(scope.initializer.arguments[0].property, "lexical");
  const declaration = calls(module, "instantiateDirectEvalDeclarations")[0];
  assert.equal((declaration?.arguments[1] as any).property, "variables");
  assert.equal((declaration?.arguments[2] as any).property, "catches");
  const nested = vars.find((x) => x.type?.name === "DirectEvalSite");
  assert.ok(nested);
  const fields = Object.fromEntries(
    nested.initializer.properties.map((x: any) => [x.name, x.value]),
  );
  assert.equal(fields.scriptOrModule.property, "scriptOrModule");
  assert.equal(fields.catches.property, "catches");
  assert.equal(fields.thisValue.property, "thisValue");
  assert.equal(fields.newTarget.property, "newTarget");
  assert.equal(
    (calls(module, "callEvalCandidate")[0]?.arguments[5] as any).value,
    2,
  );
});
test("strict direct eval uses its fresh scope for both var and lexical declarations", () => {
  const module = lower("'use strict';var v=1;eval(7)");
  const declaration = calls(module, "instantiateDirectEvalDeclarations")[0];
  assert.equal((declaration?.arguments[1] as any).name, "$scope");
  assert.equal((declaration?.arguments[4] as any).value, true);
  const nested = variables(module).find(
    (x) => x.type?.name === "DirectEvalSite",
  );
  const catches = nested.initializer.properties.find(
    (x: any) => x.name === "catches",
  );
  assert.equal(catches.value.name, "undefined");
});
test("direct eval entry binding preserves early errors", () => {
  const parsed = parseEvalScript(createSourceTextView("let x;var x"), {
    strict: false,
    newTarget: true,
    superProperty: false,
    superCall: false,
  });
  assert.ok(parsed.ok);
  const result = lowering.lowerDirectEvalScript(
    parsed.value,
    "let x;var x",
    2,
    { privateEnvironment: false, fieldInitializer: false },
  );
  assert.ok(!result.ok);
  assert.equal(result.error.code, "EARLY_ERROR");
});

test("method eval narrows its home before calling the body", () => {
  const module = lower("super.x;super[k]=v", 7);
  const home = variables(module).find((x) => x.name === "$home");
  assert.ok(home);
  assert.equal(home.initializer.property, "home");
});
test("derived eval reads this lazily and preserves super construction", () => {
  const module = lower("this;()=>this;super();eval(7)", 15);
  assert.ok(calls(module, "getDerivedThis").length >= 2);
  const construct = calls(module, "constructSuper")[0];
  assert.equal((construct?.arguments[0] as any).name, "$derived");
  const base = variables(module).find(
    (x) => x.name === (construct?.arguments[1] as any).name,
  );
  assert.equal(base.initializer.object.name, "$activeFunction");
  const site = variables(module).find((x) => x.type?.name === "DirectEvalSite");
  const f = Object.fromEntries(
    site.initializer.properties.map((x: any) => [x.name, x.value]),
  );
  assert.equal(f.thisValue.name, "undefined");
  assert.equal(f.derived.name, "$derived");
  assert.equal(f.activeFunction.name, "$activeFunction");
  assert.equal(calls(lower("1", 15), "getDerivedThis").length, 0);
  assert.equal(
    variables(lower("1", 3)).some(
      (x) => x.name === "$home" || x.name === "$derived",
    ),
    false,
  );
});

test("private eval resolves external identities before declarations and preserves nested carriers", () => {
  const module = lower(
    "this.#x;function unused(){return this.#y}eval('1')",
    71,
  );
  const lookups = calls(module, "resolveDirectEvalPrivateName");
  assert.equal(lookups.length, 2);
  assert.deepEqual(
    lookups.map((x) => (x.arguments[1] as any).value),
    ["#x", "#y"],
  );
  assert.equal((lookups[0]?.arguments[0] as any).name, "$privateEnvironment");
  const site = variables(module).find((x) => x.type?.name === "DirectEvalSite");
  const f = Object.fromEntries(
    site.initializer.properties.map((x: any) => [x.name, x.value]),
  );
  assert.equal(f.privateEnvironment.name, "$privateEnvironment");
  assert.equal(
    calls(
      lower("class C{#x;m(){return this.#x}}", 71),
      "resolveDirectEvalPrivateName",
    ).length,
    0,
  );
});

test("runtime-compiled entries run inline with fused results and no per-operation slots", () => {
  const module = lower("({['foo' + 0]: 'ok', ['foo' + 1]: 'ok', x: o.p});", 0);
  // The body runs between the two halves of runScriptContext.
  assert.equal(calls(module, "runScriptContext").length, 0);
  assert.equal(calls(module, "enterScriptContext").length, 1);
  assert.equal(calls(module, "leaveScriptContext").length, 1);
  // Generic operations complete through fused helpers, not result records.
  assert.equal(calls(module, "objectPropertyKeyOrThrow").length, 2);
  assert.equal(calls(module, "binaryObjectValueOperationOrThrow").length, 2);
  // Static property reads use the shared throwing read helper.
  assert.equal(calls(module, "readObjectValueProperty").length, 1);
  assert.equal(calls(module, "throwIfRuntimeError").length, 1);
  // Global hooks are read once, not once per operation.
  const serialized = JSON.stringify(module);
  assert.equal(serialized.split('"property":"hooks"').length - 1, 1);
  // Only string literals (shared literal tables) and multi-use values stay
  // named: the computed keys forward into their single consumers.
  const named: string[] = [];
  rewriteModule(module, {
    statement(node) {
      if (node.kind === "variable" && node.mode === "const")
        for (const declaration of node.declarations)
          if (
            declaration !== undefined &&
            declaration.kind !== "object-binding" &&
            declaration.kind !== "array-binding" &&
            declaration.name.startsWith("$value") &&
            declaration.initializer?.kind !== "string"
          )
            named.push(declaration.name);
      return node;
    },
  });
  assert.equal(named.length, 1, named.join());
});

test("runtime-compiled functions skip only unobservable receiver and environment setup", () => {
  const module = lower(
    [
      "({",
      "  plain() { return 'ok'; },",
      "  self() { return this; },",
      "  arrow() { return () => this; },",
      "  sup() { return super.x; },",
      "  evals() { return eval('1'); },",
      "  param(a) { return 1; },",
      "  local() { var v = 1; return v; },",
      "  args() { return arguments; },",
      "});",
    ].join("\n"),
    0,
  );
  const functions = calls(module, "createRetainedSourceFunction");
  // One fused call names, creates and retains each function.
  assert.equal(calls(module, "createSourceFunction").length, 0);
  assert.equal(calls(module, "retainFunctionSource").length, 0);
  assert.equal(functions.length, 9);
  const byName = new Map<string, Expression>();
  for (const fn of functions) {
    const name = fn.arguments[4];
    const callback = fn.arguments[0];
    assert.ok(name?.kind === "string" && callback !== undefined);
    byName.set(name.value, callback);
  }
  const uses = (name: string, helper: string) => {
    const callback = byName.get(name);
    assert.ok(callback);
    return JSON.stringify(callback).includes(`"name":"${helper}"`);
  };
  // Receiver conversion only where this, super or direct eval can read it.
  assert.equal(uses("plain", "sloppyCallReceiverOrThrow"), false);
  assert.equal(uses("param", "sloppyCallReceiverOrThrow"), false);
  for (const name of ["self", "arrow", "sup", "evals"])
    assert.equal(uses(name, "sloppyCallReceiverOrThrow"), true, name);
  // Environments only where something is bound in them.
  assert.equal(uses("plain", "createDeclarativeEnvironment"), false);
  assert.equal(uses("self", "createDeclarativeEnvironment"), false);
  for (const name of ["evals", "param", "local", "args"])
    assert.equal(uses(name, "createDeclarativeEnvironment"), true, name);
});
