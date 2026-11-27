import assert from "node:assert/strict";
import test from "node:test";
import { createNumberIndex } from "@tint/foundation/collections/key-index";
import type { FunctionIR, Instruction } from "@tint/ir/scalar";
import { temporaryRegisters } from "../src/aarch64/scalar/temporary-registers.ts";
const s = { start: 0, end: 0 };
function fixture(
  instructions: readonly Instruction[],
  returned: number,
): FunctionIR {
  return {
    id: 0,
    name: "temps",
    exported: true,
    parameters: [],
    slots: [],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions,
        terminator: { kind: "return", value: returned, ...s },
      },
    ],
  };
}
test("scalar temporaries reuse registers after their last use", () => {
  const fn = fixture(
    [
      { kind: "constant", id: 0, value: 1, ...s },
      { kind: "unary", id: 1, operator: "~", operand: 0, ...s },
      { kind: "unary", id: 2, operator: "~", operand: 1, ...s },
    ],
    2,
  );
  const registers = temporaryRegisters(fn, new Uint8Array([1, 1, 1]));
  assert.deepEqual(registers, new Uint8Array([16, 17, 16]));
});
test("values crossing calls or used by opaque operations retain stack storage", () => {
  const fn = fixture(
    [
      { kind: "constant", id: 0, value: 1, ...s },
      { kind: "call", id: 1, target: 1, arguments: [0], ...s },
      { kind: "unary", id: 2, operator: "~", operand: 0, ...s },
    ],
    2,
  );
  const registers = temporaryRegisters(fn, new Uint8Array([1, 1, 1]));
  assert.equal(registers?.[0], 0);
  assert.equal(registers?.[1], 0);
  assert.equal(registers?.[2], 16);
});
test("non-scalar values and exhausted budgets receive no register proof", () => {
  const fn = fixture([{ kind: "constant", id: 0, value: 1, ...s }], 0);
  assert.deepEqual(
    temporaryRegisters(fn, new Uint8Array([0])),
    new Uint8Array([0]),
  );
  assert.equal(temporaryRegisters(fn, new Uint8Array([1]), 0), undefined);
});

test("register pressure spills excess simultaneously live values", () => {
  const instructions: Instruction[] = [];
  for (let i = 0; i < 20; i++)
    instructions.push({ kind: "constant", id: i, value: i, ...s });
  for (let i = 0; i < 20; i++)
    instructions.push({
      kind: "unary",
      id: 20 + i,
      operator: "~",
      operand: i,
      ...s,
    });
  const registers = temporaryRegisters(
    fixture(instructions, 39),
    new Uint8Array(40).fill(1),
  );
  assert.ok(registers);
  assert.equal(registers.subarray(0, 20).filter((x) => x !== 0).length, 16);
  assert.equal(registers[16], 0);
});

test("nonleaf emission keeps eligible scalar temporaries in registers", async () => {
  const { emitModule } = await import("@tint/codegen/aarch64/scalar");
  const caller = fixture(
    [
      { kind: "call", id: undefined, target: 1, arguments: [], ...s },
      { kind: "constant", id: 0, value: 1, ...s },
      { kind: "unary", id: 1, operator: "~", operand: 0, ...s },
    ],
    1,
  );
  const callee: FunctionIR = {
    ...fixture([], 0),
    id: 1,
    name: "callee",
    returnType: "void",
    blocks: [
      {
        id: 0,
        instructions: [],
        terminator: { kind: "return", value: undefined, ...s },
      },
    ],
  };
  for (const closed of [false, true]) {
    const result = emitModule(
      { functions: [caller, callee] },
      {
        maxByteLength: 0xffffffff,
        debugSpans: false,
        linearAllocation: false,
        generationalBarriers: false,
        closedRoots: closed ? [0] : undefined,
      },
    );
    assert.ok(result.ok, JSON.stringify(result));
    const fn = result.value.functions[0]!,
      view = new DataView(result.value.code.buffer);
    let promoted = 0,
      saved = 0;
    for (
      let offset = fn.offset;
      offset < fn.offset + fn.byteLength;
      offset += 4
    ) {
      const word = view.getUint32(offset, true);
      // Only bitwise uses read the constant, so it is an integer word homed
      // in callee-saved x19: mov x19, x9 or movz x19, #1.
      if ([0xaa0903f3, 0xd2800033].includes(word)) promoted++;
      // str x19, [sp, #imm] (unsigned offset) saves the home.
      if ((word & 0xffc0001f) >>> 0 === 0xf9000013) saved++;
    }
    assert.equal(promoted, 1);
    assert.ok(saved >= 1, "x19 is saved in the prologue");
  }
});

test("compact valueIds handles sparse SSA IDs with identical plans and emitted code", async () => {
  const { emitModule } = await import("@tint/codegen/aarch64/scalar");
  const dense = fixture(
    [
      { kind: "constant", id: 0, value: 1, ...s },
      { kind: "unary", id: 1, operator: "~", operand: 0, ...s },
      { kind: "unary", id: 2, operator: "~", operand: 1, ...s },
    ],
    2,
  );
  const sparse = fixture(
    [
      { kind: "constant", id: 3_000_000, value: 1, ...s },
      { kind: "unary", id: 3_000_050, operator: "~", operand: 3_000_000, ...s },
      { kind: "unary", id: 3_000_100, operator: "~", operand: 3_000_050, ...s },
    ],
    3_000_100,
  );
  const valueIds = createNumberIndex();
  const c0 = valueIds.intern(3_000_000);
  const c1 = valueIds.intern(3_000_050);
  const c2 = valueIds.intern(3_000_100);
  const densePlan = temporaryRegisters(dense, new Uint8Array([1, 1, 1]))!;
  const sparsePlan = temporaryRegisters(
    sparse,
    new Uint8Array([1, 1, 1]),
    1_000_000,
    10,
    undefined,
    undefined,
    valueIds,
  )!;
  assert.ok(sparsePlan);
  assert.equal(sparsePlan.length, 3);
  assert.deepEqual(
    [sparsePlan[c0], sparsePlan[c1], sparsePlan[c2]],
    [densePlan[0], densePlan[1], densePlan[2]],
  );
  // Missing interned result ID returns undefined cleanly.
  assert.equal(
    temporaryRegisters(
      sparse,
      new Uint8Array([1, 1]),
      1_000_000,
      10,
      undefined,
      undefined,
      createNumberIndex(),
    ),
    undefined,
  );
  // Full emission produces byte-identical code for dense and sparse SSA IDs in
  // non-leaf bounded mode (even when raw SSA IDs exceed the 1,000,000 budget).
  const callee: FunctionIR = {
    ...fixture([], 0),
    id: 1,
    name: "callee",
    returnType: "void",
    blocks: [
      {
        id: 0,
        instructions: [],
        terminator: { kind: "return", value: undefined, ...s },
      },
    ],
  };
  const denseCaller = fixture(
    [
      { kind: "call", id: undefined, target: 1, arguments: [], ...s },
      { kind: "constant", id: 0, value: 1, ...s },
      { kind: "unary", id: 1, operator: "~", operand: 0, ...s },
    ],
    1,
  );
  const sparseCaller = fixture(
    [
      { kind: "call", id: undefined, target: 1, arguments: [], ...s },
      { kind: "constant", id: 3_000_000, value: 1, ...s },
      { kind: "unary", id: 3_000_050, operator: "~", operand: 3_000_000, ...s },
    ],
    3_000_050,
  );
  const opts = {
    maxByteLength: 0xffffffff,
    debugSpans: false,
    linearAllocation: false,
    generationalBarriers: false,
  };
  const denseEmit = emitModule({ functions: [denseCaller, callee] }, opts);
  const sparseEmit = emitModule({ functions: [sparseCaller, callee] }, opts);
  assert.ok(denseEmit.ok, JSON.stringify(denseEmit));
  assert.ok(sparseEmit.ok, JSON.stringify(sparseEmit));
  assert.deepEqual(sparseEmit.value.code, denseEmit.value.code);
});
