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
  "class D extends Object{constructor(){eval(7);super()}}new D();",
  "class D extends Object{constructor(){(()=>eval(7))();super()}}new D();",
  "var o={m(){return eval(7)}};if(o.m()!==7)throw 1;",
  "class C{#p=1;x=eval(7);static y=eval(8);static{if(eval(9)!==9)throw 1}m(){return eval(this.#p)}}const c=new C();if(c.x!==7||C.y!==8||c.m()!==1)throw 1;",
  "function*g(){return eval(yield 1)}const i=g();i.next();if(i.next(5).value!==5)throw 1;",
  "function f(eval){return eval(1,2)}if(f((a,b)=>a+b)!==3)throw 1;var o={eval(){return this}};with(o){if(eval(1)!==o)throw 2}",
  'function f(){var eval=$262.createRealm().global.eval;return [eval(7),eval("var z=1;z")]}const r=f();if(r[0]!==7||r[1]!==1)throw 1;',
  "var o;o?.f(eval(7));var t={toString(){throw 1}};if(eval(t)!==t||eval()!==undefined)throw 2;",
  "function f(a=eval(7)){try{throw 1}catch(e){try{throw{}}catch({x}){with({}){return eval(a)}}}}if(f()!==7)throw 1;",
  'if((0,eval)("eval(7)")!==7||(0,eval)("\'use strict\';eval(8)")!==8)throw 1;',
  'if($262.evalScript("function h(){return eval(7)}h()")!==7)throw 1;',
  "function f(){let s=0;for(let i=0;i<20000;i++){try{throw i}catch(e){s+=eval(1)}}return s}if(f()!==20000)throw 1;",
  'function f(){try{throw 1}catch(e){eval("1")}}f();',
  'class D extends Object{constructor(){eval("1");super()}}new D();',
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
    mkdtempSync(join(tmpdir(), "tint-native-eval-site-")),
    "eval-site",
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
