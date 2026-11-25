import type { Block, FunctionIR, Instruction } from "../scalar/index.ts";
import {
  instructionResult,
  provenRecordReads,
  verifierRecordWork,
} from "../scalar/index.ts";

export interface SlotCopyPropagation {
  readonly fn: FunctionIR;
  readonly visited: number;
  readonly rewritten: number;
  /** The rewrite was discarded because a direct record read lost the
   * verifier's layout proof. */
  readonly refused: boolean;
}

const transparent = 0,
  valid = 1,
  invalid = 2;

/** Global copy propagation over local slots. Inlining binds each argument to a
 * fresh parameter slot, so one object is reachable through several slots and
 * facts proven on one (descriptor checks, record facts) are lost on the
 * others. A load of copy slot B becomes a load of its source A wherever every
 * path from entry reaches it through a copy store B = A with no later store to
 * A or B; the copy stores then die in store cleanup.
 *
 * Inlined calls chain copies (C = B, B = A). Each copy is processed before
 * its source, and a load rewritten to read B is then a load of B for B's own
 * rewrite, so equal values resolve to the chain's root wherever every hop is
 * valid. Rewriting one hop at a time would leave a descriptor check reading B
 * and the read it guards reading A's copy, breaking the record read proof.
 *
 * Validity is decided per copy slot over the blocks between its loads and the
 * stores that reach them (a backward region, like sparse liveness), so work
 * follows live ranges rather than blocks x slots. Slots written by
 * terminators or exception entries, parameters and the receiver are never
 * copies; such a source is accepted only where no such write intervenes,
 * which is enforced by treating them as unknown writes. */
export function propagateSlotCopies(
  fn: FunctionIR,
  budget: number,
  stableLayouts: boolean = false,
): SlotCopyPropagation | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0)
    throw "INVALID_OPTIMIZATION_BUDGET";
  const slotCount = fn.slots.length,
    blockCount = fn.blocks.length;
  let visited = slotCount + blockCount,
    maximum = -1;
  // Same-typed slots only: loads of the copy become loads of the source.
  if (visited > budget) return undefined;
  // Copies need every write to be a visible store: parameters and the
  // receiver are written at entry, terminator transfer slots and exception
  // slots on edges. Only the latter disqualify a source.
  const opaque = new Uint8Array(slotCount),
    edgeWritten = new Uint8Array(slotCount);
  for (const parameter of fn.parameters)
    if (parameter !== undefined) opaque[parameter] = 1;
  if (fn.receiverSlot !== undefined) opaque[fn.receiverSlot] = 1;
  const definitions: (Instruction | undefined)[] = [],
    positions: number[] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "copy block invariant";
    for (let index = 0; index < block.instructions.length; index++) {
      const op = block.instructions[index];
      if (op === undefined) throw "copy instruction invariant";
      if (++visited > budget) return undefined;
      const id = instructionResult(op);
      if (id !== undefined) {
        definitions[id] = op;
        positions[id] = index;
        if (id > maximum) maximum = id;
      }
    }
    const term = block.terminator;
    if (
      term.kind === "record" ||
      term.kind === "record-cell" ||
      term.kind === "cell"
    )
      edgeWritten[term.slot] = 1;
    if (block.exception !== undefined) edgeWritten[block.exception.slot] = 1;
  }
  // Candidate copies: 0 unknown, otherwise source + 1.
  const sources = new Uint32Array(slotCount),
    rejected = new Uint8Array(slotCount),
    loads = new Uint32Array(slotCount);
  /** The slot a store copies, or -1: the stored value is a load of another
   * slot earlier in the same block with no store to that slot between. (A
   * reference copy of an optional reference is not a copy: reading the source
   * would add an unwrap at every load.) */
  function copyOf(block: Block, position: number, value: number): number {
    const op = definitions[value];
    if (op === undefined || op.kind !== "load") return -1;
    const at = positions[op.id] ?? -1;
    if (block.instructions[at] !== op) return -1;
    for (let index = at + 1; index < position; index++) {
      const between = block.instructions[index];
      if (between === undefined) throw "copy instruction invariant";
      if (between.kind === "store" && between.slot === op.slot) return -1;
    }
    return op.slot;
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "copy block invariant";
    for (let index = 0; index < block.instructions.length; index++) {
      const op = block.instructions[index];
      if (op === undefined) throw "copy instruction invariant";
      if (op.kind === "load") {
        loads[op.slot] = (loads[op.slot] ?? 0) + 1;
        continue;
      }
      if (op.kind !== "store" || rejected[op.slot] === 1) continue;
      visited += index;
      if (visited > budget) return undefined;
      const source = copyOf(block, index, op.value),
        slot = op.slot;
      if (
        source < 0 ||
        source === slot ||
        (sources[slot] !== 0 && sources[slot] !== source + 1)
      ) {
        rejected[slot] = 1;
        continue;
      }
      sources[slot] = source + 1;
    }
  }
  const candidates: number[] = [];
  for (let slot = 0; slot < slotCount; slot++) {
    if (
      rejected[slot] === 1 ||
      opaque[slot] === 1 ||
      edgeWritten[slot] === 1 ||
      sources[slot] === 0 ||
      (loads[slot] ?? 0) === 0
    )
      continue;
    const source = (sources[slot] ?? 0) - 1;
    if (edgeWritten[source] !== 1 && fn.slots[slot] === fn.slots[source])
      candidates.push(slot);
  }
  if (candidates.length === 0)
    return { fn, visited, rewritten: 0, refused: false };
  // Copies before their sources: order by the number of candidate hops down
  // to the chain's root (a cycle of copies is cut where it closes).
  const candidate = new Uint8Array(slotCount),
    depths = new Uint32Array(slotCount),
    depthState = new Uint8Array(slotCount),
    chain: number[] = [];
  for (const slot of candidates) {
    if (slot === undefined) throw "copy candidate invariant";
    candidate[slot] = 1;
  }
  for (const slot of candidates) {
    if (slot === undefined) throw "copy candidate invariant";
    chain.length = 0;
    let cursor = slot;
    while (candidate[cursor] === 1 && depthState[cursor] === 0) {
      depthState[cursor] = 1;
      chain.push(cursor);
      cursor = (sources[cursor] ?? 0) - 1;
    }
    let depth =
      candidate[cursor] === 1 && depthState[cursor] === 2
        ? (depths[cursor] ?? 0) + 1
        : 0;
    for (let index = chain.length - 1; index >= 0; index--) {
      const link = chain[index] ?? 0;
      depths[link] = depth++;
      depthState[link] = 2;
    }
    visited += chain.length;
  }
  candidates.sort((a: number, b: number): number => {
    const order = (depths[b] ?? 0) - (depths[a] ?? 0);
    return order !== 0 ? order : a - b;
  });

  // Predecessors (CSR) with an exception-edge flag; successors likewise.
  const predecessorCounts = new Uint32Array(blockCount + 1),
    successorCounts = new Uint32Array(blockCount + 1);
  function eachSuccessor(
    block: Block,
    visit: (target: number, exceptional: boolean) => void,
  ): void {
    const term = block.terminator;
    if (term.kind === "jump") visit(term.target, false);
    else if (
      term.kind === "branch" ||
      term.kind === "record" ||
      term.kind === "record-cell" ||
      term.kind === "cell"
    ) {
      visit(term.consequent, false);
      if (term.alternate !== term.consequent) visit(term.alternate, false);
    }
    if (block.exception !== undefined) visit(block.exception.target, true);
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "copy block invariant";
    eachSuccessor(block, (target, _exceptional) => {
      predecessorCounts[target + 1] = (predecessorCounts[target + 1] ?? 0) + 1;
      successorCounts[block.id + 1] = (successorCounts[block.id + 1] ?? 0) + 1;
    });
  }
  for (let id = 0; id < blockCount; id++) {
    predecessorCounts[id + 1] =
      (predecessorCounts[id + 1] ?? 0) + (predecessorCounts[id] ?? 0);
    successorCounts[id + 1] =
      (successorCounts[id + 1] ?? 0) + (successorCounts[id] ?? 0);
  }
  const edgeCount = predecessorCounts[blockCount] ?? 0,
    predecessors = new Uint32Array(edgeCount),
    predecessorExceptional = new Uint8Array(edgeCount),
    successors = new Uint32Array(edgeCount),
    successorExceptional = new Uint8Array(edgeCount),
    predecessorFill = predecessorCounts.slice(0, blockCount),
    successorFill = successorCounts.slice(0, blockCount);
  for (const block of fn.blocks) {
    if (block === undefined) throw "copy block invariant";
    eachSuccessor(block, (target, exceptional) => {
      const p = predecessorFill[target] ?? 0;
      predecessors[p] = block.id;
      predecessorExceptional[p] = exceptional ? 1 : 0;
      predecessorFill[target] = p + 1;
      const s = successorFill[block.id] ?? 0;
      successors[s] = target;
      successorExceptional[s] = exceptional ? 1 : 0;
      successorFill[block.id] = s + 1;
    });
  }
  visited += blockCount + edgeCount * 2;
  if (visited > budget) return undefined;

  // Per-slot blocks holding loads and stores, for candidate and source slots;
  // blocks holding loads rewritten to read a slot are added as they occur.
  const interest = new Uint8Array(slotCount);
  for (const slot of candidates) {
    if (slot === undefined) throw "copy candidate invariant";
    interest[slot] = 1;
    interest[(sources[slot] ?? 0) - 1] = 1;
  }
  const loadBlocks: number[][] = [],
    rewrittenBlocks: number[][] = [],
    storeBlocks: number[][] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "copy block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "copy instruction invariant";
      if (
        (op.kind !== "load" && op.kind !== "store") ||
        interest[op.slot] !== 1
      )
        continue;
      const lists = op.kind === "load" ? loadBlocks : storeBlocks;
      let list = lists[op.slot];
      if (list === undefined) {
        list = [];
        lists[op.slot] = list;
      }
      if (list[list.length - 1] !== block.id) list.push(block.id);
    }
  }

  // Per-candidate scratch, reset by generation stamps.
  const storeStamp = new Uint32Array(blockCount),
    listedStamp = new Uint32Array(blockCount),
    localStamp = new Uint32Array(blockCount),
    localState = new Uint8Array(blockCount),
    regionStamp = new Uint32Array(blockCount),
    falseStamp = new Uint32Array(blockCount),
    stack: number[] = [];
  let generation = 0;
  // Rewritten loads: value id -> source slot + 1.
  const replacements = new Uint32Array(maximum + 1);
  let rewritten = 0;
  /** The slot load `op` of `slot` reads after the rewrites so far. */
  function loaded(op: number, slot: number): number {
    const replacement = replacements[op] ?? 0;
    return replacement === 0 ? slot : replacement - 1;
  }
  /** Make a load (in `block`) read `source`, a load of it from now on. */
  function replace(op: number, block: number, source: number): void {
    if ((replacements[op] ?? 0) === 0) rewritten++;
    replacements[op] = source + 1;
    if (candidate[source] !== 1) return;
    let list = rewrittenBlocks[source];
    if (list === undefined) {
      list = [];
      rewrittenBlocks[source] = list;
    }
    if (list[list.length - 1] !== block) list.push(block);
  }

  /** The state just before `end` in a block, scanning backward: the copy is
   * valid (reached a copy store), invalid (a store to the source, or another
   * store to the copy) or transparent (no store to either). */
  function scan(
    block: Block,
    end: number,
    slot: number,
    source: number,
  ): number {
    for (let index = end - 1; index >= 0; index--) {
      const op = block.instructions[index];
      if (op === undefined) throw "copy instruction invariant";
      visited++;
      if (op.kind !== "store") continue;
      if (op.slot === source) return invalid;
      if (op.slot === slot)
        return copyOf(block, index, op.value) === source ? valid : invalid;
    }
    return transparent;
  }
  function local(block: Block, slot: number, source: number): number {
    if (localStamp[block.id] !== generation) {
      localStamp[block.id] = generation;
      localState[block.id] =
        storeStamp[block.id] === generation
          ? scan(block, block.instructions.length, slot, source)
          : transparent;
    }
    return localState[block.id] ?? transparent;
  }
  /** The exit state of `from` along an edge. An exception edge may leave from
   * any instruction, so it is transparent only without stores to either
   * slot, and otherwise invalid. */
  function edgeState(
    from: number,
    exceptional: boolean,
    slot: number,
    source: number,
  ): number {
    const block = fn.blocks[from];
    if (block === undefined) throw "copy block invariant";
    if (exceptional)
      return storeStamp[from] === generation ? invalid : transparent;
    return local(block, slot, source);
  }

  for (const slot of candidates) {
    if (slot === undefined) throw "copy candidate invariant";
    const source = (sources[slot] ?? 0) - 1;
    generation++;
    // Blocks reading the slot: its own loads and loads rewritten to it.
    const loadList: number[] = [];
    for (const id of loadBlocks[slot] ?? []) {
      if (id === undefined) throw "copy load block invariant";
      listedStamp[id] = generation;
      loadList.push(id);
    }
    for (const id of rewrittenBlocks[slot] ?? []) {
      if (id === undefined) throw "copy load block invariant";
      if (listedStamp[id] === generation) continue;
      listedStamp[id] = generation;
      loadList.push(id);
    }
    for (const id of storeBlocks[slot] ?? [])
      if (id !== undefined) storeStamp[id] = generation;
    for (const id of storeBlocks[source] ?? [])
      if (id !== undefined) storeStamp[id] = generation;
    // Region: blocks whose entry state matters, from loads not decided
    // within their own block, backward through transparent predecessors.
    const pendingLoads: number[] = [],
      pendingBlocks: number[] = [];
    stack.length = 0;
    for (const id of loadList) {
      if (id === undefined) throw "copy load block invariant";
      const block = fn.blocks[id];
      if (block === undefined) throw "copy block invariant";
      for (let index = 0; index < block.instructions.length; index++) {
        const op = block.instructions[index];
        if (op === undefined) throw "copy instruction invariant";
        if (op.kind !== "load" || loaded(op.id, op.slot) !== slot) continue;
        const state =
          storeStamp[id] === generation
            ? scan(block, index, slot, source)
            : transparent;
        if (state === valid) replace(op.id, id, source);
        else if (state === transparent) {
          pendingLoads.push(op.id);
          pendingBlocks.push(id);
          if (regionStamp[id] !== generation) {
            regionStamp[id] = generation;
            stack.push(id);
          }
        }
      }
    }
    if (pendingLoads.length === 0) continue;
    const region: number[] = [];
    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined) throw "copy region invariant";
      region.push(id);
      const start = predecessorCounts[id] ?? 0,
        end = predecessorCounts[id + 1] ?? 0;
      for (let edge = start; edge < end; edge++) {
        if (++visited > budget) return undefined;
        const from = predecessors[edge] ?? 0;
        if (regionStamp[from] === generation) continue;
        if (
          edgeState(from, predecessorExceptional[edge] === 1, slot, source) ===
          transparent
        ) {
          regionStamp[from] = generation;
          stack.push(from);
        }
      }
    }
    // Entry states: false where some incoming edge is invalid (the entry
    // block's own entry is unknown), propagated forward through transparent
    // region blocks.
    for (const id of region) {
      if (id === undefined) throw "copy region invariant";
      let failed = id === fn.entry;
      const start = predecessorCounts[id] ?? 0,
        end = predecessorCounts[id + 1] ?? 0;
      for (let edge = start; edge < end && !failed; edge++) {
        visited++;
        if (
          edgeState(
            predecessors[edge] ?? 0,
            predecessorExceptional[edge] === 1,
            slot,
            source,
          ) === invalid
        )
          failed = true;
      }
      if (failed && falseStamp[id] !== generation) {
        falseStamp[id] = generation;
        stack.push(id);
      }
    }
    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined) throw "copy region invariant";
      const start = successorCounts[id] ?? 0,
        end = successorCounts[id + 1] ?? 0;
      for (let edge = start; edge < end; edge++) {
        if (++visited > budget) return undefined;
        const to = successors[edge] ?? 0;
        if (regionStamp[to] !== generation || falseStamp[to] === generation)
          continue;
        if (
          edgeState(id, successorExceptional[edge] === 1, slot, source) ===
          transparent
        ) {
          falseStamp[to] = generation;
          stack.push(to);
        }
      }
    }
    if (visited > budget) return undefined;
    for (let index = 0; index < pendingLoads.length; index++) {
      const load = pendingLoads[index] ?? 0,
        block = pendingBlocks[index] ?? 0;
      if (falseStamp[block] !== generation) replace(load, block, source);
    }
  }
  if (rewritten === 0) return { fn, visited, rewritten: 0, refused: false };
  const blocks: Block[] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "copy block invariant";
    let instructions: Instruction[] | undefined;
    for (let index = 0; index < block.instructions.length; index++) {
      const op = block.instructions[index];
      if (op === undefined) throw "copy instruction invariant";
      const replacement = op.kind === "load" ? (replacements[op.id] ?? 0) : 0;
      if (replacement === 0) {
        if (instructions !== undefined) instructions.push(op);
        continue;
      }
      if (instructions === undefined)
        instructions = block.instructions.slice(0, index);
      if (op.kind !== "load") throw "copy rewrite invariant";
      instructions.push({ ...op, slot: replacement - 1 });
    }
    blocks.push(
      instructions === undefined ? block : { ...block, instructions },
    );
  }
  const result: FunctionIR = { ...fn, blocks };
  // The verifier proves direct record reads by tracing their object through
  // slot stores to a descriptor check (provenRecordReads); reading a source
  // instead of its copy can move the object off that trace. Keep the input
  // when any read loses its proof.
  let reads = 0;
  for (const block of blocks) {
    if (block === undefined) throw "copy block invariant";
    for (const op of block.instructions)
      if (op !== undefined && op.kind === "record-read") reads++;
  }
  if (reads > 0) {
    const proofs = provenRecordReads(result, verifierRecordWork, stableLayouts);
    visited += reads;
    let proven = proofs !== undefined;
    if (proofs !== undefined)
      for (const block of blocks) {
        if (block === undefined) throw "copy block invariant";
        for (const op of block.instructions)
          if (
            op !== undefined &&
            op.kind === "record-read" &&
            proofs[op.id] !== 1
          )
            proven = false;
      }
    if (!proven) return { fn, visited, rewritten: 0, refused: true };
  }
  return { fn: result, visited, rewritten, refused: false };
}
