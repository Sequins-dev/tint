import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import {
  createNativeBatchBuilder,
  prepareNativeScripts,
  nativeTestResources,
} from "./test262-native.ts";
import { NativeImageRunner } from "./test262-native-process.ts";
import { executionPlan } from "./test262-execution.ts";
const bodies = [
  'const g=AGF("x","y","yield x+y")(2,3);if((await g.next()).value!==5||!(await g.next()).done)throw 1;',
  'const g=AGF("a=1","...rest","var x=yield await a;yield* rest;return x+arguments.length")(undefined,7,8);if((await g.next()).value!==1||(await g.next(10)).value!==7||(await g.next()).value!==8||(await g.next()).value!==13)throw 1;',
  'if((await AGF("a","arguments[0]=2;yield a")(1).next()).value!==2||(await AGF("a","\\"use strict\\";arguments[0]=2;yield a")(1).next()).value!==1||(await AGF("a","a","yield a")(1,2).next()).value!==2||AGF("a","b=1","").length!==1)throw 1;',
  'globalThis.F=AGF("yield arguments.callee===F;yield new.target");const g=F();if((await g.next()).value!==true||(await g.next()).value!==undefined)throw 1;',
  'let caught=false;try{AGF("a=(()=>{throw 7})()","")()}catch(e){caught=e===7}if(!caught)throw 1;',
  'const g=AGF("throw 8")();let caught=false;try{await g.next()}catch(e){caught=e===8}if(!caught||!(await g.next()).done)throw 1;',
  'globalThis.entered=false;const f=AGF("globalThis.entered=true;yield 1"),a=f(),b=f(),log=[];const p=a.throw(3).catch(e=>{if(e!==3)throw 1;log.push("throw")}),q=b.return(Promise.resolve(6)).then(r=>{if(r.value!==6||!r.done)throw 2;log.push("return")});await p;await q;if(entered||log.join()!=="throw,return")throw 3;',
  'const trace=async g=>{const log=[];const a=g.next().then(r=>log.push("a"+r.value)),b=g.next("X").then(r=>log.push("b"+r.value)),c=g.return("R").then(r=>log.push("c"+r.value)),d=g.next().then(r=>log.push("d"+r.done));await a;await b;await c;await d;return log.join()};const a=await trace(AGF("yield await 1;yield 2;return 3")()),b=await trace((async function*(){yield await 1;yield 2;return 3})());if(a!==b||a!=="a1,b2,cR,dtrue")throw 1;',
  'globalThis.finished=false;const a=AGF("try{yield Promise.resolve(4)}finally{globalThis.finished=true}")();if((await a.next()).value!==4||(await a.return(9)).value!==9||!finished)throw 1;const b=AGF("try{yield 1}finally{yield 3}")();await b.next();if((await b.return(9)).value!==3||(await b.next()).value!==9)throw 2;',
  'const r=await AGF("try{yield await Promise.reject(9)}catch(e){return e}")().next();if(r.value!==9||!r.done)throw 1;',
  'const g=AGF("for await(const v of [1,Promise.resolve(2)])yield v")();if((await g.next()).value!==1||(await g.next()).value!==2||!(await g.next()).done)throw 1;',
  'globalThis.P2={};globalThis.F=AGF("a=(F.prototype=P2)","yield a");if(Object.getPrototypeOf(F())!==P2)throw 1;const G=AGF("yield 1"),p=Object.getPrototypeOf(G.prototype);G.prototype=1;if(Object.getPrototypeOf(G())!==p)throw 2;let caught=false;try{new G()}catch(e){caught=e instanceof TypeError}if(!caught)throw 3;',
  'const other=$262.createRealm().global,C=other.Function("return (async function*(){}).constructor")(),g=C("yield this;yield new TypeError(\\"t\\")")(),p=g.next();if(!(p instanceof other.Promise)||(await p).value!==other||!((await g.next()).value instanceof other.TypeError)||!(g instanceof other.Object))throw 1;',
  'if((await AGF("\\"use strict\\";yield this").call(5).next()).value!==5)throw 1;const v=(await AGF("yield this").call(1).next()).value;if(typeof v!=="object"||Object.getPrototypeOf(v)!==Number.prototype)throw 2;',
  'const unused=AGF("await missingNeverCalled;yield 1");if(unused.name!=="anonymous"||(await AGF("yield eval(\\"1\\")")().next()).value!==1)throw 1;',
  'const g=AGF("const x={v:42};await 1;yield 1;return ()=>x.v")();await g.next();for(let i=0;i<1024;i++){const a=new Uint32Array(8192);a[0]=i}if((await g.next()).value()!==42)throw 1;',
  'if(!(await AGF()().next()).done||(await AGF("return 1")().next()).value!==1)throw 1;',
];
const sources = bodies.map(
  (body) =>
    `(async()=>{const AGF=(async function*(){}).constructor;${body}})().then(()=>print("Test262:AsyncTestComplete"),()=>print("Test262:AsyncTestFailure:Error:async-generator-function-fallback"));`,
);
const expectedOutcomes: readonly ("completed" | "unsupported")[] = sources.map(
  () => "completed",
);
function referenceRealm() {
  const context = createContext();
  const global = runInContext("globalThis", context);
  const api = {
    global,
    createRealm: referenceRealm,
    evalScript: (source: string) => runInContext(source, context),
  };
  Object.assign(context, { $262: api, print: () => {} });
  return { context, ...api };
}
const cases = [];
for (const [index, source] of sources.entries()) {
  // Prototype lookup after parameter initialization follows the specification.
  if (index !== 11)
    await runInContext(
      `(async()=>{const AGF=(async function*(){}).constructor;${bodies[index]}})()`,
      referenceRealm().context,
    );
  const prepared = prepareNativeScripts(
    executionPlan(source, "raw", {
      flags: ["raw"],
      features: [],
      includes: [],
    }),
    "raw",
    [],
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  cases.push({
    scripts: prepared.modules,
    asynchronous: true,
  });
}
const built = createNativeBatchBuilder()(cases);
if (!built.ok) throw Error(JSON.stringify(built.outcome));
if (process.env.TINT_BUILD_ONLY === "1") {
  const path = join(
    mkdtempSync(
      join(tmpdir(), "tint-native-async-generator-function-fallback-"),
    ),
    "async-generator-function-fallback",
  );
  writeFileSync(path, built.bytes, { mode: 0o755 });
  console.log(path);
} else {
  const image = new NativeImageRunner(
    built.bytes,
    nativeTestResources.timeoutMs,
  );
  try {
    for (let selectedCase = 0; selectedCase < cases.length; selectedCase++) {
      const started = performance.now(),
        outcome = image.run(selectedCase);
      console.log(
        JSON.stringify({
          selectedCase,
          outcome,
          elapsedMs: performance.now() - started,
        }),
      );
      assert.equal(outcome.kind, expectedOutcomes[selectedCase]);
    }
  } finally {
    image.close();
  }
}
