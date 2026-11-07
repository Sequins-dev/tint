import type { FunctionIR } from "./model.ts";
export interface InitializationSlots {
  readonly indices: Uint32Array;
  readonly count: number;
}
interface IncomingEdge {
  readonly block: number;
  readonly exceptional: boolean;
  readonly initializedSlot: number | undefined;
}
/** Verified slots/graph only. Parameters and locally proved definitions need no
 * fixed-point facts. Zero denotes an untracked slot; other indices are dense bit
 * positions plus one. Unproved reads retain the full initialization analysis. */
export function initializationSlots(fn: FunctionIR): InitializationSlots {
  const indices = new Uint32Array(fn.slots.length),
    parameters = new Uint8Array(fn.slots.length),
    defined = new Uint32Array(fn.slots.length);
  for (const slot of fn.parameters) {
    if (slot === undefined) throw "initialization parameter invariant";
    parameters[slot] = 1;
  }
  if (fn.receiverSlot !== undefined) parameters[fn.receiverSlot] = 1;
  let incoming: IncomingEdge[][] | undefined,
    proofBudget = 0;
  function predecessors(): IncomingEdge[][] {
    if (incoming !== undefined) return incoming;
    const edges: IncomingEdge[][] = fn.blocks.map(() => []);
    function edge(
      source: number,
      target: number,
      exceptional: boolean,
      initializedSlot: number | undefined,
    ): void {
      const list = edges[target];
      if (list === undefined) throw "initialization predecessor invariant";
      list.push({ block: source, exceptional, initializedSlot });
    }
    for (const block of fn.blocks) {
      if (block === undefined) throw "initialization block invariant";
      const term = block.terminator;
      if (term.kind === "jump") edge(block.id, term.target, false, undefined);
      else if (
        term.kind === "branch" ||
        term.kind === "cell" ||
        term.kind === "record" ||
        term.kind === "record-cell"
      ) {
        const initializedSlot =
          term.kind !== "branch" &&
          term.operation === "read" &&
          term.consequent !== term.alternate
            ? term.slot
            : undefined;
        edge(block.id, term.consequent, false, initializedSlot);
        edge(block.id, term.alternate, false, undefined);
      }
      if (block.exception !== undefined)
        edge(block.id, block.exception.target, true, block.exception.slot);
    }
    incoming = edges;
    return edges;
  }
  function initializedAtEntry(block: number, slot: number): boolean {
    // Backedges must never strengthen the function's initial boundary. A shared
    // budget bounds both recursion and instruction scans, including diamonds.
    if (--proofBudget < 0 || block === fn.entry) return false;
    const edges = predecessors()[block];
    if (edges === undefined || edges.length === 0) return false;
    for (const edge of edges) {
      if (--proofBudget < 0) return false;
      if (edge.initializedSlot === slot) continue;
      // A handler can be reached before a later store in its source block.
      // Only its explicit exception transfer slot is locally established.
      if (edge.exceptional) return false;
      const source = fn.blocks[edge.block];
      if (source === undefined) throw "initialization predecessor invariant";
      let stored = false;
      for (let i = source.instructions.length - 1; i >= 0; i--) {
        if (--proofBudget < 0) return false;
        const op = source.instructions[i];
        if (op === undefined) throw "initialization instruction invariant";
        if (op.kind === "store" && op.slot === slot) {
          stored = true;
          break;
        }
      }
      if (!stored && !initializedAtEntry(edge.block, slot)) return false;
    }
    return true;
  }
  function requiresFacts(block: number, slot: number): boolean {
    proofBudget = 128;
    return !initializedAtEntry(block, slot);
  }
  let count = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "initialization block invariant";
    const stamp = block.id + 1;
    for (const op of block.instructions) {
      if (op === undefined) throw "initialization instruction invariant";
      if (op.kind === "store") defined[op.slot] = stamp;
      else if (
        op.kind === "load" &&
        parameters[op.slot] !== 1 &&
        defined[op.slot] !== stamp &&
        indices[op.slot] === 0 &&
        requiresFacts(block.id, op.slot)
      )
        indices[op.slot] = ++count;
    }
    const term = block.terminator;
    if (
      (term.kind === "cell" ||
        term.kind === "record" ||
        term.kind === "record-cell") &&
      term.operation !== "read" &&
      parameters[term.slot] !== 1 &&
      defined[term.slot] !== stamp &&
      indices[term.slot] === 0 &&
      requiresFacts(block.id, term.slot)
    )
      indices[term.slot] = ++count;
  }
  return { indices, count };
}
