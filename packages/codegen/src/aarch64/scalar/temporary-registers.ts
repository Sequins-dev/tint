import {
  instructionResult,
  instructionEffects,
  effectAllocate,
  visitInstructionOperands,
  visitTerminatorOperands,
  type FunctionIR,
  type Instruction,
} from "@tint/ir/scalar";
function transparent(op: Instruction): boolean {
  return (
    // Reads of records, references and reference vectors use x9..x12 and
    // the d0/d1 scratch only, so numeric homes survive them too.
    op.kind === "reference-wrap" ||
    op.kind === "string-reference" ||
    op.kind === "reference-string" ||
    op.kind === "reference-value" ||
    op.kind === "record-read" ||
    op.kind === "record-has" ||
    op.kind === "reference-vector-is" ||
    op.kind === "reference-vector-length" ||
    op.kind === "reference-vector-read" ||
    op.kind === "constant" ||
    op.kind === "load" ||
    op.kind === "store" ||
    op.kind === "unary" ||
    op.kind === "binary" ||
    op.kind === "array-length" ||
    // A string's length is one load (x9, d0).
    op.kind === "string-length" ||
    op.kind === "array-read" ||
    op.kind === "array-element" ||
    op.kind === "array-write" ||
    op.kind === "array-store" ||
    op.kind === "optional-wrap" ||
    op.kind === "optional-value" ||
    op.kind === "optional-value-or" ||
    op.kind === "optional-present" ||
    // Inline memory word accesses use x0..x3, x9..x11, d0 and d1 only.
    (op.kind === "host-call" &&
      (op.operation === "memory-read-word" ||
        op.operation === "memory-write-word"))
  );
}
function referenceTransparent(op: Instruction): boolean {
  return transparent(op);
}
/** Verified block-local SSA. Candidate 1 is numeric/boolean; candidate 2 is a
 * single-word reference; candidate 3 is an integer or boolean word, homed in
 * callee-saved x19..x28 (encoded as 32 + register), which every call and
 * helper preserves, so its lifetime may cross opaque operations. References must die before every safepoint and opaque
 * use, including call arguments. Numeric allocation is unchanged and takes
 * priority. Additional reference analysis falls back to that complete plan on
 * exhaustion. FP homes use d16..d31; pointer homes encode x4..x8 as 32 + register.
 * Transparent numeric/array kernels preserve both banks. */
export function temporaryRegisters(
  fn: FunctionIR,
  candidates: Uint8Array,
  maxWork: number = 1000000,
  /** Word temporaries use x19 up to x(19 + wordRegisters - 1). */
  wordRegisters: number = 10,
  /** Instructions that may collect. A reference whose lifetime crosses an
   * opaque operation but no safepoint needs no root: it joins the word
   * temporaries (callee-saved, preserved by calls and helpers). */
  collects?: (op: Instruction) => boolean,
): Uint8Array | undefined {
  if (
    !Number.isSafeInteger(maxWork) ||
    maxWork < 1 ||
    candidates.length * 5 > maxWork
  )
    return undefined;
  let work = candidates.length * 5,
    position = 0,
    safepoints = 0,
    epoch = 0,
    referenceEpoch = 0,
    hasReferenceCandidate = false,
    hasWordCandidate = false;
  const starts = new Uint32Array(candidates.length),
    ends = new Uint32Array(candidates.length),
    epochs = new Uint32Array(candidates.length),
    // Safepoints passed before a value's definition, and whether a later
    // use follows another safepoint; terminator uses other than returns,
    // branches and record reads rule promotion out.
    safepointsAt = new Uint32Array(candidates.length),
    crossed = new Uint8Array(candidates.length),
    blocked = new Uint8Array(candidates.length),
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
      // Calls take their arguments before they may collect (callees root
      // their parameters); allocations read operands after allocating.
      const collecting = collects === undefined || collects(op),
        call = op.kind === "call" || op.kind === "call-indirect";
      if (collecting && !call) safepoints++;
      visitInstructionOperands(op, (id) => {
        work++;
        ends[id] = position;
        if (safepoints !== (safepointsAt[id] ?? 0)) crossed[id] = 1;
        if (candidates[id] === 3) return;
        const reference = candidates[id] === 2;
        if (
          !(reference ? referenceSafe : safe) ||
          epochs[id] !== (reference ? referenceEpoch : epoch)
        )
          valid[id] = 0;
      });
      if (collecting && call) safepoints++;
      const id = instructionResult(op);
      if (id !== undefined) {
        if (id >= candidates.length) return undefined;
        starts[id] = position;
        safepointsAt[id] = safepoints;
        const reference = candidates[id] === 2;
        if (reference) hasReferenceCandidate = true;
        if (candidates[id] === 3) hasWordCandidate = true;
        epochs[id] = reference ? referenceEpoch : epoch;
        if (candidates[id] !== 3 && !(reference ? referenceSafe : safe))
          valid[id] = 0;
      }
    }
    position++;
    const term = block.terminator;
    visitTerminatorOperands(term, (id) => {
      work++;
      ends[id] = position;
      if (safepoints !== (safepointsAt[id] ?? 0)) crossed[id] = 1;
      if (
        term.kind !== "return" &&
        term.kind !== "branch" &&
        !(term.kind === "record" && term.operation === "read")
      )
        blocked[id] = 1;
      if (
        (candidates[id] !== 3 &&
          epochs[id] !== (candidates[id] === 2 ? referenceEpoch : epoch)) ||
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
  // References disqualified only by operations that clobber x4..x8 become
  // word temporaries when no safepoint falls inside their lifetime.
  if (collects !== undefined)
    for (let id = 0; id < candidates.length; id++)
      if (
        candidates[id] === 2 &&
        valid[id] !== 2 &&
        crossed[id] !== 1 &&
        blocked[id] !== 1
      ) {
        valid[id] = 3;
        hasWordCandidate = true;
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
  if (hasWordCandidate) {
    const words = new Uint32Array(wordRegisters);
    for (const block of fn.blocks) {
      if (block === undefined) throw "word temporary block invariant";
      words.fill(0);
      for (const op of block.instructions) {
        if (op === undefined) throw "word temporary instruction invariant";
        if (++work > maxWork) return undefined;
        const id = instructionResult(op);
        if (id === undefined || valid[id] !== 3) continue;
        const start = starts[id] ?? 0,
          end = ends[id] ?? 0;
        if (end <= start) continue;
        for (let r = 0; r < wordRegisters; r++)
          if ((words[r] ?? 0) < start) {
            words[r] = end;
            registers[id] = 32 + 19 + r;
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
  // x4..x8 hold incoming arguments only until the prologue stores them. Calls
  // and opaque operations end reference lifetimes; transparent scalar kernels
  // preserve these five registers. Encode integer homes as 32 + register.
  work += candidates.length;
  if (work > maxWork) return registers;
  const result = new Uint8Array(registers);
  for (const block of fn.blocks) {
    if (block === undefined) throw "reference temporary block invariant";
    for (let r = 0; r < 5; r++) occupied[r] = 0;
    for (const op of block.instructions) {
      if (op === undefined) throw "reference temporary instruction invariant";
      if (++work > maxWork) return registers;
      const id = instructionResult(op);
      if (id === undefined || valid[id] !== 2) continue;
      const start = starts[id] ?? 0,
        end = ends[id] ?? 0;
      if (end <= start) continue;
      for (let r = 0; r < 5; r++) {
        if (++work > maxWork) return registers;
        if ((occupied[r] ?? 0) < start) {
          occupied[r] = end;
          result[id] = r + 36;
          break;
        }
      }
    }
  }
  return result;
}

/** Closed cooperative-GC IR. A proven nonallocating block cannot observe stale
 * temporary roots. The emitter must clear the entire temporary pool before
 * every other block, including catch targets. Failure retains the old policy. */
export function nonAllocatingBlocks(
  fn: FunctionIR,
  noSafepoints: Uint8Array,
  maxWork: number = 1000000,
): Uint8Array | undefined {
  if (!Number.isSafeInteger(maxWork) || maxWork < 1) return undefined;
  let work = 0,
    maximum = 0;
  for (const block of fn.blocks) {
    if (block === undefined || ++work > maxWork || block.id >= maxWork)
      return undefined;
    maximum = Math.max(maximum, block.id);
  }
  work += maximum + 1;
  if (work > maxWork) return undefined;
  const result = new Uint8Array(maximum + 1);
  for (const block of fn.blocks) {
    if (block === undefined) throw "temporary root block invariant";
    let safe: boolean = true;
    switch (block.terminator.kind) {
      case "return":
      case "jump":
      case "branch":
      case "trap":
      case "record":
      case "record-cell":
      case "cell":
      case "throw":
      case "throw-literal":
        break;
      default:
        safe = false;
    }
    for (const op of block.instructions) {
      if (op === undefined || ++work > maxWork) return undefined;
      if (op.kind === "call") {
        if (noSafepoints[op.target] !== 1) safe = false;
      } else if ((instructionEffects(op) & effectAllocate) !== 0) safe = false;
    }
    result[block.id] = safe ? 1 : 0;
  }
  return result;
}
