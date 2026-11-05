import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, runInContext, type Context } from "node:vm";
import {
  createNativeBatchBuilder,
  prepareNativeScripts,
  nativeTestResources,
} from "./test262-native.ts";
import { NativeImageRunner } from "./test262-native-process.ts";
import { executionPlan } from "./test262-execution.ts";

const sources = [
  `const other=$262.createRealm().global;const r=Proxy.revocable(other.Proxy,{get(t,k){if(k==='prototype'){r.revoke();return null;}return Reflect.get(t,k);}});let caught=false;try{Reflect.construct(Object,[],r.proxy);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 1;const prototype={};const s=Proxy.revocable(other.Proxy,{get(t,k){if(k==='prototype'){s.revoke();return prototype;}return Reflect.get(t,k);}});if(Object.getPrototypeOf(Reflect.construct(Object,[],s.proxy))!==prototype)throw 2;`,

  `const other=$262.createRealm().global;for(const target of [other.Proxy,new Proxy(other.Proxy,{}),other.Proxy.bind(null)]){for(const C of [Error,TypeError,RangeError,ReferenceError,SyntaxError,EvalError,URIError]){const value=Reflect.construct(C,[],target);if(Object.getPrototypeOf(value)!==other[C.name].prototype)throw C.name;}if(Object.getPrototypeOf(Reflect.construct(AggregateError,[[]],target))!==other.AggregateError.prototype)throw 1;if(Object.getPrototypeOf(Reflect.construct(Promise,[()=>{}],target))!==other.Promise.prototype)throw 2;}`,
  `const other=$262.createRealm().global;const a=new other.Array(1,2);if(Object.getPrototypeOf(Array.prototype.slice.call(a))!==Array.prototype)throw 1;const r=Proxy.revocable(function(){},{});const bound=r.proxy.bind(null);const b=[];b.constructor=bound;r.revoke();let caught=false;try{b.map(x=>x);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;`,

  `const other=$262.createRealm().global;for(const C of [Object,Array,Boolean,Number,String,RegExp]){const value=Reflect.construct(C,[],other.Proxy);if(Object.getPrototypeOf(value)!==other[C.name].prototype)throw C.name;}function F(){}const bound=other.Proxy.bind(null);if(Object.getPrototypeOf(Reflect.construct(F,[],bound))!==other.Object.prototype)throw 1;const proxy=new Proxy(other.Proxy,{get(t,k){return k==='prototype'?null:Reflect.get(t,k);}});if(Object.getPrototypeOf(Reflect.construct(F,[],proxy))!==other.Object.prototype)throw 2;`,

  `const e=$262.createRealm().global.eval,o={};if(e()!==undefined||e(o)!==o||e(42)!==42||e(null)!==null)throw 1;`,
  `const other=$262.createRealm().global;if(other===globalThis||other.Object===Object||other.Array.prototype===Array.prototype)throw 1;if(other.globalThis!==other||other.$262.global!==other)throw 2;other.x=42;if(typeof x!=='undefined')throw 3;if(other.Symbol.for('shared')!==Symbol.for('shared')||other.Symbol.iterator!==Symbol.iterator)throw 4;if(other.$262.createRealm().global.Object===other.Object)throw 5;`,
  `const P=$262.createRealm().global.Proxy;const p=new P({}, {get:42});let caught=false;try{p.x;}catch(e){caught=e instanceof TypeError;}if(!caught)throw 1;const r=P.revocable({},{});r.revoke();caught=false;try{Object.getPrototypeOf(r.proxy);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;`,
  `const P=$262.createRealm().global.Proxy;const f=new P(function(){},{apply(t,r,args){return args;}});if(Object.getPrototypeOf(f(42))!==Array.prototype)throw 1;const C=new P(function(){},{construct(t,args){return args;}});if(Object.getPrototypeOf(new C(42))!==Array.prototype)throw 2;let desc;const p=new P({}, {defineProperty(t,k,d){desc=d;return true;}});Object.defineProperty(p,'x',{value:42});if(Object.getPrototypeOf(desc)!==Object.prototype)throw 3;`,
  `const other=$262.createRealm().global;const p=new Proxy({}, {get:42});let caught=false;try{other.Reflect.get(p,'x');}catch(e){caught=e instanceof other.TypeError&&!(e instanceof TypeError);}if(!caught)throw 1;`,
];
function referenceRealm(): {
  global: object;
  context: Context;
  createRealm: typeof referenceRealm;
} {
  const context = createContext();
  const host = {
    context,
    global: runInContext("globalThis", context) as object,
    createRealm: referenceRealm,
  };
  Object.assign(context, { $262: host });
  return host;
}
const cases = sources.map((source) => {
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
// Unsupported dynamic compilation must propagate even if Script catches it.
const unsupported = `try{$262.createRealm().global.eval('1');}catch(e){}`;
const prepared = prepareNativeScripts(
  executionPlan(unsupported, "raw", {
    flags: ["raw"],
    features: [],
    includes: [],
  }),
  "raw",
  [],
);
assert.ok(prepared.ok);
cases.push({ scripts: prepared.modules, asynchronous: false });
const built = createNativeBatchBuilder()(cases);
assert.ok(built.ok, JSON.stringify(built));
if (process.env.TINT_BUILD_ONLY === "1") {
  const path = join(
    mkdtempSync(join(tmpdir(), "tint-native-realms-")),
    "realms",
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
      const outcome = image.run(index);
      assert.equal(
        outcome.kind,
        index === sources.length ? "unsupported" : "completed",
        JSON.stringify({ index, outcome }),
      );
      console.log(JSON.stringify({ index, outcome }));
    }
  } finally {
    image.close();
  }
}
