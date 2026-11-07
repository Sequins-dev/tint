import {
  instructionResult,
  visitInstructionOperands,
  visitTerminatorOperands,
  type ModuleIR,
  type FunctionIR,
  type Instruction,
  type Block,
  type ScalarType,
  type Terminator,
} from "../scalar/index.ts";
export interface Inlining {
  readonly module: ModuleIR;
  readonly visited: number;
  readonly inlined: number;
}
function scalar(type: ScalarType): boolean {
  return (
    type === "number" ||
    type === "boolean" ||
    type === "optional-number" ||
    type === "optional-boolean"
  );
}
function supported(op: Instruction): boolean {
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
    case "boolean-none":
    case "boolean-wrap":
    case "boolean-present":
    case "boolean-value":
    case "reference-none":
    case "reference-wrap":
    case "reference-value":
    case "record-read":
    case "array-read":
    case "array-valid":
    case "array-length":
      return true;
    case "host-call":
      return op.operation === "memory-read-word";
    default:
      return false;
  }
}
/** Inline bounded nonallocating direct-call CFGs. Straight-line parameters alias
 * caller values. CFG parameters use traced slots with ordinary slot liveness.
 * Block-local caller temporaries may not cross a CFG expansion. Locals may also
 * hold typed-array aliases; scalar and traced reference results use private slots.
 * Environments, calls, allocation, stores to heap, and callee
 * handlers are excluded. Caller exception edges survive cloning. Input is verified
 * IR and never mutated. Budget exhaustion discards all partial transformations. */
export function inlineSmallFunctions(
  module: ModuleIR,
  budget: number,
  guarded: boolean = false,
): Inlining | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0)
    throw "INVALID_OPTIMIZATION_BUDGET";
  const eligible = new Uint8Array(module.functions.length),
    costs: number[] = [];
  let visited = 0,
    inlined = 0;
  for (const fn of module.functions) {
    if (fn === undefined) throw "inline function invariant";
    let good =
        fn.import !== true &&
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
      cost = fn.parameters.length + (fn.returnType === "void" ? 0 : 1),
      returns = 0;
    for (let slot = 0; slot < fn.slots.length; slot++) {
      const type = fn.slots[slot];
      if (type === undefined) throw "inline slot invariant";
      if (
        !scalar(type) &&
        type !== "reference" &&
        type !== "optional-reference" &&
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
      if (visited >= budget) return undefined;
      visited++;
      cost++;
      if (block.exception !== undefined) good = false;
      const term = block.terminator;
      if (term.kind === "return") returns++;
      if (
        (term.kind === "record" && term.operation !== "read") ||
        term.kind === "record-cell" ||
        term.kind === "cell"
      )
        good = false;
      for (const op of block.instructions) {
        if (op === undefined) throw "inline instruction invariant";
        if (visited >= budget) return undefined;
        visited++;
        cost++;
        if (
          !supported(op) ||
          (op.kind === "store" &&
            fn.blocks.length === 1 &&
            fn.parameters.includes(op.slot))
        )
          good = false;
      }
    }
    eligible[fn.id] =
      good && cost <= (guarded ? 128 : 64) && returns > 0 ? 1 : 0;
    costs[fn.id] = cost;
  }
  const functions: FunctionIR[] = [];
  for (const fn of module.functions) {
    if (fn === undefined) throw "inline function invariant";
    let nextValue = 0,
      nextBlock = 0,
      originalCount = 0,
      hasCandidate = false;
    for (const block of fn.blocks) {
      if (block === undefined) throw "inline block invariant";
      nextBlock = Math.max(nextBlock, block.id + 1);
      for (const op of block.instructions) {
        if (op === undefined) throw "inline instruction invariant";
        const id = instructionResult(op);
        if (id !== undefined) nextValue = Math.max(nextValue, id + 1);
        originalCount++;
        if (
          op.kind === "call" &&
          eligible[op.target] &&
          op.target !== fn.id &&
          op.environment === undefined
        )
          hasCandidate = true;
      }
    }
    if (!hasCandidate) {
      functions.push(fn);
      continue;
    }
    let allowance = originalCount + 128,
      changed = false;
    const slots: ScalarType[] = fn.slots.slice(),
      blocks: Block[] = [];
    for (const block of fn.blocks) {
      if (block === undefined) throw "inline block invariant";
      let current = block.id,
        instructions: Instruction[] = [];
      const positions = new Map<number, number>();
      let mappedPositions = false;
      for (let position = 0; position < block.instructions.length; position++) {
        const op = block.instructions[position];
        if (op === undefined) throw "inline instruction invariant";
        if (visited >= budget) return undefined;
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
          cost > allowance
        ) {
          instructions.push(op);
          continue;
        }
        const straight = callee.blocks.length === 1;
        if (!straight) {
          if (!mappedPositions) {
            mappedPositions = true;
            for (let i = 0; i < block.instructions.length; i++) {
              if (visited >= budget) return undefined;
              visited++;
              const instruction = block.instructions[i];
              if (instruction === undefined)
                throw "inline instruction invariant";
              const id = instructionResult(instruction);
              if (id !== undefined) positions.set(id, i);
            }
          }
          const definitions = positions;
          let crosses = false;
          const check = (id: number): void => {
            if ((definitions.get(id) ?? position) < position) crosses = true;
          };
          for (let i = position + 1; i < block.instructions.length; i++) {
            if (visited >= budget) return undefined;
            visited++;
            const later = block.instructions[i];
            if (later === undefined) throw "inline instruction invariant";
            visitInstructionOperands(later, check);
          }
          visitTerminatorOperands(block.terminator, check);
          if (crosses) {
            instructions.push(op);
            continue;
          }
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
        if (nextValue > 0xffffffff || nextBlock > 0xffffffff) return undefined;
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
            },
          };
        }
        for (const source of callee.blocks) {
          if (source === undefined) throw "inline block invariant";
          const cloned: Instruction[] = [];
          for (const instruction of source.instructions) {
            if (instruction === undefined) throw "inline instruction invariant";
            if (visited >= budget) return undefined;
            visited++;
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
                  start: op.start,
                  end: op.end,
                });
                break;
              case "load":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  slot: slot(instruction.slot),
                  start: op.start,
                  end: op.end,
                });
                break;
              case "store":
                cloned.push({
                  ...instruction,
                  slot: slot(instruction.slot),
                  value: value(instruction.value),
                  start: op.start,
                  end: op.end,
                });
                break;
              case "unary":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  operand: value(instruction.operand),
                  start: op.start,
                  end: op.end,
                });
                break;
              case "binary":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  left: value(instruction.left),
                  right: value(instruction.right),
                  start: op.start,
                  end: op.end,
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
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  value: value(instruction.value),
                  start: op.start,
                  end: op.end,
                });
                break;
              case "array-length":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  array: value(instruction.array),
                  start: op.start,
                  end: op.end,
                });
                break;
              case "array-read":
              case "array-valid":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  array: value(instruction.array),
                  index: value(instruction.index),
                  start: op.start,
                  end: op.end,
                });
                break;
              case "record-read":
                cloned.push({
                  ...instruction,
                  id: value(instruction.id),
                  object: value(instruction.object),
                  start: op.start,
                  end: op.end,
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
                  start: op.start,
                  end: op.end,
                });
                break;
              default:
                throw "inline candidate invariant";
            }
          }
          const term = source.terminator;
          let terminator: Terminator;
          if (term.kind === "return") {
            if (resultSlot >= 0) {
              if (term.value === undefined) throw "inline return invariant";
              cloned.push({
                kind: "store",
                slot: resultSlot,
                value: value(term.value),
                start: op.start,
                end: op.end,
              });
            }
            terminator = {
              kind: "jump",
              target: continuation,
              start: op.start,
              end: op.end,
            };
          } else if (term.kind === "branch")
            terminator = {
              ...term,
              condition: value(term.condition),
              consequent: target(term.consequent),
              alternate: target(term.alternate),
              start: op.start,
              end: op.end,
            };
          else if (term.kind === "record" && term.operation === "read")
            terminator = {
              ...term,
              object: value(term.object),
              slot: slot(term.slot),
              consequent: target(term.consequent),
              alternate: target(term.alternate),
              start: op.start,
              end: op.end,
            };
          else if (term.kind === "jump")
            terminator = {
              ...term,
              target: target(term.target),
              start: op.start,
              end: op.end,
            };
          else if (term.kind === "throw")
            terminator = {
              ...term,
              value: value(term.value),
              start: op.start,
              end: op.end,
            };
          else if (term.kind === "throw-literal" || term.kind === "trap")
            terminator = { ...term, start: op.start, end: op.end };
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
        if (!straight) instructions = [];
        if (op.id !== undefined)
          instructions.push({
            kind: "load",
            id: op.id,
            slot: resultSlot,
            start: op.start,
            end: op.end,
          });
        allowance -= cost;
        inlined++;
        changed = true;
      }
      blocks[current] = { ...block, id: current, instructions };
    }
    functions.push(changed ? { ...fn, slots, blocks } : fn);
  }
  return {
    module: inlined === 0 ? module : { ...module, functions },
    visited,
    inlined,
  };
}
