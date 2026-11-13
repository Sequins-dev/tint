import { bulkListCopies } from "./bulk-list-copies.ts";
import { simplifyControlFlow } from "./control-flow.ts";
import { promoteLoopCells } from "./cell-promotion.ts";
import { threadBranches } from "./branch-threading.ts";
import { coalesceOptionalDefaults } from "./coalesce.ts";
import { compactSlots } from "./slots.ts";
export { compactSlots } from "./slots.ts";
export { simplifyControlFlow } from "./control-flow.ts";
import { lowerProvenRecordReads } from "./record-access.ts";
export { lowerProvenRecordReads } from "./record-access.ts";
import { reuseUnionReads } from "./union-reads.ts";
export { reuseUnionReads } from "./union-reads.ts";
import { proveCellStates } from "./cell-states.ts";
export { proveCellStates } from "./cell-states.ts";
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
import { inlineSmallFunctions } from "./inline.ts";
import { devirtualizeClosureCalls } from "./closures.ts";
import { selectArrayAccesses } from "./bounds.ts";
import { hoistLoopInvariants } from "./licm.ts";
export { hoistLoopInvariants } from "./licm.ts";
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
  readonly inlining?: "small" | "guarded";
  /** Rewrite indirect calls of closures known within their function into
   * direct calls (closed programs: no managed callback contracts observe
   * the call shapes or the function table). */
  readonly devirtualizeClosures?: boolean;
  /** No foreign code constructs or writes this module's records (no managed
   * surfaces or native services): closures read from record fields that
   * only ever hold one closure devirtualize too. */
  readonly closedRecords?: boolean;
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
    if (begin !== undefined) begin(module);
  }
  if (passLimit !== undefined && passLimit <= 0)
    return { module, passes, budgetExhausted: false };
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
  function stop(checkpoint: ModuleIR): Optimization {
    return { module: checkpoint, budgetExhausted: false, passes };
  }
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
    return cleanupFunctions(
      module,
      maxInstructions,
      directCalls,
      passes,
      record,
      remarks,
    );
  let visited = 0,
    rewritten = 0;
  const functions: FunctionIR[] = [];
  for (const fn of module.functions) {
    if (fn === undefined) throw "optimizer function invariant";
    const result = foldFunctionConstants(fn, maxInstructions - visited);
    if (result === undefined) {
      record(
        {
          phase: "scalar",
          pass: "fold-constants",
          visited: maxInstructions,
          rewritten: 0,
        },
        module,
        true,
      );
      return { module, budgetExhausted: true, passes };
    }
    functions.push(result.fn);
    visited += result.visited;
    rewritten += result.rewritten;
  }
  let constantsFolded = rewritten === 0 ? module : { ...module, functions };
  if (
    record(
      { phase: "scalar", pass: "fold-constants", visited, rewritten },
      constantsFolded,
      false,
    )
  )
    return stop(constantsFolded);
  function exhausted(checkpoint: ModuleIR, pass: PassStatistics): Optimization {
    record(pass, checkpoint, true);
    return { module: checkpoint, budgetExhausted: true, passes };
  }
  const ssaFunctions: FunctionIR[] = [],
    ssaLimit = Math.max(1000000, Math.floor(maxInstructions / 20));
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
    if (ssaVisited >= ssaLimit) {
      ssaSkipped++;
      ssaFunctions.push(fn);
      ssaVisited++;
      continue;
    }
    const allowance = Math.min(100000, ssaLimit - ssaVisited);
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
  if (
    record(
      {
        phase: "scalar",
        pass: "ssa-constants",
        visited: ssaVisited,
        rewritten: ssaRewritten,
        skipped: ssaSkipped,
      },
      constantsFolded,
      false,
    )
  )
    return stop(constantsFolded);
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
  if (
    record(
      {
        phase: "scalar",
        pass: "forward-local-loads",
        visited: forwardVisited,
        rewritten: forwarded,
      },
      folded,
      false,
    )
  )
    return stop(folded);
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
  if (
    record(
      {
        phase: "scalar",
        pass: "remove-unread-stores",
        visited: storeVisited,
        rewritten: storesRemoved,
      },
      stored,
      false,
    )
  )
    return stop(stored);
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
  if (
    record(
      {
        phase: "scalar",
        pass: "remove-dead-scalars",
        visited: deadVisited,
        rewritten: removed,
      },
      deadFree,
      false,
    )
  )
    return stop(deadFree);
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
  if (
    record(
      {
        phase: "scalar",
        pass: "coalesce-defaults",
        visited: deadVisited - deadOnly,
        rewritten: coalesced,
      },
      scalarModule,
      false,
    )
  )
    return stop(scalarModule);
  const recordFunctions: FunctionIR[] = [];
  let recordVisited = 0,
    recordsReplaced = 0;
  for (const fn of scalarModule.functions) {
    if (fn === undefined) throw "optimizer function invariant";
    const result = scalarReplaceRecords(
      fn,
      scalarModule,
      maxInstructions - visited - storeVisited - deadVisited - recordVisited,
      remarks,
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
  if (
    record(
      {
        phase: "scalar",
        pass: "scalar-replace-records",
        visited: recordVisited,
        rewritten: recordsReplaced,
      },
      replaced,
      false,
    )
  )
    return stop(replaced);
  // Indirect calls of closures created in the same function become direct
  // calls (environment passed explicitly), so the inliner sees callbacks.
  const devirtualized =
    options.devirtualizeClosures === true
      ? devirtualizeClosureCalls(
          replaced,
          maxInstructions -
            visited -
            storeVisited -
            deadVisited -
            recordVisited,
          options.closedRecords === true,
          remarks,
        )
      : { module: replaced, visited: 0, rewritten: 0 };
  if (devirtualized === undefined)
    return exhausted(replaced, {
      phase: "scalar",
      pass: "devirtualize-closures",
      visited:
        maxInstructions - visited - storeVisited - deadVisited - recordVisited,
      rewritten: 0,
    });
  if (options.devirtualizeClosures === true)
    if (
      record(
        {
          phase: "scalar",
          pass: "devirtualize-closures",
          visited: devirtualized.visited,
          rewritten: devirtualized.rewritten,
        },
        devirtualized.module,
        false,
      )
    )
      return stop(devirtualized.module);
  recordVisited += devirtualized.visited;
  let inlinedModule = devirtualized.module,
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
      false,
      remarks,
    );
    if (inlineResult === undefined)
      return exhausted(inlinedModule, {
        phase: "scalar",
        pass: "inline-small-functions",
        visited: remaining,
        rewritten: 0,
      });
    if (
      record(
        {
          phase: "scalar",
          pass: "inline-small-functions",
          visited: inlineResult.visited,
          rewritten: inlineResult.inlined,
        },
        inlineResult.module,
        false,
      )
    )
      return stop(inlineResult.module);
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
      if (
        record(
          {
            phase: "scalar",
            pass,
            visited: cleanupVisited,
            rewritten: cleanupRewritten,
          },
          inlinedModule,
          false,
        )
      )
        return stop(inlinedModule);
      spent += cleanupVisited;
    }
  }
  if (inlinedModule !== replaced) {
    // Inlining exposes callee allocations to their callers: replace the
    // records that no longer escape, then clean up the scalar copies.
    let spent = 0;
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
          const result = scalarReplaceRecords(
            fn,
            inlinedModule,
            budget,
            remarks,
          );
          if (result !== undefined) {
            next = result.fn;
            cleanupVisited += result.visited;
            cleanupRewritten += result.replaced;
          }
        } else if (phase === 1) {
          const result = simplifyControlFlow(fn, budget);
          if (result !== undefined) {
            next = result.fn;
            cleanupVisited += result.visited;
            cleanupRewritten += result.rewritten;
          }
        } else if (phase === 2) {
          const result = coalesceOptionalDefaults(fn, budget);
          if (result !== undefined) {
            next = result.fn;
            cleanupVisited += result.visited;
            cleanupRewritten += result.rewritten;
          }
        } else if (phase === 3) {
          const result = forwardLocalLoads(fn, budget);
          if (result !== undefined) {
            next = result.fn;
            cleanupVisited += result.visited;
            cleanupRewritten += result.forwarded;
          }
        } else {
          const result =
            phase === 4
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
      if (
        record(
          {
            phase: "scalar",
            pass,
            visited: cleanupVisited,
            rewritten: cleanupRewritten,
          },
          inlinedModule,
          false,
        )
      )
        return stop(inlinedModule);
      spent += cleanupVisited;
    }
  }
  let used = 0;
  for (const pass of passes) {
    if (pass === undefined) throw "optimizer pass invariant";
    used += pass.visited;
  }
  // Repeated reads of one field of an unchanged object reuse the first.
  const unreused = inlinedModule;
  const reusedFunctions: FunctionIR[] = [];
  let reuseVisited = 0,
    reuseRewritten = 0;
  for (const fn of inlinedModule.functions) {
    if (fn === undefined) throw "optimizer union read function invariant";
    const result = reuseUnionReads(fn, maxInstructions - used - reuseVisited);
    if (result === undefined)
      return exhausted(inlinedModule, {
        phase: "scalar",
        pass: "reuse-union-reads",
        visited: maxInstructions - used,
        rewritten: 0,
      });
    reusedFunctions.push(result.fn);
    reuseVisited += result.visited;
    reuseRewritten += result.rewritten;
  }
  used += reuseVisited;
  if (reuseRewritten > 0)
    inlinedModule = { ...inlinedModule, functions: reusedFunctions };
  if (
    record(
      {
        phase: "scalar",
        pass: "reuse-union-reads",
        visited: reuseVisited,
        rewritten: reuseRewritten,
      },
      inlinedModule,
      false,
    )
  )
    return stop(inlinedModule);
  // Cells already accessed through an unchanged object slot are initialized.
  const provenFunctions: FunctionIR[] = [];
  let cellVisited = 0,
    cellRewritten = 0;
  for (const fn of inlinedModule.functions) {
    if (fn === undefined) throw "optimizer cell state function invariant";
    const result = proveCellStates(
      fn,
      inlinedModule.records,
      maxInstructions - used - cellVisited,
    );
    if (result === undefined)
      return exhausted(inlinedModule, {
        phase: "scalar",
        pass: "prove-cell-states",
        visited: maxInstructions - used,
        rewritten: 0,
      });
    provenFunctions.push(result.fn);
    cellVisited += result.visited;
    cellRewritten += result.rewritten;
  }
  used += cellVisited;
  if (cellRewritten > 0)
    inlinedModule = { ...inlinedModule, functions: provenFunctions };
  if (
    record(
      {
        phase: "scalar",
        pass: "prove-cell-states",
        visited: cellVisited,
        rewritten: cellRewritten,
      },
      inlinedModule,
      false,
    )
  )
    return stop(inlinedModule);
  // Captured variables accessed in loops live in slots there.
  const promotion = promoteLoopCells(inlinedModule, maxInstructions - used);
  if (promotion === undefined)
    return exhausted(inlinedModule, {
      phase: "scalar",
      pass: "promote-loop-cells",
      visited: maxInstructions - used,
      rewritten: 0,
    });
  if (
    record(
      {
        phase: "scalar",
        pass: "promote-loop-cells",
        visited: promotion.visited,
        rewritten: promotion.promoted,
      },
      promotion.module,
      false,
    )
  )
    return stop(promotion.module);
  used += promotion.visited;
  inlinedModule = promotion.module;
  // Element copy loops over dense reference lists (slice) get a bulk
  // vector copy fast path.
  const bulk = bulkListCopies(inlinedModule, maxInstructions - used);
  if (bulk === undefined)
    return exhausted(inlinedModule, {
      phase: "scalar",
      pass: "bulk-list-copies",
      visited: maxInstructions - used,
      rewritten: 0,
    });
  if (
    record(
      {
        phase: "scalar",
        pass: "bulk-list-copies",
        visited: bulk.visited,
        rewritten: bulk.rewritten,
      },
      bulk.module,
      false,
    )
  )
    return stop(bulk.module);
  used += bulk.visited;
  inlinedModule = bulk.module;
  const accesses = lowerProvenRecordReads(
    inlinedModule,
    maxInstructions - used,
    remarks,
  );
  if (accesses === undefined)
    return exhausted(inlinedModule, {
      phase: "scalar",
      pass: "lower-proven-record-reads",
      visited: maxInstructions - used,
      rewritten: 0,
    });
  if (
    record(
      {
        phase: "scalar",
        pass: "lower-proven-record-reads",
        visited: accesses.visited,
        rewritten: accesses.rewritten,
      },
      accesses.module,
      false,
    )
  )
    return stop(accesses.module);
  // Loop-invariant computations and checked immutable reads move to loop
  // preheaders.
  const hoistedFunctions: FunctionIR[] = [];
  let hoistVisited = 0,
    hoistRewritten = 0;
  for (const fn of accesses.module.functions) {
    if (fn === undefined) throw "optimizer licm function invariant";
    const result = hoistLoopInvariants(
      fn,
      accesses.module,
      maxInstructions - used - accesses.visited - hoistVisited,
      remarks,
    );
    if (result === undefined)
      return exhausted(accesses.module, {
        phase: "scalar",
        pass: "hoist-loop-invariants",
        visited: maxInstructions - used - accesses.visited,
        rewritten: 0,
      });
    hoistedFunctions.push(result.fn);
    hoistVisited += result.visited;
    hoistRewritten += result.hoisted;
  }
  used += hoistVisited;
  const invariantModule =
    hoistRewritten === 0
      ? accesses.module
      : { ...accesses.module, functions: hoistedFunctions };
  if (
    record(
      {
        phase: "scalar",
        pass: "hoist-loop-invariants",
        visited: hoistVisited,
        rewritten: hoistRewritten,
      },
      invariantModule,
      false,
    )
  )
    return stop(invariantModule);
  // Interval facts select unchecked typed-array accesses (and fold the
  // defaults of reads that can no longer be absent).
  const selectedFunctions: FunctionIR[] = [];
  let selectVisited = 0,
    selectRewritten = 0,
    selectSkipped = 0;
  for (const fn of invariantModule.functions) {
    if (fn === undefined) throw "optimizer array function invariant";
    const result = selectArrayAccesses(
      fn,
      maxInstructions - used - accesses.visited - selectVisited,
      remarks,
    );
    if (result === undefined)
      return exhausted(invariantModule, {
        phase: "scalar",
        pass: "select-array-access",
        visited: maxInstructions - used - accesses.visited,
        rewritten: 0,
      });
    selectedFunctions.push(result.fn);
    selectVisited += result.visited;
    selectRewritten += result.rewritten;
    if (result.skipped === true) selectSkipped++;
  }
  used += selectVisited;
  const selectedModule =
    selectRewritten === 0
      ? invariantModule
      : { ...invariantModule, functions: selectedFunctions };
  if (
    record(
      {
        phase: "scalar",
        pass: "select-array-access",
        visited: selectVisited,
        rewritten: selectRewritten,
        ...(selectSkipped === 0 ? {} : { skipped: selectSkipped }),
      },
      selectedModule,
      false,
    )
  )
    return stop(selectedModule);
  // Thread branches on slot-carried booleans before the sweep, which then
  // forwards the copied reloads and removes the carriers' stores.
  const threadedFunctions: FunctionIR[] = [];
  let threadVisited = 0,
    threadRewritten = 0;
  for (const fn of selectedModule.functions) {
    if (fn === undefined) throw "optimizer threading function invariant";
    const result = threadBranches(
      fn,
      maxInstructions - used - accesses.visited - threadVisited,
      remarks,
    );
    if (result === undefined)
      return exhausted(selectedModule, {
        phase: "scalar",
        pass: "thread-branches",
        visited: maxInstructions - used - accesses.visited,
        rewritten: 0,
      });
    threadedFunctions.push(result.fn);
    threadVisited += result.visited;
    threadRewritten += result.rewritten;
  }
  used += threadVisited;
  const threadedModule =
    threadRewritten === 0
      ? selectedModule
      : { ...selectedModule, functions: threadedFunctions };
  if (
    record(
      {
        phase: "scalar",
        pass: "thread-branches",
        visited: threadVisited,
        rewritten: threadRewritten,
      },
      threadedModule,
      false,
    )
  )
    return stop(threadedModule);
  // Proven record reads branch on a constant true: fold those branches
  // before the sweep so their conditions die with them.
  const foldedBranches: FunctionIR[] = [];
  let branchVisited = 0,
    branchRewritten = 0;
  for (const fn of threadedModule.functions) {
    if (fn === undefined) throw "optimizer branch function invariant";
    const result = simplifyControlFlow(
      fn,
      maxInstructions - used - accesses.visited - branchVisited,
    );
    if (result === undefined)
      return exhausted(threadedModule, {
        phase: "scalar",
        pass: "simplify-control-flow",
        visited: maxInstructions - used - accesses.visited,
        rewritten: 0,
      });
    foldedBranches.push(result.fn);
    branchVisited += result.visited;
    branchRewritten += result.rewritten;
  }
  used += branchVisited;
  const unswept =
    branchRewritten === 0
      ? threadedModule
      : { ...threadedModule, functions: foldedBranches };
  if (
    record(
      {
        phase: "scalar",
        pass: "simplify-control-flow",
        visited: branchVisited,
        rewritten: branchRewritten,
      },
      unswept,
      false,
    )
  )
    return stop(unswept);
  // Record-read lowering, hoisting and access selection leave copies, dead
  // success flags, unread optionals and folded comparisons behind: sweep the
  // functions they changed.
  const swept = new Uint8Array(unswept.functions.length);
  let sweeping = false;
  for (let id = 0; id < unswept.functions.length; id++)
    if (unswept.functions[id] !== unreused.functions[id]) {
      swept[id] = 1;
      sweeping = true;
    }
  let selected = unswept;
  if (sweeping) {
    const foldedFunctions: FunctionIR[] = [];
    let foldVisited = 0,
      foldRewritten = 0;
    for (const fn of unswept.functions) {
      if (fn === undefined) throw "optimizer sweep function invariant";
      if (swept[fn.id] !== 1) {
        foldedFunctions.push(fn);
        continue;
      }
      const result = foldFunctionConstants(
        fn,
        maxInstructions - used - accesses.visited - foldVisited,
      );
      if (result === undefined)
        return exhausted(unswept, {
          phase: "scalar",
          pass: "fold-constants",
          visited: maxInstructions - used - accesses.visited,
          rewritten: 0,
        });
      foldedFunctions.push(result.fn);
      foldVisited += result.visited;
      foldRewritten += result.rewritten;
    }
    used += foldVisited;
    const folded =
      foldRewritten === 0
        ? unswept
        : { ...unswept, functions: foldedFunctions };
    if (
      record(
        {
          phase: "scalar",
          pass: "fold-constants",
          visited: foldVisited,
          rewritten: foldRewritten,
        },
        folded,
        false,
      )
    )
      return stop(folded);
    const sweep = cleanupFunctionsPass(
      folded,
      maxInstructions - used - accesses.visited,
      summarizeEffects(folded, maxInstructions - used - accesses.visited),
      swept,
    );
    if (
      record(
        {
          phase: "scalar",
          pass: "function-local-cleanup",
          visited: sweep.visited,
          rewritten: sweep.rewritten,
          skipped: sweep.skipped,
        },
        sweep.module,
        false,
      )
    )
      return stop(sweep.module);
    used += sweep.visited;
    selected = sweep.module;
  }
  const controlFunctions: FunctionIR[] = [];
  let controlVisited = 0,
    controlRewritten = 0;
  for (const fn of selected.functions) {
    if (fn === undefined) throw "optimizer control-flow function invariant";
    const result = simplifyControlFlow(
      fn,
      maxInstructions - used - accesses.visited - controlVisited,
    );
    if (result === undefined)
      return exhausted(selected, {
        phase: "scalar",
        pass: "simplify-control-flow",
        visited: maxInstructions - used - accesses.visited,
        rewritten: 0,
      });
    controlFunctions.push(result.fn);
    controlVisited += result.visited;
    controlRewritten += result.rewritten;
  }
  const controlled =
    controlRewritten === 0
      ? selected
      : { ...selected, functions: controlFunctions };
  if (
    record(
      {
        phase: "scalar",
        pass: "simplify-control-flow",
        visited: controlVisited,
        rewritten: controlRewritten,
      },
      controlled,
      false,
    )
  )
    return stop(controlled);
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
  const compacted =
    compactRemoved === 0
      ? controlled
      : { ...controlled, functions: compactedFunctions };
  if (
    record(
      {
        phase: "scalar",
        pass: "compact-slots",
        visited: compactVisited,
        rewritten: compactRemoved,
      },
      compacted,
      false,
    )
  )
    return stop(compacted);
  return { module: compacted, budgetExhausted: false, passes };
}

/** Only scalar operations with no observable effects are removable. In
 * particular, unused calls, allocations, memory accesses and throws survive. */
function removable(op: Instruction): boolean {
  switch (op.kind) {
    case "constant":
    case "string-literal":
    case "general-none":
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
