import { hasBit, setBit } from "@tint/foundation/collections/bit-vector";
import type { FunctionIR } from "./model.ts";
/** Verified IR only. Return slots whose previous contents can be discarded at
 * block entry. A bounded backwards may-use analysis includes exception edges;
 * exhaustion returns no plan, so callers retain their conservative roots. */
export interface SlotLiveness {
  readonly slots: readonly (readonly number[])[];
  readonly work: number;
}
function analyzeSlots(
  fn: FunctionIR,
  maxWork: number = 10000000,
  trackedSlots: readonly number[] | undefined,
  liveResult: boolean,
): SlotLiveness | undefined {
  if (!Number.isSafeInteger(maxWork) || maxWork < 0) return undefined;
  const slotCount =
    trackedSlots === undefined ? fn.slots.length : trackedSlots.length;
  if (slotCount * fn.blocks.length > maxWork) return undefined;
  const indices =
    trackedSlots === undefined ? undefined : new Uint32Array(fn.slots.length);
  if (trackedSlots !== undefined && indices !== undefined) {
    const selected = trackedSlots,
      mapping = indices;
    for (let index = 0; index < selected.length; index++) {
      const slot = selected[index];
      if (
        slot === undefined ||
        !Number.isInteger(slot) ||
        slot < 0 ||
        slot >= fn.slots.length ||
        mapping[slot] !== 0
      )
        return undefined;
      mapping[slot] = index + 1;
    }
  }
  function bit(slot: number): number {
    return indices === undefined ? slot : (indices[slot] ?? 0) - 1;
  }
  let work = 0;
  const words = Math.ceil(slotCount / 32),
    matrixWords = words * fn.blocks.length,
    uses = new Uint32Array(matrixWords),
    defs = new Uint32Array(matrixWords),
    live = new Uint32Array(matrixWords),
    first = new Uint32Array(fn.blocks.length),
    second = new Uint32Array(fn.blocks.length);
  // Successors use target+1, leaving zero as the absent-edge sentinel.
  for (const block of fn.blocks) {
    if (block === undefined) throw "block invariant";
    const base = block.id * words * 32;
    for (const op of block.instructions) {
      if (op === undefined) throw "instruction invariant";
      if (++work > maxWork) return undefined;
      if (op.kind === "load" || op.kind === "store") {
        const index = bit(op.slot);
        if (index >= 0) {
          if (op.kind === "load" && !hasBit(defs, base + index))
            setBit(uses, base + index);
          if (op.kind === "store") setBit(defs, base + index);
        }
      }
    }
    const term = block.terminator;
    if (term.kind === "jump") first[block.id] = term.target + 1;
    else if (
      term.kind === "branch" ||
      term.kind === "cell" ||
      term.kind === "record" ||
      term.kind === "record-cell"
    ) {
      first[block.id] = term.consequent + 1;
      second[block.id] = term.alternate + 1;
      if (term.kind !== "branch") {
        // Conservatively retain guarded transfer slots on both edges.
        const index = bit(term.slot);
        if (index >= 0) {
          if (!hasBit(defs, base + index)) setBit(uses, base + index);
          setBit(defs, base + index);
        }
      }
    }
  }
  const blockCount = fn.blocks.length;
  // Heads, ring queue, and three possible predecessor links per block share
  // one allocation. No per-edge objects or per-block queues are needed.
  work += blockCount * 9;
  if (work > maxWork) return undefined;
  const schedule = new Uint32Array(blockCount * 8),
    queued = new Uint8Array(blockCount),
    linkBase = blockCount * 2;
  let links = 0;
  function predecessor(source: number, target: number): void {
    const at = linkBase + links * 2;
    schedule[at] = source;
    schedule[at + 1] = schedule[target] ?? 0;
    schedule[target] = ++links;
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "liveness predecessor invariant";
    const one = (first[block.id] ?? 0) - 1,
      two = (second[block.id] ?? 0) - 1,
      handler = block.exception;
    if (one >= 0) predecessor(block.id, one);
    if (two >= 0 && two !== one) predecessor(block.id, two);
    if (
      handler !== undefined &&
      handler.target !== one &&
      handler.target !== two
    )
      predecessor(block.id, handler.target);
    schedule[blockCount + block.id] = blockCount - block.id - 1;
  }
  queued.fill(1);
  let head = 0,
    tail = 0,
    pending = blockCount;
  while (pending > 0) {
    if (++work > maxWork) return undefined;
    const index = schedule[blockCount + head] ?? 0;
    head++;
    if (head === blockCount) head = 0;
    pending--;
    queued[index] = 0;
    let changed = false;
    const block = fn.blocks[index];
    if (block === undefined) throw "slot liveness invariant";
    const base = index * words,
      one = (first[index] ?? 0) - 1,
      two = (second[index] ?? 0) - 1,
      handler = block.exception;
    for (let word = 0; word < words; word++) {
      let outgoing = 0;
      if (one >= 0) {
        if (++work > maxWork) return undefined;
        outgoing = live[one * words + word] ?? 0;
      }
      if (two >= 0) {
        if (++work > maxWork) return undefined;
        outgoing = outgoing | (live[two * words + word] ?? 0);
      }
      // A throw may precede any store. Normal defs never kill handler uses.
      const exceptional =
          handler === undefined
            ? 0
            : (live[handler.target * words + word] ?? 0),
        position = base + word,
        result =
          ((outgoing & ~(defs[position] ?? 0)) |
            (uses[position] ?? 0) |
            exceptional) >>>
          0;
      if (++work > maxWork) return undefined;
      if (live[position] !== result) {
        live[position] = result;
        changed = true;
      }
    }
    if (!changed) continue;
    let link = schedule[index] ?? 0;
    while (link !== 0) {
      if (++work > maxWork) return undefined;
      const at = linkBase + (link - 1) * 2,
        source = schedule[at] ?? 0;
      link = schedule[at + 1] ?? 0;
      if (queued[source] === 1) continue;
      queued[source] = 1;
      schedule[blockCount + tail] = source;
      tail++;
      if (tail === blockCount) tail = 0;
      pending++;
    }
  }
  let resultBits = live;
  // Live-entry consumers need no dead-root edge propagation or scratch matrix.
  if (!liveResult) {
    const clear = new Uint32Array(matrixWords);
    function edge(source: number, target: number): boolean {
      const sourceBase = source * words,
        targetBase = target * words;
      for (let word = 0; word < words; word++) {
        if (++work > maxWork) return false;
        const from = sourceBase + word,
          to = targetBase + word;
        clear[to] =
          (clear[to] ?? 0) |
          (((live[from] ?? 0) | (defs[from] ?? 0)) & ~(live[to] ?? 0));
      }
      return true;
    }
    for (const block of fn.blocks) {
      if (block === undefined) throw "block invariant";
      const one = (first[block.id] ?? 0) - 1,
        two = (second[block.id] ?? 0) - 1;
      if (one >= 0 && !edge(block.id, one)) return undefined;
      if (two >= 0 && !edge(block.id, two)) return undefined;
      const handler = block.exception;
      if (handler !== undefined) {
        if (!edge(block.id, handler.target)) return undefined;
        const index = bit(handler.slot),
          base = handler.target * words * 32;
        if (index >= 0 && !hasBit(live, base + index))
          setBit(clear, base + index);
      }
    }
    const entryBase = fn.entry * words * 32;
    for (const parameter of fn.parameters) {
      if (parameter === undefined) throw "parameter invariant";
      const index = bit(parameter);
      if (index >= 0 && !hasBit(live, entryBase + index))
        setBit(clear, entryBase + index);
    }
    resultBits = clear;
  }
  const result: number[][] = [];
  for (let block = 0; block < fn.blocks.length; block++) {
    const base = block * words * 32;
    const slots: number[] = [];
    for (let index = 0; index < slotCount; index++) {
      if (++work > maxWork) return undefined;
      if (hasBit(resultBits, base + index)) {
        const slot = trackedSlots === undefined ? index : trackedSlots[index];
        if (slot === undefined) throw "tracked slot invariant";
        slots.push(slot);
      }
    }
    result.push(slots);
  }
  return { slots: result, work };
}

/** All slots whose incoming value may be read, including exceptional paths.
 * Unlike root clearing, this includes values not initialized on an incoming edge. */
export function liveSlotsAtEntry(
  fn: FunctionIR,
  maxWork: number = 10000000,
): readonly (readonly number[])[] | undefined {
  return analyzeLiveSlots(fn, maxWork)?.slots;
}
/** Slots with potentially occupied storage that are dead on entry. */
export function deadSlotsAtEntry(
  fn: FunctionIR,
  maxWork: number = 10000000,
  trackedSlots?: readonly number[],
): readonly (readonly number[])[] | undefined {
  return analyzeSlots(fn, maxWork, trackedSlots, false)?.slots;
}

export function analyzeLiveSlots(
  fn: FunctionIR,
  maxWork: number,
  trackedSlots?: readonly number[],
): SlotLiveness | undefined {
  return analyzeSlots(fn, maxWork, trackedSlots, true);
}
