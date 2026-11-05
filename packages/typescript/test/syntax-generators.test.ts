import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import {
  parseScript,
  parseStrictScript,
  rewriteModule,
} from "../src/syntax/index.ts";

function parse(text: string, strict = false) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  return strict ? parseStrictScript(source.value) : parseScript(source.value);
}

test("generator declarations, expressions and methods preserve yield syntax", () => {
  for (const text of [
    "function*g(){yield;yield 42;yield* [1,2];yield yield 1;}",
    "const f=function* named(){let x=(yield 1)+2;return yield x;};",
    "({*m(){yield 1;}, *['key'](){yield* [];}, *get(){yield 2;}});",
    "class C{*m(){yield 1;}static *m(){yield 2;}*#m(){yield 3;}*[42](){yield 4;}}",
    "class C{static *constructor(){yield 1;}}",
    "function*yield(){}",
    "function*g(){yield\n42;}",
    "function*g(){let f=function yield(){return yield;};let a=()=>yield;}",
    "function*g(x=()=>yield,y=function(){return yield;}){}",
    "function*g(){class C{[yield 1](){return 42;}}}",
    "function*g(){let o={[yield 1](){return 42;}};}",
  ])
    assert.ok(parse(text).ok, text);
  const result = parse("function*g(){yield;yield* xs;}");
  assert.ok(result.ok);
  const fn = result.value.statements[0];
  assert.equal(fn?.kind, "function");
  if (fn?.kind !== "function" || fn.body.kind !== "block") return;
  assert.equal(fn.generator, true);
  const first = fn.body.statements[0],
    second = fn.body.statements[1];
  assert.equal(first?.kind, "expression");
  if (first?.kind === "expression") {
    assert.equal(first.expression.kind, "yield");
    if (first.expression.kind === "yield")
      assert.equal(first.expression.expression, undefined);
  }
  if (second?.kind === "expression") {
    assert.equal(second.expression.kind, "yield");
    if (second.expression.kind === "yield")
      assert.equal(second.expression.delegate, true);
  }
});

test("yield grammar context does not leak into nested functions or class initialization", () => {
  for (const text of [
    "function*g(x=yield 1){}",
    "function*g(yield){}",
    "function*g(){let\nyield 0;}",
    '"use strict";function*g(x,x){}',
    "(function*yield(){})",
    "function*g(){let yield=1;}",
    "function*g(){yield:while(true){}}",
    "function*g(){function yield(){}}",
    "function*g(){let f=(yield)=>42;}",
    "function*g(){let f=(x=yield 1)=>42;}",
    "function*g(){let f=()=>yield 1;}",
    "function*g(){function f(){yield 1;}}",
    "function*g(){class C{x=yield 1;}}",
    "function*g(){class C{static{yield 1;}}}",
    "function*g(){class C{m(){yield 1;}}}",
    "function*g(){yield\n*[];}",
    "function*g(){yield*;}",
    "function*g(){1+yield 2;}",
    "class C{*constructor(){}}",
    "class C{get *x(){}}",
    "({get *x(){}})",
    "function*g(){y\\u0069eld 1;}",
  ])
    assert.equal(parse(text).ok, false, text);
  assert.equal(parse("function*yield(){}", true).ok, false);
});

test("rewriting traverses yield operands and preserves generator markers", () => {
  const parsed = parse(
    "function*g(){yield x;yield* xs;}({*m(){yield x;}});class C{*m(){yield x;}}",
  );
  assert.ok(parsed.ok);
  let operands = 0,
    yields = 0;
  const rewritten = rewriteModule(parsed.value, {
    expression(node) {
      if (node.kind === "identifier") operands++;
      if (node.kind === "yield") yields++;
      return node;
    },
  });
  assert.equal(operands, 4);
  assert.equal(yields, 4);
  assert.deepEqual(rewritten, parsed.value);
});

test("bare yield ends at template continuation tokens", () => {
  for (const text of [
    "function*g(){return `1${yield}3${4}5`;}",
    "function*g(){return `1${yield}3`;}",
    "function*g(){return `1${yield}3${yield}5`;}",
  ]) {
    const result = parse(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
  assert.equal(parse("function*g(){return `${yield*}`;}").ok, false);
});

test("yield followed by an assignment operator is a syntax error, not an unsupported expression", async () => {
  const { Script } = await import("node:vm");
  for (const operator of [
    "=",
    "+=",
    "-=",
    "*=",
    "**=",
    "/=",
    "%=",
    "<<=",
    ">>=",
    ">>>=",
    "&=",
    "|=",
    "^=",
    "&&=",
    "||=",
    "??=",
  ])
    for (const delegate of ["", "*"]) {
      const source = `function* g(){yield ${delegate} ${operator} 1;}`;
      assert.throws(() => new Script(source), SyntaxError);
      const parsed = parse(source);
      assert.equal(parsed.ok, false, source);
      if (!parsed.ok) assert.equal(parsed.error.code, "SYNTAX_ERROR", source);
    }
});
