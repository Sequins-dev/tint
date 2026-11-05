import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionIR } from "@tint/ir/scalar";
import { canUseLeafRegisters } from "../src/aarch64/scalar/leaf-registers.ts";
const s = { start: 0, end: 0 };
const fn: FunctionIR = {
  id: 0,
  name: "f",
  exported: true,
  slots: ["number", "reference", "general"],
  parameters: [0, 1],
  returnType: "number",
  entry: 0,
  blocks: [
    {
      id: 0,
      instructions: [
        { kind: "load", id: 0, slot: 0, ...s },
        { kind: "load", id: 1, slot: 1, ...s },
      ],
      terminator: { kind: "return", value: 0, ...s },
    },
  ],
};
test("calls and address-exposed cell transfer slots retain stack storage", () => {
  const block = fn.blocks[0]!;
  assert.equal(
    canUseLeafRegisters({
      ...fn,
      blocks: [
        {
          ...block,
          instructions: [
            ...block.instructions,
            { kind: "call", id: undefined, target: 0, arguments: [], ...s },
          ],
        },
      ],
    }),
    false,
  );
  assert.equal(
    canUseLeafRegisters({
      ...fn,
      blocks: [
        {
          ...block,
          terminator: {
            kind: "cell",
            cell: 0,
            operation: "read",
            slot: 0,
            consequent: 0,
            alternate: 0,
            ...s,
          },
        },
      ],
    }),
    false,
  );
});
test("closed leaf code uses volatile FP registers for scalar locals", async () => {
  const { emitModule } = await import("@tint/codegen/aarch64/scalar");
  const { encode } = await import("@tint/codegen/aarch64/isa");
  const module = {
    functions: [
      {
        ...fn,
        slots: ["number" as const],
        parameters: [0],
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "load" as const, id: 0, slot: 0, ...s }],
            terminator: { kind: "return" as const, value: 0, ...s },
          },
        ],
      },
    ],
  };
  const output = emitModule(module, {
    maxByteLength: 0xffffffff,
    debugSpans: false,
    linearAllocation: false,
    generationalBarriers: false,
    closedRoots: [0],
  });
  assert.ok(output.ok);
  const move = encode({ op: "fmov-d-d", rd: 16, rn: 0 });
  assert.ok(move.ok);
  const view = new DataView(output.value.code.buffer);
  const words = Array.from(
    { length: output.value.code.length / 4 },
    (_, index) => view.getUint32(index * 4, true),
  );
  assert.ok(
    words.includes(move.value),
    "parameter should enter d16 rather than a stack slot",
  );
});

test("private leaf helpers preserve the register-storage bank", async () => {
  const { numericHelper } = await import("../src/aarch64/scalar/numeric.ts");
  const { stringHelper } = await import("../src/aarch64/scalar/strings.ts");
  const { rememberedBarrier } =
    await import("../src/aarch64/scalar/barrier.ts");
  const helpers = [
    numericHelper("to-uint32"),
    numericHelper("remainder"),
    stringHelper("string-equal"),
    stringHelper("string-starts-with"),
    stringHelper("string-code-unit"),
    rememberedBarrier(),
  ];
  for (const body of helpers)
    for (const instruction of body) {
      if (instruction.op === "ldr-d") assert.ok(instruction.rt < 16);
      if (
        "rd" in instruction &&
        (instruction.op.startsWith("f") ||
          instruction.op.startsWith("scvtf") ||
          instruction.op.startsWith("ucvtf")) &&
        instruction.op !== "fmov-x-d" &&
        !instruction.op.startsWith("fcvt")
      )
        assert.ok(
          typeof instruction.rd === "number" && instruction.rd < 16,
          JSON.stringify(instruction),
        );
      assert.ok(
        instruction.op !== "bl" && instruction.op !== "blr",
        "private helpers must not make arbitrary calls",
      );
    }
});

test("aligned inline cell reads do not expose local addresses", () => {
  const block = fn.blocks[0]!;
  const reading: FunctionIR = {
    ...fn,
    environment: {
      byteLength: 24,
      cells: [
        { type: "number", stateOffset: 0, valueOffset: 8, mutable: true },
      ],
    },
    blocks: [
      {
        ...block,
        terminator: {
          kind: "cell",
          cell: 0,
          operation: "read",
          slot: 0,
          consequent: 0,
          alternate: 0,
          ...s,
        },
      },
    ],
  };
  assert.equal(canUseLeafRegisters(reading), true);
  assert.equal(
    canUseLeafRegisters({
      ...reading,
      environment: {
        byteLength: 24,
        cells: [
          { type: "number", stateOffset: 0, valueOffset: 9, mutable: true },
        ],
      },
    }),
    false,
  );
});

test("reusable leaf code can promote slots without a closed-world type proof", async () => {
  const { emitModule } = await import("@tint/codegen/aarch64/scalar");
  const { encode } = await import("@tint/codegen/aarch64/isa");
  const emitted = emitModule({
    functions: [
      {
        ...fn,
        slots: ["number"],
        parameters: [0],
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
            terminator: { kind: "return", value: 0, ...s },
          },
        ],
      },
    ],
  });
  assert.ok(emitted.ok);
  const move = encode({ op: "fmov-d-d", rd: 16, rn: 0 });
  assert.ok(move.ok);
  const view = new DataView(emitted.value.code.buffer);
  const words = Array.from(
    { length: emitted.value.code.length / 4 },
    (_, index) => view.getUint32(index * 4, true),
  );
  assert.ok(words.includes(move.value));
});
