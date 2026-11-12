import {
  instructionResult,
  type Block,
  type FunctionIR,
  type Instruction,
  type ModuleIR,
} from "../scalar/index.ts";

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
      fn !== undefined &&
      fn.import !== true &&
      fn.receiverSlot === undefined &&
      fn.environment === undefined
    );
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
    if (fn.closureEnvironment === undefined) {
      twins[target] = target;
      return target;
    }
    const id = module.functions.length + reserved.length;
    reserved.push(target);
    twins[target] = id;
    return id;
  }
  /** The twin of a closure body: its environment is a trailing parameter. */
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
    slots.push("reference");
    const parameters = fn.parameters.slice();
    parameters.push(environmentSlot);
    return {
      id,
      name: fn.name + "$direct",
      exported: false,
      parameters,
      slots,
      returnType: fn.returnType,
      entry: fn.entry,
      blocks,
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
  const fieldTargets = new Map<number, KnownClosure>(),
    unknownFields = new Set<number>();
  function writeField(key: number, known: KnownClosure | undefined): void {
    const previous = fieldTargets.get(key);
    if (known === undefined) unknownFields.add(key);
    else if (previous === undefined) fieldTargets.set(key, known);
    else if (previous.target !== known.target) unknownFields.add(key);
  }
  for (const fn of module.functions) {
    if (fn === undefined) throw "closure function invariant";
    for (const block of fn.blocks) {
      if (block === undefined) throw "closure block invariant";
      const local: (KnownClosure | undefined)[] = [],
        // Closures stored to slots in this block (absent: unknown).
        stored: (KnownClosure | undefined)[] = [];
      for (const op of block.instructions) {
        if (op === undefined) throw "closure instruction invariant";
        if (visited >= budget) return undefined;
        visited++;
        if (op.kind === "function-new" && eligible(op.target))
          local[op.id] = {
            target: op.target,
            environment: op.environment !== undefined,
          };
        else if (op.kind === "store") stored[op.slot] = local[op.value];
        else if (op.kind === "load") local[op.id] = stored[op.slot];
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
        writeField(term.record * 65536 + term.field, stored[term.slot]);
    }
  }
  function fieldTarget(
    record: number,
    field: number,
  ): KnownClosure | undefined {
    if (!closedRecords) return undefined;
    const key = record * 65536 + field;
    return unknownFields.has(key) ? undefined : fieldTargets.get(key);
  }
  const functions: FunctionIR[] = [];
  for (const fn of module.functions) {
    if (fn === undefined) throw "closure function invariant";
    // Slots every write of which stores a closure of one target; slots with
    // any other write (or an entry value) are in `unknown`.
    const slotTargets = new Map<number, KnownClosure>(),
      unknown = new Set<number>();
    for (const parameter of fn.parameters)
      if (parameter !== undefined) unknown.add(parameter);
    if (fn.receiverSlot !== undefined) unknown.add(fn.receiverSlot);
    let candidates = false;
    for (const block of fn.blocks) {
      if (block === undefined) throw "closure block invariant";
      if (block.exception !== undefined) unknown.add(block.exception.slot);
      const term = block.terminator;
      // Reads of closure fields store their closure in the transfer slot.
      const read =
        (term.kind === "record" || term.kind === "record-cell") &&
        term.operation === "read"
          ? fieldTarget(term.record, term.field)
          : undefined;
      if (
        term.kind === "record" ||
        term.kind === "record-cell" ||
        term.kind === "cell"
      ) {
        const previous = slotTargets.get(term.slot);
        if (read === undefined) unknown.add(term.slot);
        else if (previous === undefined) slotTargets.set(term.slot, read);
        else if (previous.target !== read.target) unknown.add(term.slot);
      }
      const local: (KnownClosure | undefined)[] = [];
      for (const op of block.instructions) {
        if (op === undefined) throw "closure instruction invariant";
        if (visited >= budget) return undefined;
        visited++;
        if (op.kind === "function-new" && eligible(op.target))
          local[op.id] = {
            target: op.target,
            environment: op.environment !== undefined,
          };
        else if (op.kind === "store") {
          const known = local[op.value],
            previous = slotTargets.get(op.slot);
          if (known === undefined) unknown.add(op.slot);
          else if (previous === undefined) slotTargets.set(op.slot, known);
          else if (previous.target !== known.target) unknown.add(op.slot);
        } else if (op.kind === "call-indirect") candidates = true;
      }
    }
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
    const blocks: Block[] = [];
    for (const block of fn.blocks) {
      if (block === undefined) throw "closure block invariant";
      const known: (KnownClosure | undefined)[] = [];
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
        else if (op.kind === "load") {
          const slotKnown = slotTargets.get(op.slot);
          if (slotKnown !== undefined && !unknown.has(op.slot))
            known[op.id] = slotKnown;
        }
        if (instructions !== undefined) instructions.push(op);
        if (op.kind !== "call-indirect" || op.receiver !== undefined) continue;
        const closure = known[op.callee];
        if (closure === undefined) continue;
        const target = module.functions[closure.target];
        if (
          target === undefined ||
          target.parameters.length !== op.arguments.length ||
          (target.closureEnvironment === undefined) === closure.environment
        )
          continue;
        const callee = direct(closure.target);
        if (callee === undefined) continue;
        if (instructions === undefined)
          instructions = block.instructions.slice(0, i);
        else instructions.pop();
        const args = op.arguments.slice();
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
