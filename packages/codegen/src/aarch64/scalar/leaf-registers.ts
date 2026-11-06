import {
  scalarByteLength,
  instructionResult,
  visitInstructionOperands,
  visitTerminatorOperands,
  type ScalarType,
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

/** Plan the same private leaf storage bank before emission, so typed copies can
 * use direct FP moves. One register owns one frame word for the whole function;
 * there is no lifetime aliasing, and no GC visibility decision is made here.
 * The caller must establish the existing no-safepoint/leaf proofs first. */
export function leafStorageRegisters(
  fn: FunctionIR,
  slotOffsets: readonly number[],
  value: (id: number) => { readonly offset: number; readonly type: ScalarType },
  firstByte: number,
  lastByte: number,
  maxWork: number = 1000000,
): Uint8Array | undefined {
  if (
    !Number.isSafeInteger(lastByte) ||
    lastByte < firstByte ||
    lastByte % 8 !== 0 ||
    lastByte > 8000000 ||
    !Number.isSafeInteger(maxWork) ||
    maxWork < 1
  )
    return undefined;
  const words = lastByte / 8;
  if (words * 18 > maxWork) return undefined;
  const counts = new Uint32Array(words),
    registers = new Uint8Array(words);
  let work = words * 18;
  function touch(offset: number, bytes: number): void {
    for (let byte = 0; byte < bytes; byte += 8) {
      work++;
      const index = (offset + byte) / 8;
      if (offset >= firstByte && index < words)
        counts[index] = (counts[index] ?? 0) + 1;
    }
  }
  function slot(id: number): void {
    const offset = slotOffsets[id],
      type = fn.slots[id];
    if (offset === undefined || type === undefined)
      throw "leaf storage slot invariant";
    touch(offset, scalarByteLength(type));
  }
  function operand(id: number): void {
    const storage = value(id);
    touch(storage.offset, scalarByteLength(storage.type));
  }
  for (const id of fn.parameters) {
    if (id === undefined) throw "leaf parameter invariant";
    slot(id);
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "leaf storage block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "leaf storage instruction invariant";
      if (++work > maxWork) return undefined;
      visitInstructionOperands(op, operand);
      const result = instructionResult(op);
      if (result !== undefined) operand(result);
      if (op.kind === "load" || op.kind === "store") slot(op.slot);
    }
    const term = block.terminator;
    visitTerminatorOperands(term, operand);
    if (
      term.kind === "cell" ||
      term.kind === "record-cell" ||
      term.kind === "record"
    )
      slot(term.slot);
    if (work > maxWork) return undefined;
  }
  for (let register = 16; register < 32; register++) {
    let best = -1,
      score = 0;
    for (let word = firstByte / 8; word < words; word++) {
      const count = counts[word] ?? 0;
      if (registers[word] === 0 && count > score) {
        best = word;
        score = count;
      }
    }
    if (best < 0) break;
    registers[best] = register;
  }
  return registers;
}
