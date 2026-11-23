import type { SignatureLayout } from "./abi.ts";
import {
  scalarByteLength,
  isNativeTypedArray,
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

/** Cell writes and initializations with the inline-read layout constraints
 * copy their transfer slot inline (through the register-aware emitter)
 * instead of calling the generic cell helper. */
export function canInlineCellWrite(fn: FunctionIR, term: Terminator): boolean {
  if (
    (term.kind !== "cell" && term.kind !== "record-cell") ||
    (term.operation !== "write" && term.operation !== "initialize")
  )
    return false;
  return canInlineCellRead(fn, { ...term, operation: "read" });
}
/** Inline cell accesses never expose their transfer slot's frame address,
 * so the slot may live in a register home. */
export function canInlineCellAccess(fn: FunctionIR, term: Terminator): boolean {
  return canInlineCellRead(fn, term) || canInlineCellWrite(fn, term);
}
/** Requires a separately established no-safepoint proof. Private generated
 * helpers preserve d16..d31. Ordinary calls do not; remaining cell helpers expose
 * frame addresses. Inline accesses transfer through the register-aware emitter. */
export function canUseLeafRegisters(fn: FunctionIR): boolean {
  for (const block of fn.blocks) {
    if (block === undefined) throw "leaf block invariant";
    if (
      (block.terminator.kind === "cell" ||
        block.terminator.kind === "record-cell") &&
      !canInlineCellAccess(fn, block.terminator)
    )
      return false;
    for (const op of block.instructions) {
      if (op === undefined) throw "leaf instruction invariant";
      if (
        op.kind === "call" ||
        op.kind === "call-indirect" ||
        op.kind === "host-call" ||
        op.kind === "c-call"
      )
        return false;
    }
  }
  return true;
}

export interface LeafStoragePlan {
  readonly registers: Uint8Array;
  readonly references?: Uint8Array;
  /** Callee-saved GP registers holding integer words; the prologue saves them. */
  readonly saved: readonly number[];
}
/** Callee-saved registers for integer words, which no helper clobbers. */
const integerHomes = [19, 20, 21, 22, 23, 24, 25, 26, 27, 28];
function referenceWord(type: ScalarType): boolean {
  return (
    type === "reference" ||
    type === "optional-reference" ||
    type === "string" ||
    type === "optional-string" ||
    isNativeTypedArray(type)
  );
}
/** Plan the same private leaf storage bank before emission, so typed copies can
 * use direct FP moves. One register owns one frame word for the whole function;
 * there is no lifetime aliasing, and no GC visibility decision is made here.
 * Words whose every occupant holds an integer or boolean word (`integerWords`)
 * take callee-saved GP registers instead, so their uses need no bank moves;
 * a word accessed fewer than three times does not pay for its save.
 * The caller must establish the existing no-safepoint/leaf proofs first. */
export function leafStorageRegisters(
  fn: FunctionIR,
  slotOffsets: readonly number[],
  value: (id: number) => { readonly offset: number; readonly type: ScalarType },
  firstByte: number,
  lastByte: number,
  maxWork: number = 1000000,
  signature?: SignatureLayout,
  integerWords?: Uint8Array,
): LeafStoragePlan | undefined {
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
  // Counting, then one search per FP and integer home.
  if (words * 28 > maxWork) return undefined;
  const counts = new Uint32Array(words),
    registers = new Uint8Array(words);
  let work = words * 28,
    integerSafe = true;
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
      if (op.kind === "array-copy" || op.kind === "array-fill")
        integerSafe = false;
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
  const saved: number[] = [];
  const integral: Uint8Array = integerWords ?? new Uint8Array(0);
  if (integral.length > 0)
    for (const register of integerHomes) {
      if (register === undefined) throw "leaf integer home invariant";
      let best = -1,
        score = 2;
      for (let word = firstByte / 8; word < words; word++) {
        const count = counts[word] ?? 0;
        if (integral[word] === 1 && registers[word] === 0 && count > score) {
          best = word;
          score = count;
        }
      }
      if (best < 0) break;
      registers[best] = 32 + register;
      saved.push(register);
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
  const original: LeafStoragePlan = { registers, saved };
  if (
    signature === undefined ||
    !integerSafe ||
    signature.parameters.length !== fn.parameters.length
  )
    return original;
  const parameters = signature.parameters;
  // Three analysis arrays, a separate emitter working copy, and five searches.
  // Exhaustion retains the complete original FP bank, never partial new homes.
  work += words * 9;
  if (work > maxWork) return original;
  const eligible = new Uint8Array(words),
    references = new Uint8Array(words),
    result = new Uint8Array(registers);
  function mark(offset: number, type: ScalarType): void {
    if (offset >= firstByte && offset / 8 < words && referenceWord(type))
      eligible[offset / 8] = 1;
  }
  for (let slot = 0; slot < fn.slots.length; slot++) {
    if (++work > maxWork) return original;
    const type = fn.slots[slot],
      offset = slotOffsets[slot];
    if (type === undefined || offset === undefined)
      throw "leaf reference slot invariant";
    mark(offset, type);
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "leaf reference block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "leaf reference instruction invariant";
      if (++work > maxWork) return original;
      const id = instructionResult(op);
      if (id !== undefined) {
        const storage = value(id);
        mark(storage.offset, storage.type);
      }
    }
  }
  let used = 0;
  // Incoming argument registers are reserved for their own live parameter homes.
  // Other locals begin after the prologue; stack arguments follow consumed GPRs.
  for (let i = 0; i < fn.parameters.length; i++) {
    if (++work > maxWork) return original;
    const slot = fn.parameters[i],
      location = parameters[i];
    if (slot === undefined || location === undefined)
      throw "leaf reference parameter invariant";
    const offset = slotOffsets[slot];
    if (offset === undefined) throw "leaf reference parameter offset invariant";
    const word = offset / 8;
    if (
      location.kind === "integer" &&
      eligible[word] === 1 &&
      (counts[word] ?? 0) > 1
    ) {
      if (
        location.index < 4 ||
        location.index > 7 ||
        (used & (1 << (location.index - 4))) !== 0
      )
        return original;
      references[word] = location.index + 32;
      used |= 1 << (location.index - 4);
    }
  }
  for (let register = 4; register <= 8; register++) {
    if ((used & (1 << (register - 4))) !== 0) continue;
    let best = -1,
      score = 1;
    for (let word = firstByte / 8; word < words; word++) {
      const count = counts[word] ?? 0;
      if (eligible[word] === 1 && references[word] === 0 && count > score) {
        best = word;
        score = count;
      }
    }
    if (best < 0) break;
    references[best] = register + 32;
    used |= 1 << (register - 4);
  }
  if (used === 0) return original;
  for (let slot = 0; slot < fn.slots.length; slot++) {
    if (++work > maxWork) return original;
    const offset = slotOffsets[slot];
    if (offset === undefined) throw "leaf reference local offset invariant";
    const register = references[offset / 8] ?? 0;
    if (register !== 0) result[offset / 8] = register;
  }
  return { registers: result, references, saved };
}
