import { bulkListCopies } from "./bulk-list-copies.ts";
import { unbounded } from "./budget.ts";
import { hasScriptOperations, simplifyControlFlow } from "./control-flow.ts";
import { promoteLoopCells } from "./cell-promotion.ts";
import { splitOptionalNumbers } from "./optional-split.ts";
import { shadowGeneralNumbers } from "./general-numbers.ts";
import { threadBranches } from "./branch-threading.ts";
import { coalesceOptionalDefaults } from "./coalesce.ts";
import { compactSlots } from "./slots.ts";
export { compactSlots } from "./slots.ts";
export { unboundedWork } from "./budget.ts";
export { simplifyControlFlow } from "./control-flow.ts";
import { lowerProvenRecordReads } from "./record-access.ts";
export { lowerProvenRecordReads } from "./record-access.ts";
import { sinkEnvironmentLoads } from "./sink-environment-loads.ts";
export { sinkEnvironmentLoads } from "./sink-environment-loads.ts";
import { reuseUnionReads } from "./union-reads.ts";
export { reuseUnionReads } from "./union-reads.ts";
import { proveCellStates } from "./cell-states.ts";
export { proveCellStates } from "./cell-states.ts";
import { foldSSAConstants } from "./ssa.ts";
export { foldSSAConstants } from "./ssa.ts";
import { unary, binary, type Constant } from "./constants.ts";
import { forwardLocalLoads } from "./forward-loads.ts";
import { propagateSlotCopies } from "./slot-copies.ts";
import { cacheListVectors } from "./list-vectors.ts";
export { cacheListVectors } from "./list-vectors.ts";
import { cacheElementStorage } from "./element-cache.ts";
export { cacheElementStorage } from "./element-cache.ts";
export { propagateSlotCopies } from "./slot-copies.ts";
export { forwardLocalLoads, type ForwardedLoads } from "./forward-loads.ts";
export { traceModuleReferences } from "./reachability.ts";
export {
  lowerReferenceLists,
  referenceListWorkBudget,
  type ReferenceListRuntime,
  type ReferenceListAlias,
  type ReferenceListRewrite,
} from "./reference-lists.ts";
export {
  pruneModuleReferences,
  pruneClosedModule,
  type ClosedPruning,
} from "./reachable.ts";
import {
  instructionMayThrow,
  stableDescriptors,
  summarizeEffects,
  instructionResult,
  visitInstructionOperands,
  visitTerminatorOperands,
  slotVariables,
  removedStoreBinding,
  retainDebugValues,
  type ModuleIR,
  type FunctionIR,
  type Block,
  type Instruction,
  type ValueBinding,
} from "../scalar/index.ts";
import { scalarReplaceRecords } from "./records.ts";
import { dispatchStringChains } from "./string-dispatch.ts";
import { inlineSmallFunctions } from "./inline.ts";
import { devirtualizeClosureCalls } from "./closures.ts";
import { selectArrayAccesses } from "./bounds.ts";
import { hoistLoopInvariants } from "./licm.ts";
import { boundCountedLoops, versionNonzeroDivisors } from "./counted-loops.ts";
import { layoutBlocks } from "./block-layout.ts";
export { hoistLoopInvariants } from "./licm.ts";
export { versionNonzeroDivisors } from "./counted-loops.ts";
export { selectArrayAccesses } from "./bounds.ts";
export { devirtualizeClosureCalls } from "./closures.ts";

import type {
  OptimizationObserver,
  OptimizationRemark,
  PassStatistics,
  RemarkSink,
} from "./observer.ts";
export {
  formatPassJSON,
  formatPassTable,
  type OptimizationObserver,
  type OptimizationRemark,
  type PassEvent,
  type PassReport,
  type PassStatistics,
  type RemarkSink,
} from "./observer.ts";
export interface Optimization {
  readonly module: ModuleIR;
  readonly passes: readonly PassStatistics[];
  readonly budgetExhausted: boolean;
}
/** Why an optimization run did not finish within its budget (the pass that
 * ran out, and the work it was given), or undefined when it finished.
 * Live compilation must report this rather than run partially optimized code. */
export function optimizationExhaustion(
  optimization: Optimization,
): string | undefined {
  if (!optimization.budgetExhausted) return undefined;
  // The pass that ran out is the last one recorded.
  const pass = optimization.passes[optimization.passes.length - 1];
  return pass === undefined
    ? "optimization budget exhausted"
    : "optimization budget exhausted in " +
        pass.pass +
        " after " +
        String(pass.visited) +
        " units of work";
}
function foldFunctionConstants(
  fn: FunctionIR,
  budget: number,
): { fn: FunctionIR; visited: number; rewritten: number } | undefined {
  let visited = 0,
    rewritten = 0,
    // Fresh value IDs for rewrites that add instructions.
    fresh = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "optimizer block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "optimizer instruction invariant";
      const id = instructionResult(op);
      if (id !== undefined && id >= fresh) fresh = id + 1;
    }
  }
  const blocks: Block[] = [];
  let functionChanged = false;
  for (const block of fn.blocks) {
    if (block === undefined) throw "optimizer block invariant";
    const values: (Constant | undefined)[] = [],
      wraps: (number | undefined)[] = [],
      absent: (number | undefined)[] = [],
      texts: (string | undefined)[] = [],
      instructions: Instruction[] = [];
    let slots: (Constant | undefined)[] = [],
      slotTexts: (string | undefined)[] = [],
      changed = false;
    for (const op of block.instructions) {
      if (op === undefined) throw "optimizer instruction invariant";
      if (visited >= budget) return undefined;
      visited++;
      // String constants: literals, their concatenations (bounded, as they
      // become image data), lengths and equality.
      const text = foldedText(op, texts, slotTexts);
      if (text !== undefined) {
        texts[text.id] = text.value;
        if (op.kind !== "string-literal") {
          instructions.push({
            kind: "string-literal",
            id: text.id,
            value: text.value,
            start: op.start,
            end: op.end,
          });
          changed = true;
          rewritten++;
          continue;
        }
      }
      if (op.kind === "store") slotTexts[op.slot] = texts[op.value];
      const textual = foldedTextScalar(op, texts);
      if (textual !== undefined) {
        values[textual.id] = textual.value;
        instructions.push({
          kind: "constant",
          id: textual.id,
          value: textual.value,
          start: op.start,
          end: op.end,
        });
        changed = true;
        rewritten++;
        continue;
      }
      // Equality of two present optionals is equality of their payloads; a
      // present optional never equals an absent one.
      if (op.kind === "optional-wrap") wraps[op.id] = op.value;
      else if (op.kind === "undefined") absent[op.id] = 1;
      else if (
        op.kind === "binary" &&
        (op.operator === "===" || op.operator === "!==")
      ) {
        const left = wraps[op.left],
          right = wraps[op.right];
        if (left !== undefined && right !== undefined) {
          instructions.push({ ...op, left, right });
          changed = true;
          rewritten++;
          continue;
        }
        if (
          (left !== undefined && absent[op.right] === 1) ||
          (right !== undefined && absent[op.left] === 1)
        ) {
          const value = op.operator === "!==";
          values[op.id] = value;
          instructions.push({
            kind: "constant",
            id: op.id,
            value,
            start: op.start,
            end: op.end,
          });
          changed = true;
          rewritten++;
          continue;
        }
        // An optional against a present one: `o === wrap(v)` is
        // `(o ?? NaN) === v` (absent selects NaN, which equals nothing).
        if (
          (left !== undefined) !== (right !== undefined) &&
          absent[op.left] !== 1 &&
          absent[op.right] !== 1
        ) {
          const other = left === undefined ? op.left : op.right,
            payload = left === undefined ? right : left;
          if (payload === undefined) throw "optional equality invariant";
          const nan = fresh++,
            selected = fresh++;
          instructions.push({
            kind: "constant",
            id: nan,
            value: NaN,
            start: op.start,
            end: op.end,
          });
          instructions.push({
            kind: "optional-value-or",
            id: selected,
            value: other,
            fallback: nan,
            start: op.start,
            end: op.end,
          });
          instructions.push({ ...op, left: selected, right: payload });
          changed = true;
          rewritten++;
          continue;
        }
      }
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
      if (op.kind === "host-call" || instructionMayThrow(op)) {
        slots = [];
        slotTexts = [];
      }
    }
    blocks.push(changed ? { ...block, instructions } : block);
    if (changed) functionChanged = true;
  }
  return { fn: functionChanged ? { ...fn, blocks } : fn, visited, rewritten };
}
/** Longest string a fold may create (folded strings become image data). */
const maximumFoldedText = 1024;
/** A string literal `op` is or folds to: a literal, a load of a slot holding
 * a known literal, or a concatenation of two known literals. */
function foldedText(
  op: Instruction,
  texts: readonly (string | undefined)[],
  slotTexts: readonly (string | undefined)[],
): { readonly id: number; readonly value: string } | undefined {
  if (op.kind === "string-literal") return { id: op.id, value: op.value };
  if (op.kind === "load") {
    const value = slotTexts[op.slot];
    return value === undefined ? undefined : { id: op.id, value };
  }
  if (op.kind === "string-concat") {
    const left = texts[op.left],
      right = texts[op.right];
    if (
      left === undefined ||
      right === undefined ||
      left.length + right.length > maximumFoldedText
    )
      return undefined;
    return { id: op.id, value: left + right };
  }
  return undefined;
}
/** The number or boolean a string operation on known literals yields. */
function foldedTextScalar(
  op: Instruction,
  texts: readonly (string | undefined)[],
): { readonly id: number; readonly value: number | boolean } | undefined {
  if (op.kind === "string-length") {
    const value = texts[op.string];
    return value === undefined ? undefined : { id: op.id, value: value.length };
  }
  if (
    op.kind === "binary" &&
    (op.operator === "===" || op.operator === "!==")
  ) {
    const left = texts[op.left],
      right = texts[op.right];
    if (left === undefined || right === undefined) return undefined;
    return {
      id: op.id,
      value: op.operator === "===" ? left === right : left !== right,
    };
  }
  return undefined;
}
export interface OptimizationOptions {
  /** Experimental wider candidates (two rounds). Full self-build profiling
   * currently favors the smaller default candidates (up to three rounds). */
  readonly inlining?: "small" | "guarded" | "none";
  /** Rewrite indirect calls of closures known within their function into
   * direct calls (closed programs: no managed callback contracts observe
   * the call shapes or the function table). */
  readonly devirtualizeClosures?: boolean;
  /** No foreign code constructs or writes this module's records (no managed
   * surfaces or native services): closures read from record fields that
   * only ever hold one closure devirtualize too. */
  readonly closedRecords?: boolean;
  /** Explicit contract that the module is the whole program: no foreign,
   * service or later-compiled (live) code creates function values or calls
   * into it, so every indirect call reaches only this module's address-taken
   * functions of its signature (see indirectCallTargets). Interprocedural
   * summaries then union those targets' effects instead of assuming an
   * indirect call may do anything. AOT executables only; live compilation
   * must leave it unset. */
  readonly closedCalls?: boolean;
  /** Diagnostics: pass events and remarks. Observation never changes the
   * optimized module. */
  readonly observer?: OptimizationObserver;
  /** Diagnostics (miscompile bisection): stop after this many reported
   * passes, keeping the module the last one produced. */
  readonly passLimit?: number;
}
/** Reports a completed pass; true when the pass limit stops the pipeline. */
type PassRecorder = (
  statistics: PassStatistics,
  module: ModuleIR,
  budgetExhausted: boolean,
) => boolean;
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
    // Bounded budgets share themselves across functions; AOT cleans every
    // function completely.
    const allowance = unbounded(budget)
      ? budget - visited
      : Math.min(50000, budget - visited);
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
  passes: PassStatistics[],
  record: PassRecorder,
  remarks: RemarkSink | undefined,
): Optimization {
  // Reserve inlining work without increasing the total bound. Removing local
  // copies first exposes small helpers hidden by their unoptimized IR size.
  const reserve = directCalls ? Math.floor(budget / 4) : 0,
    effects = summarizeEffects(module, budget),
    first = cleanupFunctionsPass(module, budget - reserve, effects);
  if (
    record(
      {
        phase: "scalar",
        pass: "function-local-cleanup",
        visited: first.visited,
        rewritten: first.rewritten,
        skipped: first.skipped,
      },
      first.module,
      !directCalls && first.skipped > 0,
    ) ||
    !directCalls
  )
    return { module: first.module, passes, budgetExhausted: first.skipped > 0 };
  const inlining =
      reserve === 0
        ? undefined
        : inlineSmallFunctions(first.module, reserve, false, true, remarks),
    inlineVisited = inlining?.visited ?? reserve,
    inlined = inlining?.module ?? first.module;
  if (
    record(
      {
        phase: "scalar",
        pass: "inline-small-functions",
        visited: inlineVisited,
        rewritten: inlining?.inlined ?? 0,
      },
      inlined,
      false,
    )
  )
    return { module: inlined, passes, budgetExhausted: false };
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
  const budgetExhausted =
    last.skipped > 0 || inlining?.budgetExhausted === true;
  record(
    {
      phase: "scalar",
      pass: "function-local-cleanup",
      visited: last.visited,
      rewritten: last.rewritten,
      skipped: last.skipped,
    },
    last.module,
    budgetExhausted,
  );
  return { module: last.module, passes, budgetExhausted };
}
/** The current version of a module under optimization. Each completed pass
 * replaces `module`, so superseded versions become collectable as soon as no
 * caller retains them (unoptimized hosts keep a frame's dead locals alive
 * until it returns, so the pipeline keeps versions only here). */
export interface ModuleVersion {
  module: ModuleIR;
}
/** The passes of an in-place optimization (see optimizeModuleVersion). */
export interface OptimizationReport {
  readonly passes: readonly PassStatistics[];
  readonly budgetExhausted: boolean;
}
/** A function pass's result in the shape the module drivers accumulate. */
interface FunctionRewrite {
  readonly fn: FunctionIR;
  readonly visited: number;
  readonly rewritten: number;
  readonly refused: boolean;
}
/** A module-wide pass's result in the shape the module drivers adopt. */
interface ModuleRewrite {
  readonly module: ModuleIR;
  readonly visited: number;
  readonly rewritten: number;
}
/** One pass over a module version. An exhausted pass leaves the version
 * unchanged and reports the work done before it ran out. */
interface PassStep {
  readonly visited: number;
  readonly rewritten: number;
  readonly skipped: number;
  readonly exhausted: boolean;
  /** The version's module was replaced. */
  readonly replaced: boolean;
}
/** Makes `module` the current version, marking the indices whose function
 * changed in `changes`. */
function adoptModule(
  version: ModuleVersion,
  module: ModuleIR,
  changes: number[] | undefined,
): boolean {
  const previous = version.module;
  if (module === previous) return false;
  if (changes !== undefined) markChangedFunctions(changes, previous, module);
  version.module = module;
  return true;
}
function markChangedFunctions(
  changes: number[],
  previous: ModuleIR,
  next: ModuleIR,
): void {
  for (let id = 0; id < next.functions.length; id++)
    if (next.functions[id] !== previous.functions[id]) changes[id] = 1;
}
/** Rewrites each function of the version (only those `selected`, when given)
 * with what remains of `budget`, then adopts the rewritten functions when
 * any rewrite changed something. */
function rewriteFunctions(
  version: ModuleVersion,
  budget: number,
  selected: Uint8Array | undefined,
  changes: number[] | undefined,
  rewrite: (fn: FunctionIR, budget: number) => FunctionRewrite | undefined,
): PassStep {
  const functions: FunctionIR[] = [];
  let visited = 0,
    rewritten = 0,
    refused = 0;
  for (const fn of version.module.functions) {
    if (fn === undefined) throw "optimizer function invariant";
    if (selected !== undefined && selected[fn.id] !== 1) {
      functions.push(fn);
      continue;
    }
    const result = rewrite(fn, budget - visited);
    if (result === undefined)
      return {
        visited,
        rewritten: 0,
        skipped: refused,
        exhausted: true,
        replaced: false,
      };
    functions.push(result.fn);
    visited += result.visited;
    rewritten += result.rewritten;
    if (result.refused) refused++;
  }
  const replaced =
    rewritten > 0 &&
    adoptModule(version, { ...version.module, functions }, changes);
  return { visited, rewritten, skipped: refused, exhausted: false, replaced };
}
/** Runs a module-wide pass over the version and adopts its result. */
function rewriteModuleVersion(
  version: ModuleVersion,
  changes: number[] | undefined,
  rewrite: (module: ModuleIR) => ModuleRewrite | undefined,
): PassStep {
  const result = rewrite(version.module);
  if (result === undefined)
    return {
      visited: 0,
      rewritten: 0,
      skipped: 0,
      exhausted: true,
      replaced: false,
    };
  const replaced = adoptModule(version, result.module, changes);
  return {
    visited: result.visited,
    rewritten: result.rewritten,
    skipped: 0,
    exhausted: false,
    replaced,
  };
}
/** Function-local cleanup of the selected functions (see cleanupFunctionsPass). */
function cleanupSelectedFunctions(
  version: ModuleVersion,
  budget: number,
  selected: Uint8Array,
): PassStep {
  const result = cleanupFunctionsPass(
    version.module,
    budget,
    summarizeEffects(version.module, budget),
    selected,
  );
  const replaced = adoptModule(version, result.module, undefined);
  return {
    visited: result.visited,
    rewritten: result.rewritten,
    skipped: result.skipped,
    exhausted: false,
    replaced,
  };
}
/** SSA constant folding. Bounded (live) budgets cap it so one large function
 * cannot starve the established passes; AOT builds run it on every function. */
function foldModuleSSAConstants(
  version: ModuleVersion,
  maxInstructions: number,
  visited: number,
): PassStep {
  const ssaFunctions: FunctionIR[] = [],
    ssaLimit = unbounded(maxInstructions)
      ? maxInstructions
      : Math.max(1000000, Math.floor(maxInstructions / 20));
  let ssaVisited = 0,
    ssaSkipped = 0,
    ssaRewritten = 0;
  for (const fn of version.module.functions) {
    if (fn === undefined) throw "optimizer SSA function invariant";
    // SSA is an optional expensive phase. Bound it independently so a large
    // candidate cannot consume the budgets of established scalar/inline passes.
    const remaining = maxInstructions - visited - ssaVisited;
    if (remaining < 1)
      return {
        visited: ssaVisited,
        rewritten: 0,
        skipped: ssaSkipped,
        exhausted: true,
        replaced: false,
      };
    if (ssaVisited >= ssaLimit) {
      ssaSkipped++;
      ssaFunctions.push(fn);
      ssaVisited++;
      continue;
    }
    const allowance = unbounded(maxInstructions)
      ? remaining
      : Math.min(100000, ssaLimit - ssaVisited);
    const result = foldSSAConstants(fn, Math.min(remaining, allowance));
    if (result === undefined) {
      if (remaining < allowance)
        return {
          visited: ssaVisited,
          rewritten: 0,
          skipped: ssaSkipped,
          exhausted: true,
          replaced: false,
        };
      ssaVisited += allowance;
      ssaSkipped++;
      ssaFunctions.push(fn);
      continue;
    }
    ssaFunctions.push(result.fn);
    ssaVisited += result.visited;
    ssaRewritten += result.rewritten;
  }
  const replaced =
    ssaRewritten > 0 &&
    adoptModule(
      version,
      { ...version.module, functions: ssaFunctions },
      undefined,
    );
  return {
    visited: ssaVisited,
    rewritten: ssaRewritten,
    skipped: ssaSkipped,
    exhausted: false,
    replaced,
  };
}
/** Size measures that choose between the full pipeline and local cleanup. */
function measureModule(module: ModuleIR): {
  readonly instructions: number;
  readonly blocks: number;
  readonly slots: number;
  readonly directCalls: boolean;
} {
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
  return { instructions, blocks, slots, directCalls };
}
/** The functions marked in `changes` among a module's `count`. */
function changedFunctions(
  changes: readonly number[],
  count: number,
): Uint8Array {
  const selected = new Uint8Array(count);
  for (let id = 0; id < count; id++) if (changes[id] === 1) selected[id] = 1;
  return selected;
}
function anyChanged(changes: readonly number[], count: number): boolean {
  for (let id = 0; id < count; id++) if (changes[id] === 1) return true;
  return false;
}
function foldConstantsRewrite(
  fn: FunctionIR,
  budget: number,
): FunctionRewrite | undefined {
  const result = foldFunctionConstants(fn, budget);
  return result === undefined
    ? undefined
    : {
        fn: result.fn,
        visited: result.visited,
        rewritten: result.rewritten,
        refused: false,
      };
}
function forwardLoadsRewrite(
  fn: FunctionIR,
  budget: number,
  effects: Uint32Array | undefined,
): FunctionRewrite | undefined {
  const result = forwardLocalLoads(fn, budget, effects);
  return result === undefined
    ? undefined
    : {
        fn: result.fn,
        visited: result.visited,
        rewritten: result.forwarded,
        refused: false,
      };
}
function unreadStoresRewrite(
  fn: FunctionIR,
  budget: number,
): FunctionRewrite | undefined {
  const result = removeUnreadStores(fn, budget);
  return result === undefined
    ? undefined
    : {
        fn: result.fn,
        visited: result.visited,
        rewritten: result.removed,
        refused: false,
      };
}
function deadScalarsRewrite(
  fn: FunctionIR,
  budget: number,
): FunctionRewrite | undefined {
  const result = removeDeadScalars(fn, budget);
  return result === undefined
    ? undefined
    : {
        fn: result.fn,
        visited: result.visited,
        rewritten: result.removed,
        refused: false,
      };
}
function coalesceRewrite(
  fn: FunctionIR,
  budget: number,
): FunctionRewrite | undefined {
  const result = coalesceOptionalDefaults(fn, budget);
  return result === undefined
    ? undefined
    : {
        fn: result.fn,
        visited: result.visited,
        rewritten: result.rewritten,
        refused: false,
      };
}
function controlFlowRewrite(
  fn: FunctionIR,
  budget: number,
): FunctionRewrite | undefined {
  const result = simplifyControlFlow(fn, budget);
  return result === undefined
    ? undefined
    : {
        fn: result.fn,
        visited: result.visited,
        rewritten: result.rewritten,
        refused: false,
      };
}
function recordReplacementRewrite(
  fn: FunctionIR,
  module: ModuleIR,
  budget: number,
  remarks: RemarkSink | undefined,
): FunctionRewrite | undefined {
  const result = scalarReplaceRecords(fn, module, budget, remarks);
  return result === undefined
    ? undefined
    : {
        fn: result.fn,
        visited: result.visited,
        rewritten: result.replaced,
        refused: false,
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
  const version: ModuleVersion = { module };
  const report = optimizeModuleVersion(version, maxInstructions, options);
  return {
    module: version.module,
    passes: report.passes,
    budgetExhausted: report.budgetExhausted,
  };
}
/** Optimizes `version.module` in place (see optimizeModule): each completed
 * pass replaces it, so a caller that keeps only the version lets superseded
 * versions, including the input, be collected during the pipeline. */
export function optimizeModuleVersion(
  version: ModuleVersion,
  maxInstructions: number = 20000000,
  options: OptimizationOptions = {},
): OptimizationReport {
  if (!Number.isSafeInteger(maxInstructions) || maxInstructions < 0)
    throw "INVALID_OPTIMIZATION_BUDGET";
  const observer = options.observer,
    observePass = observer === undefined ? undefined : observer.pass,
    sink = observer === undefined ? undefined : observer.remark,
    passLimit = options.passLimit,
    passes: PassStatistics[] = [];
  // A pass's remarks are delivered when it completes; an exhausted pass's
  // work (and so its remarks) is discarded.
  let pendingRemarks: OptimizationRemark[] = [];
  const remarks: RemarkSink | undefined =
    sink === undefined
      ? undefined
      : (remark: OptimizationRemark): void => {
          pendingRemarks.push(remark);
        };
  if (observer !== undefined) {
    const begin = observer.begin;
    if (begin !== undefined) begin(version.module);
  }
  if (passLimit !== undefined && passLimit <= 0)
    return { passes, budgetExhausted: false };
  function record(
    statistics: PassStatistics,
    after: ModuleIR,
    budgetExhausted: boolean,
  ): boolean {
    passes.push(statistics);
    if (sink !== undefined) {
      const delivered = pendingRemarks;
      pendingRemarks = [];
      if (!budgetExhausted)
        for (const remark of delivered) {
          if (remark === undefined) throw "optimizer remark invariant";
          sink(remark);
        }
    }
    if (observePass !== undefined)
      observePass({ statistics, module: after, budgetExhausted });
    return passLimit !== undefined && passes.length >= passLimit;
  }
  /** Records a completed pass of the current version; true stops. */
  function completed(
    pass: PassStatistics["pass"],
    step: PassStep,
    skipped: boolean,
  ): boolean {
    return record(
      skipped
        ? {
            phase: "scalar",
            pass,
            visited: step.visited,
            rewritten: step.rewritten,
            skipped: step.skipped,
          }
        : {
            phase: "scalar",
            pass,
            visited: step.visited,
            rewritten: step.rewritten,
          },
      version.module,
      false,
    );
  }
  function stop(): OptimizationReport {
    return { passes, budgetExhausted: false };
  }
  /** Records the pass that ran out; the version keeps the last checkpoint. */
  function exhausted(
    pass: PassStatistics["pass"],
    visited: number,
  ): OptimizationReport {
    record(
      { phase: "scalar", pass, visited, rewritten: 0 },
      version.module,
      true,
    );
    return { passes, budgetExhausted: true };
  }
  const size = measureModule(version.module);
  // Preserve the initial all-or-nothing contract when even one scan cannot fit.
  // Otherwise reserve the budget for useful local work when the multi-phase
  // pipeline's estimated footprint already exceeds it.
  if (
    version.module.functions.length > 1 &&
    size.instructions <= maxInstructions &&
    size.instructions * 5 + size.slots * 2 + size.blocks > maxInstructions
  ) {
    const cleaned = cleanupFunctions(
      version.module,
      maxInstructions,
      size.directCalls,
      passes,
      record,
      remarks,
    );
    version.module = cleaned.module;
    return { passes, budgetExhausted: cleaned.budgetExhausted };
  }
  const folded = rewriteFunctions(
    version,
    maxInstructions,
    undefined,
    undefined,
    foldConstantsRewrite,
  );
  if (folded.exhausted) return exhausted("fold-constants", maxInstructions);
  if (completed("fold-constants", folded, false)) return stop();
  let visited = folded.visited;
  const ssa = foldModuleSSAConstants(version, maxInstructions, visited);
  if (ssa.exhausted)
    return exhausted("ssa-constants", maxInstructions - visited);
  if (completed("ssa-constants", ssa, true)) return stop();
  visited += ssa.visited;
  const callEffects = summarizeEffects(
    version.module,
    maxInstructions - visited,
  );
  const forwarded = rewriteFunctions(
    version,
    maxInstructions - visited,
    undefined,
    undefined,
    (fn: FunctionIR, budget: number): FunctionRewrite | undefined =>
      forwardLoadsRewrite(fn, budget, callEffects),
  );
  if (forwarded.exhausted)
    return exhausted("forward-local-loads", maxInstructions - visited);
  if (completed("forward-local-loads", forwarded, false)) return stop();
  visited += forwarded.visited;
  const stores = rewriteFunctions(
    version,
    maxInstructions - visited,
    undefined,
    undefined,
    unreadStoresRewrite,
  );
  if (stores.exhausted)
    return exhausted("remove-unread-stores", maxInstructions - visited);
  if (completed("remove-unread-stores", stores, false)) return stop();
  const storeVisited = stores.visited;
  const dead = rewriteFunctions(
    version,
    maxInstructions - visited - storeVisited,
    undefined,
    undefined,
    deadScalarsRewrite,
  );
  if (dead.exhausted)
    return exhausted(
      "remove-dead-scalars",
      maxInstructions - visited - storeVisited,
    );
  if (completed("remove-dead-scalars", dead, false)) return stop();
  // Local forwarding and store removal leave each lowered `x ?? constant`
  // in its canonical diamond; fuse it so later passes see merged blocks.
  // Later budgets subtract deadVisited, which includes this pass.
  const coalesced = rewriteFunctions(
    version,
    maxInstructions - visited - storeVisited - dead.visited,
    undefined,
    undefined,
    coalesceRewrite,
  );
  if (coalesced.exhausted)
    return exhausted(
      "coalesce-defaults",
      maxInstructions -
        visited -
        storeVisited -
        dead.visited -
        coalesced.visited,
    );
  if (completed("coalesce-defaults", coalesced, false)) return stop();
  const deadVisited = dead.visited + coalesced.visited;
  const records = rewriteFunctions(
    version,
    maxInstructions - visited - storeVisited - deadVisited,
    undefined,
    undefined,
    (fn: FunctionIR, budget: number): FunctionRewrite | undefined =>
      recordReplacementRewrite(fn, version.module, budget, remarks),
  );
  if (records.exhausted)
    return exhausted(
      "scalar-replace-records",
      maxInstructions - visited - storeVisited - deadVisited,
    );
  if (completed("scalar-replace-records", records, false)) return stop();
  let recordVisited = records.visited;
  // Functions devirtualization and inlining change; their cleanup below
  // visits only those.
  const inlineChanges: number[] = [];
  let inlinedAny = false;
  // Indirect calls of closures created in the same function become direct
  // calls (environment passed explicitly), so the inliner sees callbacks.
  if (options.devirtualizeClosures === true) {
    const devirtualizeBudget =
      maxInstructions - visited - storeVisited - deadVisited - recordVisited;
    const devirtualized = rewriteModuleVersion(
      version,
      inlineChanges,
      (module: ModuleIR): ModuleRewrite | undefined =>
        devirtualizeClosureCalls(
          module,
          devirtualizeBudget,
          options.closedRecords === true,
          remarks,
        ),
    );
    if (devirtualized.exhausted)
      return exhausted("devirtualize-closures", devirtualizeBudget);
    if (completed("devirtualize-closures", devirtualized, false)) return stop();
    recordVisited += devirtualized.visited;
    if (devirtualized.replaced) inlinedAny = true;
  }
  let inlineVisited = 0;
  const guardedInlining = options.inlining === "guarded";
  // Inlining considers leaf callees only, so a wrapper becomes eligible once
  // its own callees were inlined: repeat while rounds make progress.
  const inlineRounds =
    options.inlining === "none" ? 0 : guardedInlining ? 2 : 3;
  for (let round = 0; round < inlineRounds; round++) {
    const remaining =
      maxInstructions -
      visited -
      storeVisited -
      deadVisited -
      recordVisited -
      inlineVisited;
    const inlined = rewriteModuleVersion(
      version,
      inlineChanges,
      (module: ModuleIR): ModuleRewrite | undefined => {
        const result = inlineSmallFunctions(
          module,
          remaining,
          guardedInlining,
          false,
          remarks,
        );
        return result === undefined
          ? undefined
          : {
              module: result.module,
              visited: result.visited,
              rewritten: result.inlined,
            };
      },
    );
    if (inlined.exhausted)
      return exhausted("inline-small-functions", remaining);
    if (inlined.replaced) inlinedAny = true;
    if (completed("inline-small-functions", inlined, false)) return stop();
    inlineVisited += inlined.visited;
    if (inlined.rewritten === 0) break;
  }
  if (inlinedAny) {
    const changed = changedFunctions(
      inlineChanges,
      version.module.functions.length,
    );
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
      const cleaned = rewriteFunctions(
        version,
        maxInstructions - spent,
        changed,
        undefined,
        phase === 0
          ? foldConstantsRewrite
          : phase === 1
            ? (fn: FunctionIR, budget: number): FunctionRewrite | undefined =>
                forwardLoadsRewrite(fn, budget, undefined)
            : phase === 2
              ? unreadStoresRewrite
              : deadScalarsRewrite,
      );
      if (cleaned.exhausted) return exhausted(pass, maxInstructions - spent);
      if (completed(pass, cleaned, false)) return stop();
      spent += cleaned.visited;
    }
    // Inlining exposes callee allocations to their callers: replace the
    // records that no longer escape, then clean up the scalar copies.
    spent = 0;
    for (const pass of passes) {
      if (pass === undefined) throw "optimizer pass invariant";
      spent += pass.visited;
    }
    // Replacement resolves record guards to constant branches: fold them,
    // merge the straight-line blocks, then forward and clean up.
    for (let phase = 0; phase < 6; phase++) {
      const pass: PassStatistics["pass"] =
        phase === 0
          ? "scalar-replace-records"
          : phase === 1
            ? "simplify-control-flow"
            : phase === 2
              ? "coalesce-defaults"
              : phase === 3
                ? "forward-local-loads"
                : phase === 4
                  ? "remove-unread-stores"
                  : "remove-dead-scalars";
      const cleaned = rewriteFunctions(
        version,
        maxInstructions - spent,
        changed,
        undefined,
        phase === 0
          ? (fn: FunctionIR, budget: number): FunctionRewrite | undefined =>
              recordReplacementRewrite(fn, version.module, budget, remarks)
          : phase === 1
            ? controlFlowRewrite
            : phase === 2
              ? coalesceRewrite
              : phase === 3
                ? (
                    fn: FunctionIR,
                    budget: number,
                  ): FunctionRewrite | undefined =>
                    forwardLoadsRewrite(fn, budget, undefined)
                : phase === 4
                  ? unreadStoresRewrite
                  : deadScalarsRewrite,
      );
      if (cleaned.exhausted) return exhausted(pass, maxInstructions - spent);
      if (completed(pass, cleaned, false)) return stop();
      spent += cleaned.visited;
    }
  }
  let used = 0;
  for (const pass of passes) {
    if (pass === undefined) throw "optimizer pass invariant";
    used += pass.visited;
  }
  // Functions record-read lowering, hoisting and access selection change
  // (from here to the sweep below); the sweep cleans up only those.
  const sweepChanges: number[] = [];
  // Repeated reads of one field of an unchanged object reuse the first.
  const reused = rewriteFunctions(
    version,
    maxInstructions - used,
    undefined,
    sweepChanges,
    (fn: FunctionIR, budget: number): FunctionRewrite | undefined => {
      const result = reuseUnionReads(fn, budget);
      return result === undefined
        ? undefined
        : {
            fn: result.fn,
            visited: result.visited,
            rewritten: result.rewritten,
            refused: false,
          };
    },
  );
  if (reused.exhausted)
    return exhausted("reuse-union-reads", maxInstructions - used);
  used += reused.visited;
  if (completed("reuse-union-reads", reused, false)) return stop();
  // Cells already accessed through an unchanged object slot are initialized.
  const proven = rewriteFunctions(
    version,
    maxInstructions - used,
    undefined,
    sweepChanges,
    (fn: FunctionIR, budget: number): FunctionRewrite | undefined => {
      const result = proveCellStates(fn, version.module.records, budget);
      return result === undefined
        ? undefined
        : {
            fn: result.fn,
            visited: result.visited,
            rewritten: result.rewritten,
            refused: false,
          };
    },
  );
  if (proven.exhausted)
    return exhausted("prove-cell-states", maxInstructions - used);
  used += proven.visited;
  if (completed("prove-cell-states", proven, false)) return stop();
  // Captured variables accessed in loops live in slots there.
  const promotionBudget = maxInstructions - used;
  const promoted = rewriteModuleVersion(
    version,
    sweepChanges,
    (module: ModuleIR): ModuleRewrite | undefined => {
      const result = promoteLoopCells(
        module,
        promotionBudget,
        remarks,
        options.closedCalls === true,
      );
      return result === undefined
        ? undefined
        : {
            module: result.module,
            visited: result.visited,
            rewritten: result.promoted,
          };
    },
  );
  if (promoted.exhausted)
    return exhausted("promote-loop-cells", promotionBudget);
  if (completed("promote-loop-cells", promoted, false)) return stop();
  used += promoted.visited;
  // Element copy loops over dense reference lists (slice) get a bulk
  // vector copy fast path.
  const bulkBudget = maxInstructions - used;
  const bulk = rewriteModuleVersion(
    version,
    sweepChanges,
    (module: ModuleIR): ModuleRewrite | undefined =>
      bulkListCopies(module, bulkBudget),
  );
  if (bulk.exhausted) return exhausted("bulk-list-copies", bulkBudget);
  if (completed("bulk-list-copies", bulk, false)) return stop();
  used += bulk.visited;
  // Chains of string tests against literals dispatch on the length first
  // (before record reads are lowered: the dispatch joins paths that read
  // proofs follow).
  const dispatched = rewriteFunctions(
    version,
    maxInstructions - used,
    undefined,
    sweepChanges,
    (fn: FunctionIR, budget: number): FunctionRewrite | undefined => {
      const result = dispatchStringChains(fn, budget, remarks);
      return result === undefined
        ? undefined
        : {
            fn: result.fn,
            visited: result.visited,
            rewritten: result.rewritten,
            refused: false,
          };
    },
  );
  if (dispatched.exhausted)
    return exhausted("dispatch-string-chains", maxInstructions - used);
  used += dispatched.visited;
  if (completed("dispatch-string-chains", dispatched, false)) return stop();
  const accessBudget = maxInstructions - used;
  const accesses = rewriteModuleVersion(
    version,
    sweepChanges,
    (module: ModuleIR): ModuleRewrite | undefined =>
      lowerProvenRecordReads(module, accessBudget, remarks),
  );
  if (accesses.exhausted)
    return exhausted("lower-proven-record-reads", accessBudget);
  if (completed("lower-proven-record-reads", accesses, false)) return stop();
  const accessVisited = accesses.visited;
  // Inlined parameters copy their arguments: loads of a copy read the
  // source slot instead, so facts proven on either slot cover both.
  const copyLayouts = stableDescriptors(version.module);
  const copies = rewriteFunctions(
    version,
    maxInstructions - used - accessVisited,
    undefined,
    sweepChanges,
    (fn: FunctionIR, budget: number): FunctionRewrite | undefined => {
      const result = propagateSlotCopies(fn, budget, copyLayouts);
      return result === undefined
        ? undefined
        : {
            fn: result.fn,
            visited: result.visited,
            rewritten: result.rewritten,
            refused: result.refused,
          };
    },
  );
  if (copies.exhausted)
    return exhausted(
      "propagate-slot-copies",
      maxInstructions - used - accessVisited,
    );
  if (completed("propagate-slot-copies", copies, true)) return stop();
  used += copies.visited;
  // Loop-invariant computations and checked immutable reads move to loop
  // preheaders.
  const hoisted = rewriteFunctions(
    version,
    maxInstructions - used - accessVisited,
    undefined,
    sweepChanges,
    (fn: FunctionIR, budget: number): FunctionRewrite | undefined => {
      const result = hoistLoopInvariants(fn, version.module, budget, remarks);
      return result === undefined
        ? undefined
        : {
            fn: result.fn,
            visited: result.visited,
            rewritten: result.hoisted,
            refused: false,
          };
    },
  );
  if (hoisted.exhausted)
    return exhausted(
      "hoist-loop-invariants",
      maxInstructions - used - accessVisited,
    );
  used += hoisted.visited;
  if (completed("hoist-loop-invariants", hoisted, false)) return stop();
  // Interval facts select unchecked typed-array accesses (and fold the
  // defaults of reads that can no longer be absent).
  const selected = rewriteFunctions(
    version,
    maxInstructions - used - accessVisited,
    undefined,
    sweepChanges,
    (fn: FunctionIR, budget: number): FunctionRewrite | undefined => {
      const result = selectArrayAccesses(fn, budget, remarks);
      return result === undefined
        ? undefined
        : {
            fn: result.fn,
            visited: result.visited,
            rewritten: result.rewritten,
            refused: false,
          };
    },
  );
  if (selected.exhausted)
    return exhausted(
      "select-array-access",
      maxInstructions - used - accessVisited,
    );
  used += selected.visited;
  if (completed("select-array-access", selected, false)) return stop();
  // Optional numbers that are only stored and inspected become a presence
  // and a value slot (registers rather than two frame words); threading
  // then sees the presence tests as slot-carried booleans.
  const split = rewriteFunctions(
    version,
    maxInstructions - used - accessVisited,
    undefined,
    sweepChanges,
    (fn: FunctionIR, budget: number): FunctionRewrite | undefined => {
      const result = splitOptionalNumbers(fn, budget, remarks);
      return result === undefined
        ? undefined
        : {
            fn: result.fn,
            visited: result.visited,
            rewritten: result.split,
            refused: false,
          };
    },
  );
  if (split.exhausted)
    return exhausted(
      "split-optional-numbers",
      maxInstructions - used - accessVisited,
    );
  used += split.visited;
  if (completed("split-optional-numbers", split, false)) return stop();
  // General slots tested as numbers keep a presence and a number shadow, so
  // their tests read registers and proven reads skip the tag check.
  const shadows = rewriteFunctions(
    version,
    maxInstructions - used - accessVisited,
    undefined,
    sweepChanges,
    (fn: FunctionIR, budget: number): FunctionRewrite | undefined => {
      const result = shadowGeneralNumbers(fn, budget, remarks);
      return result === undefined
        ? undefined
        : {
            fn: result.fn,
            visited: result.visited,
            rewritten: result.shadowed,
            refused: false,
          };
    },
  );
  if (shadows.exhausted)
    return exhausted(
      "shadow-general-numbers",
      maxInstructions - used - accessVisited,
    );
  used += shadows.visited;
  if (completed("shadow-general-numbers", shadows, false)) return stop();
  // Thread branches on slot-carried booleans before the sweep, which then
  // forwards the copied reloads and removes the carriers' stores.
  const threaded = rewriteFunctions(
    version,
    maxInstructions - used - accessVisited,
    undefined,
    sweepChanges,
    (fn: FunctionIR, budget: number): FunctionRewrite | undefined => {
      const result = threadBranches(fn, budget, remarks);
      return result === undefined
        ? undefined
        : {
            fn: result.fn,
            visited: result.visited,
            rewritten: result.rewritten,
            refused: false,
          };
    },
  );
  if (threaded.exhausted)
    return exhausted("thread-branches", maxInstructions - used - accessVisited);
  used += threaded.visited;
  if (completed("thread-branches", threaded, false)) return stop();
  // Proven record reads branch on a constant true: fold those branches
  // before the sweep so their conditions die with them.
  const branches = rewriteFunctions(
    version,
    maxInstructions - used - accessVisited,
    undefined,
    sweepChanges,
    controlFlowRewrite,
  );
  if (branches.exhausted)
    return exhausted(
      "simplify-control-flow",
      maxInstructions - used - accessVisited,
    );
  used += branches.visited;
  if (completed("simplify-control-flow", branches, false)) return stop();
  // Record-read lowering, hoisting and access selection leave copies, dead
  // success flags, unread optionals and folded comparisons behind: sweep the
  // functions they changed.
  const swept = changedFunctions(sweepChanges, version.module.functions.length);
  if (anyChanged(sweepChanges, swept.length)) {
    const sweepFolded = rewriteFunctions(
      version,
      maxInstructions - used - accessVisited,
      swept,
      undefined,
      foldConstantsRewrite,
    );
    if (sweepFolded.exhausted)
      return exhausted(
        "fold-constants",
        maxInstructions - used - accessVisited,
      );
    used += sweepFolded.visited;
    if (completed("fold-constants", sweepFolded, false)) return stop();
    const sweep = cleanupSelectedFunctions(
      version,
      maxInstructions - used - accessVisited,
      swept,
    );
    if (completed("function-local-cleanup", sweep, true)) return stop();
    used += sweep.visited;
  }
  const generalControlChanged = new Uint8Array(version.module.functions.length);
  let hasGeneralControlChanged = false;
  const control = rewriteFunctions(
    version,
    maxInstructions - used - accessVisited,
    undefined,
    undefined,
    (fn: FunctionIR, budget: number): FunctionRewrite | undefined => {
      const result = controlFlowRewrite(fn, budget);
      if (
        result !== undefined &&
        result.rewritten > 0 &&
        hasScriptOperations(result.fn)
      ) {
        generalControlChanged[fn.id] = 1;
        hasGeneralControlChanged = true;
      }
      return result;
    },
  );
  if (control.exhausted)
    return exhausted(
      "simplify-control-flow",
      maxInstructions - used - accessVisited,
    );
  if (completed("simplify-control-flow", control, false)) return stop();
  let controlVisited = control.visited;
  // Jump-chain merging in general functions exposes block-local forwarding
  // (e.g. wrap/unwrap pairs and merged loop increments) before slot
  // compaction, element caching, and counted-loop induction.
  if (hasGeneralControlChanged) {
    const postControl = cleanupSelectedFunctions(
      version,
      maxInstructions - used - accessVisited - controlVisited,
      generalControlChanged,
    );
    if (completed("function-local-cleanup", postControl, true)) return stop();
    controlVisited += postControl.visited;
  }
  // Sink cold closure-environment loads from the entry block to the lowest
  // common dominator of their uses outside loops, freeing callee-saved
  // registers on hot paths.
  const sunk = rewriteFunctions(
    version,
    maxInstructions - used - accessVisited - controlVisited,
    undefined,
    undefined,
    (fn: FunctionIR, budget: number): FunctionRewrite | undefined => {
      const result = sinkEnvironmentLoads(fn, version.module, budget, remarks);
      return result === undefined
        ? undefined
        : {
            fn: result.fn,
            visited: result.visited,
            rewritten: result.sunk,
            refused: false,
          };
    },
  );
  if (sunk.exhausted)
    return exhausted(
      "sink-environment-loads",
      maxInstructions - used - accessVisited - controlVisited,
    );
  if (completed("sink-environment-loads", sunk, false)) return stop();
  const sinkVisited = sunk.visited;
  const compacted = rewriteFunctions(
    version,
    maxInstructions - used - accessVisited - controlVisited - sinkVisited,
    undefined,
    undefined,
    (fn: FunctionIR, budget: number): FunctionRewrite | undefined => {
      const result = compactSlots(fn, budget);
      return result === undefined
        ? undefined
        : {
            fn: result.fn,
            visited: result.visited,
            rewritten: result.removed,
            refused: false,
          };
    },
  );
  if (compacted.exhausted)
    return exhausted(
      "compact-slots",
      maxInstructions - used - accessVisited - controlVisited - sinkVisited,
    );
  if (completed("compact-slots", compacted, false)) return stop();
  const compactVisited = compacted.visited;
  // Dense list reads in loops read a vector cached ahead of the loop and
  // refreshed after each site that may replace that list's root (codegen
  // trusts that cache, so nothing may move code after this; copying a whole
  // loop with its refreshes keeps it current).
  const vectorBudget =
    maxInstructions -
    used -
    accessVisited -
    controlVisited -
    sinkVisited -
    compactVisited;
  const vectors = rewriteModuleVersion(
    version,
    undefined,
    (module: ModuleIR): ModuleRewrite | undefined =>
      cacheListVectors(module, vectorBudget, options.closedCalls === true),
  );
  if (vectors.exhausted) return exhausted("cache-list-vectors", vectorBudget);
  if (completed("cache-list-vectors", vectors, false)) return stop();
  // Loop-invariant packed binary64 array accesses cache (storage, count) in
  // the loop preheader and invalidate count to 0 after cold calls/writes.
  const elementBudget = vectorBudget - vectors.visited;
  const cachedElements = rewriteFunctions(
    version,
    elementBudget,
    undefined,
    undefined,
    (fn: FunctionIR, budget: number): FunctionRewrite | undefined => {
      const result = cacheElementStorage(fn, budget, remarks);
      return result === undefined
        ? undefined
        : {
            fn: result.fn,
            visited: result.visited,
            rewritten: result.rewritten,
            refused: false,
          };
    },
  );
  if (cachedElements.exhausted)
    return exhausted("cache-element-storage", elementBudget);
  if (completed("cache-element-storage", cachedElements, false)) return stop();
  // Last: counted loops with unknown bounds compare against a word bound,
  // with a cold copy for bounds beyond uint32. Running after the vector
  // caches lets the copy share the loop's cache slots instead of adding
  // its own, which would compete with the hot loop's for registers.
  const boundChanges: number[] = [];
  const bounded = rewriteFunctions(
    version,
    elementBudget - cachedElements.visited,
    undefined,
    boundChanges,
    (fn: FunctionIR, budget: number): FunctionRewrite | undefined => {
      const result = boundCountedLoops(fn, budget, remarks);
      return result === undefined
        ? undefined
        : {
            fn: result.fn,
            visited: result.visited,
            rewritten: result.bounded,
            refused: false,
          };
    },
  );
  // An exhausted bound pass reports the work it completed.
  if (bounded.exhausted)
    return exhausted("bound-counted-loops", bounded.visited);
  if (completed("bound-counted-loops", bounded, false)) return stop();
  // Loops taking remainders by an invariant integer get a version for a
  // positive divisor, whose remainders codegen keeps integers.
  const divided = rewriteFunctions(
    version,
    elementBudget - cachedElements.visited - bounded.visited,
    undefined,
    boundChanges,
    (fn: FunctionIR, budget: number): FunctionRewrite | undefined => {
      const result = versionNonzeroDivisors(fn, budget, remarks);
      return result === undefined
        ? undefined
        : {
            fn: result.fn,
            visited: result.visited,
            rewritten: result.versioned,
            refused: false,
          };
    },
  );
  if (divided.exhausted)
    return exhausted("version-nonzero-divisors", divided.visited);
  if (completed("version-nonzero-divisors", divided, false)) return stop();
  // Interval facts again where a counter now has a word bound or a divisor
  // a positive slot: values derived from a counter (a loop-invariant
  // `round * 7` carried in a slot) become safe integer slots, and positive
  // divisors nonzero slots. Selection rewrites accesses in place and moves no
  // code, which the vector caches above require. It runs (and reports) only
  // when some loop was bounded or versioned.
  const reboundSelection = new Uint8Array(version.module.functions.length);
  let rebound = false;
  for (let id = 0; id < boundChanges.length; id++)
    if (boundChanges[id] === 1) {
      reboundSelection[id] = 1;
      rebound = true;
    }
  let reselectedVisited = 0;
  if (rebound) {
    const reselected = rewriteFunctions(
      version,
      elementBudget -
        cachedElements.visited -
        bounded.visited -
        divided.visited,
      reboundSelection,
      undefined,
      (fn: FunctionIR, budget: number): FunctionRewrite | undefined => {
        const result = selectArrayAccesses(fn, budget, remarks);
        // New facts alone are a rewrite here: the module must adopt them.
        return result === undefined
          ? undefined
          : {
              fn: result.fn,
              visited: result.visited,
              rewritten: result.rewritten + (result.fn === fn ? 0 : 1),
              refused: false,
            };
      },
    );
    if (reselected.exhausted)
      return exhausted("select-array-access", reselected.visited);
    if (completed("select-array-access", reselected, false)) return stop();
    reselectedVisited = reselected.visited;
  }
  // Layout only: each block is followed by its preferred successor, so the
  // emitter elides that edge's branch (block-layout.ts).
  const layoutBudget =
    elementBudget -
    cachedElements.visited -
    bounded.visited -
    divided.visited -
    reselectedVisited;
  const laid = rewriteFunctions(
    version,
    layoutBudget,
    undefined,
    undefined,
    (fn: FunctionIR, budget: number): FunctionRewrite | undefined => {
      const result = layoutBlocks(fn, budget);
      return result === undefined
        ? undefined
        : {
            fn: result.fn,
            visited: result.visited,
            rewritten: result.moved,
            refused: false,
          };
    },
  );
  if (laid.exhausted) return exhausted("layout-blocks", layoutBudget);
  if (completed("layout-blocks", laid, false)) return stop();
  return { passes, budgetExhausted: false };
}

/** Only scalar operations with no observable effects are removable. In
 * particular, unused calls, allocations, memory accesses and throws survive. */
function removable(op: Instruction): boolean {
  switch (op.kind) {
    case "constant":
    case "string-literal":
    case "general-none":
    case "script-argument-count":
    case "activation-read":
    case "script-entry":
    case "global-cell":
    case "general-null":
    case "general-wrap":
    case "load":
    case "unary":
    case "binary":
    // Wrapping and presence tests cannot fail; unwraps (`*-value`) can.
    case "undefined":
    case "optional-wrap":
    case "optional-present":
    case "optional-value-or":
    case "boolean-none":
    case "boolean-wrap":
    case "boolean-present":
    case "string-none":
    case "string-wrap":
    case "string-present":
    case "reference-none":
    case "reference-wrap":
    case "string-reference":
    case "reference-string":
    // Reads selected as in bounds cannot fail.
    case "array-element":
      return true;
    default:
      return false;
  }
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
  const debug =
    fn.debug === undefined ? undefined : retainDebugValues(fn, blocks);
  return {
    fn: debug === undefined ? { ...fn, blocks } : { ...fn, blocks, debug },
    removed,
    visited,
  };
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
  const blocks: Block[] = [],
    // Debug builds: a removed store to a named slot binds its value.
    variables = slotVariables(fn),
    bindings: ValueBinding[] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "optimizer block invariant";
    const instructions: Instruction[] = [];
    let previous = -1;
    for (const op of block.instructions) {
      if (op === undefined) throw "optimizer instruction invariant";
      if (visited >= budget) return undefined;
      visited++;
      if (op.kind === "store" && read[op.slot] !== 1) {
        removed++;
        removedStoreBinding(variables, op, previous, bindings);
      } else instructions.push(op);
      previous = instructionResult(op) ?? previous;
    }
    blocks.push(
      instructions.length === block.instructions.length
        ? block
        : { ...block, instructions },
    );
  }
  if (removed === 0) return { fn, removed, visited };
  const debug =
    fn.debug === undefined
      ? undefined
      : retainDebugValues(fn, blocks, bindings);
  return {
    fn: debug === undefined ? { ...fn, blocks } : { ...fn, blocks, debug },
    removed,
    visited,
  };
}
