import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkModule } from "@tint/typescript/checker";
function check(text: string) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.equal(source.ok, true);
  const ast = parseModule(source.value);
  assert.equal(ast.ok, true, text);
  return checkModule(ast.value);
}
test("binds scalar functions, forward calls, shadowed locals and mutable parameters", () => {
  const result = check(
    "export function f(x:number):number { let y=x+1; { const x=true; if(x) y=g(y); } x=y; return x; } function g(x:number):number { return x*2; }",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.functions.length, 2);
  const f = result.value.functions[0];
  assert.ok(f);
  assert.deepEqual(
    f.locals.map((l) => [l.id, l.name, l.type, l.mutable]),
    [
      [0, "x", "number", true],
      [1, "y", "number", true],
      [2, "x", "boolean", false],
    ],
  );
  assert.equal(f.node.exported, true);
});
test("checks conditionals, short circuit, loops and all return paths", () => {
  for (const text of [
    "function f(x:boolean):number { if(x) return 1; else return 2; }",
    "function f(x:number):number { while(x>0){ x=x-1; if(x===2) continue; if(x===1) break; } return x; }",
    "function f(x:boolean):boolean { let y=false; return x && (y=true) || y; }",
    "function f():void { return; }",
    "function f():number { return f(); }",
  ])
    assert.equal(check(text).ok, true, text);
});
test("rejects name, initialization, mutability, type and completion errors", () => {
  const cases = [
    ["function f():number { return missing; }", "UNKNOWN_NAME"],
    ["function f():number { let x=x; return x; }", "UNINITIALIZED"],
    ["function f():number { x=1; let x=2; return x; }", "UNINITIALIZED"],
    ["function f(x:number):number { let x=1; return x; }", "DUPLICATE_NAME"],
    ["function f():number { const x=1; x=2; return x; }", "IMMUTABLE"],
    ["function f():number { let x=1; x=true; return x; }", "TYPE_MISMATCH"],
    [
      "function f(x:number):number { return g(true); } function g(x:number):number { return x; }",
      "TYPE_MISMATCH",
    ],
    ["function f():number { return f(1); }", "ARITY"],
    ["function f(x:boolean):number { if(x) return 1; }", "MISSING_RETURN"],
    ["function f():void { return 1; }", "TYPE_MISMATCH"],
    ["function f():number { return; }", "TYPE_MISMATCH"],
    ["function f():number { {let x=1;} return x; }", "UNKNOWN_NAME"],
    [
      "function f():number{return 1;} function f():number{return 2;}",
      "DUPLICATE_NAME",
    ],
  ];
  for (const [text, code] of cases) {
    assert.ok(text);
    const r = check(text);
    assert.equal(r.ok, false, text);
    if (!r.ok) {
      assert.equal(r.error.code, code, text);
      assert.ok(r.error.end >= r.error.start);
      assert.equal("value" in r, false);
    }
  }
});
test("coverage gaps are explicit rather than weakened type guarantees", () => {
  for (const text of [
    'import "./x.ts";',
    "const x=1;",
    "function f(x):number{return x;}",
    "function f(){return 1;}",
    "function f(x:number|boolean):number{return 1;}",
    "function f():number{let x:number;return x;}",
    "function f():number{function g():number{return 1;}return g();}",
    'function f():number{return "x";}',
    "function f():number { return f.x; }",
    "function f():number { let g=f; return 1; }",
  ]) {
    const r = check(text);
    assert.equal(r.ok, false, text);
    if (!r.ok) assert.equal(r.error.code, "UNSUPPORTED", text);
  }
});
test("strict binding errors are rejected before scalar checking", () => {
  for (const text of [
    "function eval():number {return 1;}",
    "function f(arguments:number):number{return arguments;}",
    "function f():number{const eval=1;return eval;}",
  ]) {
    const bytes = new TextEncoder().encode(text);
    const source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    const result = parseModule(source.value);
    assert.ok(!result.ok, text);
    assert.equal(result.error.code, "SYNTAX_ERROR");
  }
});

test("parsed object and closure syntax stays outside the scalar compilation contract", () => {
  for (const text of [
    "interface API { readonly run: () => number }",
    "function f():number { const x = { value: 1 }; return 0; }",
    "function f():number { const run = () => 1; return 0; }",
    "function f():number { function nested():number { return 1; } return 0; }",
    'function f():number { throw "failure"; }',
  ]) {
    const result = check(text);
    assert.ok(!result.ok, text);
    assert.equal(result.error.code, "UNSUPPORTED", text);
  }
});

test("scalar annotations do not silently erase type arguments", () => {
  for (const source of [
    "function f(n:number<string>):number{return n;}",
    "function f(n:number<string>|undefined):number{return n??0;}",
    "function f():void<number>{return;}",
  ])
    assert.ok(!check(source).ok, source);
});

test("scalar finite checks accept numbers and represented nonnumeric values", () => {
  for (const source of [
    "function f(x:number):boolean{return Number.isFinite(x);}",
    "function f(x:number|undefined):boolean{return Number.isFinite(x);}",
    "function f(x:boolean):boolean{return Number.isFinite(x);}",
  ]) {
    const r = check(source);
    assert.ok(r.ok, JSON.stringify(r));
  }
  assert.equal(
    check("function f():boolean{return Number.isFinite();}").ok,
    false,
  );
});
