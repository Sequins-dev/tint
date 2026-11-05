import {
  instructionResult,
  visitInstructionOperands,
  visitTerminatorOperands,
  type FunctionIR,
  type Instruction,
} from "@tint/ir/scalar";
function transparent(op: Instruction): boolean {
  return (
    op.kind === "constant" ||
    op.kind === "load" ||
    op.kind === "store" ||
    op.kind === "unary" ||
    op.kind === "binary" ||
    op.kind === "array-length" ||
    op.kind === "array-read" ||
    op.kind === "array-write" ||
    op.kind === "optional-wrap" ||
    op.kind === "optional-value" ||
    op.kind === "optional-present"
  );
}
/** Verified block-local SSA. Candidates must be non-reference, single-word
 * temporaries. Only directly stored definitions qualify. Values crossing or
 * consumed by opaque instructions retain memory, including call arguments.
 * Private numeric/array helpers preserve the volatile d16..d31 bank. */
export function temporaryRegisters(
  fn: FunctionIR,
  candidates: Uint8Array,
  maxWork: number = 1000000,
): Uint8Array | undefined {
  if (
    !Number.isSafeInteger(maxWork) ||
    maxWork < 1 ||
    candidates.length * 5 > maxWork
  )
    return undefined;
  let work = candidates.length * 5,
    position = 0,
    epoch = 0;
  const starts = new Uint32Array(candidates.length),
    ends = new Uint32Array(candidates.length),
    epochs = new Uint32Array(candidates.length),
    valid = new Uint8Array(candidates),
    registers = new Uint8Array(candidates.length),
    occupied = new Uint32Array(16);
  for (const block of fn.blocks) {
    if (block === undefined) throw "temporary block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "temporary instruction invariant";
      if (++work > maxWork) return undefined;
      position++;
      const safe = transparent(op);
      if (!safe) epoch++;
      visitInstructionOperands(op, (id) => {
        work++;
        ends[id] = position;
        if (!safe || epochs[id] !== epoch) valid[id] = 0;
      });
      const id = instructionResult(op);
      if (id !== undefined) {
        if (id >= candidates.length) return undefined;
        starts[id] = position;
        epochs[id] = epoch;
        if (!safe) valid[id] = 0;
      }
    }
    position++;
    const term = block.terminator;
    visitTerminatorOperands(term, (id) => {
      work++;
      ends[id] = position;
      if (
        epochs[id] !== epoch ||
        (term.kind !== "return" && term.kind !== "branch")
      )
        valid[id] = 0;
    });
    if (work > maxWork) return undefined;
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "temporary block invariant";
    for (let r = 0; r < 16; r++) occupied[r] = 0;
    for (const op of block.instructions) {
      if (op === undefined) throw "temporary instruction invariant";
      if (++work > maxWork) return undefined;
      const id = instructionResult(op);
      if (id === undefined || valid[id] !== 1) continue;
      const start = starts[id] ?? 0,
        end = ends[id] ?? 0;
      if (end <= start) continue;
      for (let r = 0; r < 16; r++) {
        if (++work > maxWork) return undefined;
        if ((occupied[r] ?? 0) < start) {
          occupied[r] = end;
          registers[id] = r + 16;
          break;
        }
      }
    }
  }
  return registers;
}
