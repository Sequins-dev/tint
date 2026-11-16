import type { Instruction } from "../isa.ts";
import { createLeafAssembler } from "./leaf.ts";
/** x9 is an initialized object start, x10 the runtime context. Preserve x0 and x9;
 * clobber x10..x16, d0 and flags. Nonallocating and nonsafepointing. Publication
 * proves buffer extents; the runtime exclusively maintains old top/base/count.
 * Queue overflow retains the bitmap and requests a complete remembered scan. */
export function rememberedBarrier(): readonly Instruction[] {
  const asm = createLeafAssembler(),
    emit = asm.emit;
  function compare(left: number, right: number): void {
    emit({
      op: "sub-reg",
      width: 64,
      rd: "zr",
      rn: left,
      rm: right,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
  }
  function zero(register: number): void {
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: register,
      immediate: 0,
      shift: 0,
      setFlags: true,
    });
  }
  function subtract(rd: number, left: number, right: number): void {
    emit({
      op: "sub-reg",
      width: 64,
      rd,
      rn: left,
      rm: right,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
  }
  emit({ op: "ldr", width: 64, rt: 12, rn: 10, offset: 56 });
  zero(12);
  asm.branch("done", "eq");
  emit({ op: "ldr", width: 32, rt: 11, rn: 12, offset: 24 });
  zero(11);
  asm.branch("done", "eq");
  emit({ op: "ldr", width: 64, rt: 10, rn: 10, offset: 8 });
  subtract(11, 9, 10);
  emit({ op: "ldr", width: 32, rt: 13, rn: 12, offset: 8 });
  emit({ op: "ldr", width: 32, rt: 14, rn: 12, offset: 28 });
  subtract(13, 13, 14);
  subtract(11, 11, 13);
  emit({ op: "ldr", width: 32, rt: 13, rn: 12, offset: 12 });
  compare(11, 13);
  asm.branch("done", "cs");
  // One dirty bit per 8-byte granule: byte offset >> 6, bit (offset >> 3) & 7.
  emit({ op: "ubfm", width: 64, rd: 13, rn: 11, immr: 6, imms: 63 });
  emit({ op: "ubfm", width: 32, rd: 14, rn: 11, immr: 3, imms: 5 });
  emit({ op: "ldr", width: 64, rt: 15, rn: 12, offset: 32 });
  emit({
    op: "add-reg",
    width: 64,
    rd: 15,
    rn: 15,
    rm: 13,
    shift: "lsl",
    amount: 0,
    setFlags: false,
  });
  emit({ op: "ldrb", rt: 13, rn: 15, offset: 0 });
  emit({ op: "movz", width: 32, rd: 16, immediate: 1, shift: 0 });
  emit({ op: "lslv", width: 32, rd: 16, rn: 16, rm: 14 });
  emit({ op: "and-reg", width: 32, rd: 14, rn: 13, rm: 16 });
  zero(14);
  asm.branch("done", "ne");
  emit({ op: "orr-reg", width: 32, rd: 13, rn: 13, rm: 16 });
  emit({ op: "strb", rt: 13, rn: 15, offset: 0 });
  emit({ op: "ldr", width: 32, rt: 13, rn: 12, offset: 48 });
  emit({ op: "ldr", width: 32, rt: 14, rn: 12, offset: 52 });
  compare(13, 14);
  asm.branch("overflow", "cs");
  emit({ op: "ldr", width: 64, rt: 15, rn: 12, offset: 40 });
  emit({
    op: "add-reg",
    width: 64,
    rd: 15,
    rn: 15,
    rm: 13,
    shift: "lsl",
    amount: 3,
    setFlags: false,
  });
  emit({ op: "scvtf-d-x", rd: 0, rn: 11 });
  emit({ op: "str-d", rt: 0, rn: 15, offset: 0 });
  emit({
    op: "add-imm",
    width: 32,
    rd: 13,
    rn: 13,
    immediate: 1,
    shift: 0,
    setFlags: false,
  });
  emit({ op: "str", width: 32, rt: 13, rn: 12, offset: 48 });
  asm.branch("done");
  asm.label("overflow");
  emit({ op: "movz", width: 32, rd: 13, immediate: 1, shift: 0 });
  emit({ op: "str", width: 32, rt: 13, rn: 12, offset: 56 });
  asm.label("done");
  emit({ op: "ret", rn: 30 });
  return asm.finish();
}
