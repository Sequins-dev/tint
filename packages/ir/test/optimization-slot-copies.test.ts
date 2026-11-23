import assert from "node:assert/strict";
import test from "node:test";
import type {
  Block,
  FunctionIR,
  Instruction,
  ScalarType,
} from "@tint/ir/scalar";
import { propagateSlotCopies } from "../src/optimization/slot-copies.ts";
const s = { start: 0, end: 0 };

function fn(
  slots: readonly ScalarType[],
  blocks: readonly Block[],
  parameters: readonly number[] = [0],
): FunctionIR {
  return {
    id: 0,
    name: "copies",
    exported: true,
    parameters,
    slots,
    returnType: "void",
    entry: 0,
    blocks,
  };
}
function block(
  id: number,
  instructions: readonly Instruction[],
  terminator: Block["terminator"],
): Block {
  return { id, instructions, terminator };
}
const ret: Block["terminator"] = { kind: "return", value: undefined, ...s };
function loadSlots(result: FunctionIR, id: number): number[] {
  const slots: number[] = [];
  for (const op of result.blocks[id]?.instructions ?? [])
    if (op.kind === "load") slots.push(op.slot);
  return slots;
}

test("loads of a copy read its source across joins", () => {
  const input = fn(
    ["number", "number"],
    [
      block(
        0,
        [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "store", slot: 1, value: 0, ...s },
          { kind: "constant", id: 1, value: true, ...s },
        ],
        { kind: "branch", condition: 1, consequent: 1, alternate: 2, ...s },
      ),
      block(1, [], { kind: "jump", target: 3, ...s }),
      block(2, [], { kind: "jump", target: 3, ...s }),
      block(3, [{ kind: "load", id: 2, slot: 1, ...s }], ret),
    ],
  );
  const result = propagateSlotCopies(input, 10000);
  assert.ok(result);
  assert.equal(result.rewritten, 1);
  assert.deepEqual(loadSlots(result.fn, 3), [0]);
});

test("a source store on any path keeps the copy", () => {
  const input = fn(
    ["number", "number"],
    [
      block(
        0,
        [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "store", slot: 1, value: 0, ...s },
          { kind: "constant", id: 1, value: true, ...s },
        ],
        { kind: "branch", condition: 1, consequent: 1, alternate: 2, ...s },
      ),
      block(
        1,
        [
          { kind: "constant", id: 3, value: 4, ...s },
          { kind: "store", slot: 0, value: 3, ...s },
        ],
        { kind: "jump", target: 3, ...s },
      ),
      block(2, [], { kind: "jump", target: 3, ...s }),
      block(3, [{ kind: "load", id: 2, slot: 1, ...s }], ret),
    ],
  );
  const result = propagateSlotCopies(input, 10000);
  assert.ok(result);
  assert.equal(result.rewritten, 0);
});

test("loop bodies read the source until it changes", () => {
  // b0: s1 = s0; b1: loop header; b2: body reads s1, maybe writes s0.
  const body = (writes: boolean): Instruction[] => [
    { kind: "load", id: 2, slot: 1, ...s },
    ...(writes
      ? [
          { kind: "constant", id: 3, value: 1, ...s } as const,
          { kind: "store", slot: 0, value: 3, ...s } as const,
        ]
      : []),
  ];
  for (const writes of [false, true]) {
    const input = fn(
      ["number", "number"],
      [
        block(
          0,
          [
            { kind: "load", id: 0, slot: 0, ...s },
            { kind: "store", slot: 1, value: 0, ...s },
          ],
          { kind: "jump", target: 1, ...s },
        ),
        block(1, [{ kind: "constant", id: 1, value: true, ...s }], {
          kind: "branch",
          condition: 1,
          consequent: 2,
          alternate: 3,
          ...s,
        }),
        block(2, body(writes), { kind: "jump", target: 1, ...s }),
        block(3, [], ret),
      ],
    );
    const result = propagateSlotCopies(input, 10000);
    assert.ok(result);
    assert.equal(result.rewritten, writes ? 0 : 1);
  }
});

test("reference copies of optional references stay copies", () => {
  // Reading the source would need an unwrap at every load.
  const input = fn(
    ["optional-reference", "reference"],
    [
      block(
        0,
        [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "reference-value", id: 1, value: 0, ...s },
          { kind: "store", slot: 1, value: 1, ...s },
        ],
        { kind: "jump", target: 1, ...s },
      ),
      block(1, [{ kind: "load", id: 2, slot: 1, ...s }], ret),
    ],
  );
  const result = propagateSlotCopies(input, 10000);
  assert.ok(result);
  assert.equal(result.rewritten, 0);
});

test("slots with different sources or non-copy stores stay", () => {
  const input = fn(
    ["number", "number", "number"],
    [
      block(
        0,
        [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "store", slot: 2, value: 0, ...s },
          { kind: "load", id: 1, slot: 1, ...s },
          { kind: "store", slot: 2, value: 1, ...s },
        ],
        { kind: "jump", target: 1, ...s },
      ),
      block(1, [{ kind: "load", id: 2, slot: 2, ...s }], ret),
    ],
    [0, 1],
  );
  const result = propagateSlotCopies(input, 10000);
  assert.ok(result);
  assert.equal(result.rewritten, 0);
});

test("copy chains resolve to their root, keeping record read proofs", () => {
  // Inlining chains parameter copies: 1 = 0, 2 = 1, 3 = 2. The descriptor
  // check reads slot 2 and the guarded read slot 3; rewriting each load one
  // hop (2 -> 1, 3 -> 2) would check one slot and read another.
  const input = fn(
    ["reference", "reference", "reference", "reference", "number"],
    [
      block(
        0,
        [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "store", slot: 1, value: 0, ...s },
        ],
        { kind: "jump", target: 1, ...s },
      ),
      block(
        1,
        [
          { kind: "load", id: 1, slot: 1, ...s },
          { kind: "store", slot: 2, value: 1, ...s },
        ],
        { kind: "jump", target: 2, ...s },
      ),
      block(
        2,
        [
          { kind: "load", id: 2, slot: 2, ...s },
          { kind: "store", slot: 3, value: 2, ...s },
        ],
        {
          kind: "record",
          object: 2,
          record: 0,
          field: 0,
          operation: "read",
          slot: 4,
          consequent: 3,
          alternate: 4,
          ...s,
        },
      ),
      block(
        3,
        [
          { kind: "load", id: 3, slot: 3, ...s },
          {
            kind: "record-read",
            id: 4,
            object: 3,
            record: 0,
            field: 0,
            ...s,
          },
        ],
        { kind: "return", value: 4, ...s },
      ),
      block(4, [], ret),
    ],
  );
  const result = propagateSlotCopies(input, 10000);
  assert.ok(result);
  assert.equal(result.refused, false);
  assert.equal(result.rewritten, 3);
  assert.deepEqual(loadSlots(result.fn, 1), [0]);
  assert.deepEqual(loadSlots(result.fn, 2), [0]);
  assert.deepEqual(loadSlots(result.fn, 3), [0]);
});

/** Deterministic pseudo-random numbers. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}
/** Random CFGs over four number slots (slot 4 receives exceptions): blocks
 * load, copy and overwrite slots; some blocks have exception handlers. */
function randomFunction(next: () => number): FunctionIR {
  const blockCount = 2 + Math.floor(next() * 7),
    blocks: Block[] = [];
  let id = 0;
  for (let index = 0; index < blockCount; index++) {
    const instructions: Instruction[] = [],
      values: number[] = [];
    const count = Math.floor(next() * 6);
    for (let step = 0; step < count; step++) {
      const choice = next(),
        slot = Math.floor(next() * 4);
      if (choice < 0.45 || values.length === 0) {
        instructions.push({ kind: "load", id, slot, ...s });
        values.push(id++);
      } else if (choice < 0.85) {
        const value = values[Math.floor(next() * values.length)] ?? 0;
        instructions.push({ kind: "store", slot, value, ...s });
      } else {
        instructions.push({ kind: "constant", id, value: id, ...s });
        values.push(id++);
      }
    }
    const target = (): number => Math.floor(next() * blockCount);
    const shape = next();
    let terminator: Block["terminator"];
    if (shape < 0.2 && index > 0) terminator = ret;
    else if (shape < 0.5) terminator = { kind: "jump", target: target(), ...s };
    else {
      instructions.push({ kind: "constant", id, value: true, ...s });
      terminator = {
        kind: "branch",
        condition: id++,
        consequent: target(),
        alternate: target(),
        ...s,
      };
    }
    blocks.push({
      id: index,
      instructions,
      terminator,
      ...(next() < 0.4 ? { exception: { target: target(), slot: 4 } } : {}),
    });
  }
  return fn(["number", "number", "number", "number", "number"], blocks);
}
/** Runs a function on a decision tape: branches and throws (at any
 * instruction of a block with a handler) follow the tape. Returns every
 * loaded value in order. */
function execute(input: FunctionIR, tape: () => number): number[] {
  const slots = [100, 101, 102, 103, 104],
    trace: number[] = [];
  let current = input.entry;
  for (let steps = 0; steps < 60; steps++) {
    const block = input.blocks[current];
    if (block === undefined) throw "test block";
    const values = new Map<number, number>();
    let thrown = false;
    for (const op of block.instructions) {
      if (block.exception !== undefined && tape() < 0.15) {
        thrown = true;
        break;
      }
      if (op.kind === "load") {
        const value = slots[op.slot] ?? -1;
        values.set(op.id, value);
        trace.push(value);
      } else if (op.kind === "store")
        slots[op.slot] = values.get(op.value) ?? -1;
      else if (op.kind === "constant") values.set(op.id, Number(op.id));
      else if (op.kind === "reference-value")
        values.set(op.id, values.get(op.value) ?? -1);
    }
    if (thrown && block.exception !== undefined) {
      slots[block.exception.slot] = -7;
      current = block.exception.target;
      continue;
    }
    const term = block.terminator;
    if (term.kind === "return") break;
    if (term.kind === "jump") current = term.target;
    else if (term.kind === "branch")
      current = tape() < 0.5 ? term.consequent : term.alternate;
    else throw "test terminator";
  }
  return trace;
}

test("copy propagation preserves every loaded value on random graphs", () => {
  const next = random(12345);
  let rewritten = 0;
  for (let round = 0; round < 6000; round++) {
    const input = randomFunction(next),
      result = propagateSlotCopies(input, 1000000);
    assert.ok(result);
    rewritten += result.rewritten;
    for (let run = 0; run < 20; run++) {
      const seed = Math.floor(next() * 1000000) + 1;
      assert.deepEqual(
        execute(result.fn, random(seed)),
        execute(input, random(seed)),
      );
    }
  }
  // The graphs exercise the rewrite, not only the refusals.
  assert.ok(rewritten > 100, String(rewritten));
});
