import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionIR, ModuleIR } from "@tint/ir/scalar";
import { slotHomes } from "../src/aarch64/scalar/slot-registers.ts";
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
const references = {
  eligible: (slot: number): boolean => fn.slots[slot] === "reference",
  collects: (op: { readonly kind: string }): boolean => op.kind === "call",
};
test("slot homes keep repeatedly used slots, charging references their spills", () => {
  const plan = slotHomes(fn, new Uint8Array(3), undefined, [28], references);
  assert.ok(plan);
  // The number slot takes d8. The reference slot's two loads are worth no
  // more than the store and reload its liveness across the call would cost.
  assert.equal(plan.floatCount, 1);
  assert.deepEqual([...plan.registers], [8, 0, 0]);
  assert.deepEqual(plan.saved, []);
});
test("address-exposed slots keep stack storage; exhausted budgets plan nothing", () => {
  const block = fn.blocks[0]!;
  const plan = slotHomes(
    {
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
    },
    new Uint8Array(3),
    undefined,
    [28],
    references,
  );
  assert.ok(plan);
  assert.equal(plan.registers[0], 0);
  assert.equal(
    slotHomes(fn, new Uint8Array(3), undefined, [28], references, 0),
    undefined,
  );
});
test("loop-carried references take GP homes and spill only across safepoints", () => {
  // b0: s1 = param; b1 (loop): x = load s1; call when s2; store s1 = x;
  // branch back. The call is a safepoint with s1 live after it.
  const loop: FunctionIR = {
    id: 0,
    name: "loop",
    exported: true,
    parameters: [0, 2],
    slots: ["reference", "reference", "boolean"],
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "store", slot: 1, value: 0, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 1, slot: 1, ...s },
          { kind: "load", id: 2, slot: 1, ...s },
          { kind: "store", slot: 1, value: 2, ...s },
          { kind: "load", id: 3, slot: 2, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 3,
          consequent: 2,
          alternate: 3,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "call", id: undefined, target: 1, arguments: [], ...s },
          { kind: "load", id: 4, slot: 1, ...s },
          { kind: "store", slot: 1, value: 4, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 3,
        instructions: [],
        terminator: { kind: "return", value: undefined, ...s },
      },
    ],
  };
  const plan = slotHomes(loop, new Uint8Array(3), undefined, [28, 27], {
    eligible: (slot) => loop.slots[slot] === "reference",
    collects: (op) => op.kind === "call",
  });
  assert.ok(plan);
  assert.equal(plan.registers[1], 32 + 28);
  // Spilled around the call (block 2, instruction 0) only.
  assert.deepEqual(plan.spills[2]?.[0], [1]);
  assert.equal(plan.spills[1], undefined);
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
  // FP saves (DWARF 64 + n); GP slot homes add their own save rules.
  assert.deepEqual(
    [...rule.saves]
      .filter((save) => save.register >= 64)
      .sort((a, b) => a.register - b.register),
    [...stored]
      .sort(([a], [b]) => a - b)
      .map(([register, slot]) => ({
        register: 64 + register,
        offset: slot - caller.frameBytes - 16,
      })),
  );
  assert.deepEqual(leaf.unwind, { kind: "frame", saves: [] });
});
/** Boolean slots (GP homes) of one block ending in a return of `result`. */
function booleans(
  slots: number,
  parameters: number[],
  instructions: FunctionIR["blocks"][number]["instructions"],
  result: number,
): FunctionIR {
  const types: FunctionIR["slots"][number][] = [];
  for (let slot = 0; slot < slots; slot++) types.push("boolean");
  return {
    id: 0,
    name: "sharing",
    exported: true,
    parameters,
    slots: types,
    returnType: "boolean",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions,
        terminator: { kind: "return", value: result, ...s },
      },
    ],
  };
}
test("slots whose live ranges never meet share one register home", () => {
  // s0 -> s1 -> s2 copies: each dies where the next is written.
  const plan = slotHomes(
    booleans(
      4,
      [3],
      [
        { kind: "load", id: 0, slot: 3, ...s },
        { kind: "store", slot: 0, value: 0, ...s },
        { kind: "load", id: 1, slot: 0, ...s },
        { kind: "store", slot: 1, value: 1, ...s },
        { kind: "load", id: 2, slot: 1, ...s },
        { kind: "store", slot: 2, value: 2, ...s },
        { kind: "load", id: 3, slot: 2, ...s },
      ],
      3,
    ),
    new Uint8Array(4),
    undefined,
    [28, 27],
    undefined,
  );
  assert.ok(plan);
  assert.deepEqual([...plan.registers], [60, 60, 60, 0]);
  assert.deepEqual(plan.saved, [28]);
  assert.equal(plan.shared, true);
});
test("a loaded value keeps its slot's home until the value's last use", () => {
  // id1 (loaded from s0) is used after s1 is written: a load may alias
  // its slot's home, so s0 and s1 must not share.
  const plan = slotHomes(
    booleans(
      4,
      [3],
      [
        { kind: "load", id: 0, slot: 3, ...s },
        { kind: "store", slot: 0, value: 0, ...s },
        { kind: "load", id: 1, slot: 0, ...s },
        { kind: "store", slot: 1, value: 0, ...s },
        { kind: "load", id: 2, slot: 1, ...s },
        { kind: "store", slot: 2, value: 1, ...s },
        { kind: "load", id: 3, slot: 2, ...s },
      ],
      3,
    ),
    new Uint8Array(4),
    undefined,
    [28, 27],
    undefined,
  );
  assert.ok(plan);
  assert.notEqual(plan.registers[0], 0);
  assert.notEqual(plan.registers[1], 0);
  assert.notEqual(plan.registers[0], plan.registers[1]);
});
test("parameters and slots read before any store interfere at entry", () => {
  // s1 is read before it is written (its home starts as zero) while the
  // prologue writes parameter s0: they never meet at a store, only at entry.
  const plan = slotHomes(
    booleans(
      3,
      [0],
      [
        { kind: "load", id: 0, slot: 1, ...s },
        { kind: "load", id: 1, slot: 0, ...s },
        { kind: "load", id: 2, slot: 0, ...s },
        { kind: "store", slot: 2, value: 1, ...s },
        { kind: "load", id: 3, slot: 2, ...s },
        { kind: "store", slot: 1, value: 2, ...s },
        { kind: "load", id: 4, slot: 1, ...s },
      ],
      4,
    ),
    new Uint8Array(3),
    undefined,
    [28, 27],
    undefined,
  );
  assert.ok(plan);
  assert.notEqual(plan.registers[0], 0);
  assert.notEqual(plan.registers[1], 0);
  assert.notEqual(plan.registers[0], plan.registers[1]);
});
test("slots live into a handler interfere throughout the protected block", () => {
  // s0 is live into the handler (block 1), so a throw anywhere in block 0
  // reads it: s1, written before s0's store there, must not share its home.
  const fn: FunctionIR = {
    ...booleans(
      3,
      [0],
      [
        { kind: "load", id: 0, slot: 0, ...s },
        { kind: "store", slot: 1, value: 0, ...s },
        { kind: "load", id: 1, slot: 1, ...s },
        { kind: "load", id: 2, slot: 1, ...s },
        { kind: "store", slot: 0, value: 1, ...s },
        { kind: "load", id: 3, slot: 0, ...s },
      ],
      3,
    ),
    slots: ["boolean", "boolean", "boolean", "general"],
  };
  const entry = fn.blocks[0]!;
  const protectedFn: FunctionIR = {
    ...fn,
    blocks: [
      { ...entry, exception: { target: 1, slot: 3 } },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 4, slot: 0, ...s },
          { kind: "store", slot: 2, value: 4, ...s },
          { kind: "load", id: 5, slot: 2, ...s },
        ],
        terminator: { kind: "return", value: 5, ...s },
      },
    ],
  };
  const plan = slotHomes(
    protectedFn,
    new Uint8Array(4),
    undefined,
    [28, 27],
    undefined,
  );
  assert.ok(plan);
  assert.notEqual(plan.registers[0], 0);
  assert.notEqual(plan.registers[1], 0);
  assert.notEqual(plan.registers[0], plan.registers[1]);
});
