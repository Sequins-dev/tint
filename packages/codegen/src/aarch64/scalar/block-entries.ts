import { blockSuccessors, type Block, type FunctionIR } from "@tint/ir/scalar";
function isColdBlock(block: Block): boolean {
  const kind = block.terminator.kind;
  return (
    block.instructions.length <= 4 &&
    (kind === "trap" || kind === "throw" || kind === "throw-literal")
  );
}
function prefersAlternateFallthrough(block: Block): boolean {
  const term = block.terminator;
  if (term.kind !== "branch") return false;
  const condition = term.condition;
  for (
    let i = block.instructions.length - 1;
    i >= 0 && i >= block.instructions.length - 6;
    i--
  ) {
    const op = block.instructions[i];
    if (op === undefined) continue;
    if (op.kind === "binary" && op.id === condition)
      return op.operator === "===" || op.operator === "==";
  }
  return false;
}
/** Orders blocks in greedy hot-trace fallthrough order, placing entry first,
 * keeping sequential loop and dispatch bodies contiguous, and sinking
 * trap/throw blocks to the end of the function. */
export function orderBlocks(fn: FunctionIR): readonly Block[] {
  if (fn.blocks.length <= 2) return fn.blocks;
  const byId = new Map<number, Block>();
  for (const block of fn.blocks) {
    if (block === undefined) throw "block entry invariant";
    byId.set(block.id, block);
  }
  const ordered: Block[] = [],
    placed = new Set<number>(),
    hotWork: Block[] = [],
    coldWork: Block[] = [];
  const enqueue = (target: number): void => {
    if (placed.has(target)) return;
    const block = byId.get(target);
    if (block === undefined) return;
    if (isColdBlock(block)) coldWork.push(block);
    else hotWork.push(block);
  };
  const entry = byId.get(fn.entry) ?? fn.blocks[0];
  if (entry !== undefined) hotWork.push(entry);
  while (hotWork.length > 0 || coldWork.length > 0) {
    let current = hotWork.pop() ?? coldWork.pop();
    while (current !== undefined && !placed.has(current.id)) {
      placed.add(current.id);
      ordered.push(current);
      const t = current.terminator;
      let nextId: number | undefined;
      if (t.kind === "jump") {
        nextId = t.target;
      } else if (
        t.kind === "record" ||
        t.kind === "record-cell" ||
        t.kind === "cell"
      ) {
        nextId = t.consequent;
        enqueue(t.alternate);
      } else if (t.kind === "branch") {
        const cons = byId.get(t.consequent),
          alt = byId.get(t.alternate),
          consCold = cons !== undefined && isColdBlock(cons),
          altCold = alt !== undefined && isColdBlock(alt),
          consRet = cons !== undefined && cons.terminator.kind === "return",
          altRet = alt !== undefined && alt.terminator.kind === "return";
        if (altCold && !consCold) {
          nextId = t.consequent;
          enqueue(t.alternate);
        } else if (consCold && !altCold) {
          nextId = t.alternate;
          enqueue(t.consequent);
        } else if (consRet && !altRet) {
          nextId = t.alternate;
          enqueue(t.consequent);
        } else if (altRet && !consRet) {
          nextId = t.consequent;
          enqueue(t.alternate);
        } else if (prefersAlternateFallthrough(current)) {
          nextId = t.alternate;
          enqueue(t.consequent);
        } else {
          nextId = t.consequent;
          enqueue(t.alternate);
        }
      }
      if (current.exception !== undefined) enqueue(current.exception.target);
      const nextBlock = nextId === undefined ? undefined : byId.get(nextId);
      current =
        nextBlock !== undefined && !placed.has(nextBlock.id)
          ? nextBlock
          : undefined;
    }
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "block entry invariant";
    if (!placed.has(block.id)) {
      placed.add(block.id);
      ordered.push(block);
    }
  }
  return ordered;
}
/** Blocks whose register contents at entry the emitter can derive from the
 * edges it has already emitted when it reaches them: every control-flow
 * predecessor precedes the block in layout. Excluded are the function entry
 * (entered from the prologue), targets of back edges (loop headers and
 * self-loops, whose latches are emitted later) and exception handler targets
 * (entered from landing pads emitted after the body). */
export function forwardableEntries(
  fn: FunctionIR,
  blocks: readonly Block[] = fn.blocks,
): Set<number> {
  const position = new Map<number, number>();
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block === undefined) throw "block entry invariant";
    position.set(block.id, index);
  }
  const excluded = new Set<number>();
  excluded.add(fn.entry);
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block === undefined) throw "block entry invariant";
    const handler = block.exception;
    if (handler !== undefined) excluded.add(handler.target);
    for (const successor of blockSuccessors(block)) {
      if (successor === undefined) throw "block entry invariant";
      const at = position.get(successor);
      if (at === undefined || at <= index) excluded.add(successor);
    }
  }
  const result = new Set<number>();
  for (const block of blocks) {
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
