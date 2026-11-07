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
function referenceTransparent(op: Instruction): boolean {
  return (
    transparent(op) ||
    op.kind === "reference-wrap" ||
    op.kind === "reference-value" ||
    op.kind === "record-read" ||
    op.kind === "record-has" ||
    op.kind === "reference-vector-is" ||
    op.kind === "reference-vector-length" ||
    op.kind === "reference-vector-read"
  );
}
/** Verified block-local SSA. Candidate 1 is numeric/boolean; candidate 2 is a
 * single-word reference. References must die before every safepoint and opaque
 * use, including call arguments. Numeric allocation is unchanged and takes
 * priority. Additional reference analysis falls back to that complete plan on
 * exhaustion. Private numeric/array helpers preserve the volatile d16..d31 bank. */
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
    epoch = 0,
    referenceEpoch = 0,
    hasReferenceCandidate = false;
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
      const safe = transparent(op),
        referenceSafe = referenceTransparent(op);
      if (!safe) epoch++;
      if (!referenceSafe) referenceEpoch++;
      visitInstructionOperands(op, (id) => {
        work++;
        ends[id] = position;
        const reference = candidates[id] === 2;
        if (
          !(reference ? referenceSafe : safe) ||
          epochs[id] !== (reference ? referenceEpoch : epoch)
        )
          valid[id] = 0;
      });
      const id = instructionResult(op);
      if (id !== undefined) {
        if (id >= candidates.length) return undefined;
        starts[id] = position;
        const reference = candidates[id] === 2;
        if (reference) hasReferenceCandidate = true;
        epochs[id] = reference ? referenceEpoch : epoch;
        if (!(reference ? referenceSafe : safe)) valid[id] = 0;
      }
    }
    position++;
    const term = block.terminator;
    visitTerminatorOperands(term, (id) => {
      work++;
      ends[id] = position;
      if (
        epochs[id] !== (candidates[id] === 2 ? referenceEpoch : epoch) ||
        (term.kind !== "return" &&
          term.kind !== "branch" &&
          !(
            candidates[id] === 2 &&
            term.kind === "record" &&
            term.operation === "read"
          ))
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
  if (!hasReferenceCandidate) return registers;
  let hasReference = false;
  for (let id = 0; id < valid.length; id++) {
    if (++work > maxWork) return registers;
    if (valid[id] === 2) {
      hasReference = true;
      break;
    }
  }
  if (!hasReference) return registers;
  // Preserve the original numeric plan on every additional-analysis fallback.
  work += candidates.length * 2 + 32;
  if (work > maxWork) return registers;
  const result = new Uint8Array(registers),
    next = new Uint32Array(candidates.length),
    heads = new Uint32Array(16),
    tails = new Uint32Array(16);
  for (const block of fn.blocks) {
    for (let r = 0; r < 16; r++) {
      heads[r] = 0;
      tails[r] = 0;
      occupied[r] = 0;
    }
    for (const op of block.instructions) {
      if (++work > maxWork) return registers;
      const id = instructionResult(op);
      if (id === undefined || registers[id] === 0) continue;
      const r = registers[id]! - 16,
        previous = tails[r] ?? 0;
      if (previous === 0) heads[r] = id + 1;
      else next[previous - 1] = id + 1;
      tails[r] = id + 1;
    }
    for (const op of block.instructions) {
      if (++work > maxWork) return registers;
      const id = instructionResult(op);
      if (id === undefined || valid[id] !== 2) continue;
      const start = starts[id] ?? 0,
        end = ends[id] ?? 0;
      if (end <= start) continue;
      for (let r = 0; r < 16; r++) {
        if (++work > maxWork) return registers;
        let head = heads[r] ?? 0;
        while (head !== 0 && (ends[head - 1] ?? 0) < start) {
          if (++work > maxWork) return registers;
          head = next[head - 1] ?? 0;
        }
        heads[r] = head;
        if (
          (occupied[r] ?? 0) < start &&
          (head === 0 || (starts[head - 1] ?? 0) > end)
        ) {
          occupied[r] = end;
          result[id] = r + 16;
          break;
        }
      }
    }
  }
  return result;
}
