import assert from "node:assert/strict";
import test from "node:test";
import { proveCellStates } from "../src/optimization/cell-states.ts";
import {
  verify,
  type Block,
  type FunctionIR,
  type Instruction,
  type ModuleIR,
} from "@tint/ir/scalar";
const s = { start: 0, end: 0 };
const records = [
  {
    byteLength: 48,
    fields: [
      { offset: 24, type: "number" as const, mutable: true, stateOffset: 16 },
      { offset: 40, type: "number" as const, mutable: false, stateOffset: 32 },
    ],
  },
];

/** b0..b2 each load the object from slot 0 and access a cell of it into
 * slot 1; `between` runs before the third access. Block 3 traps, 4 returns. */
function program(
  operations: readonly ("initialize" | "read" | "write")[],
  fields: readonly number[],
  between: readonly Instruction[] = [],
): FunctionIR {
  const blocks: Block[] = [];
  operations.forEach((operation, index) => {
    const object = 10 + index;
    const instructions: Instruction[] = index === 2 ? between.slice() : [];
    instructions.push({ kind: "load", id: object, slot: 0, ...s });
    blocks.push({
      id: index,
      instructions,
      terminator: {
        kind: "record-cell",
        object,
        record: 0,
        field: fields[index] ?? 0,
        operation,
        slot: 1,
        consequent: index + 1 < operations.length ? index + 1 : 4,
        alternate: 3,
        ...s,
      },
    });
  });
  blocks[3] = { id: 3, instructions: [], terminator: { kind: "trap", ...s } };
  blocks[4] = {
    id: 4,
    instructions: [{ kind: "load", id: 20, slot: 1, ...s }],
    terminator: { kind: "return", value: 20, ...s },
  };
  return {
    id: 0,
    name: "cells",
    exported: true,
    parameters: [0, 1, 2],
    slots: ["reference", "number", "reference"],
    returnType: "number",
    entry: 0,
    blocks,
  };
}
function marked(fn: FunctionIR): boolean[] {
  return fn.blocks
    .slice(0, 3)
    .map(
      (block) =>
        block !== undefined &&
        block.terminator.kind === "record-cell" &&
        block.terminator.initialized === true,
    );
}
function check(fn: FunctionIR): void {
  const module: ModuleIR = { records, functions: [fn] };
  assert.deepEqual(verify(module), { ok: true });
}

test("accesses after a successful access to the same cell skip the state test", () => {
  const fn = program(["read", "write", "read"], [0, 0, 0]);
  check(fn);
  const result = proveCellStates(fn, records, 100000);
  assert.ok(result);
  assert.deepEqual(marked(result.fn), [false, true, true]);
  check(result.fn);
});

test("initializations, immutable writes and other fields stay checked", () => {
  const result = proveCellStates(
    program(["initialize", "initialize", "read"], [1, 0, 1]),
    records,
    100000,
  );
  assert.ok(result);
  // The second initialization stays checked (it must fail on state 1); the
  // read of field 1 follows its initialization.
  assert.deepEqual(marked(result.fn), [false, false, true]);
  const immutable = proveCellStates(
    program(["read", "write", "read"], [1, 1, 1]),
    records,
    100000,
  );
  assert.ok(immutable);
  assert.deepEqual(marked(immutable.fn), [false, false, true]);
});

test("a store to the object slot ends the proof", () => {
  const store: Instruction[] = [
    { kind: "load", id: 30, slot: 2, ...s },
    { kind: "store", slot: 0, value: 30, ...s },
  ];
  const result = proveCellStates(
    program(["read", "read", "read"], [0, 0, 0], store),
    records,
    100000,
  );
  assert.ok(result);
  assert.deepEqual(marked(result.fn), [false, true, false]);
});

test("the verifier rejects a proven-initialized initialization", () => {
  const fn = program(["read", "read", "read"], [0, 0, 0]);
  const block = fn.blocks[0];
  assert.ok(block && block.terminator.kind === "record-cell");
  const bad: FunctionIR = {
    ...fn,
    blocks: [
      {
        ...block,
        terminator: {
          ...block.terminator,
          operation: "initialize",
          initialized: true,
        },
      },
      ...fn.blocks.slice(1),
    ],
  };
  const verdict = verify({ records, functions: [bad] });
  assert.equal(verdict.ok, false);
});
