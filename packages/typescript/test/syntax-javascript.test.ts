import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule, parseStrictScript } from "@tint/typescript/syntax";
function parse(text: string) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  return parseModule(source.value, "javascript");
}
test("JavaScript modules reject TypeScript-only grammar", () => {
  for (const text of [
    "const x:number=1;",
    "function f(x?:number){}",
    "function f<T>(x){}",
    "interface Shape {x:number}",
    "type Shape={x:number};",
    'import type {Shape} from "m";',
    'import {type Shape} from "m";',
    "export type {Shape};",
    "export {type Shape};",
    "const f=(x?):number=>1;",
  ])
    assert.equal(parse(text).ok, false, text);
});
test("JavaScript modules retain contextual names and relational calls", () => {
  for (const text of [
    'import type from "m";',
    'import {type} from "m";',
    "export {type};",
    "export function f(x){return x+1;}",
  ])
    assert.ok(parse(text).ok, text);
  const result = parse("f<T>(x);");
  assert.ok(result.ok);
  const stmt = result.value.statements[0];
  assert.ok(stmt?.kind === "expression");
  assert.equal(stmt.expression.kind, "binary");
});

test("strict scripts separate module declarations and await identifiers", () => {
  for (const text of ['import {x} from "m";', "export const x=1;"]) {
    const bytes = new TextEncoder().encode(text);
    const source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    assert.equal(parseStrictScript(source.value).ok, false);
  }
  const bytes = new TextEncoder().encode("const await=1; const x=await+1;");
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  assert.ok(parseStrictScript(source.value).ok);
  assert.equal(parseModule(source.value, "javascript").ok, false);
});

test("strict source goals reject eval and arguments as bindings and assignment targets", () => {
  for (const id of ["eval", "arguments"]) {
    for (const text of [
      `let ${id}=1;`,
      `const ${id}=1;`,
      `function ${id}(){}`,
      `function f(${id}){}`,
      `const f=function(${id}){};`,
      `const f=(${id})=>1;`,
      `const f=${id}=>1;`,
      `try{}catch(${id}){}`,
      `for(const ${id} of items){}`,
      `import {x as ${id}} from "m";`,
      `import {${id}} from "m";`,
      `import ${id} from "m";`,
      `import * as ${id} from "m";`,
      `${id}=1;`,
      `(${id})+=1;`,
      `${id} ||= 1;`,
      `++${id};`,
      `(${id})--;`,
    ]) {
      const result = parse(text);
      assert.ok(!result.ok, text);
      assert.equal(result.error.code, "SYNTAX_ERROR", text);
    }
    for (const text of [
      `read(${id});`,
      `object.${id}=1;`,
      `const o={${id}:1};`,
    ])
      assert.ok(parse(text).ok, text);
  }
});

test("non-simple parameters forbid an own use-strict directive", () => {
  for (const body of [
    '"use strict";',
    "'before'; 'use strict';",
    '"other\\ntext"; "use strict";',
  ]) {
    for (const text of [
      `function f(x=1){${body}}`,
      `const f=function(x=1){${body}};`,
      `const f=(x=1)=>{${body}};`,
      `const o={f(x=1){${body}}};`,
    ]) {
      const result = parse(text);
      assert.ok(!result.ok, text);
      assert.equal(result.error.code, "SYNTAX_ERROR");
    }
  }
  for (const body of [
    "`use strict`;",
    '"use\\x20strict";',
    '("use strict");',
    '; "use strict";',
    '`before`; "use strict";',
  ])
    assert.ok(parse(`function f(x=1){${body}}`).ok, body);
  assert.ok(parse('function f(x){"use strict";}').ok);
});

test("classic for initializers apply the grammar's In parameter", () => {
  for (const text of [
    "for(a in b; ; ){}",
    "for(1 in b; ; ){}",
    "for(let a=1 in b; ; ){}",
    "for(a=b in c; ; ){}",
    "for(a ? b : c in d; ; ){}",
    "for(a=()=>b in c; ; ){}",
  ])
    assert.equal(parse(text).ok, false, text);
  for (const text of [
    "for((a in b); ; ){}",
    "for(let a=(1 in b); ; ){}",
    "for(a ? b in c : d; ; ){}",
    "for([a in b]; ; ){}",
    "for(({a:b in c}); ; ){}",
    "for(f(a in b); ; ){}",
    "for(a=()=>{return b in c;}; ; ){}",
    "for(; a in b; c in d){}",
  ])
    assert.equal(parse(text).ok, true, text);
});

test("escaped identifier names preserve keyword and strict binding restrictions", () => {
  for (const text of [
    "const \\u0061=1; read(a);",
    "object.\\u0069f;",
    "const o={\\u0069f:1};",
    "import {\\u0069f as value} from 'm';",
  ])
    assert.ok(parse(text).ok, text);
  for (const text of [
    "\\u0069f(true){}",
    "const \\u0069f=1;",
    "const e\\u0076al=1;",
    "e\\u0076al=1;",
    "const x=tr\\u0075e;",
    "const x=ty\\u0070eof value;",
    "for(;;){br\\u0065ak;}",
  ])
    assert.equal(parse(text).ok, false, text);
});

test("identifier rest parameters parse in functions, arrows and methods", () => {
  for (const text of [
    "function f(a,...rest){}",
    "const f=(...rest)=>rest;",
    "const o={m(...rest){}};",
    "class C{constructor(...rest){}m(...rest){}}",
  ])
    assert.ok(parse(text).ok, text);
});
test("rest parameters enforce last position, uniqueness and non-simple rules", () => {
  for (const text of [
    "function f(...rest,){}",
    "function f(...rest,x){}",
    "function f(...rest=[]){}",
    "function f(a,...a){}",
    "function f(...rest){'use strict';}",
    "class C{set x(...rest){}}",
    "const o={set x(...rest){}}",
  ])
    assert.equal(parse(text).ok, false, text);
});

test("debugger statements retain their syntax identity and obey ASI", () => {
  for (const text of [
    "debugger;",
    "debugger\n42;",
    "if(true)debugger;else debugger;",
    "function f(){debugger}",
  ]) {
    assert.ok(parse(text).ok, text);
  }
  const result = parse("debugger;");
  assert.ok(result.ok);
  assert.equal(result.value.statements[0]?.kind, "debugger");
  for (const text of ["(debugger);", "debugger 42;", "debu\\u0067ger;"])
    assert.equal(parse(text).ok, false, text);
});
