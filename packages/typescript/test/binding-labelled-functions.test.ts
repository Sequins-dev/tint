import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";
import { createSourceText } from "@tint/source/text";
import { parseScript } from "@tint/typescript/syntax";
import * as binding from "../src/binding/index.ts";
function parse(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const result = parseScript(source.value);
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
test("labelled top-level functions retain ordinary var-scoped declaration order", () => {
  const script = parse(
    "a: function f(){return 1;} b:c:function f(){return 2;} function g(){}",
  );
  const plan = binding.collectScriptDeclarations(script);
  assert.deepEqual(
    plan.functions.map((f) => f.name),
    ["f", "f", "g"],
  );
  assert.deepEqual(plan.lexical, []);
  assert.deepEqual(
    binding.collectScriptDeclarations(parse("a:{b:function f(){}}")).functions,
    [],
  );
});
test("labelled function bindings resolve the same references as unlabelled declarations", () => {
  for (const text of [
    "function f(){return f;} f;",
    "a:b:function f(){return f;} f;",
  ]) {
    const result = binding.bindScript(parse(text));
    assert.ok(result.ok, JSON.stringify(result));
    const f = result.value.bindings.find((b) => b.name === "f");
    assert.ok(f);
    assert.equal(f.kind, "function");
    assert.equal(result.value.scopes[f.scope]?.kind, "script");
    for (const reference of result.value.references)
      if (reference.node.kind === "identifier" && reference.node.name === "f")
        assert.equal(reference.binding, f.id);
  }
});
test("labelled function declarations participate in lexical redeclaration early errors", () => {
  for (const text of [
    "let f; a:function f(){}",
    "const f=1; a:b:function f(){}",
    "class f{} a:function f(){}",
  ]) {
    assert.throws(() => new Script(text), SyntaxError);
    assert.equal(
      binding.validateJavaScriptBindings(parse(text), "script")?.code,
      "DUPLICATE_NAME",
      text,
    );
  }
});
