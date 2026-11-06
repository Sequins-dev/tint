import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Script } from "node:vm";
import {
  createNativeBatchBuilder,
  prepareNativeScripts,
} from "./test262-native.ts";
import { executionPlan } from "./test262-execution.ts";
import {
  workspaceSources,
  workspaceSourceIdentity,
  readWorkspaceSourceSnapshot,
} from "./workspace-sources.ts";

// Stage 3 proposal nonextensible-applies-to-private (pinned Test262 feature
// flag; https://tc39.es/proposal-nonextensible-applies-to-private/). ES2025 still
// allows these additions. PrivateFieldAdd performs ? IsExtensible(O) before its
// duplicate check; InitializeInstanceElements performs one ? IsExtensible(O)
// before a non-empty private method batch. Node 24 / V8 does not implement the
// proposal, so Node only syntax-checks these cases; it is not an oracle here.
// The final case is baseline ECMA-262: base-class OrdinaryCreateFromConstructor
// (10.2.2 step 5.a) precedes PrepareForOrdinaryCall, so it reports in the caller
// realm. V8 agrees on that case.
assert.equal(
  process.env.TINT_BUILD_ONLY,
  "1",
  "Build only; execute through the serial LLDB fixture recorder",
);
const trojan = `class B{constructor(o){return o;}}`;
const sources = [
  {
    name: "return-override private field rejects non-extensible object",
    source: `${trojan}class A extends B{#v;constructor(o){super(o);this.#v=42;}static v(o){return o.#v;}}const t=new A({});if(A.v(t)!==42)throw 70;let ok=false;const s=Object.preventExtensions({});try{new A(s);}catch(e){ok=e instanceof TypeError;}if(!ok)throw 71;`,
  },
  {
    name: "return-override private method and accessor reject non-extensible object",
    source: `${trojan}class M extends B{#m(){return 1;}static has(o){return #m in o;}}class G extends B{get #g(){return 2;}static has(o){return #g in o;}}for(const C of [M,G]){if(!C.has(new C({})))throw 72;const s=Object.preventExtensions({});let ok=false;try{new C(s);}catch(e){ok=e instanceof TypeError;}if(!ok||C.has(s))throw 73;}`,
  },
  {
    name: "base preventExtensions(this) blocks derived private elements",
    source: `class N{constructor(seal){if(seal)Object.preventExtensions(this);}}class F extends N{#v=1;}class M extends N{#m(){}}class P extends N{x=1;}for(const C of [F,M,P]){new C(false);let ok=false;try{new C(true);}catch(e){ok=e instanceof TypeError;}if(!ok)throw 74;}`,
  },
  {
    name: "existing private fields stay writable after seal and freeze",
    source: `${trojan}class A extends B{#a=1;static get(o){return o.#a;}static inc(o){o.#a++;}}const o={};new A(o);Object.seal(o);A.inc(o);if(A.get(o)!==2)throw 75;Object.freeze(o);A.inc(o);if(A.get(o)!==3||!Object.isFrozen(o))throw 76;`,
  },
  {
    name: "proxy isExtensible is observed per field and once per method batch",
    source: `${trojan}let n=0;const p=()=>new Proxy({},{isExtensible(t){n++;return Reflect.isExtensible(t);}});class F extends B{#a;#b;x=1;}class M extends B{#m(){}#n(){}get #g(){return 0;}}class E extends B{x=1;}new F(p());if(n!==2)throw 77;n=0;new M(p());if(n!==1)throw 78;n=0;new E(p());if(n!==0)throw 79;`,
  },
  {
    name: "throwing isExtensible trap aborts private element addition",
    source: `${trojan}const err={};const p=new Proxy({},{isExtensible(){throw err;}});class F extends B{#a;static has(o){return #a in o;}}class M extends B{#m(){}static has(o){return #m in o;}}for(const C of [F,M]){let ok=false;try{new C(p);}catch(e){ok=e===err;}if(!ok||C.has(p))throw 80;}`,
  },
  {
    name: "private field initializer runs before the extensibility rejection",
    source: `${trojan}const log=[];class A extends B{#x=(log.push('x'),1);y=log.push('y');}let ok=false;try{new A(Object.preventExtensions({}));}catch(e){ok=e instanceof TypeError;}if(!ok||log.join()!=='x')throw 81;`,
  },
  {
    name: "this stays bound when instance element initialization rejects",
    source: `${trojan}class A extends B{#x;constructor(o){try{super(o);}catch(e){if(!(e instanceof TypeError))throw 82;}}static has(o){return #x in o;}}const s=Object.preventExtensions({});const r=new A(s);if(r!==s||A.has(s))throw 83;`,
  },
  {
    name: "static private field rejects a non-extensible class constructor",
    source: `const log=[];let ok=false;try{class C{static{Object.preventExtensions(this);}static #x=(log.push('x'),1);}}catch(e){ok=e instanceof TypeError;}if(!ok||log.join()!=='x')throw 84;class D{static #m(){return 5;}static m(){return D.#m();}}if(D.m()!==5)throw 85;`,
  },
  {
    name: "foreign class rejects in its defining realm",
    source: `const h=$262.createRealm(),o=h.global,C=h.evalScript('class B{constructor(o){return o;}} (class extends B{#x;})');let ok=false;try{new C(Object.preventExtensions({}));}catch(e){ok=e instanceof o.TypeError&&!(e instanceof TypeError);}if(!ok)throw 86;`,
  },
  {
    name: "foreign base class creates its instance in the caller realm",
    source: `const r=$262.createRealm(),o=r.global,C=r.evalScript('(class {})'),h=Proxy.revocable(function(){},{get(){h.revoke();}});let ok=false;try{Reflect.construct(C,[],h.proxy);}catch(e){ok=e instanceof TypeError&&!(e instanceof o.TypeError);}if(!ok)throw 87;`,
  },
];
const cases = sources.map(({ source }) => {
  new Script(source);
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
const captured = process.env.TINT_TEST262_SOURCES;
const snapshot =
  captured === undefined
    ? workspaceSources()
    : readWorkspaceSourceSnapshot(captured);
const built = createNativeBatchBuilder(snapshot)(cases);
if (!built.ok) throw Error(JSON.stringify(built.outcome));
const directory = mkdtempSync(
    join(tmpdir(), "tint-native-class-instance-elements-"),
  ),
  binary = join(directory, "class-instance-elements"),
  fixture = join(directory, "cases.json");
writeFileSync(binary, built.bytes, { mode: 0o755, flag: "wx" });
writeFileSync(
  fixture,
  JSON.stringify(
    {
      kind: "native-class-instance-elements-fixture",
      conformance: false,
      cases: sources.map((item) => ({
        ...item,
        expected: { kind: "completed" },
      })),
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
writeFileSync(
  binary + ".manifest.json",
  JSON.stringify(
    {
      kind: "tint-hosted-native-build",
      version: 1,
      sourceSnapshot: workspaceSourceIdentity(snapshot),
      imageSha256: createHash("sha256").update(built.bytes).digest("hex"),
      fixture,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(binary);
