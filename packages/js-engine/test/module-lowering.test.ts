import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import {
  parseModule,
  parameterIdentifiers,
  rewriteModule,
  type Module,
} from "@tint/typescript/syntax";
import * as lowering from "../src/lowering/index.ts";
function parse(source: string) {
  const result = parseModule(createSourceTextView(source));
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
function lower(source: string) {
  const result = lowering.lowerSourceTextModule(parse(source), source);
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
function calls(module: Module) {
  const result: string[] = [];
  rewriteModule(module, {
    expression(node) {
      if (node.kind === "call" && node.callee.kind === "identifier")
        result.push(node.callee.name);
      return node;
    },
  });
  return result;
}
test("modules export a factory over the shared runtime without Script entry or global declaration setup", () => {
  assert.equal(typeof lowering.lowerSourceTextModule, "function");
  const module = lower(
    "export var v=1;export let l;export function f(){return v;} this;",
  );
  const entries = module.statements.filter(
    (statement) => statement.kind === "function" && statement.exported,
  );
  assert.equal(entries.length, 1);
  const create = entries[0];
  assert.ok(create?.kind === "function");
  assert.equal(create.name, "create");
  assert.deepEqual(
    create.parameters.flatMap((parameter) =>
      parameterIdentifiers(parameter).map((identifier) => identifier.name),
    ),
    ["$global", "$errors", "$hostDefined"],
  );
  assert.ok(
    module.imports.some(
      (entry) => entry.specifier === "@tint/js-runtime/modules",
    ),
  );
  assert.ok(
    !module.imports.some((entry) =>
      entry.bindings.some(
        (binding) => binding.local === "instantiateGlobalDeclarations",
      ),
    ),
  );
  const names = calls(module);
  assert.ok(names.includes("createLoweredSourceModule"));
  assert.ok(!names.includes("runScriptContext"));
  assert.ok(!names.includes("instantiateGlobalDeclarations"));
  const serialized = JSON.stringify(module);
  assert.ok(!serialized.includes('"name":"$script"'));
  assert.ok(serialized.includes('"name":"$environment"'));
  assert.equal(lowering.scriptRuntimeSurface().length, 143);
});
test("module this is undefined while ordinary function receivers keep their own binding", () => {
  const module = lower(
    "export const top=this;export function f(){return this;}",
  );
  const result = JSON.stringify(module);
  assert.ok(result.includes('"name":"undefined"'));
  assert.ok(result.includes('"name":"$receiver'));
});
test("module binding errors remain genuine early errors", () => {
  for (const source of ["let a;export {a};export {a};", "export {missing};"]) {
    const result = lowering.lowerSourceTextModule(parse(source), source);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "EARLY_ERROR");
  }
});
test("module lowering covers imports, destructuring, hoisted/default declarations and top-level disposal", () => {
  for (const source of [
    'import d,{x as v} from "m";export {v};export let {a,b:[c]}=d;export function f(){return v;}export class C{};using resource=null;',
    "export default function f(){f=1;return f;}",
    "export default function*(){yield 1;}",
    "export default async function(){await 1;}",
    "export default class C{}",
    "export default (function(){});",
  ])
    lower(source);
  const module = lower("using resource=null;export const x=42;");
  const names = calls(module);
  assert.ok(names.includes("disposeLexicalResources"));
  assert.ok(names.includes("registerLexicalDisposable"));
});
test("template sites are allocated by each module factory rather than shared across records", () => {
  const module = lower("export function f(tag){return tag`x`;}");
  assert.ok(
    !module.statements.some((statement) => statement.kind === "variable"),
  );
  const create = module.statements.find(
    (statement) => statement.kind === "function",
  );
  assert.ok(create?.kind === "function");
  assert.equal(create.body.kind, "block");
  if (create.body.kind !== "block") assert.fail("factory body");
  assert.ok(
    create.body.statements.some(
      (statement) =>
        statement.kind === "variable" &&
        statement.declarations.some(
          (declaration) =>
            declaration.kind === undefined &&
            declaration.name.startsWith("$templateSite"),
        ),
    ),
  );
});

test("module normal completion is formed after top-level resource cleanup", () => {
  const module = lower("using resource=null;export const result=42;");
  const create = module.statements.find(
    (statement) => statement.kind === "function",
  );
  assert.ok(create?.kind === "function" && create.body.kind === "block");
  const returned = create.body.statements.find(
    (statement) => statement.kind === "return",
  );
  assert.ok(
    returned?.kind === "return" && returned.expression?.kind === "call",
  );
  const execute = returned.expression.arguments[6];
  assert.ok(execute?.kind === "arrow" && execute.body.kind === "block");
  const handled = execute.body.statements[0];
  assert.ok(handled?.kind === "try");
  assert.equal(handled.body.statements.at(-1)?.kind, "return");
});

test("exported function and class source retention excludes the export wrapper", () => {
  const module = lower(
    "export function f(){} export async function af(){} export function* g(){} export class C{}",
  );
  const retained: string[] = [];
  rewriteModule(module, {
    expression(node) {
      if (
        node.kind === "call" &&
        node.callee.kind === "identifier" &&
        node.callee.name === "retainFunctionSource"
      ) {
        const source = node.arguments[1];
        if (source?.kind === "string") retained.push(source.value);
      }
      return node;
    },
  });
  for (const source of [
    "function f(){}",
    "async function af(){}",
    "function* g(){}",
    "class C{}",
  ])
    assert.ok(retained.includes(source), JSON.stringify(retained));
});
