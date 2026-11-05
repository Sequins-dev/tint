import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseScript } from "@tint/typescript/syntax";

function parse(text: string) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  return parseScript(source.value);
}

test("exponentiation is right associative and binds above multiplication", () => {
  const result = parse("2 * 3 ** 2 ** 2;");
  assert.ok(result.ok, JSON.stringify(result));
  const statement = result.value.statements[0];
  assert.ok(
    statement?.kind === "expression" && statement.expression.kind === "binary",
  );
  const product = statement.expression;
  assert.equal(product.operator, "*");
  assert.ok(product.right.kind === "binary");
  assert.equal(product.right.operator, "**");
  assert.ok(product.right.right.kind === "binary");
  assert.equal(product.right.right.operator, "**");
});

test("exponentiation distinguishes unary bases from grouped bases and unary exponents", () => {
  for (const text of [
    "(-2) ** 2;",
    "2 ** -2;",
    "2 ** -(2 ** 3);",
    "x++ ** 2;",
    "++x ** 2;",
    "x **= 2 ** 3;",
    "new C() ** 2;",
  ]) {
    assert.ok(parse(text).ok, text);
    assert.doesNotThrow(() => Function(text));
  }
  for (const text of [
    "-2 ** 2;",
    "+2 ** 2;",
    "!2 ** 2;",
    "~2 ** 2;",
    "typeof x ** 2;",
    "void x ** 2;",
    "delete x.y ** 2;",
    "2 ** -2 ** 2;",
  ]) {
    assert.equal(parse(text).ok, false, text);
    assert.throws(() => Function(text), SyntaxError);
  }
});
