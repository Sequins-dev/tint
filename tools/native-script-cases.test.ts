// Script fixtures that need the full Script runtime share one image: its
// build dominates the gate's native batch, so every case here runs in it.
//
// The Annex B [[IsHTMLDDA]] host capability selects how Scripts lower
// `x == null` and `ToBoolean` (`if (x)`). Scripts lowered for a host that
// declares it keep the brand check; Scripts lowered without it test the tag
// alone and exclude such objects when they evaluate. The image runs both beside
// the Test262 host, which marks `$262.IsHTMLDDA` before any Script runs: the
// declared Script completes, and the mismatched Script must refuse to run
// rather than observe `$262.IsHTMLDDA == null` as false or `Boolean($262.IsHTMLDDA)` as true.
//
// Native script entries replace heap bookkeeping with activation records,
// so stack traces and legacy caller and arguments reflection merge them
// with the heap frames of list invocations (apply, call, construct),
// builtins and barriers. Tail calls in strict code either replace the frame
// (a jump) or keep a bounded stack through the trampoline; those sections
// recurse 100,000 times. A function whose `arguments` only feed
// `f.apply(thisArg, arguments)` forwards its actuals without creating the
// object; Node computes the expected observations for that section. Every
// section throws a distinct value on the first wrong observation.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { withNativeFixtureMemory } from "./gate/native-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";
import { executionPlan } from "./test262-execution.ts";
import { NativeImageRunner } from "./test262-native-process.ts";
import {
  benchmarkScriptHost,
  createNativeBatchBuilder,
  deferNativeCase,
  nativeTestResources,
  prepareNativeScripts,
  test262ScriptHost,
  type NativeScriptHost,
} from "./test262-native.ts";
import { workspaceSources } from "./workspace-sources.ts";

const htmlDDACases: readonly {
  readonly source: string;
  readonly host: NativeScriptHost;
  readonly expected: unknown;
}[] = [
  {
    // The declared capability keeps Annex B loose equality and ToBoolean.
    source: String.raw`const d=$262.IsHTMLDDA;if(!(d==null)||d!=undefined||!(null==d)||d||Boolean(d))throw 1;`,
    host: test262ScriptHost,
    expected: { kind: "completed" },
  },
  {
    // Lowered without the capability: the exclusion refuses the host's
    // marked object before the Script body runs, and the refusal escapes
    // the entry uncaught (status 70 on aarch64, 1 on x86-64; see
    // runtime-diagnostics.test.ts).
    source: String.raw`if($262.IsHTMLDDA==null)throw 1;`,
    host: benchmarkScriptHost,
    expected: {
      kind: "crash",
      detail:
        "unexpected native exit status " +
        (nativeFixtureTarget().arch === "x86_64" ? 1 : 70),
    },
  },
  {
    // Truthiness without the capability also skips the [[IsHTMLDDA]] check and
    // must refuse to run beside a host that marked one.
    source: String.raw`if($262.IsHTMLDDA)throw 1;`,
    host: benchmarkScriptHost,
    expected: {
      kind: "crash",
      detail:
        "unexpected native exit status " +
        (nativeFixtureTarget().arch === "x86_64" ? 1 : 70),
    },
  },
  {
    // Without a skipped check there is nothing to exclude.
    source: String.raw`if(typeof $262.IsHTMLDDA!=="undefined")throw 1;`,
    host: benchmarkScriptHost,
    expected: { kind: "completed" },
  },
];

const activationSections: readonly string[] = [
  // Trace names, innermost first, through native calls with stack actuals.
  String.raw`
function c() { return new Error("x").stack; }
function b() { return c(1, 2, 3, 4, 5); }
function a() { return b(); }
var trace = a();
if (!/at c\n\s+at b\n\s+at a/.test(trace)) throw 1;
function viaCall() { return c.call(null, 1); }
if (!/at c\n\s+at viaCall/.test(viaCall())) throw 2;
function viaApply() { return c.apply(null, [1, 2, 3, 4]); }
if (!/at c\n\s+at viaApply/.test(viaApply())) throw 3;
function Made() { this.stack = new Error("y").stack; }
function make() { return new Made().stack; }
if (!/at Made\n\s+at make/.test(make())) throw 4;
`,
  // Caller reflection: visible sloppy callers, hidden strict ones, list
  // entries and the null caller once the invocation returns.
  String.raw`
function inner() { return inner.caller; }
function outer() { return inner(); }
if (outer() !== outer) throw 1;
function hidden() { "use strict"; return inner(); }
if (hidden() !== null) throw 2;
var arrow = () => inner();
if (arrow() !== arrow) throw 3;
if (inner.caller !== null) throw 4;
function viaApply() { return inner.apply(null, []); }
if (viaApply() !== viaApply) throw 5;
function deep(n) { return n === 0 ? inner() : deep(n - 1); }
if (deep(3) !== deep) throw 6;
var builtin = [0].map(function mapped() { return inner(); })[0];
if (typeof builtin !== "function" || builtin.name !== "mapped") throw 7;
`,
  // Legacy arguments reflection: register and stack actuals, missing and
  // extra actuals, and list entries.
  String.raw`
function g(a, b) { return g.arguments; }
function callG() { return g(1, 2, 3, 4, 5); }
var args = callG();
if (args.length !== 5 || args[0] !== 1 || args[2] !== 3 || args[4] !== 5) throw 1;
function none() { return none.arguments.length; }
if (none() !== 0) throw 2;
function two(a) { return two.arguments[1]; }
if (two(7, 8) !== 8) throw 3;
function many(a, b, c, d, e, f) { return many.arguments[5]; }
if (many(1, 2, 3, 4, 5, 6) !== 6) throw 4;
function listed() { return listed.arguments[2]; }
if (listed.apply(null, [4, 5, 6]) !== 6) throw 5;
function nested(x) { return x === 0 ? nested.arguments[0] : nested(x - 1); }
if (nested(2) !== 0) throw 6;
if (g.arguments !== null) throw 7;
`,
  // An exception unwinds native entries without leaving their records.
  String.raw`
function thrower() { throw new Error("t"); }
function mid(a, b, c, d) { return thrower(); }
function catcher() {
  try { mid(1, 2, 3, 4); } catch (e) {}
  return new Error("y").stack;
}
var trace = catcher();
if (/at (thrower|mid)/.test(trace)) throw 1;
if (!/at catcher/.test(trace)) throw 2;
function probe() { return probe.caller; }
function after() {
  try { mid(); } catch (e) {}
  return probe();
}
if (after() !== after) throw 3;
`,
];

const depth = 100000;
const tailCallSections: readonly string[] = [
  // Self and mutual recursion with register actuals: jumps.
  String.raw`"use strict";
function count(n, total) { return n === 0 ? total : count(n - 1, total + 1); }
if (count(${depth}, 0) !== ${depth}) throw 1;
function even(n) { return n === 0 ? true : odd(n - 1); }
function odd(n) { return n === 0 ? false : even(n - 1); }
if (even(${depth}) !== true || odd(${depth}) !== false) throw 2;
`,
  // Stack actuals and spread: fallback calls, then trampolines.
  String.raw`"use strict";
function four(a, b, c, n) { return n === 0 ? a + b + c : four(a, b, c, n - 1); }
if (four(1, 2, 3, ${depth}) !== 6) throw 1;
function spread(n) { return n === 0 ? "done" : spread(...[n - 1]); }
if (spread(${depth}) !== "done") throw 2;
function wide(n) { return n === 0 ? 0 : narrow(1, 2, 3, n - 1); }
function narrow(a, b, c, n) { return wide(n); }
if (wide(${depth}) !== 0) throw 3;
`,
  // Builtin and bound targets: fallback calls through their dispatch.
  String.raw`"use strict";
function viaCall(n) { return n === 0 ? "call" : viaCall.call(null, n - 1); }
if (viaCall(${depth}) !== "call") throw 1;
function viaApply(n) { return n === 0 ? "apply" : viaApply.apply(null, [n - 1]); }
if (viaApply(${depth}) !== "apply") throw 2;
var bound;
function viaBound(n) { return n === 0 ? "bound" : bound(n - 1); }
bound = viaBound.bind(null);
if (viaBound(${depth}) !== "bound") throw 3;
`,
  // Construction, exceptions and receivers through tail calls.
  String.raw`"use strict";
function make(x) { return { x: x }; }
function Made(x) { return make(x); }
var made = new Made(7);
if (made.x !== 7 || made instanceof Made) throw 1;
function Plain(x) { this.x = x; return id(x); }
function id(x) { return x; }
var plain = new Plain(8);
if (plain.x !== 8 || !(plain instanceof Plain)) throw 2;
function fail(n) { if (n === 0) throw new Error("deep"); return fail(n - 1); }
var caught;
try { fail(${depth}); } catch (e) { caught = e.message; }
if (caught !== "deep") throw 3;
var counter = { left: ${depth}, step() { return this.left-- === 0 ? this : this.step(); } };
if (counter.step() !== counter) throw 4;
`,
];

const forwardingProgram = String.raw`
var Class = { create: function () {
  return function () { this.initialize.apply(this, arguments); };
} };
var Point = Class.create();
Point.prototype = { initialize: function (x, y, z) {
  this.n = arguments.length; this.x = x; this.y = y; this.z = z;
} };
function describe(p) { return [p.n, p.x, p.y, p.z].join(":"); }
function counts() {
  var out = [];
  out.push(describe(new Point()));
  out.push(describe(new Point(1)));
  out.push(describe(new Point(1, 2)));
  out.push(describe(new Point(1, 2, 3)));
  out.push(describe(new Point(1, 2, 3, 4)));
  out.push(describe(new Point(1, 2, 3, 4, 5)));
  return out.join(",");
}
function collect() { return Array.prototype.slice.call(arguments).join("/"); }
function mapped(a, b) { a = "A"; return collect.apply(null, arguments); }
function strictUnmapped(a, b) { "use strict"; a = "A"; return collect.apply(null, arguments); }
function extra(a) { a = 9; return collect.apply(null, arguments); }
function receiver() { return function () { return this.tag; }.apply({ tag: "t" }, arguments); }
function viaThis() { return reader.apply(this, arguments); }
function reader() { return this === undefined || this === globalThis ? "global" : this.tag; }
function replaced(x) { return collect.apply(null, arguments); }
function shadowed() { var target = { apply: function (t, a) { return "own:" + a.length; } }; return target.apply(null, arguments); }
function bound() { return collect.bind(null, "b").apply(null, arguments); }
function builtin() { return Math.max.apply(Math, arguments); }
function constructed() { function Inner(a, b) { this.s = a + b; } return Inner; }
function mixed(a) { var held = arguments; return collect.apply(null, arguments) + "|" + held.length; }
function sections() {
  var out = [];
  out.push(counts());
  out.push(mapped(1, 2), mapped(1), mapped());
  out.push(strictUnmapped(1, 2), extra(1, 2, 3));
  out.push(receiver(5), viaThis.call({ tag: "r" }, 1), viaThis(2));
  var saved = Function.prototype.apply;
  Function.prototype.apply = function (t, a) { return "patched:" + a.length; };
  out.push(replaced(1, 2));
  Function.prototype.apply = saved;
  out.push(replaced(1, 2), shadowed(1, 2, 3), bound(1, 2), builtin(3, 9, 4));
  out.push(mixed(4, 5));
  return out;
}
`;

/** The forwarding section: the program, then a check against Node's
 * observations of the same program. */
async function forwardingSection(): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "tint-forwarding-"));
  let expected: string[];
  try {
    const file = join(directory, "fixture.cjs");
    writeFileSync(file, forwardingProgram + "module.exports = sections;\n");
    const sections = (await import(pathToFileURL(file).href))
      .default as () => string[];
    expected = sections();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  assert.equal(expected.length, 15);
  return (
    forwardingProgram +
    `var actual = sections(), expected = ${JSON.stringify(expected)};
for (var i = 0; i < expected.length; i++)
  if (actual[i] !== expected[i]) throw new Error(i + ": " + actual[i]);
`
  );
}

const directMethodProgram = String.raw`
function Counter(v) { this.v = v; }
Counter.prototype.inc = function (d) { this.v = this.v + d; return this.v; };
Counter.prototype.get = function () { return this.v; };
Counter.add = function (a, b) { return a + b; };
function Box(v) { this.v = v; }
Box.prototype = {
  get: function () { return this.v * 10; },
  failIfNeg: function (x) { if (x < 0) throw "neg:" + x; return this.v + x; },
  rec: function (n) { return n <= 0 ? this.v : this.rec(n - 1) + 1; },
};
function callThis() { return typeof this + ":" + (this === globalThis ? "global" : String(this.valueOf())); }
function runDirectTests() {
  var out = [];
  var c = new Counter(5);
  var b = new Box(3);
  // Monomorphic and bimodal direct method dispatch + non-this static method.
  out.push(c.inc(2), c.get(), b.get(), Counter.add(4, 9));
  // Extra arguments must still be evaluated; missing arguments become undefined.
  var side = 0;
  out.push(c.inc(3, (side = 77)), side, String(Counter.add(1)));
  // Recursive direct method & exception unwinding.
  out.push(b.rec(4));
  try { b.failIfNeg(-5); out.push("no-throw"); } catch (e) { out.push(e); }
  // Monkey-patching prototype and own-property shadowing must deopt cleanly.
  var origGet = Counter.prototype.get;
  Counter.prototype.get = function () { return this.v + 1000; };
  out.push(c.get());
  Counter.prototype.get = origGet;
  c.get = function () { return 9999; };
  out.push(c.get());
  delete c.get;
  out.push(c.get());
  // Primitive sloppy this boxing through prototype method.
  Number.prototype.inc = Counter.prototype.inc;
  var primRes = (42).inc(1);
  out.push(primRes);
  delete Number.prototype.inc;
  // Function.prototype.call forwarding, sloppy receiver coercion, and override.
  out.push(c.inc.call(new Counter(10), 5), callThis.call(null), callThis.call(undefined), callThis.call(7));
  var savedCall = Function.prototype.call;
  Function.prototype.call = function (t, x) { return "patched-call:" + x; };
  out.push(c.inc.call(c, 99));
  Function.prototype.call = savedCall;
  out.push(c.inc.call(c, 1));
  // Inline global cell write invalidation (delete, non-writable, setter, global proto),
  // new Array() direct target shortcut vs subclass, and zero-param lazy forwarding scope.
  globalThis.__a7g = 10;
  function writeG(fn) { __a7g = fn(); }
  writeG(function () { return 20; });
  out.push(__a7g);
  writeG(function () { delete globalThis.__a7g; return 30; });
  out.push(__a7g);
  Object.defineProperty(globalThis, "__a7ro", { value: 1, writable: true, configurable: true });
  function writeRo(fn) { __a7ro = fn(); }
  writeRo(function () { return 2; });
  writeRo(function () { Object.defineProperty(globalThis, "__a7ro", { writable: false }); return 9; });
  out.push(__a7ro);
  var setterLog = [];
  globalThis.__a7acc = 1;
  function writeAcc(fn) { __a7acc = fn(); }
  writeAcc(function () { return 2; });
  writeAcc(function () {
    Object.defineProperty(globalThis, "__a7acc", {
      set: function (v) { setterLog.push(v); },
      get: function () { return 77; },
      configurable: true,
    });
    return 55;
  });
  out.push(__a7acc, setterLog.join(","));
  var a1 = new Array(3), a2 = new Array(4, 5);
  class SubArr extends Array {}
  var sub = new SubArr(2);
  out.push(a1.length, a2.join(","), sub instanceof SubArr, sub.length);
  // Zero-param forwarding wrapper (lazyForwardingScope): hot path + cold fallback.
  var Mk = function () { return function () { this.initialize.apply(this, arguments); }; };
  var Pair = Mk();
  Pair.prototype = { initialize: function (x, y) { this.s = x + y; } };
  out.push(new Pair(3, 4).s);
  var savedApply = Function.prototype.apply;
  var applySeen = 0;
  Function.prototype.apply = function (t, a) { applySeen = a.length; return savedApply.call(this, t, a); };
  out.push(new Pair(10, 20).s, applySeen);
  Function.prototype.apply = savedApply;
  return out.join("|");
}
`;

async function directMethodSection(): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "tint-direct-methods-"));
  let expected: string;
  try {
    const file = join(directory, "fixture.cjs");
    writeFileSync(
      file,
      directMethodProgram + "module.exports = runDirectTests;\n",
    );
    const runDirectTests = (await import(pathToFileURL(file).href))
      .default as () => string;
    expected = runDirectTests();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  return (
    directMethodProgram +
    `var actual = runDirectTests(), expected = ${JSON.stringify(expected)};
if (actual !== expected) throw new Error(actual + " !== " + expected);
`
  );
}

// Native entries are the subject of the call cases on targets that implement
// the entry ABI (aarch64); x86-64 runs the same cases on register/list entries.
if (nativeFixtureTarget().arch === "aarch64")
  process.env.TINT_NATIVE_SCRIPT_CALLS = "1";
const callSources = [
  ...activationSections,
  ...tailCallSections,
  await forwardingSection(),
  await directMethodSection(),
];
const cases: readonly {
  readonly source: string;
  readonly host: NativeScriptHost;
}[] = [
  ...htmlDDACases,
  ...callSources.map((source) => ({ source, host: test262ScriptHost })),
];
const deferred = cases.map(({ source, host }) => {
  const plan = executionPlan(source, "raw", {
    flags: ["raw"],
    features: [],
    includes: [],
  });
  const prepared = prepareNativeScripts(plan, "raw", [], host);
  assert.ok(prepared.ok, JSON.stringify(prepared));
  return deferNativeCase({
    scripts: prepared.modules,
    asynchronous: plan.asynchronous,
  });
});
const built = withNativeFixtureMemory(() =>
  createNativeBatchBuilder(workspaceSources())(deferred),
);
if (!built.ok) assert.fail(JSON.stringify(built.outcome));
const image = new NativeImageRunner(built.bytes, nativeTestResources.timeoutMs);
after(() => image.close());

test("Scripts lowered without the IsHTMLDDA capability refuse a host that creates one", () => {
  for (const [index, { expected }] of htmlDDACases.entries()) {
    const outcome = image.run(index);
    console.log(JSON.stringify({ index, outcome }));
    assert.deepEqual(outcome, expected, JSON.stringify({ index, outcome }));
  }
});

test("native entries keep traces, caller reflection, tail calls and forwarding", () => {
  for (let index = 0; index < callSources.length; index++) {
    const outcome = image.run(htmlDDACases.length + index);
    assert.deepEqual(
      outcome,
      { kind: "completed" },
      JSON.stringify({ index, outcome }),
    );
  }
});
