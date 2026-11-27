import {
  instructionResult,
  isNativeTypedArray,
  visitInstructionOperands,
  visitTerminatorOperands,
  substituteInstructionValues,
  substituteTerminatorValues,
  instructionEffects,
  effectAllocate,
  naturalLoops,
  type ModuleIR,
  type FunctionIR,
  type Instruction,
  type Block,
  type ScalarType,
  type Terminator,
  type Span,
  type DebugOrigin,
  type InlineSite,
  type SourceVariable,
  type SlotBinding,
  type ValueBinding,
} from "../scalar/index.ts";
import type { OptimizationRemark, RemarkSink } from "./observer.ts";
export interface Inlining {
  readonly module: ModuleIR;
  readonly visited: number;
  readonly inlined: number;
  readonly budgetExhausted?: true;
}
function scalar(type: ScalarType): boolean {
  return (
    type === "number" ||
    type === "boolean" ||
    type === "optional-number" ||
    type === "optional-boolean"
  );
}
/** The type of a value that crosses an inlined CFG through a slot, when it
 * is known from its definition alone. */
function crossingType(
  op: Instruction,
  module: ModuleIR,
): ScalarType | undefined {
  switch (op.kind) {
    case "call":
    case "call-indirect": {
      const type = module.functions[op.target]?.returnType;
      return type === undefined || type === "void" ? undefined : type;
    }
    case "function-new":
    case "reference-value":
      return "reference";
    case "general-is":
      return "boolean";
    case "general-value":
      return op.type;
    case "general-wrap":
    case "general-none":
      return "general";
    case "reference-wrap":
    case "reference-none":
    case "string-reference":
    case "function-environment":
      return "optional-reference";
    case "reference-string":
      return "optional-string";
    case "string-value":
    case "string-literal":
      return "string";
    case "string-wrap":
      return "optional-string";
    case "optional-wrap":
      return "optional-number";
    case "optional-value":
    case "optional-value-or":
      return "number";
    case "optional-present":
      return "boolean";
    case "unary":
      return op.operator === "!" ||
        op.operator === "truthy" ||
        op.operator === "is-integer"
        ? "boolean"
        : op.operator === "boolean-number" ||
            [
              "+",
              "-",
              "~",
              "ceil",
              "trunc",
              "sqrt",
              "fround",
              "f16round",
            ].includes(op.operator)
          ? "number"
          : undefined;
    case "binary":
      return ["===", "!==", "==", "!=", "<", ">", "<=", ">="].includes(
        op.operator,
      )
        ? "boolean"
        : "number";
    case "general-none":
    case "general-null":
    case "general-wrap":
      return "general";
    case "general-equal":
      return "boolean";
    default:
      return undefined;
  }
}
/** Generated reference-list accessors whose IR shape the emitter matches to
 * inline their dense paths (an allocation in the body marks the cell-boxed
 * variant). Expanding allocating callees into them would hide that shape. */
function shapeRecognized(fn: FunctionIR): boolean {
  return fn.name.startsWith("__tint_reference_list_");
}
/** Outlined pre-loop-proven numeric loop kernels stay out-of-line so they keep
 * `fn.environment === undefined` and run with intraprocedural integer slots
 * without polluting their general script callers. */
function outlinedSpecLoop(fn: FunctionIR): boolean {
  return fn.name.includes("__tint_spec_loop_");
}
/** Blocks other than empty traps (the failure edges of checked record
 * accesses), which add no code worth bounding. */
function nonTrapBlocks(fn: FunctionIR): number {
  let count = 0;
  for (const block of fn.blocks)
    if (
      block !== undefined &&
      (block.terminator.kind !== "trap" || block.instructions.length > 0)
    )
      count++;
  return count;
}
function supported(
  op: Instruction,
  references: boolean = true,
  allowGeneral: boolean = false,
): boolean {
  switch (op.kind) {
    case "constant":
    case "load":
    case "store":
    case "unary":
    case "binary":
    case "undefined":
    case "optional-wrap":
    case "optional-present":
    case "optional-value":
    case "optional-value-or":
    case "boolean-none":
    case "boolean-wrap":
    case "boolean-present":
    case "boolean-value":
    case "array-read":
    case "array-element":
    case "array-valid":
    case "array-length":
    case "array-write":
    case "array-store":
    case "array-fill":
    case "array-atomic":
    case "array-word64-read":
    case "array-word64-write":
    case "array-word64-fill":
    case "array-atomic-word64":
    // Tag tests and payload views of general values are pure inline
    // sequences (a mismatched checked view traps).
    case "general-is":
    case "general-record-is":
    case "general-value":
    case "record-slot-read":
    case "property-load":
    // A cached property store is a nonallocating, nonthrowing inline
    // sequence; its write keeps heap effects (see instructionEffects).
    case "property-store":
    case "script-entry":
    case "global-cell":
    // Element loads, stores, and length reads are inline, nonallocating and nonthrowing.
    case "element-load":
    case "element-store":
    case "general-element-load":
    case "general-element-store":
    case "general-slot-load":
    case "general-slot-store":
    case "element-length":
    case "element-storage":
    case "element-count":
    // The nonallocating Latin-1 and ASCII primitives (bound foundation
    // functions): inline sequences with a private helper call, so a bound
    // body inlines into its callers like a typed-array access.
    case "string-ascii-prefix":
    case "bytes-ascii-prefix":
    case "string-copy-latin1":
    // And the nonallocating UTF-8 primitives.
    case "string-utf8-length":
    case "string-write-utf8":
    // The string-transfer primitives (#15's realm bindings).
    case "string-flat":
    case "string-flatten-into":
    // Strings' cached array indices (a load, and a store into the field).
    case "string-index-cached":
    case "string-index-cache":
      return true;
    case "general-null":
    case "general-equal":
      return allowGeneral;
    case "reference-none":
    case "reference-wrap":
    case "reference-value":
    case "string-reference":
    case "reference-string":
    case "record-read":
    case "record-new":
    case "reference-vector-new":
    // General values: wrapped results and uninitialized general sentinels.
    case "general-wrap":
    case "general-none":
    // A function value's own environment (a class constructor's state):
    // a pure read of an explicit operand, unlike closure-environment.
    case "function-environment":
    // Thrown errors (such as a class binding's TDZ ReferenceError) and
    // their messages are position-independent.
    case "string-literal":
    case "error-new":
    // A closure's environment is an explicit operand: it clones with the
    // callee (a factory such as makeCounter then exposes its closure to
    // devirtualization in the caller).
    case "function-new":
      return references;
    // An indirect call stays a call in the caller, as a direct one does.
    // Script calls (a JavaScript call header) stay out.
    case "call-indirect":
      return references && op.scriptArguments === undefined;
    // A direct call stays a call in the caller: an exception it throws
    // reaches the caller's handler, as it did through the callee.
    case "call":
      return op.environment === undefined;
    case "host-call":
      // Raw word access is a nonallocating, nonthrowing inline sequence.
      // Writes keep unknown effects (see instructionEffects), so later
      // passes still treat them as clobbering every heap and slot fact.
      return (
        op.operation === "memory-read-word" ||
        op.operation === "memory-write-word" ||
        op.operation === "memory-move" ||
        op.operation === "memory-compare-exchange-word" ||
        op.operation === "memory-fetch-add-word" ||
        op.operation === "memory-load-acquire-word" ||
        op.operation === "memory-store-release-word" ||
        op.operation === "memory-read-float64" ||
        op.operation === "memory-write-float64"
      );
    // A leaf C call never allocates, throws or re-enters managed code, so
    // its single-instruction bindings inline into callers: the call site
    // gets the direct `blr` without a managed wrapper or completion check.
    case "c-call":
    case "c-memory":
      return true;
    default:
      return false;
  }
}
/** Largest inlined expansion (instructions, terminators, parameter copies
 * and result slot). */
const maxExpansion = 128;
/** Single-instruction script cache / call-entry bindings (`boundBody`):
 * inlining replaces one call with one IR instruction, so they are exempt
 * from per-caller growth caps (especially the fixed `referenceAllowance`). */
function isScriptInlineIntrinsic(fn: FunctionIR): boolean {
  if (fn.blocks.length !== 1) return false;
  const block = fn.blocks[0];
  if (block === undefined || block.terminator.kind !== "return") return false;
  const count = block.instructions.length;
  if (count === 0) return false;
  for (let i = 0; i < count - 1; i++)
    if (block.instructions[i]?.kind !== "load") return false;
  const last = block.instructions[count - 1];
  if (last === undefined) return false;
  return (
    last.kind === "property-load" ||
    last.kind === "property-store" ||
    last.kind === "element-load" ||
    last.kind === "element-store" ||
    last.kind === "general-element-load" ||
    last.kind === "general-element-store" ||
    last.kind === "general-slot-load" ||
    last.kind === "general-slot-store" ||
    last.kind === "array-element" ||
    last.kind === "array-store" ||
    last.kind === "element-length" ||
    last.kind === "script-entry" ||
    last.kind === "global-cell" ||
    last.kind === "general-record-is"
  );
}
/** Fixed-arity JS object literal and constructor fast-path allocators
 * (`createLiteralObject1..4`, `createConstructedObject1..8`): recognized by
 * their IR shape (returns an object reference, takes at least one `general`
 * field value parameter, allocates one wide `OrdinaryObject` record with at
 * least 20 fields, and has at most one fallback `call`). Exempt from the small
 * `maxExpansion`/`referenceAllowance` caps so hot allocation sites expand
 * directly to bump-pointer allocation. */
function isScriptObjectAllocator(fn: FunctionIR, module: ModuleIR): boolean {
  if (fn.returnType !== "reference" && fn.returnType !== "optional-reference")
    return false;
  let hasGeneralParam = false;
  for (const param of fn.parameters) {
    if (param !== undefined && fn.slots[param] === "general") {
      hasGeneralParam = true;
      break;
    }
  }
  if (!hasGeneralParam) return false;
  const records = module.records;
  if (records === undefined) return false;
  let wideRecordNew = 0,
    otherRecordNew = 0,
    calls = 0;
  for (const block of fn.blocks) {
    if (block === undefined) return false;
    for (const op of block.instructions) {
      if (op === undefined) return false;
      if (op.kind === "record-new") {
        const fields = records[op.record]?.fields;
        if (fields !== undefined && fields.length >= 20) wideRecordNew++;
        else otherRecordNew++;
      } else if (op.kind === "call") {
        calls++;
      }
    }
  }
  return wideRecordNew === 1 && otherRecordNew === 0 && calls <= 1;
}
/** Most non-trap blocks of an inlined scalar or void callee. */
function maxCalleeBlocks(guarded: boolean): number {
  return guarded ? 32 : 24;
}
/** Why a direct call was not inlined (remarks only; mirrors the selection). */
function inlineRefusal(
  caller: FunctionIR,
  callee: FunctionIR | undefined,
  environment: boolean,
  eligibility: number,
  cost: number,
  allowance: number,
  referenceAllowance: number,
  effectful: boolean,
  nonallocatingCaller: boolean,
  separated: boolean,
): string {
  if (callee === undefined) return "unknown callee";
  if (callee.id === caller.id) return "recursive call";
  if (environment) return "call passes a closure environment";
  if (separated) return "caller and callee differ in interruptibility";
  if (eligibility === 0) {
    if (callee.import === true) return "callee is an import";
    if (
      callee.environment !== undefined ||
      callee.closureEnvironment !== undefined ||
      callee.receiverSlot !== undefined
    )
      return "callee uses an environment or receiver";
    if (shapeRecognized(callee) || outlinedSpecLoop(callee))
      return "callee is a shape-recognized helper";
    if (cost > maxExpansion)
      return (
        "callee cost " + String(cost) + " exceeds limit " + String(maxExpansion)
      );
    return "callee has an unsupported operation, slot type, exception handler, cell access or recursion";
  }
  if (cost > allowance)
    return (
      "cost " +
      String(cost) +
      " exceeds the caller's remaining growth allowance " +
      String(allowance)
    );
  if (shapeRecognized(caller) && effectful)
    return "shape-recognized caller keeps effectful callees out";
  if (eligibility === 2 && !nonallocatingCaller && shapeRecognized(caller))
    return "shape-recognized allocating caller";
  if (eligibility === 2 && cost > referenceAllowance)
    return (
      "reference-returning callee cost " +
      String(cost) +
      " exceeds the remaining reference allowance " +
      String(referenceAllowance)
    );
  return "not selected";
}
/** Inline bounded nonallocating direct-call CFGs. Straight-line parameters alias
 * caller values. CFG parameters use traced slots with ordinary slot liveness.
 * Block-local caller temporaries may not cross a CFG expansion. Locals may also
 * hold typed-array aliases; scalar and traced reference results use private slots.
 * Environments, calls, allocation, managed heap stores and callee
 * handlers are excluded. Caller exception edges survive cloning. Input is verified
 * IR and never mutated. Incremental mode keeps only completed nonallocating
 * callers, caps each expansion and retains original callees after exhaustion.
 * Remarks describe only decisions of callers whose result is kept.
 * `interruptible` marks the functions that poll for Worker stop requests (at
 * loop headers, and on entry when they call). Worker code never inlines into
 * runtime code, which would lose its polls, and runtime code inlines into
 * Worker code only when it has no loop: an inlined leaf brings no call and no
 * loop header, so it gains no poll either. */
export function inlineSmallFunctions(
  module: ModuleIR,
  budget: number,
  guarded: boolean = false,
  incremental: boolean = false,
  remarks?: RemarkSink,
  interruptible?: (fn: FunctionIR) => boolean,
): Inlining | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0)
    throw "INVALID_OPTIMIZATION_BUDGET";
  // Remarks wait for their caller's result to be kept.
  let pendingRemarks: OptimizationRemark[] = [];
  function flushRemarks(): void {
    const sink = remarks;
    if (sink === undefined) return;
    for (const remark of pendingRemarks) {
      if (remark === undefined) throw "inline remark invariant";
      sink(remark);
    }
    pendingRemarks = [];
  }
  // Interruptibility class by function ID (empty when every function shares one).
  const classify = interruptible;
  const classes = new Uint8Array(
    classify === undefined ? 0 : module.functions.length,
  );
  if (classify !== undefined)
    for (let id = 0; id < module.functions.length; id++) {
      const fn = module.functions[id];
      if (fn === undefined) throw "inline function invariant";
      classes[id] = classify(fn) ? 1 : 0;
    }
  // Loop-free runtime callees, computed on first use: 1 free, 2 loops.
  const loopFree = new Uint8Array(classes.length);
  /** Whether the callee must stay a call because the classes differ. */
  function separated(caller: FunctionIR, callee: number): boolean {
    if (classes.length === 0 || classes[caller.id] === classes[callee])
      return false;
    if (classes[caller.id] !== 1) return true;
    if (loopFree[callee] === 0) {
      const target = module.functions[callee];
      if (target === undefined) throw "inline callee invariant";
      const loops = naturalLoops(target, 100000);
      loopFree[callee] =
        loops !== undefined && loops.loops.length === 0 ? 1 : 2;
    }
    return loopFree[callee] !== 1;
  }
  const eligible = new Uint8Array(module.functions.length),
    // Callees that call or allocate (kept out of shape-recognized helpers).
    effectful = new Uint8Array(module.functions.length),
    directCallers = new Uint32Array(module.functions.length),
    intrinsic = new Uint8Array(module.functions.length),
    allocator = new Uint8Array(module.functions.length),
    costs: number[] = [];
  let hasScriptEntries = false;
  for (const fn of module.functions) {
    if (fn !== undefined && fn.scriptEntry === true) {
      hasScriptEntries = true;
      break;
    }
  }
  let visited = 0,
    inlined = 0,
    committed = 0;
  if (incremental && module.functions.length > budget)
    return { module, visited: budget, inlined: 0, budgetExhausted: true };
  const checkpoints = incremental ? module.functions.slice() : undefined;
  if (incremental) visited += module.functions.length;
  function exhausted(): Inlining | undefined {
    if (!incremental) return undefined;
    const completed = checkpoints;
    if (completed === undefined) throw "inline checkpoint invariant";
    // The unfinished caller's decisions are discarded with it.
    pendingRemarks = [];
    return {
      module: committed === 0 ? module : { ...module, functions: completed },
      visited,
      inlined: committed,
      budgetExhausted: true,
    };
  }
  for (const fn of module.functions) {
    if (fn === undefined) throw "inline function invariant";
    let good =
        fn.import !== true &&
        !shapeRecognized(fn) &&
        !outlinedSpecLoop(fn) &&
        fn.receiverSlot === undefined &&
        fn.environment === undefined &&
        fn.closureEnvironment === undefined &&
        (fn.returnType === "void" ||
          scalar(fn.returnType) ||
          fn.returnType === "reference" ||
          fn.returnType === "optional-reference" ||
          // A straight-line general result (such as a bound property
          // cache read) needs only the caller's general result slot.
          (fn.returnType === "general" && fn.blocks.length === 1)),
      // Charge actual expansion work: instructions, terminators, parameter
      // copies and the result slot. Empty jump/trap blocks do not need a
      // separate size heuristic that excludes otherwise small helpers.
      original =
        (fn.returnType === "void" || scalar(fn.returnType)) &&
        nonTrapBlocks(fn) <= maxCalleeBlocks(guarded),
      cost = 0,
      overhead = fn.parameters.length + (fn.returnType === "void" ? 0 : 1),
      returns = 0;
    if (incremental && !good) continue;
    const isAllocator =
      hasScriptEntries &&
      fn.scriptEntry !== true &&
      isScriptObjectAllocator(fn, module);
    const limit = isAllocator ? 256 : maxExpansion;
    for (let slot = 0; slot < fn.slots.length; slot++) {
      if (incremental) {
        if (visited >= budget) return exhausted();
        visited++;
        if (!good) break;
      }
      const type = fn.slots[slot];
      if (type === undefined) throw "inline slot invariant";
      // Multi-block callees copy parameters into traced slots in the caller,
      // and non-parameter traced locals always add caller slots: bound them
      // under referenceAllowance (eligibility 2) rather than unbounded scalar
      // expansion. Straight-line helpers alias parameters directly.
      if (
        !scalar(type) &&
        !isNativeTypedArray(type) &&
        (fn.blocks.length > 1 || !fn.parameters.includes(slot))
      )
        original = false;
      if (
        !scalar(type) &&
        type !== "reference" &&
        type !== "optional-reference" &&
        type !== "string" &&
        type !== "optional-string" &&
        type !== "general" &&
        !isNativeTypedArray(type) &&
        !fn.parameters.includes(slot)
      )
        good = false;
    }
    for (const block of fn.blocks) {
      if (block === undefined) throw "inline block invariant";
      if (incremental && !good) break;
      if (visited >= budget) return exhausted();
      visited++;
      overhead++;
      if (block.exception !== undefined) good = false;
      const term = block.terminator;
      if (term.kind === "return") returns++;
      // Checked record reads and writes, and record cells (whose
      // environment object is an explicit operand), clone with their slots;
      // frame cells keep their owner's environment and stay out.
      if (term.kind === "record" || term.kind === "record-cell")
        original = false;
      if (term.kind === "cell") good = false;
      for (const op of block.instructions) {
        if (op === undefined) throw "inline instruction invariant";
        if (visited >= budget) return exhausted();
        visited++;
        cost++;
        if (
          op.kind === "call" ||
          op.kind === "record-new" ||
          op.kind === "reference-vector-new"
        )
          effectful[fn.id] = 1;
        if (op.kind === "call" && op.target !== fn.id)
          directCallers[op.target] = (directCallers[op.target] ?? 0) + 1;
        // Recursive callees keep their calls (each round would unroll one
        // more level).
        if (op.kind === "call" && op.target === fn.id) good = false;
        if (
          !supported(op, false, false) ||
          (op.kind === "store" && fn.parameters.includes(op.slot))
        )
          original = false;
        if (
          !supported(op, true, isAllocator) ||
          (op.kind === "store" &&
            fn.blocks.length === 1 &&
            fn.parameters.includes(op.slot))
        )
          good = false;
        if (
          incremental &&
          (!good || cost > limit || (!original && cost + overhead > limit))
        ) {
          good = false;
          break;
        }
      }
    }
    const expansion = original ? cost : cost + overhead;
    eligible[fn.id] =
      good && expansion <= limit && returns > 0 ? (original ? 1 : 2) : 0;
    if (eligible[fn.id] !== 0) {
      if (isAllocator) allocator[fn.id] = 1;
      else if (isScriptInlineIntrinsic(fn)) intrinsic[fn.id] = 1;
    }
    costs[fn.id] = expansion;
  }
  const functions: FunctionIR[] = [];
  for (const fn of module.functions) {
    if (fn === undefined) throw "inline function invariant";
    let nextValue = 0,
      nextBlock = 0,
      originalCount = 0,
      nonallocatingCaller = true,
      hasCandidate = false;
    for (const block of fn.blocks) {
      if (block === undefined) throw "inline block invariant";
      if (incremental && !nonallocatingCaller) break;
      if (incremental) {
        if (visited >= budget) return exhausted();
        visited++;
      }
      nextBlock = Math.max(nextBlock, block.id + 1);
      const term = block.terminator;
      if (
        (term.kind === "record" && term.operation !== "read") ||
        term.kind === "record-cell" ||
        term.kind === "cell"
      )
        nonallocatingCaller = false;
      for (const op of block.instructions) {
        if (op === undefined) throw "inline instruction invariant";
        if (incremental) {
          if (visited >= budget) return exhausted();
          visited++;
        }
        const id = instructionResult(op);
        if (id !== undefined) nextValue = Math.max(nextValue, id + 1);
        originalCount++;
        if (
          op.kind === "call"
            ? !eligible[op.target] ||
              op.environment !== undefined ||
              separated(fn, op.target)
            : incremental
              ? (instructionEffects(op) & effectAllocate) !== 0
              : !supported(op)
        )
          nonallocatingCaller = false;
        if (incremental && (!nonallocatingCaller || originalCount > 50000)) {
          nonallocatingCaller = false;
          break;
        }
        if (
          op.kind === "call" &&
          eligible[op.target] &&
          op.target !== fn.id &&
          op.environment === undefined &&
          !separated(fn, op.target)
        )
          hasCandidate = true;
      }
    }
    if (!hasCandidate || (incremental && !nonallocatingCaller)) {
      functions.push(fn);
      continue;
    }
    // referenceAllowance: total cost of CFG callees with traced reference
    // slots (eligibility 2) one caller absorbs. Collection accessors (a
    // number list's read, push and resize cost 35-58 each) are this kind, so
    // a loop over several lists needs room for a handful of them.
    // A callee already eligible for inlining with internal callers stays within
    // maxExpansion, so inlining a cold slow path (such as writeNumberList into
    // pushNumberList) does not disqualify the wrapper from later rounds.
    const selfCost = costs[fn.id] ?? 0,
      keepInlineable =
        !incremental &&
        eligible[fn.id] !== 0 &&
        (directCallers[fn.id] ?? 0) > 0;
    let allowance = incremental
        ? 128
        : keepInlineable
          ? Math.min(originalCount + 128, Math.max(0, maxExpansion - selfCost))
          : originalCount + 128,
      referenceAllowance = 384,
      allocatorInlines = 0,
      changed = false;
    const slots: ScalarType[] = fn.slots.slice(),
      blocks: Block[] = [],
      originalValues = nextValue;
    const callerDebug = fn.debug,
      debugSites: InlineSite[] | undefined =
        callerDebug === undefined ? undefined : callerDebug.inlineSites.slice(),
      debugVariables: SourceVariable[] | undefined =
        callerDebug === undefined ? undefined : callerDebug.variables.slice(),
      debugSlots: SlotBinding[] | undefined =
        callerDebug === undefined ? undefined : callerDebug.slots.slice(),
      debugValues: ValueBinding[] | undefined =
        callerDebug === undefined ? undefined : callerDebug.values.slice();
    for (const block of fn.blocks) {
      if (block === undefined) throw "inline block invariant";
      let current = block.id,
        instructions: Instruction[] = [],
        // Values rematerialized after a CFG expansion (replacement ID + 1).
        remap: Uint32Array | undefined;
      const positions = new Map<number, number>();
      let mappedPositions = false;
      for (let position = 0; position < block.instructions.length; position++) {
        const original = block.instructions[position];
        if (original === undefined) throw "inline instruction invariant";
        const op =
          remap === undefined
            ? original
            : substituteInstructionValues(original, remap);
        if (visited >= budget) return exhausted();
        visited++;
        const callee =
            op.kind === "call" ? module.functions[op.target] : undefined,
          cost = callee === undefined ? 0 : (costs[callee.id] ?? 0),
          isAllocatorCallee =
            callee !== undefined && allocator[callee.id] === 1,
          allowAllocator =
            isAllocatorCallee &&
            fn.scriptEntry === true &&
            fn.blocks.length <= 8000 &&
            allocatorInlines < 48,
          isIntrinsic =
            (callee !== undefined && intrinsic[callee.id] === 1) ||
            allowAllocator;
        if (
          op.kind !== "call" ||
          callee === undefined ||
          !eligible[callee.id] ||
          (isAllocatorCallee && !allowAllocator) ||
          callee.id === fn.id ||
          op.environment !== undefined ||
          separated(fn, callee.id) ||
          (!isIntrinsic && cost > allowance) ||
          (shapeRecognized(fn) && effectful[callee.id] === 1) ||
          (eligible[callee.id] === 2 &&
            ((!nonallocatingCaller && shapeRecognized(fn)) ||
              (!isIntrinsic && cost > referenceAllowance)))
        ) {
          if (remarks !== undefined && op.kind === "call")
            pendingRemarks.push({
              pass: "inline-small-functions",
              outcome: "missed",
              function: fn.name,
              start: op.start,
              end: op.end,
              message:
                "not inlined " +
                (callee === undefined ? "#" + op.target : callee.name) +
                ": " +
                inlineRefusal(
                  fn,
                  callee,
                  op.environment !== undefined,
                  eligible[op.target] ?? 0,
                  cost,
                  allowance,
                  referenceAllowance,
                  effectful[op.target] === 1,
                  nonallocatingCaller,
                  separated(fn, op.target),
                ),
            });
          instructions.push(op);
          continue;
        }
        const straight = callee.blocks.length === 1;
        let pendingCrossing: number[] = [];
        const spillTypes = new Map<number, ScalarType>(),
          spillSlots = new Map<number, number>();
        if (!straight) {
          if (!mappedPositions) {
            mappedPositions = true;
            for (let i = 0; i < block.instructions.length; i++) {
              if (visited >= budget) return exhausted();
              visited++;
              const instruction = block.instructions[i];
              if (instruction === undefined)
                throw "inline instruction invariant";
              const id = instructionResult(instruction);
              if (id !== undefined) positions.set(id, i);
            }
          }
          // Caller values defined before the call and used after it would
          // cross into the continuation block. Constants and loads of a slot
          // not stored since are rematerialized there; anything else keeps
          // the call.
          const definitions = positions,
            crossing: number[] = [],
            seen = new Set<number>(),
            // Objects of later direct record reads: their layout proofs
            // (unique-predecessor chains) cannot pass the expansion's joins.
            readObjects = new Set<number>();
          const check = (id: number): void => {
            if ((definitions.get(id) ?? position) < position && !seen.has(id)) {
              seen.add(id);
              crossing.push(id);
            }
          };
          for (let i = position + 1; i < block.instructions.length; i++) {
            if (visited >= budget) return exhausted();
            visited++;
            const later = block.instructions[i];
            if (later === undefined) throw "inline instruction invariant";
            visitInstructionOperands(later, check);
            if (later.kind === "record-read") readObjects.add(later.object);
          }
          visitTerminatorOperands(block.terminator, check);
          let rematerializable = true,
            blocking = "";
          for (const id of crossing) {
            if (id === undefined) throw "inline crossing invariant";
            const defined = definitions.get(id),
              definition =
                defined === undefined ? undefined : block.instructions[defined];
            if (defined === undefined || definition === undefined) {
              rematerializable = false;
              break;
            }
            if (definition.kind === "constant") continue;
            if (definition.kind === "load") {
              // A load is repeated in the continuation unless its slot is
              // stored before the call; then it crosses like other values.
              let restored = false;
              for (let i = defined + 1; i < position && !restored; i++) {
                if (visited >= budget) return exhausted();
                visited++;
                const between = block.instructions[i];
                if (between === undefined) throw "inline instruction invariant";
                restored =
                  between.kind === "store" && between.slot === definition.slot;
              }
              if (!restored) continue;
            }
            // Other values cross through a fresh slot: stored before the
            // expansion and reloaded in the continuation.
            const type = readObjects.has(id)
              ? undefined
              : definition.kind === "load"
                ? fn.slots[definition.slot]
                : crossingType(definition, module);
            if (type === undefined) {
              rematerializable = false;
              blocking = readObjects.has(id)
                ? definition.kind + " read after the call"
                : definition.kind;
              break;
            }
            spillTypes.set(id, type);
          }
          if (!rematerializable) {
            if (remarks !== undefined)
              pendingRemarks.push({
                pass: "inline-small-functions",
                outcome: "missed",
                function: fn.name,
                start: op.start,
                end: op.end,
                message:
                  "not inlined " +
                  callee.name +
                  ": a caller value live across the call cannot cross the expanded control flow" +
                  (blocking === "" ? "" : " (" + blocking + ")"),
              });
            instructions.push(op);
            continue;
          }
          pendingCrossing = crossing;
        }
        // Debug builds keep the callee's own spans and record the call as an
        // inline site (after it, the callee's sites); otherwise copied code
        // takes the call's span.
        const site = debugSites === undefined ? -1 : debugSites.length,
          siteBase = site + 1;
        if (debugSites !== undefined) {
          const parent = op.inline;
          debugSites.push(
            parent === undefined
              ? { callee: callee.name, start: op.start, end: op.end }
              : { callee: callee.name, start: op.start, end: op.end, parent },
          );
          for (const inner of callee.debug?.inlineSites ?? []) {
            if (inner === undefined) throw "inline debug site invariant";
            const enclosing = inner.parent;
            debugSites.push({
              callee: inner.callee,
              start: inner.start,
              end: inner.end,
              parent: enclosing === undefined ? site : siteBase + enclosing,
            });
          }
        }
        // Caller code at the call stays in the call's own inline site.
        const callInline = debugSites === undefined ? undefined : op.inline;
        function placed(source: Span & DebugOrigin): Span & DebugOrigin {
          if (site < 0)
            return { start: op.start, end: op.end, inline: undefined };
          const inner = source.inline;
          return {
            start: source.start,
            end: source.end,
            inline: inner === undefined ? site : siteBase + inner,
          };
        }
        const valueMap: number[] = [],
          slotMap: number[] = [],
          blockMap: number[] = [];
        for (let slot = 0; slot < callee.slots.length; slot++) {
          if (straight && callee.parameters.includes(slot)) continue;
          const type = callee.slots[slot];
          if (type === undefined) throw "inline slot invariant";
          slotMap[slot] = slots.length;
          slots.push(type);
        }
        // Callee variables join the caller's in this inline site; their
        // slot bindings follow the copied slots.
        const variableBase =
          debugVariables === undefined ? 0 : debugVariables.length;
        if (debugVariables !== undefined && debugSlots !== undefined) {
          const calleeDebug = callee.debug;
          if (calleeDebug !== undefined) {
            for (const variable of calleeDebug.variables) {
              if (variable === undefined)
                throw "inline debug variable invariant";
              const inner = variable.inline;
              debugVariables.push({
                ...variable,
                inline: inner === undefined ? site : siteBase + inner,
              });
            }
            for (const binding of calleeDebug.slots) {
              if (binding === undefined) throw "inline debug slot invariant";
              const mapped = slotMap[binding.slot];
              if (mapped !== undefined)
                debugSlots.push({
                  slot: mapped,
                  variable: variableBase + binding.variable,
                });
            }
          }
        }
        let resultSlot = -1;
        if (op.id !== undefined) {
          if (callee.returnType === "void") throw "inline result invariant";
          resultSlot = slots.length;
          slots.push(callee.returnType);
        }
        const continuation = straight ? current : nextBlock++;
        for (const source of callee.blocks) {
          if (source === undefined) throw "inline block invariant";
          blockMap[source.id] = straight ? current : nextBlock++;
          for (const instruction of source.instructions) {
            if (instruction === undefined) throw "inline instruction invariant";
            const id = instructionResult(instruction);
            if (id === undefined) continue;
            const parameter =
              instruction.kind === "load"
                ? callee.parameters.indexOf(instruction.slot)
                : -1;
            if (straight && parameter >= 0) {
              const argument = op.arguments[parameter];
              if (argument === undefined) throw "inline argument invariant";
              valueMap[id] = argument;
            } else valueMap[id] = nextValue++;
          }
        }
        if (nextValue > 0xffffffff || nextBlock > 0xffffffff)
          return exhausted();
        // Callee value bindings follow the copied values. Straight-line
        // parameters are the argument values throughout the inlined body.
        const calleeDebug = callee.debug;
        if (debugValues !== undefined && calleeDebug !== undefined) {
          // Removed parameter loads stand for arguments defined earlier;
          // bindings anchored there start at their value instead.
          const parameterLoads = new Set<number>();
          if (straight)
            for (const source of callee.blocks) {
              if (source === undefined) throw "inline block invariant";
              for (const instruction of source.instructions)
                if (
                  instruction !== undefined &&
                  instruction.kind === "load" &&
                  callee.parameters.includes(instruction.slot)
                )
                  parameterLoads.add(instruction.id);
            }
          for (const binding of calleeDebug.values) {
            if (binding === undefined) throw "inline debug value invariant";
            const value = valueMap[binding.value],
              anchor =
                binding.after < 0 || parameterLoads.has(binding.after)
                  ? -1
                  : valueMap[binding.after];
            if (value !== undefined && anchor !== undefined)
              debugValues.push({
                variable: variableBase + binding.variable,
                value,
                after: anchor,
              });
          }
          if (straight)
            for (const binding of calleeDebug.slots) {
              if (binding === undefined) throw "inline debug slot invariant";
              const index = callee.parameters.indexOf(binding.slot),
                argument = index < 0 ? undefined : op.arguments[index];
              if (argument !== undefined)
                debugValues.push({
                  variable: variableBase + binding.variable,
                  value: argument,
                  after: -1,
                });
            }
        }
        function value(id: number): number {
          const mapped = valueMap[id];
          if (mapped === undefined) throw "inline value invariant";
          return mapped;
        }
        function slot(id: number): number {
          const mapped = slotMap[id];
          if (mapped === undefined) throw "inline slot invariant";
          return mapped;
        }
        function target(id: number): number {
          const mapped = blockMap[id];
          if (mapped === undefined) throw "inline block invariant";
          return mapped;
        }
        if (!straight) {
          for (const [id, type] of spillTypes) {
            const spill = slots.length;
            slots.push(type);
            spillSlots.set(id, spill);
            // An earlier expansion in this block may have renamed the value.
            const renamed = remap === undefined ? 0 : (remap[id] ?? 0);
            instructions.push({
              kind: "store",
              slot: spill,
              value: renamed === 0 ? id : renamed - 1,
              start: op.start,
              end: op.end,
              inline: callInline,
            });
          }
          for (let i = 0; i < callee.parameters.length; i++) {
            const parameter = callee.parameters[i],
              argument = op.arguments[i];
            if (parameter === undefined || argument === undefined)
              throw "inline argument invariant";
            instructions.push({
              kind: "store",
              slot: slot(parameter),
              value: argument,
              start: op.start,
              end: op.end,
              inline: callInline,
            });
          }
          blocks[current] = {
            ...block,
            id: current,
            instructions,
            terminator: {
              kind: "jump",
              target: target(callee.entry),
              start: op.start,
              end: op.end,
              inline: callInline,
            },
          };
        }
        for (const source of callee.blocks) {
          if (source === undefined) throw "inline block invariant";
          const cloned: Instruction[] = [];
          for (const instruction of source.instructions) {
            if (instruction === undefined) throw "inline instruction invariant";
            if (visited >= budget) return exhausted();
            visited++;
            const at = placed(instruction);
            if (
              straight &&
              instruction.kind === "load" &&
              callee.parameters.includes(instruction.slot)
            )
              continue;
            switch (instruction.kind) {
              case "constant":
              case "undefined":
              case "boolean-none":
              case "reference-none":
              case "general-none":
              case "general-null":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "load":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  slot: slot(instruction.slot),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "store":
                cloned.push({
                  ...instruction,
                  slot: slot(instruction.slot),
                  value: value(instruction.value),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "unary":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  operand: value(instruction.operand),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "binary":
              case "general-equal":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  left: value(instruction.left),
                  right: value(instruction.right),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "optional-value-or":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  value: value(instruction.value),
                  fallback: value(instruction.fallback),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "function-environment":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  callee: value(instruction.callee),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "string-literal":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "error-new":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  message: value(instruction.message),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "optional-wrap":
              case "optional-present":
              case "optional-value":
              case "boolean-wrap":
              case "boolean-present":
              case "boolean-value":
              case "reference-wrap":
              case "reference-value":
              case "string-reference":
              case "reference-string":
              case "general-is":
              case "general-record-is":
              case "general-value":
              case "general-wrap":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  value: value(instruction.value),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "array-length":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  array: value(instruction.array),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "array-read":
              case "array-element":
              case "array-valid":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  array: value(instruction.array),
                  index: value(instruction.index),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "record-slot-read":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  object: value(instruction.object),
                  index: value(instruction.index),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "property-load":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  object: value(instruction.object),
                  site: value(instruction.site),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "property-store":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  object: value(instruction.object),
                  value: value(instruction.value),
                  site: value(instruction.site),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "script-entry":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  callee: value(instruction.callee),
                  realm: value(instruction.realm),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "global-cell":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  scope: value(instruction.scope),
                  cache: value(instruction.cache),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "element-load": {
                const cachedStorage = instruction.cachedStorage,
                  cachedCount = instruction.cachedCount;
                cloned.push(
                  cachedStorage !== undefined && cachedCount !== undefined
                    ? {
                        ...instruction,
                        id: value(instruction.id),
                        object: value(instruction.object),
                        index: value(instruction.index),
                        cachedStorage: value(cachedStorage),
                        cachedCount: value(cachedCount),
                        start: at.start,
                        end: at.end,
                        inline: at.inline,
                      }
                    : {
                        ...instruction,
                        id: value(instruction.id),
                        object: value(instruction.object),
                        index: value(instruction.index),
                        start: at.start,
                        end: at.end,
                        inline: at.inline,
                      },
                );
                break;
              }
              case "element-store": {
                const cachedStorage = instruction.cachedStorage,
                  cachedCount = instruction.cachedCount;
                cloned.push(
                  cachedStorage !== undefined && cachedCount !== undefined
                    ? {
                        ...instruction,
                        id: value(instruction.id),
                        object: value(instruction.object),
                        index: value(instruction.index),
                        value: value(instruction.value),
                        cachedStorage: value(cachedStorage),
                        cachedCount: value(cachedCount),
                        start: at.start,
                        end: at.end,
                        inline: at.inline,
                      }
                    : {
                        ...instruction,
                        id: value(instruction.id),
                        object: value(instruction.object),
                        index: value(instruction.index),
                        value: value(instruction.value),
                        start: at.start,
                        end: at.end,
                        inline: at.inline,
                      },
                );
                break;
              }
              case "element-length":
              case "element-storage":
              case "element-count":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  object: value(instruction.object),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "general-element-load":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  object: value(instruction.object),
                  index: value(instruction.index),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "general-element-store":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  object: value(instruction.object),
                  index: value(instruction.index),
                  value: value(instruction.value),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "general-slot-load":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  tags: value(instruction.tags),
                  refs: value(instruction.refs),
                  numbers: value(instruction.numbers),
                  index: value(instruction.index),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "general-slot-store":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  tags: value(instruction.tags),
                  refs: value(instruction.refs),
                  numbers: value(instruction.numbers),
                  index: value(instruction.index),
                  value: value(instruction.value),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "record-read":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  object: value(instruction.object),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "string-flat":
              case "string-index-cached":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  string: value(instruction.string),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "string-index-cache":
                cloned.push({
                  ...instruction,
                  string: value(instruction.string),
                  value: value(instruction.value),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "string-flatten-into":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  address: value(instruction.address),
                  byteLength: value(instruction.byteLength),
                  string: value(instruction.string),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "string-ascii-prefix":
              case "string-utf8-length":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  string: value(instruction.string),
                  begin: value(instruction.begin),
                  limit: value(instruction.limit),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "bytes-ascii-prefix":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  bytes: value(instruction.bytes),
                  begin: value(instruction.begin),
                  limit: value(instruction.limit),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "string-copy-latin1":
              case "string-write-utf8":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  string: value(instruction.string),
                  begin: value(instruction.begin),
                  limit: value(instruction.limit),
                  bytes: value(instruction.bytes),
                  offset: value(instruction.offset),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "host-call":
                cloned.push({
                  ...instruction,
                  id:
                    instruction.id === undefined
                      ? undefined
                      : value(instruction.id),
                  arguments: instruction.arguments.map(value),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "c-call":
              case "c-memory":
                cloned.push({
                  ...instruction,
                  id:
                    instruction.id === undefined
                      ? undefined
                      : value(instruction.id),
                  arguments: instruction.arguments.map(value),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "array-write":
                cloned.push({
                  ...instruction,
                  array: value(instruction.array),
                  index: value(instruction.index),
                  value: value(instruction.value),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "array-fill":
                cloned.push({
                  ...instruction,
                  array: value(instruction.array),
                  value: value(instruction.value),
                  from: value(instruction.from),
                  to: value(instruction.to),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "array-store":
                cloned.push({
                  ...instruction,
                  array: value(instruction.array),
                  index: value(instruction.index),
                  value: value(instruction.value),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "array-atomic":
                cloned.push({
                  ...instruction,
                  id:
                    instruction.id === undefined
                      ? undefined
                      : value(instruction.id),
                  array: value(instruction.array),
                  index: value(instruction.index),
                  operands: instruction.operands.map(value),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "array-word64-read":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  array: value(instruction.array),
                  index: value(instruction.index),
                  scratch: value(instruction.scratch),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "array-word64-write":
              case "array-atomic-word64":
                cloned.push({
                  ...instruction,
                  array: value(instruction.array),
                  index: value(instruction.index),
                  scratch: value(instruction.scratch),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "array-word64-fill":
                cloned.push({
                  ...instruction,
                  array: value(instruction.array),
                  scratch: value(instruction.scratch),
                  from: value(instruction.from),
                  to: value(instruction.to),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "call":
                cloned.push({
                  ...instruction,
                  id:
                    instruction.id === undefined
                      ? undefined
                      : value(instruction.id),
                  ...(instruction.receiver === undefined
                    ? {}
                    : { receiver: value(instruction.receiver) }),
                  arguments: instruction.arguments.map(value),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "call-indirect":
                cloned.push({
                  ...instruction,
                  id:
                    instruction.id === undefined
                      ? undefined
                      : value(instruction.id),
                  callee: value(instruction.callee),
                  ...(instruction.receiver === undefined
                    ? {}
                    : { receiver: value(instruction.receiver) }),
                  arguments: instruction.arguments.map(value),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "function-new":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  ...(instruction.environment === undefined
                    ? {}
                    : { environment: value(instruction.environment) }),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "record-new":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  arguments: instruction.arguments.map((argument) =>
                    argument === undefined ? undefined : value(argument),
                  ),
                  ...(instruction.presence === undefined
                    ? {}
                    : {
                        presence: instruction.presence.map((flag) =>
                          flag === undefined ? undefined : value(flag),
                        ),
                      }),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              case "reference-vector-new":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  length: value(instruction.length),
                  start: at.start,
                  end: at.end,
                  inline: at.inline,
                });
                break;
              default:
                throw "inline candidate invariant";
            }
          }
          const term = source.terminator,
            termAt = placed(term);
          let terminator: Terminator;
          if (term.kind === "return") {
            if (resultSlot >= 0) {
              if (term.value === undefined) throw "inline return invariant";
              cloned.push({
                kind: "store",
                slot: resultSlot,
                value: value(term.value),
                start: termAt.start,
                end: termAt.end,
                inline: termAt.inline,
              });
            }
            terminator = {
              kind: "jump",
              target: continuation,
              start: termAt.start,
              end: termAt.end,
              inline: termAt.inline,
            };
          } else if (term.kind === "branch")
            terminator = {
              ...term,
              condition: value(term.condition),
              consequent: target(term.consequent),
              alternate: target(term.alternate),
              start: termAt.start,
              end: termAt.end,
              inline: termAt.inline,
            };
          else if (term.kind === "record")
            terminator = {
              ...term,
              object: value(term.object),
              slot: slot(term.slot),
              consequent: target(term.consequent),
              alternate: target(term.alternate),
              start: termAt.start,
              end: termAt.end,
              inline: termAt.inline,
            };
          else if (term.kind === "record-cell")
            terminator = {
              ...term,
              object: value(term.object),
              slot: slot(term.slot),
              consequent: target(term.consequent),
              alternate: target(term.alternate),
              start: termAt.start,
              end: termAt.end,
              inline: termAt.inline,
            };
          else if (term.kind === "jump")
            terminator = {
              ...term,
              target: target(term.target),
              start: termAt.start,
              end: termAt.end,
              inline: termAt.inline,
            };
          else if (term.kind === "throw")
            terminator = {
              ...term,
              value: value(term.value),
              start: termAt.start,
              end: termAt.end,
              inline: termAt.inline,
            };
          else if (term.kind === "throw-literal" || term.kind === "trap")
            terminator = {
              ...term,
              start: termAt.start,
              end: termAt.end,
              inline: termAt.inline,
            };
          else throw "inline terminator invariant";
          if (straight) {
            for (const instruction of cloned) {
              if (instruction === undefined) throw "inline clone invariant";
              instructions.push(instruction);
            }
          } else
            blocks[target(source.id)] = {
              ...block,
              id: target(source.id),
              instructions: cloned,
              terminator,
            };
        }
        current = continuation;
        if (!straight) {
          instructions = [];
          for (const id of pendingCrossing) {
            if (id === undefined) throw "inline crossing invariant";
            const defined = positions.get(id),
              definition =
                defined === undefined ? undefined : block.instructions[defined];
            const replacement = nextValue++,
              spill = spillSlots.get(id);
            if (spill !== undefined)
              instructions.push({
                kind: "load",
                id: replacement,
                slot: spill,
                start: op.start,
                end: op.end,
                inline: callInline,
              });
            else if (
              definition === undefined ||
              (definition.kind !== "load" && definition.kind !== "constant")
            )
              throw "inline rematerialization invariant";
            else instructions.push({ ...definition, id: replacement });
            if (remap === undefined) remap = new Uint32Array(originalValues);
            remap[id] = replacement + 1;
          }
          pendingCrossing = [];
        }
        if (op.id !== undefined)
          instructions.push({
            kind: "load",
            id: op.id,
            slot: resultSlot,
            start: op.start,
            end: op.end,
            inline: callInline,
          });
        if (allowAllocator) allocatorInlines++;
        if (!isIntrinsic) {
          allowance -= cost;
          if (eligible[callee.id] === 2) referenceAllowance -= cost;
        }
        inlined++;
        changed = true;
        if (remarks !== undefined)
          pendingRemarks.push({
            pass: "inline-small-functions",
            outcome: "applied",
            function: fn.name,
            start: op.start,
            end: op.end,
            message:
              "inlined " +
              callee.name +
              " (cost " +
              String(cost) +
              (straight
                ? ", straight-line"
                : ", " + String(callee.blocks.length) + " blocks") +
              ")",
          });
      }
      blocks[current] = {
        ...block,
        id: current,
        instructions,
        terminator:
          remap === undefined
            ? block.terminator
            : substituteTerminatorValues(block.terminator, remap),
      };
    }
    const completed: FunctionIR = changed
      ? {
          ...fn,
          slots,
          blocks,
          ...(debugSites === undefined ||
          debugVariables === undefined ||
          debugSlots === undefined ||
          debugValues === undefined
            ? {}
            : {
                debug: {
                  variables: debugVariables,
                  slots: debugSlots,
                  values: debugValues,
                  inlineSites: debugSites,
                },
              }),
        }
      : fn;
    functions.push(completed);
    if (checkpoints !== undefined) checkpoints[fn.id] = completed;
    committed = inlined;
    if (incremental) flushRemarks();
  }
  flushRemarks();
  return {
    module: inlined === 0 ? module : { ...module, functions },
    visited,
    inlined,
  };
}
