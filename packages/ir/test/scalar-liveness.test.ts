import { analyzeLiveSlots } from "../src/scalar/liveness.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { deadSlotsAtEntry, verify, type FunctionIR } from "@tint/ir/scalar";
const span = { start: 0, end: 1 };
test("flat liveness retains high-bit and next-word references across self edges", () => {
  const fn: FunctionIR = {
    id: 0,
    name: "highBits",
    exported: true,
    parameters: Array.from({ length: 33 }, (_, i) => i),
    slots: Array.from({ length: 33 }, () => "string" as const),
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 31, ...span },
          { kind: "load", id: 1, slot: 32, ...span },
        ],
        terminator: { kind: "jump", target: 0, ...span },
      },
    ],
  };
  assert.ok(verify({ functions: [fn] }).ok);
  assert.deepEqual(deadSlotsAtEntry(fn, 1000), [
    Array.from({ length: 31 }, (_, i) => i),
  ]);
  assert.deepEqual(deadSlotsAtEntry(fn, 1000, [32, 31]), [[]]);
});
test("liveness uses a fixed number of numeric buffers for a large graph", () => {
  const count = 200;
  const fn: FunctionIR = {
    id: 0,
    name: "large",
    exported: true,
    parameters: [0, 1],
    slots: ["string", "string"],
    returnType: "string",
    entry: 0,
    blocks: Array.from({ length: count }, (_, id) => ({
      id,
      instructions:
        id === 0 || id === count - 1
          ? [{ kind: "load" as const, id, slot: id === 0 ? 0 : 1, ...span }]
          : [],
      terminator:
        id === count - 1
          ? { kind: "return" as const, value: id, ...span }
          : { kind: "jump" as const, target: id + 1, ...span },
    })),
  };
  const original = globalThis.Uint32Array;
  let allocations = 0;
  globalThis.Uint32Array = new Proxy(original, {
    construct(target, args) {
      allocations++;
      return Reflect.construct(target, args);
    },
  });
  try {
    const result = deadSlotsAtEntry(fn);
    assert.ok(result);
    assert.deepEqual(result[0], []);
    assert.deepEqual(result[1], [0]);
    assert.deepEqual(result[count - 1], []);
  } finally {
    globalThis.Uint32Array = original;
  }
  assert.ok(allocations <= 8, `numeric buffer allocations: ${allocations}`);
});
function fixture(): FunctionIR {
  return {
    id: 0,
    name: "liveness",
    exported: true,
    parameters: [0, 1],
    slots: ["string", "string"],
    returnType: "string",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 1,
        instructions: [],
        terminator: { kind: "jump", target: 2, ...span },
      },
      {
        id: 2,
        instructions: [{ kind: "load", id: 1, slot: 1, ...span }],
        terminator: { kind: "return", value: 1, ...span },
      },
    ],
  };
}
test("slot lifetime ends on the first edge after its final use", () => {
  assert.deepEqual(deadSlotsAtEntry(fixture()), [[], [0], []]);
});
test("loops preserve values needed on a back edge", () => {
  const fn = fixture();
  const loop = {
    ...fn,
    blocks: [
      ...fn.blocks.slice(0, 2),
      {
        id: 2,
        instructions: [],
        terminator: { kind: "jump" as const, target: 0, ...span },
      },
    ],
  };
  assert.deepEqual(deadSlotsAtEntry(loop), [[1], [], []]);
  assert.deepEqual(deadSlotsAtEntry(loop, 1000, [1]), [[1], [], []]);
  assert.deepEqual(deadSlotsAtEntry(loop, 1000, [0]), [[], [], []]);
});
test("exceptional successors keep pre-throw values even if the block later overwrites them", () => {
  const fn = fixture();
  const first = fn.blocks[0]!;
  const exceptional: FunctionIR = {
    ...fn,
    slots: ["string", "string", "general"],
    blocks: [
      {
        ...first,
        exception: { target: 2, slot: 2 },
        instructions: [
          ...first.instructions,
          { kind: "call", id: 2, target: 0, arguments: [0, 0], ...span },
          { kind: "store" as const, slot: 1, value: 0, ...span },
        ],
        terminator: { kind: "jump" as const, target: 1, ...span },
      },
      {
        ...fn.blocks[1]!,
        instructions: [
          { kind: "string-literal", id: 3, value: "done", ...span },
        ],
        terminator: { kind: "return" as const, value: 3, ...span },
      },
      fn.blocks[2]!,
    ],
  };
  const verified = verify({ functions: [exceptional] });
  assert.ok(verified.ok, JSON.stringify(verified));
  const dead = deadSlotsAtEntry(exceptional);
  assert.ok(dead);
  assert.ok(!dead[0]!.includes(1));
  assert.ok(!dead[2]!.includes(1));
  for (const tracked of [[0], [1], [2], [0, 2]])
    assert.deepEqual(
      deadSlotsAtEntry(exceptional, 1000, tracked),
      dead.map((slots) => slots.filter((slot) => tracked.includes(slot))),
    );
});
test("analysis budget exhaustion disables slot reclamation", () => {
  assert.equal(deadSlotsAtEntry(fixture(), 0), undefined);
});

test("a value needed on either branch survives their shared predecessor", () => {
  const fn = fixture();
  const fork = {
    ...fn,
    blocks: [
      {
        ...fn.blocks[0]!,
        instructions: [
          { kind: "constant" as const, id: 0, value: true, ...span },
        ],
        terminator: {
          kind: "branch" as const,
          condition: 0,
          consequent: 1,
          alternate: 2,
          ...span,
        },
      },
      {
        ...fn.blocks[1]!,
        instructions: [{ kind: "load" as const, id: 1, slot: 0, ...span }],
        terminator: { kind: "return" as const, value: 1, ...span },
      },
      {
        ...fn.blocks[2]!,
        instructions: [{ kind: "load" as const, id: 2, slot: 1, ...span }],
        terminator: { kind: "return" as const, value: 2, ...span },
      },
    ],
  };
  assert.deepEqual(deadSlotsAtEntry(fork), [[], [1], [0]]);
});
test("invalid work budgets never enable an unbounded analysis", () => {
  for (const budget of [NaN, Infinity, -1, 0.5])
    assert.equal(deadSlotsAtEntry(fixture(), budget), undefined);
});

test("tracked slot liveness matches the full analysis without scanning unrelated slots", () => {
  const fn = fixture();
  const large: FunctionIR = {
    ...fn,
    slots: [
      ...fn.slots,
      ...Array.from({ length: 10000 }, () => "number" as const),
    ],
  };
  const full = deadSlotsAtEntry(large);
  assert.ok(full);
  assert.equal(deadSlotsAtEntry(large, 1000), undefined);
  const tracked = deadSlotsAtEntry(large, 1000, [0, 1]);
  assert.deepEqual(
    tracked,
    full.map((slots) => slots.filter((slot) => slot < 2)),
  );
  assert.deepEqual(
    deadSlotsAtEntry(large, 1000, [1]),
    full.map((slots) => slots.filter((slot) => slot === 1)),
  );
  assert.equal(deadSlotsAtEntry(large, 1000, [0, 0]), undefined);
  assert.equal(deadSlotsAtEntry(large, 1000, [-1]), undefined);
});

test("live-entry queries do not allocate the dead-root edge matrix", () => {
  const original = globalThis.Uint32Array;
  let allocations = 0;
  globalThis.Uint32Array = new Proxy(original, {
    construct(target, args) {
      allocations++;
      return Reflect.construct(target, args);
    },
  });
  try {
    assert.ok(analyzeLiveSlots(fixture(), 10000));
    const liveAllocations = allocations;
    allocations = 0;
    assert.ok(deadSlotsAtEntry(fixture(), 10000));
    assert.equal(allocations, liveAllocations + 1);
  } finally {
    globalThis.Uint32Array = original;
  }
});

test("backward liveness schedules predecessors within a linear reverse-chain budget", () => {
  const count = 100;
  const fn: FunctionIR = {
    id: 0,
    name: "reverse",
    exported: true,
    parameters: [0],
    slots: ["string"],
    returnType: "string",
    entry: count - 1,
    blocks: Array.from({ length: count }, (_, id) => ({
      id,
      instructions:
        id === 0 ? [{ kind: "load" as const, id: 0, slot: 0, ...span }] : [],
      terminator:
        id === 0
          ? { kind: "return" as const, value: 0, ...span }
          : { kind: "jump" as const, target: id - 1, ...span },
    })),
  };
  const result = analyzeLiveSlots(fn, count * 32);
  assert.ok(result);
  assert.deepEqual(
    result.slots,
    Array.from({ length: count }, () => [0]),
  );
});
