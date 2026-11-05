import type { FunctionIR, Instruction, Block } from "./model.ts";
import { instructionResult } from "./operands.ts";
/** Verified IR with stable local slots and no opaque alias mutation only.
 * Recognize constant initialization plus guarded unit-step
 * increments. Unique normal predecessor chains establish the guard; joins,
 * exception entries, intervening writes and unsupported updates retain checks. */
export function provenInductionWords(
  fn: FunctionIR,
  maxWork: number = 200000,
): Uint8Array | undefined {
  if (!Number.isSafeInteger(maxWork) || maxWork < 1) return undefined;
  let work = fn.slots.length + fn.blocks.length,
    maximum = -1,
    count = 0,
    additions = 0;
  if (work > maxWork) return undefined;
  for (const block of fn.blocks) {
    if (block === undefined) throw "induction block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "induction instruction invariant";
      if (++work > maxWork) return undefined;
      count++;
      const id = instructionResult(op);
      if (id !== undefined) maximum = Math.max(maximum, id);
      if (op.kind === "binary" && op.operator === "+") additions++;
    }
  }
  if (additions === 0 || maximum > count * 4 + 16 || maximum >= maxWork)
    return undefined;
  const definitions: (Instruction | undefined)[] = [],
    positions = new Uint32Array(maximum + 1),
    predecessors = new Uint32Array(fn.blocks.length),
    valid = new Uint8Array(fn.slots.length),
    initialized = new Uint8Array(fn.slots.length),
    updated = new Uint8Array(fn.slots.length);
  for (let slot = 0; slot < fn.slots.length; slot++)
    valid[slot] = fn.slots[slot] === "number" ? 1 : 0;
  for (const parameter of fn.parameters) {
    if (parameter === undefined) throw "induction parameter invariant";
    valid[parameter] = 0;
  }
  function edge(from: number, to: number): void {
    predecessors[to] = predecessors[to] === 0 ? from + 1 : 0xffffffff;
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "induction block invariant";
    for (let position = 0; position < block.instructions.length; position++) {
      if (++work > maxWork) return undefined;
      const op = block.instructions[position];
      if (op === undefined) throw "induction instruction invariant";
      const id = instructionResult(op);
      if (id !== undefined) {
        definitions[id] = op;
        positions[id] = position;
      }
    }
    const term = block.terminator;
    if (term.kind === "jump") edge(block.id, term.target);
    else if (
      term.kind === "branch" ||
      term.kind === "record" ||
      term.kind === "cell" ||
      term.kind === "record-cell"
    ) {
      edge(block.id, term.consequent);
      edge(block.id, term.alternate);
      if (term.kind !== "branch" && term.operation === "read")
        valid[term.slot] = 0;
    }
    if (block.exception !== undefined)
      predecessors[block.exception.target] = 0xffffffff;
  }
  predecessors[fn.entry] = 0xffffffff;
  function wordConstant(op: Instruction | undefined): boolean {
    if (op === undefined || op.kind !== "constant") return false;
    const value = op.value;
    return (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= -2147483648 &&
      value <= 4294967295
    );
  }
  function one(op: Instruction | undefined): boolean {
    return op !== undefined && op.kind === "constant" && op.value === 1;
  }
  function guarded(block: Block, position: number, slot: number): boolean {
    let current = block,
      cutoff = position;
    for (let depth = 0; depth < 128; depth++) {
      for (let i = 0; i < cutoff; i++) {
        if (++work > maxWork) return false;
        const op = current.instructions[i];
        if (op === undefined) throw "induction scan invariant";
        if (op.kind === "store" && op.slot === slot) return false;
      }
      const pred = predecessors[current.id] ?? 0;
      if (pred === 0 || pred === 0xffffffff) return false;
      const previous = fn.blocks[pred - 1];
      if (previous === undefined) throw "induction predecessor invariant";
      const term = previous.terminator;
      if (
        (term.kind === "cell" ||
          term.kind === "record" ||
          term.kind === "record-cell") &&
        term.operation === "read" &&
        term.slot === slot
      )
        return false;
      if (
        term.kind === "branch" &&
        term.consequent === current.id &&
        term.alternate !== current.id
      ) {
        const condition = definitions[term.condition];
        if (
          condition !== undefined &&
          condition.kind === "binary" &&
          condition.operator === "<"
        ) {
          const left = definitions[condition.left],
            right = definitions[condition.right];
          if (
            left !== undefined &&
            left.kind === "load" &&
            left.slot === slot &&
            (wordConstant(right) ||
              (right !== undefined && right.kind === "array-length"))
          ) {
            const begin = positions[condition.left];
            if (begin === undefined) throw "induction guard invariant";
            for (let i = begin + 1; i < previous.instructions.length; i++) {
              if (++work > maxWork) return false;
              const op = previous.instructions[i];
              if (op === undefined) throw "induction scan invariant";
              if (op.kind === "store" && op.slot === slot) return false;
            }
            return true;
          }
        }
      }
      current = previous;
      cutoff = previous.instructions.length;
    }
    return false;
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "induction block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "induction instruction invariant";
      if (++work > maxWork) return undefined;
      if (op.kind !== "store" || valid[op.slot] !== 1) continue;
      const source = definitions[op.value];
      if (wordConstant(source)) {
        initialized[op.slot] = 1;
        continue;
      }
      if (
        source !== undefined &&
        source.kind === "binary" &&
        source.operator === "+"
      ) {
        const left = definitions[source.left],
          right = definitions[source.right];
        const loaded = one(left) ? right : one(right) ? left : undefined;
        if (
          loaded !== undefined &&
          loaded.kind === "load" &&
          loaded.slot === op.slot
        ) {
          const position = positions[loaded.id];
          if (position === undefined) throw "induction update invariant";
          updated[op.slot] = 1;
          if (!guarded(block, position, op.slot)) valid[op.slot] = 0;
          if (work > maxWork) return undefined;
          continue;
        }
      }
      valid[op.slot] = 0;
    }
  }
  for (let slot = 0; slot < valid.length; slot++)
    if (initialized[slot] !== 1 || updated[slot] !== 1) valid[slot] = 0;
  return valid;
}
