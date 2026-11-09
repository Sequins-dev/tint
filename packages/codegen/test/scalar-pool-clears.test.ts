import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionIR, Terminator } from "@tint/ir/scalar";
import { poolClearPlan } from "../src/aarch64/scalar/pool-clears.ts";

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
