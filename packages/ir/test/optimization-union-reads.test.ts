import assert from "node:assert/strict";
import test from "node:test";
import { reuseUnionReads } from "../src/optimization/union-reads.ts";
import {
  verify,
  type Block,
  type FunctionIR,
  type Instruction,
  type ModuleIR,
} from "@tint/ir/scalar";
const s = { start: 0, end: 0 };
const records = [0, 1, 2].map(() => ({
  byteLength: 32,
  fields: [{ offset: 16, type: "number" as const, mutable: false }],
}));

/** b0: object in slot 0 (parameter). A chain reads field 0 of layouts
 * `first` into slot 2, then `between` runs, then a second chain over
 * `second` reads into slot 4 and returns it. Block 1 traps. */
function program(
  first: readonly number[],
  second: readonly number[],
  between: readonly Instruction[] = [],
  joinFromElsewhere = false,
): FunctionIR {
  const blocks: Block[] = [];
  const trap: Block = {
    id: 1,
    instructions: [],
    terminator: { kind: "trap", ...s },
  };
  let id = 100;
  function chain(
    layouts: readonly number[],
    copySlot: number,
    transfer: number,
    consequent: number,
    firstBlock: number,
  ): void {
    layouts.forEach((record, index) => {
      const object = id++;
      const instructions: Instruction[] =
        index === 0
          ? [
              { kind: "load", id: object, slot: 0, ...s },
              { kind: "store", slot: copySlot, value: object, ...s },
            ]
          : [{ kind: "load", id: object, slot: copySlot, ...s }];
      blocks.push({
        id: firstBlock + index,
        instructions,
        terminator: {
          kind: "record",
          object,
          record,
          field: 0,
          operation: "read",
          slot: transfer,
          consequent,
          alternate: index + 1 < layouts.length ? firstBlock + index + 1 : 1,
          ...s,
        },
      });
    });
  }
  // b0 branches on parameter slot 5 when another path may skip the read.
  blocks.push({
    id: 0,
    instructions: joinFromElsewhere
      ? [{ kind: "load", id: id++, slot: 5, ...s }]
      : [],
    terminator: joinFromElsewhere
      ? { kind: "branch", condition: 100, consequent: 5, alternate: 3, ...s }
      : { kind: "jump", target: 5, ...s },
  });
  blocks.push(trap);
  // b2: after the first chain.
  blocks.push({
    id: 2,
    instructions: between.slice(),
    terminator: { kind: "jump", target: 3, ...s },
  });
  blocks.push({
    id: 3,
    instructions: [],
    terminator: { kind: "jump", target: 5 + first.length, ...s },
  });
  chain(first, 1, 2, 2, 5);
  chain(second, 3, 4, 4, 5 + first.length);
  blocks.push({
    id: 4,
    instructions: [{ kind: "load", id: id++, slot: 4, ...s }],
    terminator: { kind: "return", value: id - 1, ...s },
  });
  const ordered: Block[] = [];
  for (const block of blocks) ordered[block.id] = block;
  return {
    id: 0,
    name: "reads",
    exported: true,
    parameters: joinFromElsewhere ? [0, 5] : [0],
    slots: [
      "reference",
      "reference",
      "number",
      "reference",
      "number",
      "boolean",
    ],
    returnType: "number",
    entry: 0,
    blocks: ordered,
  };
}
function readCount(fn: FunctionIR): number {
  return fn.blocks.filter(
    (block) =>
      block !== undefined &&
      block.terminator.kind === "record" &&
      block.terminator.operation === "read",
  ).length;
}
function check(fn: FunctionIR): void {
  const module: ModuleIR = { records, functions: [fn] };
  assert.deepEqual(verify(module), { ok: true });
}

test("a repeated union field read copies the earlier result", () => {
  const fn = program([0, 1, 2], [0, 1, 2]);
  check(fn);
  const result = reuseUnionReads(fn, 100000);
  assert.ok(result);
  assert.equal(result.rewritten, 1);
  assert.equal(readCount(result.fn), 3);
  check(result.fn);
});

test("a narrowed union (subset of layouts) reuses the wider read", () => {
  const result = reuseUnionReads(program([0, 1, 2], [1, 2]), 100000);
  assert.ok(result);
  assert.equal(result.rewritten, 1);
  check(result.fn);
  // A wider later read cannot reuse a narrower earlier one.
  const wider = reuseUnionReads(program([1, 2], [0, 1, 2]), 100000);
  assert.ok(wider);
  assert.equal(wider.rewritten, 0);
});

test("stores to the object slot, calls and heap writes end availability", () => {
  const store: Instruction[] = [
    { kind: "load", id: 90, slot: 3, ...s },
    { kind: "store", slot: 0, value: 90, ...s },
  ];
  const stored = reuseUnionReads(program([0, 1], [0, 1], store), 100000);
  assert.ok(stored);
  assert.equal(stored.rewritten, 0);
  const call: Instruction[] = [
    { kind: "call", id: undefined, target: 0, arguments: [], ...s },
  ];
  const called = reuseUnionReads(program([0, 1], [0, 1], call), 100000);
  assert.ok(called);
  assert.equal(called.rewritten, 0);
});

test("a read reached on another path without the earlier read is kept", () => {
  const fn = program([0, 1], [0, 1], [], true);
  check(fn);
  const result = reuseUnionReads(fn, 100000);
  assert.ok(result);
  assert.equal(result.rewritten, 0);
});

test("exhausted budgets plan nothing", () => {
  assert.equal(reuseUnionReads(program([0, 1], [0, 1]), 3), undefined);
});

test("reuses union field reads through reference-value unwraps", () => {
  // Slot 0 is optional-reference; both chains unwrap it via reference-value.
  const fn: FunctionIR = {
    id: 0,
    name: "optionalUnion",
    exported: true,
    parameters: [0],
    slots: ["optional-reference", "number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "reference-value", id: 1, value: 0, ...s },
        ],
        terminator: {
          kind: "record",
          object: 1,
          record: 0,
          field: 0,
          operation: "read",
          slot: 1,
          consequent: 2,
          alternate: 1,
          ...s,
        },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 2, slot: 0, ...s },
          { kind: "reference-value", id: 3, value: 2, ...s },
        ],
        terminator: {
          kind: "record",
          object: 3,
          record: 1,
          field: 0,
          operation: "read",
          slot: 1,
          consequent: 2,
          alternate: 5,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 4, slot: 0, ...s },
          { kind: "reference-value", id: 5, value: 4, ...s },
        ],
        terminator: {
          kind: "record",
          object: 5,
          record: 0,
          field: 0,
          operation: "read",
          slot: 2,
          consequent: 4,
          alternate: 3,
          ...s,
        },
      },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 6, slot: 0, ...s },
          { kind: "reference-value", id: 7, value: 6, ...s },
        ],
        terminator: {
          kind: "record",
          object: 7,
          record: 1,
          field: 0,
          operation: "read",
          slot: 2,
          consequent: 4,
          alternate: 5,
          ...s,
        },
      },
      {
        id: 4,
        instructions: [
          { kind: "load", id: 8, slot: 1, ...s },
          { kind: "load", id: 9, slot: 2, ...s },
          { kind: "binary", id: 10, operator: "+", left: 8, right: 9, ...s },
        ],
        terminator: { kind: "return", value: 10, ...s },
      },
      { id: 5, instructions: [], terminator: { kind: "trap", ...s } },
    ],
  };
  check(fn);
  const result = reuseUnionReads(fn, 100000);
  assert.ok(result);
  assert.equal(result.rewritten, 1);
  check(result.fn);
  assert.equal(result.fn.blocks[2]?.terminator.kind, "jump");
});
