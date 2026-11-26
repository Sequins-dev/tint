import {
  instructionResult,
  type Block,
  type FunctionIR,
  type Instruction,
  type ModuleIR,
} from "../scalar/index.ts";
import type { RemarkSink } from "./observer.ts";

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
  let hasScriptEntries = false;
  for (const fn of module.functions) {
    if (fn !== undefined && fn.scriptEntry === true) {
      hasScriptEntries = true;
      break;
    }
  }
  let fieldTargets = new Map<number, KnownClosure>(),
    unknownFields = new Set<number>();
  function fieldTarget(
    record: number,
    field: number,
  ): KnownClosure | undefined {
    if (!closedRecords) return undefined;
    const key = record * 65536 + field;
    return unknownFields.has(key) ? undefined : fieldTargets.get(key);
  }
  /** Slot facts of `fn` under the current field facts. Propagates closures
   * through both direct writes (`function-new`, `record`/`record-cell` reads,
   * `record-read`) and slot-to-slot copies (`v = load sA; store sB v`) so
   * environment-captured imports copied into call temporaries devirtualize. */
  function slotFacts(fn: FunctionIR): SlotFacts | undefined {
    const targets = new Map<number, KnownClosure>(),
      unknown = new Set<number>(),
      // Slot -> slots it is copied from (store of a load).
      copies = new Map<number, number[]>();
    for (const parameter of fn.parameters)
      if (parameter !== undefined) unknown.add(parameter);
    if (fn.receiverSlot !== undefined) unknown.add(fn.receiverSlot);
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
    // Indexed by value ID, one array per function: value IDs are unique
    // within it. (A fresh array per block would grow to the function's
    // largest ID in every block: dense native lists fill the gap.)
    const local: (KnownClosure | undefined)[] = [],
      // Slot (+ 1) a value loads, for stores that copy another slot.
      loaded: number[] = [];
    for (const block of fn.blocks) {
      if (block === undefined) throw "closure block invariant";
      if (block.exception !== undefined) unknown.add(block.exception.slot);
      const term = block.terminator;
      // Reads of closure fields store their closure in the transfer slot.
      if (
        term.kind === "record" ||
        term.kind === "record-cell" ||
        term.kind === "cell"
      )
        write(
          term.slot,
          term.kind !== "cell" && term.operation === "read"
            ? fieldTarget(term.record, term.field)
            : undefined,
        );
      for (const op of block.instructions) {
        if (op === undefined) throw "closure instruction invariant";
        if (visited >= budget) return undefined;
        visited++;
        if (op.kind === "function-new" && eligible(op.target))
          local[op.id] = {
            target: op.target,
            environment: op.environment !== undefined,
          };
        else if (hasScriptEntries && op.kind === "record-read")
          local[op.id] = fieldTarget(op.record, op.field);
        else if (op.kind === "load") loaded[op.id] = op.slot + 1;
        else if (op.kind === "store") {
          const source = loaded[op.value] ?? 0;
          // Storing a slot's own value back changes nothing.
          if (source - 1 === op.slot) continue;
          if (source !== 0) {
            // A copy (as an inlined callee's result reaches its caller's
            // variable): the slot holds what the source slot holds.
            const sources = copies.get(op.slot);
            if (sources === undefined) copies.set(op.slot, [source - 1]);
            else sources.push(source - 1);
          } else write(op.slot, local[op.value]);
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
    const writeField = (key: number, known: KnownClosure | undefined): void => {
      const previous = nextTargets.get(key);
      if (known === undefined) nextUnknown.add(key);
      else if (previous === undefined) nextTargets.set(key, known);
      else if (previous.target !== known.target) nextUnknown.add(key);
    };
    for (const fn of module.functions) {
      if (fn === undefined) throw "closure function invariant";
      const own = slotFacts(fn);
      if (own === undefined) return undefined;
      const slotTarget = (slot: number): KnownClosure | undefined =>
        own.unknown.has(slot) ? undefined : own.targets.get(slot);
      // By value ID and by slot, one array per function (see slotFacts);
      // `stored` holds this block's stores to the slots in `storedHere`.
      const local: (KnownClosure | undefined)[] = [],
        stored: (KnownClosure | undefined)[] = [];
      for (const block of fn.blocks) {
        if (block === undefined) throw "closure block invariant";
        // Slots stored in this block (their closures in `stored`).
        const storedHere = new Set<number>();
        for (const op of block.instructions) {
          if (op === undefined) throw "closure instruction invariant";
          if (visited >= budget) return undefined;
          visited++;
          if (op.kind === "function-new" && eligible(op.target))
            local[op.id] = {
              target: op.target,
              environment: op.environment !== undefined,
            };
          else if (hasScriptEntries && op.kind === "record-read")
            local[op.id] = fieldTarget(op.record, op.field);
          else if (op.kind === "store") {
            stored[op.slot] = local[op.value];
            storedHere.add(op.slot);
          } else if (op.kind === "load")
            local[op.id] = storedHere.has(op.slot)
              ? stored[op.slot]
              : slotTarget(op.slot);
          else if (op.kind === "record-new") {
            const fields = recordLayouts[op.record]?.fields;
            for (let field = 0; field < op.arguments.length; field++) {
              const argument = op.arguments[field];
              if (
                argument === undefined &&
                fields?.[field]?.stateOffset !== undefined
              )
                continue;
              writeField(
                op.record * 65536 + field,
                argument === undefined ? undefined : local[argument],
              );
            }
          }
        }
        const term = block.terminator;
        if (
          (term.kind === "record" || term.kind === "record-cell") &&
          term.operation !== "read"
        )
          writeField(
            term.record * 65536 + term.field,
            storedHere.has(term.slot)
              ? stored[term.slot]
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
      // By value ID, one array per function (see slotFacts).
      known: (KnownClosure | undefined)[] = [];
    for (const block of fn.blocks) {
      if (block === undefined) throw "closure block invariant";
      let instructions: Instruction[] | undefined;
      for (let i = 0; i < block.instructions.length; i++) {
        const op = block.instructions[i];
        if (op === undefined) throw "closure instruction invariant";
        if (visited >= budget) return undefined;
        visited++;
        if (op.kind === "function-new" && eligible(op.target))
          known[op.id] = {
            target: op.target,
            environment: op.environment !== undefined,
          };
        else if (hasScriptEntries && op.kind === "record-read")
          known[op.id] = fieldTarget(op.record, op.field);
        else if (op.kind === "load") {
          const slotKnown = slotTargets.get(op.slot);
          if (slotKnown !== undefined && !unknown.has(op.slot))
            known[op.id] = slotKnown;
        }
        if (instructions !== undefined) instructions.push(op);
        if (op.kind !== "call-indirect" || op.scriptArguments !== undefined)
          continue;
        const closure = known[op.callee];
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
  // twin are devirtualized as well.
  for (let index = 0; index < reserved.length; index++) {
    const target = reserved[index];
    if (target === undefined) throw "closure twin invariant";
    const body = functions[target];
    if (body === undefined) throw "closure body invariant";
    const id = module.functions.length + index;
    const built = twin(body, id);
    if (built === undefined) return undefined;
    added.push(built);
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
