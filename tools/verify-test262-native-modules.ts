import {
  nativeSyntaxVerdictSource,
  nativeSyntaxDependencies,
} from "./native-syntax-kernel.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createNativeBatchBuilder,
  prepareNativeModuleProgram,
  prepareNativeScripts,
  prepareNativeScriptProgram,
  parsedNativeHost,
  type NativeTestCase,
} from "./test262-native.ts";
import {
  workspaceSources,
  workspaceSourceIdentity,
} from "./workspace-sources.ts";
import { executionPlan } from "./test262-execution.ts";
import { test262Source, within } from "./test262-checkout.ts";

// Execution belongs to the serial LLDB recorder; building never launches output.
assert.equal(
  process.env.TINT_BUILD_ONLY,
  "1",
  "Build with TINT_BUILD_ONLY=1; run cases through the native fixture recorder",
);
const directory = mkdtempSync(join(tmpdir(), "tint-test262-module-host-"));
const snapshot = workspaceSources();
const descriptions: {
  name: string;
  sources: Record<string, string>;
  harness: readonly { filename: string; source: string }[];
  asynchronous: boolean;
  omitDependency: boolean;
  expected: unknown;
  verdictOverride?: unknown;
  factoryOverride?: string;
  variant?: "sloppy" | "strict";
  absent?: readonly string[];
}[] = [];
const cases: NativeTestCase[] = [];
const raw = { flags: ["raw"], features: [], includes: [] };
const script = prepareNativeScripts(
  executionPlan("42;", "raw", raw),
  "raw",
  [],
);
assert.ok(script.ok, JSON.stringify(script));
cases.push({ scripts: script.modules, asynchronous: false });
descriptions.push({
  name: "Script in a gated mixed batch",
  sources: { "script.js": "42;" },
  harness: [],
  asynchronous: false,
  omitDependency: false,
  expected: { kind: "completed" },
});
function moduleCase(
  name: string,
  sources: Record<string, string>,
  expected: unknown,
  asynchronous = false,
  harness: readonly { filename: string; source: string }[] = [],
  omitDependency = false,
): void {
  const folder = join(directory, "case-" + cases.length);
  // The graph discovery reads the unchanged fixture files, including root cycles.
  mkdirSync(folder);
  for (const [filename, text] of Object.entries(sources))
    writeFileSync(join(folder, filename), text);
  const source = sources["root.js"];
  assert.ok(source !== undefined);
  const plan = {
    source,
    goal: "module" as const,
    harness: harness.map((item) => item.filename),
    asynchronous,
    canSuspend: true,
  };
  const prepared = prepareNativeModuleProgram(
    plan,
    harness,
    join(folder, "root.js"),
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  cases.push({
    scripts: prepared.harness,
    modules: omitDependency ? prepared.entries.slice(0, 1) : prepared.entries,
    asynchronous,
  });
  descriptions.push({
    name,
    sources,
    harness,
    asynchronous,
    omitDependency,
    expected,
  });
}
moduleCase(
  "cyclic modules and hoisted functions",
  {
    "root.js":
      'import {value} from "./dep.js";export function early(){return 42;}if(value!==42||this!==undefined)throw 1;',
    "dep.js": 'import {early} from "./root.js";export const value=early();',
  },
  { kind: "completed" },
);
const noEvaluation = [
  {
    filename: "guard.js",
    source: 'function $DONOTEVALUATE(){throw "body executed before linking";}',
  },
];
moduleCase(
  "resolution fails before either module body",
  {
    "root.js": 'import {missing} from "./dep.js";$DONOTEVALUATE();',
    "dep.js": "export const present=1;$DONOTEVALUATE();",
  },
  { kind: "error", phase: "resolution", type: "SyntaxError" },
  false,
  noEvaluation,
);
moduleCase(
  "runtime errors retain the runtime phase",
  { "root.js": 'throw new TypeError("module");' },
  { kind: "error", phase: "runtime", type: "TypeError" },
);
moduleCase(
  "loader miss is sticky unsupported",
  { "root.js": 'import "./dep.js";', "dep.js": "export const value=42;" },
  { kind: "unsupported" },
  false,
  [],
  true,
);
moduleCase(
  "module jobs reach the shared async checkpoint",
  {
    "root.js":
      'Promise.resolve().then(()=>print("Test262:AsyncTestComplete"));',
  },
  { kind: "completed" },
  true,
);
moduleCase(
  "harness errors retain the harness phase",
  { "root.js": "export const value=42;" },
  { kind: "error", phase: "harness", type: "RangeError" },
  false,
  [{ filename: "throw.js", source: 'throw new RangeError("harness");' }],
);
moduleCase(
  "native fixture parse error precedes module evaluation",
  { "root.js": 'import "./dep.js";$DONOTEVALUATE();', "dep.js": "0++;" },
  { kind: "error", phase: "resolution", type: "SyntaxError" },
  false,
  noEvaluation,
);
function overrideVerdict(
  name: string,
  program: string,
  expected: unknown,
  detail: unknown,
): void {
  moduleCase(
    name,
    {
      "root.js": 'import "./dep.js";throw 1;',
      "dep.js": "globalThis.fixtureBodyRan=true;throw 1;",
    },
    expected,
  );
  const index = cases.length - 1,
    current = cases[index]!;
  cases[index] = {
    ...current,
    modules: current.modules!.map((entry) =>
      entry.name !== "dep.js"
        ? entry
        : {
            name: entry.name,
            verdict: true,
            module: parsedNativeHost(
              "fixture-verdict-override-" + index,
              program,
              new Map(nativeSyntaxDependencies),
            ),
          },
    ),
  };
  descriptions[index]!.verdictOverride = detail;
}
const acceptedSource = "globalThis.fixtureBodyRan=true;throw 1;";
overrideVerdict(
  "native acceptance without a compiled fixture stays unsupported",
  nativeSyntaxVerdictSource(new TextEncoder().encode(acceptedSource), "module"),
  { kind: "unsupported" },
  { source: acceptedSource },
);
overrideVerdict(
  "invalid source decoding stays unsupported",
  nativeSyntaxVerdictSource(new Uint8Array([255]), "module"),
  { kind: "unsupported" },
  { bytes: [255] },
);
overrideVerdict(
  "an unknown verdict is a host invariant",
  "export function run():number{return 99;}",
  { kind: "crash", detail: "native module host invariant" },
  { code: 99 },
);
moduleCase(
  "module import.meta identity and ordinary properties",
  {
    "root.js":
      "const meta=import.meta;if(meta!==import.meta||Object.getPrototypeOf(meta)!==null||!Object.isExtensible(meta))throw 1;meta.value=42;if(import.meta.value!==42)throw 2;",
  },
  { kind: "completed" },
);
moduleCase(
  "dynamic import loads and returns the namespace",
  {
    "root.js":
      'import("./dep.js").then(ns=>{if(ns.value!==42)throw 1;print("Test262:AsyncTestComplete");});',
    "dep.js": "export const value=42;",
  },
  { kind: "completed" },
  true,
);
moduleCase(
  "repeated dynamic imports share namespace and one evaluation",
  {
    "root.js":
      'Promise.all([import("./dep.js"),import("./dep.js")]).then(values=>{if(values[0]!==values[1]||globalThis.evaluations!==1)throw 1;print("Test262:AsyncTestComplete");});',
    "dep.js":
      "globalThis.evaluations=(globalThis.evaluations||0)+1;export const value=42;",
  },
  { kind: "completed" },
  true,
);
moduleCase(
  "dynamic import invalid options reject without loading",
  {
    "root.js":
      'import("./dep.js",42).then(()=>{throw 1;},error=>{if(!(error instanceof TypeError))throw 2;print("Test262:AsyncTestComplete");});',
    "dep.js": "throw 3;",
  },
  { kind: "completed" },
  true,
);
moduleCase(
  "dynamic specifier coercion rejects with original value",
  {
    "root.js":
      'const marker={};import({toString(){throw marker;}}).then(()=>{throw 1;},error=>{if(error!==marker)throw 2;print("Test262:AsyncTestComplete");});',
  },
  { kind: "completed" },
  true,
);
moduleCase(
  "module dynamic self-import resolves its existing namespace",
  {
    "root.js":
      'import("./root.js").then(ns=>{if(ns.value!==42)throw 1;print("Test262:AsyncTestComplete");});export const value=42;',
  },
  { kind: "completed" },
  true,
);
function scriptRootCase(
  name: string,
  sources: Record<string, string>,
  expected: unknown,
  asynchronous: boolean,
  variant: "sloppy" | "strict" = "strict",
): void {
  const folder = join(directory, "case-" + cases.length);
  mkdirSync(folder);
  for (const [filename, text] of Object.entries(sources))
    writeFileSync(join(folder, filename), text);
  const source = sources["root.js"];
  assert.ok(source !== undefined);
  const plan = executionPlan(source, variant, {
    flags: asynchronous ? ["async"] : [],
    features: [],
    includes: [],
  });
  const harness = plan.harness.map((filename) => ({
    filename,
    source: test262Source(
      within(join(process.cwd(), ".tint-bootstrap/test262/harness"), filename),
    ).source,
  }));
  const prepared = prepareNativeScriptProgram(
    plan,
    variant,
    harness,
    join(folder, "root.js"),
  );
  assert.ok(
    prepared.ok && prepared.root !== undefined,
    JSON.stringify(prepared),
  );
  cases.push({
    scripts: prepared.scripts,
    modules: prepared.root.entries,
    scriptRoot: { absent: prepared.root.absent },
    asynchronous,
    canSuspend: plan.canSuspend,
  });
  descriptions.push({
    name,
    sources,
    harness,
    asynchronous,
    omitDependency: false,
    expected,
    variant,
    absent: prepared.root.absent,
  });
}
scriptRootCase(
  "Script-root namespace import",
  {
    "root.js":
      'import("./dep.js").then(ns=>{assert.sameValue(ns.value,42);$DONE();},$DONE);',
    "dep.js": "export const value=42;",
  },
  { kind: "completed" },
  true,
);
scriptRootCase(
  "Script-root repeated imports share namespace and evaluation",
  {
    "root.js":
      'const p=import("./dep.js"),q=import("./dep.js");assert.notSameValue(p,q);Promise.all([p,q]).then(values=>{assert.sameValue(values[0],values[1]);assert.sameValue(globalThis.evaluations,1);$DONE();},$DONE);',
    "dep.js":
      "globalThis.evaluations=(globalThis.evaluations||0)+1;export const value=42;",
  },
  { kind: "completed" },
  true,
);
scriptRootCase(
  "Script-root literal missing sibling rejects TypeError",
  {
    "root.js":
      'import("./absent.js").then(()=>{$DONE(new Error("unexpected load"));},error=>{assert(error instanceof TypeError);$DONE();});',
  },
  { kind: "completed" },
  true,
);
scriptRootCase(
  "Script-root empty table accepts an empty specifier promise",
  { "root.js": 'import("");' },
  { kind: "completed" },
  false,
);
scriptRootCase(
  "Script-root empty specifier rejects TypeError",
  {
    "root.js":
      'import("").then(()=>{$DONE(new Error("unexpected load"));},error=>{assert(error instanceof TypeError);$DONE();});',
  },
  { kind: "completed" },
  true,
);
scriptRootCase(
  "Script-root undiscovered computed sibling stays unsupported",
  {
    "root.js": 'import("./oth"+"er.js");',
    "other.js": "export const value=42;",
  },
  { kind: "unsupported" },
  false,
);
scriptRootCase(
  "Script-root self import runs a separate module once",
  {
    "root.js":
      'globalThis.selfCount=(globalThis.selfCount||0)+1;if(globalThis.selfCount===1){import("./root.js").then(ns=>{assert.sameValue(globalThis.selfCount,2);assert.sameValue(Object.getPrototypeOf(ns),null);$DONE();},$DONE);}',
  },
  { kind: "completed" },
  true,
  "sloppy",
);
scriptRootCase(
  "Script-root repeated evaluation errors preserve identity",
  {
    "root.js":
      'import("./dep.js").then(()=>{$DONE(new Error("unexpected load"));},first=>{assert(first instanceof TypeError);import("./dep.js").then(()=>{$DONE(new Error("unexpected load"));},second=>{assert.sameValue(first,second);$DONE();});});',
    "dep.js": 'throw new TypeError("fixture");',
  },
  { kind: "completed" },
  true,
);
scriptRootCase(
  "Script-root fixture linking errors reject SyntaxError",
  {
    "root.js":
      'import("./dep.js").then(()=>{$DONE(new Error("unexpected load"));},error=>{assert(error instanceof SyntaxError);$DONE();});',
    "dep.js": 'import {missing} from "./leaf.js";',
    "leaf.js": "export const present=42;",
  },
  { kind: "completed" },
  true,
);
scriptRootCase(
  "Script-root sloppy with does not use the module grammar",
  {
    "root.js":
      'with({name:"./dep.js"}){import(name).then(ns=>{assert.sameValue(ns.value,42);$DONE();},$DONE);}',
    "dep.js": "export const value=42;",
  },
  { kind: "completed" },
  true,
  "sloppy",
);
scriptRootCase(
  "Script-root invalid fixture uses the native syntax verdict",
  {
    "root.js":
      'import("./dep.js").then(()=>{$DONE(new Error("unexpected load"));},error=>{assert(error instanceof SyntaxError);$DONE();});',
    "dep.js": "0++;",
  },
  { kind: "completed" },
  true,
);
scriptRootCase(
  "Script-root imports from promise jobs preserve the referrer",
  {
    "root.js":
      'Promise.resolve().then(()=>import("./dep.js")).then(ns=>{assert.sameValue(ns.value,42);$DONE();},$DONE);',
    "dep.js": "export const value=42;",
  },
  { kind: "completed" },
  true,
);
moduleCase(
  "parsed fixture binding error rejects before module evaluation",
  {
    "root.js": 'import "./dep.js"; throw new Error("root executed");',
    "dep.js":
      'var smoosh; function smoosh() {} throw new Error("fixture executed");',
  },
  { kind: "error", phase: "resolution", type: "SyntaxError" },
);
scriptRootCase(
  "Script-root parsed fixture binding error rejects SyntaxError",
  {
    "root.js":
      'import("./dep.js").then(()=>{$DONE(new Error("unexpected load"));},error=>{assert(error instanceof SyntaxError);$DONE();});',
    "dep.js":
      'var smoosh; function smoosh() {} throw new Error("fixture executed");',
  },
  { kind: "completed" },
  true,
);
moduleCase(
  "top-level await settles before the host reads evaluation",
  {
    "root.js":
      "export const value=await 42;if(value!==42)throw new Error('value');",
  },
  { kind: "completed" },
);
moduleCase(
  "a suspended dependency leaves its sibling runnable",
  {
    "root.js":
      'import {value} from "./leaf.js";import "./sibling.js";if(value!==42||trace.join(",")!=="start,sibling,end")throw new Error("order");',
    "setup.js": "globalThis.trace=[];",
    "leaf.js":
      'import "./setup.js";trace.push("start");export const value=await 42;trace.push("end");',
    "sibling.js": 'import "./setup.js";trace.push("sibling");',
  },
  { kind: "completed" },
);
moduleCase(
  "top-level for-await preserves values and completion",
  {
    "root.js":
      "let sum=0;for await(const value of [1,2,3])sum+=value;if(sum!==6)throw new Error('sum');",
  },
  { kind: "completed" },
);
moduleCase(
  "top-level await-using waits for disposal",
  {
    "root.js":
      "let closed=false;{await using resource={async [Symbol.asyncDispose](){await 0;closed=true;}};}if(!closed)throw new Error('not disposed');",
  },
  { kind: "completed" },
);
moduleCase(
  "rejection after top-level await retains the runtime error",
  { "root.js": "await 0;throw new TypeError('after await');" },
  { kind: "error", phase: "runtime", type: "TypeError" },
);
moduleCase(
  "top-level await reaches the async Test262 completion protocol",
  { "root.js": 'await 0;print("Test262:AsyncTestComplete");' },
  { kind: "completed" },
  true,
);
moduleCase(
  "an async completion may precede an unsettled module evaluation",
  {
    "root.js": 'print("Test262:AsyncTestComplete");await new Promise(()=>{});',
  },
  { kind: "completed" },
  true,
);
moduleCase(
  "an unsettled module without async completion reports host timeout",
  { "root.js": "await new Promise(()=>{});" },
  { kind: "timeout" },
);
scriptRootCase(
  "Script import waits for a top-level-await fixture",
  {
    "root.js":
      'import("./dep.js").then(ns=>{assert.sameValue(ns.value,42);$DONE();},$DONE);',
    "dep.js": "export const value=await 42;",
  },
  { kind: "completed" },
  true,
);
moduleCase(
  "an asynchronous module host fault is never a JavaScript rejection",
  { "root.js": "await 0;" },
  { kind: "crash" },
);
const faultFactory = `
import {createSourceTextModule,type ModuleRecord,type ModuleCapability} from "modules";
import type {GlobalEnvironment} from "globals";
import type {ErrorRealm,ScriptPropertyKey} from "objects";
export function create(global:GlobalEnvironment<ScriptPropertyKey,unknown>,realm:ErrorRealm,hostDefined:unknown):ModuleRecord {
 const owner:{value:ModuleRecord|undefined}={value:undefined};
 const module=createSourceTextModule(realm,{requests:[],imports:[],localExports:[],indirectExports:[],starExports:[],hasTopLevelAwait:true},hostDefined,(environment):void=>{},():void=>{},():void=>{},(capability:ModuleCapability):void=>{const current=owner.value;if(current===undefined)throw "FIXTURE_OWNER_INVARIANT";current.executionFault={error:"FIXTURE_ASYNC_HOST_FAULT"};capability.functions.resolve(undefined);});owner.value=module;return module;
}`;
const faultIndex = cases.length - 1,
  faultCase = cases[faultIndex];
assert.ok(faultCase);
cases[faultIndex] = {
  ...faultCase,
  modules: [
    {
      name: "root.js",
      module: parsedNativeHost(
        "async-module-host-fault",
        faultFactory,
        new Map([
          ["modules", "packages/js-runtime/src/modules/index.ts"],
          ["globals", "packages/js-runtime/src/environments/global/index.ts"],
          ["objects", "packages/js-runtime/src/objects/index.ts"],
        ]),
      ),
    },
  ],
};
descriptions[faultIndex]!.factoryOverride = faultFactory;
moduleCase(
  "parenthesized assignment preserves anonymous function and class names",
  {
    "root.js":
      'let fn;(fn)=function(){};const d=Object.getOwnPropertyDescriptor(fn,"name");if(d.value!==""||d.writable||d.enumerable||!d.configurable)throw new Error("descriptor");fn=(function(){});if(fn.name!=="fn")throw new Error("plain");let C;(C)=class{};if(C.name!=="")throw new Error("class");',
  },
  { kind: "completed" },
);
const coverSource =
  'var fn;(fn)=function(){};if(fn.name!=="")throw new Error("cover");fn=(function(){});if(fn.name!=="fn")throw new Error("plain");';
const cover = prepareNativeScripts(
  executionPlan(coverSource, "raw", {
    flags: ["raw"],
    features: [],
    includes: [],
  }),
  "raw",
  [],
);
assert.ok(cover.ok, JSON.stringify(cover));
cases.push({ scripts: cover.modules, asynchronous: false });
descriptions.push({
  name: "sloppy parenthesized assignment name inference",
  sources: { "script.js": coverSource },
  harness: [],
  asynchronous: false,
  omitDependency: false,
  expected: { kind: "completed" },
});
const built = createNativeBatchBuilder(snapshot, true)(cases);
if (!built.ok) throw Error(JSON.stringify(built.outcome));
const binary = join(directory, "module-host"),
  fixture = join(directory, "cases.json");
writeFileSync(binary, built.bytes, { mode: 0o755, flag: "wx" });
writeFileSync(
  fixture,
  JSON.stringify(
    {
      kind: "native-module-host-fixture",
      conformance: false,
      cases: descriptions,
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
