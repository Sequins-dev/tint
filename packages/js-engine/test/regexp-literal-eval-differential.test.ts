import assert from "node:assert/strict";
import test from "node:test";
import { createLoweredRealm } from "./lowered-node-host.ts";

// Differential: a sole RegExp literal program takes the evaluator fast path,
// while appending an empty block forces the shared compiled path with the same
// (empty) declaration plan and the same completion value (UpdateEmpty keeps the
// literal's value); a trailing ";" would only terminate the literal statement.
// Every observable result must agree for direct (sloppy/strict) and indirect eval.
const corpus = [
  "/a/",
  "/a/;",
  "/a/gimsy",
  "/a/d",
  "/(?<n>a)\\k<n>/d",
  "/./su",
  "/[\\p{L}--[a-z]]/v",
  "/\\p{Script=Greek}/u",
  "/\\uD83D\\uDE00/u",
  "/\u{1F600}/u",
  "/\u{1F600}/",
  "/\uD800/",
  "/[\uDC00-\uDFFF]/",
  "/\\u2028/",
  "/a/ /* trailing */",
  "/* leading */ /a/g",
  "  /a/m  // tail",
  " /a/ ",
  "/a/\n",
  "/(?:)/",
  "/[/]/",
  "/a\\/b/",
  "/\\c/",
  "/{/",
  "/]/",
  "/a{2,1}/",
  "/(/",
  "/a/gg",
  "/a/x",
  "/a/uv",
  "/[b-a]/",
  "/\\u{110000}/u",
  "/(?<a>x)(?<a>y)/",
  "/\\p{Foo}/u",
  "/a\nb/",
  "//",
];
const program = (source: string): string => `
function describe(r) {
  if (typeof r !== "object" || r === null) return typeof r + ":" + String(r);
  return [
    Object.getPrototypeOf(r) === RegExp.prototype,
    r instanceof RegExp,
    r.source,
    r.flags,
    r.lastIndex,
    Object.getOwnPropertyNames(r).join(","),
    r.global, r.ignoreCase, r.multiline, r.dotAll, r.unicode, r.sticky,
    r.hasIndices, r.unicodeSets,
    String(r.exec("xa\u{1F600}/b\\u2028{]")),
  ].join("|");
}
function outcome(evaluate) {
  try {
    var first = evaluate(), second = evaluate();
    return describe(first) + "|fresh=" + (typeof first !== "object" || first !== second);
  } catch (error) {
    return "throw:" + (error && error.constructor && error.constructor.name);
  }
}
var before = Object.getOwnPropertyNames(this).length;
var src = ${JSON.stringify(source)};
print(outcome(function () { return eval(src); }));
print(outcome(function () { "use strict"; return eval(src); }));
print(outcome(function () { return (0, eval)(src); }));
print(String(Object.getOwnPropertyNames(this).length === before));
`;
for (const source of corpus)
  test(
    "sole RegExp literal fast path matches compiled eval: " +
      JSON.stringify(source),
    () => {
      const fast = createLoweredRealm(),
        compiled = createLoweredRealm();
      assert.equal(fast.run(program(source)), "none");
      assert.equal(compiled.run(program(source + "\n{}")), "none");
      assert.equal(fast.printed.length, 4);
      assert.equal(fast.compiledEntries(), 0, "fast path compiles nothing");
      // Each of the three entry shapes (sloppy and strict direct, indirect)
      // compiles once unless it is an early error; its repeated evaluation
      // reuses the retained exact-source entry and must still observe a
      // fresh RegExp ("fresh=" in the description).
      const early = fast.printed[0] === "throw:SyntaxError";
      assert.equal(compiled.compiledEntries(), early ? 0 : 3);
      assert.deepEqual(fast.printed, compiled.printed);
      assert.equal(fast.printed[3], "true", "no global bindings created");
    },
  );
test("differential corpus covers valid, invalid and empty programs", () => {
  const realm = createLoweredRealm();
  for (const source of corpus) realm.run(program(source));
  const outcomes = realm.printed.filter((_, i) => i % 4 === 0);
  assert.ok(outcomes.some((o) => o.startsWith("true|true|")));
  assert.ok(outcomes.some((o) => o === "throw:SyntaxError"));
  assert.ok(outcomes.some((o) => o.startsWith("undefined:")));
});
