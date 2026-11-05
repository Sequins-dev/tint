import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { planClosures } from "@tint/ts-native/closure/layout";
import { verify } from "@tint/ir/scalar";
import {
  lowerClosureEntries,
  lowerClosureFactory,
  planScalarClosures,
} from "@tint/ts-native/closure/lowering";
function fixture(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const layouts = planClosures(
    checked.value.bindings,
    checked.value.bindings.bindings
      .filter((b) => b.captured)
      .map((b) => ({ binding: b.id, size: 8, alignment: 8 })),
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
  );
  assert.ok(layouts.ok);
  const environment = layouts.value.environments[0];
  assert.ok(environment);
  return { checked: checked.value, environment };
}
test("captured numeric throws survive guarded-cell SSA rewriting", () => {
  const f = fixture(
    "function make(start:number):()=>number {let value=start;return ()=>{throw value;};}",
  );
  const result = lowerClosureEntries(f.checked, [1], f.environment);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});
test("counter closure source lowers through scalar IR with guarded shared cells", () => {
  const f = fixture(
    "interface Counter { readonly add:(n:number)=>number; readonly get:()=>number } function make(start:number):Counter { let x=start; return {add:n=>{x+=n;return x;},get:()=>x}; }",
  );
  const r = lowerClosureEntries(f.checked, [1, 2], f.environment);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  assert.equal(r.value.module.functions.length, 2);
  assert.equal(r.value.module.functions[0]?.parameters.length, 1);
  assert.equal(r.value.module.functions[1]?.parameters.length, 0);
  assert.ok(
    r.value.module.functions[0]?.blocks.some(
      (b) => b.terminator.kind === "cell" && b.terminator.operation === "write",
    ),
  );
  assert.ok(
    r.value.module.functions[1]?.blocks.some(
      (b) => b.terminator.kind === "trap",
    ),
  );
});
test("side effects, prefix/postfix snapshots and control flow survive cell splitting", () => {
  const f = fixture(
    "interface C { readonly run:(n:number)=>number } function make():C { let x=1; return {run:n=>{ let total=0; for(let i=0;i<n;i++){ total+=x++; } x+=(x=3); return total+x; }}; }",
  );
  const r = lowerClosureEntries(f.checked, [1], f.environment);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});
test("unsupported entries and mismatched representations fail without partial IR", () => {
  const f = fixture(
    "interface C { readonly run:()=>number } function make():C { let x=1; return {run:()=>x}; }",
  );
  for (const ids of [[0], [99], [1, 1]])
    assert.ok(!lowerClosureEntries(f.checked, ids, f.environment).ok);
  assert.ok(
    !lowerClosureEntries(f.checked, [1], { ...f.environment, cells: [] }).ok,
  );
});

test("boolean captures and optional numeric results use their scalar encodings", () => {
  for (const source of [
    "interface C { readonly run:()=>boolean } function make():C { let x=true; return {run:()=>{x=!x;return x;}}; }",
    "interface C { readonly run:(n:number)=>number|undefined } function make():C { let x=1; return {run:n=>{if(n>0)return x;}}; }",
  ]) {
    const f = fixture(source);
    const r = lowerClosureEntries(f.checked, [1], f.environment);
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok(verify(r.value.module).ok);
  }
});

test("entry lowering rejects unsupported calls and multiple capture scopes", () => {
  const f = fixture(
    "interface C { readonly run:()=>number } function make():C { let x=1; function other():number {return 2;} return {run:()=>x+other()}; }",
  );
  assert.ok(!lowerClosureEntries(f.checked, [2], f.environment).ok);
  const nested = fixture(
    "function make():number {let x=1; function outer():number {let y=2; function inner():number {return x+y;} return inner();} return outer();}",
  );
  assert.ok(!lowerClosureEntries(nested.checked, [2], nested.environment).ok);
});

test("factory initializer lowers parameter and declaration captures in source order", () => {
  const f = fixture(
    "interface C {readonly add:(n:number)=>number;readonly get:()=>number} function make(start:number):C { const step=2; let x=start+step; start++; x+=start; return {add:n=>{x+=n+step;return x;},get:()=>x+start}; }",
  );
  const result = lowerClosureFactory(f.checked, 0, f.environment);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
  assert.equal(result.value.initializer, 0);
  assert.deepEqual(result.value.exports, [
    { name: "add", function: 1 },
    { name: "get", function: 2 },
  ]);
  const init = result.value.module.functions[0];
  assert.ok(init);
  assert.equal(init.returnType, "boolean");
  assert.equal(init.parameters.length, 1);
  assert.equal(
    init.blocks.filter(
      (b) =>
        b.terminator.kind === "cell" && b.terminator.operation === "initialize",
    ).length,
    3,
  );
});

test("factory projection rejects early exits and nonclosure result properties", () => {
  for (const source of [
    "interface C {readonly get:()=>number} function make(n:number):C {let x=n;if(n>0)return {get:()=>x};return {get:()=>x};}",
    "interface C {readonly get:()=>number;readonly value:number} function make(n:number):C {let x=n;return {get:()=>x,value:x++};}",
  ]) {
    const f = fixture(source);
    assert.ok(!lowerClosureFactory(f.checked, 0, f.environment).ok);
  }
});

test("factory helper calls and recursion share their owner's environment", () => {
  const source =
    "interface C {readonly run:(n:number)=>number} function make(start:number):C {let x=start;function add(n:number):number {if(n<=0)return x;x++;return add(n-1);}return {run:n=>add(n)};}";
  const bytes = new TextEncoder().encode(source),
    text = createSourceText(bytes, bytes.length);
  assert.ok(text.ok);
  const parsed = parseModule(text.value);
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const layouts = planScalarClosures(
    checked.value,
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
  );
  assert.ok(layouts.ok, JSON.stringify(layouts));
  const env = layouts.value.environments[0];
  assert.ok(env);
  assert.equal(env.cells.length, 1);
  const result = lowerClosureFactory(checked.value, 0, env);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
  assert.ok(
    result.value.module.functions.some((f) =>
      f.blocks.some((b) =>
        b.instructions.some(
          (i) => i.kind === "call" && i.environment === "inherit",
        ),
      ),
    ),
  );
});

test("static function projection never erases reassigned or first-class function bindings", () => {
  for (const source of [
    "interface C {readonly run:()=>number} function make():C {let x=1;function f():number{return x;}f=()=>2;return {run:()=>f()};}",
    "interface C {readonly run:()=>number} function make():C {let x=1;function f():number{return x;}return {run:f};}",
  ]) {
    const f = fixture(source);
    const planned = planScalarClosures(
      f.checked,
      {
        pointerSize: 8,
        wordSize: 8,
        allocationAlignment: 16,
        frameAlignment: 16,
        maxAlignment: 16,
      },
      4096,
    );
    if (planned.ok) {
      const env = planned.value.environments[0];
      assert.ok(env);
      assert.ok(!lowerClosureFactory(f.checked, 0, env).ok);
    }
  }
});

test("caller-owned closure families retain explicit borrowed array handles", () => {
  const source =
    "interface C {readonly run:(n:number)=>number} function make(data:Uint32Array):C {data.fill(2);return {run:n=>{data[1]=n;return (data[1]??0)+data.length;}};}";
  const bytes = new TextEncoder().encode(source),
    text = createSourceText(bytes, bytes.length);
  assert.ok(text.ok);
  const parsed = parseModule(text.value);
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok);
  const layouts = planScalarClosures(
    checked.value,
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
  );
  assert.ok(layouts.ok, JSON.stringify(layouts));
  const env = layouts.value.environments[0];
  assert.ok(env);
  const lowered = lowerClosureFactory(checked.value, 0, env);
  assert.ok(lowered.ok, JSON.stringify(lowered));
  assert.ok(verify(lowered.value.module).ok);
  assert.ok(
    lowered.value.module.functions[0]?.environment?.cells.some(
      (c) => c.type === "Uint32Array" && c.borrowed === true,
    ),
  );
});

test("optional factories preserve early undefined exits as a false construction status", () => {
  const f = fixture(
    "interface C {readonly get:()=>number} function make(n:number):C|undefined {if(n<0)return undefined;let x=n;return {get:()=>x};}",
  );
  const r = lowerClosureFactory(f.checked, 0, f.environment);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.value.module.functions[0]?.returnType, "boolean");
  assert.ok(verify(r.value.module).ok);
});

test("literal throws remain abrupt completions through environment helper calls", () => {
  const f = fixture(
    'interface C {readonly run:(n:number)=>number} function make(start:number):C {let x=start;function check(n:number):number {if(n<0)throw "invalid index";return n;}return {run:n=>{x+=check(n);return x;}};}',
  );
  const layouts = planScalarClosures(
    f.checked,
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
  );
  assert.ok(layouts.ok);
  const env = layouts.value.environments[0];
  assert.ok(env);
  const r = lowerClosureFactory(f.checked, 0, env);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  assert.ok(
    r.value.module.functions.some((f) =>
      f.blocks.some((b) => b.terminator.kind === "throw-literal"),
    ),
  );
});

test("unsigned byte and halfword arrays preserve distinct checked element types", () => {
  for (const kind of ["Uint8Array", "Uint16Array"]) {
    const source = `interface C {readonly run:(n:number)=>number} function make(data:${kind}):C {data.fill(2);return {run:n=>{data[1]=n;return (data[1]??0)+data.length;}};}`;
    const bytes = new TextEncoder().encode(source),
      text = createSourceText(bytes, bytes.length);
    assert.ok(text.ok);
    const parsed = parseModule(text.value);
    assert.ok(parsed.ok);
    const checked = checkClosureModule(parsed.value);
    assert.ok(checked.ok, JSON.stringify(checked));
    const layouts = planScalarClosures(
      checked.value,
      {
        pointerSize: 8,
        wordSize: 8,
        allocationAlignment: 16,
        frameAlignment: 16,
        maxAlignment: 16,
      },
      4096,
    );
    assert.ok(layouts.ok);
    const env = layouts.value.environments[0];
    assert.ok(env);
    const r = lowerClosureFactory(checked.value, 0, env);
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok(verify(r.value.module).ok);
  }
});

test("aliases and inline object contracts reach native closure IR", () => {
  const f = fixture(
    "type Count=number;type C={readonly add:(n:Count)=>Count;readonly get:()=>Count};function make(start:Count):C {let x=start;return {add:n=>{x+=n;return x;},get:()=>x};}",
  );
  const r = lowerClosureFactory(f.checked, 0, f.environment);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("local aliases cannot silently resolve through a same-named top-level type", () => {
  const bytes = new TextEncoder().encode(
    "type N=number;function f():number {type N=boolean;let x:N=1;return x;}",
  );
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(!checked.ok);
  assert.equal(checked.error.code, "UNSUPPORTED");
});

test("numeric and boolean literal contracts retain checked values with scalar encodings", () => {
  const f = fixture(
    "type Count=1|2;type C={readonly get:()=>Count;readonly flag:()=>true};function make():C {let x:Count=1;const flag:true=true;return {get:()=>{x=2;return x;},flag:()=>flag};}",
  );
  const r = lowerClosureFactory(f.checked, 0, f.environment);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  assert.equal(r.value.module.functions[1]?.returnType, "number");
  assert.equal(r.value.module.functions[2]?.returnType, "boolean");
});

test("literal contracts reject unrelated values rather than widening the declared domain", () => {
  for (const text of [
    "type N=1|2;function f():N {return 3;}",
    "function f():true {return false;}",
    'type R={readonly kind:"ok"};function f():R {return {kind:"bad"};}',
    "type N=1|2;function f():N {let x:N=1;x=3;return x;}",
  ]) {
    const bytes = new TextEncoder().encode(text),
      source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    const parsed = parseModule(source.value);
    assert.ok(parsed.ok);
    assert.ok(!checkClosureModule(parsed.value).ok, text);
  }
});

test("borrowed closure entries reject allocating typed-array copies", () => {
  for (const body of [
    "a.set(a);return 0;",
    "const b=new Uint16Array(a);return b.length;",
  ]) {
    const f = fixture(
      `interface C{readonly run:(a:Uint8Array)=>number} function make():C{let x=0;return {run:a=>{x+=1;${body}}};}`,
    );
    const r = lowerClosureEntries(f.checked, [1], f.environment);
    assert.equal(r.ok, false);
    if (!r.ok)
      assert.match(
        r.error,
        /managed environments|borrowed closure environments/,
      );
  }
});

test("borrowed closure entries reject default initialization before cell ownership is integrated", () => {
  const f = fixture(
    "interface C{readonly run:(n?:number)=>number}function make():C{let x=1;return {run:(n:number=3)=>{x+=n;return x;}};}",
  );
  const r = lowerClosureEntries(f.checked, [1], f.environment);
  assert.equal(r.ok, false);
  if (!r.ok)
    assert.match(r.error, /default parameters require managed module entries/);
});

test("factory lowering includes transitively called top-level helpers", () => {
  const f = fixture(
    "interface Counter {readonly add:(n:number)=>number} function make(start:number):Counter{let value=start;return {add:(delta:number):number=>{value=combine(value,delta);return value;}};} function combine(a:number,b:number):number{return finish(a+b);} function finish(value:number):number{return value;} function unused():number{return 99;}",
  );
  const result = lowerClosureFactory(f.checked, 0, f.environment);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
  assert.equal(result.value.module.functions.length, 4);
  assert.deepEqual(result.value.exports, [{ name: "add", function: 1 }]);
});

test("unconditional loops lower without a reachable implicit return", () => {
  for (const body of [
    "for(;;){if(flag)return 42;continue;}",
    "while(true){if(flag)return 42;}",
    "do{if(flag)return 42;}while(true);",
    "for(;true;){if(flag)return 42;}",
  ]) {
    const f = fixture(
      `function make(flag:boolean):()=>number{return ()=>{${body}};}`,
    );
    const result = lowerClosureEntries(f.checked, [1], f.environment);
    assert.ok(result.ok, JSON.stringify(result));
    assert.ok(verify(result.value.module).ok);
  }
});
