import { prepareModuleInvocation } from "../src/modules/invocation.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSourceText } from "@tint/source/text";
import { parseModule, rewriteModule } from "@tint/typescript/syntax";
import { prepareModuleInstance } from "@tint/ts-native/modules";
import { bindModule } from "@tint/typescript/binding";
import { checkClosureModule } from "@tint/typescript/checker";

test("module instance preparation retains ordered state and stable function exports", () => {
  const bytes = new TextEncoder().encode(
    `let count=seed();function seed():number{return 7;}export function next():number{return ++count;}export function read():number{return count;}`,
  );
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const bound = bindModule(parsed.value);
  assert.ok(bound.ok);
  const prepared = prepareModuleInstance(parsed.value, bound.value, [
    { name: "next", local: "next" },
    { name: "read", local: "read" },
  ]);
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const checked = checkClosureModule(prepared.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
  assert.deepEqual(prepared.value.exports, ["next", "read"]);
  assert.equal(parsed.value.statements[0]?.kind, "variable");
  assert.equal(prepared.value.module.statements.at(-1)?.kind, "function");
});

function prepare(
  text: string,
  names: readonly string[],
  retained: readonly string[] = [],
) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const bound = bindModule(parsed.value, ["undefined"]);
  assert.ok(bound.ok, JSON.stringify(bound));
  return prepareModuleInstance(
    parsed.value,
    bound.value,
    names.map((name) => ({ name, local: name })),
    retained,
  );
}

test("module instance rejects missing, duplicate, generic and reassigned exports", () => {
  for (const [text, names, message] of [
    ["function f():number{return 1;}", ["missing"], "function declaration"],
    ["function f():number{return 1;}", ["f", "f"], "distinct"],
    ["function f<T>(x:T):T{return x;}", ["f"], "specialized"],
    [
      "function f():number{return 1;}function replace():void{f=():number=>2;}",
      ["f"],
      "live binding",
    ],
    ["import {f} from './other';", ["f"], "resolved imports"],
  ] as const) {
    const result = prepare(text, names);
    assert.ok(!result.ok);
    assert.ok(result.error.includes(message), result.error);
  }
});

test("module initializer names avoid source collisions and preserve optional export parameters", () => {
  const result = prepare(
    "const __tint_initialize=7;export function f(x:number=3):number{return x+__tint_initialize;}",
    ["f"],
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.initializer.name, "__tint_initialize_");
  const checked = checkClosureModule(result.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
  const type = result.value.initializer.returnType;
  assert.equal(type?.kind, "object");
  if (type?.kind !== "object") throw new Error("expected instance record");
  const fn = type.properties[0]?.type;
  assert.equal(fn?.kind, "function");
  if (fn?.kind !== "function") throw new Error("expected function field");
  assert.equal(fn.parameters[0]?.optional, true);
  assert.equal(fn.parameters[0]?.initializer, undefined);
});

test("module instances retain independent host or runtime declarations", () => {
  const result = prepare(
    "const offset=2;function helper(x:number):number{return x+offset;}let count=40;function run():number{return helper(count++);}",
    ["run"],
    ["helper", "offset"],
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(
    result.value.module.statements.some(
      (s) => s.kind === "function" && s.name === "helper",
    ),
  );
  const checked = checkClosureModule(result.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
  const invalid = prepare(
    "let count=40;function helper():number{return count;}function run():number{return helper();}",
    ["run"],
    ["helper"],
  );
  assert.ok(!invalid.ok);
  assert.match(invalid.error, /retained.*instance/);
});

test("module invocation forwards an export signature after initializing its state", () => {
  const prepared = prepare(
    "const base=20;export function run(n:number=22):number{return base+n;}",
    ["run"],
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const result = prepareModuleInvocation(prepared.value, "run");
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.entry.parameters[0]?.optional, true);
  const checked = checkClosureModule(result.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
  assert.equal(prepareModuleInvocation(prepared.value, "missing").ok, false);
});

test("retained dependency validation visits references in a bounded number of passes", () => {
  const retained = Array.from({ length: 40 }, (_, i) => `helper${i}`);
  const text =
    retained
      .map((name) => `function ${name}(value:number):number{return value+1;}`)
      .join("\n") + "\nfunction run():number{return helper0(41);}";
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const bound = bindModule(parsed.value);
  assert.ok(bound.ok);
  let visits = 0;
  const references = new Proxy(bound.value.references, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) visits++;
      return Reflect.get(target, key, receiver);
    },
  });
  const result = prepareModuleInstance(
    parsed.value,
    { ...bound.value, references },
    [{ name: "run", local: "run" }],
    retained,
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(
    visits <= bound.value.references.length * 3,
    `visited ${visits} references for ${bound.value.references.length} inputs`,
  );
});

test("module instance rejects classes until scoped contract and construction lowering are available", () => {
  const result = prepare(
    "let count=1;class Counter{value:number=0;constructor(){this.value=count++;}read():number{return this.value;}}export function next():number{return new Counter().read();}",
    ["next"],
  );
  assert.ok(!result.ok);
  assert.match(
    result.error,
    /classes require scoped contract and construction lowering/,
  );
});

function prepareGenerated(
  text: string,
  retained: readonly string[],
  shifted = false,
) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const module = rewriteModule(parsed.value, {
    statement: (node) => ({
      ...node,
      start: shifted ? 1000 : 0,
      end: shifted ? 1001 : 0,
      nodeHash: 0,
    }),
    expression: (node) => ({ ...node, start: 0, end: 0, nodeHash: 0 }),
    type: (node) => ({ ...node, start: 0, end: 0, nodeHash: 0 }),
  });
  const bound = bindModule(module);
  assert.ok(bound.ok, JSON.stringify(bound));
  return prepareModuleInstance(
    module,
    bound.value,
    [{ name: "run", local: "run" }],
    retained,
  );
}
test("retention follows AST identity when generated declarations and references share spans and hashes", () => {
  const result = prepareGenerated(
    "let count=40;function helper():number{return 2;}function run():number{return count+helper();}",
    ["helper"],
  );
  assert.ok(result.ok, JSON.stringify(result));
  const checked = checkClosureModule(result.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
});
test("retention rejects actual nested captures even when child positions lie outside the declaration span", () => {
  const result = prepareGenerated(
    "let count=40;function helper():()=>number{return ()=>count;}function run():number{return 42;}",
    ["helper"],
    true,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /instance state: count/);
});
test("retention tracks split variable initializers without admitting or blaming moved captures", () => {
  const invalid = prepareGenerated(
    "let count=40;const kept=():number=>count,moved=1;function run():number{return moved;}",
    ["kept"],
    true,
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.match(invalid.error, /instance state: count/);
  const valid = prepareGenerated(
    "let count=40;const kept=1,moved=():number=>count;function run():number{return moved();}",
    ["kept"],
    true,
  );
  assert.ok(valid.ok, JSON.stringify(valid));
  const checked = checkClosureModule(valid.value.module);
  assert.ok(checked.ok, JSON.stringify(checked));
});
