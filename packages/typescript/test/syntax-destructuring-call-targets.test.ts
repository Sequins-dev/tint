import assert from "node:assert/strict";
import { test } from "node:test";
import { createSourceText } from "@tint/source/text";
import { parseScript } from "../src/syntax/index.ts";
function parse(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  return parseScript(source.value);
}
// Annex B web-compat call assignment targets (runtime ReferenceError) apply to
// a plain or compound assignment only. Destructuring assignment targets must
// have AssignmentTargetType simple (ECMA-262 13.15.5.1), so call expressions
// inside array/object patterns are early SyntaxErrors in sloppy code too.
// Test262: staging/sm/expressions/destructuring-pattern-parenthesized.js.
test("call expressions are invalid destructuring assignment targets", () => {
  for (const text of [
    "[f()] = [];",
    "[f() = 'ohai', b] = [1, 2];",
    "[(f()) = 'kthxbai', b] = [1, 2];",
    "[...f()] = [];",
    "({ a: f() } = {});",
    "({ a: f() = 1 } = {});",
    "({ ...f() } = {});",
    "[[f()]] = [[]];",
  ]) {
    const result = parse(text);
    assert.equal(result.ok, false, text);
  }
});
test("web-compat call targets remain for sloppy simple assignment only", () => {
  assert.equal(parse("f() = 1;").ok, true);
  assert.equal(parse("f() += 1;").ok, true);
  assert.equal(parse("'use strict'; f() = 1;").ok, false);
  for (const text of [
    "[a, b] = [1, 2];",
    "[(a), b.c, d[0]] = [];",
    "({ a: (b), c: d.e } = {});",
  ])
    assert.equal(parse(text).ok, true, text);
});
