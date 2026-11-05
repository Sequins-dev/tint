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
  'const C=(async function(){}).constructor;if(await C("x","return await x")(42)!==42)throw 1;',
  'const C=(async function(){}).constructor,f=C("{x}={x:40}","...r","return await x+r.length");if(f.length!==0||await f(undefined,1,2)!==42)throw 1;',
  'const C=(async function(){}).constructor,f=C("a=1","arguments[0]=42;await 1;return [a,arguments[0]]");const r=await f(7);if(r[0]!==7||r[1]!==42)throw 1;',
  'const C=(async function(){}).constructor;if(await C("await 1;return this")()!==globalThis||await C("\\"use strict\\";await 1;return this").call(null)!==null||await C("await 1;return new.target")()!==undefined)throw 1;',
  'const C=(async function(){}).constructor,f=C("await 1;return arguments.callee");if(await f()!==f)throw 1;',
  'const C=(async function(){}).constructor,f=C("a=1","return await a");if(f.name!=="anonymous"||f.length!==0||f.hasOwnProperty("prototype"))throw 1;let bad=false;try{new f()}catch(e){bad=e instanceof TypeError}if(!bad)throw 2;',
  'const C=(async function(){}).constructor,f=C("await missingGlobal");if(f.name!=="anonymous")throw 1;',
  'globalThis.marker={};const C=(async function(){}).constructor,f=C("try{await Promise.reject(marker)}catch(e){return e}finally{globalThis.didFinally=true}");if(await f()!==marker||!didFinally)throw 1;',
  'const C=(async function(){}).constructor,log=[],f=C("log","log.push(\\"b0\\");await 1;log.push(\\"b1\\");return 42");const done=f(log).then(v=>{if(v!==42)throw 1;log.push("settled")});Promise.resolve().then(()=>log.push("t1")).then(()=>log.push("t2")).then(()=>log.push("t3")).then(()=>log.push("t4"));for(let i=0;i<8;i++)await 0;await done;if(log.join()!=="b0,b1,t1,settled,t2,t3,t4")throw 2;',
  'globalThis.marker={};const C=(async function(){}).constructor,f=C("a=(()=>{throw marker})()","return a");let sync=false,p;try{p=f()}catch(e){sync=true}if(sync)throw 1;let caught;try{await p}catch(e){caught=e}if(caught!==marker)throw 2;',
  'const C=(async function(){}).constructor,f=C("x","return x"),input=Promise.resolve(42),p=f(input);if(p===input||await p!==42)throw 1;',
  'globalThis.churn=()=>{for(let i=0;i<1024;i++){const a=new Uint32Array(8192);a[0]=i;if(a[0]!==i)throw 1}};const C=(async function(){}).constructor,f=C("keep","await 1;churn();await 2;return keep()");const keep=(()=>{const x=42;return ()=>x})();if(await f(keep)!==42)throw 2;',
  'const C=(async function(){}).constructor,f=C("let x=40;await 1;return eval(\\"x+2\\")");if(await f()!==42)throw 1;',
  'const other=$262.createRealm().global,C=other.Function("return (async function(){}).constructor")(),f=C("await 1;return [globalThis,Object.getPrototypeOf(this)]"),p=f.call(1);if(Object.getPrototypeOf(p)!==other.Promise.prototype)throw 1;const r=await p;if(r[0]!==other||r[1]!==other.Number.prototype)throw 2;',
  'const C=(async function(){}).constructor,f=C("return async()=>42"),g=await f();if(await g()!==42)throw 1;',
  'const C=(async function(){}).constructor,f=C("a=1","await 1;return a"),a=f(19),b=f(23);if(a===b||await a!==19||await b!==23)throw 1;',
];
const sources = bodies.map(
  (body) =>
    `(async()=>{${body}})().then(()=>print("Test262:AsyncTestComplete"),()=>print("Test262:AsyncTestFailure:Error:async-function-body"));`,
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
  await runInContext(
    `(async()=>{${bodies[index]}})()`,
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
    mkdtempSync(join(tmpdir(), "tint-native-async-function-body-")),
    "async-function-body",
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
