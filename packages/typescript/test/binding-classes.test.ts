import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseStrictScript } from "@tint/typescript/syntax";
import {
  bindStrictScript,
  collectStrictScriptDeclarations,
} from "../src/binding/index.ts";
function parse(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseStrictScript(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}
test("classes have mutable outer and immutable inner lexical identities", () => {
  const ast = parse("class C {x=C; m(){return C;}} C=42;");
  const bound = bindStrictScript(ast);
  assert.ok(bound.ok, JSON.stringify(bound));
  const names = bound.value.bindings.filter((b) => b.name === "C");
  assert.equal(names.length, 2);
  assert.equal(names[0]?.mutable, true);
  assert.equal(names[1]?.mutable, false);
  assert.deepEqual(
    collectStrictScriptDeclarations(ast).lexical.map((x) => [
      x.name,
      x.constant,
    ]),
    [["C", false]],
  );
  assert.equal(bindStrictScript(parse("let C;class C{}")).ok, false);
  assert.equal(bindStrictScript(parse("class C{}var C;")).ok, false);
});
test("class fields forbid arguments through arrows but nested ordinary functions own arguments", () => {
  for (const source of ["class C{x=arguments;}", "class C{x=()=>arguments;}"])
    assert.equal(bindStrictScript(parse(source)).ok, false, source);
  assert.ok(
    bindStrictScript(parse("class C{x=function(){return arguments;};}")).ok,
  );
});

test("static blocks isolate var and lexical bindings and forbid lexical arguments", () => {
  const source = "class C{static{var x=1;let y=2;}static{var x=3;let y=4;}}";
  const bound = bindStrictScript(parse(source));
  assert.ok(bound.ok, JSON.stringify(bound));
  assert.equal(bound.value.bindings.filter((b) => b.name === "x").length, 2);
  assert.equal(bound.value.bindings.filter((b) => b.name === "y").length, 2);
  for (const text of [
    "class C{static{arguments;}}",
    "class C{static{()=>arguments;}}",
    "class C{static{let x;var x;}}",
    "class C{static{let x;let x;}}",
  ])
    assert.equal(bindStrictScript(parse(text)).ok, false, text);
  assert.ok(
    bindStrictScript(
      parse("class C{static{function f(){return arguments;}f();}}"),
    ).ok,
  );
});

test("private names are lexical, forward-declared and shadowed by nested classes", () => {
  for (const text of [
    "class C{m(o){return o.#x;}#x;}",
    "class C{#x;m(){return class D{m(o){return o.#x;}};}}",
    "class C{#x;m(){return class D{#x;m(o){return o.#x;}};}}",
    "class C{get #x(){return 1;}set #x(v){}}",
    "class C{static get #x(){return 1;}static set #x(v){}}",
    "class C{#x;[(()=>this.#x)()](){}}",
  ])
    assert.ok(bindStrictScript(parse(text)).ok, text);
  for (const text of [
    "o.#x;",
    "class C{m(o){return o.#x;}}",
    "class C{#x;#x;}",
    "class C{#x;static #x;}",
    "class C{get #x(){return 1;}static set #x(v){}}",
    "class C{get #x(){return 1;}get #x(){return 2;}}",
    "class C{get #x(){return 1;}set #x(v){}#x;}",
    "class C extends (class{m(o){return o.#x;}}){#x;}",
  ])
    assert.equal(bindStrictScript(parse(text)).ok, false, text);
});

test("private brand checks resolve the same lexical names as private access", () => {
  for (const text of [
    "class C{#x;has(o){return #x in o;}}",
    "class C{has(o){return #x in o===true;}#x;}",
    "class C{#x;m(){return class D{has(o){return #x in o;}};}}",
  ])
    assert.ok(bindStrictScript(parse(text)).ok, text);
  assert.equal(
    bindStrictScript(parse("class C{has(o){return #x in o;}}")).ok,
    false,
  );
});
