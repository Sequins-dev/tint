import assert from "node:assert/strict";
import { test } from "node:test";
import { Script } from "node:vm";
import { createSourceText } from "@tint/source/text";
import { parseScript } from "@tint/typescript/syntax";
import * as binding from "../src/binding/index.ts";
function validate(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseScript(source.value);
  assert.ok(parsed.ok);
  assert.equal(typeof binding.validateJavaScriptBindings, "function");
  return binding.validateJavaScriptBindings(parsed.value, "script");
}
for (const text of [
  "{function f(){}let f;}",
  "{var f;function f(){}}",
  "try{}catch(f){function f(){}}",
  "switch(0){case 0:function f(){}case 1:const f=1;}",
])
  test(`early-error validation is independent of Annex B execution support: ${text}`, () => {
    assert.throws(() => new Script(text), SyntaxError);
    assert.equal(validate(text)?.code, "DUPLICATE_NAME");
  });
for (const text of [
  "{function f(){}function f(){}}",
  "{function f(){}}",
  "let f;{function f(){}}",
])
  test(`early-error validation accepts valid sloppy block declarations: ${text}`, () => {
    assert.doesNotThrow(() => new Script(text));
    assert.equal(validate(text), undefined);
  });
