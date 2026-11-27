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
    // Validate every range before the first load or store. 2^53 - 1 is 53
    // trailing ones, encodable as one 64-bit logical immediate.
    emit({
      op: "orr-imm",
      width: 64,
      rd: 9,
      rn: "zr",
      n: 1,
      immr: 0,
      imms: 52,
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
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 4,
      immediate: width,
      shift: 0,
      setFlags: true,
    });
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
  copy("backward-pair", "backward-tail", 16, false);
  asm.label("backward-tail");
  emit({
    op: "sub-imm",
    width: 64,
    rd: "zr",
    rn: 4,
    immediate: 0,
    shift: 0,
    setFlags: true,
  });
  asm.branch("done", "eq");
  copy("backward-word", "backward-byte", 8, false);
  copy("backward-byte", "done", 1, false);
  asm.label("forward");
  // Fast straight-line copies for the dominant 32- and 48-byte managed objects.
  emit({
    op: "sub-imm",
    width: 64,
    rd: "zr",
    rn: 4,
    immediate: 32,
    shift: 0,
    setFlags: true,
  });
  asm.branch("forward-not32", "ne");
  emit({
    op: "ldp",
    width: 64,
    rt: 9,
    rt2: 10,
    rn: 3,
    offset: 0,
    mode: "offset",
  });
  emit({
    op: "stp",
    width: 64,
    rt: 9,
    rt2: 10,
    rn: 2,
    offset: 0,
    mode: "offset",
  });
  emit({
    op: "ldp",
    width: 64,
    rt: 9,
    rt2: 10,
    rn: 3,
    offset: 16,
    mode: "offset",
  });
  emit({
    op: "stp",
    width: 64,
    rt: 9,
    rt2: 10,
    rn: 2,
    offset: 16,
    mode: "offset",
  });
  asm.branch("done");
  asm.label("forward-not32");
  emit({
    op: "sub-imm",
    width: 64,
    rd: "zr",
    rn: 4,
    immediate: 48,
    shift: 0,
    setFlags: true,
  });
  asm.branch("forward-pair", "ne");
  emit({
    op: "ldp",
    width: 64,
    rt: 9,
    rt2: 10,
    rn: 3,
    offset: 0,
    mode: "offset",
  });
  emit({
    op: "stp",
    width: 64,
    rt: 9,
    rt2: 10,
    rn: 2,
    offset: 0,
    mode: "offset",
  });
  emit({
    op: "ldp",
    width: 64,
    rt: 9,
    rt2: 10,
    rn: 3,
    offset: 16,
    mode: "offset",
  });
  emit({
    op: "stp",
    width: 64,
    rt: 9,
    rt2: 10,
    rn: 2,
    offset: 16,
    mode: "offset",
  });
  emit({
    op: "ldp",
    width: 64,
    rt: 9,
    rt2: 10,
    rn: 3,
    offset: 32,
    mode: "offset",
  });
  emit({
    op: "stp",
    width: 64,
    rt: 9,
    rt2: 10,
    rn: 2,
    offset: 32,
    mode: "offset",
  });
  asm.branch("done");
  copy("forward-pair", "forward-tail", 16, true);
  asm.label("forward-tail");
  emit({
    op: "sub-imm",
    width: 64,
    rd: "zr",
    rn: 4,
    immediate: 0,
    shift: 0,
    setFlags: true,
  });
  asm.branch("done", "eq");
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

/** x0 destination address, x1 byte count (a multiple of the element size),
 * x2 the element pattern replicated to 64 bits. Stores the pattern over the
 * range, 64 bytes per iteration, then 32/16/8/4/2/1-byte tails. Every chunk
 * starts at a multiple of the element size from x0, so the pattern stays in
 * phase. Nonallocating; clobbers x0 and x1. */
export function memoryFiller(): readonly Instruction[] {
  const asm = createLeafAssembler(),
    emit = asm.emit;
  function below(bytes: number, label: string): void {
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 1,
      immediate: bytes,
      shift: 0,
      setFlags: true,
    });
    asm.branch(label, "cc");
  }
  function consume(bytes: number): void {
    emit({
      op: "add-imm",
      width: 64,
      rd: 0,
      rn: 0,
      immediate: bytes,
      shift: 0,
      setFlags: false,
    });
    emit({
      op: "sub-imm",
      width: 64,
      rd: 1,
      rn: 1,
      immediate: bytes,
      shift: 0,
      setFlags: false,
    });
  }
  asm.label("wide");
  below(64, "quad");
  for (let offset = 0; offset < 64; offset += 16)
    emit({
      op: "stp",
      width: 64,
      rt: 2,
      rt2: 2,
      rn: 0,
      offset,
      mode: "offset",
    });
  consume(64);
  asm.branch("wide");
  asm.label("quad");
  below(32, "pair");
  emit({
    op: "stp",
    width: 64,
    rt: 2,
    rt2: 2,
    rn: 0,
    offset: 0,
    mode: "offset",
  });
  emit({
    op: "stp",
    width: 64,
    rt: 2,
    rt2: 2,
    rn: 0,
    offset: 16,
    mode: "offset",
  });
  consume(32);
  asm.label("pair");
  below(16, "word");
  emit({
    op: "stp",
    width: 64,
    rt: 2,
    rt2: 2,
    rn: 0,
    offset: 0,
    mode: "offset",
  });
  consume(16);
  asm.label("word");
  below(8, "half");
  emit({ op: "str", width: 64, rt: 2, rn: 0, offset: 0 });
  consume(8);
  asm.label("half");
  below(4, "short");
  emit({ op: "str", width: 32, rt: 2, rn: 0, offset: 0 });
  consume(4);
  asm.label("short");
  below(2, "byte");
  emit({ op: "strh", rt: 2, rn: 0, offset: 0 });
  consume(2);
  asm.label("byte");
  below(1, "done");
  emit({ op: "strb", rt: 2, rn: 0, offset: 0 });
  asm.label("done");
  emit({ op: "ret", rn: 30 });
  return asm.finish();
}

export type BytesElementKind =
  "i8" | "u8" | "i16" | "u16" | "i32" | "u32" | "f16" | "f32" | "f64";

export interface BytesEmitContext {
  readonly wordKinds: Uint8Array;
  readonly wordConstants: Uint32Array;
  readonly jsConvert: boolean;
  readonly resultOffset: number;
  readonly internValue: (id: number) => number;
  readonly emit: (instruction: Instruction) => void;
  readonly imm: (rd: number, value: number) => void;
  readonly storedAsInteger: (id: number) => boolean;
  readonly storedAsWord: (id: number) => boolean;
  readonly wantsInteger: (id: number) => boolean;
  readonly booleanConstant: (id: number) => boolean | undefined;
  readonly intRegister: (id: number, scratch: number) => number;
  readonly intTarget: (id: number, fallback: number) => number;
  readonly rawRegister: (id: number, scratch: number) => number;
  readonly rawValue: (rt: number, id: number) => void;
  readonly rawLoad: (rt: number, offset: number) => void;
  readonly rawStore: (rt: number, offset: number) => void;
  readonly saveRaw: (rt: number, id: number) => void;
  readonly markInteger: (id: number) => void;
  readonly materializeInteger: (id: number) => void;
  readonly wordValue: (id: number) => void;
  readonly floatLoad: (rt: number, id: number) => void;
  readonly floatOperand: (id: number, scratch: number) => number;
  readonly floatTarget: (id: number, fallback: number) => number;
  readonly floatStore: (rt: number, id: number) => void;
  readonly getCachedArrayDataVal: () => number;
  readonly getCachedArrayDataReg: () => number;
  readonly setCachedArrayData: (reg: number, val: number) => void;
}

function bytesDataAndOffset(
  ctx: BytesEmitContext,
  array: number,
  offset: number,
  hoistedBase: number | undefined,
): { readonly dataReg: number; readonly index: number } {
  const fact = ctx.internValue(offset);
  let index = 12;
  if (ctx.storedAsInteger(offset)) index = ctx.intRegister(offset, 12);
  else if (ctx.wordKinds[fact] === 3) ctx.imm(12, ctx.wordConstants[fact] ?? 0);
  else {
    ctx.floatLoad(0, offset);
    ctx.emit({ op: "fcvtzs-x-d", rd: 12, rn: 0 });
  }
  let dataReg = 10;
  if (hoistedBase !== undefined) {
    dataReg = hoistedBase;
  } else if (ctx.getCachedArrayDataVal() === array) {
    dataReg = 15;
  } else {
    const arrReg = ctx.rawRegister(array, 10);
    if (arrReg >= 19) {
      dataReg = 15;
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
    } else {
      ctx.emit({
        op: "ldr",
        width: 64,
        rt: 10,
        rn: arrReg,
        offset: nativeArrayDataOffset,
      });
    }
  }
  return { dataReg, index };
}

function emitSwapOp(
  ctx: BytesEmitContext,
  swapOp: "rev16" | "rev32" | "rev",
  rd: number,
  rn: number,
): void {
  if (swapOp === "rev16") ctx.emit({ op: "rev16", rd, rn });
  else if (swapOp === "rev32") ctx.emit({ op: "rev32", rd, rn });
  else ctx.emit({ op: "rev", rd, rn });
}

function emitByteSwap(
  ctx: BytesEmitContext,
  swapOp: "rev16" | "rev32" | "rev",
  reg: number,
  littleEndian: number,
): void {
  const constLe = ctx.booleanConstant(littleEndian);
  if (constLe === true) return;
  if (constLe === false) {
    emitSwapOp(ctx, swapOp, reg, reg);
    return;
  }
  ctx.rawValue(13, littleEndian);
  ctx.emit({ op: "cbnz", width: 32, rt: 13, displacement: 8 });
  emitSwapOp(ctx, swapOp, reg, reg);
}

export function emitBytesLoad(
  ctx: BytesEmitContext,
  op: {
    readonly id: number;
    readonly array: number;
    readonly offset: number;
    readonly element: BytesElementKind;
    readonly littleEndian: number;
  },
  hoistedBase: number | undefined,
): void {
  const { dataReg, index } = bytesDataAndOffset(
    ctx,
    op.array,
    op.offset,
    hoistedBase,
  );
  const el = op.element,
    constLe = ctx.booleanConstant(op.littleEndian);
  if (el === "f16" || el === "f32" || el === "f64") {
    const target = ctx.floatTarget(op.id, 0);
    const size: 1 | 2 | 3 = el === "f16" ? 1 : el === "f32" ? 2 : 3;
    if (constLe === true) {
      ctx.emit({
        op: "ldr-indexed",
        size,
        fp: true,
        rt: target,
        rn: dataReg,
        rm: index,
        scaled: false,
      });
      if (el === "f16") ctx.emit({ op: "fcvt-d-h", rd: target, rn: target });
      else if (el === "f32")
        ctx.emit({ op: "fcvt-d-s", rd: target, rn: target });
    } else {
      ctx.emit({
        op: "ldr-indexed",
        size,
        fp: false,
        rt: 11,
        rn: dataReg,
        rm: index,
        scaled: false,
      });
      emitByteSwap(
        ctx,
        el === "f16" ? "rev16" : el === "f32" ? "rev32" : "rev",
        11,
        op.littleEndian,
      );
      if (el === "f16") {
        ctx.emit({ op: "fmov-s-w", rd: target, rn: 11 });
        ctx.emit({ op: "fcvt-d-h", rd: target, rn: target });
      } else if (el === "f32") {
        ctx.emit({ op: "fmov-s-w", rd: target, rn: 11 });
        ctx.emit({ op: "fcvt-d-s", rd: target, rn: target });
      } else {
        ctx.emit({ op: "fmov-d-x", rd: target, rn: 11 });
      }
    }
    ctx.floatStore(target, op.id);
    return;
  }
  const signed = el === "i8" || el === "i16" || el === "i32";
  const size: 0 | 1 | 2 =
    el === "i8" || el === "u8" ? 0 : el === "i16" || el === "u16" ? 1 : 2;
  const intOut = ctx.wantsInteger(op.id);
  const dst =
    intOut && (size === 0 || constLe !== undefined)
      ? ctx.intTarget(op.id, 11)
      : 11;
  if (size === 0 || constLe === true) {
    ctx.emit({
      op: "ldr-indexed",
      size,
      fp: false,
      rt: dst,
      rn: dataReg,
      rm: index,
      scaled: false,
      signed,
    });
  } else {
    ctx.emit({
      op: "ldr-indexed",
      size,
      fp: false,
      rt: dst,
      rn: dataReg,
      rm: index,
      scaled: false,
      signed: false,
    });
    emitByteSwap(ctx, size === 1 ? "rev16" : "rev32", dst, op.littleEndian);
    if (signed) {
      if (size === 1) ctx.emit({ op: "sxth", rd: dst, rn: dst });
      else ctx.emit({ op: "sxtw", rd: dst, rn: dst });
    }
  }
  if (intOut) {
    ctx.saveRaw(dst, op.id);
    ctx.markInteger(op.id);
  } else {
    const target = ctx.floatTarget(op.id, 0);
    if (signed) ctx.emit({ op: "scvtf-d-x", rd: target, rn: dst });
    else ctx.emit({ op: "ucvtf-d-w", rd: target, rn: dst });
    ctx.floatStore(target, op.id);
  }
}

export function emitBytesStore(
  ctx: BytesEmitContext,
  op: {
    readonly array: number;
    readonly offset: number;
    readonly value: number;
    readonly element: BytesElementKind;
    readonly littleEndian: number;
  },
  hoistedBase: number | undefined,
): void {
  const el = op.element,
    constLe = ctx.booleanConstant(op.littleEndian);
  const isFloat = el === "f16" || el === "f32" || el === "f64";
  const storeVal = op.value;
  ctx.materializeInteger(storeVal);
  const directWord =
    !isFloat && (ctx.storedAsInteger(storeVal) || ctx.storedAsWord(storeVal));
  if (!isFloat && !directWord) {
    ctx.wordValue(storeVal);
    ctx.rawStore(9, ctx.resultOffset + 24);
    if (!ctx.jsConvert) ctx.setCachedArrayData(-1, -1);
  }
  const { dataReg, index } = bytesDataAndOffset(
    ctx,
    op.array,
    op.offset,
    hoistedBase,
  );
  if (isFloat) {
    const size: 1 | 2 | 3 = el === "f16" ? 1 : el === "f32" ? 2 : 3;
    let fVal = 0;
    if (ctx.storedAsInteger(storeVal)) ctx.floatLoad(0, storeVal);
    else fVal = ctx.floatOperand(storeVal, 0);
    if (el === "f16") {
      ctx.emit({ op: "fcvt-h-d", rd: 0, rn: fVal });
      fVal = 0;
    } else if (el === "f32") {
      ctx.emit({ op: "fcvt-s-d", rd: 0, rn: fVal });
      fVal = 0;
    }
    if (constLe === true) {
      ctx.emit({
        op: "str-indexed",
        size,
        fp: true,
        rt: fVal,
        rn: dataReg,
        rm: index,
        scaled: false,
      });
    } else {
      if (el === "f64") ctx.emit({ op: "fmov-x-d", rd: 11, rn: fVal });
      else ctx.emit({ op: "fmov-w-s", rd: 11, rn: fVal });
      emitByteSwap(
        ctx,
        el === "f16" ? "rev16" : el === "f32" ? "rev32" : "rev",
        11,
        op.littleEndian,
      );
      ctx.emit({
        op: "str-indexed",
        size,
        fp: false,
        rt: 11,
        rn: dataReg,
        rm: index,
        scaled: false,
      });
    }
    return;
  }
  const size: 0 | 1 | 2 =
    el === "i8" || el === "u8" ? 0 : el === "i16" || el === "u16" ? 1 : 2;
  let word = 11;
  if (directWord)
    word = ctx.storedAsInteger(storeVal)
      ? ctx.intRegister(storeVal, 11)
      : ctx.rawRegister(storeVal, 11);
  else ctx.rawLoad(11, ctx.resultOffset + 24);
  if (size !== 0 && constLe !== true) {
    const swapOp = size === 1 ? "rev16" : "rev32";
    if (constLe === false) {
      emitSwapOp(ctx, swapOp, 11, word);
      word = 11;
    } else {
      if (word !== 11)
        ctx.emit({ op: "orr-reg", width: 64, rd: 11, rn: "zr", rm: word });
      emitByteSwap(ctx, swapOp, 11, op.littleEndian);
      word = 11;
    }
  }
  ctx.emit({
    op: "str-indexed",
    size,
    fp: false,
    rt: word,
    rn: dataReg,
    rm: index,
    scaled: false,
  });
}

export function emitBytesWord64Load(
  ctx: BytesEmitContext,
  op: {
    readonly array: number;
    readonly offset: number;
    readonly scratch: number;
    readonly littleEndian: number;
  },
  hoistedBase: number | undefined,
): void {
  const { dataReg, index } = bytesDataAndOffset(
    ctx,
    op.array,
    op.offset,
    hoistedBase,
  );
  ctx.emit({
    op: "ldr-indexed",
    size: 3,
    fp: false,
    rt: 11,
    rn: dataReg,
    rm: index,
    scaled: false,
  });
  emitByteSwap(ctx, "rev", 11, op.littleEndian);
  ctx.rawValue(12, op.scratch);
  ctx.emit({
    op: "ldr",
    width: 64,
    rt: 12,
    rn: 12,
    offset: nativeArrayDataOffset,
  });
  ctx.emit({ op: "str", width: 64, rt: 11, rn: 12, offset: 0 });
}

export function emitBytesWord64Store(
  ctx: BytesEmitContext,
  op: {
    readonly array: number;
    readonly offset: number;
    readonly scratch: number;
    readonly littleEndian: number;
  },
  hoistedBase: number | undefined,
): void {
  const { dataReg, index } = bytesDataAndOffset(
    ctx,
    op.array,
    op.offset,
    hoistedBase,
  );
  ctx.rawValue(11, op.scratch);
  ctx.emit({
    op: "ldr",
    width: 64,
    rt: 11,
    rn: 11,
    offset: nativeArrayDataOffset,
  });
  ctx.emit({ op: "ldr", width: 64, rt: 11, rn: 11, offset: 0 });
  emitByteSwap(ctx, "rev", 11, op.littleEndian);
  ctx.emit({
    op: "str-indexed",
    size: 3,
    fp: false,
    rt: 11,
    rn: dataReg,
    rm: index,
    scaled: false,
  });
}
