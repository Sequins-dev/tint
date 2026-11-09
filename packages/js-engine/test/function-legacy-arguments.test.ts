import { test } from "node:test";
import assert from "node:assert/strict";
import { createLoweredRealm } from "./lowered-node-host.ts";

// Sloppy ordinary functions may carry legacy own "caller"/"arguments"
// properties (ECMA-262 17.1 forbids them only for strict functions, arrows,
// methods, generators and async functions, which keep reaching the
// %ThrowTypeError% accessors on Function.prototype). Test262:
// staging/sm/extensions/{function-properties,arguments-property-access-in-function}.js.
const prelude = `
function check(actual, expected, label) {
  if (actual !== expected) throw new Error(label + ": " + actual + " !== " + expected);
}
function throwsType(f, label) {
  try { f(); } catch (e) { if (e instanceof TypeError) return; throw new Error(label + ": wrong error"); }
  throw new Error(label + ": no error");
}
`;
const cases: readonly (readonly [string, string])[] = [
  [
    "outside and inside a top-level invocation",
    `function foo() { check(foo.arguments.length, 0, "inner length"); check(foo.caller, null, "inner caller"); }
     check(foo.arguments, null, "before"); check(foo.caller, null, "before caller");
     foo(); check(foo.arguments, null, "after"); check(foo.caller, null, "after caller");`,
  ],
  [
    "arguments reflect the active call's values",
    `var obj = { test: function () { var args = obj.test.arguments; check(args !== null, true, "present");
       check(args[0], 5, "first"); check(args[1], undefined, "second"); check(args.length, 2, "length"); } };
     obj.test(5, undefined);`,
  ],
  [
    "innermost recursive invocation wins",
    `function r(n) { if (n > 0) return r(n - 1); return r.arguments[0]; }
     check(r(3), 0, "innermost");`,
  ],
  [
    "legacy accessor is an own configurable accessor without a setter",
    `function g() {} var d = Object.getOwnPropertyDescriptor(g, "arguments");
     check(typeof d.get, "function", "getter"); check(d.set, undefined, "setter");
     check(d.enumerable, false, "enumerable"); check(d.configurable, true, "configurable");`,
  ],
  [
    "forbidden extensions keep the poison pills",
    `function s() { "use strict"; } throwsType(() => s.arguments, "strict");
     throwsType(() => (() => 0).arguments, "arrow");
     throwsType(() => ({ m() {} }).m.arguments, "method");
     throwsType(() => (class {}).arguments, "class");
     check(Object.prototype.hasOwnProperty.call(s, "arguments"), false, "strict own");`,
  ],
];

test("sloppy functions expose legacy arguments; forbidden extensions stay poisoned", () => {
  const failures: string[] = [];
  for (const [label, source] of cases) {
    const outcome = createLoweredRealm().run(prelude + source);
    if (outcome !== "none") failures.push(label + ": " + outcome);
  }
  assert.deepEqual(failures, []);
});
