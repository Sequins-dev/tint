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
  'if($262.evalScript("1+2")!==3)throw 1;$262.evalScript("let live=40;");if($262.evalScript("live+2")!==42)throw 2;',
  'let caught=false;try{$262.evalScript("let a;let a;")}catch(e){caught=e instanceof SyntaxError;}if(!caught)throw 1;Object.defineProperty(globalThis,"fixed",{value:1,configurable:false});caught=false;try{$262.evalScript("function fixed(){}")}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;',
  'const child=$262.createRealm();child.evalScript("var w=1");if(typeof w!=="undefined"||child.global.w!==1)throw 1;let caught=false;try{child.evalScript("let a;let a;")}catch(e){caught=e instanceof child.global.SyntaxError&&!(e instanceof SyntaxError);}if(!caught)throw 2;',
  'try{$262.evalScript("t`x`")}catch(e){}try{$262.evalScript("42")}catch(e){}',
  'globalThis.j=0;$262.evalScript("Promise.resolve().then(()=>{globalThis.j=1})");if(j!==0)throw 1;Promise.resolve().then(()=>{if(j!==1)throw 2;print("Test262:AsyncTestComplete")});',
  "if($262.evalScript(" +
    JSON.stringify('"' + String.fromCharCode(0xd800) + '"') +
    ").charCodeAt(0)!==0xD800)throw 1;",
  'if(Function("return 1")()!==1||$262.evalScript("2")!==2)throw 1;',
];
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
  // Node vm reports SyntaxError for the restricted global function declaration;
  // Test262 script-decl-func-err-non-configurable.js requires TypeError.
  if (index !== 1) runInContext(source, referenceRealm().context);
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
  return { scripts: prepared.modules, asynchronous: index === 4 };
});
const built = createNativeBatchBuilder()(cases);
if (!built.ok) throw new Error(JSON.stringify(built.outcome));
if (process.env.TINT_BUILD_ONLY === "1") {
  const path = join(
    mkdtempSync(join(tmpdir(), "tint-native-eval-script-")),
    "eval-script",
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
      assert.equal(outcome.kind, "completed");
    }
  } finally {
    image.close();
  }
}
