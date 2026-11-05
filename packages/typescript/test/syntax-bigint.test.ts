import { test } from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { createSourceText } from "@tint/source/text";
import {
  scan,
  parseScript,
  literalPropertyName,
  type Expression,
} from "../src/syntax/index.ts";
function source(text: string) {
  const bytes = new TextEncoder().encode(text);
  const result = createSourceText(bytes, bytes.length);
  assert.ok(result.ok);
  return result.value;
}
for (const spelling of [
  "0n",
  "123n",
  "9007199254740993n",
  "0xF_Fn",
  "0b1010_0101n",
  "0o777n",
  "123_456_789n",
])
  test(`BigInt literal retains exact value: ${spelling}`, () => {
    const expected = String(new Script(spelling).runInNewContext());
    const tokens = scan(source(spelling));
    assert.ok(tokens.ok);
    assert.equal(tokens.value[0]?.kind, "bigint");
    assert.equal(tokens.value[0]?.value, spelling);
    const parsed = parseScript(source(spelling));
    assert.ok(parsed.ok, JSON.stringify(parsed));
    const stmt = parsed.value.statements[0];
    assert.equal(stmt?.kind, "expression");
    if (stmt?.kind !== "expression") return;
    const expr = stmt.expression;
    assert.equal(expr.kind, "bigint");
    if (expr.kind !== "bigint") return;
    assert.equal(expr.value, expected);
    assert.equal(expr.raw, spelling);
    assert.equal(literalPropertyName(expr), expected);
  });
for (const spelling of [
  "1.0n",
  "1.n",
  ".1n",
  "1e2n",
  "01n",
  "0_1n",
  "0xn",
  "0b2n",
  "1_n",
  "1nfoo",
  "1nn",
  "1n\\u0061",
])
  test(`invalid BigInt spelling rejects: ${spelling}`, () => {
    assert.throws(() => new Script(spelling), SyntaxError);
    const result = scan(source(spelling));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "LEXICAL_ERROR");
  });
test("BigInt object and class property names normalize without Number rounding", () => {
  for (const text of [
    "({9007199254740993n:42,0xffn(){}});",
    "class C{9007199254740993n=42;0xffn(){}}",
  ]) {
    assert.doesNotThrow(() => new Script(text));
    const result = parseScript(source(text));
    assert.ok(result.ok, JSON.stringify(result));
  }
  const positive: Expression = {
    kind: "bigint",
    value: "9007199254740993",
    raw: "9007199254740993n",
    start: 0,
    end: 17,
  };
  assert.equal(
    literalPropertyName({
      ...positive,
      kind: "unary",
      operator: "-",
      operand: positive,
    }),
    "-9007199254740993",
  );
  assert.equal(
    literalPropertyName({
      kind: "unary",
      operator: "+",
      operand: positive,
      start: 0,
      end: 18,
    }),
    undefined,
  );
});
