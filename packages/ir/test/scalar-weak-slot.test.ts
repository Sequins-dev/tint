import assert from "node:assert/strict";
import test from "node:test";
import {
  verify,
  instructionMayThrow,
  instructionEffects,
  effectAllocate,
  effectEscape,
  effectReadHeap,
  effectWriteHeap,
  visitInstructionOperands,
  instructionResult,
  substituteInstructionValues,
  type ModuleIR,
} from "../src/scalar/index.ts";
const span = { start: 0, end: 0 };
const module: ModuleIR = {
  functions: [
    {
      id: 0,
      name: "weak",
      exported: true,
      parameters: [0, 1, 2],
      slots: ["general", "general", "boolean"],
      returnType: "general",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "load", id: 0, slot: 0, ...span },
            { kind: "load", id: 1, slot: 1, ...span },
            { kind: "load", id: 2, slot: 2, ...span },
            {
              kind: "weak-slot-new",
              id: 3,
              key: 0,
              value: 1,
              ephemeron: 2,
              ...span,
            },
            { kind: "weak-slot-key", id: 4, cell: 3, ...span },
            { kind: "weak-slot-value", id: 5, cell: 3, ...span },
            { kind: "weak-slot-set-value", cell: 3, value: 1, ...span },
            { kind: "weak-slot-clear", cell: 3, ...span },
          ],
          terminator: { kind: "return", value: 4, ...span },
        },
      ],
    },
  ],
};
test("weak cells use general handles and participate in operand, effect and substitution contracts", () => {
  assert.equal(verify(module).ok, true);
  const ops = module.functions[0]!.blocks[0]!.instructions;
  const seen: number[] = [];
  visitInstructionOperands(ops[3]!, (id) => seen.push(id));
  assert.deepEqual(seen, [0, 1, 2]);
  assert.equal(instructionMayThrow(ops[3]!), true);
  assert.ok(instructionEffects(ops[3]!) & effectAllocate);
  assert.ok(instructionEffects(ops[3]!) & effectEscape);
  assert.equal(instructionEffects(ops[4]!), effectReadHeap);
  assert.equal(instructionEffects(ops[6]!), effectWriteHeap | effectEscape);
  assert.equal(instructionResult(ops[6]!), undefined);
  assert.equal(instructionResult(ops[7]!), undefined);
  const replacements = new Uint32Array([11, 12, 13, 14]);
  assert.deepEqual(substituteInstructionValues(ops[3]!, replacements), {
    kind: "weak-slot-new",
    id: 3,
    key: 10,
    value: 11,
    ephemeron: 12,
    ...span,
  });
  assert.deepEqual(substituteInstructionValues(ops[6]!, replacements), {
    kind: "weak-slot-set-value",
    cell: 13,
    value: 11,
    ...span,
  });
  assert.deepEqual(substituteInstructionValues(ops[7]!, replacements), {
    kind: "weak-slot-clear",
    cell: 13,
    ...span,
  });
});
test("weak cell operands cannot silently reinterpret numbers, booleans or raw references", () => {
  const fn = module.functions[0]!,
    block = fn.blocks[0]!;
  for (const index of [0, 1, 2]) {
    const slots = [...fn.slots];
    slots[index] = index === 2 ? "number" : "reference";
    assert.equal(verify({ functions: [{ ...fn, slots }] }).ok, false);
  }
  const instructions = [...block.instructions];
  instructions[6] = { kind: "weak-slot-set-value", cell: 3, value: 2, ...span };
  assert.equal(
    verify({ functions: [{ ...fn, blocks: [{ ...block, instructions }] }] }).ok,
    false,
  );
});
test("weak binding authorization validates exact signatures and rejects duplicates", async () => {
  const scalar = await import("../src/scalar/index.ts");
  assert.equal(typeof scalar.bindWeakOperations, "function");
  const fn = module.functions[0]!;
  const bound = scalar.bindWeakOperations(module, [
    { function: 0, operation: "new" },
  ]);
  assert.ok(bound.ok);
  if (bound.ok) assert.equal(verify(bound.value).ok, true);
  assert.equal(
    scalar.bindWeakOperations(module, [{ function: 0, operation: "key" }]).ok,
    false,
  );
  assert.equal(
    scalar.bindWeakOperations(module, [
      { function: 0, operation: "new" },
      { function: 0, operation: "new" },
    ]).ok,
    false,
  );
  assert.equal(
    scalar.bindWeakOperations(
      { functions: [{ ...fn, slots: ["general", "number", "boolean"] }] },
      [{ function: 0, operation: "new" }],
    ).ok,
    false,
  );
});
