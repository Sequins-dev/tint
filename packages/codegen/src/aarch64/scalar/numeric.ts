import { createLeafAssembler } from "./leaf.ts";
import type { Instruction } from "../isa.ts";
export type NumericHelper = "to-uint32" | "remainder";
/** Private leaf-kernel ABI, not a source-language or foreign call entry. */
export function numericHelper(kind: NumericHelper): readonly Instruction[] {
  const assembler = createLeafAssembler(),
    emit = assembler.emit,
    label = assembler.label,
    branch = assembler.branch;
  function cmp(rn: number, immediate: number): void {
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn,
      immediate,
      shift: 0,
      setFlags: true,
    });
  }
  if (kind === "to-uint32") {
    // Raw binary64 x9 -> low modulo-2^32 bits in w9. Clobbers x9-x12, NZCV.
    emit({ op: "ubfm", width: 64, rd: 10, rn: 9, immr: 52, imms: 62 });
    cmp(10, 1023);
    branch("zero", "cc"); // |x| < 1, including subnormals and zero.
    cmp(10, 1107);
    branch("zero", "cs"); // exponent >= 84, NaN, infinity.
    cmp(10, 1075);
    branch("left", "cs");
    emit({ op: "ubfm", width: 64, rd: 11, rn: 9, immr: 0, imms: 51 });
    emit({ op: "movz", width: 64, rd: 12, immediate: 16, shift: 48 });
    emit({ op: "orr-reg", width: 64, rd: 11, rn: 11, rm: 12 });
    emit({ op: "movz", width: 64, rd: 12, immediate: 1075, shift: 0 });
    emit({
      op: "sub-reg",
      width: 64,
      rd: 10,
      rn: 12,
      rm: 10,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    emit({ op: "lsrv", width: 64, rd: 11, rn: 11, rm: 10 });
    branch("sign");
    label("left");
    emit({
      op: "sub-imm",
      width: 64,
      rd: 10,
      rn: 10,
      immediate: 1075,
      shift: 0,
      setFlags: false,
    });
    emit({ op: "lslv", width: 32, rd: 11, rn: 9, rm: 10 });
    label("sign");
    cmp(9, 0);
    branch("done", "pl");
    emit({
      op: "sub-reg",
      width: 32,
      rd: 11,
      rn: "zr",
      rm: 11,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    label("done");
    emit({ op: "orr-reg", width: 32, rd: 9, rn: "zr", rm: 11 });
    emit({ op: "ret", rn: 30 });
    label("zero");
    emit({ op: "movz", width: 32, rd: 9, immediate: 0, shift: 0 });
    emit({ op: "ret", rn: 30 });
  } else {
    // d0 % d1 -> d0. Clobbers d0-d5, x9, NZCV. Exact power-of-two reduction.
    emit({ op: "fmov-d-d", rd: 2, rn: 0 });
    emit({ op: "fcmp", rn: 0, rm: 0 });
    branch("invalid", "vs");
    emit({ op: "fcmp", rn: 1, rm: 1 });
    branch("invalid", "vs");
    emit({ op: "fabs", rd: 0, rn: 0 });
    emit({ op: "fabs", rd: 1, rn: 1 });
    emit({ op: "fmov-d-x", rd: 4, rn: "zr" });
    emit({ op: "fcmp", rn: 1, rm: 4 });
    branch("invalid", "eq");
    emit({ op: "movz", width: 64, rd: 9, immediate: 0x7ff0, shift: 48 });
    emit({ op: "fmov-d-x", rd: 4, rn: 9 });
    emit({ op: "fcmp", rn: 0, rm: 4 });
    branch("invalid", "eq");
    emit({ op: "fcmp", rn: 0, rm: 1 });
    branch("original", "mi");
    // A normal power-of-two divisor scales binary64 exactly. With |x| >= |y|,
    // the quotient cannot underflow; truncation and subtraction give the exact
    // remainder. An overflowing quotient implies x is already a multiple of y.
    // Other divisors retain the general reduction (rounded division is unsafe).
    emit({ op: "fmov-x-d", rd: 9, rn: 1 });
    emit({ op: "ubfm", width: 64, rd: 9, rn: 9, immr: 0, imms: 51 });
    cmp(9, 0);
    branch("general", "ne");
    emit({ op: "fdiv", rd: 3, rn: 0, rm: 1 });
    emit({ op: "fcmp", rn: 3, rm: 4 });
    branch("power-zero", "eq");
    emit({ op: "frintz", rd: 3, rn: 3 });
    emit({ op: "fmul", rd: 3, rn: 3, rm: 1 });
    emit({ op: "fsub", rd: 0, rn: 0, rm: 3 });
    branch("sign");
    label("power-zero");
    emit({ op: "fmov-d-x", rd: 0, rn: "zr" });
    branch("sign");
    label("general");
    emit({ op: "fmov-d-d", rd: 3, rn: 1 });
    emit({ op: "movz", width: 64, rd: 9, immediate: 0x3fe0, shift: 48 });
    emit({ op: "fmov-d-x", rd: 5, rn: 9 });
    emit({ op: "fmul", rd: 4, rn: 0, rm: 5 });
    label("scale");
    emit({ op: "fcmp", rn: 3, rm: 4 });
    branch("reduce", "gt");
    emit({ op: "fadd", rd: 3, rn: 3, rm: 3 });
    branch("scale");
    label("reduce");
    emit({ op: "fcmp", rn: 0, rm: 3 });
    branch("halve", "mi");
    emit({ op: "fsub", rd: 0, rn: 0, rm: 3 });
    label("halve");
    emit({ op: "fcmp", rn: 3, rm: 1 });
    branch("sign", "eq");
    emit({ op: "fmul", rd: 3, rn: 3, rm: 5 });
    branch("reduce");
    label("sign");
    emit({ op: "fmov-d-x", rd: 4, rn: "zr" });
    emit({ op: "fcmp", rn: 2, rm: 4 });
    branch("done", "pl");
    emit({ op: "fneg", rd: 0, rn: 0 });
    label("done");
    emit({ op: "ret", rn: 30 });
    label("original");
    emit({ op: "fmov-d-d", rd: 0, rn: 2 });
    emit({ op: "ret", rn: 30 });
    label("invalid");
    emit({ op: "fmov-d-x", rd: 0, rn: "zr" });
    emit({ op: "fdiv", rd: 0, rn: 0, rm: 0 });
    emit({ op: "ret", rn: 30 });
  }
  return assembler.finish();
}
