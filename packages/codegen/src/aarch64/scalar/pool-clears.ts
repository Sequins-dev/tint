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
/** Deferred dead-slot clears. A slot that dies at a block entry only has to be
 * zero before the next collection could scan it; until then its stale value
 * is unobservable, and a store to its word makes the word valid again. Words
 * pending since their slot died (and not stored since) are cleared at the
 * entry of each collecting block; other blocks clear nothing and pass their
 * pending words on (all of them on exceptional edges, since a throw may
 * precede the block's stores). Every collection therefore still sees every
 * dead slot zeroed. `deaths(block)` lists word indices dying at its entry,
 * `writes(block)` the words it stores. Returns sorted indices per block id, or
 * undefined when the fixed point would exceed `budget` word operations. */
export function deadSlotClearPlan(
  fn: FunctionIR,
  words: number,
  deaths: (block: number) => readonly number[],
  writes: (block: number) => readonly number[],
  slotWords: (slot: number) => readonly number[],
  collecting: (block: number) => boolean,
  budget: number,
): readonly (readonly number[])[] | undefined {
  const count = fn.blocks.length,
    stride = Math.ceil(words / 32);
  if (count === 0 || words === 0) return [];
  let work = count * stride * 2;
  // Words stored on an edge rather than by an instruction: a guarded read's
  // transfer slot on its consequent edge, and the thrown value's slot on
  // entry to a handler. Pending clears must not reach (and erase) them.
  const transfer = new Uint32Array(count * stride),
    caught = new Uint32Array(count * stride);
  if (!Number.isSafeInteger(work) || work > budget) return undefined;
  const incoming = new Uint32Array(count * stride),
    born = new Uint32Array(count * stride),
    stored = new Uint32Array(count * stride),
    clears = new Uint8Array(count),
    queued = new Uint8Array(count),
    queue: number[] = [];
  function mark(table: Uint32Array, block: number, word: number): boolean {
    if (word < 0 || word >= words) return false;
    const at = block * stride + (word >>> 5);
    table[at] = ((table[at] ?? 0) | (1 << (word & 31))) >>> 0;
    return true;
  }
  for (let index = 0; index < count; index++) {
    const block = fn.blocks[index];
    if (block === undefined || block.id !== index) return undefined;
    clears[index] = collecting(index) ? 1 : 0;
    for (const word of deaths(index)) {
      if (word === undefined || !mark(born, index, word)) return undefined;
    }
    for (const word of writes(index)) {
      if (word === undefined || !mark(stored, index, word)) return undefined;
    }
    const term = block.terminator;
    if (
      (term.kind === "cell" ||
        term.kind === "record" ||
        term.kind === "record-cell") &&
      term.operation === "read"
    )
      for (const word of slotWords(term.slot)) {
        if (word === undefined) throw "dead clear transfer invariant";
        mark(transfer, index, word);
      }
    const handler = block.exception;
    if (handler !== undefined)
      for (const word of slotWords(handler.slot)) {
        if (word === undefined) throw "dead clear handler invariant";
        mark(caught, handler.target, word);
      }
    queue.push(index);
    queued[index] = 1;
  }
  if (fn.entry < 0 || fn.entry >= count) return undefined;
  const normal = new Uint32Array(stride),
    exceptional = new Uint32Array(stride);
  function propagate(
    target: number,
    outgoing: Uint32Array,
    killed: Uint32Array | undefined,
    killedAt: number,
  ): void {
    if (target < 0 || target >= count) throw "dead clear target invariant";
    let changed = false;
    for (let i = 0; i < stride; i++) {
      const at = target * stride + i,
        mask =
          ((caught[at] ?? 0) |
            (killed === undefined ? 0 : (killed[killedAt + i] ?? 0))) >>>
          0,
        before = incoming[at] ?? 0,
        after = (before | ((outgoing[i] ?? 0) & ~mask)) >>> 0;
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
    if (index === undefined) throw "dead clear queue invariant";
    queued[index] = 0;
    work += stride * 4;
    if (work > budget) return undefined;
    const block = fn.blocks[index];
    if (block === undefined) throw "dead clear block invariant";
    const collects = clears[index] === 1;
    for (let i = 0; i < stride; i++) {
      const at = index * stride + i,
        pending = ((incoming[at] ?? 0) | (born[at] ?? 0)) >>> 0;
      // A collecting block clears every pending word at its entry.
      exceptional[i] = collects ? 0 : pending;
      normal[i] = collects ? 0 : (pending & ~(stored[at] ?? 0)) >>> 0;
    }
    const term = block.terminator;
    if (term.kind === "jump") propagate(term.target, normal, undefined, 0);
    else if (term.kind === "branch") {
      propagate(term.consequent, normal, undefined, 0);
      if (term.alternate !== term.consequent)
        propagate(term.alternate, normal, undefined, 0);
    } else if (
      term.kind === "cell" ||
      term.kind === "record" ||
      term.kind === "record-cell"
    ) {
      // When both edges share a target, the transfer write still masks the
      // word: skipping a dead clear only retains a valid stale reference,
      // whereas clearing a transferred value would corrupt it.
      propagate(term.consequent, normal, transfer, index * stride);
      if (term.alternate !== term.consequent)
        propagate(term.alternate, normal, undefined, 0);
    }
    const handler = block.exception;
    if (handler !== undefined)
      propagate(handler.target, exceptional, undefined, 0);
    if (head > 4096 && head * 2 > queue.length) {
      queue.splice(0, head);
      head = 0;
    }
  }
  const plan: number[][] = [];
  for (let index = 0; index < count; index++) {
    const required: number[] = [];
    if (clears[index] === 1)
      for (let word = 0; word < words; word++) {
        const at = index * stride + (word >>> 5),
          bit = 1 << (word & 31);
        if ((((incoming[at] ?? 0) | (born[at] ?? 0)) & bit) !== 0)
          required.push(word);
      }
    plan.push(required);
  }
  return plan;
}
/** Slot root words the prologue must zero before publishing the frame. A word
 * needs zeroing only if some path from entry reaches a possible collection, or
 * a read of that word, before a store writes it: the collector then scans the
 * frame and verified IR may rely on a zero (absent) initial value. Must-write
 * forward dataflow over word indices; `initial` lists words the prologue
 * itself stores. Guarded `read` terminators write their slot only on the
 * consequent edge, and other cell/record terminators read it. Exception
 * handlers inherit the throwing block's entry state, since a throw may precede
 * every store in it, and `throw`/`throw-literal` count as collections. Clears
 * are not treated as writes. `wordsOf(slot)` lists a slot's root word
 * indices; slots sharing an offset share words, so a store to either writes
 * the word. Calls collect unless `noSafepoints` proves the target never does.
 * Returns a per-word mark (1 = zero in the prologue), or undefined when
 * `budget` word operations would be exceeded. */
export function prologueClearWords(
  fn: FunctionIR,
  words: number,
  initial: readonly number[],
  wordsOf: (slot: number) => readonly number[],
  noSafepoints: Uint8Array | undefined,
  budget: number,
): Uint8Array | undefined {
  const blockCount = fn.blocks.length,
    stride = (words + 31) >>> 5;
  let work = blockCount * (stride + 1) + words;
  if (work > budget) return undefined;
  for (let index = 0; index < blockCount; index++)
    if (fn.blocks[index]?.id !== index) return undefined;
  const entry = fn.entry;
  if (entry < 0 || entry >= blockCount) return undefined;
  // Unreached blocks keep the all-written top state and expose nothing.
  const states = new Uint32Array(blockCount * stride).fill(0xffffffff),
    reached = new Uint8Array(blockCount),
    queued = new Uint8Array(blockCount),
    exposed = new Uint8Array(words),
    state = new Uint32Array(stride),
    edge = new Uint32Array(stride);
  for (let index = 0; index < stride; index++)
    states[entry * stride + index] = 0;
  for (const word of initial) {
    if (word === undefined || word < 0 || word >= words)
      throw "prologue word invariant";
    states[entry * stride + (word >>> 5)] =
      (states[entry * stride + (word >>> 5)] ?? 0) | (1 << (word & 31));
  }
  reached[entry] = 1;
  function has(word: number): boolean {
    return ((state[word >>> 5] ?? 0) & (1 << (word & 31))) !== 0;
  }
  function read(slot: number, final: boolean): void {
    if (!final) return;
    for (const word of wordsOf(slot)) {
      if (word === undefined) throw "prologue read invariant";
      if (!has(word)) exposed[word] = 1;
    }
  }
  function write(slot: number, into: Uint32Array): void {
    for (const word of wordsOf(slot)) {
      if (word === undefined) throw "prologue write invariant";
      into[word >>> 5] = (into[word >>> 5] ?? 0) | (1 << (word & 31));
    }
  }
  function collect(final: boolean): void {
    if (!final) return;
    work += words;
    for (let word = 0; word < words; word++) if (!has(word)) exposed[word] = 1;
  }
  const worklist: number[] = [entry];
  queued[entry] = 1;
  // Meet `from` into a successor's state; requeue it when the state shrinks.
  function meet(target: number, from: Uint32Array): void {
    if (target < 0 || target >= blockCount) throw "prologue edge invariant";
    let changed = reached[target] !== 1;
    reached[target] = 1;
    const base = target * stride;
    for (let index = 0; index < stride; index++) {
      const before = states[base + index] ?? 0,
        after = (before & (from[index] ?? 0)) >>> 0;
      if (after !== before) {
        states[base + index] = after;
        changed = true;
      }
    }
    work += stride;
    if (changed && queued[target] !== 1) {
      queued[target] = 1;
      worklist.push(target);
    }
  }
  function visit(index: number, final: boolean): void {
    const block = fn.blocks[index];
    if (block === undefined) throw "prologue block invariant";
    const base = index * stride;
    for (let word = 0; word < stride; word++)
      state[word] = states[base + word] ?? 0;
    // A throw may precede every store in the block.
    if (block.exception !== undefined && !final)
      meet(block.exception.target, state);
    for (const op of block.instructions) {
      if (op === undefined) throw "prologue instruction invariant";
      work++;
      if (op.kind === "load") read(op.slot, final);
      else if (op.kind === "store") write(op.slot, state);
      else if (
        op.kind === "call"
          ? noSafepoints === undefined || noSafepoints[op.target] !== 1
          : (instructionEffects(op) & effectAllocate) !== 0
      )
        collect(final);
    }
    const term = block.terminator;
    switch (term.kind) {
      case "jump":
        if (!final) meet(term.target, state);
        break;
      case "branch":
        if (!final) {
          meet(term.consequent, state);
          meet(term.alternate, state);
        }
        break;
      case "record":
      case "record-cell":
      case "cell":
        if (term.operation !== "read") read(term.slot, final);
        if (!final) {
          meet(term.alternate, state);
          for (let word = 0; word < stride; word++)
            edge[word] = state[word] ?? 0;
          if (term.operation === "read") write(term.slot, edge);
          meet(term.consequent, edge);
        }
        break;
      case "throw":
      case "throw-literal":
        collect(final);
        break;
      case "return":
      case "trap":
        break;
    }
  }
  while (worklist.length > 0) {
    const index = worklist.pop();
    if (index === undefined) throw "prologue worklist invariant";
    queued[index] = 0;
    visit(index, false);
    if (work > budget) return undefined;
  }
  for (let index = 0; index < blockCount; index++) {
    if (reached[index] !== 1) continue;
    visit(index, true);
    if (work > budget) return undefined;
  }
  return exposed;
}
