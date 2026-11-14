import {
  analyzeLiveSlots,
  naturalLoops,
  type FunctionIR,
  type Instruction,
} from "@tint/ir/scalar";
import { canInlineCellAccess } from "./leaf-registers.ts";

/** Callee-saved register homes for slots. */
export interface SlotHomes {
  /** Per slot: an FP register (8..15), 32 + a GP register, or 0. */
  readonly registers: Uint8Array;
  /** FP homes are d8..d(8 + floatCount - 1). */
  readonly floatCount: number;
  /** GP registers holding word and reference slots. */
  readonly saved: readonly number[];
  /** Per block, per instruction index: register-homed reference slots live
   * after that instruction, which may collect. The emitter stores them to
   * their frame words before it and reloads them after it. */
  readonly spills: readonly (
    readonly (readonly number[] | undefined)[] | undefined
  )[];
}

/** Reference homes: which slots may hold managed single-word references in
 * registers, and which instructions may collect (safepoints). */
export interface ReferenceHomes {
  readonly eligible: (slot: number) => boolean;
  readonly collects: (op: Instruction) => boolean;
}

/** Assigns callee-saved registers to slot groups: slots sharing a frame word
 * (`groups[slot]`, see shareFrameSlots; 0 for a private word) never occupy
 * the same block, so one register can hold all of them. Numbers take
 * d8..d15; integer slots (int64 storage), booleans and references take
 * `words` in order. Groups are ranked by accesses weighted by loop depth
 * (4 per level), so loop-carried slots win over straight-line ones; a
 * reference group is charged a store and a reload for every safepoint it is
 * live across, since the collector scans and updates frame words only. Calls
 * and helpers preserve these registers, so homes hold for the whole
 * function. Slots whose cells escape to helpers keep their frame words, as
 * do groups mixing register classes. Reference homes are never live into an
 * exception handler: a throw can leave the frame word stale. */
export function slotHomes(
  fn: FunctionIR,
  integerSlots: Uint8Array,
  groups: Uint32Array | undefined,
  words: readonly number[],
  references: ReferenceHomes | undefined,
  maxWork: number = 2000000,
): SlotHomes | undefined {
  const count = fn.slots.length;
  if (!Number.isSafeInteger(maxWork) || maxWork < 1 || count > 65536)
    return undefined;
  let work = count * 4;
  if (work > maxWork) return undefined;
  // Loop depth per block (blocks are dense by ID in verified IR).
  const blockCount = fn.blocks.length,
    depth = new Uint8Array(blockCount),
    forest = naturalLoops(fn, Math.max(1, maxWork - work));
  if (forest !== undefined) {
    work += forest.visited;
    for (const loop of forest.loops) {
      if (loop === undefined) throw "slot home loop invariant";
      for (const block of loop.body)
        if (block < blockCount && (depth[block] ?? 0) < 255)
          depth[block] = (depth[block] ?? 0) + 1;
    }
  }
  // 4 per loop level, capped at six levels.
  const depthWeights = [1, 4, 16, 64, 256, 1024, 4096];
  const blockWeight = (block: number): number =>
    depthWeights[Math.min(depth[block] ?? 0, 6)] ?? 4096;
  const weights = new Float64Array(count),
    escaped = new Uint8Array(count),
    handlerSlot = new Uint8Array(count);
  let escapes = false;
  for (const block of fn.blocks) {
    if (block === undefined) throw "slot home block invariant";
    const weight = blockWeight(block.id);
    if (block.exception !== undefined) handlerSlot[block.exception.slot] = 1;
    for (const op of block.instructions) {
      if (op === undefined) throw "slot home instruction invariant";
      if (++work > maxWork) return undefined;
      if (op.kind === "load" || op.kind === "store")
        weights[op.slot] = (weights[op.slot] ?? 0) + weight;
    }
    const term = block.terminator;
    if (term.kind === "cell" || term.kind === "record-cell") {
      if (canInlineCellAccess(fn, term))
        weights[term.slot] = (weights[term.slot] ?? 0) + weight;
      else {
        escaped[term.slot] = 1;
        escapes = true;
      }
    } else if (term.kind === "record")
      weights[term.slot] = (weights[term.slot] ?? 0) + weight;
  }
  // Reference candidates: worth more than a save, not live into a handler.
  const eligible = references === undefined ? undefined : references.eligible,
    collects = references === undefined ? undefined : references.collects;
  const candidates: number[] = [];
  if (eligible !== undefined && !escapes)
    for (let slot = 0; slot < count; slot++)
      if (
        eligible(slot) &&
        handlerSlot[slot] !== 1 &&
        fn.receiverSlot !== slot &&
        (weights[slot] ?? 0) > 1
      )
        candidates.push(slot);
  const liveIn =
    candidates.length === 0
      ? undefined
      : analyzeLiveSlots(fn, Math.max(1, maxWork - work), candidates);
  if (liveIn !== undefined) work += liveIn.work;
  // Live candidates as a sparse set (members plus positions), so resetting
  // per block and listing the live set at each safepoint cost only the live
  // slots, not the function's slot count.
  const candidate = new Uint8Array(count),
    position = new Uint32Array(count),
    members: number[] = [],
    crossings = new Float64Array(count),
    // Per block, per collecting instruction: candidates live after it.
    afterSets: (number[] | undefined)[][] = [];
  for (const slot of candidates) if (slot !== undefined) candidate[slot] = 1;
  function enter(slot: number): void {
    if (candidate[slot] !== 1) return;
    const at = position[slot] ?? 0;
    if (at > 0 && members[at - 1] === slot) return;
    members.push(slot);
    position[slot] = members.length;
  }
  function leave(slot: number): void {
    const at = position[slot] ?? 0;
    if (at === 0 || members[at - 1] !== slot) return;
    const last = members.pop();
    if (last === undefined) throw "slot home live set invariant";
    if (last !== slot) {
      members[at - 1] = last;
      position[last] = at;
    }
    position[slot] = 0;
  }
  if (liveIn !== undefined) {
    for (const block of fn.blocks) {
      if (block === undefined) throw "slot home block invariant";
      const handler = block.exception;
      if (handler !== undefined)
        for (const slot of liveIn.slots[handler.target] ?? [])
          if (slot !== undefined) handlerSlot[slot] = 1;
    }
    for (const block of fn.blocks) {
      if (block === undefined) throw "slot home block invariant";
      // Live-out: every successor's live-in (read terminators define their
      // slot only on the consequent edge; counting it live is conservative).
      for (const slot of members) if (slot !== undefined) position[slot] = 0;
      members.length = 0;
      const t = block.terminator,
        successors: number[] = [];
      if (t.kind === "jump") successors.push(t.target);
      else if (t.kind === "branch") {
        successors.push(t.consequent);
        successors.push(t.alternate);
      } else if (
        t.kind === "record" ||
        t.kind === "record-cell" ||
        t.kind === "cell"
      ) {
        successors.push(t.consequent);
        successors.push(t.alternate);
        enter(t.slot);
      }
      for (const successor of successors) {
        if (successor === undefined) throw "slot home successor invariant";
        const slots = liveIn.slots[successor] ?? [];
        work += slots.length;
        for (const slot of slots) if (slot !== undefined) enter(slot);
      }
      if (++work > maxWork) return undefined;
      const sets: (number[] | undefined)[] = [];
      const weight = blockWeight(block.id);
      for (let index = block.instructions.length - 1; index >= 0; index--) {
        const op = block.instructions[index];
        if (op === undefined) throw "slot home instruction invariant";
        if (++work > maxWork) return undefined;
        if (collects !== undefined && collects(op)) {
          const after = members.slice();
          for (const slot of after)
            if (slot !== undefined)
              crossings[slot] = (crossings[slot] ?? 0) + weight;
          sets[index] = after;
          work += after.length;
        }
        if (op.kind === "store") leave(op.slot);
        else if (op.kind === "load") enter(op.slot);
      }
      afterSets[block.id] = sets;
    }
  }
  // Group key: shared group, or a private key per slot.
  const groupCount = count + 1,
    key = (slot: number): number => {
      const shared = groups === undefined ? 0 : (groups[slot] ?? 0);
      return shared !== 0 ? shared : groupCount + slot;
    };
  // Class per group: 1 float, 2 word, 4 reference, 3 mixed or ineligible.
  const classes = new Map<number, number>(),
    totals = new Map<number, number>();
  const referenceCandidate = new Uint8Array(count);
  if (liveIn !== undefined)
    for (const slot of candidates)
      if (slot !== undefined && handlerSlot[slot] !== 1)
        referenceCandidate[slot] = 1;
  for (let slot = 0; slot < count; slot++) {
    if (++work > maxWork) return undefined;
    const type = fn.slots[slot];
    const group = key(slot);
    const integer = integerSlots[slot] === 1;
    const kind =
      escaped[slot] === 1 || fn.receiverSlot === slot
        ? 3
        : integer || type === "boolean"
          ? 2
          : type === "number"
            ? 1
            : referenceCandidate[slot] === 1
              ? 4
              : eligible !== undefined && eligible(slot)
                ? 3
                : 0;
    if (kind === 0) continue;
    const previous = classes.get(group);
    classes.set(group, previous === undefined || previous === kind ? kind : 3);
    totals.set(
      group,
      (totals.get(group) ?? 0) +
        (weights[slot] ?? 0) -
        (kind === 4 ? 2 * (crossings[slot] ?? 0) : 0),
    );
  }
  // Rank each register class; one access alone does not pay for a save.
  const floats: number[] = [],
    gpGroups: number[] = [];
  for (const [group, kind] of classes) {
    if ((totals.get(group) ?? 0) <= 1) continue;
    if (kind === 1) floats.push(group);
    else if (kind === 2 || kind === 4) gpGroups.push(group);
  }
  const byWeight = (a: number, b: number): number =>
    (totals.get(b) ?? 0) - (totals.get(a) ?? 0) || a - b;
  floats.sort(byWeight);
  gpGroups.sort(byWeight);
  const assigned = new Map<number, number>();
  let floatCount = 0;
  for (const group of floats) {
    if (group === undefined) throw "slot home group invariant";
    if (floatCount >= 8) break;
    assigned.set(group, 8 + floatCount);
    floatCount++;
  }
  const saved: number[] = [];
  for (const group of gpGroups) {
    if (group === undefined) throw "slot home group invariant";
    const register = words[saved.length];
    if (register === undefined) break;
    assigned.set(group, 32 + register);
    saved.push(register);
  }
  const registers = new Uint8Array(count),
    homedReference = new Uint8Array(count);
  for (let slot = 0; slot < count; slot++) {
    const home = assigned.get(key(slot));
    const kind = classes.get(key(slot));
    if (home === undefined || kind === undefined) continue;
    if (kind === 1 || kind === 2 || kind === 4) registers[slot] = home;
    if (kind === 4) homedReference[slot] = 1;
  }
  const spills: ((readonly number[] | undefined)[] | undefined)[] = [];
  for (let block = 0; block < afterSets.length; block++) {
    const sets = afterSets[block];
    if (sets === undefined) continue;
    const lists: (readonly number[] | undefined)[] = [];
    let any = false;
    for (let index = 0; index < sets.length; index++) {
      const after = sets[index];
      if (after === undefined) continue;
      const list: number[] = [];
      for (const slot of after)
        if (slot !== undefined && homedReference[slot] === 1) list.push(slot);
      list.sort((left, right) => left - right);
      if (list.length > 0) {
        lists[index] = list;
        any = true;
      }
    }
    if (any) spills[block] = lists;
  }
  return { registers, floatCount, saved, spills };
}
