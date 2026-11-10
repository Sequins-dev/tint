import { writeUnsigned } from "@tint/foundation/binary/bytes";
/** Numeric register indices are 0..30. Spell register 31 by its role. */
export type DataRegister = number | "zr";
export type BaseRegister = number | "sp";
export type Register = DataRegister | BaseRegister;
export type RegisterWidth = 32 | 64;
export type MemoryAccessWidth = 8 | 16 | 32 | 64;
export type Condition =
  | "eq"
  | "ne"
  | "cs"
  | "cc"
  | "mi"
  | "pl"
  | "vs"
  | "vc"
  | "hi"
  | "ls"
  | "ge"
  | "lt"
  | "gt"
  | "le"
  | "al"
  | "nv";
export type Branch =
  | { readonly op: "b" | "bl" }
  | { readonly op: "b.cond"; readonly condition: Condition }
  | {
      readonly op: "cbz" | "cbnz";
      readonly width: RegisterWidth;
      readonly rt: DataRegister;
    };
export type Instruction =
  | { readonly op: "clrex" | "yield" }
  | { readonly op: "dmb"; readonly domain: "ish" | "ishld" | "ishst" | "sy" }
  | {
      readonly op: "ldar" | "stlr" | "ldaxr";
      readonly width: MemoryAccessWidth;
      readonly rt: DataRegister;
      readonly rn: BaseRegister;
    }
  | {
      readonly op: "stlxr";
      readonly width: MemoryAccessWidth;
      /** The status is always a W register, regardless of payload width. */
      readonly rs: DataRegister;
      readonly rt: DataRegister;
      readonly rn: BaseRegister;
    }
  | { readonly op: "brk"; readonly immediate: number }
  | {
      readonly op: "ldrb" | "strb" | "ldrh" | "strh";
      readonly rt: DataRegister;
      readonly rn: BaseRegister;
      readonly offset: number;
    }
  | {
      readonly op:
        | "and-reg"
        | "orr-reg"
        | "eor-reg"
        | "orn-reg"
        | "lslv"
        | "lsrv"
        | "asrv";
      readonly width: RegisterWidth;
      readonly rd: DataRegister;
      readonly rn: DataRegister;
      readonly rm: DataRegister;
    }
  | {
      readonly op: "ubfm";
      readonly width: RegisterWidth;
      readonly rd: DataRegister;
      readonly rn: DataRegister;
      readonly immr: number;
      readonly imms: number;
    }
  | {
      readonly op: "fabs" | "fmov-d-d" | "frintp" | "frintz" | "fsqrt";
      readonly rd: number;
      readonly rn: number;
    }
  | { readonly op: "ucvtf-d-w"; readonly rd: number; readonly rn: DataRegister }
  | {
      readonly op: "fadd" | "fsub" | "fmul" | "fdiv";
      readonly rd: number;
      readonly rn: number;
      readonly rm: number;
    }
  | { readonly op: "fneg"; readonly rd: number; readonly rn: number }
  | { readonly op: "fcmp"; readonly rn: number; readonly rm: number }
  | { readonly op: "fmov-d-x"; readonly rd: number; readonly rn: DataRegister }
  | { readonly op: "fmov-x-d"; readonly rd: DataRegister; readonly rn: number }
  | {
      readonly op: "ldr-d" | "str-d";
      readonly rt: number;
      readonly rn: BaseRegister;
      readonly offset: number;
    }
  | {
      readonly op: "cset";
      readonly rd: DataRegister;
      readonly condition: Condition;
    }
  | {
      readonly op: "fcvtzs-w-d" | "fcvtzs-x-d";
      readonly rd: DataRegister;
      readonly rn: number;
    }
  | {
      readonly op: "scvtf-d-w" | "scvtf-d-x";
      readonly rd: number;
      readonly rn: DataRegister;
    }
  | { readonly op: "mrs-fpcr" | "msr-fpcr"; readonly rt: DataRegister }
  | {
      readonly op: "adr";
      readonly rd: DataRegister;
      readonly displacement: number;
    }
  | {
      /** Address of the 4 KiB page `pages` pages from this instruction's page. */
      readonly op: "adrp";
      readonly rd: DataRegister;
      readonly pages: number;
    }
  | { readonly op: "nop" }
  | {
      readonly op: "movz" | "movk";
      readonly width: RegisterWidth;
      readonly rd: DataRegister;
      readonly immediate: number;
      readonly shift: 0 | 16 | 32 | 48;
    }
  | {
      readonly op: "add-imm" | "sub-imm";
      readonly width: RegisterWidth;
      readonly rd: Register;
      readonly rn: BaseRegister;
      readonly immediate: number;
      readonly shift: 0 | 12;
      readonly setFlags: boolean;
    }
  | {
      readonly op: "add-reg" | "sub-reg";
      readonly width: RegisterWidth;
      readonly rd: DataRegister;
      readonly rn: DataRegister;
      readonly rm: DataRegister;
      readonly shift: "lsl" | "lsr" | "asr";
      readonly amount: number;
      readonly setFlags: boolean;
    }
  | {
      readonly op: "ldr" | "str";
      readonly width: RegisterWidth;
      readonly rt: DataRegister;
      readonly rn: BaseRegister;
      readonly offset: number;
    }
  | {
      readonly op: "ldp" | "stp";
      readonly width: RegisterWidth;
      readonly rt: DataRegister;
      readonly rt2: DataRegister;
      readonly rn: BaseRegister;
      readonly offset: number;
      readonly mode: "offset" | "pre" | "post";
    }
  | { readonly op: "br" | "blr" | "ret"; readonly rn: number }
  | (Branch & { readonly displacement: number });
export type EncodingError =
  | "INVALID_REGISTER"
  | "INVALID_WIDTH"
  | "INVALID_IMMEDIATE"
  | "INVALID_SHIFT"
  | "INVALID_CONDITION"
  | "INVALID_MODE"
  | "INVALID_FLAGS"
  | "INVALID_INSTRUCTION"
  | "MISALIGNED"
  | "OUT_OF_RANGE"
  | "OUT_OF_BOUNDS"
  | "INVALID_OFFSET"
  | "UNPREDICTABLE_OPERANDS"
  | "PATCH_MISMATCH";
export type EncodingResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: EncodingError };
/** A resolved branch relocation in one contiguous, 4-byte-aligned address space. */
export interface BranchFixup {
  readonly offset: number;
  readonly targetOffset: number;
  readonly branch: Branch;
}
type Failure = { readonly ok: false; readonly error: EncodingError };
function fail(error: EncodingError): Failure {
  return { ok: false, error };
}
function word(value: number): EncodingResult<number> {
  return { ok: true, value };
}
function integer(n: number, min: number, max: number): boolean {
  return Number.isInteger(n) && n >= min && n <= max;
}
function register(r: Register, special: "sp" | "zr" | "none"): number {
  if (typeof r === "number" && integer(r, 0, 30)) return r;
  if ((special === "sp" && r === "sp") || (special === "zr" && r === "zr"))
    return 31;
  return -1;
}
function condition(c: Condition): number {
  switch (c) {
    case "eq":
      return 0;
    case "ne":
      return 1;
    case "cs":
      return 2;
    case "cc":
      return 3;
    case "mi":
      return 4;
    case "pl":
      return 5;
    case "vs":
      return 6;
    case "vc":
      return 7;
    case "hi":
      return 8;
    case "ls":
      return 9;
    case "ge":
      return 10;
    case "lt":
      return 11;
    case "gt":
      return 12;
    case "le":
      return 13;
    case "al":
      return 14;
    case "nv":
      return 15;
    default:
      return -1;
  }
}
function branchWord(
  branch: Branch,
  displacement: number,
): EncodingResult<number> {
  if (!integer(displacement, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
    return fail("INVALID_IMMEDIATE");
  if (displacement % 4 !== 0) return fail("MISALIGNED");
  const imm = displacement / 4;
  if (branch.op === "b" || branch.op === "bl") {
    if (!integer(imm, -0x2000000, 0x1ffffff)) return fail("OUT_OF_RANGE");
    return word(
      (branch.op === "b" ? 0x14000000 : 0x94000000) +
        (imm < 0 ? imm + 0x4000000 : imm),
    );
  }
  if (!integer(imm, -0x40000, 0x3ffff)) return fail("OUT_OF_RANGE");
  const field = (imm < 0 ? imm + 0x80000 : imm) * 32;
  if (branch.op === "b.cond") {
    const cond = condition(branch.condition);
    if (cond < 0) return fail("INVALID_CONDITION");
    return word(0x54000000 + field + cond);
  }
  if (branch.op === "cbz" || branch.op === "cbnz") {
    if (branch.width !== 32 && branch.width !== 64)
      return fail("INVALID_WIDTH");
    const rt = register(branch.rt, "zr");
    if (rt < 0) return fail("INVALID_REGISTER");
    return word(
      0x34000000 +
        (branch.width === 64 ? 0x80000000 : 0) +
        (branch.op === "cbnz" ? 0x1000000 : 0) +
        field +
        rt,
    );
  }
  return fail("INVALID_INSTRUCTION");
}

export function encode(instruction: Instruction): EncodingResult<number> {
  const i = instruction;
  switch (i.op) {
    case "clrex":
      return word(0xd5033f5f);
    case "yield":
      return word(0xd503203f);
    case "dmb": {
      const domain =
        i.domain === "ish"
          ? 11
          : i.domain === "ishld"
            ? 9
            : i.domain === "ishst"
              ? 10
              : i.domain === "sy"
                ? 15
                : -1;
      if (domain < 0) return fail("INVALID_MODE");
      return word(0xd50330bf + domain * 256);
    }
    case "ldar":
    case "stlr":
    case "ldaxr":
    case "stlxr": {
      const size =
        i.width === 8
          ? 0
          : i.width === 16
            ? 1
            : i.width === 32
              ? 2
              : i.width === 64
                ? 3
                : -1;
      if (size < 0) return fail("INVALID_WIDTH");
      const rt = register(i.rt, "zr"),
        rn = register(i.rn, "sp");
      if (rt < 0 || rn < 0) return fail("INVALID_REGISTER");
      let base: number;
      if (i.op === "stlxr") {
        const rs = register(i.rs, "zr");
        if (rs < 0) return fail("INVALID_REGISTER");
        // The exclusive-store status must not overwrite its source or address.
        // Base register 31 denotes SP, while status 31 denotes WZR.
        if (rs === rt || (rs === rn && rn !== 31))
          return fail("UNPREDICTABLE_OPERANDS");
        base = 0x0800fc00 + rs * 65536;
      } else
        base =
          i.op === "ldar"
            ? 0x08dffc00
            : i.op === "stlr"
              ? 0x089ffc00
              : 0x085ffc00;
      return word(base + size * 0x40000000 + rn * 32 + rt);
    }
    case "and-reg":
    case "orr-reg":
    case "eor-reg":
    case "orn-reg":
    case "lslv":
    case "lsrv":
    case "asrv": {
      if (i.width !== 32 && i.width !== 64) return fail("INVALID_WIDTH");
      const rd = register(i.rd, "zr"),
        rn = register(i.rn, "zr"),
        rm = register(i.rm, "zr");
      if (rd < 0 || rn < 0 || rm < 0) return fail("INVALID_REGISTER");
      const base =
        i.op === "and-reg"
          ? 0x0a000000
          : i.op === "orr-reg"
            ? 0x2a000000
            : i.op === "eor-reg"
              ? 0x4a000000
              : i.op === "orn-reg"
                ? 0x2a200000
                : i.op === "lslv"
                  ? 0x1ac02000
                  : i.op === "lsrv"
                    ? 0x1ac02400
                    : 0x1ac02800;
      return word(
        base + (i.width === 64 ? 0x80000000 : 0) + rm * 65536 + rn * 32 + rd,
      );
    }
    case "ubfm": {
      if (i.width !== 32 && i.width !== 64) return fail("INVALID_WIDTH");
      const rd = register(i.rd, "zr"),
        rn = register(i.rn, "zr");
      if (rd < 0 || rn < 0) return fail("INVALID_REGISTER");
      if (!integer(i.immr, 0, i.width - 1) || !integer(i.imms, 0, i.width - 1))
        return fail("INVALID_IMMEDIATE");
      return word(
        (i.width === 64 ? 0xd3400000 : 0x53000000) +
          i.immr * 65536 +
          i.imms * 1024 +
          rn * 32 +
          rd,
      );
    }
    case "fsqrt":
    case "fabs":
    case "frintp":
    case "frintz":
    case "fmov-d-d": {
      if (!integer(i.rd, 0, 31) || !integer(i.rn, 0, 31))
        return fail("INVALID_REGISTER");
      return word(
        (i.op === "fsqrt"
          ? 0x1e61c000
          : i.op === "fabs"
            ? 0x1e60c000
            : i.op === "frintp"
              ? 0x1e64c000
              : i.op === "frintz"
                ? 0x1e65c000
                : 0x1e604000) +
          i.rn * 32 +
          i.rd,
      );
    }
    case "ucvtf-d-w": {
      const rn = register(i.rn, "zr");
      if (!integer(i.rd, 0, 31) || rn < 0) return fail("INVALID_REGISTER");
      return word(0x1e630000 + rn * 32 + i.rd);
    }
    case "fadd":
    case "fsub":
    case "fmul":
    case "fdiv": {
      if (
        !integer(i.rd, 0, 31) ||
        !integer(i.rn, 0, 31) ||
        !integer(i.rm, 0, 31)
      )
        return fail("INVALID_REGISTER");
      const base =
        i.op === "fadd"
          ? 0x1e602800
          : i.op === "fsub"
            ? 0x1e603800
            : i.op === "fmul"
              ? 0x1e600800
              : 0x1e601800;
      return word(base + i.rm * 65536 + i.rn * 32 + i.rd);
    }
    case "fneg": {
      if (!integer(i.rd, 0, 31) || !integer(i.rn, 0, 31))
        return fail("INVALID_REGISTER");
      return word(0x1e614000 + i.rn * 32 + i.rd);
    }
    case "fcmp": {
      if (!integer(i.rn, 0, 31) || !integer(i.rm, 0, 31))
        return fail("INVALID_REGISTER");
      return word(0x1e602000 + i.rm * 65536 + i.rn * 32);
    }
    case "fmov-d-x":
    case "scvtf-d-w":
    case "scvtf-d-x": {
      const rn = register(i.rn, "zr");
      if (!integer(i.rd, 0, 31) || rn < 0) return fail("INVALID_REGISTER");
      return word(
        (i.op === "fmov-d-x"
          ? 0x9e670000
          : i.op === "scvtf-d-x"
            ? 0x9e620000
            : 0x1e620000) +
          rn * 32 +
          i.rd,
      );
    }
    case "fmov-x-d": {
      const rd = register(i.rd, "zr");
      if (rd < 0 || !integer(i.rn, 0, 31)) return fail("INVALID_REGISTER");
      return word(0x9e660000 + i.rn * 32 + rd);
    }
    case "fcvtzs-w-d":
    case "fcvtzs-x-d": {
      const rd = register(i.rd, "zr");
      if (rd < 0 || !integer(i.rn, 0, 31)) return fail("INVALID_REGISTER");
      return word(
        (i.op === "fcvtzs-x-d" ? 0x9e780000 : 0x1e780000) + i.rn * 32 + rd,
      );
    }
    case "ldr-d":
    case "str-d": {
      const rn = register(i.rn, "sp");
      if (rn < 0 || !integer(i.rt, 0, 31)) return fail("INVALID_REGISTER");
      if (!Number.isSafeInteger(i.offset)) return fail("INVALID_IMMEDIATE");
      if (i.offset % 8 !== 0) return fail("MISALIGNED");
      if (!integer(i.offset / 8, 0, 4095)) return fail("OUT_OF_RANGE");
      return word(
        (i.op === "ldr-d" ? 0xfd400000 : 0xfd000000) +
          (i.offset / 8) * 1024 +
          rn * 32 +
          i.rt,
      );
    }
    case "cset": {
      const rd = register(i.rd, "zr"),
        cond = condition(i.condition);
      if (rd < 0) return fail("INVALID_REGISTER");
      if (cond < 0 || cond >= 14) return fail("INVALID_CONDITION");
      return word(0x1a9f07e0 + (cond ^ 1) * 4096 + rd);
    }
    case "mrs-fpcr":
    case "msr-fpcr": {
      const rt = register(i.rt, "zr");
      if (rt < 0) return fail("INVALID_REGISTER");
      return word((i.op === "mrs-fpcr" ? 0xd53b4400 : 0xd51b4400) + rt);
    }
    case "adr": {
      const rd = register(i.rd, "zr");
      if (rd < 0) return fail("INVALID_REGISTER");
      if (
        !integer(
          i.displacement,
          -Number.MAX_SAFE_INTEGER,
          Number.MAX_SAFE_INTEGER,
        )
      )
        return fail("INVALID_IMMEDIATE");
      if (!integer(i.displacement, -1048576, 1048575))
        return fail("OUT_OF_RANGE");
      const imm =
        i.displacement < 0 ? i.displacement + 2097152 : i.displacement;
      return word(
        0x10000000 + (imm % 4) * 0x20000000 + Math.floor(imm / 4) * 32 + rd,
      );
    }
    case "adrp": {
      const rd = register(i.rd, "zr");
      if (rd < 0) return fail("INVALID_REGISTER");
      if (!integer(i.pages, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
        return fail("INVALID_IMMEDIATE");
      if (!integer(i.pages, -1048576, 1048575)) return fail("OUT_OF_RANGE");
      const imm = i.pages < 0 ? i.pages + 2097152 : i.pages;
      return word(
        0x90000000 + (imm % 4) * 0x20000000 + Math.floor(imm / 4) * 32 + rd,
      );
    }
    case "nop":
      return word(0xd503201f);
    case "b":
    case "bl":
    case "b.cond":
    case "cbz":
    case "cbnz":
      return branchWord(i, i.displacement);
    case "br":
    case "blr":
    case "ret": {
      const rn = register(i.rn, "none");
      if (rn < 0) return fail("INVALID_REGISTER");
      const base =
        i.op === "br" ? 0xd61f0000 : i.op === "blr" ? 0xd63f0000 : 0xd65f0000;
      return word(base + rn * 32);
    }
    case "movz":
    case "movk": {
      if (i.width !== 32 && i.width !== 64) return fail("INVALID_WIDTH");
      const rd = register(i.rd, "zr");
      if (rd < 0) return fail("INVALID_REGISTER");
      if (!integer(i.immediate, 0, 65535)) return fail("INVALID_IMMEDIATE");
      if (!integer(i.shift, 0, i.width - 16) || i.shift % 16 !== 0)
        return fail("INVALID_SHIFT");
      return word(
        (i.op === "movz" ? 0x52800000 : 0x72800000) +
          (i.width === 64 ? 0x80000000 : 0) +
          (i.shift / 16) * 0x200000 +
          i.immediate * 32 +
          rd,
      );
    }
    case "add-imm":
    case "sub-imm": {
      if (i.width !== 32 && i.width !== 64) return fail("INVALID_WIDTH");
      if (typeof i.setFlags !== "boolean") return fail("INVALID_FLAGS");
      const rd = register(i.rd, i.setFlags ? "zr" : "sp"),
        rn = register(i.rn, "sp");
      if (rd < 0 || rn < 0) return fail("INVALID_REGISTER");
      if (!integer(i.immediate, 0, 4095)) return fail("INVALID_IMMEDIATE");
      if (i.shift !== 0 && i.shift !== 12) return fail("INVALID_SHIFT");
      return word(
        0x11000000 +
          (i.width === 64 ? 0x80000000 : 0) +
          (i.op === "sub-imm" ? 0x40000000 : 0) +
          (i.setFlags ? 0x20000000 : 0) +
          (i.shift === 12 ? 0x400000 : 0) +
          i.immediate * 1024 +
          rn * 32 +
          rd,
      );
    }
    case "add-reg":
    case "sub-reg": {
      if (i.width !== 32 && i.width !== 64) return fail("INVALID_WIDTH");
      if (typeof i.setFlags !== "boolean") return fail("INVALID_FLAGS");
      const rd = register(i.rd, "zr"),
        rn = register(i.rn, "zr"),
        rm = register(i.rm, "zr");
      if (rd < 0 || rn < 0 || rm < 0) return fail("INVALID_REGISTER");
      const shift =
        i.shift === "lsl"
          ? 0
          : i.shift === "lsr"
            ? 1
            : i.shift === "asr"
              ? 2
              : -1;
      if (shift < 0 || !integer(i.amount, 0, i.width - 1))
        return fail("INVALID_SHIFT");
      return word(
        0x0b000000 +
          (i.width === 64 ? 0x80000000 : 0) +
          (i.op === "sub-reg" ? 0x40000000 : 0) +
          (i.setFlags ? 0x20000000 : 0) +
          shift * 0x400000 +
          rm * 65536 +
          i.amount * 1024 +
          rn * 32 +
          rd,
      );
    }
    case "brk":
      if (!integer(i.immediate, 0, 65535)) return fail("INVALID_IMMEDIATE");
      return word(0xd4200000 + i.immediate * 32);
    case "ldrb":
    case "strb":
    case "ldrh":
    case "strh": {
      const scale = i.op === "ldrh" || i.op === "strh" ? 2 : 1;
      const rt = register(i.rt, "zr"),
        rn = register(i.rn, "sp");
      if (rt < 0 || rn < 0) return fail("INVALID_REGISTER");
      if (!Number.isInteger(i.offset) || i.offset % scale !== 0)
        return fail("INVALID_IMMEDIATE");
      if (!integer(i.offset, 0, 4095 * scale)) return fail("OUT_OF_RANGE");
      return word(
        (i.op === "ldrb"
          ? 0x39400000
          : i.op === "strb"
            ? 0x39000000
            : i.op === "ldrh"
              ? 0x79400000
              : 0x79000000) +
          (i.offset / scale) * 1024 +
          rn * 32 +
          rt,
      );
    }
    case "ldr":
    case "str": {
      if (i.width !== 32 && i.width !== 64) return fail("INVALID_WIDTH");
      const rt = register(i.rt, "zr"),
        rn = register(i.rn, "sp");
      if (rt < 0 || rn < 0) return fail("INVALID_REGISTER");
      if (!integer(i.offset, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
        return fail("INVALID_IMMEDIATE");
      const scale = i.width / 8;
      if (i.offset % scale !== 0) return fail("MISALIGNED");
      if (!integer(i.offset / scale, 0, 4095)) return fail("OUT_OF_RANGE");
      return word(
        0xb9000000 +
          (i.width === 64 ? 0x40000000 : 0) +
          (i.op === "ldr" ? 0x400000 : 0) +
          (i.offset / scale) * 1024 +
          rn * 32 +
          rt,
      );
    }
    case "ldp":
    case "stp": {
      if (i.width !== 32 && i.width !== 64) return fail("INVALID_WIDTH");
      const rt = register(i.rt, "zr"),
        rt2 = register(i.rt2, "zr"),
        rn = register(i.rn, "sp");
      if (rt < 0 || rt2 < 0 || rn < 0) return fail("INVALID_REGISTER");
      if (i.mode !== "offset" && i.mode !== "pre" && i.mode !== "post")
        return fail("INVALID_MODE");
      if (
        (i.op === "ldp" && rt === rt2) ||
        (i.mode !== "offset" && rn !== 31 && (rn === rt || rn === rt2))
      )
        return fail("UNPREDICTABLE_OPERANDS");
      if (!integer(i.offset, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
        return fail("INVALID_IMMEDIATE");
      const scale = i.width / 8;
      if (i.offset % scale !== 0) return fail("MISALIGNED");
      const imm = i.offset / scale;
      if (!integer(imm, -64, 63)) return fail("OUT_OF_RANGE");
      const mode =
        i.mode === "pre" ? 0x800000 : i.mode === "post" ? -0x800000 : 0;
      return word(
        0x29000000 +
          (i.width === 64 ? 0x80000000 : 0) +
          (i.op === "ldp" ? 0x400000 : 0) +
          mode +
          (imm < 0 ? imm + 128 : imm) * 32768 +
          rt2 * 1024 +
          rn * 32 +
          rt,
      );
    }
    default:
      return fail("INVALID_INSTRUCTION");
  }
}
function site(bytes: Uint8Array, offset: number): EncodingResult<undefined> {
  if (!integer(offset, 0, Number.MAX_SAFE_INTEGER))
    return fail("INVALID_OFFSET");
  if (offset % 4 !== 0) return fail("MISALIGNED");
  if (offset > bytes.length || 4 > bytes.length - offset)
    return fail("OUT_OF_BOUNDS");
  return { ok: true, value: undefined };
}
export function writeInstruction(
  bytes: Uint8Array,
  offset: number,
  instruction: Instruction,
): EncodingResult<undefined> {
  const valid = site(bytes, offset);
  if (!valid.ok) return valid;
  const result = encode(instruction);
  if (!result.ok) return result;
  const written = writeUnsigned(bytes, offset, 4, result.value, "little");
  if (!written.ok) return fail("OUT_OF_BOUNDS");
  return { ok: true, value: undefined };
}
/** Whether `branch` can encode this byte displacement in its compact form. */
export function branchInReach(branch: Branch, displacement: number): boolean {
  return branchWord(branch, displacement).ok;
}
export function patchBranch(
  bytes: Uint8Array,
  fixup: BranchFixup,
): EncodingResult<undefined> {
  const valid = site(bytes, fixup.offset);
  if (!valid.ok) return valid;
  if (!integer(fixup.targetOffset, 0, Number.MAX_SAFE_INTEGER))
    return fail("INVALID_OFFSET");
  const template = branchWord(fixup.branch, 0);
  if (!template.ok) return template;
  const encoded = branchWord(fixup.branch, fixup.targetOffset - fixup.offset);
  if (!encoded.ok) return encoded;
  const b0 = bytes[fixup.offset],
    b1 = bytes[fixup.offset + 1],
    b2 = bytes[fixup.offset + 2],
    b3 = bytes[fixup.offset + 3];
  if (
    b0 === undefined ||
    b1 === undefined ||
    b2 === undefined ||
    b3 === undefined
  )
    return fail("OUT_OF_BOUNDS");
  const existing = b0 + b1 * 256 + b2 * 65536 + b3 * 0x1000000;
  const mask =
    fixup.branch.op === "b" || fixup.branch.op === "bl"
      ? 0xfc000000
      : 0xff00001f;
  if ((existing & mask) !== (template.value & mask))
    return fail("PATCH_MISMATCH");
  const written = writeUnsigned(
    bytes,
    fixup.offset,
    4,
    encoded.value,
    "little",
  );
  if (!written.ok) return fail("OUT_OF_BOUNDS");
  return { ok: true, value: undefined };
}

export function patchAddress(
  bytes: Uint8Array,
  fixup: {
    readonly offset: number;
    readonly targetOffset: number;
    readonly rd: DataRegister;
  },
): EncodingResult<undefined> {
  const valid = site(bytes, fixup.offset);
  if (!valid.ok) return valid;
  if (!integer(fixup.targetOffset, 0, Number.MAX_SAFE_INTEGER))
    return fail("INVALID_OFFSET");
  const template = encode({ op: "adr", rd: fixup.rd, displacement: 0 });
  if (!template.ok) return template;
  const encoded = encode({
    op: "adr",
    rd: fixup.rd,
    displacement: fixup.targetOffset - fixup.offset,
  });
  if (!encoded.ok) return encoded;
  const b0 = bytes[fixup.offset],
    b1 = bytes[fixup.offset + 1],
    b2 = bytes[fixup.offset + 2],
    b3 = bytes[fixup.offset + 3];
  if (
    b0 === undefined ||
    b1 === undefined ||
    b2 === undefined ||
    b3 === undefined
  )
    return fail("OUT_OF_BOUNDS");
  const existing = b0 + b1 * 256 + b2 * 65536 + b3 * 0x1000000;
  if ((existing & 0x9f00001f) !== (template.value & 0x9f00001f))
    return fail("PATCH_MISMATCH");
  if (!writeUnsigned(bytes, fixup.offset, 4, encoded.value, "little").ok)
    return fail("OUT_OF_BOUNDS");
  return { ok: true, value: undefined };
}
/** Position-independent address sequence; reserves scratch and does not alter flags. */
export function relativeAddress(
  rd: number,
  scratch: number,
  displacement: number,
): EncodingResult<readonly Instruction[]> {
  if (!integer(rd, 0, 30) || !integer(scratch, 0, 30) || rd === scratch)
    return fail("INVALID_REGISTER");
  if (!integer(displacement, -0xffffffff, 0xffffffff))
    return fail("OUT_OF_RANGE");
  const magnitude = displacement < 0 ? -displacement : displacement;
  return {
    ok: true,
    value: [
      { op: "adr", rd, displacement: 0 },
      {
        op: "movz",
        width: 64,
        rd: scratch,
        immediate: magnitude % 65536,
        shift: 0,
      },
      {
        op: "movk",
        width: 64,
        rd: scratch,
        immediate: Math.floor(magnitude / 65536),
        shift: 16,
      },
      {
        op: displacement < 0 ? "sub-reg" : "add-reg",
        width: 64,
        rd,
        rn: rd,
        rm: scratch,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      },
    ],
  };
}
/** Two-instruction address of a target up to 4 GiB away (ADRP+ADD). Only for
 * code whose base address is 4 KiB aligned, so page arithmetic on offsets
 * matches the loaded addresses. */
export function pageAddress(
  rd: number,
  pages: number,
  low: number,
): EncodingResult<readonly Instruction[]> {
  if (!integer(rd, 0, 30)) return fail("INVALID_REGISTER");
  if (!integer(low, 0, 4095)) return fail("INVALID_IMMEDIATE");
  if (!integer(pages, -1048576, 1048575)) return fail("OUT_OF_RANGE");
  return {
    ok: true,
    value: [
      { op: "adrp", rd, pages },
      {
        op: "add-imm",
        width: 64,
        rd,
        rn: rd,
        immediate: low,
        shift: 0,
        setFlags: false,
      },
    ],
  };
}
/** Atomically patch a pageAddress(rd, 0, 0) placeholder at a site whose code
 * base is 4 KiB aligned; offsets share that base. */
export function patchPageAddress(
  bytes: Uint8Array,
  fixup: {
    readonly offset: number;
    readonly targetOffset: number;
    readonly rd: number;
  },
): EncodingResult<undefined> {
  const valid = site(bytes, fixup.offset);
  if (!valid.ok) return valid;
  if (fixup.offset > bytes.length - 8) return fail("OUT_OF_BOUNDS");
  if (!integer(fixup.targetOffset, 0, Number.MAX_SAFE_INTEGER))
    return fail("INVALID_OFFSET");
  const template = pageAddress(fixup.rd, 0, 0);
  if (!template.ok) return template;
  const sequence = pageAddress(
    fixup.rd,
    Math.floor(fixup.targetOffset / 4096) - Math.floor(fixup.offset / 4096),
    fixup.targetOffset % 4096,
  );
  if (!sequence.ok) return sequence;
  const expected: number[] = [],
    replacement: number[] = [];
  for (const instruction of template.value) {
    if (instruction === undefined) throw "page address template invariant";
    const encoded = encode(instruction);
    if (!encoded.ok) return encoded;
    expected.push(encoded.value);
  }
  for (const instruction of sequence.value) {
    if (instruction === undefined) throw "page address sequence invariant";
    const encoded = encode(instruction);
    if (!encoded.ok) return encoded;
    replacement.push(encoded.value);
  }
  for (let index = 0; index < expected.length; index++) {
    const at = fixup.offset + index * 4;
    const current =
      ((bytes[at] ?? 0) |
        ((bytes[at + 1] ?? 0) << 8) |
        ((bytes[at + 2] ?? 0) << 16) |
        ((bytes[at + 3] ?? 0) << 24)) >>>
      0;
    if (current !== expected[index]) return fail("PATCH_MISMATCH");
  }
  for (let index = 0; index < replacement.length; index++) {
    const value = replacement[index] ?? 0,
      at = fixup.offset + index * 4;
    bytes[at] = value & 0xff;
    bytes[at + 1] = (value >>> 8) & 0xff;
    bytes[at + 2] = (value >>> 16) & 0xff;
    bytes[at + 3] = (value >>> 24) & 0xff;
  }
  return { ok: true, value: undefined };
}
/** Atomically patch a four-instruction relativeAddress(rd, scratch, 0) placeholder. */
export function patchRelativeAddress(
  bytes: Uint8Array,
  fixup: {
    readonly offset: number;
    readonly targetOffset: number;
    readonly rd: number;
    readonly scratch: number;
  },
): EncodingResult<undefined> {
  const valid = site(bytes, fixup.offset);
  if (!valid.ok) return valid;
  if (fixup.offset > bytes.length - 16) return fail("OUT_OF_BOUNDS");
  if (!integer(fixup.targetOffset, 0, Number.MAX_SAFE_INTEGER))
    return fail("INVALID_OFFSET");
  const template = relativeAddress(fixup.rd, fixup.scratch, 0);
  if (!template.ok) return template;
  const sequence = relativeAddress(
    fixup.rd,
    fixup.scratch,
    fixup.targetOffset - fixup.offset,
  );
  if (!sequence.ok) return sequence;
  const words: number[] = [];
  for (let index = 0; index < 4; index++) {
    const expected = template.value[index],
      instruction = sequence.value[index];
    if (expected === undefined || instruction === undefined)
      throw "relative address invariant";
    const original = encode(expected),
      replacement = encode(instruction);
    if (!original.ok) return original;
    if (!replacement.ok) return replacement;
    const at = fixup.offset + index * 4;
    const b0 = bytes[at],
      b1 = bytes[at + 1],
      b2 = bytes[at + 2],
      b3 = bytes[at + 3];
    if (
      b0 === undefined ||
      b1 === undefined ||
      b2 === undefined ||
      b3 === undefined
    )
      return fail("OUT_OF_BOUNDS");
    if (b0 + b1 * 256 + b2 * 65536 + b3 * 0x1000000 !== original.value)
      return fail("PATCH_MISMATCH");
    words.push(replacement.value);
  }
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (word === undefined) throw "relative address word invariant";
    if (!writeUnsigned(bytes, fixup.offset + index * 4, 4, word, "little").ok)
      throw "validated relative address invariant";
  }
  return { ok: true, value: undefined };
}
