import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionIR } from "../src/scalar/model.ts";
import { wordOnlyValues } from "../src/scalar/word-uses.ts";
const s = { start: 0, end: 0 };
const fn: FunctionIR = {
  id: 0,
  name: "bits",
  exported: true,
  parameters: [0],
  slots: ["number"],
  returnType: "number",
  entry: 0,
  blocks: [
    {
      id: 0,
      instructions: [
        { kind: "load", id: 0, slot: 0, ...s },
        { kind: "unary", id: 1, operator: "~", operand: 0, ...s },
        { kind: "binary", id: 2, operator: "^", left: 1, right: 0, ...s },
      ],
      terminator: { kind: "return", value: 2, ...s },
    },
  ],
};
test("bit-only intermediates retain word representations; returned numbers do not", () => {
  assert.deepEqual([...wordOnlyValues(fn)!], [0, 1, 0]);
});
test("a single ordinary use prevents word-only representation", () => {
  const block = fn.blocks[0]!;
  const result = wordOnlyValues({
    ...fn,
    blocks: [
      {
        ...block,
        instructions: [
          ...block.instructions,
          { kind: "store", slot: 0, value: 1, ...s },
        ],
      },
    ],
  });
  assert.equal(result?.[1], 0);
});
test("exhaustion publishes no representation plan", () => {
  assert.equal(wordOnlyValues(fn, 0), undefined);
  assert.equal(wordOnlyValues(fn, NaN), undefined);
});
