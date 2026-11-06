import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import {
  createNativeBatchBuilder,
  prepareNativeScriptProgram,
  type NativeTestCase,
} from "./test262-native.ts";
import {
  workspaceSources,
  workspaceSourceIdentity,
} from "./workspace-sources.ts";

/** Bespoke native regressions for arguments objects, parameter/body scopes and
 * direct-eval declaration conflicts. Not a Test262 conformance measurement:
 * each Script throws on any deviation from ECMAScript 2027 (§10.2.11,
 * §10.4.4, §19.2.1.4, §B.3.2/B.3.4). The Node reference pass below is a
 * separate sanity check of the expectations, never native evidence; cases
 * with a recorded divergence follow the specification and pinned Test262. */
const programs: readonly {
  readonly name: string;
  readonly source: string;
  /** Node v24 deviates from the cited rule; skip only its reference check. */
  readonly nodeDivergence?: string;
}[] = [
  {
    name: "strict direct eval rejects assignment to arguments (10.5-1-s)",
    source:
      '"use strict";let caught=false;try{(function(){eval("arguments = 10");})(30);}catch(e){caught=e instanceof SyntaxError;}if(!caught)throw 1;',
  },
  {
    name: "strict eval code rejects arguments assignment in nested functions (10.5-7-b-1-s)",
    source:
      '"use strict";let caught=false;try{eval("(function f(){arguments = 10;}());");}catch(e){caught=e instanceof SyntaxError;}if(!caught)throw 1;',
  },
  {
    name: "sloppy eval cannot define non-definable global functions of any kind",
    source:
      'for(const s of["function NaN(){}","function* NaN(){}","async function NaN(){}","async function* NaN(){}"]){let caught=false;try{eval(s);}catch(e){caught=e instanceof TypeError;}if(!caught||typeof NaN!=="number")throw s;}',
  },
  {
    name: "duplicate simple parameters map only the last occurrence",
    source:
      "function f(a,a){arguments[0]=9;const before=a;a=5;return[before,arguments[0],arguments[1]];}const r=f(1,2);if(r[0]!==2||r[1]!==9||r[2]!==5)throw 1;function g(a,a){return[a,arguments.length,0 in arguments,1 in arguments];}const s=g(1);if(s[0]!==undefined||s[1]!==1||!s[2]||s[3])throw 2;",
  },
  {
    name: "mapping ends after delete, accessor or non-writable redefinition",
    source:
      'function f(a,b,c){delete arguments[0];arguments[0]=7;Object.defineProperty(arguments,"1",{get(){return 8;}});Object.defineProperty(arguments,"2",{writable:false});c=3;a=1;b=2;return[arguments[0],arguments[1],arguments[2]];}const r=f(10,20,30);if(r[0]!==7||r[1]!==8||r[2]!==30)throw 1;',
  },
  {
    name: "non-simple and strict parameter lists produce unmapped arguments",
    source:
      'function d(a,b=0){a=9;arguments[1]=4;return[arguments[0],b];}function r(a,...rest){arguments[0]=9;return a;}function p(a,[b]){a=9;return arguments[0];}function s(a){"use strict";a=9;return arguments[0];}const x=d(1,2);if(x[0]!==1||x[1]!==2||r(1)!==1||p(1,[2])!==1||s(1)!==1)throw 1;',
  },
  {
    name: "strict callee and caller share the ThrowTypeError intrinsic",
    source:
      'function f(){"use strict";return arguments;}const a=f(),t=Object.getOwnPropertyDescriptor(Function.prototype,"caller").get,c=Object.getOwnPropertyDescriptor(a,"callee");if(c.get!==t||c.set!==t||c.enumerable||c.configurable)throw 1;let caught=false;try{a.callee;}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;',
  },
  {
    name: "parameter defaults observe left-to-right TDZ",
    source:
      "function f(a=b,b){return a;}let caught=false;try{f();}catch(e){caught=e instanceof ReferenceError;}if(!caught||f(1)!==1)throw 1;function g(a=a){}caught=false;try{g();}catch(e){caught=e instanceof ReferenceError;}if(!caught)throw 2;",
  },
  {
    name: "body vars start from same-named parameters in a separate environment",
    source:
      "function f(a=1,g=()=>a){var a;const before=a;a=2;return[before,g(),a];}const r=f();if(r[0]!==1||r[1]!==1||r[2]!==2)throw 1;function h(a,b=()=>arguments){var arguments;return b()===arguments&&arguments[0]===5;}if(!h(5))throw 2;",
  },
  {
    name: "body functions and lexicals named arguments shadow or suppress the object",
    source:
      'function f(){function arguments(){}return typeof arguments;}function g(a=0){function arguments(){}return typeof arguments;}function h(){let arguments=3;return arguments;}function k(arguments){return arguments;}if(f()!=="function"||g()!=="function"||h()!==3||k(4)!==4)throw 1;',
  },
  {
    name: "direct eval in parameters cannot redeclare a later parameter",
    source:
      'function b(p=eval("var q"),q){}let caught=false;try{b();}catch(e){caught=e instanceof SyntaxError;}if(!caught||"q"in globalThis)throw 1;',
  },
  {
    name: "direct eval in parameters cannot redeclare the arguments binding",
    source:
      'function a(p=eval("var arguments")){}function c(p=eval("var arguments")){let arguments;}for(const f of[a,c]){let caught=false;try{f();}catch(e){caught=e instanceof SyntaxError;}if(!caught)throw f.name;}if("arguments"in globalThis)throw 2;',
    nodeDivergence:
      "§10.2.11 binds arguments in the parameter environment, so §19.2.1.4 step 3.d rejects the eval var; pinned func-decl-no-pre-existing-arguments-bindings-are-present-declare-arguments.js and func-decl-fn-body-cntns-arguments-lex-bind-declare-arguments.js expect SyntaxError",
  },
  {
    name: "direct eval in parameters declares vars outside parameter scope",
    source:
      'var x="outside";function f(p=eval("var x=\\"inside\\""),g=()=>x){var x;return[g(),x];}const r=f();if(r[0]!=="inside"||r[1]!==undefined||x!=="outside")throw 1;',
  },
  {
    name: "direct eval in methods with parameter expressions checks arguments conflicts",
    source:
      'const o={f(p=eval("var arguments")){},g(p=eval("var arguments"),arguments){},*h(p=eval("var arguments")){}};for(const k of["f","g"]){let caught=false;try{o[k]();}catch(e){caught=e instanceof SyntaxError;}if(!caught)throw k;}let caught=false;try{o.h();}catch(e){caught=e instanceof SyntaxError;}if(!caught)throw "h";',
    nodeDivergence:
      "same §19.2.1.4 rule for methods; pinned meth-*/gen-meth-*-declare-arguments.js expect SyntaxError",
  },
  {
    name: "catch parameters permit eval var redeclaration but body lexicals do not",
    source:
      'function f(){try{throw 1;}catch(e){eval("var e=2");var inner=e;}return[inner,e];}const r=f();if(r[0]!==2||r[1]!==undefined)throw 1;function g(){try{throw 1;}catch(e){let x;try{eval("var x");}catch(err){return err instanceof SyntaxError;}}return false;}if(!g())throw 2;',
  },
  {
    name: "destructured catch parameters are also exempt from eval var conflicts",
    source:
      'function h(){try{throw[1];}catch([d]){eval("var d=3");return[d,typeof e];}}const r=h();if(r[0]!==3||r[1]!=="undefined")throw 1;',
    nodeDivergence:
      "§19.2.1.4 step 3.d.i.2.a exempts every Catch clause Environment Record, including destructured parameters; the ES2015 BindingIdentifier-only restriction was removed",
  },
  {
    name: "eval Annex B block functions bypass catch parameters into the var scope",
    source:
      'function f(){try{throw 1;}catch(g){eval("{ function g(){return 3;} }");var inner=g;}return[inner,typeof g];}const r=f();if(r[0]!==1||r[1]!=="function")throw 1;',
  },
  {
    name: "with scopes are skipped by eval conflict checks and receive initializers",
    source:
      'function f(){var o={x:1};with(o){eval("var x=2");}return[o.x,x];}const r=f();if(r[0]!==2||r[1]!==undefined)throw 1;function g(){var x=0;var o={x:1,[Symbol.unscopables]:{x:true}};with(o){x=5;}return[o.x,x];}const s=g();if(s[0]!==1||s[1]!==5)throw 2;',
  },
  {
    name: "parameter pattern abrupt completion closes the argument iterator once",
    source:
      "let closed=0;function iter(){return{[Symbol.iterator](){return{next(){return{value:undefined,done:false};},return(){closed++;return{};}};}};}function f([a=(()=>{throw 7;})()]){}let caught;try{f(iter());}catch(e){caught=e;}if(caught!==7||closed!==1)throw 1;function g([a]){return a;}g(iter());if(closed!==2)throw 2;",
  },
  {
    // Pinned annexB block-decl-func-skip-arguments.js predates this rule.
    name: "Annex B block functions named arguments replace the implicit arguments binding",
    source:
      'const r=[];(function(){r.push(String(arguments));{r.push(arguments());function arguments(){}r.push(arguments());}r.push(typeof arguments);})();(function(x){const f=()=>arguments;{function arguments(){}}r.push(typeof f());})(1);(function(..._){{function arguments(){}}r.push(typeof arguments);})();(function(a=0,f=()=>arguments){{function arguments(){}}r.push(typeof arguments,String(f()));})();if(r.join()!=="[object Arguments],,,function,function,function,function,[object Arguments]")throw r.join();',
  },
];

function referenceRealm() {
  const context = createContext();
  Object.assign(context, { print: () => {} });
  return context;
}
// Node checks the expectations only; native acceptance is a separate run.
for (const item of programs)
  if (item.nodeDivergence === undefined)
    runInContext(item.source, referenceRealm());
if (process.env.TINT_BUILD_ONLY !== "1") {
  console.log("Node reference expectations hold; set TINT_BUILD_ONLY=1");
  process.exit(0);
}
const directory = mkdtempSync(join(tmpdir(), "tint-arguments-scope-")),
  snapshot = workspaceSources();
const cases: NativeTestCase[] = [];
for (const [index, item] of programs.entries()) {
  const folder = join(directory, "case-" + index);
  mkdirSync(folder);
  writeFileSync(join(folder, "root.js"), item.source);
  const prepared = prepareNativeScriptProgram(
    {
      source: item.source,
      goal: "script",
      harness: [],
      asynchronous: false,
      canSuspend: true,
    },
    "sloppy",
    [],
    join(folder, "root.js"),
    undefined,
    true,
    true,
  );
  assert.ok(prepared.ok, item.name + ": " + JSON.stringify(prepared));
  cases.push({ scripts: prepared.scripts, asynchronous: false });
}
const built = createNativeBatchBuilder(snapshot, true)(cases);
if (!built.ok) throw Error(JSON.stringify(built.outcome));
const binary = join(directory, "arguments-scope"),
  fixture = join(directory, "cases.json");
writeFileSync(binary, built.bytes, { mode: 0o755, flag: "wx" });
writeFileSync(
  fixture,
  JSON.stringify(
    {
      kind: "native-arguments-scope-fixture",
      conformance: false,
      expected: { kind: "completed" },
      cases: programs,
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
