// Native script entries link activation records into their frames instead
// of heap bookkeeping (js-runtime activations.ts). Stack traces and legacy
// caller and arguments reflection merge those records with the heap frames
// of entries called through a materialized list (apply, call, construct),
// of register entries and of builtins, so each section mixes the two and
// checks the order, hidden strict frames, actuals beyond the registers and
// the chain after an exception unwinds. Classic Scripts keep the functions
// sloppy; each throws a distinct value on the first wrong observation.
import assert from "node:assert/strict";
import test from "node:test";
import { withNativeFixtureMemory } from "./gate/native-fixture.ts";
import { executionPlan } from "./test262-execution.ts";
import { NativeImageRunner } from "./test262-native-process.ts";
import {
  benchmarkScriptHost,
  createNativeBatchBuilder,
  deferNativeCase,
  nativeTestResources,
  prepareNativeScripts,
} from "./test262-native.ts";
import { workspaceSources } from "./workspace-sources.ts";

const sections: readonly string[] = [
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

/** Builds every section into one image and runs each to completion. */
function runSections(nativeScriptCalls: boolean): void {
  // The variable is read per preparation.
  process.env.TINT_EXPERIMENTAL_NATIVE_SCRIPT_CALLS = nativeScriptCalls
    ? "1"
    : "0";
  const deferred = sections.map((source) => {
    const plan = executionPlan(source, "raw", {
      flags: ["raw"],
      features: [],
      includes: [],
    });
    const prepared = prepareNativeScripts(plan, "raw", [], benchmarkScriptHost);
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
  const image = new NativeImageRunner(
    built.bytes,
    nativeTestResources.timeoutMs,
  );
  try {
    for (let index = 0; index < sections.length; index++) {
      const outcome = image.run(index);
      assert.deepEqual(
        outcome,
        { kind: "completed" },
        JSON.stringify({ nativeScriptCalls, index, outcome }),
      );
    }
  } finally {
    image.close();
  }
}

test("native activation records keep traces and legacy caller reflection", () => {
  runSections(true);
});
test("heap bookkeeping alone keeps the same observations", () => {
  runSections(false);
});
