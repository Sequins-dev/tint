import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verify,
  instructionEffects,
  instructionMayThrow,
  visitInstructionOperands,
  substituteInstructionValues,
  provenDirectOnlyFunctions,
  type ModuleIR,
  type Instruction,
  type FunctionIR,
} from "../src/scalar/index.ts";
import {
  pruneClosedModule,
  optimizeModule,
} from "../src/optimization/index.ts";
const span = { start: 0, end: 0 };
function fixture(part: "entry" | "signature" = "entry"): ModuleIR {
  return {
    functions: [
      {
        id: 0,
        name: "dead",
        exported: false,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "constant", id: 0, value: 0, ...span }],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      },
      {
        id: 1,
        name: "target",
        exported: false,
        parameters: [0],
        slots: ["number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      },
      {
        id: 2,
        name: "address",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "function-address", id: 0, target: 1, part, ...span },
            ],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      },
    ],
  };
}
test("static function addresses define effect-free numbers without value operands", () => {
  for (const part of ["entry", "signature"] as const) {
    const module = fixture(part);
    assert.ok(verify(module).ok, JSON.stringify(verify(module)));
    const op = module.functions[2]!.blocks[0]!.instructions[0]!;
    assert.equal(instructionEffects(op), 0);
    assert.equal(instructionMayThrow(op), false);
    const operands: number[] = [];
    visitInstructionOperands(op, (id) => operands.push(id));
    assert.deepEqual(operands, []);
    assert.deepEqual(
      substituteInstructionValues(op, new Uint32Array([0, 100])),
      op,
    );
    assert.equal(provenDirectOnlyFunctions(module, [2])?.[1], 0);
  }
});
test("address-only references retain and renumber their target during pruning", () => {
  const original = fixture();
  const pruned = pruneClosedModule(original, [2]);
  assert.ok(pruned);
  assert.equal(pruned.removedFunctions, 1);
  assert.equal(pruned.module.functions.length, 2);
  assert.equal(pruned.module.functions[0]?.name, "target");
  const op = pruned.module.functions[1]!.blocks[0]!.instructions[0]!;
  assert.equal(op.kind, "function-address");
  if (op.kind === "function-address") assert.equal(op.target, 0);
  assert.ok(verify(pruned.module).ok);
  const optimized = optimizeModule(original);
  assert.ok(verify(optimized.module).ok);
  assert.ok(
    optimized.module.functions[2]?.blocks[0]?.instructions.some(
      (op) => op.kind === "function-address",
    ),
  );
});
test("function addresses reject unknown, imported and environment-bearing targets", () => {
  const original = fixture();
  const target = original.functions[1]!;
  const denied: FunctionIR[] = [
    { ...target, environment: { byteLength: 0, cells: [] } },
    { ...target, closureEnvironment: 0 },
    { ...target, receiverSlot: 1, slots: ["number", "general"] },
    { ...target, import: true, blocks: [] },
  ];
  for (const altered of denied) {
    const module: ModuleIR = {
      ...original,
      records: [{ byteLength: 16, fields: [] }],
      functions: [original.functions[0]!, altered, original.functions[2]!],
    };
    const withoutAddress: ModuleIR = {
      ...module,
      functions: [
        module.functions[0]!,
        altered,
        {
          ...module.functions[2]!,
          blocks: [
            {
              id: 0,
              instructions: [{ kind: "constant", id: 0, value: 0, ...span }],
              terminator: { kind: "return", value: 0, ...span },
            },
          ],
        },
      ],
    };
    assert.ok(
      verify(withoutAddress).ok,
      JSON.stringify(verify(withoutAddress)),
    );
    const invalid = verify(module);
    assert.equal(invalid.ok, false);
    if (!invalid.ok)
      assert.match(
        invalid.error.message,
        altered.import === true
          ? /imports have no local address/
          : /target must be environment-free/,
      );
  }
  const op: Instruction = {
    kind: "function-address",
    id: 0,
    target: 999,
    part: "entry",
    ...span,
  };
  const address = original.functions[2]!;
  assert.equal(
    verify({
      ...original,
      functions: [
        original.functions[0]!,
        target,
        { ...address, blocks: [{ ...address.blocks[0]!, instructions: [op] }] },
      ],
    }).ok,
    false,
  );
});
