import { test } from "node:test";
import assert from "node:assert/strict";
import type { Expression } from "@tint/typescript/syntax";
type OrdinaryFunction = Extract<Expression, { kind: "function-expression" }>;
const block: OrdinaryFunction["body"] = {
  kind: "block",
  statements: [],
  start: 0,
  end: 2,
};
const concise: OrdinaryFunction["body"] = {
  // @ts-expect-error Ordinary functions require a block; concise bodies belong to arrows.
  kind: "number",
  value: 1,
  raw: "1",
  start: 0,
  end: 1,
};
void concise;
test("ordinary functions have independently extractable block-body contracts", () => {
  assert.equal(block.kind, "block");
});
