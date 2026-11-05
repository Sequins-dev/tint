import type { FunctionIR } from "./model.ts";
import {
  instructionResult,
  visitInstructionOperands,
  visitTerminatorOperands,
} from "./operands.ts";
export interface ValueLifetimes {
  readonly ends: Uint32Array;
  readonly work: number;
}
/** Verified block-local SSA. Positions include every instruction and terminator;
 * result storage must not alias operands whose last use is that same position. */
export function valueLifetimes(
  fn: FunctionIR,
  maxWork: number = 1000000,
): ValueLifetimes | undefined {
  if (!Number.isSafeInteger(maxWork) || maxWork < 1) return undefined;
  let maximum = -1,
    count = 0,
    work = fn.blocks.length;
  for (const block of fn.blocks) {
    if (block === undefined) throw "lifetime block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "lifetime instruction invariant";
      if (++work > maxWork) return undefined;
      const id = instructionResult(op);
      if (id !== undefined) {
        maximum = Math.max(maximum, id);
        count++;
      }
    }
  }
  if (maximum > count * 4 + 16 || work + maximum + 1 > maxWork)
    return undefined;
  work += maximum + 1;
  const ends = new Uint32Array(maximum + 1);
  let position = 0;
  function use(id: number): void {
    work++;
    ends[id] = position;
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "lifetime block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "lifetime instruction invariant";
      position++;
      work++;
      const id = instructionResult(op);
      if (id !== undefined) ends[id] = position;
      visitInstructionOperands(op, use);
      if (work > maxWork) return undefined;
    }
    position++;
    work++;
    visitTerminatorOperands(block.terminator, use);
    if (work > maxWork) return undefined;
  }
  return { ends, work };
}
