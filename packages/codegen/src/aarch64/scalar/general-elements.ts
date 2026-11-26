import {
  nativeArrayDataOffset,
  nativeArrayInlineOffset,
  nativeArrayLengthOffset,
} from "@tint/abi/host";
import {
  scalarByteLength,
  type Block,
  type RecordLayout,
  type ScalarType,
} from "@tint/ir/scalar";
import type { Instruction as MachineInstruction } from "../isa.ts";

export interface DirectGeneralTargetPlanContext {
  readonly block: Block;
  readonly slots: readonly (ScalarType | undefined)[];
  readonly slotOffset: (slot: number) => number;
  readonly valueUses: Uint32Array;
  readonly internValue: (id: number) => number;
  readonly foldedConstants: Uint8Array;
  readonly skippedStores?: readonly number[] | undefined;
  readonly fusionAccessId?: number | undefined;
  readonly fusionTestId?: number | undefined;
}

/** Plans direct-to-slot stack targets for single-use `general`-producing
 * instructions (`property-load`, `general-element-load`, `general-slot-load`,
 * `general-wrap`, `general-none`, `general-null`) stored into a `general` slot
 * in the same block, eliminating dead SSA temp round-trips and STLF stalls. */
export function planDirectGeneralTargets(
  ctx: DirectGeneralTargetPlanContext,
): Map<number, number> {
  const {
    block,
    slots,
    slotOffset,
    valueUses,
    internValue,
    foldedConstants,
    skippedStores,
    fusionAccessId,
    fusionTestId,
  } = ctx;
  const targets = new Map<number, number>();
  const directAtIndex = new Map<number, number>();
  const instructions = block.instructions;
  function overlaps(
    offA: number,
    bytesA: number,
    offB: number,
    bytesB: number,
  ): boolean {
    return offA < offB + bytesB && offB < offA + bytesA;
  }
  for (let sIdx = 0; sIdx < instructions.length; sIdx++) {
    const sOp = instructions[sIdx];
    if (
      sOp === undefined ||
      sOp.kind !== "store" ||
      slots[sOp.slot] !== "general"
    )
      continue;
    if (skippedStores !== undefined && skippedStores.indexOf(sIdx) >= 0)
      continue;
    const valId = sOp.value;
    const valIdx = internValue(valId);
    if (foldedConstants[valIdx] === 1 || targets.has(valId)) continue;
    let expectedUses = 1;
    if (fusionAccessId === valId && fusionTestId !== undefined) {
      for (let tIdx = 0; tIdx < instructions.length; tIdx++) {
        const tOp = instructions[tIdx];
        if (
          tOp !== undefined &&
          tOp.kind === "general-is" &&
          tOp.id === fusionTestId &&
          tOp.value === valId
        ) {
          expectedUses = 2;
          break;
        }
      }
    }
    if ((valueUses[valIdx] ?? 0) !== expectedUses) continue;
    const destOffset = slotOffset(sOp.slot);
    let defIdx = -1;
    let safe = true;
    for (let k = sIdx - 1; k >= 0; k--) {
      const mid = instructions[k];
      if (mid === undefined) {
        safe = false;
        break;
      }
      if (
        (mid.kind === "property-load" ||
          mid.kind === "general-element-load" ||
          mid.kind === "general-slot-load" ||
          mid.kind === "general-wrap" ||
          mid.kind === "general-none" ||
          mid.kind === "general-null" ||
          mid.kind === "call" ||
          mid.kind === "call-indirect") &&
        mid.id === valId
      ) {
        defIdx = k;
        break;
      }
      const existingDirect = directAtIndex.get(k);
      if (
        existingDirect !== undefined &&
        overlaps(existingDirect, 16, destOffset, 16)
      ) {
        safe = false;
        break;
      }
      if (mid.kind === "load" || mid.kind === "store") {
        const midType = slots[mid.slot];
        const midBytes = midType === undefined ? 16 : scalarByteLength(midType);
        if (overlaps(slotOffset(mid.slot), midBytes, destOffset, 16)) {
          safe = false;
          break;
        }
        continue;
      }
      if (
        mid.kind !== "constant" &&
        mid.kind !== "reference-none" &&
        mid.kind !== "boolean-none" &&
        mid.kind !== "string-none" &&
        mid.kind !== "general-none" &&
        mid.kind !== "general-null" &&
        mid.kind !== "general-is"
      ) {
        safe = false;
        break;
      }
    }
    if (!safe || defIdx < 0) continue;
    targets.set(valId, destOffset);
    directAtIndex.set(defIdx, destOffset);
  }
  return targets;
}

export type GeneralElementOp =
  | {
      readonly kind: "general-element-load";
      readonly id: number;
      readonly object: number;
      readonly index: number;
      readonly record: number;
      readonly field: number;
      readonly elementsRecord: number;
      readonly countField: number;
      readonly tagsField: number;
      readonly refsField: number;
      readonly numbersField: number;
    }
  | {
      readonly kind: "general-element-store";
      readonly id: number;
      readonly object: number;
      readonly index: number;
      readonly value: number;
      readonly record: number;
      readonly field: number;
      readonly elementsRecord: number;
      readonly countField: number;
      readonly tagsField: number;
      readonly refsField: number;
      readonly numbersField: number;
    }
  | {
      readonly kind: "general-slot-load";
      readonly id: number;
      readonly tags: number;
      readonly refs: number;
      readonly numbers: number;
      readonly index: number;
    }
  | {
      readonly kind: "general-slot-store";
      readonly id: number;
      readonly tags: number;
      readonly refs: number;
      readonly numbers: number;
      readonly index: number;
      readonly value: number;
    };

export interface PropertyStoreOp {
  readonly kind: "property-store";
  readonly id: number;
  readonly value: number;
  readonly entries?: number;
}

export interface GeneralElementEmitContext {
  readonly records: readonly RecordLayout[] | undefined;
  readonly jsConvert: boolean;
  readonly contextOffset: number;
  readonly fusedMiss: number | undefined;
  readonly directTargetOffset?: number;
  readonly instructionCount: () => number;
  readonly emit: (instruction: MachineInstruction) => void;
  readonly patchInstruction: (
    index: number,
    instruction: MachineInstruction,
  ) => void;
  readonly branchCond: (
    condition: "ne" | "lt" | "cs",
    targetBlock: number,
  ) => void;
  readonly branchCbz: (rt: number, targetBlock: number) => void;
  readonly imm: (register: number, value: number) => void;
  readonly generalPair: (
    register: number,
    offset: number,
    load: boolean,
  ) => void;
  readonly descriptorPointer: (record: number) => void;
  readonly valueOffset: (id: number) => number;
  readonly exactInteger: (id: number) => boolean;
  readonly intRegister: (id: number, fallback: number) => number;
  readonly floatOperand: (id: number, fallback: number) => number;
  readonly rawValue: (register: number, id: number) => void;
  readonly rawLoad: (register: number, offset: number) => void;
  readonly rawTarget: (id: number, fallback: number) => number;
  readonly saveRaw: (register: number, id: number) => void;
  readonly rememberDeferred: () => void;
}

export interface PropertyStoreEmitContext {
  readonly site: number;
  readonly siteShapeOffset: number;
  readonly shapeFieldOffset: number;
  readonly epochFieldOffset: number;
  readonly useColdStubs: boolean;
  readonly generationalBarriers: boolean;
  readonly fusedMiss: number | undefined;
  readonly misses: readonly number[];
  readonly instructionCount: () => number;
  readonly emit: (instruction: MachineInstruction) => void;
  readonly patchInstruction: (
    index: number,
    instruction: MachineInstruction,
  ) => void;
  readonly farBranch: (index: number, instruction: MachineInstruction) => void;
  readonly branchNe: (targetBlock: number) => void;
  readonly imm: (register: number, value: number) => void;
  readonly compare: (left: number, right: number) => void;
  readonly entryPair: (offset: number) => void;
  readonly generalPair: (
    register: number,
    offset: number,
    load: boolean,
  ) => void;
  readonly valueOffset: (id: number) => number;
  readonly rawTarget: (id: number, fallback: number) => number;
  readonly saveRaw: (register: number, id: number) => void;
  readonly rememberTransitionOrValue: (valueOffset: number) => void;
  readonly clearStackWords: () => void;
  readonly deleteForwardable: (block: number) => void;
  readonly pushColdStub: (stub: () => void) => void;
}

/** Emits polymorphic inline-cached property-store probing, transition epoch
 * validation, value write, generational write barrier, and optional cold stub
 * for secondary cache entries. */
export function emitPolymorphicPropertyStore(
  ctx: PropertyStoreEmitContext,
  op: PropertyStoreOp,
): void {
  const {
    site,
    siteShapeOffset,
    shapeFieldOffset,
    epochFieldOffset,
    useColdStubs,
    generationalBarriers,
    fusedMiss,
    misses,
    instructionCount,
    emit,
    patchInstruction,
    farBranch,
    branchNe,
    imm,
    compare,
    entryPair,
    generalPair,
    valueOffset,
    rawTarget,
    saveRaw,
    rememberTransitionOrValue,
    clearStackWords,
    deleteForwardable,
    pushColdStub,
  } = ctx;
  const storeEntries = op.entries ?? 1;
  const storeStride = 32;
  const storeEpochPtrAt = siteShapeOffset + storeEntries * storeStride;
  if (
    siteShapeOffset + (storeEntries - 1) * storeStride + 16 > 504 ||
    storeEpochPtrAt > 4088
  )
    throw "property cache layout invariant";
  function compareStoreShape(): void {
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
  const storeCold = storeEntries > 1 && useColdStubs;
  if (storeCold && fusedMiss !== undefined) deleteForwardable(fusedMiss);
  let furtherStore = -1;
  const storeHits: number[] = [];
  if (storeCold || storeEntries === 1) {
    entryPair(siteShapeOffset);
    if (storeCold) {
      compareStoreShape();
      furtherStore = instructionCount();
      emit({ op: "b.cond", condition: "ne", displacement: 0 });
    } else compare(9, 12);
    emit({
      op: "ldp",
      width: 64,
      rt: 14,
      rt2: 9,
      rn: site,
      offset: siteShapeOffset + 16,
      mode: "offset",
    });
  } else {
    for (let entry = 0; entry < storeEntries; entry++) {
      const at = siteShapeOffset + entry * storeStride;
      entryPair(at);
      if (entry === storeEntries - 1) {
        compare(9, 12);
        emit({
          op: "ldp",
          width: 64,
          rt: 14,
          rt2: 9,
          rn: site,
          offset: at + 16,
          mode: "offset",
        });
        break;
      }
      compareStoreShape();
      const next = instructionCount();
      emit({ op: "b.cond", condition: "ne", displacement: 0 });
      emit({
        op: "ldp",
        width: 64,
        rt: 14,
        rt2: 9,
        rn: site,
        offset: at + 16,
        mode: "offset",
      });
      storeHits.push(instructionCount());
      emit({ op: "b", displacement: 0 });
      patchInstruction(next, {
        op: "b.cond",
        condition: "ne",
        displacement: (instructionCount() - next) * 4,
      });
    }
  }
  for (const at of storeHits)
    patchInstruction(at, {
      op: "b",
      displacement: (instructionCount() - at) * 4,
    });
  const storeHitAt = instructionCount();
  if (storeCold) clearStackWords();
  // A transition (x14) also needs the epoch it was found under
  // (x9) to be current.
  const existing = instructionCount();
  emit({ op: "cbz", width: 64, rt: 14, displacement: 0 });
  emit({
    op: "ldr",
    width: 64,
    rt: 15,
    rn: site,
    offset: storeEpochPtrAt,
  });
  emit({
    op: "ldr",
    width: 64,
    rt: 15,
    rn: 15,
    offset: epochFieldOffset,
  });
  compare(15, 9);
  emit({
    op: "str",
    width: 64,
    rt: 14,
    rn: 10,
    offset: shapeFieldOffset,
  });
  patchInstruction(existing, {
    op: "cbz",
    width: 64,
    rt: 14,
    displacement: (instructionCount() - existing) * 4,
  });
  emit({
    op: "add-reg",
    width: 64,
    rd: 13,
    rn: 10,
    rm: 13,
    shift: "lsl",
    amount: 3,
    setFlags: false,
  });
  if (generationalBarriers)
    // Preserve `transition` (x14) in x11 across `generalPair(14, ...)` and
    // `rememberObject` (which clobbers x12/x13 before running `unneeded`).
    emit({
      op: "orr-reg",
      width: 64,
      rd: 11,
      rn: "zr",
      rm: 14,
    });
  generalPair(14, valueOffset(op.value), true);
  emit({
    op: "stp",
    width: 64,
    rt: 14,
    rt2: 15,
    rn: 13,
    offset: 0,
    mode: "offset",
  });
  if (generationalBarriers) {
    // Fast skip when no shape transition occurred (x11 === 0) and the stored
    // general value's tag (x14) carries no managed reference (reference tags:
    // 3=string, 5=object, 6=symbol, 7=bigint -> bitmask 0xe8). This avoids
    // 3 dependent context/heap/nursery loads and taken cold-stub jumps on
    // every primitive write to an old-generation object.
    const hasTransition = instructionCount();
    emit({ op: "cbnz", width: 64, rt: 11, displacement: 0 });
    imm(12, 0xe8);
    emit({ op: "lsrv", width: 64, rd: 12, rn: 12, rm: 14 });
    const skipBarrier = instructionCount();
    emit({ op: "tbz", rt: 12, bit: 0, displacement: 0 });
    patchInstruction(hasTransition, {
      op: "cbnz",
      width: 64,
      rt: 11,
      displacement: (instructionCount() - hasTransition) * 4,
    });
    rememberTransitionOrValue(valueOffset(op.value));
    patchInstruction(skipBarrier, {
      op: "tbz",
      rt: 12,
      bit: 0,
      displacement: (instructionCount() - skipBarrier) * 4,
    });
    clearStackWords();
  }
  let storeMissAt = -1;
  if (fusedMiss === undefined) {
    const target = rawTarget(op.id, 12);
    imm(target, 1);
    const stored = instructionCount();
    emit({ op: "b", displacement: 0 });
    storeMissAt = instructionCount();
    for (const missSite of misses)
      patchInstruction(missSite, {
        op: "b.cond",
        condition: "ne",
        displacement: (storeMissAt - missSite) * 4,
      });
    imm(target, 0);
    patchInstruction(stored, {
      op: "b",
      displacement: (instructionCount() - stored) * 4,
    });
    saveRaw(target, op.id);
  }
  if (storeCold) {
    const first = siteShapeOffset;
    pushColdStub((): void => {
      farBranch(furtherStore, {
        op: "b.cond",
        condition: "ne",
        displacement: (instructionCount() - furtherStore) * 4,
      });
      clearStackWords();
      for (let entry = 1; entry < storeEntries; entry++) {
        const at = first + entry * storeStride;
        entryPair(at);
        compareStoreShape();
        let next = -1;
        if (entry < storeEntries - 1) {
          next = instructionCount();
          emit({
            op: "b.cond",
            condition: "ne",
            displacement: 0,
          });
        } else if (fusedMiss !== undefined) branchNe(fusedMiss);
        else {
          const missed = instructionCount();
          emit({
            op: "b.cond",
            condition: "ne",
            displacement: 0,
          });
          farBranch(missed, {
            op: "b.cond",
            condition: "ne",
            displacement: (storeMissAt - missed) * 4,
          });
        }
        emit({
          op: "ldp",
          width: 64,
          rt: 14,
          rt2: 9,
          rn: site,
          offset: at + 16,
          mode: "offset",
        });
        const back = instructionCount();
        emit({ op: "b", displacement: 0 });
        farBranch(back, {
          op: "b",
          displacement: (storeHitAt - back) * 4,
        });
        if (next >= 0)
          patchInstruction(next, {
            op: "b.cond",
            condition: "ne",
            displacement: (instructionCount() - next) * 4,
          });
      }
    });
  }
}

/** Emits flat general-array element and slot load/store instructions. */
export function emitGeneralElementAccess(
  ctx: GeneralElementEmitContext,
  op: GeneralElementOp,
): void {
  const {
    records,
    jsConvert,
    contextOffset,
    fusedMiss,
    directTargetOffset,
    instructionCount,
    emit,
    patchInstruction,
    branchCond,
    branchCbz,
    imm,
    generalPair,
    descriptorPointer,
    valueOffset,
    exactInteger,
    intRegister,
    floatOperand,
    rawValue,
    rawLoad,
    rawTarget,
    saveRaw,
    rememberDeferred,
  } = ctx;
  const isElement =
    op.kind === "general-element-load" || op.kind === "general-element-store";
  const isLoad =
    op.kind === "general-element-load" || op.kind === "general-slot-load";
  let tagsOffset = 0,
    refsOffset = 0,
    numbersOffset = 0,
    slotTags = 0,
    slotRefs = 0,
    slotNumbers = 0;
  const misses: number[] = [];
  const ltMisses: number[] = [];
  const boundMisses: number[] = [];
  const cbzMisses: number[] = [];
  function emitMissCond(condition: "ne" | "lt" | "cs", bucket: number[]): void {
    if (fusedMiss !== undefined) branchCond(condition, fusedMiss);
    else {
      bucket.push(instructionCount());
      emit({ op: "b.cond", condition, displacement: 0 });
    }
  }
  let index = 12;
  if (
    op.kind === "general-element-load" ||
    op.kind === "general-element-store"
  ) {
    const elementsField = records?.[op.record]?.fields[op.field],
      elementFields = records?.[op.elementsRecord]?.fields;
    const countField = elementFields?.[op.countField],
      tagsField = elementFields?.[op.tagsField],
      refsField = elementFields?.[op.refsField],
      numbersField = elementFields?.[op.numbersField];
    if (
      elementsField === undefined ||
      countField === undefined ||
      tagsField === undefined ||
      refsField === undefined ||
      numbersField === undefined
    )
      throw "general element access layout invariant";
    tagsOffset = tagsField.offset;
    refsOffset = refsField.offset;
    numbersOffset = numbersField.offset;
    // Check object tag 5 (reference), OrdinaryObject descriptor,
    // non-null internalArrayElements -> x10.
    generalPair(9, valueOffset(op.object), true);
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 9,
      immediate: 5,
      shift: 0,
      setFlags: true,
    });
    emitMissCond("ne", misses);
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
    emitMissCond("ne", misses);
    emit({
      op: "ldr",
      width: 64,
      rt: 10,
      rn: 10,
      offset: elementsField.offset,
    });
    if (fusedMiss !== undefined) branchCbz(10, fusedMiss);
    else {
      cbzMisses.push(instructionCount());
      emit({ op: "cbz", width: 64, rt: 10, displacement: 0 });
    }
    // Unsigned integer index (x12 or intRegister) < generalCount.
    if (exactInteger(op.index)) {
      const reg = intRegister(op.index, 12);
      if (!isLoad && reg !== 12) {
        emit({
          op: "orr-reg",
          width: 64,
          rd: 12,
          rn: "zr",
          rm: reg,
        });
      } else {
        index = reg;
      }
      emit({
        op: "ldr-d",
        rt: 1,
        rn: 10,
        offset: countField.offset,
      });
      emit({ op: "fcvtzu-x-d", rd: 11, rn: 1 });
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: index,
        rm: 11,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
      emitMissCond("cs", boundMisses);
    } else if (jsConvert) {
      const number = floatOperand(op.index, 0);
      emit({ op: "fjcvtzs", rd: 12, rn: number });
      emitMissCond("ne", misses);
      emit({
        op: "sub-imm",
        width: 32,
        rd: "zr",
        rn: 12,
        immediate: 0,
        shift: 0,
        setFlags: true,
      });
      emitMissCond("lt", ltMisses);
      emit({
        op: "ldr-d",
        rt: 1,
        rn: 10,
        offset: countField.offset,
      });
      emit({ op: "fcmp", rn: number, rm: 1 });
      emitMissCond("cs", boundMisses);
    } else {
      const number = floatOperand(op.index, 0);
      emit({ op: "fcvtzu-x-d", rd: 12, rn: number });
      emit({ op: "ucvtf-d-x", rd: 1, rn: 12 });
      emit({ op: "fcmp", rn: 1, rm: number });
      emitMissCond("ne", misses);
      emit({
        op: "ldr-d",
        rt: 1,
        rn: 10,
        offset: countField.offset,
      });
      emit({ op: "fcmp", rn: number, rm: 1 });
      emitMissCond("cs", boundMisses);
    }
  } else {
    slotTags = op.tags;
    slotRefs = op.refs;
    slotNumbers = op.numbers;
    if (exactInteger(op.index)) {
      const reg = intRegister(op.index, 12);
      if (!isLoad && reg !== 12) {
        emit({
          op: "orr-reg",
          width: 64,
          rd: 12,
          rn: "zr",
          rm: reg,
        });
      } else {
        index = reg;
      }
    } else {
      const number = floatOperand(op.index, 0);
      emit({ op: "fcvtzu-x-d", rd: 12, rn: number });
    }
  }
  function loadFieldOrVal(
    rt: number,
    fieldOffset: number,
    valId: number,
  ): void {
    if (isElement)
      emit({
        op: "ldr",
        width: 64,
        rt,
        rn: 10,
        offset: fieldOffset,
      });
    else rawValue(rt, valId);
  }
  if (op.kind === "general-element-load" || op.kind === "general-slot-load") {
    // Load tag byte from generalTags[index].
    loadFieldOrVal(13, tagsOffset, slotTags);
    emit({
      op: "ldr",
      width: 64,
      rt: 13,
      rn: 13,
      offset: nativeArrayDataOffset,
    });
    emit({
      op: "ldr-indexed",
      size: 0,
      fp: false,
      rt: 9,
      rn: 13,
      rm: index,
      scaled: false,
    });
    // Fast straight-line path for tag 5 (object reference).
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 9,
      immediate: 5,
      shift: 0,
      setFlags: true,
    });
    const notRef5 = instructionCount();
    emit({ op: "b.cond", condition: "ne", displacement: 0 });
    const refLoad = instructionCount();
    loadFieldOrVal(11, refsOffset, slotRefs);
    emit({
      op: "add-imm",
      width: 64,
      rd: 11,
      rn: 11,
      immediate: nativeArrayInlineOffset,
      shift: 0,
      setFlags: false,
    });
    emit({
      op: "ldr-indexed",
      size: 3,
      fp: false,
      rt: 10,
      rn: 11,
      rm: index,
      scaled: true,
    });
    const storeResult = instructionCount();
    const offset = directTargetOffset ?? valueOffset(op.id);
    generalPair(9, offset, false);
    const doneFromHit = instructionCount();
    emit({ op: "b", displacement: 0 });
    patchInstruction(notRef5, {
      op: "b.cond",
      condition: "ne",
      displacement: (instructionCount() - notRef5) * 4,
    });
    // Tag 3 (string) shares refLoad.
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 9,
      immediate: 3,
      shift: 0,
      setFlags: true,
    });
    emit({
      op: "b.cond",
      condition: "eq",
      displacement: (refLoad - instructionCount()) * 4,
    });
    // Tag 1 (number): read from numbers[index].
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 9,
      immediate: 1,
      shift: 0,
      setFlags: true,
    });
    const notNum = instructionCount();
    emit({ op: "b.cond", condition: "ne", displacement: 0 });
    loadFieldOrVal(11, numbersOffset, slotNumbers);
    emit({
      op: "ldr",
      width: 64,
      rt: 11,
      rn: 11,
      offset: nativeArrayDataOffset,
    });
    emit({
      op: "ldr-indexed",
      size: 3,
      fp: false,
      rt: 10,
      rn: 11,
      rm: index,
      scaled: true,
    });
    emit({
      op: "b",
      displacement: (storeResult - instructionCount()) * 4,
    });
    patchInstruction(notNum, {
      op: "b.cond",
      condition: "ne",
      displacement: (instructionCount() - notNum) * 4,
    });
    // Tag 6 (boolean true) -> tag 2, payload 1.
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 9,
      immediate: 6,
      shift: 0,
      setFlags: true,
    });
    const notTrue = instructionCount();
    emit({ op: "b.cond", condition: "ne", displacement: 0 });
    imm(9, 2);
    imm(10, 1);
    emit({
      op: "b",
      displacement: (storeResult - instructionCount()) * 4,
    });
    patchInstruction(notTrue, {
      op: "b.cond",
      condition: "ne",
      displacement: (instructionCount() - notTrue) * 4,
    });
    // Tag 0 (undefined), 2 (false), or 4 (null): payload 0.
    emit({
      op: "orr-reg",
      width: 64,
      rd: 10,
      rn: "zr",
      rm: "zr",
    });
    emit({
      op: "b",
      displacement: (storeResult - instructionCount()) * 4,
    });
    if (isElement && fusedMiss === undefined) {
      for (const site of misses)
        patchInstruction(site, {
          op: "b.cond",
          condition: "ne",
          displacement: (instructionCount() - site) * 4,
        });
      for (const site of ltMisses)
        patchInstruction(site, {
          op: "b.cond",
          condition: "lt",
          displacement: (instructionCount() - site) * 4,
        });
      for (const site of boundMisses)
        patchInstruction(site, {
          op: "b.cond",
          condition: "cs",
          displacement: (instructionCount() - site) * 4,
        });
      for (const site of cbzMisses)
        patchInstruction(site, {
          op: "cbz",
          width: 64,
          rt: 10,
          displacement: (instructionCount() - site) * 4,
        });
      emit({
        op: "orr-reg",
        width: 64,
        rd: 9,
        rn: "zr",
        rm: "zr",
      });
      imm(10, 1);
      generalPair(9, offset, false);
    }
    patchInstruction(doneFromHit, {
      op: "b",
      displacement: (instructionCount() - doneFromHit) * 4,
    });
    return;
  }
  // Store path: x12 = index (and x10 = elements when isElement).
  const valOffset = valueOffset(op.value);
  rawLoad(9, valOffset);
  rawLoad(13, valOffset + 8);
  emit({
    op: "sub-imm",
    width: 64,
    rd: "zr",
    rn: 9,
    immediate: 1,
    shift: 0,
    setFlags: true,
  });
  const isNumber = instructionCount();
  emit({ op: "b.cond", condition: "eq", displacement: 0 });
  // Non-number write: load tagsData (x14) and refsVec (x11).
  loadFieldOrVal(14, tagsOffset, slotTags);
  emit({
    op: "ldr",
    width: 64,
    rt: 14,
    rn: 14,
    offset: nativeArrayDataOffset,
  });
  loadFieldOrVal(11, refsOffset, slotRefs);
  // Check tag 5 (reference) or tag 3 (string).
  emit({
    op: "sub-imm",
    width: 64,
    rd: "zr",
    rn: 9,
    immediate: 5,
    shift: 0,
    setFlags: true,
  });
  const isRef5 = instructionCount();
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
  const isRef3 = instructionCount();
  emit({ op: "b.cond", condition: "eq", displacement: 0 });
  // Primitive (tag 0 undefined, 2 boolean, 4 null): encode true as 6.
  emit({
    op: "sub-imm",
    width: 64,
    rd: "zr",
    rn: 9,
    immediate: 2,
    shift: 0,
    setFlags: true,
  });
  const notBool = instructionCount();
  emit({ op: "b.cond", condition: "ne", displacement: 0 });
  const boolFalse = instructionCount();
  emit({ op: "cbz", width: 64, rt: 13, displacement: 0 });
  imm(9, 6);
  patchInstruction(notBool, {
    op: "b.cond",
    condition: "ne",
    displacement: (instructionCount() - notBool) * 4,
  });
  patchInstruction(boolFalse, {
    op: "cbz",
    width: 64,
    rt: 13,
    displacement: (instructionCount() - boolFalse) * 4,
  });
  emit({
    op: "str-indexed",
    size: 0,
    fp: false,
    rt: 9,
    rn: 14,
    rm: 12,
    scaled: false,
  });
  emit({
    op: "add-imm",
    width: 64,
    rd: 11,
    rn: 11,
    immediate: nativeArrayInlineOffset,
    shift: 0,
    setFlags: false,
  });
  emit({
    op: "orr-reg",
    width: 64,
    rd: 14,
    rn: "zr",
    rm: "zr",
  });
  emit({
    op: "str-indexed",
    size: 3,
    fp: false,
    rt: 14,
    rn: 11,
    rm: 12,
    scaled: true,
  });
  const primHit = instructionCount();
  emit({ op: "b", displacement: 0 });
  // Managed pointer (tag 5 or 3): write tag, write ref, run barrier.
  patchInstruction(isRef5, {
    op: "b.cond",
    condition: "eq",
    displacement: (instructionCount() - isRef5) * 4,
  });
  patchInstruction(isRef3, {
    op: "b.cond",
    condition: "eq",
    displacement: (instructionCount() - isRef3) * 4,
  });
  emit({
    op: "str-indexed",
    size: 0,
    fp: false,
    rt: 9,
    rn: 14,
    rm: 12,
    scaled: false,
  });
  emit({
    op: "add-imm",
    width: 64,
    rd: 14,
    rn: 11,
    immediate: nativeArrayInlineOffset,
    shift: 0,
    setFlags: false,
  });
  emit({
    op: "str-indexed",
    size: 3,
    fp: false,
    rt: 13,
    rn: 14,
    rm: 12,
    scaled: true,
  });
  emit({
    op: "orr-reg",
    width: 64,
    rd: 9,
    rn: "zr",
    rm: 11,
  });
  rawLoad(10, contextOffset);
  rememberDeferred();
  const refHit = instructionCount();
  emit({ op: "b", displacement: 0 });
  // Number write (tag 1): miss if index >= numbers.length.
  patchInstruction(isNumber, {
    op: "b.cond",
    condition: "eq",
    displacement: (instructionCount() - isNumber) * 4,
  });
  loadFieldOrVal(14, numbersOffset, slotNumbers);
  emit({
    op: "ldr",
    width: 64,
    rt: 11,
    rn: 14,
    offset: nativeArrayLengthOffset,
  });
  emit({
    op: "sub-reg",
    width: 64,
    rd: "zr",
    rn: 12,
    rm: 11,
    shift: "lsl",
    amount: 0,
    setFlags: true,
  });
  emitMissCond("cs", boundMisses);
  emit({
    op: "ldr",
    width: 64,
    rt: 14,
    rn: 14,
    offset: nativeArrayDataOffset,
  });
  emit({
    op: "str-indexed",
    size: 3,
    fp: false,
    rt: 13,
    rn: 14,
    rm: 12,
    scaled: true,
  });
  loadFieldOrVal(14, tagsOffset, slotTags);
  emit({
    op: "ldr",
    width: 64,
    rt: 14,
    rn: 14,
    offset: nativeArrayDataOffset,
  });
  emit({
    op: "str-indexed",
    size: 0,
    fp: false,
    rt: 9,
    rn: 14,
    rm: 12,
    scaled: false,
  });
  loadFieldOrVal(11, refsOffset, slotRefs);
  emit({
    op: "add-imm",
    width: 64,
    rd: 11,
    rn: 11,
    immediate: nativeArrayInlineOffset,
    shift: 0,
    setFlags: false,
  });
  emit({
    op: "orr-reg",
    width: 64,
    rd: 14,
    rn: "zr",
    rm: "zr",
  });
  emit({
    op: "str-indexed",
    size: 3,
    fp: false,
    rt: 14,
    rn: 11,
    rm: 12,
    scaled: true,
  });
  patchInstruction(primHit, {
    op: "b",
    displacement: (instructionCount() - primHit) * 4,
  });
  patchInstruction(refHit, {
    op: "b",
    displacement: (instructionCount() - refHit) * 4,
  });
  if (fusedMiss !== undefined) return;
  const target = rawTarget(op.id, 12);
  imm(target, 1);
  const stored = instructionCount();
  emit({ op: "b", displacement: 0 });
  for (const site of misses)
    patchInstruction(site, {
      op: "b.cond",
      condition: "ne",
      displacement: (instructionCount() - site) * 4,
    });
  for (const site of ltMisses)
    patchInstruction(site, {
      op: "b.cond",
      condition: "lt",
      displacement: (instructionCount() - site) * 4,
    });
  for (const site of boundMisses)
    patchInstruction(site, {
      op: "b.cond",
      condition: "cs",
      displacement: (instructionCount() - site) * 4,
    });
  for (const site of cbzMisses)
    patchInstruction(site, {
      op: "cbz",
      width: 64,
      rt: 10,
      displacement: (instructionCount() - site) * 4,
    });
  imm(target, 0);
  patchInstruction(stored, {
    op: "b",
    displacement: (instructionCount() - stored) * 4,
  });
  saveRaw(target, op.id);
}

export interface GeneralEqualSpecializedContext {
  readonly instructionCount: () => number;
  readonly emit: (instruction: MachineInstruction) => void;
  readonly patchInstruction: (
    index: number,
    instruction: MachineInstruction,
  ) => void;
  readonly imm: (rd: number, value: number) => void;
  readonly generalPair: (first: number, offset: number, load: boolean) => void;
  readonly valueOffset: (id: number) => number;
  readonly rawValue: (target: number, id: number) => void;
  readonly rawLoad: (target: number, offset: number) => void;
  readonly floatLoad: (target: number, id: number, delta: number) => void;
  readonly stringEqual: () => void;
  readonly saveRaw: (source: number, id: number) => void;
  readonly clearStackWords: () => void;
}

/** Emits specialized AArch64 code for `general-equal` when at least one
 * operand has a statically known general tag (`0`=undefined, `1`=number,
 * `2`=boolean, `3`=string, `4`=null, `5`=reference), avoiding the full
 * polymorphic tag dispatch and `string-equal` machinery. */
export function emitSpecializedGeneralEqual(
  ctx: GeneralEqualSpecializedContext,
  opId: number,
  leftId: number,
  rightId: number,
  leftTag: number | undefined,
  rightTag: number | undefined,
): void {
  const {
    instructionCount,
    emit,
    patchInstruction,
    imm,
    generalPair,
    valueOffset,
    rawValue,
    rawLoad,
    floatLoad,
    stringEqual,
    saveRaw,
    clearStackWords,
  } = ctx;
  if (leftTag !== undefined && rightTag !== undefined) {
    if (leftTag !== rightTag) {
      imm(9, 0);
      saveRaw(9, opId);
      return;
    }
    if (leftTag === 0 || leftTag === 4) {
      imm(9, 1);
      saveRaw(9, opId);
      return;
    }
    if (leftTag === 1) {
      floatLoad(0, leftId, 8);
      floatLoad(1, rightId, 8);
      emit({ op: "fcmp", rn: 0, rm: 1 });
      emit({ op: "cset", rd: 9, condition: "eq" });
      saveRaw(9, opId);
      return;
    }
    rawLoad(9, valueOffset(leftId) + 8);
    rawLoad(10, valueOffset(rightId) + 8);
    if (leftTag === 3) {
      stringEqual();
      saveRaw(9, opId);
      return;
    }
    emit({
      op: "sub-reg",
      width: 64,
      rd: "zr",
      rn: 9,
      rm: 10,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
    emit({ op: "cset", rd: 9, condition: "eq" });
    saveRaw(9, opId);
    return;
  }
  const knownLeft = leftTag !== undefined;
  const knownTag = knownLeft ? leftTag : rightTag;
  const knownId = knownLeft ? leftId : rightId;
  const otherId = knownLeft ? rightId : leftId;
  if (knownTag === undefined) throw "specialized general-equal tag invariant";
  if (knownTag === 0 || knownTag === 4) {
    rawValue(9, otherId);
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 9,
      immediate: knownTag,
      shift: 0,
      setFlags: true,
    });
    emit({ op: "cset", rd: 9, condition: "eq" });
    saveRaw(9, opId);
    return;
  }
  if (knownTag === 2 || knownTag === 5) {
    generalPair(9, valueOffset(otherId), true);
    rawLoad(11, valueOffset(knownId) + 8);
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 9,
      immediate: knownTag,
      shift: 0,
      setFlags: true,
    });
    const mismatch = instructionCount();
    emit({ op: "b.cond", condition: "ne", displacement: 0 });
    emit({
      op: "sub-reg",
      width: 64,
      rd: "zr",
      rn: 10,
      rm: 11,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
    emit({ op: "cset", rd: 9, condition: "eq" });
    const done = instructionCount();
    emit({ op: "b", displacement: 0 });
    patchInstruction(mismatch, {
      op: "b.cond",
      condition: "ne",
      displacement: (instructionCount() - mismatch) * 4,
    });
    imm(9, 0);
    patchInstruction(done, {
      op: "b",
      displacement: (instructionCount() - done) * 4,
    });
    saveRaw(9, opId);
    return;
  }
  rawValue(9, otherId);
  emit({
    op: "sub-imm",
    width: 64,
    rd: "zr",
    rn: 9,
    immediate: knownTag,
    shift: 0,
    setFlags: true,
  });
  const mismatch = instructionCount();
  emit({ op: "b.cond", condition: "ne", displacement: 0 });
  if (knownTag === 1) {
    floatLoad(0, otherId, 8);
    floatLoad(1, knownId, 8);
    emit({ op: "fcmp", rn: 0, rm: 1 });
    emit({ op: "cset", rd: 9, condition: "eq" });
  } else {
    rawLoad(9, valueOffset(otherId) + 8);
    rawLoad(10, valueOffset(knownId) + 8);
    stringEqual();
  }
  const done = instructionCount();
  emit({ op: "b", displacement: 0 });
  patchInstruction(mismatch, {
    op: "b.cond",
    condition: "ne",
    displacement: (instructionCount() - mismatch) * 4,
  });
  imm(9, 0);
  patchInstruction(done, {
    op: "b",
    displacement: (instructionCount() - done) * 4,
  });
  clearStackWords();
  saveRaw(9, opId);
}
