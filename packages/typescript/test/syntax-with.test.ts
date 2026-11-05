import { test } from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { createSourceText } from "@tint/source/text";
import { parseScript, rewriteModule } from "../src/syntax/index.ts";
function parse(text: string) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  return parseScript(source.value);
}
for (const text of [
  "with ({x:42}) x;",
  "with ({}) {var x=1;let y=2;}",
  "function*g(){with({x:42}){yield x;}}",
  "outer:with({}){break outer;}",
  "with ({}) ;",
])
  test(`sloppy with parses: ${text}`, () => {
    assert.doesNotThrow(() => new Script(text));
    const result = parse(text);
    assert.ok(result.ok, JSON.stringify(result));
    const rewritten = rewriteModule(result.value, {});
    assert.deepEqual(rewritten, result.value);
  });
for (const text of [
  '"use strict";with({}){}',
  'function f(){"use strict";with({}){}}',
  "class C{m(){with({}){}}}",
  "with ({}) let x=1;",
  "with ({}) function f(){}",
  "with () {}",
])
  test(`with rejects invalid context: ${text}`, () => {
    assert.throws(() => new Script(text), SyntaxError);
    const result = parse(text);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "SYNTAX_ERROR");
  });
