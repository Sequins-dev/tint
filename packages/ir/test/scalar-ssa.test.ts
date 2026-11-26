import assert from "node:assert/strict";
import test from "node:test";
import { promoteSlots, lowerSSA } from "../src/scalar/ssa.ts";
import { verify } from "../src/scalar/index.ts";
import type { FunctionIR } from "../src/scalar/model.ts";
const s = { start: 0, end: 0 };
const diamond: FunctionIR = {
  id: 0,
  name: "diamond",
  exported: true,
  parameters: [0],
  slots: ["boolean", "number"],
  returnType: "number",
  entry: 0,
  blocks: [
    {
      id: 0,
      instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
      terminator: {
        kind: "branch",
        condition: 0,
        consequent: 1,
        alternate: 2,
        ...s,
      },
    },
    {
      id: 1,
      instructions: [
        { kind: "constant", id: 1, value: 4, ...s },
        { kind: "store", slot: 1, value: 1, ...s },
      ],
      terminator: { kind: "jump", target: 3, ...s },
    },
    {
      id: 2,
      instructions: [
        { kind: "constant", id: 2, value: 5, ...s },
        { kind: "store", slot: 1, value: 2, ...s },
      ],
      terminator: { kind: "jump", target: 3, ...s },
    },
    {
      id: 3,
      instructions: [{ kind: "load", id: 3, slot: 1, ...s }],
      terminator: { kind: "return", value: 3, ...s },
    },
  ],
};
test("promotes branch joins into typed block arguments and distinct global definitions", () => {
  assert.deepEqual(verify({ functions: [diamond] }), { ok: true });
  const ssa = promoteSlots(diamond, 10000)!;
  assert.ok(ssa);
  assert.equal(ssa.blocks[3]!.parameters.length, 1);
  assert.equal(ssa.blocks[3]!.parameters[0]!.type, "number");
  assert.equal(ssa.blocks[3]!.instructions.length, 0);
  assert.notEqual(
    ssa.blocks[1]!.edges[0]!.arguments[0],
    ssa.blocks[2]!.edges[0]!.arguments[0],
  );
  assert.deepEqual(verify({ functions: [lowerSSA(ssa)] }), { ok: true });
});
test("preserves mutable exception-observable storage and fails closed on budget exhaustion", () => {
  assert.equal(promoteSlots(diamond, 0), undefined);
  const fn: FunctionIR = {
    ...diamond,
    slots: [...diamond.slots, "general"],
    blocks: diamond.blocks.map((b) =>
      b.id === 1 ? { ...b, exception: { target: 2, slot: 2 } } : b,
    ),
  };
  const ssa = promoteSlots(fn, 10000)!;
  assert.ok(ssa);
  assert.equal(ssa.blocks[3]!.parameters.length, 0);
  assert.ok(ssa.blocks[1]!.instructions.some((op) => op.kind === "store"));
});
test("loop carried values use block arguments and parallel copies preserve swaps", () => {
  const fn: FunctionIR = {
    id: 0,
    name: "loop",
    exported: true,
    parameters: [0],
    slots: ["boolean", "number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 1, ...s },
          { kind: "constant", id: 1, value: 2, ...s },
          { kind: "store", slot: 1, value: 0, ...s },
          { kind: "store", slot: 2, value: 1, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 2, slot: 1, ...s },
          { kind: "load", id: 3, slot: 2, ...s },
          { kind: "store", slot: 1, value: 3, ...s },
          { kind: "store", slot: 2, value: 2, ...s },
          { kind: "load", id: 4, slot: 0, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 4,
          consequent: 1,
          alternate: 2,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [{ kind: "load", id: 5, slot: 1, ...s }],
        terminator: { kind: "return", value: 5, ...s },
      },
    ],
  };
  assert.deepEqual(verify({ functions: [fn] }), { ok: true });
  const ssa = promoteSlots(fn, 10000)!;
  assert.equal(ssa.blocks[1]!.parameters.length, 2);
  assert.deepEqual(
    ssa.blocks[1]!.edges[0]!.arguments,
    ssa.blocks[1]!.parameters.map((p) => p.id).reverse(),
  );
  const lowered = lowerSSA(ssa);
  assert.deepEqual(verify({ functions: [lowered] }), { ok: true });
  assert.equal(
    lowered.slots.length,
    fn.slots.length + 2,
    "loop and exit parameters for one source variable must share storage",
  );
});
test("SSA lowering rejects edges that disagree with control flow", () => {
  const ssa = promoteSlots(diamond, 10000)!;
  const blocks = ssa.blocks.map((block) =>
    block.id === 1
      ? { ...block, edges: [{ target: 2, arguments: [] }] }
      : block,
  );
  assert.throws(() => lowerSSA({ ...ssa, blocks }), /SSA edge target/);
});
test("unused slots do not create a slots-times-blocks promotion cost", () => {
  const fn: FunctionIR = {
    id: 0,
    name: "sparse",
    exported: true,
    parameters: [],
    slots: Array(100).fill("number"),
    returnType: "void",
    entry: 0,
    blocks: Array.from({ length: 100 }, (_, id) => ({
      id,
      instructions: [],
      terminator:
        id === 99
          ? { kind: "return" as const, value: undefined, ...s }
          : { kind: "jump" as const, target: id + 1, ...s },
    })),
  };
  assert.ok(promoteSlots(fn, 5000));
});

test("branch parameters coalesce only when both edge copies agree", () => {
  const fn: FunctionIR = {
    ...diamond,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "constant", id: 1, value: 7, ...s },
          { kind: "store", slot: 1, value: 1, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 0,
          consequent: 1,
          alternate: 2,
          ...s,
        },
      },
      {
        id: 1,
        instructions: [{ kind: "load", id: 2, slot: 1, ...s }],
        terminator: { kind: "return", value: 2, ...s },
      },
      {
        id: 2,
        instructions: [{ kind: "load", id: 3, slot: 1, ...s }],
        terminator: { kind: "return", value: 3, ...s },
      },
    ],
  };
  const ssa = promoteSlots(fn, 10000)!;
  const shared = lowerSSA(ssa);
  assert.ok(verify({ functions: [shared] }).ok);
  assert.equal(shared.slots.length, fn.slots.length + 1);
  assert.equal(
    shared.blocks[0]!.instructions.filter((op) => op.kind === "store").length,
    1,
    "agreeing edge copies need one store",
  );
  const conflicting = {
    ...ssa,
    valueCount: ssa.valueCount + 1,
    blocks: ssa.blocks.map((block) =>
      block.id !== 0
        ? block
        : {
            ...block,
            instructions: [
              ...block.instructions,
              { kind: "constant" as const, id: ssa.valueCount, value: 9, ...s },
            ],
            edges: block.edges.map((edge, i) =>
              i === 0 ? edge : { ...edge, arguments: [ssa.valueCount] },
            ),
          },
    ),
  };
  const distinct = lowerSSA(conflicting);
  assert.ok(verify({ functions: [distinct] }).ok);
  assert.equal(distinct.slots.length, fn.slots.length + 2);
});
test("values passed through unchanged to their own parameter storage are not re-stored", () => {
  // Slot 1 is loop-invariant: the loop header passes its parameter through
  // to itself and to the exit, which share storage with it.
  const fn: FunctionIR = {
    id: 0,
    name: "invariant",
    exported: true,
    parameters: [0],
    slots: ["boolean", "number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 7, ...s },
          { kind: "constant", id: 1, value: 0, ...s },
          { kind: "store", slot: 1, value: 0, ...s },
          { kind: "store", slot: 2, value: 1, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 2, slot: 2, ...s },
          { kind: "load", id: 3, slot: 1, ...s },
          { kind: "binary", id: 4, operator: "+", left: 2, right: 3, ...s },
          { kind: "store", slot: 2, value: 4, ...s },
          { kind: "load", id: 5, slot: 0, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 5,
          consequent: 1,
          alternate: 2,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 6, slot: 1, ...s },
          { kind: "load", id: 7, slot: 2, ...s },
          { kind: "binary", id: 8, operator: "+", left: 6, right: 7, ...s },
        ],
        terminator: { kind: "return", value: 8, ...s },
      },
    ],
  };
  assert.deepEqual(verify({ functions: [fn] }), { ok: true });
  const ssa = promoteSlots(fn, 10000)!;
  const lowered = lowerSSA(ssa);
  assert.deepEqual(verify({ functions: [lowered] }), { ok: true });
  const header = lowered.blocks[1]!;
  const loaded = new Map<number, number>();
  for (const op of header.instructions)
    if (op.kind === "load") loaded.set(op.id, op.slot);
  const stores = header.instructions.filter((op) => op.kind === "store");
  for (const op of stores)
    if (op.kind === "store")
      assert.notEqual(
        loaded.get(op.value),
        op.slot,
        "a parameter is never stored back to its own slot",
      );
  // Only the updated accumulator is stored on the loop edges.
  assert.equal(stores.length, 1);
});
test("pass-through parameters with no local uses do not emit dead loads", () => {
  const fn: FunctionIR = {
    id: 0,
    name: "passthrough",
    exported: true,
    parameters: [0],
    slots: ["boolean", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 42, ...s },
          { kind: "store", slot: 1, value: 0, ...s },
          { kind: "load", id: 1, slot: 0, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 1,
          consequent: 1,
          alternate: 2,
          ...s,
        },
      },
      {
        id: 1,
        instructions: [],
        terminator: { kind: "jump", target: 2, ...s },
      },
      {
        id: 2,
        instructions: [{ kind: "load", id: 2, slot: 1, ...s }],
        terminator: { kind: "return", value: 2, ...s },
      },
    ],
  };
  assert.deepEqual(verify({ functions: [fn] }), { ok: true });
  const ssa = promoteSlots(fn, 10000)!;
  assert.equal(ssa.blocks[1]!.parameters.length, 1);
  const lowered = lowerSSA(ssa);
  assert.deepEqual(verify({ functions: [lowered] }), { ok: true });
  assert.equal(
    lowered.blocks[1]!.instructions.length,
    0,
    "pass-through block must not materialize an unused parameter load",
  );
});
