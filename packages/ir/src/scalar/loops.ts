import type { Block, FunctionIR } from "./model.ts";

/** A natural loop: its header, the blocks of every cycle through it (loops
 * sharing a header are one loop), the blocks that branch back to it, and
 * the slots any of its blocks writes (stores, terminator destinations and
 * exception slots). */
export interface NaturalLoop {
  readonly header: number;
  readonly body: ReadonlySet<number>;
  readonly latches: readonly number[];
  readonly writes: ReadonlySet<number>;
}
export interface LoopForest {
  readonly loops: readonly NaturalLoop[];
  readonly visited: number;
}

/** Successor block IDs, normal edges first, then the exception edge. */
export function blockSuccessors(block: Block): number[] {
  const successors: number[] = [];
  const term = block.terminator;
  if (term.kind === "jump") successors.push(term.target);
  else if (
    term.kind === "branch" ||
    term.kind === "record" ||
    term.kind === "record-cell" ||
    term.kind === "cell"
  ) {
    successors.push(term.consequent);
    successors.push(term.alternate);
  }
  const exception = block.exception;
  if (exception !== undefined) successors.push(exception.target);
  return successors;
}

/** Natural loops from depth-first back edges (an edge to a block on the
 * search stack). Irreducible cycles still have such an edge, so every cycle
 * is covered by some loop's body. Undefined on budget exhaustion. */
export function naturalLoops(
  fn: FunctionIR,
  budget: number,
): LoopForest | undefined {
  let visited = 0;
  if (fn.import === true || fn.blocks.length === 0)
    return { loops: [], visited };
  const byId = new Map<number, Block>();
  for (const block of fn.blocks) {
    if (block === undefined) throw "loop block invariant";
    byId.set(block.id, block);
  }
  const backEdges: { readonly source: number; readonly header: number }[] = [],
    onStack = new Set<number>(),
    finished = new Set<number>();
  const stack: { readonly block: number; next: number }[] = [
    { block: fn.entry, next: 0 },
  ];
  onStack.add(fn.entry);
  while (stack.length > 0) {
    if (visited >= budget) return undefined;
    visited++;
    const frame = stack[stack.length - 1];
    if (frame === undefined) throw "loop stack invariant";
    const current = byId.get(frame.block);
    if (current === undefined) throw "loop block invariant";
    const successor = blockSuccessors(current)[frame.next];
    if (successor === undefined) {
      stack.pop();
      onStack.delete(frame.block);
      finished.add(frame.block);
      continue;
    }
    frame.next++;
    if (onStack.has(successor))
      backEdges.push({ source: frame.block, header: successor });
    else if (!finished.has(successor)) {
      onStack.add(successor);
      stack.push({ block: successor, next: 0 });
    }
  }
  const predecessors = new Map<number, number[]>();
  for (const block of fn.blocks) {
    if (block === undefined) throw "loop block invariant";
    for (const successor of blockSuccessors(block)) {
      if (successor === undefined) throw "loop successor invariant";
      const list = predecessors.get(successor);
      if (list === undefined) predecessors.set(successor, [block.id]);
      else list.push(block.id);
    }
  }
  const bodies = new Map<number, Set<number>>(),
    latches = new Map<number, number[]>(),
    order: number[] = [];
  for (const edge of backEdges) {
    if (edge === undefined) throw "loop edge invariant";
    const existing = bodies.get(edge.header),
      body = existing ?? new Set<number>();
    if (existing === undefined) {
      body.add(edge.header);
      bodies.set(edge.header, body);
      latches.set(edge.header, []);
      order.push(edge.header);
    }
    latches.get(edge.header)?.push(edge.source);
    const pending: number[] = [edge.source];
    while (pending.length > 0) {
      if (visited >= budget) return undefined;
      visited++;
      const id = pending.pop();
      if (id === undefined || body.has(id)) continue;
      body.add(id);
      for (const predecessor of predecessors.get(id) ?? [])
        if (predecessor !== undefined) pending.push(predecessor);
    }
  }
  const loops: NaturalLoop[] = [];
  for (const header of order) {
    if (header === undefined) throw "loop header invariant";
    const body = bodies.get(header);
    if (body === undefined) throw "loop body invariant";
    const writes = new Set<number>();
    for (const id of body) {
      const block = byId.get(id);
      if (block === undefined) throw "loop block invariant";
      if (visited >= budget) return undefined;
      visited++;
      const exception = block.exception;
      if (exception !== undefined) writes.add(exception.slot);
      const term = block.terminator;
      if (
        term.kind === "record" ||
        term.kind === "record-cell" ||
        term.kind === "cell"
      )
        writes.add(term.slot);
      for (const op of block.instructions)
        if (op !== undefined && op.kind === "store") writes.add(op.slot);
    }
    loops.push({ header, body, latches: latches.get(header) ?? [], writes });
  }
  return { loops, visited };
}
