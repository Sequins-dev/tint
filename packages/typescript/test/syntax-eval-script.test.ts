import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import * as syntax from "../src/syntax/index.ts";
const none = {
  strict: false,
  newTarget: false,
  superProperty: false,
  superCall: false,
};
function parse(text: string, context = none) {
  assert.equal(typeof syntax.parseEvalScript, "function");
  return syntax.parseEvalScript(createSourceTextView(text), context);
}
function accepts(text: string, context = none) {
  const result = parse(text, context);
  assert.ok(result.ok, JSON.stringify({ text, result }));
}
function rejects(text: string, context = none) {
  const result = parse(text, context);
  assert.ok(!result.ok, text);
  assert.equal(result.error.code, "SYNTAX_ERROR", text);
}
test("each eval caller capability has its own parser gate", () => {
  for (const [flag, sources] of [
    ["newTarget", ["new.target", "()=>new.target", "(a=new.target)=>a"]],
    ["superProperty", ["super.x", "super[k]", "()=>super.x"]],
    ["superCall", ["super(1)", "()=>super()"]],
  ] as const) {
    for (const source of sources) {
      rejects(source);
      accepts(source, { ...none, [flag]: true });
      rejects(source, {
        strict: true,
        newTarget: flag !== "newTarget",
        superProperty: flag !== "superProperty",
        superCall: flag !== "superCall",
      });
    }
  }
  rejects("super", {
    strict: true,
    newTarget: true,
    superProperty: true,
    superCall: true,
  });
});
test("eval retains Script grammar and resets nested function super capabilities", () => {
  const all = {
    strict: false,
    newTarget: true,
    superProperty: true,
    superCall: true,
  };
  for (const strict of [false, true])
    for (const source of [
      "return 1",
      "break",
      "continue",
      "L:{break M}",
      "await 1",
      "using x=null",
      "export default 1",
      "import x from 'x'",
      "class C{static{await}}",
    ]) {
      rejects(source, { ...all, strict });
    }
  for (const source of [
    "(function(){super.x})",
    "(function*(){super()})",
    "async function f(){super.x}",
    "({m(){super()}})",
  ]) {
    rejects(source, all);
  }
  for (const source of [
    "({m(){return super.x}})",
    "(function(){return new.target})",
    "class D extends B{constructor(){super()}}",
    "var await=1;await",
    "{using x=null}",
    "1 <!-- c",
  ]) {
    accepts(source);
    accepts(source, all);
  }
});
test("caller strictness forces eval early errors without enabling function grammar", () => {
  for (const source of [
    "with(o){}",
    "010",
    "08",
    "'\\07'",
    "'\\8'",
    "var public",
    "var yield",
    "var arguments",
    "eval=1",
    "delete x",
    "function f(a,a){}",
  ]) {
    accepts(source);
    rejects(source, { ...none, strict: true });
  }
  rejects("'use strict';with(o){}");
  accepts("var await=1;await", { ...none, strict: true });
});
test("empty eval contexts preserve the existing Script results exactly", () => {
  for (const source of [
    "1",
    "'use strict';let x=1",
    "{function f(){}}",
    "class C{#x;m(){return this.#x}}",
    "var r=/x/u",
    "tag`x`",
    "<!-- x\n1",
    "return 1",
    "super.x",
    "new.target",
    "'\\07'",
    "var yield",
  ]) {
    assert.deepEqual(
      parse(source),
      syntax.parseScript(createSourceTextView(source)),
      source,
    );
    assert.deepEqual(
      parse(source, { ...none, strict: true }),
      syntax.parseStrictScript(createSourceTextView(source)),
      source,
    );
  }
});
