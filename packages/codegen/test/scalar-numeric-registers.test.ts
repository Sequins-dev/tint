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
test("doubles whose uses want integers keep FP homes instead of GP round trips", () => {
  // ((a + b) + c) | 0 over unproven doubles: both sums feed an integer use,
  // but each is computed by FADD, so a GP home only adds bank moves.
  const output = emitModule({
    functions: [
      {
        id: 0,
        name: "sum",
        exported: true,
        parameters: [0, 1, 2],
        slots: ["number", "number", "number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              // A call keeps this out of leaf register allocation.
              {
                kind: "call",
                id: undefined,
                target: 1,
                arguments: [],
                ...span,
              },
              { kind: "load", id: 0, slot: 0, ...span },
              { kind: "load", id: 1, slot: 1, ...span },
              { kind: "load", id: 2, slot: 2, ...span },
              {
                kind: "binary",
                id: 3,
                operator: "+",
                left: 0,
                right: 1,
                ...span,
              },
              {
                kind: "binary",
                id: 4,
                operator: "+",
                left: 3,
                right: 2,
                ...span,
              },
              { kind: "constant", id: 5, value: 0, ...span },
              {
                kind: "binary",
                id: 6,
                operator: "|",
                left: 4,
                right: 5,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 6, ...span },
          },
        ],
      },
      {
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
      },
    ],
  });
  assert.ok(output.ok, JSON.stringify(output));
  const view = new DataView(output.value.code.buffer);
  let fadds = 0;
  const moves: number[] = [];
  for (let offset = 0; offset < output.value.code.length; offset += 4) {
    const word = view.getUint32(offset, true);
    if ((word & 0xffe0fc00) >>> 0 === 0x1e602800) fadds++;
    // FMOV Xd, Dn into the word temporaries x19..x28.
    if ((word & 0xfffffc00) >>> 0 === 0x9e660000 && (word & 31) >= 19)
      moves.push(word);
  }
  assert.equal(fadds, 2);
  assert.deepEqual(moves, []);
});

test("safepoint-free innermost loop hoists TypedArray data pointer, imul constant, and FP constant to preheader", () => {
  const output = emitModule({
    functions: [
      {
        id: 0,
        name: "hoistLoop",
        exported: true,
        parameters: [0, 1],
        slots: ["Float64Array", "number", "number", "number", "number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 0, ...span },
              { kind: "store", slot: 2, value: 0, ...span },
              { kind: "store", slot: 3, value: 0, ...span },
              { kind: "constant", id: 1, value: 1, ...span },
              { kind: "store", slot: 4, value: 1, ...span },
            ],
            terminator: { kind: "jump", target: 1, ...span },
          },
          {
            id: 1,
            instructions: [
              { kind: "load", id: 2, slot: 2, ...span },
              { kind: "load", id: 3, slot: 1, ...span },
              {
                kind: "binary",
                id: 4,
                operator: "<",
                left: 2,
                right: 3,
                ...span,
              },
            ],
            terminator: {
              kind: "branch",
              condition: 4,
              consequent: 2,
              alternate: 3,
              ...span,
            },
          },
          {
            id: 2,
            instructions: [
              { kind: "load", id: 5, slot: 0, ...span },
              { kind: "load", id: 6, slot: 2, ...span },
              { kind: "array-element", id: 7, array: 5, index: 6, ...span },
              { kind: "constant", id: 8, value: 0.25, ...span },
              {
                kind: "binary",
                id: 9,
                operator: "*",
                left: 7,
                right: 8,
                ...span,
              },
              { kind: "load", id: 10, slot: 3, ...span },
              {
                kind: "binary",
                id: 11,
                operator: "+",
                left: 10,
                right: 9,
                ...span,
              },
              { kind: "store", slot: 3, value: 11, ...span },
              { kind: "load", id: 12, slot: 4, ...span },
              { kind: "constant", id: 13, value: 0x2c1b3c6d, ...span },
              {
                kind: "binary",
                id: 14,
                operator: "imul",
                left: 12,
                right: 13,
                ...span,
              },
              { kind: "store", slot: 4, value: 14, ...span },
              { kind: "constant", id: 15, value: 1, ...span },
              {
                kind: "binary",
                id: 16,
                operator: "+",
                left: 6,
                right: 15,
                ...span,
              },
              { kind: "store", slot: 2, value: 16, ...span },
            ],
            terminator: { kind: "jump", target: 1, ...span },
          },
          {
            id: 3,
            instructions: [
              { kind: "load", id: 17, slot: 3, ...span },
              { kind: "load", id: 18, slot: 4, ...span },
              {
                kind: "binary",
                id: 19,
                operator: "+",
                left: 17,
                right: 18,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 19, ...span },
          },
        ],
      },
    ],
  });
  assert.ok(output.ok, JSON.stringify(output));
  const view = new DataView(output.value.code.buffer);
  let hoistedArrayLdr = 0;
  let hoistedFmulD3 = 0;
  let hoistedImulReg = 0;
  for (let offset = 0; offset < output.value.code.length; offset += 4) {
    const word = view.getUint32(offset, true);
    // LDR Dt, [Xn, Xm, lsl #3] where Xn is x4..x8 (0xfc607800 mask 0xffe0fc00)
    if (
      (word & 0xffe0fc00) >>> 0 === 0xfc607800 &&
      ((word >>> 5) & 31) >= 4 &&
      ((word >>> 5) & 31) <= 8
    )
      hoistedArrayLdr++;
    // FMUL Dd, Dn, Dm where Dm is d3..d7
    if (
      (word & 0xffe0fc00) >>> 0 === 0x1e600800 &&
      ((word >>> 16) & 31) >= 3 &&
      ((word >>> 16) & 31) <= 7
    )
      hoistedFmulD3++;
    // MADD Wd, Wn, Wm, WZR (0x1b007c00 mask 0xffe0fc00) where Wm is w4..w8
    if (
      (word & 0xffe0fc00) >>> 0 === 0x1b007c00 &&
      ((word >>> 16) & 31) >= 4 &&
      ((word >>> 16) & 31) <= 8
    )
      hoistedImulReg++;
  }
  assert.equal(
    hoistedArrayLdr,
    1,
    "expected hoisted TypedArray data pointer in x4..x8",
  );
  assert.equal(hoistedFmulD3, 1, "expected hoisted FP constant 0.25 in d3..d7");
  assert.equal(hoistedImulReg, 1, "expected hoisted imul constant in w4..w8");
});

test("loop with a call safepoint does not hoist raw TypedArray data pointer", () => {
  const output = emitModule({
    functions: [
      {
        id: 0,
        name: "safepointLoop",
        exported: true,
        parameters: [0, 1],
        slots: ["Float64Array", "number", "number", "number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 0, ...span },
              { kind: "store", slot: 2, value: 0, ...span },
              { kind: "store", slot: 3, value: 0, ...span },
            ],
            terminator: { kind: "jump", target: 1, ...span },
          },
          {
            id: 1,
            instructions: [
              { kind: "load", id: 1, slot: 2, ...span },
              { kind: "load", id: 2, slot: 1, ...span },
              {
                kind: "binary",
                id: 3,
                operator: "<",
                left: 1,
                right: 2,
                ...span,
              },
            ],
            terminator: {
              kind: "branch",
              condition: 3,
              consequent: 2,
              alternate: 3,
              ...span,
            },
          },
          {
            id: 2,
            instructions: [
              { kind: "call", id: 4, target: 1, arguments: [], ...span },
              { kind: "load", id: 5, slot: 0, ...span },
              { kind: "load", id: 6, slot: 2, ...span },
              { kind: "array-element", id: 7, array: 5, index: 6, ...span },
              { kind: "load", id: 8, slot: 3, ...span },
              {
                kind: "binary",
                id: 9,
                operator: "+",
                left: 8,
                right: 7,
                ...span,
              },
              { kind: "store", slot: 3, value: 9, ...span },
              { kind: "constant", id: 10, value: 1, ...span },
              {
                kind: "binary",
                id: 11,
                operator: "+",
                left: 6,
                right: 10,
                ...span,
              },
              { kind: "store", slot: 2, value: 11, ...span },
            ],
            terminator: { kind: "jump", target: 1, ...span },
          },
          {
            id: 3,
            instructions: [{ kind: "load", id: 12, slot: 3, ...span }],
            terminator: { kind: "return", value: 12, ...span },
          },
        ],
      },
      {
        id: 1,
        name: "callee",
        exported: false,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "constant", id: 0, value: 1, ...span }],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      },
    ],
  });
  assert.ok(output.ok, JSON.stringify(output));
  const view = new DataView(output.value.code.buffer);
  let hoistedArrayLdr = 0;
  for (let offset = 0; offset < output.value.code.length; offset += 4) {
    const word = view.getUint32(offset, true);
    if (
      (word & 0xffe0fc00) >>> 0 === 0xfc607800 &&
      ((word >>> 5) & 31) >= 4 &&
      ((word >>> 5) & 31) <= 8
    )
      hoistedArrayLdr++;
  }
  assert.equal(
    hoistedArrayLdr,
    0,
    "must never hoist raw backing pointer across safepoint",
  );
});
