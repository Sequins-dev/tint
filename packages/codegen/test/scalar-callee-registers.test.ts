import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionIR, ModuleIR } from "@tint/ir/scalar";
import { calleeSavedSlots } from "../src/aarch64/scalar/callee-registers.ts";
const s = { start: 0, end: 0 };
const fn: FunctionIR = {
  id: 0,
  name: "caller",
  exported: true,
  parameters: [0, 1],
  slots: ["number", "reference", "boolean"],
  returnType: "number",
  entry: 0,
  blocks: [
    {
      id: 0,
      instructions: [
        { kind: "load", id: 0, slot: 0, ...s },
        { kind: "load", id: 1, slot: 1, ...s },
        { kind: "call", id: undefined, target: 1, arguments: [], ...s },
        { kind: "load", id: 2, slot: 0, ...s },
        { kind: "load", id: 3, slot: 1, ...s },
      ],
      terminator: { kind: "return", value: 2, ...s },
    },
  ],
};
test("callee-saved plans retain only repeatedly used unboxed scalar slots", () => {
  const plan = calleeSavedSlots(fn);
  assert.ok(plan);
  assert.equal(plan.count, 1);
  assert.deepEqual([...plan.registers], [8, 0, 0]);
});
test("address-exposed numeric slots and exhausted budgets keep stack storage", () => {
  const block = fn.blocks[0]!;
  assert.equal(
    calleeSavedSlots({
      ...fn,
      blocks: [
        {
          ...block,
          terminator: {
            kind: "cell",
            cell: 0,
            operation: "write",
            slot: 0,
            consequent: 0,
            alternate: 0,
            ...s,
          },
        },
      ],
    }),
    undefined,
  );
  assert.equal(calleeSavedSlots(fn, 0), undefined);
});
test("emission saves and restores the scalar register bank around calls", async () => {
  const { emitModule } = await import("@tint/codegen/aarch64/scalar");
  const { encode } = await import("@tint/codegen/aarch64/isa");
  const callee: FunctionIR = {
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
        terminator: { kind: "return", value: undefined, ...s },
      },
    ],
  };
  const module: ModuleIR = { functions: [fn, callee] };
  const result = emitModule(module, {
    maxByteLength: 0xffffffff,
    debugSpans: false,
    linearAllocation: false,
    generationalBarriers: false,
    closedRoots: [0],
  });
  assert.ok(result.ok);
  const move = encode({ op: "fmov-d-d", rd: 8, rn: 0 });
  assert.ok(move.ok);
  const view = new DataView(result.value.code.buffer),
    first = result.value.functions[0]!;
  const saves = new Map<number, number>(),
    restores = new Map<number, number>();
  let saved = 0,
    restored = 0,
    moved = 0,
    exits = 0;
  for (
    let offset = first.offset;
    offset < first.offset + first.byteLength;
    offset += 4
  ) {
    const value = view.getUint32(offset, true);
    if (value === move.value) moved++;
    if (value === 0xd65f03c0) exits++;
    if ((value & 0xffc003ff) >>> 0 === 0xfd0003e8) {
      saved++;
      const offset = (value >>> 10) & 4095;
      saves.set(offset, (saves.get(offset) ?? 0) + 1);
    }
    if ((value & 0xffc003ff) >>> 0 === 0xfd4003e8) {
      restored++;
      const offset = (value >>> 10) & 4095;
      restores.set(offset, (restores.get(offset) ?? 0) + 1);
    }
  }
  assert.ok(moved >= 1, "the parameter enters its preserved FP register");
  assert.ok(saved >= 1);
  assert.equal(restores.size, 1);
  for (const offset of restores.keys()) assert.equal(saves.get(offset), 1);
  assert.ok(exits > 0);
  // The prologue's stack-overflow exit returns before any callee save.
  assert.equal(restored, exits - 1);
});
test("function unwind rules locate each preserved FP register at its save slot", async () => {
  const { emitModule } = await import("@tint/codegen/aarch64/scalar");
  const callee: FunctionIR = {
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
        terminator: { kind: "return", value: undefined, ...s },
      },
    ],
  };
  const result = emitModule(
    { functions: [fn, callee] },
    {
      maxByteLength: 0xffffffff,
      debugSpans: false,
      linearAllocation: false,
      generationalBarriers: false,
      closedRoots: [0],
    },
  );
  assert.ok(result.ok);
  const [caller, leaf] = result.value.functions;
  assert.ok(caller !== undefined && leaf !== undefined);
  const view = new DataView(result.value.code.buffer);
  // str d<n>, [sp, #imm*8]: the stored register and its sp-relative slot.
  const stored = new Map<number, number>();
  for (
    let offset = caller.offset;
    offset < caller.offset + caller.byteLength;
    offset += 4
  ) {
    const value = view.getUint32(offset, true);
    if ((value & 0xffc003e0) >>> 0 === 0xfd0003e0)
      stored.set(value & 31, ((value >>> 10) & 4095) * 8);
  }
  assert.ok(stored.size >= 1);
  const rule = caller.unwind;
  assert.ok(rule !== undefined && rule.kind === "frame");
  // CFA = fp + 16 and sp = fp - frameBytes.
  assert.deepEqual(
    [...rule.saves].sort((a, b) => a.register - b.register),
    [...stored]
      .sort(([a], [b]) => a - b)
      .map(([register, slot]) => ({
        register: 64 + register,
        offset: slot - caller.frameBytes - 16,
      })),
  );
  assert.deepEqual(leaf.unwind, { kind: "frame", saves: [] });
});
