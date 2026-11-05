import type { Instruction } from "../isa.ts";
import { createLeafAssembler } from "./leaf.ts";
/** Nonallocating initialization of one owned numeric typed array.
 * x9 allocation, x10 element count, x11 aligned extent, x12 kind marker.
 * Preserves x9, clobbers x13/x14 and flags. Extent was validated before allocation. */
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
  emit({ op: "movz", width: 64, rd: 14, immediate: 32, shift: 0 });
  asm.label("next");
  emit({
    op: "sub-reg",
    width: 64,
    rd: "zr",
    rn: 14,
    rm: 11,
    shift: "lsl",
    amount: 0,
    setFlags: true,
  });
  asm.branch("done", "cs");
  emit({ op: "str", width: 64, rt: "zr", rn: 13, offset: 0 });
  emit({
    op: "add-imm",
    width: 64,
    rd: 13,
    rn: 13,
    immediate: 8,
    shift: 0,
    setFlags: false,
  });
  emit({
    op: "add-imm",
    width: 64,
    rd: 14,
    rn: 14,
    immediate: 8,
    shift: 0,
    setFlags: false,
  });
  asm.branch("next");
  asm.label("done");
  emit({ op: "ret", rn: 30 });
  return asm.finish();
}
