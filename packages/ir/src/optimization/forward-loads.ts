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
} from "../scalar/index.ts";
import { hasScriptOperations } from "./control-flow.ts";
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
    loads = 0;
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
      if (op.kind === "load") loads++;
    }
  }
  // The alias table is indexed by value ID: bound it by the instruction
  // count, with slack for the sparse IDs later passes leave behind.
  if (loads === 0 || maximum > count * 16 + 4096)
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
  const hasGeneral = hasScriptOperations(fn);
  const numberValues = hasGeneral ? new Set<number>() : undefined;
  const wrappedNumbers = hasGeneral ? new Map<number, number>() : undefined;
  function producesNumber(op: Instruction): boolean {
    switch (op.kind) {
      case "constant":
        return typeof op.value === "number";
      case "load":
        return fn.slots[op.slot] === "number";
      case "general-value":
        return op.type === "number";
      case "string-length":
      case "string-code-unit":
        return true;
      case "unary":
        return (
          op.operator === "-" ||
          op.operator === "+" ||
          op.operator === "~" ||
          op.operator === "ceil" ||
          op.operator === "trunc" ||
          op.operator === "sqrt" ||
          op.operator === "uint32" ||
          op.operator === "boolean-number"
        );
      case "binary":
        switch (op.operator) {
          case "+":
          case "-":
          case "*":
          case "/":
          case "%":
          case "**":
          case "&":
          case "|":
          case "^":
          case "<<":
          case ">>":
          case ">>>":
          case "imul":
          case "min":
          case "max":
            return true;
        }
        return false;
    }
    return false;
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "forward block invariant";
    epoch++;
    numberValues?.clear();
    wrappedNumbers?.clear();
    const instructions: Instruction[] = [];
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
        wrappedNumbers !== undefined &&
        rewritten.kind === "general-value" &&
        rewritten.type === "number"
      ) {
        const unwrapped = wrappedNumbers.get(rewritten.value);
        if (unwrapped !== undefined) {
          aliases[rewritten.id] = unwrapped + 1;
          forwarded++;
          changed = true;
          continue;
        }
      }
      if (
        wrappedNumbers !== undefined &&
        rewritten.kind === "general-is" &&
        rewritten.type === "number" &&
        wrappedNumbers.has(rewritten.value)
      ) {
        instructions.push({
          kind: "constant",
          id: rewritten.id,
          value: true,
          start: rewritten.start,
          end: rewritten.end,
        });
        forwarded++;
        changed = true;
        continue;
      }
      instructions.push(rewritten);
      if (rewritten !== op) changed = true;
      if (numberValues !== undefined) {
        const resultId = instructionResult(rewritten);
        if (resultId !== undefined && producesNumber(rewritten))
          numberValues.add(resultId);
        if (
          rewritten.kind === "general-wrap" &&
          numberValues.has(rewritten.value)
        )
          wrappedNumbers?.set(rewritten.id, rewritten.value);
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
