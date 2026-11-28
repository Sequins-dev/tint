import {
  instructionResult,
  retainDebugValues,
  visitInstructionOperands,
  visitTerminatorOperands,
  type Block,
  type FunctionIR,
  type Instruction,
  type ModuleIR,
  type ScalarType,
} from "../scalar/index.ts";
import { compactReachableBlocks } from "./control-flow.ts";
import type { RemarkSink } from "./observer.ts";

/** Closures at or above this block count whose body is moved to a `$direct`
 * twin become one-block forwarding thunks, avoiding duplicating large bodies
 * across all subsequent optimization, verification, and emission passes.
 * Tiny closures keep their direct body so escaping callbacks incur no thunk. */
const thunkBlockThreshold = 16;

export interface ClosureDevirtualization {
  readonly module: ModuleIR;
  readonly visited: number;
  /** Indirect calls rewritten to direct calls. */
  readonly rewritten: number;
}

/** The known closure a callee value holds: the function it was created from. */
interface KnownClosure {
  readonly target: number;
  readonly environment: boolean;
}

/** A function's slots every write of which stores a closure of one target;
 * slots with any other write (or an entry value) are in `unknown`. */
interface SlotFacts {
  readonly targets: Map<number, KnownClosure>;
  readonly unknown: Set<number>;
  /** Whether the function makes indirect calls. */
  readonly candidates: boolean;
}

/** Rewrites indirect calls whose callee provably holds a closure created by
 * `function-new F` in the same function (directly, or through a slot every
 * write of which stores such a closure) into direct calls. A closure with a
 * managed environment is called through a direct twin of `F` that receives
 * its environment as a trailing parameter (`closure-environment` becomes a
 * load of it); the caller passes the callee value's environment. The direct
 * calls are then ordinary inlining candidates, so callbacks of iteration
 * helpers and local closures compile like direct calls. Input is verified IR
 * and never mutated; twins are appended to the module. */
export function devirtualizeClosureCalls(
  module: ModuleIR,
  budget: number,
  closedRecords: boolean = false,
  remarks?: RemarkSink,
  openRecords?: ReadonlySet<number>,
): ClosureDevirtualization | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0)
    throw "INVALID_OPTIMIZATION_BUDGET";
  let visited = 0,
    rewritten = 0;
  const twins: (number | undefined)[] = [],
    added: FunctionIR[] = [];
  function eligible(target: number): boolean {
    const fn = module.functions[target];
    return (
      fn !== undefined && fn.import !== true && fn.environment === undefined
    );
  }
  // Twins built by an earlier run of this pass (it runs again after each
  // productive inlining round) are reused: their names are unique.
  const byName = new Map<string, number>();
  for (const fn of module.functions)
    if (fn !== undefined) byName.set(fn.name, fn.id);
  for (const fn of module.functions) {
    if (fn === undefined || !fn.name.endsWith("$direct")) continue;
    const original = byName.get(fn.name.slice(0, fn.name.length - 7));
    if (original !== undefined) twins[original] = fn.id;
  }
  /** Closure targets given a direct twin, in twin order. */
  const reserved: number[] = [];
  // Pre-scan `function-new` sites to prove when every closure created for a
  // target passes a fresh `record-new` matching `target.closureEnvironment`.
  // Whole-function slot facts catch cross-block `record-new` -> `store` ->
  // `load` -> `function-new` (such as class `$define` building `$call`).
  // When records are closed (or the target is not exported), no other code can
  // construct a closure for that target with a different environment layout,
  // so dead reads of `closure-environment` into unread slots are safe to elide
  // on `$direct` twins even when `ts-native` marks the closure `exported: true`.
  const seenFnNew = new Uint8Array(module.functions.length);
  const badEnvLayout = new Uint8Array(module.functions.length);
  const usedFnNewTarget = new Uint8Array(module.functions.length);
  const directCalledTarget = new Uint8Array(module.functions.length);
  for (const fn of module.functions) {
    if (fn === undefined) throw "closure function invariant";
    const slotRec = new Int32Array(fn.slots.length);
    slotRec.fill(-1);
    for (const p of fn.parameters) if (p !== undefined) slotRec[p] = -2;
    if (fn.receiverSlot !== undefined) slotRec[fn.receiverSlot] = -2;
    const blockRec = new Map<number, number>();
    const fnNewResultTarget = new Map<number, number>();
    const nonStoreUsed = new Set<number>();
    const markNonStore = (id: number): void => {
      nonStoreUsed.add(id);
    };
    const slotNonDeadRead = new Uint8Array(fn.slots.length);
    for (const block of fn.blocks) {
      if (block === undefined) throw "closure block invariant";
      if (block.exception !== undefined) slotRec[block.exception.slot] = -2;
      const term = block.terminator;
      if (
        term.kind === "record" ||
        term.kind === "record-cell" ||
        term.kind === "cell"
      ) {
        if (term.operation === "read") slotRec[term.slot] = -2;
        else slotNonDeadRead[term.slot] = 1;
      }
      if (blockRec.size > 0) blockRec.clear();
      for (const op of block.instructions) {
        if (op === undefined) throw "closure instruction invariant";
        // `function-environment` only extracts a closure's environment record
        // and never invokes the closure target.
        if (op.kind !== "store" && op.kind !== "function-environment")
          visitInstructionOperands(op, markNonStore);
        if (op.kind === "call") directCalledTarget[op.target] = 1;
        else if (op.kind === "record-new") {
          blockRec.set(op.id, op.record);
        } else if (
          op.kind === "reference-wrap" ||
          op.kind === "reference-value"
        ) {
          const rec = blockRec.get(op.value);
          if (rec !== undefined) blockRec.set(op.id, rec);
        } else if (op.kind === "store") {
          const rec = blockRec.get(op.value);
          const cur = slotRec[op.slot] ?? -2;
          if (rec === undefined) slotRec[op.slot] = -2;
          else if (cur === -1) slotRec[op.slot] = rec;
          else if (cur !== rec) slotRec[op.slot] = -2;
        } else if (op.kind === "function-new") {
          fnNewResultTarget.set(op.id, op.target);
        }
      }
      visitTerminatorOperands(term, markNonStore);
    }
    // Propagate live-read slots backwards through `store slot=B value=(load A)`
    // so dead stores of a devirtualized `function-new` into an unread slot do
    // not keep the original closure target falsely live.
    const liveIds = new Set<number>(nonStoreUsed);
    let liveChanged = true;
    while (liveChanged) {
      liveChanged = false;
      for (const block of fn.blocks) {
        if (block === undefined) throw "closure block invariant";
        for (const op of block.instructions) {
          if (op === undefined) throw "closure instruction invariant";
          if (
            op.kind === "load" &&
            liveIds.has(op.id) &&
            slotNonDeadRead[op.slot] === 0
          ) {
            slotNonDeadRead[op.slot] = 1;
            liveChanged = true;
          } else if (
            op.kind === "store" &&
            slotNonDeadRead[op.slot] === 1 &&
            !liveIds.has(op.value)
          ) {
            liveIds.add(op.value);
            liveChanged = true;
          }
        }
      }
    }
    for (const [id, target] of fnNewResultTarget) {
      if (liveIds.has(id)) usedFnNewTarget[target] = 1;
    }
    for (const block of fn.blocks) {
      if (block === undefined) throw "closure block invariant";
      if (blockRec.size > 0) blockRec.clear();
      for (const op of block.instructions) {
        if (op === undefined) throw "closure instruction invariant";
        if (op.kind === "record-new") {
          blockRec.set(op.id, op.record);
        } else if (op.kind === "load") {
          const rec = slotRec[op.slot] ?? -2;
          if (rec >= 0) blockRec.set(op.id, rec);
        } else if (
          op.kind === "reference-wrap" ||
          op.kind === "reference-value"
        ) {
          const rec = blockRec.get(op.value);
          if (rec !== undefined) blockRec.set(op.id, rec);
        } else if (op.kind === "function-new" && op.environment !== undefined) {
          seenFnNew[op.target] = 1;
          const targetEnv = module.functions[op.target]?.closureEnvironment;
          if (
            targetEnv === undefined ||
            blockRec.get(op.environment) !== targetEnv
          )
            badEnvLayout[op.target] = 1;
        }
      }
    }
  }
  const envLayoutOk = new Uint8Array(module.functions.length);
  for (let id = 0; id < module.functions.length; id++) {
    const fn = module.functions[id];
    if (
      fn !== undefined &&
      fn.closureEnvironment !== undefined &&
      seenFnNew[id] === 1 &&
      badEnvLayout[id] === 0 &&
      (closedRecords || !fn.exported)
    )
      envLayoutOk[id] = 1;
  }
  const envUsageCache = new Map<
    number,
    {
      readonly needsEnv: boolean;
      readonly deadReadBlocks: ReadonlySet<number>;
      readonly deadEnvSlots: ReadonlySet<number>;
      readonly deadEnvLoads: ReadonlySet<number>;
    }
  >();
  /** Analyze whether a closure actually uses its `closure-environment` after
   * ignoring pure `record` reads of `fn.closureEnvironment` into slots that are
   * never read anywhere in `fn`. Those dead environment reads are always safe
   * to elide on a `$direct` twin when every closure of `fn` is proven to pass
   * `fn.closureEnvironment`. */
  function analyzeClosureEnv(fn: FunctionIR): {
    readonly needsEnv: boolean;
    readonly deadReadBlocks: ReadonlySet<number>;
    readonly deadEnvSlots: ReadonlySet<number>;
    readonly deadEnvLoads: ReadonlySet<number>;
  } {
    const cached = envUsageCache.get(fn.id);
    if (cached !== undefined) return cached;
    const envRecord = fn.closureEnvironment;
    if (envRecord === undefined) {
      const res = {
        needsEnv: false,
        deadReadBlocks: new Set<number>(),
        deadEnvSlots: new Set<number>(),
        deadEnvLoads: new Set<number>(),
      };
      envUsageCache.set(fn.id, res);
      return res;
    }
    const existingTwinId = twins[fn.id];
    const existingTwin =
      existingTwinId !== undefined
        ? module.functions[existingTwinId]
        : undefined;
    if (existingTwin !== undefined) {
      const baseParams =
        fn.parameters.length + (fn.receiverSlot === undefined ? 0 : 1);
      const res = {
        needsEnv: existingTwin.parameters.length > baseParams,
        deadReadBlocks: new Set<number>(),
        deadEnvSlots: new Set<number>(),
        deadEnvLoads: new Set<number>(),
      };
      envUsageCache.set(fn.id, res);
      return res;
    }
    const layout = module.records?.[envRecord];
    if (layout === undefined || (fn.exported && envLayoutOk[fn.id] !== 1)) {
      const res = {
        needsEnv: true,
        deadReadBlocks: new Set<number>(),
        deadEnvSlots: new Set<number>(),
        deadEnvLoads: new Set<number>(),
      };
      envUsageCache.set(fn.id, res);
      return res;
    }
    const slotRead = new Uint8Array(fn.slots.length);
    const slotWrites = new Uint32Array(fn.slots.length);
    const envOpIds = new Set<number>();
    const envSlotCandidate = new Set<number>();
    const nonEnvWrittenSlot = new Uint8Array(fn.slots.length);
    for (const p of fn.parameters)
      if (p !== undefined) nonEnvWrittenSlot[p] = 1;
    if (fn.receiverSlot !== undefined) nonEnvWrittenSlot[fn.receiverSlot] = 1;
    for (const block of fn.blocks) {
      if (block === undefined) throw "closure block invariant";
      if (block.exception !== undefined)
        nonEnvWrittenSlot[block.exception.slot] = 1;
      for (const op of block.instructions) {
        if (op === undefined) throw "closure instruction invariant";
        if (op.kind === "closure-environment") envOpIds.add(op.id);
        else if (op.kind === "load") slotRead[op.slot] = 1;
        else if (op.kind === "store") {
          slotWrites[op.slot] = (slotWrites[op.slot] ?? 0) + 1;
          if (envOpIds.has(op.value)) envSlotCandidate.add(op.slot);
          else nonEnvWrittenSlot[op.slot] = 1;
        }
      }
      const term = block.terminator;
      if (
        term.kind === "record" ||
        term.kind === "record-cell" ||
        term.kind === "cell"
      ) {
        nonEnvWrittenSlot[term.slot] = 1;
        if (term.operation !== "read") slotRead[term.slot] = 1;
      }
    }
    const pureEnvSlots = new Set<number>();
    for (const s of envSlotCandidate) {
      if (nonEnvWrittenSlot[s] === 0 && (slotWrites[s] ?? 0) > 0)
        pureEnvSlots.add(s);
    }
    const envLoadIds = new Set<number>();
    const loadSlotOf = new Map<number, number>();
    for (const block of fn.blocks) {
      if (block === undefined) throw "closure block invariant";
      for (const op of block.instructions) {
        if (op === undefined) throw "closure instruction invariant";
        if (op.kind === "load" && pureEnvSlots.has(op.slot)) {
          envLoadIds.add(op.id);
          loadSlotOf.set(op.id, op.slot);
        }
      }
    }
    const deadReadBlocks = new Set<number>();
    for (const block of fn.blocks) {
      if (block === undefined) throw "closure block invariant";
      const term = block.terminator;
      if (
        term.kind === "record" &&
        term.operation === "read" &&
        term.record === envRecord &&
        slotRead[term.slot] === 0 &&
        (envOpIds.has(term.object) || envLoadIds.has(term.object))
      ) {
        const field = layout.fields[term.field];
        if (
          field !== undefined &&
          field.stateOffset === undefined &&
          field.presenceOffset === undefined
        )
          deadReadBlocks.add(block.id);
      }
    }
    // Check whether any closure-environment value (or pure env slot load) has a
    // remaining live use outside deadReadBlocks and pureEnvSlot stores.
    let liveEnvUse = false;
    const liveUsedEnvLoads = new Set<number>();
    const markLiveUse = (id: number): void => {
      if (envOpIds.has(id)) liveEnvUse = true;
      if (envLoadIds.has(id)) {
        liveEnvUse = true;
        liveUsedEnvLoads.add(id);
      }
    };
    for (const block of fn.blocks) {
      if (block === undefined) throw "closure block invariant";
      for (const op of block.instructions) {
        if (op === undefined) throw "closure instruction invariant";
        if (
          op.kind === "store" &&
          pureEnvSlots.has(op.slot) &&
          envOpIds.has(op.value)
        )
          continue;
        visitInstructionOperands(op, markLiveUse);
      }
      if (!deadReadBlocks.has(block.id))
        visitTerminatorOperands(block.terminator, markLiveUse);
    }
    const deadEnvLoads = new Set<number>();
    for (const id of envLoadIds)
      if (!liveUsedEnvLoads.has(id)) deadEnvLoads.add(id);
    const deadEnvSlots = liveEnvUse ? new Set<number>() : pureEnvSlots;
    const res = {
      needsEnv: liveEnvUse,
      deadReadBlocks,
      deadEnvSlots,
      deadEnvLoads,
    };
    envUsageCache.set(fn.id, res);
    return res;
  }
  /** The direct function to call for closures of `target`. Twins are built
   * after every function's calls are rewritten (see below). */
  function direct(target: number): number | undefined {
    const fn = module.functions[target];
    if (fn === undefined) throw "closure target invariant";
    const existing = twins[target];
    if (existing !== undefined) return existing;
    if (fn.closureEnvironment === undefined && fn.receiverSlot === undefined) {
      twins[target] = target;
      return target;
    }
    const id = module.functions.length + reserved.length;
    reserved.push(target);
    twins[target] = id;
    return id;
  }
  /** The twin of a closure body: its receiver and environment are trailing
   * parameters, in that order, so the twin is an ordinary (inlinable)
   * function. */
  function twin(fn: FunctionIR, id: number): FunctionIR | undefined {
    const envInfo = analyzeClosureEnv(fn);
    const needsEnv = fn.closureEnvironment !== undefined && envInfo.needsEnv;
    const environmentSlot = fn.slots.length;
    const blocks: Block[] = [];
    for (const block of fn.blocks) {
      if (block === undefined) throw "closure block invariant";
      let instructions: Instruction[] | undefined;
      for (let i = 0; i < block.instructions.length; i++) {
        const op = block.instructions[i];
        if (op === undefined) throw "closure instruction invariant";
        if (visited >= budget) return undefined;
        visited++;
        if (op.kind === "closure-environment") {
          if (instructions === undefined)
            instructions = block.instructions.slice(0, i);
          if (needsEnv) {
            instructions.push({
              kind: "load",
              id: op.id,
              slot: environmentSlot,
              start: op.start,
              end: op.end,
              ...(op.inline === undefined ? {} : { inline: op.inline }),
            });
          }
          continue;
        }
        if (
          !needsEnv &&
          ((op.kind === "store" && envInfo.deadEnvSlots.has(op.slot)) ||
            (op.kind === "load" && envInfo.deadEnvLoads.has(op.id)))
        ) {
          if (instructions === undefined)
            instructions = block.instructions.slice(0, i);
          continue;
        }
        if (instructions !== undefined) instructions.push(op);
      }
      let terminator = block.terminator;
      if (
        envInfo.deadReadBlocks.has(block.id) &&
        terminator.kind === "record" &&
        terminator.operation === "read"
      ) {
        terminator = {
          kind: "jump",
          target: terminator.consequent,
          start: terminator.start,
          end: terminator.end,
          ...(terminator.inline === undefined
            ? {}
            : { inline: terminator.inline }),
        };
      }
      blocks.push(
        instructions === undefined && terminator === block.terminator
          ? block
          : {
              ...block,
              ...(instructions === undefined ? {} : { instructions }),
              terminator,
            },
      );
    }
    const slots = fn.slots.slice();
    const parameters = fn.parameters.slice();
    if (fn.receiverSlot !== undefined) parameters.push(fn.receiverSlot);
    if (needsEnv) {
      slots.push("reference");
      parameters.push(environmentSlot);
    }
    // The body keeps its source-debugging metadata: an earlier inlining
    // round may have left inline sites its instructions refer to.
    const debug =
      fn.debug === undefined ? undefined : retainDebugValues(fn, blocks);
    const twin: FunctionIR = {
      id,
      name: fn.name + "$direct",
      exported: false,
      parameters,
      slots,
      returnType: fn.returnType,
      entry: fn.entry,
      blocks,
    };
    const result = debug === undefined ? twin : { ...twin, debug };
    if (envInfo.deadReadBlocks.size > 0) {
      const cleaned = compactReachableBlocks(
        result,
        result.blocks,
        Math.max(0, budget - visited),
      );
      if (cleaned === undefined) return undefined;
      visited += cleaned.visited;
      return cleaned.fn;
    }
    return result;
  }
  /** One-block forwarding thunk replacing a large closure body once its
   * `$direct` twin carries the full body. Preserves the closure ABI, receiver
   * and environment while forwarding indirect calls directly to `target`. */
  function thunk(fn: FunctionIR, target: number): FunctionIR {
    const slots: ScalarType[] = [],
      parameters: number[] = [],
      instructions: Instruction[] = [],
      args: number[] = [],
      firstBlock = fn.blocks[fn.entry],
      thunkSpan =
        firstBlock === undefined
          ? { start: 0, end: 0 }
          : {
              start: firstBlock.terminator.start,
              end: firstBlock.terminator.end,
            };
    let nextId = 0;
    for (const parameter of fn.parameters) {
      if (parameter === undefined) throw "closure parameter invariant";
      const type = fn.slots[parameter];
      if (type === undefined) throw "closure parameter slot invariant";
      const slot = slots.length;
      slots.push(type);
      parameters.push(slot);
      const id = nextId++;
      instructions.push({ kind: "load", id, slot, ...thunkSpan });
      args.push(id);
    }
    let receiverSlot: number | undefined;
    if (fn.receiverSlot !== undefined) {
      const type = fn.slots[fn.receiverSlot];
      if (type === undefined) throw "closure receiver slot invariant";
      receiverSlot = slots.length;
      slots.push(type);
      const id = nextId++;
      instructions.push({ kind: "load", id, slot: receiverSlot, ...thunkSpan });
      args.push(id);
    }
    if (fn.closureEnvironment !== undefined && analyzeClosureEnv(fn).needsEnv) {
      const id = nextId++;
      instructions.push({ kind: "closure-environment", id, ...thunkSpan });
      args.push(id);
    }
    const result = fn.returnType === "void" ? undefined : nextId++;
    instructions.push({
      kind: "call",
      id: result,
      target,
      arguments: args,
      ...thunkSpan,
    });
    const block: Block = {
      id: 0,
      instructions,
      terminator: { kind: "return", value: result, ...thunkSpan },
    };
    return {
      id: fn.id,
      name: fn.name,
      exported: fn.exported,
      ...(receiverSlot === undefined ? {} : { receiverSlot }),
      ...(fn.closureEnvironment === undefined
        ? {}
        : { closureEnvironment: fn.closureEnvironment }),
      parameters,
      slots,
      returnType: fn.returnType,
      entry: 0,
      blocks: [block],
    };
  }
  // With closed records (no foreign code constructs or writes this module's
  // records), fields are written only by record-new arguments and record
  // (cell) writes and initializations (raw memory operations belong to the
  // trusted runtime). A field every
  // write of which stores a closure of one target (`fieldTargets`, keyed
  // record * 65536 + field; others in `unknownFields`) yields that closure
  // when read: sibling closures calling each other through their shared
  // environment (or the cell boxes it holds) devirtualize too. An absent
  // record-new argument leaves a cell field uninitialized, not written.
  const recordLayouts = module.records ?? [];
  function isReferenceField(record: number, field: number): boolean {
    return recordLayouts[record]?.fields[field]?.type === "reference";
  }
  function isClosedRecord(record: number): boolean {
    return (
      closedRecords && (openRecords === undefined || !openRecords.has(record))
    );
  }
  // Pre-scan once to avoid repeatedly scanning functions that neither write
  // reference record fields nor make indirect calls nor produce closures.
  // Direct-call closure parameter facts: for internal functions that are only
  // reached via direct `call` (never exported, never scriptEntry, and never
  // referenced by any used `function-new`), if every direct `call` site passes
  // a known closure of the same target for parameter `k`, seed `paramTargets`
  // with that closure (e.g. `DerivedClass$define$direct` receiving `Base$init`).
  const fnCount = module.functions.length,
    isDirectOnlyInternal = new Uint8Array(fnCount),
    directCallers: FunctionIR[] = [],
    hasCallIndirect = new Uint8Array(fnCount),
    hasClosureSource = new Uint8Array(fnCount),
    hasFunctionEnv = new Uint8Array(fnCount),
    activeRecordWriters: FunctionIR[] = [],
    staticUnknownFields = new Set<number>();
  if (closedRecords) {
    for (let id = 0; id < fnCount; id++) {
      const fn = module.functions[id];
      if (
        fn !== undefined &&
        !fn.exported &&
        fn.import !== true &&
        fn.scriptEntry === undefined &&
        usedFnNewTarget[id] === 0 &&
        directCalledTarget[id] === 1
      ) {
        isDirectOnlyInternal[id] = 1;
      }
    }
  }
  for (const fn of module.functions) {
    if (fn === undefined) throw "closure function invariant";
    let callsIndirect = false,
      closureSource = false,
      functionEnv = false,
      writesRefField = false,
      callsDirectOnly = false;
    if (isDirectOnlyInternal[fn.id] === 1) {
      for (const param of fn.parameters) {
        const type = param === undefined ? undefined : fn.slots[param];
        if (type === "reference" || type === "optional-reference") {
          closureSource = true;
          break;
        }
      }
    }
    for (const block of fn.blocks) {
      if (block === undefined) throw "closure block invariant";
      const term = block.terminator;
      if (term.kind === "record" || term.kind === "record-cell") {
        if (
          isClosedRecord(term.record) &&
          isReferenceField(term.record, term.field)
        ) {
          if (term.operation === "read") closureSource = true;
          else writesRefField = true;
        }
      }
      for (const op of block.instructions) {
        if (op === undefined) throw "closure instruction invariant";
        if (op.kind === "call" && isDirectOnlyInternal[op.target] === 1)
          callsDirectOnly = true;
        if (op.kind === "function-new" && eligible(op.target))
          closureSource = true;
        else if (op.kind === "function-environment") functionEnv = true;
        else if (
          op.kind === "record-read" &&
          isClosedRecord(op.record) &&
          isReferenceField(op.record, op.field)
        )
          closureSource = true;
        else if (
          op.kind === "call-indirect" &&
          op.scriptArguments === undefined
        )
          callsIndirect = true;
        else if (
          op.kind === "record-new" &&
          isClosedRecord(op.record) &&
          !writesRefField
        ) {
          const fields = recordLayouts[op.record]?.fields;
          for (let field = 0; field < op.arguments.length; field++)
            if (fields?.[field]?.type === "reference") {
              writesRefField = true;
              break;
            }
        }
      }
    }
    if (callsDirectOnly) directCallers.push(fn);
    if (callsIndirect) hasCallIndirect[fn.id] = 1;
    if (closureSource) hasClosureSource[fn.id] = 1;
    if (functionEnv) hasFunctionEnv[fn.id] = 1;
    if (writesRefField) {
      if (closureSource) activeRecordWriters.push(fn);
      else {
        // Functions with no closure sources can only write unknown values
        // into every reference field they initialize or store.
        for (const block of fn.blocks) {
          if (block === undefined) throw "closure block invariant";
          for (const op of block.instructions) {
            if (op === undefined) throw "closure instruction invariant";
            if (op.kind !== "record-new" || !isClosedRecord(op.record))
              continue;
            const fields = recordLayouts[op.record]?.fields;
            for (let field = 0; field < op.arguments.length; field++) {
              const meta = fields?.[field];
              if (meta?.type !== "reference") continue;
              if (
                op.arguments[field] === undefined &&
                meta.stateOffset !== undefined
              )
                continue;
              staticUnknownFields.add(op.record * 65536 + field);
            }
          }
          const term = block.terminator;
          if (
            (term.kind === "record" || term.kind === "record-cell") &&
            term.operation !== "read" &&
            isClosedRecord(term.record) &&
            isReferenceField(term.record, term.field)
          )
            staticUnknownFields.add(term.record * 65536 + term.field);
        }
      }
    }
  }
  let fieldTargets = new Map<number, KnownClosure>(),
    unknownFields = new Set<number>();
  function fieldTarget(
    record: number,
    field: number,
  ): KnownClosure | undefined {
    if (!isClosedRecord(record)) return undefined;
    const key = record * 65536 + field;
    return unknownFields.has(key) ? undefined : fieldTargets.get(key);
  }
  let paramTargets = new Map<number, KnownClosure>(),
    unknownParams = new Set<number>(),
    returnTargets = new Map<number, KnownClosure>();
  function paramTarget(
    fnId: number,
    paramIndex: number,
  ): KnownClosure | undefined {
    const key = fnId * 65536 + paramIndex;
    return unknownParams.has(key) ? undefined : paramTargets.get(key);
  }
  const closureReturners: FunctionIR[] = [];
  if (closedRecords) {
    for (const fn of module.functions) {
      if (
        fn !== undefined &&
        fn.import !== true &&
        (fn.returnType === "reference" ||
          fn.returnType === "optional-reference")
      )
        closureReturners.push(fn);
    }
  }
  /** Slot facts of `fn` under the current field facts. Only `reference`
   * slots can hold a closure (function-new produces `reference`, call-indirect
   * requires `reference`). Propagates closures through both direct writes
   * (`function-new`, `record`/`record-cell` reads, `record-read`) and
   * slot-to-slot copies (`v = load sA; store sB v`) so environment-captured
   * imports copied into call temporaries devirtualize. */
  function isClosureSlot(type: ScalarType | undefined): boolean {
    return type === "reference" || type === "optional-reference";
  }
  function slotFacts(fn: FunctionIR): SlotFacts | undefined {
    const targets = new Map<number, KnownClosure>(),
      unknown = new Set<number>(),
      // Slot -> slots it is copied from (store of a load).
      copies = new Map<number, number[]>();
    for (let pi = 0; pi < fn.parameters.length; pi++) {
      const parameter = fn.parameters[pi];
      if (parameter !== undefined && isClosureSlot(fn.slots[parameter])) {
        const knownParam =
          isDirectOnlyInternal[fn.id] === 1
            ? paramTarget(fn.id, pi)
            : undefined;
        if (knownParam !== undefined) targets.set(parameter, knownParam);
        else unknown.add(parameter);
      }
    }
    const receiverSlot = fn.receiverSlot;
    if (receiverSlot !== undefined && isClosureSlot(fn.slots[receiverSlot]))
      unknown.add(receiverSlot);
    let candidates = false;
    const write = (slot: number, known: KnownClosure | undefined): boolean => {
      if (unknown.has(slot)) return false;
      const previous = targets.get(slot);
      if (known === undefined) {
        unknown.add(slot);
        return true;
      }
      if (previous === undefined) {
        targets.set(slot, known);
        return true;
      }
      if (previous.target !== known.target) {
        unknown.add(slot);
        return true;
      }
      return false;
    };
    const local = new Map<number, KnownClosure>(),
      // Slot (+ 1) a reference/optional-reference value loads, for stores that copy another slot.
      loaded = new Map<number, number>(),
      // Absent optional-reference values (reference-none): storing absent into an
      // optional-reference slot never produces a closure at reference-value (it traps).
      absentValues = new Set<number>();
    for (const block of fn.blocks) {
      if (block === undefined) throw "closure block invariant";
      const exception = block.exception;
      if (exception !== undefined && isClosureSlot(fn.slots[exception.slot]))
        unknown.add(exception.slot);
      const term = block.terminator;
      // Reads of closure fields store their closure in the transfer slot;
      // writes and initializations only read `term.slot`.
      if (
        (term.kind === "record" ||
          term.kind === "record-cell" ||
          term.kind === "cell") &&
        term.operation === "read" &&
        isClosureSlot(fn.slots[term.slot])
      )
        write(
          term.slot,
          term.kind !== "cell" && fn.slots[term.slot] === "reference"
            ? fieldTarget(term.record, term.field)
            : undefined,
        );
      for (const op of block.instructions) {
        if (op === undefined) throw "closure instruction invariant";
        if (visited >= budget) return undefined;
        visited++;
        if (op.kind === "function-new" && eligible(op.target))
          local.set(op.id, {
            target: op.target,
            environment: op.environment !== undefined,
          });
        else if (op.kind === "reference-none") absentValues.add(op.id);
        else if (
          op.kind === "reference-wrap" ||
          op.kind === "reference-value"
        ) {
          const directKnown = local.get(op.value);
          if (directKnown !== undefined) local.set(op.id, directKnown);
          const source = loaded.get(op.value);
          if (source !== undefined) loaded.set(op.id, source);
        } else if (op.kind === "record-read") {
          const fieldKnown = fieldTarget(op.record, op.field);
          if (fieldKnown !== undefined) local.set(op.id, fieldKnown);
        } else if (op.kind === "call") {
          const callId = op.id;
          if (callId !== undefined) {
            const retKnown = returnTargets.get(op.target);
            if (retKnown !== undefined) local.set(callId, retKnown);
          }
        } else if (op.kind === "load" && isClosureSlot(fn.slots[op.slot]))
          loaded.set(op.id, op.slot + 1);
        else if (op.kind === "store" && isClosureSlot(fn.slots[op.slot])) {
          if (
            fn.slots[op.slot] === "optional-reference" &&
            absentValues.has(op.value)
          )
            continue;
          const source = loaded.get(op.value) ?? 0;
          // Storing a slot's own value back changes nothing.
          if (source - 1 === op.slot) continue;
          if (source !== 0) {
            // A copy (as an inlined callee's result reaches its caller's
            // variable): the slot holds what the source slot holds.
            const sources = copies.get(op.slot);
            if (sources === undefined) copies.set(op.slot, [source - 1]);
            else sources.push(source - 1);
          } else write(op.slot, local.get(op.value));
        } else if (op.kind === "call-indirect") candidates = true;
      }
    }
    // Copies take their sources' facts, to a fixpoint (facts only grow); a
    // source no write ever reaches holds its initial value: unknown.
    for (let changed = true; changed;) {
      changed = false;
      for (const [slot, sources] of copies) {
        if (unknown.has(slot)) continue;
        for (const source of sources) {
          if (visited >= budget) return undefined;
          visited++;
          const known = targets.get(source);
          if (
            unknown.has(source) ||
            (known === undefined && !copies.has(source))
          ) {
            unknown.add(slot);
            changed = true;
            break;
          }
          if (known !== undefined && targets.get(slot) === undefined) {
            targets.set(slot, known);
            changed = true;
          } else if (
            known !== undefined &&
            targets.get(slot)?.target !== known.target
          ) {
            unknown.add(slot);
            changed = true;
            break;
          }
        }
      }
    }
    // A copy of a copy cycle no closure write reaches is unknown too.
    for (const [slot] of copies)
      if (targets.get(slot) === undefined) unknown.add(slot);
    return { targets, unknown, candidates };
  }
  // With closed records (no foreign code constructs or writes this module's
  // records), fields are written only by record-new arguments and record
  // (cell) writes and initializations (raw memory operations belong to the
  // trusted runtime). A field every write of which stores a closure of one
  // target (`fieldTargets`, keyed record * 65536 + field; others in
  // `unknownFields`) yields that closure when read: sibling closures calling
  // each other through their shared environment (or the cell boxes it
  // holds) devirtualize too. An absent record-new argument leaves a cell
  // field uninitialized, not written. Written values are known through
  // slots (whole-function facts) and earlier field facts, so a closure
  // copied from one environment into another (a function declaration
  // captured by value) stays known; facts only grow, to a fixpoint.
  for (let round = 0; closedRecords && round < 8; round++) {
    const nextParamTargets = new Map<number, KnownClosure>(),
      nextUnknownParams = new Set<number>();
    const writeParam = (key: number, known: KnownClosure | undefined): void => {
      if (nextUnknownParams.has(key)) return;
      const previous = nextParamTargets.get(key);
      if (known === undefined) nextUnknownParams.add(key);
      else if (previous === undefined) nextParamTargets.set(key, known);
      else if (previous.target !== known.target) nextUnknownParams.add(key);
    };
    for (const fn of directCallers) {
      if (fn === undefined) throw "closure function invariant";
      if (
        !fn.exported &&
        fn.scriptEntry === undefined &&
        usedFnNewTarget[fn.id] === 0 &&
        directCalledTarget[fn.id] === 0
      )
        continue;
      const own = slotFacts(fn);
      if (own === undefined) return undefined;
      const slotTarget = (slot: number): KnownClosure | undefined =>
        own.unknown.has(slot) ? undefined : own.targets.get(slot);
      const local = new Map<number, KnownClosure>(),
        stored = new Map<number, KnownClosure>(),
        storedStamp = new Uint32Array(fn.slots.length);
      let blockStamp = 0;
      for (const block of fn.blocks) {
        if (block === undefined) throw "closure block invariant";
        blockStamp++;
        for (const op of block.instructions) {
          if (op === undefined) throw "closure instruction invariant";
          if (visited >= budget) return undefined;
          visited++;
          if (op.kind === "function-new" && eligible(op.target))
            local.set(op.id, {
              target: op.target,
              environment: op.environment !== undefined,
            });
          else if (op.kind === "record-read") {
            const fieldKnown = fieldTarget(op.record, op.field);
            if (fieldKnown !== undefined) local.set(op.id, fieldKnown);
          } else if (
            op.kind === "reference-wrap" ||
            op.kind === "reference-value"
          ) {
            const wrapped = local.get(op.value);
            if (wrapped !== undefined) local.set(op.id, wrapped);
          } else if (op.kind === "store" && isClosureSlot(fn.slots[op.slot])) {
            const value = local.get(op.value);
            if (value === undefined) stored.delete(op.slot);
            else stored.set(op.slot, value);
            storedStamp[op.slot] = blockStamp;
          } else if (op.kind === "load" && isClosureSlot(fn.slots[op.slot])) {
            const value =
              storedStamp[op.slot] === blockStamp
                ? stored.get(op.slot)
                : slotTarget(op.slot);
            if (value !== undefined) local.set(op.id, value);
          } else if (op.kind === "call") {
            const callId = op.id;
            if (callId !== undefined) {
              const retKnown = returnTargets.get(op.target);
              if (retKnown !== undefined) local.set(callId, retKnown);
            }
            if (isDirectOnlyInternal[op.target] === 1) {
              const callee = module.functions[op.target];
              if (callee !== undefined) {
                for (let k = 0; k < op.arguments.length; k++) {
                  const pSlot = callee.parameters[k];
                  if (
                    pSlot !== undefined &&
                    isClosureSlot(callee.slots[pSlot])
                  ) {
                    const argId = op.arguments[k];
                    writeParam(
                      op.target * 65536 + k,
                      argId === undefined ? undefined : local.get(argId),
                    );
                  }
                }
              }
            }
          }
        }
      }
    }
    const nextTargets = new Map<number, KnownClosure>(),
      nextUnknown = new Set<number>();
    for (const key of staticUnknownFields)
      if (key !== undefined) nextUnknown.add(key);
    const writeField = (key: number, known: KnownClosure | undefined): void => {
      if (nextUnknown.has(key)) return;
      const previous = nextTargets.get(key);
      if (known === undefined) nextUnknown.add(key);
      else if (previous === undefined) nextTargets.set(key, known);
      else if (previous.target !== known.target) nextUnknown.add(key);
    };
    for (const fn of activeRecordWriters) {
      if (fn === undefined) throw "closure function invariant";
      if (
        !fn.exported &&
        fn.scriptEntry === undefined &&
        usedFnNewTarget[fn.id] === 0 &&
        directCalledTarget[fn.id] === 0
      )
        continue;
      const own = slotFacts(fn);
      if (own === undefined) return undefined;
      const slotTarget = (slot: number): KnownClosure | undefined =>
        own.unknown.has(slot) ? undefined : own.targets.get(slot);
      const local = new Map<number, KnownClosure>(),
        stored = new Map<number, KnownClosure>(),
        storedStamp = new Uint32Array(fn.slots.length);
      let blockStamp = 0;
      for (const block of fn.blocks) {
        if (block === undefined) throw "closure block invariant";
        blockStamp++;
        for (const op of block.instructions) {
          if (op === undefined) throw "closure instruction invariant";
          if (visited >= budget) return undefined;
          visited++;
          if (op.kind === "function-new" && eligible(op.target))
            local.set(op.id, {
              target: op.target,
              environment: op.environment !== undefined,
            });
          else if (op.kind === "record-read") {
            const fieldKnown = fieldTarget(op.record, op.field);
            if (fieldKnown !== undefined) local.set(op.id, fieldKnown);
          } else if (op.kind === "call") {
            const callId = op.id;
            if (callId !== undefined) {
              const retKnown = returnTargets.get(op.target);
              if (retKnown !== undefined) local.set(callId, retKnown);
            }
          } else if (op.kind === "store" && fn.slots[op.slot] === "reference") {
            const value = local.get(op.value);
            if (value === undefined) stored.delete(op.slot);
            else stored.set(op.slot, value);
            storedStamp[op.slot] = blockStamp;
          } else if (op.kind === "load" && fn.slots[op.slot] === "reference") {
            const value =
              storedStamp[op.slot] === blockStamp
                ? stored.get(op.slot)
                : slotTarget(op.slot);
            if (value !== undefined) local.set(op.id, value);
          } else if (op.kind === "record-new" && isClosedRecord(op.record)) {
            const fields = recordLayouts[op.record]?.fields;
            for (let field = 0; field < op.arguments.length; field++) {
              const meta = fields?.[field];
              if (meta?.type !== "reference") continue;
              const argument = op.arguments[field];
              if (argument === undefined && meta.stateOffset !== undefined)
                continue;
              writeField(
                op.record * 65536 + field,
                argument === undefined ? undefined : local.get(argument),
              );
            }
          }
        }
        const term = block.terminator;
        if (
          (term.kind === "record" || term.kind === "record-cell") &&
          term.operation !== "read" &&
          isClosedRecord(term.record) &&
          isReferenceField(term.record, term.field)
        )
          writeField(
            term.record * 65536 + term.field,
            storedStamp[term.slot] === blockStamp
              ? stored.get(term.slot)
              : slotTarget(term.slot),
          );
      }
    }
    const nextReturnTargets = new Map<number, KnownClosure>();
    for (const fn of closureReturners) {
      if (fn === undefined) throw "closure function invariant";
      const own = slotFacts(fn);
      if (own === undefined) return undefined;
      const slotTarget = (slot: number): KnownClosure | undefined =>
        own.unknown.has(slot) ? undefined : own.targets.get(slot);
      let agreed: KnownClosure | undefined;
      let valid = true;
      for (const block of fn.blocks) {
        if (block === undefined) throw "closure block invariant";
        const term = block.terminator;
        if (term.kind !== "return") continue;
        const returnValue = term.value;
        if (returnValue === undefined) {
          valid = false;
          break;
        }
        const local = new Map<number, KnownClosure>();
        for (const op of block.instructions) {
          if (op === undefined) throw "closure instruction invariant";
          if (visited >= budget) return undefined;
          visited++;
          if (op.kind === "function-new" && eligible(op.target))
            local.set(op.id, {
              target: op.target,
              environment: op.environment !== undefined,
            });
          else if (op.kind === "record-read") {
            const fk = fieldTarget(op.record, op.field);
            if (fk !== undefined) local.set(op.id, fk);
          } else if (op.kind === "call") {
            const callId = op.id;
            if (callId !== undefined) {
              const rk = returnTargets.get(op.target);
              if (rk !== undefined) local.set(callId, rk);
            }
          } else if (
            op.kind === "reference-wrap" ||
            op.kind === "reference-value"
          ) {
            const w = local.get(op.value);
            if (w !== undefined) local.set(op.id, w);
          } else if (op.kind === "load" && isClosureSlot(fn.slots[op.slot])) {
            const sk = slotTarget(op.slot);
            if (sk !== undefined) local.set(op.id, sk);
          }
        }
        const ret = local.get(returnValue);
        if (ret === undefined) {
          valid = false;
          break;
        }
        if (agreed === undefined) agreed = ret;
        else if (agreed.target !== ret.target) {
          valid = false;
          break;
        }
      }
      if (valid && agreed !== undefined) nextReturnTargets.set(fn.id, agreed);
    }
    let same =
      nextTargets.size === fieldTargets.size &&
      nextParamTargets.size === paramTargets.size &&
      nextReturnTargets.size === returnTargets.size;
    for (const [key, known] of nextTargets)
      if (
        fieldTargets.get(key)?.target !== known.target ||
        nextUnknown.has(key) !== unknownFields.has(key)
      )
        same = false;
    if (nextUnknown.size !== unknownFields.size) same = false;
    for (const [key, known] of nextParamTargets)
      if (
        paramTargets.get(key)?.target !== known.target ||
        nextUnknownParams.has(key) !== unknownParams.has(key)
      )
        same = false;
    if (nextUnknownParams.size !== unknownParams.size) same = false;
    for (const [key, known] of nextReturnTargets)
      if (returnTargets.get(key)?.target !== known.target) same = false;
    fieldTargets = nextTargets;
    unknownFields = nextUnknown;
    paramTargets = nextParamTargets;
    unknownParams = nextUnknownParams;
    returnTargets = nextReturnTargets;
    if (same) break;
  }
  const functions: FunctionIR[] = [];
  for (const fn of module.functions) {
    if (fn === undefined) throw "closure function invariant";
    const checkDeadEnv =
      closedRecords &&
      hasFunctionEnv[fn.id] === 1 &&
      hasClosureSource[fn.id] === 1;
    if (
      !checkDeadEnv &&
      (hasCallIndirect[fn.id] !== 1 ||
        (remarks === undefined && hasClosureSource[fn.id] !== 1))
    ) {
      functions.push(fn);
      continue;
    }
    const own = slotFacts(fn);
    if (own === undefined) return undefined;
    const slotTargets = own.targets,
      unknown = own.unknown,
      candidates = own.candidates;
    if (!candidates && !checkDeadEnv) {
      functions.push(fn);
      continue;
    }
    let nextValue = 0;
    for (const block of fn.blocks) {
      if (block === undefined) throw "closure block invariant";
      for (const op of block.instructions) {
        if (op === undefined) throw "closure instruction invariant";
        const id = instructionResult(op);
        if (id !== undefined && id >= nextValue) nextValue = id + 1;
      }
    }
    let changed = false;
    const blocks: Block[] = [],
      known = new Map<number, KnownClosure>(),
      fnNewEnv = new Map<number, number>();
    for (const block of fn.blocks) {
      if (block === undefined) throw "closure block invariant";
      let instructions: Instruction[] | undefined;
      for (let i = 0; i < block.instructions.length; i++) {
        const op = block.instructions[i];
        if (op === undefined) throw "closure instruction invariant";
        if (visited >= budget) return undefined;
        visited++;
        if (op.kind === "function-new" && eligible(op.target)) {
          known.set(op.id, {
            target: op.target,
            environment: op.environment !== undefined,
          });
          if (op.environment !== undefined) fnNewEnv.set(op.id, op.environment);
        } else if (op.kind === "record-read") {
          const fieldKnown = fieldTarget(op.record, op.field);
          if (fieldKnown !== undefined) known.set(op.id, fieldKnown);
        } else if (op.kind === "call") {
          const callId = op.id;
          if (callId !== undefined) {
            const retKnown = returnTargets.get(op.target);
            if (retKnown !== undefined) known.set(callId, retKnown);
          }
        } else if (
          op.kind === "reference-wrap" ||
          op.kind === "reference-value"
        ) {
          const wrapped = known.get(op.value);
          if (wrapped !== undefined) known.set(op.id, wrapped);
        } else if (op.kind === "load" && isClosureSlot(fn.slots[op.slot])) {
          const slotKnown = slotTargets.get(op.slot);
          if (slotKnown !== undefined && !unknown.has(op.slot))
            known.set(op.id, slotKnown);
        }
        if (instructions !== undefined) instructions.push(op);
        if (op.kind !== "call-indirect" || op.scriptArguments !== undefined)
          continue;
        const closure = known.get(op.callee);
        if (closure === undefined) {
          if (remarks !== undefined)
            remarks({
              pass: "devirtualize-closures",
              outcome: "missed",
              function: fn.name,
              start: op.start,
              end: op.end,
              message:
                "indirect call stays indirect: callee is not a closure known in this function",
            });
          continue;
        }
        const target = module.functions[closure.target];
        const witness = module.functions[op.target];
        // A void witness can discard a value, but a direct call still has
        // to model the target's actual result in IR.
        if (op.discardResult === true && target?.returnType !== "void")
          continue;
        // The direct call defines the call's result as the target returns
        // it: the result shapes must agree exactly.
        const expected = module.functions[op.target]?.returnType;
        if (
          target !== undefined &&
          op.discardResult !== true &&
          (op.id === undefined
            ? target.returnType !== "void"
            : target.returnType !== expected)
        ) {
          if (remarks !== undefined)
            remarks({
              pass: "devirtualize-closures",
              outcome: "missed",
              function: fn.name,
              start: op.start,
              end: op.end,
              message:
                "indirect call stays indirect: " +
                target.name +
                " returns " +
                target.returnType +
                ", the call expects " +
                (op.id === undefined
                  ? "void"
                  : expected === undefined
                    ? "an unknown result"
                    : expected),
            });
          continue;
        }
        if (
          target === undefined ||
          witness === undefined ||
          target.parameters.length !== op.arguments.length ||
          (target.closureEnvironment === undefined) === closure.environment ||
          (target.receiverSlot === undefined) !== (op.receiver === undefined)
        ) {
          if (remarks !== undefined)
            remarks({
              pass: "devirtualize-closures",
              outcome: "missed",
              function: fn.name,
              start: op.start,
              end: op.end,
              message:
                "indirect call stays indirect: " +
                (target === undefined
                  ? "unknown target"
                  : target.parameters.length !== op.arguments.length
                    ? target.name +
                      " takes " +
                      String(target.parameters.length) +
                      " parameters, the call passes " +
                      String(op.arguments.length)
                    : target.name + " environment or receiver shape differs"),
            });
          continue;
        }
        let paramMismatch = false;
        for (let k = 0; k < target.parameters.length; k++) {
          const targetSlot = target.parameters[k],
            witnessSlot = witness.parameters[k];
          if (
            targetSlot === undefined ||
            witnessSlot === undefined ||
            target.slots[targetSlot] !== witness.slots[witnessSlot]
          ) {
            paramMismatch = true;
            break;
          }
        }
        if (paramMismatch) continue;
        const callee = direct(closure.target);
        if (callee === undefined) continue;
        if (instructions === undefined)
          instructions = block.instructions.slice(0, i);
        else instructions.pop();
        const args = op.arguments.slice();
        // A method's twin takes the call's receiver as a parameter.
        const receiver = op.receiver;
        if (receiver !== undefined) args.push(receiver);
        const passEnvironment =
          closure.environment && analyzeClosureEnv(target).needsEnv;
        if (passEnvironment) {
          const directEnv = fnNewEnv.get(op.callee);
          if (directEnv !== undefined) {
            args.push(directEnv);
          } else {
            const optional = nextValue++,
              environment = nextValue++;
            instructions.push({
              kind: "function-environment",
              id: optional,
              callee: op.callee,
              start: op.start,
              end: op.end,
            });
            instructions.push({
              kind: "reference-value",
              id: environment,
              value: optional,
              start: op.start,
              end: op.end,
            });
            args.push(environment);
          }
        }
        instructions.push({
          kind: "call",
          id: op.id,
          target: callee,
          arguments: args,
          start: op.start,
          end: op.end,
        });
        rewritten++;
        changed = true;
        if (remarks !== undefined)
          remarks({
            pass: "devirtualize-closures",
            outcome: "applied",
            function: fn.name,
            start: op.start,
            end: op.end,
            message:
              "indirect call devirtualized to " +
              target.name +
              (closure.environment ? " (environment passed explicitly)" : ""),
          });
      }
      blocks.push(
        instructions === undefined ? block : { ...block, instructions },
      );
    }
    if (closedRecords && (changed || checkDeadEnv)) {
      // Devirtualizing an environment-free closure call often leaves the
      // closure-lookup `record` read of a known closure's `function-environment`
      // writing into a slot whose only remaining `load` (the old `call-indirect`
      // callee) is now unused. Elide those dead reads now so the surrounding
      // closure-environment fetches become dead too.
      const usedValues = new Set<number>();
      const markVal = (id: number): void => {
        usedValues.add(id);
      };
      for (const block of blocks) {
        if (block === undefined) throw "closure block invariant";
        for (const op of block.instructions) {
          if (op === undefined) throw "closure instruction invariant";
          visitInstructionOperands(op, markVal);
        }
        visitTerminatorOperands(block.terminator, markVal);
      }
      const slotRead = new Uint8Array(fn.slots.length);
      for (const block of blocks) {
        if (block === undefined) throw "closure block invariant";
        for (const op of block.instructions) {
          if (op === undefined) throw "closure instruction invariant";
          if (op.kind === "load" && usedValues.has(op.id))
            slotRead[op.slot] = 1;
        }
        const term = block.terminator;
        if (
          (term.kind === "record" ||
            term.kind === "record-cell" ||
            term.kind === "cell") &&
          term.operation !== "read"
        )
          slotRead[term.slot] = 1;
      }
      let deadEnvPruned = false;
      const envOfClosure = new Map<number, number>();
      for (let b = 0; b < blocks.length; b++) {
        const block = blocks[b];
        if (block === undefined) throw "closure block invariant";
        if (envOfClosure.size > 0) envOfClosure.clear();
        for (const op of block.instructions) {
          if (op === undefined) throw "closure instruction invariant";
          if (op.kind === "function-environment") {
            const c = known.get(op.callee);
            if (c !== undefined && envLayoutOk[c.target] === 1) {
              const envRec = module.functions[c.target]?.closureEnvironment;
              if (envRec !== undefined) envOfClosure.set(op.id, envRec);
            }
          } else if (op.kind === "reference-value") {
            const envRec = envOfClosure.get(op.value);
            if (envRec !== undefined) envOfClosure.set(op.id, envRec);
          }
        }
        const term = block.terminator;
        if (
          term.kind === "record" &&
          term.operation === "read" &&
          slotRead[term.slot] === 0 &&
          envOfClosure.get(term.object) === term.record
        ) {
          const field = recordLayouts[term.record]?.fields[term.field];
          if (
            field !== undefined &&
            field.stateOffset === undefined &&
            field.presenceOffset === undefined
          ) {
            blocks[b] = {
              ...block,
              terminator: {
                kind: "jump",
                target: term.consequent,
                start: term.start,
                end: term.end,
                ...(term.inline === undefined ? {} : { inline: term.inline }),
              },
            };
            changed = true;
            deadEnvPruned = true;
            rewritten++;
          }
        }
      }
      if (deadEnvPruned) {
        const cleaned = compactReachableBlocks(
          fn,
          blocks,
          Math.max(0, budget - visited),
        );
        if (cleaned === undefined) return undefined;
        visited += cleaned.visited;
        functions.push(cleaned.fn);
        continue;
      }
    }
    functions.push(changed ? { ...fn, blocks } : fn);
  }
  if (rewritten === 0) return { module, visited, rewritten };
  // Build each twin from its closure's rewritten body, so calls inside the
  // twin are devirtualized as well. Large closure bodies become one-block
  // forwarding thunks to their twin so later passes and codegen do not
  // duplicate them.
  for (let index = 0; index < reserved.length; index++) {
    const target = reserved[index];
    if (target === undefined) throw "closure twin invariant";
    const body = functions[target];
    if (body === undefined) throw "closure body invariant";
    const id = module.functions.length + index;
    const built = twin(body, id);
    if (built === undefined) return undefined;
    added.push(built);
    if (
      body.blocks.length >= thunkBlockThreshold &&
      body.scriptEntry === undefined
    )
      functions[target] = thunk(body, id);
  }
  for (const fn of added) {
    if (fn === undefined) throw "closure twin invariant";
    functions.push(fn);
  }
  const records = module.records;
  return {
    module: records === undefined ? { functions } : { records, functions },
    visited,
    rewritten,
  };
}
