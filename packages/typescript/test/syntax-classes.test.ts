import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import {
  parseStrictScript,
  parseModule,
  rewriteModule,
} from "../src/syntax/index.ts";
function parse(text: string, typescript = false) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  return typescript
    ? parseModule(source.value)
    : parseStrictScript(source.value);
}
test("class syntax preserves methods, fields, computed keys, heritage and definition identity", () => {
  for (const text of [
    "class C {x=1; constructor(x){this.x=x;} getX(){return this.x;} static make(){return new C(42);}}",
    "let C=class Named extends Base { [key()] = 1; static [name](){} };",
    "let C=class { static x=1; x; };",
    "class C { static(){}; static static=1; ['constructor'](){} }",
  ]) {
    const result = parse(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
  const result = parse(
    "export class C<T> { x: T; constructor(x:T){this.x=x;} value():T{return this.x;} }",
    true,
  );
  assert.ok(result.ok, JSON.stringify(result));
  const declaration = result.value.statements[0];
  assert.equal(declaration?.kind, "class");
  if (declaration?.kind !== "class") return;
  assert.equal(declaration.definition.name, "C");
  assert.equal(declaration.definition.elements.length, 3);
  assert.deepEqual(declaration.definition.typeParameters, ["T"]);
  assert.ok(declaration.exported);
});
test("class grammar rejects invalid constructors, static prototype and abrupt method context", () => {
  for (const text of [
    "class C{constructor(){} constructor(){}}",
    "class C{constructor=1;}",
    "class C{static prototype() {}}",
    "class C{static prototype=1;}",
    "class {}",
    "if(true)class C{}",
    "while(true){class C{m(){break;}}}",
  ]) {
    const result = parse(text);
    assert.ok(!result.ok, text);
    assert.equal(result.error.code, "SYNTAX_ERROR", text);
  }
});
test("class rewriting visits keys, field initializers and method bodies", () => {
  const parsed = parse("class C{[old]=old;m(){return old;}}");
  assert.ok(parsed.ok, JSON.stringify(parsed));
  let count = 0;
  rewriteModule(parsed.value, {
    expression(node) {
      if (node.kind === "identifier" && node.name === "old") count++;
      return node;
    },
  });
  assert.equal(count, 3);
});

test("class accessors retain their kind and enforce accessor grammar", () => {
  for (const text of [
    "class C{get x(){return 1;}set x(v){}static get y(){return 2;}static set y(v){}}",
    "class C{get [key](){return 1;}set [key](v){}get(){}set(){}}",
    "class C{get\nx(){return 1;}}",
  ]) {
    const result = parse(text);
    assert.ok(result.ok, JSON.stringify(result));
    const declaration = result.value.statements[0];
    assert.equal(declaration?.kind, "class");
    if (declaration?.kind !== "class") continue;
    assert.equal(declaration.definition.elements[0]?.kind, "get");
  }
  for (const text of [
    "class C{get x(a){}}",
    "class C{set x(){}}",
    "class C{set x(a,b){}}",
    "class C{get constructor(){}}",
    "class C{set constructor(v){}}",
    "class C{static get prototype(){}}",
  ]) {
    const result = parse(text);
    assert.ok(!result.ok, text);
    assert.equal(result.error.code, "SYNTAX_ERROR", text);
  }
});

test("get and set fields permit ASI before generator methods", () => {
  for (const name of ["get", "set"]) {
    for (const prefix of ["", "static "]) {
      const result = parse(`class C { ${prefix}${name}\n *method(){} }`);
      assert.ok(result.ok, JSON.stringify(result));
      const declaration = result.value.statements[0];
      assert.equal(declaration?.kind, "class");
      if (declaration?.kind !== "class") return;
      assert.equal(declaration.definition.elements[0]?.kind, "field");
      assert.equal(declaration.definition.elements[1]?.kind, "method");
      assert.equal(parse(`class C { ${prefix}${name} *method(){} }`).ok, false);
    }
  }
});
