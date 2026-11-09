import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionIR, Instruction, Terminator } from "@tint/ir/scalar";
import { aliasedSlotLoads } from "../src/aarch64/scalar/slot-aliases.ts";

const at = { start: 0, end: 0 };
const load = (id: number, slot: number): Instruction =>
  ({ ...at, kind: "load", id, slot }) as Instruction;
const store = (slot: number, value: number): Instruction =>
  ({ ...at, kind: "store", slot, value }) as Instruction;
const constant = (id: number): Instruction =>
  ({ ...at, kind: "constant", id, value: 1 }) as Instruction;
const add = (id: number, left: number, right: number): Instruction =>
  ({ ...at, kind: "binary", id, operator: "+", left, right }) as Instruction;
const ret = (value: number | undefined): Terminator =>
  ({ ...at, kind: "return", value }) as Terminator;
const guarded = (
  kind: "record" | "record-cell" | "cell",
  object: number,
  slot: number,
): Terminator =>
  ({
    ...at,
    kind,
    object,
    cell: 0,
    record: 0,
    field: 0,
    operation: "read",
    slot,
    consequent: 1,
    alternate: 1,
  }) as Terminator;

function fn(
  slots: readonly string[],
  blocks: readonly {
    readonly ops: readonly Instruction[];
    readonly term: Terminator;
  }[],
): FunctionIR {
  return {
    entry: 0,
    slots,
    parameters: [],
    blocks: blocks.map((block, id) => ({
      id,
      instructions: block.ops,
      terminator: block.term,
    })),
  } as unknown as FunctionIR;
}
function aliases(ir: FunctionIR): number[] {
  const marks = aliasedSlotLoads(ir, 1_000_000);
  assert.ok(marks);
  return [...marks];
}

test("a load used before any store to its slot reads the slot in place", () => {
  const ir = fn(
    ["number", "number"],
    [{ ops: [load(0, 0), load(1, 1), add(2, 0, 1)], term: ret(2) }],
  );
  const marks = aliases(ir);
  assert.equal(marks[0], 1);
  assert.equal(marks[1], 1);
  assert.equal(marks[2], 0);
});

test("a store to the slot before a later use keeps a private home", () => {
  // v0 = s0; s0 = c; return v0 + c. The store would overwrite v0's value.
  const ir = fn(
    ["number"],
    [
      {
        ops: [load(0, 0), constant(1), store(0, 1), add(2, 0, 1)],
        term: ret(2),
      },
    ],
  );
  assert.equal(aliases(ir)[0], 0);
  // A terminator use after the store conflicts in the same way.
  const returned = fn(
    ["number"],
    [{ ops: [load(0, 0), constant(1), store(0, 1)], term: ret(0) }],
  );
  assert.equal(aliases(returned)[0], 0);
});

test("a store after the last use, or storing the loaded value, keeps the alias", () => {
  // The store reads v0 as its operand before writing the slot.
  const consumed = fn(
    ["number"],
    [
      {
        ops: [load(0, 0), constant(1), add(2, 0, 1), store(0, 2)],
        term: ret(2),
      },
    ],
  );
  assert.equal(aliases(consumed)[0], 1);
  // Storing v0 back to its own slot leaves the slot equal to v0.
  const same = fn(
    ["number"],
    [
      {
        ops: [load(0, 0), store(0, 0), constant(1), add(2, 0, 1)],
        term: ret(2),
      },
    ],
  );
  assert.equal(aliases(same)[0], 1);
  // A store to a different slot never conflicts.
  const other = fn(
    ["number", "number"],
    [
      {
        ops: [load(0, 0), constant(1), store(1, 1), add(2, 0, 1)],
        term: ret(2),
      },
    ],
  );
  assert.equal(aliases(other)[0], 1);
});

test("candidates do not survive past their block", () => {
  // Block-local SSA: a later block's store to the slot cannot affect v0, and a
  // reload in that block is its own candidate.
  const ir = fn(
    ["number"],
    [
      {
        ops: [load(0, 0), add(1, 0, 0)],
        term: { ...at, kind: "jump", target: 1 } as Terminator,
      },
      {
        ops: [constant(2), store(0, 2), load(3, 0), add(4, 3, 3)],
        term: ret(4),
      },
    ],
  );
  const marks = aliases(ir);
  assert.equal(marks[0], 1);
  assert.equal(marks[3], 1);
});

test("guarded record reads that write the slot conflict with operands of that slot", () => {
  // The record terminator writes s0 while v0 (a load of s0) is its object.
  const conflicting = fn(
    ["reference"],
    [
      { ops: [load(0, 0)], term: guarded("record", 0, 0) },
      { ops: [], term: ret(undefined) },
    ],
  );
  assert.equal(aliases(conflicting)[0], 0);
  // Writing a different slot leaves the operand aliased.
  const disjoint = fn(
    ["reference", "reference"],
    [
      { ops: [load(0, 0)], term: guarded("record", 0, 1) },
      { ops: [], term: ret(undefined) },
    ],
  );
  assert.equal(aliases(disjoint)[0], 1);
});

test("slots named by cell terminators are never aliased", () => {
  for (const kind of ["cell", "record-cell"] as const) {
    const ir = fn(
      ["reference", "reference"],
      [
        { ops: [load(0, 0), load(1, 1)], term: guarded(kind, 1, 0) },
        { ops: [load(2, 0)], term: ret(2) },
      ],
    );
    const marks = aliases(ir);
    assert.equal(marks[0], 0, kind);
    assert.equal(marks[2], 0, kind);
    assert.equal(marks[1], 1, kind);
  }
});

test("budget exhaustion and sparse value ids fall back to private homes", () => {
  const ir = fn(["number"], [{ ops: [load(0, 0)], term: ret(0) }]);
  assert.equal(aliasedSlotLoads(ir, 1), undefined);
  const sparse = fn(
    ["number"],
    [{ ops: [load(5_000_000, 0)], term: ret(5_000_000) }],
  );
  assert.equal(aliasedSlotLoads(sparse, 1_000_000), undefined);
});
