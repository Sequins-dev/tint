import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
function bind(text: string, globals: readonly string[] = []) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  return bindModule(parsed.value, globals);
}
test("sibling closures share binding identities and forward captures through intermediate functions", () => {
  const r = bind(
    "function make(){ let x=0; return { read: () => x, write: () => ++x, nested: () => () => x }; }",
  );
  assert.ok(r.ok);
  const x = r.value.bindings.find((b) => b.name === "x");
  assert.ok(x);
  assert.equal(x.mutable, true);
  assert.equal(x.captured, true);
  const captures = r.value.functions.flatMap((f) => f.captures);
  assert.equal(captures.filter((c) => c.binding === x.id).length, 4);
  assert.equal(captures.filter((c) => c.binding === x.id && c.write).length, 1);
  assert.equal(
    captures.filter((c) => c.binding === x.id && c.forwarded).length,
    1,
  );
});
test("predeclaration resolves shadowing and recursive functions without pretending to prove initialization", () => {
  const r = bind(
    "let x=1; function f(){ const get=()=>x; let x=2; { let x=3; x++; } return get; }",
  );
  assert.ok(r.ok);
  const xs = r.value.bindings.filter((b) => b.name === "x");
  assert.equal(xs.length, 3);
  assert.equal(xs.filter((b) => b.captured).length, 1);
  assert.equal(xs[1]?.captured, true);
  const recursion = bind(
    "function outer(){ function f(){ return f(); } return f; }",
  );
  assert.ok(recursion.ok);
  assert.equal(recursion.value.functions[1]?.captures.length, 1);
});
test("loop bindings have a separate scope and properties are not lexical names", () => {
  const r = bind(
    "function f(a){ for(let i=0;i<3;i++){ const g=()=>i; a.value=g; } return { a, value: a.length }; }",
  );
  assert.ok(r.ok);
  const i = r.value.bindings.find((b) => b.name === "i");
  assert.ok(i);
  assert.equal(r.value.scopes[i.scope]?.kind, "for");
  assert.equal(i.captured, true);
  assert.ok(!r.value.bindings.some((b) => b.name === "value"));
  assert.ok(!bind("function f(){ for(let i=0;i<3;i++){} return i; }").ok);
});
test("unknown names, duplicate bindings and immutable writes fail without a partial graph", () => {
  for (const [text, code] of [
    ["function f(){ return missing; }", "UNKNOWN_NAME"],
    ["function f(x){ let x=0; }", "DUPLICATE_NAME"],
    ["let x=1; let x=2;", "DUPLICATE_NAME"],
    ["function f(){ const x=0; return ()=>x++; }", "IMMUTABLE"],
    ['import {x} from "a"; x=1;', "IMMUTABLE"],
    ['import type {X} from "a"; X;', "UNKNOWN_NAME"],
  ]) {
    const r = bind(text ?? "");
    assert.ok(!r.ok, text);
    assert.equal(r.error.code, code);
    assert.equal("value" in r, false);
  }
  assert.ok(bind("const a = {x:1}; a.x=2;").ok);
});
test("allocator captures bind against explicit host globals", () => {
  const text = readFileSync(
    new URL(
      "../../native-runtime/src/allocators/region/index.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const r = bind(text, ["Number", "Math", "undefined"]);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.value.functions.length, 30);
  for (const name of ["metadata", "count", "used", "read", "find", "discard"]) {
    assert.equal(
      r.value.bindings.find((b) => b.name === name)?.captured,
      true,
      name,
    );
  }
  assert.equal(
    r.value.references.filter((r) => r.global !== undefined).length > 0,
    true,
  );
});

test("property mutation reads the captured handle and module names stay module references", () => {
  const r = bind(
    'import { external } from "host"; let moduleValue=1; function make(a){ const object=a; return () => { object.value=external(moduleValue); }; }',
  );
  assert.ok(r.ok);
  const closure = r.value.functions[1];
  assert.ok(closure);
  assert.equal(closure.captures.length, 1);
  assert.equal(closure.captures[0]?.read, true);
  assert.equal(closure.captures[0]?.write, false);
  const object = r.value.bindings.find((b) => b.name === "object");
  assert.equal(object?.mutable, false);
  assert.equal(object?.captured, true);
});
test("forwarded captures merge with direct access and lexical names shadow globals", () => {
  const r = bind(
    "function outer(x){ return ()=>{ x=1; return ()=>x; }; } function other(){ return Number; let Number=1; }",
    ["Number"],
  );
  assert.ok(r.ok);
  assert.deepEqual(
    r.value.functions[1]?.captures.map((c) => [c.read, c.write, c.forwarded]),
    [[false, true, true]],
  );
  assert.equal(
    r.value.references.some((r) => r.global === "Number"),
    false,
  );
});
test("binding limits deep expression trees without a partial result", () => {
  const r = bind(
    "function f(){ return " + Array(400).fill("1").join("+") + "; }",
  );
  assert.ok(!r.ok);
  assert.equal(r.error.code, "LIMIT");
});
test("switch discriminants use the outer scope and clauses share a new lexical scope", () => {
  const r = bind(
    "function f(n:number):number{switch(n){case 0:let n:number=1;return n;default:return n;} }",
  );
  assert.ok(r.ok, JSON.stringify(r));
  const bindings = r.value.bindings.filter((b) => b.name === "n");
  assert.equal(bindings.length, 2);
  const references = r.value.references.filter(
    (r) => r.node.kind === "identifier" && r.node.name === "n",
  );
  assert.equal(references[0]?.binding, bindings[0]?.id);
  assert.equal(references[1]?.binding, bindings[1]?.id);
  assert.equal(references[2]?.binding, bindings[1]?.id);
});
test("for-of bindings shadow the iterable expression and are confined to the loop", () => {
  const r = bind(
    "function f(a:Uint8Array):void{for(const a of a){const read=()=>a;}}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  const local = r.value.bindings.find(
    (b) => b.name === "a" && b.kind === "const",
  );
  assert.ok(local);
  assert.equal(local.captured, true);
  assert.ok(
    r.value.references
      .filter((r) => r.node.kind === "identifier" && r.node.name === "a")
      .every((r) => r.binding === local.id),
  );
  assert.equal(
    bind("function f(a:Uint8Array):number{for(const x of a){}return x;}").ok,
    false,
  );
  assert.equal(
    bind("function f(a:Uint8Array):void{for(const x of a){x=1;}}").ok,
    false,
  );
});

test("parameter initializers resolve parameters and outer names before body declarations", () => {
  const r = bind("const x=1;function f(a=x,b=()=>a,c=b){const x=2;return c;}");
  assert.ok(r.ok, JSON.stringify(r));
  const xs = r.value.bindings.filter((b) => b.name === "x");
  const ref = r.value.references.find(
    (r) => r.node.kind === "identifier" && r.node.name === "x",
  );
  assert.equal(ref?.binding, xs[0]?.id);
  const a = r.value.bindings.find((b) => b.name === "a");
  assert.ok(a?.captured);
  assert.equal(bind("function f(a=missing){return a;}").ok, false);
});

test("loop patterns bind each name in the loop scope and track captures", () => {
  const result = bind(
    "function f(entries){const key=0;for(const [key,value] of entries){const read=()=>key+value;}return key;}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  const keys = result.value.bindings.filter((b) => b.name === "key");
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0]?.scope, keys[1]?.scope);
  assert.equal(keys[0]?.captured, false);
  assert.equal(keys[1]?.captured, true);
  const value = result.value.bindings.find((b) => b.name === "value");
  assert.equal(value?.captured, true);
  assert.equal(value?.mutable, false);
  assert.equal(
    bind("function f(entries){for(const [x,x] of entries){}}").ok,
    false,
  );
  assert.equal(
    bind("function f(entries){for(const [x,y] of entries){}return x;}").ok,
    false,
  );
});

test("this resolves to the nearest ordinary function through lexical arrows", () => {
  const result = bind(
    "this; const top=()=>this; function outer(){this; const nested=()=>()=>this; const object={method(){return ()=>this;}}; function inner(){return this;} }",
  );
  assert.ok(result.ok);
  const owners = result.value.receiverReferences.map(
    (reference) => reference.owner,
  );
  assert.deepEqual(owners, [undefined, undefined, 1, 1, 4, 6]);
  assert.deepEqual(
    result.value.functions.map((fn) => fn.receiver),
    [undefined, 1, 1, 1, 4, 4, 6],
  );
  assert.equal(
    result.value.references.some((reference) => reference.global === "this"),
    false,
  );
});

test("receiver resolution includes parameter defaults and resets at ordinary functions", () => {
  const result = bind(
    "function outer(value=this){ const arrow=(input=this)=>input; const ordinary=function(value=this){return ()=>this;}; return ()=>this; }",
  );
  assert.ok(result.ok);
  assert.deepEqual(
    result.value.receiverReferences.map((reference) => reference.owner),
    [0, 0, 2, 2, 0],
  );
  assert.equal(
    result.value.bindings.some((binding) => binding.name === "this"),
    false,
  );
  assert.equal(result.value.functions[2]?.receiver, 2);
});

test("lexical receivers use one immutable owned binding and forward through nested arrows", () => {
  const result = bind(
    "function outer(){return ()=>()=>this;} function separate(){return this;}",
  );
  assert.ok(result.ok);
  const graph = result.value;
  const binding = graph.functions[0]!.receiverBinding;
  assert.notEqual(binding, undefined);
  assert.equal(graph.bindings[binding!]!.mutable, false);
  assert.equal(graph.bindings[binding!]!.captured, true);
  assert.deepEqual(graph.functions[1]!.captures, [
    { binding, read: false, write: false, forwarded: true },
  ]);
  assert.deepEqual(graph.functions[2]!.captures, [
    { binding, read: true, write: false, forwarded: false },
  ]);
  assert.equal(graph.functions[3]!.receiverBinding, undefined);
});

test("computed object keys participate in closure capture analysis", () => {
  const result = bind("function f(){let key='x';return ()=>({[key]:42});}");
  assert.ok(result.ok);
  assert.equal(
    result.value.bindings.find((b) => b.name === "key")?.captured,
    true,
  );
});

test("typed array iteration defaults fail explicitly until typed lowering supports them", () => {
  const result = bind("function f(){for(const [x=42] of values){}}", [
    "values",
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "UNSUPPORTED");
    assert.match(result.error.message, /array iteration defaults/);
  }
});

test("typed array iteration rest fails explicitly until typed lowering supports it", () => {
  const result = bind("function f(){for(const [...rest] of values){}}", [
    "values",
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "UNSUPPORTED");
    assert.match(result.error.message, /array iteration rest/);
  }
});

test("typed RegExp values fail explicitly until native object lowering exists", () => {
  const result = bind("const pattern=/identifier/g;");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "UNSUPPORTED");
});
