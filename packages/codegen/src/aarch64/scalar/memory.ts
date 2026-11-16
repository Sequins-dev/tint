import type { Instruction } from "../isa.ts";
import { nativeArrayLengthOffset, nativeArrayDataOffset } from "@tint/abi/host";
import { createLeafAssembler } from "./leaf.ts";
/** x0 authorized base, x1 window length, x2 destination offset, x3 source offset,
 * x4 byte count. Inputs are exact nonnegative integers. Returns x0 = 0 or -1.
 * Normal mapped memory only. Nonallocating, overlap-safe, clobbers x0..x4/x9..x11.
 * Typed-array variant: x0 destination header, x1 source header, d0 integer
 * element offset, x5 element-size shift. Verified IR guarantees matching numeric
 * encodings. Returns boolean x0. Both variants share the overlap-safe byte loop. */
export function memoryMover(
  typedArrays: boolean = false,
): readonly Instruction[] {
  const asm = createLeafAssembler(),
    emit = asm.emit;
  function compare(a: number, b: number): void {
    emit({
      op: "sub-reg",
      width: 64,
      rd: "zr",
      rn: a,
      rm: b,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
  }
  function add(rd: number, rn: number, rm: number): void {
    emit({
      op: "add-reg",
      width: 64,
      rd,
      rn,
      rm,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
  }
  function subtract(rd: number, rn: number, rm: number): void {
    emit({
      op: "sub-reg",
      width: 64,
      rd,
      rn,
      rm,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
  }
  function step(rd: number, amount: number, forward: boolean): void {
    emit({
      op: forward ? "add-imm" : "sub-imm",
      width: 64,
      rd,
      rn: rd,
      immediate: amount,
      shift: 0,
      setFlags: false,
    });
  }
  if (typedArrays) {
    // Reject nonintegral, negative, nonfinite or oversized offsets before touching data.
    emit({ op: "fcvtzs-x-d", rd: 2, rn: 0 });
    emit({ op: "scvtf-d-x", rd: 1, rn: 2 });
    emit({ op: "fcmp", rn: 0, rm: 1 });
    asm.branch("invalid", "ne");
    emit({
      op: "ldr",
      width: 64,
      rt: 11,
      rn: 0,
      offset: nativeArrayLengthOffset,
    });
    emit({
      op: "ldr",
      width: 64,
      rt: 4,
      rn: 1,
      offset: nativeArrayLengthOffset,
    });
    compare(2, 11);
    asm.branch("invalid", "hi");
    subtract(11, 11, 2);
    compare(4, 11);
    asm.branch("invalid", "hi");
    emit({ op: "ldr", width: 64, rt: 9, rn: 0, offset: nativeArrayDataOffset });
    emit({ op: "ldr", width: 64, rt: 3, rn: 1, offset: nativeArrayDataOffset });
    emit({ op: "lslv", width: 64, rd: 2, rn: 2, rm: 5 });
    emit({ op: "lslv", width: 64, rd: 4, rn: 4, rm: 5 });
    add(2, 9, 2);
  } else {
    // Validate every range before the first load or store.
    for (const shift of [0, 16, 32, 48])
      emit({
        op: shift === 0 ? "movz" : "movk",
        width: 64,
        rd: 9,
        immediate: shift === 48 ? 31 : 65535,
        shift: shift === 0 ? 0 : shift === 16 ? 16 : shift === 32 ? 32 : 48,
      });
    add(10, 0, 1);
    compare(10, 9);
    asm.branch("invalid", "hi");
    compare(2, 1);
    asm.branch("invalid", "hi");
    compare(3, 1);
    asm.branch("invalid", "hi");
    subtract(10, 1, 2);
    compare(4, 10);
    asm.branch("invalid", "hi");
    subtract(10, 1, 3);
    compare(4, 10);
    asm.branch("invalid", "hi");
    add(2, 0, 2);
    add(3, 0, 3);
  }
  compare(2, 3);
  asm.branch("done", "eq");
  asm.branch("forward", "cc");
  add(2, 2, 4);
  add(3, 3, 4);
  function copy(
    label: string,
    next: string,
    width: 1 | 8 | 16,
    forward: boolean,
  ): void {
    asm.label(label);
    emit({ op: "movz", width: 64, rd: 10, immediate: width, shift: 0 });
    compare(4, 10);
    asm.branch(next, "cc");
    if (width === 16) {
      // Pair transfers move 16 bytes per iteration, post-indexed forward
      // and pre-indexed backward.
      emit({
        op: "ldp",
        width: 64,
        rt: 9,
        rt2: 10,
        rn: 3,
        offset: forward ? 16 : -16,
        mode: forward ? "post" : "pre",
      });
      emit({
        op: "stp",
        width: 64,
        rt: 9,
        rt2: 10,
        rn: 2,
        offset: forward ? 16 : -16,
        mode: forward ? "post" : "pre",
      });
      step(4, 16, false);
      asm.branch(label);
      return;
    }
    if (!forward) {
      step(2, width, false);
      step(3, width, false);
    }
    if (width === 8) {
      emit({ op: "ldr", width: 64, rt: 9, rn: 3, offset: 0 });
      emit({ op: "str", width: 64, rt: 9, rn: 2, offset: 0 });
    } else {
      emit({ op: "ldrb", rt: 9, rn: 3, offset: 0 });
      emit({ op: "strb", rt: 9, rn: 2, offset: 0 });
    }
    if (forward) {
      step(2, width, true);
      step(3, width, true);
    }
    step(4, width, false);
    asm.branch(label);
  }
  copy("backward-pair", "backward-word", 16, false);
  copy("backward-word", "backward-byte", 8, false);
  copy("backward-byte", "done", 1, false);
  asm.label("forward");
  copy("forward-pair", "forward-word", 16, true);
  copy("forward-word", "forward-byte", 8, true);
  copy("forward-byte", "done", 1, true);
  asm.label("done");
  emit({
    op: "movz",
    width: 64,
    rd: 0,
    immediate: typedArrays ? 1 : 0,
    shift: 0,
  });
  emit({ op: "ret", rn: 30 });
  asm.label("invalid");
  if (typedArrays)
    emit({ op: "movz", width: 64, rd: 0, immediate: 0, shift: 0 });
  else emit({ op: "orn-reg", width: 64, rd: 0, rn: "zr", rm: "zr" });
  emit({ op: "ret", rn: 30 });
  return asm.finish();
}
