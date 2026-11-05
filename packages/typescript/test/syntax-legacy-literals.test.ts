import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseScript, parseModule } from "../src/syntax/index.ts";
function parse(text: string, module = false) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  return module
    ? parseModule(source.value, "javascript")
    : parseScript(source.value);
}
test("legacy string escapes are decoded only in sloppy grammar", () => {
  for (const [text, expected] of [
    ['"\\1";', "\x01"],
    ['"\\377";', "\xff"],
    ['"\\400";', " 0"],
    ['"\\8\\9";', "89"],
    ['"\\08";', "\x008"],
  ]) {
    const result = parse(text!);
    assert.ok(result.ok, JSON.stringify(result));
    const node = result.value.statements[0];
    assert.equal(node?.kind, "expression");
    if (node?.kind === "expression" && node.expression.kind === "string")
      assert.equal(node.expression.value, expected);
    else assert.fail("expected string literal");
    assert.equal(parse('"use strict";' + text).ok, false);
    assert.equal(parse(text!, true).ok, false);
  }
  assert.equal(parse('"\\1"; "use strict";').ok, false);
  assert.equal(parse('function f(){"\\1"; "use strict";}').ok, false);
  assert.equal(parse("`\\1`;").ok, false);
  assert.equal(parse("tag`\\1`;").ok, true);
});

test("legacy numeric literals distinguish octal and non-octal decimal spellings", () => {
  for (const [text, expected] of [
    ["010;", 8],
    ["077;", 63],
    ["08;", 8],
    ["09.5;", 9.5],
    ["08e1;", 80],
  ] as const) {
    const result = parse(text);
    assert.ok(result.ok, JSON.stringify(result));
    const node = result.value.statements[0];
    if (node?.kind !== "expression" || node.expression.kind !== "number")
      assert.fail("number expected");
    assert.equal(node.expression.value, expected);
    assert.equal(parse('"use strict";' + text).ok, false);
    assert.equal(parse(text, true).ok, false);
  }
  for (const text of ["01.5;", "01e2;", "01n;", "0_1;", "08_1;"])
    assert.equal(parse(text).ok, false, text);
});
