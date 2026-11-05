import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseScript } from "@tint/typescript/syntax";

test("runtime source strings preserve lone surrogate literal values and locations", () => {
  const text = "// source\r\n'\ud800\udfff\ud800';\n'\udfff';";
  const source = createSourceTextView(text),
    parsed = parseScript(source);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  assert.equal(parsed.value.end, text.length);
  const first = parsed.value.statements[0],
    second = parsed.value.statements[1];
  assert.equal(first?.kind, "expression");
  assert.equal(second?.kind, "expression");
  if (
    first?.kind !== "expression" ||
    first.expression.kind !== "string" ||
    second?.kind !== "expression" ||
    second.expression.kind !== "string"
  )
    assert.fail("string statements expected");
  assert.equal(first.expression.value, "\ud800\udfff\ud800");
  assert.equal(second.expression.value, "\udfff");
  assert.deepEqual(source.positionAt(first.start), {
    ok: true,
    value: { line: 2, column: 1 },
  });
  assert.deepEqual(source.positionAt(second.start), {
    ok: true,
    value: { line: 3, column: 1 },
  });
  const invalid = parseScript(createSourceTextView("\r\n\ud800;"));
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.error.position.line, 2);
    assert.equal(invalid.error.position.column, 1);
  }
});
