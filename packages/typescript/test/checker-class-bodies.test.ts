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
test("classes declared directly in a non-generic module-level function resolve there", () => {
  // Module instances evaluate module classes in their initializer function.
  const local = check(
    "function init():number{class C{x:number=1;m():number{return this.x;}}return new C().m();}",
  );
  assert.ok(local.ok, JSON.stringify(local));
  assert.equal(local.value.classes.length, 1);
  for (const [source, message] of [
    // A generic function's type parameters are not in module scope.
    [
      "function init<T>(value:T):number{class C{x:number=1;}return new C().x;}",
      /generic functions require specialization/,
    ],
    // Nested classes need scoped contract resolution, and a body class may
    // not shadow another declaration.
    [
      "function init():number{if(true){class C{x:number=1;}return new C().x;}return 0;}",
      /local classes require scoped contract resolution/,
    ],
    [
      "function init():number{const f=():number=>{class C{x:number=1;}return new C().x;};return f();}",
      /local classes require scoped contract resolution/,
    ],
    [
      "class C{x:number=2;}function init():number{class C{x:number=1;}return new C().x;}",
      /local classes require scoped contract resolution/,
    ],
  ] as const) {
    const result = check(source);
    assert.ok(!result.ok, source);
    assert.equal(result.error.code, "UNSUPPORTED", source);
    assert.match(result.error.message, message, source);
  }
});
test("delete follows TypeScript's strict checks (TS2704, TS2790) and fails the build", () => {
  const prefix =
    "class P{readonly a:number=1;readonly b?:number;c:number=1;d:unknown=1;e!:number;f?:number;constructor(){this.e=1;}}" +
    "interface R{g:number;h?:number;}export function run(r:R):boolean{const p=new P();return ";
  for (const [operand, code] of [
    ["p.a", "TS2704"],
    ["p.b", "TS2704"],
    ['p["c"]', "TS2790"],
    ["p.e", "TS2790"],
    ["r.g", "TS2790"],
  ] as const) {
    const text = prefix + "delete " + operand + ";}";
    const result = check(text);
    assert.ok(!result.ok, operand);
    assert.equal(result.error.code, code, operand);
    assert.equal(text.slice(result.error.start, result.error.end), operand);
    assert.equal(result.error.preventsFallback, true, operand);
  }
  // Operands that admit undefined (optional, `unknown`) are valid TypeScript
  // and are deleted on the typed path.
  for (const operand of ["p.d", "p.f", "r.h"]) {
    const result = check(prefix + "delete " + operand + ";}");
    assert.ok(result.ok, JSON.stringify({ operand, result }));
  }
});
test("optional class fields admit undefined and need no constructor assignment", () => {
  const result = check(
    "class P{x?:number;y:number=1;}export function run():number{const p=new P();const x=p.x;return x===undefined?p.y:x;}",
  );
  assert.ok(result.ok, JSON.stringify(result));
});
test("own methods called during construction are analyzed in place", () => {
  for (const source of [
    "class C{x:number=1;y:number=this.read();read():number{return this.x;}}",
    "class C{x:number;y:number;constructor(){this.x=1;this.init();}init():void{this.y=this.x*2;}}",
    "class C{x:number;y:number;constructor(){this.x=1;this.init();}init():void{if(this.x>0){this.y=1;}else{this.y=2;}}}",
    "class C{x:number;items:number[];constructor(n:number){this.x=n;this.items=[];this.fill(n);}fill(n:number):void{for(let i=0;i<n;i++)this.items.push(i*this.x);}}",
    "class C{x:number;constructor(){this.a();this.x=1;}a():void{this.b();}b():void{}}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify({ source, result }));
  }
  // An early return or a loop does not definitely assign: the field is
  // unassigned when construction completes.
  for (const source of [
    "class C{x:number;y:number;constructor(){this.x=1;this.init();}init():void{if(this.x>0)return;this.y=2;}}",
    "class C{x:number;y:number;constructor(){this.x=1;this.init();}init():void{for(let i=0;i<3;i++){this.y=i;}}}",
  ]) {
    const result = check(source);
    assert.ok(!result.ok, source);
    assert.equal(result.error.code, "UNINITIALIZED", source);
  }
});
/** Field names the checker records as possibly read before assignment. */
function unproven(source: string): string[] {
  const result = check(source);
  assert.ok(result.ok, JSON.stringify({ source, result }));
  const names: string[] = [];
  for (const contract of result.value.classes)
    for (const member of contract.members) {
      const element = member.node;
      if (
        element.kind === "field" &&
        element.key.kind === "string" &&
        result.value.uninitializedFields?.get(element) === true
      )
        names.push(element.key.value);
    }
  return names;
}
test("fields code may read before assignment stay typed and are recorded", () => {
  for (const [source, names] of [
    // A method reads the field before its assignment.
    [
      "class C{x:number;constructor(){this.x=this.twice();}twice():number{return this.x*2;}}",
      ["x"],
    ],
    [
      "class C{x:number;constructor(){this.m();this.x=1;}m():number{return this.x;}}",
      ["x"],
    ],
    // Direct early reads: the pinned TypeScript reports TS2565 and TS2729
    // here, which this checker does not reproduce yet (see
    // docs/design-typed-classes.md); they read undefined exactly.
    ["class C{x:number;constructor(){this.x=this.x+1;}}", ["x"]],
    ["class C{x:number=this.y;y:number=1;}", ["y"]],
    // Recursion, an own override, a written prototype and an escape of
    // `this` are not followed: unassigned fields may be observed.
    [
      "class C{x:number;constructor(){this.a();this.x=1;}a():void{this.a();}}",
      ["x"],
    ],
    [
      "class C{x:number;m():number{return 1;}constructor(){this.m=():number=>2;this.m();this.x=1;}}",
      ["x"],
    ],
    [
      "class C{x:number;constructor(){this.m();this.x=1;}m():void{}}function patch():void{C.prototype.m=function(this:C):void{};}",
      ["x"],
    ],
    [
      'function see(c:C):number{return c.y;}class C{x:number;y:number;s:string;constructor(){this.x=1;see(this);this.y=2;this.s="";}}',
      ["y", "s"],
    ],
    // Assigned before every observation: nothing is recorded.
    [
      "function see(c:C):number{return c.y;}class C{y:number;constructor(){this.y=2;see(this);}}",
      [],
    ],
  ] as const)
    assert.deepEqual(unproven(source), names, source);
  // Speculative reads are typed for one primitive category; other storage,
  // static fields and non-numeric updates are not lowered yet.
  for (const [source, code] of [
    [
      "class D{}class C{d:D;constructor(){this.read();this.d=new D();}read():D{return this.d;}}",
      "UNINITIALIZED",
    ],
    ["class C{static a:number=C.b;static b:number=1;}", "UNINITIALIZED"],
    [
      "class C{b:boolean;constructor(){this.add();this.b=false;}add():void{this.b||=true;}}",
      "UNSUPPORTED",
    ],
    [
      "class C{n:number;constructor(){this.add();this.n=1;}add():void{this.n??=2;}}",
      "UNSUPPORTED",
    ],
  ] as const) {
    const result = check(source);
    assert.ok(!result.ok, source);
    assert.equal(result.error.code, code, source);
  }
});
