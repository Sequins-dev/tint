import {
  instructionResult,
  visitInstructionOperands,
  visitTerminatorOperands,
  substituteInstructionValues,
  substituteTerminatorValues,
  instructionEffects,
  effectAllocate,
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
    case "call": {
      const type = module.functions[op.target]?.returnType;
      return type === undefined || type === "void" ? undefined : type;
    }
    case "reference-value":
      return "reference";
    case "reference-wrap":
    case "reference-none":
    case "string-reference":
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
            ["+", "-", "~", "ceil", "trunc", "sqrt"].includes(op.operator)
          ? "number"
          : undefined;
    case "binary":
      return ["===", "!==", "==", "!=", "<", ">", "<=", ">="].includes(
        op.operator,
      )
        ? "boolean"
        : "number";
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
function supported(op: Instruction, references: boolean = true): boolean {
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
    case "reference-none":
    case "reference-wrap":
    case "reference-value":
    case "string-reference":
    case "reference-string":
    case "record-read":
    case "record-new":
    case "reference-vector-new":
      return references;
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
        op.operation === "memory-compare-exchange-word" ||
        op.operation === "memory-fetch-add-word" ||
        op.operation === "memory-load-acquire-word" ||
        op.operation === "memory-store-release-word"
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
): string {
  if (callee === undefined) return "unknown callee";
  if (callee.id === caller.id) return "recursive call";
  if (environment) return "call passes a closure environment";
  if (eligibility === 0) {
    if (callee.import === true) return "callee is an import";
    if (
      callee.environment !== undefined ||
      callee.closureEnvironment !== undefined ||
      callee.receiverSlot !== undefined
    )
      return "callee uses an environment or receiver";
    if (shapeRecognized(callee)) return "callee is a shape-recognized helper";
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
 * Remarks describe only decisions of callers whose result is kept. */
export function inlineSmallFunctions(
  module: ModuleIR,
  budget: number,
  guarded: boolean = false,
  incremental: boolean = false,
  remarks?: RemarkSink,
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
  const eligible = new Uint8Array(module.functions.length),
    // Callees that call or allocate (kept out of shape-recognized helpers).
    effectful = new Uint8Array(module.functions.length),
    costs: number[] = [];
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
        fn.receiverSlot === undefined &&
        fn.environment === undefined &&
        fn.closureEnvironment === undefined &&
        (fn.returnType === "void" ||
          scalar(fn.returnType) ||
          fn.returnType === "reference" ||
          fn.returnType === "optional-reference"),
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
    for (let slot = 0; slot < fn.slots.length; slot++) {
      if (incremental) {
        if (visited >= budget) return exhausted();
        visited++;
        if (!good) break;
      }
      const type = fn.slots[slot];
      if (type === undefined) throw "inline slot invariant";
      if (
        !scalar(type) &&
        type !== "reference" &&
        type !== "optional-reference" &&
        type !== "string" &&
        type !== "optional-string" &&
        type !== "Uint8Array" &&
        type !== "Uint16Array" &&
        type !== "Uint32Array" &&
        type !== "Float64Array" &&
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
      // Checked record reads and writes clone with their slots; cells keep
      // their owner's environment and stay out.
      if (term.kind === "record-cell" || term.kind === "cell") good = false;
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
        // Recursive callees keep their calls (each round would unroll one
        // more level).
        if (op.kind === "call" && op.target === fn.id) good = false;
        if (
          !supported(op, false) ||
          (op.kind === "store" && fn.parameters.includes(op.slot))
        )
          original = false;
        if (
          !supported(op) ||
          (op.kind === "store" &&
            fn.blocks.length === 1 &&
            fn.parameters.includes(op.slot))
        )
          good = false;
        if (
          incremental &&
          (!good ||
            cost > maxExpansion ||
            (!original && cost + overhead > maxExpansion))
        ) {
          good = false;
          break;
        }
      }
    }
    const expansion = original ? cost : cost + overhead;
    eligible[fn.id] =
      good && expansion <= maxExpansion && returns > 0 ? (original ? 1 : 2) : 0;
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
            ? !eligible[op.target] || op.environment !== undefined
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
          op.environment === undefined
        )
          hasCandidate = true;
      }
    }
    if (!hasCandidate || (incremental && !nonallocatingCaller)) {
      functions.push(fn);
      continue;
    }
    let allowance = incremental ? 128 : originalCount + 128,
      referenceAllowance = 128,
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
          cost = callee === undefined ? 0 : (costs[callee.id] ?? 0);
        if (
          op.kind !== "call" ||
          callee === undefined ||
          !eligible[callee.id] ||
          callee.id === fn.id ||
          op.environment !== undefined ||
          cost > allowance ||
          (shapeRecognized(fn) && effectful[callee.id] === 1) ||
          (eligible[callee.id] === 2 &&
            ((!nonallocatingCaller && shapeRecognized(fn)) ||
              cost > referenceAllowance))
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
        allowance -= cost;
        if (eligible[callee.id] === 2) referenceAllowance -= cost;
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
