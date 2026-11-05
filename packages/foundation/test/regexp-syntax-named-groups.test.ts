import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRegExp } from "../src/regexp/syntax/index.ts";
for (const [spelling, name] of [
  ["name", "name"],
  ["π", "π"],
  ["$", "$"],
  ["_2", "_2"],
  ["if", "if"],
  [String.raw`\u0061`, "a"],
  [String.raw`\u{10400}`, "𐐀"],
  [String.raw`\uD801\uDC00`, "𐐀"],
  [String.raw`a\u200c`, "a‌"],
])
  for (const flags of ["", "u"])
    test(`named capture ${spelling} / ${flags}`, () => {
      const pattern = `(?<${spelling}>a)\\k<${spelling}>`;
      assert.doesNotThrow(() => new RegExp(pattern, flags));
      const result = parseRegExp(pattern, flags);
      assert.ok(result.ok, JSON.stringify(result));
      assert.deepEqual(result.value.names, [{ name, capture: 1 }]);
      assert.equal(result.value.captures, 1);
    });
for (const pattern of [
  String.raw`\k<name>(?<name>a)`,
  String.raw`\1(?<name>a)`,
  "(?<x>a)|(?<x>b)",
  "(?:(?<x>a)|(?<x>b))+",
  "(?:(?<x>a)|(?:(?<x>b)|c))",
])
  test(`forward or disjoint capture ${pattern}`, () => {
    assert.doesNotThrow(() => new RegExp(pattern, "u"));
    const result = parseRegExp(pattern, "u");
    assert.ok(result.ok, JSON.stringify(result));
  });
for (const pattern of [
  "(?<>a)",
  "(?<1a>b)",
  "(?<a-b>c)",
  String.raw`(?<\x61>a)`,
  String.raw`(?<\uD800>a)`,
  "(?<x>a)(?<x>b)",
  "(?<x>(?<x>a))",
  "(?:(?<x>a)|b)(?<x>c)",
  "(?<x>a)|(?<x>b)(?<x>c)",
  String.raw`\k<missing>(?<name>a)`,
  String.raw`(?<name>a)\k`,
  String.raw`\k(?<name>a)`,
])
  for (const flags of ["", "u"])
    test(`invalid named group ${pattern} / ${flags}`, () => {
      assert.throws(() => new RegExp(pattern, flags), SyntaxError);
      const result = parseRegExp(pattern, flags);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.kind, "syntax");
    });
test("named-reference grammar is enabled by named groups anywhere or by Unicode mode", () => {
  assert.equal(parseRegExp(String.raw`\k<literal>`, "").ok, true);
  const invalid = parseRegExp(String.raw`\k<missing>`, "u");
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.kind, "syntax");
  const valid = parseRegExp(String.raw`\k<a>(?<a>x)`, "");
  assert.ok(valid.ok);
  const body = valid.value.body;
  assert.equal(body.kind, "sequence");
  if (body.kind !== "sequence") return;
  assert.deepEqual(body.terms[0], { kind: "named-backreference", name: "a" });
});

test("named-capture mode forbids identity k escapes inside character classes", () => {
  for (const pattern of [String.raw`(?<a>x)[\k]`, String.raw`[\k<a>](?<a>x)`]) {
    assert.throws(() => new RegExp(pattern), SyntaxError);
    const result = parseRegExp(pattern, "");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "syntax");
  }
  const legacy = parseRegExp(String.raw`[\k]`, "");
  assert.ok(legacy.ok);
});
