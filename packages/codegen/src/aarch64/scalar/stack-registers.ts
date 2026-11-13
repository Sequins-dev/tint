import {
  readWord,
  writeWord,
  type WordBuffer,
} from "@tint/foundation/binary/word-buffer";
/** Rewrite generated leaf frames only: no safepoints, ordinary calls, escaped
 * local addresses, or uses of d16..d31. The range excludes context/result/header
 * storage. Keep one instruction per access so branch fixups and DWARF stay valid.
 * Large-offset accesses use address scratch and are deliberately not promoted. */
export function promoteStackWords(
  code: WordBuffer,
  start: number,
  end: number,
  firstByte: number,
  lastByte: number,
  maxWork: number = 1000000,
  /** Debug builds learn each promoted frame word's FP register. */
  report?: (byteOffset: number, register: number) => void,
): number {
  const limit = Math.min(lastByte, 32768),
    slots = Math.ceil(limit / 8);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > code.length ||
    !Number.isInteger(firstByte) ||
    firstByte < 0 ||
    firstByte % 8 !== 0 ||
    !Number.isInteger(lastByte) ||
    lastByte % 8 !== 0 ||
    limit <= firstByte ||
    !Number.isSafeInteger(maxWork) ||
    maxWork < (end - start) * 2 + slots * 16 + 16
  )
    return 0;
  const counts = new Uint32Array(slots),
    blocked = new Uint8Array(slots),
    registers = new Uint8Array(slots);
  for (let index = start; index < end; index++) {
    const instruction = readWord(code, index);
    if (instruction === undefined) throw "stack instruction invariant";
    const kind = (instruction & 0xffc003e0) >>> 0,
      immediate = (instruction >>> 10) & 4095;
    if (
      kind === 0xf94003e0 ||
      kind === 0xf90003e0 ||
      kind === 0xfd4003e0 ||
      kind === 0xfd0003e0
    ) {
      const offset = immediate * 8;
      if (offset >= firstByte && offset < limit)
        counts[immediate] = (counts[immediate] ?? 0) + 1;
    } else {
      const scale =
        kind === 0xb94003e0 || kind === 0xb90003e0
          ? 4
          : kind === 0x794003e0 || kind === 0x790003e0
            ? 2
            : kind === 0x394003e0 || kind === 0x390003e0
              ? 1
              : 0;
      if (scale !== 0) {
        const offset = immediate * scale;
        if (offset >= firstByte && offset < limit)
          blocked[Math.floor(offset / 8)] = 1;
      }
    }
  }
  let promoted = 0;
  for (let register = 16; register < 32; register++) {
    let best = -1,
      score = 0;
    for (let slot = firstByte / 8; slot < slots; slot++) {
      const count = counts[slot] ?? 0;
      if (blocked[slot] !== 1 && registers[slot] === 0 && count > score) {
        best = slot;
        score = count;
      }
    }
    if (best < 0) break;
    registers[best] = register;
    if (report !== undefined) report(best * 8, register);
    promoted++;
  }
  for (let index = start; index < end; index++) {
    const instruction = readWord(code, index);
    if (instruction === undefined) throw "stack instruction invariant";
    const kind = (instruction & 0xffc003e0) >>> 0;
    if (
      kind !== 0xf94003e0 &&
      kind !== 0xf90003e0 &&
      kind !== 0xfd4003e0 &&
      kind !== 0xfd0003e0
    )
      continue;
    const register = registers[(instruction >>> 10) & 4095] ?? 0,
      operand = instruction & 31;
    if (register === 0) continue;
    const replacement =
      kind === 0xf94003e0
        ? 0x9e660000 + register * 32 + operand
        : kind === 0xf90003e0
          ? 0x9e670000 + operand * 32 + register
          : kind === 0xfd4003e0
            ? 0x1e604000 + register * 32 + operand
            : 0x1e604000 + operand * 32 + register;
    writeWord(code, index, replacement);
  }
  return promoted;
}
