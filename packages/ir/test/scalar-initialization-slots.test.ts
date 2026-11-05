import assert from "node:assert/strict";
import test from "node:test";
import { initializationSlots } from "../src/scalar/initialization-slots.ts";
import type { FunctionIR } from "../src/scalar/model.ts";
const span = { start: 0, end: 0 };
test("only reads requiring predecessor facts occupy the initialization matrix", () => {
  const fn: FunctionIR = {
    id: 0,
    name: "f",
    exported: true,
    parameters: [0],
    slots: ["number", "number", "number", "number"],
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...span },
          { kind: "store", slot: 1, value: 0, ...span },
          { kind: "load", id: 1, slot: 1, ...span },
          { kind: "store", slot: 2, value: 1, ...span },
        ],
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 2, slot: 2, ...span },
          { kind: "store", slot: 2, value: 2, ...span },
        ],
        terminator: { kind: "return", value: undefined, ...span },
      },
    ],
  };
  const result = initializationSlots(fn);
  assert.equal(result.count, 1);
  assert.deepEqual([...result.indices], [0, 0, 1, 0]);
});
test("guarded writes consume transfer slots but reads define them on an edge", () => {
  const fn: FunctionIR = {
    id: 0,
    name: "f",
    exported: true,
    parameters: [0],
    slots: ["reference", "number", "number"],
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
        terminator: {
          kind: "record",
          object: 0,
          record: 0,
          field: 0,
          operation: "write",
          slot: 1,
          consequent: 1,
          alternate: 1,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [{ kind: "load", id: 1, slot: 0, ...span }],
        terminator: {
          kind: "record",
          object: 1,
          record: 0,
          field: 0,
          operation: "read",
          slot: 2,
          consequent: 1,
          alternate: 1,
          ...span,
        },
      },
    ],
  };
  assert.deepEqual([...initializationSlots(fn).indices], [0, 1, 0]);
});
