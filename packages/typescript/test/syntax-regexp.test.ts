import { test } from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { createSourceText } from "@tint/source/text";
import { parseScript, rewriteModule } from "../src/syntax/index.ts";
function parse(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  return parseScript(source.value);
}
for (const text of [
  String.raw`/\d+/giu;`,
  "/=/.test('=');",
  "const f=(a=/[),}]/g)=>a;",
  "function f(a=/[)]/){return a;}",
  "const f=async(a=/[)]/)=>a;",
  "( /x/ );",
  "async(/x/);",
  "if(true)/x/.test('x');",
  "function f(){return /x/;}",
  "const x=`a${/[}]/.test('}')}`;",
  "let x=10; x /= 2; x / 2 / 1;",
  "/x/ / 2;",
  "const f = (a = () => /[)]/) => a;",
  'function f(){"use strict";return /a/;}',
  "({m(a=/[)]/){return a;}});",
])
  test(`regexp context ${text}`, () => {
    assert.doesNotThrow(() => new Script(text));
    const result = parse(text);
    assert.ok(result.ok, JSON.stringify(result));
  });
for (const text of [
  "/(/;",
  "/[z-a]/;",
  "/a/gg;",
  "/a/uv;",
  "/x/z;",
  "/x/π;",
  "/a{3,2}/;",
  String.raw`/\8/u;`,
  "/abc\n/;",
  "/abc",
  "async()=>{(a=await/r/g)=>{}};",
])
  test(`regexp syntax error ${JSON.stringify(text)}`, () => {
    assert.throws(() => new Script(text), SyntaxError);
    const result = parse(text);
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.ok(
        result.error.code === "SYNTAX_ERROR" ||
          result.error.code === "LEXICAL_ERROR",
        JSON.stringify(result),
      );
  });
test("regexp AST preserves raw pattern and flags through rewriting", () => {
  const result = parse(String.raw`/a\/b/g;`);
  assert.ok(result.ok);
  const statement = result.value.statements[0];
  assert.equal(statement?.kind, "expression");
  if (statement?.kind !== "expression") return;
  assert.deepEqual(statement.expression, {
    kind: "regexp",
    pattern: String.raw`a\/b`,
    flags: "g",
    start: 0,
    end: 7,
  });
  const rewritten = rewriteModule(result.value, {});
  assert.deepEqual(rewritten, result.value);
});
