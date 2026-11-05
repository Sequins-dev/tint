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
  '$262.evalScript("async function h(){return await 7}");h().then(v=>{if(v!==7)throw 1;print("Test262:AsyncTestComplete")});',
  'const g=(0,eval)("(function*(){var x=yield 1;return x+1})")();const a=g.next(),b=g.next(41);if(a.value!==1||a.done||b.value!==42||!b.done)throw 1;print("Test262:AsyncTestComplete");',
  'const f=new Function("return (async function(){}).constructor")();if(f!==Object.getPrototypeOf(async function(){}).constructor)throw 1;const g=new Function("return (async function*(){}).constructor")();if(g!==Object.getPrototypeOf(async function*(){}).constructor)throw 2;print("Test262:AsyncTestComplete");',
  'const g=(0,eval)("(async function*(){yield await 1;return 2})")();g.next().then(a=>{if(a.value!==1||a.done)throw 1;return g.next()}).then(b=>{if(b.value!==2||!b.done)throw 2;print("Test262:AsyncTestComplete")});',
  '$262.evalScript("async function h(){try{await Promise.reject(9)}catch(e){return e}}");h().then(v=>{if(v!==9)throw 1;print("Test262:AsyncTestComplete")});',
  'function churn(){for(let i=0;i<1024;i++){const bytes=new Uint32Array(8192);bytes[0]=i;if(bytes[0]!==i)throw 1}}$262.evalScript("async function h(keep){await 1;churn();await 2;return keep()}");const keep=(()=>{const x=42;return ()=>x})();h(keep).then(v=>{if(v!==42)throw 2;print("Test262:AsyncTestComplete")});',
  '$262.evalScript("async function h(log){log.push(\\"a\\");await 0;log.push(\\"b\\");await 0;log.push(\\"c\\")}");const log=[];const p=h(log);Promise.resolve().then(()=>log.push("t1")).then(()=>log.push("t2"));p.then(()=>{if(log.join()!=="a,b,t1,c,t2")throw 1;print("Test262:AsyncTestComplete")});',
];
const expectedOutcomes: readonly ("completed" | "unsupported")[] = [
  "completed",
  "completed",
  "completed",
  "completed",
  "completed",
  "completed",
  "completed",
];
assert.equal(expectedOutcomes.length, sources.length);
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
    mkdtempSync(join(tmpdir(), "tint-native-managed-suspension-")),
    "managed-suspension",
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
