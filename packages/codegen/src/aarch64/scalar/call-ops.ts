import {
  nativeActivationTopOffset,
  nativeArrayDataOffset,
  nativeArrayInlineOffset,
  nativeArrayLengthOffset,
} from "@tint/abi/host";
import {
  nativeFunctionByteLength,
  nativeFunctionDescriptorOffset,
  nativeFunctionEntryOffset,
  nativeFunctionEnvironmentOffset,
  nativeFunctionSignatureOffset,
} from "@tint/abi/function";
import type {
  Block as IRBlock,
  Instruction as IRInstruction,
  ScalarType,
} from "@tint/ir/scalar";
import { branchAt, type Branch, type Condition } from "../isa.ts";
import {
  activationArgumentsOffset,
  activationCalleeOffset,
  activationCountOffset,
  activationFrameOffset,
  scriptActualRegisterPairs,
  scriptArgumentLayout,
  scriptFirstActualRegister,
  scriptGpActualRegisterPairs,
} from "./abi.ts";
import type { FusedPropertyAccess } from "../../scalar/property-fusion.ts";
import type { BlockEmitContext, ScalarValue } from "./block-emitter.ts";
import type { Diagnostic } from "./index.ts";

export function emitCallOp(
  ctx: BlockEmitContext,
  instruction: IRInstruction,
  b: IRBlock,
  operationIndex: number,
  directGeneralTarget: Map<number, number> | undefined,
  fusion: FusedPropertyAccess | undefined,
  nextBlock: number | undefined,
  initialTailExitBlock: number | undefined,
): number | undefined {
  const op = instruction;
  let tailExitBlock = initialTailExitBlock;
  const {
    values,
    valueIds,
    slotOffsets,
    integerStorage,
    integerUses,
    wordStorage,
    scalarRegisters,
    setFrameStart,
    setTailExitBlock,
    address,
    branch,
    clearWordCaches,
    descriptorPointer,
    emit,
    exceptionalBranch,
    floatLoad,
    floatOperand,
    functionSignaturePointer,
    generalPair,
    guardDescriptor,
    imm,
    imm64,
    intRegister,
    linkLazyActivation,
    listReadShapes,
    localPointer,
    managedPointer,
    materializeInteger,
    patchInstruction,
    pollWorkerStop,
    provenListHeader,
    rawLoad,
    rawRegister,
    rawStore,
    rawTarget,
    rawValue,
    rememberObject,
    safepoint,
    saveRaw,
    scriptActualPair,
    teardown,
    traceThrow,
    trapIf,
    zeroWords,
    activationOffset,
    allowColdStubs,
    callSites,
    coldListReads,
    contextOffset,
    deferRememberSlow,
    directReturns,
    discardResultTargets,
    elidedStoreSource,
    emittedDirectStore,
    entryImports,
    environmentOffset,
    fn,
    foldedConstants,
    functionRecord,
    generationalBarriers,
    instructions,
    integerSlots,
    interruptible,
    lazyActivation,
    localSignatures,
    module,
    nanSentinelRemainders,
    nonNullValues,
    parameterKeys,
    provenNonNull,
    pureLeafNoActivation,
    resultOffset,
    resultPointerOffset,
    scriptEntryCallees,
    signatureImports,
    signatures,
    siteGeneralArguments,
    stackWords,
    start,
    throwTraces,
    tracker,
    vectorShapes,
    wordConstants,
    wordKinds,
    writeShapes,
    zeroValues,
  } = ctx;
  function fail(code: Diagnostic["code"], message: string): never {
    return ctx.fail(code, message);
  }
  function value(id: number): ScalarValue {
    const v = values[valueIds.intern(id)];
    if (v === undefined) throw "value invariant";
    return v;
  }
  function slotOffset(slot: number): number {
    const offset = slotOffsets[slot];
    if (offset === undefined) throw "slot invariant";
    return offset;
  }
  function typeOf(id: number): ScalarType {
    return value(id).type;
  }
  function storedAsInteger(id: number): boolean {
    return integerStorage[valueIds.intern(id)] === 1;
  }
  function markInteger(id: number): void {
    integerStorage[valueIds.intern(id)] = 1;
  }
  function wantsInteger(id: number): boolean {
    return (
      integerUses[valueIds.intern(id)] === 1 && value(id).type === "number"
    );
  }
  function storedAsWord(id: number): boolean {
    return wordStorage !== undefined && wordStorage[id] === 1;
  }
  function homeOf(id: number): number {
    const storage = scalarRegisters;
    return storage === undefined ? 0 : (storage[value(id).offset / 8] ?? 0);
  }
  switch (op.kind) {
    case "call-indirect":
    case "call": {
      pollWorkerStop();
      const target = signatures[op.target];
      if (target === undefined) throw "call signature invariant";
      const actuals =
        op.kind === "call-indirect" ? op.scriptArguments : undefined;
      // Dense list reads: the vector fast path inline, the
      // accessor call only for sparse roots, holes past the
      // length, non-index numbers and guard failures.
      let listReadDone: number | undefined;
      const listShape =
        op.kind === "call" &&
        op.id !== undefined &&
        op.environment === undefined &&
        !entryImports.has(op.target)
          ? listReadShapes(op.target)
          : undefined;
      const writeShape =
        op.kind === "call" &&
        op.id === undefined &&
        op.environment === undefined &&
        !entryImports.has(op.target)
          ? writeShapes[op.target]
          : undefined;
      const vectorHeader: number | undefined =
        op.kind === "call" &&
        op.id !== undefined &&
        op.environment === undefined &&
        !entryImports.has(op.target)
          ? vectorShapes[op.target]
          : undefined;
      const vectorResult = op.id;
      if (vectorHeader !== undefined && vectorResult !== undefined) {
        // A list's root vector, or none (zero) for a none list or
        // a root that is not a reference vector. Only a header of
        // another layout calls the accessor.
        const list = op.arguments[0],
          rootField = module.records?.[vectorHeader]?.fields[1];
        if (list === undefined) throw "list vector argument invariant";
        if (rootField === undefined || rootField.offset > 32760)
          throw "list vector layout invariant";
        const listRegister: number = rawRegister(list, 9),
          absent: number[] = [];
        emit({
          op: "orr-reg",
          width: 64,
          rd: 12,
          rn: "zr",
          rm: "zr",
        });
        const listAbsent: number = instructions.length;
        absent.push(listAbsent);
        emit({
          op: "cbz",
          width: 64,
          rt: listRegister,
          displacement: 0,
        });
        emit({
          op: "ldr",
          width: 64,
          rt: 10,
          rn: listRegister,
          offset: 0,
        });
        descriptorPointer(vectorHeader);
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
        const mismatch = instructions.length;
        emit({ op: "b.cond", condition: "ne", displacement: 0 });
        emit({
          op: "ldr",
          width: 64,
          rt: 10,
          rn: listRegister,
          offset: rootField.offset,
        });
        absent.push(instructions.length);
        emit({ op: "cbz", width: 64, rt: 10, displacement: 0 });
        emit({ op: "ldr", width: 64, rt: 11, rn: 10, offset: 0 });
        emit({
          op: "sub-imm",
          width: 64,
          rd: "zr",
          rn: 11,
          immediate: 6,
          shift: 0,
          setFlags: true,
        });
        emit({
          op: "csel",
          width: 64,
          rd: 12,
          rn: 10,
          rm: "zr",
          condition: "eq",
        });
        for (const site of absent) {
          if (site === undefined) throw "list vector patch invariant";
          patchInstruction(site, {
            op: "cbz",
            width: 64,
            rt: site === listAbsent ? listRegister : 10,
            displacement: (instructions.length - site) * 4,
          });
        }
        const resultRegister: number = rawTarget(vectorResult, 12);
        if (resultRegister !== 12)
          emit({
            op: "orr-reg",
            width: 64,
            rd: resultRegister,
            rn: "zr",
            rm: 12,
          });
        saveRaw(resultRegister, vectorResult);
        listReadDone = instructions.length;
        emit({ op: "b", displacement: 0 });
        patchInstruction(mismatch, {
          op: "b.cond",
          condition: "ne",
          displacement: (instructions.length - mismatch) * 4,
        });
      }
      if (writeShape !== undefined && writeShape.unchecked === true) {
        // Guarded hoisted push write: vector is proven non-null
        // reference vector and index is an integer in [0, vector.length).
        const rawVector = op.arguments[0],
          vector =
            rawVector === undefined
              ? undefined
              : (elidedStoreSource.get(rawVector) ?? rawVector),
          index = op.arguments[2],
          element = op.arguments[3];
        if (
          vector === undefined ||
          index === undefined ||
          element === undefined
        )
          throw "list write argument invariant";
        const vecReg = rawRegister(vector, 10),
          indexFact = valueIds.intern(index);
        let idxReg = 12;
        if (storedAsInteger(index)) idxReg = intRegister(index, 12);
        else if (wordKinds[indexFact] === 3)
          imm(12, wordConstants[indexFact] ?? 0);
        else {
          const number = floatOperand(index, 0);
          emit({ op: "fcvtzs-x-d", rd: 12, rn: number });
        }
        const elemNonNull =
          nonNullValues[valueIds.intern(element)] === 1 ||
          (provenNonNull !== undefined &&
            provenNonNull[valueIds.intern(element)] === 1);
        const elemReg = elemNonNull ? rawRegister(element, 13) : 13;
        if (!elemNonNull) {
          rawValue(13, element);
          const present = instructions.length;
          emit({ op: "cbnz", width: 64, rt: 13, displacement: 0 });
          emit({
            op: "orr-reg",
            width: 64,
            rd: 13,
            rn: "zr",
            rm: vecReg,
          });
          patchInstruction(present, {
            op: "cbnz",
            width: 64,
            rt: 13,
            displacement: (instructions.length - present) * 4,
          });
        }
        emit({
          op: "add-imm",
          width: 64,
          rd: 14,
          rn: vecReg,
          immediate: nativeArrayInlineOffset,
          shift: 0,
          setFlags: false,
        });
        emit({
          op: "str-indexed",
          size: 3,
          fp: false,
          rt: elemReg,
          rn: 14,
          rm: idxReg,
          scaled: true,
        });
        if (generationalBarriers) {
          rememberObject(deferRememberSlow(), vecReg, () =>
            rawLoad(10, contextOffset),
          );
        }
        break;
      }
      if (writeShape !== undefined) {
        // Dense list writes within the vector: store the element
        // (a stored undefined is the vector itself), extend the
        // logical length when writing at or past it, then the
        // barrier. Everything else calls the accessor.
        const list = op.arguments[0],
          index = op.arguments[1],
          element = op.arguments[2],
          layout = module.records?.[writeShape.header],
          lengthField = layout?.fields[0],
          rootField = layout?.fields[1];
        if (list === undefined || index === undefined || element === undefined)
          throw "list write argument invariant";
        if (
          lengthField === undefined ||
          rootField === undefined ||
          lengthField.type !== "number" ||
          lengthField.offset > 32760 ||
          rootField.offset > 32760
        )
          throw "list write layout invariant";
        // Branches to the accessor call: CBZ on a register, or a
        // conditional branch.
        const slow: {
          readonly site: number;
          readonly rt: number;
          readonly condition: Condition | undefined;
        }[] = [];
        const slowZero = (rt: number): void => {
          slow.push({
            site: instructions.length,
            rt,
            condition: undefined,
          });
          emit({ op: "cbz", width: 64, rt, displacement: 0 });
        };
        const slowIf = (condition: Condition): void => {
          slow.push({ site: instructions.length, rt: 0, condition });
          emit({ op: "b.cond", condition, displacement: 0 });
        };
        // Module record flow can prove the list argument is always
        // a list header (and never null), making those tests dead.
        const writeHeader = provenListHeader(list, writeShape.header),
          listReg = rawRegister(list, 9);
        if (writeHeader !== 2) slowZero(listReg);
        if (writeHeader === 0) {
          emit({
            op: "ldr",
            width: 64,
            rt: 10,
            rn: listReg,
            offset: 0,
          });
          descriptorPointer(writeShape.header);
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
          slowIf("ne");
        }
        emit({
          op: "ldr",
          width: 64,
          rt: 10,
          rn: listReg,
          offset: rootField.offset,
        });
        slowZero(10);
        emit({ op: "ldr", width: 64, rt: 11, rn: 10, offset: 0 });
        emit({
          op: "sub-imm",
          width: 64,
          rd: "zr",
          rn: 11,
          immediate: 6,
          shift: 0,
          setFlags: true,
        });
        slowIf("ne");
        const indexFact = valueIds.intern(index);
        if (storedAsInteger(index)) {
          const held = intRegister(index, 12);
          if (held !== 12)
            emit({
              op: "orr-reg",
              width: 64,
              rd: 12,
              rn: "zr",
              rm: held,
            });
        } else if (wordKinds[indexFact] === 3)
          imm(12, wordConstants[indexFact] ?? 0);
        else {
          const number = floatOperand(index, 0);
          emit({ op: "fcvtzs-x-d", rd: 12, rn: number });
          emit({ op: "scvtf-d-x", rd: 1, rn: 12 });
          emit({ op: "fcmp", rn: number, rm: 1 });
          slowIf("ne");
        }
        emit({
          op: "ldr",
          width: 32,
          rt: 11,
          rn: 10,
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
        slowIf("cs");
        const elemNonNull =
          nonNullValues[valueIds.intern(element)] === 1 ||
          (provenNonNull !== undefined &&
            provenNonNull[valueIds.intern(element)] === 1);
        const elemReg = elemNonNull ? rawRegister(element, 13) : 13;
        if (!elemNonNull) {
          rawValue(13, element);
          const present = instructions.length;
          emit({ op: "cbnz", width: 64, rt: 13, displacement: 0 });
          emit({
            op: "orr-reg",
            width: 64,
            rd: 13,
            rn: "zr",
            rm: 10,
          });
          patchInstruction(present, {
            op: "cbnz",
            width: 64,
            rt: 13,
            displacement: (instructions.length - present) * 4,
          });
        }
        emit({
          op: "add-imm",
          width: 64,
          rd: 14,
          rn: 10,
          immediate: nativeArrayInlineOffset,
          shift: 0,
          setFlags: false,
        });
        emit({
          op: "str-indexed",
          size: 3,
          fp: false,
          rt: elemReg,
          rn: 14,
          rm: 12,
          scaled: true,
        });
        // length = max(length, index + 1): indexes below the
        // vector length are exact, so are their doubles.
        emit({
          op: "add-imm",
          width: 64,
          rd: 15,
          rn: 12,
          immediate: 1,
          shift: 0,
          setFlags: false,
        });
        emit({ op: "scvtf-d-x", rd: 1, rn: 15 });
        emit({
          op: "ldr-d",
          rt: 0,
          rn: listReg,
          offset: lengthField.offset,
        });
        emit({ op: "fcmp", rn: 1, rm: 0 });
        const within = instructions.length;
        emit({ op: "b.cond", condition: "ls", displacement: 0 });
        emit({
          op: "str-d",
          rt: 1,
          rn: listReg,
          offset: lengthField.offset,
        });
        patchInstruction(within, {
          op: "b.cond",
          condition: "ls",
          displacement: (instructions.length - within) * 4,
        });
        if (generationalBarriers) {
          emit({
            op: "orr-reg",
            width: 64,
            rd: 9,
            rn: "zr",
            rm: 10,
          });
          rawLoad(10, contextOffset);
          rememberObject(deferRememberSlow());
        }
        listReadDone = instructions.length;
        emit({ op: "b", displacement: 0 });
        for (const entry of slow) {
          if (entry === undefined) throw "list write branch invariant";
          const displacement = (instructions.length - entry.site) * 4,
            condition = entry.condition;
          patchInstruction(
            entry.site,
            condition === undefined
              ? { op: "cbz", width: 64, rt: entry.rt, displacement }
              : { op: "b.cond", condition, displacement },
          );
        }
      }
      const listResult = op.id;
      if (listShape !== undefined && listResult !== undefined) {
        if (listShape.mode === "unchecked") {
          const vector = op.arguments[0],
            index = op.arguments[2];
          if (vector === undefined || index === undefined)
            throw "list read argument invariant";
          const vectorRegister = rawRegister(vector, 10),
            indexFact = valueIds.intern(index);
          let indexRegister = 12;
          if (storedAsInteger(index)) indexRegister = intRegister(index, 12);
          else if (wordKinds[indexFact] === 3)
            imm(12, wordConstants[indexFact] ?? 0);
          else {
            const number = floatOperand(index, 0);
            emit({ op: "fcvtzs-x-d", rd: 12, rn: number });
          }
          emit({
            op: "add-imm",
            width: 64,
            rd: 13,
            rn: vectorRegister,
            immediate: nativeArrayInlineOffset,
            shift: 0,
            setFlags: false,
          });
          emit({
            op: "ldr-indexed",
            size: 3,
            fp: false,
            rt: 11,
            rn: 13,
            rm: indexRegister,
            scaled: true,
          });
          const resultRegister = rawTarget(listResult, 11);
          emit({
            op: "sub-reg",
            width: 64,
            rd: "zr",
            rn: 11,
            rm: vectorRegister,
            shift: "lsl",
            amount: 0,
            setFlags: true,
          });
          emit({
            op: "csel",
            width: 64,
            rd: resultRegister,
            rn: "zr",
            rm: 11,
            condition: "eq",
          });
          saveRaw(resultRegister, listResult);
          break;
        }
        const cachedRead = listShape.mode === "cached",
          list = op.arguments[cachedRead ? 1 : 0],
          index = op.arguments[cachedRead ? 2 : 1],
          field = cachedRead
            ? undefined
            : module.records?.[listShape.header]?.fields[listShape.field];
        if (list === undefined || index === undefined)
          throw "list read argument invariant";
        if (!cachedRead && (field === undefined || field.offset > 32760))
          throw "list read layout invariant";
        const slow: { site: number; branch: Branch }[] = [];
        const toSlow = (branch: Branch): void => {
          slow.push({ site: instructions.length, branch });
          emit(branchAt(branch, 0));
        };
        // The root vector: the cached argument, or read from the
        // list header and tested to be a reference vector.
        let vectorRegister = 10;
        if (cachedRead) {
          const vector = op.arguments[0];
          if (vector === undefined) throw "list read argument invariant";
          vectorRegister = rawRegister(vector, 10);
          toSlow({ op: "cbz", width: 64, rt: vectorRegister });
        } else {
          const readHeader = provenListHeader(list, listShape.header);
          // The list's GP home when it has one (the slow call
          // reloads its arguments itself).
          const listRegister = rawRegister(list, 9);
          if (readHeader !== 2)
            toSlow({ op: "cbz", width: 64, rt: listRegister });
          if (readHeader === 0) {
            emit({
              op: "ldr",
              width: 64,
              rt: 10,
              rn: listRegister,
              offset: 0,
            });
            descriptorPointer(listShape.header);
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
            toSlow({ op: "b.cond", condition: "ne" });
          }
          emit({
            op: "ldr",
            width: 64,
            rt: 10,
            rn: listRegister,
            offset: field?.offset ?? 0,
          });
          toSlow({ op: "cbz", width: 64, rt: 10 });
          emit({ op: "ldr", width: 64, rt: 11, rn: 10, offset: 0 });
          emit({
            op: "sub-imm",
            width: 64,
            rd: "zr",
            rn: 11,
            immediate: 6,
            shift: 0,
            setFlags: true,
          });
          toSlow({ op: "b.cond", condition: "ne" });
        }
        const indexFact = valueIds.intern(index);
        let indexRegister = 12;
        if (storedAsInteger(index)) indexRegister = intRegister(index, 12);
        else if (wordKinds[indexFact] === 3)
          imm(12, wordConstants[indexFact] ?? 0);
        else {
          // Exact integers only; anything else takes the helper.
          const number = floatOperand(index, 0);
          emit({ op: "fcvtzs-x-d", rd: 12, rn: number });
          emit({ op: "scvtf-d-x", rd: 1, rn: 12 });
          emit({ op: "fcmp", rn: number, rm: 1 });
          toSlow({ op: "b.cond", condition: "ne" });
        }
        // Unsigned: negative indexes fail the length check too.
        emit({
          op: "ldr",
          width: 32,
          rt: 11,
          rn: vectorRegister,
          offset: nativeArrayLengthOffset,
        });
        emit({
          op: "sub-reg",
          width: 64,
          rd: "zr",
          rn: indexRegister,
          rm: 11,
          shift: "lsl",
          amount: 0,
          setFlags: true,
        });
        toSlow({ op: "b.cond", condition: "cs" });
        emit({
          op: "add-imm",
          width: 64,
          rd: 13,
          rn: vectorRegister,
          immediate: nativeArrayInlineOffset,
          shift: 0,
          setFlags: false,
        });
        emit({
          op: "ldr-indexed",
          size: 3,
          fp: false,
          rt: 11,
          rn: 13,
          rm: indexRegister,
          scaled: true,
        });
        // The result goes straight to its GP home when it has one.
        const resultRegister = rawTarget(listResult, 11);
        if (listShape.mode === "has") {
          // Present (a value or a stored undefined) unless null.
          emit({
            op: "sub-imm",
            width: 64,
            rd: "zr",
            rn: 11,
            immediate: 0,
            shift: 0,
            setFlags: true,
          });
          emit({ op: "cset", rd: resultRegister, condition: "ne" });
        } else {
          // A stored undefined is the vector itself and reads as
          // null, like a hole.
          emit({
            op: "sub-reg",
            width: 64,
            rd: "zr",
            rn: 11,
            rm: vectorRegister,
            shift: "lsl",
            amount: 0,
            setFlags: true,
          });
          emit({
            op: "csel",
            width: 64,
            rd: resultRegister,
            rn: "zr",
            rm: 11,
            condition: "eq",
          });
        }
        const p0 = target.parameters[0],
          p1 = target.parameters[1],
          p2 = target.parameters[2],
          vecId = op.arguments[0],
          listId = op.arguments[1],
          canColdListRead =
            allowColdStubs &&
            instructions.length - start / 4 < 131072 &&
            !interruptible &&
            b.exception === undefined &&
            listShape.mode === "cached" &&
            op.arguments.length === 3 &&
            vecId !== undefined &&
            listId !== undefined &&
            directReturns !== undefined &&
            directReturns[op.target] === 1 &&
            p0 !== undefined &&
            p0.kind === "integer" &&
            p0.index === 4 &&
            p1 !== undefined &&
            p1.kind === "integer" &&
            p1.index === 5 &&
            p2 !== undefined &&
            p2.kind === "float" &&
            p2.index === 0 &&
            storedAsInteger(index) &&
            nanSentinelRemainders[indexFact] !== 1 &&
            foldedConstants[indexFact] !== 1 &&
            contextOffset <= 32760 &&
            value(vecId).offset <= 32760 &&
            value(listId).offset <= 32760 &&
            value(index).offset <= 32760 &&
            value(listResult).offset <= 32760;
        saveRaw(resultRegister, listResult);
        if (canColdListRead && vecId !== undefined && listId !== undefined) {
          const resultReg = homeOf(listResult);
          if (resultReg < 32) stackWords.clear();
          coldListReads.push({
            slow,
            targetFn: op.target,
            vecReg: homeOf(vecId),
            vecOffset: value(vecId).offset,
            listReg: homeOf(listId),
            listOffset: value(listId).offset,
            idxReg: homeOf(index),
            idxOffset: value(index).offset,
            resultReg,
            resultOffset: value(listResult).offset,
            block: b.id,
            index: operationIndex,
            resume: instructions.length,
          });
          break;
        }
        listReadDone = instructions.length;
        emit({ op: "b", displacement: 0 });
        for (const entry of slow) {
          if (entry === undefined) throw "list read branch invariant";
          const branch = entry.branch,
            displacement = (instructions.length - entry.site) * 4;
          patchInstruction(entry.site, branchAt(branch, displacement));
        }
      }
      const importedEntry = entryImports.get(op.target);
      for (let i = 0; actuals === undefined && i < op.arguments.length; i++) {
        const arg = op.arguments[i],
          location = target.parameters[i];
        if (arg === undefined || location === undefined)
          throw "call argument invariant";
        if (
          value(arg).type === "general" ||
          value(arg).type === "optional-boolean"
        ) {
          if (location.kind === "integer")
            address(location.index, value(arg).offset);
          else {
            address(9, value(arg).offset);
            rawStore(9, location.index);
          }
        } else if (location.kind === "float") floatLoad(location.index, arg);
        else if (location.kind === "integer") rawValue(location.index, arg);
        else {
          rawValue(9, arg);
          rawStore(9, location.index);
        }
      }
      // Verified direct callees overwrite every consumed completion field.
      // The result buffer is not a GC root; no safepoint separates return
      // from payload consumption. Opaque calls retain initialization.
      if (
        (op.kind === "call-indirect" && actuals === undefined) ||
        importedEntry !== undefined
      )
        zeroWords([
          resultOffset,
          resultOffset + 8,
          resultOffset + 16,
          resultOffset + 24,
        ]);
      rawLoad(0, contextOffset);
      // A direct callee reads x1 only with an environment and x2
      // only with a receiver slot (see the prologue): otherwise
      // the hidden inputs need no zeroing. Indirect and imported
      // callees always receive them.
      const directCallee =
        op.kind === "call" && importedEntry === undefined
          ? module.functions[op.target]
          : undefined;
      if (op.kind === "call" && op.environment === "inherit")
        rawLoad(1, environmentOffset);
      else if (
        op.kind !== "call-indirect" &&
        actuals === undefined &&
        (directCallee === undefined ||
          directCallee.import === true ||
          directCallee.environment !== undefined ||
          directCallee.closureEnvironment !== undefined)
      )
        imm(1, 0);
      if (op.receiver !== undefined) address(2, value(op.receiver).offset);
      else if (
        actuals === undefined &&
        (directCallee === undefined ||
          directCallee.import === true ||
          directCallee.receiverSlot !== undefined)
      )
        imm(2, 0);
      // A tail call completes into this entry's own completion
      // area (abi.ts) and returns to this entry's caller.
      const tailCall = op.kind === "call-indirect" && op.tail === true;
      if (
        tailCall &&
        (actuals === undefined ||
          actuals.length > scriptActualRegisterPairs ||
          fn.scriptEntry !== true)
      )
        fail(
          "UNSUPPORTED",
          "tail calls pass register actuals between script entries",
        );
      if (tailCall) rawLoad(3, resultPointerOffset);
      else address(3, resultOffset);
      if (op.kind === "call-indirect") {
        rawValue(12, op.callee);
        if (
          actuals === undefined ||
          scriptEntryCallees?.has(op.callee) !== true
        ) {
          guardDescriptor(12, functionRecord);
          emit({
            op: "ldr",
            width: 64,
            rt: 10,
            rn: 12,
            offset: nativeFunctionSignatureOffset,
          });
          functionSignaturePointer(11, op.target);
          const alternate =
            op.discardResult === true &&
            !signatureImports.has(op.target) &&
            (localSignatures.byFunction[op.target] ?? 0) === 0
              ? discardResultTargets.get(parameterKeys[op.target] ?? "")
              : undefined;
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
          if (alternate === undefined)
            trapIf({ op: "b.cond", condition: "ne" });
          else {
            // The callee writes its normal result into the same
            // completion buffer. A void call consumes only the status.
            const matching: number[] = [];
            for (const candidate of alternate) {
              if (candidate === undefined)
                throw "discarded result signature invariant";
              matching.push(instructions.length);
              emit({
                op: "b.cond",
                condition: "eq",
                displacement: 0,
              });
              functionSignaturePointer(11, candidate);
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
            }
            trapIf({ op: "b.cond", condition: "ne" });
            for (const match of matching) {
              if (match === undefined)
                throw "discarded result branch invariant";
              patchInstruction(match, {
                op: "b.cond",
                condition: "eq",
                displacement: (instructions.length - match) * 4,
              });
            }
          }
        }
        emit({
          op: "ldr",
          width: 64,
          rt: 1,
          rn: 12,
          offset: nativeFunctionEnvironmentOffset,
        });
        emit({
          op: "ldr",
          width: 64,
          rt: 16,
          rn: 12,
          offset: nativeFunctionEntryOffset,
        });
        if (actuals !== undefined) {
          const layout = scriptArgumentLayout(actuals.length);
          // Overflow words stay in the caller frame. The stack map
          // roots them in place until the callee has returned.
          for (let i = layout.registerArguments; i < actuals.length; i++) {
            const argument = actuals[i];
            if (argument === undefined) throw "script operand invariant";
            const source = value(argument).offset;
            const target = (i - layout.registerArguments) * 16;
            generalPair(9, source, true);
            generalPair(9, target, false);
          }
          let listFolded = false;
          for (let i = 0; i < op.arguments.length; i++) {
            const argument = op.arguments[i],
              location = target.parameters[i];
            if (argument === undefined || location === undefined)
              throw "script call header invariant";
            if (i >= 2 && zeroValues[valueIds.intern(argument)] === 1) {
              if (location.kind === "pair") {
                imm(location.index, 0);
                imm(location.index + 1, 0);
              } else {
                imm(location.index, actuals.length * 2 + 1);
                listFolded = true;
              }
              continue;
            }
            const offset = value(argument).offset;
            if (location.kind === "pair")
              generalPair(location.index, offset, true);
            else rawLoad(location.index, offset);
          }
          for (let i = 0; i < scriptGpActualRegisterPairs; i++) {
            const register = scriptFirstActualRegister + i * 2;
            const argument = actuals[i];
            if (
              argument === undefined ||
              zeroValues[valueIds.intern(argument)] === 1
            ) {
              imm(register, 0);
              imm(register + 1, 0);
            } else {
              const offset = value(argument).offset;
              generalPair(register, offset, true);
            }
          }
          const extraActuals = Math.min(
            actuals.length,
            scriptActualRegisterPairs,
          );
          for (
            let i: number = scriptGpActualRegisterPairs;
            i < extraActuals;
            i++
          ) {
            const argument = actuals[i];
            if (argument === undefined) throw "script operand invariant";
            if (zeroValues[valueIds.intern(argument)] === 1) {
              const d = (i - scriptGpActualRegisterPairs) * 2;
              emit({ op: "fmov-d-x", rd: d, rn: "zr" });
              emit({ op: "fmov-d-x", rd: d + 1, rn: "zr" });
            } else {
              scriptActualPair(i, value(argument).offset, true, 17);
            }
          }
          if (!listFolded) {
            const list = instructions.length;
            emit({ op: "cbnz", width: 64, rt: 2, displacement: 0 });
            imm(2, actuals.length * 2 + 1);
            patchInstruction(list, {
              op: "cbnz",
              width: 64,
              rt: 2,
              displacement: (instructions.length - list) * 4,
            });
          }
        }
        if (tailCall) {
          // The callee replaces this frame: no safepoint, no
          // completion check, no return of our own.
          emit({
            op: "orr-reg",
            width: 64,
            rd: 17,
            rn: "zr",
            rm: 16,
          });
          teardown(true);
          emit({ op: "br", rn: 17 });
          setFrameStart(instructions.length * 4);
          tailExitBlock = b.id;
          setTailExitBlock(b.id);
          break;
        }
        if (lazyActivation) linkLazyActivation();
        emit({ op: "blr", rn: 16 });
      } else {
        const needsLazyLink =
          lazyActivation &&
          !(
            importedEntry === undefined &&
            pureLeafNoActivation !== undefined &&
            pureLeafNoActivation[op.target] === 1
          );
        if (needsLazyLink) linkLazyActivation();
        if (importedEntry !== undefined) {
          managedPointer(16, importedEntry);
          emit({ op: "blr", rn: 16 });
        } else branch({ op: "bl" }, op.target, undefined);
      }
      safepoint();
      if (
        lazyActivation &&
        !(
          op.kind === "call" &&
          importedEntry === undefined &&
          pureLeafNoActivation !== undefined &&
          pureLeafNoActivation[op.target] === 1
        )
      ) {
        emit({
          op: "ldr",
          width: 64,
          rt: 16,
          rn: "sp",
          offset: activationOffset,
        });
        rawLoad(17, contextOffset);
        emit({
          op: "str",
          width: 64,
          rt: 16,
          rn: 17,
          offset: nativeActivationTopOffset,
        });
      }
      if (actuals !== undefined && actuals.length > scriptActualRegisterPairs)
        siteGeneralArguments.set(
          callSites.length - 1,
          actuals.length - scriptActualRegisterPairs,
        );
      pollWorkerStop();
      emit({
        op: "sub-imm",
        width: 32,
        rd: "zr",
        rn: 0,
        immediate: 1,
        shift: 0,
        setFlags: true,
      });
      exceptionalBranch({ op: "b.cond", condition: "ne" });
      // The normal payload is consumed only after the completion check.
      const resultId = op.id;
      if (resultId !== undefined) {
        const registerResult =
          actuals !== undefined ||
          (op.kind === "call" &&
            importedEntry === undefined &&
            directReturns !== undefined &&
            directReturns[op.target] === 1);
        const directOffset =
          listReadDone === undefined
            ? directGeneralTarget?.get(resultId)
            : undefined;
        if (directOffset !== undefined) {
          emittedDirectStore[valueIds.intern(resultId)] = 1;
          if (registerResult) generalPair(1, directOffset, false);
          else {
            generalPair(9, resultOffset + 16, true);
            generalPair(9, directOffset, false);
          }
        } else {
          if (registerResult) saveRaw(1, resultId);
          else {
            rawLoad(9, resultOffset + 16);
            saveRaw(9, resultId);
          }
          if (
            value(resultId).type === "general" ||
            value(resultId).type === "optional-boolean"
          ) {
            if (registerResult) rawStore(2, value(resultId).offset + 8);
            else {
              rawLoad(10, resultOffset + 24);
              rawStore(10, value(resultId).offset + 8);
            }
          }
        }
      }
      if (listReadDone !== undefined)
        patchInstruction(listReadDone, {
          op: "b",
          displacement: (instructions.length - listReadDone) * 4,
        });
      break;
    }
    default:
      throw "call op invariant";
  }
  return tailExitBlock;
}
