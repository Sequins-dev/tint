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
  "function f(a){let x=a;function g(){return x;}eval(7);x++;return g;}if(f(1)()!==2)throw 1;",
  "function f(a=eval(7),b=()=>a){var a=42;return [b(),a]}const r=f();if(r[0]!==7||r[1]!==42)throw 1;",
  "function f(a){let x=1;eval(7);arguments[0]=42;return [a,x]}const r=f(1);if(r[0]!==42||r[1]!==1)throw 1;",
  "function f(){eval(7);let caught=false;try{x}catch(e){caught=e instanceof ReferenceError}let x=1;if(!caught)throw 1;return x}if(f()!==1)throw 2;",
  "function f(){let x=1;eval(7);{function g(){return x}}return g()}if(f()!==1)throw 1;",
  "function f(){let a=1;const g=()=>{let b=2;eval(7);return a+b};return g}if(f()()!==3)throw 1;",
  "function f(eval,a=eval(7)){let x=a;eval(9);return x}if(f(x=>x+1)!==8)throw 1;",
  'if($262.evalScript("function f(a=eval(7)){let x=a;eval(7);return()=>x};f()()")!==7)throw 1;',
  'function f(){let x;try{eval("var x")}catch(e){}}f();',
];
const expectedOutcomes: readonly ("completed" | "unsupported")[] = [
  "completed",
  "completed",
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
    evalScript: (text: string) => runInContext(text, context),
  };
  Object.assign(context, { $262: api, print: () => {} });
  return { context, ...api };
}
const cases = sources.map((source, index) => {
  if (expectedOutcomes[index] === "completed")
    runInContext(source, referenceRealm().context);
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
  return { scripts: prepared.modules, asynchronous: false };
});
const built = createNativeBatchBuilder()(cases);
if (!built.ok) throw new Error(JSON.stringify(built.outcome));
if (process.env.TINT_BUILD_ONLY === "1") {
  const path = join(
    mkdtempSync(join(tmpdir(), "tint-native-eval-environments-")),
    "eval-environments",
  );
  writeFileSync(path, built.bytes, { mode: 0o755 });
  console.log(path);
} else {
  const image = new NativeImageRunner(
    built.bytes,
    nativeTestResources.timeoutMs,
  );
  try {
    for (let index = 0; index < cases.length; index++) {
      const started = performance.now(),
        outcome = image.run(index);
      console.log(
        JSON.stringify({
          index,
          outcome,
          elapsedMs: performance.now() - started,
        }),
      );
      assert.equal(outcome.kind, expectedOutcomes[index]);
    }
  } finally {
    image.close();
  }
}
