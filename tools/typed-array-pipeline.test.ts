import assert from "node:assert/strict";
import { test } from "node:test";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkModule } from "@tint/typescript/checker";
import { lowerModule } from "@tint/ts-native/scalar";
import { emitModule } from "@tint/codegen/aarch64/scalar";
function check(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.equal(source.ok, true);
  const parsed = parseModule(source.value);
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  return checkModule(parsed.value);
}
test("borrowed Uint32Array access compiles with lazy read fallback and ordered writes", () => {
  const c = check(
    `export function main(a:Uint32Array):number {a[0]=4294967297;return (a[0] ?? 7)+a.length;}`,
  );
  assert.equal(c.ok, true, JSON.stringify(c));
  const ir = lowerModule(c.value);
  assert.equal(ir.ok, true, JSON.stringify(ir));
  assert.equal(emitModule(ir.value).ok, true);
});
test("unsupported typed-array reads and property writes are rejected", () => {
  for (const body of [
    "return a[0];",
    "a.length=4;return 0;",
    "a[true]=1;return 0;",
    "a[0]=false;return 0;",
    "return a.foo;",
  ])
    assert.equal(
      check(`function f(a:Uint32Array):number{${body}}`).ok,
      false,
      body,
    );
});

test("nullish expressions reject unparenthesized logical mixing", () => {
  for (const expression of [
    "a[0] ?? 1 || 2",
    "a[0] ?? 1 && 2",
    "1 || a[0] ?? 2",
    "1 && a[0] ?? 2",
  ]) {
    const bytes = new TextEncoder().encode(
      `function f(a:Uint32Array):number{return ${expression};}`,
    );
    const source = createSourceText(bytes, bytes.length);
    assert.equal(source.ok, true);
    assert.equal(parseModule(source.value).ok, false, expression);
  }
  assert.equal(
    check("function f(a:Uint32Array):number{return a[0] ?? (1 || 2);}").ok,
    true,
  );
});

test("allocator library operations compile with checked built-in resolution", () => {
  const c = check(
    `function f(a:Uint32Array,x:number):number {let b=a.fill(Math.ceil(x),-2,1/0);return Number.isInteger(x)?b.length:(b[1]??0);}`,
  );
  assert.equal(c.ok, true, JSON.stringify(c));
  const ir = lowerModule(c.value);
  assert.equal(ir.ok, true, JSON.stringify(ir));
  assert.equal(emitModule(ir.value).ok, true);
});

test("built-ins respect lexical shadowing, arity and supported argument types", () => {
  for (const text of [
    "function f(Math:number):number{return Math.ceil(1);}",
    "function f(Number:number):boolean{return Number.isInteger(1);}",
    "function Math():number{return 1;}function f():number{return Math.ceil(1);}",
    "function f():number{let x=Math.ceil(1);let Math=3;return x;}",
    "function f():number{return Math.ceil(true);}",
    "function f():boolean{return Number.isInteger();}",
    "function f(a:Uint32Array):void{a.fill();}",
    "function f(a:Uint32Array):void{a.fill(1,2,3,4);}",
    "function f(a:Uint32Array):void{a.fill(1,true);}",
  ])
    assert.equal(check(text).ok, false, text);
  assert.equal(
    check("function f(a:Uint32Array):boolean{return Number.isInteger(a);}").ok,
    true,
  );
});

test("optional numbers carry undefined through slots, calls, returns and nullish fallback", () => {
  const c =
    check(`function f(a:Uint32Array):number {let x:number|undefined=a[4];x=take(x);return x??7;}
 function take(x:number|undefined):number|undefined{return x===undefined?undefined:x;}`);
  assert.equal(c.ok, true, JSON.stringify(c));
  const ir = lowerModule(c.value);
  assert.equal(ir.ok, true, JSON.stringify(ir));
  assert.equal(emitModule(ir.value).ok, true);
});

test("optional numbers cannot silently flow into required numeric operations", () => {
  for (const body of [
    "return a[0];",
    "let x:number=a[0];return x;",
    "let x=a[0];return x+1;",
    "let x=a[0];x++;return 0;",
    "a[0]=undefined;return 0;",
  ])
    assert.equal(
      check(`function f(a:Uint32Array):number{${body}}`).ok,
      false,
      body,
    );
  assert.equal(
    check("function f(undefined:number):number{return undefined;}").ok,
    true,
  );
  assert.equal(check("function f():undefined|number{return 3;}").ok, true);
  assert.equal(
    check("function f():number|undefined{return undefined;}").ok,
    true,
  );
});

test("optional local guards narrow branches and surviving early-return paths", () => {
  for (const text of [
    "function f(x:number|undefined):number{if(x!==undefined)return x+1;return 0;}",
    "function f(x:number|undefined):number{if(x===undefined)return 0;return x+1;}",
    "function f(x:number|undefined):number{return x!==undefined?x+1:0;}",
    "function f(x:number|undefined):boolean{return x!==undefined&&x>0;}",
    "function f(x:number|undefined):boolean{return x===undefined||x>0;}",
    "function f(x:number|undefined):number{if(x){x++;return x;}return 0;}",
  ]) {
    const c = check(text);
    assert.equal(c.ok, true, JSON.stringify(c));
    const ir = lowerModule(c.value);
    assert.equal(ir.ok, true, JSON.stringify(ir));
    assert.equal(emitModule(ir.value).ok, true);
  }
});

test("narrowing rejects stale facts after writes, joins, shadowing and loop backedges", () => {
  for (const body of [
    "if(x!==undefined){x=undefined;return x+1;}return 0;",
    "if(x!==undefined){if(flag)x=undefined;return x+1;}return 0;",
    "if(x!==undefined){}return x+1;",
    "if(x===undefined||x>0)return x+1;return 0;",
    "if(x!==undefined){let x=undefined;return x+1;}return 0;",
    "if(x!==undefined&&((x=undefined)===undefined))return x+1;return 0;",
    "if(x!==undefined){(x=undefined)??0;return x+1;}return 0;",
    "if(x===undefined)return 0;while(flag){let y=x+1;x=undefined;}return 0;",
    "if(x===undefined)return 0;for(;flag;){let y=x+1;x=undefined;}return 0;",
  ])
    assert.equal(
      check(`function f(x:number|undefined,flag:boolean):number{${body}}`).ok,
      false,
      body,
    );
  assert.equal(
    check(
      "function f(x:number|undefined,undefined:number):number{if(x!==undefined)return x+1;return 0;}",
    ).ok,
    false,
  );
});

test("assignment and branch merges retain facts only on continuing paths", () => {
  for (const body of [
    "if(x===undefined)x=3;return x+1;",
    "if(undefined===x)return 0;return x+1;",
    "if(!(x===undefined)){x+=(x=undefined)??2;return x;}return 0;",
    "if(x!==undefined){x??(x=undefined);return x+1;}return 0;",
    "while(x!==undefined){let y=x+1;x=undefined;return y;}return 0;",
    "for(;x!==undefined;x=undefined){return x+1;}return 0;",
  ]) {
    const c = check(`function f(x:number|undefined):number{${body}}`);
    assert.equal(c.ok, true, JSON.stringify(c));
    const ir = lowerModule(c.value);
    assert.equal(ir.ok, true, JSON.stringify(ir));
    assert.equal(emitModule(ir.value).ok, true);
  }
});

test("byte and halfword arrays use shared lowering while retaining distinct signatures", () => {
  for (const kind of ["Uint8Array", "Uint16Array"]) {
    const c = check(
      `function f(a:${kind},n:number):number {let b=a.fill(n,-2);b[0]=n;return (b[0]??7)+b.length;}`,
    );
    assert.ok(c.ok, JSON.stringify(c));
    const ir = lowerModule(c.value);
    assert.ok(ir.ok, JSON.stringify(ir));
    assert.ok(emitModule(ir.value).ok);
  }
  assert.ok(
    !check("function f(a:Uint8Array,b:Uint16Array):number {a=b;return 0;}").ok,
  );
  assert.ok(
    !check("function f(a:Uint16Array,b:Uint32Array):number {a=b;return 0;}").ok,
  );
});
test("scalar and contextual pipelines share normalized owned-array construction", () => {
  const c = check(
    "export function main(n:number|undefined):Uint32Array{return new Uint32Array(n);}",
  );
  assert.ok(c.ok, JSON.stringify(c));
  const ir = lowerModule(c.value);
  assert.ok(ir.ok, JSON.stringify(ir));
  assert.ok(
    ir.value.functions[0]?.blocks.some((b) =>
      b.instructions.some((i) => i.kind === "array-new"),
    ),
  );
  assert.ok(emitModule(ir.value).ok);
  assert.equal(
    check(
      "function main():Uint32Array{const Uint32Array=1;return new Uint32Array(3);}",
    ).ok,
    false,
  );
});
test("scalar subarray lowering preserves width and handles optional bounds", () => {
  const c = check(
    "function view(a:Uint16Array,b:number|undefined,e:number|undefined):Uint16Array{return a.subarray(b,e);}",
  );
  assert.ok(c.ok, JSON.stringify(c));
  const ir = lowerModule(c.value);
  assert.ok(ir.ok, JSON.stringify(ir));
  assert.ok(emitModule(ir.value).ok);
  for (const text of [
    'function f(a:Uint8Array):Uint8Array{return a.subarray("1");}',
    "function f(a:Uint8Array):Uint8Array{return a.subarray(1,2,3);}",
    "function f(a:Uint8Array):Uint16Array{return a.subarray();}",
  ])
    assert.equal(check(text).ok, false, text);
});

test("scalar set preserves checked conversion across element widths", () => {
  for (const dest of ["Uint8Array", "Uint16Array", "Uint32Array"])
    for (const source of ["Uint8Array", "Uint16Array", "Uint32Array"]) {
      const c = check(
        `function copy(a:${dest},b:${source},n:number|undefined):void{return a.set(b,n);}`,
      );
      assert.ok(c.ok, JSON.stringify(c));
      const ir = lowerModule(c.value);
      assert.ok(ir.ok, JSON.stringify(ir));
      assert.ok(emitModule(ir.value).ok);
    }
  for (const body of [
    "a.set();",
    "a.set(b,0,1);",
    "a.set(1);",
    "a.set(b,true);",
    "const x:number=a.set(b);",
  ])
    assert.equal(
      check(`function f(a:Uint8Array,b:Uint16Array):void{${body}}`).ok,
      false,
      body,
    );
});

test("typed-array copy constructors lower allocation and element conversion", () => {
  for (const dst of ["Uint8Array", "Uint16Array", "Uint32Array"])
    for (const src of ["Uint8Array", "Uint16Array", "Uint32Array"]) {
      const c = check(`function copy(a:${src}):${dst}{return new ${dst}(a);}`);
      assert.ok(c.ok, JSON.stringify(c));
      const ir = lowerModule(c.value);
      assert.ok(ir.ok, JSON.stringify(ir));
      assert.ok(emitModule(ir.value).ok);
    }
});

test("nonnumeric defaults reject unsupported input encodings", () => {
  for (const text of ["function f(x:boolean=true):number{return 1;}"]) {
    const r = check(text);
    assert.equal(r.ok, false);
    if (!r.ok)
      assert.match(
        r.error.message,
        /parameters currently require numeric types/,
      );
  }
});

test("optional numeric parameters accept omission and use tagged undefined slots", () => {
  const c = check(
    "function value(a:number,b?:number):number{return a+(b??7);}function run():number{return value(2)+value(2,undefined)+value(2,3);}",
  );
  assert.ok(c.ok, JSON.stringify(c));
  const ir = lowerModule(c.value);
  assert.ok(ir.ok, JSON.stringify(ir));
  assert.ok(emitModule(ir.value).ok);
  for (const source of [
    "function f(x?:number):number{return x;}",
    "function f(x?:number,y:number):number{return y;}",
    "function f(x:number|undefined):number{return x??0;}function g():number{return f();}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("numeric defaults are checked in parameter order with distinct input and local types", () => {
  for (const text of [
    "function f(a:number=3,b:number=a+2):number{return a+b;}function g():number{return f()+f(undefined,4);}",
    "function f(a:number=3,b:number):number{return a+b;}function g():number{return f(undefined,4);}",
    "function f(a:number|undefined=undefined):number{return a??7;}function g():number{return f();}",
  ]) {
    const c = check(text);
    assert.ok(c.ok, JSON.stringify(c));
    const ir = lowerModule(c.value);
    assert.ok(ir.ok, JSON.stringify(ir));
    assert.ok(emitModule(ir.value).ok);
  }
  for (const text of [
    "function f(a:number=b,b:number=3):number{return a;}",
    "function f(a:number=a):number{return a;}",
    "function f(a:number=1):number{a=undefined;return a;}",
    "function f(a:number=1,b:number):number{return a+b;}function g():number{return f();}",
    "function f(a:number=undefined):number{return a;}",
  ])
    assert.equal(check(text).ok, false, text);
});

test("Float64Array uses numeric reads and managed array lowering without integer conversion", () => {
  const c = check(
    "function f(a:Float64Array):Float64Array{const b=new Float64Array(a);b[0]=-0;b.fill(0.5,1);b.set(a.subarray(0,2));return b;}",
  );
  assert.ok(c.ok, JSON.stringify(c));
  const ir = lowerModule(c.value);
  assert.ok(ir.ok, JSON.stringify(ir));
  assert.ok(emitModule(ir.value).ok);
});

test("matching typed-array set uses a nonallocating overlap-safe bulk operation", () => {
  for (const type of [
    "Uint8Array",
    "Uint16Array",
    "Uint32Array",
    "Float64Array",
  ]) {
    const checked = check(`function f(a:${type},b:${type}):void{a.set(b,1);}`);
    assert.ok(checked.ok, JSON.stringify(checked));
    const ir = lowerModule(checked.value);
    assert.ok(ir.ok, JSON.stringify(ir));
    const operations = ir.value.functions.flatMap((f) =>
      f.blocks.flatMap((b) => b.instructions),
    );
    assert.ok(operations.some((op) => op.kind === "array-copy"));
    assert.ok(!operations.some((op) => op.kind === "array-new"));
    assert.ok(emitModule(ir.value).ok);
  }
});
