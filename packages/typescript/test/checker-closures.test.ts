import type { ReadonlyKeyIndex } from "@tint/foundation/collections/key-index";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
function indexValues<K, V>(index: ReadonlyKeyIndex<K, V>): V[] {
  const values: V[] = [];
  index.forEach((value) => values.push(value));
  return values;
}

function check(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  return checkClosureModule(parsed.value);
}
test("contextual conditional spreads validate properties from every branch", () => {
  assert.equal(
    check(
      'function f(flag:boolean):{x?:number}{return {...(flag?{x:"bad"}:{})};}',
    ).ok,
    false,
  );
  assert.ok(
    check("function f(flag:boolean):{x?:number}{return {...(flag?{x:42}:{})};}")
      .ok,
  );
});
test("delegated negation refinements do not copy discarded fact sets", () => {
  const original = globalThis.Set;
  let copies = 0;
  globalThis.Set = new Proxy(original, {
    construct(target, args) {
      if (args[0] instanceof original) copies++;
      return Reflect.construct(target, args);
    },
  });
  try {
    function measure(condition: string): number {
      copies = 0;
      const result = check(`function f(x:number|undefined):number {
        if (${condition}) return x + 1;
        return 0;
      }`);
      assert.ok(result.ok, JSON.stringify(result));
      return copies;
    }
    const direct = measure("x !== undefined");
    assert.equal(measure("!!!!!!!!(x !== undefined)"), direct);
  } finally {
    globalThis.Set = original;
  }
});
test("calls do not repeatedly scan growing sets of stable initialized bindings", () => {
  const original = Set.prototype[Symbol.iterator];
  let work = 0;
  Set.prototype[Symbol.iterator] = function () {
    const iterator = original.call(this);
    const counted = new Error().stack?.includes("invalidateCalls") === true;
    const next = iterator.next;
    iterator.next = function () {
      const item = next.call(this);
      if (counted && !item.done) work++;
      return item;
    };
    return iterator;
  };
  const count = 200;
  try {
    const result = check(
      "function touch():number{return 0;} function run():number{" +
        Array.from(
          { length: count },
          (_, i) => `const value${i}:number|undefined=touch();`,
        ).join("") +
        `return value${count - 1};}`,
    );
    assert.ok(result.ok, JSON.stringify(result));
  } finally {
    Set.prototype[Symbol.iterator] = original;
  }
  assert.ok(work <= count * 4, `call invalidation visits: ${work}`);
});

test("branch snapshots do not accumulate redundant nonnullable presence facts", () => {
  const original = globalThis.Set;
  let work = 0;
  globalThis.Set = new Proxy(original, {
    construct(target, args) {
      if (args[0] instanceof original) work += args[0].size;
      return Reflect.construct(target, args);
    },
  });
  const count = 200;
  try {
    const result = check(
      "function touch():number{return 0;} function run():number{" +
        Array.from(
          { length: count },
          (_, i) => `const value${i}=touch();if(value${i}<0)return 0;`,
        ).join("") +
        `return value${count - 1};}`,
    );
    assert.ok(result.ok, JSON.stringify(result));
  } finally {
    globalThis.Set = original;
  }
  assert.ok(work <= count * 16, `branch snapshot fact copies: ${work}`);
});

test("calls invalidate captured bindings written after a previous call", () => {
  const result = check(`function run():number {
    let value:number|undefined=0;
    function touch():void {}
    function reset():void {value=undefined;}
    touch();value=1;reset();return value+1;}`);
  assert.equal(result.ok, false);
});
const counter = `interface Counter { readonly add: (n:number)=>number; readonly get: ()=>number }
function create(start:number):Counter { let value=start; return {add: n => { value=value+n; return value; },get:()=>value}; }`;
test("contextual arrow parameters and captured state are checked from source", () => {
  const r = check(counter);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.value.bindings.functions.length, 3);
  const value = r.value.bindings.bindings.find((b) => b.name === "value");
  assert.ok(value?.captured);
  const ops = r.value.operations.filter((o) => o.binding === value.id);
  assert.ok(ops.some((o) => o.operation.kind === "initialize"));
  assert.ok(
    ops.some(
      (o) =>
        o.operation.kind === "write" && o.operation.guard === "initialized",
    ),
  );
  assert.ok(
    ops.some(
      (o) => o.operation.kind === "read" && o.operation.guard === "initialized",
    ),
  );
  const n = r.value.bindings.bindings.find((b) => b.name === "n");
  assert.ok(n);
  const t = r.value.bindingTypes[n.id];
  assert.notEqual(t, undefined);
  if (t !== undefined) assert.equal(r.value.types[t]?.kind, "number");
});
test("return types, object properties, writes and calls are enforced", () => {
  for (const source of [
    counter.replace("value=value+n", "value=true"),
    counter.replace("get:()=>value", "get:()=>true"),
    counter.replace("get:()=>value", "missing:()=>value"),
    counter.replace("add: n =>", "add: (n:boolean) =>"),
    counter.replace("let value=start", "const value=start"),
    "interface A { readonly f:()=>number } function make():A { return {f:()=>{ let x=1; }}; }",
    "function f(x:number):number { return x; } function g():number { return f(true); }",
  ]) {
    const r = check(source);
    assert.ok(!r.ok, source);
    assert.equal("value" in r, false);
  }
});
test("nested functions, contextual returns and optional values retain declared types", () => {
  const r = check(`interface API { readonly read:()=>number|undefined }
function make(x:number|undefined):API { function read():number|undefined { return x; } return {read}; }`);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(
    check("function f(x:boolean):number { if(x) return 1; else return 2; }").ok,
  );
  assert.ok(!check("function f(x:boolean):number { if(x) return 1; }").ok);
});
test("captured narrowing is not assumed across closure calls or reassignment", () => {
  const r = check(
    `function f(x:number|undefined):number { function clear():undefined { x=undefined; return undefined; } if(x!==undefined){ clear(); return x+1; } return 0; }`,
  );
  assert.ok(!r.ok);
});

test("explicit arrow signatures, readonly fields and contextual arguments compose", () => {
  assert.ok(
    check(
      "function f():number { const twice=(x:number):number=>x*2; return twice(3); }",
    ).ok,
  );
  assert.ok(
    check(
      "function apply(f:(x:number)=>number):number { return f(2); } function main():number { return apply(x=>x+1); }",
    ).ok,
  );
  assert.ok(
    check(
      "interface A { x:number } function f():number { const a:A={x:1}; a.x=3; return a.x; }",
    ).ok,
  );
  assert.ok(
    !check(
      "interface A { readonly x:number } function f():number { const a:A={x:1}; a.x=3; return a.x; }",
    ).ok,
  );
  assert.ok(
    check(
      "interface A { readonly f:(x:number)=>number } function make():A { return {f:(x:number|undefined)=>1}; }",
    ).ok,
  );
  assert.ok(
    !check(
      "interface A { readonly f:(x:number|undefined)=>number } function make():A { return {f:(x:number)=>x}; }",
    ).ok,
  );
});
test("forward annotated captures keep runtime TDZ guards and inferred forward captures fail explicitly", () => {
  const r = check(
    "function f():number { const read=():number=>x; let x:number=1; return read(); }",
  );
  assert.ok(r.ok);
  const x = r.value.bindings.bindings.find((b) => b.name === "x");
  assert.ok(x);
  const read = r.value.operations.find(
    (o) => o.binding === x.id && o.operation.kind === "read",
  );
  assert.equal(read?.operation.guard, "initialized");
  const failure = check(
    "function f():number { const read=():number=>x; let x=1; return read(); }",
  );
  assert.ok(!failure.ok);
  assert.equal(failure.error.code, "UNSUPPORTED");
});
test("contextual object checking accepts a single object union alternative and rejects ambiguity", () => {
  assert.ok(
    check(
      "interface A { readonly f:()=>number } function make(x:boolean):A|undefined { if(x) return undefined; return {f:()=>1}; }",
    ).ok,
  );
  assert.ok(
    !check(
      "interface A { readonly f:()=>number } interface B { readonly f:()=>boolean } function make():A|B { return {f:()=>1}; }",
    ).ok,
  );
  assert.ok(!check("function f():number { return ()=>1; }").ok);
});

test("void helpers and loops check captured numeric updates", () => {
  const r = check(`interface Counter { readonly run:(n:number)=>number }
function make():Counter { let count=0;
  function add(n:number):void { for(let i=0;i<n;i++){ if(i===2) continue; count+=i; if(count>20) break; } }
  return {run:n=>{ add(n); while(count<10) count++; return count; }};
}`);
  assert.ok(r.ok, JSON.stringify(r));
  const count = r.value.bindings.bindings.find((b) => b.name === "count");
  assert.ok(count?.captured);
  const ops = r.value.operations.filter((o) => o.binding === count.id);
  assert.ok(ops.filter((o) => o.operation.kind === "write").length >= 2);
  assert.ok(
    check("function f():void { return; } function g():void { return f(); }").ok,
  );
  assert.ok(check("function f():void { return undefined; }").ok);
});
test("void result checking and loop completion stay conservative", () => {
  for (const source of [
    "function f():void {} function g():number { return f(); }",
    "function f(x:void):void {}",
    "interface Bad { value:void }",
    "function f():void { return 1; }",
    "function f(flag:boolean):number { while(flag){ return 1; } }",
    "function f():void { let x=true; x++; }",
    "function f():void { let x=1; x+=true; }",
    "function f():void { const x=1; x++; }",
  ]) {
    const r = check(source);
    assert.ok(!r.ok, source);
  }
});
test("compound assignments snapshot reads before RHS writes and preserve guards", () => {
  const r = check("function f():number { let x=1; x+=(x=2); return x++; }");
  assert.ok(r.ok);
  const x = r.value.bindings.bindings.find((b) => b.name === "x");
  assert.ok(x);
  assert.deepEqual(
    r.value.operations
      .filter((o) => o.binding === x.id)
      .map((o) => o.operation.kind),
    ["initialize", "read", "write", "write", "read", "write"],
  );
});

test("void calls cannot supply conditions or equality operands of incompatible types", () => {
  for (const body of [
    "if(h()) return;",
    "while(h()) break;",
    "for(;h();) break;",
    "const x=!h();",
    "const x=h()===1;",
    "const x=h()?1:2;",
  ]) {
    const r = check("function h():void {} function f():void {" + body + "}");
    assert.ok(!r.ok, body);
  }
});
test("loop header captures retain binding identity and declared numeric storage", () => {
  const r = check(
    "function f():number { let total=0; for(let i=0;i<3;i++){ const get=():number=>i; total+=get(); } return total; }",
  );
  assert.ok(r.ok);
  const i = r.value.bindings.bindings.find((b) => b.name === "i");
  assert.ok(i?.captured);
  assert.equal(r.value.bindings.scopes[i.scope]?.kind, "for");
  const id = r.value.bindingTypes[i.id];
  assert.notEqual(id, undefined);
  if (id !== undefined) assert.equal(r.value.types[id]?.kind, "number");
});

test("the allocator implementation passes contextual closure checking", () => {
  const r = check(
    readFileSync(
      new URL(
        "../../native-runtime/src/allocators/region/index.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.value.bindings.functions.length, 30);
  assert.ok(indexValues(r.value.intrinsics).includes("array-read"));
  assert.ok(indexValues(r.value.intrinsics).includes("array-fill"));
});
test("array reads require guards and scalar builtins retain explicit contracts", () => {
  assert.ok(
    check(
      'function f(a:Uint32Array):number { const x=a[0]; if(x===undefined) throw "missing"; a[1]=Math.ceil(x); a.fill(3,0,1); return a.length; }',
    ).ok,
  );
  assert.ok(check("function f(a:Uint32Array):number { return a[0]??3; }").ok);
  for (const source of [
    "function f(a:Uint32Array):number { return a[0]+1; }",
    "function f(a:Uint32Array):void { a[0]=true; }",
    "function f(a:Uint32Array):void { a.fill(true); }",
    "function f():number { return Math.ceil(true); }",
    "function f(Math:number):number { return Math.ceil(1); }",
    "function f():boolean { let Number=1; return Number.isInteger(1); }",
  ])
    assert.ok(!check(source).ok, source);
});
test("narrowing facts follow guards and are invalidated by captured mutation", () => {
  assert.ok(
    check(
      "function f(x:number|undefined):number { if(x===undefined)return 0; return x+1; }",
    ).ok,
  );
  assert.ok(
    check(
      "function f(x:number|undefined):boolean { return x!==undefined && x>0; }",
    ).ok,
  );
  assert.ok(
    check(
      "function f(x:number|undefined):number { return x===undefined?0:x+1; }",
    ).ok,
  );
  for (const source of [
    "function f(x:number|undefined):number { function clear():void { x=undefined; } if(x!==undefined){clear();return x+1;}return 0; }",
    "function f(x:number|undefined):number { if(x!==undefined){x=undefined;return x+1;}return 0; }",
    "function f(x:number|undefined):number { if(x!==undefined){const g=():number=>x+1;return g();}return 0; }",
    "function f(x:number|undefined):number { if(x!==undefined){while(true){x=undefined;break;}return x+1;}return 0; }",
  ])
    assert.ok(!check(source).ok, source);
});

test("captured facts survive closure creation but not unknown or method calls", () => {
  assert.ok(
    check(
      "function f(x:number|undefined):number { if(x===undefined)return 0; const get=():number|undefined=>x; return x+1; }",
    ).ok,
  );
  assert.ok(
    check(
      "function f(x:number|undefined,cb:()=>void):number { const value=x; if(value===undefined)return 0; cb(); return value+1; }",
    ).ok,
  );
  for (const source of [
    "function f(x:number|undefined,cb:()=>void):number { const get=():number|undefined=>x; if(x===undefined)return 0; cb(); return x+1; }",
    "interface A { readonly run:()=>void } function f(x:number|undefined,a:A):number { const get=():number|undefined=>x; if(x===undefined)return 0; a.run();return x+1; }",
    "function f(x:number|undefined):number { if(x!==undefined && (x=undefined)===undefined)return x+1;return 0; }",
    "function f(x:number|undefined,undefined:number|undefined):number { if(x!==undefined)return x+1;return 0; }",
  ])
    assert.ok(!check(source).ok, source);
});
test("joins preserve facts only on continuing paths and writes invalidate numeric snapshots", () => {
  assert.ok(
    check(
      "function f(x:number|undefined):number { if(x===undefined)x=3; return x+1; }",
    ).ok,
  );
  assert.ok(
    check(
      "function f(x:number|undefined):number { if(x===undefined)return 0; x+=(x=2); return x; }",
    ).ok,
  );
  assert.ok(
    !check(
      "function f(x:number|undefined,b:boolean):number { if(x===undefined)return 0; if(b)x=undefined; return x+1; }",
    ).ok,
  );
  assert.ok(
    !check(
      "function f(x:number|undefined):number { if(x===undefined)return 0; const y=(x=undefined);return x+1; }",
    ).ok,
  );
});
test("builtin recognition respects lexical shadowing and reports arity errors", () => {
  for (const source of [
    "function f():number { return Math.ceil(1,2); }",
    "function f():boolean { return Number.isInteger(); }",
    "function f(a:Uint32Array):void { a.fill(); }",
    "function f(a:Uint32Array):void { a.fill(1,2,3,4); }",
    'function f(a:Uint32Array):void { a.fill(1,"bad"); }',
    "function f(a:Uint32Array):number { return a[true]??0; }",
    "function f():number { const Math=1; return Math.ceil(1); }",
  ])
    assert.ok(!check(source).ok, source);
});

test("tagged union object literals select their concrete contextual variant", () => {
  for (const source of [
    'type Result<T>={readonly ok:true;readonly value:T}|{readonly ok:false;readonly error:string}; function f(n:number):Result<number>{if(n>0)return {ok:true,value:n};return {ok:false,error:"negative"};}',
    'type A={readonly kind:"a";readonly apply:(x:number)=>number}|{readonly kind:"b";readonly apply:(x:boolean)=>boolean}; function f():A{return {kind:"a",apply:x=>x+1};}',
    "type Result<T>={readonly ok:true;readonly value:T}|{readonly ok:false;readonly error:string}; function f():Result<Result<number>>{return {ok:true,value:{ok:true,value:3}};}",
  ]) {
    const r = check(source);
    assert.ok(r.ok, JSON.stringify(r));
  }
  for (const source of [
    'type A={readonly kind:"a";readonly value:number}|{readonly kind:"b";readonly value:boolean}; function f():A{return {kind:"a",value:true};}',
    'type A={readonly kind:"a";readonly value:number}|{readonly kind:"b";readonly value:boolean}; function f():A{return {kind:"c",value:1};}',
    'type A={readonly kind:"a";readonly value:number}|{readonly kind:"b";readonly value:boolean}; function f():A{return {kind:"a"};}',
  ])
    assert.ok(!check(source).ok, source);
});

test("the unchanged word64 module passes contextual checking", () => {
  const r = check(
    readFileSync(
      new URL("../../foundation/src/binary/word64.ts", import.meta.url),
      "utf8",
    ),
  );
  assert.ok(r.ok, JSON.stringify(r));
});
test("numeric standard globals respect shadowing and argument contracts", () => {
  assert.ok(
    check(
      "function f(n:number):number{return Math.floor(n)+Number.MAX_SAFE_INTEGER;}",
    ).ok,
  );
  for (const source of [
    "function f():number{return Math.floor(true);}",
    "function f():number{return Math.floor(1,2);}",
    "function f(Number:number):number{return Number.MAX_SAFE_INTEGER;}",
    "function f(Math:number):number{return Math.floor(1);}",
  ])
    assert.ok(!check(source).ok, source);
});

test("readonly discriminants narrow result payloads on continuing control-flow paths", () => {
  const header =
    "type Result<T>={readonly ok:true;readonly value:T}|{readonly ok:false;readonly error:string};";
  for (const body of [
    "function f(r:Result<number>):number{if(r.ok)return r.value;return 0;}",
    "function f(r:Result<number>,cb:()=>void):number{if(r.ok){cb();return r.value;}return 0;}",
    "function f(r:Result<number>):number{if(!r.ok)return 0;return r.value;}",
    "function f(r:Result<number>):number{return r.ok?r.value:0;}",
    "function f(r:Result<number>):number{if(r.ok===true)return r.value;return 0;}",
    "function f(r:Result<number>):number{if(false===r.ok)return 0;return r.value;}",
  ]) {
    const r = check(header + body);
    assert.ok(r.ok, JSON.stringify(r));
  }
  for (const body of [
    "function f(r:Result<number>):number{return r.value;}",
    "function f(r:Result<number>):number{if(!r.ok)return r.value;return 0;}",
    'function f(r:Result<number>):number{if(r.ok){r={ok:false,error:"x"};return r.value;}return 0;}',
    "function f(r:Result<number>):number{if(r.ok){const get=():number=>r.value;return get();}return 0;}",
  ])
    assert.ok(!check(header + body).ok, body);
});

test("string and numeric tags refine only established continuing branches", () => {
  const header =
    'type A={readonly kind:"a";readonly value:number}|{readonly kind:"b";readonly text:string};';
  for (const body of [
    'function f(x:A):number{if(x.kind!=="a")return 0;return x.value;}',
    'function f(x:A):number{if("b"===x.kind)return 0;return x.value;}',
    'function f(x:A):number{if(x.kind==="a" && x.value>0)return x.value;return 0;}',
  ]) {
    const r = check(header + body);
    assert.ok(r.ok, JSON.stringify(r));
  }
  for (const body of [
    'function f(x:A,b:boolean):number{if(x.kind==="a" || b)return x.value;return 0;}',
    'function f(x:A):number{if(x.kind==="a"){}return x.value;}',
    'function f(x:A):number{if(x.kind=="a")return x.value;return 0;}',
  ])
    assert.ok(!check(header + body).ok, body);
  assert.ok(
    check(
      "type A={readonly kind:1;readonly value:number}|{readonly kind:2};function f(x:A):number{if(x.kind===1)return x.value;return 0;}",
    ).ok,
  );
  assert.ok(
    !check(
      "type A={kind:true;readonly value:number}|{kind:false};function f(x:A):number{if(x.kind)return x.value;return 0;}",
    ).ok,
  );
});

test("multi-variant guards retain narrowed subsets for subsequent tests", () => {
  const header =
    'type A={readonly kind:"a";readonly a:number}|{readonly kind:"b";readonly b:number}|{readonly kind:"c";readonly c:number};';
  const r = check(
    header +
      'function f(x:A):number{if(x.kind==="a")return x.a;if(x.kind==="b")return x.b;return x.c;}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(
    !check(
      header + 'function f(x:A):number{if(x.kind==="a")return x.a;return x.b;}',
    ).ok,
  );
});
test("array literals use contextual element types including nested records and callbacks", () => {
  const r = check(
    "interface Item {readonly n:number} function items(n:number):readonly Item[]{return [{n}, {n:n+1}];} function callbacks(n:number):readonly ((x:number)=>number)[]{return [x=>x+n];} function matrix():readonly (readonly number[])[]{return [[1,2],[]];}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.value.bindings.functions.some((f) => f.captures.length > 0));
});
test("array construction rejects mismatched elements and missing contexts", () => {
  for (const text of [
    "function f():number[]{return [true];}",
    "function f():number[]{return [{n:1}];}",
    "function f():void{const a=[];}",
    "function f():number[]{return [missing];}",
  ])
    assert.equal(check(text).ok, false, text);
});
test("later module literal constants have stable types without early initialization", () => {
  const r = check("function read():number{return VALUE;} const VALUE=42;");
  assert.ok(r.ok, JSON.stringify(r));
  const binding = r.value.bindings.bindings.find((b) => b.name === "VALUE");
  assert.ok(binding);
  const operations = r.value.operations.filter((o) => o.binding === binding.id);
  assert.equal(operations[0]?.operation.kind, "read");
  assert.equal(operations[operations.length - 1]?.operation.kind, "initialize");
});
test("switch narrows readonly discriminants and recognizes returning clauses", () => {
  const r = check(
    'type Result={readonly kind:"number";readonly value:number}|{readonly kind:"boolean";readonly flag:boolean}; function read(r:Result):number{switch(r.kind){case "number":return r.value;default:return r.flag?1:0;}}',
  );
  assert.ok(r.ok, JSON.stringify(r));
});
test("switch completion distinguishes break, continue, fallthrough and return", () => {
  assert.ok(
    check(
      "function f(n:number):number{switch(n){case 1:case 2:return 2;default:return 3;}}",
    ).ok,
  );
  for (const text of [
    "function f(n:number):number{switch(n){case 1:break;return 2;default:return 3;}}",
    "function f(n:number):number{switch(n){case 1:return 2;}}",
  ])
    assert.equal(check(text).ok, false, text);
  assert.ok(
    check(
      "function f(n:number):number{while(n>0){switch(n){case 1:n=0;continue;default:break;}n=n-1;}return n;}",
    ).ok,
  );
});
test("switch fallthrough cannot reuse another clause discriminant refinement", () => {
  const text =
    'type R={readonly kind:"a";readonly value:number}|{readonly kind:"b";readonly flag:boolean}; function read(r:R):number{switch(r.kind){case "a":r.value;default:return r.flag?1:0;}}';
  assert.equal(check(text).ok, false);
  assert.equal(
    check(
      "function f(n:number):number{switch(n){case 0:let value=1;break;default:let value=2;break;}return 0;}",
    ).ok,
    false,
  );
  assert.ok(
    check(
      "function f(n:number):number{switch(n){case 0:{let value=1;return value;}default:{let value=2;return value;}}}",
    ).ok,
  );
});
test("literal property unions remain finite when returned as declared tags", () => {
  assert.ok(
    check(
      'type R={readonly kind:"a"}|{readonly kind:"b"}; function kind(r:R):"a"|"b"{return r.kind;}',
    ).ok,
  );
});
test("typed-array iteration infers numeric locals without bypassing TDZ or readonly rules", () => {
  for (const type of ["Uint8Array", "Uint16Array", "Uint32Array"])
    assert.ok(
      check(
        `function sum(a:${type}):number{let n=0;for(const v of a){n+=v;}return n;}`,
      ).ok,
    );
  for (const text of [
    "function f(a:Uint8Array):void{for(const a of a){}}",
    "function f(a:Uint8Array):void{for(const x of a){x=1;}}",
    "function f(a:Uint8Array):number{for(const x of a){}return x;}",
    "function f(a:number):void{for(const x of a){}}",
    "function f(a:Uint8Array):number{for(const x of a){return x;}}",
  ])
    assert.equal(check(text).ok, false, text);
});
test("typed-array constructors validate arguments and do not bypass local bindings", () => {
  for (const text of [
    "function f():Uint8Array{return new Uint8Array();}",
    "function f(n:number|undefined):Uint16Array{return new (Uint16Array)(n);}",
    "function f():Uint32Array{return new Uint32Array(3.9);}",
  ])
    assert.ok(check(text).ok, text);
  for (const text of [
    "function f():Uint8Array{const Uint8Array=1;return new Uint8Array(3);}",
    "function Uint8Array(n:number):number{return n;} function f():Uint8Array{return new Uint8Array(3);}",
    'function f():Uint8Array{return new Uint8Array("3");}',
    "function f():Uint8Array{return new Uint8Array(3,4);}",
    "function f():Uint8Array{return new Uint8Array<number>(3);}",
  ])
    assert.equal(check(text).ok, false, text);
});

test("typed-array set validates source, offset, arity and void result", () => {
  assert.ok(
    check(
      "function f(a:Uint8Array,b:Uint32Array,n:number|undefined):void{return a.set(b,n);}",
    ).ok,
  );
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

test("typed-array copy constructors accept unsigned sources of every width", () => {
  for (const dst of ["Uint8Array", "Uint16Array", "Uint32Array"])
    for (const src of ["Uint8Array", "Uint16Array", "Uint32Array"])
      assert.ok(
        check(`function copy(a:${src}):${dst}{return new ${dst}(a);}`).ok,
      );
});

test("boolean defaults accept omission and reject nonboolean values", () => {
  assert.ok(
    check(
      "function f(x:boolean=true):boolean{return x;}function run():boolean{return f()&&f(false)&&f(undefined);}",
    ).ok,
  );
  assert.equal(
    check(
      "function f(x:boolean=true):boolean{return x;}function run():boolean{return f(1);}",
    ).ok,
    false,
  );
});

test("optional numeric parameters distinguish omitted calls from required undefined unions", () => {
  assert.ok(
    check(
      "function f(x?:number):number{return x??7;}function run():number{return f()+f(undefined)+f(3);}",
    ).ok,
  );
  for (const source of [
    "function f(x?:number):number{return x;}",
    "function f(x?:number,y:number):number{return y;}",
    "function f(x:number|undefined):number{return x??0;}function g():number{return f();}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("default numeric parameters enforce order, local types and minimum arity", () => {
  for (const source of [
    "function f(a:number=3,b:number=a+2):number{return a+b;}function g():number{return f()+f(undefined,4);}",
    "function f(a:number=3,b:number):number{return a+b;}function g():number{return f(undefined,4);}",
  ])
    assert.ok(check(source).ok, source);
  for (const source of [
    "function f(a:number=b,b:number=3):number{return a;}",
    "function f(a:number=a):number{return a;}",
    "function f(a:number=1):number{a=undefined;return a;}",
    "function f(a:number=1,b:number):number{return a+b;}function g():number{return f();}",
    "function f(a:number=undefined):number{return a;}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("ordinary numeric arrays check indexing, mutation, push and iteration with readonly contracts", () => {
  for (const source of [
    "function f(a:readonly number[]):number{return (a[0]??7)+a.length;}",
    "function f():number{const a=[1,2,3];a[1]=4;const n=a.push(5,6);let sum=0;for(const x of a){sum+=x??0;}return sum+n;}",
    "function f():number{const a:number[]=[];a.push();return a.length;}",
  ])
    assert.ok(check(source).ok, source);
  for (const source of [
    "function f(a:readonly number[]):void{a[0]=1;}",
    "function f(a:readonly number[]):void{a.push(1);}",
    "function f(a:number[]):number{return a[0];}",
    "function f(a:number[]):void{a.push(true);}",
    "function f(a:number[]):void{a[true]=1;}",
    "function f(a:readonly number[]):void{a.length=1;}",
  ])
    assert.equal(check(source).ok, false, source);
});
test("the SHA-256 rounds source passes contextual checking", () => {
  const source = readFileSync(
    new URL("../../foundation/src/binary/sha256-rounds.ts", import.meta.url),
    "utf8",
  );
  const r = check(source);
  assert.ok(r.ok, JSON.stringify(r));
});

// Elements iterate as T, as in TypeScript; a hole read as a T excluding
// undefined throws a TypeError at run time instead of being silently
// discarded (tools/build-for-of-holes-fixture.ts).
test("for-of elements are typed T and explicit undefined guards still check", () => {
  assert.ok(
    check(
      "function f(a:number[]):number{for(const x of a){return x;}return 0;}",
    ).ok,
  );
  assert.ok(
    check(
      "function f(a:readonly number[]):number{let sum=0;for(const x of a){if(x===undefined)continue;sum+=x;}return sum;}",
    ).ok,
  );
});
test("readonly discriminants on const bindings survive calls while reassignable bindings remain conservative", () => {
  const header =
    "type R={readonly ok:true;readonly value:number}|{readonly ok:false;readonly error:string};";
  const valid = check(
    header +
      "function f(input:R,cb:()=>void):number{const r=input;if(!r.ok)return 0;cb();return r.value;}",
  );
  assert.ok(valid.ok, JSON.stringify(valid));
  assert.equal(
    check(
      header +
        'function f(input:R):number{let r=input;const change=():void=>{r={ok:false,error:"changed"};};if(!r.ok)return 0;change();return r.value;}',
    ).ok,
    false,
  );
});
test("optional properties check exact construction and writes without inventing presence", () => {
  const header =
    "interface Options {count?:number; explicit?:number|undefined; readonly label?:string}";
  for (const body of [
    "function f():Options{return {};}",
    "function f():Options{return {count:1,explicit:undefined};}",
    "function f(o:Options):number{o.count=2;return o.count??0;}",
    "function f(o:Options):number{const n=o.count;if(n===undefined)return 0;return n;}",
    "function f(o:Options):void{o.explicit=undefined;}",
  ]) {
    const r = check(header + body);
    assert.ok(r.ok, JSON.stringify(r));
  }
  for (const body of [
    "function f():Options{return {count:undefined};}",
    "function f(o:Options):number{return o.count;}",
    "function f(o:Options):void{o.count=undefined;}",
    'function f(o:Options):void{o.label="changed";}',
  ])
    assert.equal(check(header + body).ok, false, body);
  const unsafe = check(
    'type R={readonly ok?:true;readonly value:number}|{readonly ok:false;readonly error:string};function f(r:R):string{if(!r.ok)return r.error;return "";}',
  );
  assert.equal(unsafe.ok, false);
});
test("optional readonly views cannot recover incompatible hidden fields through an empty structural view", () => {
  const source =
    "interface Hidden{readonly count:string} interface Optional{readonly count?:number} function project(value:Hidden):Optional{const erased:{}=value;return erased;}";
  assert.equal(check(source).ok, false);
});
test("undefined guards narrow recursive optional object bindings without preserving unsafe captured facts", () => {
  const header = "interface Node {readonly value:number;next?:Node|undefined}";
  for (const body of [
    "function read(node:Node|undefined):number{if(node===undefined)return 0;return node.value;}",
    "function read(node:Node|undefined):number{if(node)return node.value;return 0;}",
    "function read(root:Node):number{const next=root.next;if(next!==undefined)return next.value;return 0;}",
    "function make():Node|undefined{return undefined;}",
  ]) {
    const r = check(header + body);
    assert.ok(r.ok, JSON.stringify(r));
  }
  assert.equal(
    check(
      header + "function read(node:Node|undefined):number{return node.value;}",
    ).ok,
    false,
  );
  assert.equal(
    check(
      header +
        "function read(node:Node|undefined):number{const clear=():void=>{node=undefined;};if(node!==undefined){clear();return node.value;}return 0;}",
    ).ok,
    false,
  );
});
test("undefined guards on mutable bindings survive nested loops, switches and labels that leave them unassigned", () => {
  const header =
    "interface Cell {readonly id:number;readonly next:Cell|undefined}";
  const walk = (inner: string) =>
    header +
    "function walk(head:Cell|undefined):number{let total=0;let cell:Cell|undefined=head;while(cell!==undefined){total+=cell.id;" +
    inner +
    "cell=cell.next;}return total;}";
  // As in TypeScript, the guard holds after statements that never assign the
  // binding: each of these used to drop it at the inner statement's exit.
  for (const inner of [
    "for(let j=0;j<3;j++)total+=j;",
    "let k=0;while(k<3)k++;",
    "do{total++;}while(total<0);",
    "for(const id of [1,2])total+=id;",
    "switch(cell.id){case 1:total+=1;break;default:total+=2;}",
    "outer:for(let j=0;j<3;j++){for(let k=0;k<3;k++){if(k>j)continue outer;if(k>total)break outer;}}",
  ]) {
    const r = check(walk(inner));
    assert.ok(r.ok, inner + ": " + JSON.stringify(r));
  }
  // An inner statement that may assign the binding, a var redeclaration in
  // it, or a closure the loop calls still clears the guard.
  const varWalk = (inner: string) =>
    header +
    "function walk(head:Cell|undefined):number{let total=0;var cell:Cell|undefined=head;while(cell!==undefined){total+=cell.id;for(let j=0;j<1;j++){" +
    inner +
    "}cell=cell.next;}return total;}";
  const varKept = check(varWalk("total++;"));
  assert.ok(varKept.ok, JSON.stringify(varKept));
  for (const source of [
    walk("for(let j=0;j<3;j++){if(j>1)cell=undefined;}"),
    walk("while(total<0)cell=head;"),
    walk("switch(total){case 0:cell=undefined;break;}"),
    varWalk("var cell:Cell|undefined=undefined;"),
    header +
      "function walk(head:Cell|undefined):number{let total=0;let cell:Cell|undefined=head;const clear=():void=>{cell=undefined;};while(cell!==undefined){for(let j=0;j<3;j++)clear();cell=cell.next;}return total;}",
  ]) {
    const r = check(source);
    assert.ok(!r.ok && r.error.code === "PROPERTY", source);
    assert.equal(source.slice(r.error.start, r.error.end), "cell.next");
  }
});
test("writes through a record union check the field against every member", () => {
  const header =
    'interface One {readonly kind:"one";next:Item|undefined;count:number;x:string;readonly r:number}' +
    'interface Three {readonly kind:"three";text:string;count:number;next:Item|undefined;x:string|number;r:number}' +
    "type Item=One|Three;";
  // Every member declares the field with a type the value fits: the write
  // dispatches on the member, with no run-time check.
  for (const body of [
    "function f(o:Item,t:Item):void{o.next=t;}",
    "function f(o:Item):void{o.next=undefined;}",
    "function f(o:Item):void{o.count+=1;o.count++;}",
    'function f(o:Item):void{o.x="s";}',
  ]) {
    const r = check(header + body);
    assert.ok(r.ok, body + ": " + JSON.stringify(r));
  }
  // TypeScript accepts a value of the union's read type, but One declares
  // x as string: the typed path has no per-member run-time check yet, so
  // the write falls back explicitly.
  const mixed = check(header + "function f(o:Item):void{o.x=1;}");
  assert.ok(!mixed.ok, JSON.stringify(mixed));
  assert.equal(mixed.error.fallback?.capability, "union-field-write");
  // As in TypeScript: a member's readonly field, and a value outside every
  // member's type, are errors.
  for (const body of [
    "function f(o:Item):void{o.r=1;}",
    'function f(o:Item):void{o.count="s";}',
  ]) {
    const r = check(header + body);
    assert.ok(!r.ok && r.error.fallback === undefined, body);
  }
});
test("string sets check standard construction, methods and readonly views", () => {
  for (const source of [
    'function f():number{const s=new Set<string>();s.add("a").add("b");if(s.has("a"))s.delete("b");const n=s.size;s.clear();return n;}',
    'function read(s:ReadonlySet<string>):boolean{return s.has("a");} function f():boolean{return read(new Set<string>());}',
  ]) {
    const r = check(source);
    assert.ok(r.ok, JSON.stringify(r));
  }
  for (const source of [
    "function f():void{const s=new Set<string>();s.add(1);}",
    'function f(s:ReadonlySet<string>):void{s.add("a");}',
    "function f():void{const s=new Set<string>();s.size=2;}",
    'function f():void{const s=new Set<string>();s.clear("x");}',
    'function f():void{const s=new Set<string>(["a"]);}',
    "function f(Set:number):void{const s=new Set<string>();}",
    "interface Set<T>{value:T}function f():void{const s=new Set<string>();}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("maps check key/value contracts, readonly views and optional get results", () => {
  for (const source of [
    'function f():number{const m=new Map<string,number>();m.set("a",1).set("b",2);if(m.has("a"))m.delete("b");const n=m.get("a")??0;m.clear();return n+m.size;}',
    'function read(m:ReadonlyMap<string,number>):number|undefined{return m.get("a");}function f():number|undefined{return read(new Map<string,number>());}',
  ]) {
    const r = check(source);
    assert.ok(r.ok, JSON.stringify(r));
  }
  for (const source of [
    "function f():void{const m=new Map<string,number>();m.set(1,2);}",
    'function f():void{const m=new Map<string,number>();m.set("a","bad");}',
    'function f(m:ReadonlyMap<string,number>):void{m.set("a",1);}',
    'function f():number{return new Map<string,number>().get("a");}',
    "function f():void{new Map<string,number>().size=1;}",
    "function f(Map:number):void{const m=new Map<string,number>();}",
    "function f():void{const m=new Map<string>();}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("string arrays infer element types and preserve optional indexed/iteration reads", () => {
  for (const source of [
    'function f():string{const a=["a","b"];a[4]="e";a.push("f","g");return a[1]??"missing";}',
    'function f(a:readonly string[]):string{let s="";for(const item of a){s=s+(item??"hole");}return s;}',
    'function f():number{const a:string[]=[];return a.push("a");}',
  ]) {
    const r = check(source);
    assert.ok(r.ok, JSON.stringify(r));
  }
  for (const source of [
    'function f():void{const a=["a"];a.push(1);}',
    'function f():void{const a=["a"];a[0]=1;}',
    'function f(a:readonly string[]):void{a.push("a");}',
    "function f(a:string[]):string{return a[0];}",
    'function f():void{const a=["a",1];}',
  ])
    assert.equal(check(source).ok, false, source);
});

test("presence and discriminant facts compose for optional object unions", () => {
  const prefix =
    'type Item={readonly kind:"a";value:number}|{readonly kind:"b";label:string};';
  const valid = check(
    prefix +
      `function read(item:Item|undefined):number {
    if(item===undefined)return 0;
    if(item.kind==="a")return item.value;
    return item.label.length;
  }`,
  );
  assert.ok(valid.ok, JSON.stringify(valid));
  for (const body of [
    "return item.value;",
    "if(item===undefined)return 0;return item.value;",
  ])
    assert.ok(
      !check(prefix + "function read(item:Item|undefined):number{" + body + "}")
        .ok,
    );
});

test("object map calls contextually check key/value literals and retain readonly restrictions", () => {
  const prefix = "interface Key{id:number} interface Item{value:number}";
  const valid = check(
    prefix +
      `function run():number{
    const map=new Map<Key,Item>();map.set({id:1},{value:7});
    const view:ReadonlyMap<Key,Item>=map;const value=view.get({id:1});
    return value===undefined?0:value.value;
  }`,
  );
  assert.ok(valid.ok, JSON.stringify(valid));
  for (const body of [
    'map.set({id:"bad"},{value:7});return 0;',
    'map.set({id:1},{value:"bad"});return 0;',
    "const view:ReadonlyMap<Key,Item>=map;view.set({id:1},{value:7});return 0;",
    "return map.get({id:1}).value;",
  ])
    assert.ok(
      !check(
        prefix +
          "function run():number{const map=new Map<Key,Item>();" +
          body +
          "}",
      ).ok,
      body,
    );
});

test("Set constructor inference preserves possible holes and explicit element contracts", () => {
  for (const source of [
    "function f(input:Uint8Array):number{const s=new Set(input);s.add(3);return s.size;}",
    "function f(input:string[]):number{const s=new Set(input);s.add(undefined);s.add('x');return s.size;}",
    "function f(input:number[]):number{const s=new Set<number|undefined>(input);return s.size;}",
    "function f():number{const s:Set<string>=new Set();s.add('x');return s.size;}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify({ source, result }));
  }
  for (const source of [
    "function f(input:Uint8Array):number{const s=new Set<string>(input);return s.size;}",
    "function f(input:Uint8Array):number{const s=new (Set)<string>(input);return s.size;}",
    "function f(input:number[]):number{const s=new Set<number>(input);return s.size;}",
    "function f(input:Uint8Array):number{const s=new Set(input,input);return s.size;}",
    "function f():number{const s=new Set();return s.size;}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("String.fromCharCode requires numeric operands and respects local shadowing", () => {
  for (const argument of ['"x"', "true", "undefined"])
    assert.equal(
      check(`function f():string{return String.fromCharCode(${argument});}`).ok,
      false,
    );
  const local = check(
    "function f(String:{fromCharCode:(value:boolean)=>number}):number{return String.fromCharCode(true);}",
  );
  assert.ok(local.ok, JSON.stringify(local));
  assert.equal(
    indexValues(local.value.intrinsics).includes("string-from-code-units"),
    false,
  );
});

test("contextual numeric defaults remove undefined from the inferred local parameter", () => {
  const result = check(`interface Reader {read:(ahead?:number)=>number}
    function consume(n:number):number{return n;}
    function make():Reader{return {read:(ahead=0)=>consume(ahead)};}`);
  assert.ok(result.ok, JSON.stringify(result));
});

test("inferred object fields retain fixed writable types", () => {
  for (const body of [
    'const x={count:1};x.count="wrong";',
    "const x={};x.extra=1;",
    "const x={nested:{count:1}};x.nested.count=false;",
    "const x={count:1,count:2};",
  ])
    assert.equal(check(`function f():void{${body}}`).ok, false, body);
});

test("string defaults preserve literal contracts and parameter initialization order", () => {
  for (const source of [
    'function f(code:"bad"|"limit"="other"):string{return code;}',
    "function f(code:string=1):string{return code;}",
    'function f(first:string=second,second:string="x"):string{return first;}',
  ])
    assert.equal(check(source).ok, false, source);
  const nullable = check(
    "function f(value:string|undefined=undefined):string|undefined{return value;}",
  );
  assert.ok(nullable.ok, JSON.stringify(nullable));
});

test("Math min/max require numbers and preserve ordinary calls on shadowed Math", () => {
  for (const method of ["min", "max"]) {
    for (const argument of ['"1"', "true", "undefined"])
      assert.equal(
        check(`function f():number{return Math.${method}(${argument});}`).ok,
        false,
      );
  }
  const result = check(
    "function f(Math:{min:(value:boolean)=>number}):number{return Math.min(true);}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(
    indexValues(result.value.intrinsics).includes("math-min"),
    false,
  );
});

test("string compound writes preserve mutability and declared contracts", () => {
  for (const body of [
    'const value="a";value+="b";',
    'let value:"a"="a";value+="b";',
    'let value="a";value+=1;',
    'let value="a";value-="b";',
    'let value:string|undefined=undefined;value+="b";',
  ])
    assert.equal(check(`function run():void{${body}}`).ok, false, body);
});

test("deferred locals require assignment on every reachable read path", () => {
  for (const source of [
    "function f(flag:boolean):number{let x:number;if(flag)x=1;else x=2;return x;}",
    "function f(flag:boolean):number{let x:number;if(flag)x=1;else return 2;return x;}",
    "function f():number{let x:number;x=1;while(x<2){x=x+1;}return x;}",
    "function f():number{let x:number;x=1;try{}finally{}return x;}",
    "function f():number{let x:number;x=1;for(let i=0;i<2;i++){x=x+1;}return x;}",
    "function f():string|undefined{let x:string|undefined;return x;}",
  ]) {
    const r = check(source);
    assert.ok(r.ok, JSON.stringify({ source, r }));
  }
  for (const source of [
    "function f():number{let x:number;return x;}",
    "function f(flag:boolean):number{let x:number;if(flag)x=1;return x;}",
    "function f(flag:boolean):number{let x:number;while(flag){x=1;}return x;}",
    "function f():number{x=1;let x:number;return x;}",
    "function f():number{let x:number;x+=1;return x;}",
    "function f():number{let x:number;const read=():number=>x;x=1;return read();}",
    "function f():number{let x:number;try{x=1;}catch{}return x;}",
    "function f(flag:boolean):number{while(flag){let x:number;if(flag)x=1;else return x;}return 0;}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("string includes requires a string search and optional numeric position", () => {
  for (const call of [
    "text.includes()",
    "text.includes(1)",
    'text.includes("x",true)',
    'text.includes("x",0,1)',
  ])
    assert.equal(
      check(`function f(text:string):boolean{return ${call};}`).ok,
      false,
      call,
    );
});

test("string split checks separator and limit contracts", () => {
  for (const call of [
    "text.split(1)",
    'text.split("x",true)',
    'text.split("x",1,2)',
  ])
    assert.equal(
      check(`function f(text:string):string[]{return ${call};}`).ok,
      false,
      call,
    );
  assert.ok(check("function f(text:string):string[]{return text.split();}").ok);
});

test("conditional inference joins object variants and undefined without an annotation", () => {
  const result = check(`type Token={readonly kind:"token";value:number};
    function read(flag:boolean,token:Token):number {
      const maybe=flag?token:undefined;
      if(maybe===undefined)return 0;
      return maybe.value;
    }`);
  assert.ok(result.ok, JSON.stringify(result));
  const unsafe = check(
    `type Token={value:number};function read(flag:boolean,token:Token):number{const maybe=flag?token:undefined;return maybe.value;}`,
  );
  assert.equal(unsafe.ok, false);
});

test("splice enforces mutable receivers and insertion element contracts", () => {
  for (const source of [
    "function f(a:readonly number[]):number[]{return a.splice(0,1);}",
    'function f(a:number[]):number[]{return a.splice(0,1,"bad");}',
    'function f(a:number[]):number[]{return a.splice("bad",1);}',
  ])
    assert.equal(check(source).ok, false);
  assert.ok(
    check(
      "function f(a:number[]):number[]{return a.splice(undefined,undefined,1);}",
    ).ok,
  );
});

test("string join validates separators and rejects unimplemented element conversions", () => {
  for (const source of [
    "function f(a:string[]):string{return a.join(1);}",
    'function f(a:string[]):string{return a.join(",",";");}',
    "function f(a:{n:number}[]):string{return a.join();}",
  ])
    assert.equal(check(source).ok, false);
  assert.ok(
    check("function f(a:readonly string[]):string{return a.join();}").ok,
  );
});

test("Number string conversion respects shadowing and rejects unsupported coercions", () => {
  assert.ok(check("function f(text:string):number{return Number(text);}").ok);
  assert.ok(
    check("function f(Number:(n:number)=>number):number{return Number(2);}").ok,
  );
  for (const body of [
    "Number()",
    "Number(1)",
    "Number(undefined)",
    "Number({value:1})",
    'Number("1","2")',
  ])
    assert.equal(check("function f():number{return " + body + ";}").ok, false);
});

test("OR guards merge compatible discriminant subsets without admitting other variants", () => {
  const result =
    check(`type Node={readonly kind:"a";value:number}|{readonly kind:"b";value:number}|{readonly kind:"c";other:string};
 function read(node:Node):number{while(node.kind==="a"||node.kind==="b"){return node.value;}return 0;}`);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(
    check(
      `type Node={readonly kind:"a";value:number}|{readonly kind:"b";other:string};function read(node:Node,flag:boolean):number{if(node.kind==="a"||flag)return node.value;return 0;}`,
    ).ok,
    false,
  );
});

test("pop rejects readonly receivers and arguments and keeps an optional result", () => {
  for (const source of [
    "function f(a:readonly number[]):number|undefined{return a.pop();}",
    "function f(a:number[]):number|undefined{return a.pop(1);}",
    "function f(a:{value:number}[]):number{return a.pop().value;}",
  ])
    assert.equal(check(source).ok, false);
});

test("array includes validates the search contract and numeric position", () => {
  for (const source of [
    'function f(a:number[]):boolean{return a.includes("x");}',
    'function f(a:string[]):boolean{return a.includes("x","bad");}',
    "function f(a:string[]):boolean{return a.includes();}",
  ])
    assert.equal(check(source).ok, false);
  assert.ok(
    check(
      "function f(a:readonly string[]):boolean{return a.includes(undefined);}",
    ).ok,
  );
});

test("conditional empty arrays infer from either nonempty array branch", () => {
  for (const value of ["flag?items:[]", "flag?[]:items", "flag?(items):([])"]) {
    const result = check(
      "function f(flag:boolean,items:number[]):number{const selected=" +
        value +
        ";selected.push(1);return selected.length;}",
    );
    assert.ok(result.ok, JSON.stringify(result));
  }
  assert.equal(
    check(
      "function f(flag:boolean,items:readonly number[]):number{const selected=flag?[]:items;return selected.push(1);}",
    ).ok,
    false,
  );
  assert.equal(
    check(
      "function f(flag:boolean):number{const selected=flag?1:[];return selected.length;}",
    ).ok,
    false,
  );
});

test("empty branch inference preserves branch-local presence facts", () => {
  assert.ok(
    check(
      "function f(item:{value:number}|undefined):number{const values=item===undefined?[]:[item.value];return values.length;}",
    ).ok,
  );
  assert.equal(
    check(
      "function f(item:{value:number}|undefined):number{const values=item===undefined?[]:[item.value];return item.value;}",
    ).ok,
    false,
  );
});

test("readonly primitive field guards prove literal unions without changing object shape", () => {
  for (const source of [
    'function use(value:"++"|"--"):number{return 1;}function f(token:{readonly value:string}):number{if(token.value==="++"||token.value==="--")return use(token.value);return 0;}',
    "function use(value:7):number{return value;}function f(token:{readonly value:number}):number{if(token.value!==7)return 0;return use(token.value);}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  for (const source of [
    'function use(value:"x"):number{return 1;}function f(token:{value:string}):number{if(token.value==="x")return use(token.value);return 0;}',
    'function use(value:"x"):number{return 1;}function f(token:{readonly value:string}):number{if(token.value==="x"){token={value:"y"};return use(token.value);}return 0;}',
    'function use(value:"x"):number{return 1;}function f(token:{readonly value:string},flag:boolean):number{if(token.value==="x"||flag)return use(token.value);return 0;}',
  ])
    assert.equal(check(source).ok, false);
});

test("calls invalidate readonly field observations through mutable aliases", () => {
  const result = check(
    'function use(value:"x"):number{return 1;}function f():number{const writable:{value:string}={value:"x"};const view:{readonly value:string}=writable;function mutate():void{writable.value="y";}if(view.value==="x"){mutate();return use(view.value);}return 0;}',
  );
  assert.equal(result.ok, false);
});

test("property writes invalidate readonly field observations through aliases", () => {
  const result = check(
    'function use(value:"x"):number{return 1;}function f():number{const writable:{value:string}={value:"x"};const view:{readonly value:string}=writable;if(view.value==="x"){writable.value="y";return use(view.value);}return 0;}',
  );
  assert.equal(result.ok, false);
});

test("try completion preserves assignments on every normal continuation", () => {
  for (const source of [
    "function f():number{let x:number;try{x=1;}finally{}return x;}",
    "function f():number{let x:number;try{}finally{x=1;}return x;}",
    "function f():number{let x:number;try{x=1;}catch{x=2;}return x;}",
    "function f():number{let x:number;try{x=1;}catch{return 2;}return x;}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify({ source, result }));
  }
  for (const source of [
    "function f():number{let x:number;try{x=1;}finally{return x;}}",
    "function f():number{let x:number;try{x=1;}catch{}finally{}return x;}",
    "function f(flag:boolean):number{let x:number;try{if(flag)x=1;}finally{}return x;}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("Map entry patterns bind key and value contracts independently", () => {
  for (const source of [
    'function f(m:ReadonlyMap<string,number>):number{let n=0;for(const [key,value] of m){if(key==="x")n=n+value;}return n;}',
    'function f(m:Map<number,string>):string{for(let [,value] of m){value="x";return value;}return "";}',
    "function f(m:Map<string,number>):undefined{for(const [,,extra] of m)return extra;return undefined;}",
  ]) {
    const r = check(source);
    assert.ok(r.ok, JSON.stringify({ source, r }));
  }
  for (const source of [
    "function f(m:Map<string,number>):number{for(const [key,value] of m)return key;return 0;}",
    "function f(m:Map<string,number>):void{for(const [key,value] of m){value=2;}}",
    "function f(m:Map<string,number>):number{for(const [,,extra] of m)return extra;return 0;}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("Number.isFinite is non-coercing and respects shadowed globals", () => {
  for (const source of [
    "function f(x:number|undefined):boolean{return Number.isFinite(x);}",
    'function f():boolean{return Number.isFinite("2");}',
    'function f(Number:{readonly isFinite:(x:string)=>boolean}):boolean{return Number.isFinite("x");}',
  ]) {
    const r = check(source);
    assert.ok(r.ok, JSON.stringify(r));
  }
  for (const source of [
    "function f():boolean{return Number.isFinite();}",
    "function f():boolean{return Number.isFinite(1,2);}",
    "function f():boolean{const Number=1;return Number.isFinite(1);}",
  ])
    assert.equal(check(source).ok, false);
});

test("for-of retains enclosing immutable tag proofs but not mutable field observations", () => {
  const r = check(
    'type T={readonly kind:"items";readonly values:readonly number[]}|{readonly kind:"other"};function f(t:T):number{const item=t;switch(item.kind){case "items":{for(const n of item.values){if(n!==undefined&&item.values.length>0)return n;}return item.values.length;}default:return 0;}}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  const invalid = check(
    'function use(x:"x"):void{}function f(a:readonly number[]):void{const data:{value:string}={value:"x"};const view:{readonly value:string}=data;if(view.value==="x"){for(const n of a){use(view.value);data.value="y";}}}',
  );
  assert.equal(invalid.ok, false);
});

test("array map context types callback inputs and infers expression results", () => {
  for (const source of [
    "function f(a:readonly number[]):number[]{return a.map(x=>x+1);}",
    "function f(a:readonly {value:number}[]):number[]{return a.map(x=>x.value);}",
    "function f(a:number[]):number[]{return a.map((x,i,source)=>x+i+source.length);}",
    "function f(a:number[]):number[]{return a.map((x):number=>{return x+1;});}",
    "function f(a:number[]):number[]{const result=a.map(x=>x+1);return result;}",
  ]) {
    const r = check(source);
    assert.ok(r.ok, JSON.stringify({ source, r }));
  }
  for (const source of [
    "function f(a:number[]):number[]{return a.map((x:string)=>1);}",
    "function f(a:(number|undefined)[]):number[]{return a.map(x=>x+1);}",
    "function f(a:readonly number[]):number[]{return a.map((x,i,source)=>{source.push(1);return x;});}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("map callback restrictions reject unsupported invocation contracts", () => {
  for (const source of [
    "function f(a:number[]):number[]{return a.map((x=1)=>x);}",
    "function f(a:number[]):number[]{return a.map((x?:number)=>x??0);}",
    "function f(a:number[]):number[]{return a.map((a,b,c,d)=>1);}",
    "function f(a:number[]):number[]{return a.map(x=>x,1);}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("readonly optional property presence guards narrow reads conservatively", () => {
  for (const source of [
    "function f(x:{readonly value?:number}):number{if(x.value!==undefined)return x.value+1;return 0;}",
    'function f(x:{readonly value:string|undefined}):string{if(undefined===x.value)return "";return x.value;}',
    "function f(x:{readonly value?:number}):boolean{return x.value!==undefined&&Number.isInteger(x.value)&&x.value>0;}",
    "function f(x:{readonly value?:number}):undefined{if(x.value===undefined)return x.value;return undefined;}",
  ]) {
    const r = check(source);
    assert.ok(r.ok, JSON.stringify({ source, r }));
  }
  for (const source of [
    "function g():void{}function f(x:{readonly value?:number}):number{if(x.value!==undefined){g();return x.value;}return 0;}",
    "function f(x:{readonly value?:number}):number{if(x.value!==undefined){x={};return x.value;}return 0;}",
    "function f(flag:boolean,x:{readonly value?:number}):number{if(x.value!==undefined||flag)return x.value;return 0;}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("numeric predicates cannot revive field proofs after argument side effects", () => {
  const r = check(
    "function mutate(x:{value:number|undefined}):number{x.value=undefined;return 1;}function f():boolean{const source:{value:number|undefined}={value:1};const view:{readonly value:number|undefined}=source;return view.value!==undefined&&Number.isFinite(mutate(source))&&view.value>0;}",
  );
  assert.equal(r.ok, false);
});

test("successive tag exclusions remove multi-tag variants and refine tag reads", () => {
  for (const source of [
    'type T={readonly kind:"a"|"b";value:number}|{readonly kind:"c";other:number};function f(x:T):number{if(x.kind==="a")return x.value;if(x.kind==="b")return x.value;return x.other;}',
    'type T={readonly kind:"a"|"b";value:number}|{readonly kind:"c";other:number};function f(x:T):number{switch(x.kind){case "a":return x.value;case "b":return x.value;default:return x.other;}}',
    'function use(x:"a"):number{return 1;}function f(x:{readonly kind:"a"|"b"}):number{if(x.kind==="a")return use(x.kind);return 0;}',
  ]) {
    const r = check(source);
    assert.ok(r.ok, JSON.stringify({ source, r }));
  }
  assert.equal(
    check(
      'function use(x:"a"):number{return 1;}function change():void{}function f(x:{readonly kind:"a"|"b"}):number{if(x.kind==="a"){change();return use(x.kind);}return 0;}',
    ).ok,
    false,
  );
});

test("immutable local presence survives switch and loop completion", () => {
  for (const source of [
    "function f(value:number|undefined,flag:boolean):number{const x=value;if(x===undefined)return 0;switch(flag){case true:break;default:break;}return x;}",
    "function f(value:number|undefined,flag:boolean):number{const x=value;if(x===undefined)return 0;while(flag){break;}return x;}",
  ]) {
    const r = check(source);
    assert.ok(r.ok, JSON.stringify(r));
  }
});

test("array some contextualizes callbacks without requiring boolean results", () => {
  for (const source of [
    "function f(a:readonly number[]):boolean{return a.some((value,index,source)=>value+index+source.length);}",
    "function f(a:(number|undefined)[]):boolean{return a.some(value=>value);}",
    "function f(a:string[]):boolean{return a.some(value=>value);}",
    "function f(a:number[]):boolean{return a.some((value):boolean=>{return value>0;});}",
  ]) {
    const r = check(source);
    assert.ok(r.ok, JSON.stringify(r));
  }
  for (const source of [
    "function f(a:number[]):boolean{return a.some((value:string)=>true);}",
    "function f(a:number[]):boolean{return a.some();}",
    "function f(a:number[]):boolean{return a.some(value=>true,1);}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("switch definite assignment intersects actual normal exits", () => {
  for (const source of [
    "function f(n:number):number{let x:number;switch(n){case 1:x=2;break;default:x=3;break;}return x;}",
    "function f(flag:boolean):number{let x:number;switch(flag){case true:x=2;break;case false:x=3;break;}return x;}",
    "function f(n:number):number{let x:number;switch(n){case 1:return 9;default:x=3;}return x;}",
    "function f(n:number):number{let x:number;switch(n){case 1:while(true){break;}x=2;break;default:x=3;}return x;}",
  ]) {
    const r = check(source);
    assert.ok(r.ok, JSON.stringify({ source, r }));
  }
  for (const source of [
    "function f(n:number):number{let x:number;switch(n){case 1:x=2;break;}return x;}",
    "function f(n:number,flag:boolean):number{let x:number;switch(n){case 1:if(flag)break;x=2;break;default:x=3;}return x;}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("nested arrays preserve inner mutability and sparse reads", () => {
  for (const source of [
    "function f(refs:readonly number[]):number{const edges:(readonly number[])[]=[];edges.push(refs);const row=edges[0];if(row===undefined)return 0;return row[0]??0;}",
    "function f():number{const rows=[[1,2],[3]];const row=rows[0];if(row===undefined)return 0;row.push(4);return row.length;}",
    "function f(rows:readonly (readonly string[])[]):number{return rows.map(row=>row.length).length;}",
    "function f(rows:(number[]|undefined)[]):number{rows.push(undefined);const row=rows.pop();if(row===undefined)return 0;return row.length;}",
  ]) {
    const r = check(source);
    assert.ok(r.ok, JSON.stringify({ source, r }));
  }
  for (const source of [
    "function f(row:readonly number[]):void{const rows:number[][]=[];rows.push(row);}",
    "function f(rows:(readonly number[])[]):void{const row=rows[0];if(row!==undefined)row.push(1);}",
    "function f(rows:readonly number[][]):void{rows.push([1]);}",
    "function f(rows:number[][]):number{return rows[0].length;}",
    'function f(rows:number[][]):void{rows.push(["wrong"]);}',
  ])
    assert.equal(check(source).ok, false, source);
});

test("nullish empty array fallbacks inherit the present array type", () => {
  for (const source of [
    "function f(rows:(readonly number[])[]):number{let count=0;for(const value of rows[0]??[])count=count+(value??0);return count;}",
    "function f(row:number[]|undefined):number[]{return row??[];}",
    "function f(row:readonly string[]|undefined):number{const result=row??([]);return result.length;}",
  ]) {
    const r = check(source);
    assert.ok(r.ok, JSON.stringify({ source, r }));
  }
  assert.equal(
    check(
      "function f(row:readonly number[]|undefined):void{const result=row??[];result.push(1);}",
    ).ok,
    false,
  );
  assert.equal(
    check("function f(value:number|undefined):number{return value??[];}").ok,
    false,
  );
});

test("string concatenation accepts primitive number and boolean operands", () => {
  for (const source of [
    'function f(n:number,b:boolean):string{return n+":"+b;}',
    'function f(n:number,b:boolean):string{return b+":"+n;}',
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  assert.equal(
    check('function f(x:{value:number}):string{return ""+x;}').ok,
    false,
  );
});

test("record writes preserve const variant facts but invalidate observed fields", () => {
  const source =
    'type T={readonly kind:"union";readonly members:readonly number[]}|{readonly kind:"number"};function f(input:T):number{const source=input;const state:{value:boolean}={value:false};if(source.kind==="union"){state.value=true;return source.members.length;}return 0;}';
  const result = check(source);
  assert.ok(result.ok, JSON.stringify(result));
  for (const source of [
    "function f(input:{readonly value?:number},alias:{value:number|undefined}):number{if(input.value!==undefined){alias.value=undefined;return input.value;}return 0;}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("arrow creation retains stable captured narrowing without inheriting mutable observations", () => {
  for (const source of [
    'type T={readonly kind:"a";value:number}|{readonly kind:"b"};function f(input:T):()=>number{const source=input;if(source.kind==="a")return ():number=>source.value;return ():number=>0;}',
    "function f(input:number|undefined):()=>number{const value=input;if(value!==undefined)return ():number=>value+1;return ():number=>0;}",
    'type T={readonly kind:"a";values:readonly number[]}|{readonly kind:"b"};function f(input:T):number[]{const source=input;if(source.kind==="a")return [1].map(x=>source.values.length+x);return [];}',
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify({ source, result }));
  }
  for (const source of [
    "function f(input:number|undefined):()=>number{let value=input;if(value!==undefined)return ():number=>value+1;return ():number=>0;}",
    "function f(input:{readonly value?:number}):()=>number{if(input.value!==undefined)return ():number=>input.value+1;return ():number=>0;}",
    "function f(input:number|undefined):number{const value=input;if(value!==undefined){function read():number{return value+1;}return read();}return 0;}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("strict tag equality intersects finite discriminants on both operands", () => {
  const header =
    'type T={readonly kind:"array"|"set";element:number}|{readonly kind:"other";name:string};';
  for (const body of [
    'function f(a:T,b:T):number{if((a.kind==="array"||a.kind==="set")&&b.kind===a.kind)return b.element;return 0;}',
    'function f(a:T,b:T):number{if(b.kind==="array"&&a.kind===b.kind)return a.element;return 0;}',
    'function f(a:T,b:T):number{if(a.kind==="other"&&a.kind!==b.kind)return b.element;return 0;}',
  ]) {
    const result = check(header + body);
    assert.ok(result.ok, JSON.stringify({ body, result }));
  }
  for (const body of [
    "function f(a:T,b:T):number{if(a.kind!==b.kind)return b.element;return 0;}",
    "function f(a:T,b:T):number{if(a.kind===b.kind)return b.element;return 0;}",
  ])
    assert.equal(check(header + body).ok, false, body);
});

test("array find callbacks account for holes and return optional elements", () => {
  for (const source of [
    "function f(values:readonly number[]):number|undefined{return values.find((value,index,array)=>(value??0)>index+array.length);}",
    'function f(values:readonly {name:string}[]):{name:string}|undefined{return values.find(value=>value!==undefined&&value.name==="x");}',
    "function f(values:string[]):string|undefined{return values.find(value=>value);}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify({ source, result }));
  }
  for (const source of [
    "function f(values:number[]):number{return values.find(value=>true);}",
    "function f(values:number[]):number|undefined{return values.find((value:number)=>value>0);}",
    'function f(values:{name:string}[]):{name:string}|undefined{return values.find(value=>value.name==="x");}',
  ])
    assert.equal(check(source).ok, false, source);
});

test("arrays retain set element contracts and readonly views", () => {
  for (const source of [
    "function f():number{const groups=[new Set<number>()];const set=groups[0];if(set===undefined)return 0;set.add(3);return set.size;}",
    "function f(values:readonly number[]):Set<number>[]{return values.map(()=>new Set<number>());}",
    'function f(set:Set<string>):boolean{const groups:ReadonlySet<string>[]=[];groups.push(set);const first=groups[0];return first!==undefined&&first.has("x");}',
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify({ source, result }));
  }
  for (const source of [
    "function f(set:Set<string>):void{const groups:Set<number>[]=[];groups.push(set);}",
    "function f(set:ReadonlySet<number>):void{const groups:Set<number>[]=[];groups.push(set);}",
    "function f(groups:ReadonlySet<number>[]):void{const first=groups[0];if(first!==undefined)first.add(1);}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("set for-of binds present elements and respects readonly handles", () => {
  for (const source of [
    "function f(values:ReadonlySet<number>):number{let sum=0;for(const value of values)sum+=value;return sum;}",
    'function f(values:Set<string>):string{let text="";for(const value of values){if(value==="skip")continue;text+=value;break;}return text;}',
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  assert.equal(
    check(
      "function f(values:ReadonlySet<number>):void{for(const value of values)values.add(value);}",
    ).ok,
    false,
  );
});

test("array every checks present elements and accepts truthy callback values", () => {
  for (const source of [
    "function f(values:readonly number[]):boolean{return values.every((value,index,array)=>value+index+array.length);}",
    "function f(values:readonly {value:number}[]):boolean{return values.every(item=>item.value);}",
    "function f(values:(number|undefined)[]):boolean{return values.every(value=>value!==undefined);}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  assert.equal(
    check(
      "function f(values:(number|undefined)[]):boolean{return values.every(value=>value+1);}",
    ).ok,
    false,
  );
  assert.equal(
    check(
      "function f(values:readonly number[]):boolean{return values.every((value,index,array)=>array.push(value));}",
    ).ok,
    false,
  );
});

test("optional discriminant comparisons narrow only branches excluding absence", () => {
  const prefix =
    'type Item={readonly kind:"a";value:number}|{readonly kind:"b";label:string};';
  for (const body of [
    'if(item?.kind==="a")return item.value;return 0;',
    'if(item?.kind!=="a")return 0;return item.value;',
    'if("a"===item?.kind)return item.value;return 0;',
  ]) {
    const result = check(
      prefix + "function read(item:Item|undefined):number{" + body + "}",
    );
    assert.ok(result.ok, JSON.stringify(result));
  }
  for (const body of [
    'if(item?.kind!=="b")return item.value;return 0;',
    'if(item?.kind==="b")return 0;return item.value;',
  ])
    assert.equal(
      check(prefix + "function read(item:Item|undefined):number{" + body + "}")
        .ok,
      false,
      body,
    );
});

test("array findIndex checks hole-visiting callbacks and returns a number", () => {
  for (const source of [
    "function f(a:readonly number[]):number{return a.findIndex((v,i,values)=>v===undefined||v===i);}",
    "function f(a:string[]):number{return a.findIndex(v=>v);}",
    "interface Item{value:number} function f(a:Item[]):number{return a.findIndex(v=>v!==undefined&&v.value===2);}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  for (const source of [
    "function f(a:number[]):number{return a.findIndex(v=>v+1);}",
    "function f(a:readonly number[]):number{return a.findIndex((v,i,values)=>values.push(1));}",
    "function f(a:number[]):boolean{return a.findIndex(v=>true);}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("array filter preserves element types and returns a mutable array", () => {
  for (const source of [
    "function f(a:readonly number[]):number[]{const b=a.filter((v,i,array)=>v>i);b.push(3);return b;}",
    "function f(a:readonly string[]):string[]{return a.filter(v=>v);}",
    "interface Item{value:number} function f(a:Item[]):Item[]{return a.filter(v=>v.value>0);}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  for (const source of [
    "function f(a:number[]):string[]{return a.filter(v=>true);}",
    "function f(a:(number|undefined)[]):number[]{return a.filter(v=>true);}",
    "function f(a:readonly number[]):number[]{return a.filter((v,i,array)=>array.push(v));}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("Set spread infers present numeric and string elements", () => {
  for (const source of [
    "function f(a:ReadonlySet<number>):number[]{return [0,...a,9];}",
    "function f(a:Set<string>):string[]{const b=[...a];return b;}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  assert.equal(
    check("function f(a:Set<string>):number[]{return [...a];}").ok,
    false,
  );
});

test("array sort checks numeric comparators and excludes undefined from inputs", () => {
  for (const source of [
    "function f(a:number[]):number[]{return a.sort((a,b)=>a-b);}",
    "function f(a:(number|undefined)[]):(number|undefined)[]{return a.sort((a,b)=>{return a-b;});}",
    "function f(a:string[]):string[]{return a.sort((a,b)=>a.length-b.length);}",
    "interface Item{rank:number} function f(a:Item[]):Item[]{return a.sort((a,b)=>a.rank-b.rank);}",
    "function cmp(a:number,b:number):number{return a-b;} function f(a:number[]):number[]{return a.sort(cmp);}",
    "function f(a:number[]):number[]{return a.sort(()=>0/0);}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  for (const source of [
    "function f(a:readonly number[]):number[]{return a.sort((a,b)=>a-b);}",
    "function f(a:number[]):number[]{return a.sort((a,b)=>a>b);}",
    "function f(a:number[]):number[]{return a.sort((a:string,b:string)=>1);}",
    "function f(a:number[]):number[]{return a.sort((a,b,c)=>1);}",
    "function f(a:number[]):number[]{return a.sort();}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("effectful logical guards retain stable const variants but discard mutable facts", () => {
  const prefix =
    'type Item={readonly kind:"a";value:number}|{readonly kind:"b";label:string}; function effect():boolean{return true;}';
  for (const body of [
    'const item=input;if(item?.kind==="a"&&effect())return item.value;return 0;',
    'const item=input;if(!(item?.kind!=="a"||!effect()))return item.value;return 0;',
    'const item=input;if((item?.kind==="a"&&effect())||(item?.kind==="a"&&effect()))return item.value;return 0;',
  ]) {
    const result = check(
      prefix + "function f(input:Item|undefined):number{" + body + "}",
    );
    assert.ok(result.ok, JSON.stringify(result));
  }
  for (const body of [
    'let item:Item|undefined=input;const mutate=():boolean=>{item=undefined;return true;};if(item?.kind==="a"&&mutate())return item.value;return 0;',
    'const item=input;if((item?.kind==="a"&&effect())||effect())return item.value;return 0;',
  ])
    assert.equal(
      check(prefix + "function f(input:Item|undefined):number{" + body + "}")
        .ok,
      false,
      body,
    );
  assert.equal(
    check(
      "function effect():boolean{return true;} function f(input:{readonly value?:number}):number{const item=input;if(item.value!==undefined&&effect())return item.value;return 0;}",
    ).ok,
    false,
  );
});

test("effectful conditions retain facts already valid after their evaluation", () => {
  const result = check(
    "function effect():boolean{return true;} function f(input:number|undefined):number{let value:number|undefined=input;if(value===undefined)return 0;if(effect())return value;return value;}",
  );
  assert.ok(result.ok, JSON.stringify(result));
});

test("array defaults retain element and readonly contracts", () => {
  for (const source of [
    "function f(a:number[]=[]):number{return a.length;} function run():number{return f()+f(undefined)+f([1]);}",
    "function f(a:readonly string[]=[]):number{return a.length;} function run():number{return f();}",
    "interface Item{value:number} function f(a:Item[]=[]):number{return a.length;} function run():number{return f();}",
    "function f(a:number[]=[],b:readonly number[]=a):number{return b.length;} function run():number{return f([1]);}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  for (const source of [
    'function f(a:number[]=["x"]):number{return a.length;}',
    "function f(a:readonly number[]=[]):number{return a.push(1);}",
    "function f(a:number[]=b,b:number[]=[]):number{return a.length;}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("explicit primitive-union arrays preserve their semantic element contract", () => {
  for (const source of [
    'type Element=number|"number"|"string";function f(values:readonly Element[]=[]):boolean{return values.some(v=>v==="number");}',
    'function f(values:(number|string)[]=[1,"x"]):(number|string)[]{values.push(2,"y");return values;}',
    "function f(values:readonly (number|string|boolean)[]):(number|string|boolean)[]{return values.filter(v=>v!==false);}",
    "function f(values:(number|string)[]):number|string|undefined{return values[0];}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  for (const source of [
    "function f(values:(number|string)[]):void{values.push(true);}",
    "function f(values:(number|string)[]):number|string{return values[0];}",
    "function f(values:readonly (number|string)[]):void{values.push(1);}",
    "function f(values:(number|string)[]):number[]{return values;}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("String conversion checks supported primitives and respects shadowing", () => {
  for (const source of [
    "function f(n:number,b:boolean,s:string):string{return String(n)+String(b)+String(s)+String(undefined)+String();}",
    "function f(String:(n:number)=>number):number{return String(1);}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  for (const source of [
    "function f():string{return String({value:1});}",
    "function f():string{return String(1,2);}",
    "function f():number{return String(1);}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("array indexOf accepts readonly receivers and returns a numeric position", () => {
  for (const source of [
    "function f(a:readonly number[]):number{return a.indexOf(undefined,-1);}",
    'function f(a:string[]):number{return a.indexOf("x");}',
    "interface Item{value:number}function f(a:Item[],item:Item):number{return a.indexOf(item);}",
  ]) {
    const r = check(source);
    assert.ok(r.ok, JSON.stringify(r));
  }
  for (const source of [
    'function f(a:number[]):number{return a.indexOf("x");}',
    "function f(a:number[]):boolean{return a.indexOf(1);}",
    'function f(a:number[]):number{return a.indexOf(1,"x");}',
  ])
    assert.equal(check(source).ok, false, source);
});

test("Number.isSafeInteger is a noncoercing boolean test", () => {
  const r = check(
    "function f(n:number|undefined,s:string):boolean{return Number.isSafeInteger(n)&&!Number.isSafeInteger(s)&&!Number.isSafeInteger(true);}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(
    check("function f():number{return Number.isSafeInteger(1);}").ok,
    false,
  );
  assert.equal(
    check("function f():boolean{return Number.isSafeInteger();}").ok,
    false,
  );
});

test("switch fallthrough joins discriminant alternatives", () => {
  const result = check(
    'type Op={readonly kind:"read"|"valid";array:number}|{readonly kind:"write";array:number;value:number}|{readonly kind:"other";label:string};function f(op:Op):number{switch(op.kind){case "read":case "valid":case "write":return op.array;default:return 0;}}',
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(
    check(
      'type Op={readonly kind:"a";value:number}|{readonly kind:"b";other:number};function f(op:Op):number{switch(op.kind){case "a":case "b":return op.value;}}',
    ).ok,
    false,
  );
});

test("if joins preserve the union of narrowed alternatives", () => {
  const result = check(
    'type Op={readonly kind:"a";value:number}|{readonly kind:"b";value:number}|{readonly kind:"c";text:string};function f(op:Op):number{switch(op.kind){case "a":case "b":if(op.kind==="a"){op.value;}else{op.value;}return op.value;default:return 0;}}',
  );
  assert.ok(result.ok, JSON.stringify(result));
});

test("strict literal comparisons narrow finite primitive unions", () => {
  for (const source of [
    'type Value="number"|"boolean";function accept(v:Value|undefined):number{return 1;}function f(v:Value|"void"|undefined):number{if(v!=="void")return accept(v);return 0;}',

    'type Value="number"|"boolean";function accept(v:Value):number{return 1;}function f(v:Value|"void"):number{const value=v;if(value==="void")return 0;return accept(value);}',
    "function one(v:1):number{return v;}function f(v:1|2):number{if(1===v)return one(v);return 0;}",
    "function yes(v:true):number{return 1;}function f(v:true|false):number{if(v!==false)return yes(v);return 0;}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  assert.equal(
    check(
      'function one(v:1):number{return v;}function f(v:1|"1"):number{if(v==1)return one(v);return 0;}',
    ).ok,
    false,
  );
});

test("strict comparisons narrow broad primitives to literal alternatives", () => {
  for (const source of [
    'function accept(v:"day"):number{return 1;}function f(v:string):number{if(v==="day")return accept(v);return 0;}',
    'function accept(v:"day"|"week"):number{return 1;}function f(v:string):number{if(v!=="day"&&v!=="week")return 0;return accept(v);}',
    'function accept(v:"day"|"week"):number{return 1;}function f(v:string):number{if("day"===v||"week"===v)return accept(v);return 0;}',
    "function accept(v:42):number{return v;}function f(v:number):number{if(v!==42)return 0;return accept(v);}",
    "function accept(v:true):number{return 1;}function f(v:boolean):number{if(v===true)return accept(v);return 0;}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  for (const source of [
    'function accept(v:"day"):number{return 1;}function f(v:string):number{if(v=="day")return accept(v);return 0;}',
    'function accept(v:"day"):number{return 1;}function f(v:string):number{if(v!=="day")return accept(v);return 0;}',
    'function accept(v:42):number{return v;}function f(v:string):number{if(v==="42")return accept(v);return 0;}',
    'function accept(v:"day"):number{return 1;}function f(v:string):number{let x=v;const mutate=():number=>{x="week";return 0;};if(x==="day"){mutate();return accept(x);}return 0;}',
  ])
    assert.equal(check(source).ok, false, source);
});

test("long literal disjunctions keep narrowing unions flat", () => {
  const conditions = Array.from({ length: 80 }, (_, i) => `value===${i}`).join(
    "||",
  );
  const result = check(
    `function f(value:number):number{if(${conditions})return value;return 0;}`,
  );
  assert.ok(result.ok, JSON.stringify(result));
});

test("Set copies infer element types from mutable and readonly sets", () => {
  for (const source of [
    "function f(input:ReadonlySet<number>):Set<number>{return new Set(input);}",
    "function f(input:Set<string>):Set<string>{return new Set<string>(input);}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  assert.equal(
    check(
      "function f(input:ReadonlySet<number>):Set<string>{return new Set<string>(input);}",
    ).ok,
    false,
  );
});

test("typeof narrows primitive union bindings on both branches", () => {
  for (const source of [
    'function text(v:string):number{return v.length;}function other(v:number|boolean):number{return 1;}function f(v:string|number|boolean):number{if(typeof v==="string")return text(v);return other(v);}',
    'function accept(v:number):number{return v;}function f(v:number|undefined):number{if("number"===typeof v)return accept(v);return 0;}',
    'function text(v:string):number{return v.length;}function f(v:string|number):number{if(typeof v!=="number")return text(v);return v;}',
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  assert.equal(
    check(
      'function text(v:string):number{return v.length;}function f(v:string|number):number{let x:string|number=v;const mutate=():number=>{x=2;return 0;};if(typeof x==="string"){mutate();return text(x);}return 0;}',
    ).ok,
    false,
  );
});

test("typeof narrows unknown values without making the remaining branch soundly known", () => {
  for (const source of [
    'function read(value:unknown):number {if(typeof value==="number")return value;return 0;}',
    'function read(value:unknown):string {return typeof value==="string"?value:"";}',
    'function read(value:unknown):boolean {if(typeof value!=="boolean")return false;return value;}',
    'function read():number {try{throw 42;}catch(error){return typeof error==="number"?error:0;}}',
  ])
    assert.ok(check(source).ok, source);
  assert.equal(
    check(
      'function read(value:unknown):number {if(typeof value==="string")return 0;return value;}',
    ).ok,
    false,
  );
});

test("optional discriminants retain the absent alternative", () => {
  for (const source of [
    'type P={readonly kind?:"property";name:string}|{readonly kind:"spread";value:number};function f(p:P):string{if(p.kind==="spread")return "spread";return p.name;}',
    'type P={readonly kind?:"property";name:string}|{readonly kind:"spread";value:number};function f(p:P):number{if(p.kind==="spread")return p.value;return 0;}',
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  assert.equal(
    check(
      'type P={readonly kind?:"a";name:string}|{readonly kind?:"b";value:number};function f(p:P):number{if(p.kind!=="a")return p.value;return 0;}',
    ).ok,
    false,
  );
});

test("calls preserve uncaptured local and parameter refinements", () => {
  for (const source of [
    'type T={readonly kind:"a";value:number}|{readonly kind:"b"};function f(input:T):number{let source=input;const state:{value:number}={value:0};if(source.kind==="a"){state.value=1;return source.value;}return 0;}',

    'function effect():number{return 1;}function accept(x:number):number{return x;}function f(value:number|string):number{if(typeof value!=="number")return 0;effect();return accept(value);}',
    'type T={readonly kind:"a";value:number}|{readonly kind:"b";text:string};function effect():number{return 1;}function f(value:T):number{if(value.kind!=="a")return 0;effect();return value.value;}',
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("grouped switch refinements survive an early conditional break", () => {
  const result = check(
    'type Op={readonly kind:"assignment";value:number}|{readonly kind:"compound";value:number}|{readonly kind:"update";target:number}|{readonly kind:"other";text:string};function f(input:Op,flag:boolean):number{const node=input;switch(node.kind){case "assignment":case "compound":case "update":let count=1;while(count>0)count=count-1;if(node.kind==="assignment"&&flag){break;}if(node.kind!=="update")return node.value;break;}return 0;}',
  );
  assert.ok(result.ok, JSON.stringify(result));
});

test("conditional expression joins retain incoming variant restrictions", () => {
  const result = check(
    'type T={readonly kind:"a";value:number}|{readonly kind:"b";value:number}|{readonly kind:"c";text:string};function f(x:T):number{if(x.kind==="c")return 0;const n=x.kind==="a"?1:2;return x.value+n;}',
  );
  assert.ok(result.ok, JSON.stringify(result));
});

test("present optional properties use their write context", () => {
  const result = check(
    "interface R{value?:boolean;other:boolean|undefined}function f(flag:boolean):R{return {value:flag&&true,other:undefined};}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(
    check(
      "interface R{value?:boolean;other:boolean|undefined}function f():R{return {value:undefined,other:undefined};}",
    ).ok,
    false,
  );
});

test("array slice preserves element types and returns mutable copies", () => {
  for (const source of [
    "function f(a:readonly number[]):number[]{return a.slice(0,2);}",
    "function f(a:readonly string[],end:number|undefined):string[]{const b=a.slice(undefined,end);b.push('x');return b;}",
    "interface Item{value:number} function f(a:readonly Item[]):Item[]{return a.slice(-2);}",
    "function f(a:readonly (number|undefined)[]):(number|undefined)[]{return a.slice();}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  for (const source of [
    "function f(a:number[]):string[]{return a.slice();}",
    "function f(a:number[]):number[]{return a.slice(true);}",
    "function f(a:number[]):number[]{return a.slice(0,1,2);}",
    "function f(a:(number|undefined)[]):number[]{return a.slice();}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("relational string operators require two present string operands", () => {
  for (const operator of ["<", ">", "<=", ">="]) {
    const accepted = check(
      `function f(a:string,b:string):boolean{return a ${operator} b;}`,
    );
    assert.ok(accepted.ok, JSON.stringify(accepted));
    assert.equal(
      check(`function f(a:string,b:number):boolean{return a ${operator} b;}`)
        .ok,
      false,
    );
    assert.equal(
      check(
        `function f(a:string|undefined,b:string):boolean{return a ${operator} b;}`,
      ).ok,
      false,
    );
  }
});

test("null is distinct from undefined and narrows nullable scalar bindings", () => {
  const accepted = check(
    "function read(value:number|null|undefined):number{if(value===undefined)return 0;if(value===null)return 1;return value;}function empty():null{return null;}",
  );
  assert.ok(accepted.ok, JSON.stringify(accepted));
  for (const text of [
    "function wrong():number{return null;}",
    "function wrong():undefined{return null;}",
  ])
    assert.equal(check(text).ok, false);
});
test("typed array metadata exposes buffer identity and byte extents", () => {
  const result = check(
    "function same(a:Uint8Array,b:Uint32Array):boolean{return a.buffer===b.buffer;} function offset(a:Uint16Array):number{return a.byteOffset+a.byteLength;}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(
    check("function f(a:Uint8Array):number{a.byteOffset=1;return 0;}").ok,
    false,
  );
});
test("TypeError construction and recognition use the unshadowed builtin", () => {
  assert.ok(
    check(
      'function f():boolean{try{throw new TypeError("bad");}catch(error){return error instanceof TypeError;}}',
    ).ok,
  );
  assert.equal(
    check("function f():unknown{return new TypeError(1);}").ok,
    false,
  );
  assert.equal(
    check("function f(TypeError:number):unknown{return new TypeError();}").ok,
    false,
  );
});

test("binding types are indexed by dense binding identity across shadowed scopes", () => {
  const result = check(
    "function first(value:number):number{return value;} function second(value:string):string{return value;}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(Array.isArray(result.value.bindingTypes));
  const parameters = result.value.bindings.bindings.filter(
    (binding) => binding.name === "value",
  );
  assert.equal(parameters.length, 2);
  assert.deepEqual(
    parameters.map((binding) => {
      const id = result.value.bindingTypes[binding.id];
      assert.notEqual(id, undefined);
      return result.value.types[id!]?.kind;
    }),
    ["number", "string"],
  );
});

test("discriminant narrowing retains tag identities without rescanning the type graph", () => {
  const declarations = Array.from(
    { length: 120 },
    (_, i) => `interface Extra${i}{field${i}:number}`,
  ).join("\n");
  const source =
    declarations +
    `
interface A {readonly kind:"a"; a:number}
interface B {readonly kind:"b"; b:number}
function f(value:A|B):number {
  if(value.kind==="a") return value.a;
  return value.b;
}`;
  const original = Array.prototype.findIndex;
  let work = 0;
  Array.prototype.findIndex = function (predicate, thisArg) {
    return original.call(this, (value, index, array) => {
      if (
        array.length > 120 &&
        value &&
        typeof value === "object" &&
        "kind" in value &&
        ["object", "literal", "union", "number", "string", "boolean"].includes(
          value.kind,
        )
      )
        work++;
      return predicate.call(thisArg, value, index, array);
    });
  };
  try {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  } finally {
    Array.prototype.findIndex = original;
  }
  assert.ok(work < 120, `type graph lookup work: ${work}`);
});

test("narrowing token lookup avoids a growing linear string-key table", () => {
  const source =
    `interface A{readonly kind:"a";a:number} interface B{readonly kind:"b";b:number}\n` +
    Array.from(
      { length: 80 },
      (_, i) =>
        `function f${i}(value:A|B):number{if(value.kind==="a")return value.a;return value.b;}`,
    ).join("\n");
  const original = Map.prototype.get;
  let work = 0;
  Map.prototype.get = function (key) {
    if (typeof key === "string") work += this.size;
    return original.call(this, key);
  };
  try {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  } finally {
    Map.prototype.get = original;
  }
  assert.ok(work < 2000, `linear string-key lookup work: ${work}`);
});

test("already definite scalar reads do not allocate union traversal sets", () => {
  const text =
    "function f(x:number):number{" + "x=x+1;".repeat(100) + "return x;}";
  const original = globalThis.Set;
  let allocations = 0;
  globalThis.Set = new Proxy(original, {
    construct(target, args) {
      if (new Error().stack?.includes("presentType")) allocations++;
      return Reflect.construct(target, args);
    },
  });
  try {
    const result = check(text);
    assert.ok(result.ok, JSON.stringify(result));
  } finally {
    globalThis.Set = original;
  }
  assert.equal(
    allocations,
    0,
    `union traversal set allocations: ${allocations}`,
  );
});

test("logical assignment does not make skipped RHS assignments definite", () => {
  const result = check(
    "function f(x:number,y:number|undefined):number {x ||= (y=1);return y+1;}",
  );
  assert.ok(!result.ok);
});

test("const primitive initializers preserve literal and conditional union types", () => {
  assert.ok(
    check(
      'function accept(x:"a"|"b"):number{return 1;} function f(flag:boolean):number {const x=flag?"a":"b";return accept(x);}',
    ).ok,
  );
  assert.ok(
    check(
      "function accept(x:42):number{return x;} function f():number {const x=42;return accept(x);}",
    ).ok,
  );
  assert.ok(
    !check(
      'function accept(x:"a"|"b"):number{return 1;} function f(flag:boolean):number {let x=flag?"a":"b";return accept(x);}',
    ).ok,
  );
});

test("nullish assignment merges skipped RHS facts and establishes target presence", () => {
  assert.ok(
    !check(
      "function f(x:number|undefined,y:number|undefined):number {x ??= (y=1);return y+1;}",
    ).ok,
  );
  assert.ok(
    check("function f(x:number|undefined):number {x ??= 42;return x;}").ok,
  );
  assert.ok(
    !check(
      "function f(x:number|undefined,y:number|undefined):number {x ??= y;return x;}",
    ).ok,
  );
});

test("outer discriminants narrow nested union properties in conditional expressions", () => {
  const r = check(`
    interface Block { readonly kind: "block"; readonly value: number }
    interface Leaf { readonly kind: "leaf"; readonly value: string }
    type Callable = { readonly kind: "ordinary"; readonly body: Block }
      | { readonly kind: "arrow"; readonly body: Block | Leaf };
    function read(block: Block): number { return block.value; }
    function visit(node: Callable): Callable {
      switch (node.kind) {
        case "ordinary":
        case "arrow":
          return node.kind === "ordinary" ? { ...node, body: { kind: "block", value: read(node.body) } } : node;
      }
    }
  `);
  assert.ok(r.ok, JSON.stringify(r));
});

test("readonly optional properties narrow across object union variants", () => {
  const r = check(`
    interface Result { readonly value: number }
    type Input = { readonly kind: "a"; readonly result: Result | undefined }
      | { readonly kind: "b"; readonly result: Result | undefined };
    function read(result: Result): number { return result.value; }
    function visit(input: Input): number {
      return input.result === undefined ? 0 : read(input.result);
    }
  `);
  assert.ok(r.ok, JSON.stringify(r));
});

test("union property facts do not survive calls or writable variants", () => {
  for (const writable of [false, true]) {
    const r = check(`
      interface Result { readonly value: number }
      type Input = { readonly kind: "a"; readonly result: Result | undefined }
        | { readonly kind: "b"; ${writable ? "" : "readonly"} result: Result | undefined };
      function read(result: Result): number { return result.value; }
      function visit(input: Input, change: () => void): number {
        if (input.result === undefined) return 0;
        ${writable ? "" : "change();"}
        return read(input.result);
      }
    `);
    assert.equal(r.ok, false, JSON.stringify(r));
  }
});

test("property updates reject readonly and absent numeric contracts", () => {
  for (const text of [
    "function f(box:{readonly value:number}):number{return box.value++;}",
    "function f(box:{value:number|undefined}):number{return ++box.value;}",
    "function f(box:{value:string}):number{return box.value++;}",
    "function f(box:{value:1}):number{return box.value+=1;}",
  ])
    assert.equal(check(text).ok, false, text);
});

test("literal record indexing retains missing and readonly property checks", () => {
  for (const text of [
    'function f(box:{value:number}):number{return box["missing"];} ',
    'function f(box:{readonly value:number}):number{return box["value"]++;}',
    'function f(box:{readonly value:number}):number{return box["value"]=1;}',
    "function f(box:{value:number},key:string):number{return box[key];}",
  ])
    assert.equal(check(text).ok, false, text);
});

test("an explicit field extension satisfies an optional-property intersection", () => {
  const r = check(
    "interface Token {readonly value:string} function extend(token:Token):Token & {readonly computed?:boolean}{return {...token,computed:false};}",
  );
  assert.ok(r.ok, JSON.stringify(r));
});

test("string indexing remains readonly and optional in the strict profile", () => {
  for (const source of [
    "function f(s:string):string{return s[0];}",
    'function f(s:string):string{return s[0]="x";}',
    "function f(s:string):number{return s[0]++;}",
    "function f(s:string):string|undefined{return s[true];}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("numeric global constants cannot be assigned and unknown names stay rejected", () => {
  for (const source of [
    "function f():number{return NaN=1;}",
    "function f():number{return Infinity++;}",
    "function f():number{return Number.EPSILON=1;}",
    "function f():number{return Math.PI=3;}",
    "function f():number{return Math.UNKNOWN_CONSTANT;}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("strict var reads require definite assignment unless absence is represented", () => {
  for (const source of [
    "function f():number{return x;var x:number=1;}",
    "function f(flag:boolean):number{if(flag){var x=1;}return x;}",
    "function f():number{const read:()=>number=()=>x;var x=1;return read();}",
    'function f():number{var x:number=1;var x:string="bad";return x;}',
  ])
    assert.equal(check(source).ok, false, source);
  for (const source of [
    "function f():number{x=1;var x:number;return x;}",
    "function f():number{var x;var x=42;var x;return x;}",
    "function f():number{var x=1;const read:()=>number=()=>x;return read();}",
    "function f():boolean{for(var x of new Uint32Array(0)){}return x===undefined;}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("optional string calls preserve skipped undefined and grouping boundaries", () => {
  for (const body of [
    "return s?.trim();",
    "return (s?.trim()).trim();",
    "return s?.at(0).trim();",
  ]) {
    const result = check(`function f(s:string|undefined):string{${body}}`);
    assert.ok(!result.ok, body);
  }
  const result = check(
    "function f(s:string|undefined):string|undefined{return s?.at(0)?.trim();}",
  );
  assert.ok(result.ok, JSON.stringify(result));
});

test("optional string receivers remove both null and undefined from their live type", () => {
  const result = check(
    "function clean(s:string|null|undefined):string|undefined{return s?.trim();} function size(s:string|null):number|undefined{return s?.length;}",
  );
  assert.ok(result.ok, JSON.stringify(result));
});

test("array joining accepts numeric elements and numeric typed arrays", () => {
  const result = check(
    'function join(a:(number|undefined)[],b:Float64Array):string{return a.join("|")+b.join();}',
  );
  assert.ok(result.ok, JSON.stringify(result));
});

test("mutable array length assignments preserve their numeric result", () => {
  const result = check(
    'function resize(a:number[],n:number):number{return a.length=n;} function bracket(a:string[]):number{return a["length"]=0;}',
  );
  assert.ok(result.ok, JSON.stringify(result));
  for (const source of [
    "function f(a:readonly number[]):void{a.length=0;}",
    "function f(a:Uint8Array):void{a.length=0;}",
    'function f(a:number[]):void{a.length="1";}',
  ])
    assert.ok(!check(source).ok, source);
});

test("array length updates and compound assignments retain mutability rules", () => {
  const result = check(
    "function f(a:number[]):number{a.length+=2;a.length&&=3;a.length||=1;a.length??=4;return a.length+++--a.length;}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(!check("function f(a:readonly number[]):void{a.length++;}").ok);
});

test("reverse retains receiver types and rejects readonly mutation", () => {
  assert.ok(
    check(
      "function f(a:number[]):number[]{return a.reverse();} function g(a:Float64Array):Float64Array{return a.reverse();}",
    ).ok,
  );
  assert.ok(!check("function f(a:readonly number[]):void{a.reverse();}").ok);
  assert.ok(!check("function f(a:number[]):void{a.reverse(1);}").ok);
});

test("array fill checks the element contract and readonly receiver", () => {
  assert.ok(
    check(
      'function f(a:string[]):string[]{return a.fill("x",undefined,undefined);}',
    ).ok,
  );
  assert.ok(!check('function f(a:readonly string[]):void{a.fill("x");}').ok);
  assert.ok(!check('function f(a:number[]):void{a.fill("x");}').ok);
});

test("a returning disjunction retains the left guard on its fallthrough path", () => {
  const result = check(
    "function use(n:number):number{return n;} function f(n:number|undefined,flags:number[]):number{if(n===undefined||flags[n]===1)return 0;return use(n);}",
  );
  assert.ok(result.ok, JSON.stringify(result));
});

test("indexed guard reads retain facts only when receiver and key are effect-free", () => {
  for (const body of [
    "if(n===undefined||flags[n]===1)return 0;return n+1;",
    "if(n!==undefined&&flags[n]!==1)return n+1;return 0;",
  ])
    assert.ok(
      check(`function f(n:number|undefined,flags:number[]):number{${body}}`).ok,
      body,
    );
  for (const read of ["flags[mutate()]", "mutateArray()[0]"]) {
    const source = `function f(n:number|undefined,flags:number[]):number{function mutate():number{n=undefined;return 0;}function mutateArray():number[]{n=undefined;return flags;}if(n===undefined||${read}===1)return 0;return n+1;}`;
    assert.ok(!check(source).ok, source);
  }
});

test("shift and unshift enforce element types and readonly receivers", () => {
  for (const source of [
    "function f(a:readonly number[]):void{a.shift();}",
    "function f(a:readonly number[]):void{a.unshift(1);}",
    'function f(a:number[]):void{a.unshift("bad");}',
    "function f(a:number[]):void{a.shift(1);}",
  ])
    assert.ok(!check(source).ok, source);
});

test("satisfies checks a constraint while retaining inferred object fields", () => {
  const result = check(
    'function f():string{const x={text:" hi ",count:1} satisfies {text:string|number,count:number};return x.text.trim();}',
  );
  assert.ok(result.ok, JSON.stringify(result));
  for (const source of [
    'function f():void{const x={n:"bad"} satisfies {n:number};}',
    "function f():void{const x={n:1,extra:2} satisfies {n:number};}",
    "function f():void{const x={} satisfies {n:number};}",
  ])
    assert.ok(!check(source).ok, source);
});

test("nested satisfies checks every constraint and keeps contextual boolean literals", () => {
  assert.ok(
    !check(
      "function f():void{const x=({n:1} satisfies {n:number}) satisfies {n:string};}",
    ).ok,
  );
  const result = check(
    "function f():true{const x={flag:true} satisfies {flag:boolean};return x.flag;}",
  );
  assert.ok(result.ok, JSON.stringify(result));
});

test("satisfies retains const literals and empty-array never elements", () => {
  const result = check(
    "function f():42{const n=42 satisfies number;return n;}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  const array = check("function f():void{const a=[] satisfies number[];}");
  assert.ok(array.ok, JSON.stringify(array));
  assert.ok(
    !check("function f():void{const a=[] satisfies number[];a.push(1);}").ok,
  );
});

test("nonempty satisfies arrays infer mutable elements from contextual values", () => {
  const result = check(
    'function f():string{const a=["x"] satisfies readonly (string|number)[];a.push("y");return a[0]?.trim()??"";}',
  );
  assert.ok(result.ok, JSON.stringify(result));
});

test("satisfies keeps nested fresh object and array inference", () => {
  const result = check(
    'function f():string{const x={nested:{text:"hi"},values:["x"]} satisfies {nested:{text:string|number},values:(string|number)[]};x.values.push("y");return x.nested.text.trim()+(x.values[0]?.trim()??"");}',
  );
  assert.ok(result.ok, JSON.stringify(result));
  const nested = check(
    'function f():string{const x=[["hi"]] satisfies readonly (readonly (string|number)[])[];const first=x[0];if(first===undefined)return "";first.push("x");return first[0]?.trim()??"";}',
  );
  assert.ok(nested.ok, JSON.stringify(nested));
});

test("satisfies conditional inference retains both checked branch types", () => {
  const result = check(
    'function f(flag:boolean):string{const x=(flag?{text:"a"}:{text:"b"}) satisfies {text:string|number};return x.text.trim();}',
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(
    !check(
      'function f(flag:boolean):void{const x=(flag?{text:"a"}:{text:1}) satisfies {text:string};}',
    ).ok,
  );
});

test("satisfies unknown validates without imposing a contextual representation", () => {
  const result = check(
    "function f():number{const x={n:42} satisfies unknown;const a=[] satisfies unknown;const b=[true] satisfies unknown;a.length=1;return x.n+(a.length===1&&b[0]===true?0:1);}",
  );
  assert.ok(result.ok, JSON.stringify(result));
});

test("reverse array searches check hole-visiting callbacks and result contracts", () => {
  for (const source of [
    "function f(a:readonly number[]):number{return a.findLastIndex((v,i,values)=>v===undefined||v===i);}",
    "function f(a:string[]):string|undefined{return a.findLast(v=>v);}",
    "function f(a:boolean[]):boolean|undefined{return a.findLast(v=>v===false);}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  for (const source of [
    "function f(a:number[]):number{return a.findLast(v=>true);}",
    "function f(a:number[]):number{return a.findLastIndex((v:number)=>v>0);}",
    "function f(a:readonly number[]):number{return a.findLastIndex((v,i,values)=>values.push(1));}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("typed array searches expose numeric elements and preserve receiver types", () => {
  for (const type of [
    "Uint8Array",
    "Uint16Array",
    "Uint32Array",
    "Float64Array",
  ]) {
    for (const method of ["find", "findLast", "findIndex", "findLastIndex"]) {
      const result = check(
        `function f(a:${type}):number|undefined{return a.${method}((v:number,i,values)=>v===i&&values.length===a.length);}`,
      );
      assert.ok(result.ok, JSON.stringify(result));
    }
    assert.equal(
      check(`function f(a:${type}):number{return a.find(v=>true);}`).ok,
      false,
    );
    assert.equal(
      check(
        `function f(a:${type}):number{return a.findLastIndex((v:string)=>true);}`,
      ).ok,
      false,
    );
  }
});

test("typed array quantifiers accept numeric callbacks and return booleans", () => {
  for (const type of [
    "Uint8Array",
    "Uint16Array",
    "Uint32Array",
    "Float64Array",
  ]) {
    for (const method of ["some", "every"]) {
      const result = check(
        `function f(a:${type}):boolean{return a.${method}((v:number,i,values)=>v===i&&values.length===a.length);}`,
      );
      assert.ok(result.ok, JSON.stringify(result));
      assert.equal(
        check(
          `function f(a:${type}):boolean{return a.${method}((v:string)=>true);}`,
        ).ok,
        false,
      );
    }
  }
});

test("array block callbacks infer return types including fallthrough", () => {
  for (const source of [
    "function f(a:number[]):number[]{return a.map(v=>{return v+1;});}",
    "function f(a:number[]):(number|undefined)[]{return a.map(v=>{if(v>0)return v;});}",
    "function f(a:number[]):(number|undefined)[]{return a.map(v=>{if(v>0)return;return v;});}",
    "function f(a:number[]):boolean{return a.some(v=>{return v>0;});}",
    "function f(a:number[]):number|undefined{return a.findLast(v=>{return v!==undefined;});}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  assert.equal(
    check(
      "function f(a:number[]):number[]{return a.map(v=>{if(v>0)return v;});}",
    ).ok,
    false,
  );
});

test("forEach accepts discarded callback results and typed or sparse receivers", () => {
  for (const source of [
    "function f(a:number[]):void{a.forEach((v,i,values)=>{values[i]=v+1;});}",
    "function f(a:readonly number[]):void{a.forEach(v=>v+1);}",
    "function f(a:Uint8Array):void{a.forEach((v,i,values)=>{values[i]=v+1;});}",
    "function f(a:number[]):void{a.forEach(v=>{if(v>0)return v;});}",
    "function g(v:number):void{} function f(a:number[]):void{a.forEach(g);}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  for (const source of [
    "function f(a:readonly number[]):void{a.forEach((v,i,values)=>{values[i]=v;});}",
    "function f(a:number[]):boolean{return a.forEach(v=>true);}",
    "function f(a:Uint8Array):void{a.forEach((v:string)=>{});}",
  ])
    assert.equal(check(source).ok, false, source);
});

test("array predicates may return void because builtin truthiness treats undefined as false", () => {
  for (const source of [
    "function f(a:number[]):boolean{return a.some(v=>{});}",
    "function f(a:Uint8Array):boolean{return a.every(v=>{});}",
    "function f(a:number[]):number[]{return a.filter(v=>{});}",
    "function f(a:number[]):number|undefined{return a.find(v=>{});}",
    "function f(a:number[]):number{return a.findLastIndex(v=>{});}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("receiver syntax cannot silently compile before the native receiver ABI exists", () => {
  for (const source of [
    "export function f():number{return this;}",
    "export function f():()=>number{return ()=>this;}",
  ]) {
    const result = check(source);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "UNSUPPORTED");
      assert.match(result.error.message, /receiver-aware/);
    }
  }
});

test("explicit receivers type function bodies and lexical arrows", () => {
  const result = check(
    "interface Context {x:number;} function read(this:Context):number{return this.x;} function closure(this:Context):()=>number{return ()=>this.x;} interface Object {x:number;read(this:Context):number;} function run(o:Object):number{return o.read()+(o.read)()+o['read']();}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.receiverTypes.size, 2);
});
test("receiver contracts reject detached calls and incompatible body access", () => {
  for (const source of [
    "interface C{x:number;} function read(this:C):number{return this.missing;}",
    "interface C{x:number;} function read(this:C):number{return this.x;} function run():number{return read();}",
    "interface C{x:number;} interface O{read(this:C):number;} function run(o:O):number{return o.read();}",
  ]) {
    const result = check(source);
    assert.equal(result.ok, false, source);
  }
});

test("contextual function typing cannot erase an explicit receiver requirement", () => {
  const result = check(
    "interface C{x:number;} function run():number {const detached:()=>number=function(this:C):number{return 1;};return detached();}",
  );
  assert.equal(result.ok, false);
  const valid = check(
    "interface C{x:number;} interface O{x:number;read(this:C):number;} function make():O{return {x:3,read(this:C):number{return this.x;}};}",
  );
  assert.ok(valid.ok, JSON.stringify(valid));
});
test("unknown arrays preserve general values across indexing and writes", () => {
  const result = check(
    "function run(values:unknown[],value:unknown):unknown {values.push(value);values[0]=value;return values[0];}",
  );
  assert.ok(result.ok, JSON.stringify(result));
});
test("unknown contextual types do not impose object or array literal shapes", () => {
  for (const source of [
    "function run():unknown {const value:unknown={value:42};return value;}",
    "function run():unknown[] {return [{value:42},[1,2],false];}",
  ])
    assert.ok(check(source).ok, JSON.stringify(check(source)));
});

test("typed object accessors require explicit layout support", () => {
  const result = check(
    "function f():{x:number}{return {get x(){return 42;}};}",
  );
  assert.ok(!result.ok);
  assert.equal(result.error.code, "UNSUPPORTED");
  assert.match(result.error.message, /accessor layout/);
});

test("prototype setters reject a fixed-record context", () => {
  const result = check(
    "function f():{x:number}{return {__proto__:null,x:42};}",
  );
  assert.ok(!result.ok);
  assert.equal(result.error.code, "UNSUPPORTED");
  assert.match(result.error.message, /requires an indexed object context/);
});

test("a broad computed key does not establish fixed required fields", () => {
  const result = check("function f(key:string):{x:number}{return {[key]:42};}");
  assert.ok(!result.ok);
  assert.equal(result.error.code, "UNSUPPORTED");
  assert.match(result.error.message, /requires an indexed object context/);
});

test("typed rest rejects a scalar annotation and the parser rejects tuples", () => {
  const scalar = check("function f(...r:number):number{return 42;}");
  assert.ok(!scalar.ok);
  assert.equal(scalar.error.code, "INVALID_TYPE");
  assert.equal(scalar.error.message, "rest parameter requires an array type");
  const input = new TextEncoder().encode(
    "function f(...r:readonly [number]):number{return 42;}",
  );
  const source = createSourceText(input, input.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(!parsed.ok);
  assert.equal(parsed.error.message, "tuple types are not supported");
});

test("typed rest rejects realm arrays in the native packed-list ABI", () => {
  const alias = check(`
    type Entry = [string, number];
    function take(...entry: Entry): number { return entry[1]; }
  `);
  assert.ok(!alias.ok);
  assert.equal(alias.error.code, "INVALID_TYPE");
  assert.equal(alias.error.message, "rest parameter requires an array type");

  const spread = check(`
    function take(...values: number[]): number { return values.length; }
    function count(values: Record<string, number>): number {
      return take(...Object.values(values));
    }
  `);
  assert.ok(!spread.ok);
  assert.equal(spread.error.code, "UNSUPPORTED");
  assert.equal(spread.error.message, "rest spread requires a supported array");
});

test("typed templates accept fixed primitive inputs and reject unresolved object coercion", () => {
  assert.ok(
    check(
      "function f(n:number,s:string,b:boolean,u:undefined,z:null):string{return `${n}${s}${b}${u}${z}`;}",
    ).ok,
  );
  assert.equal(
    check("function f(o:{x:number}):string{return `${o}`;}").ok,
    false,
  );
});

test("typed native checks do not silently erase async function semantics", () => {
  for (const text of [
    "async function f():number{return 42;}",
    "async function* f():number{yield 42;}",
    "class C{async *f():number{yield 42;}}",
    "class C{async f():number{return 42;}}",
    "function f():number {let g=async (x:number):number=>x;return 1;}",
    "function f():number {let g=async function():number{return 42;};return 1;}",
  ]) {
    const result = check(text);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "UNSUPPORTED");
  }
});

test("unconditional loops do not invent an implicit undefined return", () => {
  for (const body of [
    "for(;;){return 42;}",
    "for(;;){if(flag)return 42;continue;}",
    "while(true){if(flag)return 42;}",
    "do {if(flag)return 42;} while(true);",
    "for(;;){try {break;} finally {return 42;}}",
  ]) {
    const result = check(`function f(flag:boolean):number{${body}}`);
    assert.ok(result.ok, JSON.stringify({ body, result }));
  }
});
test("loops with a finite exit still require a return", () => {
  for (const body of [
    "for(;;){if(flag)break;return 42;}",
    "while(true){break;}",
    "do {continue;} while(flag);",
    "for(;flag;){return 42;}",
    "while(flag){return 42;}",
  ])
    assert.equal(
      check(`function f(flag:boolean):number{${body}}`).ok,
      false,
      body,
    );
});

test("immutable binding refinements survive try regions without preserving mutable observations", () => {
  for (const region of [
    "try{}finally{}",
    "try{}catch{}",
    "try{throw 1;}catch{}finally{}",
  ]) {
    const source = `function f(input:{value:number}|undefined):number{const record=input;if(record===undefined)throw 0;${region}return record.value;}`;
    const result = check(source);
    assert.ok(result.ok, JSON.stringify({ source, result }));
  }
  for (const source of [
    "function f(input:{value:number}|undefined):number{let record=input;if(record===undefined)throw 0;try{}finally{record=undefined;}return record.value;}",
    "function f(input:{value:number|undefined}):number{const record=input;if(record.value===undefined)throw 0;try{}finally{record.value=undefined;}return record.value;}",
  ])
    assert.equal(check(source).ok, false, source);
});
test("numeric conditional branches do not introduce undefined", () => {
  for (const source of [
    "const a=4;const b=8;function f(flag:boolean):number{return (flag?a:b)|16;}",
    "function f(flag:boolean):number{const a:4=4;const b:8=8;return (flag?a:b)|16;}",
    "function f(flag:boolean):4|8{const a:4=4;const b:8=8;const result=flag?a:b;return result;}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  assert.equal(
    check("function f(flag:boolean):number{return (flag?4:undefined)|16;}").ok,
    false,
  );
});

test("optional readonly record arrays retain immutable views through loops", () => {
  for (const source of [
    "interface Blob {readonly slot:number;readonly bytes:Uint8Array}function f(blobs?:readonly Blob[]):number{if(blobs!==undefined){return blobs.length;}return 0;}",
    "interface Blob {readonly slot:number}function f(input:readonly Blob[]|undefined):number{const blobs=input;if(blobs===undefined)return 0;let n=0;for(let i=0;i<blobs.length;i++){const b=blobs[i];if(b!==undefined)n+=b.slot;}return n;}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  assert.equal(
    check(
      "interface Blob {readonly slot:number}function f(blobs?:readonly Blob[]):number{return blobs.length;}",
    ).ok,
    false,
  );
});

test("function arrays expose collection operations and preserve callable signatures", () => {
  for (const source of [
    "type Action=(value:number)=>number;function run(actions:readonly Action[]):number{let result=0;for(let i=0;i<actions.length;i++){const action=actions[i];if(action!==undefined)result=action(result);}return result;}",
    "function run():number{const actions:((value:number)=>number)[]=[];actions.push((value:number):number=>value+42);const action=actions.pop();return action===undefined?0:action(0);}",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  assert.equal(
    check(
      'function run(actions:readonly ((value:number)=>number)[]):number{const action=actions[0];return action===undefined?0:action("wrong");}',
    ).ok,
    false,
  );
  assert.equal(
    check(
      "function run(actions:readonly (()=>number)[]):void{actions.push(():number=>42);}",
    ).ok,
    false,
  );
});

test("strict literal equality narrows unknown values across alternatives", () => {
  for (const text of [
    'function f(value:unknown):"a"|"b"{if(value==="a"||value==="b")return value;return "a";}',
    'function f(value:unknown):"a"|"b"|"c"{if(value==="a"||value==="b"||value==="c")return value;return "a";}',
    'function f(value:unknown):"a"|1|true{if(value==="a"||value===1||value===true)return value;return "a";}',
    'function f(value:unknown):"a"{if(value!=="a")return "a";return value;}',
  ])
    assert.ok(check(text).ok, text);
  for (const text of [
    'function f(value:unknown):"a"{if(value!=="a")return value;return "a";}',
    'function f(value:unknown):"a"|"b"{if(value==="a"||value===42)return value;return "a";}',
    'function f(value:unknown):"a"|"b"{if(value==="a"||value==="b"){value=42;return value;}return "a";}',
  ])
    assert.equal(check(text).ok, false, text);
});

test("typeof narrows unions containing collection, buffer and callable types", () => {
  for (const text of [
    'function text(v:string):number{return v.length;}function list(v:readonly string[]):number{return v.length;}function f(v:string|readonly string[]):number{if(typeof v==="string")return text(v);return list(v);}',
    'function f(v:string|Set<number>):number{if(typeof v==="object")return v.size;return v.length;}',
    'function f(v:string|Map<string,number>):number{if(typeof v!=="object")return v.length;return v.size;}',
    'function f(v:string|Uint8Array):number{if(typeof v==="object")return v.byteLength;return v.length;}',
    'function f(v:string|(()=>number)):number{if(typeof v==="function")return v();return v.length;}',
  ]) {
    const result = check(text);
    assert.ok(result.ok, JSON.stringify({ text, result }));
  }
  for (const text of [
    'function text(v:string):number{return v.length;}function f(v:string|number[]):number{if(typeof v==="object")return text(v);return 0;}',
    'function f(v:string|(()=>number)):number{if(typeof v==="string")return v();return 0;}',
  ])
    assert.equal(check(text).ok, false, text);
});
test("short-circuit narrowing of uncaptured mutable bindings survives calls", () => {
  const prefix =
    "interface T{readonly label:string;readonly payload:number[]}function g(n:number):number{return n;}";
  // A parameter narrowed earlier in an && chain stays narrowed after a
  // call later in the chain: no closure captures it, so no call can
  // reassign it.
  for (const body of [
    'function f(t:T|undefined,id:number):boolean{return t!==undefined&&t.label==="x"+String(id)&&t.payload.length===4;}',
    "function f(t:T|undefined,id:number):boolean{return t!==undefined&&g(id)===1&&t.payload.length===4;}",
    'function f(t:T|undefined,id:number):boolean{if(t!==undefined&&String(id)==="1")return t.payload.length===4;return false;}',
    "function f(t0:T|undefined,id:number):boolean{let t=t0;return t!==undefined&&g(id)===1&&t.payload.length===4;}",
    "function f(t:T|undefined,id:number):boolean{let n=0;return t!==undefined&&(n=id)===1&&t.payload.length===4;}",
  ])
    assert.ok(check(prefix + body).ok, body);
  // Facts do not survive an operand that assigns the binding, directly or
  // through a closure that captures it.
  for (const body of [
    "function f(t:T|undefined):boolean{return t!==undefined&&(t=undefined)===undefined&&t.payload.length===4;}",
    "function f(t:T|undefined):boolean{return t!==undefined&&g((t=undefined)===undefined?1:0)===1&&t.payload.length===4;}",
    "function f(t:T|undefined):boolean{const clear=():number=>{t=undefined;return 1;};return t!==undefined&&clear()===1&&t.payload.length===4;}",
  ])
    assert.equal(check(prefix + body).ok, false, body);
});
test("`as` from unknown is a checked downcast to testable types", () => {
  const prefix = "interface P{readonly x:number}";
  for (const body of [
    "function f(v:unknown):number{return v as number;}",
    "function f(v:unknown):string|undefined{return v as string|undefined;}",
    "function f(v:unknown):Uint8Array{return v as Uint8Array;}",
    "function f(v:unknown):P{return v as P;}",
    "function f(v:unknown):boolean|null{return v as boolean|null;}",
  ]) {
    const checked = check(prefix + body);
    assert.ok(checked.ok, body);
    assert.equal(indexValues(checked.value.downcasts!).length, 1, body);
  }
  // Types without a run-time test stay rejected (lists would need a deep
  // check, functions a signature check).
  for (const body of [
    "function f(v:unknown):number[]{return v as number[];}",
    "function f(v:unknown):()=>number{return v as ()=>number;}",
  ])
    assert.equal(check(prefix + body).ok, false, body);
  // A downcast is only from unknown: other narrowing assertions keep their
  // upcast-only checking.
  assert.equal(
    check(prefix + "function f(v:number|string):number{return v as number;}")
      .ok,
    false,
  );
});

test("native Error constructors and guards expose TypeScript error members", () => {
  for (const source of [
    'function f(): Error { return new Error("message"); }',
    'function f(): Error { return { name: "Custom", message: "text" }; }',
    'function f(): string { try { throw new RangeError("range"); } catch (e) { if (!(e instanceof RangeError)) throw e; return e.message; } }',
    "function f(e: Error | string): string { if (e instanceof Error) return e.name; return e; }",
    "function f(e: Error): string | undefined { return e.stack; }",
    'function f(e: unknown): string { if (e instanceof Error && e.message === "a") return e.name; return ""; }',
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }

  for (const source of [
    "function f(): boolean { return 42 instanceof Error; }",
    "function f(): Error { return new Error(1); }",
    "function f(e: Error): string { return e.code; }",
    'function f(): Error { return { name: "Custom", message: 1 }; }',
  ])
    assert.equal(check(source).ok, false, source);

  const cause = check(
    'function f(): Error { return new Error("x", {cause: 42}); }',
  );
  assert.equal(cause.ok, false);
  assert.match(
    JSON.stringify(cause),
    /Error options \(cause\) require the realm Error constructor/,
  );
});

test("typed rest checks minimum arity, contextual elements and trailing spreads", () => {
  const result = check(`
    function count(head: number = 2, ...xs: readonly { value: number }[]): number {
      return head + xs.length;
    }
    function run(): number {
      const fn: (head?: number, ...xs: Array<{ value: number }>) => number = count;
      return fn() + fn(1, { value: 3 }) + fn(1, ...[{ value: 4 }]);
    }
  `);
  assert.ok(result.ok, JSON.stringify(result));
});

test("typed rest rejects mismatched elements and incompatible calling conventions", () => {
  const declaration =
    "function f(x: number, ...xs: number[]): number { return x + xs.length; }";
  for (const [body, code, message] of [
    ["return f();", "ARITY", /invalid call/],
    ['return f(1, "bad");', "TYPE_MISMATCH", /invalid call/],
    [
      'const bad: string[] = ["bad"]; return f(1, ...bad);',
      "TYPE_MISMATCH",
      /rest spread/,
    ],
    ["return f(...[1]);", "UNSUPPORTED", /spread.*rest position/],
    ["return fixed(...[1]);", "UNSUPPORTED", /spread.*rest position/],
    [
      "const x: (x: number, xs: number[]) => number = f; return 0;",
      "TYPE_MISMATCH",
      /matching rest layouts/,
    ],
  ] as const) {
    const result = check(
      declaration +
        "function fixed(x: number): number { return x; } function run(): number {" +
        body +
        "}",
    );
    assert.ok(!result.ok, body);
    assert.equal(result.error.code, code, JSON.stringify(result));
    assert.match(result.error.message, message);
  }
});

test("a void callback context preserves inferred value returns", () => {
  const result = check(`
    function named(): number { return 42; }
    function run(cb: () => void): void { cb(); }
    function main(): void {
      const cb: () => void = () => 42;
      run(cb);
      run(named);
      run(() => { return 42; });
    }
  `);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.voidResultDiscard, true);
  assert.ok(!check("function explicitlyVoid(): void { return 42; }").ok);
});

test("ordinary void callbacks keep exact call witnesses", () => {
  const absent = check(`
    function invoke(cb: () => void): void { cb(); }
    function main(): void { invoke(() => { return; }); }
  `);
  assert.ok(absent.ok);
  assert.equal(absent.value.voidResultDiscard, false);

  const alternative = check(`
    function keep(value: string): string { return value; }
    function main(): void {
      const value: ((x: number) => void) | ((x: string) => string) = keep;
    }
  `);
  assert.ok(alternative.ok);
  assert.equal(alternative.value.voidResultDiscard, false);
});

test("resolves string index signatures and finite Record annotations", () => {
  const result = check(`
    interface Indexed { readonly [key: string]: number; count: number }
    type ByName = Record<string, number>;
    type Pair = Record<"first" | "second", number>;
    function read(indexed: Indexed, byName: ByName, pair: Pair): Indexed[string] {
      return indexed.count + pair.first + pair.second;
    }
  `);
  assert.ok(result.ok, JSON.stringify(result));
});

test("requires every key of a finite Record", () => {
  const result = check(`
    function make(): Record<"first" | "second", number> { return {first: 1}; }
  `);
  assert.equal(result.ok, false);
  if (!result.ok) assert.notEqual(result.error.code, "INVALID_TYPE");
});

test("respects a local declaration named Record", () => {
  const result = check(`
    type Record<T> = { value: T };
    function read(record: Record<number>): number { return record.value; }
  `);
  assert.ok(result.ok, JSON.stringify(result));
});

test("checks fixed index-signature fields with exact optionality", () => {
  assert.ok(
    check(`
    interface Base { [key: string]: string }
    interface Derived extends Base { name: "ok" }
    function read(value: Derived): "ok" { return value.name; }
  `).ok,
  );
  assert.ok(check("type Good = { [key: string]: number; item?: number };").ok);
  for (const type of ["item: string", "item?: number | undefined"]) {
    const result = check(`type Bad = { [key: string]: number; ${type} };`);
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.match(result.error.message, /incompatible with the string index/);
  }
});

test("string index reads include undefined except for declared required fields", () => {
  const declarations = "type D = { [key: string]: number; count: number };";
  assert.ok(
    check(
      declarations +
        "function read(d: D): number { return d.count + (d.missing ?? 0); }",
    ).ok,
  );
  const result = check(
    declarations + "function read(d: D): number { return d.missing; }",
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "TYPE_MISMATCH");
});

test("only structural sources with compatible fields imply a string index", () => {
  const result = check(`
    type Alias = { count: number };
    function convert(value: Alias): Record<string, number> { return value; }
  `);
  assert.ok(result.ok, JSON.stringify(result));
  const interfaceSource = check(`
    interface Fixed { count: number }
    function convert(value: Fixed): Record<string, number> { return value; }
  `);
  assert.equal(interfaceSource.ok, false);
  if (!interfaceSource.ok)
    assert.equal(interfaceSource.error.code, "TYPE_MISMATCH");
});

test("checks dynamic names and writes using the declared index type", () => {
  const definition = "interface D { [key: string]: number; count: 42 }";
  const result = check(
    definition +
      `
    function update(key: string, n: number): number {
      const value: D = { count: 42, [key]: 1 };
      value[key] = n;
      value[2] = n;
      return (value[key] ?? 0) + value["count"];
    }
  `,
  );
  assert.ok(result.ok, JSON.stringify(result));
  for (const statement of [
    "value[key] = undefined;",
    'value[key] = "bad";',
    "value[false] = 1;",
    'value["count"] = 5;',
  ]) {
    const rejected = check(
      definition + `function f(value: D, key: string): void { ${statement} }`,
    );
    assert.equal(rejected.ok, false, statement);
    if (!rejected.ok) assert.equal(rejected.error.preventsFallback, true);
  }
});

test("readonly index signatures reject indexed writes", () => {
  const result = check(`
    function f(value: { readonly [key: string]: number }, key: string): void {
      value[key] = 5;
    }
  `);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "IMMUTABLE");
});

test("selects realm allocations through local aliases and array insertion", () => {
  const result = check(`
    interface Entry { count: number; tag?: string }
    function make(key: string): Record<string, Entry[]> {
      const entry: Entry = { count: 40 };
      const entries: Entry[] = [entry];
      const alias = entries;
      const result: Record<string, Entry[]> = { [key]: alias };
      alias.push({ count: 2 });
      entry.tag = "ready";
      return result;
    }
  `);
  assert.ok(result.ok, JSON.stringify(result));
  const entries = result.value.bindings.bindings.find(
    (b) => b.name === "entries",
  );
  assert.ok(entries);
  const type = result.value.types[result.value.bindingTypes[entries.id] ?? -1];
  assert.equal(type?.kind, "array");
  if (type?.kind === "array") assert.equal(type.realmArray, true);
});

test("realm demand follows calls, captures, typed fields and joins", () => {
  const result = check(`
    function identity(input: number[]): number[] { return input; }
    function f(flag: boolean): void {
      const items: number[] = [39];
      const holder: { items: number[] } = { items };
      let selected = flag ? identity(holder.items) : [0];
      if (!flag) selected = [1];
      const append = (): void => { selected.push(3); };
      const object: Record<string, number[]> = { selected };
      append();
    }
  `);
  assert.ok(result.ok, JSON.stringify(result));
  const items = result.value.bindings.bindings.find((b) => b.name === "items");
  assert.ok(items);
  const type = result.value.types[result.value.bindingTypes[items.id] ?? -1];
  assert.ok(type?.kind === "array" && type.realmArray === true);
});

test("indirect native aggregate calls still require views", () => {
  const result = check(`
    function consume(xs: number[]): void {}
    function f(): void {
      const list = [42];
      const callback: (xs: number[]) => void = consume;
      callback(list);
      const object: Record<string, unknown> = { payload: list };
    }
  `);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.preventsFallback, true);
    assert.equal(
      result.error.message,
      "UNSUPPORTED: native list values in dynamic-key objects need slice 2b list/record views",
    );
  }
});

test("ordinary Object reflection remains eligible for general fallback", () => {
  for (const call of [
    'Object.defineProperty(value, "answer", { value: 42 });',
    'Object.hasOwn(value, "answer");',
  ]) {
    const result = check(`function f(): number {
      const value = { answer: 42 };
      ${call}
      return value.answer;
    }`);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(
        result.error.message,
        "typed Object method requires a realm record",
      );
      assert.equal(result.error.preventsFallback, undefined);
    }
  }
  const accepted = check(`
    function own(value: Record<string, number>, key: string | number): boolean {
      return Object.hasOwn(value, key);
    }
  `);
  assert.ok(accepted.ok, JSON.stringify(accepted));
});

test("for-in binds a string key without asserting an indexed value is present", () => {
  const result = check(`
    function total(value: Record<string, number>): number {
      let total: number = 0;
      for (const key in value) total += value[key] ?? 0;
      let key: string = "";
      for (key in value) { if (key === "skip") continue; total += 1; }
      return total;
    }
  `);
  assert.ok(result.ok, JSON.stringify(result));
});

test("Object enumeration preserves index value and entry position types", () => {
  const result = check(`
    function read(dict: Record<string, number>): number {
      const keys = Object.keys(dict);
      const values = Object.values(dict);
      const entries: [string, number][] = Object.entries(dict);
      const entry = entries[0];
      if (entry === undefined) return 0;
      const key: string = entry[0];
      const value: number = entry[1];
      return key === keys[0] ? (values[0] ?? 0) + value : 0;
    }
  `);
  assert.ok(result.ok, JSON.stringify(result));
});

test("unannotated computed literals keep open storage", () => {
  const result = check(`
    function f(key: string): unknown {
      const object = { [key]: 1 };
      object[key] = "open";
      return object[key];
    }
  `);
  assert.ok(result.ok, JSON.stringify(result));
});

test("a numeric native list parameter gets a live view in a dynamic property", () => {
  const result = check(`
    export function f(value: number[]): void {
      const object: Record<string, unknown> = {};
      object.value = value;
    }
  `);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(indexValues(result.value.nativeListViews!).length, 1);
});

test("finite Record keys select the declared fixed fields", () => {
  assert.ok(
    check(`
    type Pair = Record<"a" | "b", number>;
    function read(value: Pair, key: "a" | "b"): number {
      value[key] = 42;
      return value[key];
    }
  `).ok,
  );
  assert.equal(
    check(`
    function read(value: Record<"a" | "b", number>, key: string): number {
      return value[key];
    }
  `).ok,
    false,
  );
});

test("literal presence narrows a dynamic property read", () => {
  const result = check(`
    function read(value: Record<string, number>): number {
      if ("key" in value) return value["key"] + value.key;
      return 0;
    }
  `);
  assert.ok(result.ok, JSON.stringify(result));
});

test("literal in introduces an unknown property on a narrowed Error", () => {
  const accepted = check(`function code(e: unknown): string {
    if (e instanceof Error && "code" in e && typeof e.code === "string") {
      const code: string = e.code;
      return code;
    }
    return "";
  }`);
  assert.ok(accepted.ok, JSON.stringify(accepted));
  assert.equal(
    check(`function code(e: Error): string {
    if ("code" in e) return e.code;
    return "";
  }`).ok,
    false,
  );
  assert.equal(
    check(`function code(e: Error): unknown {
    if (!("code" in e)) return e.code;
    return undefined;
  }`).ok,
    false,
  );
  assert.equal(
    check('function has(e: string): boolean { return "code" in e; }').ok,
    false,
  );
  assert.ok(
    check(`function value(o: { value: number }): number {
    if ("value" in o) return o.value;
    return 0;
  }`).ok,
  );
  assert.ok(
    check(`function errno(e: Error): number {
    if ("errno" in e && e.errno === -5) return e.errno;
    return 0;
  }`).ok,
  );
});

test("a checked property fact can cross a call on an uncaptured Error", () => {
  const accepted = check(`function touch(e: Error): void {}
function code(e: Error): string {
  if ("code" in e && typeof e["code"] === "string") {
    touch(e);
    return e.code;
  }
  return "";
}`);
  assert.ok(accepted.ok, JSON.stringify(accepted));
});

test("instanceof uses the checked constructor type through aliases and stable properties", () => {
  for (const source of [
    "function f(x: unknown): string { const C = Error; if (x instanceof C) return x.message; return ''; }",
    "function f(x: unknown, C: ErrorConstructor): string { const box = { C }; if (x instanceof box.C) return x.message; return ''; }",
    "function f(box: { value: unknown }): number { if (box.value instanceof Uint8Array) return box.value[0] ?? 0; return 0; }",
    "function f(x: unknown, Error: Uint8ArrayConstructor): number { if (x instanceof Error) return x.length; return 0; }",
    "function f(x: unknown, C: { [Symbol.hasInstance](x: unknown): x is string }): string { if (x instanceof C) return x; return ''; }",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("instanceof rejects primitive left operands and invalid right operands", () => {
  for (const condition of [
    "42 instanceof Error",
    "value instanceof 42",
    "value instanceof {}",
  ]) {
    assert.equal(
      check("function f(value: unknown): boolean { return " + condition + "; }")
        .ok,
      false,
    );
  }
});

test("instanceof flow follows stable paths and excludes matching union constituents", () => {
  for (const source of [
    "function f(box: { child: { value: unknown } }): number { if (box.child.value instanceof Uint16Array) return box.child['value'].length; return 0; }",
    "function f(x: Error | string): string { const C = Error; if (x instanceof C) return x.message; return x; }",
    "function f(x: unknown): number { if (x instanceof Int16Array) { x[0] = -12; return x[0] ?? 0; } return 0; }",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
  assert.equal(
    check(
      "function f(box: { value: unknown }): number { if (box.value instanceof Uint8Array) { box.value = 0; return box.value.length; } return 0; }",
    ).ok,
    false,
  );
});

test("instanceof recognizes the well-known symbol independently of string keys", () => {
  const result = check(
    'function f(x: unknown, C: { "@@hasInstance": (x:unknown)=>boolean }): boolean { return x instanceof C; }',
  );
  assert.equal(result.ok, false);
});

test("instanceof does not exclude structurally compatible records from the false branch", () => {
  const result = check(
    "interface ErrorLike { name: string; message: string } " +
      "function f(x: ErrorLike | string): string { if (x instanceof Error) return x.message; return x; }",
  );
  assert.equal(result.ok, false);
});

test("a declared hasInstance hook must accept an operand and return boolean", () => {
  for (const method of ["(): boolean", "(x: unknown): number"]) {
    const result = check(
      "function f(x: unknown, C: { [Symbol.hasInstance]" +
        method +
        " }): boolean { return x instanceof C; }",
    );
    assert.equal(result.ok, false);
  }
});

test("installed library constructors narrow through direct and annotated aliases", () => {
  for (const source of [
    "function f(x: unknown): number { if (x instanceof Date) return x.getTime(); return 0; }",
    "function f(x: unknown, C: DateConstructor): number { if (x instanceof C) return x.getTime(); return 0; }",
    "function f(x: unknown): number { const C: RegExpConstructor = RegExp; if (x instanceof C) return x.source.length; return 0; }",
    "function f(x: unknown): number { if (x instanceof Map) return x.size; return 0; }",
    "function f(x: unknown): boolean { return x instanceof Promise || x instanceof WeakMap || x instanceof WeakSet || x instanceof DataView; }",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("library narrowing keeps the non-instance constituent in the false branch", () => {
  const result = check(
    "function f(x: Date | string): string { if (x instanceof Date) return x.toISOString(); return x; }",
  );
  assert.ok(result.ok, JSON.stringify(result));
});

test("library constructor and member diagnostics identify the missing support", () => {
  for (const [source, message] of [
    [
      "function f(x: unknown): boolean { return x instanceof FinalizationRegistry; }",
      "Program realm does not install the library global FinalizationRegistry",
    ],
    [
      "function f(x: unknown): boolean { return x instanceof MadeUpConstructor; }",
      "No pinned TypeScript library value named MadeUpConstructor",
    ],
    [
      "function f(x: unknown): void { if (x instanceof RegExp) x.exec('a'); }",
      "Realm method RegExp.exec requires unsupported library signature lowering",
    ],
    [
      "function f(): number { return Uint8Array.prototype.length; }",
      "Realm property Uint8Array.prototype has no supported library representation",
    ],
  ]) {
    assert.ok(source);
    const result = check(source);
    assert.equal(result.ok ? undefined : result.error.message, message);
  }
});

test("typeof guards admit general calls and checked result consumption", () => {
  for (const body of [
    'if (typeof x === "function") return x(1, "extra"); return "";',
    'if ("function" !== typeof x) return ""; const result: string = x(); return result;',
    'if (!(typeof x === "function")) return ""; let result: string = ""; result = x(); return result;',
    'if (typeof x === "function" && x()) return "yes"; return "";',
    'if (typeof x !== "function" || !x()) return ""; return x();',
    'if (typeof x === "function") { const result = x(); return result; } return "";',
  ]) {
    const result = check("function f(x: unknown): string {" + body + "}");
    assert.ok(result.ok, JSON.stringify(result));
  }
  assert.ok(
    check(`function f(x: { readonly call: unknown }): unknown {
    if (typeof x.call === "function") return (x.call)(42);
    return undefined;
  }`).ok,
  );
});

test("callable facts retain concrete signatures and obey invalidation", () => {
  const concrete =
    "function f(x: ((n: number) => string) | undefined): string {";
  assert.ok(
    check(concrete + 'if (typeof x === "function") return x(1); return ""; }')
      .ok,
  );
  for (const source of [
    concrete + 'if (typeof x === "function") return x("bad"); return ""; }',
    "function f(x: unknown): unknown { return x(); }",
    'function f(x: unknown): unknown { if (typeof x !== "function") return x(); return 0; }',
    'function f(x: unknown): unknown { if (typeof x === "function") { x = 1; return x(); } return 0; }',
    'function f(x: unknown): unknown { const reset = (): void => { x = 1; }; if (typeof x === "function") { reset(); return x(); } return 0; }',
    'function f(x: unknown): unknown { if (typeof x === "function") { const g: (n: number) => string = x; return g; } return 0; }',
    'function f(x: unknown): unknown { if (typeof x === "function") return new x(); return 0; }',
  ]) {
    const result = check(source);
    assert.ok(!result.ok, source);
    assert.equal(result.error.code, "TYPE_MISMATCH", JSON.stringify(result));
  }
});

test("object binding declarations project annotated property types", () => {
  const result =
    check(`function f(input: { nested: { count: number }; label?: string }): number {
    const { nested: { count: total }, label = "default" } = input;
    return label.length + total;
  }`);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(
    check(`function f(input: { count: number }): number {
      const { missing } = input;
      return missing;
    }`).ok,
    false,
  );
});

test("binding patterns check native array elements, defaults, and rest", () => {
  const result = check(`function f(values: (number | undefined)[]): number {
    const [first = 0, , ...rest] = values;
    return first + (rest[0] ?? 0);
  }`);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(
    check("function f(values: number): void { const [x] = values; }").ok,
    false,
  );
});

test("patterns in parameters and for-of heads use their input types", () => {
  const result = check(`
    function project({ n = 20 }: { n?: number }, twice: number = n + n): number { return twice; }
    function f(items: { x: number }[]): number {
      const pick: (item: { x: number }) => number = ({ x }) => x;
      let total = 0;
      for (const { x } of items) { total += pick({ x }); }
      return total + project({});
    }
  `);
  assert.ok(result.ok, JSON.stringify(result));
});

test("destructuring assignments preserve their source type and check target writes", () => {
  const result = check(`
    function f(): number {
      let a: number = 1, b: number = 2;
      [a, b] = [b, a];
      const result = ({ a } = { a: 42 });
      return result.a;
    }
  `);
  assert.ok(result.ok, JSON.stringify(result));
  for (const source of [
    'function f(): void { let a: number = 0; ({ a } = { a: "wrong" }); }',
    "function f(xs: number[]): void { let a: number = 0; [a] = xs; }",
  ])
    assert.equal(check(source).ok, false);
});

test("module binding patterns publish leaf types to following declarations", () => {
  const result = check(`
    export const { value: answer }: { value: number } = { value: 42 };
    export function run(): number { return answer; }
  `);
  assert.ok(result.ok, JSON.stringify(result));
});

test("binding defaults contextually type empty property and parameter literals", () => {
  for (const source of [
    "function f(o: { xs?: number[] }): number { const { xs = [] }: { xs?: number[] } = o; return xs.length; }",
    "function f({ a = {} } = {}): number { return 42; }",
  ]) {
    const result = check(source);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

test("catch patterns with an any annotation project general values", () => {
  const result = check(`
    function f(value: unknown): number {
      try { throw value; } catch ({ n }: any) { return n as number; }
    }
  `);
  assert.ok(result.ok, JSON.stringify(result));
});

test("inferred union leaves can change type while annotated leaves retain their contract", () => {
  const source = `function f(input: { value: number | string }): boolean {
    let { value } = input;
    value = true;
    return value;
  }`;
  assert.ok(check(source).ok);
  assert.equal(
    check(
      source.replace(
        "let { value }",
        "let { value }: { value: number | string }",
      ),
    ).ok,
    false,
  );
});

test("realm iterator pattern parameters can initialize before later defaults", () => {
  const result = check(`
    function read([first = 20]: Iterable<number>, second: number = first): number {
      return first + second;
    }
  `);
  assert.ok(result.ok, JSON.stringify(result));
});

test("realm iterator values retain realm record layouts", () => {
  const result = check(`
    function read(input: Iterable<{ value: number }>): number {
      const [entry] = input;
      if (entry === undefined) return 0;
      const { value } = entry;
      return value;
    }
  `);
  assert.ok(result.ok, JSON.stringify(result));
  const checked = result.value;
  const entry = checked.bindings.bindings.find(
    (binding) => binding.name === "entry",
  );
  assert.ok(entry);
  const type = checked.types[checked.bindingTypes[entry.id] ?? -1];
  assert.ok(type?.kind === "union");
  assert.ok(
    type.members.some((member) => {
      const variant = checked.types[member];
      return variant?.kind === "object" && variant.realmRecord === true;
    }),
  );
});

test("numeric spreads compose with surrounding elements in typed literals", () => {
  const result = check(`
    function f(references: number[], generals: number[], frameBytes: number): number[] {
      return [frameBytes, references.length, ...references, generals.length, ...generals, 0];
    }
  `);
  assert.ok(result.ok, JSON.stringify(result));
});

test("updates share dynamic-key read and write checks", () => {
  const accepted = check(`
    function f(numbers: Record<string, number>, labels: Record<string, string>, key: string): number {
      numbers[key] ??= 20;
      labels.title ??= "Tint";
      if ("title" in labels) labels.title += "!";
      const old = "value" in numbers ? numbers.value++ : 0;
      return "value" in numbers ? old + (numbers.value *= 2) : old;
    }
  `);
  assert.ok(accepted.ok, JSON.stringify(accepted));
  for (const source of [
    "function f(x: { readonly [key: string]: number }): void { x.value ??= 1; }",
    'function f(x: Record<string, number>): void { if ("value" in x) x.value += "x"; }',
  ])
    assert.equal(check(source).ok, false);
});

test("a statically void callback result can be evaluated in a value context", () => {
  const result = check(`
    function read(action: () => void): unknown {
      const actual: unknown = action();
      if (action() === undefined) return action();
      return actual;
    }
  `);
  assert.ok(result.ok, JSON.stringify(result));
});

test("dynamic-key erasure requests native views for witnessed layouts", () => {
  const result = check(`
    function run(): void {
      const list: number[] = [1];
      const record: {value: number; readonly label: string} = {value: 2, label: "a"};
      const callable = (x: number): number => x + 1;
      const table: Record<string, unknown> = {list, record, callable};
      table.alias = record;
    }
  `);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(indexValues(result.value.nativeCallableViews!).length, 1);
  assert.equal(indexValues(result.value.nativeListViews!).length, 1);
  const fields = indexValues(result.value.nativeRecordViews!);
  assert.equal(fields.length, 2);
  assert.deepEqual(fields[0], [
    { name: "value", type: "number", optional: false, readonly: false },
    { name: "label", type: "string", optional: false, readonly: true },
  ]);
});
test("typed Atomics run inline on native integer arrays only", () => {
  for (const type of ["Uint8Array", "Uint16Array", "Uint32Array"])
    assert.ok(
      check(
        `function f(a:${type}):number{Atomics.store(a,0,1);return Atomics.add(a,0,1)+Atomics.sub(a,0,1)+Atomics.and(a,0,1)+Atomics.or(a,0,1)+Atomics.xor(a,0,1)+Atomics.exchange(a,0,1)+Atomics.compareExchange(a,0,1,2)+Atomics.load(a,0);}`,
      ).ok,
      type,
    );
  for (const text of [
    // The pinned library types Atomics on integer typed arrays only.
    "function f(a:Float64Array):number{return Atomics.add(a,0,1);}",
    "function f(a:Uint32Array):number{return Atomics.add(a,0);}",
    "function f(a:Uint32Array):number{return Atomics.load(a,0,1);}",
    "function f(a:Uint32Array):number{return Atomics.compareExchange(a,0,1);}",
    'function f(a:Uint32Array):number{return Atomics.add(a,"0",1);}',
    "function f(a:Uint32Array):number{return Atomics.add(a,0,true);}",
    "function f(a:Uint32Array,v:number|undefined):number{return Atomics.store(a,0,v);}",
  ])
    assert.equal(check(text).ok, false, text);
  // A local binding named Atomics is an ordinary value.
  const shadowed = check(
    "function f(a:Uint32Array):number{const Atomics={add:(x:Uint32Array,i:number,v:number):number=>v};return Atomics.add(a,0,1);}",
  );
  assert.ok(shadowed.ok);
});
