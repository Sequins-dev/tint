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
  'if(Function("a","b","return a+b")(40,2)!==42)throw 1;',
  'if(Function("a","arguments[0]=2;return a")(1)!==2||Function("a","\'use strict\';arguments[0]=2;return a")(1)!==1||Function("a=0","arguments[0]=2;return a")(1)!==1)throw 1;',
  'const f=Function("a","{x}={x:1}","...r","return a+x+r.length");if(f.length!==1||f(40,undefined,0)!==42)throw 1;',
  'if(Function("a","a","return a")(1,2)!==2)throw 1;',
  'if(Function("return this")()!==globalThis||Function("\'use strict\';return this")()!==undefined)throw 1;const other=$262.createRealm().global;const boxed=other.Function("return this").call(1);if(Object.getPrototypeOf(boxed)!==other.Number.prototype)throw 2;',
  'const f=Function("return arguments.callee");if(f()!==f||Function("return typeof anonymous")()!=="undefined")throw 1;',
  'const F=Function("return new.target");function G(){}if(new F()!==F||Reflect.construct(F,[],G)!==G)throw 1;const H=Function("this.x=1");const h=new H();if(h.x!==1||Object.getPrototypeOf(h)!==H.prototype)throw 2;',
  'const other=$262.createRealm().global;if(other.Function("return this")()!==other)throw 1;let caught=false;try{other.Function("null.x")()}catch(e){caught=e instanceof other.TypeError&&!(e instanceof TypeError)}if(!caught)throw 2;',
  'const late=Function("return later");globalThis.later=42;if(late()!==42||Function("created=42;return created")()!==42||created!==42)throw 1;let caught=false;try{Function("\'use strict\';missing=1")()}catch(e){caught=e instanceof ReferenceError}if(!caught)throw 2;',
  'const count=Function("var x=0;return function(){return ++x}")();if(count()!==1)throw 1;for(let i=0;i<20000;i++){const a=[i,i,i,i,i,i,i,i];if(a[0]!==i)throw 2;}if(count()!==2)throw 3;',
  'if(Function("{function q(){return 7}} return q()")()!==7)throw 1;',
  'if(Function("return this")()!==globalThis||Function("x","return x")(42)!==42)throw 1;',
  'const never=Function("return tag`x`");if(typeof never!=="function")throw 1;',
  'if(Function("return arguments[0]")()!==undefined)throw 1;',
  'const f=Function("return tag`x`");try{f()}catch(e){}',
  'const f=Function("return eval(\\"1\\")");try{f()}catch(e){}',
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
    mkdtempSync(join(tmpdir(), "tint-native-function-fallback-")),
    "function-fallback",
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
