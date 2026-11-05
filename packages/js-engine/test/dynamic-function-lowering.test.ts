import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDynamicFunction,
  rewriteModule,
  type Module,
  type Expression,
} from "@tint/typescript/syntax";
import * as lowering from "../src/lowering/index.ts";
function lower(parameters: string[], body: string) {
  const parsed = parseDynamicFunction("normal", parameters, body);
  assert.ok(parsed.ok);
  assert.equal(typeof lowering.lowerDynamicFunctionImplementation, "function");
  const result = lowering.lowerDynamicFunctionImplementation(parsed.value);
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
test("dynamic implementation returns a non-constructible carrier without Script declarations", () => {
  const module = lower(["a=1", "...rest"], "return a+rest.length");
  assert.equal(calls(module, "instantiateGlobalDeclarations").length, 0);
  assert.equal(calls(module, "instantiateEvalDeclarations").length, 0);
  for (const imported of module.imports.flatMap((i) => i.bindings))
    assert.ok(
      ![
        "instantiateGlobalDeclarations",
        "instantiateEvalDeclarations",
      ].includes(imported.imported),
    );
  const carrier = calls(module, "createSourceFunction").at(-1)!;
  assert.ok(carrier);
  assert.deepEqual(carrier.arguments[1], {
    start: carrier.start,
    end: carrier.end,
    kind: "boolean",
    value: false,
  });
  assert.equal(carrier.arguments[5]?.kind, "number");
  assert.equal((carrier.arguments[5] as { value: number }).value, 0);
  const callback = carrier.arguments[0];
  assert.equal(callback?.kind, "arrow");
  if (callback?.kind !== "arrow") return;
  assert.equal(callback.parameters.length, 4);
  const nodes: Expression[] = [];
  rewriteModule(module, {
    expression(node) {
      nodes.push(node);
      return node;
    },
  });
  assert.ok(nodes.some((n) => n.kind === "member" && n.property === "push"));
  assert.ok(
    nodes.some(
      (n) =>
        n.kind === "index" && n.index.kind === "number" && n.index.value === 0,
    ),
  );
  assert.ok(
    nodes.some(
      (n) =>
        n.kind === "index" && n.index.kind === "number" && n.index.value === 1,
    ),
  );
});
test("dynamic body retains constructor identity and nested source spans", () => {
  const module = lower(
    [],
    "return function inner(){ /* exact */ return anonymous; }",
  );
  const retained = calls(module, "retainFunctionSource").map(
    (c) => c.arguments[1],
  );
  assert.ok(
    retained.some(
      (n) =>
        n?.kind === "string" &&
        n.value === "function inner(){ /* exact */ return anonymous; }",
    ),
  );
  const context = calls(module, "runScriptContext")[0];
  assert.ok(context);
  assert.match(JSON.stringify(context.arguments[1]), /hostDefined/);
  const names = calls(module, "resolveBinding").map((c) => c.arguments[1]);
  assert.ok(names.some((n) => n?.kind === "string" && n.value === "anonymous"));
  assert.ok(
    !calls(module, "createBinding").some((c) =>
      c.arguments.some((n) => n.kind === "string" && n.value === "anonymous"),
    ),
  );
});
for (const [params, body] of [
  [[], "return new.target"],
  [["a"], "arguments[0]=2;return a"],
  [["{x}=({x:1})", "...rest"], "return x+rest.length"],
  [[], "'use strict'; return this"],
] as [string[], string][])
  test("dynamic implementation covers " + body, () => {
    lower(params, body);
  });
test("dynamic implementation rejects unsupported class elements explicitly", () => {
  const syntax = parseDynamicFunction(
    "normal",
    [],
    "return class { accessor x=1 }",
  );
  assert.ok(syntax.ok);
  assert.equal(typeof lowering.lowerDynamicFunctionImplementation, "function");
  const result = lowering.lowerDynamicFunctionImplementation(syntax.value);
  assert.ok(!result.ok);
  assert.equal(result.error.code, "UNSUPPORTED");
});

test("async dynamic bodies lower through a packed continuation carrier", () => {
  const parsed = parseDynamicFunction(
    "async",
    ["a=1", "...rest"],
    "return await a+rest.length",
  );
  assert.ok(parsed.ok);
  const result = lowering.lowerDynamicFunctionImplementation(parsed.value);
  assert.ok(result.ok, JSON.stringify(result));
  const carrier = calls(
    result.value,
    "createSourceAsyncContinuationFunction",
  ).at(-1);
  assert.ok(carrier);
  assert.equal(carrier.arguments[0]?.kind, "arrow");
  if (carrier.arguments[0]?.kind === "arrow")
    assert.equal(carrier.arguments[0].parameters.length, 4);
  assert.equal(calls(result.value, "instantiateGlobalDeclarations").length, 0);
  assert.equal(calls(result.value, "instantiateEvalDeclarations").length, 0);
});

test("generator dynamic bodies use a packed initializer with three callback arguments", () => {
  const parsed = parseDynamicFunction(
    "generator",
    ["a=1", "...rest"],
    "yield a;return rest.length",
  );
  assert.ok(parsed.ok);
  const lowered = lowering.lowerDynamicFunctionImplementation(parsed.value);
  assert.ok(lowered.ok, JSON.stringify(lowered));
  const carrier = calls(lowered.value, "createSourceGeneratorFunction").at(-1);
  assert.ok(carrier);
  assert.equal(carrier.arguments[0]?.kind, "arrow");
  if (carrier.arguments[0]?.kind === "arrow")
    assert.equal(carrier.arguments[0].parameters.length, 3);
});

test("async generator dynamic bodies use a packed three-argument initializer", () => {
  const parsed = parseDynamicFunction(
    "async-generator",
    ["a=1", "...rest"],
    "yield await a;yield* rest",
  );
  assert.ok(parsed.ok);
  const result = lowering.lowerDynamicFunctionImplementation(parsed.value);
  assert.ok(result.ok, JSON.stringify(result));
  const carrier = calls(result.value, "createSourceAsyncGeneratorFunction").at(
    -1,
  );
  assert.ok(carrier);
  assert.equal(carrier.arguments[0]?.kind, "arrow");
  if (carrier.arguments[0]?.kind === "arrow")
    assert.equal(carrier.arguments[0].parameters.length, 3);
});
