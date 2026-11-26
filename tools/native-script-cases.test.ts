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
import { runInNewContext } from "node:vm";
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
  // 4..7 register actuals, 8+ overflow actuals, lazy activation through cold
  // property IC misses (getter/proxy observing caller, arguments, stack, and
  // throwing), and GC survival of object arguments across cold calls.
  String.raw`
function sum4(a, b, c, d) { return (a || 0) + (b || 0) * 10 + (c || 0) * 100 + (d || 0) * 1000; }
function sum7(a, b, c, d, e, f, g) {
  return [a, b, c, d, e, f, g].map(function (x) { return x === undefined ? "u" : String(x); }).join(",");
}
function sum9(a, b, c, d, e, f, g, h, i) {
  return [a, b, c, d, e, f, g, h, i].map(function (x) { return x === undefined ? "u" : String(x); }).join(",");
}
if (sum4(1, 2, 3, 4) !== 4321) throw 1;
if (sum4(1, 2) !== 21) throw 2;
if (sum7(1, 2, 3, 4, 5, 6, 7) !== "1,2,3,4,5,6,7") throw 3;
if (sum7(1, 2, 3, 4) !== "1,2,3,4,u,u,u") throw 4;
if (sum7(1, 2, 3, 4, 5, 6, 7, 8, 9) !== "1,2,3,4,5,6,7") throw 5;
if (sum9(1, 2, 3, 4, 5, 6, 7, 8, 9) !== "1,2,3,4,5,6,7,8,9") throw 6;
if (sum9(1, 2, 3, 4, 5, 6, 7) !== "1,2,3,4,5,6,7,u,u") throw 7;
if (sum9(1, 2) !== "1,2,u,u,u,u,u,u,u") throw 8;

// Lazy-activation cold IC miss: getter observes caller, arguments[0..7], stack,
// and throws cleanly without corrupting nativeActivationTop.
function lazyRead2(o, x) { return o.v + x; }
function lazyRead6(o, a, b, c, d, e) { return o.v + a + b + c + d + e; }
function lazyRead9(o, a, b, c, d, e, f, g, h) { return o.v + a + b + c + d + e + f + g + h; }
var plain = { v: 10 };
for (var w = 0; w < 4; w++) {
  if (lazyRead2(plain, 5) !== 15) throw 9;
  if (lazyRead6(plain, 1, 2, 3, 4, 5) !== 25) throw 10;
  if (lazyRead9(plain, 1, 2, 3, 4, 5, 6, 7, 8) !== 46) throw 11;
}
var observed = {};
var accessor = {
  get v() {
    observed.caller2 = lazyRead2.caller;
    observed.args2 = lazyRead2.arguments ? lazyRead2.arguments.length + ":" + lazyRead2.arguments[1] : "none";
    observed.stack = new Error("lazy").stack;
    return 100;
  }
};
function callLazy2() { return lazyRead2(accessor, 42); }
if (callLazy2() !== 142) throw 12;
if (observed.caller2 !== callLazy2) throw 13;
if (observed.args2 !== "2:42") throw 14;
if (!/at lazyRead2\n\s+at callLazy2/.test(observed.stack)) throw 15;
if (lazyRead2.caller !== null || lazyRead2.arguments !== null) throw 16;

var obs6 = {};
var acc6 = {
  get v() {
    obs6.caller = lazyRead6.caller;
    obs6.len = lazyRead6.arguments.length;
    obs6.a5 = lazyRead6.arguments[5];
    obs6.a6 = lazyRead6.arguments[6];
    obs6.stack = new Error("lazy6").stack;
    return 200;
  }
};
function callLazy6() { return lazyRead6(acc6, 1, 2, 3, 4, 5, 66); }
if (callLazy6() !== 215) throw 17;
if (obs6.caller !== callLazy6 || obs6.len !== 7 || obs6.a5 !== 5 || obs6.a6 !== 66) throw 18;
if (!/at lazyRead6\n\s+at callLazy6/.test(obs6.stack)) throw 19;

var obs9 = {};
var acc9 = {
  get v() {
    obs9.len = lazyRead9.arguments.length;
    obs9.a8 = lazyRead9.arguments[8];
    return 300;
  }
};
if (lazyRead9(acc9, 1, 2, 3, 4, 5, 6, 7, 8) !== 336) throw 20;
if (obs9.len !== 9 || obs9.a8 !== 8) throw 21;

var throwingAcc = { get v() { throw new Error("boom"); } };
function catchLazy() {
  try { lazyRead6(throwingAcc, 1, 2, 3, 4, 5); } catch (e) {}
  return new Error("after").stack;
}
var afterLazy = catchLazy();
if (/at lazyRead6/.test(afterLazy) || !/at catchLazy/.test(afterLazy)) throw 22;

// GC survival of freshly allocated objects passed in register actuals 0..6 and stack actuals 7..8.
var gcAcc = {
  get v() {
    var junk = [];
    for (var j = 0; j < 2000; j++) junk.push({ a: j, b: j + 1, c: "s" + j });
    return junk.length;
  }
};
function lazyGc6(o, a, b, c, d, e) {
  var k = o.v;
  return k + a.n + b.n + c.n + d.n + e.n;
}
function lazyGc9(o, a, b, c, d, e, f, g, h) {
  var k = o.v;
  return k + a.n + b.n + c.n + d.n + e.n + f.n + g.n + h.n;
}
for (var r = 0; r < 3; r++) {
  if (lazyGc6(gcAcc, { n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }) !== 2015) throw 23;
  if (lazyGc9(gcAcc, { n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }, { n: 6 }, { n: 7 }, { n: 8 }) !== 2036) throw 24;
}

// Constructing with 4..7 arguments must preserve new.target (x8/x9) across
// d0..d7 actual spilling and GC.
function WideNew(a, b, c, d, e, f, g) {
  var nt = new.target;
  var junk = [];
  for (var j = 0; j < 200; j++) junk.push({ x: j });
  this.ok = nt === WideNew && junk.length === 200;
  this.sum = (a || 0) + (b || 0) + (c || 0) + (d || 0) + (e || 0) + (f || 0) + (g || 0);
}
var wn4 = new WideNew(1, 2, 3, 4);
if (!wn4.ok || wn4.sum !== 10) throw 25;
var wn7 = new WideNew(1, 2, 3, 4, 5, 6, 7);
if (!wn7.ok || wn7.sum !== 28) throw 26;

// Lazy-activation function with <= 3 params calling an allocating helper after
// dirtying stack frames must zero deferred actual slots 3..6 before GC runs.
function dirtyStack(a, b, c, d, e, f, g) { return a + b + c + d + e + f + g; }
function lazyAlloc1(x) {
  var arr = new Array(200);
  for (var j = 0; j < 200; j++) arr[j] = { v: x + j };
  return arr[199].v;
}
function lazyAllocWrap(x) {
  return lazyAlloc1(x);
}
for (var k = 0; k < 20; k++) {
  dirtyStack(1, 2, 3, 4, 5, 6, 7);
  if (lazyAllocWrap(k) !== k + 199) throw 27;
}
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
function seven(a, b, c, d, e, f, n) {
  return n === 0 ? a + b + c + d + e + f : seven(a, b, c, d, e, f, n - 1);
}
if (seven(1, 2, 3, 4, 5, 6, ${depth}) !== 21) throw 4;
function eight(a, b, c, d, e, f, g, n) {
  return n === 0 ? a + b + c + d + e + f + g : eight(a, b, c, d, e, f, g, n - 1);
}
if (eight(1, 2, 3, 4, 5, 6, 7, ${depth}) !== 28) throw 5;
function spread(n) { return n === 0 ? "done" : spread(...[n - 1]); }
if (spread(${depth}) !== "done") throw 2;
function wide(n) { return n === 0 ? 0 : narrow(1, 2, 3, 4, 5, 6, 7, n - 1); }
function narrow(a, b, c, d, e, f, g, n) { return wide(n); }
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
  out.push(describe(new Point(1, 2, 3, 4, 5, 6)));
  out.push(describe(new Point(1, 2, 3, 4, 5, 6, 7)));
  out.push(describe(new Point(1, 2, 3, 4, 5, 6, 7, 8)));
  out.push(describe(new Point(1, 2, 3, 4, 5, 6, 7, 8, 9)));
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

const milestone2Program = String.raw`
function M2Pt(x, y) { this.x = x; this.y = y; }
var M2Mk = function () { return function () { this.initialize.apply(this, arguments); }; };
var M2Vec = M2Mk();
M2Vec.prototype = {
  initialize: function (x, y) { this.x = x; this.y = y; },
  boom: function (flag) { this.x = 111; if (flag) throw new Error("mid-tx"); this.y = 222; return this.x + this.y; },
};
var M2_GLOBAL = 100;
function m2Loop(holder, n, at) {
  var sum = 0;
  for (var i = 0; i < n; i++) {
    var inner = holder.v;
    sum += holder.a + inner.b + M2_GLOBAL;
    holder.c = i;
    if (i === at) { holder.a = 7; holder.v = { b: 50 }; globalThis.M2_GLOBAL = 200; }
  }
  return sum + holder.c;
}
function runMilestone2ScriptTests() {
  var out = [];
  // Sloppy ConstructSite non-writable prototype invalidation (no throw in sloppy mode).
  var p1 = new M2Pt(3, 4);
  Object.defineProperty(M2Pt.prototype, "x", { value: 77, writable: false, configurable: true });
  var pRo = new M2Pt(1, 2);
  delete M2Pt.prototype.x;
  out.push(p1.x + p1.y, pRo.x, pRo.y);
  // Sloppy forwarding Class.create() + transactional method mid-throw preserving partial write & Error.stack.
  var vt = new M2Vec(1, 2);
  try { vt.boom(true); out.push("no-throw"); } catch (e) {
    out.push(e.message, vt.x, vt.y, typeof e.stack === "string" && e.stack.length > 0);
  }
  out.push(vt.boom(false), vt.y);
  // Sloppy script-goal global var mutated through globalThis inside a cached property loop.
  var h1 = { a: 3, v: { b: 10 }, c: 0 };
  out.push(m2Loop(h1, 10, 4));
  M2_GLOBAL = 100;
  var side = 0, h2 = { a: 2, v: { b: 5 } };
  Object.defineProperty(h2, "c", {
    set: function (val) { side += val; if (val === 2) { h2.a = 9; h2.v = { b: 40 }; globalThis.M2_GLOBAL = 300; } },
    get: function () { return side; },
    configurable: true,
  });
  out.push(m2Loop(h2, 6, -1), side);
  return out.join("|");
}
`;

function milestone2Section(): string {
  const expected = runInNewContext(
    milestone2Program + "\nrunMilestone2ScriptTests();\n",
  ) as string;
  return (
    milestone2Program +
    `var actual = runMilestone2ScriptTests(), expected = ${JSON.stringify(expected)};
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
  milestone2Section(),
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
