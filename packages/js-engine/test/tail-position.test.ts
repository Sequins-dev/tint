import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import { parseScript } from "@tint/typescript/syntax";
import { collectTailCalls } from "../src/lowering/tail-position.ts";

function selected(
  body: string,
  options = { strict: true, async: false, generator: false },
) {
  const source = `function f(){${body}}`;
  const parsed = parseScript(createSourceTextView(source));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const fn = parsed.value.statements[0];
  assert.ok(fn?.kind === "function" && fn.body.kind === "block");
  return [...collectTailCalls(fn.body, options)].map((node) =>
    source.slice(node.start, node.end),
  );
}

test("only strict ordinary bodies admit tail calls", () => {
  assert.deepEqual(selected("return g();"), ["g()"]);
  for (const options of [
    { strict: false, async: false, generator: false },
    { strict: true, async: true, generator: false },
    { strict: true, async: false, generator: true },
    { strict: true, async: true, generator: true },
  ])
    assert.deepEqual(selected("return g();", options), []);
});

test("only the last value-producing call transfers", () => {
  assert.deepEqual(selected("return getF()(argument());"), [
    "getF()(argument())",
  ]);
  assert.deepEqual(selected("return a() ? (b(), c()) : d() && e();"), [
    "c()",
    "e()",
  ]);
  assert.deepEqual(selected("return (a() || b()) ?? c();"), ["c()"]);
  assert.deepEqual(selected("return a() + b();"), []);
  assert.deepEqual(selected("return new C(f());"), []);
});

test("optional calls and tags are eligible but accesses after a call are not", () => {
  assert.deepEqual(selected("return f?.();"), ["f?.()"]);
  assert.deepEqual(selected("return f()?.x;"), []);
  assert.deepEqual(selected("return (tag`x`);"), ["tag`x`"]);
  assert.deepEqual(selected("return f().x();"), ["f().x()"]);
});

test("nested functions own their own tail positions", () => {
  assert.deepEqual(
    selected("function g(){return h();} const a=()=>i(); return g();"),
    ["g()"],
  );
});

test("try handlers and finalizers preserve pending work", () => {
  assert.deepEqual(selected("try{return a();}catch(e){return b();}"), ["b()"]);
  assert.deepEqual(selected("try{return a();}finally{return b();}"), ["b()"]);
  assert.deepEqual(
    selected("try{return a();}catch(e){return b();}finally{return c();}"),
    ["c()"],
  );
});

test("iterator closing prevents a transfer from a for-of body", () => {
  assert.deepEqual(selected("for(const x of xs){return f();}"), []);
  assert.deepEqual(selected("for(const x in xs){return f();}"), ["f()"]);
  assert.deepEqual(selected("while(p()){if(q())return f();}return g();"), [
    "f()",
    "g()",
  ]);
});

test("resource disposal blocks later calls in the owning scope", () => {
  assert.deepEqual(selected("using x=resource;return f();"), []);
  assert.deepEqual(selected("return f();using x=resource;"), ["f()"]);
  assert.deepEqual(selected("{using x=resource;}return f();"), ["f()"]);
  assert.deepEqual(selected("using x=resource;{return f();}"), []);
  assert.deepEqual(selected("for(using x=resource;;){return f();}"), []);
});

test("concise arrows use the same expression rules", () => {
  const source = "const f = x => x ? g() : h();";
  const parsed = parseScript(createSourceTextView(source));
  assert.ok(parsed.ok);
  const declaration = parsed.value.statements[0];
  assert.ok(declaration?.kind === "variable");
  const arrow = declaration.declarations[0]?.initializer;
  assert.ok(arrow?.kind === "arrow");
  assert.deepEqual(
    [...collectTailCalls(arrow.body, { strict: true })].map((node) =>
      source.slice(node.start, node.end),
    ),
    ["g()", "h()"],
  );
});
