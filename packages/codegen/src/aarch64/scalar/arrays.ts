import type { Instruction } from "../isa.ts";
import { createLeafAssembler } from "./leaf.ts";
/** Nonallocating initialization of one owned numeric typed array.
 * x9 allocation, x10 element count, x11 aligned extent, x12 kind marker.
 * Preserves x9, clobbers x13-x15 and flags. Extent was validated before
 * allocation; it is a multiple of 16, so the data after the 32-byte header
 * clears in 16-byte pairs: 64 bytes per iteration, then the remainder. Data
 * of 256 bytes or more clears whole 64-byte cache lines with DC ZVA (no line
 * fill from memory) when DCZID_EL0 reads 4: zeroing permitted, 64-byte
 * blocks, as on Apple cores; any other value keeps the store loops. */
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
  // x14 = end of the extent.
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
  const compare = (rn: number, rm: number): void =>
    emit({
      op: "sub-reg",
      width: 64,
      rd: "zr",
      rn,
      rm,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
  const compareImmediate = (rn: number, immediate: number): void =>
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn,
      immediate,
      shift: 0,
      setFlags: true,
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
  // Small data (or no usable DC ZVA) takes the store loops directly.
  emit({
    op: "sub-reg",
    width: 64,
    rd: 15,
    rn: 14,
    rm: 13,
    shift: "lsl",
    amount: 0,
    setFlags: false,
  });
  compareImmediate(15, 256);
  asm.branch("stores", "cc");
  emit({ op: "mrs-dczid", rt: 15 });
  compareImmediate(15, 4);
  asm.branch("stores", "ne");
  // Pairs up to the first 64-byte boundary (at most three).
  asm.label("align");
  emit({ op: "ubfm", width: 64, rd: 15, rn: 13, immr: 0, imms: 5 });
  compareImmediate(15, 0);
  asm.branch("lines", "eq");
  clearPair();
  asm.branch("align");
  // x15 = end - 64: the last line start that fits.
  asm.label("lines");
  emit({
    op: "sub-imm",
    width: 64,
    rd: 15,
    rn: 14,
    immediate: 64,
    shift: 0,
    setFlags: false,
  });
  asm.label("line");
  compare(13, 15);
  asm.branch("stores", "hi");
  emit({ op: "dc-zva", rt: 13 });
  emit({
    op: "add-imm",
    width: 64,
    rd: 13,
    rn: 13,
    immediate: 64,
    shift: 0,
    setFlags: false,
  });
  asm.branch("line");
  // x14 = end - 64: the last cursor from which a whole block fits.
  asm.label("stores");
  emit({
    op: "sub-imm",
    width: 64,
    rd: 14,
    rn: 14,
    immediate: 64,
    shift: 0,
    setFlags: false,
  });
  asm.label("block");
  compare(13, 14);
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
  compare(13, 14);
  asm.branch("done", "cs");
  clearPair();
  asm.branch("pair");
  asm.label("done");
  emit({ op: "ret", rn: 30 });
  return asm.finish();
}
