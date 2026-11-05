import assert from "node:assert/strict";
import { test } from "node:test";
import { createSourceText } from "@tint/source/text";
import * as syntax from "../src/syntax/index.ts";

test("optional-chain detection follows postfix links and stops at parentheses", () => {
  assert.equal(typeof syntax.isOptionalChain, "function");
  for (const [text, expected] of [
    ["o?.x.y", true],
    ["o.m?.()", true],
    ["o?.[k]?.(a).x", true],
    ["(o?.x).y", false],
    ["(o?.x)()", false],
    ["o.m()", false],
  ] as const) {
    const bytes = new TextEncoder().encode(text),
      source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    const parsed = syntax.parseScript(source.value);
    assert.ok(parsed.ok, JSON.stringify(parsed));
    const statement = parsed.value.statements[0];
    assert.equal(statement?.kind, "expression");
    if (statement?.kind === "expression")
      assert.equal(
        syntax.isOptionalChain(statement.expression),
        expected,
        text,
      );
  }
});
