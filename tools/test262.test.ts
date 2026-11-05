import { test } from "node:test";
import assert from "node:assert/strict";
import { testMetadata, syntaxVariants, inspectSyntax } from "./test262.ts";
const fixture = (metadata: string, body = "let value=1;") =>
  `/*---\n${metadata}\n---*/\n${body}`;
test("Test262 metadata retains YAML arrays, negatives and harness requirements", () => {
  assert.deepEqual(
    testMetadata(
      fixture(`description: >
  A multiline description.
flags: [onlyStrict]
features:
  - let
includes: [compareArray.js]
negative:
  phase: parse
  type: SyntaxError`),
    ),
    {
      flags: ["onlyStrict"],
      features: ["let"],
      includes: ["compareArray.js"],
      negative: { phase: "parse", type: "SyntaxError" },
    },
  );
  assert.throws(() => testMetadata("let x=1;"), /metadata/);
  assert.throws(() => testMetadata(fixture("flags: [1]")), /flags/);
  assert.throws(
    () => testMetadata(fixture("flags: [noStrict, onlyStrict]")),
    /flags/,
  );
  assert.throws(
    () => testMetadata(fixture("negative: {phase: nonsense, type: Error}")),
    /negative/,
  );
});
test("Test262 mode planning keeps sloppy and raw cases visible", () => {
  for (const [flags, expected] of [
    ["[]", ["sloppy", "strict"]],
    ["[onlyStrict]", ["strict"]],
    ["[noStrict]", ["sloppy"]],
    ["[module]", ["module"]],
    ["[raw]", ["raw"]],
  ] as const) {
    assert.deepEqual(
      syntaxVariants(testMetadata(fixture(`flags: ${flags}`))),
      expected,
    );
  }
});
test("syntax reports never treat parser limits as conformance passes", () => {
  const unsupported = fixture(
    "flags: [module]\nnegative: {phase: parse, type: SyntaxError}",
    "let x=/a{9007199254740992}/;",
  );
  assert.equal(
    inspectSyntax(unsupported, "module", testMetadata(unsupported)).status,
    "limit",
  );
  const valid = fixture(
    "flags: [onlyStrict]",
    "const f=function(){return 1;};",
  );
  assert.equal(
    inspectSyntax(valid, "strict", testMetadata(valid)).status,
    "accepted",
  );
  assert.equal(
    inspectSyntax(valid, "sloppy", testMetadata(valid)).status,
    "accepted",
  );
  const negative = fixture(
    "flags: [onlyStrict]\nnegative: {phase: parse, type: SyntaxError}",
    "let = ;",
  );
  assert.equal(
    inspectSyntax(negative, "strict", testMetadata(negative)).status,
    "negative-rejected-unverified",
  );
  const incorrect = fixture(
    "flags: [onlyStrict]\nnegative: {phase: early, type: SyntaxError}",
  );
  assert.equal(
    inspectSyntax(incorrect, "strict", testMetadata(incorrect)).status,
    "negative-accepted",
  );
});
test("strict test transformation preserves original source and reports the prefix", () => {
  const text = fixture("flags: [onlyStrict]", 'const x = "unterminated');
  const result = inspectSyntax(text, "strict", testMetadata(text));
  assert.equal(result.status, "rejected");
  assert.equal(result.prefixLines, 1);
  assert.equal(result.diagnostic?.position.line, 5);
});

test("raw module tests retain module grammar without source transformations", () => {
  const text =
    "#!\n" + fixture("flags: [module, raw]", "export const value=1;");
  const metadata = testMetadata(text);
  assert.deepEqual(syntaxVariants(metadata), ["module"]);
  const result = inspectSyntax(text, "module", metadata);
  assert.equal(result.status, "accepted");
  assert.equal(result.prefixLines, 0);
});

test("Test262 metadata accepts CR-only source without rewriting test text", () => {
  const lf = fixture(
    "flags: [onlyStrict]\nincludes: [nativeFunctionMatcher.js]\nnegative:\n  phase: runtime\n  type: TypeError",
    "const text = `first\nsecond`;",
  );
  const expected = testMetadata(lf);
  for (const newline of ["\r", "\r\n", "\n"]) {
    const source = lf.replaceAll("\n", newline);
    assert.deepEqual(testMetadata(source), expected);
    assert.ok(source.endsWith(`const text = \`first${newline}second\`;`));
  }
});

test("sloppy and raw syntax inventories use Script directives without a strict prefix", () => {
  for (const variant of ["sloppy", "raw"] as const) {
    const text = fixture("flags: []", "var eval=1;function f(a,a){return a;}");
    const result = inspectSyntax(text, variant, testMetadata(text));
    assert.equal(result.status, "accepted");
    assert.equal(result.prefixLines, 0);
    const strict = fixture("flags: []", '"use strict";var eval=1;');
    assert.equal(
      inspectSyntax(strict, variant, testMetadata(strict)).status,
      "rejected",
    );
  }
});
