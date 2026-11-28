import {
  nativeArrayDataOffset,
  nativeArrayInlineOffset,
  nativeArrayLengthOffset,
} from "@tint/abi/host";
import { encodeFloat64 } from "@tint/foundation/binary/bytes";
import type { WordBuffer } from "@tint/foundation/binary/word-buffer";
import type { NumberIndex } from "@tint/foundation/collections/key-index";
import {
  typedArrayIntegerElements,
  typedArrayLayout,
  typedArrayScale,
  type Block as IRBlock,
  type Instruction as IRInstruction,
  type NativeTypedArray,
  type ScalarType,
} from "@tint/ir/scalar";
import type { Branch, Instruction } from "../isa.ts";
import type { DebugTracker } from "./debug-variables.ts";
import type { LeafHelperKind } from "./index.ts";

export interface ArrayOpsValue {
  readonly offset: number;
  readonly type: ScalarType;
}

export interface ArrayOpsEmitContext {
  readonly instructions: WordBuffer;
  readonly valueIds: NumberIndex;
  readonly wordKinds: Uint8Array;
  readonly wordConstants: Uint32Array;
  readonly contextOffset: number;
  readonly resultOffset: number;
  readonly generationalBarriers: boolean;
  readonly tracker: DebugTracker | undefined;
  readonly deferredAllocSlowPaths: (() => void)[];
  readonly elidedStoreSource: Map<number, number>;
  readonly foldedConstants: Uint8Array;
  readonly fusedFallbacks: Map<number, number>;
  readonly fusedReads: Uint32Array;
  readonly hoistedArrayDataValues: Map<number, number>;
  readonly canDeferColdStub: () => boolean;
  readonly deferRememberSlow: () =>
    ((emitSlow: () => void) => void) | undefined;
  readonly getCachedArrayDataReg: () => number;
  readonly getCachedArrayDataVal: () => number;
  readonly setCachedArrayData: (reg: number, val: number) => void;
  readonly value: (id: number) => ArrayOpsValue;
  readonly absentNumber: (rd: number) => void;
  readonly arrayIndex: (
    array: number,
    index: number,
    vector?: boolean,
  ) => number;
  readonly callHelper: (kind: LeafHelperKind) => void;
  readonly clampedValue: (id: number) => void;
  readonly clearWordCaches: () => void;
  readonly elementToDouble: (type: ScalarType, rd: number, rn: number) => void;
  readonly emit: (i: Instruction) => void;
  readonly floatLoad: (rt: number, id: number, byteOffset?: number) => void;
  readonly floatOperand: (id: number, scratch: number) => number;
  readonly floatStore: (rt: number, id: number) => void;
  readonly floatTarget: (id: number, scratch: number) => number;
  readonly homeOf: (id: number) => number;
  readonly imm: (rd: number, value: number) => void;
  readonly imm64: (rd: number, lo: number, hi: number) => void;
  readonly intOperand: (id: number, rt: number) => void;
  readonly intRegister: (id: number, scratch: number) => number;
  readonly intTarget: (id: number, scratch: number) => number;
  readonly loadElement: (
    type: ScalarType,
    base: number,
    index: number,
    integer: number,
    float: number,
  ) => boolean;
  readonly markInteger: (id: number) => void;
  readonly materializeInteger: (id: number) => void;
  readonly numberConstant: (id: number) => number | undefined;
  readonly patchInstruction: (index: number, instruction: Instruction) => void;
  readonly quietNumber: (rd: number, rn: number) => void;
  readonly rawLoad: (rt: number, offset: number) => void;
  readonly rawRegister: (id: number, scratch: number) => number;
  readonly rawStore: (rt: number | "zr", offset: number) => void;
  readonly rawValue: (rt: number, id: number) => void;
  readonly rememberObject: (
    defer?: (emitSlow: () => void) => void,
    objReg?: number,
    loadContext?: () => void,
    unneeded?: () => readonly number[],
  ) => void;
  readonly saveRaw: (rt: number, id: number) => void;
  readonly storedAsInteger: (id: number) => boolean;
  readonly storedAsWord: (id: number) => boolean;
  readonly trapIf: (branch: Branch) => void;
  readonly typedArrayType: (type: ScalarType) => NativeTypedArray;
  readonly vectorHeader: (vector: number) => void;
  readonly wantsInteger: (id: number) => boolean;
  readonly wordValue: (id: number) => void;
}

export function emitArrayOp(
  ctx: ArrayOpsEmitContext,
  instruction: IRInstruction,
  b: IRBlock,
  initialOperationIndex: number,
): number {
  const op = instruction;
  let operationIndex = initialOperationIndex;
  const {
    instructions,
    valueIds,
    wordKinds,
    wordConstants,
    contextOffset,
    resultOffset,
    generationalBarriers,
    tracker,
    deferredAllocSlowPaths,
    elidedStoreSource,
    foldedConstants,
    fusedFallbacks,
    fusedReads,
    hoistedArrayDataValues,
    canDeferColdStub,
    deferRememberSlow,
    value,
    absentNumber,
    arrayIndex,
    callHelper,
    clampedValue,
    clearWordCaches,
    elementToDouble,
    emit,
    floatLoad,
    floatOperand,
    floatStore,
    floatTarget,
    homeOf,
    imm,
    imm64,
    intOperand,
    intRegister,
    intTarget,
    loadElement,
    markInteger,
    materializeInteger,
    numberConstant,
    patchInstruction,
    quietNumber,
    rawLoad,
    rawRegister,
    rawStore,
    rawValue,
    rememberObject,
    saveRaw,
    storedAsInteger,
    storedAsWord,
    trapIf,
    typedArrayType,
    vectorHeader,
    wantsInteger,
    wordValue,
  } = ctx;
  switch (op.kind) {
    case "reference-vector-copy": {
      // x14 source, x15 target, x9 count, x12 index, x13/x10 the
      // element bases. The count must be an exact integer within
      // both lengths (negatives fail the unsigned checks).
      vectorHeader(op.source);
      emit({
        op: "add-imm",
        width: 64,
        rd: 14,
        rn: 10,
        immediate: 0,
        shift: 0,
        setFlags: false,
      });
      vectorHeader(op.target);
      emit({
        op: "add-imm",
        width: 64,
        rd: 15,
        rn: 10,
        immediate: 0,
        shift: 0,
        setFlags: false,
      });
      const copyCount = floatOperand(op.count, 0);
      emit({ op: "fcvtzs-x-d", rd: 9, rn: copyCount });
      emit({ op: "scvtf-d-x", rd: 1, rn: 9 });
      emit({ op: "fcmp", rn: 1, rm: copyCount });
      trapIf({ op: "b.cond", condition: "ne" });
      const withinLength = (vector: number): void => {
        emit({
          op: "ldr",
          width: 32,
          rt: 11,
          rn: vector,
          offset: nativeArrayLengthOffset,
        });
        emit({
          op: "sub-reg",
          width: 64,
          rd: "zr",
          rn: 9,
          rm: 11,
          shift: "lsl",
          amount: 0,
          setFlags: true,
        });
        trapIf({ op: "b.cond", condition: "hi" });
      };
      withinLength(14);
      withinLength(15);
      const emptyCopy = instructions.length;
      emit({ op: "cbz", width: 64, rt: 9, displacement: 0 });
      emit({
        op: "add-imm",
        width: 64,
        rd: 13,
        rn: 14,
        immediate: nativeArrayInlineOffset,
        shift: 0,
        setFlags: false,
      });
      emit({
        op: "add-imm",
        width: 64,
        rd: 10,
        rn: 15,
        immediate: nativeArrayInlineOffset,
        shift: 0,
        setFlags: false,
      });
      imm(12, 0);
      const copyLoop = instructions.length;
      emit({
        op: "ldr-indexed",
        size: 3,
        fp: false,
        rt: 11,
        rn: 13,
        rm: 12,
        scaled: true,
      });
      if (op.rebase) {
        emit({
          op: "sub-reg",
          width: 64,
          rd: "zr",
          rn: 11,
          rm: 14,
          shift: "lsl",
          amount: 0,
          setFlags: true,
        });
        emit({ op: "b.cond", condition: "ne", displacement: 8 });
        emit({
          op: "add-imm",
          width: 64,
          rd: 11,
          rn: 15,
          immediate: 0,
          shift: 0,
          setFlags: false,
        });
      }
      emit({
        op: "str-indexed",
        size: 3,
        fp: false,
        rt: 11,
        rn: 10,
        rm: 12,
        scaled: true,
      });
      emit({
        op: "add-imm",
        width: 64,
        rd: 12,
        rn: 12,
        immediate: 1,
        shift: 0,
        setFlags: false,
      });
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: 12,
        rm: 9,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
      emit({
        op: "b.cond",
        condition: "cc",
        displacement: (copyLoop - instructions.length) * 4,
      });
      if (generationalBarriers) {
        // One remembered target covers every copied element.
        emit({
          op: "add-imm",
          width: 64,
          rd: 9,
          rn: 15,
          immediate: 0,
          shift: 0,
          setFlags: false,
        });
        rawLoad(10, contextOffset);
        rememberObject(deferRememberSlow());
      }
      patchInstruction(emptyCopy, {
        op: "cbz",
        width: 64,
        rt: 9,
        displacement: (instructions.length - emptyCopy) * 4,
      });
      break;
    }
    case "array-read": {
      const readType = value(op.array).type,
        readFpHome = homeOf(op.id),
        constReadIdx = numberConstant(op.index);
      if (
        readType === "Float64Array" &&
        fusedFallbacks.get(op.id) === undefined &&
        fusedReads[valueIds.intern(op.id)] === 0 &&
        constReadIdx !== undefined &&
        Number.isInteger(constReadIdx) &&
        constReadIdx >= 0 &&
        constReadIdx <= 4095 &&
        !(constReadIdx === 0 && 1 / constReadIdx < 0)
      ) {
        const arrReg = rawRegister(op.array, 9);
        emit({
          op: "ldr",
          width: 32,
          rt: 11,
          rn: arrReg,
          offset: nativeArrayLengthOffset,
        });
        emit({
          op: "ldr",
          width: 64,
          rt: 10,
          rn: arrReg,
          offset: nativeArrayDataOffset,
        });
        emit({
          op: "sub-imm",
          width: 64,
          rd: "zr",
          rn: 11,
          immediate: constReadIdx,
          shift: 0,
          setFlags: true,
        });
        if (readFpHome > 0 && readFpHome < 32) {
          const absent = instructions.length;
          emit({ op: "b.cond", condition: "ls", displacement: 0 });
          emit({
            op: "ldr-d",
            rt: readFpHome,
            rn: 10,
            offset: constReadIdx * 8,
          });
          quietNumber(readFpHome, readFpHome);
          if (canDeferColdStub()) {
            const resumeAt = instructions.length;
            clearWordCaches();
            deferredAllocSlowPaths.push(() => {
              clearWordCaches();
              patchInstruction(absent, {
                op: "b.cond",
                condition: "ls",
                displacement: (instructions.length - absent) * 4,
              });
              absentNumber(11);
              emit({ op: "fmov-d-x", rd: readFpHome, rn: 11 });
              emit({
                op: "b",
                displacement: (resumeAt - instructions.length) * 4,
              });
            });
          } else {
            const done = instructions.length;
            emit({ op: "b", displacement: 0 });
            patchInstruction(absent, {
              op: "b.cond",
              condition: "ls",
              displacement: (instructions.length - absent) * 4,
            });
            absentNumber(11);
            emit({ op: "fmov-d-x", rd: readFpHome, rn: 11 });
            patchInstruction(done, {
              op: "b",
              displacement: (instructions.length - done) * 4,
            });
          }
          if (tracker !== undefined)
            tracker.saved(op.id, instructions.length * 4);
          break;
        }
        const absent = instructions.length;
        emit({ op: "b.cond", condition: "ls", displacement: 0 });
        emit({
          op: "ldr-d",
          rt: 0,
          rn: 10,
          offset: constReadIdx * 8,
        });
        quietNumber(0, 0);
        emit({ op: "fmov-x-d", rd: 11, rn: 0 });
        const done = instructions.length;
        emit({ op: "b", displacement: 0 });
        patchInstruction(absent, {
          op: "b.cond",
          condition: "ls",
          displacement: (instructions.length - absent) * 4,
        });
        absentNumber(11);
        patchInstruction(done, {
          op: "b",
          displacement: (instructions.length - done) * 4,
        });
        saveRaw(11, op.id);
        break;
      }
      const readIndex = arrayIndex(op.array, op.index);
      if (
        fusedFallbacks.get(op.id) === undefined &&
        fusedReads[valueIds.intern(op.id)] === 0
      ) {
        const fpHome = homeOf(op.id);
        if (fpHome > 0 && fpHome < 32) {
          // Load in-bounds elements directly into the FP home and
          // keep absent NaN materialization off the hot path.
          const absent = instructions.length;
          emit({ op: "cbz", width: 32, rt: 13, displacement: 0 });
          if (loadElement(readType, 10, readIndex, 11, fpHome)) {
            if (readType === "Float64Array") quietNumber(fpHome, fpHome);
          } else elementToDouble(readType, fpHome, 11);
          if (canDeferColdStub()) {
            const resumeAt = instructions.length;
            clearWordCaches();
            deferredAllocSlowPaths.push(() => {
              clearWordCaches();
              patchInstruction(absent, {
                op: "cbz",
                width: 32,
                rt: 13,
                displacement: (instructions.length - absent) * 4,
              });
              absentNumber(11);
              emit({ op: "fmov-d-x", rd: fpHome, rn: 11 });
              emit({
                op: "b",
                displacement: (resumeAt - instructions.length) * 4,
              });
            });
          } else {
            const done = instructions.length;
            emit({ op: "b", displacement: 0 });
            patchInstruction(absent, {
              op: "cbz",
              width: 32,
              rt: 13,
              displacement: (instructions.length - absent) * 4,
            });
            absentNumber(11);
            emit({ op: "fmov-d-x", rd: fpHome, rn: 11 });
            patchInstruction(done, {
              op: "b",
              displacement: (instructions.length - done) * 4,
            });
          }
          if (tracker !== undefined)
            tracker.saved(op.id, instructions.length * 4);
          break;
        }
        // The boxed result starts as `undefined`; only an
        // in-range element replaces it, as a quiet number: words
        // convert exactly, Float32 widening always gives a quiet
        // NaN, and doubles are quieted, as their raw bits could
        // be the reserved `undefined` NaN.
        absentNumber(11);
        const absent = instructions.length;
        emit({ op: "cbz", width: 32, rt: 13, displacement: 0 });
        if (loadElement(readType, 10, readIndex, 11, 0)) {
          if (readType === "Float64Array") quietNumber(0, 0);
        } else elementToDouble(readType, 0, 11);
        emit({ op: "fmov-x-d", rd: 11, rn: 0 });
        patchInstruction(absent, {
          op: "cbz",
          width: 32,
          rt: 13,
          displacement: (instructions.length - absent) * 4,
        });
        saveRaw(11, op.id);
        break;
      }
      // The element (zero when absent) as an exact int64 or, for
      // floating-point kinds, its double's bits.
      imm(11, 0);
      const skipRead = instructions.length;
      emit({ op: "cbz", width: 32, rt: 13, displacement: 0 });
      if (readType === "Float64Array")
        emit({
          op: "ldr-indexed",
          size: 3,
          fp: false,
          rt: 11,
          rn: 10,
          rm: readIndex,
          scaled: true,
        });
      else if (loadElement(readType, 10, readIndex, 11, 0))
        emit({ op: "fmov-x-d", rd: 11, rn: 0 });
      patchInstruction(skipRead, {
        op: "cbz",
        width: 32,
        rt: 13,
        displacement: (instructions.length - skipRead) * 4,
      });
      const constantFallback = fusedFallbacks.get(op.id);
      if (constantFallback !== undefined) {
        // `?? constant`: the read's own home receives the final
        // number, the converted element or the constant's bits.
        const absent = instructions.length;
        emit({ op: "cbz", width: 32, rt: 13, displacement: 0 });
        if (typedArrayIntegerElements(typedArrayType(readType))) {
          elementToDouble(readType, 0, 11);
          emit({ op: "fmov-x-d", rd: 11, rn: 0 });
        }
        const done = instructions.length;
        emit({ op: "b", displacement: 0 });
        patchInstruction(absent, {
          op: "cbz",
          width: 32,
          rt: 13,
          displacement: (instructions.length - absent) * 4,
        });
        const bits = encodeFloat64(constantFallback);
        imm64(11, bits.lo, bits.hi);
        patchInstruction(done, {
          op: "b",
          displacement: (instructions.length - done) * 4,
        });
        saveRaw(11, op.id);
        break;
      }
      // `?? 0`: keep the element word (zero when absent) in the
      // read's own home; the fused default converts it there, as
      // the result's home may not be free before that point.
      saveRaw(11, op.id);
      break;
    }
    case "array-element":
    case "array-store": {
      // The index is a proven integer within the fixed length:
      // address the element directly, without checks.
      const type = value(op.array).type,
        array = typedArrayType(type),
        element = typedArrayLayout(array).element,
        scale = typedArrayScale(type);
      const storeVal =
        op.kind === "array-store"
          ? (elidedStoreSource.get(op.value) ?? op.value)
          : 0;
      if (op.kind === "array-store") materializeInteger(storeVal);
      // Word elements convert first (possibly through a helper,
      // which clobbers scratch registers) and are staged; int64
      // or low-32 word values store their low bits (ToInt8/16/32
      // and ToUint8/16/32 of an exact integer) straight from a
      // register, as doubles do.
      const directWord =
        op.kind === "array-store" &&
        element !== "float" &&
        element !== "clamped" &&
        (storedAsInteger(storeVal) || storedAsWord(storeVal));
      // A clamped byte is computed inline (no helper), so it stays
      // in x9, which the index and data pointer loads leave alone.
      if (op.kind === "array-store" && element === "clamped")
        clampedValue(storeVal);
      else if (
        op.kind === "array-store" &&
        element !== "float" &&
        !directWord
      ) {
        wordValue(storeVal);
        rawStore(9, resultOffset + 24);
      }
      const fact = valueIds.intern(op.index);
      let constIdx: number | undefined = undefined;
      if (element === "float" && scale === 3) {
        const c = numberConstant(op.index);
        if (
          c !== undefined &&
          Number.isInteger(c) &&
          c >= 0 &&
          c <= 4095 &&
          !(c === 0 && 1 / c < 0)
        )
          constIdx = c;
        else if (wordKinds[fact] === 3 && (wordConstants[fact] ?? 0) <= 4095)
          constIdx = wordConstants[fact] ?? 0;
      }
      let index = 12;
      if (constIdx === undefined) {
        if (storedAsInteger(op.index)) index = intRegister(op.index, 12);
        else if (wordKinds[fact] === 3) imm(12, wordConstants[fact] ?? 0);
        else {
          floatLoad(0, op.index);
          emit({ op: "fcvtzs-x-d", rd: 12, rn: 0 });
        }
      }
      const hoistedBase = hoistedArrayDataValues.get(op.array);
      let dataReg = 10;
      if (hoistedBase !== undefined) {
        dataReg = hoistedBase;
      } else if (ctx.getCachedArrayDataVal() === op.array) {
        dataReg = 15;
      } else {
        const arrReg = rawRegister(op.array, 10);
        if (arrReg >= 19) {
          dataReg = 15;
          const cachedArrayDataReg = ctx.getCachedArrayDataReg();
          if (cachedArrayDataReg !== arrReg) {
            emit({
              op: "ldr",
              width: 64,
              rt: 15,
              rn: arrReg,
              offset: nativeArrayDataOffset,
            });
            ctx.setCachedArrayData(arrReg, -1);
          }
        } else {
          emit({
            op: "ldr",
            width: 64,
            rt: 10,
            rn: arrReg,
            offset: nativeArrayDataOffset,
          });
        }
      }
      if (op.kind === "array-store" && element === "float") {
        if (
          scale === 3 &&
          constIdx !== undefined &&
          constIdx * 8 <= 504 &&
          (dataReg === 15 || hoistedBase !== undefined)
        ) {
          let nextStoreIdx = operationIndex + 1;
          while (nextStoreIdx < b.instructions.length) {
            const cand = b.instructions[nextStoreIdx];
            if (
              cand !== undefined &&
              cand.kind === "constant" &&
              foldedConstants[valueIds.intern(cand.id)] === 1
            ) {
              nextStoreIdx++;
              continue;
            }
            break;
          }
          const nextStore = b.instructions[nextStoreIdx];
          if (
            nextStore !== undefined &&
            nextStore.kind === "array-store" &&
            nextStore.array === op.array &&
            numberConstant(nextStore.index) === constIdx + 1
          ) {
            const storeVal2 =
              elidedStoreSource.get(nextStore.value) ?? nextStore.value;
            let v1 = 0;
            if (storedAsInteger(storeVal)) floatLoad(0, storeVal);
            else v1 = floatOperand(storeVal, 0);
            let v2 = 1;
            if (storedAsInteger(storeVal2)) floatLoad(1, storeVal2);
            else v2 = floatOperand(storeVal2, 1);
            emit({
              op: "stp-d",
              rt: v1,
              rt2: v2,
              rn: dataReg,
              offset: constIdx * 8,
            });
            operationIndex = nextStoreIdx;
            break;
          }
        }
        let value = 0;
        if (storedAsInteger(storeVal)) floatLoad(0, storeVal);
        else value = floatOperand(storeVal, 0);
        if (scale === 1) {
          // ECMAScript's Float16 conversion rounds to nearest,
          // ties to even, as FCVT does.
          emit({ op: "fcvt-h-d", rd: 0, rn: value });
          value = 0;
        } else if (scale === 2) {
          // ECMAScript's Float32 conversion rounds to nearest,
          // ties to even, as FCVT does.
          emit({ op: "fcvt-s-d", rd: 0, rn: value });
          value = 0;
        }
        if (constIdx !== undefined)
          emit({
            op: "str-d",
            rt: value,
            rn: dataReg,
            offset: constIdx * 8,
          });
        else
          emit({
            op: "str-indexed",
            size: scale,
            fp: true,
            rt: value,
            rn: dataReg,
            rm: index,
            scaled: true,
          });
        break;
      }
      if (op.kind === "array-store") {
        let word = 11;
        if (directWord)
          word = storedAsInteger(storeVal)
            ? intRegister(storeVal, 11)
            : rawRegister(storeVal, 11);
        else if (element === "clamped") word = 9;
        else rawLoad(11, resultOffset + 24);
        emit({
          op: "str-indexed",
          size: scale,
          fp: false,
          rt: word,
          rn: dataReg,
          rm: index,
          scaled: scale !== 0,
        });
        break;
      }
      if (element === "float") {
        // Straight into the result's FP home when it has one.
        const target = floatTarget(op.id, 0);
        if (constIdx !== undefined)
          emit({
            op: "ldr-d",
            rt: target,
            rn: dataReg,
            offset: constIdx * 8,
          });
        else loadElement(type, dataReg, index, 11, target);
        floatStore(target, op.id);
        break;
      }
      if (wantsInteger(op.id)) {
        // Integer elements load as an exact int64.
        const target = intTarget(op.id, 11);
        loadElement(type, dataReg, index, target, 0);
        saveRaw(target, op.id);
        markInteger(op.id);
        break;
      }
      loadElement(type, dataReg, index, 11, 0);
      const target = floatTarget(op.id, 0);
      elementToDouble(type, target, 11);
      floatStore(target, op.id);
      break;
    }
    case "array-copy": {
      rawValue(0, op.array);
      rawValue(1, op.source);
      floatLoad(0, op.offset);
      const type = value(op.array).type;
      imm(5, typedArrayScale(type));
      callHelper("array-copy");
      saveRaw(0, op.id);
      break;
    }
    case "array-fill": {
      // The element's bits once, replicated to a 64-bit pattern
      // the fill helper stores over [from, to).
      const type = value(op.array).type,
        element = typedArrayLayout(typedArrayType(type)).element,
        scale = typedArrayScale(type);
      if (type === "Float64Array") {
        if (storedAsInteger(op.value)) {
          floatLoad(0, op.value);
          emit({ op: "fmov-x-d", rd: 9, rn: 0 });
        } else rawValue(9, op.value);
      } else if (element === "float") {
        floatLoad(0, op.value);
        if (scale === 1) emit({ op: "fcvt-h-d", rd: 0, rn: 0 });
        else emit({ op: "fcvt-s-d", rd: 0, rn: 0 });
        emit({ op: "fmov-w-s", rd: 9, rn: 0 });
      } else if (element === "clamped") clampedValue(op.value);
      else wordValue(op.value);
      if (scale < 3) {
        emit({
          op: "ubfm",
          width: 64,
          rd: 9,
          rn: 9,
          immr: 0,
          imms: (8 << scale) - 1,
        });
        const repeat = scale === 0 ? 0x01010101 : scale === 1 ? 0x00010001 : 1;
        imm64(10, repeat, repeat);
        emit({
          op: "madd",
          width: 64,
          rd: 9,
          rn: 9,
          rm: 10,
          ra: "zr",
        });
      }
      rawStore(9, resultOffset + 24);
      intOperand(op.from, 10);
      intOperand(op.to, 11);
      emit({
        op: "sub-reg",
        width: 64,
        rd: 1,
        rn: 11,
        rm: 10,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
      const empty = instructions.length;
      emit({ op: "b.cond", condition: "le", displacement: 0 });
      rawValue(12, op.array);
      emit({
        op: "ldr",
        width: 64,
        rt: 12,
        rn: 12,
        offset: nativeArrayDataOffset,
      });
      emit({
        op: "add-reg",
        width: 64,
        rd: 0,
        rn: 12,
        rm: 10,
        shift: "lsl",
        amount: scale,
        setFlags: false,
      });
      if (scale !== 0)
        emit({
          op: "add-reg",
          width: 64,
          rd: 1,
          rn: "zr",
          rm: 1,
          shift: "lsl",
          amount: scale,
          setFlags: false,
        });
      rawLoad(2, resultOffset + 24);
      callHelper("array-fill");
      patchInstruction(empty, {
        op: "b.cond",
        condition: "le",
        displacement: (instructions.length - empty) * 4,
      });
      break;
    }
    case "array-write": {
      const type = value(op.array).type,
        element = typedArrayLayout(typedArrayType(type)).element,
        scale = typedArrayScale(type);
      // Stage the element's bits: a double's, a Float32's, a
      // clamped byte or a word's low bits.
      if (type === "Float64Array") {
        if (storedAsInteger(op.value)) {
          floatLoad(0, op.value);
          emit({ op: "fmov-x-d", rd: 9, rn: 0 });
        } else rawValue(9, op.value);
      } else if (element === "float") {
        floatLoad(0, op.value);
        if (scale === 1) emit({ op: "fcvt-h-d", rd: 0, rn: 0 });
        else emit({ op: "fcvt-s-d", rd: 0, rn: 0 });
        emit({ op: "fmov-w-s", rd: 9, rn: 0 });
      } else if (element === "clamped") clampedValue(op.value);
      else wordValue(op.value);
      rawStore(9, resultOffset + 24);
      const storeIndex = arrayIndex(op.array, op.index);
      const invalid = instructions.length;
      emit({ op: "cbz", width: 32, rt: 13, displacement: 0 });
      rawLoad(11, resultOffset + 24);
      emit({
        op: "str-indexed",
        size: scale,
        fp: false,
        rt: 11,
        rn: 10,
        rm: storeIndex,
        scaled: scale !== 0,
      });
      patchInstruction(invalid, {
        op: "cbz",
        width: 32,
        rt: 13,
        displacement: (instructions.length - invalid) * 4,
      });
      break;
    }
    default:
      throw "array op invariant";
  }
  return operationIndex;
}
