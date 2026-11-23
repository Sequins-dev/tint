// Proper tail calls in strict code. A native script entry called with
// actual operands replaces its frame with a native callee's (a jump);
// other tail calls request the call from a list invocation's trampoline or,
// from an entry called with actual operands, call ordinarily once, after
// which the callee's tail calls trampoline. Each section recurses 100,000
// times through one of those paths, so a path that keeps a frame per call
// overflows the stack, and checks the returned value.
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

const depth = 100000;
const sections: readonly string[] = [
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

/** Builds every section into one image and runs each to completion. */
function runSections(nativeScriptCalls: boolean): void {
  // The variable is read per preparation.
  process.env.TINT_NATIVE_SCRIPT_CALLS = nativeScriptCalls ? "1" : "0";
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

test("native entries keep strict tail calls in bounded stack", () => {
  runSections(true);
});
test("trampolined tail calls alone keep the same results", () => {
  runSections(false);
});
