import type { FunctionIR, Instruction } from "./model.ts";
import {
  instructionResult,
  visitInstructionOperands,
  visitTerminatorOperands,
} from "./operands.ts";
function bitwise(op: Instruction): boolean {
  return (
    (op.kind === "unary" && op.operator === "~") ||
    (op.kind === "binary" &&
      (op.operator === "&" ||
        op.operator === "|" ||
        op.operator === "^" ||
        op.operator === "<<" ||
        op.operator === ">>" ||
        op.operator === ">>>" ||
        op.operator === "imul"))
  );
}
/** Verified IR only. A bitwise result observed solely by other bitwise operations
 * needs only its modulo-2^32 bits. Any other use (including a slot store, call,
 * return or boxing) retains the ordinary numeric representation. Dense bounded
 * value-ID flags; sparse/oversized functions conservatively publish no plan. */
export function wordOnlyValues(
  fn: FunctionIR,
  maxWork: number = 1000000,
): Uint8Array | undefined {
  if (!Number.isSafeInteger(maxWork) || maxWork < 1) return undefined;
  let maximum = -1,
    candidates = 0,
    work = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "word use block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "word use instruction invariant";
      if (++work > maxWork) return undefined;
      if (bitwise(op)) candidates++;
      const id = instructionResult(op);
      if (id !== undefined) maximum = Math.max(maximum, id);
    }
  }
  if (candidates === 0) return undefined;
  if (maximum >= maxWork || maximum > work * 4 + 16) return undefined;
  const flags = new Uint8Array(maximum + 1),
    used = new Uint8Array(maximum + 1);
  for (const block of fn.blocks) {
    if (block === undefined) throw "word use block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "word use instruction invariant";
      if (++work > maxWork) return undefined;
      const id = instructionResult(op);
      if (id !== undefined && bitwise(op)) flags[id] = 1;
    }
  }
  let wordUse = false;
  function consume(id: number): void {
    work++;
    used[id] = 1;
    if (!wordUse) flags[id] = 0;
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "word use block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "word use instruction invariant";
      wordUse = bitwise(op);
      visitInstructionOperands(op, consume);
      if (++work > maxWork) return undefined;
    }
    wordUse = false;
    visitTerminatorOperands(block.terminator, consume);
    if (++work > maxWork) return undefined;
  }
  for (let id = 0; id < flags.length; id++) {
    if (++work > maxWork) return undefined;
    if (used[id] !== 1) flags[id] = 0;
  }
  return flags;
}
