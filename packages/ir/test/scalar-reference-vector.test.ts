import assert from "node:assert/strict";
import test from "node:test";
import {
  verify,
  instructionMayThrow,
  visitInstructionOperands,
  instructionResult,
  type ModuleIR,
} from "../src/scalar/index.ts";
const s = { start: 0, end: 0 };
const module: ModuleIR = {
  functions: [
    {
      id: 0,
      name: "vector",
      exported: true,
      parameters: [0],
      slots: ["optional-reference"],
      returnType: "optional-reference",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "constant", id: 0, value: 2, ...s },
            { kind: "reference-vector-new", id: 1, length: 0, ...s },
            { kind: "load", id: 2, slot: 0, ...s },
            { kind: "constant", id: 3, value: 0, ...s },
            {
              kind: "reference-vector-write",
              vector: 1,
              index: 3,
              value: 2,
              ...s,
            },
            { kind: "reference-vector-length", id: 4, vector: 1, ...s },
            { kind: "reference-vector-read", id: 5, vector: 1, index: 3, ...s },
          ],
          terminator: { kind: "return", value: 5, ...s },
        },
      ],
    },
  ],
};
test("reference vector operations preserve managed result and operand contracts", () => {
  assert.equal(verify(module).ok, true);
  const ops = module.functions[0]!.blocks[0]!.instructions,
    seen: number[] = [];
  visitInstructionOperands(ops[4]!, (id) => seen.push(id));
  assert.deepEqual(seen, [1, 3, 2]);
  assert.equal(instructionResult(ops[4]!), undefined);
  assert.equal(instructionMayThrow(ops[1]!), true);
});
test("numeric payloads cannot be written as managed references", () => {
  const fn = module.functions[0]!,
    b = fn.blocks[0]!;
  const instructions = [...b.instructions];
  instructions[4] = {
    kind: "reference-vector-write",
    vector: 1,
    index: 3,
    value: 0,
    ...s,
  };
  assert.equal(
    verify({ functions: [{ ...fn, blocks: [{ ...b, instructions }] }] }).ok,
    false,
  );
});
test("vector copies take two vectors and a numeric count and produce no result", () => {
  const fn = module.functions[0]!,
    b = fn.blocks[0]!;
  const copy = {
    kind: "reference-vector-copy" as const,
    source: 1,
    target: 1,
    count: 3,
    rebase: true,
    ...s,
  };
  const instructions = [...b.instructions, copy];
  assert.equal(
    verify({ functions: [{ ...fn, blocks: [{ ...b, instructions }] }] }).ok,
    true,
  );
  const seen: number[] = [];
  visitInstructionOperands(copy, (id) => seen.push(id));
  assert.deepEqual(seen, [1, 1, 3]);
  assert.equal(instructionResult(copy), undefined);
  instructions[instructions.length - 1] = { ...copy, count: 2 };
  assert.equal(
    verify({ functions: [{ ...fn, blocks: [{ ...b, instructions }] }] }).ok,
    false,
  );
});
