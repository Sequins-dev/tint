import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionIR, Instruction, Terminator } from "@tint/ir/scalar";
import { shareFrameSlots } from "../src/scalar/slot-sharing.ts";

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

test("shared owners match per-slot liveness across many groups and blocks", () => {
  // Seeded random CFG: each block loads/stores a few slots and jumps or
  // branches forward and back. The reference recomputes liveness per slot
  // with a fixpoint and asks for another live slot of the same group.
  let seed = 0x2545f491;
  const random = (limit: number): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 8) % limit;
  };
  const blockCount = 240,
    slotCount = 160;
  const types = Array.from({ length: slotCount }, (_, slot) =>
    slot % 3 === 0 ? "number" : "reference",
  );
  const shapes: BlockShape[] = [],
    stored: number[] = [];
  for (let block = 0; block < blockCount; block++) {
    // Short live ranges: store a slot, load it again one to three blocks on.
    const ops: Instruction[] = [];
    for (const back of [1, 2, 3]) {
      const from = stored[block - back];
      if (from !== undefined && random(2) === 0) ops.push(load(from));
    }
    const slot = random(slotCount);
    stored.push(slot);
    ops.push(store(slot));
    const next = Math.min(block + 1, blockCount - 1);
    const term =
      block === blockCount - 1
        ? end
        : random(8) === 0
          ? branch(next, Math.max(0, block - random(4)))
          : jump(next);
    shapes.push({ ops, term });
  }
  const ir = fn(types, shapes);
  const sharing = shareFrameSlots(ir, () => true, 10_000_000);
  assert.ok(sharing);
  const successors = shapes.map((shape) =>
    shape.term.kind === "jump"
      ? [shape.term.target]
      : shape.term.kind === "branch"
        ? [shape.term.consequent, shape.term.alternate]
        : [],
  );
  const live: boolean[][] = [];
  for (let slot = 0; slot < slotCount; slot++) {
    const liveIn = new Array<boolean>(blockCount).fill(false);
    let changed = true;
    while (changed) {
      changed = false;
      for (let block = blockCount - 1; block >= 0; block--) {
        let value = (successors[block] ?? []).some((s) => liveIn[s]);
        const ops = shapes[block]?.ops ?? [];
        for (let i = ops.length - 1; i >= 0; i--) {
          const op = ops[i] as { kind: string; slot: number };
          if (op.slot !== slot) continue;
          value = op.kind === "load";
        }
        if (value !== liveIn[block]) {
          liveIn[block] = value;
          changed = true;
        }
      }
    }
    live.push(liveIn);
  }
  let owned = 0;
  const color: Uint32Array = sharing.color;
  for (let slot = 0; slot < slotCount; slot++)
    for (let block = 0; block < blockCount; block++) {
      const group: number | undefined = color[slot];
      const expected: boolean =
        group !== 0 &&
        live.some(
          (liveIn, other) =>
            other !== slot && color[other] === group && liveIn[block] === true,
        );
      if (expected) owned++;
      assert.equal(
        sharing.otherLiveIn(slot, block),
        expected,
        `slot ${slot} block ${block}`,
      );
    }
  assert.ok(owned > 100, `exercise many owners (${owned})`);
  assert.ok(sharing.colors > 8);
  const withoutOwners = shareFrameSlots(
    ir,
    () => true,
    10_000_000,
    undefined,
    false,
  );
  assert.ok(withoutOwners !== undefined);
  assert.equal(withoutOwners.colors, sharing.colors);
  assert.deepEqual(withoutOwners.color, sharing.color);
  assert.throws(
    () => withoutOwners.otherLiveIn(0, 0),
    /owner tracking disabled/,
  );
});

test("deferred packed bit-row owner lookup matches exact liveness on dense shared groups", () => {
  // Two slots share one group over a long chain so packed bit rows are strictly
  // smaller than an open-addressed hash table (12 bytes/entry vs 2 bits/block).
  const blockCount = 128;
  const shapes: BlockShape[] = [];
  for (let block = 0; block < blockCount; block++) {
    const ops: Instruction[] = [];
    if (block === 0) ops.push(store(0));
    if (block === 60) ops.push(load(0));
    if (block === 64) ops.push(store(1));
    if (block === 127) ops.push(load(1));
    // Slot 2 is live across the entire function -> singleton group.
    if (block === 0) ops.push(store(2));
    if (block === 127) ops.push(load(2));
    shapes.push({
      ops,
      term: block === blockCount - 1 ? end : jump(block + 1),
    });
  }
  const ir = fn(["reference", "reference", "reference"], shapes);
  const sharing = shareFrameSlots(ir, () => true, 10_000_000);
  assert.ok(sharing);
  assert.equal(sharing.color[0], sharing.color[1]);
  assert.notEqual(sharing.color[2], sharing.color[0]);
  for (let block = 0; block < blockCount; block++) {
    // Slot 0 is live-in on blocks 1..60; slot 1 is live-in on blocks 65..127.
    assert.equal(
      sharing.otherLiveIn(0, block),
      block >= 65 && block <= 127,
      `slot 0 block ${block}`,
    );
    assert.equal(
      sharing.otherLiveIn(1, block),
      block >= 1 && block <= 60,
      `slot 1 block ${block}`,
    );
    // Singleton group never has another live-in slot.
    assert.equal(sharing.otherLiveIn(2, block), false, `slot 2 block ${block}`);
  }
});

test("dense occupancy bit-row promotion preserves exact coloring across >1024 blocks and bit-31 boundaries", () => {
  // 1,100 blocks spans 35 bit-row words and 2 summary words (including word 31
  // = bit 31 of summary word 0). With 12 densely live slots (~6,000+ entries),
  // sparse Uint16Array growth exceeds dense bit-row bytes (~1.8 KiB) and
  // promotes mid-run to dense occupancy bit rows with active-word probing.
  const blockCount = 1100;
  const shapes: BlockShape[] = [];
  for (let block = 0; block < blockCount; block++) {
    const ops: Instruction[] = [];
    // Slots 0..5 are live across the entire 1,100-block chain (must stay
    // distinct and force promotion).
    if (block === 0) for (let s = 0; s < 6; s++) ops.push(store(s));
    if (block === blockCount - 1) for (let s = 0; s < 6; s++) ops.push(load(s));
    // Slot 6 lives in blocks 0..500; slot 7 lives in blocks 501..1099 -> must share!
    if (block === 0) ops.push(store(6));
    if (block === 500) ops.push(load(6));
    if (block === 501) ops.push(store(7));
    if (block === 1099) ops.push(load(7));
    // Slot 8 lives across word-31 boundary (blocks 990..1030); slot 9 lives
    // in blocks 0..989 -> must share! Slot 10 touches block 1024 -> conflicts
    // with slot 8 (summary word 1, bit 0), so shares with slot 9 instead? No,
    // slot 10 lives 1024..1099 (disjoint from slot 9: 0..989) -> shares with 9!
    if (block === 990) ops.push(store(8));
    if (block === 1030) ops.push(load(8));
    if (block === 0) ops.push(store(9));
    if (block === 989) ops.push(load(9));
    if (block === 1024) ops.push(store(10));
    if (block === 1099) ops.push(load(10));
    // Slot 11 is ineligible (private).
    if (block === 10) ops.push(store(11));
    if (block === 1080) ops.push(load(11));
    shapes.push({
      ops,
      term: block === blockCount - 1 ? end : jump(block + 1),
    });
  }
  const types = Array.from({ length: 12 }, () => "number" as const);
  const ir = fn(types, shapes);
  const withOwners = shareFrameSlots(
    ir,
    (s) => s !== 11,
    10_000_000,
    undefined,
    true,
  );
  const withoutOwners = shareFrameSlots(
    ir,
    (s) => s !== 11,
    10_000_000,
    undefined,
    false,
  );
  assert.ok(withOwners);
  assert.ok(withoutOwners);
  assert.equal(withOwners.colors, withoutOwners.colors);
  assert.deepEqual(withOwners.color, withoutOwners.color);
  // Ineligible slot stays private.
  assert.equal(withOwners.color[11], 0);
  // Slots 0..5 all mutually overlap -> 6 distinct groups.
  const firstSix = new Set(
    Array.from({ length: 6 }, (_, s) => withOwners.color[s]),
  );
  assert.equal(firstSix.size, 6);
  // Disjoint pairs share groups.
  assert.equal(withOwners.color[6], withOwners.color[7]);
  assert.equal(withOwners.color[8], withOwners.color[9]);
  assert.notEqual(withOwners.color[8], withOwners.color[10]);
  assert.equal(withOwners.color[9], withOwners.color[8]);
  assert.notEqual(withOwners.color[6], withOwners.color[8]);
  // Owner lookup agrees across the entire 1,100-block range.
  assert.equal(withOwners.otherLiveIn(6, 502), true);
  assert.equal(withOwners.otherLiveIn(6, 500), false);
  assert.equal(withOwners.otherLiveIn(7, 100), true);
  assert.equal(withOwners.otherLiveIn(7, 501), false);
  assert.equal(withOwners.otherLiveIn(8, 500), true);
  assert.equal(withOwners.otherLiveIn(9, 1024), true);
});
