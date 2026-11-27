import {
  instructionResult,
  type Block,
  type FunctionIR,
  type Instruction,
  type ModuleIR,
  type ScalarType,
} from "../scalar/index.ts";
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
        if (op.kind !== "closure-environment") continue;
        if (instructions === undefined)
          instructions = block.instructions.slice();
        instructions[i] = {
          kind: "load",
          id: op.id,
          slot: environmentSlot,
          start: op.start,
          end: op.end,
        };
      }
      blocks.push(
        instructions === undefined ? block : { ...block, instructions },
      );
    }
    const slots = fn.slots.slice();
    const parameters = fn.parameters.slice();
    if (fn.receiverSlot !== undefined) parameters.push(fn.receiverSlot);
    if (fn.closureEnvironment !== undefined) {
      slots.push("reference");
      parameters.push(environmentSlot);
    }
    // The body keeps its source-debugging metadata: an earlier inlining
    // round may have left inline sites its instructions refer to.
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
    return fn.debug === undefined ? twin : { ...twin, debug: fn.debug };
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
    if (fn.closureEnvironment !== undefined) {
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
  const fnCount = module.functions.length,
    hasCallIndirect = new Uint8Array(fnCount),
    hasClosureSource = new Uint8Array(fnCount),
    activeRecordWriters: FunctionIR[] = [],
    staticUnknownFields = new Set<number>();
  for (const fn of module.functions) {
    if (fn === undefined) throw "closure function invariant";
    let callsIndirect = false,
      closureSource = false,
      writesRefField = false;
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
        if (op.kind === "function-new" && eligible(op.target))
          closureSource = true;
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
    if (callsIndirect) hasCallIndirect[fn.id] = 1;
    if (closureSource) hasClosureSource[fn.id] = 1;
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
    for (const parameter of fn.parameters)
      if (parameter !== undefined && isClosureSlot(fn.slots[parameter]))
        unknown.add(parameter);
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
      // Reads of closure fields store their closure in the transfer slot.
      if (
        (term.kind === "record" ||
          term.kind === "record-cell" ||
          term.kind === "cell") &&
        isClosureSlot(fn.slots[term.slot])
      )
        write(
          term.slot,
          term.kind !== "cell" &&
            term.operation === "read" &&
            fn.slots[term.slot] === "reference"
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
    let same = nextTargets.size === fieldTargets.size;
    for (const [key, known] of nextTargets)
      if (
        fieldTargets.get(key)?.target !== known.target ||
        nextUnknown.has(key) !== unknownFields.has(key)
      )
        same = false;
    if (nextUnknown.size !== unknownFields.size) same = false;
    fieldTargets = nextTargets;
    unknownFields = nextUnknown;
    if (same) break;
  }
  const functions: FunctionIR[] = [];
  for (const fn of module.functions) {
    if (fn === undefined) throw "closure function invariant";
    if (
      hasCallIndirect[fn.id] !== 1 ||
      (remarks === undefined && hasClosureSource[fn.id] !== 1)
    ) {
      functions.push(fn);
      continue;
    }
    const own = slotFacts(fn);
    if (own === undefined) return undefined;
    const slotTargets = own.targets,
      unknown = own.unknown,
      candidates = own.candidates;
    if (!candidates) {
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
      known = new Map<number, KnownClosure>();
    for (const block of fn.blocks) {
      if (block === undefined) throw "closure block invariant";
      let instructions: Instruction[] | undefined;
      for (let i = 0; i < block.instructions.length; i++) {
        const op = block.instructions[i];
        if (op === undefined) throw "closure instruction invariant";
        if (visited >= budget) return undefined;
        visited++;
        if (op.kind === "function-new" && eligible(op.target))
          known.set(op.id, {
            target: op.target,
            environment: op.environment !== undefined,
          });
        else if (op.kind === "record-read") {
          const fieldKnown = fieldTarget(op.record, op.field);
          if (fieldKnown !== undefined) known.set(op.id, fieldKnown);
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
        if (closure.environment) {
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
