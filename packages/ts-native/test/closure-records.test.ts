import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { lowerModuleEntries } from "@tint/ts-native/closure/lowering";
import { verify } from "@tint/ir/scalar";
import {
  createRecordContracts,
  arrayElement,
  entryType,
} from "../src/closure/lowering/records.ts";
const target = {
  pointerSize: 8,
  wordSize: 8,
  allocationAlignment: 16,
  frameAlignment: 16,
  maxAlignment: 16,
} as const;
test("checked record views guard extraction and require the witness type in the result", () => {
  const result = lower(
    "interface Box{value:number} function view(value:unknown,witness:Box):Box|undefined{return undefined;}",
    [0],
    true,
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
  assert.equal(
    result.value.module.functions[0]?.returnType,
    "optional-reference",
  );
  assert.equal(
    result.value.module.functions[0]?.blocks[0]?.terminator.kind,
    "branch",
  );
  assert.equal(
    lower(
      "function view(value:unknown,witness:{value:number}):{text:string}|undefined{return undefined;}",
      [0],
      true,
    ).ok,
    false,
  );
  assert.equal(
    lower(
      "function view(value:unknown,witness:{value:number}):{value:42}|undefined{return undefined;}",
      [0],
      true,
    ).ok,
    false,
  );
});
test("concrete record views derive their layout from the optional result without a witness allocation", () => {
  const result = lower(
    "interface Box{value:number} function view(value:unknown):Box|undefined{return undefined;}",
    [0],
    true,
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
  assert.equal(result.value.module.functions[0]?.parameters.length, 1);
  assert.ok(
    result.value.module.functions[0]?.blocks[0]?.instructions.some(
      (op) => op.kind === "general-record-is",
    ),
  );
  for (const type of [
    "{value:number}",
    "{value:number}|{text:string}|undefined",
    "number|undefined",
  ]) {
    const body =
      type === "{value:number}" ? "return {value:1};" : "return undefined;";
    assert.equal(
      lower(`function view(value:unknown):${type}{${body}}`, [0], true).ok,
      false,
    );
  }
});
function lower(
  text: string,
  recordBindings?: readonly number[],
  view: boolean = false,
) {
  const bytes = new TextEncoder().encode(text),
    s = createSourceText(bytes, bytes.length);
  assert.ok(s.ok);
  const p = parseModule(s.value);
  assert.ok(p.ok);
  const c = checkClosureModule(p.value);
  assert.ok(c.ok, JSON.stringify(c));
  return lowerModuleEntries(
    c.value,
    c.value.bindings.functions
      .filter((f) => f.parent === undefined)
      .map((f) => f.id),
    target,
    4096,
    recordBindings === undefined
      ? undefined
      : {
          recordBindings: recordBindings.map((fn) => ({
            function: fn,
            operation: view ? "view" : "test",
          })),
        },
  );
}
test("explicit record-test capabilities replace only validated module functions", () => {
  const text =
    "interface Box {value:number} export function matches(value:unknown, witness:Box):boolean{return false;}";
  const plain = lower(text),
    bound = lower(text, [0]);
  assert.ok(plain.ok);
  assert.ok(bound.ok, JSON.stringify(bound));
  assert.equal(
    plain.value.module.functions[0]?.blocks[0]?.instructions.some(
      (op) => op.kind === "general-record-is",
    ),
    false,
  );
  assert.ok(
    bound.value.module.functions[0]?.blocks[0]?.instructions.some(
      (op) => op.kind === "general-record-is",
    ),
  );
  assert.ok(verify(bound.value.module).ok);
  assert.equal(lower(text, [0, 0]).ok, false);
  assert.equal(lower(text, [99]).ok, false);
  assert.equal(
    lower(
      "function matches(value:number,witness:{value:number}):boolean{return false;}",
      [0],
    ).ok,
    false,
  );
});
test("checked object construction, aliases and properties share the ordinary function pipeline", () => {
  const r = lower(
    "interface Pair {lo:number;hi:number} function make(a:number,b:number):Pair{return {hi:b,lo:a};} function read(p:Pair):number{return p.lo+p.hi;} function write(p:Pair,n:number):number{const alias=p;alias.lo=n;return p.lo;}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  assert.equal(r.value.module.records?.length, 1);
  assert.ok(
    r.value.module.functions[0]!.blocks.some((b) =>
      b.instructions.some((i) => i.kind === "record-new"),
    ),
  );
  assert.ok(
    r.value.module.functions[1]!.blocks.some(
      (b) => b.terminator.kind === "record",
    ),
  );
  assert.ok(
    r.value.module.functions[2]!.blocks.some(
      (b) =>
        b.terminator.kind === "record" && b.terminator.operation === "write",
    ),
  );
});
test("nested constructors and direct helpers carry managed reference results", () => {
  const r = lower(
    "interface Pair {readonly lo:number;readonly hi:number} interface Box {readonly value:Pair} function pair(a:number,b:number):Pair{return {lo:a,hi:b};} function box(a:number,b:number):Box{return {value:pair(a,b)};} function total(b:Box):number{return b.value.lo+b.value.hi;}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  assert.equal(r.value.module.records?.length, 2);
});
test("structural subtypes use their own property offsets", () => {
  const r = lower(
    "interface Pair {lo:number;hi:number} interface Wide {extra:number;hi:number;lo:number} function wide():Wide{return {extra:7,hi:2,lo:1};} function read(p:Pair):number{return p.lo;} function run():number{return read(wide());}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  const reads = r.value.module.functions[1]!.blocks.map(
    (b) => b.terminator,
  ).filter((t) => t.kind === "record");
  assert.equal(reads.length, 2);
  assert.deepEqual(
    reads
      .map((t) => r.value.module.records![t.record]!.fields[t.field]!.offset)
      .sort((a, b) => a - b),
    [16, 32],
  );
});
test("unsupported managed fields and captured module state fail explicitly", () => {
  const text = lower(
    'interface Message {text:readonly string[]} function message():Message{return {text:["hi"]};}',
  );
  assert.equal(text.ok, false);
  const capture = lower("let n=1; function read():number{return n;}");
  assert.equal(capture.ok, false);
});
test("immutable module literals lower without environment storage", () => {
  const r = lower(
    "const BASE=4294967296; const ENABLED=true; function read(n:number):number{if(ENABLED)return n+BASE;return n;}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  const values = r.value.module.functions[0]!.blocks.flatMap(
    (b) => b.instructions,
  )
    .filter((i) => i.kind === "constant")
    .map((i) => i.value);
  assert.ok(values.includes(4294967296));
  assert.ok(values.includes(true));
});
test("module initializers cannot silently lose runtime effects", () => {
  const r = lower(
    "function init():number{return 1;} const n=init(); function read():number{return 2;}",
  );
  assert.equal(r.ok, false);
});
test("finite string contracts retain values across records and literal guards", () => {
  const r = lower(
    'type Error="BAD"|"EMPTY"; interface Result {readonly ok:false;readonly error:Error} function result():Result{return {ok:false,error:"BAD"};} function inspect(r:Result):boolean{return r.error==="BAD";}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});
test("finite strings never silently acquire numeric comparison semantics", () => {
  const r = lower('function invalid(e:"BAD"):boolean{return e===1;}');
  assert.equal(r.ok, false);
});
test("optional numeric fields wrap constructor and assignment values", () => {
  const r = lower(
    "interface Box {value:number|undefined} function make():Box{return {value:1};} function clear(b:Box):void{b.value=undefined;} function set(b:Box):number{return b.value=2;} function read(b:Box):number|undefined{return b.value;}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  assert.ok(
    r.value.module.records?.some((r) =>
      r.fields.some((f) => f.type === "optional-number"),
    ),
  );
});
test("readonly optional fields accept a narrower numeric physical layout", () => {
  const r = lower(
    "interface Maybe {readonly value:number|undefined} interface Yes {readonly value:number} function make():Yes{return {value:1};} function read(b:Maybe):number|undefined{return b.value;}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});
test("switch lowers returning clauses, fallthrough and distinct loop control targets", () => {
  for (const text of [
    "function f(n:number):number{switch(n){case 1:case 2:return 2;default:return 3;}}",
    "function f(n:number):number{let result=0;while(n>0){switch(n){case 1:n=0;continue;default:result=result+n;break;}n=n-1;}return result;}",
    'type Result={readonly kind:"number";readonly value:number}|{readonly kind:"boolean";readonly flag:boolean}; function read(r:Result):number{switch(r.kind){case "number":return r.value;default:return r.flag?1:0;}}',
  ]) {
    const r = lower(text);
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok(verify(r.value.module).ok);
  }
  assert.equal(
    lower(
      'function f(value:"BAD"):number{switch(value){case 1:return 1;default:return 2;}}',
    ).ok,
    false,
  );
});
test("exhaustive finite switches need no synthetic source default", () => {
  for (const text of [
    'function f(n:"a"|"b"):number{switch(n){case "a":return 1;case "b":return 2;}}',
    "function f(n:boolean):number{switch(n){case true:return 1;case false:return 0;}}",
  ]) {
    const r = lower(text);
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok(verify(r.value.module).ok);
  }
});
test("general strings carry literal contents through records, calls and built-in reads", () => {
  const r = lower(
    'const TEXT="A\\u0000\\ud800"; interface Box {readonly value:string} function make():Box{return {value:TEXT};} function code(text:string,n:number):number{return text.charCodeAt(n)+text.length;} function same(a:string,b:string):boolean{return a===b;} function empty():number{return "".charCodeAt();} function absent():number{return "a".charCodeAt(undefined);}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  assert.ok(
    r.value.module.records?.some((r) =>
      r.fields.some((f) => f.type === "string"),
    ),
  );
});
test("string concatenation lowers to an allocating operation with rooted operands", () => {
  const r = lower(
    'function join(a:string,b:string):string{return a+b;} function run():string{return join("A\\u0000", "\\ud800")+"!";}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  assert.equal(
    r.value.module.functions
      .flatMap((f) => f.blocks.flatMap((b) => b.instructions))
      .filter((i) => i.kind === "string-concat").length,
    2,
  );
});
test("string slicing supports optional relative bounds through shared IR", () => {
  const r = lower(
    'function part(s:string,start:number|undefined,end:number|undefined):string{return s.slice(start,end);} function run():string{return "abc".slice()+"abc".slice(-2); }',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  assert.equal(
    r.value.module.functions
      .flatMap((f) => f.blocks.flatMap((b) => b.instructions))
      .filter((i) => i.kind === "string-slice").length,
    3,
  );
});
test("string prefix tests support optional numeric positions", () => {
  const r = lower(
    'function prefix(s:string,p:string,n:number|undefined):boolean{return s.startsWith(p,n);} function run():boolean{return "abc".startsWith("ab");}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  assert.equal(
    r.value.module.functions
      .flatMap((f) => f.blocks.flatMap((b) => b.instructions))
      .filter((i) => i.kind === "string-starts-with").length,
    2,
  );
});
test("typed array for-of lowers iteration with break, continue and mutable bindings", () => {
  const r = lower(
    "function sum(a:Uint8Array):number{let total=0;for(let value of a){if(value===0)continue;value=value+1;total+=value;if(total>20)break;}return total;}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  const ops = r.value.module.functions[0]!.blocks.flatMap(
    (b) => b.instructions,
  );
  assert.ok(ops.some((i) => i.kind === "array-read"));
  assert.ok(ops.some((i) => i.kind === "array-length"));
});
test("for-of captured bindings cannot silently reuse one iteration cell", () => {
  const r = lower(
    "function first(a:Uint32Array):number{for(const x of a){function read():number{return x;}return read();}return 0;}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});
test("unsigned typed-array constructors lower normalized numeric lengths to owned allocation", () => {
  const r = lower(
    "function make(n:number|undefined):Uint8Array{return new Uint8Array(n);} function wide():Uint16Array{return new Uint16Array(3.9);} function empty():Uint32Array{return new Uint32Array();}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  assert.deepEqual(
    r.value.module.functions
      .flatMap((f) => f.blocks.flatMap((b) => b.instructions))
      .filter((i) => i.kind === "array-new")
      .map((i) => i.type),
    ["Uint8Array", "Uint16Array", "Uint32Array"],
  );
});
test("owned typed arrays can flow through traced record fields", () => {
  const r = lower(
    "interface Output {readonly bytes:Uint8Array;wide:Uint32Array} function make(n:number):Output{return {bytes:new Uint8Array(n),wide:new Uint32Array(n)};} function read(x:Output):number{x.bytes[0]=7;return x.bytes[0]??0;}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  assert.deepEqual(
    r.value.module.records?.[0]?.fields.map((f) => f.type),
    ["Uint8Array", "Uint32Array"],
  );
});
test("typed-array subarray preserves element type and optional relative bounds", () => {
  const r = lower(
    "function tail(a:Uint8Array,b:number|undefined,e:number|undefined):Uint8Array{return a.subarray(b,e);} function all(a:Uint16Array):Uint16Array{return a.subarray();}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  assert.equal(
    r.value.module.functions
      .flatMap((f) => f.blocks.flatMap((b) => b.instructions))
      .filter((i) => i.kind === "array-subarray").length,
    2,
  );
});
test("typed-array set lowers checked bounds and a source snapshot before writes", () => {
  const r = lower(
    "function copy(a:Uint8Array,b:Uint32Array,n:number|undefined):void{return a.set(b,n);}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  const ops = r.value.module.functions[0]!.blocks.flatMap(
    (b) => b.instructions,
  );
  assert.ok(
    ops.some((i) => i.kind === "array-new" && i.type === "Uint32Array"),
  );
  assert.equal(ops.filter((i) => i.kind === "array-write").length, 2);
});

test("module calls materialize omitted optional numeric arguments", () => {
  const r = lower(
    "function f(x?:number):number{return x??7;}function run():number{return f()+f(undefined)+f(3);}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("module entries lower numeric defaults before their bodies", () => {
  const r = lower(
    "function f(a:number=3,b:number=a+2):number{return a+b;}function g():number{return f()+f(undefined,4);}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("ordinary numeric arrays never reuse unsigned typed-array native encodings", () => {
  const r = lower(
    "function sum(a:number[]):number{a.push(3);return (a[0]??0)+a.length;}",
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /unsupported native representation/);
});

test("Float64Array source arrays preserve traced native handles", () => {
  const r = lower(
    "interface Box{readonly values:Float64Array}function f(n:number):Box{return {values:new Float64Array(n)};}function read(b:Box):number{return b.values[0]??0;}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  assert.equal(r.value.module.records?.[0]?.fields[0]?.type, "Float64Array");
});
test("optional numeric record contracts lower construction and access with presence storage", () => {
  for (const body of [
    "function make():Options{return {};}",
    "function read(o:Options):number{return o.count??0;}",
    "function write(o:Options):void{o.count=2;}",
  ])
    assert.equal(
      lower("interface Options {count?:number}" + body).ok,
      true,
      body,
    );
});

test("optional fields preserve omission independently from explicit undefined in native IR", () => {
  const r = lower(
    "interface Options {count?:number|undefined} function absent():Options{return {};}function explicit():Options{return {count:undefined};}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  const constructors = r.value.module.functions.map((f) =>
    f.blocks
      .flatMap((b) => b.instructions)
      .find((i) => i.kind === "record-new"),
  );
  assert.ok(
    constructors[0]?.kind === "record-new" &&
      constructors[1]?.kind === "record-new",
  );
  assert.equal(constructors[0].arguments[0], undefined);
  assert.equal(typeof constructors[1].arguments[0], "number");
  assert.ok(
    r.value.module.records?.some((r) =>
      r.fields.some((f) => f.presenceOffset !== undefined),
    ),
  );
  assert.equal(
    lower("interface Text{label?:string} function make():Text{return {};}").ok,
    true,
  );
});
test("recursive optional objects lower through managed optional references", () => {
  const result = lower(`
    interface Node {readonly value:number;next?:Node|undefined}
    function make():Node{return {value:1};}
    function empty():Node|undefined{return undefined;}
    function link(node:Node,next:Node|undefined):void{node.next=next;}
    function read(node:Node|undefined):number{if(node===undefined)return 0;return node.value;}
    function run():number{const node=make();link(node,empty());link(node,node);const next=node.next;return read(next);}
  `);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
  assert.ok(
    result.value.module.records?.some((r) =>
      r.fields.some(
        (f) =>
          f.type === "optional-reference" && f.presenceOffset !== undefined,
      ),
    ),
  );
  const ops = result.value.module.functions.flatMap((f) =>
    f.blocks.flatMap((b) => b.instructions),
  );
  assert.ok(ops.some((i) => i.kind === "reference-wrap"));
  assert.ok(ops.some((i) => i.kind === "reference-value"));
});
test("optional object fallback and undefined conversion preserve checked value distinctions", () => {
  const r = lower(`interface Node{readonly value:number}
    function none():undefined{return undefined;}
    function fallback(node:Node|undefined,other:Node):Node{return node??other;}
    function run(node:Node):number{const missing:undefined=none();const result:Node|undefined=missing;const chosen=result??node;if(chosen===undefined)return 0;return chosen.value;}
  `);
  assert.ok(r.ok, JSON.stringify(r));
  const bad = lower(
    "interface Node{value:number} function compare(node:Node|undefined,flag:boolean):boolean{const other:number|undefined=flag?1:undefined;return node===other;}",
  );
  assert.equal(bad.ok, false);
});

test("optional strings lower calls, presence, truthiness, equality and exact optional fields", () => {
  const r = lower(`interface Text{label?:string|undefined}
 function echo(value:string|undefined):string|undefined{return value;}
 function read(t:Text):number{const value=t.label;if(value===undefined)return 0;return value.length;}
 function run(flag:boolean):string {
   const t:Text={};t.label=flag?"":undefined;
   const value=echo(t.label);if(value!==undefined&&value!=="x")t.label="done";
   t.label=undefined;
   return (value??"fallback")+typeof value;
 }`);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  assert.ok(
    r.value.module.records?.some((r) =>
      r.fields.some(
        (f) => f.type === "optional-string" && f.presenceOffset !== undefined,
      ),
    ),
  );
});

test("checked object spread copies fields before applying later overrides", () => {
  const result = lower(
    "function copy(source:{x:number}):number{const copy={...source,x:2};return copy.x;}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
  assert.ok(
    result.value.module.functions.some((f) =>
      f.blocks.some(
        (b) =>
          b.terminator.kind === "record" && b.terminator.operation === "read",
      ),
    ),
  );
  assert.ok(
    result.value.module.functions.some((f) =>
      f.blocks.some((b) =>
        b.instructions.some((op) => op.kind === "record-new"),
      ),
    ),
  );
});

test("finally replaces a pending return through native completion routing", () => {
  const result = lower(
    "function run():number{try{return 1;}finally{return 2;}}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(verify(result.value.module), { ok: true });
});

test("never-returning managed callbacks use the void normal ABI and terminate flow", () => {
  const result = lower(
    "function invoke(callback:()=>never):number{return callback();}function run():number{return invoke(()=>{throw 42;});}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(verify(result.value.module), { ok: true });
});

test("unknown values use the general native representation", () => {
  const result = lower(
    "function identity(value:unknown):unknown{return value;}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.module.functions[0]?.returnType, "general");
  assert.deepEqual(verify(result.value.module), { ok: true });
});
test("mixed string and record unions retain their checked variants in general storage", () => {
  const result = lower(
    "function identity(value:string|{id:number}):string|{id:number}{return value;}function read(value:string|{id:number}):number{return typeof value==='string'?value.length:value.id;}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.module.functions[0]?.returnType, "general");
  assert.deepEqual(verify(result.value.module), { ok: true });
});

test("optional syntax on a required typed-array receiver preserves ordinary indexed access", () => {
  const result = lower(
    "function read(value:Uint8Array):number|undefined{return value?.[0];}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(verify(result.value.module), { ok: true });
});

test("String.fromCharCode lowers numeric arguments through a string construction instruction", () => {
  const result = lower(
    "function text(a:number,b:number):string{return String.fromCharCode(a,b,0xd800);}function empty():string{return String.fromCharCode();}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
  const ops = result.value.module.functions.flatMap((f) =>
    f.blocks.flatMap((b) => b.instructions),
  );
  assert.ok(ops.some((op) => op.kind === "string-from-code-units"));
});

test("never calls terminate normal flow without fabricating a return value", () => {
  const result = lower(
    'function fail():never{throw "failure";}function forward():number{return fail();}function choose(flag:boolean):number{return flag?7:fail();}',
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
  assert.equal(result.value.module.functions[0]?.returnType, "void");
  const forward = result.value.module.functions[1];
  assert.ok(forward);
  assert.equal(forward.blocks.length, 1);
  assert.equal(forward.blocks[0]?.terminator.kind, "trap");
  assert.ok(forward.blocks[0]?.instructions.some((op) => op.kind === "call"));
});

test("inferred object literals use ordinary native record construction", () => {
  const result = lower(`function run():number {
    const first={};const second={};const alias=first;
    if(first===second||first!==alias)return -1;
    const state={count:1,nested:{value:2},label:"ok"};
    state.count=3;state.nested.value=4;
    return state.count+state.nested.value;
  }`);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("string defaults use optional string inputs and lazy entry initialization", () => {
  const result = lower(`type Code="bad"|"limit";
    function label(code:Code="bad"):string{return code;}
    function run():string{return label()+label("limit")+label(undefined);}`);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
  assert.ok(
    result.value.module.functions.some((f) =>
      f.slots.includes("optional-string"),
    ),
  );
});

test("object defaults accept omitted inputs and captured reference values", () => {
  const result = lower(`type Box={value:number};
    function box(value:Box={value:3}):Box{return value;}
    function captured(value:Box={value:4}):()=>number{return ():number=>value.value;}
    function run():number{const supplied:Box={value:5};
      if(box(supplied)!==supplied)return -1;
      return box().value+box(undefined).value+captured()();}`);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("Math min and max lower variadic numeric calls through shared scalar IR", () => {
  const result = lower(
    "function f(a:number,b:number):number{return Math.min(a,b,3)+Math.max(a,b)+Math.min()+Math.max();}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("string compound assignment reads the old value before RHS mutation", () => {
  const result = lower(`function run():string {
    let value="a";const rhs=():string=>{value="reset";return "b";};
    const assigned=(value+=rhs());return assigned+value;
  }`);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("String.fromCodePoint lowers validated numeric inputs and surrogate pairs", () => {
  const result = lower(
    "function text(a:number,b:number):string{return String.fromCodePoint(a,b);}function empty():string{return String.fromCodePoint();}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
  assert.ok(
    result.value.module.functions.some((f) =>
      f.blocks.some((b) => b.terminator.kind === "throw"),
    ),
  );
});

test("typed locals may be assigned on all branches before their first read", () => {
  const result = lower(`function choose(flag:boolean):string{
    let value:string; if(flag)value="yes";else value="no";
    let result:string;result=value;return result;
  }`);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("string includes lowers through bounded UTF-16 prefix searches", () => {
  const result = lower(
    "function has(text:string,search:string,position:number|undefined):boolean{return text.includes(search,position);}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
  assert.ok(
    result.value.module.functions.some((f) =>
      f.blocks.some((b) =>
        b.instructions.some((i) => i.kind === "string-starts-with"),
      ),
    ),
  );
});

test("boolean defaults lower false separately from omitted arguments", () => {
  const result = lower(`function flag(value:boolean=true):boolean{return value;}
    function capture(value:boolean=false):()=>boolean{return ():boolean=>value;}
    function run():boolean{return flag()&&!flag(false)&&flag(undefined)&&!capture()();}`);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("guarded optional record reads unwrap physical field encodings", () => {
  const r = lower(
    'function number(x:{readonly value?:number}):number{if(x.value===undefined)return 0;return x.value;}function text(x:{readonly value?:string}):string{if(x.value===undefined)return "";return x.value;}interface Item {value:number}function object(x:{readonly value?:Item}):number{if(x.value===undefined)return 0;return x.value.value;}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  const kinds = r.value.module.functions.flatMap((f) =>
    f.blocks.flatMap((b) => b.instructions.map((i) => i.kind)),
  );
  for (const kind of ["optional-value", "string-value", "reference-value"])
    assert.ok(
      kinds.some((actual) => actual === kind),
      kind,
    );
});

test("absent guarded fields produce undefined independent of physical encoding", () => {
  const r = lower(
    "function f(x:{readonly value?:string}):undefined{if(x.value===undefined)return x.value;return undefined;}interface Item {value:number}function g(x:{readonly value?:Item}):undefined{if(x.value===undefined)return x.value;return undefined;}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("numeric concatenation and String require an included exact formatter contract", () => {
  for (const expression of ['n+":"', "String(n)", "`${n}`"]) {
    for (const [helper, expected] of [
      ['function format(n:number):string{return "x";}', true],
      ['function format(n:1):string{return "x";}', false],
      ["function format(n:number):number{return n;}", false],
    ] as const) {
      const bytes = new TextEncoder().encode(
        helper + "function run(n:number):string{return " + expression + ";}",
      );
      const source = createSourceText(bytes, bytes.length);
      assert.ok(source.ok);
      const parsed = parseModule(source.value);
      assert.ok(parsed.ok);
      const checked = checkClosureModule(parsed.value);
      assert.ok(checked.ok);
      const result = lowerModuleEntries(checked.value, [0, 1], target, 4096, {
        numberToString: 0,
      });
      assert.equal(result.ok, expected, JSON.stringify(result));
      assert.equal(
        lowerModuleEntries(checked.value, [1], target, 4096, {
          numberToString: 0,
        }).ok,
        false,
      );
      assert.equal(
        lowerModuleEntries(checked.value, [0, 1], target, 4096).ok,
        false,
      );
    }
  }
});
test("callback ABI contracts do not require a concrete matching function", () => {
  const result = lower(
    "function invoke(callback:(a:number,b:number)=>number):number{return callback(20,22);}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});
test("object spread ignores stored fields overwritten by a later explicit property", () => {
  const result = lower(`interface Span {start:number;end:number}
    interface Text extends Span {type:string}
    interface Numeric extends Span {type:{value:number}}
    function numeric():Numeric{return {start:0,end:1,type:{value:3}};}
    function copy(span:Span):Text{return {...span,type:"text"};}`);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});
test("conditional literal spreads use only their actual closed object shapes", () => {
  const result = lower(`interface Output {type:string;optional?:boolean}
    interface Other {type:{value:number}}
    function other():Other{return {type:{value:1}};}
    function copy(flag:boolean):Output{return {type:"text",...(flag?{optional:true}:{})};}`);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});
test("optional callbacks use nullable function references and narrow before calling", () => {
  const result = lower(
    "function apply(f:((x:number)=>number)|undefined,n:number):number {if(f===undefined)return 0;return f(n);} function run():number{return apply((x:number):number=>x+1,41)+apply(undefined,9);}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});
test("union-valued object construction shares an identical physical layout", () => {
  const result = lower(
    'type Item={readonly kind:"a";readonly value:number}|{readonly kind:"b";readonly value:number};function copy(item:Item):Item{return {...item};}function run():number{return copy({kind:"b",value:42}).value;}',
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});
test("discriminated union spreads choose their physical variant after evaluating inputs", () => {
  const result = lower(
    'type Item={readonly kind:"a";readonly value:number;readonly label:string}|{readonly kind:"b";readonly value:number};function copy(item:Item):Item{return {...item,value:item.value+1};}function run():number{const a=copy({kind:"a",value:20,label:"x"}),b=copy({kind:"b",value:20});return a.value+b.value;}',
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});
test("union spread snapshots can carry different primitive and reference categories", () => {
  const result = lower(
    'type Item={readonly kind:"n";readonly value:number}|{readonly kind:"o";readonly value:{amount:number}}|{readonly kind:"none"};function copy(item:Item):Item{return {...item};}function run():number{const a=copy({kind:"n",value:20}),b=copy({kind:"o",value:{amount:22}}),c=copy({kind:"none"});if(a.kind!=="n"||b.kind!=="o"||c.kind!=="none")return -1;return a.value+b.value.amount;}',
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});
test("optional discriminants select the same union variant when absent", () => {
  const result = lower(
    'type Item={readonly kind?:"a";readonly a:number}|{readonly kind:"b";readonly b:number};function copy(item:Item):Item{return {...item};}function run():number{const x=copy({a:20}),y=copy({kind:"b",b:22});if(x.kind==="b"||y.kind!=="b")return -1;return x.a+y.b;}',
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("string unions containing a widened string retain the native string representation", () => {
  const result = lower(
    'function choose(tag:string|"a"):number{switch(tag){case "a":return 42;default:return 0;}}function run():number{return choose("a");}',
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("optional typed-array fields retain nullable references and presence", () => {
  const result = lower(`interface Input {readonly data?:Uint8Array|undefined}
    function make(data:Uint8Array):Input{return {data};}
    function absent():Input{return {};}
    function explicit():Input{return {data:undefined};}
    function size(input:Input):number{const data=input.data;return data===undefined?0:data.length;}`);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
  assert.ok(
    result.value.module.records?.some((record) =>
      record.fields.some(
        (field) =>
          field.type === "optional-reference" &&
          field.presenceOffset !== undefined,
      ),
    ),
  );
});

test("exact optional typed-array fields lower without allowing explicit undefined", () => {
  const result = lower(`interface Input {readonly data?:Uint8Array}
    function make(data:Uint8Array):Input{return {data};}
    function absent():Input{return {};}
    function size(input:Input):number{const data=input.data;return data===undefined?0:data.length;}`);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("optional typed-array fallback restores the concrete array encoding", () => {
  const result = lower(`interface Input {readonly data?:Uint8Array|undefined}
    function select(input:Input):Uint8Array{return input.data??new Uint8Array(0);}
    function size(input:Input):number{const data=input.data??new Uint8Array(0);return data.length;}`);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("lowering indexes reference bindings once for all function entries", () => {
  const text =
    "const BASE=7; function add(x:number):number{return x+BASE;}" +
    Array.from(
      { length: 40 },
      (_, i) =>
        `function f${i}(x:number):number{let y=x+BASE;y+=add(x);return y;}`,
    ).join("");
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  let visits = 0,
    bindingVisits = 0;
  const bindings = new Proxy(checked.value.bindings.bindings, {
    get(array, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) bindingVisits++;
      return Reflect.get(array, key, receiver);
    },
  });
  const references = new Proxy(checked.value.bindings.references, {
    get(array, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) visits++;
      return Reflect.get(array, key, receiver);
    },
  });
  const input = {
    ...checked.value,
    bindings: { ...checked.value.bindings, references, bindings },
  };
  const output = lowerModuleEntries(
    input,
    input.bindings.functions.map((f) => f.id),
    target,
    4096,
  );
  assert.ok(output.ok, JSON.stringify(output));
  assert.ok(verify(output.value.module).ok);
  const baseline = lowerModuleEntries(
    checked.value,
    input.bindings.functions.map((f) => f.id),
    target,
    4096,
  );
  assert.deepEqual(output, baseline);
  assert.ok(
    bindingVisits <= bindings.length * 12,
    `${bindingVisits} binding reads for ${bindings.length} bindings`,
  );
  assert.ok(
    visits <= references.length * 3,
    `${visits} reference reads for ${references.length} references`,
  );
});

test("repeated property accesses reuse the compatible receiver shapes", () => {
  const declarations = Array.from(
    { length: 100 },
    (_, i) => `interface Unrelated${i} { readonly field${i}: number; }`,
  ).join("\n");
  const bytes = new TextEncoder().encode(`${declarations}
    interface Pair { value: number; }
    interface Wide { extra: number; value: number; }
    function read(p: Pair): number { return p.value; }
    function wide(): Wide { return {extra: 1, value: 2}; }
  `);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  let reads = 0;
  const types = new Proxy(checked.value.types, {
    get(array, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      return Reflect.get(array, key, receiver);
    },
  });
  const contracts = createRecordContracts(
    { ...checked.value, types },
    target,
    4096,
    (message) => {
      throw Error(message);
    },
  );
  const members: (import("@tint/typescript/syntax").Expression & {
    kind: "member";
  })[] = [];
  checked.value.expressions.forEach((_, node) => {
    if (node.kind === "member") members.push(node);
  });
  assert.equal(members.length, 1);
  const member = members[0]!;
  reads = 0;
  contracts.access(member, member.object, "value", "number", false);
  const initialReads = reads;
  const expected = contracts.accesses.get(member);
  assert.ok(expected && expected.choices.length >= 2);
  reads = 0;
  for (let i = 0; i < 100; i++) {
    const node = { ...member, start: member.start + i + 10000 };
    contracts.access(node, member.object, "value", "number", false);
    assert.deepEqual(contracts.accesses.get(node), expected);
  }
  assert.ok(
    reads < initialReads * 2,
    `${reads} repeat type reads vs ${initialReads} initial reads`,
  );
});

test("record contracts reuse the caller's validated type relations", async () => {
  const { createTypeSystem } = await import("@tint/typescript/types");
  const bytes = new TextEncoder().encode(
    "function run(n:number):number{return n;}",
  );
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok);
  const system = createTypeSystem(checked.value.types);
  assert.ok(system.ok);
  let reads = 0;
  const types = new Proxy(checked.value.types, {
    get(array, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      return Reflect.get(array, key, receiver);
    },
  });
  createRecordContracts(
    { ...checked.value, types },
    target,
    4096,
    (message) => {
      throw Error(message);
    },
    [],
    [],
    [],
    system.value,
  );
  assert.equal(
    reads,
    0,
    "already validated immutable types must not be copied again",
  );
});

test("dense direct-call and capture IDs do not use linear numeric maps", () => {
  const text = Array.from(
    { length: 120 },
    (_, i) =>
      `function f${i}():number{return ${i === 0 ? "0" : `f${i - 1}()+1`};}`,
  ).join("\n");
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok);
  let functionReads = 0;
  const functions = new Proxy(checked.value.bindings.functions, {
    get(array, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) functionReads++;
      return Reflect.get(array, key, receiver);
    },
  });
  const input = {
    ...checked.value,
    bindings: { ...checked.value.bindings, functions },
  };
  const original = Map.prototype.get,
    originalHas = Set.prototype.has;
  let work = 0;
  Map.prototype.get = function <K, V>(this: Map<K, V>, key: K): V | undefined {
    const result = original.call(this, key);
    if (
      typeof key === "number" &&
      (typeof result === "number" ||
        (result !== null &&
          typeof result === "object" &&
          "parameters" in result &&
          "body" in result))
    )
      work += this.size;
    return result;
  };
  Set.prototype.has = function <T>(this: Set<T>, value: T): boolean {
    if (typeof value === "number") work += this.size;
    return originalHas.call(this, value);
  };
  try {
    const output = lowerModuleEntries(
      input,
      checked.value.bindings.functions.map((f) => f.id),
      target,
      4096,
    );
    assert.ok(output.ok, JSON.stringify(output));
    assert.ok(verify(output.value.module).ok);
    for (let i = 1; i < 120; i++)
      assert.ok(
        output.value.module.functions[i]!.blocks.some((b) =>
          b.instructions.some(
            (op) => op.kind === "call" && op.target === i - 1,
          ),
        ),
      );
  } finally {
    Map.prototype.get = original;
    Set.prototype.has = originalHas;
  }
  assert.ok(work < 120 * 40, `numeric ID lookup work: ${work}`);
  assert.ok(functionReads < 120 * 30, `function graph reads: ${functionReads}`);
});

test("record layout IDs use dense lookup after shape discovery", () => {
  const text =
    Array.from(
      { length: 40 },
      (_, i) => `interface Wide${i}{value:number;extra${i}:number}`,
    ).join("\n") +
    "\ninterface Base{value:number} function read(p:Base):number{return p.value;}";
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok);
  const contracts = createRecordContracts(
    checked.value,
    target,
    4096,
    (message) => {
      throw Error(message);
    },
  );
  const members: (import("@tint/typescript/syntax").Expression & {
    kind: "member";
  })[] = [];
  checked.value.expressions.forEach((_, node) => {
    if (node.kind === "member") members.push(node);
  });
  const member = members[0]!;
  assert.ok(member);
  contracts.access(member, member.object, "value", "number", false);
  assert.ok(contracts.records.length >= 40);
  const original = Map.prototype.get;
  let work = 0;
  Map.prototype.get = function <K, V>(this: Map<K, V>, key: K): V | undefined {
    const result = original.call(this, key);
    if (typeof key === "number" && typeof result === "number")
      work += this.size;
    return result;
  };
  try {
    for (let i = 0; i < 20; i++)
      contracts.access(
        { ...member, start: member.start + 10000 + i },
        member.object,
        "value",
        "number",
        false,
      );
  } finally {
    Map.prototype.get = original;
  }
  assert.equal(work, 0);
});

test("collection encoding is computed once before runtime-binding membership lookup", () => {
  const text =
    Array.from(
      { length: 50 },
      (_, i) => `interface Extra${i}{extra${i}:number}`,
    ).join("\n") +
    "\ninterface A{a:number} interface B{b:number} function f(value:A|B,items:(A|B|undefined)[]):void{}";
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok);
  const array = checked.value.types.findIndex(
    (t) =>
      t.kind === "array" && checked.value.types[t.element]?.kind === "union",
  );
  assert.ok(array >= 0);
  const element = arrayElement(checked.value, array);
  assert.notEqual(element, undefined);
  const encodings = checked.value.types.flatMap((t, id) =>
    t.kind === "object" && t.properties[0]?.name.startsWith("extra")
      ? [id]
      : [],
  );
  assert.ok(encodings.length >= 50);
  let reads = 0;
  const types = new Proxy(checked.value.types, {
    get(array, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      return Reflect.get(array, key, receiver);
    },
  });
  const input = { ...checked.value, types };
  arrayElement(input, array);
  const once = reads;
  reads = 0;
  assert.equal(entryType(input, array, [...encodings, element!]), "reference");
  assert.ok(
    reads < once * 4,
    `${reads} reads vs ${once} for one classification`,
  );
});

test("unbound recursive collections are rejected without traversing their elements", () => {
  const text =
    "interface Node {children?:(Node|string)[]} function f(nodes:(Node|string)[]):void{}";
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok);
  const array = checked.value.types.findIndex((t) => t.kind === "array");
  assert.ok(array >= 0);
  assert.equal(entryType(checked.value, array), undefined);
});

test("record dispatch excludes unrelated property shapes before structural comparison", async () => {
  const { createTypeSystem } = await import("@tint/typescript/types");
  const text =
    Array.from(
      { length: 100 },
      (_, i) => `interface Extra${i}{field${i}:number}`,
    ).join("\n") +
    `\ninterface A{value:number} interface B{value:number;extra:number} function f(x:A|B):number{return x.value;}`;
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok);
  const system = createTypeSystem(checked.value.types);
  assert.ok(system.ok);
  let queries = 0;
  const relations = {
    ...system.value,
    assignable: (a: number, b: number) => {
      queries++;
      return system.value.assignable(a, b);
    },
  };
  const contracts = createRecordContracts(
    checked.value,
    target,
    4096,
    (message) => {
      throw Error(message);
    },
    [],
    [],
    [],
    relations,
  );
  checked.value.expressions.forEach((_, node) => {
    if (node.kind === "member")
      contracts.access(node, node.object, "value", "number", false);
  });
  assert.ok(queries < 20, `structural candidate queries: ${queries}`);
  const baseline = lowerModuleEntries(
    checked.value,
    checked.value.bindings.functions.map((f) => f.id),
    target,
    4096,
  );
  assert.ok(baseline.ok, JSON.stringify(baseline));
  assert.ok(verify(baseline.value.module).ok);
});

test("quoted record keys share identifier-keyed native layouts", () => {
  const result = lower(
    'function make():{value:number}{return {"value":42};} function read():number{return make().value;}',
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("escaping classic-for closures lower with per-iteration cells", () => {
  const result = lower(`function run():number {
    let first:()=>number=()=>-1;
    let second:()=>number=()=>-1;
    for(let i=0;i<2;i++) {
      if(i===0)first=()=>i;else second=()=>i;
    }
    return first()*10+second();
  }`);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("ordinary anonymous functions use contextual signatures and captured cells", () => {
  const result = lower(`function run():number {
    let value=1;
    const increment:(n:number)=>number=function(n){value+=n;return value;};
    return increment(41);
  }`);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("object methods receive contextual parameter contracts", () => {
  const result = lower(`interface Counter {add(n:number):number}
    function run():number {let value=1;const counter:Counter={add(n){value+=n;return value;}};return counter.add(41);}`);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("numeric logical assignments lower as conditional writes", () => {
  const result = lower(
    "function f(x:number,y:number):number {x ||= y; x &&= y+1; return x;}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("string and boolean logical assignments retain selected primitive values", () => {
  const result = lower(
    'function f():boolean {let text="";text ||= "value";text &&= "done";let flag=false;flag ||= true;flag &&= false;return text==="done"&&!flag;}',
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("optional numeric nullish assignment shares nullish control flow", () => {
  const result = lower(
    "function f(x:number|undefined):number {x ??= 42;return x;}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("nullish assignment preserves present false and empty-string carriers", () => {
  const result = lower(
    'function f(x:boolean|undefined,s:string|undefined):boolean {x ??= false;s ??= "";return !x && s==="";}',
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("string suffix tests reuse prefix comparison with bounded end positions", () => {
  const r = lower(
    'function suffix(s:string,p:string,n:number|undefined):boolean{return s.endsWith(p,n);} function run():boolean{return "abc".endsWith("bc");}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  assert.equal(
    r.value.module.functions
      .flatMap((f) => f.blocks.flatMap((b) => b.instructions))
      .filter((op) => op.kind === "string-starts-with").length,
    2,
  );
});

test("string indexOf shares search lowering with includes", () => {
  const r = lower(
    'function find(s:string,p:string,n:number|undefined):number{return s.indexOf(p,n);} function run():number{return "abc".indexOf("b");}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  assert.equal(
    r.value.module.functions
      .flatMap((f) => f.blocks.flatMap((b) => b.instructions))
      .filter((op) => op.kind === "string-starts-with").length,
    2,
  );
});

test("string lastIndexOf uses reverse search with optional positions", () => {
  const r = lower(
    'function find(s:string,p:string,n:number|undefined):number{return s.lastIndexOf(p,n);} function run():number{return "ababa".lastIndexOf("ba");}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
  assert.equal(
    r.value.module.functions
      .flatMap((f) => f.blocks.flatMap((b) => b.instructions))
      .filter((op) => op.kind === "string-starts-with").length,
    2,
  );
});

test("Number.isNaN accepts numeric, absent and nonnumeric checked values", () => {
  const r = lower(
    "function nan(n:number|undefined):boolean{return Number.isNaN(n);} function text(s:string):boolean{return Number.isNaN(s);} function flag(b:boolean):boolean{return Number.isNaN(b);} function run():boolean{return Number.isNaN(0/0)&&!Number.isNaN(undefined);}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("numeric record updates and compounds retain prefix/postfix value contracts", () => {
  const r = lower(
    "function run(box:{value:number}):number {const before=box.value++;const after=++box.value;box.value+=2;box.value*=3;return before+after+box.value;}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("logical record assignments support present primitive fields", () => {
  const r = lower(
    'function run(box:{number:number;text:string;flag:boolean}):number {box.number||=2;box.text&&="updated";box.flag||=true;return box.number;}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("nullish record assignments retain optional carriers until the presence check", () => {
  const r = lower(
    'function run(box:{n:number|undefined;text:string|undefined;flag:boolean|undefined}):number {const n=box.n??=2;box.text??="";box.flag??=false;return n;}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("literal bracket reads use checked record fields", () => {
  const r = lower(
    'interface Box {"quoted-key":number;42:number} function read(box:Box):number{return box["quoted-key"]+box[0x2a];}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("literal bracket assignments and updates share named property contracts", () => {
  const r = lower(
    'function run(box:{value:number;maybe:number|undefined}):number {box["value"]=1;box["value"]++;box["value"]+=2;box["value"]||=9;return box["maybe"]??=box["value"];}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("computed literal fields and methods retain finite record contracts", () => {
  const r = lower(
    'interface Box {["__proto__"]:number;["read"]():number} function run():number{const box:Box={["__proto__"]:40,["read"](){return 2;}};return box["__proto__"]+box["read"]();}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("singleton key types resolve record access without erasing key evaluation", () => {
  const r = lower(
    'function read(box:{value:number},key:"value"):number{return box[key];} function run(box:{value:number}):number{const key="value";box[key]+=1;return read(box,key);}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("string charAt and at lower UTF-16 access with distinct absent results", () => {
  const r = lower(
    'function char(s:string,n:number|undefined):string{return s.charAt(n);} function relative(s:string,n:number|undefined):string|undefined{return s.at(n);} function run():string{return "abc".charAt()+ ("abc".at(-1) ?? "");}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("string codePointAt returns an optional numeric Unicode code point", () => {
  const r = lower(
    'function point(s:string,n:number|undefined):number|undefined{return s.codePointAt(n);} function run():number{return "😀".codePointAt() ?? 0;}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("string substring clamps bounds and swaps reversed positions", () => {
  const r = lower(
    'function part(s:string,a:number|undefined,b:number|undefined):string{return s.substring(a,b);} function run():string{return "abcd".substring(3,1);}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("Math trunc, abs and sign lower through numeric primitives", () => {
  const r = lower(
    "function run(x:number):number{return Math.trunc(x)+Math.abs(x)+Math.sign(x);}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("numeric string bracket access returns an optional UTF-16 unit", () => {
  const r = lower(
    'function element(s:string|undefined,n:number):string|undefined{return s?.[n];} function run():string{return "abc"[1] ?? "";}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("string for-of yields code-point strings through ordinary loop control flow", () => {
  const r = lower(
    'function run(s:string):string{let result="";for(const part of s){if(part==="x")continue;if(part==="!")break;result+=part;}return result;}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("escaping string iteration closures retain per-iteration bindings", () => {
  const r = lower(
    'function run():string{let first:()=>string=()=>"";let i=0;for(const part of "😀b"){if(i===0)first=()=>part;i++;}return first();}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("Math imul uses exact low-word multiplication", () => {
  const r = lower(
    "function run(a:number,b:number):number{return Math.imul(a,b);}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("Math clz32 normalizes to uint32 before counting leading zeros", () => {
  const r = lower("function run(x:number):number{return Math.clz32(x);}");
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("Math round lowers nearest ties toward positive infinity", () => {
  const r = lower("function run(x:number):number{return Math.round(x);}");
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("Math sqrt preserves a numeric square-root operation in IR", () => {
  const r = lower("function run(x:number):number{return Math.sqrt(x);}");
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("standard numeric globals and constants retain local shadowing", () => {
  const r = lower(
    "function globals():number{return Infinity+NaN+Number.EPSILON+Number.MIN_VALUE+Number.MAX_VALUE+Number.MIN_SAFE_INTEGER+Math.PI+Math.E;} function shadow(NaN:number,Infinity:number,Number:{EPSILON:number},Math:{PI:number}):number{return NaN+Infinity+Number.EPSILON+Math.PI;}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("var redeclarations share storage without resetting existing values", () => {
  const r = lower(
    "function run(x:number):number{var x:number=2;var y:number=3;{var y:number;y+=4;}return x+y;}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});
test("optional var slots initialize before declaration and preserve captured storage", () => {
  const r = lower(
    "function run():number{const read:()=>number=()=>x??0;const before=read();var x:number|undefined=42;var x:number|undefined;return before+read();}",
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("void evaluates value-producing and void-returning operands before producing undefined", () => {
  const r = lower(
    'function effect():void{} function run():undefined{void 42;void effect();return void "text";}',
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(verify(r.value.module).ok);
});

test("string trimming lowers both ends and individual ends through string primitives", () => {
  const result = lower(
    "function clean(s:string):string{return s.trim()+s.trimStart()+s.trimEnd();}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("optional string method receivers share chain control flow and skip arguments", () => {
  const result = lower(
    "function clean(s:string|undefined,n:number):string|undefined{return s?.substring(n).trim();} function size(s:string|undefined):number|undefined{return s?.trim().length;}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("optional callbacks lower through managed indirect calls", () => {
  const result = lower(
    "function call(f:((n:number)=>number)|undefined,n:number):number|undefined{return f?.(n);} function discard(f:(()=>void)|undefined):void{f?.();}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("optional record method receivers preserve their function read in the chain", () => {
  const result = lower(
    "function call(o:{f:(n:number)=>number}|undefined,n:number):number|undefined{return o?.f(n);}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("optional typed-array receivers unwrap to their exact live element encoding", () => {
  for (const name of [
    "Uint8Array",
    "Uint16Array",
    "Uint32Array",
    "Float64Array",
  ]) {
    const result = lower(
      `function read(a:${name}|undefined):number|undefined{return a?.fill(42)?.[0];} function length(a:${name}|undefined):number|undefined{return a?.length;}`,
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.ok(verify(result.value.module).ok);
  }
});

test("string concat accepts zero or multiple string arguments and optional receivers", () => {
  const result = lower(
    'function f(s:string):string{return s.concat()+s.concat("a","b");} function optional(s:string|undefined):string|undefined{return s?.concat("a");}',
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("typed array at lowers integer normalization and relative offsets", () => {
  const result = lower(
    "function read(a:Uint8Array,n:number):number|undefined{return a.at(n);} function optional(a:Float64Array|undefined):number|undefined{return a?.at(-1);}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("string repeat lowers checked counts and preserves optional receivers", () => {
  const result = lower(
    "function repeat(s:string,n:number):string{return s.repeat(n);} function optional(s:string|undefined):string|undefined{return s?.repeat(2);}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
  assert.ok(
    result.value.module.functions.some((f) =>
      f.blocks.some((b) => b.terminator.kind === "throw"),
    ),
  );
});

test("typed-array reverse preserves the receiver and lowers in-place numeric swaps", () => {
  const result = lower(
    "function reverse(a:Uint32Array):Uint32Array{return a.reverse();} function optional(a:Float64Array|undefined):Float64Array|undefined{return a?.reverse();}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("string padding lowers optional lengths and fillers through shared string operations", () => {
  const result = lower(
    "function pad(s:string,n:number|undefined,f:string|undefined):string{return s.padStart(n,f).padEnd(20);} function absent(s:string|undefined):string|undefined{return s?.padStart();}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("typed-array fill accepts undefined bounds and preserves receiver type", () => {
  const result = lower(
    "function f(a:Uint32Array,b:number|undefined,e:number|undefined):Uint32Array{return a.fill(42,b,e);}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("singleton computed length reads preserve optional receivers", () => {
  const result = lower(
    'function f(a:Uint32Array,k:"length"):number{return a[k];} function g(a:string|undefined):number|undefined{return a?.["length"];}',
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("typed-array slice allocates an independent result with optional bounds", () => {
  const result = lower(
    "function f(a:Uint32Array,b:number|undefined,e:number|undefined):Uint32Array{return a.slice(b,e);} function optional(a:Uint8Array|undefined):Uint8Array|undefined{return a?.slice();}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("bare and implicit returns produce undefined in optional result encodings", () => {
  for (const [type, value] of [
    ["number", "3"],
    ["boolean", "false"],
    ["string", '"yes"'],
    ["{value:number}", "{value:3}"],
  ]) {
    for (const body of [
      `if(flag)return;return ${value};`,
      `if(flag)return ${value};`,
    ]) {
      const result = lower(
        `function run(flag:boolean):${type}|undefined{${body}}`,
      );
      assert.ok(result.ok, JSON.stringify(result));
      const verified = verify(result.value.module);
      assert.ok(verified.ok, JSON.stringify(verified));
    }
  }
});

test("typed string and boolean templates lower through rooted concatenation", () => {
  const result = lower(
    "function f(s:string,b:boolean):string{return `a${s}:${b}z`;}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(verify(result.value.module).ok);
});

test("managed lowering can preserve distinct semantic records with identical storage", () => {
  const text =
    'interface A{readonly tag:"a";readonly flag:boolean;}interface B{readonly tag:"b";readonly flag:boolean;}function read(a:A,b:B):boolean{return a.flag&&b.flag;}';
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok);
  const shared = lowerModuleEntries(checked.value, [0], target, 4096, {
    recordTypes: true,
  });
  assert.ok(shared.ok, JSON.stringify(shared));
  assert.equal(shared.value.module.records?.length, 1);
  const graph = checked.value,
    keys = new Map<number, number>();
  for (let id = 0; id < graph.types.length; id++) {
    const type = graph.types[id];
    if (type?.kind !== "object") continue;
    const property = type.properties.find(
      (property) => property?.name === "tag",
    );
    const tag = property === undefined ? undefined : graph.types[property.type];
    if (tag?.kind === "literal" && (tag.value === "a" || tag.value === "b"))
      keys.set(id, tag.value === "a" ? 1 : 2);
  }
  const privateRecords = lowerModuleEntries(graph, [0], target, 4096, {
    recordIdentity: () => ({ ok: true, value: undefined }),
  });
  assert.ok(privateRecords.ok);
  assert.equal(privateRecords.value.module.records?.length, 1);
  const distinct = lowerModuleEntries(graph, [0], target, 4096, {
    recordTypes: true,
    recordIdentity: (type: number) => ({ ok: true, value: keys.get(type) }),
  });
  assert.ok(distinct.ok, JSON.stringify(distinct));
  assert.equal(distinct.value.module.records?.length, 2);
  const a = checked.value.typeNames.get("A"),
    b = checked.value.typeNames.get("B");
  assert.ok(a !== undefined && b !== undefined);
  assert.notEqual(
    distinct.value.recordTypes?.[a],
    distinct.value.recordTypes?.[b],
  );
});
