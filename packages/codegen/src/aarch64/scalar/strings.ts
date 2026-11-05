import type { Instruction } from "../isa.ts";
import { createLeafAssembler } from "./leaf.ts";
export type StringHelper =
  | "string-starts-with"
  | "string-equal"
  | "string-code-unit"
  | "string-concat-copy"
  | "string-slice-bounds"
  | "string-slice-copy";
/** Flat UTF-16 strings: marker=1 at +0, flags at +8, length at +16, units at +24.
 * All helpers are nonallocating. Valid strings fit in a uint32-sized allocation. */
export function stringHelper(kind: StringHelper): readonly Instruction[] {
  const asm = createLeafAssembler(),
    emit = asm.emit,
    label = asm.label,
    branch = asm.branch;
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
  // x12 count, x13 source units, x14 destination units; clobbers x15/x16, advances pointers.
  function copyUnits(prefix: string): void {
    emit({ op: "movz", width: 64, rd: 15, immediate: 0, shift: 0 });
    compare(15, 12);
    branch(prefix + "-done", "eq");
    label(prefix + "-loop");
    emit({ op: "ldrh", rt: 16, rn: 13, offset: 0 });
    emit({ op: "strh", rt: 16, rn: 14, offset: 0 });
    emit({
      op: "add-imm",
      width: 64,
      rd: 13,
      rn: 13,
      immediate: 2,
      shift: 0,
      setFlags: false,
    });
    emit({
      op: "add-imm",
      width: 64,
      rd: 14,
      rn: 14,
      immediate: 2,
      shift: 0,
      setFlags: false,
    });
    emit({
      op: "add-imm",
      width: 64,
      rd: 15,
      rn: 15,
      immediate: 1,
      shift: 0,
      setFlags: false,
    });
    compare(15, 12);
    branch(prefix + "-loop", "cc");
    label(prefix + "-done");
  }
  if (kind === "string-slice-bounds") {
    // x9 source, d0 begin, d1 limit, x10 limit-present -> x12 begin, x13 count.
    // Clamp before integer conversion; valid flat strings bound results below 2^31.
    emit({ op: "ldr", width: 32, rt: 12, rn: 9, offset: 16 });
    emit({ op: "ucvtf-d-w", rd: 2, rn: 12 });
    emit({ op: "fmov-d-x", rd: 3, rn: "zr" });
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 10,
      immediate: 0,
      shift: 0,
      setFlags: true,
    });
    branch("limit-present", "ne");
    emit({ op: "fmov-d-d", rd: 1, rn: 2 });
    label("limit-present");
    function normalize(reg: number, prefix: string): void {
      emit({ op: "fcmp", rn: reg, rm: reg });
      branch(prefix + "-ordered", "vc");
      emit({ op: "fmov-d-d", rd: reg, rn: 3 });
      label(prefix + "-ordered");
      emit({ op: "frintz", rd: reg, rn: reg });
      emit({ op: "fcmp", rn: reg, rm: 3 });
      branch(prefix + "-positive", "ge");
      emit({ op: "fadd", rd: reg, rn: reg, rm: 2 });
      emit({ op: "fcmp", rn: reg, rm: 3 });
      branch(prefix + "-positive", "ge");
      emit({ op: "fmov-d-d", rd: reg, rn: 3 });
      label(prefix + "-positive");
      emit({ op: "fcmp", rn: reg, rm: 2 });
      branch(prefix + "-bounded", "le");
      emit({ op: "fmov-d-d", rd: reg, rn: 2 });
      label(prefix + "-bounded");
    }
    normalize(0, "begin");
    normalize(1, "limit");
    emit({ op: "fcvtzs-w-d", rd: 12, rn: 0 });
    emit({ op: "fcvtzs-w-d", rd: 13, rn: 1 });
    compare(13, 12);
    branch("nonempty", "hi");
    emit({ op: "movz", width: 64, rd: 13, immediate: 0, shift: 0 });
    emit({ op: "ret", rn: 30 });
    label("nonempty");
    emit({
      op: "sub-reg",
      width: 64,
      rd: 13,
      rn: 13,
      rm: 12,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    emit({ op: "ret", rn: 30 });
  } else if (kind === "string-slice-copy") {
    // x9 destination, x10 source, x11 begin, x12 count. Preserve x9.
    emit({ op: "movz", width: 64, rd: 13, immediate: 1, shift: 0 });
    emit({ op: "str", width: 64, rt: 13, rn: 9, offset: 0 });
    emit({ op: "str", width: 64, rt: "zr", rn: 9, offset: 8 });
    emit({ op: "str", width: 64, rt: 12, rn: 9, offset: 16 });
    emit({
      op: "add-reg",
      width: 64,
      rd: 13,
      rn: 10,
      rm: 11,
      shift: "lsl",
      amount: 1,
      setFlags: false,
    });
    emit({
      op: "add-imm",
      width: 64,
      rd: 13,
      rn: 13,
      immediate: 24,
      shift: 0,
      setFlags: false,
    });
    emit({
      op: "add-imm",
      width: 64,
      rd: 14,
      rn: 9,
      immediate: 24,
      shift: 0,
      setFlags: false,
    });
    copyUnits("slice");
    emit({ op: "ret", rn: 30 });
  } else if (kind === "string-concat-copy") {
    // x9 destination, x10/x11 rooted inputs. Preserve x9; clobber x12-x16.
    // Allocation extent and combined length have already been checked by the caller.
    emit({ op: "movz", width: 64, rd: 12, immediate: 1, shift: 0 });
    emit({ op: "str", width: 64, rt: 12, rn: 9, offset: 0 });
    emit({ op: "str", width: 64, rt: "zr", rn: 9, offset: 8 });
    emit({ op: "ldr", width: 32, rt: 12, rn: 10, offset: 16 });
    emit({ op: "ldr", width: 32, rt: 13, rn: 11, offset: 16 });
    emit({
      op: "add-reg",
      width: 64,
      rd: 12,
      rn: 12,
      rm: 13,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    emit({ op: "str", width: 64, rt: 12, rn: 9, offset: 16 });
    emit({
      op: "add-imm",
      width: 64,
      rd: 14,
      rn: 9,
      immediate: 24,
      shift: 0,
      setFlags: false,
    });
    function copy(source: number, prefix: string): void {
      emit({ op: "ldr", width: 32, rt: 12, rn: source, offset: 16 });
      emit({
        op: "add-imm",
        width: 64,
        rd: 13,
        rn: source,
        immediate: 24,
        shift: 0,
        setFlags: false,
      });
      copyUnits(prefix);
    }
    copy(10, "left");
    copy(11, "right");
    emit({ op: "ret", rn: 30 });
  } else if (kind === "string-equal" || kind === "string-starts-with") {
    // x9/x10 objects -> w9 boolean. Clobbers x9-x15 and flags.
    if (kind === "string-equal") {
      compare(9, 10);
      branch("equal", "eq");
      emit({ op: "ldr", width: 32, rt: 11, rn: 9, offset: 16 });
      emit({ op: "ldr", width: 32, rt: 12, rn: 10, offset: 16 });
      compare(11, 12);
      branch("different", "ne");
    } else {
      // x9 source, x10 search, d0 position. Clamp to [0,length], not relative to end.
      emit({ op: "fcmp", rn: 0, rm: 0 });
      branch("position-ordered", "vc");
      emit({ op: "fmov-d-x", rd: 0, rn: "zr" });
      label("position-ordered");
      emit({ op: "frintz", rd: 0, rn: 0 });
      emit({ op: "fmov-d-x", rd: 1, rn: "zr" });
      emit({ op: "fcmp", rn: 0, rm: 1 });
      branch("position-positive", "ge");
      emit({ op: "fmov-d-d", rd: 0, rn: 1 });
      label("position-positive");
      emit({ op: "ldr", width: 32, rt: 12, rn: 9, offset: 16 });
      emit({ op: "ucvtf-d-w", rd: 1, rn: 12 });
      emit({ op: "fcmp", rn: 0, rm: 1 });
      branch("position-bounded", "le");
      emit({ op: "fmov-d-d", rd: 0, rn: 1 });
      label("position-bounded");
      emit({ op: "fcvtzs-w-d", rd: 13, rn: 0 });
      emit({
        op: "sub-reg",
        width: 64,
        rd: 12,
        rn: 12,
        rm: 13,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      emit({ op: "ldr", width: 32, rt: 11, rn: 10, offset: 16 });
      compare(11, 12);
      branch("different", "hi");
      emit({
        op: "add-reg",
        width: 64,
        rd: 9,
        rn: 9,
        rm: 13,
        shift: "lsl",
        amount: 1,
        setFlags: false,
      });
    }
    emit({ op: "movz", width: 64, rd: 13, immediate: 0, shift: 0 });
    compare(13, 11);
    branch("equal", "eq");
    emit({
      op: "add-imm",
      width: 64,
      rd: 9,
      rn: 9,
      immediate: 24,
      shift: 0,
      setFlags: false,
    });
    emit({
      op: "add-imm",
      width: 64,
      rd: 10,
      rn: 10,
      immediate: 24,
      shift: 0,
      setFlags: false,
    });
    label("scan");
    emit({
      op: "add-reg",
      width: 64,
      rd: 14,
      rn: 9,
      rm: 13,
      shift: "lsl",
      amount: 1,
      setFlags: false,
    });
    emit({
      op: "add-reg",
      width: 64,
      rd: 15,
      rn: 10,
      rm: 13,
      shift: "lsl",
      amount: 1,
      setFlags: false,
    });
    emit({ op: "ldrh", rt: 14, rn: 14, offset: 0 });
    emit({ op: "ldrh", rt: 15, rn: 15, offset: 0 });
    compare(14, 15);
    branch("different", "ne");
    emit({
      op: "add-imm",
      width: 64,
      rd: 13,
      rn: 13,
      immediate: 1,
      shift: 0,
      setFlags: false,
    });
    compare(13, 11);
    branch("scan", "cc");
    label("equal");
    emit({ op: "movz", width: 32, rd: 9, immediate: 1, shift: 0 });
    emit({ op: "ret", rn: 30 });
    label("different");
    emit({ op: "movz", width: 32, rd: 9, immediate: 0, shift: 0 });
    emit({ op: "ret", rn: 30 });
  } else {
    // x9 object, d0 numeric index -> d0 Number using charCodeAt's integer conversion.
    // Clobbers x9/x10, d0/d1 and flags. Flat allocation bounds keep valid indices < 2^31.
    emit({ op: "fcmp", rn: 0, rm: 0 });
    branch("ordered", "vc");
    emit({ op: "fmov-d-x", rd: 0, rn: "zr" });
    label("ordered");
    emit({ op: "frintz", rd: 0, rn: 0 });
    emit({ op: "fmov-d-x", rd: 1, rn: "zr" });
    emit({ op: "fcmp", rn: 0, rm: 1 });
    branch("invalid", "mi");
    emit({ op: "ldr", width: 32, rt: 10, rn: 9, offset: 16 });
    emit({ op: "ucvtf-d-w", rd: 1, rn: 10 });
    emit({ op: "fcmp", rn: 0, rm: 1 });
    branch("invalid", "ge");
    emit({ op: "fcvtzs-w-d", rd: 10, rn: 0 });
    emit({
      op: "add-reg",
      width: 64,
      rd: 9,
      rn: 9,
      rm: 10,
      shift: "lsl",
      amount: 1,
      setFlags: false,
    });
    emit({ op: "ldrh", rt: 10, rn: 9, offset: 24 });
    emit({ op: "ucvtf-d-w", rd: 0, rn: 10 });
    emit({ op: "ret", rn: 30 });
    label("invalid");
    emit({ op: "movz", width: 64, rd: 10, immediate: 0x7ff8, shift: 48 });
    emit({ op: "fmov-d-x", rd: 0, rn: 10 });
    emit({ op: "ret", rn: 30 });
  }
  return asm.finish();
}
