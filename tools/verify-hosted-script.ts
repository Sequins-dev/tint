import assert from "node:assert/strict";
import { Script } from "node:vm";
import { createSourceText } from "@tint/source/text";
import { parseStrictScript, parseScript } from "@tint/typescript/syntax";
import { lowerStrictScript, lowerScript } from "@tint/js-engine/lowering";
import type { SourceModule } from "@tint/typescript/modules/model";
import { verifyHostedFixture } from "./hosted-fixture.ts";

// ECMA-262 13.3.7.1 captures GetSuperConstructor before ArgumentListEvaluation.
// Node 24.12 instead selects the changed parent in this case. Assert its observed
// reference result separately; the native expectation remains the specified 1.
const superConstructorLookupCase =
  "class A{constructor(){this.x=1;}}class Z{constructor(){this.x=99;}}class B extends A{constructor(){super(Object.setPrototypeOf(B,Z));}}new B().x;";
// EvaluateGeneratorBody instantiates declarations before selecting the instance
// prototype. Node 24.12 retains the previous prototype; Test262's
// generators/generator-created-after-decl-inst.js requires the updated one.
const generatorPrototypeLookupCase =
  "const p={};function*g(a=(g.prototype=p)){return a;}const i=g();Object.getPrototypeOf(i)===p;";
// Assignment evaluates its reference before the RHS (ECMA-262 13.15.2).
// Node 24.12 instead redirects this write after the RHS deletes the property.
const deletedWithBindingCase = "let o={x:19};with(o){x=(delete o.x,42);}o.x;";
const nodeReferenceValues = new Map<string, unknown>([
  [deletedWithBindingCase, undefined],
  [superConstructorLookupCase, 99],
  [generatorPrototypeLookupCase, false],
]);
const cases = [
  [
    "const source=[1,,3],seen=[];const result=source.map(function(value,index,array){seen.push(index);if(index===0){array[1]=2;array.push(4);}return value+10*index;});const sparse=[,2].map(x=>x*2);result.length===3&&result[0]===1&&result[1]===12&&result[2]===23&&seen.length===3&&sparse.length===2&&!(0 in sparse)&&sparse[1]===4;",
    "none",
    true,
  ],
  [
    "let log='';const out={};const source=[1,,3];source.constructor={[Symbol.species]:function(n){log+='s'+n;return out;}};const result=source.map((value,index)=>{log+='c'+index;return value*2;});result===out&&log==='s3c0c2'&&out[0]===2&&!(1 in out)&&out[2]===6;",
    "none",
    true,
  ],

  [
    "let log='';const receiver={toString(){log+='r';return 'aba';}},search={toString(){log+='s';return 'a';}},position={valueOf(){log+='p';return 1;}};const first=String.prototype.indexOf.call(receiver,search,position);const last=String.prototype.lastIndexOf.call(receiver,search,position);let caught=false;try{String.prototype.indexOf.call('abc',Symbol(),position);}catch(e){caught=e instanceof TypeError;}first===2&&last===0&&log==='rsprsp'&&caught&&'aba'.lastIndexOf('a',NaN)===2&&'aba'.lastIndexOf('a',-Infinity)===0&&'aba'.indexOf('',Infinity)===3;",
    "none",
    true,
  ],

  [
    "let log='';const receiver={toString(){log+='s';return 'A😀Z';}},start={valueOf(){log+='a';return 3;}},end={valueOf(){log+='b';return 1;}};const part=String.prototype.substring.call(receiver,start,end);let caught=0;for(const method of [String.prototype.substring,String.prototype.slice]){try{method.call(null,start,end);}catch(e){if(e instanceof TypeError)caught++;}try{method.call('abc',Symbol());}catch(e){if(e instanceof TypeError)caught++;}}part==='😀'&&log==='sab'&&caught===4&&'abcdef'.slice(-3,-1)==='de'&&'abc'.substring(Infinity,1)==='bc'&&'abc'.slice(1,undefined)==='bc';",
    "none",
    true,
  ],

  [
    "let log='';function f(){log+='f';return 1;}function rhs(){log+='r';return 2;}let caught=0;try{f()=rhs();}catch(e){if(e instanceof ReferenceError)caught++;}try{f()+=rhs();}catch(e){if(e instanceof ReferenceError)caught++;}try{f()++;}catch(e){if(e instanceof ReferenceError)caught++;}caught===3&&log==='fff';",
    "none",
    true,
    false,
  ],
  [
    "let closed=false,caught=false;function f(){return 1;}function* g(){try{yield 1;}finally{closed=true;}}try{for(f() of g()){}}catch(e){caught=e instanceof ReferenceError;}caught&&closed;",
    "none",
    true,
    false,
  ],

  [
    "let result;{result=f();function f(){return 42;}}result===42&&typeof f==='undefined';",
    "none",
    true,
  ],
  [
    "let result;switch(0){case 0:result=f();break;case 1:function f(){return 42;}}result===42&&typeof f==='undefined';",
    "none",
    true,
  ],
  ["let read;{function f(){return x;}read=f;let x=42;}read();", "none", 42],
  [
    "let caught=false;{try{f();}catch(e){caught=e instanceof ReferenceError;}function f(){return x;}let x=42;}caught;",
    "none",
    true,
  ],

  [
    "let log='';function init(){log+='i';return 19;}function source(){log+='s';return {a:1,b:2};}let n=0;for(var x=init() in source()){log+=x;n++;}var y;for(var y=23 in null){}log==='isab'&&n===2&&x==='b'&&y===23;",
    "none",
    true,
    false,
  ],

  [
    "let log='';const f=String.prototype.charCodeAt;const receiver={toString(){log+='s';return 'AZ';}},index={valueOf(){log+='i';return 1.9;}};const code=f.call(receiver,index);let errors=0;for(const value of [null,undefined,Symbol()]){try{f.call(value,index);}catch(e){if(e instanceof TypeError)errors++;}}const outside=f.call('A',Infinity);code===90&&log==='si'&&errors===3&&outside!==outside&&f.call(42,1)===50&&f.call('A',-0.9)===65&&f.call('A')===65;",
    "none",
    true,
  ],
  ["String.fromCharCode();", "none", ""],
  [
    "String.fromCharCode(65.9,-1,65536,0xd800,NaN,Infinity,-Infinity);",
    "none",
    "A\uFFFF\u0000\uD800\u0000\u0000\u0000",
  ],
  [
    "let log='';const a={valueOf(){log+='a';return 65;}},b={valueOf(){log+='b';throw 42;}},c={valueOf(){log+='c';return 66;}};try{String.fromCharCode(a,b,c);}catch(e){log+=e;}log;",
    "none",
    "ab42",
  ],
  [
    "let n=0;for(const x of [Symbol(),1n]){try{String.fromCharCode(x);}catch(e){if(e instanceof TypeError)n++;}}n;",
    "none",
    2,
  ],
  [
    "String.fromCodePoint(65,0x1f600,0xd800,0x10ffff);",
    "none",
    "A😀\uD800\uDBFF\uDFFF",
  ],
  ["String.fromCodePoint();", "none", ""],
  ["String.fromCodePoint(-0,null,true,'66');", "none", "\u0000\u0000\u0001B"],
  [
    "let n=0;for(const x of [-1,0x110000,0.5,NaN,Infinity,-Infinity,undefined]){try{String.fromCodePoint(x);}catch(e){if(e instanceof RangeError)n++;}}n;",
    "none",
    7,
  ],
  [
    "let n=0;for(const x of [Symbol(),1n]){try{String.fromCodePoint(x);}catch(e){if(e instanceof TypeError)n++;}}n;",
    "none",
    2,
  ],
  [
    "let log='';const a={valueOf(){log+='a';return 65;}},b={valueOf(){log+='b';return -1;}},c={valueOf(){log+='c';return 66;}};try{String.fromCodePoint(a,b,c);}catch(e){}log;",
    "none",
    "ab",
  ],
  [
    "let token={};let ok=false;try{String.fromCodePoint({valueOf(){throw token;}});}catch(e){ok=e===token;}ok;",
    "none",
    true,
  ],

  ["function f(){for(const x of []){}const y=42;return y;}f();", "none", 42],
  ["let x=19;with({x:42}){x;}", "none", 42, false],
  [
    "let x=19;with({x:42,[Symbol.unscopables]:{x:true}}){x;}",
    "none",
    19,
    false,
  ],
  ["const o={x:42,f(){return this.x;}};with(o){(f)();}", "none", 42, false],
  [deletedWithBindingCase, "none", 42, false],
  ["let f;with({x:42}){f=()=>x;}f();", "none", 42, false],
  [
    "function*g(){with({x:42}){yield x;return x;}}let i=g();i.next().value+i.next().value;",
    "none",
    84,
    false,
  ],
  ["let x=42;with({x:19}){let x=1;}x;", "none", 42, false],
  ["with('abc'){length;}", "none", 3, false],
  ["with(null){}", "type", undefined, false],
  ["19;with({}){}", "none", undefined, false],
  ["with({x:19}){var x=42;}x;", "none", undefined, false],

  [
    "let g=this,d=Object.getOwnPropertyDescriptor(g,'globalThis');let ok=globalThis===g&&d.writable&&d.configurable&&!d.enumerable;globalThis=19;ok&&this===g&&globalThis===19&&delete g.globalThis&&typeof globalThis==='undefined';",
    "none",
    true,
  ],

  [
    "let e=new AggregateError([1,2],'bad',{cause:42});e instanceof AggregateError&&e instanceof Error&&e.name==='AggregateError'&&e.message==='bad'&&e.cause===42&&e.errors.join(',')==='1,2';",
    "none",
    true,
  ],
  ["let a=[1],e=AggregateError(a);a.push(2);e.errors.length;", "none", 1],
  [
    "let d=Object.getOwnPropertyDescriptor(new AggregateError([]),'errors');d.writable&&d.configurable&&!d.enumerable;",
    "none",
    true,
  ],
  [
    "let s='';let message={toString(){s+='m';return 'bad';}},options={get cause(){s+='c';return 42;}},input={get [Symbol.iterator](){s+='i';return function(){return [1][Symbol.iterator]();};}};new AggregateError(input,message,options);s;",
    "none",
    "mci",
  ],
  ["try{new AggregateError();}catch(e){e instanceof TypeError;}", "none", true],
  [
    "let n=0,i={[Symbol.iterator](){return this;},next(){throw 42;},return(){n++;return {};}};try{new AggregateError(i);}catch(e){if(e!==42)throw e;}n;",
    "none",
    0,
  ],

  [
    "Object.getOwnPropertyNames(Promise.resolve).join(',');",
    "none",
    "length,name",
  ],
  ["[1,2,3].filter(x=>x>1).join(',');", "none", "2,3"],
  [
    "let a=[1,,3],seen='';let b=a.filter((x,i,o)=>{seen+=i;if(i===0){a[1]=2;a.push(4);}if(o!==a)throw 1;return x>1;});seen+':'+b.join(',');",
    "none",
    "012:2,3",
  ],
  [
    "class A extends Array{};let a=new A(1,2,3);let b=a.filter(x=>x>1);b instanceof A&&b.join(',')==='2,3';",
    "none",
    true,
  ],
  [
    "let n=-1;function C(length){n=length;}let a=[1,2,3];a.constructor={[Symbol.species]:C};let b=a.filter(x=>x>1);b instanceof C&&n===0&&b[0]===2&&b[1]===3&&!('length' in b);",
    "none",
    true,
  ],
  [
    "let o={0:42,length:1,get constructor(){throw 1;}};Array.prototype.filter.call(o,()=>true)[0];",
    "none",
    42,
  ],
  [
    "let a=[42];a.constructor={[Symbol.species]:null};let b=a.filter(()=>true);Object.getPrototypeOf(b)===Array.prototype;",
    "none",
    true,
  ],
  [
    "let a=[42];a.constructor={[Symbol.species]:()=>{}};try{a.filter(()=>true);}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "let n=0,a=[42];Object.defineProperty(a,'constructor',{get(){n++;throw 1;}});try{a.filter(null);}catch(e){if(!(e instanceof TypeError))throw e;}n;",
    "none",
    0,
  ],
  [
    "let n=0;function C(){return Object.preventExtensions({});}let a=[42];a.constructor={[Symbol.species]:C};try{a.filter(()=>{n++;return true;});}catch(e){if(!(e instanceof TypeError))throw e;}n;",
    "none",
    1,
  ],

  ["function f(a,b){return this.x+a+b;}f.apply({x:1},[20,21]);", "none", 42],
  [
    "function f(){return arguments.length;}f.apply(null,null)+f.apply(null,undefined);",
    "none",
    0,
  ],
  [
    "let n=0;function f(a,b){return a===42&&b===undefined;}let o={length:2,get 0(){n++;return 42;}};f.apply(null,o)&&n===1;",
    "none",
    true,
  ],
  [
    "let n=0;try{Function.prototype.apply.call({},null,{get length(){n++;return 0;}});}catch(e){if(!(e instanceof TypeError))throw e;}n;",
    "none",
    0,
  ],
  [
    "try{(function(){}).apply(null,'abc');}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "let p={0:42},o=Object.create(p);o.length=1;(function(x){return x;}).apply(null,o);",
    "none",
    42,
  ],

  ["let n=0;[1,2,3].forEach(x=>n+=x);n;", "none", 6],
  [
    "let a=[1,,3],s='';a.forEach((v,i,o)=>{s+=i+':'+v+';';if(i===0){a[1]=2;a.push(4);}if(o!==a)throw 1;});s;",
    "none",
    "0:1;1:2;2:3;",
  ],
  ["let a=[1,2,3],s='';a.forEach((v,i)=>{s+=v;delete a[1];});s;", "none", "13"],
  [
    "let n=0,p={1:42},o=Object.create(p);o.length=3;Array.prototype.forEach.call(o,(v,i)=>n=v+i);n;",
    "none",
    43,
  ],
  [
    "let seen;[42].forEach(function(v){seen=this.x+v;},{x:1});seen;",
    "none",
    43,
  ],
  [
    "let s='';Array.prototype.forEach.call('ab',(v,i,o)=>{s+=v+i;if(typeof o!=='object')throw 1;});s;",
    "none",
    "a0b1",
  ],
  [
    "let n=0;try{Array.prototype.forEach.call({get length(){n++;return 0;}},null);}catch(e){if(!(e instanceof TypeError))throw e;}n;",
    "none",
    1,
  ],

  ["typeof Promise;", "none", "function"],
  [
    "Promise.length===1&&Promise.name==='Promise'&&Promise.prototype.constructor===Promise;",
    "none",
    true,
  ],
  ["Promise.resolve(42) instanceof Promise;", "none", true],
  ["let p=Promise.resolve(42);Promise.resolve(p)===p;", "none", true],
  [
    "let p=Promise.reject(42);p.catch(()=>{});Promise.resolve(p)===p;",
    "none",
    true,
  ],
  ["let n=0;new Promise(resolve=>{n++;resolve(42);});n;", "none", 1],
  ["let n=0;new Promise(resolve=>resolve(42)).then(()=>n++);n;", "none", 0],
  ["try{Promise(()=>{});}catch(e){e instanceof TypeError;}", "none", true],
  ["try{new Promise(42);}catch(e){e instanceof TypeError;}", "none", true],
  [
    "try{Promise.prototype.then.call({});}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "let f=()=>42;Promise.prototype.catch.call({then(a,b){return a===undefined&&b===f;}},f);",
    "none",
    true,
  ],
  [
    "class P extends Promise{};let p=P.resolve(42);p instanceof P&&p.then() instanceof P;",
    "none",
    true,
  ],
  [
    "let p=Promise.resolve(42);p.constructor={[Symbol.species]:null};p.then() instanceof Promise;",
    "none",
    true,
  ],
  [
    "let p=Promise.resolve(42);p.constructor={[Symbol.species]:()=>{}};try{p.then();}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  ["Promise[Symbol.species]===Promise;", "none", true],

  ["42 instanceof {[Symbol.hasInstance](x){return x===42;}};", "none", true],
  [
    "class C{static [Symbol.hasInstance](x){return x===42;}}42 instanceof C;",
    "none",
    true,
  ],
  [
    "let n=0,o={get [Symbol.hasInstance](){n++;return function(x){return this===o&&x===42;};}};let ok=42 instanceof o;ok&&n===1;",
    "none",
    true,
  ],
  ["42 instanceof {[Symbol.hasInstance](){return {};}};", "none", true],
  ["42 instanceof {[Symbol.hasInstance](){return 0;}};", "none", false],
  [
    "try{42 instanceof {[Symbol.hasInstance]:1};}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  ["Function.prototype[Symbol.hasInstance].call({},42);", "none", false],
  [
    "function C(){};Object.defineProperty(C,Symbol.hasInstance,{value:null});new C() instanceof C;",
    "none",
    true,
  ],
  [
    "function C(){};Object.defineProperty(C,Symbol.hasInstance,{value(x){return x===42;}});let B=C.bind(null);42 instanceof B;",
    "none",
    true,
  ],
  [
    "function C(){};C.prototype=1;try{({}) instanceof C;}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  ["const [x=20,...r]=[undefined,22];x+r[0];", "none", 42],
  ["let [[x],{a:[y]}]=[[20],{a:[22]}];x+y;", "none", 42],
  ["function f([x=42]=[]){return x;}f();", "none", 42],
  ["function f(...[x,y]){return x+y;}f(20,22);", "none", 42],
  ["let n;try{throw [42];}catch([x]){n=x;}n;", "none", 42],
  [
    "let n=0;for(const [[x],{y=1}] of [[[20],{}],[[20],{}]])n+=x+y;n;",
    "none",
    42,
  ],
  ["let n=0;for(let [x]=[0];x<3;x++)n+=x;n;", "none", 3],
  ["let n;const [...[x,y]]=[20,22];n=x+y;n;", "none", 42],
  [
    "let ok=false;try{let [x=x]=[];}catch(e){ok=e instanceof ReferenceError;}ok;",
    "none",
    true,
  ],
  ["let x,r;[x=20,...r]=[undefined,22];x+r[0];", "none", 42],
  ["let x;[[x]]= [[42]];x;", "none", 42],
  ["let x;({a:[x]}={a:[42]});x;", "none", 42],
  ["let x;[...[x]]=[42];x;", "none", 42],
  ["let x,n=0;for([x] of [[20],[22]])n+=x;n;", "none", 42],
  [
    "let trace='',o={};function target(){trace+='t';return o;}let it={[Symbol.iterator](){return {next(){trace+='n';return {value:42,done:false};},return(){trace+='r';return {};}};}};[target().x]=it;trace;",
    "none",
    "tnr",
  ],
  [
    "let n=0,x;let it={[Symbol.iterator](){return {next(){throw 1;},return(){n++;return {};}};}};try{[x]=it;}catch(e){}n;",
    "none",
    0,
  ],
  [
    "let n=0;const x=1;let it={[Symbol.iterator](){return {next(){return {value:42,done:false};},return(){n++;return {};}};}};try{[x]=it;}catch(e){}n;",
    "none",
    1,
  ],
  ["function f(a,b,c){return a+b+c;}f(10,...[11,21]);", "none", 42],
  ["let o={x:40,f(a,b){return this.x+a+b;}};o.f(...[1,1]);", "none", 42],
  ["class C{constructor(a,b){this.x=a+b;}}new C(...[20,22]).x;", "none", 42],
  [
    "class B{constructor(a,b){this.x=a+b;}}class C extends B{constructor(...args){super(...args);}}new C(20,22).x;",
    "none",
    42,
  ],
  ["let n=0;null?.f(...{[Symbol.iterator](){n++;return {};}});n;", "none", 0],
  [
    "let a=[1,...[2,3],,5,,];a.length===6&&a[2]===3&&!(3 in a)&&!(5 in a);",
    "none",
    true,
  ],
  ["[...'a😀b'].length;", "none", 3],
  [
    "let i=0,o={[Symbol.iterator](){return {next(){return {value:++i,done:i>2};}};}};let a=[0,...o,39];a[1]+a[2]+a[3];",
    "none",
    42,
  ],
  [
    "let closed=0,o={[Symbol.iterator](){return {next(){throw 1;},return(){closed++;return {};}};}};try{[...o];}catch(e){}closed;",
    "none",
    0,
  ],
  ["class S extends Symbol{};Object.getPrototypeOf(S)===Symbol;", "none", true],
  [
    "class S extends Symbol{};try{new S();}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "class S extends Symbol{constructor(){return {x:42};}}new S().x;",
    "none",
    42,
  ],
  [
    "let called=false;try{new Symbol({toString(){called=true;return 'x';}});}catch(e){}called;",
    "none",
    false,
  ],
  [
    "let n=0;for(const [x,...rest] of [[10,11,21]])n=x+rest[0]+rest[1];n;",
    "none",
    42,
  ],
  ["for(var [...rest] of [[]]){}rest.length;", "none", 0],
  ["let n=0;for(const [x=42,...rest] of [[]])n=x+rest.length;n;", "none", 42],
  [
    "let calls=0,closed=0;let o={[Symbol.iterator](){return {next(){return {value:++calls,done:calls>2};},return(){closed++;return {};}};}};let n;for(const [...rest] of [o])n=rest.length;n*100+calls*10+closed;",
    "none",
    230,
  ],
  [
    "let closed=0;let o={[Symbol.iterator](){return {next(){throw 1;},return(){closed++;return {};}};}};try{for(const [...rest] of [o]){}}catch(e){}closed;",
    "none",
    0,
  ],
  ["let n=0;for(const [x=21,y=x] of [[]])n=x+y;n;", "none", 42],
  ["let n=0;for(let [x=(n++,42)] of [[null],[1],[]]){}n;", "none", 1],
  [
    "let ok=false;try{for(const [x=x] of [[]]){}}catch(e){ok=e instanceof ReferenceError;}ok;",
    "none",
    true,
  ],
  [
    "let closed=0;let o={[Symbol.iterator](){return {next(){return {value:undefined,done:false};},return(){closed++;return {};}};}};function bad(){throw 1;}try{for(const [x=bad()] of [o]){}}catch(e){}closed;",
    "none",
    1,
  ],
  ["let n=0;for(const [x,y] of [[10,11],[20,1]])n+=x+y;n;", "none", 42],
  [
    "let a=[];for(let [x] of [[1],[2]])a.push(()=>x);a[0]()*10+a[1]();",
    "none",
    12,
  ],
  ["for(var [x,y] of [[42]]){}x===42&&y===undefined;", "none", true],
  [
    "let calls=0,closed=0;let o={[Symbol.iterator](){return {next(){calls++;return {get value(){throw 1;},done:false};},return(){closed++;return {};}};}};for(const [,] of [o]){}calls*10+closed;",
    "none",
    11,
  ],
  [
    "let calls=0,closed=0;let o={[Symbol.iterator](){return {next(){calls++;return {};},return(){closed++;return {};}};}};for(const [] of [o]){}calls*10+closed;",
    "none",
    1,
  ],
  [
    "let closed=0;let inner={[Symbol.iterator](){return {next(){throw 1;},return(){closed+=10;return {};}};}};let outer={[Symbol.iterator](){return {next(){return {value:inner,done:false};},return(){closed++;return {};}};}};try{for(const [x] of outer){}}catch(e){}closed;",
    "none",
    1,
  ],
  ["let x;for(x of [1,42]){}x;", "none", 42],
  ["let x;for({x=42} of [{}]){}x;", "none", 42],
  [
    "let o={},n=0;function target(){n++;return o;}for(target().x of [1,2]){}n*10+o.x;",
    "none",
    22,
  ],
  [
    "let closed=0;let o={[Symbol.iterator](){return {next(){return {value:42,done:false};},return(){closed++;return {};}};}};const x=1;try{for(x of o){}}catch(e){}closed;",
    "none",
    1,
  ],
  ["let n=0;for(const x of [10,32])n+=x;n;", "none", 42],
  ["let s='';for(const c of 'a😀b')s+=c;s;", "none", "a😀b"],
  ["let n=0;for(let {x=21} of [{},{}])n+=x;n;", "none", 42],
  ["for(var x of [1,42]){}x;", "none", 42],
  ["let a=[];for(let x of [1,2])a.push(()=>x);a[0]()*10+a[1]();", "none", 12],
  [
    "let x=[42];try{for(let x of x){}}catch(e){e instanceof ReferenceError;}",
    "none",
    true,
  ],
  [
    "let closed=0;let o={[Symbol.iterator](){return {next(){return {value:42,done:false};},return(){closed++;return {};}};}};for(const x of o){break;}closed;",
    "none",
    1,
  ],
  [
    "let closed=0,n=0;let o={[Symbol.iterator](){return {next(){return {value:++n,done:n>2};},return(){closed++;return {};}};}};for(const x of o){continue;}closed;",
    "none",
    0,
  ],
  [
    "let closed=0;let o={[Symbol.iterator](){return {next(){return {value:42};},return(){closed++;return {};}};}};function f(){for(const x of o)return x;}f()+closed;",
    "none",
    43,
  ],
  [
    "let o={[Symbol.iterator](){return {next(){return {value:1};},return(){throw 2;}};}};try{for(const x of o){throw 42;}}catch(e){e;}",
    "none",
    42,
  ],
  [
    "let o={[Symbol.iterator](){return {next(){return {value:1};},return(){throw 42;}};}};try{for(const x of o){break;}}catch(e){e;}",
    "none",
    42,
  ],
  [
    "let closed=0,o={[Symbol.iterator](){return {next(){throw 42;},return(){closed++;return {};}};}};try{for(const x of o){}}catch{}closed;",
    "none",
    0,
  ],
  [
    "let closed=0,o={[Symbol.iterator](){return {next(){return {get value(){throw 42;}};},return(){closed++;return {};}};}};try{for(const x of o){}}catch{}closed;",
    "none",
    0,
  ],
  [
    "let closed=0,o={[Symbol.iterator](){return {next(){return {value:null};},return(){closed++;return {};}};}};try{for(const {x} of o){}}catch{}closed;",
    "none",
    1,
  ],
  [
    "let closed=0,o={[Symbol.iterator](){return {next(){return {value:1};},return(){closed++;return {};}};}};for(const x of o){while(true){break;}break;}closed;",
    "none",
    1,
  ],

  [
    "let it=[42].values();let a=it.next();a.value===42&&!a.done&&it.next().done&&it.next().value===undefined;",
    "none",
    true,
  ],
  ["Array.prototype.values===Array.prototype[Symbol.iterator];", "none", true],
  ["let it=[].values();it[Symbol.iterator]()===it;", "none", true],
  [
    "let it=[,42].values();let a=it.next();a.value===undefined&&!a.done&&it.next().value===42;",
    "none",
    true,
  ],
  ["let a=[1],it=a.values();it.next();a.push(42);it.next().value;", "none", 42],
  [
    "let a=[1],it=a.values();a.length=0;it.next();a.push(42);it.next().done;",
    "none",
    true,
  ],
  [
    "let a={0:42,length:1};Array.prototype.values.call(a).next().value;",
    "none",
    42,
  ],
  [
    "let n=0,a={get 0(){n++;},length:1};Array.prototype.keys.call(a).next().value===0&&n===0;",
    "none",
    true,
  ],
  [
    "let entry=[42].entries().next().value;entry[0]===0&&entry[1]===42&&entry.length===2;",
    "none",
    true,
  ],
  [
    "let a={get 0(){throw 1;},1:42,length:2};let it=Array.prototype.values.call(a);try{it.next();}catch{}it.next().value;",
    "none",
    42,
  ],
  [
    "let n=0,a={get length(){if(n++===0)throw 1;return 1;},0:42};let it=Array.prototype.values.call(a);try{it.next();}catch{}it.next().value;",
    "none",
    42,
  ],
  [
    "let it='a😀b'[Symbol.iterator]();it.next().value+it.next().value+it.next().value;",
    "none",
    "a😀b",
  ],
  [
    "let it='😀'[Symbol.iterator]();it.next().value.length===2&&it.next().done&&it.next().done;",
    "none",
    true,
  ],
  [
    "let it=String.prototype[Symbol.iterator].call(42);it.next().value+it.next().value;",
    "none",
    "42",
  ],
  [
    "try{[].values().next.call({});}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "try{''[Symbol.iterator]().next.call({});}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "Object.prototype.toString.call([].values());",
    "none",
    "[object Array Iterator]",
  ],
  [
    "Object.prototype.toString.call(''[Symbol.iterator]());",
    "none",
    "[object String Iterator]",
  ],
  [
    "function f(){return arguments[Symbol.iterator]===Array.prototype.values&&arguments[Symbol.iterator]().next().value===42;}f(42);",
    "none",
    true,
  ],

  ["Object.prototype.toString.call(Symbol());", "none", "[object Symbol]"],
  [
    "Object.prototype.toString.call({[Symbol.toStringTag]:'Custom'});",
    "none",
    "[object Custom]",
  ],
  [
    "Object.prototype.toString.call({[Symbol.toStringTag]:42});",
    "none",
    "[object Object]",
  ],
  [
    "let n=0;let o={get [Symbol.toStringTag](){n++;return 'Custom';}};Object.prototype.toString.call(o);n;",
    "none",
    1,
  ],

  ["let s=Symbol();s==Object(s);", "none", true],
  ["let s=Symbol();Object(s)==s;", "none", true],
  ["let s=Symbol();s=={[Symbol.toPrimitive](){return s;}};", "none", true],
  ["Symbol()==0;", "none", false],

  [
    "let s=Symbol('x');let o={[Symbol.toPrimitive](hint){return s;}};let target={};target[o]=42;target[s];",
    "none",
    42,
  ],
  [
    "let hints='';let o={[Symbol.toPrimitive](hint){hints+=hint+',';return 1;}};+o;''+o;String(o);hints;",
    "none",
    "number,default,string,",
  ],
  [
    "try{String(Object(Symbol('x')));}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "try{+{[Symbol.toPrimitive](){return {};}};}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "try{+{[Symbol.toPrimitive]:42};}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  ["let s=Symbol('x');({[s](){}})[s].name;", "none", "[x]"],
  ["let s=Symbol('x');class C{[s](){return 42;}}new C()[s]();", "none", 42],

  ["typeof Symbol();", "none", "symbol"],
  ["Symbol('x')===Symbol('x');", "none", false],
  ["Symbol.for('x')===Symbol.for('x');", "none", true],
  ["Symbol.keyFor(Symbol.for('x'));", "none", "x"],
  ["Symbol.keyFor(Symbol('x'));", "none", undefined],
  ["Symbol('x').description;", "none", "x"],
  ["Symbol().description;", "none", undefined],
  ["Symbol('').description;", "none", ""],
  ["String(Symbol('x'));", "none", "Symbol(x)"],
  ["Symbol('x').toString();", "none", "Symbol(x)"],
  ["let s=Symbol('x');Object(s).valueOf()===s;", "none", true],
  ["let s=Symbol();let o={[s]:42};o[s];", "none", 42],
  ["let s=Symbol();let o={[s]:42};s in o;", "none", true],
  [
    "let s=Symbol();let o={[s]:42};Object.getOwnPropertySymbols(o)[0]===s;",
    "none",
    true,
  ],
  ["let s=Symbol();let o={[s]:42};o.hasOwnProperty(s);", "none", true],
  [
    "let s=Symbol();let o={};Object.defineProperty(o,s,{value:42});o[s];",
    "none",
    42,
  ],
  ["let s=Symbol();let rest;({...rest}={[s]:42});rest[s];", "none", 42],
  ["try{new Symbol();}catch(e){e instanceof TypeError;}", "none", true],
  ["try{Symbol.keyFor({});}catch(e){e instanceof TypeError;}", "none", true],
  ["try{Number(Symbol());}catch(e){e instanceof TypeError;}", "none", true],
  ["try{''+Symbol();}catch(e){e instanceof TypeError;}", "none", true],
  ["try{new String(Symbol());}catch(e){e instanceof TypeError;}", "none", true],

  ["let x;({x}={x:42});x;", "none", 42],
  ["let x;({x=42}={});x;", "none", 42],
  ["let x;({x=42}={x:null});x;", "none", null],
  ["let x;({a:{x=42}={}}={});x;", "none", 42],
  ["let x;let source={x:42};({x}=source)===source;", "none", true],
  ["let o={};({x:o.value=42}={});o.value;", "none", 42],
  ["let x,rest;({x,...rest}={x:1,y:42});rest.y;", "none", 42],
  ["let n;for({length:n} in {abc:1}){}n;", "none", 3],
  ["let n=0;for({x:missing.y} in {}){n++;}n;", "none", 0],
  ["let n=0,x;try{({[(n++,'x')]:x}=null);}catch(e){}n;", "none", 0],
  [
    "let log='',o={};let source={get x(){log+='g';return undefined;}};function target(){log+='t';return o;}({[(log+='k','x')]:target().x=(log+='d',42)}=(log+='r',source));log;",
    "none",
    "rktgd",
  ],
  [
    "let log='',o={};let key={toString(){log+='p';return 'x';}};let source={get x(){log+='g';return 42;}};({x:o[(log+='t',key)]}=source);log;",
    "none",
    "tgp",
  ],
  [
    "let n=0;try{({x:null.y}={get x(){n++;return 42;}});}catch(e){}n;",
    "none",
    1,
  ],
  [
    "let log='',o={};let source={get x(){log+='g';return 42;}};function target(){log+='t';return o;}({...target().rest}=source);log;",
    "none",
    "tg",
  ],
  [
    "let x,y;let source=Object.defineProperty({},'__proto__',{value:42});({__proto__:x,__proto__:y}=source);x===42&&y===x;",
    "none",
    true,
  ],
  ["let f;({f=function(){}}={});f.name;", "none", "f"],
  ["let o={};({f:o.f=function(){}}={});o.f.name;", "none", ""],
  ["const x=1;try{({x}={x:42});}catch(e){e.name;}", "none", "TypeError"],
  ["let o={set x(v){this.y=v;}};({x:o.x}={x:42});o.y;", "none", 42],
  [
    "class C{#x=0;m(){({x:this.#x}={x:42});return this.#x;}}new C().m();",
    "none",
    42,
  ],
  ["let o={};let x;({x,...o.rest}={x:1,y:42});o.rest.y;", "none", 42],
  ["let x,rest;({length:x,...rest}='abc');x===3&&rest[1]==='b';", "none", true],
  ["let x;for({length:x=42} in {a:1,abcd:2}){}x;", "none", 4],
  ["function f({x}){return x;}f({x:42});", "none", 42],
  ["function f({x=42,y=x}={}){return y;}f();", "none", 42],
  ["const f=({x:{y=42}={}}={})=>y;f();", "none", 42],
  ["function f({x,...rest}){return rest.y;}f({x:1,y:42});", "none", 42],
  ["function f(...{length:n}){return n;}f(1,2,3);", "none", 3],
  ["let o={m({x}){return this.y+x;},y:2};o.m({x:40});", "none", 42],
  [
    "class C{constructor({x}){this.x=x;}m({y}){return this.x+y;}}new C({x:40}).m({y:2});",
    "none",
    42,
  ],
  ["class C{set x({y}){this.y=y;}}let c=new C();c.x={y:42};c.y;", "none", 42],
  ["function f({x=()=>y},y=42){return x();}f({});", "none", 42],
  [
    "function f({x=y},y=42){}try{f({});}catch(e){e.name;}",
    "none",
    "ReferenceError",
  ],
  ["function f({x}){}try{f();}catch(e){e.name;}", "none", "TypeError"],
  ["function f({x=42}){var x;return x;}f({});", "none", 42],
  ["let x=42;function f({y=()=>x}){var x=1;return y();}f({});", "none", 42],
  [
    "let x=42;function f({[(()=>x)()]:y}){var x=1;return y;}f({42:42});",
    "none",
    42,
  ],
  ["function f({x}){x=1;return arguments[0].x;}f({x:42});", "none", 42, false],
  [
    "function f({x},y){y=1;return arguments[1];}f({x:1},42);",
    "none",
    42,
    false,
  ],
  [
    "function f({arguments}){return arguments;}f({arguments:42});",
    "none",
    42,
    false,
  ],
  ["function f({x},y=1){}f.length;", "none", 1],
  ["function f({x=1}){}f.length;", "none", 1],
  ["function f({x}={}){}f.length;", "none", 0],
  ["function f({g=function(){}}){return g.name;}f({});", "none", "g"],
  ["let n=0;function f({[n++]:x=42}){return x;}f({});n;", "none", 1],
  ["let n=0;for(const {length} in {abc:1})n=length;n;", "none", 3],
  [
    "let n=0;for(let {0:first,length:nlen,...rest} in {abc:1}){n=first==='a'&&nlen===3&&rest[1]==='b'&&rest[2]==='c';}n;",
    "none",
    true,
  ],
  ["for(var {length:n} in {abc:1}){}n;", "none", 3],
  [
    "let f;for(let {length:n} in {a:1,abcd:2}){if(n===1)f=()=>n;}f();",
    "none",
    1,
  ],
  ["let n=0;for(const {missing:x=(n++,42)} in {a:1,b:2}){}n;", "none", 2],
  ["let n=0;for(const {[(n++,'length')]:x} in {a:1,bb:2}){}n;", "none", 2],
  [
    "try{for(let {length:x} in x){}}catch(e){e.name;}",
    "none",
    "ReferenceError",
  ],
  ["let n=0;for(let {missing:x=y,other:y=1} in {}){n++;}n;", "none", 0],
  [
    "try{for(let {missing:x=y,other:y=1} in {a:1}){}}catch(e){e.name;}",
    "none",
    "ReferenceError",
  ],
  ["let n=0;for(let {length:x}= {length:1},y=0;y<2;y++){n+=x;}n;", "none", 2],
  ["try{throw {x:42};}catch({x}){x;}", "none", 42],
  ["try{throw {};}catch({x=42,y=x,...rest}){y;}", "none", 42],
  ["try{throw {};}catch({x:{y=42}={}}){y;}", "none", 42],
  ["try{throw {x:null};}catch({x=42}){x;}", "none", null],
  ["try{throw {x:1,y:42};}catch({x,...rest}){rest.y;}", "none", 42],
  ["let f;try{throw {};}catch({x=42}){f=()=>x;}f();", "none", 42],
  ["let x=1;try{throw {x:2};}catch({x}){x=3;}x;", "none", 1],
  ["let n=0;try{try{throw null;}catch({[n++]:x}){}}catch(e){n;}", "none", 0],
  [
    "let n=0;try{try{throw {};}catch({x=y,y=1}){}finally{n=42;}}catch(e){n;}",
    "none",
    42,
  ],
  [
    "try{try{throw {};}catch({x=y,y=1}){}}catch(e){e.name;}",
    "none",
    "ReferenceError",
  ],
  [
    "try{throw 'abc';}catch({length,0:first}){length===3&&first==='a';}",
    "none",
    true,
  ],
  [
    "let n=0;try{throw {get x(){n++;return 42;}};}catch({x}){x===42&&n===1;}",
    "none",
    true,
  ],
  ["try{throw {};}catch({f=function(){}}){f.name;}", "none", "f"],
  ["try{throw {let:42};}catch({let:x}){x;}", "none", 42, false],
  ["const {x}={x:42};x;", "none", 42],
  ["let {x=42,y=1}={y:null};x===42&&y===null;", "none", true],
  ["let {x:{y=42}={}}={};y;", "none", 42],
  ["let n=0;let {x}={get x(){n++;return 42;}};x===42&&n===1;", "none", true],
  ["let {x:renamed=function(){}}={};renamed.name;", "none", "renamed"],
  ["let {x:Renamed=class{}}={};Renamed.name;", "none", "Renamed"],
  [
    "let n=0;let {x=(n++,1),y=(n++,2)}={x:0};n===1&&x===0&&y===2;",
    "none",
    true,
  ],
  ["var {x,y:x}={x:1,y:42};x;", "none", 42],
  [
    "try{let {x=y,y=42}={};}catch(e){e instanceof ReferenceError;}",
    "none",
    true,
  ],
  ["let {x=20,y=x+22}={};y;", "none", 42],
  ["let before=x;var {x}={x:42};before===undefined&&x===42;", "none", true],
  ["try{let {}=null;}catch(e){e instanceof TypeError;}", "none", true],
  [
    "try{const {...rest}=undefined;}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "let n=0;try{let {[n++]:x}=null;}catch(e){n===0&&e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "let source=Object.create({inherited:1});source.x=1;source.y=42;Object.defineProperty(source,'hidden',{value:2});let {x,...rest}=source;rest.y===42&&!('x' in rest)&&!('inherited' in rest)&&!('hidden' in rest);",
    "none",
    true,
  ],
  [
    "let n=0;let {x,...rest}={get x(){n++;return 1;},y:42};n===1&&rest.y===42;",
    "none",
    true,
  ],
  [
    "let n=0;let key={toString(){n++;return 'x';}};let {[key]:x,...rest}={x:1,y:42};n===1&&x===1&&rest.y===42&&!('x' in rest);",
    "none",
    true,
  ],
  ["let source={};let {x=(source.y=42),...rest}=source;rest.y;", "none", 42],
  [
    "let source=Object.create(null);Object.defineProperty(source,'__proto__',{value:42,enumerable:true});let {...rest}=source;rest.__proto__===42&&Object.getPrototypeOf(rest)===Object.prototype;",
    "none",
    true,
  ],
  ["Number.prototype.extra=42;let {extra}=2;extra;", "none", 42],
  [
    "let {length,0:first,...rest}='abc';length===3&&first==='a'&&rest[1]==='b'&&rest[2]==='c'&&!('length' in rest);",
    "none",
    true,
  ],
  ["let {}=42;42;", "none", 42],
  [
    "let fs=[];for(let {x}={x:0};x<2;x++){fs.push(()=>x);}fs[0]()===0&&fs[1]()===1;",
    "none",
    true,
  ],
  [
    "var x;let captured;try{throw 1;}catch(x){var {value:x}={value:42};captured=x;}captured===42&&x===undefined;",
    "none",
    true,
  ],
  ["const {x}={x:1};try{x=2;}catch(e){e instanceof TypeError;}", "none", true],
  ["let x=1;{let {x}={x:42};if(x!==42)throw 0;}x;", "none", 1],
  ["42;let {x}={x:1};", "none", 42],
  [
    "let n=0;try{let {x,y}={get x(){throw 42;},get y(){n++;}};}catch(e){e===42&&n===0;}",
    "none",
    true,
  ],
  [
    "let source=Object.create({get x(){return this.y;}});source.y=42;let {x}=source;x;",
    "none",
    42,
  ],
  [
    "let n=0;try{let {x:{y},[n++]:z}={x:null};}catch(e){e instanceof TypeError&&n===0;}",
    "none",
    true,
  ],
  ["function f(){let {x=42}={};return ()=>x;}f()();", "none", 42],
  ["2 ** 3 ** 2;", "none", 512],
  ["2 * 3 ** 2 + 1;", "none", 19],
  ["(-2) ** 3;", "none", -8],
  ["2 ** -3;", "none", 0.125],
  ["1 / ((-0) ** 3);", "none", -Infinity],
  ["NaN ** 0;", "none", 1],
  ["'2' ** '5';", "none", 32],
  ["let x=2;x **= 3 ** 2;x;", "none", 512],
  [
    "let n=0;let x={get v(){n++;return 2;},set v(v){n+=v;}};x.v **= 5;n;",
    "none",
    33,
  ],
  [
    "let n=0;let o={x:2};function key(){n++;return 'x';}o[key()] **= 3;n===1&&o.x===8;",
    "none",
    true,
  ],
  ["let x=2;x++ ** 3;", "none", 8],
  ["let x=2;++x ** 3;", "none", 27],
  [
    "let n=0;let a={valueOf(){n=1;return 2;}};let b={valueOf(){if(n!==1)throw 0;n=2;return 5;}};(a ** b)===32&&n===2;",
    "none",
    true,
  ],
  ["2 ** 0.5;", "none", Math.sqrt(2)],
  ["Math.pow(2,32);", "none", 4294967296],
  ["Math.pow('2','5');", "none", 32],
  ["1/Math.pow(-0,3);", "none", -Infinity],
  ["Math.pow(-0,-3);", "none", -Infinity],
  ["Math.pow(NaN,0);", "none", 1],
  ["Number.isNaN(Math.pow(1,Infinity));", "none", true],
  ["Math.pow(2,-1074);", "none", 5e-324],
  [
    "let n=0;let a={valueOf(){n=1;return 2;}};let b={valueOf(){if(n!==1)throw 0;n=2;return 5;}};Math.pow(a,b)===32&&n===2;",
    "none",
    true,
  ],
  [
    "let n=0;try{Math.pow({valueOf(){throw 42;}},{valueOf(){n++;return 2;}});}catch(e){e===42&&n===0;}",
    "none",
    true,
  ],
  [
    "let d=Object.getOwnPropertyDescriptor(Math,'pow');d.writable&&!d.enumerable&&d.configurable&&Math.pow.length===2&&Math.pow.name==='pow';",
    "none",
    true,
  ],
  ["Math.pow(2,0.5);", "none", Math.sqrt(2)],
  [
    "function tag(p){return p[0]===undefined&&p.raw[0]==='\\\\x';}tag`\\x`;",
    "none",
    true,
  ],
  [
    "function tag(p,a,b){return p[0]===undefined&&p[1]==='valid'&&p[2]===undefined&&a===1&&b===2;}tag`\\u{}${1}valid${2}\\8`;",
    "none",
    true,
  ],
  [
    "function tag(p){return Object.getOwnPropertyDescriptor(p,'0').value===undefined&&Object.isFrozen(p);}tag`\\u{110000}`;",
    "none",
    true,
  ],
  ["function tag(parts){return parts[0];}tag`hello`;", "none", "hello"],
  ["function tag(parts,x){return x;}tag`a${42}b`;", "none", 42],
  [
    "function tag(parts){return parts[0]+'|'+parts.raw[0];}tag`a\\nb`;",
    "none",
    "a\nb|a\\nb",
  ],
  [
    "function tag(parts){return Array.isArray(parts)&&Array.isArray(parts.raw)&&Object.isFrozen(parts)&&Object.isFrozen(parts.raw);}tag`x`;",
    "none",
    true,
  ],
  [
    "function tag(parts){let d=Object.getOwnPropertyDescriptor(parts,'raw');return !d.writable&&!d.enumerable&&!d.configurable;}tag`x`;",
    "none",
    true,
  ],
  [
    "function tag(parts){return parts;}function f(){return tag`a${42}b`;}f()===f();",
    "none",
    true,
  ],
  ["function tag(parts){return parts;}tag`x`===tag`x`;", "none", false],
  ["let o={x:42,tag(parts){return this.x;}};o.tag`x`;", "none", 42],
  ["let o={x:42,tag(parts){return this.x;}};(o?.tag)`x`;", "none", 42],
  [
    "let o={toString(){throw 1;}};function tag(parts,x){return x===o;}tag`${o}`;",
    "none",
    true,
  ],
  [
    "let n=0;function tag(parts,a,b){return arguments.length===3&&a===0&&b===1&&n===2;}tag`${n++}${n++}`;",
    "none",
    true,
  ],
  [
    "let n=0;let o={get tag(){n=1;return function(parts,x){return n===2&&x===1;};}};o.tag`${n++}`;",
    "none",
    true,
  ],
  [
    "let n=0;let tag=0;try{tag`${n++}`;}catch(e){n===1&&e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "function tag(parts){return parts[0];}tag`outer${tag`inner`}tail`;",
    "none",
    "outer",
  ],
  [
    "class A{tag(parts,x){return this.n+x;}}class B extends A{n=20;m(){return super.tag`${22}`;}}new B().m();",
    "none",
    42,
  ],
  [
    "class C{#tag(parts,x){return x;}m(){return this.#tag`${42}`;}}new C().m();",
    "none",
    42,
  ],
  [
    "function tag(parts){return parts.raw[0];}tag`a\r\nb\rc`;",
    "none",
    "a\nb\nc",
  ],
  ["function tag(parts){return parts.length;}tag``;", "none", 1],
  [
    "function tag(parts){try{parts[0]='bad';}catch(e){return e instanceof TypeError;}}tag`x`;",
    "none",
    true,
  ],
  [
    "function tag(parts){return function C(){this.x=42;};}new (tag`x`)().x;",
    "none",
    42,
  ],
  [
    "let a=[1,2];a.join=function(){return this===a&&arguments.length===0?42:0;};a.toString();",
    "none",
    42,
  ],
  [
    "let a=[];a.join=1;Object.prototype.toString=function(){throw 1;};a.toString();",
    "none",
    "[object Array]",
  ],
  ["Array.prototype.toString.call({join(){return 42;}});", "none", 42],
  ["Array.prototype.toString.call({join:1});", "none", "[object Object]"],
  [
    "try{Array.prototype.toString.call(null);}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "let n=0;let a=[];Object.defineProperty(a,'join',{get(){n++;return function(){return 41;};}});a.toString()+n;",
    "none",
    42,
  ],
  [
    "let a=[];a.join=function(){throw 42;};try{a.toString();}catch(e){e;}",
    "none",
    42,
  ],
  ["`a${42}b`;", "none", "a42b"],
  [
    "`${null},${undefined},${true},${false}`;",
    "none",
    "null,undefined,true,false",
  ],
  ["`${-0},${NaN},${Infinity}`;", "none", "0,NaN,Infinity"],
  ["`a${`b${42}c`}d`;", "none", "ab42cd"],
  ["`${{x:42}.x}`;", "none", "42"],
  ["`${(()=>{return 42;})()}`;", "none", "42"],
  [
    "let n=0;let o={toString(){n++;return 'x';},valueOf(){throw 1;}};`${o}${n}`;",
    "none",
    "x1",
  ],
  [
    "let n=0;let o={toString(){n++;return {};},valueOf(){n++;return 40;}};`${o}${n}`;",
    "none",
    "402",
  ],
  [
    "let n=0;let o={toString(){throw 42;}};try{`${o}${n++}`;}catch(e){n===0&&e===42;}",
    "none",
    true,
  ],
  [
    "let o={toString(){return {};},valueOf(){return {};}};try{`${o}`;}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  ["let String=()=>{throw 1;};`${42}`;", "none", "42"],
  ["let n=0;`${n++}${n++}${n}`;", "none", "012"],
  ["`${[1,2]}`;", "none", "1,2"],
  ["`${'}'}`;", "none", "}"],
  ["`${/* } */ 42}`;", "none", "42"],
  ["let o={x:42};`${o?.x}`;", "none", "42"],
  ["class C{#x=42;m(){return `${this.#x}`;}}new C().m();", "none", "42"],
  [
    "class A{m(){return 42;}}class C extends A{m(){return `${super.m()}`;}}new C().m();",
    "none",
    "42",
  ],
  ["let o={[`x${42}`]:42};o.x42;", "none", 42],
  ["function f(x){return ()=>`${x}`;}f(42)();", "none", "42"],
  ["debugger;", "none", undefined, false],
  ["42;debugger;", "none", 42],
  ["debugger\n42;", "none", 42],
  ["42;{debugger;}", "none", 42],
  ["42;if(true)debugger;", "none", undefined],
  ["function f(){debugger;return 42;}f();", "none", 42],
  [
    "class C{static{debugger;this.x=42;}m(){debugger;return 42;}}C.x+new C().m();",
    "none",
    84,
  ],
  ["let n=0;while(n<3){debugger;n++;}n;", "none", 3],
  ["try{throw 42;}catch(e){debugger;e;}finally{debugger;}", "none", 42],
  ["function f(...r){return r.length;}f();", "none", 0],
  ["function f(a,...r){return r[0]+r[1];}f(0,20,22);", "none", 42],
  ["function f(a,b,...r){return r.length;}f(1);", "none", 0],
  [
    "function f(...r){return Array.isArray(r)&&Object.getPrototypeOf(r)===Array.prototype;}f();",
    "none",
    true,
  ],
  ["function f(...r){return r;}f(42)[0];", "none", 42],
  ["function f(...r){return r;}f()!==f();", "none", true],
  ["function f(...r){return 0 in r;}f(undefined);", "none", true],
  ["function f(...r){r[0]=1;return arguments[0];}f(42);", "none", 42],
  ["function f(a,...r){a=1;return arguments[0];}f(42);", "none", 42, false],
  ["function f(a,...r){arguments[0]=1;return a;}f(42);", "none", 42, false],
  ["function f(...r){var r;return r[0];}f(42);", "none", 42, false],
  ["function f(...arguments){return arguments[0];}f(42);", "none", 42, false],
  ["function f(a=()=>r,...r){return a()[0];}f(undefined,42);", "none", 42],
  [
    "function f(a=r,...r){}try{f();}catch(e){e instanceof ReferenceError;}",
    "none",
    true,
  ],
  ["function f(...r){return ()=>r[0];}f(42)();", "none", 42],
  ["let f=(a,...r)=>r[0];f(1,42);", "none", 42],
  ["let o={x:20,m(...r){return this.x+r[0];}};o.m(22);", "none", 42],
  [
    "class C{constructor(...r){this.x=r[0];}m(...r){return this.x+r[0];}}new C(20).m(22);",
    "none",
    42,
  ],
  [
    "class A{constructor(x){this.x=x;}}class C extends A{constructor(...r){super(r[0]);}}new C(42).x;",
    "none",
    42,
  ],
  [
    "class C{#m(...r){return r[0];}m(){return this.#m(42);}}new C().m();",
    "none",
    42,
  ],
  ["function f(a,...r){}f.length;", "none", 1],
  ["((...r)=>r).length;", "none", 0],
  [
    "class C{constructor(a,...r){}m(a,...r){}}C.length+C.prototype.m.length;",
    "none",
    2,
  ],
  ["null?.x.y;", "none", undefined],
  ["undefined?.[missing](missing).x;", "none", undefined],
  ["let n=0;null?.[n++];n;", "none", 0],
  ["let n=0;let o={m:null};o.m?.(n++);n;", "none", 0],
  ["let o={x:42,m(){return this.x;}};o?.m();", "none", 42],
  ["let o={x:42,m(){return this.x;}};o.m?.();", "none", 42],
  ["let o={x:42,m(){return this.x;}};(o?.m)();", "none", 42],
  ["let o={x:42,m(){return this.x;}};(o?.m)?.();", "none", 42],
  ["let o={x:42,m(){return this.x;}};o?.['m']?.();", "none", 42],
  ["let o={x:42,m(){return this;}};o?.m().x;", "none", 42],
  ["let n=0;try{(null?.m)(n++);}catch(e){}n;", "none", 1],
  ["let n=0;try{({m:1}).m?.(n++);}catch(e){}n;", "none", 1],
  [
    "let n=0;let o={get m(){n++;return function(){return this===o?41:0;};}};o.m?.()+n;",
    "none",
    42,
  ],
  ["let n=0;let o={get x(){n++;return null;}};o?.x?.[missing];n;", "none", 1],
  ["let o={x:null};o?.x?.y.z;", "none", undefined],
  ["try{({x:null})?.x.y;}catch(e){e instanceof TypeError;}", "none", true],
  ["try{(null?.x).y;}catch(e){e instanceof TypeError;}", "none", true],
  ["delete null?.[missing];", "none", true],
  ["let n=0;let o={get x(){n++;return 42;}};delete o?.x;n;", "none", 0],
  ["let o={x:42};delete (o?.x);'x' in o;", "none", false],
  ["let o={x:{y:42}};delete o?.x.y;'y' in o.x;", "none", false],
  [
    "let o={};Object.defineProperty(o,'x',{value:42});try{delete o?.x;}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  ["let o={m(){return 42;}};delete o?.m();", "none", true],
  ["typeof null?.x;", "none", "undefined"],
  ["try{missing?.x;}catch(e){e instanceof ReferenceError;}", "none", true],
  ["false?.valueOf();", "none", false],
  ["(0)?.valueOf();", "none", 0],
  ["''?.length;", "none", 0],
  ["class C{#x=42;m(o){return o?.#x;}}new C().m(null);", "none", undefined],
  ["class C{#x=42;m(o){return o?.#x;}}let c=new C();c.m(c);", "none", 42],
  [
    "class C{#m(){return 42;}m(o){return o?.#m?.();}}let c=new C();c.m(c);",
    "none",
    42,
  ],
  [
    "class C{#x=42;m(o){return o?.#x;}}try{new C().m({});}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "class A{m(){return this.x;}}class B extends A{x=42;m(){return super.m?.();}}new B().m();",
    "none",
    42,
  ],
  [
    "class A{m(){return this.x;}}class B extends A{x=42;m(){return super['m']?.();}}new B().m();",
    "none",
    42,
  ],
  [
    "class A{constructor(){this.x=42;}}class B extends A{constructor(){super()?.x;}}new B().x;",
    "none",
    42,
  ],
  [
    "class C{set x(v=42){this.y=v;}}Object.getOwnPropertyDescriptor(C.prototype,'x').set.length;",
    "none",
    0,
  ],

  ["class C{x=this.#m();#m(){return 42;}}new C().x;", "none", 42],
  [
    "class C{#v=1;get #x(){return this.#v;}set #x(v){this.#v=v;}m(){this.#x=42;return this.#x;}}new C().m();",
    "none",
    42,
  ],
  [
    "class C{set #x(v){this.v=v;}a=1;get #x(){return this.v;}m(){this.#x=42;return this.#x;}}new C().m();",
    "none",
    42,
  ],
  ["class C{static x=this.#m();static #m(){return 42;}}C.x;", "none", 42],
  [
    "class A{}class C extends A{x=this.#m();#m(){return 42;}}new C().x;",
    "none",
    42,
  ],
  ["class C{x=this.#a;get #a(){return 42;}}new C().x;", "none", 42],
  [
    "class C{get #x(){return 42;}m(){this.#x=1;}}try{new C().m();}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "class C{set #x(v){}m(){return this.#x;}}try{new C().m();}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "class C{#m(){return 42;}m(){this.#m=1;}}try{new C().m();}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "class C{#m(){return this.x;}expose(){return this.#m;}}new C().expose().call({x:42});",
    "none",
    42,
  ],
  [
    "class C{#m(){}expose(){return this.#m;}}new C().expose()===new C().expose();",
    "none",
    true,
  ],
  [
    "function make(){return class{#m(){}expose(){return this.#m;}};}let A=make(),B=make();new A().expose()===new B().expose();",
    "none",
    false,
  ],
  [
    "class C{#m(){}expose(){return this.#m;}}let f=new C().expose();try{new f();}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "class C{#m(a,b=1){}expose(){return this.#m;}}let f=new C().expose();f.name==='#m'&&f.length===1;",
    "none",
    true,
  ],
  [
    "class C{#m(){return this===undefined;}expose(){return this.#m;}}let f=new C().expose();f();",
    "none",
    true,
  ],
  [
    "class A{m(){return this.x;}}class C extends A{#m(){return super.m();}x=42;m(){return this.#m();}}new C().m();",
    "none",
    42,
  ],
  [
    "class C{static get #x(){return this.v;}static set #x(v){this.v=v;}static{this.#x=42;}static read(){return this.#x;}}C.read();",
    "none",
    42,
  ],
  [
    "class C{#m(){}has(o){return #m in o;}}let c=new C();c.has(c)&&!c.has({});",
    "none",
    true,
  ],
  [
    "class C{get #x(){return 1;}has(o){return #x in o;}}let c=new C();c.has(c);",
    "none",
    true,
  ],
  [
    "class C{get #x(){throw 42;}m(){return this.#x;}}try{new C().m();}catch(e){e;}",
    "none",
    42,
  ],

  ["class C{#x=42;get(){return this.#x;}}new C().get();", "none", 42],
  [
    "class C{#x=1;inc(){this.#x+=40;return ++this.#x;}}new C().inc();",
    "none",
    42,
  ],
  ["class C{#x;set(){this.#x??=42;return this.#x;}}new C().set();", "none", 42],
  ["class C{static #x=42;static get(){return this.#x;}}C.get();", "none", 42],
  [
    "class C{#x;has(o){return #x in o;}}let c=new C();c.has(c)&&!c.has({});",
    "none",
    true,
  ],
  [
    "class C{#x;has(o){return #x in o;}}try{new C().has(1);}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "class C{#x=42;get(){return this.#x;}}let f=new C().get;try{f.call({});}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "class A{#x=40;a(){return this.#x;}}class B extends A{#x=2;b(){return this.#x;}}let b=new B();b.a()+b.b();",
    "none",
    42,
  ],
  [
    "function make(){return class{#x=42;has(o){return #x in o;}};}let A=make(),B=make();new A().has(new B());",
    "none",
    false,
  ],
  ["class C{#x=42;get(){return ()=>this.#x;}}new C().get()();", "none", 42],
  [
    "class C{#x=42;get(){return this.#x;}}let c=new C();c['#x']=1;c.get();",
    "none",
    42,
  ],
  [
    "class C{#x=this.#x;}try{new C();}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "class C{#x=this.#y;#y=42;}try{new C();}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "class A{static #x=42;static get(){return this.#x;}}class B extends A{}try{B.get();}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "class A{constructor(o){return o;}}class B extends A{#x=42;static read(o){return o.#x;}}let o={};new B(o);B.read(o);",
    "none",
    42,
  ],
  [
    "class A{constructor(o){return o;}}class B extends A{#x=42;}let o={};new B(o);try{new B(o);}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "class C{#x=42;get(){return class D{read(o){return o.#x;}};}}let c=new C(),D=c.get();new D().read(c);",
    "none",
    42,
  ],

  ["class C{static{this.x=42;}}C.x;", "none", 42],
  ["class C{static x=1;static{this.x++;}static y=this.x+40;}C.y;", "none", 42],
  [
    "let trace='';class C{static{trace+='b';}static [(trace+='k','x')]=(trace+='f',1);static{trace+='z';}}trace;",
    "none",
    "kbfz",
  ],
  ["class C{static{this.x=this.m();}static m(){return 42;}}C.x;", "none", 42],
  [
    "class C{static{var x=1;let y=2;this.f=()=>x+y;}static{var x=30;let y=9;this.g=()=>x+y;}}C.f()+C.g();",
    "none",
    42,
  ],
  ["let x=42;class C{static{var x=1;}}x;", "none", 42],
  ["let x=42;class C{static{this.x=x;}}C.x;", "none", 42],
  [
    "class A{static get x(){return this.y;}}class B extends A{static y=42;static{this.z=super.x;}}B.z;",
    "none",
    42,
  ],
  [
    "class C{static{this.x=new.target;this.f=()=>new.target;}}C.x===undefined&&C.f()===undefined;",
    "none",
    true,
  ],
  [
    "let trace=0;try{class C{static{trace=1;throw 42;}static x=(trace=2);}}catch(e){trace+=e;}trace;",
    "none",
    43,
  ],
  ["class C{static{this.x=C;}}C.x===C;", "none", true],
  ["let f;class C{static{function g(){return 42;}f=g;}}f();", "none", 42],
  ["let x=0;class C{static{while(x<42)x++;}}x;", "none", 42],
  ["let x=0;class C{static{this.x=++x;}}new C();new C();x;", "none", 1],

  ["function F(){return new.target;}new F()===F;", "none", true],
  ["function F(){return new.target;}F()===undefined;", "none", true],
  [
    "function F(){return ()=>new.target;}let a=new F();F();a()===F;",
    "none",
    true,
  ],
  [
    "function F(){return function(){return new.target;};}let a=new F();a()===undefined;",
    "none",
    true,
  ],
  [
    "class A{constructor(){this.target=new.target;}}class B extends A{}new B().target===B;",
    "none",
    true,
  ],
  [
    "class A{}class B extends A{constructor(){let target=new.target;super();this.target=target;}}new B().target===B;",
    "none",
    true,
  ],
  [
    "class C{x=new.target;static x=new.target;m(){return new.target;}}let c=new C();c.x===undefined&&C.x===undefined&&c.m()===undefined;",
    "none",
    true,
  ],
  ["function F(x=new.target){this.x=x;}new F().x===F;", "none", true],
  ["class C{constructor(x=new.target){this.x=x;}}new C().x===C;", "none", true],
  [
    "class A{}class B extends A{constructor(x=new.target){super();this.x=x;}}new B().x===B;",
    "none",
    true,
  ],
  [
    "function F(){return new.target;}let B=F.bind(null);new B()===F;",
    "none",
    true,
  ],
  [
    "function F(){return ({m(){return new.target;}}).m();}new F() instanceof F;",
    "none",
    true,
  ],

  [
    "class A{constructor(x){this.x=x;}}class B extends A{constructor(x){super(x+1);}}new B(41).x;",
    "none",
    42,
  ],
  [
    "class A{}class B extends A{constructor(){this.x=1;super();}}try{new B();}catch(e){e instanceof ReferenceError;}",
    "none",
    true,
  ],
  [
    "class A{}class B extends A{constructor(){}}try{new B();}catch(e){e instanceof ReferenceError;}",
    "none",
    true,
  ],
  ["class B extends null{constructor(){return {x:42};}}new B().x;", "none", 42],
  [
    "class A{}class B extends A{constructor(){return 42;}}try{new B();}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "class A{}class B extends A{constructor(){return undefined;}}try{new B();}catch(e){e instanceof ReferenceError;}",
    "none",
    true,
  ],
  [
    "class A{x=42;}class B extends A{constructor(){super();return undefined;}}new B().x;",
    "none",
    42,
  ],
  [
    "let n=0;class A{constructor(){n++;}}class B extends A{constructor(){super();super();}}try{new B();}catch(e){}n;",
    "none",
    2,
  ],
  [
    "class A{x=42;}class B extends A{constructor(){let f=()=>this;super();return f();}}new B().x;",
    "none",
    42,
  ],
  [
    "class A{x=42;}class B extends A{constructor(){(()=>super())();}}new B().x;",
    "none",
    42,
  ],
  [
    "class A{x=42;}class B extends A{constructor(x=super()){this.y=x.x;}}new B().y;",
    "none",
    42,
  ],
  [
    "class A{}class B extends A{constructor(x=this){super();}}try{new B();}catch(e){e instanceof ReferenceError;}",
    "none",
    true,
  ],
  [
    "let n=0;class A{}class B extends A{constructor(){super[(n++,'x')];}}try{new B();}catch(e){}n;",
    "none",
    0,
  ],
  [superConstructorLookupCase, "none", 1],
  [
    "class A{}class B extends A{constructor(){let f=()=>super();f();}}new B() instanceof B;",
    "none",
    true,
  ],
  [
    "class A{x=41;}class B extends A{y=this.x+1;constructor(){super();}}new B().y;",
    "none",
    42,
  ],
  [
    "let seen;class A{}class B extends A{x=(()=>{throw 1;})();constructor(){try{super();}catch(e){seen=this;}return seen;}}new B()===seen;",
    "none",
    true,
  ],
  [
    "let n=0;class A{}class B extends A{x=(n++,1);constructor(){return {};}}new B();n;",
    "none",
    0,
  ],
  [
    "class A{x=41;m(){return this.x+1;}}class B extends A{}new B().m();",
    "none",
    42,
  ],
  [
    "class A{constructor(x){this.x=x;}}class B extends A{y=this.x+1;}new B(41).y;",
    "none",
    42,
  ],
  [
    "class A{m(){return this.x;}}class B extends A{x=42;m(){return super.m();}}new B().m();",
    "none",
    42,
  ],
  [
    "class A{static x=42;}class B extends A{static m(){return super.x;}}B.m();",
    "none",
    42,
  ],
  [
    "class A{}class B extends A{}let b=new B();b instanceof B&&b instanceof A&&Object.getPrototypeOf(B)===A&&Object.getPrototypeOf(B.prototype)===A.prototype;",
    "none",
    true,
  ],
  [
    "class C extends null{}Object.getPrototypeOf(C.prototype)===null&&Object.getPrototypeOf(C)===Function.prototype;",
    "none",
    true,
  ],
  [
    "class C extends null{}try{new C();}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  ["try{class C extends 42{}}catch(e){e instanceof TypeError;}", "none", true],
  [
    "try{class C extends C{}}catch(e){e instanceof ReferenceError;}",
    "none",
    true,
  ],
  [
    "function A(){}A.prototype=42;try{class C extends A{}}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "let hits=0;let f=()=>{};Object.defineProperty(f,'prototype',{get(){hits++;return {};}});try{class C extends f{}}catch(e){}hits;",
    "none",
    0,
  ],
  [
    "let n=0;function base(){n++;return class {x=42;};}class C extends base(){}new C().x===42&&n===1;",
    "none",
    true,
  ],
  [
    "class C{constructor(){this.x=super.y;}}Object.setPrototypeOf(C.prototype,{y:42});new C().x;",
    "none",
    42,
  ],
  [
    "class C{constructor(x=super.y){this.x=x;}}Object.setPrototypeOf(C.prototype,{y:42});new C().x;",
    "none",
    42,
  ],
  [
    "class C{constructor(){this.f=()=>super.y;}}Object.setPrototypeOf(C.prototype,{y:42});new C().f();",
    "none",
    42,
  ],
  [
    "let o={__proto__:{x:1},m(){return super[(Object.setPrototypeOf(o,{x:42}),'x')];}};o.m();",
    "none",
    42,
  ],
  [
    "let log='';let k={toString(){log+='k';return 'x';}};let o={__proto__:{},m(){super[k]=(log+='v',42);}};o.m();log;",
    "none",
    "vk",
  ],
  [
    "let p={get x(){'use strict';return this;}};let o={__proto__:p,m(){'use strict';return super.x;}};o.m.call(undefined);",
    "none",
    undefined,
  ],
  [
    "let p={set x(v){'use strict';if(this!==7)throw 1;}};let o={__proto__:p,m(){'use strict';super.x=42;return 42;}};o.m.call(7);",
    "none",
    42,
  ],
  [
    "let p={};Object.defineProperty(p,'x',{value:1,writable:false});let o={__proto__:p,m(){'use strict';super.x=42;}};try{o.m();}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "let p={};Object.defineProperty(p,'x',{value:1,writable:false});let o={__proto__:p,m(){super.x=42;return this.x;}};o.m();",
    "none",
    1,
    false,
  ],
  [
    "let o={__proto__:{x:42},m(){return super.x;}};let other={__proto__:{x:1},m:o.m};other.m();",
    "none",
    42,
  ],
  ["let o={__proto__:{x:42},m(x=super.x){return x;}};o.m();", "none", 42],
  [
    "class C{m(){return super.x;}}Object.setPrototypeOf(C.prototype,{x:42});new C().m();",
    "none",
    42,
  ],
  [
    "class C{static m(){return super.x;}}Object.setPrototypeOf(C,{x:42});C.m();",
    "none",
    42,
  ],
  [
    "class C{x=super.y;}Object.setPrototypeOf(C.prototype,{y:42});new C().x;",
    "none",
    42,
  ],
  [
    "let n=0;let o={m(){delete super[(n++,'x')];}};try{o.m();}catch(e){}n;",
    "none",
    1,
  ],
  [
    "let n=0;let k={toString(){n++;return 'x';}};let o={m(){delete super[k];}};try{o.m();}catch(e){}n;",
    "none",
    0,
  ],
  ["let p={x:42};let o={__proto__:p,m(){return super.x;}};o.m();", "none", 42],
  [
    "let p={get x(){return this.y;}};let o={__proto__:p,m(){return super.x;}};o.m.call({y:42});",
    "none",
    42,
  ],
  [
    "let p={m(){return this.y;}};let o={__proto__:p,m(){return super.m();}};o.m.call({y:42});",
    "none",
    42,
  ],
  [
    "let p={x:1};let o={__proto__:p,m(){super.x=42;return this.x;}};let r={};o.m.call(r)===42&&p.x===1;",
    "none",
    true,
  ],
  [
    "let p={set x(v){this.y=v;}};let o={__proto__:p,m(){super.x=42;return this.y;}};o.m.call({});",
    "none",
    42,
  ],
  [
    "let o={__proto__:{x:42},m(){return ()=>super.x;}};let f=o.m();f();",
    "none",
    42,
  ],
  [
    "let o={__proto__:{x:1},m(){return super.x;}};let f=o.m;Object.setPrototypeOf(o,{x:42});f();",
    "none",
    42,
  ],
  [
    "let o={__proto__:null,m(){return super.x;}};try{o.m();}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  [
    "let p={x:1};let o={__proto__:p,m(){super.x=(Object.setPrototypeOf(o,{x:2}),42);return this.x;}};o.m()===42&&p.x===1;",
    "none",
    true,
  ],
  [
    "let o={m(){return delete super.x;}};try{o.m();}catch(e){e instanceof ReferenceError;}",
    "none",
    true,
  ],
  ["let key='x';({[key]:42}).x;", "none", 42],
  ["let key={toString(){return 'x';}};({[key]:42}).x;", "none", 42],
  [
    "let log='';let key={toString(){log+='k';return 'x';}};let o={[key]:(log+='v',42)};log==='kv'&&o.x===42;",
    "none",
    true,
  ],
  [
    "let key='x';let o={[key](){return 42;}};o.x()===42&&o.x.name==='x';",
    "none",
    true,
  ],
  [
    "let key='x';let o={get [key](){return this.y;},set [key](v){this.y=v;}};o.x=42;let d=Object.getOwnPropertyDescriptor(o,'x');o.x===42&&d.get.name==='get x'&&d.set.name==='set x';",
    "none",
    true,
  ],
  [
    "let key='__proto__';let o={[key]:42};o.__proto__===42&&Object.getPrototypeOf(o)===Object.prototype;",
    "none",
    true,
  ],
  ["let key='f';({[key]:function(){}}).f.name;", "none", "f"],
  ["let key='x';({[key]:1,[key]:42}).x;", "none", 42],
  [
    "let hit=false;let key={toString(){throw 42;}};try{({[key]:(hit=true)});}catch(e){}hit;",
    "none",
    false,
  ],
  ["function f(k){return {[k]:42};}f('x').x;", "none", 42],
  ["let o={[(()=> 'x')()]:42};o.x;", "none", 42],
  ["let key={toString(){return 'x';}};({x:42})[key];", "none", 42],
  ["let key={toString(){return 'x';}};let o={};o[key]=42;o.x;", "none", 42],
  [
    "let key={toString(){return 'x';}};let o={x:42};delete o[key];'x' in o;",
    "none",
    false,
  ],
  [
    "let log='';let key={toString(){log+='s';return {};},valueOf(){log+='v';return 'x';}};let v=({x:42})[key];log==='sv'&&v===42;",
    "none",
    true,
  ],
  ["let key={toString(){throw 42;}};try{({})[key];}catch(e){e;}", "none", 42],
  [
    "let count=0;let key={toString(){count++;return 'x';}};try{null[key];}catch(e){}count;",
    "none",
    0,
  ],
  [
    "let log='';let key={toString(){log+='k';return 'x';}};let o={};o[key]=(log+='v',42);log;",
    "none",
    "vk",
  ],
  ["let o={...{x:42}};o.x;", "none", 42],
  [
    "let o={...null,...undefined,...42,...false};Object.keys(o).length;",
    "none",
    0,
  ],
  ["let o={...'abc'};o[0]+o[1]+o[2];", "none", "abc"],
  [
    "let p={inherited:1};let s=Object.create(p);s.x=42;let o={...s};o.x===42&&!('inherited' in o);",
    "none",
    true,
  ],
  [
    "let s={x:42};Object.defineProperty(s,'hidden',{value:1});Object.keys({...s}).join(',');",
    "none",
    "x",
  ],
  [
    "let count=0;let s={get x(){count++;return 42;}};let o={...s};let d=Object.getOwnPropertyDescriptor(o,'x');count===1&&d.value===42&&d.writable&&d.enumerable&&d.configurable;",
    "none",
    true,
  ],
  [
    "let called=false;let o={set x(v){called=true;},...{x:42}};o.x===42&&!called;",
    "none",
    true,
  ],
  ["let p={set x(v){throw 1;}};let o={__proto__:p,...{x:42}};o.x;", "none", 42],
  [
    "let s={['__proto__']:42};let o={...s};o.__proto__===42&&Object.getPrototypeOf(o)===Object.prototype;",
    "none",
    true,
  ],
  [
    "let o={x:1,...{x:2,y:3},x:42};o.x===42&&Object.keys(o).join(',')==='x,y';",
    "none",
    true,
  ],
  [
    "let s={get x(){delete this.y;this.z=3;return 42;},y:2};let o={...s};o.x===42&&!('y' in o)&&!('z' in o);",
    "none",
    true,
  ],
  [
    "let s={get x(){Object.defineProperty(this,'y',{enumerable:false});return 42;},y:2};let o={...s};o.x===42&&!('y' in o);",
    "none",
    true,
  ],
  ["let s={get x(){return this===s?42:0;}};({...s}).x;", "none", 42],
  ["let s={get x(){throw 42;}};try{({...s});}catch(e){e;}", "none", 42],
  [
    "let p={x:42};let o={__proto__:p};o.x===42&&Object.getPrototypeOf(o)===p&&!Object.prototype.hasOwnProperty.call(o,'__proto__');",
    "none",
    true,
  ],
  ["Object.getPrototypeOf({__proto__:null});", "none", null],
  ["Object.getPrototypeOf({__proto__:42})===Object.prototype;", "none", true],
  [
    "Object.getPrototypeOf({__proto__:undefined})===Object.prototype;",
    "none",
    true,
  ],
  [
    "let p={x:42};let o={'__proto__':p,['__proto__']:7};o.x===42&&o.__proto__===7;",
    "none",
    true,
  ],
  [
    "let __proto__=42;let o={__proto__:null,__proto__};o.__proto__===42&&Object.getPrototypeOf(o)===null;",
    "none",
    true,
  ],
  [
    "let o={__proto__:null,get __proto__(){return 42;}};o.__proto__;",
    "none",
    42,
  ],
  ["let o={__proto__:null,__proto__(){return 42;}};o.__proto__();", "none", 42],
  [
    "let trace='';function p(){trace+='p';return {x:42};}let o={a:(trace+='a'),__proto__:p(),b:(trace+='b')};trace==='apb'&&o.x===42;",
    "none",
    true,
  ],
  ["let o={__proto__:function(){}};Object.getPrototypeOf(o).name;", "none", ""],
  ["let o={get x(){return 42;}};o.x;", "none", 42],
  [
    "let o={get x(){return this.y;},set x(v){this.y=v;}};o.x=42;o.x;",
    "none",
    42,
  ],
  [
    "let o={set x(v){this.y=v;},get x(){return this.y;}};o.x=42;o.x;",
    "none",
    42,
  ],
  ["let o={get x(){return 1;},get x(){return 42;}};o.x;", "none", 42],
  ["let o={get x(){return 1;},x:42};o.x;", "none", 42],
  ["let o={x:1,get x(){return 42;}};o.x;", "none", 42],
  [
    "let o={get x(){return 1;},set x(v){}};let d=Object.getOwnPropertyDescriptor(o,'x');d.enumerable&&d.configurable&&d.get.name==='get x'&&d.set.name==='set x'&&d.get.length===0&&d.set.length===1;",
    "none",
    true,
  ],
  [
    "let o={get x(){return 42;}};let child=Object.create(o);child.x;",
    "none",
    42,
  ],
  ["let o={get x(){return 42;}};o.x=1;", "type", undefined],
  ["let o={get x(){return 42;}};o.x=1;o.x;", "none", 42, false],
  ["let o={get x(){throw 42;}};try{o.x;}catch(e){e;}", "none", 42],
  [
    "let o={get x(){return 1;}};new (Object.getOwnPropertyDescriptor(o,'x').get)();",
    "type",
    undefined,
  ],
  [
    "function f(){return this;}let n=f.call(42);n instanceof Number&&n.valueOf()===42;",
    "none",
    true,
    false,
  ],
  [
    "function f(){return this;}let b=f.call(false);b instanceof Boolean&&b.valueOf()===false;",
    "none",
    true,
    false,
  ],
  [
    "function f(){return this;}let s=f.call('abc');s instanceof String&&s[1]==='b';",
    "none",
    true,
    false,
  ],
  ["function f(){return this;}f.call(1)!==f.call(1);", "none", true, false],
  [
    "function f(){return this;}let o={};f.call(o)===o&&f.call(null)===this&&f.call(undefined)===this;",
    "none",
    true,
    false,
  ],
  [
    "function f(){'use strict';return this;}f.call(42)===42&&f.call(null)===null;",
    "none",
    true,
    false,
  ],
  [
    "Number.prototype.f=function(){return ()=>this;};let arrow=(42).f();arrow() instanceof Number&&arrow().valueOf()===42;",
    "none",
    true,
    false,
  ],
  [
    "Object.defineProperty(Number.prototype,'x',{get:function(){return this instanceof Number;}});(42).x;",
    "none",
    true,
    false,
  ],
  [
    "let seen;Object.defineProperty(Number.prototype,'x',{set:function(v){seen=this instanceof Number&&v===7;}});let n=42;n.x=7;seen;",
    "none",
    true,
    false,
  ],
  [
    "function f(){return this;}let bound=f.bind(42);bound() instanceof Number&&bound()!==bound();",
    "none",
    true,
    false,
  ],
  ["let keys='';for(let key in 'abc')keys+=key;keys;", "none", "012"],
  [
    "Number.prototype.extra=1;let keys='';for(let key in 42)keys+=key;keys;",
    "none",
    "extra",
  ],
  [
    "Boolean.prototype.extra=1;let keys='';for(let key in false)keys+=key;keys;",
    "none",
    "extra",
  ],
  [
    "String.prototype[0]='inherited';String.prototype.extra=1;let keys='';for(let key in 'a')keys+=key+',';keys;",
    "none",
    "0,extra,",
  ],
  [
    "Object.prototype.extra=1;let keys='';for(let key in null)keys+=key;for(let key in undefined)keys+=key;keys;",
    "none",
    "",
  ],
  ["'abc'[1];", "none", "b"],
  ["'abc'.length;", "none", 3],
  ["(42).valueOf();", "none", 42],
  ["false.valueOf();", "none", false],
  [
    "Object.defineProperty(Number.prototype,'x',{get:function(){'use strict';return typeof this;}});(42).x;",
    "none",
    "number",
  ],
  [
    "let seen;Object.defineProperty(Number.prototype,'x',{set:function(v){'use strict';seen=typeof this+v;}});let n=42;n.x='!';seen;",
    "none",
    "number!",
  ],
  ["let n=42;n.x=1;", "type", undefined],
  ["let n=42;n.x=1;n.x;", "none", undefined, false],
  ["let s='abc';s[0]='z';", "type", undefined],
  ["let s='abc';s[0]='z';s[0];", "none", "a", false],
  ["Object.prototype.hasOwnProperty.call('abc','1');", "none", true],
  [
    "Object.prototype.propertyIsEnumerable.call('abc','length');",
    "none",
    false,
  ],
  ["Object.prototype.propertyIsEnumerable.call('abc','0');", "none", true],
  ["Object.prototype.hasOwnProperty.call(42,'valueOf');", "none", false],
  [
    "let n=Object.prototype.valueOf.call(42);n instanceof Number&&n.valueOf()===42;",
    "none",
    true,
  ],
  [
    "let b=Object.prototype.valueOf.call(false);b instanceof Boolean&&b.valueOf()===false;",
    "none",
    true,
  ],
  [
    "let s=Object.prototype.valueOf.call('abc');s instanceof String&&s.length===3;",
    "none",
    true,
  ],
  ["let o={};Object.prototype.valueOf.call(o)===o;", "none", true],
  ["Object.prototype.valueOf.call(null);", "type", undefined],
  [
    "let key={toString:function(){throw 42;}};try{Object.prototype.hasOwnProperty.call(null,key);}catch(e){e;}",
    "none",
    42,
  ],
  [
    "Object.defineProperty(Number.prototype,'length',{get:function(){return this instanceof Number?1:0;}});Object.defineProperty(Number.prototype,'0',{get:function(){return this instanceof Number?'boxed':'primitive';}});Array.prototype.join.call(7);",
    "none",
    "boxed",
  ],
  ["Number('42');", "none", 42],
  ["Number()===0&&Number(undefined)!==Number(undefined);", "none", true],
  [
    "String()===''&&String(undefined)==='undefined'&&String(null)==='null';",
    "none",
    true,
  ],
  [
    "Boolean(0)===false&&Boolean('false')===true&&Boolean({})===true;",
    "none",
    true,
  ],
  [
    "let n=new Number(42);typeof n==='object'&&n.valueOf()===42&&n instanceof Number&&n!==new Number(42);",
    "none",
    true,
  ],
  [
    "let b=new Boolean(false);b.valueOf()===false&&Boolean(b)===true&&b instanceof Boolean;",
    "none",
    true,
  ],
  [
    "let s=new String('abc');s.valueOf()==='abc'&&s.toString()==='abc'&&s.length===3&&s[1]==='b'&&s instanceof String;",
    "none",
    true,
  ],
  ["let s=new String('abc');Object.keys(s).join(',');", "none", "0,1,2"],
  [
    "let s=new String('abc');Object.getOwnPropertyNames(s).join(',');",
    "none",
    "0,1,2,length",
  ],
  [
    "let s=new String('a');let d=Object.getOwnPropertyDescriptor(s,'0');d.value==='a'&&d.enumerable&&!d.writable&&!d.configurable;",
    "none",
    true,
  ],
  ["let s=new String('a');s[0]='b';", "type", undefined],
  [
    "let s=new String('a');Object.defineProperty(s,'0',{value:'a'});s[0];",
    "none",
    "a",
  ],
  [
    "let s=new String('a');Object.defineProperty(s,'0',{value:'b'});",
    "type",
    undefined,
  ],
  [
    "Number.prototype.valueOf()===0&&Boolean.prototype.valueOf()===false&&String.prototype.valueOf()==='';",
    "none",
    true,
  ],
  ["Number.prototype.valueOf.call({});", "type", undefined],
  ["String.prototype.toString.call(42);", "type", undefined],
  ["Boolean.prototype.valueOf.call(new Number(0));", "type", undefined],
  [
    "String(new Number(42))==='42'&&String(new Boolean(false))==='false';",
    "none",
    true,
  ],
  ["new Number(40)+2;", "none", 42],
  [
    "new Boolean(true)==1&&new Number(42)=='42'&&new String('x')=='x';",
    "none",
    true,
  ],
  [
    "Object.getPrototypeOf(Object(42))===Number.prototype&&Object.getPrototypeOf(Object(false))===Boolean.prototype;",
    "none",
    true,
  ],
  ["Object.getPrototypeOf('abc')===String.prototype;", "none", true],
  ["Object.keys('abc').join(',');", "none", "0,1,2"],
  ["Array.prototype.join.call('abc','-');", "none", "a-b-c"],
  ["Object.prototype.toString.call(new Number(1));", "none", "[object Number]"],
  [
    "Object.prototype.toString.call(new Boolean(false));",
    "none",
    "[object Boolean]",
  ],
  [
    "Object.prototype.toString.call(new String('x'));",
    "none",
    "[object String]",
  ],
  [
    "Number.isNaN(NaN)&&!Number.isNaN('x')&&Number.isFinite(42)&&!Number.isFinite(Infinity)&&!Number.isFinite('42');",
    "none",
    true,
  ],
  [
    "Number.isInteger(42)&&!Number.isInteger(1.5)&&Number.isSafeInteger(9007199254740991)&&!Number.isSafeInteger(9007199254740992);",
    "none",
    true,
  ],
  [
    "Number.MAX_SAFE_INTEGER===9007199254740991&&Number.MIN_SAFE_INTEGER===-9007199254740991&&Number.EPSILON>0;",
    "none",
    true,
  ],
  ["1/(new Number(-0).valueOf());", "none", -Infinity],
  [
    "let s='';let o={valueOf(){s+='n';return 42;},toString(){s+='s';return 'x';}};Number(o)===42&&String(o)==='x'&&s==='ns';",
    "none",
    true,
  ],
  ["new Number({valueOf(){throw 42;}});", "throw", 42],
  ["Number.prototype.toString.call(42,1);", "range", undefined],
  ["Number.prototype.toString.call(42,10);", "none", "42"],

  ["({valueOf(){return 40;}})+2;", "none", 42],
  ["({valueOf(){return '4';}})+2;", "none", "42"],
  [
    "let s='';let a={valueOf(){s+='a';return 40;}},b={valueOf(){s+='b';return 2;}};let n=a+b;s==='ab'&&n===42;",
    "none",
    true,
  ],
  ["let a={valueOf(){return {};},toString(){return '84';}};a/2;", "none", 42],
  ["let a={valueOf(){return 7;}};a%3;", "none", 1],
  ["({valueOf(){return 21;}})<<1;", "none", 42],
  ["+({valueOf(){return '42';}});", "none", 42],
  ["-({valueOf(){return 42;}});", "none", -42],
  ["~({valueOf(){return 0;}});", "none", -1],
  ["({valueOf(){return '10';}})<({valueOf(){return '2';}});", "none", true],
  [
    "let s='';let a={valueOf(){s+='a';return 2;}},b={valueOf(){s+='b';return 1;}};let result=a>b;result&&s==='ab';",
    "none",
    true,
  ],
  [
    "let s='';let a={valueOf(){s+='a';return 2;}},b={valueOf(){s+='b';return 1;}};let result=a<=b;!result&&s==='ab';",
    "none",
    true,
  ],
  [
    "let a={valueOf(){return NaN;}};!(a<1)&&!(a>1)&&!(a<=1)&&!(a>=1);",
    "none",
    true,
  ],
  [
    "let s='';let a={valueOf(){s+='a';throw 42;}},b={valueOf(){s+='b';return 1;}};try{a*b;}catch(e){}s;",
    "none",
    "a",
  ],
  ["+({valueOf(){return {};},toString(){return {};}});", "type", undefined],
  ["let x={valueOf(){return 40;}};x+=2;x;", "none", 42],
  [
    "let s='';let x={valueOf(){s+='v';return 41;}};let old=x++;old===41&&x===42&&s==='v';",
    "none",
    true,
  ],
  ["let x={valueOf(){return 43;}};--x;", "none", 42],
  [
    "let s='';let old={valueOf(){s+='v';return 41;}};let a={};Object.defineProperty(a,'x',{get(){s+='g';return old;},set(v){s+='s'+v;}});let n=a.x++;n===41&&s==='gvs42';",
    "none",
    true,
  ],

  [
    "null==undefined&&undefined==null&&!(null==0)&&!(undefined==0);",
    "none",
    true,
  ],
  ["false=='0'&&true=='1'&&''==0&&'  '==false&&'0x2a'==42;", "none", true],
  ["!(NaN==NaN)&&-0==0&&Infinity=='Infinity'&&'42'!=41;", "none", true],
  ["let a={};a==a&&a!={}&&({})!=({})&&'01'!='1';", "none", true],
  ["({valueOf(){return 42;}})=='42';", "none", true],
  ["'42'==({valueOf(){return 42;}});", "none", true],
  ["({valueOf(){return {};},toString(){return '42';}})==42;", "none", true],
  [
    "let a={valueOf(){throw 42;},toString(){throw 1;}};a!=null&&a!=undefined;",
    "none",
    true,
  ],
  ["({valueOf(){throw 42;}})==1;", "throw", 42],
  ["({valueOf(){return {};},toString(){return {};}})==1;", "type", undefined],
  ["let a={valueOf(){return 0;}};a==false&&false==a;", "none", true],
  [
    "let a={valueOf(){throw 42;}};let b={valueOf(){throw 42;}};a!=b;",
    "none",
    true,
  ],
  [
    "let s='';function left(){s+='l';return {valueOf(){s+='v';return 42;}};}function right(){s+='r';return 42;}let equal=left()==right();equal&&s==='lrv';",
    "none",
    true,
  ],

  ["'x' in {x:42};", "none", true],
  ["'missing' in {};", "none", false],
  ["'x' in Object.create({x:42});", "none", true],
  [
    "let a={};Object.defineProperty(a,'x',{value:undefined});'x' in a;",
    "none",
    true,
  ],
  [
    "let a={};Object.defineProperty(a,'x',{get(){throw 42;}});'x' in a;",
    "none",
    true,
  ],
  ["let a=[,undefined];!(0 in a)&&(1 in a)&&('length' in a);", "none", true],
  [
    "let s='';function key(){s+='l';return {toString(){s+='k';return 'x';}};}function obj(){s+='r';return {x:42};}let found=key() in obj();found&&s==='lrk';",
    "none",
    true,
  ],
  [
    "let s='';let key={toString(){s+='k';throw 42;}};let caught=false;try{key in null;}catch(e){caught=e instanceof TypeError;}caught&&s==='';",
    "none",
    true,
  ],
  ["({toString(){throw 42;}}) in {};", "throw", 42],
  ["({toString(){return {};},valueOf(){return 'x';}}) in {x:1};", "none", true],
  [
    "let a={x:1};let key={toString(){delete a.x;return 'x';}};key in a;",
    "none",
    false,
  ],
  ["0 in 'abc';", "type", undefined],
  ["'x' in 42;", "type", undefined],
  ["'x' in undefined;", "type", undefined],
  ["null in {'null':42};", "none", true],
  ["-0 in {0:42};", "none", true],

  ["function f(){}f.bind(null).caller;", "type", undefined],
  ["function f(){}f.bind(null).arguments=42;", "type", undefined],
  [
    "let b=(function(){}).bind(null);!b.hasOwnProperty('caller')&&!b.hasOwnProperty('arguments');",
    "none",
    true,
  ],
  [
    "let a=Object.getOwnPropertyDescriptor(Function.prototype,'caller');let b=Object.getOwnPropertyDescriptor(Function.prototype,'arguments');a.get===a.set&&a.get===b.get&&a.get===b.set&&!a.enumerable&&a.configurable;",
    "none",
    true,
  ],
  [
    "function f(){}let b=f.bind(null);Object.defineProperty(b,'caller',{value:42});b.caller;",
    "none",
    42,
  ],

  [
    "let p={x:42};let a={};Object.setPrototypeOf(a,p)===a&&a.x===42&&Object.getPrototypeOf(a)===p;",
    "none",
    true,
  ],
  [
    "let a={};Object.setPrototypeOf(a,null);Object.getPrototypeOf(a);",
    "none",
    null,
  ],
  [
    "let p={};let a=Object.create(p);Object.preventExtensions(a);Object.setPrototypeOf(a,p)===a;",
    "none",
    true,
  ],
  [
    "let a={};Object.preventExtensions(a);Object.setPrototypeOf(a,{});",
    "type",
    undefined,
  ],
  [
    "let a={};let b=Object.create(a);Object.setPrototypeOf(a,b);",
    "type",
    undefined,
  ],
  ["Object.setPrototypeOf(Object.prototype,{});", "type", undefined],
  [
    "Object.setPrototypeOf(Object.prototype,null)===Object.prototype&&Object.isExtensible(Object.prototype);",
    "none",
    true,
  ],
  ["Object.setPrototypeOf(42,{})===42;", "none", true],
  ["Object.setPrototypeOf(42,1);", "type", undefined],
  ["Object.setPrototypeOf(undefined,{});", "type", undefined],

  [
    "Object.getPrototypeOf(function(){}.bind(null))===Function.prototype;",
    "none",
    true,
  ],
  ["Object.getPrototypeOf(Object.create(null));", "none", null],
  ["Object.getPrototypeOf(null);", "type", undefined],
  [
    "let a={};Object.preventExtensions(a)===a&&!Object.isExtensible(a)&&Object.isSealed(a)&&Object.isFrozen(a);",
    "none",
    true,
  ],
  [
    "let a={x:1};Object.seal(a)===a&&Object.isSealed(a)&&!Object.isFrozen(a)&&(a.x=42)===42;",
    "none",
    true,
  ],
  [
    "let a={x:1};Object.freeze(a)===a&&Object.isFrozen(a)&&Object.isSealed(a);",
    "none",
    true,
  ],
  ["let a={};Object.preventExtensions(a);a.x=42;", "type", undefined],
  ["let a=[1];Object.freeze(a);a.push(42);", "type", undefined],
  [
    "let a=[1];Object.seal(a);a[0]=42;a[0]===42&&Object.isSealed(a)&&!Object.isFrozen(a);",
    "none",
    true,
  ],
  [
    "Object.freeze(null)===null&&Object.seal(undefined)===undefined&&Object.preventExtensions(42)===42&&Object.isFrozen('x')&&Object.isSealed(false)&&!Object.isExtensible(42);",
    "none",
    true,
  ],
  [
    "let x=0;let a={};Object.defineProperty(a,'x',{get(){throw 1;},set(v){x=v;},configurable:true});Object.freeze(a);a.x=42;x===42&&Object.isFrozen(a);",
    "none",
    true,
  ],
  [
    "function f(a){Object.freeze(arguments);a=42;return arguments[0]===1&&Object.isFrozen(arguments);}f(1);",
    "none",
    true,
    false,
  ],
  [
    "function f(a){Object.seal(arguments);a=42;return arguments[0]===42&&Object.isSealed(arguments)&&!Object.isFrozen(arguments);}f(1);",
    "none",
    true,
    false,
  ],

  ["[1,null,,undefined,42].join('-');", "none", "1----42"],
  ["[].join();", "none", ""],
  ["[1,42].join();", "none", "1,42"],
  [
    "let a=Object.create({0:42});a.length=2;Array.prototype.join.call(a,':');",
    "none",
    "42:",
  ],
  [
    "let a=[1,2];let sep={toString(){a.push(3);a[1]=42;return ':';}};a.join(sep);",
    "none",
    "1:42",
  ],
  [
    "let a=[1,2];Object.defineProperty(a,'0',{get(){delete a[1];return 42;}});a.join(':');",
    "none",
    "42:",
  ],
  [
    "let s='';let a={0:{toString(){s+='v';return 'x';}}};Object.defineProperty(a,'length',{get(){s+='l';return 1;}});let sep={toString(){s+='s';return ':';}};let r=Array.prototype.join.call(a,sep);s+r;",
    "none",
    "lsvx",
  ],
  ["[].join({toString(){throw 42;}});", "throw", 42],
  ["Array.prototype.join.call(null);", "type", undefined],

  ["let a=[1];a.push(20,21)===3&&a[1]+a[2]===41;", "none", true],
  [
    "let a={length:1.9};Array.prototype.push.call(a,42)===2&&a[1]===42&&a.length===2;",
    "none",
    true,
  ],
  [
    "let a={};Array.prototype.push.call(a,undefined)===1&&a.hasOwnProperty('0');",
    "none",
    true,
  ],
  [
    "let a={length:-3};Array.prototype.push.call(a)===0&&a.length===0;",
    "none",
    true,
  ],
  [
    "let a=[];Object.defineProperty(a,'length',{writable:false});a.push();",
    "type",
    undefined,
  ],
  [
    "let a={length:9007199254740991};let ok=false;try{Array.prototype.push.call(a,42);}catch(e){ok=e instanceof TypeError;}ok&&!a.hasOwnProperty('9007199254740991');",
    "none",
    true,
  ],
  [
    "let a=[];a.length=4294967295;let ok=false;try{a.push(42);}catch(e){ok=e instanceof RangeError;}ok&&a.length===4294967295&&a['4294967295']===42;",
    "none",
    true,
  ],
  [
    "let s='';let a={};Object.defineProperties(a,{length:{get(){s+='l';return {valueOf(){s+='v';return 0;}}},set(v){s+='n'+v;}},0:{set(v){s+='i'+v;}}});Array.prototype.push.call(a,42);s;",
    "none",
    "lvi42n1",
  ],
  [
    "let a={length:0};Object.defineProperty(a,'1',{value:0,writable:false});let ok=false;try{Array.prototype.push.call(a,41,42);}catch(e){ok=true;}ok&&a[0]===41&&a.length===0;",
    "none",
    true,
  ],
  ["Array.prototype.push.call(null,1);", "type", undefined],

  [
    "let s='';function f(){}Object.defineProperty(f,'length',{get(){s+='l';return 2.9;}});Object.defineProperty(f,'name',{get(){s+='n';return 'x';}});let b=f.bind(null,1);s==='ln'&&b.length===1&&b.name==='bound x';",
    "none",
    true,
  ],
  [
    "function f(a){}Object.defineProperty(f,'length',{value:Infinity});f.bind(null,1,2).length;",
    "none",
    Infinity,
  ],
  [
    "function f(){return arguments.length===1&&arguments[0]===undefined;}f.bind(null,undefined)();",
    "none",
    true,
  ],
  [
    "function C(){}let B=C.bind(null);Object.defineProperty(B,'prototype',{value:{}});let b=new B();b instanceof B&&b instanceof C;",
    "none",
    true,
  ],

  ["function f(a,b){return this.x+a+b;}f.call({x:1},20,21);", "none", 42],
  ["function f(){return this;}f.call();", "none", undefined],
  [
    "function f(a,b){return this.x+a+b;}let g=f.bind({x:1},20);g(21);",
    "none",
    42,
  ],
  [
    "function f(a,b,c){}let g=f.bind(null,1);g.length===2&&g.name==='bound f'&&!g.hasOwnProperty('prototype');",
    "none",
    true,
  ],
  [
    "function C(x){this.x=x;}let B=C.bind({x:0},42);let b=new B();b.x===42&&b instanceof C&&b instanceof B;",
    "none",
    true,
  ],
  [
    "class C{constructor(x){this.x=x;}}let B=C.bind(null,42);new B().x;",
    "none",
    42,
  ],
  ["class C{}C.bind(null)();", "type", undefined],
  ["let f=(()=>42).bind(null);new f();", "type", undefined],
  [
    "function f(a,b){return this.x+a+b;}f.bind({x:1},20).bind({x:0})(21);",
    "none",
    42,
  ],
  ["Function.prototype.call.call(42);", "type", undefined],
  ["Function.prototype.bind.call(42);", "type", undefined],

  ["new Object().constructor===Object;", "none", true],
  ["let a={};new Object(a)===a;", "none", true],
  ["Array.isArray(Object.create(Array.prototype));", "none", false],
  [
    "let a={x:1};let d=Object.getOwnPropertyDescriptor(a,'x');d.value=42;a.x;",
    "none",
    1,
  ],

  ["let a=Object.create({x:42});a.hasOwnProperty('x');", "none", false],
  [
    "let a={x:42};a.hasOwnProperty('x')&&a.propertyIsEnumerable('x');",
    "none",
    true,
  ],
  ["[].propertyIsEnumerable('length');", "none", false],
  [
    "let n=0;let a={};Object.defineProperty(a,'x',{get(){n++;return 42;}});a.hasOwnProperty('x');n;",
    "none",
    0,
  ],
  [
    "let n=0;let f=({}).hasOwnProperty;try{f({toString(){n++;return 'x';}});}catch{}n;",
    "none",
    1,
  ],

  ["Object().constructor===Object;", "none", true],
  ["let a={};Object(a)===a;", "none", true],
  ["let a={};Object.defineProperty(a,'x',{value:42});a.x;", "none", 42],
  [
    "let a={};Object.defineProperty(a,'x',{value:42});a.x=1;",
    "type",
    undefined,
  ],
  [
    "let a={};Object.defineProperty(a,'x',{value:42});let d=Object.getOwnPropertyDescriptor(a,'x');d.value===42&&!d.writable&&!d.enumerable&&!d.configurable;",
    "none",
    true,
  ],
  [
    "let a={};Object.defineProperty(a,'x',{get(){return 42;}});a.x;",
    "none",
    42,
  ],
  ["Object.defineProperty({},'x',{get:42});", "type", undefined],
  [
    "Object.defineProperty({},'x',{get(){return 1;},value:42});",
    "type",
    undefined,
  ],
  [
    "let a={};Object.defineProperty(a,'x',{value:1});Object.defineProperty(a,'x',{value:2});",
    "type",
    undefined,
  ],
  [
    "let p={value:42};let d=Object.create(p);let a={};Object.defineProperty(a,'x',d);a.x;",
    "none",
    42,
  ],
  ["let a=Object.create(null);a.toString;", "none", undefined],
  ["Object.create(42);", "type", undefined],
  ["Object.create(null,{x:{value:42}}).x;", "none", 42],
  [
    "let a={};try{Object.defineProperties(a,{x:{value:42},y:{get:7}});}catch{}a.x;",
    "none",
    undefined,
  ],
  [
    "let a={};Object.defineProperty(a,'y',{value:1});try{Object.defineProperties(a,{x:{value:42},y:{value:2}});}catch{}a.x;",
    "none",
    42,
  ],
  ["let a={b:1,2:2,1:3,a:4};Object.getOwnPropertyNames(a)[0];", "none", "1"],
  [
    "let a={x:42};Object.defineProperty(a,'hidden',{value:1});Object.keys(a).length;",
    "none",
    1,
  ],
  [
    "function f(a){a=42;return Object.getOwnPropertyDescriptor(arguments,'0').value;}f(1);",
    "none",
    42,
    false,
  ],
  [
    "function f(a){Object.defineProperty(arguments,'0',{writable:false});a=42;return arguments[0];}f(1);",
    "none",
    1,
    false,
  ],
  [
    "let a=[1,2,3];Object.defineProperty(a,'1',{configurable:false});try{a.length=0;}catch{}a.length;",
    "none",
    2,
  ],
  [
    "let n=0;try{Object.defineProperty(1,{toString(){n++;return 'x';}},{});}catch{}n;",
    "none",
    0,
  ],
  [
    "let n=0;try{Object.defineProperty({}, {toString(){n++;return 'x';}}, 1);}catch{}n;",
    "none",
    1,
  ],

  ["[,,,].length;", "none", 3],
  ["[42,].length;", "none", 1],
  ["[42,,].length;", "none", 2],
  ["let keys='';for(let k in [,undefined,,])keys+=k;keys;", "none", "1"],
  ["Array.prototype[0]=42;[,][0];", "none", 42],
  ["Array.prototype[0]=42;[undefined][0];", "none", undefined],

  ["let a=[];a.toString=({}).toString;a.toString();", "none", "[object Array]"],
  ["Array().length;", "none", 0],
  ["Array(3).length;", "none", 3],
  ["new Array('3')[0];", "none", "3"],
  ["Array(1,42,3)[1];", "none", 42],
  [
    "Array.isArray([])&&Array.isArray(Array.prototype)&&!Array.isArray({})&&!Array.isArray(null);",
    "none",
    true,
  ],
  ["function f(){return Array.isArray(arguments);}f();", "none", false],
  ["[] instanceof Array;", "none", true],
  ["[].constructor===Array;", "none", true],
  ["Array(1.5);", "range", undefined],
  ["new Array(-1);", "range", undefined],
  ["Array.prototype=42;", "type", undefined],

  ["[].length;", "none", 0],
  ["[1,42,3][1];", "none", 42],
  ["let a=[];a[4]=42;a.length;", "none", 5],
  ["let a=[1,2,3];a.length=1;a[2];", "none", undefined],
  ["let a=[1,2];delete a[1];a.length;", "none", 2],
  ["let a=[];a['01']=42;a.length;", "none", 0],
  ["let a=[];a.length='3';a.length;", "none", 3],
  ["let a=[];a.length=1.5;", "range", undefined],
  ["let a=[];a.length=-1;", "range", undefined],
  [
    "let n=0;let a=[1,2,3];a.length={valueOf(){n++;return 1;}};n===2&&a.length===1&&a[2]===undefined;",
    "none",
    true,
  ],
  [
    "let a=[];a.length={valueOf(){return {};},toString(){return '2';}};a.length;",
    "none",
    2,
  ],
  [
    "let a=[];a.length={valueOf(){return {};},toString(){return {};}};",
    "type",
    undefined,
  ],
  [
    "let n=0;let a=[n++,n++,n++];a[0]===0&&a[1]===1&&a[2]===2&&n===3;",
    "none",
    true,
  ],
  ["let a=[];a[4294967294]=42;a.length=0;a.length;", "none", 0],
  ["let a=[function(){}];a[0].name;", "none", ""],

  ["function f(){return arguments.length;}f(1,2);", "none", 2],
  ["function f(a){a=42;return arguments[0];}f(1);", "none", 1],
  ["function f(a){a=42;return arguments[0];}f(1);", "none", 42, false],
  ["function f(a){arguments[0]=42;return a;}f(1);", "none", 42, false],
  [
    "function f(a,a){a=42;return arguments[0]+arguments[1];}f(1,2);",
    "none",
    43,
    false,
  ],
  ["function f(a,a){a=42;return arguments[0];}f(1);", "none", 1, false],
  [
    "function f(a){delete arguments[0];a=42;return arguments[0];}f(1);",
    "none",
    undefined,
    false,
  ],
  ["function f(){return arguments.callee===f;}f();", "none", true, false],
  [
    "var saved;function f(){f=0;return arguments.callee===saved;}saved=f;saved();",
    "none",
    true,
    false,
  ],
  ["function f(){return arguments.callee;}f();", "type", undefined],
  ["function f(a=1){return arguments.callee;}f();", "type", undefined, false],
  ["function f(a=arguments.length){return a;}f();", "none", 0],
  ["function f(a=1){a=42;return arguments[0];}f(1);", "none", 1, false],
  ["function f(){return (()=>arguments[0])();}f(42);", "none", 42],
  ["function f(arguments){return arguments;}f(42);", "none", 42, false],
  ["function f(){let arguments=42;return arguments;}f();", "none", 42, false],
  [
    "function f(){function arguments(){return 42;}return arguments();}f();",
    "none",
    42,
    false,
  ],
  [
    "function f(){var arguments;return arguments.length;}f(1,2);",
    "none",
    2,
    false,
  ],
  [
    "function f(a=arguments.length){function arguments(){return 42;}return a+arguments();}f();",
    "none",
    42,
    false,
  ],
  ["function f(a){return ()=>arguments[0];}f(42)();", "none", 42],
  ["class C{constructor(x){this.x=arguments[0];}}new C(42).x;", "none", 42],
  ["class C{m(x){return arguments[0];}}new C().m(42);", "none", 42],

  [
    "let seen='';class C{get x(){throw 1;}set x(v){seen=v;}}let o=new C();for(o.x in {a:1}){}seen;",
    "none",
    "a",
  ],
  [
    "let source={a:1,b:1},seen='';class C{set x(v){seen+=v;delete source.b;}}let o=new C();for(o.x in source){}seen;",
    "none",
    "a",
  ],

  ["let key;for(key in {a:1,b:2}){}key;", "none", "b"],
  ["let o={};for(o.key in {a:1,b:2}){}o.key;", "none", "b"],
  [
    "let o={},n=0;function key(){n++;return 'k';}for(o[key()] in {a:1,b:2}){}n===2 && o.k==='b';",
    "none",
    true,
  ],
  [
    "let o={},n=0;function base(){n++;return o;}for(base().k in {a:1,b:2}){}n===2 && o.k==='b';",
    "none",
    true,
  ],
  ["for(missing in {}){}42;", "none", 42],
  ["for(missing in {a:1}){}", "reference", undefined],
  ["for(leak in {a:1,b:1}){}leak;", "none", "b", false],
  ["const key=42;for(key in {a:1}){}", "type", undefined],
  ["let key;for((key) in {a:1}){}key;", "none", "a"],
  ["let n=0;for(null[(n=42)] in {a:1}){}", "type", undefined],
  ["let n=0;for(null[(n=42)] in {}){}n;", "none", 0],
  ["let n=0;try{for(null[(n=42)] in {a:1}){}}catch{}n;", "none", 42],
  ["for(nativeObject.fixed in {a:1}){}", "type", undefined],
  ["for(nativeObject.fixed in {a:1}){}nativeObject.fixed;", "none", 1, false],
  ["var let;for(let in {a:1}){}let;", "none", "a", false],

  [
    "let out='';for(let a in {x:1,y:1})for(let b in {z:1})out+=a+b;out;",
    "none",
    "xzyz",
  ],
  ["let n=0;for(let k in {a:1,b:1}){try{continue;}finally{n++;}}n;", "none", 2],
  [
    "function f(){for(let k in {a:1}){try{return k;}finally{}}}f();",
    "none",
    "a",
  ],
  [
    "var seen;try{throw 0;}catch(k){for(var k in {a:1}){}seen=k;}seen==='a' && k===void 0;",
    "none",
    true,
  ],
  [
    "let n=0;function source(){n++;return {a:1,b:1};}for(const k in source()){}n;",
    "none",
    1,
  ],

  ["let out='';for(var key in {b:1,2:1,a:1,1:1})out+=key;out;", "none", "12ba"],
  [
    "let count=0;for(var key in null)count++;for(var other in void 0)count++;count;",
    "none",
    0,
  ],
  [
    "let out='';for(let key in {a:1,b:2}){if(key==='a')continue;out+=key;}out;",
    "none",
    "b",
  ],
  ["let out='';for(const key in {a:1,b:2}){out+=key;break;}out;", "none", "a"],
  ["let key={a:1};for(let key in key){}", "reference", undefined],
  ["for(const key in {a:1})key='b';", "type", undefined],
  ["for(var key in {a:1,b:2}){}key;", "none", "b"],
  ["let key=42;for(let key in {}){}key;", "none", 42],
  [
    "let a,b;for(let key in {x:1,y:2}){if(key==='x')a=()=>key;else b=()=>key;}a()+b();",
    "none",
    "xy",
  ],
  [
    "let o={a:1,b:2},out='';for(var key in o){out+=key;delete o.b;}out;",
    "none",
    "a",
  ],
  [
    "class C{constructor(){this.x=1;}}C.prototype.y=2;let out='';for(var key in new C())out+=key;out;",
    "none",
    "xy",
  ],

  ["let o={x:42};delete o.x;typeof o.x;", "none", "undefined"],
  ["let o={};delete o.missing;", "none", true],
  ["class C{get x(){throw 1;}}delete C.prototype.x;", "none", true],
  ["class C{get x(){throw 1;}}let o=new C();delete o.x;", "none", true],
  ["function f(){}delete f.prototype;", "type", undefined],
  ["function f(){}delete f.prototype;", "none", false, false],
  [
    "let count=0,o={x:1};function base(){count++;return o;}function key(){count+=10;return 'x';}delete base()[key()];count;",
    "none",
    11,
  ],
  ["let count=0;try{delete null[(count=42)];}catch{}count;", "none", 42],
  ["delete null.x;", "type", undefined],
  ["let x=1;delete (x=42);x;", "none", 42],
  ["let o={x:1};delete (0,o.x);o.x;", "none", 1],
  ["delete (function(){return 42;})();", "none", true],
  ["delete missing;", "none", true, false],
  ["var x=42;delete x;", "none", false, false],
  ["let x=42;delete x;", "none", false, false],
  ["delete x;let x;", "none", false, false],
  [
    "temporary=42;delete temporary;typeof temporary;",
    "none",
    "undefined",
    false,
  ],
  ["function f(x){return delete x;}f(42);", "none", false, false],
  ["let f=function self(){return delete self;};f();", "none", false, false],
  ["delete (42).x;", "none", true],
  ["delete true.x;", "none", true],
  ["delete 'abc'.length;", "type", undefined],
  ["delete 'abc'[1];", "none", false, false],
  ["delete 'abc'[3];", "none", true],
  ["delete 'abc'['01'];", "none", true],
  ["delete 'abc'['-0'];", "none", true],
  ["delete 'abc'[0];", "type", undefined],
  ["delete 'abc'.slice;", "none", true],

  ["let o={m(a,b){}};o.m.name==='m' && o.m.length===2;", "none", true],

  ["let f=function(a,b=1,c){};f.name==='f' && f.length===1;", "none", true],
  ["function f(a,b){}f.name==='f' && f.length===2;", "none", true],
  ["let f=(a,b)=>a;f.name==='f' && f.length===2;", "none", true],
  ["(function(){}).name;", "none", ""],

  [
    "let f=function self(a,b=1,c){};f.name==='self' && f.length===1;",
    "none",
    true,
  ],

  ["let f=function self(){return self;};f()===f;", "none", true],
  [
    "let f=function self(n){if(n===0)return 42;return self(n-1);};f(3);",
    "none",
    42,
  ],
  ["let f=function hidden(){};typeof hidden;", "none", "undefined"],
  [
    "let self=42;let f=function self(){return self;};f()===f && self===42;",
    "none",
    true,
  ],
  ["let f=function self(self){return self;};f(42);", "none", 42],
  ["let f=function self(){var self=42;return self;};f();", "none", 42],
  ["let f=function self(){let self=42;return self;};f();", "none", 42],
  ["let f=function self(x=self){return x;};f()===f;", "none", true],
  ["let f=function self(){return ()=>self;};f()()===f;", "none", true],
  ["let f=function self(){self=42;return self;};f();", "type", undefined],
  ["let f=function self(){self=42;return self;};f()===f;", "none", true, false],
  [
    "let f=function self(){throw self;};try{f();}catch(e){e===f;}",
    "none",
    true,
  ],
  ["let f=function self(){this.value=self;};new f().value===f;", "none", true],

  ["implicit=42;this.implicit;", "none", 42, false],
  ['"use strict";implicit=42;', "reference", undefined, false],
  ["function f(){return this;}f()===this;", "none", true, false],
  ['function f(){"use strict";return this;}f()===void 0;', "none", true, false],
  [
    "var outer=this;function f(){return ()=>this;}f()()===outer;",
    "none",
    true,
    false,
  ],
  ["function f(a,a){return a;}f(1,42);", "none", 42, false],
  ["function f(a,a){return a;}f(42);", "none", undefined, false],
  ["function f(a,a){a+=2;return a;}f(1,40);", "none", 42, false],
  ["function f(){return this;}let o={f};o.f()===o;", "none", true, false],
  [
    'function outer(){"use strict";return function(){return this;};}outer()()===void 0;',
    "none",
    true,
    false,
  ],
  ["nativeObject.fixed=42;nativeObject.fixed;", "none", 1, false],
  ['"use strict";nativeObject.fixed=42;', "type", undefined, false],
  ["const x=1;x=2;", "type", undefined, false],
  ["null.x=1;", "type", undefined, false],
  ["function f(){leak=42;}f();leak;", "none", 42, false],
  ['function f(){"use strict";leak=42;}f();', "reference", undefined, false],
  ["class C{m(){leak=42;}}new C().m();", "reference", undefined, false],
  [
    "class C{m(){return this;}}let m=new C().m;m()===void 0;",
    "none",
    true,
    false,
  ],
  ["var eval=42;eval;", "none", 42, false],
  ["let o={m(){return this;}};let m=o.m;m()===this;", "none", true, false],

  ["class C{get x(){return 42;}}new C().x;", "none", 42],
  [
    "class C{set x(v){this.y=v;}get x(){return this.y;}}let o=new C();o.x=42;o.x;",
    "none",
    42,
  ],
  [
    "class C{get x(){return this.y;}set x(v){this.y=v;}}let o=new C();o.x=42;o.x;",
    "none",
    42,
  ],
  [
    "class C{static get x(){return this.y;}static set x(v){this.y=v;}}C.x=42;C.x;",
    "none",
    42,
  ],
  ["class C{get x(){return 1;}get x(){return 42;}}new C().x;", "none", 42],
  ["class C{get x(){return 1;}x(){return 42;}}new C().x();", "none", 42],
  ["class C{x(){}get x(){return 42;}}new C().x;", "none", 42],
  ["class C{get x(){return 1;}set x(v){throw 99;}x=42;}new C().x;", "none", 42],
  ["class C{get x(){return 1;}}let o=new C();o.x=42;", "type", undefined],
  ["class C{set x(v){}}new C().x;", "none", undefined],
  ["class C{get x(){throw 42;}}try{new C().x;}catch(e){e;}", "none", 42],
  ["let n=0;class C{get [++n](){return 42;}}let o=new C();o[1]+n;", "none", 43],
  [
    "class C{get ['constructor'](){return 42;}}new C().constructor;",
    "none",
    42,
  ],
  ["class C{static get ['prototype'](){return 42;}}", "type", undefined],
  ["function f(C=class{}){return C.name;}f();", "none", "C"],
  ["let o={C:class{}};o.C.name;", "none", "C"],
  ["class C{m(D=class{}){return D.name;}}new C().m();", "none", "D"],
  [
    "class C{constructor(D=class{}){this.name=D.name;}}new C().name;",
    "none",
    "D",
  ],
  ["let C;C=class{};C.name;", "none", "C"],
  ["let C;C??=class{};C.name;", "none", "C"],
  ["let C=false;C||=class{};C.name;", "none", "C"],
  ["let C=true;C&&=class{};C.name;", "none", "C"],
  ["let C=(class{});C.name;", "none", "C"],
  ["let C;C=class Named{};C.name;", "none", "Named"],
  ["let o={};o.C=class{};o.C.name;", "none", ""],
  ["class C{x=class{};}new C().x.name;", "none", "x"],
  ["class C{static x=class{};}C.x.name;", "none", "x"],
  [
    "let key='first';class C{[key]=class{};}key='second';new C().first.name;",
    "none",
    "first",
  ],
  ["class C{x=class Named{};}new C().x.name;", "none", "Named"],
  [
    "let x=42;class C{x=class{m(){return x;}};}let D=new C().x;new D().m();",
    "none",
    42,
  ],
  ["class C{}typeof C;", "none", "function"],
  ["class C{}C.name;", "none", "C"],
  ["class C{}new C() instanceof C;", "none", true],
  ["class C{}C();", "type", undefined],
  ["class C{x=42;}new C().x;", "none", 42],
  ["class C{x;}new C().x;", "none", undefined],
  ["{let undefined=42;class C{x;}new C().x;}", "none", undefined],
  ["class C{x=41;y=this.x+1;}new C().y;", "none", 42],
  ["class C{x=41;constructor(){this.x++;}}new C().x;", "none", 42],
  ["class C{x=41;constructor(x=this.x+1){this.y=x;}}new C().y;", "none", 42],
  [
    "class C{constructor(x){this.x=x;}m(){return this.x;}}new C(42).m();",
    "none",
    42,
  ],
  ["class C{constructor(x,y=1,z){}}C.length;", "none", 1],
  ["class C{m(x,y=1){}}C.prototype.m.length;", "none", 1],
  ["class C{m(){}}C.prototype.m.name;", "none", "m"],
  ["class C{m(){}}new C.prototype.m();", "type", undefined],
  [
    "class C{m(){return this;}}let o={f:C.prototype.m};o.f()===o;",
    "none",
    true,
  ],
  ["class C{m(){return this;}}let f=C.prototype.m;f();", "none", undefined],
  ["class C{m(){return ()=>this;}}let o=new C();o.m()()===o;", "none", true],
  ["class C{f=()=>this;}let o=new C();o.f()===o;", "none", true],
  ["class C{m(){return C;}}let old=C;C=42;new old().m()===old;", "none", true],
  ["class C{m(){C=42;}}new C().m();", "type", undefined],
  ["typeof C;class C{}", "reference", undefined],
  ["class C{[C](){}}", "reference", undefined],
  ["let C=class Named{m(){return Named;}};new C().m()===C;", "none", true],
  ["let C=class Named{};typeof Named;", "none", "undefined"],
  ["let C=class{};C.name;", "none", "C"],
  ["class C{static x=42;}C.x;", "none", 42],
  ["class C{static x=C;static y=this;}C.x===C&&C.y===C;", "none", true],
  ["class C{static x=this.m();static m(){return 42;}}C.x;", "none", 42],
  ["class C{static x=41;static y=this.x+1;}C.y;", "none", 42],
  ["class C{static o=new C();x=42;}C.o.x;", "none", 42],
  ["let n=0;class C{static x=++n;y=++n;}new C();new C();n;", "none", 3],
  ["let n=0;class C{[++n]=42;}let a=new C();let b=new C();n;", "none", 1],
  ["class C{['x']=42;['m'](){return this.x;}}new C().m();", "none", 42],
  ["class C{constructor(){return 42;}}new C() instanceof C;", "none", true],
  ["let o={x:42};class C{constructor(){return o;}}new C()===o;", "none", true],
  [
    "let n=0;let o={};class C{x=++n;constructor(){return o;}}new C();n;",
    "none",
    1,
  ],
  [
    "let n=0;function f(){throw 42;}class C{x=f();constructor(){n=1;}}try{new C();}catch{}n;",
    "none",
    0,
  ],
  ["function f(){class C{x=42;}return new C();}f().x;", "none", 42],
  ["{class C{x=42;}new C().x;}", "none", 42],
  ["class C{}C.prototype.constructor===C;", "none", true],
  ["class C{['constructor'](){return 42;}}new C().constructor();", "none", 42],
  ["class C{static ['prototype']=42;}", "type", undefined],
  ["class C{static ['prototype'](){}}", "type", undefined],
  ["class C{static name=42;}C.name;", "none", 42],
  ["class C{x=1;x=42;}new C().x;", "none", 42],
  ["try{new Error(function(){});}catch{}42;", "none", 42],
  ["new Error({}).message;", "none", "[object Object]"],
  [
    "new Error({toString(){return {};},valueOf(){return 42;}}).message;",
    "none",
    "42",
  ],
  ["new Error({toString:0,valueOf(){return true;}}).message;", "none", "true"],
  [
    "try{new Error({toString(){return {};},valueOf(){return {};}});}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  ["try{new Error({toString(){throw 42;}});}catch(e){e;}", "none", 42],
  [
    "let n=0;new Error({toString(){n++;return 'x';},valueOf(){n+=10;return 0;}});n;",
    "none",
    1,
  ],
  [
    "let e=new Error();e.name={toString(){return 'N';}};e.message={toString(){return 'M';}};e.toString();",
    "none",
    "N: M",
  ],
  [
    "let n=0;let e=new Error();e.name={toString(){n=1;return 'N';}};e.message={toString(){return n;}};e.toString();",
    "none",
    "N: 1",
  ],
  [
    "let n=0;let e=new Error();e.name={toString(){throw 42;}};e.message={toString(){n=1;return 'x';}};try{e.toString();}catch{}n;",
    "none",
    0,
  ],
  [
    "function Options(){}Options.prototype.cause=42;new Error('x',new Options()).cause;",
    "none",
    42,
  ],
  [
    "let o={};let e=new Error();e.toString=o.toString;e.toString();",
    "none",
    "[object Error]",
  ],
  [
    "let o={};let e=Error.prototype;e.toString=o.toString;e.toString();",
    "none",
    "[object Object]",
  ],
  ["let e=new Error();e.valueOf()===e;", "none", true],
  ["let o={};o.valueOf()===o;", "none", true],
  [
    "let n=0;function Opt(){}Opt.prototype.cause=42;new Error({toString(){Opt.prototype.cause=19;return 'x';}},new Opt()).cause;",
    "none",
    19,
  ],
  ["new Error({toString(){return 'message';}}).message;", "none", "message"],
  ["typeof Error;", "none", "function"],
  ["Error.name;", "none", "Error"],
  ["TypeError.length;", "none", 1],
  ["new Error() instanceof Error;", "none", true],
  ["Error() instanceof Error;", "none", true],
  ["new TypeError() instanceof Error;", "none", true],
  ["new TypeError() instanceof TypeError;", "none", true],
  ["new TypeError().constructor===TypeError;", "none", true],
  ["new Error('message').message;", "none", "message"],
  ["Error(42).message;", "none", "42"],
  ["new Error(undefined).message;", "none", ""],
  ["new Error(null).message;", "none", "null"],
  ["new Error('x').toString();", "none", "Error: x"],
  ["new TypeError('x').toString();", "none", "TypeError: x"],
  ["new ReferenceError().toString();", "none", "ReferenceError"],
  ["let e=new Error('x');e.name='';e.toString();", "none", "x"],
  ["let e=new Error('');e.name='';e.toString();", "none", ""],
  ["let e=new Error('x');e.name=undefined;e.toString();", "none", "Error: x"],
  ["let e=new Error('x');e.message=undefined;e.toString();", "none", "Error"],
  [
    "let e=new Error();e.name=null;e.message=42;e.toString();",
    "none",
    "null: 42",
  ],
  [
    "let o={name:42,message:true,f:Error.prototype.toString};o.f();",
    "none",
    "42: true",
  ],
  [
    "let f=Error.prototype.toString;try{f();}catch(e){e instanceof TypeError;}",
    "none",
    true,
  ],
  ["new Error('x',{cause:42}).cause;", "none", 42],
  ["let cause={x:42};new TypeError('x',{cause}).cause===cause;", "none", true],
  ["new Error('x',42).cause;", "none", undefined],
  ["try{missing;}catch(e){e.constructor===ReferenceError;}", "none", true],
  ["try{null.x;}catch(e){e instanceof TypeError;}", "none", true],
  ["try{const x=1;x=2;}catch(e){e.name;}", "none", "TypeError"],
  ["Error.prototype.constructor===Error;", "none", true],
  ["new Error()===new Error();", "none", false],
  ["Error.prototype={};", "type", undefined],
  ["let o={x:42};o['x'];", "none", 42],
  ["let o={x:40};o['x']+=2;o.x;", "none", 42],
  ["let o={x:41};o['x']++;", "none", 41],
  ["let o={x:41};++o['x'];", "none", 42],
  ["let o={};o[42]=42;o['42'];", "none", 42],
  ["let o={};o[-0]=42;o[0];", "none", 42],
  ["let o={};o[null]=42;o['null'];", "none", 42],
  ["let o={};o[undefined]=42;o['undefined'];", "none", 42],
  ["let o={};o[true]=42;o['true'];", "none", 42],
  ["let o={x:42,f(){return this.x;}};(o['f'])();", "none", 42],
  ["let o={f(){return this;}};(0,o['f'])();", "none", undefined],
  [
    "let n=0;let o={x:41};function key(){n++;return 'x';}o[key()]++;n;",
    "none",
    1,
  ],
  ["let o={x:40};let saved=o;o[(o=null,'x')]+=2;saved.x;", "none", 42],
  ["let k='x';let o={x:1};o[k]=(k='y',42);o.x;", "none", 42],
  ["let n=0;try{null[(n=1,'x')]=(n=2);}catch{}n;", "none", 2],
  ["let n=0;try{null.x=(n=2);}catch{}n;", "none", 2],
  ["let n=0;try{undefined[(n=1,'x')]();}catch{}n;", "none", 1],
  [
    "let n=0;try{null[missing];}catch(e){n=e.name==='ReferenceError'?42:0;}n;",
    "none",
    42,
  ],
  [
    "let n=0;try{null[{}];}catch(e){n=e.name==='TypeError'?42:0;}n;",
    "none",
    42,
  ],
  ["nativeCounter['x']+=1;nativeCounter.readCount();", "none", 1],
  ["nativeCounter['x']++;nativeCounter.writeCount();", "none", 1],
  ["let o={x:42};o['x']||=missing;", "none", 42],
  ["var sum=0;for(var i=0;i<7;i++)sum+=i;sum;", "none", 21],
  ["for(var i=0;i<3;i++){}i;", "none", 3],
  ["let i=42;for(let i=0;i<3;i++){}i;", "none", 42],
  ["for(let i=0;i<3;i++){}typeof i;", "none", "undefined"],
  ["42;for(;false;){}", "none", undefined],
  ["for(var i=0;i<3;i++)i;", "none", 2],
  ["let i=0;for(;;){i++;if(i===3)break;}i;", "none", 3],
  ["let i=0;for(;i<3;i++){continue;}i;", "none", 3],
  ["let i=0;for(;i<3;i++){try{continue;}finally{i++;}}i;", "none", 4],
  ["let i=0;for(;i<3;i++){try{break;}finally{i++;}}i;", "none", 1],
  ["let i=0;while(i<3)i++;i;", "none", 3],
  ["let i=0;do{i++;continue;}while(i<3);i;", "none", 3],
  ["let i=0;do{i++;}while(false);i;", "none", 1],
  ["42;while(false){}", "none", undefined],
  ["let i=0;while(i++<3)i;", "none", 3],
  ["let i=0;do{try{continue;}finally{i++;}}while(i<3);i;", "none", 3],
  ["let f;for(let i=0;i<3;i++)f=()=>i;f();", "none", 2],
  ["let f;for(var i=0;i<3;i++)f=()=>i;f();", "none", 3],
  ["let f;for(let i=0;(f=()=>i,i<3);i++){}f();", "none", 3],
  ["let f;for(let i=0;i<3;(f=()=>i,i++)){}f();", "none", 3],
  ["let f;for(let i=0,g=()=>i;i<3;i++)f=g;f();", "none", 0],
  [
    "let a;let b;for(let i=0;i<2;i++){if(i===0)a=()=>i;else b=()=>i;}a()*10+b();",
    "none",
    1,
  ],
  [
    "let a;let b;for(let i=0;i<2;i++){if(i===0)a=()=>++i;else b=()=>i;}a()+b();",
    "none",
    2,
  ],
  ["let f;for(const i=42;;){f=()=>i;break;}f();", "none", 42],
  [
    "let n=0;for(let i=0;i<3;i++){switch(i){case 1:continue;default:n++;}}n;",
    "none",
    2,
  ],
  [
    "let n=0;for(let i=0;i<3;i++){for(let j=0;j<2;j++){continue;}n++;}n;",
    "none",
    3,
  ],
  [
    "function f(){for(let i=0;i<3;i++){try{return i;}finally{if(i===0)continue;}}}f();",
    "none",
    1,
  ],
  [
    "let i=0;let n=0;for(;i<3;i++){try{continue;}finally{n++;if(i===1)break;}}i*10+n;",
    "none",
    12,
  ],
  ["let i=0;for(i=42;false;){}", "none", undefined],
  ["let i=42;for(let i=i;;){}", "reference", undefined],
  ["for(const i=0;i<1;i++){}", "type", undefined],
  ["1<2;", "none", true],
  ["2>1;", "none", true],
  ["'2'<'10';", "none", false],
  ["'2'>'10';", "none", true],
  ["'a'<='aa';", "none", true],
  ["'aa'>='a';", "none", true],
  ["null<=0;", "none", true],
  ["true>0;", "none", true],
  ["'2'<10;", "none", true],
  ["undefined>=0;", "none", false],
  ["NaN<0;", "none", false],
  ["NaN>0;", "none", false],
  ["NaN<=0;", "none", false],
  ["NaN>=0;", "none", false],
  ["-0>=0;", "none", true],
  ["let x=1;x<(x=2);", "none", true],
  ["let n=0;function f(){n++;return n;}f()<f();", "none", true],
  ["let x='41';++x;", "none", 42],
  ["let x='42';x++;", "none", 42],
  ["let x='41';x++;x;", "none", 42],
  ["let x=43;--x;", "none", 42],
  ["let x=42;x--;", "none", 42],
  ["let x=null;x++;", "none", 0],
  ["let x=true;++x;", "none", 2],
  ["let x=-0;x++;", "none", -0],
  ["let x=undefined;x++;", "none", NaN],
  ["let x=40;x+=2;", "none", 42],
  ["let x='4';x+=2;", "none", "42"],
  ["let x=84;x/=2;", "none", 42],
  ["let x=43;x^=1;", "none", 42],
  ["let x=1;x+=(x=41);", "none", 42],
  ["let x=0;x&&=missing;", "none", 0],
  ["let x=42;x||=missing;", "none", 42],
  ["let x=0;x??=missing;", "none", 0],
  ["let x=null;x??=42;", "none", 42],
  ["let x=undefined;x??=42;", "none", 42],
  ["const x=0;x&&=missing;", "none", 0],
  ["const x=42;x||=missing;", "none", 42],
  ["const x=1;x&&=42;", "type", undefined],
  ["const x=41;++x;", "type", undefined],
  ["let o={x:40};o.x+=2;o.x;", "none", 42],
  ["let o={x:41};o.x++;", "none", 41],
  ["let o={x:40};let saved=o;o.x+=(o=null,2);saved.x;", "none", 42],
  [
    "let n=0;let o={x:41};function base(){n++;return o;}base().x++;n;",
    "none",
    1,
  ],
  ["nativeCounter.x+=1;nativeCounter.readCount();", "none", 1],
  ["nativeCounter.x++;nativeCounter.writeCount();", "none", 1],
  ["nativeCounter.x||=missing;nativeCounter.writeCount();", "none", 0],
  ["++nativeCounter.x;", "none", 42],
  ["nativeCounter.x++;", "none", 41],
  ["let x=0;try{missing+=(x=42);}catch{}x;", "none", 0],
  ["let x=0;try{null.x+=(x=42);}catch{}x;", "none", 0],

  ["switch(1){case 1:42;break;default:19;}", "none", 42],
  ["switch(2){default:19;case 2:42;}", "none", 42],
  ["switch(9){case 1:1;break;default:42;}", "none", 42],
  ["switch(1){case 1:19;case 2:42;}", "none", 42],
  ["switch(9){default:19;case 2:42;}", "none", 42],
  ["42;switch(1){}", "none", undefined],
  ["42;switch(1){case 2:19;}", "none", undefined],
  ["switch(1){case 1:break;}", "none", undefined],
  ["switch(1){case '1':19;break;default:42;}", "none", 42],
  ["switch(NaN){case NaN:19;break;default:42;}", "none", 42],
  ["switch(-0){case 0:42;break;default:19;}", "none", 42],
  ["let o={};switch(o){case {}:19;break;case o:42;}", "none", 42],
  ["switch(1){case 1:42;break;case missing:19;}", "none", 42],
  [
    'let s="";switch(2){case(s=s+"a",1):break;default:s=s+"d";case(s=s+"b",2):s=s+"x";case(s=s+"c",3):s=s+"y";}s;',
    "none",
    "abxy",
  ],
  [
    'let s="";switch(9){case(s=s+"a",1):break;default:s=s+"d";case(s=s+"b",2):s=s+"x";}s;',
    "none",
    "abdx",
  ],
  ["switch(1){case 1:let x=42;case 2:x;}", "none", 42],
  ["let x=1;switch(x){case 1:let x=42;x;}", "none", 42],
  ["let x=1;switch(x){case 1:let x=42;}x;", "none", 1],
  [
    "try{switch(1){case x:break;case 2:let x=42;}}catch(e){e.name;}",
    "none",
    "ReferenceError",
  ],
  [
    "try{switch(2){case 1:let x=42;case 2:x;}}catch(e){e.name;}",
    "none",
    "ReferenceError",
  ],
  ["switch(1){case 1:var x=42;break;}x;", "none", 42],
  ["let x=0;switch(1){case 1:try{break;}finally{x=42;}}x;", "none", 42],
  ["switch(1){case 1:try{42;break;}finally{19;}}", "none", 42],
  ["switch(1){case 1:switch(2){case 2:19;break;}42;break;}", "none", 42],
  [
    "function f(x){switch(x){case 1:return 42;default:return 19;}}f(1);",
    "none",
    42,
  ],

  ["40+2;", "none", 42],
  ['"4"+2;', "none", "42"],
  ['1+"2"+3;', "none", "123"],
  ["null+true;", "none", 1],
  ['undefined+"!";', "none", "undefined!"],
  ["undefined+1;", "none", NaN],
  ['"84"/2;', "none", 42],
  ['" 0x54 "/2;', "none", 42],
  ["1/-0;", "none", -Infinity],
  ["1/0;", "none", Infinity],
  ["0/0;", "none", NaN],
  ["-0;", "none", -0],
  ["+null;", "none", 0],
  ["-true;", "none", -1],
  ["~1;", "none", -2],
  ["-5%2;", "none", -1],
  ["6*7;", "none", 42],
  ['""-true;', "none", -1],
  ["1<<33;", "none", 2],
  ["-1>>>0;", "none", 4294967295],
  ["43&42;", "none", 42],
  ["40|2;", "none", 42],
  ["43^1;", "none", 42],
  ["let x=1;x+(x=41);", "none", 42],
  ["let x=1;try{missing+(x=42);}catch{}x;", "none", 1],
  ["NaN!==NaN;", "none", true],
  ["1/0===Infinity;", "none", true],
  ["try{Infinity=42;}catch(e){e.name;}", "none", "TypeError"],
  ["typeof undefined;", "none", "undefined"],

  ["function F(){}new F() instanceof F;", "none", true],
  ["function F(){}({}) instanceof F;", "none", false],
  ["function F(){}F.prototype instanceof F;", "none", false],
  ["function F(){}1 instanceof F;", "none", false],
  ["function F(){}null instanceof F;", "none", false],
  ["function F(){}let o=new F();F.prototype={};o instanceof F;", "none", false],
  [
    "function A(){}function B(){}B.prototype=new A();new B() instanceof A;",
    "none",
    true,
  ],
  ["function F(){}F.prototype=1;({}) instanceof F;", "type", undefined],
  ["function F(){}F.prototype=1;1 instanceof F;", "none", false],
  ["1 instanceof (()=>{});", "none", false],
  ["({}) instanceof (()=>{});", "type", undefined],
  ["({}) instanceof 1;", "type", undefined],
  ["1 instanceof {};", "type", undefined],
  ["missing instanceof 1;", "reference", undefined],
  ["let x=0;try{({}) instanceof (x=42);}catch{}x;", "none", 42],
  ["function F(){}let o=new F();o instanceof (o=null,F);", "none", true],
  ["1 instanceof nativePrototypeProbe;", "none", false],
  ["try{({}) instanceof nativePrototypeProbe;}catch(e){e;}", "none", 42],

  ["function F(x){this.x=x;}new F(42).x;", "none", 42],
  ["function F(x){this.x=x;}let o=new F(42);o.constructor===F;", "none", true],
  ["function F(){}F.prototype.constructor===F;", "none", true],
  ["function F(){}F.prototype.x=42;new F().x;", "none", 42],
  ["function F(){}F.prototype={x:42};new F().x;", "none", 42],
  ["function F(){this.x=42;return 1;}new F().x;", "none", 42],
  ["function F(){this.x=42;return null;}new F().x;", "none", 42],
  ["let o={x:42};function F(){return o;}new F()===o;", "none", true],
  ["function f(){}function F(){return f;}new F()===f;", "none", true],
  ["function F(){this.x=42;}F.prototype=null;new F().x;", "none", 42],
  ["function F(){this.x=42;}F.prototype=1;new F().x;", "none", 42],
  ["new (()=>42)();", "type", undefined],
  ["let o={f(){}};new o.f();", "type", undefined],
  ["let o={f:function(){this.x=42;}};new o.f().x;", "none", 42],
  ["new (0)(missing);", "reference", undefined],
  ["new (0)();", "type", undefined],
  ["function F(){throw 42;}try{new F();}catch(e){e;}", "none", 42],
  [
    "function F(){missing;}try{new F();}catch(e){e.name;}",
    "none",
    "ReferenceError",
  ],
  ["function F(x){this.x=x;}let C=F;new C(C=42).x;", "none", 42],
  ["function F(x=42){this.x=x;}new F().x;", "none", 42],
  ["let o={f(){}};typeof o.f.prototype;", "none", "undefined"],
  ["typeof (()=>42).prototype;", "none", "undefined"],

  ["({x:42}).x;", "none", 42],
  ["let x=42;({x}).x;", "none", 42],
  ["({x:1,x:42}).x;", "none", 42],
  ["let o={x:42,f(){return this.x;}};o.f();", "none", 42],
  ["({['x']:42}).x;", "none", 42],
  ["let x=1;let o={a:x,b:(x=42)};o.a;", "none", 1],
  ["let x=1;let o={a:(x=42),b:x};o.b;", "none", 42],
  ["({}) === ({});", "none", false],
  ["let o={x:1};let p=o;p.x=42;o.x;", "none", 42],
  ["let o={f(){return this;}};o.f()===o;", "none", true],
  ["let o={f(){return this;}};let f=o.f;f();", "none", undefined],
  ["({x:{y:42}}).x.y;", "none", 42],
  ["try{({x:missing});}catch(e){e.name;}", "none", "ReferenceError"],
  ["let x=1;try{({x:missing,y:(x=42)});}catch{}x;", "none", 1],

  ["try{(1).x;}catch{}42;", "none", 42],
  ["try{(1).x;}finally{throw 42;}", "throw", 42],
  ["done: {42;break done;19;}", "none", 42],
  ["42;done: ;", "none", 42],
  ["if(false){L:let\n{}}42;", "none", 42, false],
  ["if(false){L:let\nx=1;}42;", "none", 42, false],
  ["let x=0;a:b:while(true){x=42;break a;}x;", "none", 42],
  [
    "let x=0;outer:for(let i=0;i<3;i++){for(let j=0;j<3;j++){if(j===1)continue outer;x++;}}x;",
    "none",
    3,
  ],
  [
    "let x=0;outer:do{while(true){x++;continue outer;}}while(x<3);x;",
    "none",
    3,
  ],
  [
    "let s='';outer:while(true){try{while(true){try{break outer;}finally{s+='i';}}}finally{s+='o';}}s;",
    "none",
    "io",
  ],
  [
    "let s='';let i=0;outer:while(i++<2){try{while(true){try{continue outer;}finally{s+='i';}}}finally{s+='o';}}s;",
    "none",
    "ioio",
  ],
  [
    "let s='';outer:while(true){try{break outer;}finally{inner:while(true){s+='i';break inner;}s+='o';}}s;",
    "none",
    "io",
  ],
  [
    "let s='';let it={ [Symbol.iterator](){return this;},next(){return {value:1,done:false};},return(){s+='c';return {};}};outer:for(const x of [1,2]){for(const y of it){s+=x;continue outer;}}s;",
    "none",
    "1c2c",
  ],
  [
    "let s='';let it={ [Symbol.iterator](){return this;},next(){return {value:1,done:false};},return(){s+='c';return {};}};done:{for(const x of it){break done;}}s;",
    "none",
    "c",
  ],
  ["let x=0;a:b:for(const y of [1,2,3]){x+=y;continue a;}x;", "none", 6],
  [
    "let x='';outer:for(const k in {a:1,b:2}){switch(k){case 'a':continue outer;default:x+=k;}}x;",
    "none",
    "b",
  ],
  ["let x=0;done:{var y=42;break done;}y;", "none", 42],
  [
    "let x=0;outer:for(let i=0;i<3;i++){try{continue outer;}finally{if(i===1)break outer;x++;}}x;",
    "none",
    1,
  ],

  [
    "let s='';while(true){try{while(true){try{break;}finally{s+='i';}}s+='b';break;}finally{s+='o';}}s;",
    "none",
    "ibo",
  ],
  [
    "let s='';try{for(let i=0;i<2;i++){try{continue;}finally{s+='i';}}s+='b';}finally{s+='o';}s;",
    "none",
    "iibo",
  ],
  [
    "let s='';function f(){try{try{return 42;}finally{s+='i';}}finally{s+='o';}}f();s;",
    "none",
    "io",
  ],
  [
    "let s='';while(true){try{try{break;}finally{s+='i';}}finally{s+='o';}}s;",
    "none",
    "io",
  ],
  ["function f(){try{(1).x;}finally{return 42;}}f();", "none", 42],

  ["(function(x){return x;})(42);", "none", 42],
  ["((x)=>x)(42);", "none", 42],
  ["function f(x){return x;}f(42);", "none", 42],
  ["f(42);function f(x){return x;}", "none", 42],
  ["function f(){return 1;}function f(){return 42;}f();", "none", 42],
  ["function f(x){return x;}f();", "none", undefined],
  ["function f(){42;}f();", "none", undefined],
  ["function f(){return;}f();", "none", undefined],
  ["let x=42;let f=()=>x;f();", "none", 42],
  ["let x=1;let f=()=>x;x=42;f();", "none", 42],
  ["function f(x){return ()=>x;}let a=f(1);let b=f(42);a();b();", "none", 42],
  ["function f(x){return ()=>x;}let a=f(42);let b=f(1);b();a();", "none", 42],
  ["function f(x=42){var y=x;return y;}f();", "none", 42],
  ["function f(x=42){return x;}f(null);", "none", null],
  ["function f(x=42,y=x){return y;}f();", "none", 42],
  [
    "function f(x=y,y=42){return x;}try{f();}catch(e){e.name;}",
    "none",
    "ReferenceError",
  ],
  ["let x=42;function f(y=()=>x){var x=1;return y();}f();", "none", 42],
  ["function f(x){var x;return x;}f(42);", "none", 42],
  ["function f(){let x=42;return x;}f();", "none", 42],
  ["function f(){return g();function g(){return 42;}}f();", "none", 42],
  ["function f(x){if(x)return f(false);return 42;}f(true);", "none", 42],
  ["function f(){return this;}f();", "none", undefined],
  [
    "nativeObject.f=function(){return this;};nativeObject.f()===nativeObject;",
    "none",
    true,
  ],
  [
    "nativeObject.f=function(){return ()=>this;};nativeObject.f()()===nativeObject;",
    "none",
    true,
  ],
  ["nativeObject.f=()=>this;nativeObject.f()===this;", "none", true],
  ["function f(){throw 42;}try{f();}catch(e){e;}", "none", 42],
  [
    "function f(){missing;}try{f();}catch(e){e.name;}",
    "none",
    "ReferenceError",
  ],
  ["function f(){try{return 42;}finally{19;}}f();", "none", 42],
  ["function f(){try{return 1;}finally{return 42;}}f();", "none", 42],
  ["function f(){try{throw 1;}finally{return 42;}}f();", "none", 42],
  [
    "function f(){try{return 1;}finally{throw 42;}}try{f();}catch(e){e;}",
    "none",
    42,
  ],

  ["try {missing;} catch(e) {e.name;}", "none", "ReferenceError"],
  ["try {(0)();} catch(e) {e.name;}", "none", "TypeError"],
  [
    "try {let x=1;const y=2;y=3;} catch(e) {typeof e.message;}",
    "none",
    "string",
  ],
  ["try {throw 42;} catch(e) {e;}", "none", 42],
  ["try {throw null;} catch(e) {e;}", "none", null],
  ["try {throw void 0;} catch(e) {e;}", "none", undefined],
  ["try {nativeThrow(42);} catch(e) {e;}", "none", 42],
  ["try {42;} finally {19;}", "none", 42],
  ["42;try {} finally {}", "none", undefined],
  ["try {19;throw 1;} catch {}", "none", undefined],
  ["try {throw 1;} finally {throw 42;}", "throw", 42],
  ["try {throw 42;} finally {19;}", "throw", 42],
  ["let x=1;try {throw 42;}catch(x){x=19;}x;", "none", 1],
  ["try {throw 42;}catch(e){var e=19;e;}", "none", 19],
  ["try {throw 42;}catch(e){}typeof e;", "none", "undefined"],
  ["let x=0;try {throw 1;}catch(e){x=19;}finally{x=42;}x;", "none", 42],
  [
    "try {try{missing;}catch(e){throw e;}}catch(e){e.name;}",
    "none",
    "ReferenceError",
  ],

  ["throw 42;", "throw", 42],
  ['throw "failure";', "throw", "failure"],
  ["throw null;", "throw", null],
  ["throw void 0;", "throw", undefined],
  ["throw false;", "throw", false],
  ["throw missing;", "reference", undefined],
  ["if(true){throw 42;}missing;", "throw", 42],
  ["nativeThrow(42);missing;", "throw", 42],
  ['nativeThrow("failure");', "throw", "failure"],
  ["nativeThrow();", "throw", undefined],

  ["nativeObject.x=42;", "none", 42],
  ["nativeObject.x=42;nativeObject.x;", "none", 42],
  ["nativeObject.inherited=19;nativeObject.inherited;", "none", 19],
  ["nativeObject.self=42;", "type", undefined],
  ["nativeObject.self=missing;", "reference", undefined],
  ["null.x=missing;", "reference", undefined],
  ["null.x=42;", "type", undefined],
  ["(void 0).x=42;", "type", undefined],
  ["let o=nativeObject;o.x=(o=null,42);nativeObject.x;", "none", 42],
  ["nativeObject.input=42;nativeObject.output;", "none", 42],
  ["nativeObject.input=42;", "none", 42],
  ["nativeObject.fixed=42;", "type", undefined],

  ["nativeObject.inherited;", "none", 42],
  ["nativeObject.self === nativeObject;", "none", true],
  ["nativeObject.method() === nativeObject;", "none", true],
  ["let o=nativeObject;o.method(o=null)===nativeObject;", "none", true],
  ["let o=nativeObject;o.method((o=null).x);", "type", undefined],

  ["this.nativeIdentity(42);", "none", 42],
  ["this.nativeReceiver() === this;", "none", true],
  ["(this.nativeReceiver)() === this;", "none", true],
  ["(0,this.nativeReceiver)();", "none", undefined],
  ["this.absent;", "none", undefined],
  ["null.x;", "type", undefined],
  ["(void 0).x;", "type", undefined],
  ["this.absent(missing);", "reference", undefined],
  ["this.absent();", "type", undefined],

  ["typeof nativeIdentity;", "none", "function"],
  ["nativeIdentity(42);", "none", 42],
  ['nativeIdentity("text");', "none", "text"],
  ["nativeIdentity();", "none", undefined],
  ["nativeReceiver() === (void 0);", "none", true],
  ["var f=nativeIdentity;f(42);", "none", 42],
  ["var f=nativeIdentity;f(f=42);", "none", 42],
  ["let x=1;nativeIdentity(x,x=2);", "none", 1],
  ["let x=1;nativeIdentity(x,x=2);x;", "none", 2],
  ["(0)(42);", "type", undefined],
  ["(null)();", "type", undefined],
  ["(0)(missing);", "reference", undefined],
  ["missing(42);", "reference", undefined],
  ["nativeIdentity(missing);", "reference", undefined],
  ["let x=1;{let x=42;x;}", "none", 42],
  ["let x=42;{let x=1;}x;", "none", 42],
  ["let x=1;{x;let x=42;}", "reference", undefined],
  ["let x=1;{typeof x;let x=42;}", "reference", undefined],
  ["{const x=1;x=2;}", "type", undefined],
  ["{let x;}typeof x;", "none", "undefined"],
  ["{var x=42;}x;", "none", 42],
  ["if(false){var x=42;}x;", "none", undefined],
  ["42;{}", "none", 42],
  ["42;{let x;}", "none", 42],
  ["42;if(true){}", "none", undefined],
  ["{1;{42;let x;}var y;}", "none", 42],
  ["let x=1;{x=42;}x;", "none", 42],
  ["let x=1;{let x=2;{let x=42;x;}x;}", "none", 2],
  ["if(true){let x=42;x;}else{missing;}", "none", 42],
  ["if(false){missing;}else{const x=42;x;}", "none", 42],
  ["{let x=x;}", "reference", undefined],
  ["{let x=42,y=x;y;}", "none", 42],
  ["42;if(false)1;", "none", undefined],
  ["42;if(true);", "none", undefined],
  ["42;if(true)var x=1;", "none", undefined],
  ["if(true)42;else missing;", "none", 42],
  ["if(false)missing;else 42;", "none", 42],
  ["if(true)if(false)missing;else 42;", "none", 42],
  ["if(false)var x=1; x;", "none", undefined],
  ["if(missing)42;", "reference", undefined],
  ["if(true)missing;else 42;", "reference", undefined],
  ["let x=0;if(x=1)x=42;else x=2;x;", "none", 42],
  ["if(false)missing;42;", "none", 42],
  ["false && missing;", "none", false],
  ["true || missing;", "none", true],
  ["true && missing;", "reference", undefined],
  ["false || missing;", "reference", undefined],
  ["null ?? 42;", "none", 42],
  ["(void 0) ?? 42;", "none", 42],
  ["0 ?? missing;", "none", 0],
  ["false ?? missing;", "none", false],
  ['"" ?? missing;', "none", ""],
  ["null ?? missing;", "reference", undefined],
  ["(this ?? missing) === this;", "none", true],
  ["true ? 42 : missing;", "none", 42],
  ["false ? missing : 42;", "none", 42],
  ["null ? missing : 42;", "none", 42],
  ["this ? 42 : missing;", "none", 42],
  ["missing ? 1 : 2;", "reference", undefined],
  ["let x=0; false && (x=1); x;", "none", 0],
  ["let x=0; true || (x=1); x;", "none", 0],
  ["let x=0; (x=1) && (x=42); x;", "none", 42],
  ["let x=0; (x=1) ? (x=42) : (x=2); x;", "none", 42],
  ['false || "value";', "none", "value"],
  ["false && x; let x;", "none", false],
  ["true && x; let x;", "reference", undefined],
  ["true ? (false || 42) : missing;", "none", 42],
  ["false ? missing : (null ?? (true && 42));", "none", 42],
  ["!null;", "none", true],
  ["!(void 0);", "none", true],
  ["!false;", "none", true],
  ["!true;", "none", false],
  ["!0;", "none", true],
  ["!42;", "none", false],
  ['!"";', "none", true],
  ['!"0";', "none", false],
  ["!this;", "none", false],
  ["!!this;", "none", true],
  ["!missing;", "reference", undefined],
  ["!x; let x;", "reference", undefined],
  ["let x; !(x=42); x;", "none", 42],
  ["var x=1; let y=42; x=y; x;", "none", 42],
  ["42; var x;", "none", 42],
  ["let x; x;", "none", undefined],
  ["const x=1; x=2;", "type", undefined],
  ["x; let x=42;", "reference", undefined],
  ["missing=42;", "reference", undefined],
  ["var x; x=42; var x; x;", "none", 42],
  ['1 === "1";', "none", false],
  ['1 !== "1";', "none", true],
  ["var x=1; x === (x=2);", "none", false],
  ["var x=1; (x=2,x=42);", "none", 42],
  ["void missing;", "reference", undefined],
  ["void 0;", "none", undefined],
  ["null === (void 0);", "none", false],
  ["this === this;", "none", true],
  ["this !== null;", "none", true],
  ['var x="same"; x === "same";', "none", true],
  ["typeof missing;", "none", "undefined"],
  ["typeof (missing);", "none", "undefined"],
  ["typeof (0,missing);", "reference", undefined],
  ["typeof x;let x;", "reference", undefined],
  ["typeof null;", "none", "object"],
  ["typeof this;", "none", "object"],
  ["typeof true;", "none", "boolean"],
  ["typeof 1;", "none", "number"],
  ['typeof "text";', "none", "string"],
  ["typeof (void 0);", "none", "undefined"],
  ["var x;typeof (x=42);", "none", "number"],
  [
    "function*g(){}const r=g().next();r.done&&r.value===undefined;",
    "none",
    true,
  ],
  [
    "let n=0;function*g(a=++n){n+=10;return a;}const i=g();let eager=n===1;const r=i.next(99);eager&&r.done&&r.value===1&&n===11;",
    "none",
    true,
  ],
  [
    "let n=0;function*g(){n++;return 1;}const i=g();const r=i.return(42);r.done&&r.value===42&&n===0&&i.next().done;",
    "none",
    true,
  ],
  [
    "let n=0;function*g(){n++;}const i=g();let caught=false;try{i.throw(42);}catch(e){caught=e===42;}caught&&n===0&&i.next().done;",
    "none",
    true,
  ],
  [
    "let n=0;function*g([a]){n++;return a;}let caught=false;try{g(null);}catch(e){caught=e instanceof TypeError;}caught&&n===0;",
    "none",
    true,
  ],
  ["function*g(){return 42;}new g();", "type", undefined],
  ["const g=function*self(){return self;};g().next().value===g;", "none", true],
  ["const o={a:42,*g(){return this.a;}};o.g().next().value;", "none", 42],
  [
    "const p={a:42};const o={__proto__:p,*g(){return super.a;}};o.g().next().value;",
    "none",
    42,
  ],
  [
    "function*g(a){return ()=>arguments[0]+a;}g(21).next().value();",
    "none",
    42,
  ],
  [
    "function*g(){function f(){return 42;}return f();}g().next().value;",
    "none",
    42,
  ],
  [
    "function*g(){try{return 19;}finally{return 42;}}g().next().value;",
    "none",
    42,
  ],
  [
    "function*g(){return new.target;}g().next().value===undefined;",
    "none",
    true,
  ],
  [generatorPrototypeLookupCase, "none", true],
  [
    "function*g(){return 42;}g.prototype=0;const i=g();Object.getPrototypeOf(i)===Object.getPrototypeOf(g).prototype;",
    "none",
    true,
  ],
  [
    "class C{value=42;*g(){return this.value;}}new C().g().next().value;",
    "none",
    42,
  ],
  [
    "class C{static value=42;static *g(){return this.value;}}C.g().next().value;",
    "none",
    42,
  ],
  [
    "class B{get x(){return 42;}}class C extends B{*g(){return super.x;}}new C().g().next().value;",
    "none",
    42,
  ],
  [
    "class B{static x=42;}class C extends B{static *g(){return super.x;}}C.g().next().value;",
    "none",
    42,
  ],
  [
    "class C{#x=42;*#g(){return this.#x;}read(){return this.#g();}}new C().read().next().value;",
    "none",
    42,
  ],
  [
    "class C{static #x=42;static *#g(){return this.#x;}static read(){return this.#g();}}C.read().next().value;",
    "none",
    42,
  ],
  [
    "let n=0;class C{*g(x=++n){n+=10;return x;}}const i=new C().g();n===1&&i.next().value===1&&n===11;",
    "none",
    true,
  ],
  [
    "class C{*g(a,b=1){}}const d=Object.getOwnPropertyDescriptor(C.prototype,'g');d.writable&&!d.enumerable&&d.configurable&&d.value.name==='g'&&d.value.length===1;",
    "none",
    true,
  ],
  ["class C{*g(){}}new C.prototype.g();", "type", undefined],
  [
    "class C{*g(){return arguments[0];}}new C().g(42).next().value;",
    "none",
    42,
  ],
  [
    "function*g(){yield 1;yield 2;return 42;}const i=g();const a=i.next(99),b=i.next(),c=i.next();a.value===1&&!a.done&&b.value===2&&!b.done&&c.value===42&&c.done&&i.next().done;",
    "none",
    true,
  ],
  [
    "function*g(){const a=yield 1;const b=yield a;return a+b;}const i=g();i.next();i.next(19);i.next(23).value;",
    "none",
    42,
  ],
  [
    "function*g(){return (yield 1)+(yield 2);}const i=g();i.next();i.next(19);i.next(23).value;",
    "none",
    42,
  ],
  [
    "function*g(){yield;return 42;}const i=g();const r=i.next(99);r.value===undefined&&!r.done&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "let n=0;function*g(){n++;yield 1;n++;return 19;}const i=g();i.next();const r=i.return(42);r.done&&r.value===42&&n===1&&i.next().done;",
    "none",
    true,
  ],
  [
    "let n=0;function*g(){yield 1;n++;}const i=g();i.next();let caught=false;try{i.throw(42);}catch(e){caught=e===42;}caught&&n===0&&i.next().done;",
    "none",
    true,
  ],
  [
    "function*g(){let a=19;yield ()=>a;a=42;return a;}const i=g();const f=i.next().value;i.next();f();",
    "none",
    42,
  ],
  [
    "function*g(){yield yield 19;return 42;}const i=g();i.next().value===19&&i.next(23).value===23&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "class C{#x=19;*#g(){yield this.#x;this.#x=42;return this.#x;}g(){return this.#g();}}const i=new C().g();i.next().value===19&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "class B{get x(){return 42;}}class C extends B{*g(){yield 1;return super.x;}}const i=new C().g();i.next();i.next().value;",
    "none",
    42,
  ],
  [
    "let i;function*g(){let caught=false;try{i.next();}catch(e){caught=e instanceof TypeError;}yield caught;return 42;}i=g();i.next().value&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){function*h(){yield 19;return 42;}yield h();return 23;}const i=g();const inner=i.next().value;inner.next().value===19&&inner.next().value===42&&i.next().value===23;",
    "none",
    true,
  ],
  [
    "function*g(){const held={x:42};yield held;return held;}const i=g(),held=i.next().value;for(let k=0;k<5000;k++){const garbage={x:k};}const r=i.next();r.done&&r.value===held&&held.x===42;",
    "none",
    true,
  ],
  [
    "function*g(){yield* [19,23];return 42;}const i=g();i.next().value===19&&i.next().value===23&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){yield* 'ab';}const i=g();i.next().value==='a'&&i.next().value==='b'&&i.next().done;",
    "none",
    true,
  ],
  [
    "function*h(){yield 19;return 42;}function*g(){return yield* h();}const i=g();i.next().value===19&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "let n=0,reads=0;const result={get done(){reads++;return false;},get value(){throw 99;}};const iter={[Symbol.iterator](){return this;},next(){n++;return result;}};function*g(){yield* iter;}const i=g();i.next()===result&&n===1&&reads===1;",
    "none",
    true,
  ],
  [
    "let n=0;const iter={[Symbol.iterator](){return this;},next(v){n++;return {value:n===1?19:v,done:n>1};}};function*g(){return yield* iter;}const i=g();i.next();iter.next=function(){throw 99;};i.next(42).value;",
    "none",
    42,
  ],
  [
    "let n=0;function*g(){yield* [1,2];n++;}const i=g();i.next();const r=i.return(42);r.done&&r.value===42&&n===0;",
    "none",
    true,
  ],
  [
    "let closed=0,argc=-1;const iter={[Symbol.iterator](){return this;},next(){return {done:false};},return(){closed++;argc=arguments.length;return {};}};function*g(){yield* iter;}const i=g();i.next();let caught=false;try{i.throw(99);}catch(e){caught=e instanceof TypeError;}caught&&closed===1&&argc===0&&i.next().done;",
    "none",
    true,
  ],
  [
    "const iter={[Symbol.iterator](){return this;},next(){return {done:false};},return(){throw 42;}};function*g(){yield* iter;}const i=g();i.next();let value;try{i.throw(99);}catch(e){value=e;}value;",
    "none",
    42,
  ],
  [
    "const iter={[Symbol.iterator](){return this;},next(){return {value:19,done:false};},throw(v){return {value:v,done:true};}};function*g(){const x=yield* iter;return x+1;}const i=g();i.next();i.throw(41).value;",
    "none",
    42,
  ],
  [
    "let n=0;const iter={[Symbol.iterator](){return this;},next(){n++;return {value:41,done:n>1};},return(v){return {value:v,done:false};}};function*g(){return (yield* iter)+1;}const i=g();i.next();const r=i.return(19);r.value===19&&!r.done&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "let n=0;const iter={[Symbol.iterator](){return this;},next(){return {done:false};},return(v){return {value:v,done:true};}};function*g(){yield* iter;n++;}const i=g();i.next();const r=i.return(42);r.done&&r.value===42&&n===0;",
    "none",
    true,
  ],
  [
    "let n=0;const iter={[Symbol.iterator](){n++;return this;},next(){return {done:true};}};function*g(){yield* iter;}const i=g();i.return(42).value===42&&n===0;",
    "none",
    true,
  ],
  [
    "function*g(x){if(x)yield 19;else yield 23;return 42;}const a=g(true),b=g(false);a.next().value===19&&b.next().value===23&&a.next().value===42&&b.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(x){return x ? yield 1 : yield 2;}const a=g(true),b=g(false);a.next().value===1&&b.next().value===2&&a.next(19).value===19&&b.next(42).value===42;",
    "none",
    true,
  ],
  [
    "function*g(x){return x&&(yield 42);}const a=g(false),b=g(true);a.next().done&&b.next().value===42&&b.next(19).value===19;",
    "none",
    true,
  ],
  [
    "function*g(){return false&&(yield missing);}g().next().value===false;",
    "none",
    true,
  ],
  [
    "function*g(){return null?.m(yield missing);}g().next().done;",
    "none",
    true,
  ],
  [
    "let n=0;function*g(){{let x=yield 19;n+=x;yield x+1;}n++;return n;}const i=g();i.next().value===19&&i.next(20).value===21&&i.next().value===21;",
    "none",
    true,
  ],
  [
    "let n=0;function*g(x){if(x){yield 19;return 42;}n++;return 23;}const i=g(true);i.next();i.next().value===42&&n===0;",
    "none",
    true,
  ],
  [
    "let n=0;function*g(){if(true){yield 19;n++;}n++;}const i=g();i.next();i.return(42).value===42&&n===0&&i.next().done;",
    "none",
    true,
  ],
  [
    "let n=0;function*g(){if(true){yield 19;n++;}n++;}const i=g();i.next();let caught=false;try{i.throw(42);}catch(e){caught=e===42;}caught&&n===0&&i.next().done;",
    "none",
    true,
  ],
  [
    "function*g(x){if(x){if(x===1)yield 19;else yield 23;}yield 42;}const i=g(2);i.next().value===23&&i.next().value===42&&i.next().done;",
    "none",
    true,
  ],
  [
    "function*g(){let x=19;{let x=yield 1;yield ()=>x;}return x;}const i=g();i.next();const f=i.next(42).value;i.next().value===19&&f()===42;",
    "none",
    true,
  ],
  [
    "function*g(x){if(x)yield* [19,23];yield 42;}const i=g(true);i.next().value===19&&i.next().value===23&&i.next().value===42&&i.next().done;",
    "none",
    true,
  ],
  [
    "function*g(){let i=0;while(i<3){yield i++;}return 42;}const i=g();i.next().value===0&&i.next().value===1&&i.next().value===2&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){for(let i=0;i<4;i++){if(i===1)continue;yield i;if(i===2)break;}return 42;}const i=g();i.next().value===0&&i.next().value===2&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){let i=0;do{yield i++;}while(i<2);return 42;}const i=g();i.next().value===0&&i.next().value===1&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){for(const k in {a:1,b:2})yield k;}const i=g();i.next().value==='a'&&i.next().value==='b'&&i.next().done;",
    "none",
    true,
  ],
  [
    "function*g(){for(let i=0;i<3;i++)yield ()=>i;}const i=g(),a=i.next().value,b=i.next().value,c=i.next().value;i.next().done&&a()===0&&b()===1&&c()===2;",
    "none",
    true,
  ],
  [
    "function*g(){for(let i=0;i<2;i++){for(let j=0;j<2;j++){yield i*10+j;break;}}}const i=g();i.next().value===0&&i.next().value===10&&i.next().done;",
    "none",
    true,
  ],
  [
    "function*g(){let i=0;while(i<2){let j=0;while(j<3){j++;if(j===1)continue;break;}yield j;i++;}}const i=g();i.next().value===2&&i.next().value===2&&i.next().done;",
    "none",
    true,
  ],
  [
    "function*g(){for(let i=0;i<2;i++){switch(i){case 0:break;case 1:break;}yield i;}}const i=g();i.next().value===0&&i.next().value===1&&i.next().done;",
    "none",
    true,
  ],
  [
    "function*g(){for(let i=0;i<2;i++){switch(i){case 0:continue;case 1:break;}yield i;}}const i=g();i.next().value===1&&i.next().done;",
    "none",
    true,
  ],
  [
    "let n=0;function*g(){while(true){yield 1;n++;}}const i=g();i.next();i.return(42).value===42&&n===0&&i.next().done;",
    "none",
    true,
  ],
  [
    "function*g(){let n=0;while(yield n){n++;}return 42;}const i=g();i.next().value===0&&i.next(true).value===1&&i.next(false).value===42;",
    "none",
    true,
  ],
  [
    "function*g(){for(let n=0;n<2;yield n++){}return 42;}const i=g();i.next().value===0&&i.next().value===1&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){let n=0;do{n++;if(n===1)continue;yield n;}while(n<3);}const i=g();i.next().value===2&&i.next().value===3&&i.next().done;",
    "none",
    true,
  ],
  [
    "function*g(){for(let n=0;n<10000;n++){if(n===9999)yield 42;}return 19;}const i=g();i.next().value===42&&i.next().value===19;",
    "none",
    true,
  ],
  [
    "function*g(){try{yield 1;throw 42;}catch(e){yield e;}return 19;}const i=g();i.next().value===1&&i.next().value===42&&i.next().value===19;",
    "none",
    true,
  ],
  [
    "function*g(){try{yield 1;}catch(e){yield e;return 19;}}const i=g();i.next();i.throw(42).value===42&&i.next().value===19;",
    "none",
    true,
  ],
  [
    "let caught=false;function*g(){try{yield 1;}catch(e){caught=true;}throw 42;}const i=g();i.next();let v;try{i.next();}catch(e){v=e;}v===42&&!caught&&i.next().done;",
    "none",
    true,
  ],
  [
    "function*g(){try{try{yield 1;}catch(e){yield e;throw 19;}}catch(e){return e;}}const i=g();i.next();i.throw(42).value===42&&i.next().value===19;",
    "none",
    true,
  ],
  [
    "function*g(){try{yield 1;}catch({x}){yield x;return x+1;}}const i=g();i.next();i.throw({x:41}).value===41&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){try{yield 1;}catch{yield 42;}}const i=g();i.next();i.throw(19).value===42&&i.next().done;",
    "none",
    true,
  ],
  [
    "let caught=false;function*g(){try{yield 1;}catch(e){caught=true;}}const i=g();i.next();const r=i.return(42);r.done&&r.value===42&&!caught;",
    "none",
    true,
  ],
  [
    "function*g(){try{while(true){yield 1;}}catch(e){return e;}}const i=g();i.next();i.next();i.throw(42).value===42&&i.next().done;",
    "none",
    true,
  ],
  [
    "function*g(){try{yield* [1];}catch(e){yield e instanceof TypeError;return 42;}}const i=g();i.next();i.throw(19).value===true&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "const source={[Symbol.iterator](){return this;},next(){throw 42;}};function*g(){try{yield* source;}catch(e){return e;}}g().next().value===42;",
    "none",
    true,
  ],
  [
    "const source={[Symbol.iterator](){return this;},next(){return {value:1,done:false};},throw(){throw 42;}};function*g(){try{yield* source;}catch(e){return e;}}const i=g();i.next();i.throw(19).value===42;",
    "none",
    true,
  ],
  [
    "let caught=false;function*g(){try{yield 1;throw 19;}catch(e){yield e;throw 42;}}const i=g();i.next();i.next();let v;try{i.next();}catch(e){v=e;}v===42&&i.next().done;",
    "none",
    true,
  ],
  [
    "function*g(){try{try{yield 1;}catch({x}){yield x;}}catch(e){return e instanceof TypeError;}}const i=g();i.next();i.throw(null).value===true;",
    "none",
    true,
  ],
  [
    "let caught=false;function*g(){while(true){try{yield 1;break;}catch(e){caught=true;}}throw 42;}const i=g();i.next();let v;try{i.next();}catch(e){v=e;}v===42&&!caught;",
    "none",
    true,
  ],
  [
    "let n=0;function*g(){try{yield 1;}finally{n++;yield 2;n++;}return 42;}const i=g();i.next().value===1&&n===0&&i.next().value===2&&n===1&&i.next().value===42&&n===2;",
    "none",
    true,
  ],
  [
    "function*g(){try{yield 1;}finally{yield 2;}}const i=g();i.next();const a=i.return(42),b=i.next(19);!a.done&&a.value===2&&b.done&&b.value===42;",
    "none",
    true,
  ],
  [
    "function*g(){try{yield 1;}finally{yield 2;}}const i=g();i.next();const a=i.throw(42);let e;try{i.next();}catch(x){e=x;}a.value===2&&!a.done&&e===42&&i.next().done;",
    "none",
    true,
  ],
  [
    "function*g(){try{return 42;}finally{yield 2;}}const i=g();i.next().value===2&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){try{throw 42;}finally{yield 2;}}const i=g();i.next();let e;try{i.next();}catch(x){e=x;}e===42;",
    "none",
    true,
  ],
  [
    "function*g(){try{return 1;}finally{yield 2;return 42;}}const i=g();i.next().value===2&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){try{return 1;}finally{yield 2;}}const i=g();i.next();const r=i.return(42);r.done&&r.value===42;",
    "none",
    true,
  ],
  [
    "function*g(){try{return 1;}finally{yield 2;}}const i=g();i.next();let e;try{i.throw(42);}catch(x){e=x;}e===42;",
    "none",
    true,
  ],
  [
    "function*g(){try{try{yield 1;}finally{yield 2;}}finally{yield 3;}}const i=g();i.next();i.return(42).value===2&&i.next().value===3&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){try{try{yield 1;}finally{yield 2;}}finally{yield 3;}}const i=g();i.next();i.return(19);i.return(42).value===3&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){try{yield 1;}catch(e){yield e;}finally{yield 2;}return 42;}const i=g();i.next();i.throw(19).value===19&&i.next().value===2&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){try{yield 1;}catch(e){yield e;}finally{yield 2;}}const i=g();i.next();i.throw(19);i.return(42).value===2&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){let n=0;while(n<2){try{yield n++;continue;}finally{yield 10+n;}}return 42;}const i=g();i.next().value===0&&i.next().value===11&&i.next().value===1&&i.next().value===12&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){while(true){try{yield 1;break;}finally{yield 2;}}return 42;}const i=g();i.next().value===1&&i.next().value===2&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){try{while(true){yield 1;return 42;}}finally{yield 2;}}const i=g();i.next();i.next().value===2&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){try{yield* [1,2];}finally{yield 3;}}const i=g();i.next();i.return(42).value===3&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){try{yield* [1];}finally{yield 2;}}const i=g();i.next();i.throw(42).value===2;let e;try{i.next();}catch(x){e=x;}e instanceof TypeError;",
    "none",
    true,
  ],
  [
    "let n=0;function*g(){try{yield 1;}finally{n++;yield 2;}}const i=g();i.return(42).value===42&&n===0;",
    "none",
    true,
  ],
  [
    "let caught=false;function*g(){try{try{yield 1;}catch(e){caught=true;}}finally{yield 2;throw 42;}}const i=g();i.next();i.next();let e;try{i.next();}catch(x){e=x;}e===42&&!caught;",
    "none",
    true,
  ],
  [
    "function*g(){try{try{yield 1;}finally{yield 2;throw 42;}}catch(e){yield e;}}const i=g();i.next();i.next();i.next().value===42&&i.next().done;",
    "none",
    true,
  ],
  [
    "function*g(){for(const x of [1,2])yield x;return 42;}const i=g();i.next().value===1&&i.next().value===2&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "let closed=0;const source={[Symbol.iterator](){return this;},next(){return {value:1,done:false};},return(){closed++;return {};}};function*g(){for(const x of source)yield x;}const i=g();i.next();closed===0&&i.return(42).value===42&&closed===1;",
    "none",
    true,
  ],
  [
    "let closed=0;const source={[Symbol.iterator](){return this;},next(){return {value:1,done:false};},return(){closed++;throw 19;}};function*g(){for(const x of source)yield x;}const i=g();i.next();let e;try{i.throw(42);}catch(x){e=x;}e===42&&closed===1;",
    "none",
    true,
  ],
  [
    "let closed=0;const source={[Symbol.iterator](){return this;},next(){return {value:1,done:false};},return(){closed++;throw 19;}};function*g(){for(const x of source)yield x;}const i=g();i.next();let e;try{i.return(42);}catch(x){e=x;}e===19&&closed===1;",
    "none",
    true,
  ],
  [
    "function*g(){try{yield 1;}finally{try{yield 2;}catch(e){yield e;}}return 42;}const i=g();i.next();i.next();i.throw(19).value===19&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(x){switch(x){case 1:yield 1;case 2:yield 2;break;default:yield 3;}return 42;}const i=g(1);i.next().value===1&&i.next().value===2&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(x){switch(x){case 1:yield 1;default:yield 2;case 3:yield 3;}return 42;}const i=g(0);i.next().value===2&&i.next().value===3&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){switch(9){case 1:yield 1;}return 42;}const i=g();const r=i.next();r.done&&r.value===42;",
    "none",
    true,
  ],
  [
    "let n=0;function*g(){switch(yield 1){case (n++,yield 2):yield 3;break;case (n++,yield 4):yield 5;}return 42;}const i=g();i.next().value===1&&i.next(19).value===2&&i.next(19).value===3&&n===1&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){for(let n=0;n<2;n++){switch(n){case 0:yield 1;continue;case 1:yield 2;break;}yield 3;}return 42;}const i=g();i.next().value===1&&i.next().value===2&&i.next().value===3&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){switch(1){case 1:let x=yield 1;case 2:yield x;}return 42;}const i=g();i.next().value===1&&i.next(19).value===19&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){try{switch(1){case 1:yield 1;return 42;}}finally{yield 2;}}const i=g();i.next();i.next().value===2&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){switch(1){case 1:try{yield 1;break;}finally{yield 2;}case 2:yield 3;}return 42;}const i=g();i.next();i.next().value===2&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){try{switch(1){case 1:yield 1;case 2:throw 42;}}catch(e){yield e;}}const i=g();i.next();i.next().value===42&&i.next().done;",
    "none",
    true,
  ],
  [
    "function*g(){switch(1){case 1:while(true){yield 1;break;}yield 2;break;default:yield 3;}return 42;}const i=g();i.next().value===1&&i.next().value===2&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){outer:while(true){yield 1;break outer;}return 42;}const i=g();i.next().value===1&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){outer:inner:for(let n=0;n<2;n++){yield n;continue outer;}return 42;}const i=g();i.next().value===0&&i.next().value===1&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){done:{yield 1;break done;yield 2;}return 42;}const i=g();i.next().value===1&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){outer:while(true){try{yield 1;break outer;}finally{yield 2;}}return 42;}const i=g();i.next().value===1&&i.next().value===2&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){outer:for(let n=0;n<2;n++){try{for(let m=0;m<2;m++){yield n;continue outer;}}finally{yield n+10;}}return 42;}const i=g();i.next().value===0&&i.next().value===10&&i.next().value===1&&i.next().value===11&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){outer:while(true){switch(1){case 1:yield 1;break outer;}}return 42;}const i=g();i.next().value===1&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){done:{inner:{yield 1;break inner;}yield 2;break done;}return 42;}const i=g();i.next().value===1&&i.next().value===2&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "let closed=0;const source={[Symbol.iterator](){return this;},next(){return {value:1,done:false};},return(){closed++;return {};}};function*g(){outer:for(let n=0;n<2;n++){for(const x of source){yield n;continue outer;}}return 42;}const i=g();i.next().value===0&&closed===0&&i.next().value===1&&closed===1&&i.next().value===42&&closed===2;",
    "none",
    true,
  ],
  [
    "function*g(){outer:for(const n of [1,2]){yield n;continue outer;}return 42;}const i=g();i.next().value===1&&i.next().value===2&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){outer:while(true){yield 1;inner:while(true){break inner;}break outer;}return 42;}const i=g();i.next().value===1&&i.next().value===42;",
    "none",
    true,
  ],
  [
    "function*g(){let n=0;outer:do{yield n++;continue outer;}while(n<2);return 42;}const i=g();i.next().value===0&&i.next().value===1&&i.next().value===42;",
    "none",
    true,
  ],
  [
    'function*g(){outer:for(const n in {a:1,b:2}){yield n;continue outer;}return 42;}const i=g();i.next().value==="a"&&i.next().value==="b"&&i.next().value===42;',
    "none",
    true,
  ],
  [
    'function*g(){return `1${yield}3${4}5`;}const i=g();const a=i.next(),b=i.next(2);!a.done&&a.value===undefined&&b.done&&b.value==="12345";',
    "none",
    true,
  ],
  [
    'function*g(){return `1${yield}3${yield}5`;}const i=g();i.next();i.next(2);i.next(4).value==="12345";',
    "none",
    true,
  ],
  ["let values=42;with([]){values;}", "none", 42, false],
  [
    'typeof 42n === "bigint" && 21n + 21n === 42n && 0xffffn === 65535n;',
    "none",
    true,
  ],
  [
    "!0n && !!1n && (0n ? false : true) && (0n || 42) === 42 && (0n && 1) === 0n;",
    "none",
    true,
  ],
  ["let x=0;if(0n)x=1;while(0n)x=2;do{x+=42;}while(0n);x;", "none", 42],
  ["switch(42n){case 42n:42;break;default:0;}", "none", 42],
  [
    'String(9007199254740993n) === "9007199254740993" && Boolean(0n) === false && Object.is(42n, 42n);',
    "none",
    true,
  ],
  [
    '({[42n]: 7})["42"] === 7 && 1n == true && 9007199254740993n > 9007199254740992;',
    "none",
    true,
  ],
  ["1n + 1;", "type", undefined],
  ["1n / 0n;", "range", undefined],
  [
    "let x=40n;const a=x++,b=++x,c=x--,d=--x;a===40n&&b===42n&&c===42n&&d===40n&&x===40n;",
    "none",
    true,
  ],
  [
    "[1,2].filter(()=>0n).length===0 && [1,2].filter(()=>1n).length===2;",
    "none",
    true,
  ],
  [
    "let n=0;const o={x:{[Symbol.toPrimitive](){n++;return 41n;}}};const p=o.x++;p===41n&&o.x===42n&&n===1;",
    "none",
    true,
  ],
  [
    'BigInt("0xff")===255n&&BigInt(true)===1n&&BigInt(42)===42n&&BigInt(42n)===42n;',
    "none",
    true,
  ],
  [
    'const o=Object(42n);Object.getPrototypeOf(o)===BigInt.prototype&&o.valueOf()===42n&&o.toString()==="42"&&o+1n===43n&&Object.prototype.toString.call(o)==="[object BigInt]";',
    "none",
    true,
  ],
  ['BigInt("1.0");', "syntax", undefined],
  ["BigInt(1.5);", "range", undefined],
  ["new BigInt(1);", "type", undefined],
  [
    '(255n).toString(16)==="ff"&&(-255n).toString(16)==="-ff"&&(42n).toString(2)==="101010";',
    "none",
    true,
  ],
  [
    "Number(9007199254740993n)===9007199254740992&&Number(Object(42n))===42;",
    "none",
    true,
  ],
  ["BigInt.prototype.valueOf();", "type", undefined],
  [
    "BigInt.asIntN(8,255n)===-1n&&BigInt.asUintN(8,-1n)===255n&&BigInt.asIntN(0,1n)===0n;",
    "none",
    true,
  ],
  ["BigInt.asUintN(8,1);", "type", undefined],
  ["BigInt.asIntN(-1,1n);", "range", undefined],
  [
    "BigInt.asIntN(9007199254740991,-42n)===-42n&&BigInt.asUintN(9007199254740991,42n)===42n;",
    "none",
    true,
  ],
  [
    'let order="";const bits={valueOf(){order+="b";return 0;}},x={[Symbol.toPrimitive](){order+="x";return 42n;}};BigInt.asIntN(bits,x)===0n&&order==="bx";',
    "none",
    true,
  ],
  [
    '(123n).toLocaleString()==="123"&&(-123n).toLocaleString()==="-123"&&Object(42n).toLocaleString()==="42"&&BigInt.prototype.toLocaleString.length===0;',
    "none",
    true,
  ],
  ["BigInt.prototype.toLocaleString.call(1);", "type", undefined],
  ['/a+/.test("baaa");', "none", true],
  [
    'const r=/(?<first>a)(b)?/d,m=r.exec("za");m[0]==="a"&&m[1]==="a"&&m[2]===undefined&&m.index===1&&m.input==="za"&&m.groups.first==="a"&&Object.getPrototypeOf(m.groups)===null&&m.indices[1][0]===1&&m.indices[1][1]===2&&m.indices.groups.first===m.indices[1]&&m.indices[2]===undefined;',
    "none",
    true,
  ],
  [
    'const r=/a/g;r.lastIndex=1;let m=r.exec("ba");m.index===1&&r.lastIndex===2&&r.exec("ba")===null&&r.lastIndex===0;',
    "none",
    true,
  ],
  [
    'const r=/a/y;r.lastIndex=1;let m=r.exec("ba");m.index===1&&r.lastIndex===2&&r.exec("ba")===null&&r.lastIndex===0;',
    "none",
    true,
  ],
  ['const r=/a/;r.lastIndex=20;r.test("ba")&&r.lastIndex===20;', "none", true],
  ['const r=/(?:)/g;r.exec("");r.lastIndex;', "none", 0],
  [
    'const r=new RegExp("a","yig");const d=Object.getOwnPropertyDescriptor(r,"lastIndex");r.source==="a"&&r.flags==="giy"&&r.ignoreCase&&d.writable&&!d.enumerable&&!d.configurable&&Object.getPrototypeOf(r)===RegExp.prototype;',
    "none",
    true,
  ],
  [
    'RegExp.prototype.source==="(?:)"&&RegExp.prototype.flags===""&&RegExp.prototype.global===undefined&&RegExp.prototype.toString()==="/(?:)/";',
    "none",
    true,
  ],
  [
    'let r=/a/g,c=new RegExp(r);RegExp(r)===r&&c!==r&&c.source==="a"&&c.flags==="g";',
    "none",
    true,
  ],
  [
    'let r=/a/g;r[Symbol.match]=false;let c=RegExp(r);c!==r&&c.source==="a"&&c.flags==="g";',
    "none",
    true,
  ],
  [
    'let r=/a/g;Object.defineProperty(r,"source",{get(){throw 42;}});new RegExp(r).source;',
    "none",
    "a",
  ],
  [
    'new RegExp("/").source==="\\\\/"&&new RegExp("\\n").source==="\\\\n";',
    "none",
    true,
  ],
  ["new RegExp().source;", "none", "(?:)"],
  [
    'const r=/x/;let seen;r.exec=function(s){seen=s;return {};};r.test(123)&&seen==="123";',
    "none",
    true,
  ],
  ['const r=/x/;r.exec=function(){return null;};r.test("x");', "none", false],
  ['const r=/x/;r.exec=function(){return 1;};r.test("x");', "type", undefined],
  [
    'let r=/a/,n=0;r.lastIndex={valueOf(){n++;return 8;}};r.exec("a");n;',
    "none",
    1,
  ],
  [
    'const r=/a/g;Object.defineProperty(r,"lastIndex",{writable:false});r.exec("a");',
    "type",
    undefined,
  ],
  [
    'const r=/a/g;Object.defineProperty(r,"lastIndex",{writable:false});r.exec("b");',
    "type",
    undefined,
  ],
  [
    'let r=/a/i;r.lastIndex=100;Object.defineProperty(r,"global",{value:true});r.flags;',
    "none",
    "gi",
  ],
  [
    'let r=/a/gi;r.lastIndex=100;r.exec("a")===null&&r.lastIndex===0;',
    "none",
    true,
  ],
  ['RegExp.prototype.exec.call({},"a");', "type", undefined],
  [
    'Object.getOwnPropertyDescriptor(RegExp.prototype,"source").get.call({});',
    "type",
    undefined,
  ],
  ["Object.prototype.toString.call(/x/);", "none", "[object RegExp]"],
  [
    "Object.prototype.toString.call(RegExp.prototype);",
    "none",
    "[object Object]",
  ],
  ["function make(){return /a/;}make()!==make();", "none", true],
  ['RegExp=42;/a/.test("a");', "none", true],
  [
    'let m=/(?<=([ab]+)([bc]+))$/.exec("abc");m[1]==="a"&&m[2]==="bc";',
    "none",
    true,
  ],
  ['let m=/(a|(b))+/.exec("aba");m[1]==="a"&&m[2]===undefined;', "none", true],
  [
    'let m=/[[a-z]--[aeiou]]+/v.exec("abcz");m[0]==="bcz"&&m.index===1;',
    "none",
    true,
  ],
  [
    'let r=/./uy;r.lastIndex=1;let m=r.exec("😀a");m[0]==="😀"&&m.index===0&&r.lastIndex===2;',
    "none",
    true,
  ],
  ['new RegExp("(");', "syntax", undefined],
  ['new RegExp("a","uv");', "syntax", undefined],
  [
    'let order="";let o={get source(){order+="s";return {toString(){order+="S";return "a";}}},get flags(){order+="f";return {toString(){order+="F";return "g";}}},get [Symbol.match](){order+="m";return true;}};new RegExp(o);order;',
    "none",
    "msfSF",
  ],
  [
    'let r=/a/;Object.defineProperty(r,"constructor",{get(){throw 42;}});try{RegExp(r);}catch(e){e;}',
    "none",
    42,
  ],
  ['RegExp.prototype.test.call({exec(){return {}; }},"a");', "none", true],
  ['RegExp.prototype.toString.call({source:"x",flags:"g"});', "none", "/x/g"],
  [
    'let get=Object.getOwnPropertyDescriptor(RegExp.prototype,"flags").get;get.call({hasIndices:1,global:1,ignoreCase:1,multiline:1,dotAll:1,unicode:1,unicodeSets:1,sticky:1});',
    "none",
    "dgimsuvy",
  ],
  ['/a/i.test("A");', "none", true],
] as const;
const selectedCase =
  process.env.TINT_SCRIPT_CASE === undefined
    ? undefined
    : Number(process.env.TINT_SCRIPT_CASE);
assert.ok(
  selectedCase === undefined ||
    (Number.isInteger(selectedCase) &&
      selectedCase >= 0 &&
      selectedCase < cases.length),
  "TINT_SCRIPT_CASE must select an existing case",
);
const generated: SourceModule[] = [];
const dependencies: [string, string][] = [
  ["global", "packages/js-runtime/src/environments/global/index.ts"],
  ["object", "packages/js-runtime/src/objects/index.ts"],
];
let imports = "",
  checks = "";
const checkGroups: string[] = [];
for (const [
  index,
  [text, expectedError, expectedValue, mode],
] of cases.entries()) {
  const strict = mode !== false;
  if (selectedCase !== undefined && selectedCase !== index) continue;
  let actualError = "none",
    actual: unknown;
  try {
    actual = new Script(
      (strict ? '"use strict";\n' : "") + text,
    ).runInNewContext({
      nativeObject: Object.create(
        Object.defineProperty(
          {
            inherited: 42,
            set input(value: unknown) {
              this.output = value;
            },
            output: undefined as unknown,
            get self() {
              return this;
            },
            method: function (this: unknown) {
              return this;
            },
          },
          "fixed",
          { value: 1, writable: false },
        ),
      ),
      nativeCounter: (() => {
        let stored: unknown = 41,
          reads = 0,
          writes = 0;
        return {
          get x() {
            reads++;
            return stored;
          },
          set x(value: unknown) {
            writes++;
            stored = value;
          },
          readCount() {
            return reads;
          },
          writeCount() {
            return writes;
          },
        };
      })(),
      nativePrototypeProbe: Object.defineProperty(() => {}, "prototype", {
        get() {
          throw 42;
        },
      }),
      nativeThrow: (value: unknown) => {
        throw value;
      },
      nativeIdentity: (value: unknown) => value,
      nativeReceiver: function (this: unknown) {
        return this;
      },
    });
  } catch (error) {
    const name =
      error !== null && typeof error === "object"
        ? (error as Error).name
        : undefined;
    actualError =
      name === "TypeError"
        ? "type"
        : name === "ReferenceError"
          ? "reference"
          : name === "RangeError"
            ? "range"
            : name === "SyntaxError"
              ? "syntax"
              : "throw";
    if (actualError === "throw") actual = error;
  }
  assert.equal(actualError, expectedError, text);
  assert.equal(
    actual,
    nodeReferenceValues.has(text)
      ? nodeReferenceValues.get(text)
      : expectedValue,
    text,
  );
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = strict
    ? parseStrictScript(source.value)
    : parseScript(source.value);
  assert.ok(parsed.ok, `case ${index}: ${text}\n${JSON.stringify(parsed)}`);
  const lowered = strict
    ? lowerStrictScript(parsed.value, text)
    : lowerScript(parsed.value, text);
  assert.ok(lowered.ok, `case ${index}: ${text}\n${JSON.stringify(lowered)}`);
  const id = "script" + index;
  generated.push({
    id,
    module: lowered.value,
    dependencies: new Map([
      [
        "@tint/js-runtime/environments/global",
        "packages/js-runtime/src/environments/global/index.ts",
      ],
      [
        "@tint/js-runtime/environments/records",
        "packages/js-runtime/src/environments/records/index.ts",
      ],
      ["@tint/js-runtime/objects", "packages/js-runtime/src/objects/index.ts"],
    ]),
  });
  dependencies.push([id, id]);
  imports += `import {execute as execute${index}} from "${id}";\n`;
  const expected =
    expectedValue === undefined
      ? "undefined"
      : typeof expectedValue === "number" && Number.isNaN(expectedValue)
        ? "NaN"
        : expectedValue === Infinity
          ? "Infinity"
          : expectedValue === -Infinity
            ? "-Infinity"
            : Object.is(expectedValue, -0)
              ? "-0"
              : JSON.stringify(expectedValue);
  // Keep failures distinct from the fixture's success status as cases grow.
  checks += `const r${index}=invoke(execute${index});if(r${index}.error!=="${expectedError}"||!sameValue(r${index}.value,${expected}))return 1;\n`;
  // Bound each check function's captured entrypoints as this corpus grows.
  if ((index + 1) % 128 === 0) {
    checkGroups.push(checks);
    checks = "";
  }
}
if (checks !== "") checkGroups.push(checks);
verifyHostedFixture(
  `
${imports}
import {createGlobalEnvironment,type GlobalEnvironment} from "global";
import {type ScriptPropertyKey,createObject,createCallableObject,createDataProperty,defineOwnProperty,callObjectValue,setProperty,createErrorRealm,installErrorIntrinsics,installArrayIntrinsics,installObjectIntrinsics,installFunctionIntrinsics,installPrimitiveIntrinsics,installMapIntrinsics,installSetIntrinsics,installIteratorConstructor,installRegExpIntrinsics,installSymbolIntrinsics,installMathIntrinsics,installPromiseIntrinsics,viewObjectValue,type ErrorRealm,type ScriptRecord,createScriptRecord,drainScriptJobs,installGlobalProperties,scriptSameValue as sameValue,type ObjectHooks} from "object";
function make():GlobalEnvironment<ScriptPropertyKey,unknown>{
 const object=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>sameValue(a,b),call:(callee,receiver,args):unknown=>{const result=callObjectValue(callee,receiver,args,object);if(result.error!=="none")throw "INVALID_FIXTURE_CALL";return result.value;}};
 installGlobalProperties(object,object,hooks);
 createDataProperty<ScriptPropertyKey,unknown>(object,"nativeThrow",createCallableObject<ScriptPropertyKey,unknown>(undefined,(receiver,args):unknown=>{throw args[0];}),hooks);
 createDataProperty<ScriptPropertyKey,unknown>(object,"nativeIdentity",createCallableObject<ScriptPropertyKey,unknown>(undefined,(receiver,args):unknown=>args[0]),hooks);
 createDataProperty<ScriptPropertyKey,unknown>(object,"nativeReceiver",createCallableObject<ScriptPropertyKey,unknown>(undefined,(receiver,args):unknown=>receiver),hooks);
 const counter=createObject<ScriptPropertyKey,unknown>(undefined);
 let stored:unknown=41,reads=0,writes=0;
 const getter=createCallableObject<ScriptPropertyKey,unknown>(undefined,(receiver,args):unknown=>{reads++;return stored;});
 const setterCounter=createCallableObject<ScriptPropertyKey,unknown>(undefined,(receiver,args):unknown=>{writes++;stored=args[0];return undefined;});
 defineOwnProperty<ScriptPropertyKey,unknown>(counter,"x",{fields:12,value:undefined,writable:false,get:getter,set:setterCounter,enumerable:false,configurable:false},hooks);
 createDataProperty<ScriptPropertyKey,unknown>(counter,"readCount",createCallableObject<ScriptPropertyKey,unknown>(undefined,(receiver,args):unknown=>reads),hooks);
 createDataProperty<ScriptPropertyKey,unknown>(counter,"writeCount",createCallableObject<ScriptPropertyKey,unknown>(undefined,(receiver,args):unknown=>writes),hooks);
 createDataProperty<ScriptPropertyKey,unknown>(object,"nativeCounter",counter,hooks);
 const probe=createCallableObject<ScriptPropertyKey,unknown>(undefined,(receiver,args):unknown=>undefined);
 const probeGetter=createCallableObject<ScriptPropertyKey,unknown>(undefined,(receiver,args):unknown=>{throw 42;});
 defineOwnProperty<ScriptPropertyKey,unknown>(probe,"prototype",{fields:4,value:undefined,writable:false,get:probeGetter,set:undefined,enumerable:false,configurable:false},hooks);
 createDataProperty<ScriptPropertyKey,unknown>(object,"nativePrototypeProbe",probe,hooks);
 const prototype=createObject<ScriptPropertyKey,unknown>(undefined);
 const receiverFunction=createCallableObject<ScriptPropertyKey,unknown>(undefined,(receiver,args):unknown=>receiver);
 createDataProperty<ScriptPropertyKey,unknown>(prototype,"inherited",42,hooks);
 createDataProperty<ScriptPropertyKey,unknown>(prototype,"method",receiverFunction,hooks);
 defineOwnProperty<ScriptPropertyKey,unknown>(prototype,"self",{fields:4,value:undefined,writable:false,get:receiverFunction,set:undefined,enumerable:false,configurable:false},hooks);
 const setter=createCallableObject<ScriptPropertyKey,unknown>(undefined,(receiver,args):unknown=>{const target=viewObjectValue(receiver,object);if(target===undefined||!setProperty<ScriptPropertyKey,unknown>(target,"output",args[0],{object:target,value:receiver},hooks))throw "FIXTURE_SET_FAILED";return 19;});
 defineOwnProperty<ScriptPropertyKey,unknown>(prototype,"input",{fields:8,value:undefined,writable:false,get:undefined,set:setter,enumerable:false,configurable:false},hooks);
 defineOwnProperty<ScriptPropertyKey,unknown>(prototype,"fixed",{fields:3,value:1,writable:false,get:undefined,set:undefined,enumerable:false,configurable:false},hooks);
 createDataProperty<ScriptPropertyKey,unknown>(object,"nativeObject",createObject<ScriptPropertyKey,unknown>(prototype),hooks);
 return createGlobalEnvironment<ScriptPropertyKey,unknown>(object,object,object,(name:string):ScriptPropertyKey=>name,hooks);
}
function invoke(entry:(global:GlobalEnvironment<ScriptPropertyKey,unknown>,script:ScriptRecord)=>{readonly error:string;readonly value:unknown}):{readonly error:string;readonly value:unknown}{
 const global=make();
 const errors=createErrorRealm(createObject<ScriptPropertyKey,unknown>(undefined),global.hooks);
 const script=createScriptRecord(errors,undefined);
 installErrorIntrinsics(global.object,errors,global.hooks);
 installArrayIntrinsics(global.object,errors,global.hooks);
 installObjectIntrinsics(global.object,errors,global.hooks);
 installFunctionIntrinsics(global.object,errors,global.hooks);
 installPrimitiveIntrinsics(global.object,errors,global.hooks);
 installIteratorConstructor(global.object,errors,global.hooks);
 installMapIntrinsics(global.object,errors,global.hooks);
 installSetIntrinsics(global.object,errors,global.hooks);
 installRegExpIntrinsics(global.object,errors,global.hooks);
 installSymbolIntrinsics(global.object,errors,global.hooks);
 installMathIntrinsics(global.object,errors,global.hooks,undefined);
 installPromiseIntrinsics(global.object,errors,global.hooks,(promise,operation):void=>{});
 createDataProperty<ScriptPropertyKey,unknown>(global.object,"nativeIdentity",createCallableObject<ScriptPropertyKey,unknown>(undefined,(receiver,args):unknown=>{
   const active=errors.agent.activeContext;
   if(active===undefined||active.realm!==errors||active.scriptOrModule!==script)throw "FIXTURE_SCRIPT_CONTEXT";
   if(drainScriptJobs(errors.agent,(error):void=>{throw error;})!==0)throw "FIXTURE_ACTIVE_CHECKPOINT";
   return args[0];
 }),global.hooks);
 const result=entry(global,script);
 if(errors.agent.activeContext!==undefined)throw "FIXTURE_SCRIPT_CONTEXT_LEAK";
 if(result.error==="throw"){
   const object=viewObjectValue(result.value,global.object);
   if(object!==undefined){
     if(object.prototype===errors.prototypes.get("type"))return {error:"type",value:undefined};
     if(object.prototype===errors.prototypes.get("reference"))return {error:"reference",value:undefined};
     if(object.prototype===errors.prototypes.get("range"))return {error:"range",value:undefined};
     if(object.prototype===errors.prototypes.get("syntax"))return {error:"syntax",value:undefined};
   }
 }
 return result;
}
function negated(value:unknown):boolean{return !value;}
${checkGroups.map((group, index) => `function checkGroup${index}():number{${group}return 42;}`).join("\n")}
export function run():number{
 if(!negated(-0)||!negated(0/0)||negated(1/0)||negated(-1)||negated("false"))return 100;
 ${checkGroups.map((_, index) => `if(checkGroup${index}()!==42)return 1;`).join("\n")}return 42;
}
`,
  "script-execution",
  dependencies,
  generated,
  [
    {
      module: "packages/js-runtime/src/objects/index.ts",
      name: "viewObjectValue",
      operation: "view",
    },
    {
      module: "packages/js-runtime/src/objects/index.ts",
      name: "viewSymbolValue",
      operation: "view",
    },
    {
      module: "packages/js-runtime/src/objects/index.ts",
      name: "viewBigIntValue",
      operation: "view",
    },
  ],
  [
    {
      module: "packages/js-runtime/src/objects/index.ts",
      namespace: "ordinary-object",
      retainedExports: [
        "viewObjectValue",
        "viewSymbolValue",
        "viewBigIntValue",
      ],
    },
  ],
  // This bundle retains every generated Script's initialized closures alongside
  // its realm. Match the Test262 execution budget; the small fixture default
  // exhausts allocation during realm setup before the first assertion runs.
  { managedBytes: 67108864, allocationCapacity: 1048576 },
);
