import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionIR, Terminator } from "@tint/ir/scalar";
import {
  deadSlotClearPlan,
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
