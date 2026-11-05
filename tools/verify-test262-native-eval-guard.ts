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
  "for(const value of [undefined,null,false,7,Symbol(),{}]){if(eval(value)!==value)throw 1;}if(eval()!==undefined||eval(...[])!==undefined)throw 2;",
  "const o={y:3};if((eval)(o)!==o||((eval))(o)!==o||eval(o)?.y!==3||(eval(o))?.y!==3)throw 1;if(eval(function(){return 9})()!==9)throw 2;",
  'var log="";globalThis.eval=function(){"use strict";log+="c";return this};if(eval((log+="a",1),(log+="b",2))!==undefined||log!=="abc")throw 1;var w={eval:function(){"use strict";return this}};with(w){if(eval(1)!==w)throw 2;}',
  'var log="";let caught=false;try{{eval(log+="a");let eval;}}catch(e){caught=e instanceof ReferenceError;}if(!caught||log!=="")throw 1;globalThis.eval=undefined;caught=false;try{eval(1)}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;',
  "const other=$262.createRealm().global.eval;{let eval=other;if(eval(7)!==7)throw 1;}if(eval?.(7)!==7||(0,eval)(7)!==7||globalThis.eval(7)!==7)throw 2;",
  'if($262.evalScript("eval(7)")!==7)throw 1;if($262.evalScript("globalThis.eval=function(n){return n+1};eval(4)")!==5)throw 2;',
  'try{eval("1")}catch(e){}',
  'try{eval("1")?.y}catch(e){}',
  "try{$262.evalScript('eval(\"1\")?.y')}catch(e){}",
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
    mkdtempSync(join(tmpdir(), "tint-native-eval-guard-")),
    "eval-guard",
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
