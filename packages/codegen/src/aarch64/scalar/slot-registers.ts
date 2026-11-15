import {
  analyzeLiveSlots,
  naturalLoops,
  visitInstructionOperands,
  visitTerminatorOperands,
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
   * after that instruction, which may collect. Its stack map lists their
   * registers; the collector updates them where callees saved them. */
  readonly registerRoots: readonly (
    readonly (readonly number[] | undefined)[] | undefined
  )[];
  /** False when the interference analysis exceeded its budget, so each
   * group took a register of its own (pass statistics report this). */
  readonly shared: boolean;
}
/** Groups per register class whose interference is tracked; lower-ranked
 * groups keep their frame words. Bounds the interference matrices. */
const rankedGroupLimit = 1024;

/** Reference homes: which slots may hold managed single-word references in
 * registers, and which instructions may collect (safepoints). */
export interface ReferenceHomes {
  readonly eligible: (slot: number) => boolean;
  readonly collects: (op: Instruction) => boolean;
}

/** Slot types homed in d8..d15: numbers and NaN-boxed optional numbers. Every
 * such slot must also join the interference liveness, or a group sharing
 * its register would overwrite it while it is live. */
function floatSlotType(type: string | undefined): boolean {
  return type === "number" || type === "optional-number";
}

/** Assigns callee-saved registers to slot groups: slots sharing a frame word
 * (`groups[slot]`, see shareFrameSlots; 0 for a private word) never occupy
 * the same block, so one register can hold all of them. Groups whose slots
 * never interfere at instruction grain share a register too: no slot of one
 * is written (stored, defined at entry or by a handler or terminator) while
 * a slot of the other is live, where a slot stays live until the last use of
 * any value loaded from it (a load may alias its slot's home). Numbers and
 * NaN-boxed optional numbers take d8..d15; integer slots (int64 storage),
 * booleans and references take `words` in order, first fit, so the registers used are a prefix of each
 * class. Groups are ranked by accesses weighted by loop depth
 * (4 per level), so loop-carried slots win over straight-line ones. A
 * reference home stays in its register across safepoints: stack maps list
 * the register, and the collector updates the save slot of the callee that
 * preserved it. Calls and helpers preserve these registers, so homes hold
 * for the whole function. Slots whose cells escape to helpers keep their
 * frame words, as do groups mixing register classes. Reference homes are
 * never live into an exception handler (safepoint register lists cover
 * only what is live after each call). */
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
  // One liveness for every slot that may take a home: reference candidates
  // (for safepoint register lists) and non-escaped numbers, optional numbers,
  // integers and booleans (for interference). Without it, groups take private registers.
  const homeable: number[] = [];
  for (let slot = 0; slot < count; slot++) {
    const type = fn.slots[slot];
    if (
      escaped[slot] !== 1 &&
      fn.receiverSlot !== slot &&
      (integerSlots[slot] === 1 || type === "boolean" || floatSlotType(type))
    )
      homeable.push(slot);
  }
  for (const slot of candidates) if (slot !== undefined) homeable.push(slot);
  const allLive =
    homeable.length === 0
      ? undefined
      : analyzeLiveSlots(fn, Math.max(1, maxWork - work), homeable);
  const liveIn =
    allLive !== undefined
      ? allLive
      : candidates.length === 0
        ? undefined
        : analyzeLiveSlots(fn, Math.max(1, maxWork - work), candidates);
  if (liveIn !== undefined) work += liveIn.work;
  let shared = homeable.length === 0 || allLive !== undefined;
  // Live candidates as a sparse set (members plus positions), so resetting
  // per block and listing the live set at each safepoint cost only the live
  // slots, not the function's slot count.
  const candidate = new Uint8Array(count),
    position = new Uint32Array(count),
    members: number[] = [],
    // Per block, per collecting instruction: candidates live after it.
    afterSets: (number[] | undefined)[][] = [];
  for (const slot of candidates) if (slot !== undefined) candidate[slot] = 1;
  function enter(slot: number, tracked: Uint8Array): void {
    if (tracked[slot] !== 1) return;
    const at = position[slot] ?? 0;
    if (at > 0 && members[at - 1] === slot) return;
    members.push(slot);
    position[slot] = members.length;
  }
  function clearMembers(): void {
    for (const slot of members) if (slot !== undefined) position[slot] = 0;
    members.length = 0;
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
  if (liveIn !== undefined && candidates.length > 0) {
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
      clearMembers();
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
        enter(t.slot, candidate);
      }
      for (const successor of successors) {
        if (successor === undefined) throw "slot home successor invariant";
        const slots = liveIn.slots[successor] ?? [];
        work += slots.length;
        for (const slot of slots)
          if (slot !== undefined) enter(slot, candidate);
      }
      if (++work > maxWork) return undefined;
      const sets: (number[] | undefined)[] = [];
      for (let index = block.instructions.length - 1; index >= 0; index--) {
        const op = block.instructions[index];
        if (op === undefined) throw "slot home instruction invariant";
        if (++work > maxWork) return undefined;
        if (collects !== undefined && collects(op)) {
          const after = members.slice();
          sets[index] = after;
          work += after.length;
        }
        if (op.kind === "store") leave(op.slot);
        else if (op.kind === "load") enter(op.slot, candidate);
      }
      afterSets[block.id] = sets;
    }
  }
  // Group key: shared group, or a private key per slot.
  const groupCount = count + 1,
    key = (slot: number): number => {
      const group = groups === undefined ? 0 : (groups[slot] ?? 0);
      return group !== 0 ? group : groupCount + slot;
    };
  // Class per group: 1 float, 2 word, 4 reference, 3 mixed or ineligible.
  const classes = new Map<number, number>(),
    totals = new Map<number, number>();
  const referenceCandidate = new Uint8Array(count),
    slotKinds = new Uint8Array(count);
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
          : floatSlotType(type)
            ? 1
            : referenceCandidate[slot] === 1
              ? 4
              : eligible !== undefined && eligible(slot)
                ? 3
                : 0;
    slotKinds[slot] = kind;
    if (kind === 0) continue;
    const previous = classes.get(group);
    classes.set(group, previous === undefined || previous === kind ? kind : 3);
    totals.set(group, (totals.get(group) ?? 0) + (weights[slot] ?? 0));
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
  // Instruction-grain interference, built only for a class with more ranked
  // groups than registers (otherwise each group takes its own register).
  const floatRanked = Math.min(floats.length, rankedGroupLimit),
    gpRanked = Math.min(gpGroups.length, rankedGroupLimit),
    floatRow = floats.length > 8 ? (floatRanked + 31) >>> 5 : 0,
    gpRow = gpGroups.length > words.length ? (gpRanked + 31) >>> 5 : 0;
  /** Fills the interference matrices of the ranked groups (rank + 1 per
   * group key in `rankOf`); false when the work budget runs out. */
  function buildInterference(
    live: readonly (readonly number[])[],
    floatBits: Uint32Array,
    floatWords: number,
    gpBits: Uint32Array,
    gpWords: number,
  ): boolean {
    const keyCount = groupCount + count,
      rankOf = new Uint32Array(keyCount),
      floatKey = new Uint8Array(keyCount),
      tracked = new Uint8Array(count);
    if (floatWords > 0)
      for (let rank = 0; rank < floatRanked; rank++) {
        const group = floats[rank];
        if (group === undefined) throw "slot home rank invariant";
        rankOf[group] = rank + 1;
        floatKey[group] = 1;
      }
    if (gpWords > 0)
      for (let rank = 0; rank < gpRanked; rank++) {
        const group = gpGroups[rank];
        if (group === undefined) throw "slot home rank invariant";
        rankOf[group] = rank + 1;
      }
    for (let slot = 0; slot < count; slot++) {
      const kind = slotKinds[slot] ?? 0;
      if ((kind === 1 || kind === 2 || kind === 4) && rankOf[key(slot)] !== 0)
        tracked[slot] = 1;
    }
    function interfere(a: number, b: number): void {
      const left = key(a),
        right = key(b);
      if (left === right) return;
      const l = rankOf[left] ?? 0,
        r = rankOf[right] ?? 0;
      if (l === 0 || r === 0 || floatKey[left] !== floatKey[right]) return;
      const bits = floatKey[left] === 1 ? floatBits : gpBits,
        row = floatKey[left] === 1 ? floatWords : gpWords,
        lower = l - 1,
        upper = r - 1,
        across = lower * row + (upper >>> 5),
        back = upper * row + (lower >>> 5);
      bits[across] = (bits[across] ?? 0) | (1 << (upper & 31));
      bits[back] = (bits[back] ?? 0) | (1 << (lower & 31));
    }
    /** The slot written here interferes with every other live slot. */
    function written(slot: number): boolean {
      if (tracked[slot] !== 1) return true;
      work += members.length;
      if (work > maxWork) return false;
      for (const other of members)
        if (other !== undefined && other !== slot) interfere(slot, other);
      return true;
    }
    // Entry: parameters are written by the prologue and every other slot
    // live into the entry block starts as zero there, all at once.
    clearMembers();
    for (const slot of live[fn.entry] ?? [])
      if (slot !== undefined) enter(slot, tracked);
    for (const slot of fn.parameters)
      if (slot !== undefined) enter(slot, tracked);
    const entrySet = members.slice();
    for (const slot of entrySet)
      if (slot !== undefined && !written(slot)) return false;
    // A handler's exception slot is written on entry to the handler.
    for (const block of fn.blocks) {
      if (block === undefined) throw "slot home block invariant";
      const handler = block.exception;
      if (handler === undefined || tracked[handler.slot] !== 1) continue;
      clearMembers();
      for (const slot of live[handler.target] ?? [])
        if (slot !== undefined) enter(slot, tracked);
      if (!written(handler.slot)) return false;
    }
    // Slots a value loaded from them is still to be used, by value id.
    const loaded = new Map<number, number>(),
      protectedIn = new Uint32Array(count);
    const use = (id: number): void => {
      const slot = loaded.get(id);
      if (slot !== undefined) enter(slot, tracked);
    };
    for (const block of fn.blocks) {
      if (block === undefined) throw "slot home block invariant";
      if (++work > maxWork) return false;
      const stamp = block.id + 1,
        instructions = block.instructions;
      loaded.clear();
      for (const op of instructions) {
        if (op === undefined) throw "slot home instruction invariant";
        if (op.kind === "load" && tracked[op.slot] === 1)
          loaded.set(op.id, op.slot);
      }
      clearMembers();
      const t = block.terminator;
      if (t.kind === "jump") {
        for (const slot of live[t.target] ?? [])
          if (slot !== undefined) enter(slot, tracked);
      } else if (
        t.kind === "branch" ||
        t.kind === "record" ||
        t.kind === "record-cell" ||
        t.kind === "cell"
      ) {
        for (const slot of live[t.consequent] ?? [])
          if (slot !== undefined) enter(slot, tracked);
        for (const slot of live[t.alternate] ?? [])
          if (slot !== undefined) enter(slot, tracked);
      }
      // A slot live into the handler is live throughout this block: a throw
      // may leave it before any store here.
      const handler = block.exception;
      if (handler !== undefined)
        for (const slot of live[handler.target] ?? [])
          if (slot !== undefined) {
            enter(slot, tracked);
            protectedIn[slot] = stamp;
          }
      // Cell and record terminators may write their slot after reading it.
      if (
        t.kind === "record" ||
        t.kind === "record-cell" ||
        t.kind === "cell"
      ) {
        if (!written(t.slot)) return false;
        enter(t.slot, tracked);
      }
      visitTerminatorOperands(t, use);
      for (let index = instructions.length - 1; index >= 0; index--) {
        const op = instructions[index];
        if (op === undefined) throw "slot home instruction invariant";
        if (++work > maxWork) return false;
        if (op.kind === "store") {
          if (!written(op.slot)) return false;
          if (protectedIn[op.slot] !== stamp) leave(op.slot);
        }
        visitInstructionOperands(op, use);
        if (op.kind === "load") enter(op.slot, tracked);
      }
    }
    return true;
  }
  let floatMatrix: Uint32Array | undefined, gpMatrix: Uint32Array | undefined;
  if (shared && allLive !== undefined && (floatRow > 0 || gpRow > 0)) {
    const floatInterference = new Uint32Array(floatRanked * floatRow),
      gpInterference = new Uint32Array(gpRanked * gpRow);
    work += floatInterference.length + gpInterference.length;
    if (
      work <= maxWork &&
      buildInterference(
        allLive.slots,
        floatInterference,
        floatRow,
        gpInterference,
        gpRow,
      )
    ) {
      if (floatRow > 0) floatMatrix = floatInterference;
      if (gpRow > 0) gpMatrix = gpInterference;
    } else shared = false;
  }
  const assigned = new Map<number, number>();
  const floatHomes = rankedHomes(floats, 8, floatMatrix, floatRow);
  let floatCount = 0;
  for (let rank = 0; rank < floats.length; rank++) {
    const group = floats[rank],
      home = floatHomes[rank] ?? 0;
    if (group === undefined) throw "slot home group invariant";
    if (home === 0) continue;
    assigned.set(group, 8 + home - 1);
    floatCount = Math.max(floatCount, home);
  }
  const gpHomes = rankedHomes(gpGroups, words.length, gpMatrix, gpRow);
  let wordCount = 0;
  for (let rank = 0; rank < gpGroups.length; rank++) {
    const group = gpGroups[rank],
      home = gpHomes[rank] ?? 0;
    if (group === undefined) throw "slot home group invariant";
    if (home === 0) continue;
    const register = words[home - 1];
    if (register === undefined) throw "slot home register invariant";
    assigned.set(group, 32 + register);
    wordCount = Math.max(wordCount, home);
  }
  const saved: number[] = [];
  for (let index = 0; index < wordCount; index++) {
    const register = words[index];
    if (register === undefined) throw "slot home register invariant";
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
  const registerRoots: ((readonly number[] | undefined)[] | undefined)[] = [];
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
    if (any) registerRoots[block] = lists;
  }
  return { registers, floatCount, saved, registerRoots, shared };
}
/** Registers for groups in rank order: per rank, a register index plus one,
 * or 0. Without an interference matrix (row words per rank), each group
 * takes a register of its own; with one, the first that holds no
 * interfering group. A register taken at index i implies every lower index
 * was taken first, so the indices used form a prefix. */
function rankedHomes(
  order: readonly number[],
  registers: number,
  matrix: Uint32Array | undefined,
  row: number,
): Uint8Array {
  const bits = matrix;
  if (bits !== undefined) return firstFit(order, registers, bits, row);
  const result = new Uint8Array(order.length);
  for (let rank = 0; rank < order.length && rank < registers; rank++)
    result[rank] = rank + 1;
  return result;
}
function firstFit(
  order: readonly number[],
  registers: number,
  matrix: Uint32Array,
  row: number,
): Uint8Array {
  const result = new Uint8Array(order.length);
  // Per register: the ranks it holds, as a row of the matrix's width.
  const held = new Uint32Array(registers * row),
    ranked = Math.min(order.length, rankedGroupLimit);
  for (let rank = 0; rank < ranked; rank++) {
    const last = rank >>> 5;
    for (let register = 0; register < registers; register++) {
      let free: boolean = true;
      for (let word = 0; word <= last; word++)
        if (
          ((matrix[rank * row + word] ?? 0) &
            (held[register * row + word] ?? 0)) !==
          0
        ) {
          free = false;
          break;
        }
      if (free) {
        const at = register * row + last;
        held[at] = (held[at] ?? 0) | (1 << (rank & 31));
        result[rank] = register + 1;
        break;
      }
    }
  }
  return result;
}
