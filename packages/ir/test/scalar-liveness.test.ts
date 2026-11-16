import {
  analyzeLiveSlots,
  analyzeLiveSlotsPrecisely,
} from "../src/scalar/liveness.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deadSlotsAtEntry,
  liveSlotsIntoEntry,
  verify,
  type FunctionIR,
} from "@tint/ir/scalar";
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
test("liveness work follows live ranges, not blocks times slots", () => {
  // A chain of blocks, each storing and reading its own slot: dense
  // analysis would cost blocks x slots (4M here); sparse is linear.
  const count = 2000;
  const fn: FunctionIR = {
    id: 0,
    name: "chain",
    exported: true,
    parameters: [],
    slots: Array.from({ length: count }, () => "number" as const),
    returnType: "void",
    entry: 0,
    blocks: Array.from({ length: count }, (_, id) => ({
      id,
      instructions: [
        { kind: "constant" as const, id: id * 2, value: id, ...span },
        { kind: "store" as const, slot: id, value: id * 2, ...span },
        { kind: "load" as const, id: id * 2 + 1, slot: id, ...span },
      ],
      terminator:
        id === count - 1
          ? { kind: "return" as const, value: undefined, ...span }
          : { kind: "jump" as const, target: id + 1, ...span },
    })),
  };
  const budget = count * 16;
  const live = analyzeLiveSlots(fn, budget);
  assert.ok(live);
  assert.ok(live.slots.every((slots) => slots.length === 0));
  const dead = deadSlotsAtEntry(fn, budget);
  assert.ok(dead);
  assert.deepEqual(dead[0], []);
  assert.deepEqual(dead[5], [4]);
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

/** Reference liveness by set iteration, following the documented rules. */
function referenceLiveness(fn: FunctionIR): {
  live: Set<number>[];
  clear: number[][];
} {
  const uses: Set<number>[] = [],
    defs: Set<number>[] = [],
    successors: number[][] = [];
  for (const block of fn.blocks) {
    const used = new Set<number>(),
      defined = new Set<number>();
    for (const op of block!.instructions) {
      if (op!.kind === "load" && !defined.has(op!.slot)) used.add(op!.slot);
      if (op!.kind === "store") defined.add(op!.slot);
    }
    const term = block!.terminator;
    const next: number[] = [];
    if (term.kind === "jump") next.push(term.target);
    if (term.kind === "branch" || term.kind === "record") {
      next.push(term.consequent, term.alternate);
      if (term.kind === "record") {
        if (!defined.has(term.slot)) used.add(term.slot);
        defined.add(term.slot);
      }
    }
    uses.push(used);
    defs.push(defined);
    successors.push(next);
  }
  const live = fn.blocks.map(() => new Set<number>());
  for (let changed = true; changed;) {
    changed = false;
    for (const block of fn.blocks) {
      const id = block!.id,
        result = new Set(uses[id]);
      for (const next of successors[id]!)
        for (const slot of live[next]!)
          if (!defs[id]!.has(slot)) result.add(slot);
      if (block!.exception !== undefined)
        for (const slot of live[block!.exception.target]!) result.add(slot);
      if (result.size !== live[id]!.size) {
        live[id] = result;
        changed = true;
      }
    }
  }
  const clear = fn.blocks.map(() => new Set<number>());
  for (const block of fn.blocks) {
    const id = block!.id,
      targets = [...successors[id]!];
    if (block!.exception !== undefined) {
      const { target, slot } = block!.exception;
      targets.push(target);
      if (!live[target]!.has(slot)) clear[target]!.add(slot);
    }
    for (const target of targets)
      for (const slot of new Set([...live[id]!, ...defs[id]!]))
        if (!live[target]!.has(slot)) clear[target]!.add(slot);
  }
  for (const slot of fn.parameters)
    if (!live[fn.entry]!.has(slot)) clear[fn.entry]!.add(slot);
  return {
    live,
    clear: fn.blocks.map((block, id) =>
      block!.instructions.length === 0 && block!.terminator.kind === "trap"
        ? []
        : [...clear[id]!].sort((x, y) => x - y),
    ),
  };
}
test("sparse liveness matches set iteration on random graphs", () => {
  let seed = 7;
  const random = (limit: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % limit;
  };
  for (let round = 0; round < 500; round++) {
    const blockCount = 1 + random(10),
      slotCount = 1 + random(6);
    let value = 0;
    const blocks = Array.from({ length: blockCount }, (_, id) => {
      const instructions = Array.from({ length: random(5) }, () =>
        random(2) === 0
          ? {
              kind: "load" as const,
              id: value++,
              slot: random(slotCount),
              ...span,
            }
          : {
              kind: "store" as const,
              slot: random(slotCount),
              value: 0,
              ...span,
            },
      );
      const shape = random(6),
        target = (): number => random(blockCount);
      const terminator =
        shape === 0
          ? { kind: "return" as const, ...span }
          : shape === 1
            ? { kind: "trap" as const, ...span }
            : shape === 2
              ? {
                  kind: "record" as const,
                  slot: random(slotCount),
                  value: 0,
                  consequent: target(),
                  alternate: target(),
                  ...span,
                }
              : shape === 3
                ? {
                    kind: "branch" as const,
                    condition: 0,
                    consequent: target(),
                    alternate: target(),
                    ...span,
                  }
                : { kind: "jump" as const, target: target(), ...span };
      return {
        id,
        instructions,
        terminator,
        ...(random(4) === 0
          ? { exception: { target: target(), slot: random(slotCount) } }
          : {}),
      };
    });
    const fn = {
      id: 0,
      name: "random",
      exported: true,
      parameters: random(2) === 0 ? [] : [random(slotCount)],
      slots: Array.from({ length: slotCount }, () => "string" as const),
      returnType: "void",
      entry: 0,
      blocks,
    } as unknown as FunctionIR;
    const expected = referenceLiveness(fn);
    assert.deepEqual(
      analyzeLiveSlots(fn, 1000000)?.slots,
      expected.live.map((slots) => [...slots].sort((x, y) => x - y)),
    );
    assert.deepEqual(deadSlotsAtEntry(fn, 1000000), expected.clear);
    assert.deepEqual(liveSlotsIntoEntry(fn, 1000000)?.slots, [
      [...expected.live[0]!].sort((x, y) => x - y),
    ]);
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
test("empty trap blocks discard the frame and need no root clearing", () => {
  // Slot 0 stays live on the normal path; slot 1 dies after block 0. The
  // guard failure edge enters an empty trap: no safepoint can observe it.
  const fn: FunctionIR = {
    id: 0,
    name: "guardTrap",
    exported: true,
    parameters: [0, 1],
    slots: ["string", "string"],
    returnType: "string",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 1, ...span },
          { kind: "load", id: 1, slot: 0, ...span },
          { kind: "constant", id: 3, value: false, ...span },
        ],
        terminator: {
          kind: "branch",
          condition: 3,
          consequent: 1,
          alternate: 2,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [],
        terminator: { kind: "trap", ...span },
      },
      {
        id: 2,
        instructions: [{ kind: "load", id: 2, slot: 0, ...span }],
        terminator: { kind: "return", value: 2, ...span },
      },
    ],
  };
  assert.ok(
    verify({ functions: [fn] }).ok,
    JSON.stringify(verify({ functions: [fn] })),
  );
  assert.deepEqual(deadSlotsAtEntry(fn), [[], [], [1]]);
  // Live-entry results are unaffected.
  assert.deepEqual(analyzeLiveSlots(fn, 1000)?.slots, [[0, 1], [], [0]]);
});

test("precise liveness kills a guarded read's slot on its consequent edge only", () => {
  // b0 reads a record field into slot 1; b1 (success) reads slot 1; b2
  // (failure) reads it too only when `alternateReads`; `same` sends both
  // edges to b1.
  function fn(alternateReads: boolean, same = false): FunctionIR {
    return {
      id: 0,
      name: "guarded",
      exported: true,
      parameters: [0],
      slots: ["reference", "reference"],
      returnType: "void",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
          terminator: {
            kind: "record",
            object: 0,
            record: 0,
            field: 0,
            operation: "read",
            slot: 1,
            consequent: 1,
            alternate: same ? 1 : 2,
            ...span,
          },
        },
        {
          id: 1,
          instructions: [{ kind: "load", id: 1, slot: 1, ...span }],
          terminator: { kind: "return", value: undefined, ...span },
        },
        alternateReads
          ? {
              id: 2,
              instructions: [{ kind: "load", id: 2, slot: 1, ...span }],
              terminator: { kind: "return", value: undefined, ...span },
            }
          : { id: 2, instructions: [], terminator: { kind: "trap", ...span } },
      ],
    };
  }
  // Conservative: the read counts as a use of slot 1 in b0.
  assert.deepEqual(analyzeLiveSlots(fn(false), 1000)?.slots[0], [0, 1]);
  assert.deepEqual(analyzeLiveSlotsPrecisely(fn(false), 1000)?.slots, [
    [0],
    [1],
    [],
  ]);
  // The failure edge keeps the old contents, so a read there keeps it live.
  assert.deepEqual(analyzeLiveSlotsPrecisely(fn(true), 1000)?.slots, [
    [0, 1],
    [1],
    [1],
  ]);
  // One shared edge: written or not, so it stays conservative.
  assert.deepEqual(
    analyzeLiveSlotsPrecisely(fn(false, true), 1000)?.slots[0],
    [0, 1],
  );
  // Tracked subsets follow the same rule.
  assert.deepEqual(analyzeLiveSlotsPrecisely(fn(false), 1000, [1])?.slots, [
    [],
    [1],
    [],
  ]);
});

test("precise liveness keeps a guarded read's slot live into an exception handler", () => {
  const fn: FunctionIR = {
    id: 0,
    name: "guardedHandler",
    exported: true,
    parameters: [0],
    slots: ["reference", "reference", "general"],
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
        terminator: {
          kind: "record",
          object: 0,
          record: 0,
          field: 0,
          operation: "read",
          slot: 1,
          consequent: 1,
          alternate: 2,
          ...span,
        },
        exception: { target: 3, slot: 2 },
      },
      {
        id: 1,
        instructions: [{ kind: "load", id: 1, slot: 1, ...span }],
        terminator: { kind: "return", value: undefined, ...span },
      },
      { id: 2, instructions: [], terminator: { kind: "trap", ...span } },
      {
        id: 3,
        instructions: [{ kind: "load", id: 3, slot: 1, ...span }],
        terminator: { kind: "return", value: undefined, ...span },
      },
    ],
  };
  assert.deepEqual(analyzeLiveSlotsPrecisely(fn, 1000)?.slots[0], [0, 1]);
});
