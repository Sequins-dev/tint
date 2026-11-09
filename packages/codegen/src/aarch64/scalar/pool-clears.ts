import {
  instructionEffects,
  instructionResult,
  effectAllocate,
  type Block,
  type FunctionIR,
} from "@tint/ir/scalar";
/** Results a block defines before its first possible collection: calls not
 * proven free of safepoints and allocating instructions. A call's own result
 * is written after the call, so it is never included. */
export function preSafepointResults(
  block: Block,
  noSafepoints: Uint8Array | undefined,
): readonly number[] {
  const results: number[] = [];
  for (const op of block.instructions) {
    if (op === undefined) throw "safepoint instruction invariant";
    const collects =
      op.kind === "call"
        ? noSafepoints === undefined || noSafepoints[op.target] !== 1
        : (instructionEffects(op) & effectAllocate) !== 0;
    if (collects) break;
    const id = instructionResult(op);
    if (id !== undefined) results.push(id);
  }
  return results;
}
/** Temporary-root pool words to zero at each block entry. A collecting block
 * must observe an all-zero pool, so it clears exactly the words that may hold
 * a value written since the last clear on some path (including exceptional
 * edges); other blocks clear nothing. `written(block)` lists pool word indices
 * a block may write (its results' homes). `covered(block)` lists words the
 * block stores before its first possible collection; a collecting block need
 * not clear those, since no collection observes their stale contents. `collecting(block)` is false only
 * for blocks that can never run a collection and for blocks that are never
 * emitted, which therefore keep (never clear) the incoming words. The pool is
 * all-zero at entry unless `dirtyAtEntry`. Returns sorted indices per block id,
 * or undefined when the fixed point would exceed `budget` word operations. */
export function poolClearPlan(
  fn: FunctionIR,
  words: number,
  written: (block: number) => readonly number[],
  covered: (block: number) => readonly number[],
  collecting: (block: number) => boolean,
  dirtyAtEntry: boolean,
  budget: number,
): readonly (readonly number[])[] | undefined {
  const count = fn.blocks.length,
    stride = Math.ceil(words / 32);
  if (count === 0 || words === 0) return [];
  let work = count * stride;
  if (!Number.isSafeInteger(work) || work > budget) return undefined;
  const incoming = new Uint32Array(count * stride),
    writes = new Uint32Array(count * stride),
    clears = new Uint8Array(count),
    queued = new Uint8Array(count),
    queue: number[] = [];
  for (let index = 0; index < count; index++) {
    const block = fn.blocks[index];
    if (block === undefined || block.id !== index) return undefined;
    clears[index] = collecting(index) ? 1 : 0;
    for (const word of written(index)) {
      if (word === undefined || word < 0 || word >= words) return undefined;
      const at = index * stride + (word >>> 5);
      writes[at] = (writes[at] ?? 0) | (1 << (word & 31));
    }
  }
  const entry = fn.entry;
  if (entry < 0 || entry >= count) return undefined;
  if (dirtyAtEntry)
    for (let word = 0; word < words; word++) {
      const at = entry * stride + (word >>> 5);
      incoming[at] = (incoming[at] ?? 0) | (1 << (word & 31));
    }
  for (let index = 0; index < count; index++) {
    queue.push(index);
    queued[index] = 1;
  }
  const outgoing = new Uint32Array(stride);
  function propagate(target: number): void {
    if (target < 0 || target >= count) throw "pool clear target invariant";
    let changed = false;
    for (let i = 0; i < stride; i++) {
      const at = target * stride + i,
        before = incoming[at] ?? 0,
        after = (before | (outgoing[i] ?? 0)) >>> 0;
      if (after !== before) {
        incoming[at] = after;
        changed = true;
      }
    }
    if (changed && queued[target] === 0) {
      queued[target] = 1;
      queue.push(target);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const index = queue[head++];
    if (index === undefined) throw "pool clear queue invariant";
    queued[index] = 0;
    work += stride * 4;
    if (work > budget) return undefined;
    const block = fn.blocks[index];
    if (block === undefined) throw "pool clear block invariant";
    const keeps = clears[index] === 0;
    for (let i = 0; i < stride; i++)
      outgoing[i] =
        (keeps ? (incoming[index * stride + i] ?? 0) : 0) |
        (writes[index * stride + i] ?? 0);
    const term = block.terminator;
    if (term.kind === "jump") propagate(term.target);
    else if (
      term.kind === "branch" ||
      term.kind === "cell" ||
      term.kind === "record" ||
      term.kind === "record-cell"
    ) {
      propagate(term.consequent);
      if (term.alternate !== term.consequent) propagate(term.alternate);
    }
    const handler = block.exception;
    if (handler !== undefined) propagate(handler.target);
    // Compact the consumed prefix so long worklists stay linear in memory.
    if (head > 4096 && head * 2 > queue.length) {
      queue.splice(0, head);
      head = 0;
    }
  }
  const plan: number[][] = [],
    skip = new Uint32Array(stride);
  for (let index = 0; index < count; index++) {
    const required: number[] = [];
    if (clears[index] === 1) {
      skip.fill(0);
      for (const word of covered(index)) {
        if (word === undefined || word < 0 || word >= words) return undefined;
        skip[word >>> 5] = (skip[word >>> 5] ?? 0) | (1 << (word & 31));
      }
      for (let word = 0; word < words; word++) {
        const bit = 1 << (word & 31),
          at = word >>> 5;
        if (
          ((incoming[index * stride + at] ?? 0) & bit) !== 0 &&
          ((skip[at] ?? 0) & bit) === 0
        )
          required.push(word);
      }
    }
    plan.push(required);
  }
  return plan;
}
