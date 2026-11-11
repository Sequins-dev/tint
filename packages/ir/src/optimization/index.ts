import { simplifyControlFlow } from "./control-flow.ts";
import { coalesceOptionalDefaults } from "./coalesce.ts";
import { compactSlots } from "./slots.ts";
export { compactSlots } from "./slots.ts";
export { simplifyControlFlow } from "./control-flow.ts";
import { lowerProvenRecordReads } from "./record-access.ts";
export { lowerProvenRecordReads } from "./record-access.ts";
import { foldSSAConstants } from "./ssa.ts";
export { foldSSAConstants } from "./ssa.ts";
import { unary, binary, type Constant } from "./constants.ts";
import { forwardLocalLoads } from "./forward-loads.ts";
export { forwardLocalLoads, type ForwardedLoads } from "./forward-loads.ts";
export { traceModuleReferences } from "./reachability.ts";
export {
  lowerReferenceLists,
  referenceListWorkBudget,
  type ReferenceListRuntime,
  type ReferenceListAlias,
  type ReferenceListRewrite,
} from "./reference-lists.ts";
export { pruneClosedModule, type ClosedPruning } from "./reachable.ts";
import {
  instructionMayThrow,
  summarizeEffects,
  instructionResult,
  visitInstructionOperands,
  visitTerminatorOperands,
  type ModuleIR,
  type FunctionIR,
  type Block,
  type Instruction,
} from "../scalar/index.ts";
import { scalarReplaceRecords } from "./records.ts";
import { inlineSmallFunctions } from "./inline.ts";

export interface PassStatistics {
  /** Functions retained unchanged by a phase-local analysis limit. */
  readonly skipped?: number;
  readonly phase: "scalar";
  readonly pass:
    | "simplify-control-flow"
    | "compact-slots"
    | "lower-proven-record-reads"
    | "ssa-constants"
    | "fold-constants"
    | "coalesce-defaults"
    | "function-local-cleanup"
    | "forward-local-loads"
    | "remove-unread-stores"
    | "remove-dead-scalars"
    | "scalar-replace-records"
    | "inline-small-functions"
    | "remove-unreachable"
    | "dense-reference-lists";
  readonly visited: number;
  readonly rewritten: number;
}
export interface Optimization {
  readonly module: ModuleIR;
  readonly passes: readonly PassStatistics[];
  readonly budgetExhausted: boolean;
}
function foldFunctionConstants(
  fn: FunctionIR,
  budget: number,
): { fn: FunctionIR; visited: number; rewritten: number } | undefined {
  let visited = 0,
    rewritten = 0;
  const blocks: Block[] = [];
  let functionChanged = false;
  for (const block of fn.blocks) {
    if (block === undefined) throw "optimizer block invariant";
    const values: (Constant | undefined)[] = [],
      instructions: Instruction[] = [];
    let slots: (Constant | undefined)[] = [],
      changed = false;
    for (const op of block.instructions) {
      if (op === undefined) throw "optimizer instruction invariant";
      if (visited >= budget) return undefined;
      visited++;
      let folded: Constant | undefined;
      if (op.kind === "constant") values[op.id] = op.value;
      else if (op.kind === "store") slots[op.slot] = values[op.value];
      else if (op.kind === "load") folded = slots[op.slot];
      else if (op.kind === "unary") {
        const value = values[op.operand];
        if (value !== undefined) folded = unary(op.operator, value);
      } else if (op.kind === "binary") {
        const left = values[op.left],
          right = values[op.right];
        if (left !== undefined && right !== undefined)
          folded = binary(op.operator, left, right);
      }
      if (
        folded !== undefined &&
        (op.kind === "load" || op.kind === "unary" || op.kind === "binary")
      ) {
        values[op.id] = folded;
        instructions.push({
          kind: "constant",
          id: op.id,
          value: folded,
          start: op.start,
          end: op.end,
        });
        changed = true;
        rewritten++;
      } else instructions.push(op);
      // Until effect/alias contracts are explicit, calls and allocation/throw
      // boundaries conservatively forget local-slot facts. SSA constants survive.
      if (op.kind === "host-call" || instructionMayThrow(op)) slots = [];
    }
    blocks.push(changed ? { ...block, instructions } : block);
    if (changed) functionChanged = true;
  }
  return { fn: functionChanged ? { ...fn, blocks } : fn, visited, rewritten };
}
export interface OptimizationOptions {
  /** Experimental wider candidates (two rounds). Full self-build profiling
   * currently favors the smaller default candidates (up to three rounds). */
  readonly inlining?: "small" | "guarded";
}
/** Large graphs otherwise spend the entire budget on a module-wide phase whose
 * unfinished output is discarded. Prioritize independent scalar cleanup and
 * retain each completed function/pass checkpoint, without increasing the bound.
 * The per-function allowance leaves work for later functions after a large one. */
interface LocalCleanup {
  readonly module: ModuleIR;
  readonly visited: number;
  readonly rewritten: number;
  readonly skipped: number;
  readonly pending: Uint8Array;
}
function cleanupFunctionsPass(
  module: ModuleIR,
  budget: number,
  effects: Uint32Array | undefined,
  selected?: Uint8Array,
): LocalCleanup {
  const functions: FunctionIR[] = [],
    pending = new Uint8Array(module.functions.length);
  let visited = 0,
    rewritten = 0,
    skipped = 0,
    changed = false;
  for (const fn of module.functions) {
    if (fn === undefined) throw "optimizer cleanup function invariant";
    if (
      fn.import === true ||
      (selected !== undefined && selected[fn.id] !== 1)
    ) {
      functions.push(fn);
      continue;
    }
    const allowance = Math.min(50000, budget - visited);
    let current = fn,
      spent = 0;
    for (let phase = 0; phase < 4; phase++) {
      const remaining = allowance - spent;
      let next: FunctionIR | undefined,
        work = 0,
        changes = 0;
      if (phase === 0) {
        const result = forwardLocalLoads(current, remaining, effects);
        if (result !== undefined) {
          next = result.fn;
          work = result.visited;
          changes = result.forwarded;
        }
      } else {
        const result =
          phase === 1
            ? removeUnreadStores(current, remaining)
            : phase === 2
              ? removeDeadScalars(current, remaining)
              : compactSlots(current, remaining);
        if (result !== undefined) {
          next = result.fn;
          work = result.visited;
          changes = result.removed;
        }
      }
      if (next === undefined) {
        spent = allowance;
        skipped++;
        pending[fn.id] = 1;
        break;
      }
      current = next;
      spent += work;
      rewritten += changes;
    }
    visited += spent;
    if (current !== fn) changed = true;
    functions.push(current);
  }
  return {
    module: changed ? { ...module, functions } : module,
    visited,
    rewritten,
    skipped,
    pending,
  };
}
function cleanupFunctions(
  module: ModuleIR,
  budget: number,
  directCalls: boolean,
): Optimization {
  // Reserve inlining work without increasing the total bound. Removing local
  // copies first exposes small helpers hidden by their unoptimized IR size.
  const reserve = directCalls ? Math.floor(budget / 4) : 0,
    effects = summarizeEffects(module, budget),
    first = cleanupFunctionsPass(module, budget - reserve, effects);
  const passes: PassStatistics[] = [
    {
      phase: "scalar",
      pass: "function-local-cleanup",
      visited: first.visited,
      rewritten: first.rewritten,
      skipped: first.skipped,
    },
  ];
  if (!directCalls)
    return { module: first.module, passes, budgetExhausted: first.skipped > 0 };
  const inlining =
      reserve === 0
        ? undefined
        : inlineSmallFunctions(first.module, reserve, false, true),
    inlineVisited = inlining?.visited ?? reserve,
    inlined = inlining?.module ?? first.module;
  passes.push({
    phase: "scalar",
    pass: "inline-small-functions",
    visited: inlineVisited,
    rewritten: inlining?.inlined ?? 0,
  });
  const selected = first.pending.slice();
  for (let id = 0; id < inlined.functions.length; id++)
    if (inlined.functions[id] !== first.module.functions[id]) selected[id] = 1;
  // These transforms only remove effects or inline the existing nonallocating
  // leaf bodies. The original effect summary remains a conservative upper bound.
  // Return unused reserve to incomplete functions and new inline expansions.
  const last = cleanupFunctionsPass(
    inlined,
    budget - first.visited - inlineVisited,
    effects,
    selected,
  );
  passes.push({
    phase: "scalar",
    pass: "function-local-cleanup",
    visited: last.visited,
    rewritten: last.rewritten,
    skipped: last.skipped,
  });
  return {
    module: last.module,
    passes,
    budgetExhausted: last.skipped > 0 || inlining?.budgetExhausted === true,
  };
}
/** Consume verified scalar IR; the publisher must verify transformed IR before
 * emission. Budget exhaustion discards the unfinished phase while retaining
 * completed phases. No input is mutated. */
export function optimizeModule(
  module: ModuleIR,
  maxInstructions: number = 20000000,
  options: OptimizationOptions = {},
): Optimization {
  if (!Number.isSafeInteger(maxInstructions) || maxInstructions < 0)
    throw "INVALID_OPTIMIZATION_BUDGET";
  let instructions = 0,
    blocks = 0,
    slots = 0,
    directCalls = false;
  for (const fn of module.functions) {
    if (fn === undefined) throw "optimizer function invariant";
    slots += fn.slots.length;
    blocks += fn.blocks.length;
    for (const block of fn.blocks) {
      if (block === undefined) throw "optimizer block invariant";
      instructions += block.instructions.length;
      if (!directCalls)
        for (const op of block.instructions) {
          if (op === undefined) throw "optimizer instruction invariant";
          if (op.kind === "call") {
            directCalls = true;
            break;
          }
        }
    }
  }
  // Preserve the initial all-or-nothing contract when even one scan cannot fit.
  // Otherwise reserve the budget for useful local work when the multi-phase
  // pipeline's estimated footprint already exceeds it.
  if (
    module.functions.length > 1 &&
    instructions <= maxInstructions &&
    instructions * 5 + slots * 2 + blocks > maxInstructions
  )
    return cleanupFunctions(module, maxInstructions, directCalls);
  let visited = 0,
    rewritten = 0;
  const functions: FunctionIR[] = [];
  for (const fn of module.functions) {
    if (fn === undefined) throw "optimizer function invariant";
    const result = foldFunctionConstants(fn, maxInstructions - visited);
    if (result === undefined)
      return {
        module,
        budgetExhausted: true,
        passes: [
          {
            phase: "scalar",
            pass: "fold-constants",
            visited: maxInstructions,
            rewritten: 0,
          },
        ],
      };
    functions.push(result.fn);
    visited += result.visited;
    rewritten += result.rewritten;
  }
  let constantsFolded = rewritten === 0 ? module : { ...module, functions };
  const passes: PassStatistics[] = [
    { phase: "scalar", pass: "fold-constants", visited, rewritten },
  ];
  function exhausted(checkpoint: ModuleIR, pass: PassStatistics): Optimization {
    passes.push(pass);
    return { module: checkpoint, budgetExhausted: true, passes };
  }
  const ssaFunctions: FunctionIR[] = [];
  let ssaVisited = 0,
    ssaSkipped = 0,
    ssaRewritten = 0;
  for (const fn of constantsFolded.functions) {
    if (fn === undefined) throw "optimizer SSA function invariant";
    // SSA is an optional expensive phase. Bound it independently so a large
    // candidate cannot consume the budgets of established scalar/inline passes.
    const remaining = maxInstructions - visited - ssaVisited;
    if (remaining < 1)
      return exhausted(constantsFolded, {
        phase: "scalar",
        pass: "ssa-constants",
        visited: maxInstructions - visited,
        rewritten: 0,
      });
    if (ssaVisited >= 1000000) {
      ssaSkipped++;
      ssaFunctions.push(fn);
      ssaVisited++;
      continue;
    }
    const allowance = Math.min(100000, 1000000 - ssaVisited);
    const result = foldSSAConstants(fn, Math.min(remaining, allowance));
    if (result === undefined) {
      if (remaining < allowance)
        return exhausted(constantsFolded, {
          phase: "scalar",
          pass: "ssa-constants",
          visited: maxInstructions - visited,
          rewritten: 0,
        });
      ssaVisited += allowance;
      ssaSkipped++;
      ssaFunctions.push(fn);
      continue;
    }
    ssaFunctions.push(result.fn);
    ssaVisited += result.visited;
    ssaRewritten += result.rewritten;
  }
  if (ssaRewritten > 0)
    constantsFolded = { ...constantsFolded, functions: ssaFunctions };
  passes.push({
    phase: "scalar",
    pass: "ssa-constants",
    visited: ssaVisited,
    rewritten: ssaRewritten,
    skipped: ssaSkipped,
  });
  visited += ssaVisited;
  const callEffects = summarizeEffects(
    constantsFolded,
    maxInstructions - visited,
  );
  const forwardedFunctions: FunctionIR[] = [];
  let forwardVisited = 0,
    forwarded = 0;
  for (const fn of constantsFolded.functions) {
    if (fn === undefined) throw "optimizer function invariant";
    const result = forwardLocalLoads(
      fn,
      maxInstructions - visited - forwardVisited,
      callEffects,
    );
    if (result === undefined)
      return exhausted(constantsFolded, {
        phase: "scalar",
        pass: "forward-local-loads",
        visited: maxInstructions - visited,
        rewritten: 0,
      });
    forwardedFunctions.push(result.fn);
    forwardVisited += result.visited;
    forwarded += result.forwarded;
  }
  const folded =
    forwarded === 0
      ? constantsFolded
      : { ...constantsFolded, functions: forwardedFunctions };
  passes.push({
    phase: "scalar",
    pass: "forward-local-loads",
    visited: forwardVisited,
    rewritten: forwarded,
  });
  visited += forwardVisited;
  const storedFunctions: FunctionIR[] = [];
  let storeVisited = 0,
    storesRemoved = 0;
  for (const fn of folded.functions) {
    if (fn === undefined) throw "optimizer function invariant";
    const result = removeUnreadStores(
      fn,
      maxInstructions - visited - storeVisited,
    );
    if (result === undefined)
      return exhausted(folded, {
        phase: "scalar",
        pass: "remove-unread-stores",
        visited: maxInstructions - visited,
        rewritten: 0,
      });
    storedFunctions.push(result.fn);
    storeVisited += result.visited;
    storesRemoved += result.removed;
  }
  const stored =
    storesRemoved === 0 ? folded : { ...folded, functions: storedFunctions };
  passes.push({
    phase: "scalar",
    pass: "remove-unread-stores",
    visited: storeVisited,
    rewritten: storesRemoved,
  });
  const cleaned: FunctionIR[] = [];
  let removed = 0,
    deadVisited = 0;
  for (const fn of stored.functions) {
    if (fn === undefined) throw "optimizer function invariant";
    const result = removeDeadScalars(
      fn,
      maxInstructions - visited - storeVisited - deadVisited,
    );
    if (result === undefined)
      return exhausted(stored, {
        phase: "scalar",
        pass: "remove-dead-scalars",
        visited: maxInstructions - visited - storeVisited,
        rewritten: 0,
      });
    cleaned.push(result.fn);
    removed += result.removed;
    deadVisited += result.visited;
  }
  const deadFree = removed === 0 ? stored : { ...stored, functions: cleaned };
  passes.push({
    phase: "scalar",
    pass: "remove-dead-scalars",
    visited: deadVisited,
    rewritten: removed,
  });
  // Local forwarding and store removal leave each lowered `x ?? constant`
  // in its canonical diamond; fuse it so later passes see merged blocks.
  const coalescedFunctions: FunctionIR[] = [],
    deadOnly = deadVisited;
  let coalesced = 0;
  for (const fn of deadFree.functions) {
    if (fn === undefined) throw "optimizer function invariant";
    const result = coalesceOptionalDefaults(
      fn,
      maxInstructions - visited - storeVisited - deadVisited,
    );
    if (result === undefined)
      return exhausted(deadFree, {
        phase: "scalar",
        pass: "coalesce-defaults",
        visited: maxInstructions - visited - storeVisited - deadVisited,
        rewritten: 0,
      });
    coalescedFunctions.push(result.fn);
    coalesced += result.rewritten;
    deadVisited += result.visited;
  }
  const scalarModule =
    coalesced === 0 ? deadFree : { ...deadFree, functions: coalescedFunctions };
  // Later budgets subtract deadVisited, which now includes this pass.
  passes.push({
    phase: "scalar",
    pass: "coalesce-defaults",
    visited: deadVisited - deadOnly,
    rewritten: coalesced,
  });
  const recordFunctions: FunctionIR[] = [];
  let recordVisited = 0,
    recordsReplaced = 0;
  for (const fn of scalarModule.functions) {
    if (fn === undefined) throw "optimizer function invariant";
    const result = scalarReplaceRecords(
      fn,
      scalarModule,
      maxInstructions - visited - storeVisited - deadVisited - recordVisited,
    );
    if (result === undefined)
      return exhausted(scalarModule, {
        phase: "scalar",
        pass: "scalar-replace-records",
        visited: maxInstructions - visited - storeVisited - deadVisited,
        rewritten: 0,
      });
    recordFunctions.push(result.fn);
    recordVisited += result.visited;
    recordsReplaced += result.replaced;
  }
  const replaced =
    recordsReplaced === 0
      ? scalarModule
      : { ...scalarModule, functions: recordFunctions };
  passes.push({
    phase: "scalar",
    pass: "scalar-replace-records",
    visited: recordVisited,
    rewritten: recordsReplaced,
  });
  let inlinedModule = replaced,
    inlineVisited = 0;
  const guardedInlining = options.inlining === "guarded";
  // Inlining considers leaf callees only, so a wrapper becomes eligible once
  // its own callees were inlined: repeat while rounds make progress.
  for (let round = 0; round < (guardedInlining ? 2 : 3); round++) {
    const remaining =
      maxInstructions -
      visited -
      storeVisited -
      deadVisited -
      recordVisited -
      inlineVisited;
    const inlineResult = inlineSmallFunctions(
      inlinedModule,
      remaining,
      guardedInlining,
    );
    if (inlineResult === undefined)
      return exhausted(inlinedModule, {
        phase: "scalar",
        pass: "inline-small-functions",
        visited: remaining,
        rewritten: 0,
      });
    passes.push({
      phase: "scalar",
      pass: "inline-small-functions",
      visited: inlineResult.visited,
      rewritten: inlineResult.inlined,
    });
    inlinedModule = inlineResult.module;
    inlineVisited += inlineResult.visited;
    if (inlineResult.inlined === 0) break;
  }
  if (inlinedModule !== replaced) {
    let spent =
      visited + storeVisited + deadVisited + recordVisited + inlineVisited;
    for (let phase = 0; phase < 4; phase++) {
      const pass: PassStatistics["pass"] =
        phase === 0
          ? "fold-constants"
          : phase === 1
            ? "forward-local-loads"
            : phase === 2
              ? "remove-unread-stores"
              : "remove-dead-scalars";
      const cleanedFunctions: FunctionIR[] = [];
      let cleanupVisited = 0,
        cleanupRewritten = 0;
      for (const fn of inlinedModule.functions) {
        if (fn === undefined) throw "optimizer function invariant";
        if (fn === replaced.functions[fn.id]) {
          cleanedFunctions.push(fn);
          continue;
        }
        const budget = maxInstructions - spent - cleanupVisited;
        let next: FunctionIR | undefined;
        if (phase === 0) {
          const result = foldFunctionConstants(fn, budget);
          if (result !== undefined) {
            next = result.fn;
            cleanupVisited += result.visited;
            cleanupRewritten += result.rewritten;
          }
        } else if (phase === 1) {
          const result = forwardLocalLoads(fn, budget);
          if (result !== undefined) {
            next = result.fn;
            cleanupVisited += result.visited;
            cleanupRewritten += result.forwarded;
          }
        } else {
          const result =
            phase === 2
              ? removeUnreadStores(fn, budget)
              : removeDeadScalars(fn, budget);
          if (result !== undefined) {
            next = result.fn;
            cleanupVisited += result.visited;
            cleanupRewritten += result.removed;
          }
        }
        if (next === undefined)
          return exhausted(inlinedModule, {
            phase: "scalar",
            pass,
            visited: maxInstructions - spent,
            rewritten: 0,
          });
        cleanedFunctions.push(next);
      }
      if (cleanupRewritten > 0)
        inlinedModule = { ...inlinedModule, functions: cleanedFunctions };
      passes.push({
        phase: "scalar",
        pass,
        visited: cleanupVisited,
        rewritten: cleanupRewritten,
      });
      spent += cleanupVisited;
    }
  }
  let used = 0;
  for (const pass of passes) {
    if (pass === undefined) throw "optimizer pass invariant";
    used += pass.visited;
  }
  const accesses = lowerProvenRecordReads(
    inlinedModule,
    maxInstructions - used,
  );
  if (accesses === undefined)
    return exhausted(inlinedModule, {
      phase: "scalar",
      pass: "lower-proven-record-reads",
      visited: maxInstructions - used,
      rewritten: 0,
    });
  passes.push({
    phase: "scalar",
    pass: "lower-proven-record-reads",
    visited: accesses.visited,
    rewritten: accesses.rewritten,
  });
  const controlFunctions: FunctionIR[] = [];
  let controlVisited = 0,
    controlRewritten = 0;
  for (const fn of accesses.module.functions) {
    if (fn === undefined) throw "optimizer control-flow function invariant";
    const result = simplifyControlFlow(
      fn,
      maxInstructions - used - accesses.visited - controlVisited,
    );
    if (result === undefined)
      return exhausted(accesses.module, {
        phase: "scalar",
        pass: "simplify-control-flow",
        visited: maxInstructions - used - accesses.visited,
        rewritten: 0,
      });
    controlFunctions.push(result.fn);
    controlVisited += result.visited;
    controlRewritten += result.rewritten;
  }
  passes.push({
    phase: "scalar",
    pass: "simplify-control-flow",
    visited: controlVisited,
    rewritten: controlRewritten,
  });
  const controlled =
    controlRewritten === 0
      ? accesses.module
      : { ...accesses.module, functions: controlFunctions };
  const compactedFunctions: FunctionIR[] = [];
  let compactVisited = 0,
    compactRemoved = 0;
  for (const fn of controlled.functions) {
    if (fn === undefined) throw "optimizer slot function invariant";
    const result = compactSlots(
      fn,
      maxInstructions -
        used -
        accesses.visited -
        controlVisited -
        compactVisited,
    );
    if (result === undefined)
      return exhausted(controlled, {
        phase: "scalar",
        pass: "compact-slots",
        visited: maxInstructions - used - accesses.visited - controlVisited,
        rewritten: 0,
      });
    compactedFunctions.push(result.fn);
    compactVisited += result.visited;
    compactRemoved += result.removed;
  }
  passes.push({
    phase: "scalar",
    pass: "compact-slots",
    visited: compactVisited,
    rewritten: compactRemoved,
  });
  return {
    module:
      compactRemoved === 0
        ? controlled
        : { ...controlled, functions: compactedFunctions },
    budgetExhausted: false,
    passes,
  };
}

/** Only scalar operations with no observable effects are removable. In
 * particular, unused calls, allocations, memory accesses and throws survive. */
function removable(op: Instruction): boolean {
  return (
    op.kind === "constant" ||
    op.kind === "string-literal" ||
    op.kind === "general-none" ||
    op.kind === "general-null" ||
    op.kind === "general-wrap" ||
    op.kind === "load" ||
    op.kind === "unary" ||
    op.kind === "binary"
  );
}
function removeDeadScalars(
  fn: FunctionIR,
  budget: number,
): { fn: FunctionIR; removed: number; visited: number } | undefined {
  const uses: number[] = [],
    candidates: Instruction[] = [],
    pending: number[] = [],
    candidateIds: number[] = [],
    dead: number[] = [];
  let visited = 0,
    removed = 0;
  function use(id: number): void {
    uses[id] = (uses[id] ?? 0) + 1;
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "optimizer block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "optimizer instruction invariant";
      if (visited >= budget) return undefined;
      visited++;
      const id = instructionResult(op);
      if (id !== undefined && removable(op)) {
        candidates[id] = op;
        candidateIds.push(id);
      }
      visitInstructionOperands(op, use);
    }
    visitTerminatorOperands(block.terminator, use);
  }
  for (const id of candidateIds) {
    if (id === undefined) throw "optimizer candidate invariant";
    if ((uses[id] ?? 0) === 0) pending.push(id);
  }
  function release(id: number): void {
    const count = uses[id];
    if (count === undefined || count <= 0) throw "optimizer use invariant";
    uses[id] = count - 1;
    if (count === 1 && candidates[id] !== undefined) pending.push(id);
  }
  while (pending.length > 0) {
    if (visited >= budget) return undefined;
    visited++;
    const id = pending.pop();
    if (id === undefined) throw "optimizer queue invariant";
    const op = candidates[id];
    if (op === undefined || dead[id]) throw "optimizer candidate invariant";
    dead[id] = 1;
    removed++;
    visitInstructionOperands(op, release);
  }
  if (removed === 0) return { fn, removed, visited };
  const blocks: Block[] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "optimizer block invariant";
    const instructions: Instruction[] = [];
    for (const op of block.instructions) {
      if (op === undefined) throw "optimizer instruction invariant";
      const id = instructionResult(op);
      if (id === undefined || !dead[id]) instructions.push(op);
    }
    blocks.push(
      instructions.length === block.instructions.length
        ? block
        : { ...block, instructions },
    );
  }
  return { fn: { ...fn, blocks }, removed, visited };
}

/** Slots have no address-taking operation. Conservatively treat every cell/record
 * terminator's slot as read, including read-result slots. */
function removeUnreadStores(
  fn: FunctionIR,
  budget: number,
): { fn: FunctionIR; removed: number; visited: number } | undefined {
  const read: number[] = [];
  let visited = 0,
    removed = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "optimizer block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "optimizer instruction invariant";
      if (visited >= budget) return undefined;
      visited++;
      if (op.kind === "load") read[op.slot] = 1;
    }
    const term = block.terminator;
    if (
      term.kind === "cell" ||
      term.kind === "record" ||
      term.kind === "record-cell"
    )
      read[term.slot] = 1;
  }
  const blocks: Block[] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "optimizer block invariant";
    const instructions: Instruction[] = [];
    for (const op of block.instructions) {
      if (op === undefined) throw "optimizer instruction invariant";
      if (visited >= budget) return undefined;
      visited++;
      if (op.kind === "store" && read[op.slot] !== 1) removed++;
      else instructions.push(op);
    }
    blocks.push(
      instructions.length === block.instructions.length
        ? block
        : { ...block, instructions },
    );
  }
  return { fn: removed === 0 ? fn : { ...fn, blocks }, removed, visited };
}
