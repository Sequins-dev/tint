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
  'const f=GF("x","y","yield x+y"),g=f(2,3);if(g.next().value!==5||!g.next().done)throw 1;',
  'const g=GF("a=1","...rest","var x=yield a;yield* rest;return x+arguments.length")(undefined,7,8);if(g.next().value!==1||g.next(10).value!==7||g.next().value!==8||g.next().value!==13)throw 1;',
  'const g=GF("a","arguments[0]=2;yield a;a=3;yield arguments[0]")(1);if(g.next().value!==2||g.next().value!==3||GF("a","\\"use strict\\";arguments[0]=2;yield a")(1).next().value!==1)throw 1;',
  'if(GF("a","a","yield a")(1,2).next().value!==2||GF("a","b=1","").length!==1)throw 1;',
  'globalThis.F=GF("yield arguments.callee===F;yield new.target");const g=F();if(g.next().value!==true||g.next().value!==undefined)throw 1;',
  'let caught=false;try{GF("a=(()=>{throw 7})()","")()}catch(e){caught=e===7}if(!caught)throw 1;',
  'const f=GF("yield 1;yield 2"),a=f(),b=f(),c=f();if(a.return(5).value!==5||!a.next().done)throw 1;let caught=false;try{b.throw(3)}catch(e){caught=e===3}if(!caught||!b.next().done||c.next().value!==1||c.return(9).value!==9)throw 2;',
  'const g=GF("throw 8")();let caught=false;try{g.next()}catch(e){caught=e===8}if(!caught||!g.next().done)throw 1;',
  'const f=GF("yield 1"),p=Object.getPrototypeOf(f.prototype);let caught=false;try{new f()}catch(e){caught=e instanceof TypeError}if(!caught||Object.getPrototypeOf(f())!==f.prototype)throw 1;f.prototype=1;if(Object.getPrototypeOf(f())!==p)throw 2;',
  'globalThis.P2={};globalThis.F=GF("a=(F.prototype=P2)","yield a");if(Object.getPrototypeOf(F())!==P2)throw 1;',
  'const other=$262.createRealm().global,C=other.Function("return (function*(){}).constructor")(),g=C("yield this;yield new TypeError(\\"t\\")")();if(g.next().value!==other||!(g.next().value instanceof other.TypeError)||!(g instanceof other.Object))throw 1;',
  'if(GF("\\"use strict\\";yield this").call(5).next().value!==5)throw 1;const v=GF("yield this").call(1).next().value;if(typeof v!=="object"||Object.getPrototypeOf(v)!==Number.prototype)throw 2;',
  'const g=GF("let i=0;while(i<2){try{yield i++}catch(e){yield \\"caught \\"+e}}")();if(g.next().value!==0||g.throw("x").value!=="caught x"||g.next().value!==1)throw 1;',
  'globalThis.finalized=false;const f=GF("try{yield 1}finally{globalThis.finalized=true;yield 2}"),g=f();if(g.next().value!==1||g.return(42).value!==2||g.next().value!==42||!finalized)throw 1;',
  'if(GF("yield eval(\\"1\\")")().next().value!==1)throw 1;',
  'const g=GF("const x={v:42};yield 1;return ()=>x.v")();if(g.next().value!==1)throw 1;for(let i=0;i<1024;i++){const a=new Uint32Array(8192);a[0]=i}if(g.next().value()!==42)throw 2;',
  "if(!GF()().next().done)throw 1;",
];
const sources = bodies.map(
  (body) => `const GF=(function*(){}).constructor;${body}`,
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
  // Case 9 follows specification prototype ordering, a reviewed V8 divergence.
  if (index !== 9) runInContext(source, referenceRealm().context);
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
    asynchronous: false,
  });
}
const built = createNativeBatchBuilder()(cases);
if (!built.ok) throw Error(JSON.stringify(built.outcome));
if (process.env.TINT_BUILD_ONLY === "1") {
  const path = join(
    mkdtempSync(join(tmpdir(), "tint-native-generator-function-fallback-")),
    "generator-function-fallback",
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
