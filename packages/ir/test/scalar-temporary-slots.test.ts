import assert from "node:assert/strict";
import test from "node:test";
import { planTemporarySlots } from "../src/scalar/temporary-slots.ts";
import type { FunctionIR } from "../src/scalar/model.ts";
const s = { start: 0, end: 0 };
const fn: FunctionIR = {
  id: 0,
  name: "roots",
  exported: true,
  parameters: [],
  slots: [],
  returnType: "reference",
  entry: 0,
  blocks: [
    {
      id: 0,
      instructions: [
        { kind: "record-new", id: 0, record: 0, arguments: [], ...s },
        { kind: "reference-wrap", id: 1, value: 0, ...s },
        { kind: "reference-value", id: 2, value: 1, ...s },
      ],
      terminator: { kind: "return", value: 2, ...s },
    },
  ],
};
test("managed temporary slots reuse dead values without aliasing live operands", () => {
  const plan = planTemporarySlots(fn, new Uint8Array([1, 1, 1]));
  assert.ok(plan);
  assert.deepEqual(plan.slots, new Uint32Array([0, 1, 0]));
  assert.deepEqual(plan.references, new Uint32Array([2]));
  assert.deepEqual(plan.generals, new Uint32Array([0]));
});
test("general and single-pointer roots occupy distinct storage classes", () => {
  const generalFn: FunctionIR = {
    ...fn,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "record-new", id: 0, record: 0, arguments: [], ...s },
          { kind: "general-wrap", id: 1, value: 0, ...s },
          { kind: "general-value", id: 2, value: 1, type: "reference", ...s },
        ],
        terminator: { kind: "return", value: 2, ...s },
      },
    ],
  };
  const plan = planTemporarySlots(generalFn, new Uint8Array([1, 2, 1]));
  assert.ok(plan);
  assert.deepEqual(plan.slots, new Uint32Array([0, 0, 0]));
  assert.equal(plan.references[0], 1);
  assert.equal(plan.generals[0], 1);
});
test("bounded analysis falls back rather than publishing partial layouts", () => {
  assert.equal(planTemporarySlots(fn, new Uint8Array([1, 1, 1]), 0), undefined);
  assert.equal(planTemporarySlots(fn, new Uint8Array([1])), undefined);
});
