import assert from "node:assert/strict";
import test from "node:test";
import type { Block, FunctionIR, ModuleIR } from "@tint/ir/scalar";
import { emitModule } from "../src/aarch64/scalar/index.ts";
import { recordDispatchChains } from "../src/aarch64/scalar/record-dispatch.ts";
const s = { start: 0, end: 0 };
const field = (offset: number) => ({
  byteLength: 32,
  fields: [{ offset, type: "number" as const, mutable: false }],
});
const records = [field(16), field(16), field(16), field(24)];
/** A chain whose candidates all read field 0 at one offset. */
function oneGroup(candidates: number[], failure: number) {
  return {
    records: candidates,
    groups: [{ records: candidates, record: candidates[0], field: 0 }],
    failure,
  };
}
function candidate(
  id: number,
  record: number,
  alternate: number,
  consequent = 4,
): Block {
  return {
    id,
    instructions: [{ kind: "load", id, slot: 0, ...s }],
    terminator: {
      kind: "record",
      object: id,
      record,
      field: 0,
      operation: "read",
      slot: 1,
      consequent,
      alternate,
      ...s,
    },
  };
}
function chain(
  second: Block = candidate(1, 1, 2),
  third: Block = candidate(2, 2, 3),
  head: Block = candidate(0, 0, 1),
): FunctionIR {
  return {
    id: 0,
    name: "read",
    exported: true,
    parameters: [0],
    slots: ["reference", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      head,
      second,
      third,
      { id: 3, instructions: [], terminator: { kind: "trap", ...s } },
      {
        id: 4,
        instructions: [{ kind: "load", id: 4, slot: 1, ...s }],
        terminator: { kind: "return", value: 4, ...s },
      },
    ],
  };
}
test("union field reads with one placement fuse into one shared read", () => {
  const plan = recordDispatchChains(chain(), records, () => true);
  assert.ok(plan);
  assert.deepEqual([...plan.chains], [[0, oneGroup([0, 1, 2], 3)]]);
  assert.deepEqual([...plan.fused], [0, 1, 1, 0, 0]);
});
test("differently placed fields fuse into one test and read per offset", () => {
  const placed = recordDispatchChains(
    chain(candidate(1, 3, 2), candidate(2, 1, 3)),
    records,
    () => true,
  );
  assert.deepEqual(
    [...placed!.chains],
    [
      [
        0,
        {
          records: [0, 3, 1],
          groups: [
            { records: [0, 1], record: 0, field: 0 },
            { records: [3], record: 3, field: 0 },
          ],
          failure: 3,
        },
      ],
    ],
  );
  assert.deepEqual([...placed!.fused], [0, 1, 1, 0, 0]);
  // Both placements emit verified code that reads each offset.
  const emitted = emitModule({
    records,
    functions: [chain(candidate(1, 3, 2), candidate(2, 1, 3))],
  });
  assert.ok(emitted.ok);
});
test("dispatch fusion stops at any candidate that cannot share the read", () => {
  // A different continuation, an unguarded head, a second predecessor or a
  // store to the object slot after its load keep the original guards.
  const unfused = (fn: FunctionIR, guarded = true) => {
    const plan = recordDispatchChains(fn, records, () => guarded);
    assert.equal(plan!.chains.size, 0);
    assert.ok(plan!.fused.every((value) => value === 0));
  };
  unfused(chain(candidate(1, 1, 2, 3)));
  unfused(chain(), false);
  // A second predecessor keeps block 1 out of block 0's chain; block 1 then
  // heads its own chain with block 2.
  const shared = chain();
  const rejoined = recordDispatchChains(
    {
      ...shared,
      blocks: shared.blocks.map((block) =>
        block?.id === 4
          ? { ...block, terminator: { kind: "jump" as const, target: 1, ...s } }
          : block!,
      ),
    },
    records,
    () => true,
  );
  assert.deepEqual([...rejoined!.chains], [[1, oneGroup([1, 2], 3)]]);
  assert.deepEqual([...rejoined!.fused], [0, 0, 1, 0, 0]);
  // A store to the object slot after the head's load also keeps block 0
  // unfused; block 1 may still head its own chain.
  const head = candidate(0, 0, 1);
  const stored = recordDispatchChains(
    chain(undefined, undefined, {
      ...head,
      instructions: [
        ...head.instructions,
        { kind: "store", slot: 0, value: 0, ...s },
      ],
    }),
    records,
    () => true,
  );
  assert.equal(stored!.chains.has(0), false);
  assert.equal(stored!.fused[1], 0);
});
test("fused dispatch emits verified code smaller than the guard chain", () => {
  const emit = (fn: FunctionIR) => {
    const module: ModuleIR = { records, functions: [fn] };
    const emitted = emitModule(module);
    assert.ok(emitted.ok, JSON.stringify(emitted));
    return emitted.value.code.length;
  };
  // The broken chain keeps its last candidate as a separate guarded block.
  assert.ok(
    emit(chain()) < emit(chain(candidate(1, 1, 2), candidate(2, 3, 3))),
  );
});
test("continuations reloading a copy of the head's object still fuse", () => {
  // The head reads its parameter slot but first copies the object into a
  // second slot, which every continuation reloads (lowering's usual shape).
  const copy = (id: number, record: number, alternate: number): Block => ({
    id,
    instructions: [{ kind: "load", id, slot: 2, ...s }],
    terminator: {
      kind: "record",
      object: id,
      record,
      field: 0,
      operation: "read",
      slot: 1,
      consequent: 4,
      alternate,
      ...s,
    },
  });
  const head: Block = {
    id: 0,
    instructions: [
      { kind: "load", id: 0, slot: 0, ...s },
      { kind: "store", slot: 2, value: 0, ...s },
    ],
    terminator: {
      kind: "record",
      object: 0,
      record: 0,
      field: 0,
      operation: "read",
      slot: 1,
      consequent: 4,
      alternate: 1,
      ...s,
    },
  };
  const fn = chain(copy(1, 1, 2), copy(2, 2, 3), head);
  const plan = recordDispatchChains(
    { ...fn, slots: ["reference", "number", "reference"] },
    records,
    () => true,
  );
  assert.ok(plan);
  assert.deepEqual([...plan.chains], [[0, oneGroup([0, 1, 2], 3)]]);
  // A later store of another value into the copy breaks the alias.
  const clobbered: Block = {
    ...head,
    instructions: [
      ...head.instructions,
      { kind: "constant", id: 9, value: 0, ...s },
      { kind: "store", slot: 2, value: 9, ...s },
    ],
  };
  const broken = recordDispatchChains(
    {
      ...chain(copy(1, 1, 2), copy(2, 2, 3), clobbered),
      slots: ["reference", "number", "reference"],
    },
    records,
    () => true,
  );
  assert.equal(broken!.chains.has(0), false);
  assert.equal(broken!.fused[1], 0);
});
test("a later head absorbs an earlier-visited head's fused chain", () => {
  // Block 1 heads its own chain (1 -> 2) when visited; block 4 (visited later)
  // copies the object into slot 2 and reaches block 1 as a continuation.
  const reload = (id: number, record: number, alternate: number): Block => ({
    id,
    instructions: [{ kind: "load", id, slot: 2, ...s }],
    terminator: {
      kind: "record",
      object: id,
      record,
      field: 0,
      operation: "read",
      slot: 1,
      consequent: 5,
      alternate,
      ...s,
    },
  });
  const fn: FunctionIR = {
    id: 0,
    name: "read",
    exported: true,
    parameters: [0],
    slots: ["reference", "number", "reference"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [],
        terminator: { kind: "jump", target: 4, ...s },
      },
      reload(1, 1, 2),
      reload(2, 2, 3),
      { id: 3, instructions: [], terminator: { kind: "trap", ...s } },
      {
        id: 4,
        instructions: [
          { kind: "load", id: 4, slot: 0, ...s },
          { kind: "store", slot: 2, value: 4, ...s },
        ],
        terminator: {
          kind: "record",
          object: 4,
          record: 0,
          field: 0,
          operation: "read",
          slot: 1,
          consequent: 5,
          alternate: 1,
          ...s,
        },
      },
      {
        id: 5,
        instructions: [{ kind: "load", id: 5, slot: 1, ...s }],
        terminator: { kind: "return", value: 5, ...s },
      },
    ],
  };
  const plan = recordDispatchChains(fn, records, () => true);
  assert.ok(plan);
  assert.deepEqual([...plan.chains], [[4, oneGroup([0, 1, 2], 3)]]);
  assert.deepEqual([...plan.fused], [0, 1, 1, 0, 0, 0]);
});
test("long fused chains test membership with one bitset lookup", () => {
  // Twelve layouts with the field in one place, then a trap.
  const many = Array.from({ length: 13 }, () => field(16));
  const blocks: Block[] = [];
  for (let index = 0; index < 12; index++)
    blocks.push(candidate(index, index, index + 1, 13));
  blocks.push({ id: 12, instructions: [], terminator: { kind: "trap", ...s } });
  blocks.push({
    id: 13,
    instructions: [{ kind: "load", id: 13, slot: 1, ...s }],
    terminator: { kind: "return", value: 13, ...s },
  });
  const fn: FunctionIR = {
    id: 0,
    name: "read",
    exported: true,
    parameters: [0],
    slots: ["reference", "number"],
    returnType: "number",
    entry: 0,
    blocks,
  };
  const plan = recordDispatchChains(fn, many, () => true);
  assert.equal(plan?.chains.get(0)?.records.length, 12);
  const emitted = emitModule({ records: many, functions: [fn] });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const code = emitted.value.code;
  const view = new DataView(code.buffer, code.byteOffset);
  const own = emitted.value.functions[0]!;
  const words = Array.from({ length: own.byteLength / 4 }, (_, index) =>
    view.getUint32(own.offset + index * 4, true),
  );
  // The candidate set has a dispatch family: one LDR of the descriptor's
  // family word replaces the indexed bitset byte, and the chain no longer
  // compares the descriptor against each of the twelve layouts.
  assert.equal(
    words.filter((word) => (word & 0xffc00000) >>> 0 === 0x39400000).length,
    0,
  );
  assert.equal(
    words.filter((word) => word === 0xf940018c).length,
    1,
    "ldr x12, [x12]",
  );
  const compares = words.filter(
    (word) => (word & 0xff20001f) >>> 0 === 0xeb00001f,
  ).length;
  assert.ok(compares < 6, `descriptor comparisons: ${compares}`);
  // Each descriptor is preceded by its record index, and below that by its
  // family words: family 0 holds exactly the twelve candidates.
  for (const descriptor of emitted.value.records) {
    assert.equal(
      Number(view.getBigUint64(descriptor.offset - 8, true)),
      descriptor.record,
    );
    assert.equal(
      view.getBigUint64(descriptor.offset - 16, true),
      descriptor.record < 12 ? 1n : 0n,
    );
    assert.equal(view.getBigUint64(descriptor.offset - 24, true), 0n);
  }
});
