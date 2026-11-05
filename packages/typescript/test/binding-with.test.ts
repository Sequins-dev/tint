import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseScript } from "@tint/typescript/syntax";
import {
  bindScript,
  bindModule,
  collectScriptDeclarations,
} from "../src/binding/index.ts";
function parse(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const result = parseScript(source.value);
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
test("with traverses object and body and hoists var declarations outside the object scope", () => {
  const module = parse("with (source) {var x=1;let y=2;read(x,y);}x;");
  const result = bindScript(module);
  assert.ok(result.ok, JSON.stringify(result));
  const declarations = collectScriptDeclarations(module);
  assert.deepEqual(declarations.variables, ["x"]);
  assert.deepEqual(declarations.lexical, []);
});
test("with body var declarations participate in enclosing lexical conflicts", () => {
  const result = bindScript(parse("let x;with({}){var x;}"));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "DUPLICATE_NAME");
});
test("typed binding rejects dynamic with name resolution explicitly", () => {
  const result = bindModule(parse("with({}){}"));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "UNSUPPORTED");
});
