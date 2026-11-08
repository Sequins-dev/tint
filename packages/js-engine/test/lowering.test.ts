import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { createKeyIndex } from "@tint/foundation/collections/key-index";
import { bindModule } from "@tint/typescript/binding";
import {
  parseStrictScript,
  parseScript,
  rewriteModule,
  syntaxHash,
  type Expression,
} from "@tint/typescript/syntax";
import * as lowering from "../src/lowering/index.ts";
test("generated Script references keep linking work linear when source spans repeat", () => {
  const result = lower(
    "class Example{" +
      Array.from({ length: 128 }, (_, i) => `#field${i};`).join("") +
      "}",
  );
  assert.ok(result.ok);
  const bound = bindModule(result.value, ["undefined"]);
  assert.ok(bound.ok);
  const references = [
    ...new Set(bound.value.references.map((reference) => reference.node)),
  ];
  let comparisons = 0;
  const index = createKeyIndex<Expression, number>(
    syntaxHash,
    (left, right) => {
      comparisons++;
      return left === right;
    },
  );
  for (const [i, node] of references.entries()) index.set(node, i);
  for (const [i, node] of references.entries())
    assert.equal(index.get(node), i);
  assert.ok(
    comparisons <= references.length * 4,
    `generated reference comparisons: ${comparisons} for ${references.length} nodes`,
  );
});
test("Script value calls lower callee and arguments before callable dispatch", () => {
  for (const text of [
    "nativeIdentity(42);",
    "nativeIdentity();",
    "(0)(missing);",
    "missing(42);",
    "typeof nativeIdentity;",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});
test("Script blocks lower lexical environments and hoisted functions", () => {
  for (const text of [
    "let x=1;{let x=42;x;}",
    "{x;let x;}",
    "{const x=1;x=2;}",
    "{var x=42;}x;",
    "42;{}",
    "{f();function f(){return 42;}}",
    "switch(0){case 0:f();break;case 1:function f(){return 42;}}",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});
test("Script logical negation accepts general values and retains operand effects", () => {
  for (const text of [
    "!null;",
    "!(void 0);",
    "!!this;",
    "!missing;",
    "let x; !(x=42); x;",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});
function lower(text: string) {
  assert.equal(typeof lowering.lowerStrictScript, "function");
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const script = parseStrictScript(source.value);
  assert.ok(script.ok, JSON.stringify(script));
  return lowering.lowerStrictScript(script.value);
}
test("Script if statements lower selected branches and nested conditions", () => {
  for (const text of [
    "42;if(false)1;",
    "if(true)42;else missing;",
    "if(true)if(false)missing;else 42;",
    "if(false)var x=1; x;",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});
test("Script branching expressions lower without eagerly evaluating either arm", () => {
  for (const text of [
    "false && missing;",
    "true || missing;",
    "null ?? 42;",
    "true ? 42 : missing;",
    "let x=0; (x=1) ? (x=42) : (x=2); x;",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});
test("Script lowering produces an explicit runtime entry and source-level global names", () => {
  const result = lower("var x=1; let y=x; x=y; x;");
  assert.ok(result.ok, JSON.stringify(result));
  const entry = result.value.statements.find(
    (node) => node.kind === "function",
  );
  assert.ok(entry?.kind === "function");
  assert.equal(entry.name, "execute");
  assert.equal(entry.exported, true);
  const parameter = entry.parameters[0];
  assert.ok(parameter !== undefined && parameter.kind !== "pattern-parameter");
  assert.equal(parameter.name, "$global");
  const serialized = JSON.stringify(entry.body);
  assert.match(serialized, /resolveBinding/);
  assert.match(serialized, /instantiateGlobalDeclarations/);
  assert.match(serialized, /initializeBinding/);
  assert.doesNotMatch(serialized, /"name":"x"/);
  assert.match(serialized, /"value":"x"/);
});
test("Script lowering preserves early errors and reports unsupported execution explicitly", () => {
  const duplicate = lower("let x; var x;");
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.error.code, "EARLY_ERROR");
  const argumentsObject = lower("function f(){return arguments;} f();");
  assert.ok(argumentsObject.ok, JSON.stringify(argumentsObject));
});

test("binding resource limits are not reported as JavaScript early errors", () => {
  let expression: Expression = {
    start: 0,
    end: 1,
    kind: "number",
    raw: "1",
    value: 1,
  };
  for (let i = 0; i < 300; i++)
    expression = { start: 0, end: 1, kind: "group", expression };
  const result = lowering.lowerStrictScript({
    start: 0,
    end: 1,
    imports: [],
    statements: [{ start: 0, end: 1, kind: "expression", expression }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "LIMIT");
});

test("Script comparisons and sequencing lower without imposing TypeScript overlap restrictions", () => {
  for (const text of [
    '1 === "1";',
    "var x=1; x === (x=2);",
    "var x=1; (x=2,x=42);",
    "void missing;",
    "this !== null;",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("Script typeof distinguishes identifier references from other expressions", () => {
  for (const text of [
    "typeof missing;",
    "typeof (missing);",
    "typeof (0,missing);",
    "typeof x;let x;",
    "typeof null;",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("Script property reads and grouped method calls preserve references", () => {
  for (const text of [
    "this.nativeIdentity(42);",
    "(this.nativeReceiver)() === this;",
    "(0,this.nativeReceiver)();",
    "null.x;",
    "this.absent;",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("Script strict property assignments lower without reading the target property", () => {
  for (const text of [
    "nativeObject.x=42;",
    "(nativeObject.x)=42;",
    "null.x=missing;",
    "let o=nativeObject;o.x=(o=null,42);",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("Script throw statements use native exceptions and preserve the thrown value at the entry", () => {
  for (const text of [
    "throw 42;",
    "throw null;",
    "throw void 0;",
    "if(true){throw 42;}missing;",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
    const entry = result.value.statements.find(
      (node) => node.kind === "function",
    );
    assert.ok(entry?.kind === "function" && entry.body.kind === "block");
    assert.match(JSON.stringify(entry.body), /"kind":"try"/);
    assert.match(JSON.stringify(entry.body), /"kind":"throw"/);
  }
});

test("Script catch and finally lower lexical catch bindings and completion preservation", () => {
  for (const text of [
    "try { missing; } catch(e) { e.name; }",
    "try { throw 42; } catch(e) { e; }",
    "try { 42; } finally { 19; }",
    "try { throw 42; } catch {}",
    "try { throw 1; } finally { throw 2; }",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("Script source functions lower parameters, local declarations and captured scopes", () => {
  for (const text of [
    "(function(x){return x;})(42);",
    "((x)=>x)(42);",
    "function f(x){return x;}f(42);",
    "let x=42;let f=()=>x;f();",
    "function f(x=42){var y=x;return y;}f();",
    "function f(){return ()=>this;}f()();",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("Script object literals allocate ordinary objects and define properties in order", () => {
  for (const text of [
    "({x:42}).x;",
    "let x=42;({x}).x;",
    "({x:1,x:42}).x;",
    "let o={x:42,f(){return this.x;}};o.f();",
    "({['x']:42}).x;",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("Script construction distinguishes ordinary functions from arrows and methods", () => {
  for (const text of [
    "function F(x){this.x=x;}new F(42);",
    "new (()=>42)();",
    "let o={f(){}};new o.f();",
    "new (0)(missing);",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("Script ordinary instanceof lowers prototype checks after both operand effects", () => {
  for (const text of [
    "function F(){}new F() instanceof F;",
    "1 instanceof (()=>{});",
    "({}) instanceof (()=>{});",
    "missing instanceof 0;",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("Script in lowers general operands through property membership", () => {
  for (const text of [
    "'x' in {x:42};",
    "0 in [1];",
    "({toString(){throw 42;}}) in null;",
    "'x' in Object.create({x:1});",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("Script arithmetic lowers general operands through runtime conversion", () => {
  for (const text of [
    "null == undefined;",
    "false != '0';",
    "({valueOf(){return 42;}}) == '42';",
    "40+2;",
    "'84'/2;",
    "1 / -0;",
    "+null;",
    "-true;",
    "5%2;",
    "~1;",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("Script switch lowers ordered case selection, fallthrough and shared lexical scope", () => {
  for (const text of [
    "switch(1){case 1:42;break;default:19;}",
    "switch(2){default:19;case 2:42;}",
    "switch(1){case 1:let x=42;case 2:x;}",
    "switch(1){case x:break;case 2:let x=1;}",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("Script updates and compound assignments capture references and preserve result semantics", () => {
  for (const text of [
    "let x='41';++x;",
    "let x=42;x++;",
    "let x=40;x+=2;",
    "let o={x:40};o.x+=2;",
    "let x=0;x&&=missing;",
    "let x=42;x||=missing;",
    "let x=null;x??=42;",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("Script relational operators lower captured general operands", () => {
  for (const text of ["1<2;", "'2'>'10';", "null<=0;", "NaN>=0;"]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("Script loops lower iteration environments and native abrupt control flow", () => {
  for (const text of [
    "for(var i=0;i<3;i++){}",
    "for(let i=0;i<3;i++){if(i===1)continue;}",
    "for(const i=1;;){break;}",
    "let i=0;while(i<3)i++;",
    "let i=0;do{i++;continue;}while(i<3);",
    "for(let i=0;i<3;i++){try{continue;}finally{i++;}}",
    "let f;for(let i=0;i<3;i++)f=()=>i;f();",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("Script computed references share property reads writes and receiver calls", () => {
  for (const text of [
    "let o={x:1};o['x'];",
    "let o={x:1};o['x']+=41;",
    "let o={x:1};o['x']++;",
    "let o={f(){return this;}};(o['f'])();",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("base class declarations and expressions lower to native class runtime operations", () => {
  for (const text of [
    "class C{x=42;get(){return this.x;}}new C().get();",
    "let C=class Named {static x=42;};C.x;",
    "class C{constructor(x){this.x=x;}static make(){return new C(42);}}C.make().x;",
    "{class C{} new C();}",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("strict Script lowering refuses explicitly sloppy input", async () => {
  const { parseScript } = await import("@tint/typescript/syntax");
  const bytes = new TextEncoder().encode("var x=1;x;");
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseScript(source.value);
  assert.ok(parsed.ok);
  const result = lowering.lowerStrictScript(parsed.value);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "UNSUPPORTED");
});

test("mode-aware Script lowering accepts sloppy globals and duplicate parameters", async () => {
  const { parseScript } = await import("@tint/typescript/syntax");
  assert.equal(typeof lowering.lowerScript, "function");
  for (const text of [
    "missing=42;missing;",
    "function f(a,a){return a;}f(1,42);",
    "function f(){return this;}f();",
    "nativeObject.fixed=42;",
  ]) {
    const bytes = new TextEncoder().encode(text),
      source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    const parsed = parseScript(source.value);
    assert.ok(parsed.ok, JSON.stringify(parsed));
    const result = lowering.lowerScript(parsed.value);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("array literals lower through array-object construction", () => {
  const result = lower("let a=[1,2];a.length=1;a[0];");
  assert.ok(result.ok, JSON.stringify(result));
});

test("array elisions preserve absent elements and trailing length", () => {
  const result = lower("let a=[,undefined,,];a.length;");
  assert.ok(result.ok, JSON.stringify(result));
});

test("object methods and accessors capture the literal home while function properties do not", () => {
  const result = lower("({m(){},get x(){},set x(v){},f:function(){}});");
  assert.ok(result.ok, JSON.stringify(result));
  const calls: Expression[] = [];
  JSON.stringify(result.value, (key, value) => {
    if (value?.kind === "call" && value.callee?.name === "createSourceFunction")
      calls.push(value);
    return value;
  });
  assert.equal(calls.length, 4);
  const homes = calls.map((node) =>
    node.kind === "call" ? node.arguments[6] : undefined,
  );
  for (const home of homes.slice(0, 3)) {
    assert.equal(home?.kind, "identifier");
    assert.notEqual(
      home?.kind === "identifier" ? home.name : undefined,
      "undefined",
    );
  }
  const homeNames = homes
    .slice(0, 3)
    .map((home) => (home?.kind === "identifier" ? home.name : undefined));
  assert.equal(homeNames[0], homeNames[1]);
  assert.equal(homeNames[1], homeNames[2]);
  assert.equal(
    homes[3]?.kind === "identifier" ? homes[3].name : undefined,
    "undefined",
  );
});

test("class heritage lowers through validated constructor and prototype parents", () => {
  for (const text of [
    "class A{}class B extends A{}new B();",
    "class B extends null{}",
    "class A{m(){return 42;}}class B extends A{m(){return super.m();}}",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
    const serialized = JSON.stringify(result.value);
    assert.match(serialized, /classHeritage/);
    assert.match(serialized, /createDerivedClass/);
  }
});

test("new.target lowers through ordinary, derived and lexical function contexts", () => {
  for (const text of [
    "function F(){return new.target;} new F();",
    "class A{constructor(){this.target=new.target;}} class B extends A{} new B();",
    "class A{} class B extends A{constructor(){let target=new.target;super();}} new B();",
    "function F(){return ()=>new.target;}new F();",
    "class C{x=new.target;m(){return new.target;}}new C();",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("static blocks lower alongside static fields with independent lexical scopes", () => {
  for (const text of [
    "class C{static{this.x=42;}}C.x;",
    "class C{static x=1;static{this.x++;}static y=this.x;}",
    "class C{static{var x=1;let y=2;}static{var x=3;let y=4;}}",
    "class A{static x=42;}class B extends A{static{this.y=super.x;}}",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("private fields and brand checks lower with per-class identities", () => {
  for (const text of [
    "class C{#x=42;get(){return this.#x;}}new C().get();",
    "class C{static #x=42;static get(){return this.#x;}}C.get();",
    "class C{#x;has(o){return #x in o;}}new C().has({});",
    "class C{#x=1;inc(){return ++this.#x;}}new C().inc();",
  ])
    assert.ok(lower(text).ok, text);
});

test("private methods and paired accessors lower as class initialization elements", () => {
  for (const text of [
    "class C{x=this.#m();#m(){return 42;}}new C().x;",
    "class C{#v=1;get #x(){return this.#v;}set #x(v){this.#v=v;}m(){this.#x=42;return this.#x;}}new C().m();",
    "class C{static x=this.#m();static #m(){return 42;}}C.x;",
  ])
    assert.ok(lower(text).ok, text);
});

test("optional chains lower short-circuiting references, calls and deletion", () => {
  for (const text of [
    "let o=null;o?.x.y;",
    "let o={m(){return this;}};o?.m();o.m?.();(o?.m)();",
    "let o=null;delete o?.[missing];",
    "class C{#x=42;m(o){return o?.#x;}}new C().m(null);",
    "class A{m(){return 42;}}class B extends A{m(){return super.m?.();}}new B().m();",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("Script rest parameters lower fresh arrays and non-simple argument environments", () => {
  for (const text of [
    "function f(a,...rest){return rest;}f(1,2,3);",
    "const f=(...rest)=>rest;f(42);",
    "class C{constructor(...rest){this.rest=rest;}m(...rest){return rest;}}new C(42).m();",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("Script template substitutions lower ordered string-hint coercion", () => {
  const result = lower(
    "let n=0;const o={toString(){n++;return 'x';}};`a${o}b${n}c`;",
  );
  assert.ok(result.ok, JSON.stringify(result));
});

test("tagged templates lower persistent source sites and receiver-preserving calls", () => {
  const result = lower(
    "let o={tag(parts,x){return x;}};function f(){return o.tag`a${42}b`;}f();f();",
  );
  assert.ok(result.ok, JSON.stringify(result));
  if (result.ok)
    assert.ok(result.value.statements.some((node) => node.kind === "variable"));
});
test("object binding declarations lower ordered property reads, defaults and rest", () => {
  for (const source of [
    "const {x,y:z=42,[key()]:{deep=1},...rest}=source;",
    "function f(){var {x=42}={};return ()=>x;}f()();",
    "for(let {x}={x:0};x<2;x++){(()=>x)();}",
  ]) {
    const result = lower(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
});
test("catch object patterns lower bindings before ordered initialization", () => {
  const result = lower("try{throw {};}catch({x=42,y=x,...rest}){y;}");
  assert.ok(result.ok, JSON.stringify(result));
});
test("for-in object bindings lower per-iteration initialization", () => {
  for (const source of [
    "for (const {length:n,...rest} in {abc:1}) {n;}",
    "for (var {[key()]:x=42} in source) {x;}",
  ]) {
    const result = lower(source);
    assert.ok(result.ok, JSON.stringify(result));
    JSON.stringify(result.value, (key, value: unknown) => {
      if (key === "value") assert.notEqual(value, undefined);
      return value;
    });
  }
});
test("object parameters lower leaves and parameter expression environments", () => {
  for (const source of [
    "function f({x=42,y=x}={}){return y;}f();",
    "const f=({x})=>x;f({x:42});",
    "function f(...{length:n}){return n;}f(1,2);",
  ]) {
    const result = lower(source);
    assert.ok(result.ok, JSON.stringify(result));
    JSON.stringify(result.value, (key, value: unknown) => {
      if (key === "value") assert.notEqual(value, undefined);
      return value;
    });
  }
});
test("object assignments lower captured targets, defaults and rest", () => {
  for (const source of [
    "let x,rest;({x=42,...rest}={});x;",
    "let o={};({x:o.value=42}={});o.value;",
    "let n;for({length:n} in {abc:1}){}n;",
  ]) {
    const result = lower(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("Script for-of lowers iterator acquisition, per-iteration bindings and abrupt cleanup", () => {
  for (const source of [
    "for(const x of values){if(x)break;}",
    "for(let {x=1} of values){continue;}",
    "for(var x of values){throw x;}",
    "let x;for(x of values){if(x)break;}",
    "let x;for({x=1} of values){continue;}",
    "let target={};for(target.value of values){}",
    "for(const [x,,y] of values){if(x)break;}",
    "for(var [] of values){}",
    "for(const [x,...rest] of values){if(x)break;}",
  ]) {
    const result = lower(source);
    assert.ok(result.ok, JSON.stringify(result));
    const serialized = JSON.stringify(result.value);
    assert.match(serialized, /getScriptIterator/);
    assert.match(serialized, /stepScriptIterator/);
    assert.match(serialized, /closeScriptIterator/);
  }
});

test("array spread lowers through iterator acquisition", () => {
  const result = lower("const values=[1,...source,,2];");
  assert.ok(result.ok, JSON.stringify(result));
  assert.match(JSON.stringify(result.value), /appendScriptArraySpread/);
});
test("array declaration bindings share recursive iterator lowering", () => {
  for (const source of [
    "const [x,...r]=values;",
    "let [[x],{a:[y]}]=values;",
    "function f([x]=[]){return x;}",
    "try{}catch([x]){}",
  ]) {
    const result = lower(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
});
test("array assignments lower nested patterns, defaults and rest through iterators", () => {
  for (const source of [
    "let x,r;[x=1,...r]=values;",
    "let x;[[x]]=values;",
    "let x;({a:[x]}=value);",
    "let x;for([x] of values){}",
  ]) {
    const result = lower(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
});
test("call and constructor spread lower through shared argument collection", () => {
  for (const source of [
    "f(1,...values,2);",
    "new C(...values);",
    "class C extends B{constructor(){super(...values);}}",
  ]) {
    const result = lower(source);
    assert.ok(result.ok, JSON.stringify(result));
    assert.match(JSON.stringify(result.value), /appendScriptArguments/);
  }
});

test("generator calls separate eager initialization from lazy non-suspending bodies", () => {
  for (const text of [
    "function*g(a=42){return a;}g();",
    "function f(){function*g(){return 42;}return g;}",
    "const g=function* self(){return self;};",
    "({*g(){return this;}});",
    "class C{*g(){return this;}}",
    "class C{static *g(){return this;}}",
    "class C{*#g(){return 42;}read(){return this.#g();}}",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
    assert.match(JSON.stringify(result.value), /createSourceGeneratorFunction/);
    assert.match(JSON.stringify(result.value), /GeneratorContinuation/);
  }
});

test("sequential yields lower into native continuations", () => {
  for (const text of [
    "function*g(){yield 1;return yield 2;}",
    "function*g(){let x=yield 1;yield x;return x;}",
    "const g=function*(){return (yield 1)+(yield 2);};",
    "({*g(){yield this;}});",
    "class C{*g(){yield this;}}",
    "function*g(){yield* [1,2];return 42;}",
    "function*g(){return yield* [1,2];}",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
    assert.match(JSON.stringify(result.value), /createIteratorResult/);
  }
});

test("branch and block suspensions preserve their continuation", () => {
  for (const text of [
    "function*g(x){if(x)yield 1;else yield 2;return 42;}",
    "function*g(){return true ? yield 1 : yield 2;}",
    "function*g(x){return x && (yield 42);}",
    "function*g(){{let x=yield 1;yield x;}return 42;}",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
    const serialized = JSON.stringify(result.value);
    assert.match(serialized, /runGeneratorSteps/);
    assert.match(serialized, /"value":"transfer"/);
  }
});

test("loop suspensions use transfer targets for iteration and exits", () => {
  for (const text of [
    "function*g(){let i=0;while(i<3){yield i++;}}",
    "function*g(){for(let i=0;i<3;i++){if(i===1)continue;yield i;break;}}",
    "function*g(){let i=0;do{yield i++;}while(i<3);}",
    "function*g(){for(const x in {a:1})yield x;}",
    "function*g(){while(true){yield* [1];break;}}",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("catch scopes retain their handler across generator suspension", () => {
  for (const text of [
    "function*g(){try{yield 1;}catch(e){yield e;}}",
    "function*g(){try{throw 1;}catch({x}){yield x;}}",
    "function*g(){try{while(true){yield 1;}}catch{yield 2;}}",
    "function*g(){try{yield* [1];}catch(e){return e;}}",
    "function*g(){try{try{yield 1;}catch(e){throw e;}}catch(e){yield e;}}",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("finally scopes route pending completions through suspension", () => {
  for (const text of [
    "function*g(){try{yield 1;}finally{yield 42;}}",
    "function*g(){try{return 1;}finally{yield 42;}}",
    "function*g(){try{throw 1;}catch(e){yield e;}finally{yield 42;}}",
    "function*g(){while(true){try{yield 1;break;}finally{yield 42;}}}",
    "function*g(){for(const x of [1]){yield x;}}",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("switch suspension preserves clause selection and fallthrough", () => {
  for (const text of [
    "function*g(x){switch(x){case 1:yield 1;case 2:yield 2;break;default:yield 42;}}",
    "function*g(){switch(yield 1){case yield 2:yield 42;}}",
    "function*g(){while(true){switch(1){case 1:yield 1;continue;}}}",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("labelled suspension routes named exits and loop backedges", () => {
  for (const text of [
    "function*g(){outer:while(true){yield 1;break outer;}}",
    "function*g(){outer:inner:for(let n=0;n<2;n++){yield n;continue outer;}}",
    "function*g(){done:{yield 1;break done;}yield 42;}",
    "function*g(){outer:while(true){try{yield 1;break outer;}finally{yield 42;}}}",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("Script entries enter their realm and retain a distinct source identity", () => {
  const result = lower("42;");
  assert.ok(result.ok);
  const entry = result.value.statements.find(
    (node) => node.kind === "function",
  );
  assert.ok(entry?.kind === "function" && entry.body.kind === "block");
  assert.equal(entry.body.statements[0]?.kind, "variable");
  const statement = entry.body.statements[1];
  assert.ok(statement?.kind === "return");
  const call = statement.expression;
  assert.ok(call?.kind === "call");
  assert.ok(call.callee.kind === "identifier");
  assert.equal(call.callee.name, "runScriptContext");
  assert.equal(call.typeArguments?.length, 1);
  assert.match(JSON.stringify(call.arguments[1]), /"name":"scriptOrModule"/);
  assert.match(JSON.stringify(call.arguments[1]), /"name":"\$script"/);
  assert.doesNotMatch(JSON.stringify(call.arguments[1]), /"name":"execute"/);
  const action = call.arguments[2];
  assert.ok(action?.kind === "arrow" && action.body.kind === "block");
  assert.equal(action.body.statements[0]?.kind, "try");
});

test("async declarations and expressions lower through the Promise call boundary", () => {
  for (const text of [
    "async function f(){return 42;}f();",
    "const f=async x=>x;f(42);",
    "async function f(){try{return await 42;}catch(e){return e;}finally{await 19;}}f();",
    "({async f(){return 42;}}).f();",
    "class C{async f(){return 42;}}new C().f();",
    "let f=async function(){return 42;};f();",
    "let f=async function named(){return named;};f();",
    "function outer(){async function inner(){return 42;}return inner();}outer();",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
    let found = false;
    rewriteModule(result.value, {
      expression(node) {
        if (
          node.kind === "call" &&
          node.callee.kind === "identifier" &&
          node.callee.name === "createSourceAsyncContinuationFunction"
        )
          found = true;
        return node;
      },
    });
    assert.ok(found);
  }
});

test("async generators lower through distinct await and yield native segments", () => {
  for (const text of [
    "async function* f(){yield await 42;return 19;}f();",
    "const f=async function*(){try{yield 42;}finally{await 1;yield 19;}};f();",
    "({async *f(){yield 42;}}).f();",
    "class C{async *f(){yield 42;}}new C().f();",
  ]) {
    const result = lower(text);
    assert.ok(result.ok, JSON.stringify(result));
    const calls: string[] = [];
    const kinds: string[] = [];
    rewriteModule(result.value, {
      expression(node) {
        if (node.kind === "call" && node.callee.kind === "identifier")
          calls.push(node.callee.name);
        if (node.kind === "object")
          for (const property of node.properties)
            if (
              property.kind !== "spread" &&
              property.name === "kind" &&
              property.value.kind === "string"
            )
              kinds.push(property.value.value);
        return node;
      },
    });
    assert.ok(calls.includes("createSourceAsyncGeneratorFunction"));
    assert.ok(calls.includes("runAsyncGeneratorSteps"));
    assert.ok(kinds.includes("await"));
    assert.ok(kinds.includes("yield"));
  }
});

test("for-await lowers next and cleanup through native suspension", () => {
  const result = lower(
    "async function f(){for await(const x of xs){if(x)break;}}f();",
  );
  assert.ok(result.ok, JSON.stringify(result));
  const calls: string[] = [];
  rewriteModule(result.value, {
    expression(node) {
      if (node.kind === "call" && node.callee.kind === "identifier")
        calls.push(node.callee.name);
      return node;
    },
  });
  for (const name of [
    "getScriptAsyncIterator",
    "nextScriptAsyncIterator",
    "finishScriptAsyncIteratorStep",
    "beginScriptAsyncIteratorClose",
    "finishScriptAsyncIteratorClose",
  ])
    assert.ok(calls.includes(name), name);
});

test("async yield delegation acquires an async iterator and uses native continuation steps", () => {
  const result = lower(
    "async function* f(){try{return yield* xs;}finally{await cleanup();}}f();",
  );
  assert.ok(result.ok, JSON.stringify(result));
  const calls: string[] = [];
  rewriteModule(result.value, {
    expression(node) {
      if (node.kind === "call" && node.callee.kind === "identifier")
        calls.push(node.callee.name);
      return node;
    },
  });
  assert.ok(calls.includes("getScriptAsyncIterator"));
  assert.ok(calls.includes("createAsyncDelegatingContinuation"));
  assert.ok(calls.includes("runAsyncGeneratorSteps"));
});

test("regexp literal lowering creates a fresh object without a global constructor lookup", () => {
  const result = lower("/x/g;");
  assert.ok(result.ok, JSON.stringify(result));
  const calls: string[] = [];
  rewriteModule(result.value, {
    expression(node) {
      if (node.kind === "call" && node.callee.kind === "identifier")
        calls.push(node.callee.name);
      return node;
    },
  });
  assert.ok(calls.includes("createRegExpLiteral"));
});

test("sloppy for-in initializers lower before enumeration", () => {
  const bytes = new TextEncoder().encode(
    "for(var x=initialize() in source()){}x;",
  );
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseScript(source.value);
  assert.ok(parsed.ok);
  const result = lowering.lowerScript(parsed.value);
  assert.ok(result.ok, JSON.stringify(result));
});
test("sloppy call assignment targets lower runtime reference failures", () => {
  for (const text of [
    "f()=rhs();",
    "f()+=rhs();",
    "f()++;",
    "for(f() of values){}",
  ]) {
    const bytes = new TextEncoder().encode(text),
      source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    const parsed = parseScript(source.value);
    assert.ok(parsed.ok);
    const result = lowering.lowerScript(parsed.value);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("var object destructuring resolves its destination before reading the property and default", () => {
  const text = "var target;with(env){var {p:target=defaultValue}=source;}";
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseScript(source.value);
  assert.ok(parsed.ok);
  const lowered = lowering.lowerScript(parsed.value);
  assert.ok(lowered.ok, JSON.stringify(lowered));
  const events: string[] = [];
  rewriteModule(lowered.value, {
    expression(node) {
      if (node.kind === "call" && node.callee.kind === "identifier") {
        if (node.callee.name === "getObjectValueProperty") events.push("get");
        const name = node.arguments[1];
        // Fused identifier reads resolve at the same point as resolveBinding.
        if (
          (node.callee.name === "resolveBinding" ||
            node.callee.name === "getIdentifierValue") &&
          name?.kind === "string"
        )
          events.push("resolve:" + name.value);
      }
      return node;
    },
  });
  const target = events.indexOf("resolve:target");
  assert.ok(
    target >= 0 && target < events.indexOf("get"),
    JSON.stringify(events),
  );
  assert.ok(
    target < events.indexOf("resolve:defaultValue"),
    JSON.stringify(events),
  );
});

test("var array destructuring resolves destinations before advancing or collecting the iterator", () => {
  for (const [pattern, operation] of [
    ["[target=defaultValue]", "stepScriptIterator"],
    ["[...target]", "collectScriptIterator"],
  ]) {
    const bytes = new TextEncoder().encode(
      `var target;with(env){var ${pattern}=source;}`,
    );
    const source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    const parsed = parseScript(source.value);
    assert.ok(parsed.ok);
    const lowered = lowering.lowerScript(parsed.value);
    assert.ok(lowered.ok, JSON.stringify(lowered));
    const events: string[] = [];
    rewriteModule(lowered.value, {
      expression(node) {
        if (node.kind === "call" && node.callee.kind === "identifier") {
          if (node.callee.name === operation) events.push("advance");
          const name = node.arguments[1];
          if (node.callee.name === "resolveBinding" && name?.kind === "string")
            events.push("resolve:" + name.value);
        }
        return node;
      },
    });
    assert.ok(
      events.indexOf("resolve:target") >= 0 &&
        events.indexOf("resolve:target") < events.indexOf("advance"),
      JSON.stringify(events),
    );
  }
});

test("function source retention preserves comments, Unicode and method prefixes", () => {
  const text =
    "/* 😀 */ function f /* a */(x){return x;} const a = (x) => x; const o={async /* b */ *g(){yield 1;},get x(){return 1;}}; class C {static /* c */ async *m(){yield 2;} get x(){return 3;}}";
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseScript(source.value);
  assert.ok(parsed.ok);
  const result = lowering.lowerScript(parsed.value, text);
  assert.ok(result.ok, JSON.stringify(result));
  const retained: string[] = [];
  rewriteModule(result.value, {
    expression(node) {
      if (node.kind === "call" && node.callee.kind === "identifier") {
        if (node.callee.name === "retainFunctionSource") {
          const text = node.arguments[1];
          if (text?.kind === "string") retained.push(text.value);
        }
        if (node.callee.name === "defineClassAccessor") {
          const text = node.arguments.at(-1);
          if (text?.kind === "string") retained.push(text.value);
        }
      }
      return node;
    },
  });
  for (const expected of [
    "function f /* a */(x){return x;}",
    "(x) => x",
    "async /* b */ *g(){yield 1;}",
    "get x(){return 1;}",
    "class C {static /* c */ async *m(){yield 2;} get x(){return 3;}}",
    "async *m(){yield 2;}",
    "get x(){return 3;}",
  ])
    assert.ok(
      retained.includes(expected),
      JSON.stringify({ expected, retained }),
    );
});

test("resource scopes lower loop headers and suspended cleanup", () => {
  for (const source of [
    "for(using x=null;false;){}",
    "for(using x of []){continue;}",
    "function*g(){using x=null;yield 1;}",
    "async function f(){await using x=null;await 1;}",
    "async function f(){for(await using x of []){continue;}}",
  ]) {
    const result = lower(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("labelled sloppy block functions are instantiated before block statements", () => {
  const bytes = new TextEncoder().encode(
    "{ f(); label: function f(){return 42;} }",
  );
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseScript(source.value);
  assert.ok(parsed.ok);
  const result = lowering.lowerScript(parsed.value);
  assert.ok(result.ok, JSON.stringify(result));
  assert.match(JSON.stringify(result.value), /"name":"initializeBinding"/);
});

test("suspending callbacks enter their driver through a transfer record", () => {
  for (const source of [
    "function*g(){yield 1}",
    "async function h(){await 1}",
    "async function*g(){yield 1}",
  ]) {
    const result = lower(source);
    assert.ok(result.ok, JSON.stringify(result));
    let found = 0;
    rewriteModule(result.value, {
      expression(node) {
        if (
          node.kind === "call" &&
          node.callee.kind === "identifier" &&
          (node.callee.name === "runGeneratorSteps" ||
            node.callee.name === "runAsyncGeneratorSteps")
        ) {
          const transfer = node.arguments[0];
          assert.equal(transfer?.kind, "object");
          if (transfer?.kind !== "object") throw Error("missing transfer");
          assert.deepEqual(
            transfer.properties.map((x) => ("name" in x ? x.name : undefined)),
            ["kind", "next", "inputKind", "value"],
          );
          found++;
        }
        return node;
      },
    });
    assert.equal(found, 1);
  }
});
