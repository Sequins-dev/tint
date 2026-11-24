import assert from "node:assert/strict";
import test from "node:test";
import type {
  Block,
  FunctionIR,
  Instruction,
  ScalarType,
} from "@tint/ir/scalar";
import { verify } from "@tint/ir/scalar";
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

test("reference copies of optional references read the source unwrapped", () => {
  // s1 = unwrap(s0): a load of s1 that a checked field read takes as its
  // object becomes an unwrap of a load of s0 that keeps the load's value id,
  // so facts proven on either slot cover both. Other loads keep the copy
  // (an unwrap there would only add a null test).
  const read = (id: number, object: number, next: number): Block =>
    block(id, [{ kind: "load", id: object, slot: 1, ...s }], {
      kind: "record",
      object,
      record: 0,
      field: 0,
      operation: "read",
      slot: 2,
      consequent: next,
      alternate: 3,
      ...s,
    });
  const input = fn(
    ["optional-reference", "reference", "number"],
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
      read(1, 2, 2),
      block(2, [{ kind: "load", id: 4, slot: 1, ...s }], ret),
      block(3, [], { kind: "trap", ...s }),
    ],
  );
  const result = propagateSlotCopies(input, 10000);
  assert.ok(result);
  assert.equal(result.rewritten, 1);
  assert.deepEqual(loadSlots(result.fn, 2), [1]);
  assert.deepEqual(
    result.fn.blocks[1]?.instructions.map((op) =>
      op.kind === "load"
        ? ["load", op.id, op.slot]
        : op.kind === "reference-value"
          ? ["reference-value", op.id, op.value]
          : [op.kind],
    ),
    [
      ["load", 5, 0],
      ["reference-value", 2, 5],
    ],
  );
});

test("copies of copies read the root of the chain", () => {
  // s2 = s1 = s0 (nested inlining): s2's loads end at s0, not s1.
  const input = fn(
    ["number", "number", "number"],
    [
      block(
        0,
        [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "store", slot: 1, value: 0, ...s },
          { kind: "load", id: 1, slot: 1, ...s },
          { kind: "store", slot: 2, value: 1, ...s },
        ],
        { kind: "jump", target: 1, ...s },
      ),
      block(
        1,
        [
          { kind: "load", id: 2, slot: 2, ...s },
          { kind: "load", id: 3, slot: 1, ...s },
        ],
        ret,
      ),
    ],
  );
  const result = propagateSlotCopies(input, 10000);
  assert.ok(result);
  assert.deepEqual(loadSlots(result.fn, 1), [0, 0]);
  assert.deepEqual(loadSlots(result.fn, 0), [0, 0]);
});

test("chained copies keep a record read proven through the chain", () => {
  // s1 = s0 and s2 = s1 copy a receiver whose check reads s1; a direct read
  // through s2 after the check stays proven only when both copies resolve
  // to s0 (one round would leave the check on s0 and the read on s1).
  const input: FunctionIR = {
    ...fn(
      ["reference", "reference", "reference", "number"],
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
          {
            kind: "record",
            object: 1,
            record: 0,
            field: 0,
            operation: "read",
            slot: 3,
            consequent: 2,
            alternate: 3,
            ...s,
          },
        ),
        block(
          2,
          [
            { kind: "load", id: 2, slot: 2, ...s },
            {
              kind: "record-read",
              id: 3,
              object: 2,
              record: 0,
              field: 0,
              ...s,
            },
          ],
          ret,
        ),
        block(3, [], { kind: "trap", ...s }),
      ],
    ),
  };
  const module = {
    records: [
      {
        byteLength: 24,
        fields: [{ offset: 8, type: "number" as const, mutable: false }],
      },
    ],
    functions: [input],
  };
  assert.ok(verify(module).ok);
  const result = propagateSlotCopies(input, 100000);
  assert.ok(result);
  assert.equal(result.refused, false);
  assert.deepEqual(loadSlots(result.fn, 1), [0]);
  assert.deepEqual(loadSlots(result.fn, 2), [0]);
  assert.ok(verify({ ...module, functions: [result.fn] }).ok);
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
