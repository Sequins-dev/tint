import { blockSuccessors, type FunctionIR } from "@tint/ir/scalar";
/** Blocks whose register contents at entry the emitter can derive from the
 * edges it has already emitted when it reaches them: every control-flow
 * predecessor precedes the block in layout. Excluded are the function entry
 * (entered from the prologue), targets of back edges (loop headers and
 * self-loops, whose latches are emitted later) and exception handler targets
 * (entered from landing pads emitted after the body). */
export function forwardableEntries(fn: FunctionIR): Set<number> {
  const position = new Map<number, number>();
  for (let index = 0; index < fn.blocks.length; index++) {
    const block = fn.blocks[index];
    if (block === undefined) throw "block entry invariant";
    position.set(block.id, index);
  }
  const excluded = new Set<number>();
  excluded.add(fn.entry);
  for (let index = 0; index < fn.blocks.length; index++) {
    const block = fn.blocks[index];
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
