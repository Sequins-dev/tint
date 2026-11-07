import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionIR } from "@tint/ir/scalar";
import { leafStorageRegisters } from "../src/aarch64/scalar/leaf-registers.ts";
import { signatureLayout } from "../src/aarch64/scalar/abi.ts";
const s = { start: 0, end: 0 };
const fn: FunctionIR = {
  id: 0,
  name: "permuted-leaf-pointers",
  exported: true,
  parameters: [2, 0],
  slots: ["reference", "number", "reference"],
  returnType: "reference",
  entry: 0,
  blocks: [
    {
      id: 0,
      instructions: [
        { kind: "load", id: 0, slot: 2, ...s },
        { kind: "load", id: 1, slot: 0, ...s },
        { kind: "store", slot: 2, value: 1, ...s },
      ],
      terminator: { kind: "return", value: 0, ...s },
    },
  ],
};
const offsets = [64, 72, 80],
  value = (id: number) => ({ offset: 88 + id * 8, type: "reference" as const });
test("leaf pointer homes preserve permuted incoming integer arguments", () => {
  const baseline = leafStorageRegisters(fn, offsets, value, 64, 104)!;
  const promoted = leafStorageRegisters(
    fn,
    offsets,
    value,
    64,
    104,
    1000000,
    signatureLayout(fn),
  )!;
  assert.ok(baseline.registers[8]! < 32);
  assert.equal(promoted.registers[10], 36);
  assert.equal(promoted.registers[8], 37);
  assert.ok(promoted.references![11]! >= 38 && promoted.references![11]! <= 40);
});
test("leaf pointer analysis exhaustion retains the complete existing plan", () => {
  let budget = 1;
  while (
    leafStorageRegisters(fn, offsets, value, 64, 104, budget) === undefined
  )
    budget++;
  assert.deepEqual(
    leafStorageRegisters(
      fn,
      offsets,
      value,
      64,
      104,
      budget,
      signatureLayout(fn),
    ),
    leafStorageRegisters(fn, offsets, value, 64, 104, budget),
  );
});
test("leaf private array-copy kernels retain FP pointer storage", () => {
  const copied: FunctionIR = {
    ...fn,
    slots: ["Uint8Array", "number", "Uint8Array"],
    returnType: "Uint8Array",
    blocks: [
      {
        ...fn.blocks[0]!,
        instructions: [
          { kind: "load", id: 0, slot: 2, ...s },
          { kind: "load", id: 1, slot: 0, ...s },
          { kind: "constant", id: 2, value: 0, ...s },
          {
            kind: "array-copy",
            id: 3,
            array: 0,
            source: 1,
            offset: 2,
            ...s,
          },
        ],
      },
    ],
  };
  const copiedValue = (id: number) => ({
    offset: 88 + id * 8,
    type:
      id < 2
        ? ("Uint8Array" as const)
        : id === 2
          ? ("number" as const)
          : ("boolean" as const),
  });
  assert.deepEqual(
    leafStorageRegisters(
      copied,
      offsets,
      copiedValue,
      64,
      120,
      1000000,
      signatureLayout(copied),
    ),
    leafStorageRegisters(copied, offsets, copiedValue, 64, 120),
  );
});
