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
  'function f(){const before=()=>w;eval("var w=42");return before}if(f()()!==42)throw 1;',
  'function f(){eval("\\\"use strict\\\";var hidden=1");return typeof hidden}if(f()!=="undefined")throw 1;',
  'function f(a=eval("var made=40")){return made+2}if(f()!==42)throw 1;',
  'function f(p=eval("var arguments")){}let caught=false;try{f()}catch(e){caught=e instanceof SyntaxError}if(!caught)throw 1;',
  'function f(){let x=1;let caught=false;try{eval("var x")}catch(e){caught=e instanceof SyntaxError}if(!caught)throw 1;for(let y=0;y<1;y++){caught=false;try{eval("var y")}catch(e){caught=e instanceof SyntaxError}if(!caught)throw 2}}f();',
  'function f(){var v=40;with({eval}){eval("var w=v+2")}return w}if(f()!==42)throw 1;',
  'var o={};function k(){return eval("this")}function n(){return eval("new.target")}if(k.call(o)!==o||new n()!==n)throw 1;',
  'function f(){return [eval("1;{}"),eval("var q=1"),eval(""),eval("\\\"use strict\\\";2")]}const r=f();if(r[0]!==1||r[1]!==undefined||r[2]!==undefined||r[3]!==2)throw 1;',
  'const t={};function f(){try{eval("throw t")}catch(e){return e===t}}if(f()!==true)throw 1;',
  'function f(){eval("eval(\\\"var z=7\\\")");return z}if(f()!==7)throw 1;',
  'function* g(a){eval("var w=arguments[0]+2");yield w}const i=g(40);if(i.next().value!==42)throw 1;',
  'async function f(){eval("var w=40");await 1;return w+2}f().then(v=>{if(v!==42)throw 1;print("Test262:AsyncTestComplete")});',
  'var complete=false;function f(){eval("Promise.resolve().then(()=>{complete=true})");if(complete)throw 1}f();Promise.resolve().then(()=>{if(!complete)throw 2;print("Test262:AsyncTestComplete")});',
  'function make(){let x=42;eval("var c=()=>x");return c}const keep=make();for(let i=0;i<20000;i++){const a=[i,i,i,i,i,i,i,i];if(a[0]!==i)throw 1;}if(keep()!==42)throw 2;',
  '({m(){return eval("1")}}).m();',
  'class C{x=eval("1")}new C();',
  'class C{#m(){return eval("this.#m")}run(){return this.#m()}}new C().run();',
  'class D extends Object{constructor(){eval("1");super()}}new D();',
  'const base={get x(){return this.v}};const o={__proto__:base,v:42,m(){return eval("super.x")}};if(o.m()!==42)throw 1;',
  'class B{get x(){return this.v}}class C extends B{v=42;x=eval("super.x");static y=eval("new.target")}if(new C().x!==42||C.y!==undefined)throw 1;',
  'class B{static x=42}class C extends B{static{if(eval("super.x")!==42||eval("this")!==C||eval("new.target")!==undefined)throw 1}}',
  'class D extends Object{constructor(){if(eval("1")!==1||eval(7)!==7)throw 1;let caught=false;try{eval("this")}catch(e){caught=e instanceof ReferenceError}if(!caught)throw 2;const get=eval("()=>this");eval("super()");if(get()!==this||eval("new.target")!==D)throw 3}}new D();',
  'const log=[];class B{constructor(){log.push("B")}}class D extends B{x=log.push("field");constructor(){super();let caught=false;try{eval("super(log.push(\\"arg\\"))")}catch(e){caught=e instanceof ReferenceError}if(!caught||log.join()!=="B,field,arg,B")throw 1}}new D();',
  'const log=[];class B{get x(){return 42}}class D extends B{constructor(){let caught=false;try{eval("super[(log.push(\\"key\\"),\\"x\\")]")}catch(e){caught=e instanceof ReferenceError}if(!caught||log.length!==0)throw 1;super();if(eval("super.x")!==42)throw 2}}new D();',
  'class C{x=(()=>{let caught=false;try{eval("arguments")}catch(e){caught=e instanceof SyntaxError}if(!caught)throw 1;return 42})()}if(new C().x!==42)throw 2;',
  'const o={m(){eval("var leaked=42");return leaked}};if(o.m()!==42)throw 1;',
  'class C{static{if(eval("arguments.length")!==0)throw 1}}',
  'class C{#x=42;m(){return eval("this.#x")}}new C().m();',
  'class C{#x=42;static read(o){return eval("o.#x")}}if(C.read(new C())!==42)throw 1;let bad=false;try{C.read({})}catch(e){bad=e instanceof TypeError}if(!bad)throw 2;',
  'const log=[];class C{#x;m(){try{eval("log.push(1);this.#missing")}catch(e){if(!(e instanceof SyntaxError))throw e;return}throw 1}}new C().m();if(log.length!==0)throw 2;',
  'class C{#x;m(){let caught=false;try{eval("class D{m(){return this.#missing}};throw 1")}catch(e){caught=e instanceof SyntaxError}if(!caught)throw 2}}new C().m();',
  'class C{#x=1;m(){const D=eval("class D{#x=2;static read(o){return o.#x}};D");if(D.read(new D())!==2||eval("this.#x")!==1)throw 1;let bad=false;try{D.read(this)}catch(e){bad=e instanceof TypeError}if(!bad)throw 2}}new C().m();',
  'class C{#x=42;m(){return eval("eval(\\"this.#x\\")")}}if(new C().m()!==42)throw 1;',
  'class C{#x=42;m(){const self=this;return eval("(()=>{function f(){return self.#x}return f()})()")}}if(new C().m()!==42)throw 1;',
  'class C{static #v=40;static get x(){return eval("this.#v")}static set x(v){eval("this.#v=v")}}C.x=42;if(C.x!==42)throw 1;',
  'class O{#x=1;static check(o){let result;class I extends (result=eval("o.#x"),Object){#x=2}return result}}if(O.check(new O())!==1)throw 1;',
  'let read;class C{#x=42;[(read=(o)=>eval("o.#x"),"m")](){}}if(read(new C())!==42)throw 1;let bad=false;try{read({})}catch(e){bad=e instanceof TypeError}if(!bad)throw 2;',
  'class C{#x=42;m(){return eval("()=>this.#x")}}const keep=new C().m();for(let i=0;i<20000;i++){const a=[i,i,i,i,i,i,i,i];if(a[0]!==i)throw 1}if(keep()!==42)throw 2;',
  'class D extends Object{#x=42;y=eval("this.#x")}if(new D().y!==42)throw 1;',
  'class D extends Object{#x=42;constructor(){let caught=false;try{eval("this.#x")}catch(e){caught=e instanceof ReferenceError}if(!caught)throw 1;super();if(eval("this.#x")!==42)throw 2}}new D();',
  'class C{#x=42;async m(){await 1;return eval("this.#x")}}new C().m().then(v=>{if(v!==42)throw 1;print("Test262:AsyncTestComplete")});',
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
  // Pinned func-decl-no-pre-existing-arguments-bindings-are-present-declare-arguments.js
  // requires SyntaxError; V8 accepts it. Static-block eval arguments (26) also
  // differs: the spec supplies the static block function arguments binding.
  if (
    expectedOutcomes[index] === "completed" &&
    index !== 3 &&
    index !== 26 &&
    index !== 35
  )
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
    asynchronous: index === 11 || index === 12 || index === 40,
  });
}
const built = createNativeBatchBuilder()(cases);
if (!built.ok) throw Error(JSON.stringify(built.outcome));
if (process.env.TINT_BUILD_ONLY === "1") {
  const path = join(
    mkdtempSync(join(tmpdir(), "tint-native-direct-eval-")),
    "direct-eval",
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
