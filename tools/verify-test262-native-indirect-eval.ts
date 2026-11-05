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
  'if((0,eval)("1+2")!==3)throw 1;',
  'const e=eval;e("var shared=40;let hidden=2;");if(shared!==40||typeof hidden!=="undefined"||e("typeof hidden")!=="undefined")throw 1;',
  'const e=eval;e("\\\"use strict\\\";var privateVar=1;function privateFn(){}");if(typeof privateVar!=="undefined"||typeof privateFn!=="undefined")throw 1;',
  'if(globalThis.eval("this")!==globalThis||eval?.("42")!==42)throw 1;',
  'const e=eval;e("{function annex(){return 7;}}");if(annex()!==7)throw 1;',
  'const child=$262.createRealm();const e=child.global.eval;if(e("this")!==child.global)throw 1;e("var foreign=42");if(child.global.foreign!==42||typeof foreign!=="undefined")throw 2;',
  'const child=$262.createRealm();let caught=false;try{child.global.eval("let a;let a;")}catch(e){caught=e instanceof child.global.SyntaxError&&!(e instanceof SyntaxError)}if(!caught)throw 1;',
  'const e=eval;let caught=false;try{e("throw 7")}catch(x){caught=x===7}if(!caught)throw 1;',
  'const e=eval;if(e("1;{}")!==1||e("var q=1")!==undefined||e("if(false);")!==undefined)throw 1;',
  'const e=eval;globalThis.done=0;e("Promise.resolve().then(()=>{globalThis.done=1})");if(done!==0)throw 1;Promise.resolve().then(()=>{if(done!==1)throw 2;print("Test262:AsyncTestComplete")});',
  'const e=eval;for(const v of [undefined,null,false,7,Symbol(),{}])if(e(v)!==v)throw 1;if(e()!==undefined||e("")!==undefined||e(" /*c*/ ")!==undefined)throw 2;',
  'const e=eval;if(e("(0,eval)(\\\"2+3\\\")")!==5)throw 1;',
  'const child=$262.createRealm();{let eval=child.global.eval;if(eval("21*2")!==42)throw 1;}',
  'if($262.evalScript("(0,eval)(\\\"40+2\\\")")!==42||Function("return 1")()!==1)throw 1;',
  'try{eval("1")}catch(e){}',
  'try{eval("1")?.y}catch(e){}',
  'try{with({eval})eval("1")}catch(e){}',
  'try{$262.evalScript("eval(\\\"1\\\")")}catch(e){}',
  'try{(0,eval)("eval(\\\"1\\\")?.y")}catch(e){}',
  'try{(0,eval)("t`x`")}catch(e){}',
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
  "completed",
  "completed",
  "completed",
  "completed",
  "completed",
  "unsupported",
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
  return { scripts: prepared.modules, asynchronous: index === 9 };
});
const built = createNativeBatchBuilder()(cases);
if (!built.ok) throw new Error(JSON.stringify(built.outcome));
if (process.env.TINT_BUILD_ONLY === "1") {
  const path = join(
    mkdtempSync(join(tmpdir(), "tint-native-indirect-eval-")),
    "indirect-eval",
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
