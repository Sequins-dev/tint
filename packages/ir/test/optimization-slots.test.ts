import assert from "node:assert/strict";
import test from "node:test";
import { compactSlots } from "../src/optimization/slots.ts";
import { optimizeModule } from "../src/optimization/index.ts";
import { verify, type FunctionIR } from "@tint/ir/scalar";
const s = { start: 0, end: 0 };
const base: FunctionIR = {
  id: 0,
  name: "slots",
  exported: true,
  parameters: [2],
  slots: ["boolean", "reference", "number", "general"],
  returnType: "number",
  entry: 0,
  blocks: [
    {
      id: 0,
      instructions: [{ kind: "load", id: 0, slot: 2, ...s }],
      terminator: { kind: "return", value: 0, ...s },
    },
  ],
};
test("final optimization compacts unused slot declarations without changing the parameter ABI", () => {
  const result = optimizeModule({ functions: [base] });
  assert.deepEqual(verify(result.module), { ok: true });
  assert.deepEqual(result.module.functions[0]!.slots, ["number"]);
  assert.deepEqual(result.module.functions[0]!.parameters, [0]);
  assert.deepEqual(base.parameters, [2]);
});

test("slot compaction keeps unused ABI parameters in their original argument order", () => {
  const fn = { ...base, parameters: [2, 0] };
  const result = compactSlots(fn, 1000)!;
  assert.deepEqual(result.fn.slots, ["boolean", "number"]);
  assert.deepEqual(result.fn.parameters, [1, 0]);
  assert.deepEqual(verify({ functions: [result.fn] }), { ok: true });
  assert.equal(compactSlots(fn, result.visited - 1), undefined);
  assert.deepEqual(fn.slots, base.slots);
});

test("slot compaction remaps guarded transfers and exception destinations", () => {
  const fn: FunctionIR = {
    ...base,
    parameters: [1],
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 1, ...s }],
        exception: { target: 2, slot: 3 },
        terminator: {
          kind: "record",
          object: 0,
          record: 0,
          field: 0,
          operation: "read",
          slot: 2,
          consequent: 1,
          alternate: 2,
          ...s,
        },
      },
      {
        id: 1,
        instructions: [{ kind: "load", id: 1, slot: 2, ...s }],
        terminator: { kind: "return", value: 1, ...s },
      },
      { id: 2, instructions: [], terminator: { kind: "trap", ...s } },
    ],
  };
  const records = [
    {
      byteLength: 32,
      fields: [{ offset: 16, type: "number" as const, mutable: true }],
    },
  ];
  assert.deepEqual(verify({ functions: [fn], records }), { ok: true });
  const result = compactSlots(fn, 1000)!;
  assert.deepEqual(result.fn.slots, ["reference", "number", "general"]);
  assert.deepEqual(result.fn.blocks[0]!.exception, { target: 2, slot: 2 });
  assert.equal(result.fn.blocks[0]!.terminator.kind, "record");
  if (result.fn.blocks[0]!.terminator.kind === "record")
    assert.equal(result.fn.blocks[0]!.terminator.slot, 1);
  assert.deepEqual(verify({ functions: [result.fn], records }), { ok: true });
  assert.equal(compactSlots(result.fn, 1000)!.fn, result.fn);
});

test("slot compaction remaps integer slot facts and drops removed slots", () => {
  const fn: FunctionIR = {
    ...base,
    parameters: [],
    slots: ["number", "number", "number"],
    integerSlots: [0, 2],
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 1, ...s },
          { kind: "store", slot: 2, value: 0, ...s },
          { kind: "load", id: 1, slot: 2, ...s },
        ],
        terminator: { kind: "return", value: 1, ...s },
      },
    ],
  };
  assert.deepEqual(verify({ functions: [fn] }), { ok: true });
  const result = compactSlots(fn, 1000)!;
  assert.deepEqual(result.fn.slots, ["number"]);
  assert.deepEqual(result.fn.integerSlots, [0]);
  assert.deepEqual(verify({ functions: [result.fn] }), { ok: true });
});

test("the verifier rejects integer slot facts on non-number or parameter slots", () => {
  for (const integerSlots of [[1], [2], [0, 0], [9]]) {
    const fn: FunctionIR = { ...base, integerSlots };
    assert.equal(verify({ functions: [fn] }).ok, false, String(integerSlots));
  }
});
