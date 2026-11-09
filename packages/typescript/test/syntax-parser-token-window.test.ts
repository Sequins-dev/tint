import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import { parseModule, parseScript } from "../src/syntax/index.ts";

const script = (text: string) => parseScript(createSourceTextView(text));
const typescript = (text: string) => parseModule(createSourceTextView(text));

// staging/sm/regress/regress-610026.js evaluates 2^21 and then about 2^22
// sequential empty blocks. Parsing must neither keep every token nor build a
// node per empty block, and must not stop at a token budget.
test("millions of empty blocks parse to an empty statement list", () => {
  for (const count of [2 ** 16, 2 ** 21]) {
    const parsed = script("{}".repeat(count));
    assert.ok(parsed.ok, JSON.stringify(parsed.ok ? undefined : parsed.error));
    assert.equal(parsed.value.statements.length, 0, String(count));
  }
  const nested = script("{{}{{}}}0;" + "{}".repeat(9000) + "1;");
  assert.ok(nested.ok);
  assert.deepEqual(
    nested.value.statements.map((statement) => statement.kind),
    ["expression", "expression"],
  );
});

test("empty-block elision keeps every other statement shape", () => {
  const parsed = script(
    "l: {} if (x) {} else {} while (y) {} do {} while (z); { let a; } switch (q) { case 1: {} default: {} }",
  );
  assert.ok(parsed.ok);
  assert.deepEqual(
    parsed.value.statements.map((statement) => statement.kind),
    ["label", "if", "while", "do-while", "block", "switch"],
  );
  const switched = parsed.value.statements[5];
  assert.ok(switched?.kind === "switch");
  assert.deepEqual(
    switched.clauses.map((clause) => clause.statements.length),
    [0, 0],
  );
  // Directives are recognized from tokens: an empty block still ends the
  // directive prologue.
  const late = script('{} "use strict"; var eval;');
  assert.ok(late.ok);
  assert.equal(late.value.strict, false);
  const early = script('"use strict"; {} x = 1;');
  assert.ok(early.ok);
  assert.equal(early.value.strict, true);
});

test("backtracking across far more tokens than the window still works", () => {
  const names = Array.from({ length: 10000 }, (_, i) => "a" + i);
  // The arrow's parameter list is probed and re-read from its start.
  const arrow = script(
    "x = (" + names.join(", ") + ") => " + names[9999] + ";",
  );
  assert.ok(arrow.ok, JSON.stringify(arrow.ok ? undefined : arrow.error));
  const statement = arrow.value.statements[0];
  assert.ok(statement?.kind === "expression");
  assert.equal(statement.expression.kind, "assignment");
  // A parenthesized expression of the same length is not an arrow.
  const group = script("x = (" + names.join(", ") + ");");
  assert.ok(group.ok);
  // Regular expressions are rescanned from a checkpoint far into the source.
  const regexp = script("x = 1;".repeat(6000) + "y = /a[/]b/g.test(z);");
  assert.ok(regexp.ok, JSON.stringify(regexp.ok ? undefined : regexp.error));
  assert.equal(regexp.value.statements.length, 6001);
  // Type-argument calls and split closing angles after a long prefix.
  const generic = typescript(
    "let n = 0;".repeat(6000) +
      "const m = new Map<string, Array<number>>(); const v = f<Array<number>>(1); const w = a < b > (c);",
  );
  assert.ok(generic.ok, JSON.stringify(generic.ok ? undefined : generic.error));
  assert.equal(generic.value.statements.length, 6003);
});
