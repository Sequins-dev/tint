import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseScript, rewriteModule } from "../src/syntax/index.ts";
function parse(text: string) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  return parseScript(source.value);
}
test("decorators preserve class and element expressions through rewriting", () => {
  const result = parse(
    "@decorate class C { @factory(arg) accessor value = 1; @obj.method method(){} }",
  );
  assert.ok(result.ok, JSON.stringify(result));
  const node = result.value.statements[0];
  assert.equal(node?.kind, "class");
  if (node?.kind !== "class") return;
  assert.equal(node.definition.decorators?.length, 1);
  const field = node.definition.elements[0];
  assert.equal(field?.kind, "field");
  if (field?.kind === "field") assert.equal(field.accessor, true);
  const names: string[] = [];
  const rewritten = rewriteModule(result.value, {
    expression(node) {
      if (node.kind === "identifier") names.push(node.name);
      return node;
    },
  });
  assert.deepEqual(names, ["decorate", "factory", "arg", "obj"]);
  assert.deepEqual(rewritten.statements, result.value.statements);
  for (const text of [
    "let C = @dec class {};",
    "@yield class C {}",
    "@(fn()) class C {}",
    "class C { accessor x; static accessor y; accessor(){} }",
  ])
    assert.ok(parse(text).ok, text);
});
test("decorator grammar rejects invalid unparenthesized forms and element targets", () => {
  for (const text of [
    "@a[b] class C {}",
    "@a?.b class C {}",
    "@a()() class C {}",
    "@42 class C {}",
    "@dec function f(){}",
    "class C { @dec constructor(){} }",
    "class C { @dec static {} }",
    "class C { accessor method(){} }",
  ])
    assert.equal(parse(text).ok, false, text);
});
