import {
  instructionResult,
  instructionEffects,
  effectInvoke,
  effectUnknown,
  visitInstructionOperands,
  visitTerminatorOperands,
  substituteInstructionValues,
  substituteTerminatorValues,
  retainDebugValues,
  type FunctionIR,
  type Block,
  type Instruction,
  type ScalarType,
} from "../scalar/index.ts";
export interface ForwardedLoads {
  readonly fn: FunctionIR;
  readonly forwarded: number;
  readonly visited: number;
}
/** Verified block-local SSA. Local stores/loads establish canonical aliases;
 * joins and opaque effects invalidate slot knowledge. Allocation and known
 * calls cannot change unexposed local storage.
 * SSA snapshots stay immutable across those barriers. Stores remain for later
 * liveness cleanup, including stores observed by exception handlers. */
export function forwardLocalLoads(
  fn: FunctionIR,
  budget: number,
  effects?: Uint32Array,
): ForwardedLoads | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0)
    throw "INVALID_OPTIMIZATION_BUDGET";
  let visited = 0,
    maximum = -1,
    count = 0,
    candidates = 0,
    hasWrap = false;
  for (const block of fn.blocks) {
    if (block === undefined) throw "forward block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "forward instruction invariant";
      if (++visited > budget) return undefined;
      const id = instructionResult(op);
      if (id !== undefined) {
        maximum = Math.max(maximum, id);
        count++;
      }
      if (
        op.kind === "load" ||
        op.kind === "reference-value" ||
        op.kind === "general-value"
      )
        candidates++;
      if (op.kind === "reference-wrap" || op.kind === "general-wrap")
        hasWrap = true;
    }
  }
  // The alias table is indexed by value ID: bound it by the instruction
  // count, with slack for the sparse IDs later passes leave behind.
  if (candidates === 0 || maximum > count * 16 + 4096)
    return { fn, visited, forwarded: 0 };
  visited += maximum + 1 + fn.slots.length * 2;
  if (visited > budget) return undefined;
  const aliases = new Uint32Array(maximum + 1),
    slots = new Uint32Array(fn.slots.length),
    epochs = new Uint32Array(fn.slots.length),
    blocks: Block[] = [];
  let epoch = 0,
    forwarded = 0;
  function operand(_id: number): void {
    visited++;
  }
  function knownScalarType(
    op: Instruction,
    types: ReadonlyMap<number, ScalarType>,
  ): ScalarType | undefined {
    if (op.kind === "load") return fn.slots[op.slot];
    if (op.kind === "constant") {
      const literal = op.value;
      return typeof literal === "number" ? "number" : "boolean";
    }
    if (
      op.kind === "record-new" ||
      op.kind === "function-new" ||
      op.kind === "error-new"
    )
      return "reference";
    if (op.kind === "reference-value") return op.type ?? "reference";
    if (op.kind === "general-value") return op.type;
    if (
      op.kind === "string-literal" ||
      op.kind === "string-concat" ||
      op.kind === "string-slice" ||
      op.kind === "string-value"
    )
      return "string";
    if (op.kind === "optional-value" || op.kind === "optional-value-or")
      return "number";
    return types.get(instructionResult(op) ?? -1);
  }
  const valueTypes = new Map<number, ScalarType>(),
    wrappedReference = new Map<number, number>(),
    wrappedGeneral = new Map<
      number,
      { readonly value: number; readonly type: ScalarType }
    >();
  for (const block of fn.blocks) {
    if (block === undefined) throw "forward block invariant";
    epoch++;
    const instructions: Instruction[] = [];
    if (hasWrap) {
      valueTypes.clear();
      wrappedReference.clear();
      wrappedGeneral.clear();
    }
    let changed = false;
    for (const op of block.instructions) {
      if (op === undefined) throw "forward instruction invariant";
      visited++;
      visitInstructionOperands(op, operand);
      if (visited > budget) return undefined;
      if (op.kind === "load") {
        const known = epochs[op.slot] === epoch ? (slots[op.slot] ?? 0) : 0;
        if (known !== 0) {
          aliases[op.id] = known;
          forwarded++;
          changed = true;
          continue;
        }
        slots[op.slot] = op.id + 1;
        epochs[op.slot] = epoch;
      }
      const rewritten = substituteInstructionValues(op, aliases);
      if (
        hasWrap &&
        rewritten.kind === "reference-value" &&
        rewritten.type === undefined
      ) {
        const unwrapped = wrappedReference.get(rewritten.value);
        if (unwrapped !== undefined) {
          aliases[rewritten.id] = unwrapped + 1;
          forwarded++;
          changed = true;
          continue;
        }
      }
      if (
        hasWrap &&
        rewritten.kind === "general-value" &&
        (rewritten.type === "reference" ||
          rewritten.type === "number" ||
          rewritten.type === "boolean" ||
          rewritten.type === "string")
      ) {
        const wrapped = wrappedGeneral.get(rewritten.value);
        if (wrapped !== undefined && wrapped.type === rewritten.type) {
          aliases[rewritten.id] = wrapped.value + 1;
          forwarded++;
          changed = true;
          continue;
        }
      }
      instructions.push(rewritten);
      if (rewritten !== op) changed = true;
      if (hasWrap) {
        const resultId = instructionResult(rewritten);
        if (resultId !== undefined) {
          const t = knownScalarType(rewritten, valueTypes);
          if (t !== undefined) valueTypes.set(resultId, t);
        }
        if (rewritten.kind === "reference-wrap")
          wrappedReference.set(rewritten.id, rewritten.value);
        else if (rewritten.kind === "general-wrap") {
          const t = valueTypes.get(rewritten.value);
          if (
            t === "reference" ||
            t === "number" ||
            t === "boolean" ||
            t === "string"
          )
            wrappedGeneral.set(rewritten.id, {
              value: rewritten.value,
              type: t,
            });
        }
      }
      if (rewritten.kind === "store") {
        slots[rewritten.slot] = rewritten.value + 1;
        epochs[rewritten.slot] = epoch;
      }
      const effect =
        op.kind === "call"
          ? effects === undefined
            ? effectUnknown
            : (effects[op.target] ?? effectUnknown)
          : instructionEffects(op);
      if ((effect & effectInvoke) !== 0) epoch++;
    }
    visitTerminatorOperands(block.terminator, operand);
    if (++visited > budget) return undefined;
    const terminator = substituteTerminatorValues(block.terminator, aliases);
    blocks.push(
      changed || terminator !== block.terminator
        ? { ...block, instructions, terminator }
        : block,
    );
  }
  if (forwarded === 0) return { fn, visited, forwarded };
  // Debug value bindings follow the forwarded values.
  const debug =
    fn.debug === undefined
      ? undefined
      : retainDebugValues(fn, blocks, [], aliases);
  return {
    fn: debug === undefined ? { ...fn, blocks } : { ...fn, blocks, debug },
    visited,
    forwarded,
  };
}
