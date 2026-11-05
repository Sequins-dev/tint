import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { executionPlan } from "./test262-execution.ts";
import {
  prepareNativeScripts,
  createNativeTestBuilder,
} from "./test262-native.ts";
import { executeNativeImage } from "./test262-native-process.ts";

const checkout = resolve(process.argv[2] ?? ".tint-bootstrap/test262");
const build = createNativeTestBuilder();
const cases = [
  [
    "async function* g(){const x=yield* [19,23];assert.sameValue(x,undefined);return 42;}const i=g();Promise.all([i.next(),i.next(),i.next()]).then(r=>{assert.sameValue(r[0].value,19);assert.sameValue(r[1].value,23);assert.sameValue(r[2].value,42);assert.sameValue(r[2].done,true);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "const value=Promise.resolve(42);const src={[Symbol.asyncIterator](){return this;},next(){return {done:false,value};}};async function* g(){yield* src;}g().next().then(r=>{assert.sameValue(r.value,value);assert.sameValue(r.done,false);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "let closed=0;const src={[Symbol.asyncIterator](){return this;},next(){return {done:false,value:19};},return(v){assert.sameValue(v,23);return Promise.resolve({done:true,value:42});}};async function* g(){try{yield* src;}finally{await 0;closed++;}}const i=g();i.next().then(()=>i.return(23)).then(r=>{assert.sameValue(r.value,42);assert.sameValue(r.done,true);assert.sameValue(closed,1);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "let closed=0;const src={[Symbol.asyncIterator](){return this;},next(){return {done:false,value:19};},return(){assert.sameValue(arguments.length,0);return Promise.resolve().then(()=>{closed++;return {};});}};async function* g(){try{yield* src;}catch(e){assert.sameValue(e instanceof TypeError,true);return closed;}}const i=g();i.next().then(()=>i.throw(23)).then(r=>{assert.sameValue(r.value,1);assert.sameValue(r.done,true);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "const src={[Symbol.asyncIterator](){return this;},next(){return {done:false,value:19};},throw(v){assert.sameValue(v,23);return Promise.resolve({done:true,value:42});}};async function* g(){return yield* src;}const i=g();i.next().then(()=>i.throw(23)).then(r=>{assert.sameValue(r.value,42);assert.sameValue(r.done,true);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "let called=0;const src={[Symbol.asyncIterator](){return this;},next(){return Promise.reject(42);},throw(){called++;return {};}};async function* g(){try{yield* src;}catch(e){assert.sameValue(called,0);return e;}}g().next().then(r=>{assert.sameValue(r.value,42);assert.sameValue(r.done,true);$DONE();},$DONE);",
    "completed",
    "",
  ],

  [
    "async function f(){let n=0;for await(const x of [Promise.resolve(19),23])n+=x;return n;}f().then(v=>{assert.sameValue(v,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "async function* g(){yield 19;yield 23;}async function f(){let n=0;for await(const x of g())n+=x;return n;}f().then(v=>{assert.sameValue(v,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "let closed=0;const i={[Symbol.asyncIterator](){return this;},next(){return Promise.resolve({done:false,value:42});},return(){return Promise.resolve().then(()=>{closed++;return {};});}};async function f(){for await(const x of i){break;}assert.sameValue(closed,1);}f().then($DONE,$DONE);",
    "completed",
    "",
  ],
  [
    "let closed=0;const i={[Symbol.asyncIterator](){return this;},next(){return {done:false,value:42};},return(){closed++;return Promise.reject(19);}};async function f(){for await(const x of i){throw 42;}}f().then(()=>$DONE('unexpected'),e=>{assert.sameValue(e,42);assert.sameValue(closed,1);$DONE();});",
    "completed",
    "",
  ],
  [
    "const i={[Symbol.asyncIterator](){return this;},next(){return {done:false,value:42};},return(){return Promise.reject(19);}};async function f(){for await(const x of i){break;}}f().then(()=>$DONE('unexpected'),e=>{assert.sameValue(e,19);$DONE();});",
    "completed",
    "",
  ],
  [
    "let closed=0;const i={[Symbol.asyncIterator](){return this;},next(){return Promise.reject(42);},return(){closed++;return {};}};async function f(){for await(const x of i){}}f().then(()=>$DONE('unexpected'),e=>{assert.sameValue(e,42);assert.sameValue(closed,0);$DONE();});",
    "completed",
    "",
  ],
  [
    "let closed=0;const i={[Symbol.asyncIterator](){return this;},next(){return {done:false,get value(){throw 42;}};},return(){closed++;return {};}};async function f(){for await(const x of i){}}f().then(()=>$DONE('unexpected'),e=>{assert.sameValue(e,42);assert.sameValue(closed,0);$DONE();});",
    "completed",
    "",
  ],
  [
    "const p=Promise.resolve(42);let n=0;const i={[Symbol.asyncIterator](){return this;},next(){return {done:n++>0,value:p};}};async function f(){for await(const x of i){assert.sameValue(x,p);}}f().then($DONE,$DONE);",
    "completed",
    "",
  ],
  [
    "async function f(){let out=0;for await(const {x} of [{x:19},{x:23}])out+=x;let y;for await([y] of [[42]]){}assert.sameValue(y,42);return out;}f().then(v=>{assert.sameValue(v,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "async function* g(){for await(const x of [19,23])yield x;}const i=g();Promise.all([i.next(),i.next(),i.next()]).then(v=>{assert.sameValue(v[0].value+v[1].value,42);assert.sameValue(v[2].done,true);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "let closed=0;const i={[Symbol.asyncIterator](){return this;},next(){return {done:false,value:1};},return(){closed++;return {};}};async function f(){outer:for await(const x of [1,2]){for await(const y of i){continue outer;}}assert.sameValue(closed,2);}f().then($DONE,$DONE);",
    "completed",
    "",
  ],
  [
    "const i={[Symbol.asyncIterator](){return this;},next(){return {done:false,value:42};},return(){return 19;}};async function f(){for await(const x of i){return x;}}f().then(()=>$DONE('unexpected'),e=>{assert.sameValue(e instanceof TypeError,true);$DONE();});",
    "completed",
    "",
  ],
  [
    "let closed=0;function* g(){try{yield Promise.reject(42);}finally{closed++;}}async function f(){for await(const x of g()){}}f().then(()=>$DONE('unexpected'),e=>{assert.sameValue(e,42);assert.sameValue(closed,1);$DONE();});",
    "completed",
    "",
  ],
  [
    "async function f(){let a=[];for await(const x of [19,23])a.push(()=>x);return a[0]()+a[1]();}f().then(v=>{assert.sameValue(v,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "async function* g(){yield 19;return 42;}const i=g();Promise.all([i.next(99),i.next(),i.next()]).then(v=>{assert.sameValue(v[0].value,19);assert.sameValue(v[0].done,false);assert.sameValue(v[1].value,42);assert.sameValue(v[1].done,true);assert.sameValue(v[2].value,undefined);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "let n=0;async function* g(){n++;yield 42;}const i=g();assert.sameValue(n,0);i.return(19).then(v=>{assert.sameValue(v.value,19);assert.sameValue(v.done,true);assert.sameValue(n,0);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "async function* g(){try{yield 19;}finally{await 1;yield 23;}}const i=g();Promise.all([i.next(),i.return(Promise.resolve(42)),i.next()]).then(v=>{assert.sameValue(v[0].value,19);assert.sameValue(v[1].value,23);assert.sameValue(v[1].done,false);assert.sameValue(v[2].value,42);assert.sameValue(v[2].done,true);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "async function* g(){try{yield Promise.reject(19);}catch(e){yield e+23;}}g().next().then(v=>{assert.sameValue(v.value,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "async function* g(){try{yield 19;}catch(e){yield e;}}const i=g();Promise.all([i.next(),i.return(Promise.reject(42))]).then(v=>{assert.sameValue(v[1].value,42);assert.sameValue(v[1].done,false);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "async function* g(){try{return Promise.reject(19);}catch(e){return e+23;}}g().next().then(v=>{assert.sameValue(v.value,42);assert.sameValue(v.done,true);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "async function* g(){let total=0;for(let n=0;n<3;n++){try{total+=await 14;if(n<2)continue;}finally{await 1;}}yield total;}g().next().then(v=>{assert.sameValue(v.value,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "const o={x:42,async *g(){yield this.x;}};o.g().next().then(v=>{assert.sameValue(v.value,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "class B{get x(){return 42;}}class C extends B{async *g(){yield await super.x;}}new C().g().next().then(v=>{assert.sameValue(v.value,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "class C{#x=42;async *#g(){yield this.#x;}f(){return this.#g();}}new C().f().next().then(v=>{assert.sameValue(v.value,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "async function* g(x=missing){yield x;}assert.throws(ReferenceError,()=>g());$DONE();",
    "completed",
    "",
  ],
  [
    "async function* g(){try{yield 19;}finally{return await 42;}}const i=g();Promise.all([i.next(),i.throw(23)]).then(v=>{assert.sameValue(v[1].value,42);assert.sameValue(v[1].done,true);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "let p=Promise.resolve(1);Object.defineProperty(p,'constructor',{get(){throw 19;}});async function* g(){try{yield p;}catch(e){return e+23;}}g().next().then(v=>{assert.sameValue(v.value,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "const g=async function* named(){yield named===g;};const i=g();assert.sameValue(i[Symbol.asyncIterator](),i);i.next().then(v=>{assert.sameValue(v.value,true);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "async function f(){return await 42;}f().then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "let log=[];async function f(){log.push(1);await 42;log.push(3);await Promise.resolve();log.push(5);}let p=f();log.push(2);Promise.resolve().then(()=>log.push(4));p.then(()=>{assert.sameValue(log.join(','),'1,2,3,4,5');$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "async function f(){try{await Promise.reject(19);}catch(e){await 1;return e+23;}finally{await 1;}}f().then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "let p=Promise.resolve(1);Object.defineProperty(p,'constructor',{get(){throw 19;}});let n=0;async function f(){try{await p;}catch(e){n=e;return 42;}}let q=f();assert.sameValue(n,19);q.then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "let p=Promise.resolve(42);Object.defineProperty(p,'then',{get(){throw 19;}});async function f(){return await p;}f().then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "async function f(){return await {then(resolve){resolve(42);throw 19;}};}f().then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "async function f(){return await {get then(){throw 19;}};}f().then(()=>$DONE('unexpected'),e=>{assert.sameValue(e,19);$DONE();});",
    "completed",
    "",
  ],
  [
    "async function f(){let n=0;for(let i=0;i<3;i++){try{n+=await 14;if(i<2)continue;}finally{await 1;}}return n;}f().then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "async function f(){try{return await 19;}finally{return await 42;}}f().then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "class B{get x(){return 42;}}class C extends B{async f(){return await super.x;}}new C().f().then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "function f(x){return (async ()=>await arguments[0])();}f(42).then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "async function f(){return (await 20)+(await 22);}f().then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],

  [
    "let o={x:42,async f(){return this.x;}};assert.sameValue(o.f.name,'f');assert.throws(TypeError,()=>new o.f());o.f().then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "let p={x:42},o={__proto__:p,async ['f'](){return super.x;}};o.f().then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "class B{get x(){return 42;}}class C extends B{async f(){return super.x;}}let c=new C();assert.sameValue(Object.getOwnPropertyDescriptor(C.prototype,'f').enumerable,false);c.f().then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "class C{static x=42;static async f(){return this.x;}}C.f().then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "class C{#x=42;async #f(){return this.#x;}f(){return this.#f();}}new C().f().then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "class C{async f(x=missing){return x;}}new C().f().catch(e=>{assert.sameValue(e instanceof ReferenceError,true);$DONE();});",
    "completed",
    "",
  ],

  [
    "const f=async x=>x;assert.sameValue(f.name,'f');assert.sameValue(f.length,1);assert.throws(TypeError,()=>new f());f(42).then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "function f(x){return (async ()=>arguments[0])();}f(42).then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "function f(){return (async ()=>this.x)();}f.call({x:42}).then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "function F(){return (async ()=>new.target)();}new F().then(x=>{assert.sameValue(x,F);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "const f=async (x=missing)=>x;f().catch(e=>{assert.sameValue(e instanceof ReferenceError,true);$DONE();});",
    "completed",
    "",
  ],
  [
    "class B{get x(){return 42;}}class C extends B{f(){return (async ()=>super.x)();}}new C().f().then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],

  [
    "let n=0;async function f(x){n++;return x;}let p=f(42);assert.sameValue(n,1);assert.sameValue(p instanceof Promise,true);assert.sameValue(Object.prototype.hasOwnProperty.call(f,'prototype'),false);assert.throws(TypeError,()=>new f());p.then(v=>{assert.sameValue(v,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "async function f(){throw 42;}f().then(()=>$DONE('unexpected'),e=>{assert.sameValue(e,42);$DONE();});",
    "completed",
    "",
  ],
  [
    "async function f(x=missing){return 42;}let p=f();p.then(()=>$DONE('unexpected'),e=>{assert.sameValue(e instanceof ReferenceError,true);$DONE();});",
    "completed",
    "",
  ],
  [
    "const f=async function named(x){assert.sameValue(named,f);return x;};assert.sameValue(f.name,'named');assert.sameValue(f.length,1);f(42).then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "const f=async function(){return this.x;};assert.sameValue(f.name,'f');f.call({x:42}).then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "let p=Promise.resolve(42);async function f(){return p;}let q=f();assert.sameValue(q===p,false);q.then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "async function f(){return {then(resolve){resolve(42);throw 19;}};}f().then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "function outer(){async function inner(){return 42;}return inner();}outer().then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "let original=Promise;async function f(){return 42;}Promise=function(){throw 19;};let p=f();assert.sameValue(p instanceof original,true);p.then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "async function f(){try{return 19;}finally{return 42;}}f().then(x=>{assert.sameValue(x,42);$DONE();},$DONE);",
    "completed",
    "",
  ],

  [
    "let c=Promise.withResolvers();assert.sameValue(Object.keys(c).join(','),'promise,resolve,reject');assert.sameValue(Object.getPrototypeOf(c),Object.prototype);for(let k of Object.keys(c)){let d=Object.getOwnPropertyDescriptor(c,k);assert.sameValue(d.writable&&d.enumerable&&d.configurable,true);}c.resolve(42);c.reject(19);c.promise.then(v=>{assert.sameValue(v,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "function resolve(){}function reject(){}let p={};function C(executor){executor(resolve,reject);return p;}let c=Promise.withResolvers.call(C);assert.sameValue(c.promise,p);assert.sameValue(c.resolve,resolve);assert.sameValue(c.reject,reject);$DONE();",
    "completed",
    "",
  ],
  [
    "function C(){throw 42;}try{Promise.withResolvers.call(C);$DONE('unexpected');}catch(e){assert.sameValue(e,42);$DONE();}",
    "completed",
    "",
  ],

  [
    "Promise.resolve(42).then(x=>{assert.sameValue(x,42);$DONE();});",
    "completed",
    "",
  ],
  ["$DONE();Promise.resolve().then(()=>$DONE());", "error", "Test262Error"],
  [
    "Promise.resolve().then(()=>$DONE(new TypeError('bad')));",
    "error",
    "TypeError",
  ],
  ["Promise.resolve(42);", "timeout", ""],
  ["$DONE();throw new RangeError('after completion');", "error", "RangeError"],
  ["Promise.reject(42);$DONE();", "completed", ""],
  [
    "$DONE();Promise.resolve().then(()=>Promise.resolve().then(()=>$DONE()));",
    "error",
    "Test262Error",
  ],
  [
    "Promise.resolve(42).finally(()=>19).then(v=>{assert.sameValue(v,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "Promise.reject(42).finally(()=>19).then(()=>$DONE('unexpected'),e=>{assert.sameValue(e,42);$DONE();});",
    "completed",
    "",
  ],
  [
    "Promise.resolve(42).finally(()=>{throw 19;}).then(()=>$DONE('unexpected'),e=>{assert.sameValue(e,19);$DONE();});",
    "completed",
    "",
  ],
  [
    "let n=0;Promise.resolve(42).finally(()=>Promise.resolve().then(()=>{n=1;})).then(v=>{assert.sameValue(v,42);assert.sameValue(n,1);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "Promise.race([Promise.resolve(42),19]).then(v=>{assert.sameValue(v,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "Promise.race([Promise.reject(42),19]).then(()=>$DONE('unexpected'),e=>{assert.sameValue(e,42);$DONE();});",
    "completed",
    "",
  ],
  [
    "let n=0;Promise.race([]).then(()=>n++);Promise.resolve().then(()=>{assert.sameValue(n,0);$DONE();});",
    "completed",
    "",
  ],
  [
    "let calls=0;function resolve(){}function reject(){}function C(executor){executor(resolve,reject);}C.resolve=x=>({then(a,b){assert.sameValue(a,resolve);assert.sameValue(b,reject);calls++;}});let p=Promise.race.call(C,[1,2]);assert.sameValue(p instanceof C,true);assert.sameValue(calls,2);$DONE();",
    "completed",
    "",
  ],
  [
    "let closed=0;class C extends Promise{static resolve(){throw 42;}}let i={[Symbol.iterator](){return this;},next(){return {value:1,done:false};},return(){closed++;throw 19;}};C.race(i).catch(e=>{assert.sameValue(e,42);assert.sameValue(closed,1);$DONE();});",
    "completed",
    "",
  ],
  [
    "let closed=0;let i={[Symbol.iterator](){return this;},next(){throw 42;},return(){closed++;return {};}};Promise.race(i).catch(e=>{assert.sameValue(e,42);assert.sameValue(closed,0);$DONE();});",
    "completed",
    "",
  ],
  [
    "Promise.all([Promise.resolve(42),19]).then(v=>{assert.sameValue(v.join(','),'42,19');$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "let finish;let first=new Promise(r=>finish=r);let p=Promise.all([first,Promise.resolve(19)]);finish(42);p.then(v=>{assert.sameValue(v.join(','),'42,19');$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "Promise.all([]).then(v=>{assert.sameValue(Array.isArray(v),true);assert.sameValue(v.length,0);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "Promise.all([42,Promise.reject(19)]).then(()=>$DONE('unexpected'),e=>{assert.sameValue(e,19);$DONE();});",
    "completed",
    "",
  ],
  [
    "let calls=0,result;function C(executor){executor(v=>{calls++;result=v;},()=>{});}C.resolve=x=>({then(f){f(x);f(99);}});Promise.all.call(C,[42,19]);assert.sameValue(calls,1);assert.sameValue(result.join(','),'42,19');$DONE();",
    "completed",
    "",
  ],
  [
    "let n=0;class C extends Promise{static resolve(){throw 42;}}const i={[Symbol.iterator](){return this;},next(){return {value:1,done:false};},return(){n++;throw 19;}};C.all(i).catch(e=>{assert.sameValue(e,42);assert.sameValue(n,1);$DONE();});",
    "completed",
    "",
  ],
  [
    "Promise.allSettled([Promise.resolve(42),Promise.reject(19)]).then(v=>{assert.sameValue(v.length,2);assert.sameValue(v[0].status,'fulfilled');assert.sameValue(v[0].value,42);assert.sameValue('reason' in v[0],false);assert.sameValue(v[1].status,'rejected');assert.sameValue(v[1].reason,19);assert.sameValue('value' in v[1],false);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "Promise.allSettled([]).then(v=>{assert.sameValue(v.length,0);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "let calls=0,result;function C(executor){executor(v=>{calls++;result=v;},()=>{});}C.resolve=x=>({then(f,r){if(x===42){f(x);r(99);}else{r(x);f(99);}}});Promise.allSettled.call(C,[42,19]);assert.sameValue(calls,1);assert.sameValue(result[0].value,42);assert.sameValue(result[1].reason,19);$DONE();",
    "completed",
    "",
  ],
  [
    "Promise.any([Promise.reject(19),Promise.resolve(42)]).then(v=>{assert.sameValue(v,42);$DONE();},$DONE);",
    "completed",
    "",
  ],
  [
    "Promise.any([]).then(()=>$DONE('unexpected'),e=>{assert.sameValue(e instanceof AggregateError,true);assert.sameValue(e.errors.length,0);$DONE();});",
    "completed",
    "",
  ],
  [
    "let reject;const p=new Promise((r,j)=>reject=j);Promise.any([p,Promise.reject(19)]).catch(e=>{assert.sameValue(e.errors.join(','),'42,19');$DONE();});reject(42);",
    "completed",
    "",
  ],
  [
    "let result,calls=0;function C(executor){executor(()=>{},e=>{calls++;result=e;});}C.resolve=x=>({then(f,r){r(x);r(99);}});Promise.any.call(C,[42,19]);assert.sameValue(calls,1);assert.sameValue(result.errors.join(','),'42,19');$DONE();",
    "completed",
    "",
  ],
  ["$DONE(new AggregateError([]));", "error", "AggregateError"],
] as const;
for (const [source, kind, type] of cases) {
  const plan = executionPlan(source, "strict", {
    flags: ["async"],
    features: [],
    includes: [],
  });
  const harness = plan.harness.map((name) => {
    const filename = resolve(checkout, "harness", name);
    return { filename, source: readFileSync(filename, "utf8") };
  });
  const prepared = prepareNativeScripts(plan, "strict", harness);
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const built = build(prepared.modules, plan.asynchronous);
  assert.ok(built.ok, JSON.stringify(built));
  const outcome = executeNativeImage(built.bytes, 60000);
  console.log(JSON.stringify({ source, outcome }));
  assert.equal(outcome.kind, kind);
  if (outcome.kind === "error") assert.equal(outcome.type, type);
}
console.log(
  "Verified native async completion, failures, nested jobs and quiescence.",
);
