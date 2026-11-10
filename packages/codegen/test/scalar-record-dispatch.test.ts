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
  assert.deepEqual([...plan.chains], [[0, { records: [0, 1, 2], failure: 3 }]]);
  assert.deepEqual([...plan.fused], [0, 1, 1, 0, 0]);
});
test("dispatch fusion stops at any candidate that cannot share the read", () => {
  // A differently placed field ends the chain before that candidate.
  const placed = recordDispatchChains(
    chain(candidate(1, 1, 2), candidate(2, 3, 3)),
    records,
    () => true,
  );
  assert.deepEqual([...placed!.chains], [[0, { records: [0, 1], failure: 2 }]]);
  assert.deepEqual([...placed!.fused], [0, 1, 0, 0, 0]);
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
  assert.deepEqual(
    [...rejoined!.chains],
    [[1, { records: [1, 2], failure: 3 }]],
  );
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
  assert.deepEqual([...plan.chains], [[0, { records: [0, 1, 2], failure: 3 }]]);
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
  assert.deepEqual([...plan.chains], [[4, { records: [0, 1, 2], failure: 3 }]]);
  assert.deepEqual([...plan.fused], [0, 1, 1, 0, 0, 0]);
});
