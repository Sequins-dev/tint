import { blockSuccessors, type FunctionIR } from "@tint/ir/scalar";
/** Blocks whose register contents at entry the emitter can derive from the
 * edges it has already emitted when it reaches them: every control-flow
 * predecessor precedes the block in layout. Excluded are the function entry
 * (entered from the prologue), targets of back edges (loop headers and
 * self-loops, whose latches are emitted later) and exception handler targets
 * (entered from landing pads emitted after the body). */
export function forwardableEntries(
  fn: FunctionIR,
  /** Emission order of block IDs (see chainedBlockOrder). */
  order: readonly number[],
): Set<number> {
  const position = new Map<number, number>();
  for (let index = 0; index < order.length; index++) {
    const id = order[index];
    if (id === undefined) throw "block entry invariant";
    position.set(id, index);
  }
  const excluded = new Set<number>();
  excluded.add(fn.entry);
  for (const block of fn.blocks) {
    if (block === undefined) throw "block entry invariant";
    const index = position.get(block.id) ?? 0;
    const handler = block.exception;
    if (handler !== undefined) excluded.add(handler.target);
    for (const successor of blockSuccessors(block)) {
      if (successor === undefined) throw "block entry invariant";
      const at = position.get(successor);
      if (at === undefined || at <= index) excluded.add(successor);
    }
  }
  const result = new Set<number>();
  for (const block of fn.blocks) {
    if (block === undefined) throw "block entry invariant";
    if (!excluded.has(block.id)) result.add(block.id);
  }
  return result;
}
/** Whether execution can continue past `word` into the next instruction:
 * false only for B, BR, RET and BRK. Unknown words count as falling through,
 * which only adds an edge and so keeps forwarding conservative. */
export function fallsThrough(word: number): boolean {
  if ((word & 0xfc000000) >>> 0 === 0x14000000) return false;
  const branchRegister = (word & 0xfffffc1f) >>> 0;
  if (branchRegister === 0xd61f0000 || branchRegister === 0xd65f0000)
    return false;
  return (word & 0xffe0001f) >>> 0 !== 0xd4200000;
}

/** Emission order of a function's blocks: IR order, except that a block
 * ending in a jump or a record access is followed by its (consequent)
 * successor when that successor has no other predecessor and is not yet
 * placed, so the common path falls through instead of taking a branch
 * (inlining and record lowering append such continuations at the end).
 * The entry stays first; every block appears exactly once. */
export function chainedBlockOrder(fn: FunctionIR): number[] {
  const predecessors = new Uint32Array(fn.blocks.length);
  for (const block of fn.blocks) {
    if (block === undefined) throw "block order invariant";
    for (const successor of blockSuccessors(block))
      if (successor !== undefined)
        predecessors[successor] = (predecessors[successor] ?? 0) + 1;
    const handler = block.exception;
    if (handler !== undefined)
      predecessors[handler.target] = (predecessors[handler.target] ?? 0) + 2;
  }
  const placed = new Uint8Array(fn.blocks.length),
    order: number[] = [];
  /** The single-predecessor continuation that should follow `id`. */
  function continuation(id: number): number {
    const block = fn.blocks[id];
    if (block === undefined) throw "block order invariant";
    const term = block.terminator;
    let next = -1;
    if (term.kind === "jump") next = term.target;
    else if (term.kind === "record" || term.kind === "record-cell")
      next = term.consequent;
    return next >= 0 && next !== fn.entry && (predecessors[next] ?? 0) === 1
      ? next
      : -1;
  }
  function place(id: number): void {
    let current = id;
    while (current >= 0 && placed[current] !== 1) {
      placed[current] = 1;
      order.push(current);
      current = continuation(current);
    }
  }
  place(fn.entry);
  for (const block of fn.blocks) {
    if (block === undefined) throw "block order invariant";
    place(block.id);
  }
  return order;
}
