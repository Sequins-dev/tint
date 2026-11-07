import assert from "node:assert/strict";
import test from "node:test";
import { emitModule } from "../src/aarch64/scalar/index.ts";
import type { ModuleIR, Instruction } from "@tint/ir/scalar";

const span = { start: 0, end: 0 };
function fixture(operator: string): ModuleIR {
  return {
    functions: [
      {
        id: 0,
        name: "numeric",
        exported: true,
        parameters: [0, 1],
        slots: ["number", "number"],
        returnType: ["+", "-", "*", "/"].includes(operator)
          ? "number"
          : "boolean",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "load", id: 1, slot: 1, ...span },
              { kind: "binary", id: 2, operator, left: 0, right: 1, ...span },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
    ],
  };
}
test("numeric ALU instructions consume resident FP operands directly", () => {
  for (const [operator, opcode] of [
    ["+", 0x1e602800],
    ["-", 0x1e603800],
    ["*", 0x1e600800],
    ["/", 0x1e601800],
  ] as const) {
    const output = emitModule(fixture(operator));
    assert.ok(output.ok, JSON.stringify(output));
    const view = new DataView(output.value.code.buffer);
    const words: number[] = [];
    for (let offset = 0; offset < output.value.code.length; offset += 4) {
      const word = view.getUint32(offset, true);
      if ((word & 0xffe0fc00) >>> 0 === opcode) words.push(word);
    }
    assert.equal(words.length, 1, operator);
    assert.ok(((words[0]! >>> 5) & 31) >= 8, operator + " left operand");
    assert.ok(((words[0]! >>> 16) & 31) >= 8, operator + " right operand");
  }
});
test("numeric comparisons consume resident FP operands directly", () => {
  for (const operator of ["===", "!==", "==", "!=", "<", "<=", ">", ">="]) {
    const output = emitModule(fixture(operator));
    assert.ok(output.ok, JSON.stringify(output));
    const view = new DataView(output.value.code.buffer);
    const words: number[] = [];
    for (let offset = 0; offset < output.value.code.length; offset += 4) {
      const word = view.getUint32(offset, true);
      if ((word & 0xffe0fc1f) >>> 0 === 0x1e602000) words.push(word);
    }
    assert.equal(words.length, 1, operator);
    assert.ok(((words[0]! >>> 5) & 31) >= 8, operator + " left operand");
    assert.ok(((words[0]! >>> 16) & 31) >= 8, operator + " right operand");
  }
});
test("register pressure preserves scratch loads for spilled numeric operands", () => {
  const instructions: Instruction[] = [];
  for (let id = 0; id < 32; id++)
    instructions.push({ kind: "load", id, slot: id, ...span });
  let sum = 0;
  for (let id = 1; id < 32; id++) {
    instructions.push({
      kind: "binary",
      id: id + 31,
      operator: "+",
      left: sum,
      right: id,
      ...span,
    });
    sum = id + 31;
  }
  const input = fixture("+");
  const fn = input.functions[0]!;
  const output = emitModule({
    functions: [
      {
        ...fn,
        parameters: Array.from({ length: 32 }, (_, id) => id),
        slots: Array.from({ length: 32 }, () => "number" as const),
        blocks: [
          {
            id: 0,
            instructions,
            terminator: { kind: "return", value: sum, ...span },
          },
        ],
      },
    ],
  });
  assert.ok(output.ok, JSON.stringify(output));
  const view = new DataView(output.value.code.buffer);
  let adds = 0,
    scratchOperands = 0;
  for (let offset = 0; offset < output.value.code.length; offset += 4) {
    const word = view.getUint32(offset, true);
    if ((word & 0xffe0fc00) >>> 0 !== 0x1e602800) continue;
    adds++;
    if (((word >>> 5) & 31) < 8 || ((word >>> 16) & 31) < 8) scratchOperands++;
  }
  assert.equal(adds, 31);
  assert.ok(scratchOperands > 0);
});
