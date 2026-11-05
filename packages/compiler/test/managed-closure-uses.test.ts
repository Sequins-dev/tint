import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import * as compiler from "../src/native/managed-closure-uses.ts";

function fixture(text: string) {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const wrapper = checked.value.bindings.functions.find(
    (fn) =>
      fn.node ===
      parsed.value.statements.find(
        (statement) =>
          statement.kind === "function" && statement.name === "wrapper",
      ),
  );
  assert.ok(wrapper);
  return { checked: checked.value, wrapper: wrapper.id };
}
function allowed(text: string): string[] {
  const { checked, wrapper } = fixture(text);
  const proof = compiler.managedDirectCallDeclarations(checked, wrapper);
  assert.ok(proof.ok, JSON.stringify(proof));
  return proof.value
    .map((id) => {
      const fn = checked.bindings.functions[id];
      assert.ok(fn);
      const declaration = checked.bindings.bindings.find(
        (binding) => binding.kind === "function" && binding.node === fn.node,
      );
      assert.ok(declaration);
      return declaration.name;
    })
    .sort();
}
test("internal declarations are proven through binding identity, including recursive direct calls", () => {
  assert.equal(typeof compiler.managedDirectCallDeclarations, "function");
  assert.deepEqual(
    allowed(`function outside():number{return 1;}function wrapper():number{
 function first(n:number):number{return n===0?42:first(n-1);}
 function second():number{return first(2);}
 return second();}`),
    ["first", "second"],
  );
});
test("an argument, stored value or Script metadata reference prevents the direct-only exception", () => {
  for (const body of [
    "const x=execute;return x();",
    "const x={scriptOrModule:execute};return x.scriptOrModule();",
    "function take(f:()=>number):number{return f();}return take(execute);",
  ]) {
    const result = allowed(
      `function wrapper():number{function execute():number{return 42;}${body}}`,
    );
    assert.ok(!result.includes("execute"), body);
  }
  assert.deepEqual(
    allowed("function wrapper():()=>number{return ()=>42;}"),
    [],
  );
});
test("shadowed names and other top-level declarations never confer local proof", () => {
  assert.deepEqual(
    allowed(`function other():number{return 1;}function wrapper():number{
 function local():number{return 42;}function child():number{const local=1;return local;}return local()+child();}`),
    ["child", "local"],
  );
  const { checked } = fixture("function wrapper():number{return 42;}");
  assert.equal(compiler.managedDirectCallDeclarations(checked, 999).ok, false);
});
