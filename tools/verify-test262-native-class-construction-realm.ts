import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, runInContext, type Context } from "node:vm";
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

// Baseline ECMA-262 class construction realms. 10.2.2 [[Construct]] step 5.a
// (OrdinaryCreateFromConstructor) precedes PrepareForOrdinaryCall, so prototype
// lookup and GetFunctionRealm(newTarget) run in the caller's context; instance
// elements and the body run in the class realm. Private elements may still be
// added to non-extensible objects: the Stage 3 nonextensible-applies-to-private
// proposal is deliberately not part of this fixture.
assert.equal(
  process.env.TINT_BUILD_ONLY,
  "1",
  "Build only; execute through the serial LLDB fixture recorder",
);
const trojan = `class B{constructor(o){return o;}}`;
const sources = [
  {
    name: "foreign base class revoked newTarget reports in the caller realm",
    source: `const r=$262.createRealm(),o=r.global,C=r.evalScript('(class {})'),h=Proxy.revocable(function(){},{get(){h.revoke();}});let ok=false;try{Reflect.construct(C,[],h.proxy);}catch(e){ok=e instanceof TypeError&&!(e instanceof o.TypeError);}if(!ok)throw 90;`,
  },
  {
    name: "foreign base class with field still reports revocation in the caller realm",
    source: `const r=$262.createRealm(),o=r.global,C=r.evalScript('(class {x=1;#y=2;})'),h=Proxy.revocable(function(){},{get(){h.revoke();}});let ok=false;try{Reflect.construct(C,[],h.proxy);}catch(e){ok=e instanceof TypeError&&!(e instanceof o.TypeError);}if(!ok)throw 91;`,
  },
  {
    name: "non-object newTarget prototype falls back to the newTarget realm",
    source: `const r=$262.createRealm(),o=r.global,C=r.evalScript('(class {})'),N=function(){};N.prototype=null;const a=Reflect.construct(C,[],N);if(Object.getPrototypeOf(a)!==Object.prototype)throw 92;const M=o.Function();M.prototype=1;const b=Reflect.construct(C,[],M);if(Object.getPrototypeOf(b)!==o.Object.prototype)throw 93;`,
  },
  {
    name: "foreign base field initializer errors use the class realm",
    source: `const r=$262.createRealm(),o=r.global,C=r.evalScript('(class {x=null.y;})');let ok=false;try{new C();}catch(e){ok=e instanceof o.TypeError&&!(e instanceof TypeError);}if(!ok)throw 94;`,
  },
  {
    name: "prototype lookup precedes fields and body",
    source: `const log=[];class C{x=log.push('field');constructor(){log.push('body');}}const N=new Proxy(function(){},{get(t,k){log.push('proto');return Reflect.get(t,k);}});Reflect.construct(C,[],N);if(log.join()!=='proto,field,body')throw 95;`,
  },
  {
    name: "baseline private fields and methods attach to non-extensible objects",
    source: `${trojan}class F extends B{#v=42;static g(o){return o.#v;}}class M extends B{#m(){return 7;}get #a(){return 8;}static g(o){return o.#m()+o.#a;}}const s=Object.preventExtensions({});if(new F(s)!==s||F.g(s)!==42)throw 96;const f=Object.freeze({});new M(f);if(M.g(f)!==15||!Object.isFrozen(f))throw 97;`,
  },
  {
    name: "baseline private field stays writable after freeze",
    source: `${trojan}class A extends B{#a=1;static inc(o){return ++o.#a;}}const o={};new A(o);Object.freeze(o);if(A.inc(o)!==2)throw 98;`,
  },
];
interface ReferenceRealm {
  readonly context: Context;
  readonly global: object;
  readonly evalScript: (source: string) => unknown;
  readonly createRealm: () => ReferenceRealm;
}
function referenceRealm(): ReferenceRealm {
  const context = createContext();
  const host = {
    context,
    global: runInContext("globalThis", context) as object,
    evalScript: (source: string): unknown => runInContext(source, context),
    createRealm: referenceRealm,
  };
  Object.assign(context, { $262: host });
  return host;
}
const cases = sources.map(({ source }) => {
  // Node 24 / V8 implements ES2025 here, so it is a valid reference for each case.
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
const captured = process.env.TINT_TEST262_SOURCES;
const snapshot =
  captured === undefined
    ? workspaceSources()
    : readWorkspaceSourceSnapshot(captured);
const built = createNativeBatchBuilder(snapshot)(cases);
if (!built.ok) throw Error(JSON.stringify(built.outcome));
const directory = mkdtempSync(
    join(tmpdir(), "tint-native-class-construction-realm-"),
  ),
  binary = join(directory, "class-construction-realm"),
  fixture = join(directory, "cases.json");
writeFileSync(binary, built.bytes, { mode: 0o755, flag: "wx" });
writeFileSync(
  fixture,
  JSON.stringify(
    {
      kind: "native-class-construction-realm-fixture",
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
