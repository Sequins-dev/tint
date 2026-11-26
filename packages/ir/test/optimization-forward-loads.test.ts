import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionIR, Instruction } from "@tint/ir/scalar";
import { forwardLocalLoads } from "../src/optimization/forward-loads.ts";
const s = { start: 0, end: 0 };
function fixture(
  instructions: readonly Instruction[],
  returned: number,
): FunctionIR {
  return {
    id: 0,
    name: "copies",
    exported: true,
    parameters: [0],
    slots: ["number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions,
        terminator: { kind: "return", value: returned, ...s },
      },
    ],
  };
}
test("local copies forward canonical values and preserve store versions", () => {
  const fn = fixture(
    [
      { kind: "load", id: 0, slot: 0, ...s },
      { kind: "store", slot: 1, value: 0, ...s },
      { kind: "load", id: 1, slot: 1, ...s },
      { kind: "constant", id: 2, value: 7, ...s },
      { kind: "store", slot: 1, value: 2, ...s },
      { kind: "load", id: 3, slot: 1, ...s },
      { kind: "binary", id: 4, operator: "+", left: 1, right: 3, ...s },
    ],
    4,
  );
  const result = forwardLocalLoads(fn, 1000);
  assert.ok(result);
  assert.equal(result.forwarded, 2);
  assert.deepEqual(result.fn.blocks[0]?.instructions.at(-1), {
    kind: "binary",
    id: 4,
    operator: "+",
    left: 0,
    right: 2,
    ...s,
  });
  assert.equal(fn.blocks[0]?.instructions.length, 7);
});
test("calls invalidate slot facts but not already captured SSA values", () => {
  const fn = fixture(
    [
      { kind: "load", id: 0, slot: 0, ...s },
      { kind: "load", id: 1, slot: 0, ...s },
      { kind: "call", id: undefined, target: 1, arguments: [], ...s },
      { kind: "load", id: 2, slot: 0, ...s },
      { kind: "binary", id: 3, operator: "+", left: 1, right: 2, ...s },
    ],
    3,
  );
  const result = forwardLocalLoads(fn, 1000);
  assert.ok(result);
  assert.equal(result.forwarded, 1);
  assert.deepEqual(result.fn.blocks[0]?.instructions.at(-1), {
    kind: "binary",
    id: 3,
    operator: "+",
    left: 0,
    right: 2,
    ...s,
  });
});
test("substitution does not carry block-local values into another block", () => {
  const first = fixture([{ kind: "load", id: 0, slot: 0, ...s }], 0);
  const fn: FunctionIR = {
    ...first,
    blocks: [
      { ...first.blocks[0]!, terminator: { kind: "jump", target: 1, ...s } },
      {
        id: 1,
        instructions: [{ kind: "load", id: 1, slot: 0, ...s }],
        terminator: { kind: "return", value: 1, ...s },
      },
    ],
  };
  assert.equal(forwardLocalLoads(fn, 1000)?.forwarded, 0);
  assert.equal(forwardLocalLoads(fn, 0), undefined);
});
test("allocation and proven direct calls preserve unexposed local snapshots", () => {
  const fn = fixture(
    [
      { kind: "load", id: 0, slot: 0, ...s },
      { kind: "array-new", id: 1, type: "Uint8Array", length: 0, ...s },
      { kind: "load", id: 2, slot: 0, ...s },
      { kind: "call", id: undefined, target: 1, arguments: [], ...s },
      { kind: "load", id: 3, slot: 0, ...s },
    ],
    3,
  );
  assert.equal(
    forwardLocalLoads(fn, 1000, new Uint32Array([0, 0]))?.forwarded,
    2,
  );
});
test("record write forwards the written slot value to a subsequent record read across unique predecessors", () => {
  const fn: FunctionIR = {
    id: 0,
    name: "writeRead",
    exported: true,
    parameters: [0, 1],
    slots: ["optional-reference", "number", "reference"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "reference-value", id: 1, value: 0, ...s },
          { kind: "store", slot: 2, value: 1, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 1,
        instructions: [{ kind: "load", id: 2, slot: 2, ...s }],
        terminator: {
          kind: "record",
          object: 2,
          record: 0,
          field: 0,
          operation: "write",
          slot: 1,
          consequent: 2,
          alternate: 3,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 3, slot: 0, ...s },
          { kind: "reference-value", id: 4, value: 3, ...s },
          { kind: "record-read", id: 5, object: 4, record: 0, field: 0, ...s },
        ],
        terminator: { kind: "return", value: 5, ...s },
      },
      { id: 3, instructions: [], terminator: { kind: "trap", ...s } },
    ],
  };
  const result = forwardLocalLoads(fn, 1000);
  assert.ok(result);
  assert.equal(result.forwarded, 1);
  assert.ok(
    result.fn.blocks[2]?.instructions.some(
      (op) => op.kind === "load" && op.slot === 1,
    ),
  );
  assert.ok(
    !result.fn.blocks[2]?.instructions.some((op) => op.kind === "record-read"),
  );
});
