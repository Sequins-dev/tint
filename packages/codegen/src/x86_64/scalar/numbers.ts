import type { Condition, Gpr, Memory, Xmm } from "../isa.ts";
import {
  bits,
  byte,
  gpr,
  imm,
  label,
  setBoolean,
  word,
  xmm,
  type Emit,
} from "./machine.ts";

const eax = word(0);
const ecx = word(1);
const edx = word(2);
const r11d = word(11);
const rax = gpr(0);
const rcx = gpr(1);
const rdx = gpr(2);
const r10 = gpr(10);
const r11 = gpr(11);
const x0 = xmm(0);
const x1 = xmm(1);
const x2 = xmm(2);
const x3 = xmm(3);
const toWordLabel = "number-to-word";
const remainderLabel = "number-remainder";
const toFloat16Label = "number-to-float16";
const fromFloat16Label = "float16-to-number";

export function floatBits(emit: Emit, dst: Gpr<64>, src: Xmm): void {
  const insn: {
    readonly op: "movq";
    readonly dst: Gpr<64>;
    readonly src: Xmm;
  } = { op: "movq", dst, src };
  emit(insn);
}
/** MOVD: the low 32 bits of an XMM register (a binary32's bits). */
export function float32Bits(emit: Emit, dst: Gpr<32>, src: Xmm): void {
  const insn: {
    readonly op: "movd";
    readonly dst: Gpr<32>;
    readonly src: Xmm;
  } = { op: "movd", dst, src };
  emit(insn);
}
export function bitsFloat(emit: Emit, dst: Xmm, src: Gpr<64>): void {
  const insn: {
    readonly op: "movq";
    readonly dst: Xmm;
    readonly src: Gpr<64>;
  } = { op: "movq", dst, src };
  emit(insn);
}

function scalarDouble(
  emit: Emit,
  op: "addsd" | "subsd" | "mulsd" | "divsd" | "minsd" | "maxsd",
  src: Memory<64>,
): void {
  const insn: {
    readonly op: "addsd" | "subsd" | "mulsd" | "divsd" | "minsd" | "maxsd";
    readonly dst: Xmm;
    readonly src: Memory<64>;
  } = { op, dst: x0, src };
  emit(insn);
}

function compare(emit: Emit, cc: Condition, ordered: boolean): void {
  if (ordered) emit({ op: "setcc", cc: "np", dst: byte(2) });
  emit({ op: "setcc", cc, dst: byte(0) });
  if (ordered) emit({ op: "and", dst: byte(0), src: byte(2) });
  emit({ op: "movzx", dst: eax, src: byte(0) });
}

interface NumberEmission {
  readonly unary: (operator: string, src: Memory<64>) => boolean;
  readonly binary: (
    operator: string,
    left: Memory<64>,
    right: Memory<64>,
  ) => boolean;
  readonly toWord: (src: Memory<64>) => void;
  readonly toFloat16: (src: Memory<64>) => void;
  readonly fromFloat16: () => void;
  readonly helpers: () => void;
}

export function createNumberEmission(emit: Emit): NumberEmission {
  let needsWord = false,
    needsRemainder = false,
    needsToFloat16 = false,
    needsFromFloat16 = false,
    nextLabel = 0;

  function toWord(src: Memory<64>): void {
    needsWord = true;
    emit({ op: "mov", dst: rax, src });
    emit({ op: "call", target: label(toWordLabel) });
  }

  function toFloat16(src: Memory<64>): void {
    needsToFloat16 = true;
    emit({ op: "mov", dst: rax, src });
    emit({ op: "call", target: label(toFloat16Label) });
  }

  function fromFloat16(): void {
    needsFromFloat16 = true;
    emit({ op: "call", target: label(fromFloat16Label) });
  }

  function unary(operator: string, src: Memory<64>): boolean {
    switch (operator) {
      case "+":
      case "uint32": // The IR producer promises an exact uint32 already.
        emit({ op: "mov", dst: rax, src });
        return true;
      case "-":
        emit({ op: "mov", dst: rax, src });
        emit({ op: "mov", dst: rdx, src: bits(0, 0x80000000) });
        emit({ op: "xor", dst: rax, src: rdx });
        return true;
      case "~":
        toWord(src);
        emit({ op: "not", dst: eax });
        emit({ op: "cvtsi2sd", dst: x0, src: eax });
        break;
      case "sqrt":
        emit({ op: "sqrtsd", dst: x0, src });
        break;
      case "boolean-number":
        emit({ op: "cvtsi2sd", dst: x0, src });
        break;
      case "truthy":
      case "!":
        emit({ op: "xorpd", dst: x0, src: x0 });
        emit({ op: "ucomisd", dst: x0, src });
        compare(emit, operator === "!" ? "e" : "ne", false);
        return true;
      case "ceil":
      case "trunc":
      case "is-integer":
        round(operator, src);
        return true;
      default:
        return false;
    }
    floatBits(emit, rax, x0);
    return true;
  }

  function round(operator: string, src: Memory<64>): void {
    const prefix = "round:" + String(nextLabel++);
    const large = prefix + ":large";
    const done = prefix + ":done";
    const save = prefix + ":save";
    // Binary64 values of magnitude >= 2^52 have no fractional bits.
    emit({ op: "mov", dst: rax, src });
    emit({ op: "mov", dst: rdx, src: rax });
    emit({ op: "shl", dst: rdx, count: 1 });
    emit({ op: "shr", dst: rdx, count: 53 });
    emit({ op: "cmp", dst: edx, src: imm(1023 + 52) });
    emit({ op: "jcc", cc: "ae", target: label(large) });
    bitsFloat(emit, x0, rax);
    emit({ op: "cvttsd2si", dst: rdx, src: x0 });
    emit({ op: "cvtsi2sd", dst: x1, src: rdx });
    if (operator === "is-integer") {
      emit({ op: "ucomisd", dst: x0, src: x1 });
      setBoolean(emit, "e", 0);
      emit({ op: "jmp", target: label(done) });
    } else {
      if (operator === "ceil") {
        emit({ op: "ucomisd", dst: x0, src: x1 });
        emit({ op: "jcc", cc: "be", target: label(save) });
        emit({ op: "add", dst: rdx, src: imm(1) });
        emit({ op: "cvtsi2sd", dst: x1, src: rdx });
      }
      emit({ op: "label", name: save });
      floatBits(emit, rdx, x1);
      // Preserve the sign even when conversion through int64 produced zero.
      emit({ op: "shr", dst: rax, count: 63 });
      emit({ op: "shl", dst: rax, count: 63 });
      emit({ op: "or", dst: rax, src: rdx });
      emit({ op: "jmp", target: label(done) });
    }
    emit({ op: "label", name: large });
    if (operator === "is-integer") {
      emit({ op: "cmp", dst: edx, src: imm(2047) });
      setBoolean(emit, "ne", 0);
    }
    emit({ op: "label", name: done });
  }

  function binary(
    operator: string,
    left: Memory<64>,
    right: Memory<64>,
  ): boolean {
    switch (operator) {
      case "&":
      case "|":
      case "^":
      case "<<":
      case ">>":
      case ">>>":
      case "imul":
        wordBinary(operator, left, right);
        return true;
      case "===":
      case "==":
      case "!==":
      case "!=":
      case "<":
      case "<=":
      case ">":
      case ">=": {
        emit({ op: "movsd", dst: x0, src: left });
        emit({ op: "ucomisd", dst: x0, src: right });
        if (operator === "!==" || operator === "!=") {
          // Unordered is unequal even though UCOMISD sets ZF.
          emit({ op: "setcc", cc: "p", dst: byte(2) });
          emit({ op: "setcc", cc: "ne", dst: byte(0) });
          emit({ op: "or", dst: byte(0), src: byte(2) });
          emit({ op: "movzx", dst: eax, src: byte(0) });
        } else {
          const cc: Condition =
            operator === "<"
              ? "b"
              : operator === "<="
                ? "be"
                : operator === ">"
                  ? "a"
                  : operator === ">="
                    ? "ae"
                    : "e";
          compare(emit, cc, cc === "b" || cc === "be" || cc === "e");
        }
        return true;
      }
      case "+":
      case "-":
      case "*":
      case "/":
        emit({ op: "movsd", dst: x0, src: left });
        scalarDouble(
          emit,
          operator === "+"
            ? "addsd"
            : operator === "-"
              ? "subsd"
              : operator === "*"
                ? "mulsd"
                : "divsd",
          right,
        );
        break;
      case "%":
        needsRemainder = true;
        emit({ op: "movsd", dst: x0, src: left });
        emit({ op: "movsd", dst: x1, src: right });
        emit({ op: "call", target: label(remainderLabel) });
        break;
      case "min":
      case "max":
        minMax(operator, left, right);
        return true;
      default:
        return false;
    }
    floatBits(emit, rax, x0);
    return true;
  }

  function minMax(operator: string, left: Memory<64>, right: Memory<64>): void {
    const prefix = "minmax:" + String(nextLabel++);
    const unordered = prefix + ":unordered";
    const distinct = prefix + ":distinct";
    const done = prefix + ":done";
    emit({ op: "movsd", dst: x0, src: left });
    emit({ op: "ucomisd", dst: x0, src: right });
    emit({ op: "jcc", cc: "p", target: label(unordered) });
    emit({ op: "jcc", cc: "ne", target: label(distinct) });
    emit({ op: "mov", dst: rax, src: left });
    // Numerically equal nonzero operands have identical bits. For zero,
    // min retains either negative sign and max retains either positive sign.
    if (operator === "min") emit({ op: "or", dst: rax, src: right });
    else emit({ op: "and", dst: rax, src: right });
    emit({ op: "jmp", target: label(done) });
    emit({ op: "label", name: distinct });
    scalarDouble(emit, operator === "min" ? "minsd" : "maxsd", right);
    floatBits(emit, rax, x0);
    emit({ op: "jmp", target: label(done) });
    emit({ op: "label", name: unordered });
    emit({ op: "mov", dst: rax, src: bits(0, 0x7ff80000) });
    emit({ op: "label", name: done });
  }

  function wordBinary(
    operator: string,
    left: Memory<64>,
    right: Memory<64>,
  ): void {
    toWord(left);
    emit({ op: "mov", dst: word(10), src: eax });
    toWord(right);
    if (operator === "<<" || operator === ">>" || operator === ">>>") {
      emit({ op: "mov", dst: ecx, src: eax });
      const dst = word(10);
      if (operator === "<<") emit({ op: "shl", dst, count: "cl" });
      else if (operator === ">>") emit({ op: "sar", dst, count: "cl" });
      else emit({ op: "shr", dst, count: "cl" });
    } else if (operator === "imul")
      emit({ op: "imul", dst: word(10), src: eax });
    else if (operator === "&") emit({ op: "and", dst: word(10), src: eax });
    else if (operator === "|") emit({ op: "or", dst: word(10), src: eax });
    else emit({ op: "xor", dst: word(10), src: eax });
    // A 32-bit destination zero-extends. Use the full zero-extended register
    // for an unsigned shift result and a signed 32-bit operand otherwise.
    emit({ op: "cvtsi2sd", dst: x0, src: operator === ">>>" ? r10 : word(10) });
    floatBits(emit, rax, x0);
  }

  function helpers(): void {
    if (needsWord) emitToWord(emit);
    if (needsRemainder) emitRemainder(emit);
    if (needsToFloat16) emitToFloat16(emit);
    if (needsFromFloat16) emitFromFloat16(emit);
  }
  return { unary, binary, toWord, toFloat16, fromFloat16, helpers };
}

/** Truncate binary64 and return the low 32 bits, without a trapping conversion.
 * For 2^84 and above, even the least significant mantissa bit shifts past bit
 * 31. The exponent also excludes tiny values, NaN and infinities. */
function emitToWord(emit: Emit): void {
  const zero = toWordLabel + ":zero";
  const left = toWordLabel + ":left";
  const sign = toWordLabel + ":sign";
  const done = toWordLabel + ":done";
  emit({ op: "label", name: toWordLabel });
  emit({ op: "mov", dst: r11, src: rax });
  emit({ op: "mov", dst: rdx, src: rax });
  emit({ op: "shl", dst: rdx, count: 1 });
  emit({ op: "shr", dst: rdx, count: 53 });
  emit({ op: "sub", dst: edx, src: imm(1023) });
  emit({ op: "cmp", dst: edx, src: imm(84) });
  emit({ op: "jcc", cc: "ae", target: label(zero) });
  emit({ op: "shl", dst: rax, count: 12 });
  emit({ op: "shr", dst: rax, count: 12 });
  emit({ op: "mov", dst: ecx, src: imm(52) });
  emit({ op: "sub", dst: ecx, src: edx });
  emit({ op: "mov", dst: rdx, src: bits(0, 0x00100000) });
  emit({ op: "or", dst: rax, src: rdx });
  emit({ op: "cmp", dst: ecx, src: imm(0) });
  emit({ op: "jcc", cc: "l", target: label(left) });
  emit({ op: "shr", dst: rax, count: "cl" });
  emit({ op: "jmp", target: label(sign) });
  emit({ op: "label", name: left });
  emit({ op: "neg", dst: ecx });
  emit({ op: "shl", dst: eax, count: "cl" });
  emit({ op: "label", name: sign });
  emit({ op: "test", dst: r11, src: r11 });
  emit({ op: "jcc", cc: "ns", target: label(done) });
  emit({ op: "neg", dst: eax });
  emit({ op: "label", name: done });
  emit({ op: "ret" });
  emit({ op: "label", name: zero });
  emit({ op: "xor", dst: eax, src: eax });
  emit({ op: "ret" });
}

/** ECMAScript remainder uses the dividend's sign, including exact zero.
 * With finite magnitudes, double the divisor up to the dividend's highest
 * usable scale, then subtract at descending scales. Each subtraction is
 * between magnitudes within a factor of two and is exact, including subnormals. */
function emitRemainder(emit: Emit): void {
  const invalid = remainderLabel + ":invalid";
  const grow = remainderLabel + ":grow";
  const reduce = remainderLabel + ":reduce";
  const subtract = remainderLabel + ":subtract";
  const descend = remainderLabel + ":descend";
  const signed = remainderLabel + ":signed";
  emit({ op: "label", name: remainderLabel });
  floatBits(emit, r10, x0);
  floatBits(emit, rax, x1);
  emit({ op: "mov", dst: rdx, src: r10 });
  emit({ op: "shl", dst: rdx, count: 1 });
  emit({ op: "shr", dst: rdx, count: 1 });
  emit({ op: "shl", dst: rax, count: 1 });
  emit({ op: "shr", dst: rax, count: 1 });
  emit({ op: "jcc", cc: "e", target: label(invalid) });
  emit({ op: "mov", dst: r11, src: bits(0, 0x7ff00000) });
  emit({ op: "cmp", dst: rdx, src: r11 });
  emit({ op: "jcc", cc: "ae", target: label(invalid) });
  emit({ op: "cmp", dst: rax, src: r11 });
  emit({ op: "jcc", cc: "a", target: label(invalid) });
  bitsFloat(emit, x0, rdx);
  bitsFloat(emit, x1, rax);
  emit({ op: "ucomisd", dst: x0, src: x1 });
  emit({ op: "jcc", cc: "b", target: label(signed) });
  emit({ op: "movsd", dst: x2, src: x1 });
  emit({ op: "label", name: grow });
  emit({ op: "movsd", dst: x3, src: x2 });
  emit({ op: "addsd", dst: x3, src: x2 });
  emit({ op: "ucomisd", dst: x3, src: x0 });
  emit({ op: "jcc", cc: "a", target: label(reduce) });
  emit({ op: "movsd", dst: x2, src: x3 });
  emit({ op: "jmp", target: label(grow) });
  emit({ op: "label", name: reduce });
  emit({ op: "mov", dst: rax, src: bits(0, 0x3fe00000) });
  bitsFloat(emit, x3, rax);
  emit({ op: "label", name: subtract });
  emit({ op: "ucomisd", dst: x0, src: x2 });
  emit({ op: "jcc", cc: "b", target: label(descend) });
  emit({ op: "subsd", dst: x0, src: x2 });
  emit({ op: "label", name: descend });
  emit({ op: "ucomisd", dst: x2, src: x1 });
  emit({ op: "jcc", cc: "e", target: label(signed) });
  emit({ op: "mulsd", dst: x2, src: x3 });
  emit({ op: "jmp", target: label(subtract) });
  emit({ op: "label", name: signed });
  emit({ op: "shr", dst: r10, count: 63 });
  emit({ op: "shl", dst: r10, count: 63 });
  floatBits(emit, rax, x0);
  emit({ op: "or", dst: rax, src: r10 });
  bitsFloat(emit, x0, rax);
  emit({ op: "ret" });
  emit({ op: "label", name: invalid });
  emit({ op: "mov", dst: rax, src: bits(0, 0x7ff80000) });
  bitsFloat(emit, x0, rax);
  emit({ op: "ret" });
}

/** Convert IEEE-754 binary64 bits in RAX to IEEE-754 binary16 bits in EAX
 * using exact round-to-nearest, ties-to-even (no double rounding). Preserves
 * R9 and R10. */
function emitToFloat16(emit: Emit): void {
  const subnormal = toFloat16Label + ":subnormal";
  const underflow = toFloat16Label + ":underflow";
  const overflow = toFloat16Label + ":overflow";
  const special = toFloat16Label + ":special";
  emit({ op: "label", name: toFloat16Label });
  emit({ op: "mov", dst: r11, src: rax });
  emit({ op: "shr", dst: r11, count: 48 });
  emit({ op: "and", dst: r11d, src: imm(0x8000) });
  emit({ op: "shl", dst: rax, count: 1 });
  emit({ op: "shr", dst: rax, count: 1 });
  emit({ op: "mov", dst: rdx, src: rax });
  emit({ op: "shr", dst: rdx, count: 52 });
  emit({ op: "shl", dst: rax, count: 12 });
  emit({ op: "shr", dst: rax, count: 12 });
  emit({ op: "cmp", dst: edx, src: imm(2047) });
  emit({ op: "jcc", cc: "e", target: label(special) });
  emit({ op: "cmp", dst: edx, src: imm(1039) });
  emit({ op: "jcc", cc: "ae", target: label(overflow) });
  emit({ op: "cmp", dst: edx, src: imm(1009) });
  emit({ op: "jcc", cc: "b", target: label(subnormal) });
  // Normal binary16: biased exponent 1..30. Adding (2^41 - 1) + lsb rounds
  // to nearest ties-to-even and carries naturally into exponent (and Infinity).
  emit({ op: "sub", dst: edx, src: imm(1008) });
  emit({ op: "shl", dst: edx, count: 10 });
  emit({ op: "mov", dst: rcx, src: rax });
  emit({ op: "shr", dst: rcx, count: 42 });
  emit({ op: "and", dst: ecx, src: imm(1) });
  emit({ op: "add", dst: rax, src: rcx });
  emit({ op: "mov", dst: rcx, src: bits(0xffffffff, 0x000001ff) });
  emit({ op: "add", dst: rax, src: rcx });
  emit({ op: "shr", dst: rax, count: 42 });
  emit({ op: "add", dst: eax, src: edx });
  emit({ op: "or", dst: eax, src: r11d });
  emit({ op: "ret" });
  emit({ op: "label", name: subnormal });
  emit({ op: "cmp", dst: edx, src: imm(998) });
  emit({ op: "jcc", cc: "b", target: label(underflow) });
  emit({ op: "mov", dst: ecx, src: imm(1051) });
  emit({ op: "sub", dst: ecx, src: edx });
  emit({ op: "mov", dst: rdx, src: bits(0, 0x00100000) });
  emit({ op: "or", dst: rax, src: rdx });
  emit({ op: "mov", dst: rdx, src: rax });
  emit({ op: "shr", dst: rdx, count: "cl" });
  emit({ op: "and", dst: edx, src: imm(1) });
  emit({ op: "add", dst: rax, src: rdx });
  emit({ op: "dec", dst: ecx });
  emit({ op: "mov", dst: edx, src: imm(1) });
  emit({ op: "shl", dst: rdx, count: "cl" });
  emit({ op: "dec", dst: rdx });
  emit({ op: "add", dst: rax, src: rdx });
  emit({ op: "inc", dst: ecx });
  emit({ op: "shr", dst: rax, count: "cl" });
  emit({ op: "or", dst: eax, src: r11d });
  emit({ op: "ret" });
  emit({ op: "label", name: underflow });
  emit({ op: "mov", dst: eax, src: r11d });
  emit({ op: "ret" });
  emit({ op: "label", name: overflow });
  emit({ op: "mov", dst: eax, src: imm(0x7c00) });
  emit({ op: "or", dst: eax, src: r11d });
  emit({ op: "ret" });
  emit({ op: "label", name: special });
  emit({ op: "test", dst: rax, src: rax });
  emit({ op: "jcc", cc: "e", target: label(overflow) });
  emit({ op: "mov", dst: eax, src: imm(0x7e00) });
  emit({ op: "or", dst: eax, src: r11d });
  emit({ op: "ret" });
}

/** Widen IEEE-754 binary16 bits in EAX (zero-extended) to binary64 bits in
 * RAX. Any binary16 NaN produces the canonical quiet NaN 0x7ff80000_00000000,
 * never optional-number absence. Preserves R9 and R10. */
function emitFromFloat16(emit: Emit): void {
  const assemble = fromFloat16Label + ":assemble";
  const zeroOrSub = fromFloat16Label + ":zero-or-sub";
  const subnormal = fromFloat16Label + ":subnormal";
  const norm = fromFloat16Label + ":norm";
  const special = fromFloat16Label + ":special";
  const nan = fromFloat16Label + ":nan";
  emit({ op: "label", name: fromFloat16Label });
  emit({ op: "mov", dst: r11d, src: eax });
  emit({ op: "and", dst: r11d, src: imm(0x8000) });
  emit({ op: "shl", dst: r11, count: 48 });
  emit({ op: "mov", dst: edx, src: eax });
  emit({ op: "shr", dst: edx, count: 10 });
  emit({ op: "and", dst: edx, src: imm(31) });
  emit({ op: "and", dst: eax, src: imm(0x3ff) });
  emit({ op: "test", dst: edx, src: edx });
  emit({ op: "jcc", cc: "e", target: label(zeroOrSub) });
  emit({ op: "cmp", dst: edx, src: imm(31) });
  emit({ op: "jcc", cc: "e", target: label(special) });
  emit({ op: "add", dst: edx, src: imm(1008) });
  emit({ op: "label", name: assemble });
  emit({ op: "shl", dst: rdx, count: 52 });
  emit({ op: "shl", dst: rax, count: 42 });
  emit({ op: "or", dst: rax, src: rdx });
  emit({ op: "or", dst: rax, src: r11 });
  emit({ op: "ret" });
  emit({ op: "label", name: zeroOrSub });
  emit({ op: "test", dst: eax, src: eax });
  emit({ op: "jcc", cc: "ne", target: label(subnormal) });
  emit({ op: "mov", dst: rax, src: r11 });
  emit({ op: "ret" });
  emit({ op: "label", name: subnormal });
  emit({ op: "mov", dst: edx, src: imm(1009) });
  emit({ op: "label", name: norm });
  emit({ op: "shl", dst: eax, count: 1 });
  emit({ op: "dec", dst: edx });
  emit({ op: "test", dst: eax, src: imm(0x400) });
  emit({ op: "jcc", cc: "e", target: label(norm) });
  emit({ op: "and", dst: eax, src: imm(0x3ff) });
  emit({ op: "jmp", target: label(assemble) });
  emit({ op: "label", name: special });
  emit({ op: "test", dst: eax, src: eax });
  emit({ op: "jcc", cc: "ne", target: label(nan) });
  emit({ op: "mov", dst: rax, src: bits(0, 0x7ff00000) });
  emit({ op: "or", dst: rax, src: r11 });
  emit({ op: "ret" });
  emit({ op: "label", name: nan });
  emit({ op: "mov", dst: rax, src: bits(0, 0x7ff80000) });
  emit({ op: "ret" });
}
