import {
  nativeArrayDataOffset,
  nativeContextManagedBaseOffset,
  nativeGenerationalNurseryAddressOffset,
  nativeStringOneByteFlag,
  nativeArrayLengthOffset,
  nativeGcEpochWord,
  nativeHeaderFlagUnit,
  nativeHeaderFlagsShift,
  nativeNumberStringCacheEntries,
  nativeNumberStringCacheWord,
  nativeStringDataOffset,
  nativeStringIndexFieldOffset,
  nativeStringLengthOffset,
  nativeStringMinimumDataBytes,
  nativeStringParentOffset,
  nativeStringSlicedByteLength,
  nativeStringSlicedFlag,
  nativeStringSlicedMinimumLength,
  nativeStringSlicedStartOffset,
  nativeStringSplitCacheEntries,
  nativeStringSplitCacheWord,
  nativeStringTwoByteHeader,
} from "@tint/abi/host";
import type { WordBuffer } from "@tint/foundation/binary/word-buffer";
import type { NumberIndex } from "@tint/foundation/collections/key-index";
import type { Instruction as IRInstruction, ScalarType } from "@tint/ir/scalar";
import {
  branchAt,
  type BaseRegister,
  type Branch,
  type Instruction,
  type Instruction as MachineInstruction,
} from "../isa.ts";
import { nativeAllocationStateOffset } from "./abi.ts";
import type { LeafHelperKind } from "./index.ts";

export const slicedBit: number = nativeHeaderFlagsShift + 1;
export const slicedHighBit: number = slicedBit - 32;
export const oneByteHighBit: number = nativeHeaderFlagsShift - 32;

export function entryBits(entries: number): number {
  let bits = 0,
    size = 1;
  while (size < entries) {
    size *= 2;
    bits++;
  }
  if (size !== entries) throw "number cache size invariant";
  return bits;
}

export interface ColdNaNStub {
  readonly branchSite: number;
  readonly target: number;
  readonly resume: number;
  readonly word: boolean;
}

export function emitSliceFastNurseryView(
  emit: (instruction: MachineInstruction) => void,
  patchInstruction: (index: number, instruction: MachineInstruction) => void,
  rawLoad: (rt: number, offset: number) => void,
  instructions: { readonly length: number },
  contextOffset: number,
  fastViews: number[] | undefined,
): { readonly noState: number; readonly viewFull: number } {
  rawLoad(15, contextOffset);
  emit({
    op: "ldr",
    width: 64,
    rt: 15,
    rn: 15,
    offset: nativeAllocationStateOffset,
  });
  const noState = instructions.length;
  emit({ op: "cbz", width: 64, rt: 15, displacement: 0 });
  emit({
    op: "ldp",
    width: 32,
    rt: 16,
    rt2: 17,
    rn: 15,
    offset: 0,
    mode: "offset",
  });
  emit({
    op: "add-imm",
    width: 64,
    rd: 11,
    rn: 16,
    immediate: nativeStringSlicedByteLength,
    shift: 0,
    setFlags: false,
  });
  emit({
    op: "sub-reg",
    width: 64,
    rd: "zr",
    rn: 11,
    rm: 17,
    shift: "lsl",
    amount: 0,
    setFlags: true,
  });
  const viewFull = instructions.length;
  emit({ op: "b.cond", condition: "hi", displacement: 0 });
  emit({ op: "str", width: 32, rt: 11, rn: 15, offset: 0 });
  emit({
    op: "ldr",
    width: 64,
    rt: 15,
    rn: 15,
    offset: nativeGenerationalNurseryAddressOffset,
  });
  emit({
    op: "add-reg",
    width: 64,
    rd: 15,
    rn: 15,
    rm: 16,
    shift: "lsl",
    amount: 0,
    setFlags: false,
  });
  emit({
    op: "stp",
    width: 64,
    rt: 14,
    rt2: 13,
    rn: 15,
    offset: 0,
    mode: "offset",
  });
  emit({
    op: "stp",
    width: 64,
    rt: 12,
    rt2: 9,
    rn: 15,
    offset: nativeStringSlicedStartOffset,
    mode: "offset",
  });
  emit({
    op: "add-reg",
    width: 64,
    rd: 9,
    rn: "zr",
    rm: 15,
    shift: "lsl",
    amount: 0,
    setFlags: false,
  });
  if (fastViews !== undefined) {
    fastViews.push(instructions.length);
    emit({ op: "b", displacement: 0 });
    const viewSlow = instructions.length;
    patchInstruction(noState, {
      op: "cbz",
      width: 64,
      rt: 15,
      displacement: (viewSlow - noState) * 4,
    });
    patchInstruction(viewFull, {
      op: "b.cond",
      condition: "hi",
      displacement: (viewSlow - viewFull) * 4,
    });
  }
  return { noState, viewFull };
}
/** Branchless UTF-16 code unit read for in-bounds integer index `indexReg` on
 * string `x9` with header high word `w11` and length `w15`. Avoids branch
 * mispredictions on mixed one-byte/two-byte and flat/sliced strings; writes
 * the unit (0..65535) to `w11`. */
export function emitBranchlessCodeUnit(
  emit: (instruction: MachineInstruction) => void,
  patchInstruction: (index: number, instruction: MachineInstruction) => void,
  instructions: { readonly length: number },
  indexReg: number,
): void {
  emit({ op: "orr-reg", width: 64, rd: 10, rn: "zr", rm: 9 });
  emit({
    op: "sub-imm",
    width: 64,
    rd: "zr",
    rn: 15,
    immediate: nativeStringSlicedMinimumLength,
    shift: 0,
    setFlags: true,
  });
  const shortFlat = instructions.length;
  emit({ op: "b.cond", condition: "cc", displacement: 0 });
  emit({
    op: "ldp",
    width: 64,
    rt: 13,
    rt2: 14,
    rn: 9,
    offset: nativeStringSlicedStartOffset,
    mode: "offset",
  });
  emit({
    op: "add-reg",
    width: 64,
    rd: 14,
    rn: 14,
    rm: 13,
    shift: "lsl",
    amount: 0,
    setFlags: false,
  });
  emit({
    op: "ands-imm",
    width: 32,
    rd: "zr",
    rn: 11,
    n: 0,
    immr: 15,
    imms: 0,
  });
  emit({ op: "csel", width: 64, rd: 10, rn: 14, rm: 9, condition: "ne" });
  patchInstruction(shortFlat, {
    op: "b.cond",
    condition: "cc",
    displacement: (instructions.length - shortFlat) * 4,
  });
  emit({
    op: "add-imm",
    width: 64,
    rd: 10,
    rn: 10,
    immediate: nativeStringDataOffset,
    shift: 0,
    setFlags: false,
  });
  emit({
    op: "ands-imm",
    width: 32,
    rd: "zr",
    rn: 11,
    n: 0,
    immr: 16,
    imms: 0,
  });
  emit({ op: "cset", rd: 13, condition: "eq" });
  emit({ op: "lslv", width: 64, rd: 14, rn: indexReg, rm: 13 });
  emit({
    op: "add-reg",
    width: 64,
    rd: 10,
    rn: 10,
    rm: 14,
    shift: "lsl",
    amount: 0,
    setFlags: false,
  });
  emit({ op: "ldrb", rt: 11, rn: 10, offset: 0 });
  emit({
    op: "ldr-indexed",
    size: 0,
    fp: false,
    rt: 14,
    rn: 10,
    rm: 13,
    scaled: false,
  });
  emit({ op: "csel", width: 32, rd: 14, rn: 14, rm: "zr", condition: "eq" });
  emit({
    op: "add-reg",
    width: 32,
    rd: 11,
    rn: 11,
    rm: 14,
    shift: "lsl",
    amount: 8,
    setFlags: false,
  });
}
/** Inline probe for flat two-byte slices of length >= 9. Tests the last 8
 * units before the first 8 for long slices (> 40), and covers 9..40 units
 * completely with overlapping 8-unit loads before a single wide-unit test.
 * Preserves x9, x10, x12 and x13; sets x14 = 1 before branching to
 * narrowExact/narrowCall on ASCII matches. */
export function emitSliceFastTwoByteProbe(
  emit: (instruction: MachineInstruction) => void,
  patchInstruction: (index: number, instruction: MachineInstruction) => void,
  callHelper: (kind: LeafHelperKind) => void,
  instructions: { readonly length: number },
): {
  readonly narrowExact: number;
  readonly narrowCall: number;
} {
  const sliced = instructions.length;
  emit({ op: "tbnz", rt: 10, bit: slicedBit, displacement: 0 });
  emit({
    op: "add-imm",
    width: 64,
    rd: 15,
    rn: 9,
    immediate: nativeStringDataOffset,
    shift: 0,
    setFlags: false,
  });
  emit({
    op: "add-reg",
    width: 64,
    rd: 15,
    rn: 15,
    rm: 12,
    shift: "lsl",
    amount: 1,
    setFlags: false,
  });
  emit({
    op: "add-reg",
    width: 64,
    rd: 11,
    rn: 15,
    rm: 13,
    shift: "lsl",
    amount: 1,
    setFlags: false,
  });
  emit({
    op: "sub-imm",
    width: 64,
    rd: "zr",
    rn: 13,
    immediate: 40,
    shift: 0,
    setFlags: true,
  });
  const shortMid = instructions.length;
  emit({ op: "b.cond", condition: "ls", displacement: 0 });
  emit({
    op: "ldp",
    width: 64,
    rt: 14,
    rt2: 17,
    rn: 11,
    offset: -16,
    mode: "offset",
  });
  emit({ op: "orr-reg", width: 64, rd: 16, rn: 14, rm: 17 });
  emit({
    op: "ands-imm",
    width: 64,
    rd: "zr",
    rn: 16,
    n: 0,
    immr: 8,
    imms: 39,
  });
  const longWideEnd = instructions.length;
  emit({ op: "b.cond", condition: "ne", displacement: 0 });
  emit({
    op: "ldp",
    width: 64,
    rt: 14,
    rt2: 17,
    rn: 15,
    offset: 0,
    mode: "offset",
  });
  emit({ op: "orr-reg", width: 64, rd: 16, rn: 14, rm: 17 });
  emit({
    op: "ands-imm",
    width: 64,
    rd: "zr",
    rn: 16,
    n: 0,
    immr: 8,
    imms: 39,
  });
  const longWideStart = instructions.length;
  emit({ op: "b.cond", condition: "ne", displacement: 0 });
  patchInstruction(sliced, {
    op: "tbnz",
    rt: 10,
    bit: slicedBit,
    displacement: (instructions.length - sliced) * 4,
  });
  callHelper("string-slice-kind");
  const narrowCall = instructions.length;
  emit({ op: "cbnz", width: 64, rt: 14, displacement: 0 });
  const longDone = instructions.length;
  emit({ op: "b", displacement: 0 });
  patchInstruction(shortMid, {
    op: "b.cond",
    condition: "ls",
    displacement: (instructions.length - shortMid) * 4,
  });
  emit({
    op: "ldp",
    width: 64,
    rt: 16,
    rt2: 17,
    rn: 15,
    offset: 0,
    mode: "offset",
  });
  emit({ op: "orr-reg", width: 64, rd: 16, rn: 16, rm: 17 });
  emit({
    op: "ldp",
    width: 64,
    rt: 14,
    rt2: 17,
    rn: 11,
    offset: -16,
    mode: "offset",
  });
  emit({ op: "orr-reg", width: 64, rd: 14, rn: 14, rm: 17 });
  emit({ op: "orr-reg", width: 64, rd: 16, rn: 16, rm: 14 });
  emit({
    op: "sub-imm",
    width: 64,
    rd: "zr",
    rn: 13,
    immediate: 16,
    shift: 0,
    setFlags: true,
  });
  const exact16 = instructions.length;
  emit({ op: "b.cond", condition: "ls", displacement: 0 });
  emit({
    op: "ldp",
    width: 64,
    rt: 14,
    rt2: 17,
    rn: 15,
    offset: 16,
    mode: "offset",
  });
  emit({ op: "orr-reg", width: 64, rd: 14, rn: 14, rm: 17 });
  emit({ op: "orr-reg", width: 64, rd: 16, rn: 16, rm: 14 });
  emit({
    op: "ldp",
    width: 64,
    rt: 14,
    rt2: 17,
    rn: 11,
    offset: -32,
    mode: "offset",
  });
  emit({ op: "orr-reg", width: 64, rd: 14, rn: 14, rm: 17 });
  emit({ op: "orr-reg", width: 64, rd: 16, rn: 16, rm: 14 });
  emit({
    op: "sub-imm",
    width: 64,
    rd: "zr",
    rn: 13,
    immediate: 32,
    shift: 0,
    setFlags: true,
  });
  const exact32 = instructions.length;
  emit({ op: "b.cond", condition: "ls", displacement: 0 });
  emit({
    op: "ldp",
    width: 64,
    rt: 14,
    rt2: 17,
    rn: 15,
    offset: 32,
    mode: "offset",
  });
  emit({ op: "orr-reg", width: 64, rd: 14, rn: 14, rm: 17 });
  emit({ op: "orr-reg", width: 64, rd: 16, rn: 16, rm: 14 });
  const exactTest = instructions.length;
  patchInstruction(exact16, {
    op: "b.cond",
    condition: "ls",
    displacement: (exactTest - exact16) * 4,
  });
  patchInstruction(exact32, {
    op: "b.cond",
    condition: "ls",
    displacement: (exactTest - exact32) * 4,
  });
  emit({ op: "movz", width: 64, rd: 14, immediate: 1, shift: 0 });
  emit({
    op: "ands-imm",
    width: 64,
    rd: "zr",
    rn: 16,
    n: 0,
    immr: 8,
    imms: 39,
  });
  const narrowExact = instructions.length;
  emit({ op: "b.cond", condition: "eq", displacement: 0 });
  const wideDone = instructions.length;
  patchInstruction(longWideEnd, {
    op: "b.cond",
    condition: "ne",
    displacement: (wideDone - longWideEnd) * 4,
  });
  patchInstruction(longWideStart, {
    op: "b.cond",
    condition: "ne",
    displacement: (wideDone - longWideStart) * 4,
  });
  patchInstruction(longDone, {
    op: "b",
    displacement: (wideDone - longDone) * 4,
  });
  return { narrowExact, narrowCall };
}
/** Zero-spill inline nursery allocator for a narrowed one-byte slice
 * (x9 two-byte source, x12 begin, x13 count >= 9, x14 = 1). */
export function emitSliceFastNurseryNarrow(
  emit: (instruction: MachineInstruction) => void,
  patchInstruction: (index: number, instruction: MachineInstruction) => void,
  rawLoad: (rt: number, offset: number) => void,
  callHelper: (kind: LeafHelperKind) => void,
  instructions: { readonly length: number },
  contextOffset: number,
  narrow: {
    readonly narrowExact: number;
    readonly narrowCall: number;
  },
  fastViews: number[],
): void {
  const shortSlow = instructions.length;
  emit({ op: "b", displacement: 0 });
  const narrowTarget = instructions.length;
  patchInstruction(narrow.narrowExact, {
    op: "b.cond",
    condition: "eq",
    displacement: (narrowTarget - narrow.narrowExact) * 4,
  });
  patchInstruction(narrow.narrowCall, {
    op: "cbnz",
    width: 64,
    rt: 14,
    displacement: (narrowTarget - narrow.narrowCall) * 4,
  });
  emit({
    op: "add-imm",
    width: 64,
    rd: 11,
    rn: 13,
    immediate: nativeStringDataOffset + 7,
    shift: 0,
    setFlags: false,
  });
  emit({ op: "ubfm", width: 64, rd: 11, rn: 11, immr: 3, imms: 63 });
  emit({
    op: "add-reg",
    width: 64,
    rd: 11,
    rn: "zr",
    rm: 11,
    shift: "lsl",
    amount: 3,
    setFlags: false,
  });
  rawLoad(15, contextOffset);
  emit({
    op: "ldr",
    width: 64,
    rt: 15,
    rn: 15,
    offset: nativeAllocationStateOffset,
  });
  const narrowNoState = instructions.length;
  emit({ op: "cbz", width: 64, rt: 15, displacement: 0 });
  emit({
    op: "ldp",
    width: 32,
    rt: 16,
    rt2: 17,
    rn: 15,
    offset: 0,
    mode: "offset",
  });
  emit({
    op: "add-reg",
    width: 64,
    rd: 11,
    rn: 16,
    rm: 11,
    shift: "lsl",
    amount: 0,
    setFlags: false,
  });
  emit({
    op: "sub-reg",
    width: 64,
    rd: "zr",
    rn: 11,
    rm: 17,
    shift: "lsl",
    amount: 0,
    setFlags: true,
  });
  const narrowFull = instructions.length;
  emit({ op: "b.cond", condition: "hi", displacement: 0 });
  emit({ op: "str", width: 32, rt: 11, rn: 15, offset: 0 });
  emit({
    op: "ldr",
    width: 64,
    rt: 15,
    rn: 15,
    offset: nativeGenerationalNurseryAddressOffset,
  });
  emit({
    op: "add-reg",
    width: 64,
    rd: 15,
    rn: 15,
    rm: 16,
    shift: "lsl",
    amount: 0,
    setFlags: false,
  });
  emit({
    op: "add-reg",
    width: 64,
    rd: 10,
    rn: "zr",
    rm: 9,
    shift: "lsl",
    amount: 0,
    setFlags: false,
  });
  emit({
    op: "add-reg",
    width: 64,
    rd: 9,
    rn: "zr",
    rm: 15,
    shift: "lsl",
    amount: 0,
    setFlags: false,
  });
  emit({ op: "movz", width: 64, rd: 14, immediate: 1, shift: 0 });
  emit({ op: "movk", width: 64, rd: 14, immediate: 1, shift: 48 });
  emit({
    op: "stp",
    width: 64,
    rt: 14,
    rt2: 13,
    rn: 9,
    offset: 0,
    mode: "offset",
  });
  callHelper("string-slice-narrow");
  fastViews.push(instructions.length);
  emit({ op: "b", displacement: 0 });
  const narrowSlow = instructions.length;
  patchInstruction(shortSlow, {
    op: "b",
    displacement: (narrowSlow - shortSlow) * 4,
  });
  patchInstruction(narrowNoState, {
    op: "cbz",
    width: 64,
    rt: 15,
    displacement: (narrowSlow - narrowNoState) * 4,
  });
  patchInstruction(narrowFull, {
    op: "b.cond",
    condition: "hi",
    displacement: (narrowSlow - narrowFull) * 4,
  });
}
export interface ColdSliceStub {
  readonly short: number;
  readonly narrowExact: number;
  readonly narrowCall: number;
  readonly noState: number;
  readonly viewFull: number;
  readonly string: number;
  readonly block: number;
  readonly index: number;
  readonly resume: number;
}

export interface StringOpsValue {
  readonly offset: number;
  readonly type: ScalarType;
}

export interface StringOpsEmitContext {
  readonly instructions: WordBuffer;
  readonly valueIds: NumberIndex;
  readonly wordKinds: Uint8Array;
  readonly wordConstants: Uint32Array;
  readonly stackWords: Map<number, number>;
  readonly stringFixups: { offset: number; value: string }[];
  readonly coldNaNs: ColdNaNStub[];
  readonly coldSlices: ColdSliceStub[];
  readonly allowColdStubs: boolean;
  readonly linearAllocation: boolean;
  readonly generationalBarriers: boolean;
  readonly allocationOffset: number;
  readonly contextOffset: number;
  readonly start: number;
  readonly foldedOptionalWraps: Uint8Array;
  readonly lengthOnlySlices: Uint8Array;
  readonly low32Tree: Uint8Array;
  readonly nanSentinelWords: Uint8Array;
  readonly nanSentinelMagnitudes: Float64Array;
  readonly nanSentinelNonNegative: Uint8Array;
  readonly undefinedValues: Uint8Array;
  readonly wrappedNumberSources: Uint32Array;
  readonly wrappedNumbers: Uint8Array;
  readonly markUnitStrings: () => void;
  readonly value: (id: number) => StringOpsValue;
  readonly allocate: (
    prepare: () => void,
    size: (rd: number) => void,
    preserveFloats?: boolean,
    constSize?: number,
  ) => void;
  readonly callHelper: (kind: LeafHelperKind) => void;
  readonly emit: (i: Instruction) => void;
  readonly exactInteger: (id: number) => boolean;
  readonly floatLoad: (rt: number, id: number, byteOffset?: number) => void;
  readonly floatOperand: (id: number, scratch: number) => number;
  readonly floatStore: (rt: number, id: number) => void;
  readonly floatTarget: (id: number, scratch: number) => number;
  readonly imm: (rd: number, value: number) => void;
  readonly intOperand: (id: number, rt: number) => void;
  readonly intRegister: (id: number, scratch: number) => number;
  readonly intTarget: (id: number, scratch: number) => number;
  readonly latin1Count: (id: number) => void;
  readonly latin1Index: (id: number, rd: number) => void;
  readonly latin1Range: (lengthOffset: number) => void;
  readonly localPointer: (rd: number, pages?: boolean) => void;
  readonly markInteger: (id: number) => void;
  readonly narrowStore: (
    half: boolean,
    rt: number,
    rn: BaseRegister,
    offset: number,
  ) => void;
  readonly patchInstruction: (index: number, instruction: Instruction) => void;
  readonly pollWorkerStop: () => void;
  readonly prepareStringSize: (oneByte: number) => void;
  readonly rawLoad: (rt: number, offset: number) => void;
  readonly rawRegister: (id: number, scratch: number) => number;
  readonly rawStore: (rt: number | "zr", offset: number) => void;
  readonly rawTarget: (id: number, scratch: number) => number;
  readonly rawValue: (rt: number, id: number) => void;
  readonly saveRaw: (rt: number, id: number) => void;
  readonly sliceBounds: (
    string: number,
    begin: number,
    limit: number,
    limitAbsent: boolean,
    limitPresent: boolean,
    limitSource: number,
  ) => void;
  readonly storedAsInteger: (id: number) => boolean;
  readonly trapIf: (branch: Branch) => void;
  readonly wantsInteger: (id: number) => boolean;
  readonly wordValue: (id: number) => void;
}

export function emitStringCoreOp(
  ctx: StringOpsEmitContext,
  instruction: IRInstruction,
  blockId: number,
  siteIndex: number,
): void {
  const op = instruction;
  const {
    instructions,
    valueIds,
    wordKinds,
    wordConstants,
    stackWords,
    stringFixups,
    coldNaNs,
    coldSlices,
    allowColdStubs,
    linearAllocation,
    generationalBarriers,
    allocationOffset,
    contextOffset,
    start,
    foldedOptionalWraps,
    lengthOnlySlices,
    low32Tree,
    nanSentinelWords,
    nanSentinelMagnitudes,
    nanSentinelNonNegative,
    undefinedValues,
    wrappedNumberSources,
    wrappedNumbers,
    markUnitStrings,
    value,
    allocate,
    callHelper,
    emit,
    exactInteger,
    floatLoad,
    floatOperand,
    floatStore,
    floatTarget,
    imm,
    intOperand,
    intRegister,
    intTarget,
    localPointer,
    markInteger,
    narrowStore,
    patchInstruction,
    pollWorkerStop,
    prepareStringSize,
    rawLoad,
    rawRegister,
    rawStore,
    rawTarget,
    rawValue,
    saveRaw,
    sliceBounds,
    storedAsInteger,
    trapIf,
    wantsInteger,
    wordValue,
  } = ctx;
  switch (op.kind) {
    case "string-code-unit": {
      /** Loads the unit at `index` of `string` into `target`, by
       * its header's high word in w11: 0x10000 flat one-byte (data
       * at x10, the string plus the data offset), 0 flat two-byte,
       * otherwise sliced (the parent plus the data offset and the
       * start offset; one-byte with bit 16). Flat one-byte strings
       * take the first branch. Clobbers x10, x13 and flags. */
      function loadUnit(target: number, index: number, string: number): void {
        emit({
          op: "sub-imm",
          width: 32,
          rd: "zr",
          rn: 11,
          immediate: nativeHeaderFlagUnit / 4294967296 / 4096,
          shift: 12,
          setFlags: true,
        });
        const oneByte = instructions.length;
        emit({ op: "b.cond", condition: "eq", displacement: 0 });
        const flatTwoByte = instructions.length;
        emit({ op: "cbz", width: 32, rt: 11, displacement: 0 });
        emit({
          op: "ldp",
          width: 64,
          rt: 13,
          rt2: 10,
          rn: string,
          offset: nativeStringSlicedStartOffset,
          mode: "offset",
        });
        emit({
          op: "add-reg",
          width: 64,
          rd: 10,
          rn: 10,
          rm: 13,
          shift: "lsl",
          amount: 0,
          setFlags: false,
        });
        emit({
          op: "add-imm",
          width: 64,
          rd: 10,
          rn: 10,
          immediate: nativeStringDataOffset,
          shift: 0,
          setFlags: false,
        });
        const slicedTwoByte = instructions.length;
        emit({
          op: "tbz",
          rt: 11,
          bit: oneByteHighBit,
          displacement: 0,
        });
        const slicedOneByte = instructions.length;
        emit({ op: "b", displacement: 0 });
        patchInstruction(flatTwoByte, {
          op: "cbz",
          width: 32,
          rt: 11,
          displacement: (instructions.length - flatTwoByte) * 4,
        });
        patchInstruction(slicedTwoByte, {
          op: "tbz",
          rt: 11,
          bit: oneByteHighBit,
          displacement: (instructions.length - slicedTwoByte) * 4,
        });
        emit({
          op: "ldr-indexed",
          size: 1,
          fp: false,
          rt: target,
          rn: 10,
          rm: index,
          scaled: true,
        });
        const loaded = instructions.length;
        emit({ op: "b", displacement: 0 });
        patchInstruction(oneByte, {
          op: "b.cond",
          condition: "eq",
          displacement: (instructions.length - oneByte) * 4,
        });
        patchInstruction(slicedOneByte, {
          op: "b",
          displacement: (instructions.length - slicedOneByte) * 4,
        });
        emit({
          op: "ldr-indexed",
          size: 0,
          fp: false,
          rt: target,
          rn: 10,
          rm: index,
          scaled: false,
        });
        patchInstruction(loaded, {
          op: "b",
          displacement: (instructions.length - loaded) * 4,
        });
      }
      if (op.inBounds === true && op.unitKind !== undefined) {
        // A flat string of known kind (versionStringLoops): the
        // unit's load alone.
        const string = rawRegister(op.string, 9),
          index = intRegister(op.index, 12),
          halfword = op.unitKind === "two-byte";
        emit({
          op: "add-imm",
          width: 64,
          rd: 10,
          rn: string,
          immediate: nativeStringDataOffset,
          shift: 0,
          setFlags: false,
        });
        const integer = wantsInteger(op.id),
          target = integer ? intTarget(op.id, 11) : 11;
        emit({
          op: "ldr-indexed",
          size: halfword ? 1 : 0,
          fp: false,
          rt: target,
          rn: 10,
          rm: index,
          scaled: halfword,
        });
        if (integer) {
          saveRaw(target, op.id);
          markInteger(op.id);
          break;
        }
        const unit = floatTarget(op.id, 0);
        emit({ op: "ucvtf-d-w", rd: unit, rn: 11 });
        floatStore(unit, op.id);
        break;
      }
      if (op.inBounds === true) {
        // Proven a non-negative integer index below the length:
        // one byte or halfword load (an int64 for integer uses).
        const string = rawRegister(op.string, 9),
          index = intRegister(op.index, 12);
        emit({ op: "ldr", width: 32, rt: 11, rn: string, offset: 4 });
        emit({
          op: "add-imm",
          width: 64,
          rd: 10,
          rn: string,
          immediate: nativeStringDataOffset,
          shift: 0,
          setFlags: false,
        });
        if (wantsInteger(op.id)) {
          const target = intTarget(op.id, 11);
          loadUnit(target, index, string);
          saveRaw(target, op.id);
          markInteger(op.id);
          break;
        }
        loadUnit(11, index, string);
        const target = floatTarget(op.id, 0);
        emit({ op: "ucvtf-d-w", rd: target, rn: 11 });
        floatStore(target, op.id);
        break;
      }
      const indexFact = valueIds.intern(op.index);
      rawValue(9, op.string);
      if (storedAsInteger(op.index) || wordKinds[indexFact] === 3) {
        // An exact integer index reads the unit inline after an
        // unsigned length check; the helper yields NaN otherwise.
        let index = 12;
        if (storedAsInteger(op.index)) index = intRegister(op.index, 12);
        else imm(12, wordConstants[indexFact] ?? 0);
        emit({
          op: "ldp",
          width: 32,
          rt: 11,
          rt2: 15,
          rn: 9,
          offset: 4,
          mode: "offset",
        });
        emit({
          op: "sub-reg",
          width: 64,
          rd: "zr",
          rn: index,
          rm: 15,
          shift: "lsl",
          amount: 0,
          setFlags: true,
        });
        const outside = instructions.length;
        emit({ op: "b.cond", condition: "cs", displacement: 0 });
        emitBranchlessCodeUnit(emit, patchInstruction, instructions, index);
        const idIndex = valueIds.intern(op.id);
        if (low32Tree[idIndex] === 1) {
          const target = rawTarget(op.id, 11);
          if (target !== 11)
            emit({
              op: "orr-reg",
              width: 64,
              rd: target,
              rn: "zr",
              rm: 11,
            });
          if (allowColdStubs && instructions.length - start / 4 < 131072) {
            coldNaNs.push({
              branchSite: outside,
              target,
              resume: instructions.length,
              word: true,
            });
          } else {
            const done = instructions.length;
            emit({ op: "b", displacement: 0 });
            patchInstruction(outside, {
              op: "b.cond",
              condition: "cs",
              displacement: (instructions.length - outside) * 4,
            });
            emit({
              op: "movz",
              width: 64,
              rd: target,
              immediate: 0x6000,
              shift: 48,
            });
            patchInstruction(done, {
              op: "b",
              displacement: (instructions.length - done) * 4,
            });
          }
          saveRaw(target, op.id);
          nanSentinelWords[idIndex] = 1;
          nanSentinelMagnitudes[idIndex] = 65535;
          nanSentinelNonNegative[idIndex] = 1;
          break;
        }
        const target = floatTarget(op.id, 0);
        emit({ op: "ucvtf-d-w", rd: target, rn: 11 });
        if (allowColdStubs && instructions.length - start / 4 < 131072) {
          coldNaNs.push({
            branchSite: outside,
            target,
            resume: instructions.length,
            word: false,
          });
        } else {
          const done = instructions.length;
          emit({ op: "b", displacement: 0 });
          patchInstruction(outside, {
            op: "b.cond",
            condition: "cs",
            displacement: (instructions.length - outside) * 4,
          });
          emit({
            op: "movz",
            width: 64,
            rd: 11,
            immediate: 0x7ff8,
            shift: 48,
          });
          emit({ op: "fmov-d-x", rd: target, rn: 11 });
          patchInstruction(done, {
            op: "b",
            displacement: (instructions.length - done) * 4,
          });
        }
        floatStore(target, op.id);
        break;
      }
      floatLoad(0, op.index);
      callHelper("string-code-unit");
      floatStore(0, op.id);
      break;
    }
    case "string-from-code-units": {
      // ToUint16 is ToUint32 modulo 65536: the low bits of each
      // value's word. The string is one-byte when no unit has a bit
      // in 0xFF00. The first eight units are converted once and kept
      // packed, four halfwords per scratch word (x15, then x16)
      // across the allocation; later units are converted again.
      const values = op.values,
        result = op.id,
        packed = values.length < 8 ? values.length : 8;
      /** ToUint32 of `input` in x9 (wordValue: integer storage
       * and exact doubles inline, the helper only otherwise). */
      function codeUnit(input: number): void {
        wordValue(input);
      }
      // One unit below 256: its string from the one-unit table,
      // without allocating (V8's single-character string table).
      let tabled = -1;
      const single = values.length === 1 ? values[0] : undefined;
      if (single !== undefined) {
        codeUnit(single);
        emit({
          op: "ubfm",
          width: 64,
          rd: 10,
          rn: 9,
          immr: 0,
          imms: 15,
        });
        emit({
          op: "sub-imm",
          width: 64,
          rd: "zr",
          rn: 10,
          immediate: 256,
          shift: 0,
          setFlags: true,
        });
        const wide = instructions.length;
        emit({ op: "b.cond", condition: "cs", displacement: 0 });
        markUnitStrings();
        stringFixups.push({
          offset: instructions.length * 4,
          value: "\u0000",
        });
        localPointer(9);
        emit({
          op: "add-reg",
          width: 64,
          rd: 9,
          rn: 9,
          rm: 10,
          shift: "lsl",
          amount: 5,
          setFlags: false,
        });
        saveRaw(9, result);
        tabled = instructions.length;
        emit({ op: "b", displacement: 0 });
        patchInstruction(wide, {
          op: "b.cond",
          condition: "cs",
          displacement: (instructions.length - wide) * 4,
        });
      }
      allocate(
        () => {
          if (values.length === 1) {
            // One unit: kept whole in the first scratch word.
            const input = values[0];
            if (input === undefined) throw "string code unit invariant";
            codeUnit(input);
            rawStore(9, allocationOffset + 8);
            imm(13, 0xff00);
            emit({ op: "and-reg", width: 64, rd: 14, rn: 9, rm: 13 });
            emit({
              op: "sub-imm",
              width: 64,
              rd: "zr",
              rn: 14,
              immediate: 0,
              shift: 0,
              setFlags: true,
            });
            emit({ op: "cset", rd: 14, condition: "eq" });
            imm(11, 1);
            prepareStringSize(14);
            return;
          }
          imm(14, 0);
          imm(15, 0);
          imm(16, 0);
          for (let index = 0; index < values.length; index++) {
            const input = values[index];
            if (input === undefined) throw "string code unit invariant";
            codeUnit(input);
            emit({ op: "orr-reg", width: 64, rd: 14, rn: 14, rm: 9 });
            if (index >= packed) continue;
            // UBFIZ: the unit's 16 bits at its halfword.
            const shift = (index % 4) * 16,
              word = index < 4 ? 15 : 16;
            emit({
              op: "ubfm",
              width: 64,
              rd: 9,
              rn: 9,
              immr: (64 - shift) % 64,
              imms: 15,
            });
            emit({
              op: "orr-reg",
              width: 64,
              rd: word,
              rn: word,
              rm: 9,
            });
          }
          rawStore(15, allocationOffset + 8);
          rawStore(16, allocationOffset + 16);
          imm(13, 0xff00);
          emit({ op: "and-reg", width: 64, rd: 14, rn: 14, rm: 13 });
          emit({
            op: "sub-imm",
            width: 64,
            rd: "zr",
            rn: 14,
            immediate: 0,
            shift: 0,
            setFlags: true,
          });
          emit({ op: "cset", rd: 14, condition: "eq" });
          imm(11, values.length);
          prepareStringSize(14);
        },
        (rd) => rawLoad(rd, allocationOffset),
      );
      saveRaw(9, result);
      rawLoad(10, allocationOffset + 24);
      emit({ op: "str", width: 64, rt: 10, rn: 9, offset: 0 });
      imm(11, values.length);
      emit({
        op: "str",
        width: 64,
        rt: 11,
        rn: 9,
        offset: nativeStringLengthOffset,
      });
      emit({
        op: "sub-imm",
        width: 64,
        rd: "zr",
        rn: 10,
        immediate: nativeStringTwoByteHeader,
        shift: 0,
        setFlags: true,
      });
      const oneByte = instructions.length;
      emit({ op: "b.cond", condition: "ne", displacement: 0 });
      /** Stores every unit, a byte or a halfword each: packed units
       * from the scratch words, the rest converted again. */
      function storeUnits(half: boolean): void {
        for (let index = 0; index < values.length; index++) {
          const offset = nativeStringDataOffset + (half ? index * 2 : index);
          if (index < packed) {
            const scratch = allocationOffset + (index < 4 ? 8 : 16),
              shift = (index % 4) * 16;
            if (half && index % 4 === 0 && index + 4 <= packed) {
              // Four packed halfwords are the data's next word.
              rawLoad(11, scratch);
              rawValue(10, result);
              emit({ op: "str", width: 64, rt: 11, rn: 10, offset });
              index += 3;
              continue;
            }
            rawLoad(9, scratch);
            if (shift !== 0)
              emit({
                op: "ubfm",
                width: 64,
                rd: 9,
                rn: 9,
                immr: shift,
                imms: 63,
              });
          } else {
            const input = values[index];
            if (input === undefined) throw "string code unit invariant";
            codeUnit(input);
          }
          // STRB/STRH store the unit's low bits.
          rawValue(10, result);
          narrowStore(half, 9, 10, offset);
        }
      }
      storeUnits(true);
      const stored = instructions.length;
      emit({ op: "b", displacement: 0 });
      patchInstruction(oneByte, {
        op: "b.cond",
        condition: "ne",
        displacement: (instructions.length - oneByte) * 4,
      });
      storeUnits(false);
      patchInstruction(stored, {
        op: "b",
        displacement: (instructions.length - stored) * 4,
      });
      if (tabled >= 0)
        patchInstruction(tabled, {
          op: "b",
          displacement: (instructions.length - tabled) * 4,
        });
      break;
    }
    case "string-slice": {
      const limitIndex = valueIds.intern(op.limit),
        absent = undefinedValues[limitIndex] === 1,
        present = wrappedNumbers[limitIndex] === 1,
        limitSource =
          foldedOptionalWraps[limitIndex] === 1
            ? (wrappedNumberSources[limitIndex] ?? op.limit)
            : op.limit;
      if (lengthOnlySlices[valueIds.intern(op.id)] === 1) {
        rawValue(9, op.string);
        sliceBounds(
          op.string,
          op.begin,
          op.limit,
          absent,
          present,
          limitSource,
        );
        const target = rawTarget(op.id, 13);
        if (target !== 13)
          emit({
            op: "orr-reg",
            width: 64,
            rd: target,
            rn: "zr",
            rm: 13,
          });
        saveRaw(target, op.id);
        break;
      }
      if (
        linearAllocation &&
        generationalBarriers &&
        allowColdStubs &&
        instructions.length - start / 4 < 131072
      ) {
        pollWorkerStop();
        rawValue(9, op.string);
        sliceBounds(
          op.string,
          op.begin,
          op.limit,
          absent,
          present,
          limitSource,
        );
        emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
        emit({
          op: "sub-imm",
          width: 64,
          rd: "zr",
          rn: 13,
          immediate: nativeStringSlicedMinimumLength,
          shift: 0,
          setFlags: true,
        });
        const short = instructions.length;
        emit({ op: "b.cond", condition: "cc", displacement: 0 });
        const oneByteView = instructions.length;
        emit({
          op: "tbnz",
          rt: 10,
          bit: nativeHeaderFlagsShift,
          displacement: 0,
        });
        const narrow = emitSliceFastTwoByteProbe(
          emit,
          patchInstruction,
          callHelper,
          instructions,
        );
        emit({
          op: "add-reg",
          width: 64,
          rd: 12,
          rn: 12,
          rm: 12,
          shift: "lsl",
          amount: 0,
          setFlags: false,
        });
        patchInstruction(oneByteView, {
          op: "tbnz",
          rt: 10,
          bit: nativeHeaderFlagsShift,
          displacement: (instructions.length - oneByteView) * 4,
        });
        emit({
          op: "movz",
          width: 64,
          rd: 14,
          immediate: nativeStringSlicedFlag,
          shift: 48,
        });
        emit({ op: "orr-reg", width: 64, rd: 14, rn: 10, rm: 14 });
        emit({
          op: "tbz",
          rt: 10,
          bit: slicedBit,
          displacement: 12,
        });
        emit({
          op: "ldp",
          width: 64,
          rt: 15,
          rt2: 9,
          rn: 9,
          offset: nativeStringSlicedStartOffset,
          mode: "offset",
        });
        emit({
          op: "add-reg",
          width: 64,
          rd: 12,
          rn: 12,
          rm: 15,
          shift: "lsl",
          amount: 0,
          setFlags: false,
        });
        const view = emitSliceFastNurseryView(
          emit,
          patchInstruction,
          rawLoad,
          instructions,
          contextOffset,
          undefined,
        );
        stackWords.clear();
        coldSlices.push({
          short,
          narrowExact: narrow.narrowExact,
          narrowCall: narrow.narrowCall,
          noState: view.noState,
          viewFull: view.viewFull,
          string: op.string,
          block: blockId,
          index: siteIndex,
          resume: instructions.length,
        });
        saveRaw(9, op.id);
        break;
      }
      const fastViews: number[] = [];
      allocate(
        () => {
          rawValue(9, op.string);
          sliceBounds(
            op.string,
            op.begin,
            op.limit,
            absent,
            present,
            limitSource,
          );
          // A result of at least the minimum length in its
          // source's kind views the source's units: a 32-byte
          // sliced string (docs/design-one-byte-strings.md). A
          // one-byte source's long results always do; a two-byte
          // source's do unless their units all fit one byte (the
          // canonical kind), when they are copied narrow like
          // short results.
          emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
          emit({
            op: "sub-imm",
            width: 64,
            rd: "zr",
            rn: 13,
            immediate: nativeStringSlicedMinimumLength,
            shift: 0,
            setFlags: true,
          });
          const short = instructions.length;
          emit({ op: "b.cond", condition: "cc", displacement: 0 });
          const oneByteView = instructions.length;
          emit({
            op: "tbnz",
            rt: 10,
            bit: nativeHeaderFlagsShift,
            displacement: 0,
          });
          const narrow = emitSliceFastTwoByteProbe(
            emit,
            patchInstruction,
            callHelper,
            instructions,
          );
          emit({
            op: "add-reg",
            width: 64,
            rd: 12,
            rn: 12,
            rm: 12,
            shift: "lsl",
            amount: 0,
            setFlags: false,
          });
          patchInstruction(oneByteView, {
            op: "tbnz",
            rt: 10,
            bit: nativeHeaderFlagsShift,
            displacement: (instructions.length - oneByteView) * 4,
          });
          // The view's header: the source's kind, sliced. Its
          // start: the begin's bytes, after a sliced source's
          // own start (slices share the flat parent).
          emit({
            op: "movz",
            width: 64,
            rd: 14,
            immediate: nativeStringSlicedFlag,
            shift: 48,
          });
          emit({ op: "orr-reg", width: 64, rd: 14, rn: 10, rm: 14 });
          emit({
            op: "tbz",
            rt: 10,
            bit: slicedBit,
            displacement: 12,
          });
          emit({
            op: "ldp",
            width: 64,
            rt: 15,
            rt2: 9,
            rn: 9,
            offset: nativeStringSlicedStartOffset,
            mode: "offset",
          });
          emit({
            op: "add-reg",
            width: 64,
            rd: 12,
            rn: 12,
            rm: 15,
            shift: "lsl",
            amount: 0,
            setFlags: false,
          });
          // Fast inline nursery view allocation: avoids all stack
          // spills/reloads and the post-allocate flat/view branch
          // when the 32-byte view fits in the nursery.
          if (linearAllocation && generationalBarriers)
            emitSliceFastNurseryView(
              emit,
              patchInstruction,
              rawLoad,
              instructions,
              contextOffset,
              fastViews,
            );
          rawStore(13, allocationOffset + 16);
          rawStore(14, allocationOffset + 24);
          rawStore(12, allocationOffset + 8);
          imm(12, nativeStringSlicedByteLength);
          rawStore(12, allocationOffset);
          const viewSized = instructions.length;
          emit({ op: "b", displacement: 0 });
          patchInstruction(short, {
            op: "b.cond",
            condition: "cc",
            displacement: (instructions.length - short) * 4,
          });
          emit({
            op: "movz",
            width: 64,
            rd: 14,
            immediate: 1,
            shift: 0,
          });
          const oneByteCopy = instructions.length;
          emit({
            op: "tbnz",
            rt: 10,
            bit: nativeHeaderFlagsShift,
            displacement: 0,
          });
          callHelper("string-slice-kind");
          patchInstruction(oneByteCopy, {
            op: "tbnz",
            rt: 10,
            bit: nativeHeaderFlagsShift,
            displacement: (instructions.length - oneByteCopy) * 4,
          });
          if (linearAllocation && generationalBarriers)
            emitSliceFastNurseryNarrow(
              emit,
              patchInstruction,
              rawLoad,
              callHelper,
              instructions,
              contextOffset,
              narrow,
              fastViews,
            );
          else {
            const narrowTarget = instructions.length;
            patchInstruction(narrow.narrowExact, {
              op: "b.cond",
              condition: "eq",
              displacement: (narrowTarget - narrow.narrowExact) * 4,
            });
            patchInstruction(narrow.narrowCall, {
              op: "cbnz",
              width: 64,
              rt: 14,
              displacement: (narrowTarget - narrow.narrowCall) * 4,
            });
          }
          rawStore(13, allocationOffset + 16);
          rawStore(12, allocationOffset + 8);
          emit({
            op: "add-reg",
            width: 64,
            rd: 11,
            rn: "zr",
            rm: 13,
            shift: "lsl",
            amount: 0,
            setFlags: false,
          });
          prepareStringSize(14);
          patchInstruction(viewSized, {
            op: "b",
            displacement: (instructions.length - viewSized) * 4,
          });
        },
        (rd) => rawLoad(rd, allocationOffset),
      );
      rawValue(10, op.string);
      rawLoad(11, allocationOffset + 8);
      rawLoad(12, allocationOffset + 16);
      rawLoad(13, allocationOffset + 24);
      const flat = instructions.length;
      emit({ op: "tbz", rt: 13, bit: slicedBit, displacement: 0 });
      // A view: header and length, then the start and the flat
      // parent (a sliced source's own parent, so slices never
      // chain).
      emit({
        op: "stp",
        width: 64,
        rt: 13,
        rt2: 12,
        rn: 9,
        offset: 0,
        mode: "offset",
      });
      emit({ op: "ldr", width: 64, rt: 14, rn: 10, offset: 0 });
      emit({ op: "tbz", rt: 14, bit: slicedBit, displacement: 8 });
      emit({
        op: "ldr",
        width: 64,
        rt: 10,
        rn: 10,
        offset: nativeStringParentOffset,
      });
      emit({
        op: "stp",
        width: 64,
        rt: 11,
        rt2: 10,
        rn: 9,
        offset: nativeStringSlicedStartOffset,
        mode: "offset",
      });
      const viewed = instructions.length;
      emit({ op: "b", displacement: 0 });
      patchInstruction(flat, {
        op: "tbz",
        rt: 13,
        bit: slicedBit,
        displacement: (instructions.length - flat) * 4,
      });
      callHelper("string-slice-copy");
      patchInstruction(viewed, {
        op: "b",
        displacement: (instructions.length - viewed) * 4,
      });
      for (const fastView of fastViews)
        if (fastView !== undefined)
          patchInstruction(fastView, {
            op: "b",
            displacement: (instructions.length - fastView) * 4,
          });
      saveRaw(9, op.id);
      break;
    }
    case "string-concat": {
      allocate(
        () => {
          rawValue(9, op.left);
          rawValue(10, op.right);
          emit({
            op: "ldr",
            width: 32,
            rt: 11,
            rn: 9,
            offset: nativeStringLengthOffset,
          });
          emit({
            op: "ldr",
            width: 32,
            rt: 12,
            rn: 10,
            offset: nativeStringLengthOffset,
          });
          emit({
            op: "add-reg",
            width: 64,
            rd: 11,
            rn: 11,
            rm: 12,
            shift: "lsl",
            amount: 0,
            setFlags: false,
          });
          // One-byte exactly when both inputs are: bit 48 of the
          // headers' conjunction.
          emit({ op: "ldr", width: 64, rt: 12, rn: 9, offset: 0 });
          emit({ op: "ldr", width: 64, rt: 13, rn: 10, offset: 0 });
          emit({ op: "and-reg", width: 64, rd: 14, rn: 12, rm: 13 });
          emit({
            op: "ubfm",
            width: 64,
            rd: 14,
            rn: 14,
            immr: 48,
            imms: 48,
          });
          prepareStringSize(14);
        },
        (rd) => rawLoad(rd, allocationOffset),
      );
      // Inputs may move at the allocation safepoint: reload their rooted slots.
      rawValue(10, op.left);
      rawValue(11, op.right);
      rawLoad(12, allocationOffset + 24);
      // A one-byte result of at most eight units (so both parts
      // are flat: slices have more) is one data word: the left
      // part's word below its length, the right part's shifted
      // above it. Every string has eight readable data bytes, and
      // bytes past a string's length are never read, so neither
      // part's tail needs clearing beyond the left mask.
      const general = instructions.length;
      emit({
        op: "tbz",
        rt: 12,
        bit: nativeHeaderFlagsShift,
        displacement: 0,
      });
      emit({
        op: "ldr",
        width: 32,
        rt: 13,
        rn: 10,
        offset: nativeStringLengthOffset,
      });
      emit({
        op: "ldr",
        width: 32,
        rt: 14,
        rn: 11,
        offset: nativeStringLengthOffset,
      });
      emit({
        op: "add-reg",
        width: 64,
        rd: 15,
        rn: 13,
        rm: 14,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      emit({
        op: "sub-imm",
        width: 64,
        rd: "zr",
        rn: 15,
        immediate: 8,
        shift: 0,
        setFlags: true,
      });
      const long = instructions.length;
      emit({ op: "b.cond", condition: "hi", displacement: 0 });
      emit({
        op: "ldr",
        width: 64,
        rt: 16,
        rn: 10,
        offset: nativeStringDataOffset,
      });
      emit({
        op: "ldr",
        width: 64,
        rt: 17,
        rn: 11,
        offset: nativeStringDataOffset,
      });
      // x13 = the left part's bits; x14 = its mask, 2^bits - 1
      // (all ones for eight units, when the right part is empty
      // and its shifted word is not used).
      emit({
        op: "ubfm",
        width: 64,
        rd: 13,
        rn: 13,
        immr: 61,
        imms: 60,
      });
      imm(14, 1);
      emit({ op: "lslv", width: 64, rd: 14, rn: 14, rm: 13 });
      emit({
        op: "sub-imm",
        width: 64,
        rd: 14,
        rn: 14,
        immediate: 1,
        shift: 0,
        setFlags: false,
      });
      emit({ op: "and-reg", width: 64, rd: 14, rn: 16, rm: 14 });
      emit({ op: "lslv", width: 64, rd: 17, rn: 17, rm: 13 });
      emit({ op: "orr-reg", width: 64, rd: 14, rn: 14, rm: 17 });
      emit({
        op: "sub-imm",
        width: 64,
        rd: "zr",
        rn: 13,
        immediate: 64,
        shift: 0,
        setFlags: true,
      });
      emit({
        op: "csel",
        width: 64,
        rd: 14,
        rn: 16,
        rm: 14,
        condition: "eq",
      });
      emit({
        op: "stp",
        width: 64,
        rt: 12,
        rt2: 15,
        rn: 9,
        offset: 0,
        mode: "offset",
      });
      emit({
        op: "str",
        width: 64,
        rt: 14,
        rn: 9,
        offset: nativeStringDataOffset,
      });
      const done = instructions.length;
      emit({ op: "b", displacement: 0 });
      patchInstruction(general, {
        op: "tbz",
        rt: 12,
        bit: nativeHeaderFlagsShift,
        displacement: (instructions.length - general) * 4,
      });
      patchInstruction(long, {
        op: "b.cond",
        condition: "hi",
        displacement: (instructions.length - long) * 4,
      });
      callHelper("string-concat-copy");
      patchInstruction(done, {
        op: "b",
        displacement: (instructions.length - done) * 4,
      });
      saveRaw(9, op.id);
      break;
    }
    default:
      throw "string core op invariant";
  }
}

export function emitStringCacheOp(
  ctx: StringOpsEmitContext,
  instruction: IRInstruction,
): void {
  const op = instruction;
  const {
    instructions,
    valueIds,
    wordKinds,
    wordConstants,
    stringFixups,
    allocationOffset,
    contextOffset,
    value,
    allocate,
    callHelper,
    emit,
    exactInteger,
    floatLoad,
    floatOperand,
    floatStore,
    floatTarget,
    imm,
    intOperand,
    intRegister,
    latin1Count,
    latin1Index,
    latin1Range,
    localPointer,
    markInteger,
    narrowStore,
    patchInstruction,
    pollWorkerStop,
    prepareStringSize,
    rawLoad,
    rawRegister,
    rawStore,
    rawTarget,
    rawValue,
    saveRaw,
    storedAsInteger,
    trapIf,
    wantsInteger,
    wordValue,
  } = ctx;
  switch (op.kind) {
    case "string-allocate": {
      // The builder writes every unit before any other use, so the
      // contents are left as allocated. Its kind is one-byte unless
      // a part is two-byte.
      allocate(
        () => {
          floatLoad(0, op.length);
          emit({ op: "fcvtzs-x-d", rd: 11, rn: 0 });
          rawValue(14, op.twoByte);
          imm(13, 1);
          emit({ op: "eor-reg", width: 64, rd: 14, rn: 14, rm: 13 });
          prepareStringSize(14);
        },
        (rd) => rawLoad(rd, allocationOffset),
      );
      saveRaw(9, op.id);
      rawLoad(10, allocationOffset + 24);
      emit({ op: "str", width: 64, rt: 10, rn: 9, offset: 0 });
      floatLoad(0, op.length);
      emit({ op: "fcvtzs-x-d", rd: 10, rn: 0 });
      emit({
        op: "str",
        width: 64,
        rt: 10,
        rn: 9,
        offset: nativeStringLengthOffset,
      });
      break;
    }
    case "string-write": {
      rawValue(9, op.target);
      rawValue(10, op.source);
      if (exactInteger(op.offset)) intOperand(op.offset, 11);
      else {
        floatLoad(0, op.offset);
        emit({ op: "fcvtzs-x-d", rd: 11, rn: 0 });
      }
      // A flat one-byte source of at most eight units into a
      // one-byte target is one data word, stored whole while it
      // stays inside the target's data (its length rounded up to
      // eight bytes): every builder writes its parts in offset
      // order, so bytes stored past this part belong to a later
      // part or to unread spare capacity. Anything else, and an
      // overrun (which traps), takes the helper.
      const general: { index: number; branch: Branch }[] = [];
      const toGeneral = (branch: Branch): void => {
        general.push({ index: instructions.length, branch });
        emit(branchAt(branch, 0));
      };
      emit({ op: "ldr", width: 64, rt: 12, rn: 9, offset: 0 });
      emit({ op: "ldr", width: 64, rt: 16, rn: 10, offset: 0 });
      toGeneral({ op: "tbnz", rt: 16, bit: slicedBit });
      emit({ op: "and-reg", width: 64, rd: 12, rn: 12, rm: 16 });
      toGeneral({ op: "tbz", rt: 12, bit: nativeHeaderFlagsShift });
      emit({
        op: "ldr",
        width: 32,
        rt: 13,
        rn: 10,
        offset: nativeStringLengthOffset,
      });
      emit({
        op: "sub-imm",
        width: 64,
        rd: "zr",
        rn: 13,
        immediate: 8,
        shift: 0,
        setFlags: true,
      });
      toGeneral({ op: "b.cond", condition: "hi" });
      emit({
        op: "ldr",
        width: 32,
        rt: 14,
        rn: 9,
        offset: nativeStringLengthOffset,
      });
      emit({
        op: "add-reg",
        width: 64,
        rd: 15,
        rn: 11,
        rm: 13,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: 15,
        rm: 14,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
      toGeneral({ op: "b.cond", condition: "hi" });
      // x14 = the target's data bytes: align8(length).
      emit({
        op: "add-imm",
        width: 64,
        rd: 14,
        rn: 14,
        immediate: 7,
        shift: 0,
        setFlags: false,
      });
      emit({
        op: "ubfm",
        width: 64,
        rd: 14,
        rn: 14,
        immr: 3,
        imms: 63,
      });
      emit({
        op: "ubfm",
        width: 64,
        rd: 14,
        rn: 14,
        immr: 61,
        imms: 60,
      });
      emit({
        op: "add-imm",
        width: 64,
        rd: 15,
        rn: 11,
        immediate: 8,
        shift: 0,
        setFlags: false,
      });
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: 15,
        rm: 14,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
      toGeneral({ op: "b.cond", condition: "hi" });
      emit({
        op: "ldr",
        width: 64,
        rt: 16,
        rn: 10,
        offset: nativeStringDataOffset,
      });
      emit({
        op: "add-reg",
        width: 64,
        rd: 12,
        rn: 9,
        rm: 11,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      emit({
        op: "str",
        width: 64,
        rt: 16,
        rn: 12,
        offset: nativeStringDataOffset,
      });
      const written = instructions.length;
      emit({ op: "b", displacement: 0 });
      for (const site of general) {
        if (site === undefined) throw "string write branch invariant";
        patchInstruction(
          site.index,
          branchAt(site.branch, (instructions.length - site.index) * 4),
        );
      }
      callHelper("string-write-copy");
      patchInstruction(written, {
        op: "b",
        displacement: (instructions.length - written) * 4,
      });
      break;
    }
    case "string-from-latin1": {
      allocate(
        () => {
          latin1Index(op.begin, 11);
          latin1Index(op.limit, 12);
          rawValue(9, op.bytes);
          latin1Range(nativeArrayLengthOffset);
          rawStore(11, allocationOffset + 8);
          emit({
            op: "sub-reg",
            width: 64,
            rd: 11,
            rn: 12,
            rm: 11,
            shift: "lsl",
            amount: 0,
            setFlags: false,
          });
          rawStore(11, allocationOffset + 16);
          imm(14, 1);
          prepareStringSize(14);
        },
        (rd) => rawLoad(rd, allocationOffset),
      );
      saveRaw(9, op.id);
      rawLoad(10, allocationOffset + 24);
      emit({ op: "str", width: 64, rt: 10, rn: 9, offset: 0 });
      rawLoad(15, allocationOffset + 16);
      emit({
        op: "str",
        width: 64,
        rt: 15,
        rn: 9,
        offset: nativeStringLengthOffset,
      });
      emit({
        op: "add-imm",
        width: 64,
        rd: 14,
        rn: 9,
        immediate: nativeStringDataOffset,
        shift: 0,
        setFlags: false,
      });
      // The bytes may have moved at the allocation safepoint:
      // reload their rooted slot.
      rawValue(10, op.bytes);
      emit({
        op: "ldr",
        width: 64,
        rt: 13,
        rn: 10,
        offset: nativeArrayDataOffset,
      });
      rawLoad(11, allocationOffset + 8);
      emit({
        op: "add-reg",
        width: 64,
        rd: 13,
        rn: 13,
        rm: 11,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      callHelper("bytes-copy");
      break;
    }
    case "string-from-utf8": {
      // Measures the valid prefix (its units and kind), allocates,
      // then decodes it; with `whole`, a prefix short of the range
      // decodes as the empty string. The allocation scratch holds
      // begin (low half) and the prefix bytes (high half) at +8 and
      // the units at +16 across the allocation.
      allocate(
        () => {
          latin1Index(op.begin, 11);
          latin1Index(op.limit, 12);
          rawValue(9, op.bytes);
          latin1Range(nativeArrayLengthOffset);
          rawStore(11, allocationOffset + 8);
          emit({
            op: "sub-reg",
            width: 64,
            rd: 15,
            rn: 12,
            rm: 11,
            shift: "lsl",
            amount: 0,
            setFlags: false,
          });
          emit({
            op: "ldr",
            width: 64,
            rt: 13,
            rn: 9,
            offset: nativeArrayDataOffset,
          });
          emit({
            op: "add-reg",
            width: 64,
            rd: 13,
            rn: 13,
            rm: 11,
            shift: "lsl",
            amount: 0,
            setFlags: false,
          });
          callHelper("bytes-utf8-measure");
          if (op.whole === true) {
            // Bytes left after the prefix: the empty string.
            emit({ op: "cbz", width: 64, rt: 15, displacement: 16 });
            emit({
              op: "movz",
              width: 64,
              rd: 11,
              immediate: 0,
              shift: 0,
            });
            emit({
              op: "movz",
              width: 64,
              rd: 12,
              immediate: 0,
              shift: 0,
            });
            emit({
              op: "movz",
              width: 64,
              rd: 14,
              immediate: 1,
              shift: 0,
            });
          }
          rawLoad(16, allocationOffset + 8);
          // x12 << 32 (LSL as UBFM).
          emit({
            op: "ubfm",
            width: 64,
            rd: 12,
            rn: 12,
            immr: 32,
            imms: 31,
          });
          emit({ op: "orr-reg", width: 64, rd: 16, rn: 16, rm: 12 });
          rawStore(16, allocationOffset + 8);
          rawStore(11, allocationOffset + 16);
          prepareStringSize(14);
        },
        (rd) => rawLoad(rd, allocationOffset),
      );
      saveRaw(9, op.id);
      rawLoad(10, allocationOffset + 24);
      emit({ op: "str", width: 64, rt: 10, rn: 9, offset: 0 });
      rawLoad(11, allocationOffset + 16);
      emit({
        op: "str",
        width: 64,
        rt: 11,
        rn: 9,
        offset: nativeStringLengthOffset,
      });
      // The bytes may have moved at the allocation safepoint:
      // reload their rooted slot.
      rawValue(10, op.bytes);
      emit({
        op: "ldr",
        width: 64,
        rt: 13,
        rn: 10,
        offset: nativeArrayDataOffset,
      });
      rawLoad(16, allocationOffset + 8);
      emit({
        op: "ubfm",
        width: 64,
        rd: 15,
        rn: 16,
        immr: 32,
        imms: 63,
      });
      emit({
        op: "ubfm",
        width: 64,
        rd: 16,
        rn: 16,
        immr: 0,
        imms: 31,
      });
      emit({
        op: "add-reg",
        width: 64,
        rd: 13,
        rn: 13,
        rm: 16,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      callHelper("bytes-utf8-decode");
      break;
    }
    case "string-index-cached": {
      // The index field (nativeStringIndexFieldOffset): bit 0 set
      // when an array index is cached in the bits above, so the
      // value is field >> 1 or (no index) -1: field >> 1 or'ed
      // with the complement of bit 0 sign-extended.
      const string = rawRegister(op.string, 9);
      emit({
        op: "ldr",
        width: 32,
        rt: 10,
        rn: string,
        offset: nativeStringIndexFieldOffset,
      });
      emit({
        op: "ubfm",
        width: 64,
        rd: 11,
        rn: 10,
        immr: 1,
        imms: 31,
      });
      emit({
        op: "sbfm",
        width: 64,
        rd: 12,
        rn: 10,
        immr: 0,
        imms: 0,
      });
      if (wantsInteger(op.id)) {
        const target = rawTarget(op.id, 11);
        emit({
          op: "orn-reg",
          width: 64,
          rd: target,
          rn: 11,
          rm: 12,
        });
        saveRaw(target, op.id);
        markInteger(op.id);
        break;
      }
      emit({ op: "orn-reg", width: 64, rd: 11, rn: 11, rm: 12 });
      emit({ op: "scvtf-d-x", rd: floatTarget(op.id, 0), rn: 11 });
      floatStore(floatTarget(op.id, 0), op.id);
      break;
    }
    case "gc-epoch": {
      rawLoad(9, contextOffset);
      emit({
        op: "ldr",
        width: 64,
        rt: 10,
        rn: 9,
        offset: nativeAllocationStateOffset,
      });
      emit({ op: "movz", width: 32, rd: 11, immediate: 0, shift: 0 });
      const skip = instructions.length;
      emit({ op: "cbz", width: 64, rt: 10, displacement: 0 });
      emit({
        op: "ldr",
        width: 32,
        rt: 11,
        rn: 10,
        offset: nativeGcEpochWord * 4,
      });
      patchInstruction(skip, {
        op: "cbz",
        width: 64,
        rt: 10,
        displacement: (instructions.length - skip) * 4,
      });
      if (wantsInteger(op.id)) {
        const target = rawTarget(op.id, 11);
        if (target !== 11)
          emit({
            op: "orr-reg",
            width: 64,
            rd: target,
            rn: "zr",
            rm: 11,
          });
        saveRaw(target, op.id);
        markInteger(op.id);
        break;
      }
      emit({ op: "ucvtf-d-w", rd: floatTarget(op.id, 0), rn: 11 });
      floatStore(floatTarget(op.id, 0), op.id);
      break;
    }
    case "reference-hash": {
      if (value(op.value).type === "general") {
        rawValue(9, op.value);
        emit({
          op: "movz",
          width: 32,
          rd: 11,
          immediate: 0,
          shift: 0,
        });
        emit({
          op: "sub-imm",
          width: 64,
          rd: "zr",
          rn: 9,
          immediate: 5,
          shift: 0,
          setFlags: true,
        });
        const notRef = instructions.length;
        emit({ op: "b.cond", condition: "ne", displacement: 0 });
        rawLoad(10, value(op.value).offset + 8);
        emit({
          op: "ubfm",
          width: 64,
          rd: 11,
          rn: 10,
          immr: 3,
          imms: 63,
        });
        emit({
          op: "ubfm",
          width: 64,
          rd: 12,
          rn: 10,
          immr: 21,
          imms: 63,
        });
        emit({ op: "eor-reg", width: 32, rd: 11, rn: 11, rm: 12 });
        patchInstruction(notRef, {
          op: "b.cond",
          condition: "ne",
          displacement: (instructions.length - notRef) * 4,
        });
      } else {
        const ref = rawRegister(op.value, 10);
        emit({
          op: "ubfm",
          width: 64,
          rd: 11,
          rn: ref,
          immr: 3,
          imms: 63,
        });
        emit({
          op: "ubfm",
          width: 64,
          rd: 12,
          rn: ref,
          immr: 21,
          imms: 63,
        });
        emit({ op: "eor-reg", width: 32, rd: 11, rn: 11, rm: 12 });
      }
      if (wantsInteger(op.id)) {
        const target = rawTarget(op.id, 11);
        if (target !== 11)
          emit({
            op: "orr-reg",
            width: 64,
            rd: target,
            rn: "zr",
            rm: 11,
          });
        saveRaw(target, op.id);
        markInteger(op.id);
        break;
      }
      emit({ op: "ucvtf-d-w", rd: floatTarget(op.id, 0), rn: 11 });
      floatStore(floatTarget(op.id, 0), op.id);
      break;
    }
    case "string-index-cache": {
      // Only an unset field is written (pool literals are
      // read-only and carry theirs), by one 32-bit store of the
      // value the text determines: (value << 1) | 1.
      const string = rawRegister(op.string, 9);
      intOperand(op.value, 11);
      emit({
        op: "ldr",
        width: 32,
        rt: 10,
        rn: string,
        offset: nativeStringIndexFieldOffset,
      });
      const set = instructions.length;
      emit({ op: "cbnz", width: 32, rt: 10, displacement: 0 });
      emit({
        op: "add-reg",
        width: 32,
        rd: 11,
        rn: 11,
        rm: 11,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      emit({
        op: "add-imm",
        width: 32,
        rd: 11,
        rn: 11,
        immediate: 1,
        shift: 0,
        setFlags: false,
      });
      emit({
        op: "str",
        width: 32,
        rt: 11,
        rn: string,
        offset: nativeStringIndexFieldOffset,
      });
      patchInstruction(set, {
        op: "cbnz",
        width: 32,
        rt: 10,
        displacement: (instructions.length - set) * 4,
      });
      break;
    }
    case "number-string-cached":
    case "number-string-cache": {
      // The number-string cache (nativeNumberStringCacheWord): the
      // allocation state's word holds the table's managed offset
      // (0: none, and no state: no cache). An entry is the key's
      // bits, then its string, at the entry its comment describes.
      const store = op.kind === "number-string-cache",
        indexBits = entryBits(nativeNumberStringCacheEntries),
        stateWord = nativeNumberStringCacheWord * 4;
      // Branches to the end: a CBZ of `rt`, or (rt < 0) a B.NE.
      const exits: { site: number; rt: number }[] = [];
      function exitIf(rt: number): void {
        exits.push({ site: instructions.length, rt });
        emit({ op: "cbz", width: 64, rt, displacement: 0 });
      }
      function patchExits(): void {
        for (const exit of exits) {
          if (exit === undefined) throw "number cache exit invariant";
          const displacement = (instructions.length - exit.site) * 4;
          patchInstruction(
            exit.site,
            exit.rt < 0
              ? { op: "b.cond", condition: "ne", displacement }
              : { op: "cbz", width: 64, rt: exit.rt, displacement },
          );
        }
      }
      /** x13 = the table's entry for the bits in x10 (x13 its
       * managed offset); clobbers x11, x14, x15 and d0. */
      function entry(): void {
        rawLoad(14, contextOffset);
        emit({ op: "ldr", width: 64, rt: 14, rn: 14, offset: 8 });
        emit({
          op: "add-reg",
          width: 64,
          rd: 13,
          rn: 14,
          rm: 13,
          shift: "lsl",
          amount: 0,
          setFlags: false,
        });
        // The truncated value plus the low bits word and its
        // upper 24 bits: fcvtzs saturates rather than trapping,
        // and the low word of an integer below 2^21 is zero.
        emit({ op: "fmov-d-x", rd: 0, rn: 10 });
        emit({ op: "fcvtzs-x-d", rd: 11, rn: 0 });
        emit({
          op: "ubfm",
          width: 64,
          rd: 15,
          rn: 10,
          immr: 0,
          imms: 31,
        });
        emit({
          op: "add-reg",
          width: 64,
          rd: 11,
          rn: 11,
          rm: 15,
          shift: "lsl",
          amount: 0,
          setFlags: false,
        });
        emit({
          op: "add-reg",
          width: 64,
          rd: 11,
          rn: 11,
          rm: 15,
          shift: "lsr",
          amount: 8,
          setFlags: false,
        });
        emit({
          op: "ubfm",
          width: 64,
          rd: 11,
          rn: 11,
          immr: 0,
          imms: indexBits - 1,
        });
        emit({
          op: "add-reg",
          width: 64,
          rd: 13,
          rn: 13,
          rm: 11,
          shift: "lsl",
          amount: 4,
          setFlags: false,
        });
      }
      rawLoad(9, contextOffset);
      emit({
        op: "ldr",
        width: 64,
        rt: 12,
        rn: 9,
        offset: nativeAllocationStateOffset,
      });
      exitIf(12);
      emit({
        op: "ldr",
        width: 32,
        rt: 13,
        rn: 12,
        offset: stateWord,
      });
      if (op.kind === "number-string-cached") {
        exitIf(13);
        emit({
          op: "fmov-x-d",
          rd: 10,
          rn: floatOperand(op.value, 0),
        });
        entry();
        emit({
          op: "ldp",
          width: 64,
          rt: 15,
          rt2: 16,
          rn: 13,
          offset: nativeStringDataOffset,
          mode: "offset",
        });
        emit({
          op: "sub-reg",
          width: 64,
          rd: "zr",
          rn: 15,
          rm: 10,
          shift: "lsl",
          amount: 0,
          setFlags: true,
        });
        exits.push({ site: instructions.length, rt: -1 });
        emit({ op: "b.cond", condition: "ne", displacement: 0 });
        exitIf(16);
        saveRaw(16, op.id);
        const hit = instructions.length;
        emit({ op: "b", displacement: 0 });
        patchExits();
        // A miss: the empty string.
        stringFixups.push({
          offset: instructions.length * 4,
          value: "",
        });
        localPointer(9);
        saveRaw(9, op.id);
        patchInstruction(hit, {
          op: "b",
          displacement: (instructions.length - hit) * 4,
        });
        break;
      }
      // A store: allocate the table first when there is none.
      const have = instructions.length;
      emit({ op: "cbnz", width: 64, rt: 13, displacement: 0 });
      const tableUnits = nativeNumberStringCacheEntries * 16;
      allocate(
        () => {
          imm(11, tableUnits);
          imm(14, 1);
          prepareStringSize(14);
        },
        (rd) => rawLoad(rd, allocationOffset),
      );
      rawLoad(10, allocationOffset + 24);
      emit({ op: "str", width: 64, rt: 10, rn: 9, offset: 0 });
      imm(11, tableUnits);
      emit({
        op: "str",
        width: 64,
        rt: 11,
        rn: 9,
        offset: nativeStringLengthOffset,
      });
      // Empty entries: zero bits and no string.
      emit({
        op: "add-imm",
        width: 64,
        rd: 10,
        rn: 9,
        immediate: nativeStringDataOffset,
        shift: 0,
        setFlags: false,
      });
      imm(11, nativeNumberStringCacheEntries);
      const zero = instructions.length;
      emit({
        op: "stp",
        width: 64,
        rt: "zr",
        rt2: "zr",
        rn: 10,
        offset: 16,
        mode: "post",
      });
      emit({
        op: "sub-imm",
        width: 64,
        rd: 11,
        rn: 11,
        immediate: 1,
        shift: 0,
        setFlags: true,
      });
      emit({
        op: "b.cond",
        condition: "ne",
        displacement: (zero - instructions.length) * 4,
      });
      // Publish the table's managed offset (a collection at the
      // allocation cleared any older one).
      rawLoad(10, contextOffset);
      emit({ op: "ldr", width: 64, rt: 14, rn: 10, offset: 8 });
      emit({
        op: "sub-reg",
        width: 64,
        rd: 13,
        rn: 9,
        rm: 14,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      emit({
        op: "ldr",
        width: 64,
        rt: 12,
        rn: 10,
        offset: nativeAllocationStateOffset,
      });
      emit({
        op: "str",
        width: 32,
        rt: 13,
        rn: 12,
        offset: stateWord,
      });
      patchInstruction(have, {
        op: "cbnz",
        width: 64,
        rt: 13,
        displacement: (instructions.length - have) * 4,
      });
      emit({ op: "fmov-x-d", rd: 10, rn: floatOperand(op.value, 0) });
      entry();
      rawValue(16, op.string);
      emit({
        op: "stp",
        width: 64,
        rt: 10,
        rt2: 16,
        rn: 13,
        offset: nativeStringDataOffset,
        mode: "offset",
      });
      patchExits();
      break;
    }
    default:
      throw "string cache op invariant";
  }
}

export function emitStringTextOp(
  ctx: StringOpsEmitContext,
  instruction: IRInstruction,
): void {
  const op = instruction;
  const {
    instructions,
    valueIds,
    wordKinds,
    wordConstants,
    stringFixups,
    allocationOffset,
    contextOffset,
    value,
    allocate,
    callHelper,
    emit,
    exactInteger,
    floatLoad,
    floatOperand,
    floatStore,
    floatTarget,
    imm,
    intOperand,
    intRegister,
    latin1Count,
    latin1Index,
    latin1Range,
    localPointer,
    markInteger,
    narrowStore,
    patchInstruction,
    pollWorkerStop,
    prepareStringSize,
    rawLoad,
    rawRegister,
    rawStore,
    rawTarget,
    rawValue,
    saveRaw,
    storedAsInteger,
    trapIf,
    wantsInteger,
    wordValue,
  } = ctx;
  switch (op.kind) {
    case "string-split-cached":
    case "string-split-cache": {
      // Direct-mapped 16-entry cache of 1-argument string.split(sep)
      // snapshots (nativeStringSplitCacheWord), cleared on every GC.
      // Each 32-byte entry holds (string, separator, snapshot, 0).
      const indexBits = entryBits(nativeStringSplitCacheEntries),
        stateWord = nativeStringSplitCacheWord * 4;
      const exits: { site: number; rt: number }[] = [];
      function splitExitIf(rt: number): void {
        exits.push({ site: instructions.length, rt });
        emit({ op: "cbz", width: 64, rt, displacement: 0 });
      }
      function patchSplitExits(): void {
        for (const exit of exits) {
          if (exit === undefined) throw "split cache exit invariant";
          const displacement = (instructions.length - exit.site) * 4;
          patchInstruction(
            exit.site,
            exit.rt < 0
              ? { op: "b.cond", condition: "ne", displacement }
              : { op: "cbz", width: 64, rt: exit.rt, displacement },
          );
        }
      }
      /** x13 = table entry pointer for (x9 = string, x10 = separator),
       * given x13 = table managed offset; preserves x9, x10; clobbers
       * x11, x14, x15. */
      function splitEntry(): void {
        rawLoad(14, contextOffset);
        emit({ op: "ldr", width: 64, rt: 14, rn: 14, offset: 8 });
        emit({
          op: "add-reg",
          width: 64,
          rd: 13,
          rn: 14,
          rm: 13,
          shift: "lsl",
          amount: 0,
          setFlags: false,
        });
        emit({
          op: "ubfm",
          width: 64,
          rd: 11,
          rn: 9,
          immr: 4,
          imms: 63,
        });
        emit({
          op: "ubfm",
          width: 64,
          rd: 15,
          rn: 10,
          immr: 4,
          imms: 63,
        });
        emit({ op: "eor-reg", width: 64, rd: 11, rn: 11, rm: 15 });
        emit({
          op: "ubfm",
          width: 64,
          rd: 15,
          rn: 11,
          immr: 4,
          imms: 63,
        });
        emit({ op: "eor-reg", width: 64, rd: 11, rn: 11, rm: 15 });
        emit({
          op: "ubfm",
          width: 64,
          rd: 11,
          rn: 11,
          immr: 0,
          imms: indexBits - 1,
        });
        emit({
          op: "add-reg",
          width: 64,
          rd: 13,
          rn: 13,
          rm: 11,
          shift: "lsl",
          amount: 5,
          setFlags: false,
        });
      }
      rawLoad(9, contextOffset);
      emit({
        op: "ldr",
        width: 64,
        rt: 12,
        rn: 9,
        offset: nativeAllocationStateOffset,
      });
      splitExitIf(12);
      emit({
        op: "ldr",
        width: 32,
        rt: 13,
        rn: 12,
        offset: stateWord,
      });
      if (op.kind === "string-split-cached") {
        splitExitIf(13);
        rawValue(9, op.string);
        rawValue(10, op.separator);
        splitEntry();
        emit({
          op: "ldp",
          width: 64,
          rt: 15,
          rt2: 16,
          rn: 13,
          offset: nativeStringDataOffset,
          mode: "offset",
        });
        emit({
          op: "sub-reg",
          width: 64,
          rd: "zr",
          rn: 15,
          rm: 9,
          shift: "lsl",
          amount: 0,
          setFlags: true,
        });
        exits.push({ site: instructions.length, rt: -1 });
        emit({ op: "b.cond", condition: "ne", displacement: 0 });
        emit({
          op: "sub-reg",
          width: 64,
          rd: "zr",
          rn: 16,
          rm: 10,
          shift: "lsl",
          amount: 0,
          setFlags: true,
        });
        exits.push({ site: instructions.length, rt: -1 });
        emit({ op: "b.cond", condition: "ne", displacement: 0 });
        emit({
          op: "ldr",
          width: 64,
          rt: 16,
          rn: 13,
          offset: nativeStringDataOffset + 16,
        });
        splitExitIf(16);
        rawValue(11, op.template);
        emit({ op: "ldr", width: 64, rt: 14, rn: 16, offset: 0 });
        emit({ op: "ldr", width: 64, rt: 15, rn: 11, offset: 0 });
        emit({
          op: "sub-reg",
          width: 64,
          rd: "zr",
          rn: 14,
          rm: 15,
          shift: "lsl",
          amount: 0,
          setFlags: true,
        });
        exits.push({ site: instructions.length, rt: -1 });
        emit({ op: "b.cond", condition: "ne", displacement: 0 });
        saveRaw(16, op.id);
        const hit = instructions.length;
        emit({ op: "b", displacement: 0 });
        patchSplitExits();
        imm(9, 0);
        saveRaw(9, op.id);
        patchInstruction(hit, {
          op: "b",
          displacement: (instructions.length - hit) * 4,
        });
        break;
      }
      const have = instructions.length;
      emit({ op: "cbnz", width: 64, rt: 13, displacement: 0 });
      const tableUnits = nativeStringSplitCacheEntries * 32;
      allocate(
        () => {
          imm(11, tableUnits);
          imm(14, 1);
          prepareStringSize(14);
        },
        (rd) => rawLoad(rd, allocationOffset),
      );
      rawLoad(10, allocationOffset + 24);
      emit({ op: "str", width: 64, rt: 10, rn: 9, offset: 0 });
      imm(11, tableUnits);
      emit({
        op: "str",
        width: 64,
        rt: 11,
        rn: 9,
        offset: nativeStringLengthOffset,
      });
      emit({
        op: "add-imm",
        width: 64,
        rd: 10,
        rn: 9,
        immediate: nativeStringDataOffset,
        shift: 0,
        setFlags: false,
      });
      imm(11, nativeStringSplitCacheEntries * 2);
      const zero = instructions.length;
      emit({
        op: "stp",
        width: 64,
        rt: "zr",
        rt2: "zr",
        rn: 10,
        offset: 16,
        mode: "post",
      });
      emit({
        op: "sub-imm",
        width: 64,
        rd: 11,
        rn: 11,
        immediate: 1,
        shift: 0,
        setFlags: true,
      });
      emit({
        op: "b.cond",
        condition: "ne",
        displacement: (zero - instructions.length) * 4,
      });
      rawLoad(10, contextOffset);
      emit({ op: "ldr", width: 64, rt: 14, rn: 10, offset: 8 });
      emit({
        op: "sub-reg",
        width: 64,
        rd: 13,
        rn: 9,
        rm: 14,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      emit({
        op: "ldr",
        width: 64,
        rt: 12,
        rn: 10,
        offset: nativeAllocationStateOffset,
      });
      emit({
        op: "str",
        width: 32,
        rt: 13,
        rn: 12,
        offset: stateWord,
      });
      patchInstruction(have, {
        op: "cbnz",
        width: 64,
        rt: 13,
        displacement: (instructions.length - have) * 4,
      });
      rawValue(9, op.string);
      rawValue(10, op.separator);
      splitEntry();
      rawValue(16, op.value);
      emit({
        op: "stp",
        width: 64,
        rt: 9,
        rt2: 10,
        rn: 13,
        offset: nativeStringDataOffset,
        mode: "offset",
      });
      emit({
        op: "str",
        width: 64,
        rt: 16,
        rn: 13,
        offset: nativeStringDataOffset + 16,
      });
      patchSplitExits();
      break;
    }
    case "string-ascii-case": {
      // A string of the same length and kind, its letters mapped
      // by the helper.
      allocate(
        () => {
          rawValue(9, op.string);
          emit({
            op: "ldr",
            width: 32,
            rt: 11,
            rn: 9,
            offset: nativeStringLengthOffset,
          });
          emit({ op: "ldr", width: 64, rt: 14, rn: 9, offset: 0 });
          emit({
            op: "ubfm",
            width: 64,
            rd: 14,
            rn: 14,
            immr: 48,
            imms: 48,
          });
          prepareStringSize(14);
        },
        (rd) => rawLoad(rd, allocationOffset),
      );
      saveRaw(9, op.id);
      rawLoad(10, allocationOffset + 24);
      emit({ op: "str", width: 64, rt: 10, rn: 9, offset: 0 });
      // The source may have moved at the allocation safepoint.
      rawValue(10, op.string);
      emit({
        op: "ldr",
        width: 32,
        rt: 11,
        rn: 10,
        offset: nativeStringLengthOffset,
      });
      emit({
        op: "str",
        width: 64,
        rt: 11,
        rn: 9,
        offset: nativeStringLengthOffset,
      });
      callHelper(op.upper ? "string-ascii-upper" : "string-ascii-lower");
      break;
    }
    case "string-copy-latin1":
      latin1Index(op.offset, 14);
      latin1Index(op.begin, 11);
      latin1Index(op.limit, 12);
      rawValue(9, op.string);
      latin1Range(nativeStringLengthOffset);
      emit({
        op: "sub-reg",
        width: 64,
        rd: 15,
        rn: 12,
        rm: 11,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      // offset + count <= bytes.length.
      rawValue(10, op.bytes);
      emit({
        op: "ldr",
        width: 32,
        rt: 13,
        rn: 10,
        offset: nativeArrayLengthOffset,
      });
      emit({
        op: "add-reg",
        width: 64,
        rd: 16,
        rn: 14,
        rm: 15,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: 16,
        rm: 13,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
      trapIf({ op: "b.cond", condition: "hi" });
      emit({
        op: "ldr",
        width: 64,
        rt: 10,
        rn: 10,
        offset: nativeArrayDataOffset,
      });
      emit({
        op: "add-reg",
        width: 64,
        rd: 14,
        rn: 10,
        rm: 14,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      callHelper("string-copy-latin1");
      latin1Count(op.id);
      break;
    case "string-ascii-prefix":
      latin1Index(op.begin, 11);
      latin1Index(op.limit, 12);
      rawValue(9, op.string);
      latin1Range(nativeStringLengthOffset);
      emit({
        op: "sub-reg",
        width: 64,
        rd: 15,
        rn: 12,
        rm: 11,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      callHelper("string-ascii-prefix");
      emit({
        op: "add-reg",
        width: 64,
        rd: 9,
        rn: 9,
        rm: 11,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      latin1Count(op.id);
      break;
    case "string-utf8-length":
      latin1Index(op.begin, 11);
      latin1Index(op.limit, 12);
      rawValue(9, op.string);
      latin1Range(nativeStringLengthOffset);
      emit({
        op: "sub-reg",
        width: 64,
        rd: 15,
        rn: 12,
        rm: 11,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      callHelper("string-utf8-length");
      latin1Count(op.id);
      break;
    case "string-write-utf8":
      latin1Index(op.offset, 14);
      latin1Index(op.begin, 11);
      latin1Index(op.limit, 12);
      rawValue(9, op.string);
      latin1Range(nativeStringLengthOffset);
      emit({
        op: "sub-reg",
        width: 64,
        rd: 15,
        rn: 12,
        rm: 11,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      // offset <= bytes.length; the capacity is the rest.
      rawValue(10, op.bytes);
      emit({
        op: "ldr",
        width: 32,
        rt: 13,
        rn: 10,
        offset: nativeArrayLengthOffset,
      });
      emit({
        op: "sub-reg",
        width: 64,
        rd: 12,
        rn: 13,
        rm: 14,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
      trapIf({ op: "b.cond", condition: "cc" });
      emit({
        op: "ldr",
        width: 64,
        rt: 10,
        rn: 10,
        offset: nativeArrayDataOffset,
      });
      emit({
        op: "add-reg",
        width: 64,
        rd: 14,
        rn: 10,
        rm: 14,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      callHelper("string-write-utf8");
      if (op.written === true) {
        // Remaining capacity is in x12; bytes written = (bytes.length - offset) - x12.
        rawValue(10, op.bytes);
        emit({
          op: "ldr",
          width: 32,
          rt: 13,
          rn: 10,
          offset: nativeArrayLengthOffset,
        });
        latin1Index(op.offset, 14);
        emit({
          op: "sub-reg",
          width: 64,
          rd: 13,
          rn: 13,
          rm: 14,
          shift: "lsl",
          amount: 0,
          setFlags: false,
        });
        emit({
          op: "sub-reg",
          width: 64,
          rd: 9,
          rn: 13,
          rm: 12,
          shift: "lsl",
          amount: 0,
          setFlags: false,
        });
      } else {
        // The helper yields the units encoded; the result is the
        // index after them.
        latin1Index(op.begin, 11);
        emit({
          op: "add-reg",
          width: 64,
          rd: 9,
          rn: 9,
          rm: 11,
          shift: "lsl",
          amount: 0,
          setFlags: false,
        });
      }
      latin1Count(op.id);
      break;
    case "string-flat": {
      // 1 unless the sliced flag (bit 17 of the header's high
      // word) is set.
      const string = rawRegister(op.string, 9);
      emit({ op: "ldr", width: 32, rt: 10, rn: string, offset: 4 });
      emit({
        op: "ubfm",
        width: 64,
        rd: 10,
        rn: 10,
        immr: slicedHighBit,
        imms: slicedHighBit,
      });
      emit({ op: "movz", width: 64, rd: 9, immediate: 1, shift: 0 });
      emit({
        op: "sub-reg",
        width: 64,
        rd: 9,
        rn: 9,
        rm: 10,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      latin1Count(op.id);
      break;
    }
    case "string-flatten-into": {
      // x11 address and x12 byteLength: exact integers in
      // [0, 2^53) (else -1), a nonzero 8-byte-aligned address and
      // an end below 2^53.
      const rejects: { index: number; branch: Branch }[] = [];
      const reject = (branch: Branch): void => {
        rejects.push({ index: instructions.length, branch });
        emit(branchAt(branch, 0));
      };
      const windowWord = (id: number, rd: number): void => {
        if (exactInteger(id)) intOperand(id, rd);
        else {
          const operand = floatOperand(id, 0);
          emit({ op: "fcvtzs-x-d", rd, rn: operand });
          emit({ op: "scvtf-d-x", rd: 1, rn: rd });
          emit({ op: "fcmp", rn: operand, rm: 1 });
          reject({ op: "b.cond", condition: "ne" });
        }
        emit({
          op: "ubfm",
          width: 64,
          rd: 16,
          rn: rd,
          immr: 53,
          imms: 63,
        });
        reject({ op: "cbnz", width: 64, rt: 16 });
      };
      windowWord(op.address, 11);
      windowWord(op.byteLength, 12);
      reject({ op: "cbz", width: 64, rt: 11 });
      emit({
        op: "ubfm",
        width: 64,
        rd: 16,
        rn: 11,
        immr: 0,
        imms: 2,
      });
      reject({ op: "cbnz", width: 64, rt: 16 });
      emit({
        op: "add-reg",
        width: 64,
        rd: 16,
        rn: 11,
        rm: 12,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      emit({
        op: "ubfm",
        width: 64,
        rd: 16,
        rn: 16,
        immr: 53,
        imms: 63,
      });
      reject({ op: "cbnz", width: 64, rt: 16 });
      // x16 the flat header and x17 the length; x13 the units (a
      // slice's parent's, from its start).
      rawValue(10, op.string);
      emit({ op: "ldr", width: 64, rt: 16, rn: 10, offset: 0 });
      emit({
        op: "ldr",
        width: 32,
        rt: 17,
        rn: 10,
        offset: nativeStringLengthOffset,
      });
      emit({
        op: "add-imm",
        width: 64,
        rd: 13,
        rn: 10,
        immediate: nativeStringDataOffset,
        shift: 0,
        setFlags: false,
      });
      emit({ op: "tbz", rt: 16, bit: slicedBit, displacement: 24 });
      emit({
        op: "ldp",
        width: 64,
        rt: 14,
        rt2: 13,
        rn: 10,
        offset: nativeStringSlicedStartOffset,
        mode: "offset",
      });
      emit({
        op: "add-reg",
        width: 64,
        rd: 13,
        rn: 13,
        rm: 14,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      emit({
        op: "add-imm",
        width: 64,
        rd: 13,
        rn: 13,
        immediate: nativeStringDataOffset,
        shift: 0,
        setFlags: false,
      });
      emit({
        op: "movz",
        width: 64,
        rd: 14,
        immediate: nativeStringSlicedFlag,
        shift: 48,
      });
      emit({
        op: "sub-reg",
        width: 64,
        rd: 16,
        rn: 16,
        rm: 14,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      // x15 the data bytes; x9 the extent, align8(16 + max(bytes,
      // 8)) (nativeFlatStringExtent), at most byteLength.
      emit({
        op: "add-reg",
        width: 64,
        rd: 15,
        rn: "zr",
        rm: 17,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      emit({
        op: "tbnz",
        rt: 16,
        bit: nativeHeaderFlagsShift,
        displacement: 8,
      });
      emit({
        op: "add-reg",
        width: 64,
        rd: 15,
        rn: 15,
        rm: 15,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      emit({
        op: "movz",
        width: 64,
        rd: 9,
        immediate: nativeStringMinimumDataBytes,
        shift: 0,
      });
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: 15,
        rm: 9,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
      emit({
        op: "csel",
        width: 64,
        rd: 9,
        rn: 15,
        rm: 9,
        condition: "hi",
      });
      emit({
        op: "add-imm",
        width: 64,
        rd: 9,
        rn: 9,
        immediate: nativeStringDataOffset + 7,
        shift: 0,
        setFlags: false,
      });
      emit({
        op: "ubfm",
        width: 64,
        rd: 9,
        rn: 9,
        immr: 3,
        imms: 63,
      });
      emit({
        op: "ubfm",
        width: 64,
        rd: 9,
        rn: 9,
        immr: 61,
        imms: 60,
      });
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
      reject({ op: "b.cond", condition: "hi" });
      // The last two words first (padding, at most 15 bytes,
      // stays zero), then the header and length, then the units.
      emit({
        op: "add-reg",
        width: 64,
        rd: 14,
        rn: 11,
        rm: 9,
        shift: "lsl",
        amount: 0,
        setFlags: false,
      });
      emit({
        op: "stp",
        width: 64,
        rt: "zr",
        rt2: "zr",
        rn: 14,
        offset: -16,
        mode: "offset",
      });
      emit({
        op: "stp",
        width: 64,
        rt: 16,
        rt2: 17,
        rn: 11,
        offset: 0,
        mode: "offset",
      });
      emit({
        op: "add-imm",
        width: 64,
        rd: 14,
        rn: 11,
        immediate: nativeStringDataOffset,
        shift: 0,
        setFlags: false,
      });
      callHelper("bytes-copy");
      const written = instructions.length;
      emit({ op: "b", displacement: 0 });
      for (const site of rejects) {
        if (site === undefined) throw "flatten reject invariant";
        patchInstruction(
          site.index,
          branchAt(site.branch, (instructions.length - site.index) * 4),
        );
      }
      emit({ op: "movz", width: 64, rd: 9, immediate: 0, shift: 0 });
      emit({
        op: "sub-imm",
        width: 64,
        rd: 9,
        rn: 9,
        immediate: 1,
        shift: 0,
        setFlags: false,
      });
      patchInstruction(written, {
        op: "b",
        displacement: (instructions.length - written) * 4,
      });
      latin1Count(op.id);
      break;
    }
    default:
      throw "string text op invariant";
  }
}
