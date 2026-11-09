import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionIR, Terminator } from "@tint/ir/scalar";
import {
  deadSlotClearPlan,
  prologueClearWords,
  poolClearPlan,
} from "../src/aarch64/scalar/pool-clears.ts";

// poolClearPlan reads only block ids, terminators, exception edges and the
// entry; the rest of each block is irrelevant to the dataflow.
function cfg(
  terminators: readonly Terminator[],
  exceptions: readonly (number | undefined)[] = [],
): FunctionIR {
  const shape = {
    entry: 0,
    blocks: terminators.map((terminator, id) => {
      const target = exceptions[id];
      return {
        id,
        instructions: [],
        terminator,
        ...(target === undefined ? {} : { exception: { target, slot: 0 } }),
      };
    }),
  };
  return shape as unknown as FunctionIR;
}
const jump = (target: number): Terminator => ({
  start: 0,
  end: 0,
  kind: "jump",
  target,
});
const end: Terminator = {
  start: 0,
  end: 0,
  kind: "return",
  value: undefined,
};
function plan(
  fn: FunctionIR,
  words: number,
  writes: readonly (readonly number[])[],
  options: {
    covered?: readonly (readonly number[])[];
    collecting?: (block: number) => boolean;
    dirtyAtEntry?: boolean;
  } = {},
) {
  return poolClearPlan(
    fn,
    words,
    (block) => writes[block] ?? [],
    (block) => options.covered?.[block] ?? [],
    options.collecting ?? (() => true),
    options.dirtyAtEntry ?? false,
    1_000_000,
  );
}

test("collecting blocks clear exactly the words written since the last clear", () => {
  const fn = cfg([jump(1), jump(2), end]);
  assert.deepEqual(plan(fn, 4, [[0, 1], [2], []]), [[], [0, 1], [2]]);
  // Garbage at entry (deferred clears) is cleared by the first collector.
  assert.deepEqual(plan(fn, 3, [[], [], []], { dirtyAtEntry: true }), [
    [0, 1, 2],
    [],
    [],
  ]);
});

test("blocks that never collect keep incoming words for the next collector", () => {
  const fn = cfg([jump(1), jump(2), end]);
  assert.deepEqual(
    plan(fn, 4, [[0], [1], []], { collecting: (block) => block !== 1 }),
    [[], [], [0, 1]],
  );
});

test("words stored before the first safepoint need no clear", () => {
  const fn = cfg([jump(1), end]);
  assert.deepEqual(
    plan(
      fn,
      3,
      [
        [0, 1, 2],
        [0, 1],
      ],
      { covered: [[], [0, 2]] },
    ),
    [[], [1]],
  );
});

test("joins, loops and exception edges union every incoming path", () => {
  const branch: Terminator = {
    kind: "branch",
    condition: 0,
    consequent: 1,
    alternate: 2,
  } as unknown as Terminator;
  const join = cfg([branch, jump(3), jump(3), end]);
  assert.deepEqual(plan(join, 3, [[], [0], [2], []]), [[], [], [], [0, 2]]);
  // A loop block sees its own writes from the back edge.
  const loop = cfg([
    jump(1),
    {
      kind: "branch",
      condition: 0,
      consequent: 1,
      alternate: 2,
    } as unknown as Terminator,
    end,
  ]);
  assert.deepEqual(plan(loop, 2, [[0], [1], []]), [[], [0, 1], [1]]);
  // A handler sees words written anywhere in a throwing block.
  const handler = cfg([jump(2), end, end], [1]);
  assert.deepEqual(plan(handler, 2, [[0, 1], [], []]), [[], [0, 1], [0, 1]]);
});

test("an exhausted budget leaves the caller's whole-pool clears", () => {
  const fn = cfg([jump(1), end]);
  assert.equal(
    poolClearPlan(
      fn,
      64,
      () => [],
      () => [],
      () => true,
      false,
      1,
    ),
    undefined,
  );
});

function deadPlan(
  fn: FunctionIR,
  words: number,
  deaths: readonly (readonly number[])[],
  writes: readonly (readonly number[])[],
  collecting: (block: number) => boolean,
  slotWords: (slot: number) => readonly number[] = (slot) => [slot],
) {
  return deadSlotClearPlan(
    fn,
    words,
    (block) => deaths[block] ?? [],
    (block) => writes[block] ?? [],
    slotWords,
    collecting,
    1_000_000,
  );
}

test("dead slots are cleared at the next collecting block, not where they die", () => {
  const fn = cfg([jump(1), jump(2), end]);
  // Word 0 dies entering block 1, which cannot collect; block 2 can.
  assert.deepEqual(
    deadPlan(fn, 2, [[], [0], []], [[], [], []], (block) => block !== 1),
    [[], [], [0]],
  );
  // Without a closed-IR proof every block collects: clears stay in place.
  assert.deepEqual(
    deadPlan(fn, 2, [[], [0], []], [[], [], []], () => true),
    [[], [0], []],
  );
});

test("a store before the next collection makes a pending clear unnecessary", () => {
  const fn = cfg([jump(1), jump(2), end]);
  assert.deepEqual(
    deadPlan(fn, 2, [[], [0, 1], []], [[], [1], []], (block) => block !== 1),
    [[], [], [0]],
  );
});

test("pending clears follow every path and stop at each collecting block", () => {
  const branch = {
    kind: "branch",
    condition: 0,
    consequent: 1,
    alternate: 2,
  } as unknown as Terminator;
  const fn = cfg([branch, jump(3), jump(3), end]);
  // Dies in block 0 (non-collecting); block 1 collects, block 2 does not.
  assert.deepEqual(
    deadPlan(fn, 1, [[0], [], [], []], [[], [], [], []], (block) =>
      [1, 3].includes(block),
    ),
    [[], [0], [], [0]],
  );
});

test("edge writes of transfer and exception slots are never cleared after the fact", () => {
  const read = (slot: number): Terminator =>
    ({
      ...{ start: 0, end: 0 },
      kind: "record",
      object: 0,
      record: 0,
      field: 0,
      operation: "read",
      slot,
      consequent: 1,
      alternate: 2,
    }) as unknown as Terminator;
  // Word 0 dies in block 0, then block 0's guarded read writes slot 0 on
  // its consequent edge: collecting block 1 must not clear it, while the
  // alternate (no transfer) still clears it.
  const guarded = cfg([read(0), end, end]);
  assert.deepEqual(
    deadPlan(guarded, 1, [[0], [], []], [[], [], []], (block) => block !== 0),
    [[], [], [0]],
  );
  // The thrown value's slot is written on entry to the handler.
  const handled = cfg([jump(1), end, end], [2]);
  assert.deepEqual(
    deadPlan(handled, 1, [[0], [], []], [[], [], []], (block) => block !== 0),
    [[], [0], []],
  );
});

// prologueClearWords walks instructions; slot s owns root word s here.
function slotsFn(
  blocks: readonly {
    readonly ops: readonly unknown[];
    readonly term: Terminator;
    readonly handler?: number;
  }[],
): FunctionIR {
  return {
    entry: 0,
    slots: ["reference", "reference", "reference"],
    parameters: [],
    blocks: blocks.map((block, id) => ({
      id,
      instructions: block.ops,
      terminator: block.term,
      ...(block.handler === undefined
        ? {}
        : { exception: { target: block.handler, slot: 2 } }),
    })),
  } as unknown as FunctionIR;
}
const sLoad = (id: number, slot: number) => ({ kind: "load", id, slot });
const sStore = (slot: number, value: number) => ({
  kind: "store",
  slot,
  value,
});
const allocate = (id: number) => ({
  kind: "record-new",
  id,
  record: 0,
  arguments: [],
});
const callTo = (target: number) => ({
  kind: "call",
  id: undefined,
  target,
  arguments: [],
});
function exposed(
  fn: FunctionIR,
  initial: readonly number[] = [],
  noSafepoints?: Uint8Array,
): number[] {
  const marks = prologueClearWords(
    fn,
    3,
    initial,
    (slot) => [slot],
    noSafepoints,
    1_000_000,
  );
  assert.ok(marks);
  return [...marks];
}

test("slot words stored on every path before a collection need no prologue zero", () => {
  // s0 is stored before the allocation; s1 only after it; s2 never.
  const fn = slotsFn([
    { ops: [sStore(0, 7), allocate(9), sStore(1, 9)], term: end },
  ]);
  assert.deepEqual(exposed(fn), [0, 1, 1]);
  // With every store ahead of the collection, nothing is exposed.
  const early = slotsFn([
    {
      ops: [sStore(0, 7), sStore(1, 7), sStore(2, 7), allocate(9)],
      term: end,
    },
  ]);
  assert.deepEqual(exposed(early), [0, 0, 0]);
  // Prologue-stored words (parameters, receiver) count as written.
  const params = slotsFn([{ ops: [allocate(9)], term: end }]);
  assert.deepEqual(exposed(params, [1]), [1, 0, 1]);
});

test("a read before any store keeps the zero the IR may rely on", () => {
  const fn = slotsFn([
    { ops: [sLoad(5, 0), sStore(0, 5), sStore(1, 5), sStore(2, 5)], term: end },
  ]);
  assert.deepEqual(exposed(fn), [1, 0, 0]);
});

test("one unwritten path through a join exposes the word", () => {
  const branch = {
    kind: "branch",
    condition: 0,
    consequent: 1,
    alternate: 2,
  } as unknown as Terminator;
  const fn = slotsFn([
    { ops: [sStore(2, 7)], term: branch },
    { ops: [sStore(0, 7), sStore(1, 7)], term: jump(3) },
    { ops: [sStore(1, 7)], term: jump(3) },
    { ops: [allocate(9)], term: end },
  ]);
  assert.deepEqual(exposed(fn), [1, 0, 0]);
  // A loop back edge cannot lose a word stored before the loop.
  const loop = slotsFn([
    { ops: [sStore(0, 7), sStore(1, 7), sStore(2, 7)], term: jump(1) },
    {
      ops: [allocate(9)],
      term: {
        kind: "branch",
        condition: 0,
        consequent: 1,
        alternate: 2,
      } as unknown as Terminator,
    },
    { ops: [], term: end },
  ]);
  assert.deepEqual(exposed(loop), [0, 0, 0]);
});

test("handlers inherit the throwing block's entry state", () => {
  // B0 stores every slot but may throw first; the handler B2 collects.
  const fn = slotsFn([
    {
      ops: [sStore(0, 7), sStore(1, 7), sStore(2, 7)],
      term: jump(1),
      handler: 2,
    },
    { ops: [], term: end },
    { ops: [allocate(9)], term: end },
  ]);
  assert.deepEqual(exposed(fn), [1, 1, 1]);
});

test("guarded reads write their slot only on the consequent edge", () => {
  const read = (slot: number): Terminator =>
    ({
      kind: "record",
      object: 0,
      record: 0,
      field: 0,
      operation: "read",
      slot,
      consequent: 1,
      alternate: 2,
    }) as unknown as Terminator;
  const fn = slotsFn([
    { ops: [sStore(1, 7), sStore(2, 7)], term: read(0) },
    { ops: [allocate(9)], term: end },
    { ops: [], term: end },
  ]);
  assert.deepEqual(exposed(fn), [0, 0, 0]);
  const alternateCollects = slotsFn([
    { ops: [sStore(1, 7), sStore(2, 7)], term: read(0) },
    { ops: [], term: end },
    { ops: [allocate(9)], term: end },
  ]);
  assert.deepEqual(exposed(alternateCollects), [1, 0, 0]);
  // A write terminator reads the slot it names.
  const write = slotsFn([
    {
      ops: [],
      term: {
        kind: "cell",
        cell: 0,
        operation: "write",
        slot: 1,
        consequent: 1,
        alternate: 1,
      } as unknown as Terminator,
    },
    { ops: [sStore(0, 7), sStore(1, 7), sStore(2, 7)], term: end },
  ]);
  assert.deepEqual(exposed(write), [0, 1, 0]);
});

test("calls collect unless proven free of safepoints; throws always collect", () => {
  const fn = slotsFn([{ ops: [callTo(1), sStore(0, 7)], term: end }]);
  assert.deepEqual(exposed(fn), [1, 1, 1]);
  assert.deepEqual(exposed(fn, [], new Uint8Array([0, 1])), [0, 0, 0]);
  const thrown = slotsFn([
    { ops: [], term: { kind: "throw", value: 0 } as unknown as Terminator },
  ]);
  assert.deepEqual(exposed(thrown), [1, 1, 1]);
  // Words stored by unreached blocks or never observed need nothing.
  const quiet = slotsFn([{ ops: [], term: end }]);
  assert.deepEqual(exposed(quiet), [0, 0, 0]);
});

test("an exhausted budget keeps every prologue zero", () => {
  const fn = slotsFn([{ ops: [], term: end }]);
  assert.equal(
    prologueClearWords(fn, 3, [], (slot) => [slot], undefined, 1),
    undefined,
  );
});

test("the prologue proof converges on loops with word bit 31 in play", () => {
  // 40 words: bit 31 of the first bitset word is a real word. The loop
  // body stores every word, so nothing is exposed, within a small budget.
  const words = 40;
  const stores = Array.from({ length: words }, (_, slot) => sStore(slot, 7));
  const fn = {
    entry: 0,
    slots: Array.from({ length: words }, () => "reference"),
    parameters: [],
    blocks: [
      { id: 0, instructions: stores, terminator: jump(1) },
      {
        id: 1,
        instructions: [allocate(9)],
        terminator: {
          kind: "branch",
          condition: 0,
          consequent: 1,
          alternate: 2,
        },
      },
      { id: 2, instructions: [], terminator: end },
    ],
  } as unknown as FunctionIR;
  const marks = prologueClearWords(
    fn,
    words,
    [],
    (slot) => [slot],
    undefined,
    2_000,
  );
  assert.ok(marks, "fixed point within budget");
  assert.equal(
    [...marks].reduce((sum, mark) => sum + mark, 0),
    0,
  );
});
