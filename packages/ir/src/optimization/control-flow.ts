import type { FunctionIR, Block, Terminator } from "../scalar/index.ts";
export interface ControlFlowOptimization {
  readonly fn: FunctionIR;
  readonly visited: number;
  readonly rewritten: number;
}
/** Fold boolean constant branches, retain exceptional successors, and compact
 * block IDs. No instruction is reordered or removed from a reachable path. */
export function simplifyControlFlow(
  fn: FunctionIR,
  budget: number,
): ControlFlowOptimization | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0) return undefined;
  let visited = 0,
    rewritten = 0;
  const candidates: Block[] = [];
  for (const block of fn.blocks) {
    if (block === undefined || ++visited > budget) return undefined;
    let term = block.terminator;
    if (term.kind === "branch") {
      for (const op of block.instructions) {
        if (op === undefined || ++visited > budget) return undefined;
        if (
          op.kind === "constant" &&
          op.id === term.condition &&
          typeof op.value === "boolean"
        ) {
          term = {
            kind: "jump",
            target: op.value ? term.consequent : term.alternate,
            start: term.start,
            end: term.end,
          };
          rewritten++;
          break;
        }
      }
    }
    candidates.push(
      term === block.terminator ? block : { ...block, terminator: term },
    );
  }
  if (rewritten === 0) return { fn, visited, rewritten };
  const live = new Uint8Array(fn.blocks.length),
    pending: number[] = [fn.entry];
  for (let cursor = 0; cursor < pending.length; cursor++) {
    if (++visited > budget) return undefined;
    const id = pending[cursor];
    if (id === undefined) throw "CFG queue invariant";
    if (live[id] === 1) continue;
    live[id] = 1;
    const block = candidates[id];
    if (block === undefined) throw "CFG block invariant";
    const term = block.terminator;
    if (term.kind === "jump") pending.push(term.target);
    else if (
      term.kind === "branch" ||
      term.kind === "record" ||
      term.kind === "record-cell" ||
      term.kind === "cell"
    ) {
      pending.push(term.consequent);
      pending.push(term.alternate);
    }
    if (block.exception !== undefined) pending.push(block.exception.target);
  }
  const mapping = new Uint32Array(fn.blocks.length);
  let count = 0;
  for (let id = 0; id < live.length; id++) {
    if (++visited > budget) return undefined;
    if (live[id] === 1) mapping[id] = ++count;
  }
  function target(id: number): number {
    const mapped = mapping[id] ?? 0;
    if (mapped === 0) throw "CFG removed target";
    return mapped - 1;
  }
  const blocks: Block[] = [];
  for (const block of candidates) {
    if (block === undefined || ++visited > budget) return undefined;
    if (live[block.id] === 0) {
      rewritten++;
      continue;
    }
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
        ? { ...block, id: target(block.id), terminator }
        : {
            ...block,
            id: target(block.id),
            terminator,
            exception: { target: target(handler.target), slot: handler.slot },
          },
    );
  }
  return { fn: { ...fn, entry: target(fn.entry), blocks }, visited, rewritten };
}
