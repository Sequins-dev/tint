import {
  readWord,
  writeWord,
  type WordBuffer,
} from "@tint/foundation/binary/word-buffer";
/** Words of `fmov dN, xA` / `fmov xB, dN` (64-bit general <-> FP moves). */
const fmovFromGeneral = 0x9e670000,
  fmovToGeneral = 0x9e660000,
  movRegister = 0xaa0003e0,
  nop = 0xd503201f,
  /** 64-bit `ldr`/`str xT, [sp, #imm12 * 8]` with the register fields cleared. */
  loadStack = 0xf94003e0,
  storeStack = 0xf90003e0;
/** Sign-extend a branch immediate whose sign bit has the given value. */
function signed(value: number, sign: number): number {
  return value >= sign ? value - 2 * sign : value;
}
/** Instruction index targeted by a PC-relative branch or ADR word, if any.
 * BL targets function entries, never the middle of the current function. */
function target(word: number, index: number): number | undefined {
  if ((word & 0xfc000000) >>> 0 === 0x14000000)
    return index + signed(word & 0x3ffffff, 0x2000000);
  if ((word & 0xff000010) >>> 0 === 0x54000000)
    return index + signed((word >>> 5) & 0x7ffff, 0x40000);
  if ((word & 0x7e000000) >>> 0 === 0x34000000)
    return index + signed((word >>> 5) & 0x7ffff, 0x40000);
  if ((word & 0x7e000000) >>> 0 === 0x36000000)
    return index + signed((word >>> 5) & 0x3fff, 0x2000);
  if ((word & 0x9f000000) >>> 0 === 0x10000000) {
    const bytes = signed(
      ((word >>> 5) & 0x7ffff) * 4 + ((word >>> 29) & 3),
      0x100000,
    );
    return bytes % 4 === 0 ? index + bytes / 4 : undefined;
  }
  return undefined;
}
/** Forward a value just placed in a register to an adjacent re-read of it:
 * - a scalar slot held in dN is written by `fmov dN, xA` and read back by
 *   `fmov xB, dN`: read xA with an integer move instead of a second
 *   cross-bank transfer;
 * - a stack slot stored from, or loaded into, xA and then loaded again: the
 *   reload becomes a move (or a no-op into the same register).
 * Only when nothing can enter between the two instructions. Rewrites keep one
 * word per instruction, so branches, fixups and DWARF ranges stay valid.
 *
 * Entries are every PC-relative branch or ADR target inside [start, end)
 * (local branches are already resolved), plus the caller's block offsets for
 * branches whose displacements are patched after the function is emitted.
 * The emitter has no indirect in-function jumps. Returns the rewrite count. */
export function forwardRegisterRoundTrips(
  code: WordBuffer,
  start: number,
  end: number,
  entries: readonly (number | undefined)[],
): number {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > code.length
  )
    return 0;
  const entered = new Uint8Array(end - start + 1);
  for (const entry of entries)
    if (entry !== undefined && entry >= start && entry <= end)
      entered[entry - start] = 1;
  for (let index = start; index < end; index++) {
    const word = readWord(code, index);
    if (word === undefined) throw "register move invariant";
    const to = target(word, index);
    if (to !== undefined && to >= start && to <= end) entered[to - start] = 1;
  }
  let rewritten = 0;
  // Match against original words: a rewritten reload leaves its destination
  // holding the same value the original instruction would have loaded.
  let first = start < end ? readWord(code, start) : undefined;
  for (let index = start; index + 1 < end; index++) {
    const second = readWord(code, index + 1);
    if (first === undefined || second === undefined)
      throw "register move invariant";
    const replacement =
      (entered[index + 1 - start] ?? 0) !== 0
        ? undefined
        : forwarded(first, second);
    if (replacement !== undefined) {
      writeWord(code, index + 1, replacement);
      rewritten++;
    }
    first = second;
  }
  return rewritten;
}
/** The replacement for `second` when it only re-reads a value `first` has
 * just placed in a register: an integer move or a no-op. */
function forwarded(first: number, second: number): number | undefined {
  // fmov dN, xA ; fmov xB, dN  ->  mov xB, xA (x31 is xzr for both).
  if (
    (first & 0xfffffc00) >>> 0 === fmovFromGeneral &&
    (second & 0xfffffc00) >>> 0 === fmovToGeneral &&
    ((second >>> 5) & 31) === (first & 31)
  )
    return (movRegister | (((first >>> 5) & 31) << 16) | (second & 31)) >>> 0;
  // str/ldr xA, [sp, #k] ; ldr xB, [sp, #k]: xA still holds the slot. No
  // safepoint separates adjacent instructions, so a moving collector cannot
  // have rewritten the slot in between. x31 here is xzr for str, sp is never
  // a load destination.
  const firstKind = (first & 0xffc003e0) >>> 0;
  if (
    (second & 0xffc003e0) >>> 0 !== loadStack ||
    (firstKind !== loadStack && firstKind !== storeStack) ||
    ((first >>> 10) & 4095) !== ((second >>> 10) & 4095)
  )
    return undefined;
  const source = first & 31,
    destination = second & 31;
  if (destination === 31 || (firstKind === loadStack && source === 31))
    return undefined;
  return source === destination
    ? nop
    : (movRegister | (source << 16) | destination) >>> 0;
}
