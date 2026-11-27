import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionIR } from "@tint/ir/scalar";
import {
  canUseLeafRegisters,
  leafStorageRegisters,
} from "../src/aarch64/scalar/leaf-registers.ts";
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

test("aligned inline cell writes and initializations do not expose local addresses", () => {
  const block = fn.blocks[0]!;
  const writing = (operation: "write" | "initialize", valueOffset: number) =>
    canUseLeafRegisters({
      ...fn,
      environment: {
        byteLength: 24,
        cells: [{ type: "number", stateOffset: 0, valueOffset, mutable: true }],
      },
      blocks: [
        {
          ...block,
          terminator: {
            kind: "cell",
            cell: 0,
            operation,
            slot: 0,
            consequent: 0,
            alternate: 0,
            ...s,
          },
        },
      ],
    });
  assert.equal(writing("write", 8), true);
  assert.equal(writing("initialize", 8), true);
  // Misaligned cells go through the generic helper, which takes the
  // transfer slot's frame address.
  assert.equal(writing("write", 9), false);
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

test("general numeric equality reads payloads from their planned leaf storage", async () => {
  const { emitModule } = await import("../src/aarch64/scalar/index.ts");
  const emitted = emitModule(
    {
      functions: [
        {
          ...fn,
          slots: ["general", "general"],
          parameters: [0, 1],
          returnType: "boolean",
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...s },
                { kind: "load", id: 1, slot: 1, ...s },
                { kind: "general-equal", id: 2, left: 0, right: 1, ...s },
              ],
              terminator: { kind: "return", value: 2, ...s },
            },
          ],
        },
      ],
    },
    { closedRoots: [0] },
  );
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const body = emitted.value.functions[0]!;
  const view = new DataView(emitted.value.code.buffer);
  const words = Array.from({ length: body.byteLength / 4 }, (_, index) =>
    view.getUint32(body.offset + index * 4, true),
  );
  assert.ok(
    words.some((word) => (word & 0xfffffc00) >>> 0 === 0x1e604000),
    "leaf frame words are promoted to FP storage",
  );
  assert.equal(
    words.filter((word) => (word & 0xffc003e0) >>> 0 === 0xfd4003e0).length,
    0,
    "numeric equality must not read stale stack payloads after promotion",
  );
});

test("leafStorageRegisters prioritizes loop-carried integer slots over SSA temps and prologue params", () => {
  // 10 straight-line integer params (slots 0..9, each loaded 3x in entry block)
  // plus 1 loop-carried integer slot (slot 10, accessed once per read/write in loop)
  // plus 12 loop-local integer SSA temps (ids 100..111, each used 3x in loop).
  const slots: ("number" | "boolean")[] = [];
  const params: number[] = [];
  const entryOps: FunctionIR["blocks"][number]["instructions"][number][] = [];
  for (let i = 0; i < 10; i++) {
    slots.push("number");
    params.push(i);
    entryOps.push({ kind: "load", id: i * 3, slot: i, ...s });
    entryOps.push({ kind: "load", id: i * 3 + 1, slot: i, ...s });
    entryOps.push({ kind: "load", id: i * 3 + 2, slot: i, ...s });
  }
  slots.push("number"); // slot 10: loop-carried index
  const loopOps: FunctionIR["blocks"][number]["instructions"][number][] = [
    { kind: "load", id: 50, slot: 10, ...s },
  ];
  let prev = 50;
  for (let t = 0; t < 12; t++) {
    const id = 100 + t;
    loopOps.push({
      kind: "binary",
      id,
      operator: "+",
      left: prev,
      right: prev,
      ...s,
    });
    prev = id;
  }
  loopOps.push({ kind: "store", slot: 10, value: prev, ...s });
  loopOps.push({ kind: "constant", id: 200, value: true, ...s });
  const loopFn: FunctionIR = {
    id: 0,
    name: "loop_priority",
    exported: true,
    slots,
    parameters: params,
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: entryOps,
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 1,
        instructions: loopOps,
        terminator: {
          kind: "branch",
          condition: 200,
          consequent: 1,
          alternate: 2,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [{ kind: "load", id: 201, slot: 10, ...s }],
        terminator: { kind: "return", value: 201, ...s },
      },
    ],
  };
  const slotOffsets = slots.map((_, i) => i * 8);
  const valueBase = slots.length * 8;
  const value = (id: number) => ({
    offset: valueBase + id * 8,
    type: "number" as const,
  });
  const lastByte = valueBase + 205 * 8;
  const integerWords = new Uint8Array(lastByte / 8);
  integerWords.fill(1);
  const plan = leafStorageRegisters(
    loopFn,
    slotOffsets,
    value,
    0,
    lastByte,
    1000000,
    undefined,
    integerWords,
  );
  assert.ok(plan);
  // Slot 10 (loop-carried integer slot) MUST receive a GP home (>= 32), not FP.
  assert.ok(
    (plan.registers[10] ?? 0) >= 32,
    `expected loop-carried slot 10 in GP home, got ${plan.registers[10]}`,
  );
});

test("spilled float constants and float slot stores stay in the FP domain (no GP<->FP STLF)", async () => {
  const { emitModule } = await import("@tint/codegen/aarch64/scalar");
  const { encode } = await import("@tint/codegen/aarch64/isa");
  // Non-leaf function with 8 hot float params filling d8..d15 and a call
  // between constant and store so the constant and slots 8..9 are stack-backed.
  const slots: "number"[] = Array.from({ length: 10 }, () => "number");
  const params = Array.from({ length: 8 }, (_, i) => i);
  const ops: FunctionIR["blocks"][number]["instructions"][number][] = [];
  for (let i = 0; i < 8; i++) {
    ops.push({ kind: "load", id: 10 + i * 2, slot: i, ...s });
    ops.push({ kind: "load", id: 11 + i * 2, slot: i, ...s });
    ops.push({
      kind: "binary",
      id: 30 + i,
      operator: "+",
      left: 10 + i * 2,
      right: 11 + i * 2,
      ...s,
    });
    ops.push({ kind: "store", slot: i, value: 30 + i, ...s });
  }
  ops.push(
    { kind: "constant", id: 0, value: 1.5, ...s },
    { kind: "call", id: undefined, target: 1, arguments: [], ...s },
    { kind: "store", slot: 8, value: 0, ...s },
    { kind: "load", id: 1, slot: 8, ...s },
    { kind: "call", id: undefined, target: 1, arguments: [], ...s },
    { kind: "store", slot: 9, value: 1, ...s },
    { kind: "load", id: 2, slot: 9, ...s },
    { kind: "binary", id: 3, operator: "+", left: 1, right: 2, ...s },
  );
  let acc = 3;
  for (let i = 0; i < 8; i++) {
    ops.push({ kind: "load", id: 50 + i, slot: i, ...s });
    ops.push({
      kind: "binary",
      id: 60 + i,
      operator: "+",
      left: acc,
      right: 50 + i,
      ...s,
    });
    acc = 60 + i;
  }
  const emitted = emitModule({
    functions: [
      {
        id: 0,
        name: "spilled_fp",
        exported: true,
        slots,
        parameters: params,
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: ops,
            terminator: { kind: "return", value: acc, ...s },
          },
        ],
      },
      {
        id: 1,
        name: "nop",
        exported: false,
        slots: [],
        parameters: [],
        returnType: "void",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [],
            terminator: { kind: "return", value: undefined, ...s },
          },
        ],
      },
    ],
  });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const fmovImm = encode({ op: "fmov-d-imm", rd: 0, imm8: 0x78 }); // 1.5
  assert.ok(fmovImm.ok);
  const body = emitted.value.functions[0]!;
  const view = new DataView(emitted.value.code.buffer);
  const words = Array.from({ length: body.byteLength / 4 }, (_, index) =>
    view.getUint32(body.offset + index * 4, true),
  );
  assert.ok(
    words.includes(fmovImm.value),
    "spilled float64 immediate 1.5 should materialize via fmov d0, #imm instead of GP mov+str",
  );
  assert.ok(
    words.some((word) => (word & 0xffc003ff) >>> 0 === 0xfd0003e0),
    "spilled float constant/store should emit str d0, [sp, #off]",
  );
  assert.ok(
    words.some((word) => (word & 0xffc003ff) >>> 0 === 0xfd4003e0),
    "spilled float store should load source via ldr d0, [sp, #off]",
  );
});
