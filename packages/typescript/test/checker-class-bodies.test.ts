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
test("typed auto-accessors require explicit storage and accessor lowering", () => {
  const result = check("class C{accessor x:number=1;}");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "UNSUPPORTED");
    assert.match(result.error.message, /auto-accessor/);
  }
});
test("annotated base class bodies check instance/static receivers and construction", () => {
  for (const source of [
    "class C{x:number=42;getValue():number{return this.x;}}function run():number{return new C().getValue();}",
    "class C{x:number;constructor(x:number){this.x=x;}getValue():number{return this.x;}}function run():number{return new C(42).getValue();}",
    "class C{static x:number=42;static getValue():number{return this.x;}}function run():number{return C.getValue();}",
    "class C{x:number=41;y:number=this.x+1;getValue():number{return this.y;}}",
    "class C{x:number;constructor(flag:boolean){if(flag){this.x=1;}else{this.x=2;}}}",
    "class C{x:number;constructor(flag:boolean){if(flag)throw 1;this.x=42;}}",
    "class C{x:number=42;static create():C{return new C();}self():C{return this;}}",
    "class C{x:number=42;m():number{return this.x;}}function run(c:C):number{const m=c.m;return m.call(c);}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify({ source, result }));
    assert.ok(result.value.bodies.size > 0);
  }
});
test("class body checking rejects incorrect assignments and return types", () => {
  for (const source of [
    "class C{x:number='bad';}",
    "class C{x:number;constructor(){this.x='bad';}}",
    "class C{x:number=1;m():number{return 'bad';}}",
    "class C{static x:number=1;m():number{return this.x;}}",
    "class C{x:number=1;m():number{return this.x;}}function run(c:C):number{const m=c.m;return m();}",
  ]) {
    const result = check(source);
    assert.ok(!result.ok, source);
    assert.match(result.error.message, /type|property|call/, source);
  }
});
test("required instance fields must be initialized on every returning path", () => {
  for (const source of [
    "class C{x:number;}",
    "class C{x:number;constructor(flag:boolean){if(flag)this.x=1;}}",
    "class C{x:number;constructor(){return;}}",
    "class C{x:number;constructor(){this.x=this.x+1;}}",
    "class C{x:number=this.y;y:number=1;}",
    "class C{x:number;constructor(){this.m();this.x=1;}m():void{}}",
  ]) {
    const result = check(source);
    assert.ok(!result.ok, source);
    assert.match(result.error.message, /initializ/, source);
  }
});

test("defaults, short circuits and later field definitions cannot fake definite initialization", () => {
  for (const source of [
    "class C{x:number;constructor(value:number=(this.x=1)){}}",
    "class C{x:number;constructor(flag:boolean){flag&&(this.x=1);}}",
    "class C{x:number;constructor(flag:boolean){flag||(this.x=1);}}",
    "class C{y:number=(this.x=1);x:number;}",
    "class C{static x:number=C.y;static y:number=1;}",
    "class C{x:number;constructor(){const escape=()=>this.x;this.x=1;}}",
    "function expose(value:{x:number}):void{}class C{x:number;constructor(){expose(this);this.x=1;}}",
  ]) {
    const result = check(source);
    assert.ok(!result.ok, source);
    assert.match(result.error.message, /initializ/, source);
  }
  for (const source of [
    "class C{x:number;constructor(flag:boolean){this.x=flag?1:2;}}",
    "class C{x:number;constructor(){throw 1;}}",
    "class C{x:number|undefined;m():number|undefined{return this.x;}}",
    "class C{f:()=>number=()=>42;}",
    "class C{static x:number=1;static y:number=C.x+1;}",
  ])
    assert.ok(check(source).ok, source);
});

test("class prototypes do not masquerade as initialized instances", () => {
  for (const source of [
    "class C{x:number=1;m():number{return this.x;}}function run():number{return C.prototype.x;}",
    "class C{x:number=1;m():number{return this.x;}}function run():number{return C.prototype.m();}",
  ])
    assert.equal(check(source).ok, false, source);
  const result = check(
    "class C{x:number=1;m():number{return this.x;}}function run(c:C):number{return C.prototype.m.call(c);}",
  );
  assert.ok(result.ok, JSON.stringify(result));
});
