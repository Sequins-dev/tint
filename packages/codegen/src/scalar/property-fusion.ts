import {
  blockSuccessors,
  type Block,
  type FunctionIR,
  type Instruction,
} from "@tint/ir/scalar";

/** The part a block plays in a fused cached property access (or inline
 * element access, which misses and tests the same way): the access
 * itself (`access`, whose miss jumps to `miss` directly), the miss test the
 * branch reads (`test`, not emitted; the branch goes to `hit`), or both. */
export interface FusedPropertyAccess {
  readonly access: number | undefined;
  readonly miss: number;
  readonly test: number | undefined;
  readonly hit: number;
  /** Indices of the access block's stores after the load whose slots only
   * the skipped test reads (such as an inlined test's parameter): neither
   * edge observes them, so they are not emitted. */
  readonly skipped: readonly number[];
}

/** Instructions a miss may skip besides stores: block-local values without
 * effects that cannot trap. */
function skippable(op: Instruction): boolean {
  return (
    op.kind === "load" ||
    op.kind === "constant" ||
    op.kind === "string-literal" ||
    op.kind === "reference-none" ||
    op.kind === "general-none" ||
    op.kind === "record-read" ||
    op.kind === "general-is" ||
    (op.kind === "general-value" && op.unchecked === true)
  );
}

/** Whether some path from `start` reads one of `slots` before writing it:
 * a slot load, a terminator writing from the slot, or (conservatively) any
 * reach of an exception handler. Undefined past `budget` blocks. */
function slotsLiveAt(
  fn: FunctionIR,
  start: number,
  slots: readonly number[],
  budget: number,
): boolean | undefined {
  const seen = new Set<string>();
  const initial = slots.slice();
  initial.sort((a: number, b: number): number => a - b);
  const pending: { readonly block: number; readonly live: number[] }[] = [];
  pending.push({ block: start, live: initial });
  while (pending.length > 0) {
    const next = pending.pop();
    if (next === undefined) throw "property fusion worklist invariant";
    // Live sets only shrink along a path; each (block, set) is walked once.
    const key = String(next.block) + ":" + next.live.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > budget) return undefined;
    const block = fn.blocks[next.block];
    if (block === undefined) throw "property fusion block invariant";
    const live = next.live.slice();
    for (const op of block.instructions) {
      if (op === undefined) throw "property fusion instruction invariant";
      if (op.kind === "load" && live.indexOf(op.slot) >= 0) return true;
      if (op.kind === "store") {
        const at = live.indexOf(op.slot);
        if (at >= 0) live.splice(at, 1);
      }
    }
    if (live.length === 0) continue;
    const t = block.terminator;
    if (
      (t.kind === "record" || t.kind === "record-cell" || t.kind === "cell") &&
      t.operation !== "read" &&
      live.indexOf(t.slot) >= 0
    )
      return true;
    if (block.exception !== undefined) return true;
    for (const successor of blockSuccessors(block)) {
      if (successor === undefined) throw "property fusion successor invariant";
      pending.push({ block: successor, live });
    }
  }
  return false;
}

/** Blocks taking part in a fusable cached property access.
 *
 * A store qualifies when it is its block's last instruction and the branch
 * reads its result (true selects the consequent, the hit).
 *
 * A load qualifies when only skippable instructions and stores follow it in
 * its block, which either ends in the branch or jumps to a block (with no
 * other predecessor) of slot loads and constants only that ends in it, and
 * the branch reads the absent test of the load's value (directly or through
 * slots it was stored to) as the block's last instruction. Every slot those
 * stores write must be dead where the miss continues, so skipping them is
 * unobservable. */
/** A load whose miss is the absent value. */
function missingLoad(op: Instruction | undefined): boolean {
  return op?.kind === "property-load" || op?.kind === "element-load";
}
/** Predecessor counts over normal and exceptional edges. */
function predecessorCounts(fn: FunctionIR): Uint32Array {
  const counts = new Uint32Array(fn.blocks.length);
  for (const block of fn.blocks) {
    if (block === undefined) throw "property fusion block invariant";
    for (const successor of blockSuccessors(block))
      if (successor !== undefined)
        counts[successor] = (counts[successor] ?? 0) + 1;
  }
  return counts;
}
/** What follows a property-load: the values and slots holding its value,
 * and every slot stored after it. */
interface LoadUses {
  readonly aliases: Set<number>;
  readonly aliasSlots: number[];
  readonly stored: number[];
}
/** Track a store or load after the access; false for anything else. */
function followLoad(uses: LoadUses, op: Instruction): boolean {
  if (op.kind === "store") {
    uses.stored.push(op.slot);
    const at = uses.aliasSlots.indexOf(op.slot);
    if (uses.aliases.has(op.value)) {
      if (at < 0) uses.aliasSlots.push(op.slot);
    } else if (at >= 0) uses.aliasSlots.splice(at, 1);
    return true;
  }
  if (op.kind === "load") {
    if (uses.aliasSlots.indexOf(op.slot) >= 0) uses.aliases.add(op.id);
    return true;
  }
  return false;
}

/** Blocks taking part in a fusable cached property access.
 *
 * A store qualifies when it is its block's last instruction and the branch
 * reads its result (true selects the consequent, the hit).
 *
 * A load qualifies when only skippable instructions and stores follow it in
 * its block, which either ends in the branch or jumps to a block (with no
 * other predecessor) of slot loads and constants only that ends in it, and
 * the branch reads the absent test of the load's value (directly or through
 * slots it was stored to) as the block's last instruction. Every slot those
 * stores write must be dead where the miss continues, so skipping them is
 * unobservable. */
export function fusedPropertyAccesses(
  fn: FunctionIR,
  budget: number = 4096,
): ReadonlyMap<number, FusedPropertyAccess> {
  const fused = new Map<number, FusedPropertyAccess>();
  const none = new Uint32Array(0);
  let counted: Uint32Array = none;
  for (const block of fn.blocks) {
    if (block === undefined) throw "property fusion block invariant";
    const t = block.terminator;
    const final = block.instructions[block.instructions.length - 1];
    if (
      t.kind === "branch" &&
      t.consequent !== t.alternate &&
      final !== undefined &&
      (final.kind === "property-store" || final.kind === "element-store") &&
      final.id === t.condition
    ) {
      fused.set(block.id, {
        access: final.id,
        miss: t.alternate,
        test: final.id,
        hit: t.consequent,
        skipped: [],
      });
      continue;
    }
    // The last property-load (or element-load) and what follows it.
    let index = block.instructions.length - 1;
    while (index >= 0 && !missingLoad(block.instructions[index])) index--;
    const load = block.instructions[index];
    if (
      load === undefined ||
      (load.kind !== "property-load" && load.kind !== "element-load")
    )
      continue;
    const uses: LoadUses = {
      aliases: new Set<number>(),
      aliasSlots: [],
      stored: [],
    };
    uses.aliases.add(load.id);
    const last = block.instructions.length - 1;
    let valid: boolean = true;
    for (let next = index + 1; next <= last && valid; next++) {
      const op = block.instructions[next];
      if (op === undefined) throw "property fusion instruction invariant";
      const test =
        next === last && t.kind === "branch" && op.kind === "general-is";
      if (!followLoad(uses, op) && !test && !skippable(op)) valid = false;
    }
    if (!valid) continue;
    let testBlock: Block = block;
    if (t.kind === "jump") {
      const target = fn.blocks[t.target];
      if (target === undefined || target.id === block.id) continue;
      if (counted.length === 0) counted = predecessorCounts(fn);
      const predecessors = counted;
      if (predecessors[target.id] !== 1 || target.exception !== undefined)
        continue;
      const targetLast = target.instructions.length - 1;
      for (let next = 0; next < targetLast && valid; next++) {
        const op = target.instructions[next];
        if (op === undefined) throw "property fusion instruction invariant";
        if (op.kind === "load") followLoad(uses, op);
        else if (
          op.kind !== "constant" &&
          op.kind !== "reference-none" &&
          op.kind !== "general-none"
        )
          valid = false;
      }
      if (!valid) continue;
      testBlock = target;
    }
    const branch = testBlock.terminator;
    const test = testBlock.instructions[testBlock.instructions.length - 1];
    if (
      branch.kind !== "branch" ||
      branch.consequent === branch.alternate ||
      test === undefined ||
      test.kind !== "general-is" ||
      test.type !== "absent" ||
      test.id !== branch.condition ||
      !uses.aliases.has(test.value)
    )
      continue;
    // The test is true when the load missed.
    if (
      uses.stored.length > 0 &&
      slotsLiveAt(fn, branch.consequent, uses.stored, budget) !== false
    )
      continue;
    // A store no later instruction of the block reads, whose slot only
    // the test block loads (for the test alone) and is dead on the hit
    // edge, is not emitted.
    const skipped: number[] = [];
    if (testBlock !== block)
      for (let next = index + 1; next <= last; next++) {
        const op = block.instructions[next];
        if (op === undefined) throw "property fusion instruction invariant";
        if (op.kind !== "store") continue;
        let read: boolean = false;
        for (let later = next + 1; later <= last; later++) {
          const after = block.instructions[later];
          if (after === undefined)
            throw "property fusion instruction invariant";
          if (after.kind === "load" && after.slot === op.slot) read = true;
        }
        const slots: number[] = [];
        slots.push(op.slot);
        if (!read && slotsLiveAt(fn, branch.alternate, slots, budget) === false)
          skipped.push(next);
      }
    fused.set(block.id, {
      access: load.id,
      miss: branch.consequent,
      test: testBlock === block ? test.id : undefined,
      hit: branch.alternate,
      skipped,
    });
    if (testBlock !== block)
      fused.set(testBlock.id, {
        access: undefined,
        miss: branch.consequent,
        test: test.id,
        hit: branch.alternate,
        skipped: [],
      });
  }
  return fused;
}
