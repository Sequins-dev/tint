import type { Block, FunctionIR, Instruction } from "../scalar/index.ts";
import {
  instructionResult,
  visitInstructionOperands,
} from "../scalar/index.ts";
import { compactReachableBlocks } from "./control-flow.ts";

export interface CoalesceOptimization {
  readonly fn: FunctionIR;
  readonly visited: number;
  readonly rewritten: number;
}

function sameHandler(a: Block, b: Block): boolean {
  const x = a.exception,
    y = b.exception;
  if (x === undefined || y === undefined) return x === y;
  return x.target === y.target && x.slot === y.slot;
}
/** Rewrites the coalesce ending block P, if any, and returns the new block.
 * Counters: state[0] visited, state[1] rewritten, state[2] maximum value ID,
 * state[3] budget. */
function rewriteCoalesce(
  p: Block,
  blocks: Block[],
  entries: Uint32Array,
  entry: number,
  state: Float64Array,
): Block | undefined {
  const t = p.terminator;
  if (t.kind !== "branch" || t.consequent === t.alternate) return undefined;
  const present = blocks[t.consequent],
    absent = blocks[t.alternate];
  if (present === undefined || absent === undefined)
    throw "coalesce target invariant";
  if (
    present.id === p.id ||
    absent.id === p.id ||
    entries[present.id] !== 1 ||
    entries[absent.id] !== 1 ||
    present.instructions.length !== 3 ||
    absent.instructions.length !== 2
  )
    return undefined;
  const reload = present.instructions[0],
    unwrap = present.instructions[1],
    presentStore = present.instructions[2],
    constant = absent.instructions[0],
    absentStore = absent.instructions[1],
    presentJump = present.terminator,
    absentJump = absent.terminator;
  if (
    reload === undefined ||
    unwrap === undefined ||
    presentStore === undefined ||
    constant === undefined ||
    absentStore === undefined ||
    reload.kind !== "load" ||
    unwrap.kind !== "optional-value" ||
    unwrap.value !== reload.id ||
    presentStore.kind !== "store" ||
    presentStore.value !== unwrap.id ||
    constant.kind !== "constant" ||
    typeof constant.value !== "number" ||
    absentStore.kind !== "store" ||
    absentStore.value !== constant.id ||
    absentStore.slot !== presentStore.slot ||
    presentJump.kind !== "jump" ||
    absentJump.kind !== "jump" ||
    presentJump.target !== absentJump.target
  )
    return undefined;
  const joinId = presentJump.target,
    join = blocks[joinId];
  if (join === undefined) throw "coalesce join invariant";
  if (
    joinId === p.id ||
    joinId === present.id ||
    joinId === absent.id ||
    entries[joinId] !== 2
  )
    return undefined;
  // The tested optional, P's last store to the reloaded slot, and whether
  // anything but the branch uses the presence test.
  const condition = t.condition,
    uses = new Uint32Array(1);
  let tested = -1,
    stored = -1;
  for (const op of p.instructions) {
    if (op === undefined) throw "coalesce instruction invariant";
    state[0] = (state[0] ?? 0) + 1;
    if (op.kind === "optional-present" && op.id === condition)
      tested = op.value;
    if (op.kind === "store" && op.slot === reload.slot) stored = op.value;
    visitInstructionOperands(op, (id) => {
      if (id === condition) uses[0] = (uses[0] ?? 0) + 1;
    });
  }
  if ((state[0] ?? 0) > (state[3] ?? 0)) return undefined;
  if (tested < 0 || stored !== tested) return undefined;
  const fallback = (state[2] ?? 0) + 1,
    result = fallback + 1;
  state[2] = result;
  const instructions: Instruction[] = [];
  for (const op of p.instructions) {
    if (op === undefined) throw "coalesce instruction invariant";
    // The presence test goes when the branch was its only use.
    if (
      (uses[0] ?? 0) === 0 &&
      op.kind === "optional-present" &&
      op.id === condition
    )
      continue;
    instructions.push(op);
  }
  instructions.push(
    { ...constant, id: fallback },
    {
      kind: "optional-value-or",
      id: result,
      value: tested,
      fallback,
      start: unwrap.start,
      end: unwrap.end,
    },
    { ...presentStore, value: result },
  );
  state[1] = (state[1] ?? 0) + 1;
  entries[present.id] = 0;
  entries[absent.id] = 0;
  entries[joinId] = 1;
  if (joinId !== entry && sameHandler(p, join)) {
    // J has no other entry: append it to P.
    for (const op of join.instructions) {
      if (op === undefined) throw "coalesce instruction invariant";
      instructions.push(op);
    }
    entries[joinId] = 0;
    return { ...p, instructions, terminator: join.terminator };
  }
  return {
    ...p,
    instructions,
    terminator: { kind: "jump", target: joinId, start: t.start, end: t.end },
  };
}

/** Fuse lowered numeric `x ?? constant` diamonds into one branch-free
 * `optional-value-or`, and merge every jump into a block that has no other
 * entry (and the same exception handler) into its predecessor, so
 * straight-line code, including each fused join, is a single block.
 *
 * The recognized shape is exactly what lowering emits: block P stores the
 * optional to slot S (its last store to S) and branches on
 * `optional-present` of it; the present arm (only entry: P) is `load S;
 * optional-value; store M` and the absent arm (only entry: P) is `constant
 * k; store M`, both jumping to a join J whose only entries are those arms.
 * P then computes `optional-value-or(x, k)`, stores it to M and jumps to J,
 * so every path stores the same value to M as before and the arms become
 * unreachable. J is appended to P when it has no other entry and the same
 * exception handler, which keeps chains of coalesces in one block. Slot S
 * keeps its store; no other instruction moves or disappears from a
 * reachable path except the presence test, when only the branch used it. */
export function coalesceOptionalDefaults(
  fn: FunctionIR,
  budget: number,
): CoalesceOptimization | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0) return undefined;
  let visited = 0,
    rewritten = 0,
    maximum = -1,
    candidates = false;
  // The prefilter is free: functions with neither a jump to merge nor a
  // presence test keep their IR and charge nothing to the shared budget.
  for (const block of fn.blocks) {
    if (block === undefined) throw "coalesce block invariant";
    if (block.terminator.kind === "jump") {
      candidates = true;
      break;
    }
    for (const op of block.instructions) {
      if (op === undefined) throw "coalesce instruction invariant";
      if (op.kind === "optional-present") {
        candidates = true;
        break;
      }
    }
    if (candidates) break;
  }
  if (!candidates) return { fn, visited, rewritten };
  for (const block of fn.blocks) {
    if (block === undefined) throw "coalesce block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "coalesce instruction invariant";
      if (++visited > budget) return undefined;
      const id = instructionResult(op);
      if (id !== undefined && id > maximum) maximum = id;
    }
  }
  // Entries per block: normal edges, exceptional edges and function entry.
  const entries = new Uint32Array(fn.blocks.length);
  entries[fn.entry] = 2;
  for (const block of fn.blocks) {
    if (block === undefined) throw "coalesce block invariant";
    if (++visited > budget) return undefined;
    const t = block.terminator;
    if (t.kind === "jump") entries[t.target] = (entries[t.target] ?? 0) + 1;
    else if (
      t.kind === "branch" ||
      t.kind === "record" ||
      t.kind === "record-cell" ||
      t.kind === "cell"
    ) {
      entries[t.consequent] = (entries[t.consequent] ?? 0) + 1;
      entries[t.alternate] = (entries[t.alternate] ?? 0) + 1;
    }
    if (block.exception !== undefined) entries[block.exception.target] = 2;
  }
  const blocks: Block[] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "coalesce block invariant";
    blocks.push(block);
  }
  const state = new Float64Array(4);
  state[0] = visited;
  state[2] = maximum;
  state[3] = budget;
  for (let id = 0; id < blocks.length; id++) {
    if (entries[id] === 0) continue;
    // A merged join may end in the next coalesce of a chain.
    while (true) {
      const current = blocks[id];
      if (current === undefined) throw "coalesce block invariant";
      state[0] = (state[0] ?? 0) + 1;
      if ((state[0] ?? 0) > budget) return undefined;
      const next = rewriteCoalesce(current, blocks, entries, fn.entry, state);
      if ((state[0] ?? 0) > budget) return undefined;
      if (next !== undefined) {
        blocks[id] = next;
        continue;
      }
      // A plain jump to a block with no other entry and the same handler:
      // append it, so straight-line code is one block.
      const t = current.terminator;
      if (t.kind !== "jump" || t.target === id || t.target === fn.entry) break;
      const successor = blocks[t.target];
      if (successor === undefined) throw "coalesce successor invariant";
      if (entries[t.target] !== 1 || !sameHandler(current, successor)) break;
      const instructions: Instruction[] = current.instructions.slice();
      for (const op of successor.instructions) {
        if (op === undefined) throw "coalesce instruction invariant";
        state[0] = (state[0] ?? 0) + 1;
        instructions.push(op);
      }
      entries[t.target] = 0;
      state[1] = (state[1] ?? 0) + 1;
      blocks[id] = {
        ...current,
        instructions,
        terminator: successor.terminator,
      };
    }
  }
  visited = state[0] ?? 0;
  rewritten = state[1] ?? 0;
  if (rewritten === 0) return { fn, visited, rewritten };
  const compacted = compactReachableBlocks(fn, blocks, budget - visited);
  if (compacted === undefined) return undefined;
  return { fn: compacted.fn, visited: visited + compacted.visited, rewritten };
}
