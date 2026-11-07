import assert from "node:assert/strict";
import test from "node:test";
import { initializationSlots } from "../src/scalar/initialization-slots.ts";
import type { FunctionIR, Block } from "../src/scalar/model.ts";
import { verify } from "../src/scalar/index.ts";
const span = { start: 0, end: 0 };
function diamonds(count: number): FunctionIR {
  const blocks: Block[] = [];
  for (let i = 0; i <= count; i++) {
    const instructions: Block["instructions"][number][] = [
      { kind: "load", id: i * 4, slot: 0, ...span },
    ];
    if (i > 0)
      instructions.push({ kind: "load", id: i * 4 + 1, slot: i, ...span });
    blocks.push({
      id: i * 3,
      instructions,
      terminator:
        i === count
          ? { kind: "return", value: undefined, ...span }
          : {
              kind: "branch",
              condition: i * 4,
              consequent: i * 3 + 1,
              alternate: i * 3 + 2,
              ...span,
            },
    });
    if (i === count) break;
    for (let arm = 1; arm <= 2; arm++)
      blocks.push({
        id: i * 3 + arm,
        instructions: [
          { kind: "constant", id: i * 4 + arm + 1, value: 42, ...span },
          { kind: "store", slot: i + 1, value: i * 4 + arm + 1, ...span },
        ],
        terminator: { kind: "jump", target: i * 3 + 3, ...span },
      });
  }
  return {
    id: 0,
    name: "diamonds",
    exported: true,
    parameters: [0],
    slots: [
      "boolean",
      ...Array.from({ length: count }, () => "number" as const),
    ],
    returnType: "void",
    entry: 0,
    blocks,
  };
}
test("short-lived branch results do not grow a quadratic initialization matrix", () => {
  for (const count of [32, 64, 128]) {
    const fn = diamonds(count);
    const result = verify({ functions: [fn] });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(initializationSlots(fn).count, 0, `${count} branch results`);
  }
});
test("a missing incoming definition retains verification facts", () => {
  const original = diamonds(1),
    fn = {
      ...original,
      blocks: original.blocks.map((block) =>
        block.id === 2
          ? {
              ...block,
              instructions: block.instructions.filter(
                (op) => op.kind !== "store",
              ),
            }
          : block,
      ),
    };
  assert.equal(initializationSlots(fn).count, 1);
  const result = verify({ functions: [fn] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "INITIALIZATION");
});
test("exhausted local proof budgets fall back to the complete analysis", () => {
  const blocks: Block[] = [
    {
      id: 0,
      instructions: [
        { kind: "constant", id: 0, value: 42, ...span },
        { kind: "store", slot: 0, value: 0, ...span },
      ],
      terminator: { kind: "jump", target: 1, ...span },
    },
  ];
  for (let id = 1; id < 256; id++)
    blocks.push({
      id,
      instructions: [],
      terminator: { kind: "jump", target: id + 1, ...span },
    });
  blocks.push({
    id: 256,
    instructions: [{ kind: "load", id: 1, slot: 0, ...span }],
    terminator: { kind: "return", value: 1, ...span },
  });
  const fn: FunctionIR = {
    id: 0,
    name: "long",
    exported: true,
    parameters: [],
    slots: ["number"],
    returnType: "number",
    entry: 0,
    blocks,
  };
  assert.equal(initializationSlots(fn).count, 1);
  const result = verify({ functions: [fn] });
  assert.ok(result.ok, JSON.stringify(result));
});
test("exceptional predecessors cannot prove a store after a throwing call", () => {
  for (const before of [false, true]) {
    const store = { kind: "store" as const, slot: 0, value: 0, ...span },
      call = {
        kind: "call" as const,
        target: 1,
        id: undefined,
        arguments: [],
        ...span,
      };
    const fn: FunctionIR = {
      id: 0,
      name: "handler",
      exported: true,
      parameters: [],
      slots: ["number", "general"],
      returnType: "number",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "constant", id: 0, value: 42, ...span },
            ...(before ? [store, call] : [call, store]),
          ],
          terminator: { kind: "return", value: 0, ...span },
          exception: { target: 1, slot: 1 },
        },
        {
          id: 1,
          instructions: [{ kind: "load", id: 1, slot: 0, ...span }],
          terminator: { kind: "return", value: 1, ...span },
        },
      ],
    };
    const callee: FunctionIR = {
      id: 1,
      name: "callee",
      exported: false,
      parameters: [],
      slots: [],
      returnType: "void",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [],
          terminator: { kind: "return", value: undefined, ...span },
        },
      ],
    };
    assert.equal(
      initializationSlots(fn).count,
      1,
      "uncertain exception prefix uses full analysis",
    );
    const result = verify({ functions: [fn, callee] });
    assert.equal(result.ok, before, JSON.stringify(result));
    if (!result.ok) assert.equal(result.error.code, "INITIALIZATION");
  }
});
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
  assert.equal(result.count, 0);
  assert.deepEqual([...result.indices], [0, 0, 0, 0]);
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
