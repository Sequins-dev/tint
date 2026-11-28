import { nativeArrayDataOffset } from "@tint/abi/host";
import { encodeFloat64 } from "@tint/foundation/binary/bytes";
import type { WordBuffer } from "@tint/foundation/binary/word-buffer";
import type { NumberIndex } from "@tint/foundation/collections/key-index";
import {
  scalarByteLength,
  type Block as IRBlock,
  type FunctionIR,
  type Instruction as IRInstruction,
  type ModuleIR,
  type ScalarType,
} from "@tint/ir/scalar";
import { float64Immediate, type Branch, type Instruction } from "../isa.ts";
import type { FusedPropertyAccess } from "../../scalar/property-fusion.ts";
import type { DebugTracker } from "./debug-variables.ts";
import { emitPolymorphicPropertyStore } from "./general-elements.ts";

export interface ObjectOpsValue {
  readonly offset: number;
  readonly type: ScalarType;
}

export interface ObjectOpsEmitContext {
  readonly module: ModuleIR;
  readonly fn: FunctionIR;
  readonly instructions: WordBuffer;
  readonly valueIds: NumberIndex;
  readonly stackWords: Map<number, number>;
  readonly coldStubs: (() => void)[];
  readonly deferredIntegers: Map<number, number>;
  readonly hoistedFloatConst: Map<number, number>;
  readonly offsets: (number | undefined)[];
  readonly forwardable: Set<number>;
  readonly scalarRegisters: Uint8Array | undefined;
  readonly tracker: DebugTracker | undefined;
  readonly contextOffset: number;
  readonly floatSaveBytes: number;
  readonly generationalBarriers: boolean;
  readonly jsConvert: boolean;
  readonly emittedDirectStore: Uint8Array;
  readonly foldedConstants: Uint8Array;
  readonly integerSlots: Uint8Array;
  readonly knownObjectTag: ReadonlySet<number> | undefined;
  readonly generalEqualTags: ReadonlyMap<number, number> | undefined;
  readonly skippedCasts: Uint8Array;
  readonly undefinedValues: Uint8Array;
  readonly valueUses: Uint32Array;
  readonly zeroRefValues: Uint8Array;
  readonly zeroValues: Uint8Array;
  readonly deferRememberSlow: () =>
    ((emitSlow: () => void) => void) | undefined;
  readonly value: (id: number) => ObjectOpsValue;
  readonly absentNumber: (rd: number) => void;
  readonly allocate: (
    prepare: () => void,
    size: (rd: number) => void,
    preserveFloats?: boolean,
    constSize?: number,
  ) => void;
  readonly branch: (
    branch: Branch,
    targetFunction: number,
    targetBlock: number | undefined,
  ) => void;
  readonly coldStubsAvailable: () => boolean;
  readonly descriptorPointer: (record: number) => void;
  readonly emit: (i: Instruction) => void;
  readonly exactInteger: (id: number) => boolean;
  readonly farBranch: (index: number, instruction: Instruction) => void;
  readonly floatLoad: (rt: number, id: number, byteOffset?: number) => void;
  readonly floatOperand: (id: number, scratch: number) => number;
  readonly generalPair: (
    register: number,
    offset: number,
    load: boolean,
  ) => void;
  readonly homeOf: (id: number) => number;
  readonly imm: (rd: number, value: number) => void;
  readonly imm64: (rd: number, lo: number, hi: number) => void;
  readonly intRegister: (id: number, scratch: number) => number;
  readonly markInteger: (id: number) => void;
  readonly numberConstant: (id: number) => number | undefined;
  readonly patchInstruction: (index: number, instruction: Instruction) => void;
  readonly rawLoad: (rt: number, offset: number) => void;
  readonly rawRegister: (id: number, scratch: number) => number;
  readonly rawStore: (rt: number | "zr", offset: number) => void;
  readonly rawTarget: (id: number, scratch: number) => number;
  readonly rawValue: (rt: number, id: number) => void;
  readonly rememberObject: (
    defer?: (emitSlow: () => void) => void,
    objReg?: number,
    loadContext?: () => void,
    unneeded?: () => readonly number[],
  ) => void;
  readonly saveRaw: (rt: number, id: number) => void;
  readonly slotOffset: (slot: number) => number;
  readonly storedAsInteger: (id: number) => boolean;
  readonly trapIf: (branch: Branch) => void;
  readonly wantsInteger: (id: number) => boolean;
}

export function emitRecordNew(
  ctx: ObjectOpsEmitContext,
  instruction: IRInstruction,
  b: IRBlock,
  operationIndex: number,
  currentBatchKind: number,
): void {
  const op = instruction;
  const {
    module,
    fn,
    instructions,
    valueIds,
    stackWords,
    deferredIntegers,
    hoistedFloatConst,
    scalarRegisters,
    tracker,
    contextOffset,
    floatSaveBytes,
    generationalBarriers,
    emittedDirectStore,
    foldedConstants,
    integerSlots,
    skippedCasts,
    undefinedValues,
    valueUses,
    zeroRefValues,
    zeroValues,
    deferRememberSlow,
    value,
    absentNumber,
    allocate,
    descriptorPointer,
    emit,
    exactInteger,
    floatLoad,
    floatOperand,
    generalPair,
    homeOf,
    imm,
    imm64,
    intRegister,
    markInteger,
    numberConstant,
    patchInstruction,
    rawLoad,
    rawRegister,
    rawStore,
    rawTarget,
    rawValue,
    rememberObject,
    saveRaw,
    slotOffset,
    storedAsInteger,
    trapIf,
    wantsInteger,
  } = ctx;
  switch (op.kind) {
    case "record-new": {
      const layout = module.records?.[op.record];
      if (layout === undefined) throw "record constructor invariant";
      const recordBatchKind = currentBatchKind;
      allocate(
        () => {},
        (rd) => imm(rd, layout.byteLength),
        floatSaveBytes !== 0,
        layout.byteLength,
      );
      descriptorPointer(op.record);
      emit({ op: "str", width: 64, rt: 11, rn: 9, offset: 0 });
      /** x9 + offset in x12 when STR cannot reach it. */
      function fieldBase(offset: number): number {
        if (offset <= 32760) return 9;
        imm(12, offset);
        emit({
          op: "add-reg",
          width: 64,
          rd: 12,
          rn: 9,
          rm: 12,
          shift: "lsl",
          amount: 0,
          setFlags: false,
        });
        return 12;
      }
      // Zero words are stored last, adjacent pairs with one STP.
      const zeroWords: number[] = [];
      for (let i = 0; i < layout.fields.length; i++) {
        const field = layout.fields[i],
          arg = op.arguments[i];
        if (field === undefined) throw "record field invariant";
        const argIndex = arg === undefined ? -1 : valueIds.intern(arg);
        for (let word = 0; word < scalarByteLength(field.type); word += 8) {
          const offset = field.offset + word;
          // A missing optional number is `undefined`, not +0.
          if (
            (arg === undefined && field.type !== "optional-number") ||
            (argIndex >= 0 && zeroValues[argIndex] === 1)
          ) {
            zeroWords.push(offset);
            continue;
          }
          const nextNumField =
              word === 0 &&
              field.type === "number" &&
              arg !== undefined &&
              field.stateOffset === undefined &&
              field.presenceOffset === undefined &&
              offset <= 504 &&
              offset % 8 === 0
                ? layout.fields[i + 1]
                : undefined,
            nextNumArg =
              nextNumField !== undefined ? op.arguments[i + 1] : undefined;
          if (
            arg !== undefined &&
            nextNumField !== undefined &&
            nextNumField.type === "number" &&
            nextNumField.offset === offset + 8 &&
            nextNumField.stateOffset === undefined &&
            nextNumField.presenceOffset === undefined &&
            nextNumArg !== undefined
          ) {
            const loadFieldFloat = (valId: number, scratch: number): number => {
              const c = numberConstant(valId);
              if (c !== undefined) {
                const bits = encodeFloat64(c);
                if (bits.lo === 0 && bits.hi === 0) {
                  emit({ op: "fmov-d-x", rd: scratch, rn: "zr" });
                  return scratch;
                }
                const immediate = float64Immediate(c);
                if (immediate !== undefined) {
                  emit({
                    op: "fmov-d-imm",
                    rd: scratch,
                    imm8: immediate,
                  });
                  return scratch;
                }
              }
              return floatOperand(valId, scratch);
            };
            const rt = loadFieldFloat(arg, 0),
              rt2 = loadFieldFloat(nextNumArg, 1);
            emit({ op: "stp-d", rt, rt2, rn: 9, offset });
            i++;
            continue;
          }
          if (arg !== undefined && field.type === "number" && offset <= 32760) {
            const constant = numberConstant(arg);
            if (constant !== undefined) {
              const bits = encodeFloat64(constant);
              if (bits.lo === 0 && bits.hi === 0) {
                zeroWords.push(offset);
                continue;
              }
              const immediate = float64Immediate(constant);
              if (immediate !== undefined) {
                emit({ op: "fmov-d-imm", rd: 0, imm8: immediate });
                emit({ op: "str-d", rt: 0, rn: 9, offset });
                continue;
              }
            }
          }
          if (
            arg !== undefined &&
            field.type === "number" &&
            storedAsInteger(arg)
          ) {
            floatLoad(0, arg);
            if (offset <= 32760) emit({ op: "str-d", rt: 0, rn: 9, offset });
            else {
              emit({ op: "fmov-x-d", rd: 10, rn: 0 });
              const base = fieldBase(offset);
              emit({
                op: "str",
                width: 64,
                rt: 10,
                rn: base,
                offset: base === 9 ? offset : 0,
              });
            }
            continue;
          }
          // A word already in a register home is stored from it
          // (an FP home without a bank transfer).
          if (
            arg !== undefined &&
            word === 0 &&
            zeroRefValues[valueIds.intern(arg)] === 1
          ) {
            zeroWords.push(offset);
            continue;
          }
          const home =
            arg === undefined
              ? 0
              : (scalarRegisters?.[(value(arg).offset + word) / 8] ?? 0);
          if (home !== 0 && offset <= 32760) {
            if (home < 32) emit({ op: "str-d", rt: home, rn: 9, offset });
            else
              emit({
                op: "str",
                width: 64,
                rt: home - 32,
                rn: 9,
                offset,
              });
            continue;
          }
          let srcReg = 10;
          if (
            arg === undefined ||
            (argIndex >= 0 && undefinedValues[argIndex] === 1)
          )
            absentNumber(10);
          else {
            const srcOff = value(arg).offset + word,
              cached = stackWords.get(srcOff);
            if (cached !== undefined && cached !== 9 && cached !== 12)
              srcReg = cached;
            else rawLoad(10, srcOff);
          }
          const nextField =
              word === 0 &&
              scalarByteLength(field.type) === 8 &&
              field.presenceOffset === undefined &&
              offset <= 504 &&
              offset % 8 === 0
                ? layout.fields[i + 1]
                : undefined,
            nextArg = nextField !== undefined ? op.arguments[i + 1] : undefined;
          if (
            nextField !== undefined &&
            nextField.offset === offset + 8 &&
            scalarByteLength(nextField.type) === 8 &&
            nextField.presenceOffset === undefined &&
            nextArg !== undefined &&
            zeroRefValues[valueIds.intern(nextArg)] === 1
          ) {
            emit({
              op: "stp",
              width: 64,
              rt: srcReg,
              rt2: "zr",
              rn: 9,
              offset,
              mode: "offset",
            });
            i++;
            continue;
          }
          const base = fieldBase(offset);
          emit({
            op: "str",
            width: 64,
            rt: srcReg,
            rn: base,
            offset: base === 9 ? offset : 0,
          });
        }
        const stateOffset = field.stateOffset ?? field.presenceOffset;
        if (stateOffset !== undefined) {
          const presence = op.presence?.[i];
          if (presence === undefined) imm(10, arg === undefined ? 0 : 1);
          else rawValue(10, presence);
          imm(12, stateOffset);
          emit({
            op: "add-reg",
            width: 64,
            rd: 12,
            rn: 9,
            rm: 12,
            shift: "lsl",
            amount: 0,
            setFlags: false,
          });
          emit({ op: "strb", rt: 10, rn: 12, offset: 0 });
        }
      }
      zeroWords.sort((a: number, b: number): number => a - b);
      // Pairs beyond STP's reach from x9 address from x12 = x9 +
      // pairBase (-1 until materialized).
      let pairBase = -1;
      for (let index = 0; index < zeroWords.length; index++) {
        const offset = zeroWords[index];
        if (offset === undefined) throw "record zero invariant";
        if (zeroWords[index + 1] !== offset + 8) {
          const base = fieldBase(offset);
          emit({
            op: "str",
            width: 64,
            rt: "zr",
            rn: base,
            offset: base === 9 ? offset : 0,
          });
          // fieldBase may have replaced x12.
          if (base === 12) pairBase = -1;
          continue;
        }
        let rn = 9,
          relative = offset;
        if (offset > 504) {
          if (pairBase < 0 || offset - pairBase > 504 || offset < pairBase) {
            if (offset > 4095) {
              imm(12, offset);
              emit({
                op: "add-reg",
                width: 64,
                rd: 12,
                rn: 9,
                rm: 12,
                shift: "lsl",
                amount: 0,
                setFlags: false,
              });
            } else
              emit({
                op: "add-imm",
                width: 64,
                rd: 12,
                rn: 9,
                immediate: offset,
                shift: 0,
                setFlags: false,
              });
            pairBase = offset;
          }
          rn = 12;
          relative = offset - pairBase;
        }
        emit({
          op: "stp",
          width: 64,
          rt: "zr",
          rt2: "zr",
          rn,
          offset: relative,
          mode: "offset",
        });
        index++;
      }
      // No safepoint occurs between allocation, initialization and root publication.
      const nextAfterRecord = b.instructions[operationIndex + 1];
      if (
        tracker === undefined &&
        nextAfterRecord !== undefined &&
        (valueUses[valueIds.intern(op.id)] ?? 0) === 1
      ) {
        if (
          nextAfterRecord.kind === "store" &&
          nextAfterRecord.value === op.id &&
          scalarByteLength(fn.slots[nextAfterRecord.slot] ?? "number") === 8 &&
          integerSlots[nextAfterRecord.slot] !== 1
        ) {
          rawStore(9, slotOffset(nextAfterRecord.slot));
          emittedDirectStore[valueIds.intern(op.id)] = 1;
          break;
        }
        if (
          nextAfterRecord.kind === "reference-wrap" &&
          nextAfterRecord.value === op.id &&
          (valueUses[valueIds.intern(nextAfterRecord.id)] ?? 0) === 1
        ) {
          const afterWrap = b.instructions[operationIndex + 2];
          if (
            afterWrap !== undefined &&
            afterWrap.kind === "store" &&
            afterWrap.value === nextAfterRecord.id &&
            scalarByteLength(fn.slots[afterWrap.slot] ?? "number") === 8 &&
            integerSlots[afterWrap.slot] !== 1
          ) {
            rawStore(9, slotOffset(afterWrap.slot));
            skippedCasts[valueIds.intern(nextAfterRecord.id)] = 1;
            emittedDirectStore[valueIds.intern(nextAfterRecord.id)] = 1;
            break;
          }
        }
      }
      saveRaw(9, op.id);
      if (recordBatchKind === 2 && homeOf(op.id) === 0) {
        emit({
          op: "orr-reg",
          width: 64,
          rd: 15,
          rn: "zr",
          rm: 9,
        });
        stackWords.set(value(op.id).offset, 15);
      }
      break;
    }
    default:
      throw "record-new invariant";
  }
}

export function emitPropertyAccess(
  ctx: ObjectOpsEmitContext,
  instruction: IRInstruction,
  directGeneralTarget: Map<number, number> | undefined,
  fusion: FusedPropertyAccess | undefined,
): void {
  const op = instruction;
  const {
    module,
    fn,
    instructions,
    valueIds,
    stackWords,
    coldStubs,
    offsets,
    forwardable,
    scalarRegisters,
    contextOffset,
    generationalBarriers,
    emittedDirectStore,
    knownObjectTag,
    generalEqualTags,
    skippedCasts,
    deferRememberSlow,
    value,
    branch,
    coldStubsAvailable,
    emit,
    farBranch,
    generalPair,
    imm,
    markInteger,
    patchInstruction,
    rawLoad,
    rawRegister,
    rawStore,
    rawTarget,
    rawValue,
    rememberObject,
    saveRaw,
    trapIf,
  } = ctx;
  switch (op.kind) {
    case "property-load":
    case "property-store": {
      const fields = module.records?.[op.record]?.fields,
        siteFields = module.records?.[op.siteRecord]?.fields;
      const shapeField = fields?.[0],
        siteShape = siteFields?.[op.siteField];
      if (
        shapeField === undefined ||
        siteShape === undefined ||
        siteShape.offset > 472
      )
        throw "property cache layout invariant";
      // A fused miss leaves for the block's slow successor; an
      // unfused one produces the absent value (loads) or false.
      const fusedMiss =
        fusion !== undefined && fusion.access === op.id
          ? fusion.miss
          : undefined;
      const misses: number[] = [];
      function miss(): void {
        if (fusedMiss !== undefined)
          branch({ op: "b.cond", condition: "ne" }, fn.id, fusedMiss);
        else {
          misses.push(instructions.length);
          emit({ op: "b.cond", condition: "ne", displacement: 0 });
        }
      }
      function compare(left: number, right: number): void {
        emit({
          op: "sub-reg",
          width: 64,
          rd: "zr",
          rn: left,
          rm: right,
          shift: "lsl",
          amount: 0,
          setFlags: true,
        });
        miss();
      }
      // The receiver's tag (x9) and payload (x10), then its first
      // word (x9) against the site's entry shapes (x12; the verified
      // site layout pairs each with its word index, x13). Inherited
      // loads also accept string primitives (tag 3) via the site's
      // stringShape sentinel and cache inherited values directly in
      // the site entry (slot === 0).
      const stride = op.kind === "property-load" && op.inherited ? 32 : 16;
      const epochAt =
        op.kind === "property-load" && op.inherited
          ? siteShape.offset + op.entries * stride
          : 0;
      const useColdStubs =
        coldStubsAvailable() &&
        (fusedMiss === undefined || offsets[fusedMiss * 2] === undefined);
      const tagKnown = knownObjectTag?.has(op.id) === true;
      const stringCold =
        !tagKnown &&
        op.kind === "property-load" &&
        op.inherited &&
        useColdStubs;
      let site = 0;
      let stringBranch = -1,
        shapeReadyAt = -1;
      if (tagKnown) {
        if (op.kind === "property-load" && op.inherited && epochAt + 16 > 4088)
          throw "property cache layout invariant";
        site = rawRegister(op.site, 11);
        rawLoad(10, value(op.object).offset + 8);
        emit({
          op: "ldr",
          width: 64,
          rt: 9,
          rn: 10,
          offset: shapeField.offset,
        });
      } else {
        site = rawRegister(op.site, 11);
        generalPair(9, value(op.object).offset, true);
        if (op.kind === "property-load" && op.inherited) {
          if (epochAt + 16 > 4088) throw "property cache layout invariant";
          emit({
            op: "sub-imm",
            width: 64,
            rd: "zr",
            rn: 9,
            immediate: 5,
            shift: 0,
            setFlags: true,
          });
          if (stringCold) {
            if (fusedMiss !== undefined) forwardable.delete(fusedMiss);
            stringBranch = instructions.length;
            emit({ op: "b.cond", condition: "ne", displacement: 0 });
            emit({
              op: "ldr",
              width: 64,
              rt: 9,
              rn: 10,
              offset: shapeField.offset,
            });
            shapeReadyAt = instructions.length;
            stackWords.clear();
          } else {
            const isObj = instructions.length;
            emit({ op: "b.cond", condition: "eq", displacement: 0 });
            emit({
              op: "sub-imm",
              width: 64,
              rd: "zr",
              rn: 9,
              immediate: 3,
              shift: 0,
              setFlags: true,
            });
            miss();
            emit({
              op: "ldr",
              width: 64,
              rt: 9,
              rn: site,
              offset: epochAt + 16,
            });
            const doneShape = instructions.length;
            emit({ op: "b", displacement: 0 });
            patchInstruction(isObj, {
              op: "b.cond",
              condition: "eq",
              displacement: (instructions.length - isObj) * 4,
            });
            emit({
              op: "ldr",
              width: 64,
              rt: 9,
              rn: 10,
              offset: shapeField.offset,
            });
            patchInstruction(doneShape, {
              op: "b",
              displacement: (instructions.length - doneShape) * 4,
            });
            stackWords.clear();
          }
        } else {
          emit({
            op: "sub-imm",
            width: 64,
            rd: "zr",
            rn: 9,
            immediate: 5,
            shift: 0,
            setFlags: true,
          });
          miss();
          emit({
            op: "ldr",
            width: 64,
            rt: 9,
            rn: 10,
            offset: shapeField.offset,
          });
        }
      }
      /** x12/x13 = the shape and word index of the entry at `at`. */
      function entryPair(at: number): void {
        emit({
          op: "ldp",
          width: 64,
          rt: 12,
          rt2: 13,
          rn: site,
          offset: at,
          mode: "offset",
        });
      }
      if (op.kind === "property-load") {
        const spillFieldIndex = op.spillField,
          spillRecordIndex = op.spillRecord;
        const spillField =
          spillFieldIndex === undefined ? undefined : fields?.[spillFieldIndex];
        const spillNext =
          spillRecordIndex === undefined
            ? undefined
            : module.records?.[spillRecordIndex]?.fields[0];
        if (
          spillFieldIndex !== undefined &&
          (spillField === undefined || spillNext === undefined)
        )
          throw "property cache layout invariant";
        if (op.inherited) {
          // The receiver's shape implies its prototype; direct
          // inherited values are current while the epoch they were
          // found under (x12) is the epoch record's value (x15).
          const epochField =
            module.records?.[op.epochRecord]?.fields[op.epochField];
          if (epochField === undefined) throw "property cache layout invariant";
          if (epochAt <= 496) {
            emit({
              op: "ldp",
              width: 64,
              rt: 12,
              rt2: 15,
              rn: site,
              offset: epochAt,
              mode: "offset",
            });
          } else {
            emit({
              op: "ldr",
              width: 64,
              rt: 15,
              rn: site,
              offset: epochAt + 8,
            });
            emit({
              op: "ldr",
              width: 64,
              rt: 12,
              rn: site,
              offset: epochAt,
            });
          }
          emit({
            op: "ldr",
            width: 64,
            rt: 15,
            rn: 15,
            offset: epochField.offset,
          });
          compare(15, 12);
        }
        // Entry 0 first, falling through to the hit with the word
        // index in x13 (and the direct inherited value address in
        // x14). Further entries are tested in a cold stub after the
        // function body that branches back to the hit, so a
        // single-shape site keeps its fallthrough; without cold
        // stubs they are tested inline. The last entry's mismatch is
        // the miss.
        function valueAddressOf(at: number): void {
          emit({
            op: "add-imm",
            width: 64,
            rd: 14,
            rn: site,
            immediate: at + 16,
            shift: 0,
            setFlags: false,
          });
        }
        function compareShape(): void {
          emit({
            op: "sub-reg",
            width: 64,
            rd: "zr",
            rn: 9,
            rm: 12,
            shift: "lsl",
            amount: 0,
            setFlags: true,
          });
        }
        if (siteShape.offset + (op.entries - 1) * stride > 496)
          throw "property cache layout invariant";
        const cold = op.entries > 1 && useColdStubs;
        if (cold && fusedMiss !== undefined) forwardable.delete(fusedMiss);
        const directInheritedCold =
          op.inherited &&
          useColdStubs &&
          siteShape.offset + (op.entries - 1) * stride + 16 <= 496;
        const directOffset = directGeneralTarget?.get(op.id);
        if (directOffset !== undefined)
          emittedDirectStore[valueIds.intern(op.id)] = 1;
        const offset = directOffset ?? value(op.id).offset,
          tagHome = scalarRegisters?.[offset / 8] ?? 0,
          payloadHome = scalarRegisters?.[offset / 8 + 1] ?? 0,
          bothHomed = tagHome >= 32 && payloadHome >= 32,
          dst0 = bothHomed ? tagHome - 32 : 9,
          dst1 = bothHomed ? payloadHome - 32 : 10;
        let further = -1;
        let hitAt = -1;
        let storeResultAt = -1;
        let hitDoneAt = -1;
        const ownOrSpillBranches: number[] = [];
        const hits: number[] = [];
        let spillBranch = -1,
          spillJump = -1,
          loadValueAt = -1;
        const spillCold =
          !directInheritedCold &&
          spillField !== undefined &&
          coldStubsAvailable();
        function emitSpillWalk(): void {
          if (spillField === undefined || spillNext === undefined)
            throw "property cache layout invariant";
          emit({
            op: "ldr",
            width: 64,
            rt: 9,
            rn: 10,
            offset: spillField.offset,
          });
          emit({
            op: "ubfm",
            width: 64,
            rd: 12,
            rn: 13,
            immr: 16,
            imms: 31,
          });
          const done = instructions.length;
          emit({ op: "cbz", width: 64, rt: 12, displacement: 0 });
          const loop = instructions.length;
          emit({
            op: "ldr",
            width: 64,
            rt: 9,
            rn: 9,
            offset: spillNext.offset,
          });
          emit({
            op: "sub-imm",
            width: 64,
            rd: 12,
            rn: 12,
            immediate: 1,
            shift: 0,
            setFlags: true,
          });
          emit({
            op: "b.cond",
            condition: "ne",
            displacement: (loop - instructions.length) * 4,
          });
          patchInstruction(done, {
            op: "cbz",
            width: 64,
            rt: 12,
            displacement: (instructions.length - done) * 4,
          });
          emit({
            op: "ubfm",
            width: 64,
            rd: 13,
            rn: 13,
            immr: 0,
            imms: 15,
          });
          emit({
            op: "add-reg",
            width: 64,
            rd: 9,
            rn: 9,
            rm: 13,
            shift: "lsl",
            amount: 3,
            setFlags: false,
          });
        }
        if (directInheritedCold) {
          // Fast path for monomorphic inherited method/property loads:
          // slot === 0 (direct value in the site entry) falls straight through
          // to a direct ldp from `[site, #first+16]` with zero dependency on
          // x13 or x14; non-zero slots (own/spilled) run in a cold stub.
          entryPair(siteShape.offset);
          if (cold) {
            compareShape();
            further = instructions.length;
            emit({ op: "b.cond", condition: "ne", displacement: 0 });
          } else compare(9, 12);
          ownOrSpillBranches.push(instructions.length);
          emit({ op: "cbnz", width: 64, rt: 13, displacement: 0 });
          emit({
            op: "ldp",
            width: 64,
            rt: dst0,
            rt2: dst1,
            rn: site,
            offset: siteShape.offset + 16,
            mode: "offset",
          });
          storeResultAt = instructions.length;
          if (!bothHomed) {
            stackWords.clear();
            generalPair(9, offset, false);
          }
          hitDoneAt = instructions.length;
          stackWords.clear();
        } else {
          if (cold || op.entries === 1) {
            entryPair(siteShape.offset);
            if (cold) {
              compareShape();
              further = instructions.length;
              emit({ op: "b.cond", condition: "ne", displacement: 0 });
            } else compare(9, 12);
            if (op.inherited) valueAddressOf(siteShape.offset);
          } else
            for (let entry = 0; entry < op.entries; entry++) {
              const at = siteShape.offset + entry * stride;
              entryPair(at);
              if (entry === op.entries - 1) {
                compare(9, 12);
                if (op.inherited) valueAddressOf(at);
                break;
              }
              compareShape();
              const next = instructions.length;
              emit({ op: "b.cond", condition: "ne", displacement: 0 });
              if (op.inherited) valueAddressOf(at);
              hits.push(instructions.length);
              emit({ op: "b", displacement: 0 });
              patchInstruction(next, {
                op: "b.cond",
                condition: "ne",
                displacement: (instructions.length - next) * 4,
              });
            }
          for (const at of hits)
            patchInstruction(at, {
              op: "b",
              displacement: (instructions.length - at) * 4,
            });
          hitAt = instructions.length;
          // A join: the further entries branch here.
          if (cold) stackWords.clear();
          if (spillField !== undefined) {
            if (spillCold) {
              // Use `cmp x13, #0; b.mi` (±1 MiB) instead of `tbnz`
              // (±32 KiB) so large script functions keep cold stubs;
              // this also sets Z for the inherited `csel` below.
              emit({
                op: "sub-imm",
                width: 64,
                rd: "zr",
                rn: 13,
                immediate: 0,
                shift: 0,
                setFlags: true,
              });
              spillBranch = instructions.length;
              emit({
                op: "b.cond",
                condition: "mi",
                displacement: 0,
              });
            } else {
              const notSpill = instructions.length;
              emit({
                op: "tbz",
                rt: 13,
                bit: 63,
                displacement: 0,
              });
              emitSpillWalk();
              spillJump = instructions.length;
              emit({ op: "b", displacement: 0 });
              patchInstruction(notSpill, {
                op: "tbz",
                rt: 13,
                bit: 63,
                displacement: (instructions.length - notSpill) * 4,
              });
            }
          }
          emit({
            op: "add-reg",
            width: 64,
            rd: 9,
            rn: 10,
            rm: 13,
            shift: "lsl",
            amount: 3,
            setFlags: false,
          });
          if (op.inherited) {
            // Slot 0 carries a direct inherited value in the cache
            // entry (x14); positive slots are own receiver words (x9).
            // When `spillCold` emitted `cmp x13, #0` above, `add-reg`
            // preserved Z so `csel eq` reuses it directly.
            if (!spillCold)
              emit({
                op: "sub-imm",
                width: 64,
                rd: "zr",
                rn: 13,
                immediate: 0,
                shift: 0,
                setFlags: true,
              });
            emit({
              op: "csel",
              width: 64,
              rd: 9,
              rn: 14,
              rm: 9,
              condition: "eq",
            });
          }
          if (spillJump >= 0)
            patchInstruction(spillJump, {
              op: "b",
              displacement: (instructions.length - spillJump) * 4,
            });
          loadValueAt = instructions.length;
          if (spillField !== undefined) stackWords.clear();
          if (bothHomed)
            emit({
              op: "ldp",
              width: 64,
              rt: dst0,
              rt2: dst1,
              rn: 9,
              offset: 0,
              mode: "offset",
            });
          else {
            emit({
              op: "ldp",
              width: 64,
              rt: 9,
              rt2: 10,
              rn: 9,
              offset: 0,
              mode: "offset",
            });
            generalPair(9, offset, false);
          }
        }
        // The absent value (unfused) follows the hit's jump.
        let absentAt = -1;
        if (fusedMiss === undefined) {
          const hit = instructions.length;
          emit({ op: "b", displacement: 0 });
          absentAt = instructions.length;
          for (const site of misses)
            patchInstruction(site, {
              op: "b.cond",
              condition: "ne",
              displacement: (instructions.length - site) * 4,
            });
          // The absent value: undefined's tag with payload 1.
          emit({
            op: "orr-reg",
            width: 64,
            rd: 9,
            rn: "zr",
            rm: "zr",
          });
          imm(10, 1);
          generalPair(9, offset, false);
          patchInstruction(hit, {
            op: "b",
            displacement: (instructions.length - hit) * 4,
          });
        }
        const owner = fn.id;
        if (stringCold) {
          const siteReg = site,
            stringShapeOffset = epochAt + 16;
          coldStubs.push((): void => {
            farBranch(stringBranch, {
              op: "b.cond",
              condition: "ne",
              displacement: (instructions.length - stringBranch) * 4,
            });
            stackWords.clear();
            emit({
              op: "sub-imm",
              width: 64,
              rd: "zr",
              rn: 9,
              immediate: 3,
              shift: 0,
              setFlags: true,
            });
            if (fusedMiss !== undefined)
              branch({ op: "b.cond", condition: "ne" }, owner, fusedMiss);
            else {
              const missed = instructions.length;
              emit({
                op: "b.cond",
                condition: "ne",
                displacement: 0,
              });
              farBranch(missed, {
                op: "b.cond",
                condition: "ne",
                displacement: (absentAt - missed) * 4,
              });
            }
            emit({
              op: "ldr",
              width: 64,
              rt: 9,
              rn: siteReg,
              offset: stringShapeOffset,
            });
            const back = instructions.length;
            emit({ op: "b", displacement: 0 });
            farBranch(back, {
              op: "b",
              displacement: (shapeReadyAt - back) * 4,
            });
          });
        }
        if (cold) {
          const entries = op.entries,
            inherited = op.inherited,
            first = siteShape.offset,
            returnAt = directInheritedCold
              ? bothHomed
                ? hitDoneAt
                : storeResultAt
              : hitAt;
          coldStubs.push((): void => {
            farBranch(further, {
              op: "b.cond",
              condition: "ne",
              displacement: (instructions.length - further) * 4,
            });
            stackWords.clear();
            for (let entry = 1; entry < entries; entry++) {
              const at = first + entry * stride;
              entryPair(at);
              compareShape();
              let next = -1;
              if (entry < entries - 1) {
                next = instructions.length;
                emit({
                  op: "b.cond",
                  condition: "ne",
                  displacement: 0,
                });
              } else if (fusedMiss !== undefined)
                branch({ op: "b.cond", condition: "ne" }, owner, fusedMiss);
              else {
                const missed = instructions.length;
                emit({
                  op: "b.cond",
                  condition: "ne",
                  displacement: 0,
                });
                farBranch(missed, {
                  op: "b.cond",
                  condition: "ne",
                  displacement: (absentAt - missed) * 4,
                });
              }
              if (directInheritedCold) {
                ownOrSpillBranches.push(instructions.length);
                emit({ op: "cbnz", width: 64, rt: 13, displacement: 0 });
                emit({
                  op: "ldp",
                  width: 64,
                  rt: dst0,
                  rt2: dst1,
                  rn: site,
                  offset: at + 16,
                  mode: "offset",
                });
              } else if (inherited) valueAddressOf(at);
              const back = instructions.length;
              emit({ op: "b", displacement: 0 });
              farBranch(back, {
                op: "b",
                displacement: (returnAt - back) * 4,
              });
              if (next >= 0)
                patchInstruction(next, {
                  op: "b.cond",
                  condition: "ne",
                  displacement: (instructions.length - next) * 4,
                });
            }
          });
        }
        if (directInheritedCold) {
          const returnAt = bothHomed ? hitDoneAt : storeResultAt;
          coldStubs.push((): void => {
            const ownOrSpillAt = instructions.length;
            for (const branchIndex of ownOrSpillBranches)
              farBranch(branchIndex, {
                op: "cbnz",
                width: 64,
                rt: 13,
                displacement: (ownOrSpillAt - branchIndex) * 4,
              });
            stackWords.clear();
            if (spillField !== undefined) {
              const notSpill = instructions.length;
              emit({ op: "tbz", rt: 13, bit: 63, displacement: 0 });
              emitSpillWalk();
              const spillDone = instructions.length;
              emit({ op: "b", displacement: 0 });
              patchInstruction(notSpill, {
                op: "tbz",
                rt: 13,
                bit: 63,
                displacement: (instructions.length - notSpill) * 4,
              });
              emit({
                op: "add-reg",
                width: 64,
                rd: 9,
                rn: 10,
                rm: 13,
                shift: "lsl",
                amount: 3,
                setFlags: false,
              });
              patchInstruction(spillDone, {
                op: "b",
                displacement: (instructions.length - spillDone) * 4,
              });
            } else {
              emit({
                op: "add-reg",
                width: 64,
                rd: 9,
                rn: 10,
                rm: 13,
                shift: "lsl",
                amount: 3,
                setFlags: false,
              });
            }
            emit({
              op: "ldp",
              width: 64,
              rt: dst0,
              rt2: dst1,
              rn: 9,
              offset: 0,
              mode: "offset",
            });
            const back = instructions.length;
            emit({ op: "b", displacement: 0 });
            farBranch(back, {
              op: "b",
              displacement: (returnAt - back) * 4,
            });
          });
        } else if (spillCold)
          coldStubs.push((): void => {
            farBranch(spillBranch, {
              op: "b.cond",
              condition: "mi",
              displacement: (instructions.length - spillBranch) * 4,
            });
            stackWords.clear();
            emitSpillWalk();
            const back = instructions.length;
            emit({ op: "b", displacement: 0 });
            farBranch(back, {
              op: "b",
              displacement: (loadValueAt - back) * 4,
            });
          });
        break;
      }
      const epochField =
        module.records?.[op.epochRecord]?.fields[op.epochField];
      if (epochField === undefined) throw "property cache layout invariant";
      const owner = fn.id;
      const storeValTag = generalEqualTags?.get(op.value);
      const valueIsPrimitive =
        storeValTag === 0 ||
        storeValTag === 1 ||
        storeValTag === 2 ||
        storeValTag === 4;
      emitPolymorphicPropertyStore(
        {
          site,
          siteShapeOffset: siteShape.offset,
          shapeFieldOffset: shapeField.offset,
          epochFieldOffset: epochField.offset,
          useColdStubs,
          generationalBarriers,
          valueIsPrimitive,
          fusedMiss,
          misses,
          instructionCount: (): number => instructions.length,
          emit,
          patchInstruction,
          farBranch,
          branchNe: (targetBlock: number): void =>
            branch({ op: "b.cond", condition: "ne" }, owner, targetBlock),
          imm,
          compare,
          entryPair,
          generalPair,
          valueOffset: (id: number): number => value(id).offset,
          rawTarget,
          saveRaw,
          rememberTransitionOrValue: (
            _valueOffset: number,
            inline?: boolean,
          ): void => {
            rememberObject(
              inline === true ? undefined : deferRememberSlow(),
              10,
              (): void => rawLoad(10, contextOffset),
            );
          },
          clearStackWords: (): void => {
            stackWords.clear();
          },
          deleteForwardable: (block: number): void => {
            forwardable.delete(block);
          },
          pushColdStub: (stub: () => void): void => {
            coldStubs.push(stub);
          },
        },
        op,
      );
      break;
    }
    default:
      throw "property access invariant";
  }
}

export function emitScriptEntry(
  ctx: ObjectOpsEmitContext,
  instruction: IRInstruction,
  fusion: FusedPropertyAccess | undefined = undefined,
): void {
  const op = instruction;
  const {
    module,
    fn,
    instructions,
    stackWords,
    coldStubs,
    offsets,
    forwardable,
    contextOffset,
    generationalBarriers,
    knownObjectTag,
    deferRememberSlow,
    value,
    branch,
    coldStubsAvailable,
    descriptorPointer,
    emit,
    farBranch,
    generalPair,
    imm,
    patchInstruction,
    rawLoad,
    rawRegister,
    rawStore,
    rawTarget,
    rawValue,
    rememberObject,
    saveRaw,
    trapIf,
  } = ctx;
  switch (op.kind) {
    case "script-entry": {
      const realmFields = module.records?.[op.realmRecord]?.fields,
        agentFields = module.records?.[op.agentRecord]?.fields,
        objectFields = module.records?.[op.objectRecord]?.fields,
        entryFields = module.records?.[op.entryRecord]?.fields,
        contextFields = module.records?.[op.contextRecord]?.fields;
      const agent = realmFields?.[op.agentField],
        activeField = agentFields?.[op.activeField],
        registerCall = objectFields?.[op.registerCallField],
        invoke = entryFields?.[op.invokeField],
        context = entryFields?.[op.contextField],
        constructible = entryFields?.[op.constructibleField],
        realm = contextFields?.[op.realmField],
        scriptOrModule = contextFields?.[op.scriptOrModuleField];
      if (
        agent === undefined ||
        activeField === undefined ||
        registerCall === undefined ||
        invoke === undefined ||
        context === undefined ||
        constructible === undefined ||
        realm === undefined ||
        scriptOrModule === undefined ||
        agent.offset > 32760 ||
        activeField.offset > 32760 ||
        registerCall.offset > 32760 ||
        invoke.offset > 32760 ||
        context.offset > 32760 ||
        constructible.offset > 32760 ||
        realm.offset > 32760 ||
        scriptOrModule.offset > 496
      )
        throw "script entry layout invariant";
      const fusedMiss =
        fusion !== undefined && fusion.access === op.id
          ? fusion.miss
          : undefined;
      const useColdStubs = coldStubsAvailable();
      if (useColdStubs && fusedMiss !== undefined)
        forwardable.delete(fusedMiss);
      const owner = fn.id;
      const neMisses: number[] = [];
      const cbzMisses: {
        readonly index: number;
        readonly rt: number;
      }[] = [];
      function missNe(): void {
        if (fusedMiss !== undefined)
          branch({ op: "b.cond", condition: "ne" }, owner, fusedMiss);
        else {
          neMisses.push(instructions.length);
          emit({ op: "b.cond", condition: "ne", displacement: 0 });
        }
      }
      function missZero(rt: number): void {
        if (fusedMiss !== undefined)
          branch({ op: "cbz", width: 64, rt }, owner, fusedMiss);
        else {
          cbzMisses.push({ index: instructions.length, rt });
          emit({ op: "cbz", width: 64, rt, displacement: 0 });
        }
      }
      // x9 = callee.tag, x10 = callee.payload (tag 5 is always non-null).
      if (knownObjectTag?.has(op.id) === true) {
        rawLoad(10, value(op.callee).offset + 8);
      } else {
        generalPair(9, value(op.callee).offset, true);
        emit({
          op: "sub-imm",
          width: 64,
          rd: "zr",
          rn: 9,
          immediate: 5,
          shift: 0,
          setFlags: true,
        });
        missNe();
      }
      emit({ op: "ldr", width: 64, rt: 9, rn: 10, offset: 0 });
      descriptorPointer(op.objectRecord);
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
      missNe();
      emit({
        op: "ldr",
        width: 64,
        rt: 12,
        rn: 10,
        offset: registerCall.offset,
      });
      missZero(12);
      if (op.construct) {
        emit({
          op: "ldr",
          width: 64,
          rt: 9,
          rn: 12,
          offset: constructible.offset,
        });
        missZero(9);
      }
      if (invoke.offset === context.offset + 8 && context.offset <= 496) {
        emit({
          op: "ldp",
          width: 64,
          rt: 9,
          rt2: 11,
          rn: 12,
          offset: context.offset,
          mode: "offset",
        });
        missZero(11);
      } else {
        emit({
          op: "ldr",
          width: 64,
          rt: 11,
          rn: 12,
          offset: invoke.offset,
        });
        missZero(11);
        emit({
          op: "ldr",
          width: 64,
          rt: 9,
          rn: 12,
          offset: context.offset,
        });
      }
      const realmReg = rawRegister(op.realm, 10);
      emit({
        op: "ldr",
        width: 64,
        rt: 10,
        rn: realmReg,
        offset: agent.offset,
      });
      emit({
        op: "ldr",
        width: 64,
        rt: 10,
        rn: 10,
        offset: activeField.offset,
      });
      const active = 10;
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: 9,
        rm: active,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
      const contextCheck = instructions.length;
      emit({ op: "b.cond", condition: "ne", displacement: 0 });
      if (useColdStubs) {
        const doneAt = instructions.length;
        stackWords.clear();
        saveRaw(11, op.id);
        const realmOffset = realm.offset,
          scriptOrModuleOffset = scriptOrModule.offset;
        coldStubs.push((): void => {
          farBranch(contextCheck, {
            op: "b.cond",
            condition: "ne",
            displacement: (instructions.length - contextCheck) * 4,
          });
          stackWords.clear();
          const slowCbz = instructions.length;
          if (fusedMiss !== undefined)
            branch({ op: "cbz", width: 64, rt: active }, owner, fusedMiss);
          else
            emit({
              op: "cbz",
              width: 64,
              rt: active,
              displacement: 0,
            });
          emit({
            op: "ldr",
            width: 64,
            rt: 12,
            rn: 9,
            offset: realmOffset,
          });
          emit({
            op: "ldr",
            width: 64,
            rt: 13,
            rn: active,
            offset: realmOffset,
          });
          emit({
            op: "sub-reg",
            width: 64,
            rd: "zr",
            rn: 12,
            rm: 13,
            shift: "lsl",
            amount: 0,
            setFlags: true,
          });
          const realmNe = instructions.length;
          if (fusedMiss !== undefined)
            branch({ op: "b.cond", condition: "ne" }, owner, fusedMiss);
          else emit({ op: "b.cond", condition: "ne", displacement: 0 });
          emit({
            op: "ldp",
            width: 64,
            rt: 12,
            rt2: 13,
            rn: 9,
            offset: scriptOrModuleOffset,
            mode: "offset",
          });
          emit({
            op: "ldp",
            width: 64,
            rt: 14,
            rt2: 15,
            rn: active,
            offset: scriptOrModuleOffset,
            mode: "offset",
          });
          emit({
            op: "sub-reg",
            width: 64,
            rd: "zr",
            rn: 12,
            rm: 14,
            shift: "lsl",
            amount: 0,
            setFlags: true,
          });
          const somTagNe = instructions.length;
          if (fusedMiss !== undefined)
            branch({ op: "b.cond", condition: "ne" }, owner, fusedMiss);
          else emit({ op: "b.cond", condition: "ne", displacement: 0 });
          emit({
            op: "sub-reg",
            width: 64,
            rd: "zr",
            rn: 13,
            rm: 15,
            shift: "lsl",
            amount: 0,
            setFlags: true,
          });
          const hitSlow = instructions.length;
          emit({ op: "b.cond", condition: "eq", displacement: 0 });
          farBranch(hitSlow, {
            op: "b.cond",
            condition: "eq",
            displacement: (doneAt - hitSlow) * 4,
          });
          if (fusedMiss !== undefined) {
            branch({ op: "b" }, owner, fusedMiss);
            return;
          }
          const missAt = instructions.length;
          for (const site of neMisses)
            farBranch(site, {
              op: "b.cond",
              condition: "ne",
              displacement: (missAt - site) * 4,
            });
          for (const site of cbzMisses)
            farBranch(site.index, {
              op: "cbz",
              width: 64,
              rt: site.rt,
              displacement: (missAt - site.index) * 4,
            });
          patchInstruction(slowCbz, {
            op: "cbz",
            width: 64,
            rt: active,
            displacement: (missAt - slowCbz) * 4,
          });
          patchInstruction(realmNe, {
            op: "b.cond",
            condition: "ne",
            displacement: (missAt - realmNe) * 4,
          });
          patchInstruction(somTagNe, {
            op: "b.cond",
            condition: "ne",
            displacement: (missAt - somTagNe) * 4,
          });
          emit({
            op: "orr-reg",
            width: 64,
            rd: 11,
            rn: "zr",
            rm: "zr",
          });
          const back = instructions.length;
          emit({ op: "b", displacement: 0 });
          farBranch(back, {
            op: "b",
            displacement: (doneAt - back) * 4,
          });
        });
        break;
      }
      const hitFast = instructions.length;
      emit({ op: "b", displacement: 0 });
      // Distinct context records with the same realm and
      // scriptOrModule still match the caller's execution context.
      patchInstruction(contextCheck, {
        op: "b.cond",
        condition: "ne",
        displacement: (instructions.length - contextCheck) * 4,
      });
      missZero(active);
      emit({
        op: "ldr",
        width: 64,
        rt: 12,
        rn: 9,
        offset: realm.offset,
      });
      emit({
        op: "ldr",
        width: 64,
        rt: 13,
        rn: active,
        offset: realm.offset,
      });
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: 12,
        rm: 13,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
      missNe();
      emit({
        op: "ldp",
        width: 64,
        rt: 12,
        rt2: 13,
        rn: 9,
        offset: scriptOrModule.offset,
        mode: "offset",
      });
      emit({
        op: "ldp",
        width: 64,
        rt: 14,
        rt2: 15,
        rn: active,
        offset: scriptOrModule.offset,
        mode: "offset",
      });
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: 12,
        rm: 14,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
      missNe();
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: 13,
        rm: 15,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
      const hitSlow = instructions.length;
      emit({ op: "b.cond", condition: "eq", displacement: 0 });
      if (fusedMiss !== undefined) {
        branch({ op: "b" }, owner, fusedMiss);
      } else {
        const missAt = instructions.length;
        for (const site of neMisses)
          patchInstruction(site, {
            op: "b.cond",
            condition: "ne",
            displacement: (missAt - site) * 4,
          });
        for (const site of cbzMisses)
          patchInstruction(site.index, {
            op: "cbz",
            width: 64,
            rt: site.rt,
            displacement: (missAt - site.index) * 4,
          });
        emit({
          op: "orr-reg",
          width: 64,
          rd: 11,
          rn: "zr",
          rm: "zr",
        });
      }
      const doneAt = instructions.length;
      patchInstruction(hitFast, {
        op: "b",
        displacement: (doneAt - hitFast) * 4,
      });
      patchInstruction(hitSlow, {
        op: "b.cond",
        condition: "eq",
        displacement: (doneAt - hitSlow) * 4,
      });
      saveRaw(11, op.id);
      break;
    }
    default:
      throw "script-entry invariant";
  }
}

export function emitGlobalCell(
  ctx: ObjectOpsEmitContext,
  instruction: IRInstruction,
): void {
  const op = instruction;
  const {
    module,
    fn,
    instructions,
    stackWords,
    coldStubs,
    offsets,
    forwardable,
    contextOffset,
    generationalBarriers,
    deferRememberSlow,
    value,
    branch,
    coldStubsAvailable,
    descriptorPointer,
    emit,
    farBranch,
    generalPair,
    imm,
    patchInstruction,
    rawLoad,
    rawRegister,
    rawStore,
    rawTarget,
    rawValue,
    rememberObject,
    saveRaw,
    trapIf,
  } = ctx;
  switch (op.kind) {
    case "global-cell": {
      const scopeFields = module.records?.[op.scopeRecord]?.fields,
        globalFields = module.records?.[op.globalRecord]?.fields,
        globalObjectFields = module.records?.[op.globalObjectRecord]?.fields,
        cacheFields = module.records?.[op.cacheRecord]?.fields;
      const declarative = scopeFields?.[op.declarativeField],
        object = scopeFields?.[op.objectField],
        global = scopeFields?.[op.globalField],
        lexicalEpoch = globalFields?.[op.lexicalEpochField],
        globalObject = globalFields?.[op.globalObjectField],
        propertyEpoch = globalObjectFields?.[op.propertyEpochField],
        cacheGlobal = cacheFields?.[op.cacheGlobalField],
        cacheLexicalEpoch = cacheFields?.[op.cacheLexicalEpochField],
        cacheObjectEpoch = cacheFields?.[op.cacheObjectEpochField],
        cacheCell = cacheFields?.[op.cacheCellField];
      if (
        declarative === undefined ||
        object === undefined ||
        global === undefined ||
        lexicalEpoch === undefined ||
        globalObject === undefined ||
        propertyEpoch === undefined ||
        cacheGlobal === undefined ||
        cacheLexicalEpoch === undefined ||
        cacheObjectEpoch === undefined ||
        cacheCell === undefined ||
        declarative.offset > 32760 ||
        object.offset > 32760 ||
        global.offset > 32760 ||
        lexicalEpoch.offset > 32760 ||
        globalObject.offset > 32760 ||
        propertyEpoch.offset > 32760 ||
        cacheGlobal.offset > 32760 ||
        cacheLexicalEpoch.offset > 32760 ||
        cacheObjectEpoch.offset > 32760 ||
        cacheCell.offset > 32760
      )
        throw "global cell layout invariant";
      const cbnzMisses: {
        readonly index: number;
        readonly rt: number;
      }[] = [];
      const neMisses: number[] = [];
      function missNonZero(rt: number): void {
        cbnzMisses.push({ index: instructions.length, rt });
        emit({ op: "cbnz", width: 64, rt, displacement: 0 });
      }
      function missNe(): void {
        neMisses.push(instructions.length);
        emit({ op: "b.cond", condition: "ne", displacement: 0 });
      }
      const scopeReg = rawRegister(op.scope, 9);
      const cacheReg = rawRegister(op.cache, 10);
      emit({
        op: "ldr",
        width: 64,
        rt: 11,
        rn: scopeReg,
        offset: declarative.offset,
      });
      missNonZero(11);
      emit({
        op: "ldr",
        width: 64,
        rt: 11,
        rn: scopeReg,
        offset: object.offset,
      });
      missNonZero(11);
      emit({
        op: "ldr",
        width: 64,
        rt: 11,
        rn: scopeReg,
        offset: global.offset,
      });
      emit({
        op: "ldr",
        width: 64,
        rt: 12,
        rn: cacheReg,
        offset: cacheGlobal.offset,
      });
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: 11,
        rm: 12,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
      missNe();
      emit({
        op: "ldr",
        width: 64,
        rt: 12,
        rn: 11,
        offset: lexicalEpoch.offset,
      });
      emit({
        op: "ldr",
        width: 64,
        rt: 13,
        rn: cacheReg,
        offset: cacheLexicalEpoch.offset,
      });
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: 12,
        rm: 13,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
      missNe();
      emit({
        op: "ldr",
        width: 64,
        rt: 11,
        rn: 11,
        offset: globalObject.offset,
      });
      emit({
        op: "ldr",
        width: 64,
        rt: 12,
        rn: 11,
        offset: propertyEpoch.offset,
      });
      emit({
        op: "ldr",
        width: 64,
        rt: 13,
        rn: cacheReg,
        offset: cacheObjectEpoch.offset,
      });
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: 12,
        rm: 13,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
      missNe();
      const target = rawTarget(op.id, 11);
      emit({
        op: "ldr",
        width: 64,
        rt: target,
        rn: cacheReg,
        offset: cacheCell.offset,
      });
      const doneJump = instructions.length;
      emit({ op: "b", displacement: 0 });
      const missAt = instructions.length;
      for (const site of cbnzMisses)
        patchInstruction(site.index, {
          op: "cbnz",
          width: 64,
          rt: site.rt,
          displacement: (missAt - site.index) * 4,
        });
      for (const site of neMisses)
        patchInstruction(site, {
          op: "b.cond",
          condition: "ne",
          displacement: (missAt - site) * 4,
        });
      emit({
        op: "orr-reg",
        width: 64,
        rd: target,
        rn: "zr",
        rm: "zr",
      });
      patchInstruction(doneJump, {
        op: "b",
        displacement: (instructions.length - doneJump) * 4,
      });
      saveRaw(target, op.id);
      break;
    }
    default:
      throw "global-cell invariant";
  }
}

export function emitElementAccess(
  ctx: ObjectOpsEmitContext,
  instruction: IRInstruction,
  fusion: FusedPropertyAccess | undefined,
  wrappedNumberValues: Map<number, number>,
  initialFusedNumberElement: number,
): number {
  const op = instruction;
  let fusedNumberElement = initialFusedNumberElement;
  const {
    module,
    fn,
    instructions,
    valueIds,
    stackWords,
    coldStubs,
    offsets,
    forwardable,
    contextOffset,
    generationalBarriers,
    jsConvert,
    emittedDirectStore,
    knownObjectTag,
    deferRememberSlow,
    value,
    branch,
    coldStubsAvailable,
    descriptorPointer,
    emit,
    exactInteger,
    farBranch,
    floatLoad,
    floatOperand,
    generalPair,
    imm,
    intRegister,
    patchInstruction,
    rawLoad,
    rawRegister,
    rawStore,
    rawTarget,
    rawValue,
    rememberObject,
    saveRaw,
    storedAsInteger,
    trapIf,
  } = ctx;
  switch (op.kind) {
    case "element-load":
    case "element-store": {
      const elementsField = module.records?.[op.record]?.fields[op.field],
        elementFields = module.records?.[op.elementsRecord]?.fields;
      const countField = elementFields?.[op.countField],
        storageField = elementFields?.[op.storageField];
      if (
        elementsField === undefined ||
        countField === undefined ||
        storageField === undefined
      )
        throw "element access layout invariant";
      // A fused miss leaves for the block's slow successor; an
      // unfused one produces the absent value (loads) or false.
      const fusedMiss =
        fusion !== undefined && fusion.access === op.id
          ? fusion.miss
          : undefined;
      // Unfused miss branches: "ne" sites, "lt" sites, "cs" (unsigned
      // higher or same) sites, and cbz sites, patched at the miss.
      const misses: number[] = [];
      const ltMisses: number[] = [];
      const boundMisses: number[] = [];
      const cbzMisses: number[] = [];
      function missUnless(bound: boolean): void {
        const condition = bound ? "cs" : "ne";
        if (fusedMiss !== undefined)
          branch({ op: "b.cond", condition }, fn.id, fusedMiss);
        else {
          (bound ? boundMisses : misses).push(instructions.length);
          emit({ op: "b.cond", condition, displacement: 0 });
        }
      }
      function missIfNegative(): void {
        if (fusedMiss !== undefined)
          branch({ op: "b.cond", condition: "lt" }, fn.id, fusedMiss);
        else {
          ltMisses.push(instructions.length);
          emit({ op: "b.cond", condition: "lt", displacement: 0 });
        }
      }
      function patchMisses(): void {
        for (const site of misses)
          patchInstruction(site, {
            op: "b.cond",
            condition: "ne",
            displacement: (instructions.length - site) * 4,
          });
        for (const site of ltMisses)
          patchInstruction(site, {
            op: "b.cond",
            condition: "lt",
            displacement: (instructions.length - site) * 4,
          });
        for (const site of boundMisses)
          patchInstruction(site, {
            op: "b.cond",
            condition: "cs",
            displacement: (instructions.length - site) * 4,
          });
        for (const site of cbzMisses)
          patchInstruction(site, {
            op: "cbz",
            width: 64,
            rt: 10,
            displacement: (instructions.length - site) * 4,
          });
      }
      const wrappedNumber =
        op.kind === "element-store"
          ? wrappedNumberValues.get(op.value)
          : undefined;
      if (op.kind === "element-store" && wrappedNumber === undefined) {
        // Only a Number (tag 1) overwrites a binary64 element.
        rawLoad(13, value(op.value).offset);
        emit({
          op: "sub-imm",
          width: 64,
          rd: "zr",
          rn: 13,
          immediate: 1,
          shift: 0,
          setFlags: true,
        });
        missUnless(false);
      }
      const cachedStorage = op.cachedStorage,
        cachedCount = op.cachedCount;
      const cached = cachedStorage !== undefined && cachedCount !== undefined;
      if (!cached) {
        // The object's tag (x9) and payload (x10); its record's
        // descriptor; its elements (x10), or none.
        generalPair(9, value(op.object).offset, true);
        emit({
          op: "sub-imm",
          width: 64,
          rd: "zr",
          rn: 9,
          immediate: 5,
          shift: 0,
          setFlags: true,
        });
        missUnless(false);
        emit({ op: "ldr", width: 64, rt: 9, rn: 10, offset: 0 });
        descriptorPointer(op.record);
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
        missUnless(false);
        emit({
          op: "ldr",
          width: 64,
          rt: 10,
          rn: 10,
          offset: elementsField.offset,
        });
        if (fusedMiss !== undefined)
          branch({ op: "cbz", width: 64, rt: 10 }, fn.id, fusedMiss);
        else {
          cbzMisses.push(instructions.length);
          emit({ op: "cbz", width: 64, rt: 10, displacement: 0 });
        }
      }
      // The index as an unsigned integer (x12) below the count
      // (d1 or cachedCount): an exact integer compares unsigned
      // (negative ones are huge), any other number must convert back
      // exactly.
      let index = 12;
      if (exactInteger(op.index)) {
        index = intRegister(op.index, 12);
        let countInt = 11;
        if (cachedCount !== undefined && exactInteger(cachedCount)) {
          countInt = intRegister(cachedCount, 11);
        } else {
          let countReg = 1;
          if (cachedCount !== undefined)
            countReg = floatOperand(cachedCount, 1);
          else
            emit({
              op: "ldr-d",
              rt: 1,
              rn: 10,
              offset: countField.offset,
            });
          emit({ op: "fcvtzu-x-d", rd: 11, rn: countReg });
        }
        emit({
          op: "sub-reg",
          width: 64,
          rd: "zr",
          rn: index,
          rm: countInt,
          shift: "lsl",
          amount: 0,
          setFlags: true,
        });
        missUnless(true);
      } else if (jsConvert) {
        const number = floatOperand(op.index, 0);
        // FEAT_JSCVT: Z=1 iff exact int32 and not -0.0; non-negative
        // int32 zero-extends into x12 directly with no ucvtf round-trip.
        emit({ op: "fjcvtzs", rd: 12, rn: number });
        missUnless(false);
        emit({
          op: "sub-imm",
          width: 32,
          rd: "zr",
          rn: 12,
          immediate: 0,
          shift: 0,
          setFlags: true,
        });
        missIfNegative();
        if (cachedCount !== undefined && exactInteger(cachedCount)) {
          const countInt = intRegister(cachedCount, 11);
          emit({
            op: "sub-reg",
            width: 64,
            rd: "zr",
            rn: 12,
            rm: countInt,
            shift: "lsl",
            amount: 0,
            setFlags: true,
          });
          missUnless(true);
        } else {
          let countReg = 1;
          if (cachedCount !== undefined)
            countReg = floatOperand(cachedCount, 1);
          else
            emit({
              op: "ldr-d",
              rt: 1,
              rn: 10,
              offset: countField.offset,
            });
          emit({ op: "fcmp", rn: number, rm: countReg });
          missUnless(true);
        }
      } else {
        const number = floatOperand(op.index, 0);
        emit({ op: "fcvtzu-x-d", rd: 12, rn: number });
        // -0 converts to 0 and compares equal: element 0.
        emit({ op: "ucvtf-d-x", rd: 1, rn: 12 });
        emit({ op: "fcmp", rn: 1, rm: number });
        missUnless(false);
        let countReg = 1;
        if (cachedCount !== undefined) countReg = floatOperand(cachedCount, 1);
        else
          emit({
            op: "ldr-d",
            rt: 1,
            rn: 10,
            offset: countField.offset,
          });
        // Unordered (NaN) also sets C; NaN failed above anyway.
        emit({ op: "fcmp", rn: number, rm: countReg });
        missUnless(true);
      }
      // The storage's data words.
      if (cachedStorage !== undefined) {
        rawValue(10, cachedStorage);
      } else {
        emit({
          op: "ldr",
          width: 64,
          rt: 10,
          rn: 10,
          offset: storageField.offset,
        });
      }
      emit({
        op: "ldr",
        width: 64,
        rt: 10,
        rn: 10,
        offset: nativeArrayDataOffset,
      });
      if (op.kind === "element-store") {
        if (wrappedNumber !== undefined) {
          const fpVal = floatOperand(wrappedNumber, 0);
          emit({
            op: "str-indexed",
            size: 3,
            fp: true,
            rt: fpVal,
            rn: 10,
            rm: index,
            scaled: true,
          });
        } else {
          rawLoad(13, value(op.value).offset + 8);
          emit({
            op: "str-indexed",
            size: 3,
            fp: false,
            rt: 13,
            rn: 10,
            rm: index,
            scaled: true,
          });
        }
        if (fusedMiss !== undefined) break;
        const target = rawTarget(op.id, 12);
        imm(target, 1);
        const stored = instructions.length;
        emit({ op: "b", displacement: 0 });
        patchMisses();
        imm(target, 0);
        patchInstruction(stored, {
          op: "b",
          displacement: (instructions.length - stored) * 4,
        });
        saveRaw(target, op.id);
        break;
      }
      emit({
        op: "ldr-indexed",
        size: 3,
        fp: false,
        rt: 10,
        rn: 10,
        rm: index,
        scaled: true,
      });
      // A Number: tag 1 and the element's bits.
      imm(9, 1);
      const offset = value(op.id).offset;
      generalPair(9, offset, false);
      if (fusedMiss !== undefined) {
        fusedNumberElement = op.id;
        break;
      }
      const hit = instructions.length;
      emit({ op: "b", displacement: 0 });
      patchMisses();
      // The absent value: undefined's tag with payload 1.
      emit({ op: "orr-reg", width: 64, rd: 9, rn: "zr", rm: "zr" });
      imm(10, 1);
      generalPair(9, offset, false);
      patchInstruction(hit, {
        op: "b",
        displacement: (instructions.length - hit) * 4,
      });
      break;
    }
    default:
      throw "element access invariant";
  }
  return fusedNumberElement;
}
