import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "../src/checker/index.ts";

function check(text: string) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return checkClosureModule(parsed.value);
}

test("new expressions check constructor contracts and contextual arguments", () => {
  for (const source of [
    "interface V{x:number;}function run(C:new(x:number)=>V):number{return new C(42).x;}",
    "interface V{x:number;}function run(o:{C:new(x:number)=>V}):number{return new o.C(42).x;}",
    "interface V{x:number;}function run(C:new(f:(x:number)=>number)=>V):V{return new C((x)=>x+1);}",
    "interface V{x:number;}function run(C:new(x:{value:number})=>V):V{return new C({value:42});}",
    "interface V{x:number;}function run(Uint8Array:new()=>V):V{return new Uint8Array();}",
    "interface V{x:number;}function run(C:new(x?:number)=>V):V{return new C();}",
    "function run(C:(new()=>{x:number})|undefined):number{if(C===undefined)return 0;return new C().x;}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify({ source, result }));
  }
});

test("construction cannot use call-only types or incompatible arguments", () => {
  for (const source of [
    "function run(C:()=>number):number{return new C();}",
    "function run(C:{():number}):number{return new C();}",
    "function run(C:new(x:number)=>number):number{return new C('x');}",
    "function run(C:new(x:number)=>number):number{return new C();}",
    "function run(C:(new()=>number)|undefined):number{return new C();}",
    "function run(C:new()=>number):number{return new C<number>();}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("constructor calls invalidate aliased property refinements", () => {
  const result = check(
    "function only(x:'yes'):number{return 1;}function run(C:new()=>number,o:{value:string}):number{if(o.value==='yes'){new C();return only(o.value);}return 0;}",
  );
  assert.ok(!result.ok);
  assert.match(result.error.message, /invalid call/);
});

test("native numeric typed-array constructors accept numeric and readonly array sources", () => {
  for (const target of [
    "Uint8Array",
    "Uint16Array",
    "Uint32Array",
    "Float64Array",
  ]) {
    for (const source of [
      "number[]",
      "readonly number[]",
      "(number|undefined)[]",
    ]) {
      const text = `function copy(a:${source}):${target}{return new ${target}(a);}`;
      const result = check(text);
      assert.ok(result.ok, JSON.stringify({ text, result }));
    }
    assert.ok(
      check(`function copy():${target}{return new ${target}([1,2,3]);}`).ok,
    );
    assert.ok(check(`function copy():${target}{return new ${target}([]);}`).ok);
    assert.equal(
      check(`function copy(a:string[]):${target}{return new ${target}(a);}`).ok,
      false,
    );
    assert.equal(
      check(`function copy(a:bigint[]):${target}{return new ${target}(a);}`).ok,
      false,
    );
  }
});

test("numeric typed-array length expressions retain numeric context", () => {
  for (const length of ["flag?1:2", "(flag?1:2)+3", "undefined"]) {
    const result = check(
      `function f(flag:boolean):Uint8Array{return new Uint8Array(${length});}`,
    );
    assert.ok(result.ok, JSON.stringify({ length, result }));
  }
});
