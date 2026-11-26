import type { FunctionIR } from "./model.ts";
/** Verified IR only. Return slots whose previous contents can be discarded at
 * block entry. A bounded backwards may-use analysis includes exception edges;
 * exhaustion returns no plan, so callers retain their conservative roots.
 * Empty trap blocks never reach a safepoint and receive no clears. */
export interface SlotLiveness {
  readonly slots: readonly (readonly number[])[];
  readonly work: number;
}
/** Live-in sets as dense bit rows, for functions whose lists would be large:
 * bit `index & 31` of `rows[block * rowWords + (index >>> 5)]` is set when
 * the tracked slot `tracked[index]` is live into `block`. A block's set bits
 * lie in words `starts[block]` up to `ends[block]` (empty when equal), so
 * enumeration costs the occupied span, not the row width. Enumerating a
 * row in ascending bit order yields the slots in the order the list form
 * reports them. */
export interface SlotLiveRows {
  readonly rows: Uint32Array;
  readonly rowWords: number;
  readonly starts: Uint32Array;
  readonly ends: Uint32Array;
  readonly tracked: readonly number[];
  readonly work: number;
}
/** Row width in 32-bit words for `trackedCount` slots. */
export function liveRowWords(trackedCount: number): number {
  return (trackedCount + 31) >>> 5;
}
/** Largest dense live-in table (32-bit words, 64 MiB) callers request;
 * larger tables keep the sparse lists, whose size follows the live ranges. */
const denseLiveWords = 16777216;
/** Whether live-in sets of `trackedCount` slots fit the dense row form
 * within `limit` words (tests lower it to exercise the list form). */
export function fitsLiveRows(
  fn: FunctionIR,
  trackedCount: number,
  limit: number = denseLiveWords,
): boolean {
  return fn.blocks.length * liveRowWords(trackedCount) <= limit;
}
interface SlotAnalysis {
  readonly slots: readonly (readonly number[])[];
  readonly rows: Uint32Array | undefined;
  readonly starts: Uint32Array | undefined;
  readonly ends: Uint32Array | undefined;
  readonly work: number;
}
/** Sparse backward liveness, one slot at a time: a slot is live into the
 * blocks that read it before any store, and into every predecessor of a live
 * block that does not store it (a block whose exception handler is live keeps
 * it regardless: a throw may precede the store). Work and memory follow the
 * slots' live ranges and use/def events, not blocks x slots, so the largest
 * functions (module initializers, compiler drivers) are analyzed too. Per
 * block, results list slots in tracked order. */
function analyzeSlots(
  fn: FunctionIR,
  maxWork: number = 10000000,
  trackedSlots: readonly number[] | undefined,
  mode: "live" | "dead" | "entry",
  preciseReads: boolean = false,
  preciseExceptionTransfers: boolean = false,
  dense: boolean = false,
): SlotAnalysis | undefined {
  const liveResult = mode !== "dead";
  // Guarded reads (record, record-cell and cell terminators reading into
  // their slot) write the slot only on the consequent edge; the alternate
  // edge keeps its old contents. Precise liveness kills the slot on that
  // edge alone. Root clearing ("dead") keeps the conservative model, which
  // also counts the write as occupying the slot.
  const edgeReads = preciseReads && liveResult;
  if (!Number.isSafeInteger(maxWork) || maxWork < 0) return undefined;
  const slotTotal = fn.slots.length,
    blockCount = fn.blocks.length,
    slotCount = trackedSlots === undefined ? slotTotal : trackedSlots.length;
  let work = slotCount + blockCount;
  if (work > maxWork) return undefined;
  // 1-based tracked index per slot; 0 is untracked.
  const indices = new Uint32Array(slotTotal),
    all = trackedSlots === undefined,
    selected: readonly number[] = trackedSlots ?? [];
  if (all)
    for (let slot = 0; slot < slotTotal; slot++) indices[slot] = slot + 1;
  else
    for (let index = 0; index < selected.length; index++) {
      const slot = selected[index];
      if (
        slot === undefined ||
        !Number.isInteger(slot) ||
        slot < 0 ||
        slot >= slotTotal ||
        indices[slot] !== 0
      )
        return undefined;
      indices[slot] = index + 1;
    }
  function slotOf(index: number): number {
    if (all) return index;
    const slot = selected[index];
    if (slot === undefined) throw "tracked slot invariant";
    return slot;
  }
  // Upward-exposed uses and defs per block, as (tracked index, block) events.
  const useIndices: number[] = [],
    useBlocks: number[] = [],
    defIndices: number[] = [],
    defBlocks: number[] = [],
    usedIn = new Uint32Array(slotCount),
    definedIn = new Uint32Array(slotCount);
  function read(index: number, block: number): void {
    if (definedIn[index] === block + 1 || usedIn[index] === block + 1) return;
    usedIn[index] = block + 1;
    useIndices.push(index);
    useBlocks.push(block);
  }
  function write(index: number, block: number): void {
    if (definedIn[index] === block + 1) return;
    definedIn[index] = block + 1;
    defIndices.push(index);
    defBlocks.push(block);
  }
  // Successors: first/second (target + 1, zero when absent) and handler.
  const first = new Uint32Array(blockCount),
    second = new Uint32Array(blockCount),
    predecessorCounts = new Uint32Array(blockCount + 1),
    // Tracked index + 1 of a slot written only by the block's guarded read,
    // on its consequent edge.
    consequentWrites = new Uint32Array(edgeReads ? blockCount : 0);
  for (const block of fn.blocks) {
    if (block === undefined) throw "block invariant";
    const id = block.id;
    for (const op of block.instructions) {
      if (op === undefined) throw "instruction invariant";
      if (++work > maxWork) return undefined;
      if (op.kind === "load" || op.kind === "store") {
        const index = (indices[op.slot] ?? 0) - 1;
        if (index >= 0) {
          if (op.kind === "load") read(index, id);
          else write(index, id);
        }
      }
    }
    const term = block.terminator;
    if (term.kind === "jump") first[id] = term.target + 1;
    else if (
      term.kind === "branch" ||
      term.kind === "cell" ||
      term.kind === "record" ||
      term.kind === "record-cell"
    ) {
      first[id] = term.consequent + 1;
      if (term.alternate !== term.consequent) second[id] = term.alternate + 1;
      if (term.kind !== "branch") {
        const index = (indices[term.slot] ?? 0) - 1;
        if (
          index >= 0 &&
          edgeReads &&
          term.operation === "read" &&
          term.alternate !== term.consequent
        ) {
          // A store earlier in the block already defines it on both edges.
          if (definedIn[index] !== id + 1) consequentWrites[id] = index + 1;
        } else if (index >= 0) {
          // Conservatively retain guarded transfer slots on both edges.
          read(index, id);
          write(index, id);
        }
      }
    }
    const one = (first[id] ?? 0) - 1,
      two = (second[id] ?? 0) - 1,
      handler = block.exception;
    if (one >= 0)
      predecessorCounts[one + 1] = (predecessorCounts[one + 1] ?? 0) + 1;
    if (two >= 0)
      predecessorCounts[two + 1] = (predecessorCounts[two + 1] ?? 0) + 1;
    if (
      handler !== undefined &&
      handler.target !== one &&
      handler.target !== two
    )
      predecessorCounts[handler.target + 1] =
        (predecessorCounts[handler.target + 1] ?? 0) + 1;
  }
  // Predecessor lists (CSR). An edge from a block whose handler is the
  // target is exceptional: the target's live slots are live into the
  // source even if the source stores them.
  for (let block = 0; block < blockCount; block++)
    predecessorCounts[block + 1] =
      (predecessorCounts[block + 1] ?? 0) + (predecessorCounts[block] ?? 0);
  const edgeCount = predecessorCounts[blockCount] ?? 0,
    predecessors = new Uint32Array(edgeCount),
    exceptional = new Uint8Array(edgeCount),
    // Exception transfer slot + 1 on pure-exception edges (zero otherwise).
    exceptionTransferSlot = new Uint32Array(
      preciseExceptionTransfers ? edgeCount : 0,
    ),
    // Consequent edges of blocks with a consequent-only write.
    writing = new Uint8Array(edgeReads ? edgeCount : 0),
    filled = new Uint32Array(blockCount);
  work += edgeCount;
  if (work > maxWork) return undefined;
  function link(
    source: number,
    target: number,
    thrown: boolean,
    transferSlot: number,
  ): void {
    const at = (predecessorCounts[target] ?? 0) + (filled[target] ?? 0);
    filled[target] = (filled[target] ?? 0) + 1;
    predecessors[at] = source;
    exceptional[at] = thrown ? 1 : 0;
    if (preciseExceptionTransfers && transferSlot !== 0)
      exceptionTransferSlot[at] = transferSlot;
    if (
      edgeReads &&
      !thrown &&
      (consequentWrites[source] ?? 0) !== 0 &&
      target === (first[source] ?? 0) - 1
    )
      writing[at] = 1;
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "block invariant";
    const id = block.id,
      one = (first[id] ?? 0) - 1,
      two = (second[id] ?? 0) - 1,
      handler = block.exception,
      thrownTo = handler === undefined ? -1 : handler.target;
    if (one >= 0) link(id, one, thrownTo === one, 0);
    if (two >= 0) link(id, two, thrownTo === two, 0);
    if (thrownTo >= 0 && thrownTo !== one && thrownTo !== two)
      link(
        id,
        thrownTo,
        true,
        preciseExceptionTransfers && handler !== undefined
          ? handler.slot + 1
          : 0,
      );
  }
  // Events grouped by tracked index (counting sort).
  function group(
    eventIndices: readonly number[],
    eventBlocks: readonly number[],
  ): { starts: Uint32Array; blocks: Uint32Array } {
    const starts = new Uint32Array(slotCount + 1),
      blocks = new Uint32Array(eventIndices.length),
      cursor = new Uint32Array(slotCount);
    for (let event = 0; event < eventIndices.length; event++) {
      const index = eventIndices[event] ?? 0;
      starts[index + 1] = (starts[index + 1] ?? 0) + 1;
    }
    for (let index = 0; index < slotCount; index++)
      starts[index + 1] = (starts[index + 1] ?? 0) + (starts[index] ?? 0);
    for (let event = 0; event < eventIndices.length; event++) {
      const index = eventIndices[event] ?? 0,
        at = (starts[index] ?? 0) + (cursor[index] ?? 0);
      cursor[index] = (cursor[index] ?? 0) + 1;
      blocks[at] = eventBlocks[event] ?? 0;
    }
    return { starts, blocks };
  }
  work += useIndices.length + defIndices.length;
  if (work > maxWork) return undefined;
  const uses = group(useIndices, useBlocks),
    defs = group(defIndices, defBlocks);
  // Exception slots and parameters are cleared where they are dead.
  const handlerTargets: number[][] = [];
  if (!liveResult)
    for (const block of fn.blocks) {
      if (block === undefined) throw "block invariant";
      const handler = block.exception;
      if (handler === undefined) continue;
      const index = (indices[handler.slot] ?? 0) - 1;
      if (index < 0) continue;
      let targets = handlerTargets[index];
      if (targets === undefined) {
        targets = [];
        handlerTargets[index] = targets;
      }
      targets.push(handler.target);
    }
  const parameter = new Uint8Array(slotCount);
  for (const slot of fn.parameters) {
    if (slot === undefined) throw "parameter invariant";
    const index = (indices[slot] ?? 0) - 1;
    if (index >= 0) parameter[index] = 1;
  }
  // Dense rows replace the per-block lists of a "live" analysis.
  const rowWords = dense ? liveRowWords(slotCount) : 0,
    rows = new Uint32Array(dense ? blockCount * rowWords : 0),
    starts = new Uint32Array(dense ? blockCount : 0),
    ends = new Uint32Array(dense ? blockCount : 0);
  if (dense) starts.fill(rowWords);
  const result: number[][] = [];
  if (!dense) for (let block = 0; block < blockCount; block++) result.push([]);
  // Per-slot marks stamped with index + 1, so nothing is cleared between slots.
  const live = new Uint32Array(blockCount),
    defined = new Uint32Array(blockCount),
    cleared = new Uint32Array(blockCount),
    queue = new Uint32Array(blockCount);
  function clearAt(block: number, stamp: number, slot: number): void {
    if (live[block] === stamp || cleared[block] === stamp) return;
    cleared[block] = stamp;
    // An empty trap block stops execution before any safepoint, so its frame
    // is never scanned again; clearing dead roots there only adds code.
    if (discardsFrame(fn.blocks[block])) return;
    result[block]?.push(slot);
  }
  for (let index = 0; index < slotCount; index++) {
    const stamp = index + 1,
      slot = slotOf(index);
    const defStart = defs.starts[index] ?? 0,
      defEnd = defs.starts[index + 1] ?? 0;
    for (let at = defStart; at < defEnd; at++)
      defined[defs.blocks[at] ?? 0] = stamp;
    let tail = 0;
    const useEnd = uses.starts[index + 1] ?? 0;
    for (let at = uses.starts[index] ?? 0; at < useEnd; at++) {
      const block = uses.blocks[at] ?? 0;
      live[block] = stamp;
      queue[tail++] = block;
    }
    // The entry query stops as soon as the slot reaches the entry block.
    const entryOnly = mode === "entry";
    const transferStamp = slot + 1;
    for (let head = 0; head < tail; head++) {
      if (entryOnly && live[fn.entry] === stamp) break;
      const block = queue[head] ?? 0;
      const predEnd = predecessorCounts[block + 1] ?? 0;
      for (let at = predecessorCounts[block] ?? 0; at < predEnd; at++) {
        if (++work > maxWork) return undefined;
        const source = predecessors[at] ?? 0;
        if (live[source] === stamp) continue;
        if (exceptional[at] !== 1 && defined[source] === stamp) continue;
        // A throw creates the transfer value. The old slot can be live
        // along a normal edge to the same block, so keep that edge.
        if (
          preciseExceptionTransfers &&
          exceptionTransferSlot[at] === transferStamp
        )
          continue;
        if (writing[at] === 1 && consequentWrites[source] === stamp) continue;
        live[source] = stamp;
        queue[tail++] = source;
      }
    }
    if (entryOnly) {
      if (live[fn.entry] === stamp) result[fn.entry]?.push(slot);
      continue;
    }
    if (liveResult) {
      work += tail;
      if (work > maxWork) return undefined;
      if (dense) {
        const word = index >>> 5,
          bit = 1 << (index & 31);
        for (let at = 0; at < tail; at++) {
          const block = queue[at] ?? 0,
            position = block * rowWords + word;
          rows[position] = (rows[position] ?? 0) | bit;
          if (word < (starts[block] ?? 0)) starts[block] = word;
          if (word >= (ends[block] ?? 0)) ends[block] = word + 1;
        }
      } else
        for (let at = 0; at < tail; at++) result[queue[at] ?? 0]?.push(slot);
      continue;
    }
    // Storage is occupied after blocks where the slot is live or stored; it
    // is cleared on entry to successors where the slot is dead.
    const occupied = (block: number): boolean => {
      const one = (first[block] ?? 0) - 1,
        two = (second[block] ?? 0) - 1,
        handler = fn.blocks[block]?.exception;
      work += 3;
      if (work > maxWork) return false;
      if (one >= 0) clearAt(one, stamp, slot);
      if (two >= 0) clearAt(two, stamp, slot);
      if (handler !== undefined) clearAt(handler.target, stamp, slot);
      return true;
    };
    for (let at = 0; at < tail; at++)
      if (!occupied(queue[at] ?? 0)) return undefined;
    for (let at = defStart; at < defEnd; at++) {
      const block = defs.blocks[at] ?? 0;
      if (live[block] !== stamp && !occupied(block)) return undefined;
    }
    for (const target of handlerTargets[index] ?? [])
      if (target !== undefined) clearAt(target, stamp, slot);
    if (parameter[index] === 1) clearAt(fn.entry, stamp, slot);
  }
  return dense
    ? { slots: result, rows, starts, ends, work }
    : {
        slots: result,
        rows: undefined,
        starts: undefined,
        ends: undefined,
        work,
      };
}
function discardsFrame(
  block: FunctionIR["blocks"][number] | undefined,
): boolean {
  if (block === undefined) throw "block invariant";
  return block.instructions.length === 0 && block.terminator.kind === "trap";
}

/** All slots whose incoming value may be read, including exceptional paths.
 * Unlike root clearing, this includes values not initialized on an incoming edge. */
export function liveSlotsAtEntry(
  fn: FunctionIR,
  maxWork: number = 10000000,
): readonly (readonly number[])[] | undefined {
  return analyzeLiveSlots(fn, maxWork)?.slots;
}
function listResult(
  analysis: SlotAnalysis | undefined,
): SlotLiveness | undefined {
  return analysis === undefined
    ? undefined
    : { slots: analysis.slots, work: analysis.work };
}
function allSlots(fn: FunctionIR): number[] {
  const all: number[] = [];
  for (let slot = 0; slot < fn.slots.length; slot++) all.push(slot);
  return all;
}
function rowResult(
  analysis: SlotAnalysis | undefined,
  fn: FunctionIR,
  trackedSlots: readonly number[] | undefined,
): SlotLiveRows | undefined {
  if (analysis === undefined) return undefined;
  const rows = analysis.rows,
    starts = analysis.starts,
    ends = analysis.ends;
  if (rows === undefined || starts === undefined || ends === undefined)
    throw "dense liveness invariant";
  const tracked: readonly number[] = trackedSlots ?? allSlots(fn);
  return {
    rows,
    rowWords: liveRowWords(tracked.length),
    starts,
    ends,
    tracked,
    work: analysis.work,
  };
}
/** Slots with potentially occupied storage that are dead on entry. */
export function deadSlotsAtEntry(
  fn: FunctionIR,
  maxWork: number = 10000000,
  trackedSlots?: readonly number[],
): readonly (readonly number[])[] | undefined {
  return analyzeSlots(fn, maxWork, trackedSlots, "dead")?.slots;
}

export function analyzeLiveSlots(
  fn: FunctionIR,
  maxWork: number,
  trackedSlots?: readonly number[],
): SlotLiveness | undefined {
  return listResult(analyzeSlots(fn, maxWork, trackedSlots, "live"));
}
/** analyzeLiveSlots with dense row output (same sets and work). */
export function analyzeLiveSlotRows(
  fn: FunctionIR,
  maxWork: number,
  trackedSlots?: readonly number[],
): SlotLiveRows | undefined {
  return rowResult(
    analyzeSlots(fn, maxWork, trackedSlots, "live", false, false, true),
    fn,
    trackedSlots,
  );
}
/** Live slots where a guarded read terminator kills its slot on the
 * consequent edge only (its write happens only there), instead of counting
 * as a read. Precise stack maps use it, so a dead value is not reported as a
 * root merely because a later guarded read overwrites its slot (see
 * safepointLiveSlots). */
export function analyzeLiveSlotsPrecisely(
  fn: FunctionIR,
  maxWork: number,
  trackedSlots?: readonly number[],
  preciseExceptionTransfers: boolean = false,
): SlotLiveness | undefined {
  return listResult(
    analyzeSlots(
      fn,
      maxWork,
      trackedSlots,
      "live",
      true,
      preciseExceptionTransfers,
    ),
  );
}
/** analyzeLiveSlotsPrecisely with dense row output (same sets and work). */
export function analyzeLiveSlotRowsPrecisely(
  fn: FunctionIR,
  maxWork: number,
  trackedSlots?: readonly number[],
  preciseExceptionTransfers: boolean = false,
): SlotLiveRows | undefined {
  return rowResult(
    analyzeSlots(
      fn,
      maxWork,
      trackedSlots,
      "live",
      true,
      preciseExceptionTransfers,
      true,
    ),
    fn,
    trackedSlots,
  );
}
/** The tracked slots live into the function's entry block (all of them
 * when tracked is omitted), without the per-block table. */
export function liveSlotsIntoEntry(
  fn: FunctionIR,
  maxWork: number,
  trackedSlots?: readonly number[],
): SlotLiveness | undefined {
  const liveness = analyzeSlots(fn, maxWork, trackedSlots, "entry");
  if (liveness === undefined) return undefined;
  return { slots: [liveness.slots[fn.entry] ?? []], work: liveness.work };
}
