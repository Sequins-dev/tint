import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionIR, Instruction, Terminator } from "@tint/ir/scalar";
import { shareFrameSlots } from "../src/aarch64/scalar/slot-sharing.ts";

const at = { start: 0, end: 0 };
let nextId = 1000;
const load = (slot: number): Instruction =>
  ({ ...at, kind: "load", id: nextId++, slot }) as Instruction;
const store = (slot: number): Instruction =>
  ({ ...at, kind: "store", slot, value: 0 }) as Instruction;
const jump = (target: number): Terminator => ({ ...at, kind: "jump", target });
const end: Terminator = { ...at, kind: "return", value: undefined };
const branch = (consequent: number, alternate: number): Terminator =>
  ({
    ...at,
    kind: "branch",
    condition: 0,
    consequent,
    alternate,
  }) as Terminator;
const guardedRead = (
  slot: number,
  consequent: number,
  alternate: number,
): Terminator =>
  ({
    ...at,
    kind: "record",
    object: 0,
    record: 0,
    field: 0,
    operation: "read",
    slot,
    consequent,
    alternate,
  }) as Terminator;
interface BlockShape {
  readonly ops: readonly Instruction[];
  readonly term: Terminator;
  readonly handler?: number;
}
function fn(
  slots: readonly string[],
  blocks: readonly BlockShape[],
): FunctionIR {
  return {
    entry: 0,
    slots,
    parameters: [],
    blocks: blocks.map((block, id) => ({
      id,
      instructions: block.ops,
      terminator: block.term,
      ...(block.handler === undefined
        ? {}
        : { exception: { target: block.handler, slot: 0 } }),
    })),
  } as unknown as FunctionIR;
}
function groups(ir: FunctionIR, eligible = (_slot: number) => true) {
  const sharing = shareFrameSlots(ir, eligible, 1_000_000);
  assert.ok(sharing);
  return [...sharing.color].map((group) => group - 1);
}

test("slots with disjoint straight-line ranges share; overlapping ranges do not", () => {
  // s0 lives B0->B1, s1 lives B2->B3, s2 overlaps both.
  const ir = fn(
    ["reference", "reference", "reference"],
    [
      { ops: [store(0), store(2)], term: jump(1) },
      { ops: [load(0)], term: jump(2) },
      { ops: [store(1)], term: jump(3) },
      { ops: [load(1), load(2)], term: end },
    ],
  );
  const color = groups(ir);
  assert.equal(color[0], color[1]);
  assert.notEqual(color[2], color[0]);
});

test("only identical slot types share an offset", () => {
  const ir = fn(
    ["reference", "general"],
    [
      { ops: [store(0)], term: jump(1) },
      { ops: [load(0)], term: jump(2) },
      { ops: [store(1)], term: jump(3) },
      { ops: [load(1)], term: end },
    ],
  );
  const color = groups(ir);
  assert.notEqual(color[0], color[1]);
});

test("a value live around a loop interferes with every slot used inside it", () => {
  // s0 is defined before the loop and read after it; s1 is loop-local.
  const ir = fn(
    ["reference", "reference"],
    [
      { ops: [store(0)], term: jump(1) },
      { ops: [store(1), load(1)], term: branch(1, 2) },
      { ops: [load(0)], term: end },
    ],
  );
  const color = groups(ir);
  assert.notEqual(color[0], color[1]);
});

test("a slot read before any write on some path stays live from entry", () => {
  // s1 is read in B2 having been written only on the B1 path; it is live
  // through B0 and so cannot reuse s0's word.
  const ir = fn(
    ["reference", "reference"],
    [
      { ops: [store(0), load(0)], term: branch(1, 2) },
      { ops: [store(1)], term: jump(2) },
      { ops: [load(1)], term: end },
    ],
  );
  const color = groups(ir);
  assert.notEqual(color[0], color[1]);
});

test("a slot live into a handler is live throughout every throwing block", () => {
  // B1 may throw to B3, which reads s0. s1 is stored and read inside B1 only,
  // after s0's last normal use, but a throw may happen before that store.
  const ir = fn(
    ["reference", "reference"],
    [
      { ops: [store(0)], term: jump(1) },
      { ops: [store(1), load(1)], term: jump(2), handler: 3 },
      { ops: [], term: end },
      { ops: [load(0)], term: end },
    ],
  );
  const color = groups(ir);
  assert.notEqual(color[0], color[1]);
});

test("guarded reads define their slot only on the consequent edge", () => {
  // s1 is the transfer slot of B1's guarded read. Its alternate edge reaches
  // B3, which still reads s1's earlier value from B0, so s1 is live through
  // B1 and s0 (live B0..B1) cannot share with it.
  const ir = fn(
    ["reference", "reference", "reference"],
    [
      { ops: [store(1), store(0)], term: jump(1) },
      { ops: [load(0)], term: guardedRead(1, 2, 3) },
      { ops: [load(1)], term: end },
      { ops: [load(1)], term: end },
    ],
  );
  const color = groups(ir);
  assert.notEqual(color[0], color[1]);
  // With a trapping alternate, the transfer slot starts at the guard.
  const trapped = fn(
    ["reference", "reference"],
    [
      { ops: [store(0)], term: jump(1) },
      { ops: [load(0)], term: guardedRead(1, 2, 3) },
      { ops: [load(1)], term: end },
      { ops: [], term: { ...at, kind: "trap" } },
    ],
  );
  const shared = groups(trapped);
  // s0 and s1 both occupy B1 (s0 read, s1 written), so they stay apart.
  assert.notEqual(shared[0], shared[1]);
});

test("ineligible slots keep private offsets and report no shared owner", () => {
  const ir = fn(
    ["reference", "reference"],
    [
      { ops: [store(0)], term: jump(1) },
      { ops: [load(0)], term: jump(2) },
      { ops: [store(1)], term: jump(3) },
      { ops: [load(1)], term: end },
    ],
  );
  const sharing = shareFrameSlots(ir, (slot) => slot !== 1, 1_000_000);
  assert.ok(sharing);
  assert.equal(sharing.color[1], 0);
  assert.equal(sharing.otherLiveIn(1, 3), false);
  const both = shareFrameSlots(ir, () => true, 1_000_000);
  assert.ok(both);
  // s1 is live into B3; clearing slot 0's dead word there would destroy it.
  assert.equal(both.otherLiveIn(0, 3), true);
  assert.equal(both.otherLiveIn(1, 3), false);
  assert.equal(
    shareFrameSlots(ir, () => true, 3),
    undefined,
  );
});
