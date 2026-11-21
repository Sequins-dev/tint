import {
  nativeArrayDataOffset,
  nativeArrayLengthOffset,
  nativeStringDataOffset,
  nativeStringLengthOffset,
} from "@tint/abi/host";
import {
  utf8WindowBytes,
  utf8WindowCountBits,
} from "@tint/foundation/text/text-encoding";
import type { Condition, Memory } from "../isa.ts";
import { emitUtf8WindowLoop } from "../../utf8-window.ts";
import { byte, gpr, imm, label, mem, word, xmm, type Emit } from "./machine.ts";

/** Borrow the string and byte view for one nonallocating sequence.
 * Returns the packed count as an integer in rax. */
export function emitUtf8WindowX64(
  emit: Emit,
  prefix: string,
  argument: (index: number) => Memory<64>,
): void {
  const source = 6;
  const destination = 7;
  const units = 8;
  const space = 9;
  const value = 0;
  const temp = 2;
  function mark(name: string): void {
    emit({ op: "label", name: prefix + name });
  }
  function branch(cc: Condition, name: string): void {
    emit({ op: "jcc", cc, target: label(prefix + name) });
  }
  function jump(name: string): void {
    emit({ op: "jmp", target: label(prefix + name) });
  }
  function compare(register: number, value: number): void {
    emit({ op: "cmp", dst: gpr(register), src: imm(value) });
  }
  function exactOffset(rd: number, index: number, length: number): void {
    const input = argument(index);
    emit({ op: "cvttsd2si", dst: gpr(rd), src: input });
    emit({ op: "cvtsi2sd", dst: xmm(0), src: gpr(rd) });
    emit({ op: "ucomisd", dst: xmm(0), src: input });
    branch("p", "invalid");
    branch("ne", "invalid");
    emit({ op: "cmp", dst: gpr(rd), src: gpr(length) });
    branch("ae", "invalid");
  }

  emit({ op: "mov", dst: gpr(source), src: argument(0) });
  emit({ op: "mov", dst: gpr(destination), src: argument(1) });
  emit({
    op: "mov",
    dst: word(units),
    src: { ...mem(source, nativeStringLengthOffset), width: 32 },
  });
  emit({
    op: "mov",
    dst: word(space),
    src: { ...mem(destination, nativeArrayLengthOffset), width: 32 },
  });
  exactOffset(10, 2, units);
  exactOffset(11, 3, space);
  emit({ op: "sub", dst: gpr(units), src: gpr(10) });
  emit({ op: "sub", dst: gpr(space), src: gpr(11) });
  emit({ op: "mov", dst: word(value), src: imm(utf8WindowBytes) });
  compare(space, utf8WindowBytes);
  emit({ op: "cmovcc", cc: "a", dst: gpr(space), src: gpr(value) });
  emit({
    op: "lea",
    dst: gpr(source),
    src: {
      kind: "mem",
      width: 64,
      address: {
        kind: "base",
        base: source,
        index: 10,
        scale: 2,
        disp: nativeStringDataOffset,
      },
    },
  });
  emit({
    op: "mov",
    dst: gpr(destination),
    src: mem(destination, nativeArrayDataOffset),
  });
  emit({ op: "add", dst: gpr(destination), src: gpr(11) });
  emit({ op: "mov", dst: gpr(10), src: gpr(units) });
  emit({ op: "mov", dst: gpr(11), src: gpr(space) });
  emit({ op: "xorpd", dst: xmm(2), src: xmm(2) });

  emitUtf8WindowLoop({
    source,
    destination,
    units,
    space,
    value,
    temp,
    label: mark,
    jump,
    below: (register, value, name) => {
      compare(register, value);
      branch("b", name);
    },
    atLeast: (register, value, name) => {
      compare(register, value);
      branch("ae", name);
    },
    move: (to, from) => emit({ op: "mov", dst: word(to), src: word(from) }),
    constant: (register, value) =>
      emit({ op: "mov", dst: word(register), src: imm(value) }),
    add: (register, value) =>
      emit({ op: "add", dst: gpr(register), src: imm(value) }),
    sub: (register, value) =>
      emit({ op: "sub", dst: gpr(register), src: imm(value) }),
    addRegister: (register, added) =>
      emit({ op: "add", dst: word(register), src: word(added) }),
    shiftLeft: (register, count) =>
      emit({ op: "shl", dst: word(register), count }),
    shiftRight: (register, count) =>
      emit({ op: "shr", dst: word(register), count }),
    keepLow: (register, bits) =>
      emit({ op: "and", dst: word(register), src: imm((1 << bits) - 1) }),
    loadUnit: (register, offset) =>
      emit({
        op: "movzx",
        dst: word(register),
        src: { ...mem(source, offset), width: 16 },
      }),
    storeByte: (register, offset) =>
      emit({
        op: "mov",
        dst: { ...mem(destination, offset), width: 8 },
        src: byte(register),
      }),
    asciiBlock: (fallback) => {
      emit({
        op: "movdqu",
        dst: xmm(0),
        src: { ...mem(source, 0), width: 128 },
      });
      emit({ op: "movdqu", dst: xmm(1), src: xmm(0) });
      // Shift away the seven ASCII bits before saturation can discard a
      // high-bit lane, including a surrogate interpreted as a signed word.
      emit({ op: "psrlw", dst: xmm(1), count: 7 });
      emit({ op: "pcmpeqw", dst: xmm(1), src: xmm(2) });
      emit({ op: "pmovmskb", dst: word(value), src: xmm(1) });
      compare(value, 0xffff);
      branch("ne", fallback);
      emit({ op: "packuswb", dst: xmm(0), src: xmm(0) });
      emit({ op: "movsd", dst: mem(destination, 0), src: xmm(0) });
    },
  });
  emit({ op: "sub", dst: gpr(10), src: gpr(units) });
  emit({ op: "sub", dst: gpr(11), src: gpr(space) });
  emit({ op: "shl", dst: gpr(10), count: utf8WindowCountBits });
  emit({
    op: "lea",
    dst: gpr(0),
    src: {
      kind: "mem",
      width: 64,
      address: { kind: "base", base: 10, index: 11, scale: 1, disp: 0 },
    },
  });
  jump("result");
  mark("invalid");
  emit({ op: "xor", dst: word(0), src: word(0) });
  mark("result");
}
