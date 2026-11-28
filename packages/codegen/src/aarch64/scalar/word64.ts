import { nativeArrayDataOffset } from "@tint/abi/host";
import type {
  Word64BinaryOperator,
  Word64UnaryOperator,
} from "@tint/ir/scalar";
import type { Instruction } from "../isa.ts";

export interface Word64EmitContext {
  readonly emit: (instruction: Instruction) => void;
  readonly instructionCount: () => number;
  readonly patchInstruction: (index: number, instruction: Instruction) => void;
  readonly storedAsInteger: (id: number) => boolean;
  readonly intRegister: (id: number, scratch: number) => number;
  readonly intTarget: (id: number, scratch: number) => number;
  readonly rawRegister: (id: number, scratch: number) => number;
  readonly rawValue: (rd: number, id: number) => void;
  readonly saveRaw: (rt: number, id: number) => void;
  readonly floatLoad: (rt: number, id: number) => void;
  readonly floatStore: (rt: number, id: number) => void;
  readonly arrayIndex: (array: number, index: number) => number;
  readonly getCachedArrayDataVal: () => number;
  readonly getCachedArrayDataReg: () => number;
  readonly setCachedArrayData: (reg: number, val: number) => void;
}

/** Materialize a 64-bit integer from unsigned 32-bit `low` and `high` halves. */
function emitImm64(
  emit: (instruction: Instruction) => void,
  rd: number,
  low: number,
  high: number,
): void {
  const h0 = low & 0xffff,
    h1 = (low >>> 16) & 0xffff,
    h2 = high & 0xffff,
    h3 = (high >>> 16) & 0xffff;
  let emitted = false;
  if (h0 !== 0) {
    emit({ op: "movz", width: 64, rd, immediate: h0, shift: 0 });
    emitted = true;
  }
  if (h1 !== 0) {
    emit({
      op: emitted ? "movk" : "movz",
      width: 64,
      rd,
      immediate: h1,
      shift: 16,
    });
    emitted = true;
  }
  if (h2 !== 0) {
    emit({
      op: emitted ? "movk" : "movz",
      width: 64,
      rd,
      immediate: h2,
      shift: 32,
    });
    emitted = true;
  }
  if (h3 !== 0) {
    emit({
      op: emitted ? "movk" : "movz",
      width: 64,
      rd,
      immediate: h3,
      shift: 48,
    });
    emitted = true;
  }
  if (!emitted) emit({ op: "movz", width: 64, rd, immediate: 0, shift: 0 });
}

export function emitWord64Constant(
  ctx: Word64EmitContext,
  op: { readonly id: number; readonly low: number; readonly high: number },
): void {
  const dst = ctx.intTarget(op.id, 9);
  emitImm64(ctx.emit, dst, op.low, op.high);
  if (dst === 9) ctx.saveRaw(9, op.id);
}

export function emitWord64FromNumber(
  ctx: Word64EmitContext,
  op: { readonly id: number; readonly value: number },
): void {
  const dst = ctx.intTarget(op.id, 9);
  if (ctx.storedAsInteger(op.value)) {
    const src = ctx.intRegister(op.value, dst);
    if (src !== dst)
      ctx.emit({
        op: "orr-reg",
        width: 64,
        rd: dst,
        rn: "zr",
        rm: src,
      });
  } else {
    ctx.floatLoad(0, op.value);
    ctx.emit({ op: "fcvtzs-x-d", rd: dst, rn: 0 });
  }
  if (dst === 9) ctx.saveRaw(9, op.id);
}

export function emitWord64ToNumber(
  ctx: Word64EmitContext,
  op: { readonly id: number; readonly value: number; readonly signed: boolean },
): void {
  const src = ctx.rawRegister(op.value, 9);
  if (op.signed) ctx.emit({ op: "scvtf-d-x", rd: 0, rn: src });
  else ctx.emit({ op: "ucvtf-d-x", rd: 0, rn: src });
  ctx.floatStore(0, op.id);
}

export function emitWord64Binary(
  ctx: Word64EmitContext,
  op: {
    readonly id: number;
    readonly operator: Word64BinaryOperator;
    readonly left: number;
    readonly right: number;
  },
): void {
  const lhs = ctx.rawRegister(op.left, 9),
    rhs = ctx.rawRegister(op.right, 10),
    dst = ctx.intTarget(op.id, 9);
  switch (op.operator) {
    case "add":
      ctx.emit({
        op: "add-reg",
        width: 64,
        rd: dst,
        rn: lhs,
        rm: rhs,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      break;
    case "sub":
      ctx.emit({
        op: "sub-reg",
        width: 64,
        rd: dst,
        rn: lhs,
        rm: rhs,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      break;
    case "mul":
      ctx.emit({
        op: "madd",
        width: 64,
        rd: dst,
        rn: lhs,
        rm: rhs,
        ra: "zr",
      });
      break;
    case "and":
      ctx.emit({ op: "and-reg", width: 64, rd: dst, rn: lhs, rm: rhs });
      break;
    case "or":
      ctx.emit({ op: "orr-reg", width: 64, rd: dst, rn: lhs, rm: rhs });
      break;
    case "xor":
      ctx.emit({ op: "eor-reg", width: 64, rd: dst, rn: lhs, rm: rhs });
      break;
    case "shl":
      ctx.emit({ op: "lslv", width: 64, rd: dst, rn: lhs, rm: rhs });
      break;
    case "sar":
      ctx.emit({ op: "asrv", width: 64, rd: dst, rn: lhs, rm: rhs });
      break;
    case "shr":
      ctx.emit({ op: "lsrv", width: 64, rd: dst, rn: lhs, rm: rhs });
      break;
  }
  if (dst === 9) ctx.saveRaw(9, op.id);
}

export function emitWord64Unary(
  ctx: Word64EmitContext,
  op: {
    readonly id: number;
    readonly operator: Word64UnaryOperator;
    readonly operand: number;
  },
): void {
  const src = ctx.rawRegister(op.operand, 9),
    dst = ctx.intTarget(op.id, 9);
  if (op.operator === "neg")
    ctx.emit({
      op: "sub-reg",
      width: 64,
      rd: dst,
      rn: "zr",
      rm: src,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
  else ctx.emit({ op: "orn-reg", width: 64, rd: dst, rn: "zr", rm: src });
  if (dst === 9) ctx.saveRaw(9, op.id);
}

export function emitWord64Part(
  ctx: Word64EmitContext,
  op: {
    readonly id: number;
    readonly value: number;
    readonly half: "low" | "high";
  },
): void {
  const src = ctx.rawRegister(op.value, 9);
  if (op.half === "low")
    ctx.emit({ op: "ubfm", width: 64, rd: 9, rn: src, immr: 0, imms: 31 });
  else ctx.emit({ op: "ubfm", width: 64, rd: 9, rn: src, immr: 32, imms: 63 });
  ctx.emit({ op: "ucvtf-d-x", rd: 0, rn: 9 });
  ctx.floatStore(0, op.id);
}

export function emitWord64FromParts(
  ctx: Word64EmitContext,
  op: { readonly id: number; readonly low: number; readonly high: number },
): void {
  const dst = ctx.intTarget(op.id, 9);
  let lowReg = 9;
  if (ctx.storedAsInteger(op.low)) {
    lowReg = ctx.intRegister(op.low, 9);
    ctx.emit({ op: "ubfm", width: 64, rd: 9, rn: lowReg, immr: 0, imms: 31 });
  } else {
    ctx.floatLoad(0, op.low);
    ctx.emit({ op: "fcvtzu-w-d", rd: 9, rn: 0 });
  }
  let highReg = 10;
  if (ctx.storedAsInteger(op.high)) {
    highReg = ctx.intRegister(op.high, 10);
  } else {
    ctx.floatLoad(0, op.high);
    ctx.emit({ op: "fcvtzu-w-d", rd: 10, rn: 0 });
    highReg = 10;
  }
  ctx.emit({
    op: "orr-reg",
    width: 64,
    rd: dst,
    rn: 9,
    rm: highReg,
    shift: "lsl",
    amount: 32,
  });
  if (dst === 9) ctx.saveRaw(9, op.id);
}

function arrayDataRegister(
  ctx: Word64EmitContext,
  array: number,
  hoistedBase: number | undefined,
): number {
  if (hoistedBase !== undefined) return hoistedBase;
  if (ctx.getCachedArrayDataVal() === array) return 15;
  const arrReg = ctx.rawRegister(array, 10);
  if (arrReg >= 19) {
    if (ctx.getCachedArrayDataReg() !== arrReg) {
      ctx.emit({
        op: "ldr",
        width: 64,
        rt: 15,
        rn: arrReg,
        offset: nativeArrayDataOffset,
      });
      ctx.setCachedArrayData(arrReg, -1);
    }
    return 15;
  }
  ctx.emit({
    op: "ldr",
    width: 64,
    rt: 10,
    rn: arrReg,
    offset: nativeArrayDataOffset,
  });
  return 10;
}

export function emitArrayWord64Element(
  ctx: Word64EmitContext,
  op: { readonly id: number; readonly array: number; readonly index: number },
  hoistedBase: number | undefined,
): void {
  let indexReg = 12;
  if (ctx.storedAsInteger(op.index)) {
    indexReg = ctx.intRegister(op.index, 12);
  } else {
    ctx.floatLoad(0, op.index);
    ctx.emit({ op: "fcvtzs-x-d", rd: 12, rn: 0 });
  }
  const dataReg = arrayDataRegister(ctx, op.array, hoistedBase),
    dst = ctx.intTarget(op.id, 9);
  ctx.emit({
    op: "ldr-indexed",
    size: 3,
    fp: false,
    rt: dst,
    rn: dataReg,
    rm: indexReg,
    scaled: true,
  });
  if (dst === 9) ctx.saveRaw(9, op.id);
}

export function emitArrayWord64Store(
  ctx: Word64EmitContext,
  op: {
    readonly array: number;
    readonly index: number;
    readonly value: number;
    readonly unchecked?: true;
  },
  hoistedBase: number | undefined,
): void {
  if (op.unchecked === true) {
    let indexReg = 12;
    if (ctx.storedAsInteger(op.index)) {
      indexReg = ctx.intRegister(op.index, 12);
    } else {
      ctx.floatLoad(0, op.index);
      ctx.emit({ op: "fcvtzs-x-d", rd: 12, rn: 0 });
    }
    const dataReg = arrayDataRegister(ctx, op.array, hoistedBase),
      valReg = ctx.rawRegister(op.value, 11);
    ctx.emit({
      op: "str-indexed",
      size: 3,
      fp: false,
      rt: valReg,
      rn: dataReg,
      rm: indexReg,
      scaled: true,
    });
    return;
  }
  const storeIndex = ctx.arrayIndex(op.array, op.index);
  const invalid = ctx.instructionCount();
  ctx.emit({ op: "cbz", width: 32, rt: 13, displacement: 0 });
  const valReg = ctx.rawRegister(op.value, 11);
  ctx.emit({
    op: "str-indexed",
    size: 3,
    fp: false,
    rt: valReg,
    rn: 10,
    rm: storeIndex,
    scaled: true,
  });
  ctx.patchInstruction(invalid, {
    op: "cbz",
    width: 32,
    rt: 13,
    displacement: (ctx.instructionCount() - invalid) * 4,
  });
}
