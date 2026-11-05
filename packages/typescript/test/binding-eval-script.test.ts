import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import { parseScript, parseStrictScript } from "../src/syntax/index.ts";
import * as binding from "../src/binding/index.ts";
function parsed(source: string, strict = false) {
  const p = (strict ? parseStrictScript : parseScript)(
    createSourceTextView(source),
  );
  assert.ok(p.ok, JSON.stringify(p));
  return p.value;
}
function bind(
  source: string,
  privateEnvironment = false,
  fieldInitializer = false,
  strict = false,
) {
  assert.equal(typeof binding.bindEvalScript, "function");
  return binding.bindEvalScript(parsed(source, strict), {
    privateEnvironment,
    fieldInitializer,
  });
}
test("ordinary eval still rejects undeclared private names", () => {
  for (const source of ["this.#x", "#x in o"]) {
    const result = bind(source);
    assert.ok(!result.ok);
    assert.equal(result.error.code, "INVALID_CONTEXT");
    assert.match(result.error.message, /undeclared private name: #x/);
  }
  assert.ok(bind("(class{#x;m(o){return o.#x}})").ok);
});
test("field eval arguments restrictions follow lexical function boundaries", () => {
  for (const source of [
    "arguments",
    "()=>arguments",
    "x=>()=>arguments",
    "typeof arguments",
    "({arguments})",
    "({[arguments]:1})",
    "(class{[arguments](){}})",
  ]) {
    const r = bind(source, false, true, true);
    assert.ok(!r.ok, source);
    assert.equal(r.error.code, "INVALID_CONTEXT");
    assert.ok(bind(source, false, false, true).ok, source);
  }
  for (const source of [
    "(function(){return arguments})",
    "({m(){return arguments}})",
    "({get a(){return arguments}})",
    "(class{m(){return arguments}})",
    "function*g(){arguments}",
  ]) {
    assert.ok(bind(source, false, true, true).ok, source);
  }
});
test("both Annex B binding passes retain the eval private environment", () => {
  const result = bind("{function g(){}}this.#x;g;", true);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.annexFunctionCopies?.length, 1);
});
test("empty eval binding contexts preserve ordinary Script binding", () => {
  for (const source of [
    "var x=1;x",
    "{function f(){}}f",
    "class C{#x;m(){return this.#x}}",
    "function f(a=eval(7)){let x=1;return x}",
    "this.#x",
  ]) {
    const script = parsed(source);
    assert.deepEqual(bind(source), binding.bindScript(script), source);
  }
});

test("eval defers only genuinely external private identifiers in encounter order", () => {
  const context = { privateEnvironment: true, fieldInitializer: false };
  for (const [source, expected] of [
    ["this.#x;#x in o;this?.#y", ["#x", "#y"]],
    ["(class{#x;m(o){return o.#x}})", []],
    ["(class{#x;m(o){return o.#x+o.#y}})", ["#y"]],
    ["(class extends (this.#x,Object){#x})", ["#x"]],
    ["(class{#x;[this.#x](){}})", []],
    ["function unused(){return this.#x}", ["#x"]],
  ] as const) {
    const result = binding.bindEvalScript(parsed(source, true), context);
    assert.ok(result.ok, JSON.stringify({ source, result }));
    assert.deepEqual(result.value.externalPrivateNames ?? [], expected);
  }
});
test("deferred eval names survive both Annex B passes without hiding other early errors", () => {
  const context = { privateEnvironment: true, fieldInitializer: false };
  const result = binding.bindEvalScript(
    parsed("{function f(){}}this.#x;f;"),
    context,
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.annexFunctionCopies?.length, 1);
  assert.deepEqual(result.value.externalPrivateNames, ["#x"]);
  const duplicate = binding.bindEvalScript(parsed("class C{#x;#x}"), context);
  assert.ok(!duplicate.ok);
  assert.equal(duplicate.error.code, "DUPLICATE_NAME");
});
