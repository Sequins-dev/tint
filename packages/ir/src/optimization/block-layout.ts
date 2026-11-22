import type { Block, FunctionIR, Terminator } from "../scalar/model.ts";

/** Blocks that end the function abnormally: placed after every other block,
 * so no hot path falls through or branches past them. */
function coldBlock(block: Block): boolean {
  const kind = block.terminator.kind;
  return kind === "trap" || kind === "throw" || kind === "throw-literal";
}

/** Fallthrough-aware block order. Chains start at the entry and then at the
 * first unplaced block in the current order; each block is followed by its
 * preferred unplaced successor, so the emitter elides that edge's branch: a
 * jump's target, the success edge of a record or cell access, and for a
 * branch the earlier of its non-cold successors in the current order (the
 * source order of a loop body or `if` consequent). Blocks ending in a trap
 * or throw go last. Blocks are renumbered densely in the new order. Only
 * the layout changes: every edge keeps its source and target. */
export function layoutBlocks(
  fn: FunctionIR,
  budget: number,
): { fn: FunctionIR; visited: number; moved: number } | undefined {
  const count = fn.blocks.length;
  let visited = count;
  if (visited > budget) return undefined;
  const placed = new Uint8Array(count),
    cold = new Uint8Array(count),
    order: number[] = [];
  for (let id = 0; id < count; id++) {
    const block = fn.blocks[id];
    if (block === undefined || block.id !== id) return undefined;
    if (coldBlock(block)) cold[id] = 1;
  }
  function eligible(id: number): boolean {
    return placed[id] === 0 && cold[id] === 0;
  }
  function preferred(terminator: Terminator): number {
    if (terminator.kind === "jump")
      return placed[terminator.target] === 0 ? terminator.target : -1;
    if (
      terminator.kind === "record" ||
      terminator.kind === "record-cell" ||
      terminator.kind === "cell"
    ) {
      if (eligible(terminator.consequent)) return terminator.consequent;
      return eligible(terminator.alternate) ? terminator.alternate : -1;
    }
    if (terminator.kind === "branch") {
      const first = Math.min(terminator.consequent, terminator.alternate),
        second = Math.max(terminator.consequent, terminator.alternate);
      if (eligible(first)) return first;
      return eligible(second) ? second : -1;
    }
    return -1;
  }
  let start = 0,
    next = fn.entry;
  for (;;) {
    let id = next;
    while (id >= 0 && placed[id] === 0) {
      if (++visited > budget) return undefined;
      placed[id] = 1;
      order.push(id);
      const block = fn.blocks[id];
      if (block === undefined) throw "layout block invariant";
      id = preferred(block.terminator);
    }
    while (start < count && !eligible(start)) {
      if (++visited > budget) return undefined;
      start++;
    }
    if (start === count) break;
    next = start;
  }
  for (let id = 0; id < count; id++) if (placed[id] === 0) order.push(id);
  let moved = 0;
  const position = new Uint32Array(count);
  for (let index = 0; index < count; index++) {
    const id = order[index];
    if (id === undefined) throw "layout order invariant";
    position[id] = index;
    if (id !== index) moved++;
  }
  if (moved === 0) return { fn, visited, moved };
  function target(id: number): number {
    const mapped = position[id];
    if (mapped === undefined) throw "layout target invariant";
    return mapped;
  }
  const blocks: Block[] = [];
  for (const id of order) {
    if (++visited > budget) return undefined;
    const block = fn.blocks[id];
    if (block === undefined) throw "layout block invariant";
    const before = block.terminator;
    let terminator: Terminator = before;
    if (before.kind === "jump")
      terminator = { ...before, target: target(before.target) };
    else if (
      before.kind === "branch" ||
      before.kind === "record" ||
      before.kind === "record-cell" ||
      before.kind === "cell"
    )
      terminator = {
        ...before,
        consequent: target(before.consequent),
        alternate: target(before.alternate),
      };
    const handler = block.exception;
    blocks.push(
      handler === undefined
        ? { ...block, id: target(id), terminator }
        : {
            ...block,
            id: target(id),
            terminator,
            exception: { target: target(handler.target), slot: handler.slot },
          },
    );
  }
  return { fn: { ...fn, entry: target(fn.entry), blocks }, visited, moved };
}
