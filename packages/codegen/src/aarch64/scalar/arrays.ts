import type { Instruction } from "../isa.ts";
import { createLeafAssembler } from "./leaf.ts";
/** Nonallocating initialization of one owned numeric typed array.
 * x9 allocation, x10 element count, x11 aligned extent, x12 kind marker.
 * Preserves x9, clobbers x13/x14 and flags. Extent was validated before
 * allocation; it is a multiple of 16, so the data after the 32-byte header
 * clears in 16-byte pairs: 64 bytes per iteration, then the remainder. */
export function arrayInitializer(): readonly Instruction[] {
  const asm = createLeafAssembler(),
    emit = asm.emit;
  emit({ op: "str", width: 64, rt: 12, rn: 9, offset: 0 });
  emit({ op: "str", width: 64, rt: "zr", rn: 9, offset: 8 });
  emit({ op: "str", width: 64, rt: 10, rn: 9, offset: 16 });
  emit({
    op: "add-imm",
    width: 64,
    rd: 13,
    rn: 9,
    immediate: 32,
    shift: 0,
    setFlags: false,
  });
  emit({ op: "str", width: 64, rt: 13, rn: 9, offset: 24 });
  // x14 = end - 64: the last cursor from which a whole block fits.
  emit({
    op: "add-reg",
    width: 64,
    rd: 14,
    rn: 9,
    rm: 11,
    shift: "lsl",
    amount: 0,
    setFlags: false,
  });
  emit({
    op: "sub-imm",
    width: 64,
    rd: 14,
    rn: 14,
    immediate: 64,
    shift: 0,
    setFlags: false,
  });
  const clearPair = (): void =>
    emit({
      op: "stp",
      width: 64,
      rt: "zr",
      rt2: "zr",
      rn: 13,
      offset: 16,
      mode: "post",
    });
  asm.label("block");
  emit({
    op: "sub-reg",
    width: 64,
    rd: "zr",
    rn: 13,
    rm: 14,
    shift: "lsl",
    amount: 0,
    setFlags: true,
  });
  asm.branch("tail", "hi");
  clearPair();
  clearPair();
  clearPair();
  clearPair();
  asm.branch("block");
  asm.label("tail");
  emit({
    op: "add-imm",
    width: 64,
    rd: 14,
    rn: 14,
    immediate: 64,
    shift: 0,
    setFlags: false,
  });
  asm.label("pair");
  emit({
    op: "sub-reg",
    width: 64,
    rd: "zr",
    rn: 13,
    rm: 14,
    shift: "lsl",
    amount: 0,
    setFlags: true,
  });
  asm.branch("done", "cs");
  clearPair();
  asm.branch("pair");
  asm.label("done");
  emit({ op: "ret", rn: 30 });
  return asm.finish();
}
