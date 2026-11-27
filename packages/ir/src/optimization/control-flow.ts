import type {
  FunctionIR,
  Block,
  Instruction,
  Terminator,
} from "../scalar/index.ts";
export interface ControlFlowOptimization {
  readonly fn: FunctionIR;
  readonly visited: number;
  readonly rewritten: number;
}
/** Whether `fn` belongs to the dynamic JavaScript runtime lowering (has a
 * script entry ABI or JS property/element access IR). Used to scope JS-only
 * loop/CFG cleanups so typed-only compilation remains unchanged. */
export function hasScriptOperations(fn: FunctionIR): boolean {
  if (fn.scriptEntry === true) return true;
  if (!fn.slots.includes("general")) return false;
  for (const block of fn.blocks) {
    if (block === undefined) continue;
    for (const op of block.instructions) {
      if (op === undefined) continue;
      if (
        op.kind === "property-load" ||
        op.kind === "property-store" ||
        op.kind === "element-load" ||
        op.kind === "element-store" ||
        op.kind === "general-element-load" ||
        op.kind === "general-element-store" ||
        op.kind === "element-length" ||
        op.kind === "script-argument" ||
        op.kind === "script-argument-count"
      )
        return true;
    }
  }
  return false;
}

function hasRecordRead(block: Block): boolean {
  for (const op of block.instructions)
    if (op !== undefined && op.kind === "record-read") return true;
  return false;
}

function sameException(
  left: Block["exception"],
  right: Block["exception"],
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.target === right.target && left.slot === right.slot;
}

/** Fold boolean constant branches, merge single-predecessor jump chains in
 * general functions, retain exceptional successors, and compact block IDs. No
 * instruction is reordered or removed from a reachable path. */
export function simplifyControlFlow(
  fn: FunctionIR,
  budget: number,
): ControlFlowOptimization | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0) return undefined;
  let visited = 0,
    rewritten = 0;
  let candidates: Block[] | undefined;
  for (let index = 0; index < fn.blocks.length; index++) {
    const block = fn.blocks[index];
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
            ...(term.inline === undefined ? {} : { inline: term.inline }),
          };
          rewritten++;
          break;
        }
      }
    }
    if (term !== block.terminator) {
      if (candidates === undefined) candidates = fn.blocks.slice(0, index);
      candidates.push({ ...block, terminator: term });
    } else if (candidates !== undefined) candidates.push(block);
  }
  const sourceBlocks = candidates ?? fn.blocks;
  if (hasScriptOperations(fn) && sourceBlocks.length > 1) {
    const preds = new Uint32Array(sourceBlocks.length);
    for (const block of sourceBlocks) {
      if (block === undefined || ++visited > budget) return undefined;
      const term = block.terminator;
      if (term.kind === "jump")
        preds[term.target] = (preds[term.target] ?? 0) + 1;
      else if (
        term.kind === "branch" ||
        term.kind === "record" ||
        term.kind === "record-cell" ||
        term.kind === "cell"
      ) {
        preds[term.consequent] = (preds[term.consequent] ?? 0) + 1;
        preds[term.alternate] = (preds[term.alternate] ?? 0) + 1;
      }
      if (block.exception !== undefined)
        preds[block.exception.target] =
          (preds[block.exception.target] ?? 0) + 1;
    }
    const merged = new Uint8Array(sourceBlocks.length);
    for (let id = 0; id < sourceBlocks.length; id++) {
      if (merged[id] === 1) continue;
      const startBlock = (candidates ?? sourceBlocks)[id];
      if (startBlock === undefined || hasRecordRead(startBlock)) continue;
      let block: Block = startBlock;
      let instructions: Instruction[] | undefined;
      while (true) {
        const term = block.terminator;
        if (term.kind !== "jump") break;
        const nextId = term.target;
        if (
          nextId === block.id ||
          nextId === fn.entry ||
          merged[nextId] === 1 ||
          preds[nextId] !== 1
        )
          break;
        const next: Block | undefined = (candidates ?? sourceBlocks)[nextId];
        if (
          next === undefined ||
          hasRecordRead(next) ||
          next.terminator.kind === "record" ||
          next.terminator.kind === "record-cell" ||
          block.instructions.length + next.instructions.length > 64 ||
          !sameException(block.exception, next.exception)
        )
          break;
        if (++visited > budget) return undefined;
        if (instructions === undefined)
          instructions = block.instructions.slice();
        const out = instructions;
        for (const op of next.instructions) {
          if (op === undefined) throw "CFG merge instruction invariant";
          out.push(op);
        }
        merged[nextId] = 1;
        rewritten++;
        const ex = block.exception;
        block =
          ex === undefined
            ? { id: block.id, instructions: out, terminator: next.terminator }
            : {
                id: block.id,
                instructions: out,
                terminator: next.terminator,
                exception: ex,
              };
      }
      if (instructions !== undefined) {
        if (candidates === undefined) candidates = sourceBlocks.slice();
        candidates[id] = block;
      }
    }
  }
  if (rewritten === 0) return { fn, visited, rewritten };
  const compacted = compactReachableBlocks(
    fn,
    candidates ?? fn.blocks,
    budget - visited,
  );
  if (compacted === undefined) return undefined;
  return {
    fn: compacted.fn,
    visited: visited + compacted.visited,
    rewritten: rewritten + compacted.removed,
  };
}
/** Replace a function's blocks (indexed by ID) with those reachable from the
 * entry through normal and exceptional edges, renumbered densely in order. */
export function compactReachableBlocks(
  fn: FunctionIR,
  candidates: readonly Block[],
  budget: number,
):
  | {
      readonly fn: FunctionIR;
      readonly visited: number;
      readonly removed: number;
    }
  | undefined {
  let visited = 0,
    removed = 0;
  const live = new Uint8Array(candidates.length),
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
  const mapping = new Uint32Array(candidates.length);
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
  let blocks: Block[] | undefined;
  for (let index = 0; index < candidates.length; index++) {
    const block = candidates[index];
    if (block === undefined || ++visited > budget) return undefined;
    if (live[block.id] === 0) {
      if (blocks === undefined) blocks = candidates.slice(0, index);
      removed++;
      continue;
    }
    const mappedId = target(block.id);
    const before = block.terminator;
    let terminator: Terminator = before;
    if (before.kind === "jump") {
      const mappedTarget = target(before.target);
      if (mappedTarget !== before.target)
        terminator = { ...before, target: mappedTarget };
    } else if (
      before.kind === "branch" ||
      before.kind === "record" ||
      before.kind === "record-cell" ||
      before.kind === "cell"
    ) {
      const mappedConsequent = target(before.consequent),
        mappedAlternate = target(before.alternate);
      if (
        mappedConsequent !== before.consequent ||
        mappedAlternate !== before.alternate
      )
        terminator = {
          ...before,
          consequent: mappedConsequent,
          alternate: mappedAlternate,
        };
    }
    const handler = block.exception;
    let next: Block = block;
    if (handler === undefined) {
      if (mappedId !== block.id || terminator !== before)
        next = { ...block, id: mappedId, terminator };
    } else {
      const mappedHandlerTarget = target(handler.target);
      if (
        mappedId !== block.id ||
        terminator !== before ||
        mappedHandlerTarget !== handler.target
      )
        next = {
          ...block,
          id: mappedId,
          terminator,
          exception:
            mappedHandlerTarget === handler.target
              ? handler
              : { target: mappedHandlerTarget, slot: handler.slot },
        };
    }
    if (next !== block) {
      if (blocks === undefined) blocks = candidates.slice(0, index);
      blocks.push(next);
    } else if (blocks !== undefined) blocks.push(block);
  }
  const entry = target(fn.entry),
    resultBlocks = blocks ?? candidates;
  return {
    fn:
      resultBlocks === fn.blocks && entry === fn.entry
        ? fn
        : { ...fn, entry, blocks: resultBlocks },
    visited,
    removed,
  };
}
