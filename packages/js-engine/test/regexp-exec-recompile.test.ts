import { test } from "node:test";
import assert from "node:assert/strict";
import { createLoweredRealm } from "./lowered-node-host.ts";

// RegExpBuiltinExec (ECMA-262 22.2.7.2) performs ToLength(Get(R, "lastIndex"))
// before reading R.[[OriginalFlags]] and R.[[RegExpMatcher]]. A lastIndex
// valueOf that recompiles R (Annex B RegExp.prototype.compile) therefore
// changes the pattern and the global/sticky behaviour of the same exec.
// Test262: staging/sm/RegExp/{match,replace}-local-tolength-recompilation.js.
const prelude = `
function check(actual, expected, label) {
  if (actual !== expected) throw new Error(label + ": " + actual + " !== " + expected);
}
function recompiling(regExp, pattern, flags, assigned, index) {
  regExp.lastIndex = { valueOf() {
    regExp.compile(pattern, flags);
    if (assigned !== undefined) regExp.lastIndex = assigned;
    return index;
  } };
  return regExp;
}
`;

const cases: readonly (readonly [string, string])[] = [
  [
    "new pattern applies to the same match",
    `for (var flag of ["", "y"]) check(recompiling(new RegExp("a", flag), "b", undefined, undefined, 0)[Symbol.match]("b") !== null, true, "match " + flag);`,
  ],
  [
    "new pattern applies to the same replace",
    `for (var flag of ["", "y"]) check(recompiling(new RegExp("a", flag), "b", undefined, undefined, 0)[Symbol.replace]("b", "pass"), "pass", "replace " + flag);`,
  ],
  [
    "added global flag updates lastIndex",
    `var r = recompiling(new RegExp("a", ""), "a", "g", undefined, 0); r[Symbol.match]("a"); check(r.lastIndex, 1, "global");`,
  ],
  [
    "removed sticky flag leaves lastIndex after a match",
    `var r = recompiling(new RegExp("a", "y"), "a", "", 9000, 0); r[Symbol.match]("a"); check(r.lastIndex, 9000, "sticky match");`,
  ],
  [
    "removed sticky flag leaves lastIndex without a match",
    `var r = recompiling(new RegExp("a", "y"), "b", "", 9001, 0); r[Symbol.match]("a"); check(r.lastIndex, 9001, "sticky no match");`,
  ],
  [
    "removed sticky flag ignores an out-of-range index",
    `var r = recompiling(new RegExp("a", "y"), "b", "", 9002, 10000); r[Symbol.match]("a"); check(r.lastIndex, 9002, "sticky range");`,
  ],
];

test("RegExpBuiltinExec reads flags and matcher after lastIndex ToLength", () => {
  const failures: string[] = [];
  for (const [label, source] of cases) {
    const realm = createLoweredRealm();
    const outcome = realm.run(prelude + source);
    if (outcome !== "none") failures.push(label + ": " + outcome);
  }
  assert.deepEqual(failures, []);
});
