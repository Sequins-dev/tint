import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionIR, Instruction, ModuleIR } from "@tint/ir/scalar";
import { temporaryRegisters } from "../src/aarch64/scalar/temporary-registers.ts";
import { numericHelper } from "../src/aarch64/scalar/numeric.ts";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import { encode } from "@tint/codegen/aarch64/isa";
const s = { start: 0, end: 0 };
test("transparent numeric kernels preserve volatile pointer homes", () => {
  for (const kind of ["to-uint32", "remainder"] as const) {
    for (const op of numericHelper(kind)) {
      const integerKeys =
        "width" in op
          ? ["rd", "rn", "rm", "rt", "rt2"]
          : op.op === "fmov-d-x"
            ? ["rn"]
            : op.op === "fmov-x-d" || op.op === "fcvtzs-x-d"
              ? ["rd"]
              : [];
      for (const key of integerKeys) {
        const register = (op as unknown as Record<string, unknown>)[key];
        assert.ok(
          typeof register !== "number" || register < 4 || register > 8,
          kind + " clobbers a pointer home: " + JSON.stringify(op),
        );
      }
    }
  }
});
function fn(
  instructions: readonly Instruction[],
  returned: number,
): FunctionIR {
  return {
    id: 0,
    name: "reference-temporaries",
    exported: true,
    parameters: [0],
    slots: ["reference"],
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
test("short-lived reference payloads stay in registers until their final checked read", () => {
  const f = fn(
    [
      { kind: "load", id: 0, slot: 0, ...s },
      { kind: "record-read", id: 1, object: 0, record: 0, field: 0, ...s },
      { kind: "record-read", id: 2, object: 1, record: 0, field: 1, ...s },
    ],
    2,
  );
  const plan = temporaryRegisters(f, new Uint8Array([2, 2, 1]));
  assert.ok(plan);
  assert.notEqual(plan[0], 0);
  assert.notEqual(plan[1], 0);
  assert.notEqual(plan[0], plan[1]);
  assert.ok(plan[0]! >= 36 && plan[0]! <= 40);
  assert.ok(plan[1]! >= 36 && plan[1]! <= 40);
});
test("references crossing allocations or consumed by calls retain root storage", () => {
  for (const op of [
    { kind: "record-new", id: 1, record: 0, arguments: [], ...s },
    { kind: "call", id: undefined, target: 1, arguments: [0], ...s },
  ] as const) {
    const f = fn(
      [
        { kind: "load", id: 0, slot: 0, ...s },
        op,
        { kind: "record-read", id: 2, object: 0, record: 0, field: 1, ...s },
      ],
      2,
    );
    assert.equal(temporaryRegisters(f, new Uint8Array([2, 0, 1]))?.[0], 0);
  }
});
test("reference temporaries never displace the numeric register allocation", () => {
  const ops: Instruction[] = [];
  for (let id = 0; id < 20; id++)
    ops.push({ kind: "constant", id, value: id, ...s });
  ops.push(
    { kind: "load", id: 20, slot: 0, ...s },
    { kind: "store", slot: 0, value: 20, ...s },
  );
  for (let id = 0; id < 20; id++)
    ops.push({ kind: "unary", id: 21 + id, operator: "~", operand: id, ...s });
  const f = fn(ops, 40),
    numeric = new Uint8Array(41).fill(1);
  numeric[20] = 0;
  const before = temporaryRegisters(f, numeric)!;
  numeric[20] = 2;
  const after = temporaryRegisters(f, numeric)!;
  for (let id = 0; id < 41; id++)
    if (id !== 20) assert.equal(after[id], before[id]);
  assert.ok(after[20]! >= 36 && after[20]! <= 40);
});
test("reference pressure uses only the five volatile integer homes", () => {
  const instructions: Instruction[] = [];
  for (let id = 0; id < 6; id++)
    instructions.push({ kind: "load", id, slot: 0, ...s });
  for (let id = 0; id < 6; id++)
    instructions.push({ kind: "store", slot: 0, value: id, ...s });
  instructions.push({ kind: "constant", id: 6, value: 42, ...s });
  const plan = temporaryRegisters(
    fn(instructions, 6),
    new Uint8Array([2, 2, 2, 2, 2, 2, 1]),
  )!;
  assert.deepEqual([...plan.slice(0, 6)], [36, 37, 38, 39, 40, 0]);
});
test("block-local pointer homes do not leak into later opaque temporaries", () => {
  const caller: FunctionIR = {
    ...fn([], 0),
    returnType: "reference",
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "reference-wrap", id: 1, value: 0, ...s },
          { kind: "reference-value", id: 2, value: 1, ...s },
          { kind: "store", slot: 0, value: 2, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 3, slot: 0, ...s },
          { kind: "call", id: 4, target: 1, arguments: [3], ...s },
        ],
        terminator: { kind: "return", value: 4, ...s },
      },
    ],
  };
  const identity: FunctionIR = {
    ...fn([{ kind: "load", id: 0, slot: 0, ...s }], 0),
    id: 1,
    name: "identity",
    exported: false,
    returnType: "reference",
  };
  const result = emitModule(
    { functions: [caller, identity] },
    { closedRoots: [0] },
  );
  assert.ok(result.ok, JSON.stringify(result));
  // The slot reaches x4 directly: from its frame word, or from its register
  // home (x28) when it has one.
  const load = encode({ op: "ldr", width: 64, rt: 4, rn: "sp", offset: 48 }),
    move = encode({ op: "orr-reg", width: 64, rd: 4, rn: "zr", rm: 28 });
  assert.ok(load.ok && move.ok);
  const body = result.value.functions[0]!,
    view = new DataView(result.value.code.buffer);
  let directLoads = 0;
  for (
    let offset = body.offset;
    offset < body.offset + body.byteLength;
    offset += 4
  )
    if (
      view.getUint32(offset, true) === load.value ||
      view.getUint32(offset, true) === move.value
    )
      directLoads++;
  // Block 1 re-reads the slot into x4 rather than trusting block 0's x4
  // (with a register home, block 0's own load is a move from x28 too).
  assert.ok(directLoads >= 1);
});
test("reference analysis budget fallback retains the original numeric plan", () => {
  const f = fn(
    [
      { kind: "constant", id: 0, value: 1, ...s },
      { kind: "unary", id: 1, operator: "~", operand: 0, ...s },
      { kind: "load", id: 2, slot: 0, ...s },
      { kind: "store", slot: 0, value: 2, ...s },
    ],
    1,
  );
  let bound = 1;
  while (temporaryRegisters(f, new Uint8Array([1, 1, 0]), bound) === undefined)
    bound++;
  const before = temporaryRegisters(f, new Uint8Array([1, 1, 0]), bound)!;
  const after = temporaryRegisters(f, new Uint8Array([1, 1, 2]), bound)!;
  assert.deepEqual(after, before);
  assert.notEqual(
    temporaryRegisters(f, new Uint8Array([1, 1, 2]), 10000)?.[2],
    0,
  );
});

test("managed frames omit only references proven dead before every safepoint", async () => {
  const { emitModule } = await import("@tint/codegen/aarch64/scalar");
  for (const allocating of [false, true]) {
    const instructions: Instruction[] = [
      { kind: "load", id: 0, slot: 0, ...s },
    ];
    if (allocating)
      instructions.push({
        kind: "record-new",
        id: 1,
        record: 0,
        arguments: [0],
        ...s,
      });
    instructions.push(
      { kind: "reference-wrap", id: 2, value: 0, ...s },
      { kind: "reference-value", id: 3, value: 2, ...s },
      { kind: "store", slot: 0, value: 3, ...s },
      { kind: "constant", id: 4, value: 42, ...s },
    );
    const module: ModuleIR = {
      records: [
        {
          byteLength: 32,
          fields: [{ offset: 16, type: "reference", mutable: false }],
        },
      ],
      functions: [fn(instructions, 4)],
    };
    const result = emitModule(module, { aliasSlotLoads: false });
    assert.ok(result.ok, JSON.stringify(result));
    const roots = result.value.roots[0]!;
    assert.ok(roots);
    assert.equal(roots.offsets.length, allocating ? 3 : 1);
    // The load of slot 0 is last used before the store that replaces it, so
    // with aliasing it reads the slot word in place and needs no root of its own.
    const aliased = emitModule(module);
    assert.ok(aliased.ok, JSON.stringify(aliased));
    assert.equal(aliased.value.roots[0]!.offsets.length, allocating ? 2 : 1);
  }
});

test("slot words stored before the first collection skip the prologue zero", async () => {
  const { emitModule } = await import("@tint/codegen/aarch64/scalar");
  // Slot 1 is stored from the parameter before the allocation, so no
  // collection can observe its uninitialized frame word.
  const module: ModuleIR = {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "reference", mutable: false }],
      },
    ],
    functions: [
      {
        ...fn([], 3),
        slots: ["reference", "reference"],
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...s },
              { kind: "store", slot: 1, value: 0, ...s },
              { kind: "record-new", id: 1, record: 0, arguments: [0], ...s },
              { kind: "load", id: 2, slot: 1, ...s },
              { kind: "store", slot: 0, value: 1, ...s },
              { kind: "constant", id: 3, value: 42, ...s },
            ],
            terminator: { kind: "return", value: 3, ...s },
          },
        ],
      },
    ],
  };
  function zeroWords(prologueSlotProof: boolean): number {
    const result = emitModule(module, { prologueSlotProof });
    assert.ok(result.ok, JSON.stringify(result));
    const code = result.value.code,
      view = new DataView(code.buffer, code.byteOffset, code.byteLength);
    let words = 0;
    for (let at = 0; at < code.byteLength; at += 4) {
      const word = view.getUint32(at, true);
      // STR XZR, [SP, #imm] and STP XZR, XZR, [SP, #imm].
      if ((word & 0xffc003ff) >>> 0 === 0xf90003ff) words += 1;
      else if ((word & 0xffc07fff) >>> 0 === 0xa9007fff) words += 2;
    }
    return words;
  }
  assert.equal(zeroWords(true), zeroWords(false) - 1);
});

test("references cross calls in word registers only when no safepoint intervenes", async () => {
  const { temporaryRegisters } =
    await import("../src/aarch64/scalar/temporary-registers.ts");
  const block = (instructions: Instruction[]): FunctionIR => ({
    ...fn([], 0),
    returnType: "void",
    blocks: [
      {
        id: 0,
        instructions,
        terminator: { kind: "return", value: undefined, ...s },
      },
    ],
  });
  // Target 1 never collects, target 2 does.
  const collects = (op: Instruction): boolean =>
    (op.kind === "call" && op.target === 2) || op.kind === "record-new";
  // v0 lives across a non-collecting call: promoted to a word register.
  const quiet = block([
    { kind: "load", id: 0, slot: 0, ...s },
    { kind: "call", id: undefined, target: 1, arguments: [], ...s },
    { kind: "call", id: undefined, target: 1, arguments: [0], ...s },
  ]);
  const promoted = temporaryRegisters(
    quiet,
    new Uint8Array([2]),
    100000,
    3,
    collects,
  );
  assert.ok(promoted);
  assert.ok((promoted[0] ?? 0) >= 32 + 19 && (promoted[0] ?? 0) <= 32 + 21);
  // A use after a collecting call keeps the value in a root home.
  const crossing = block([
    { kind: "load", id: 0, slot: 0, ...s },
    { kind: "call", id: undefined, target: 2, arguments: [0], ...s },
    { kind: "call", id: undefined, target: 1, arguments: [0], ...s },
  ]);
  assert.equal(
    temporaryRegisters(crossing, new Uint8Array([2]), 100000, 3, collects)?.[0],
    0,
  );
  // Allocations read their operands after allocating (and maybe collecting).
  const allocating = block([
    { kind: "load", id: 0, slot: 0, ...s },
    { kind: "call", id: undefined, target: 1, arguments: [], ...s },
    { kind: "record-new", id: 1, record: 0, arguments: [0], ...s },
  ]);
  assert.equal(
    temporaryRegisters(
      allocating,
      new Uint8Array([2, 0]),
      100000,
      3,
      collects,
    )?.[0],
    0,
  );
});
