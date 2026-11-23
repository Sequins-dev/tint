// A native entry whose `arguments` only feed `f.apply(thisArg, arguments)`
// forwards its actual operands to f's native entry without creating the
// object (the class constructor wrappers of older libraries). Node computes
// the expected observations: forwarded counts around the register actuals,
// mapped parameters reassigned before the call, strict unmapped arguments,
// a replaced or shadowed apply, non-native targets, construction through
// the wrapper and the object created for another use.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
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

const program = String.raw`
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

test("forwarded apply calls observe the arguments object's elements", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-forwarding-"));
  let expected: string[];
  try {
    const file = join(directory, "fixture.cjs");
    writeFileSync(file, program + "module.exports = sections;\n");
    const sections = (await import(pathToFileURL(file).href))
      .default as () => string[];
    expected = sections();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  assert.equal(expected.length, 15);
  process.env.TINT_NATIVE_SCRIPT_CALLS = "1";
  const source =
    program +
    `var actual = sections(), expected = ${JSON.stringify(expected)};
for (var i = 0; i < expected.length; i++)
  if (actual[i] !== expected[i]) throw new Error(i + ": " + actual[i]);
`;
  const plan = executionPlan(source, "raw", {
    flags: ["raw"],
    features: [],
    includes: [],
  });
  const prepared = prepareNativeScripts(plan, "raw", [], benchmarkScriptHost);
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const built = withNativeFixtureMemory(() =>
    createNativeBatchBuilder(workspaceSources())([
      deferNativeCase({
        scripts: prepared.modules,
        asynchronous: plan.asynchronous,
      }),
    ]),
  );
  if (!built.ok) assert.fail(JSON.stringify(built.outcome));
  const image = new NativeImageRunner(
    built.bytes,
    nativeTestResources.timeoutMs,
  );
  try {
    assert.deepEqual(image.run(0), { kind: "completed" });
  } finally {
    image.close();
  }
});
