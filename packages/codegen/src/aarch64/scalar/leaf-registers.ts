import {
  scalarByteLength,
  type FunctionIR,
  type Terminator,
} from "@tint/ir/scalar";
/** Verified IR only. Record-cell offsets are aligned and directly addressable;
 * borrowed environments may contain unaligned cells and retain the helper. */
export function canInlineCellRead(fn: FunctionIR, term: Terminator): boolean {
  if (
    (term.kind !== "cell" && term.kind !== "record-cell") ||
    term.operation !== "read"
  )
    return false;
  const type = fn.slots[term.slot];
  if (
    type === undefined ||
    scalarByteLength(type) > 32 ||
    scalarByteLength(type) % 8 !== 0
  )
    return false;
  if (term.kind === "record-cell") return true;
  const cell = fn.environment?.cells[term.cell];
  return cell !== undefined && cell.valueOffset % 8 === 0;
}

/** Requires a separately established no-safepoint proof. Private generated
 * helpers preserve d16..d31. Ordinary calls do not; remaining cell helpers expose
 * frame addresses. Inline reads transfer through the register-aware emitter. */
export function canUseLeafRegisters(fn: FunctionIR): boolean {
  for (const block of fn.blocks) {
    if (block === undefined) throw "leaf block invariant";
    if (
      (block.terminator.kind === "cell" ||
        block.terminator.kind === "record-cell") &&
      !canInlineCellRead(fn, block.terminator)
    )
      return false;
    for (const op of block.instructions) {
      if (op === undefined) throw "leaf instruction invariant";
      if (
        op.kind === "call" ||
        op.kind === "call-indirect" ||
        op.kind === "host-call"
      )
        return false;
    }
  }
  return true;
}
