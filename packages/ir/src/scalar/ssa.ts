import { analyzeLiveSlots } from "./liveness.ts";
import { instructionResult } from "./operands.ts";
import {
  substituteInstructionValues,
  substituteTerminatorValues,
  substitutedValue,
} from "./substitution.ts";
import {
  slotVariables,
  removedStoreBinding,
  retainDebugValues,
} from "./debug.ts";
import type {
  FunctionIR,
  Block,
  Instruction,
  Terminator,
  ScalarType,
  SlotBinding,
  ValueBinding,
} from "./model.ts";
export interface SSAParameter {
  readonly id: number;
  readonly slot: number;
  readonly type: ScalarType;
}
export interface SSAEdge {
  readonly target: number;
  readonly arguments: readonly number[];
}
export interface SSABlock {
  readonly id: number;
  readonly parameters: readonly SSAParameter[];
  readonly instructions: readonly Instruction[];
  readonly terminator: Terminator;
  readonly edges: readonly SSAEdge[];
  readonly exception?: { readonly target: number; readonly slot: number };
}
export interface SSAFunction {
  readonly source: FunctionIR;
  readonly blocks: readonly SSABlock[];
  readonly valueCount: number;
  readonly promoted: number;
  readonly work: number;
  /** Debug builds: promoted named variables' values (removed stores and
   * block parameters) and the load aliases introduced by promotion. */
  readonly debug?: {
    readonly values: readonly ValueBinding[];
    readonly aliases: Uint32Array;
  };
}
/** Promote unexposed locals to block parameters. Exception-observable storage
 * stays in memory; guarded transfer slots and ABI parameter slots stay explicit.
 * Input must be verified. The result is a separate optimization IR, never passed
 * directly to the block-local backend. Budgets discard incomplete construction. */
export function promoteSlots(
  fn: FunctionIR,
  budget: number,
): SSAFunction | undefined {
  if (!Number.isSafeInteger(budget) || budget < 1) return undefined;
  let work = fn.slots.length * 3,
    maximum = -1;
  if (work > budget) return undefined;
  const eligible = new Uint8Array(fn.slots.length),
    writtenIn = new Uint32Array(fn.slots.length),
    readIn = new Uint32Array(fn.slots.length);
  eligible.fill(1);
  if (fn.receiverSlot !== undefined) eligible[fn.receiverSlot] = 0;
  for (const slot of fn.parameters) {
    if (slot === undefined) return undefined;
    eligible[slot] = 0;
  }
  for (const block of fn.blocks) {
    if (block === undefined || ++work > budget) return undefined;
    if (block.exception !== undefined) eligible.fill(0);
    const term = block.terminator;
    if (
      term.kind === "cell" ||
      term.kind === "record" ||
      term.kind === "record-cell"
    )
      eligible[term.slot] = 0;
    for (const op of block.instructions) {
      if (op === undefined || ++work > budget) return undefined;
      if (op.kind === "host-call") eligible.fill(0);
      if (op.kind === "store" || op.kind === "load") {
        const owners = op.kind === "store" ? writtenIn : readIn;
        const previous = owners[op.slot] ?? 0;
        owners[op.slot] =
          previous === 0 || previous === block.id + 1
            ? block.id + 1
            : 0xffffffff;
      }
      const id = instructionResult(op);
      if (id !== undefined) maximum = Math.max(maximum, id);
    }
  }
  if (maximum > budget) return undefined;
  const tracked: number[] = [];
  for (let slot = 0; slot < fn.slots.length; slot++) {
    if (++work > budget) return undefined;
    const written = writtenIn[slot] ?? 0,
      read = readIn[slot] ?? 0;
    if (
      eligible[slot] === 1 &&
      written !== 0 &&
      read !== 0 &&
      (written !== read || written === 0xffffffff)
    )
      tracked.push(slot);
    else eligible[slot] = 0;
  }
  const liveness = analyzeLiveSlots(fn, budget - work, tracked);
  if (liveness === undefined) return undefined;
  work += liveness.work;
  const dead = liveness.slots;
  const parameters: SSAParameter[][] = [];
  let next = maximum + 1;
  for (const block of fn.blocks) {
    if (block === undefined) return undefined;
    const params: SSAParameter[] = [],
      deadHere = dead[block.id];
    if (deadHere === undefined) return undefined;
    for (const slot of deadHere) {
      if (slot === undefined || ++work > budget) return undefined;
      const type = fn.slots[slot];
      if (type === undefined) return undefined;
      if (block.id !== fn.entry) params.push({ id: next++, slot, type });
    }
    parameters.push(params);
  }
  if (next > budget) return undefined;
  const aliases = new Uint32Array(next),
    slots = new Uint32Array(fn.slots.length),
    epochs = new Uint32Array(fn.slots.length),
    blocks: SSABlock[] = [],
    // Debug builds: promoted named variables hold block parameters and
    // the values of their removed stores.
    variables = slotVariables(fn),
    bindings: ValueBinding[] = [];
  for (const block of fn.blocks) {
    if (block === undefined) return undefined;
    const params = parameters[block.id];
    if (params === undefined) return undefined;
    const instructions: Instruction[] = [];
    const epoch = block.id + 1;
    for (const param of params) {
      if (param === undefined) return undefined;
      slots[param.slot] = param.id + 1;
      epochs[param.slot] = epoch;
      const variable =
        variables === undefined ? -1 : (variables[param.slot] ?? 0) - 1;
      if (variable >= 0)
        bindings.push({ variable, value: param.id, after: -1 });
    }
    let previous = -1;
    for (const op of block.instructions) {
      if (op === undefined || ++work > budget) return undefined;
      if (op.kind === "load" && eligible[op.slot] === 1) {
        const value = epochs[op.slot] === epoch ? (slots[op.slot] ?? 0) : 0;
        if (value === 0) return undefined;
        aliases[op.id] = value;
      } else if (op.kind === "store" && eligible[op.slot] === 1) {
        const stored = substitutedValue(aliases, op.value);
        slots[op.slot] = stored + 1;
        epochs[op.slot] = epoch;
        removedStoreBinding(
          variables,
          { ...op, value: stored },
          previous,
          bindings,
        );
      } else {
        const kept = substituteInstructionValues(op, aliases);
        instructions.push(kept);
        previous = instructionResult(kept) ?? previous;
      }
    }
    const term = substituteTerminatorValues(block.terminator, aliases);
    const targets =
      term.kind === "jump"
        ? [term.target]
        : term.kind === "branch" ||
            term.kind === "record" ||
            term.kind === "record-cell" ||
            term.kind === "cell"
          ? [term.consequent, term.alternate]
          : [];
    const edges: SSAEdge[] = [];
    for (const target of targets) {
      if (target === undefined) return undefined;
      const targetParams = parameters[target],
        args: number[] = [];
      if (targetParams === undefined) return undefined;
      for (const param of targetParams) {
        if (param === undefined || ++work > budget) return undefined;
        const value =
          epochs[param.slot] === epoch ? (slots[param.slot] ?? 0) : 0;
        if (value === 0) return undefined;
        args.push(value - 1);
      }
      edges.push({ target, arguments: args });
    }
    blocks.push({
      ...block,
      parameters: params,
      instructions,
      terminator: term,
      edges,
    });
  }
  return {
    source: fn,
    blocks,
    valueCount: next,
    promoted: tracked.length,
    work,
    ...(fn.debug === undefined ? {} : { debug: { values: bindings, aliases } }),
  };
}
/** Lower block parameters using private storage shared by source variable when
 * outgoing edges agree. Conflicting conditional copies retain distinct slots.
 * All source values are read before stores execute, preserving parallel swaps. */
export function lowerSSA(fn: SSAFunction): FunctionIR {
  const slots = fn.source.slots.slice(),
    locations = new Uint32Array(fn.valueCount),
    shared = new Uint32Array(slots.length),
    blocked = new Uint8Array(slots.length),
    seen = new Uint32Array(slots.length),
    epochs = new Uint32Array(slots.length);
  for (const block of fn.blocks) {
    if (block === undefined) throw "SSA block invariant";
    const epoch = block.id + 1;
    for (const edge of block.edges) {
      if (edge === undefined) throw "SSA edge invariant";
      const target = fn.blocks[edge.target];
      if (
        target === undefined ||
        target.parameters.length !== edge.arguments.length
      )
        throw "SSA edge arity";
      for (let index = 0; index < edge.arguments.length; index++) {
        const param = target.parameters[index],
          value = edge.arguments[index];
        if (param === undefined || value === undefined)
          throw "SSA argument invariant";
        if (fn.source.slots[param.slot] !== param.type)
          throw "SSA source slot type";
        if (epochs[param.slot] === epoch && seen[param.slot] !== value)
          blocked[param.slot] = 1;
        epochs[param.slot] = epoch;
        seen[param.slot] = value;
      }
    }
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "SSA block invariant";
    for (const param of block.parameters) {
      if (param === undefined) throw "SSA parameter invariant";
      const existing = shared[param.slot] ?? 0;
      if (blocked[param.slot] !== 1 && existing !== 0) {
        locations[param.id] = existing - 1;
      } else {
        locations[param.id] = slots.length;
        if (blocked[param.slot] !== 1) shared[param.slot] = slots.length + 1;
        slots.push(param.type);
      }
    }
  }
  epochs.fill(0);
  const blocks: Block[] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "SSA block invariant";
    const terminator = block.terminator;
    const targets =
      terminator.kind === "jump"
        ? [terminator.target]
        : terminator.kind === "branch" ||
            terminator.kind === "record" ||
            terminator.kind === "record-cell" ||
            terminator.kind === "cell"
          ? [terminator.consequent, terminator.alternate]
          : [];
    if (targets.length !== block.edges.length) throw "SSA edge target count";
    for (let edgeIndex = 0; edgeIndex < targets.length; edgeIndex++)
      if (block.edges[edgeIndex]?.target !== targets[edgeIndex])
        throw "SSA edge target mismatch";
    const instructions: Instruction[] = [],
      span = block.terminator;
    // Lowered parameter slots are fresh: only parameter loads and edge stores
    // touch them, so a parameter still holds its entry value at every edge.
    const ownParameters = new Set<number>();
    for (const param of block.parameters) {
      if (param === undefined) throw "SSA parameter invariant";
      ownParameters.add(param.id);
      instructions.push({
        kind: "load",
        id: param.id,
        slot: locations[param.id] ?? 0,
        start: span.start,
        end: span.end,
      });
    }
    for (const op of block.instructions) {
      if (op === undefined) throw "SSA instruction invariant";
      instructions.push(op);
    }
    for (const edge of block.edges) {
      if (edge === undefined) throw "SSA edge invariant";
      const target = fn.blocks[edge.target];
      if (
        target === undefined ||
        target.parameters.length !== edge.arguments.length
      )
        throw "SSA edge arity";
      for (let index = 0; index < edge.arguments.length; index++) {
        const param = target.parameters[index],
          value = edge.arguments[index];
        if (param === undefined || value === undefined)
          throw "SSA argument invariant";
        if (blocked[param.slot] !== 1) {
          // The proof above established identical values on every outgoing edge.
          if (epochs[param.slot] === block.id + 1) continue;
          epochs[param.slot] = block.id + 1;
        }
        // A value passed through unchanged to its own location is already there.
        if (
          ownParameters.has(value) &&
          locations[value] === locations[param.id]
        )
          continue;
        instructions.push({
          kind: "store",
          slot: locations[param.id] ?? 0,
          value,
          start: span.start,
          end: span.end,
        });
      }
    }
    const original = fn.source.blocks[block.id];
    if (original === undefined) throw "SSA source block invariant";
    blocks.push({ ...original, instructions, terminator: block.terminator });
  }
  const debug = fn.source.debug,
    promotion = fn.debug;
  if (debug === undefined || promotion === undefined)
    return { ...fn.source, slots, blocks };
  // A named variable's parameter storage holds it across the edges.
  const variables = slotVariables(fn.source),
    slotBindings: SlotBinding[] = debug.slots.slice(),
    bound = new Set<number>();
  if (variables !== undefined)
    for (const block of fn.blocks) {
      if (block === undefined) throw "SSA block invariant";
      for (const param of block.parameters) {
        if (param === undefined) throw "SSA parameter invariant";
        const variable = (variables[param.slot] ?? 0) - 1,
          location = locations[param.id] ?? 0;
        if (variable < 0 || bound.has(location)) continue;
        bound.add(location);
        slotBindings.push({ slot: location, variable });
      }
    }
  const retained = retainDebugValues(
    { ...fn.source, debug: { ...debug, slots: slotBindings } },
    blocks,
    promotion.values,
    promotion.aliases,
  );
  return retained === undefined
    ? { ...fn.source, slots, blocks }
    : { ...fn.source, slots, blocks, debug: retained };
}
