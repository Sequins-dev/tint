import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import {
  checkClosureModule,
  resolveInterfaceTypes,
} from "@tint/typescript/checker";

function typescriptAccepts(source: string): boolean {
  const file = "/tint-typescript-conformance.ts";
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
  };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, fresh) =>
    name === file
      ? ts.createSourceFile(name, source, languageVersion, true)
      : original(name, languageVersion, onError, fresh);
  const program = ts.createProgram([file], options, host);
  return !ts
    .getPreEmitDiagnostics(program)
    .some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
}
function tintAccepts(source: string): boolean {
  const bytes = new TextEncoder().encode(source),
    text = createSourceText(bytes, bytes.length);
  assert.ok(text.ok);
  const parsed = parseModule(text.value);
  return parsed.ok && checkClosureModule(parsed.value).ok;
}
test("satisfies supported contracts agree with the pinned TypeScript checker", () => {
  const cases: readonly [boolean, string][] = [
    [
      true,
      'function f():string{const x={text:"hi",count:1} satisfies {text:string|number,count:number};return x.text.trim();}',
    ],
    [
      true,
      "function f():true{const x={flag:true} satisfies {flag:boolean};return x.flag;}",
    ],
    [true, "function f():42{const n=42 satisfies number;return n;}"],
    [
      true,
      "function f():number{const add=((n)=>n+1) satisfies (n:number)=>number;return add(41);}",
    ],
    [false, "function f():void{const x={n:1,extra:2} satisfies {n:number};}"],
    [false, "function f():void{const x={} satisfies {n:number};}"],
    [
      false,
      "function f():void{const x=({n:1} satisfies {n:number}) satisfies {n:string};}",
    ],
    [false, "function f():void{const x=1 satisfies string;}"],
  ];
  const arraySource =
    'function f():string{const a=["x"] satisfies readonly (number|string)[];a.push("y");return a[0]?.trim()??"";}';
  assert.ok(typescriptAccepts(arraySource));
  assert.ok(tintAccepts(arraySource));
  for (const [expected, source] of [
    [
      true,
      "function f():number{const a=[] satisfies readonly number[];a.length=3;return a.length;}",
    ],
    [false, "function f():void{const a=[] satisfies number[];a.push(1);}"],
  ] as const) {
    assert.equal(typescriptAccepts(source), expected, source);
    assert.equal(tintAccepts(source), expected, source);
  }
  for (const [expected, source] of [
    [
      true,
      'function f():string{const a={nested:{text:"hi"},items:["x"]} satisfies {nested:{text:number|string},items:(number|string)[]};a.items.push("y");return a.nested.text.trim();}',
    ],
    [
      false,
      "function f():void{const a={nested:{text:1}} satisfies {nested:{text:string}};}",
    ],
    [
      false,
      "function f():void{const a={nested:({text:1} satisfies {text:number})} satisfies {nested:{text:string}};}",
    ],
  ] as const) {
    assert.equal(typescriptAccepts(source), expected, source);
    assert.equal(tintAccepts(source), expected, source);
  }
  for (const [expected, source] of cases) {
    assert.equal(typescriptAccepts(source), expected, `TypeScript: ${source}`);
    assert.equal(tintAccepts(source), expected, `Tint: ${source}`);
  }
});

test("array elision inference agrees with the pinned TypeScript checker", () => {
  for (const [expected, source] of [
    [true, 'function f():number{const a=[,"x"];return a[1]?.length??0;}'],
    [
      true,
      "function f():number{const a=[,false];return a[0]===undefined?1:0;}",
    ],
    [true, "function f():number{const a=[,{value:1}];return a[1]?.value??0;}"],
    [true, "function f():number{const a=[,,];return a.length;}"],
    [
      true,
      "function f():number{const a:(number|undefined)[]=[,1,,];return a.length;}",
    ],
    [false, "function f():void{const a:number[]=[,1];}"],
    [false, "function f():void{const a=[,1] satisfies readonly number[];}"],
    [
      true,
      "function f():number{const a=[,1] satisfies readonly (number|undefined)[];return a.length;}",
    ],
  ] as const) {
    assert.equal(typescriptAccepts(source), expected, source);
    assert.equal(tintAccepts(source), expected, source);
  }
});

test("single call and construct signature syntax agrees with the pinned TypeScript checker", () => {
  const cases: readonly [boolean, string][] = [
    [
      true,
      "interface V{x:number;} interface Factory{new(x:number):V;version:number;} interface Both extends Factory{(x:number):string;}",
    ],
    [true, "type Factory<T> = new (x:T) => {value:T};type F=Factory<number>;"],
    [true, "type Hybrid={(x:number):string}&{new(x:number):{x:number}};"],
    [true, "interface R{new():R;}"],
    [false, "type F=new(this:{x:number})=>object;"],
    [false, "interface F{new(this:object):object;}"],
    [false, "interface F{new(x:Missing):number;}"],
  ];
  for (const [expected, source] of cases) {
    assert.equal(typescriptAccepts(source), expected, source);
    const bytes = new TextEncoder().encode(source),
      text = createSourceText(bytes, bytes.length);
    assert.ok(text.ok);
    const parsed = parseModule(text.value);
    assert.equal(
      parsed.ok && resolveInterfaceTypes(parsed.value, []).ok,
      expected,
      source,
    );
  }
});

test("annotated class declaration contracts agree with the pinned TypeScript checker", () => {
  // Contract extraction does not claim to check method bodies or field initialization.
  const cases: readonly [boolean, string][] = [
    [
      true,
      "class C{value:number;constructor(value:number){this.value=value;}getValue():number{return this.value;}}",
    ],
    [
      true,
      "class C<T>{value:T;constructor(value:T){this.value=value;}self():C<T>{return this;}}type N=C<number>;",
    ],
    [
      true,
      "class C{static value:number=1;static read():number{return this.value;}}",
    ],
    [
      false,
      "interface T{x:number;}class C<T>{static value:T;}type N=C<number>;",
    ],
    [false, "class C{value:number=1;value:string='x';}"],
  ];
  for (const [expected, source] of cases) {
    assert.equal(typescriptAccepts(source), expected, source);
    const bytes = new TextEncoder().encode(source),
      text = createSourceText(bytes, bytes.length);
    assert.ok(text.ok);
    const parsed = parseModule(text.value);
    assert.equal(
      parsed.ok && resolveInterfaceTypes(parsed.value).ok,
      expected,
      source,
    );
  }
});

test("construction through typed values agrees with the pinned TypeScript checker", () => {
  for (const [expected, source] of [
    [
      true,
      "function f(C:new(x:number)=>{value:number}):number{return new C(42).value;}",
    ],
    [
      true,
      "function f(C:new(fn:(x:number)=>number)=>{value:number}):number{return new C(x=>x+1).value;}",
    ],
    [
      true,
      "function f(C:new(x?:number)=>{value:number}):number{return new C().value;}",
    ],
    [false, "function f(C:()=>number):number{return new C();}"],
    [
      false,
      "function f(C:new(x:number)=>{value:number}):number{return new C('x').value;}",
    ],
  ] as const) {
    assert.equal(typescriptAccepts(source), expected, source);
    assert.equal(tintAccepts(source), expected, source);
  }
});

test("annotated class bodies and definite field assignment agree on selected TypeScript cases", () => {
  for (const [expected, source] of [
    [
      true,
      "class C{x:number;constructor(x:number){this.x=x;}m():number{return this.x;}}function f():number{return new C(42).m();}",
    ],
    [
      true,
      "class C{x:number;constructor(flag:boolean){if(flag)this.x=1;else this.x=2;}}",
    ],
    [
      true,
      "class C{x:number;constructor(flag:boolean){if(flag)throw 1;this.x=2;}}",
    ],
    [
      true,
      "class A{x:number=1;static tag:number=1;m():number{return this.x;}}class B{x:number=1;static tag:string='b';m():number{return this.x;}}function run():A{return new B();}",
    ],
    [false, "class C{x:number;constructor(flag:boolean){if(flag)this.x=1;}}"],
    [false, "class C{x:number;constructor(){this.x='bad';}}"],
    [false, "class C{x:number=1;m():number{return 'bad';}}"],
  ] as const) {
    assert.equal(typescriptAccepts(source), expected, source);
    assert.equal(tintAccepts(source), expected, source);
  }
});
