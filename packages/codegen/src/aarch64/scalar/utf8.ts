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
import type { DataRegister, Instruction } from "../isa.ts";
import { emitUtf8WindowLoop } from "../../utf8-window.ts";
import { createLeafAssembler } from "./leaf.ts";

/** Input is x2 (string), x3 (byte view), d0 (start), d1 (offset).
 * Result in d0. Neither pointer escapes this nonallocating sequence. */
export function utf8WindowAArch64(): readonly Instruction[] {
  const asm = createLeafAssembler();
  const { emit, label, branch } = asm;
  const source = 2;
  const destination = 3;
  const units = 4;
  const space = 5;
  const value = 6;
  const temp = 7;
  const constantRegister = 12;

  function constant(rd: number, immediate: number): void {
    emit({ op: "movz", width: 64, rd, immediate, shift: 0 });
  }
  function addReg(
    op: "add-reg" | "sub-reg",
    rd: DataRegister,
    rn: number,
    rm: number,
    amount: number = 0,
    setFlags: boolean = false,
  ): void {
    emit({ op, width: 64, rd, rn, rm, shift: "lsl", amount, setFlags });
  }
  function immediate(
    op: "add-imm" | "sub-imm",
    rd: number | "zr",
    rn: number,
    value: number,
    setFlags: boolean = false,
  ): void {
    const shift = value >= 4096 && value % 4096 === 0 ? 12 : 0;
    const scaled = shift === 12 ? value / 4096 : value;
    if (scaled > 4095) {
      constant(constantRegister, value);
      addReg(
        op === "add-imm" ? "add-reg" : "sub-reg",
        rd,
        rn,
        constantRegister,
        0,
        setFlags,
      );
    } else emit({ op, width: 64, rd, rn, immediate: scaled, shift, setFlags });
  }
  function compare(register: number, value: number): void {
    immediate("sub-imm", "zr", register, value, true);
  }
  function shift(rd: number, bits: number, left: boolean): void {
    const immr = left ? 64 - bits : bits;
    const imms = left ? 63 - bits : 63;
    emit({ op: "ubfm", width: 64, rd, rn: rd, immr, imms });
  }
  function exactOffset(rd: number, rn: number, length: number): void {
    emit({ op: "fcvtzs-x-d", rd, rn });
    emit({ op: "scvtf-d-x", rd: 2, rn: rd });
    emit({ op: "fcmp", rn, rm: 2 });
    branch("invalid", "ne");
    addReg("sub-reg", "zr", rd, length, 0, true);
    branch("invalid", "cs");
  }

  emit({
    op: "ldr",
    width: 32,
    rt: units,
    rn: source,
    offset: nativeStringLengthOffset,
  });
  emit({
    op: "ldr",
    width: 32,
    rt: space,
    rn: destination,
    offset: nativeArrayLengthOffset,
  });
  exactOffset(16, 0, units);
  exactOffset(17, 1, space);
  addReg("sub-reg", units, units, 16);
  addReg("sub-reg", space, space, 17);
  constant(constantRegister, utf8WindowBytes);
  compare(space, utf8WindowBytes);
  emit({
    op: "csel",
    width: 64,
    rd: space,
    rn: space,
    rm: constantRegister,
    condition: "cc",
  });
  immediate("add-imm", source, source, nativeStringDataOffset);
  addReg("add-reg", source, source, 16, 1);
  emit({
    op: "ldr",
    width: 64,
    rt: destination,
    rn: destination,
    offset: nativeArrayDataOffset,
  });
  addReg("add-reg", destination, destination, 17);
  immediate("add-imm", 14, units, 0);
  immediate("add-imm", 15, space, 0);

  emitUtf8WindowLoop({
    source,
    destination,
    units,
    space,
    value,
    temp,
    label,
    jump: (name) => branch(name),
    below: (register, value, name) => {
      compare(register, value);
      branch(name, "cc");
    },
    atLeast: (register, value, name) => {
      compare(register, value);
      branch(name, "cs");
    },
    move: (to, from) => immediate("add-imm", to, from, 0),
    constant,
    add: (register, value) => immediate("add-imm", register, register, value),
    sub: (register, value) => immediate("sub-imm", register, register, value),
    addRegister: (register, added) =>
      addReg("add-reg", register, register, added),
    shiftLeft: (register, bits) => shift(register, bits, true),
    shiftRight: (register, bits) => shift(register, bits, false),
    keepLow: (rd, bits) =>
      emit({ op: "ubfm", width: 64, rd, rn: rd, immr: 0, imms: bits - 1 }),
    loadUnit: (rt, offset) => emit({ op: "ldrh", rt, rn: source, offset }),
    storeByte: (rt, offset) =>
      emit({ op: "strb", rt, rn: destination, offset }),
    asciiBlock: (fallback) => {
      emit({ op: "ldr-q", qt: 0, rn: source, offset: 0 });
      emit({ op: "umaxv-8h", vd: 1, vn: 0 });
      emit({ op: "umov-h0", rd: temp, vn: 1 });
      compare(temp, 0x80);
      branch(fallback, "cs");
      emit({ op: "xtn-8b", vd: 0, vn: 0 });
      emit({ op: "str-d", rt: 0, rn: destination, offset: 0 });
    },
  });
  addReg("sub-reg", 14, 14, units);
  addReg("sub-reg", 15, 15, space);
  addReg("add-reg", 9, 15, 14, utf8WindowCountBits);
  branch("result");
  label("invalid");
  constant(9, 0);
  label("result");
  emit({ op: "ucvtf-d-w", rd: 0, rn: 9 });
  return asm.finish();
}
