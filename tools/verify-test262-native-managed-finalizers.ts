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
const sources = [
  'globalThis.churn=()=>{for(let i=0;i<1024;i++){const a=new Uint32Array(8192);a[0]=i;if(a[0]!==i)throw 1}};$262.evalScript("async function f(log,value){try{return await value}finally{await 1;churn();log.push(\\"finally\\")}}");const log=[],marker={};f(log,marker).then(v=>{if(v!==marker||log.join()!=="finally")throw 1;print("Test262:AsyncTestComplete")});',
  'const F=(0,eval)("(function*(){try{yield 1;return 3}finally{yield 2}})");const a=F();if(a.next().value!==1||a.next().value!==2||a.next().value!==3)throw 1;const b=F();b.next();if(b.return(42).value!==2)throw 2;const end=b.next();if(end.value!==42||!end.done)throw 3;const marker={},c=F();c.next();if(c.throw(marker).value!==2)throw 4;let caught;try{c.next()}catch(e){caught=e}if(caught!==marker)throw 5;print("Test262:AsyncTestComplete");',
  'const g=(0,eval)("(async function*(){try{yield await 1}finally{await 2;yield 3}})")();(async()=>{const a=await g.next(),b=await g.return(42),c=await g.next();if(a.value!==1||a.done||b.value!==3||b.done||c.value!==42||!c.done)throw 1})().then(()=>print("Test262:AsyncTestComplete"));',
  'const C=(async function(){}).constructor;C("try{return await 7}finally{await 1;return 19}")().then(v=>{if(v!==19)throw 1;print("Test262:AsyncTestComplete")});',
  'globalThis.first={};globalThis.second={};const C=(async function(){}).constructor;C("try{throw first}finally{await 1;throw second}")().then(()=>{throw 1},e=>{if(e!==second)throw 2;print("Test262:AsyncTestComplete")});',
];
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
  await runInContext(source, referenceRealm().context);
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
    mkdtempSync(join(tmpdir(), "tint-native-managed-finalizers-")),
    "managed-finalizers",
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
