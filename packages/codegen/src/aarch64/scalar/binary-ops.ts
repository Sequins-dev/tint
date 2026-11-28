import { isOneByteText, stringTextBytes } from "../../scalar/string-text.ts";
import { encodeFloat64 } from "@tint/foundation/binary/bytes";
import {
  visitInstructionOperands,
  type Block as IRBlock,
  type Instruction as IRInstruction,
  type ScalarType,
} from "@tint/ir/scalar";
import {
  branchAt,
  float64Immediate,
  logicalImmediate32,
  type Condition,
} from "../isa.ts";
import {
  nativeHeaderFlagUnit,
  nativeHeaderFlagsShift,
  nativeStringDataOffset,
  nativeStringLengthOffset,
  nativeStringSlicedStartOffset,
} from "@tint/abi/host";
import type { SelectDiamond } from "./block-entries.ts";
import {
  emitReciprocalRemainder,
  emitStoreReciprocal,
} from "./block-helpers.ts";
import { slicedHighBit } from "./string-ops.ts";
import type {
  ActiveFusedAdd,
  BlockBitTest,
  BlockEmitContext,
  ScalarValue,
} from "./block-emitter.ts";
import type { Diagnostic } from "./index.ts";

export function emitBinaryOp(
  ctx: BlockEmitContext,
  instruction: IRInstruction,
  b: IRBlock,
  blockBitTest: BlockBitTest | undefined,
  blockDiamond: SelectDiamond | undefined,
  comparisonIndex: number,
  comparisonValue: number | undefined,
  initialComparisonBranch: Condition | "emitted" | undefined,
  nextBlock: number | undefined,
  activeFusedAdd: Map<number, ActiveFusedAdd>,
  elidedOptOr: Map<number, number>,
): Condition | "emitted" | undefined {
  const op = instruction;
  let comparisonBranch = initialComparisonBranch;
  const {
    values,
    valueIds,
    slotOffsets,
    integerStorage,
    integerUses,
    wordStorage,
    scalarRegisters,
    absentFlags,
    binaryImmediate,
    branch,
    callHelper,
    clearWordCaches,
    emit,
    exactInteger,
    floatOperand,
    floatStore,
    floatTarget,
    imm,
    imm64,
    intOperand,
    intRegister,
    intTarget,
    integerArithmetic,
    listReadShapes,
    materializeInteger,
    multiplierShift,
    nonNegative,
    numberConstant,
    patchInstruction,
    rawLoad,
    rawRegister,
    rawTarget,
    rawValue,
    saveRaw,
    soleSum,
    stringEqual,
    truncatableAddend,
    wordMagnitude,
    wordMultiplierShift,
    wordOperand,
    allowColdStubs,
    canDeferColdStub,
    coldReciprocals,
    comparisonOperators,
    deferredAllocSlowPaths,
    deferredIntegers,
    directFloatAlias,
    directFloatTarget,
    directIntAlias,
    directIntTarget,
    elidedStoreSource,
    emittedDirectStore,
    entryImports,
    fn,
    foldedConstants,
    foldedStringWraps,
    fusedBitTests,
    fusedShifts,
    hoistedImulConst,
    instructions,
    literalTwo,
    low32Tree,
    lowWordStoreValues,
    nanSentinelMagnitudes,
    nanSentinelNonNegative,
    nanSentinelRemainders,
    nanSentinelSafe,
    nanSentinelWords,
    noneValues,
    nonzeroValues,
    options,
    pendingFusedAdd,
    reciprocalDivisorOffsets,
    rotateAmounts,
    rotateSources,
    rotatedShifts,
    scalarLoadedSlot,
    shiftedOps,
    soleConsumers,
    start,
    storeBypassCandidate,
    stringLiterals,
    truncatedSums,
    undefinedValues,
    unsignedTruncateCandidate,
    useCounts,
    valueUses,
    wordConstants,
    wordKinds,
    wrappedStringSources,
    wrappedStrings,
    zeroConstants,
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
    case "binary": {
      if (fusedBitTests[valueIds.intern(op.id)] === 1) break;
      if (blockBitTest !== undefined && op.id === comparisonValue) {
        materializeInteger(blockBitTest.source);
        const rn = wordOperand(blockBitTest.source, 9);
        emit({
          op: "ands-imm",
          width: 32,
          rd: "zr",
          rn,
          n: blockBitTest.n,
          immr: blockBitTest.immr,
          imms: blockBitTest.imms,
        });
        comparisonBranch =
          op.operator === "===" || op.operator === "==" ? "eq" : "ne";
        break;
      }
      const immediate = binaryImmediate(op),
        floatCompare =
          comparisonOperators.includes(op.operator) &&
          typeOf(op.left) === "number" &&
          !(exactInteger(op.left) && exactInteger(op.right));
      visitInstructionOperands(op, (id) => {
        if (id !== immediate && !floatCompare) materializeInteger(id);
      });
      if ((rotateAmounts[valueIds.intern(op.id)] ?? 0) !== 0)
        materializeInteger(rotateSources[valueIds.intern(op.id)] ?? 0);
      const shiftedInit = shiftedOps.get(op.id);
      if (shiftedInit !== undefined) materializeInteger(shiftedInit.source);
      const leftNone =
          noneValues[valueIds.intern(op.left)] === 1 &&
          foldedConstants[valueIds.intern(op.left)] === 1,
        rightNone =
          noneValues[valueIds.intern(op.right)] === 1 &&
          foldedConstants[valueIds.intern(op.right)] === 1;
      if (leftNone || rightNone) {
        // Equality with a folded none (a zero word) tests the other
        // operand's word against zero.
        if (leftNone && rightNone) imm(9, 0);
        else rawValue(9, leftNone ? op.right : op.left);
        emit({
          op: "sub-imm",
          width: 64,
          rd: "zr",
          rn: 9,
          immediate: 0,
          shift: 0,
          setFlags: true,
        });
        const condition: Condition =
          op.operator === "===" || op.operator === "==" ? "eq" : "ne";
        if (op.id === comparisonValue) comparisonBranch = condition;
        else {
          const target = rawTarget(op.id, 9);
          emit({ op: "cset", rd: target, condition });
          saveRaw(target, op.id);
        }
        break;
      }
      const leftLiteral = stringLiterals.get(op.left),
        rightLiteral = stringLiterals.get(op.right),
        literal = rightLiteral ?? leftLiteral;
      const literalOneByte = literal === undefined || isOneByteText(literal),
        literalBytes = literal === undefined ? 0 : stringTextBytes(literal);
      if (
        typeOf(op.left) === "string" &&
        literal !== undefined &&
        (literalBytes <= 8 ||
          (value(op.right).type === "string" && literal.length <= 32))
      ) {
        // Equality with a literal of at most 32 units: the header
        // (the kind: equal strings have equal kinds) and length
        // in x11, then the data in 8/4/2/1-byte chunks, never past
        // either string's last data byte. One-byte literals read
        // eight units a word. Up to eight data bytes, the chunks
        // lie inside any string's allocation (at least eight data
        // bytes), so the compare has no branch; longer literals
        // skip the data on a header or length mismatch (the usual
        // outcome in a chain of tests) and compare it with the
        // literal's pool copy.
        const oneByte = literalOneByte,
          width = oneByte ? 1 : 2,
          bytes = literalBytes,
          inline = bytes <= 8;
        const literalId = rightLiteral !== undefined ? op.right : op.left,
          other = rawRegister(
            rightLiteral !== undefined ? op.left : op.right,
            9,
          ),
          pool = inline ? 0 : rawRegister(literalId, 10);
        const equal: Condition =
          op.operator === "===" || op.operator === "==" ? "eq" : "ne";
        // One pair load: the header's high word (0 two-byte,
        // 0x10000 one-byte: the kind flag is bit 48) and the
        // length word. A sliced string (more than eight data
        // bytes: nativeStringSlicedMinimumLength) can equal only
        // a pooled literal: there, the high word stays
        // in w14, only its one-byte flag (bit 16) counts, and a
        // slice's data is read from its parent plus its start
        // (x15 then holds the base the chunks read from).
        emit({
          op: "ldp",
          width: 32,
          rt: inline ? 11 : 14,
          rt2: 12,
          rn: other,
          offset: 4,
          mode: "offset",
        });
        let base = other;
        if (!inline) {
          emit({
            op: "ubfm",
            width: 64,
            rd: 11,
            rn: 14,
            immr: 16,
            imms: 16,
          });
          if (oneByte)
            emit({
              op: "sub-imm",
              width: 64,
              rd: 11,
              rn: 11,
              immediate: 1,
              shift: 0,
              setFlags: false,
            });
        } else if (oneByte)
          emit({
            op: "sub-imm",
            width: 64,
            rd: 11,
            rn: 11,
            immediate: nativeHeaderFlagUnit / 4294967296 / 4096,
            shift: 12,
            setFlags: false,
          });
        emit({
          op: "sub-imm",
          width: 64,
          rd: 12,
          rn: 12,
          immediate: literal.length,
          shift: 0,
          setFlags: false,
        });
        emit({ op: "orr-reg", width: 64, rd: 11, rn: 11, rm: 12 });
        let shortcut = -1;
        if (!inline) {
          shortcut = instructions.length;
          emit({ op: "cbnz", width: 64, rt: 11, displacement: 0 });
          emit({
            op: "add-reg",
            width: 64,
            rd: 15,
            rn: "zr",
            rm: other,
            shift: "lsl",
            amount: 0,
            setFlags: false,
          });
          const flat = instructions.length;
          emit({
            op: "tbz",
            rt: 14,
            bit: slicedHighBit,
            displacement: 0,
          });
          emit({
            op: "ldp",
            width: 64,
            rt: 13,
            rt2: 15,
            rn: other,
            offset: nativeStringSlicedStartOffset,
            mode: "offset",
          });
          emit({
            op: "add-reg",
            width: 64,
            rd: 15,
            rn: 15,
            rm: 13,
            shift: "lsl",
            amount: 0,
            setFlags: false,
          });
          patchInstruction(flat, {
            op: "tbz",
            rt: 14,
            bit: slicedHighBit,
            displacement: (instructions.length - flat) * 4,
          });
          base = 15;
        }
        for (let at = 0; at < bytes;) {
          const take =
            bytes - at >= 8 ? 8 : bytes - at >= 4 ? 4 : bytes - at >= 2 ? 2 : 1;
          const offset = nativeStringDataOffset + at;
          function chunk(rt: number, base: number): void {
            if (take === 8)
              emit({ op: "ldr", width: 64, rt, rn: base, offset });
            else if (take === 4)
              emit({ op: "ldr", width: 32, rt, rn: base, offset });
            else if (take === 2) emit({ op: "ldrh", rt, rn: base, offset });
            else emit({ op: "ldrb", rt, rn: base, offset });
          }
          chunk(12, base);
          if (inline) {
            // The literal's little-endian data bytes at..at+take.
            let lo = 0,
              hi = 0,
              scale = 1;
            for (let k = 0; k < take; k++) {
              const byte = at + k,
                code = literal.charCodeAt(Math.floor(byte / width)),
                value =
                  width === 1 || byte % 2 === 0
                    ? code % 256
                    : Math.floor(code / 256);
              if (k === 4) scale = 1;
              if (k < 4) lo += value * scale;
              else hi += value * scale;
              scale *= 256;
            }
            imm64(13, lo, hi);
          } else chunk(13, pool);
          emit({ op: "eor-reg", width: 64, rd: 12, rn: 12, rm: 13 });
          emit({ op: "orr-reg", width: 64, rd: 11, rn: 11, rm: 12 });
          at += take;
        }
        if (shortcut >= 0)
          patchInstruction(shortcut, {
            op: "cbnz",
            width: 64,
            rt: 11,
            displacement: (instructions.length - shortcut) * 4,
          });
        emit({
          op: "sub-imm",
          width: 64,
          rd: "zr",
          rn: 11,
          immediate: 0,
          shift: 0,
          setFlags: true,
        });
        if (op.id === comparisonValue) comparisonBranch = equal;
        else {
          const target = rawTarget(op.id, 9);
          emit({ op: "cset", rd: target, condition: equal });
          saveRaw(target, op.id);
        }
        break;
      }
      if (
        typeOf(op.left) === "string" ||
        typeOf(op.left) === "optional-string"
      ) {
        const leftIdx = valueIds.intern(op.left),
          rightIdx = valueIds.intern(op.right),
          leftId =
            foldedStringWraps[leftIdx] === 1
              ? (wrappedStringSources[leftIdx] ?? op.left)
              : op.left,
          rightId =
            foldedStringWraps[rightIdx] === 1
              ? (wrappedStringSources[rightIdx] ?? op.right)
              : op.right;
        rawValue(9, leftId);
        rawValue(10, rightId);
        const leftPresent =
            typeOf(op.left) === "string" || wrappedStrings[leftIdx] === 1,
          rightPresent =
            typeOf(op.right) === "string" || wrappedStrings[rightIdx] === 1,
          equality = op.operator === "===" || op.operator === "==";
        const branchTerminator = b.terminator;
        if (
          op.id === comparisonValue &&
          comparisonIndex === b.instructions.length - 1 &&
          branchTerminator.kind === "branch" &&
          blockDiamond === undefined
        ) {
          stringEqual(leftPresent, rightPresent, {
            fnId: fn.id,
            equal: equality
              ? branchTerminator.consequent
              : branchTerminator.alternate,
            different: equality
              ? branchTerminator.alternate
              : branchTerminator.consequent,
            nextBlock,
          });
          comparisonBranch = "emitted";
        } else {
          stringEqual(leftPresent, rightPresent);
          if (!equality) {
            imm(10, 1);
            emit({ op: "eor-reg", width: 32, rd: 9, rn: 9, rm: 10 });
          }
          saveRaw(9, op.id);
        }
        break;
      }
      const leftSentinelIdx = valueIds.intern(op.left),
        rightSentinelIdx = valueIds.intern(op.right),
        leftSentinel = nanSentinelWords[leftSentinelIdx] === 1,
        rightSentinel = nanSentinelWords[rightSentinelIdx] === 1;
      if (
        (op.operator === "+" || op.operator === "-") &&
        (low32Tree[valueIds.intern(op.id)] === 1 ||
          nanSentinelSafe[valueIds.intern(op.id)] === 1) &&
        leftSentinel !== rightSentinel
      ) {
        const sentIdx = leftSentinel ? leftSentinelIdx : rightSentinelIdx,
          otherId = leftSentinel ? op.right : op.left,
          otherIdx = leftSentinel ? rightSentinelIdx : leftSentinelIdx,
          otherBound =
            exactInteger(otherId) && nanSentinelRemainders[otherIdx] !== 1
              ? wordMagnitude(otherIdx)
              : -1,
          sentBound = nanSentinelMagnitudes[sentIdx] ?? 0,
          totalBound = sentBound + otherBound;
        if (otherBound >= 0 && totalBound <= 9007199254740991) {
          const otherConst =
            immediate === otherId ? deferredIntegers.get(otherId) : undefined;
          const target = rawTarget(op.id, 9);
          if (
            leftSentinel &&
            otherConst !== undefined &&
            otherConst >= 0 &&
            otherConst <= 4095
          ) {
            const leftReg = rawRegister(op.left, 9);
            emit({
              op: op.operator === "+" ? "add-imm" : "sub-imm",
              width: 64,
              rd: target,
              rn: leftReg,
              immediate: otherConst,
              shift: 0,
              setFlags: false,
            });
          } else {
            if (immediate !== undefined) materializeInteger(immediate);
            const leftReg = leftSentinel
                ? rawRegister(op.left, 9)
                : intRegister(op.left, 9),
              rightReg = rightSentinel
                ? rawRegister(op.right, 10)
                : intRegister(op.right, 10);
            emit({
              op: op.operator === "+" ? "add-reg" : "sub-reg",
              width: 64,
              rd: target,
              rn: leftReg,
              rm: rightReg,
              shift: "lsl",
              amount: 0,
              setFlags: false,
            });
          }
          saveRaw(target, op.id);
          const idIdx = valueIds.intern(op.id);
          nanSentinelWords[idIdx] = 1;
          nanSentinelMagnitudes[idIdx] = Math.max(1, totalBound);
          if (
            op.operator === "+" &&
            nanSentinelNonNegative[sentIdx] === 1 &&
            nonNegative(otherId)
          )
            nanSentinelNonNegative[idIdx] = 1;
          break;
        }
      }
      if (
        truncatedSums[valueIds.intern(op.id)] === 1 ||
        (unsignedTruncateCandidate[valueIds.intern(op.id)] === 1 &&
          integerArithmetic(op))
      ) {
        // A 32-bit add/sub (either a product's low-word sum or an
        // elided `(x +/- y) >>> 0`): width 32 zero-extends into x_rd.
        const opIdx = valueIds.intern(op.id),
          direct = directIntTarget[opIdx] ?? 0,
          target = direct !== 0 ? direct - 1 : intTarget(op.id, 9);
        if (
          immediate !== undefined &&
          (op.operator === "+" || immediate === op.right)
        ) {
          const constant = deferredIntegers.get(immediate);
          if (constant === undefined) throw "immediate invariant";
          const source = intRegister(
              immediate === op.right ? op.left : op.right,
              9,
            ),
            addend = op.operator === "-" ? -constant : constant,
            magnitude = Math.abs(addend),
            shifted = magnitude > 4095;
          emit({
            op: addend < 0 ? "sub-imm" : "add-imm",
            width: 32,
            rd: target,
            rn: source,
            immediate: shifted ? magnitude / 4096 : magnitude,
            shift: shifted ? 12 : 0,
            setFlags: false,
          });
        } else {
          const left = intRegister(op.left, 9),
            right = intRegister(op.right, 10);
          emit({
            op: op.operator === "-" ? "sub-reg" : "add-reg",
            width: 32,
            rd: target,
            rn: left,
            rm: right,
            shift: "lsl",
            amount: 0,
            setFlags: false,
          });
        }
        if (direct === 0) saveRaw(target, op.id);
        else {
          emittedDirectStore[opIdx] = 1;
          if ((valueUses[opIdx] ?? 0) > 1) directIntAlias.set(op.id, target);
        }
        markInteger(op.id);
      } else if (integerArithmetic(op) && immediate !== undefined) {
        // An immediate operand: an add/sub immediate, or a
        // multiplier 2^k (LSL) or 2^k + 1 (ADD shifted).
        const constant = deferredIntegers.get(immediate);
        if (constant === undefined) throw "immediate invariant";
        const source = intRegister(
            immediate === op.right ? op.left : op.right,
            9,
          ),
          opIdx = valueIds.intern(op.id),
          direct = directIntTarget[opIdx] ?? 0,
          target = direct !== 0 ? direct - 1 : intTarget(op.id, 9);
        if (op.operator === "*") {
          const k = multiplierShift(constant);
          if (k === undefined) throw "multiplier invariant";
          // 2^k is even; 2^k + 1 odd.
          if (constant % 2 === 0)
            emit({
              op: "ubfm",
              width: 64,
              rd: target,
              rn: source,
              immr: 64 - k,
              imms: 63 - k,
            });
          else
            emit({
              op: "add-reg",
              width: 64,
              rd: target,
              rn: source,
              rm: source,
              shift: "lsl",
              amount: k,
              setFlags: false,
            });
        } else {
          const addend = op.operator === "-" ? -constant : constant,
            magnitude = Math.abs(addend),
            shifted = magnitude > 4095;
          emit({
            op: addend < 0 ? "sub-imm" : "add-imm",
            width: 64,
            rd: target,
            rn: source,
            immediate: shifted ? magnitude / 4096 : magnitude,
            shift: shifted ? 12 : 0,
            setFlags: false,
          });
        }
        if (direct === 0) saveRaw(target, op.id);
        else {
          emittedDirectStore[opIdx] = 1;
          if ((valueUses[opIdx] ?? 0) > 1) directIntAlias.set(op.id, target);
        }
        markInteger(op.id);
      } else if (integerArithmetic(op)) {
        // Bounded below 2^53 (kind 6), so the int64 result is
        // exact but for -0 (from a product, or a -0 operand),
        // which becomes +0: its uses do not observe the sign (see
        // findIntegerUses).
        // A product by 2^k or 2^k + 1 (k <= 4) is one shifted
        // add: shorter latency than MADD, the same int64 result.
        const rightIndex = valueIds.intern(op.right),
          factor =
            op.operator === "*" && wordKinds[rightIndex] === 3
              ? (wordConstants[rightIndex] ?? 0)
              : 0,
          shift =
            factor === 2 || factor === 3
              ? 1
              : factor === 4 || factor === 5
                ? 2
                : factor === 8 || factor === 9
                  ? 3
                  : factor === 16 || factor === 17
                    ? 4
                    : 0;
        const left = intRegister(op.left, 9),
          right = shift !== 0 ? left : intRegister(op.right, 10),
          opIdx = valueIds.intern(op.id),
          direct = directIntTarget[opIdx] ?? 0,
          target = direct !== 0 ? direct - 1 : intTarget(op.id, 9);
        emit(
          shift !== 0
            ? {
                op: "add-reg",
                width: 64,
                rd: target,
                rn: factor % 2 === 1 ? left : "zr",
                rm: left,
                shift: "lsl",
                amount: shift,
                setFlags: false,
              }
            : op.operator === "*"
              ? {
                  op: "madd",
                  width: 64,
                  rd: target,
                  rn: left,
                  rm: right,
                  ra: "zr",
                }
              : {
                  op: op.operator === "+" ? "add-reg" : "sub-reg",
                  width: 64,
                  rd: target,
                  rn: left,
                  rm: right,
                  shift: "lsl",
                  amount: 0,
                  setFlags: false,
                },
        );
        if (direct === 0) saveRaw(target, op.id);
        else {
          emittedDirectStore[opIdx] = 1;
          if ((valueUses[opIdx] ?? 0) > 1) directIntAlias.set(op.id, target);
        }
        markInteger(op.id);
      } else if (["+", "-", "*", "/", "min", "max"].includes(op.operator)) {
        const fusedOr =
          op.operator === "+" || op.operator === "-"
            ? pendingFusedAdd.get(op.id)
            : undefined;
        const isFusableInt = (id: number): boolean => {
          if (!storedAsInteger(id)) return false;
          const idx = valueIds.intern(id),
            k = wordKinds[idx] ?? 0;
          return (
            k === 2 ||
            k === 3 ||
            (k === 6 && wordMagnitude(idx) <= 0x10000000000000)
          );
        };
        const leftIsInt = isFusableInt(op.left),
          rightIsInt = isFusableInt(op.right);
        if (
          fusedOr !== undefined &&
          options.hostABI?.javascriptConversion?.kind === "baseline" &&
          leftIsInt !== rightIsInt &&
          typeOf(op.left) === "number" &&
          typeOf(op.right) === "number"
        ) {
          activeFusedAdd.set(fusedOr, {
            add: op.operator === "+",
            left: op.left,
            right: op.right,
            leftIsInt,
          });
          break;
        }
        const opIdx = valueIds.intern(op.id),
          direct = directFloatTarget[opIdx] ?? 0,
          target = direct !== 0 ? direct - 1 : floatTarget(op.id, 0);
        // IEEE-754 `x * 2 === x + x` bit-for-bit for every float64
        // (including ±0, ±Inf, NaN, subnormals). Only fold when the
        // `2` is a literal constant (not a loaded variable slot).
        if (op.operator === "*") {
          const leftTwo = literalTwo[valueIds.intern(op.left)] === 1,
            rightTwo = literalTwo[valueIds.intern(op.right)] === 1;
          if (leftTwo !== rightTwo) {
            const src = floatOperand(rightTwo ? op.left : op.right, 0);
            emit({ op: "fadd", rd: target, rn: src, rm: src });
            if (direct === 0) floatStore(target, op.id);
            else {
              emittedDirectStore[opIdx] = 1;
              if ((valueUses[opIdx] ?? 0) > 1)
                directFloatAlias.set(op.id, target);
            }
            break;
          }
        }
        const left = floatOperand(op.left, 0),
          right = floatOperand(op.right, 1);
        emit({
          op:
            op.operator === "+"
              ? "fadd"
              : op.operator === "-"
                ? "fsub"
                : op.operator === "*"
                  ? "fmul"
                  : op.operator === "/"
                    ? "fdiv"
                    : op.operator === "min"
                      ? "fmin"
                      : "fmax",
          rd: target,
          rn: left,
          rm: right,
        });
        if (direct === 0) floatStore(target, op.id);
        else {
          emittedDirectStore[opIdx] = 1;
          if ((valueUses[opIdx] ?? 0) > 1) directFloatAlias.set(op.id, target);
        }
      } else if (
        op.operator === "%" &&
        exactInteger(op.left) &&
        exactInteger(op.right)
      ) {
        // Exact integer operands (below 2^53) divide as int64s:
        // SDIV truncates toward zero, so MSUB leaves the
        // remainder with the dividend's sign, as in ECMAScript.
        // A nonzero divisor (a constant, or a nonzero slot's
        // value) needs no zero test; a zero divisor gives NaN. A
        // non-negative dividend's remainder is never -0, so with
        // a nonzero divisor it is an int64 result when its uses
        // take one; otherwise a zero remainder takes the
        // dividend's sign.
        const divisor = numberConstant(op.right),
          constant =
            divisor !== undefined &&
            Number.isSafeInteger(divisor) &&
            divisor !== 0
              ? divisor
              : undefined,
          // A nonzero slot's value never divides by zero either.
          nonzeroDivisor =
            constant !== undefined ||
            nonzeroValues[valueIds.intern(op.right)] === 1;
        intOperand(op.left, 9);
        if (constant === undefined) intOperand(op.right, 10);
        else {
          const lo = ((constant % 4294967296) + 4294967296) % 4294967296,
            hi = (Math.floor(constant / 4294967296) + 4294967296) % 4294967296;
          imm64(10, lo, hi);
        }
        const consumer = soleConsumers[valueIds.intern(op.id)],
          listReadConsumer =
            (useCounts[valueIds.intern(op.id)] ?? 0) === 1 &&
            consumer !== undefined &&
            consumer.kind === "call" &&
            consumer.id !== undefined &&
            consumer.environment === undefined &&
            !entryImports.has(consumer.target)
              ? listReadShapes(consumer.target)
              : undefined,
          listReadIndex =
            listReadConsumer !== undefined &&
            consumer !== undefined &&
            consumer.kind === "call" &&
            consumer.arguments[listReadConsumer.mode === "cached" ? 2 : 1] ===
              op.id;
        if (
          nonNegative(op.left) &&
          (nonzeroDivisor ? wantsInteger(op.id) : listReadIndex)
        ) {
          const target = intTarget(op.id, 11);
          if (nonzeroDivisor) {
            const divisorSlot =
                constant === undefined
                  ? (scalarLoadedSlot[valueIds.intern(op.right)] ?? 0)
                  : 0,
              recip =
                divisorSlot > 0
                  ? (reciprocalDivisorOffsets[divisorSlot - 1] ?? 0)
                  : 0;
            if (recip > 0)
              emitReciprocalRemainder(
                emit,
                patchInstruction,
                rawLoad,
                instructions,
                target,
                recip,
                allowColdStubs && instructions.length - start / 4 < 131072
                  ? coldReciprocals
                  : undefined,
              );
            else {
              emit({ op: "sdiv", width: 64, rd: 11, rn: 9, rm: 10 });
              emit({
                op: "msub",
                width: 64,
                rd: target,
                rn: 11,
                rm: 10,
                ra: 9,
              });
            }
          } else {
            const zeroDivisor = instructions.length;
            emit({ op: "cbz", width: 64, rt: 10, displacement: 0 });
            emit({ op: "sdiv", width: 64, rd: 11, rn: 9, rm: 10 });
            emit({
              op: "msub",
              width: 64,
              rd: target,
              rn: 11,
              rm: 10,
              ra: 9,
            });
            const done = instructions.length;
            emit({ op: "b", displacement: 0 });
            patchInstruction(zeroDivisor, {
              op: "cbz",
              width: 64,
              rt: 10,
              displacement: (instructions.length - zeroDivisor) * 4,
            });
            emit({
              op: "orn-reg",
              width: 64,
              rd: target,
              rn: "zr",
              rm: "zr",
            });
            patchInstruction(done, {
              op: "b",
              displacement: (instructions.length - done) * 4,
            });
            nanSentinelRemainders[valueIds.intern(op.id)] = 1;
          }
          saveRaw(target, op.id);
          markInteger(op.id);
          break;
        }
        const remIdIdx = valueIds.intern(op.id);
        if (
          !nonzeroDivisor &&
          nonNegative(op.left) &&
          nanSentinelSafe[remIdIdx] === 1 &&
          !exactInteger(op.id)
        ) {
          const leftBound = wordMagnitude(valueIds.intern(op.left)),
            rightBound = wordMagnitude(valueIds.intern(op.right)),
            remBound =
              leftBound >= 0 && rightBound >= 0
                ? Math.min(leftBound, rightBound)
                : Math.max(leftBound, rightBound);
          if (remBound >= 0 && remBound <= 9007199254740991) {
            const target = rawTarget(op.id, 11),
              divisorSlot =
                constant === undefined
                  ? (scalarLoadedSlot[valueIds.intern(op.right)] ?? 0)
                  : 0,
              recip =
                divisorSlot > 0
                  ? (reciprocalDivisorOffsets[divisorSlot - 1] ?? 0)
                  : 0;
            if (recip > 0)
              emitReciprocalRemainder(
                emit,
                patchInstruction,
                rawLoad,
                instructions,
                target,
                recip,
                allowColdStubs && instructions.length - start / 4 < 131072
                  ? coldReciprocals
                  : undefined,
                true,
              );
            else {
              const zeroDivisor = instructions.length;
              emit({ op: "cbz", width: 64, rt: 10, displacement: 0 });
              emit({ op: "sdiv", width: 64, rd: 11, rn: 9, rm: 10 });
              emit({
                op: "msub",
                width: 64,
                rd: target,
                rn: 11,
                rm: 10,
                ra: 9,
              });
              const done = instructions.length;
              emit({ op: "b", displacement: 0 });
              patchInstruction(zeroDivisor, {
                op: "cbz",
                width: 64,
                rt: 10,
                displacement: (instructions.length - zeroDivisor) * 4,
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
            nanSentinelWords[remIdIdx] = 1;
            nanSentinelMagnitudes[remIdIdx] = Math.max(1, remBound);
            nanSentinelNonNegative[remIdIdx] = 1;
            break;
          }
        }
        const target = floatTarget(op.id, 0);
        let zeroDivisor = -1;
        if (!nonzeroDivisor) {
          zeroDivisor = instructions.length;
          emit({ op: "cbz", width: 64, rt: 10, displacement: 0 });
        }
        emit({ op: "sdiv", width: 64, rd: 11, rn: 9, rm: 10 });
        emit({
          op: "msub",
          width: 64,
          rd: 11,
          rn: 11,
          rm: 10,
          ra: 9,
        });
        const nonzero = instructions.length;
        emit({ op: "cbnz", width: 64, rt: 11, displacement: 0 });
        if (storedAsInteger(op.left)) {
          // An int64 dividend is never -0: its sign bit decides.
          emit({ op: "fmov-d-x", rd: target, rn: "zr" });
          emit({ op: "tbz", rt: 9, bit: 63, displacement: 8 });
          emit({ op: "fneg", rd: target, rn: target });
        } else {
          // left * +0 is a zero with the dividend's sign.
          const left = floatOperand(op.left, 1);
          emit({ op: "fmov-d-x", rd: 2, rn: "zr" });
          emit({ op: "fmul", rd: target, rn: left, rm: 2 });
        }
        const zeroDone = instructions.length;
        emit({ op: "b", displacement: 0 });
        patchInstruction(nonzero, {
          op: "cbnz",
          width: 64,
          rt: 11,
          displacement: (instructions.length - nonzero) * 4,
        });
        emit({ op: "scvtf-d-x", rd: target, rn: 11 });
        if (zeroDivisor >= 0) {
          const divided = instructions.length;
          emit({ op: "b", displacement: 0 });
          patchInstruction(zeroDivisor, {
            op: "cbz",
            width: 64,
            rt: 10,
            displacement: (instructions.length - zeroDivisor) * 4,
          });
          // x % 0 is NaN.
          emit({
            op: "movz",
            width: 64,
            rd: 9,
            immediate: 0x7ff8,
            shift: 48,
          });
          emit({ op: "fmov-d-x", rd: target, rn: 9 });
          patchInstruction(divided, {
            op: "b",
            displacement: (instructions.length - divided) * 4,
          });
        }
        patchInstruction(zeroDone, {
          op: "b",
          displacement: (instructions.length - zeroDone) * 4,
        });
        floatStore(target, op.id);
      } else if (op.operator === "%") {
        // Operands that are exact 32-bit integers (a nonzero
        // divisor) divide inline: SDIV truncates toward zero, so
        // MSUB leaves the remainder with the dividend's sign, as
        // in ECMAScript; a zero remainder takes the dividend's
        // sign (-0 for negative dividends). The 32-bit
        // conversions saturate out of range, which the exactness
        // test rejects; INT32_MIN % -1 yields 0 (-0). Every other
        // operand calls the helper.
        const left = floatOperand(op.left, 0),
          right = floatOperand(op.right, 1),
          target = floatTarget(op.id, 0),
          slow: number[] = [];
        const exact = (register: number, word: number): void => {
          emit({ op: "fcvtzs-w-d", rd: word, rn: register });
          emit({ op: "scvtf-d-w", rd: 2, rn: word });
          emit({ op: "fcmp", rn: register, rm: 2 });
          slow.push(instructions.length);
          emit({ op: "b.cond", condition: "ne", displacement: 0 });
        };
        exact(left, 9);
        exact(right, 10);
        const zeroDivisor = instructions.length;
        emit({ op: "cbz", width: 32, rt: 10, displacement: 0 });
        emit({ op: "sdiv", width: 32, rd: 11, rn: 9, rm: 10 });
        emit({
          op: "msub",
          width: 32,
          rd: 11,
          rn: 11,
          rm: 10,
          ra: 9,
        });
        const nonzero = instructions.length;
        emit({ op: "cbnz", width: 32, rt: 11, displacement: 0 });
        // left * +0 is a zero with the dividend's sign.
        emit({ op: "fmov-d-x", rd: 2, rn: "zr" });
        emit({ op: "fmul", rd: target, rn: left, rm: 2 });
        const zeroDone = instructions.length;
        emit({ op: "b", displacement: 0 });
        patchInstruction(nonzero, {
          op: "cbnz",
          width: 32,
          rt: 11,
          displacement: (instructions.length - nonzero) * 4,
        });
        emit({ op: "scvtf-d-w", rd: target, rn: 11 });
        const fastDone = instructions.length;
        emit({ op: "b", displacement: 0 });
        for (const site of slow) {
          if (site === undefined) throw "remainder site invariant";
          patchInstruction(site, {
            op: "b.cond",
            condition: "ne",
            displacement: (instructions.length - site) * 4,
          });
        }
        patchInstruction(zeroDivisor, {
          op: "cbz",
          width: 32,
          rt: 10,
          displacement: (instructions.length - zeroDivisor) * 4,
        });
        if (left !== 0) emit({ op: "fmov-d-d", rd: 0, rn: left });
        if (right !== 1) emit({ op: "fmov-d-d", rd: 1, rn: right });
        callHelper("remainder");
        if (target !== 0) emit({ op: "fmov-d-d", rd: target, rn: 0 });
        patchInstruction(zeroDone, {
          op: "b",
          displacement: (instructions.length - zeroDone) * 4,
        });
        patchInstruction(fastDone, {
          op: "b",
          displacement: (instructions.length - fastDone) * 4,
        });
        floatStore(target, op.id);
      } else if (
        ["&", "|", "^", "<<", ">>", ">>>", "imul"].includes(op.operator)
      ) {
        const opIdx = valueIds.intern(op.id);
        if (rotatedShifts[opIdx] === 1 || fusedShifts[opIdx] === 1) break;
        const bypass = storeBypassCandidate.get(op.id);
        if (
          bypass !== undefined &&
          (storedAsInteger(bypass) ||
            (storedAsWord(bypass) &&
              lowWordStoreValues[valueIds.intern(bypass)] === 1))
        ) {
          elidedStoreSource.set(op.id, bypass);
          const bypassDirect = directIntTarget[valueIds.intern(bypass)] ?? 0;
          if (bypassDirect !== 0) {
            directIntAlias.set(op.id, bypassDirect - 1);
            if (storedAsInteger(bypass)) markInteger(op.id);
          }
          break;
        }
        const rightIndex = valueIds.intern(op.right),
          rightKind = wordKinds[rightIndex] ?? 0,
          rotation = rotateAmounts[opIdx] ?? 0,
          shifted = shiftedOps.get(op.id),
          direct = directIntTarget[opIdx] ?? 0;
        // Word and int64 results are computed into their GP home.
        const target =
          direct !== 0
            ? direct - 1
            : storedAsWord(op.id) || wantsInteger(op.id)
              ? rawTarget(op.id, 9)
              : 9;
        let extended = false;
        if (rotation !== 0) {
          const source = wordOperand(rotateSources[opIdx] ?? 0, 9);
          emit({
            op: "extr",
            width: 32,
            rd: target,
            rn: source,
            rm: source,
            lsb: rotation - 1,
          });
        } else if (shifted !== undefined) {
          const left = wordOperand(shifted.other, 13),
            right =
              shifted.source === shifted.other
                ? left
                : wordOperand(shifted.source, 9);
          emit({
            op:
              op.operator === "&"
                ? "and-reg"
                : op.operator === "|"
                  ? "orr-reg"
                  : "eor-reg",
            width: 32,
            rd: target,
            rn: left,
            rm: right,
            shift: shifted.shift,
            amount: shifted.amount,
          });
        } else if (
          (op.operator === "<<" ||
            op.operator === ">>" ||
            op.operator === ">>>") &&
          foldedConstants[rightIndex] === 1 &&
          (rightKind === 1 || rightKind === 3)
        ) {
          // A constant count (modulo 32) as an immediate shift.
          const count = (wordConstants[rightIndex] ?? 0) % 32;
          const source = wordOperand(op.left, 9);
          emit(
            op.operator === "<<"
              ? {
                  op: "ubfm",
                  width: 32,
                  rd: target,
                  rn: source,
                  immr: (32 - count) % 32,
                  imms: 31 - count,
                }
              : {
                  op: op.operator === ">>" ? "sbfm" : "ubfm",
                  width: 32,
                  rd: target,
                  rn: source,
                  immr: count,
                  imms: 31,
                },
          );
        } else if (
          (op.operator === "|" || op.operator === "^") &&
          (zeroConstants[rightIndex] === 1 ||
            zeroConstants[valueIds.intern(op.left)] === 1)
        ) {
          const fusedAdd = activeFusedAdd.get(op.id);
          if (fusedAdd !== undefined) {
            // `(int32 +/- f64) | 0`: convert the float operand with
            // FJCVTZS (which sets Z=1 iff it is an exact signed
            // int32) and add/sub in 32-bit GP registers, breaking
            // the GP->FP->GP loop-carried dependency chain on `int`.
            const intId = fusedAdd.leftIsInt ? fusedAdd.left : fusedAdd.right,
              fltId = fusedAdd.leftIsInt ? fusedAdd.right : fusedAdd.left,
              optOrigin = elidedOptOr.get(fltId);
            const intReg = intRegister(intId, 10),
              fltReg = floatOperand(optOrigin ?? fltId, 0);
            emit({ op: "fjcvtzs", rd: 9, rn: fltReg });
            const toSlow = instructions.length;
            emit({ op: "b.cond", condition: "ne", displacement: 0 });
            if (fusedAdd.add)
              emit({
                op: "add-reg",
                width: 32,
                rd: target,
                rn: intReg,
                rm: 9,
                shift: "lsl",
                amount: 0,
                setFlags: false,
              });
            else
              emit({
                op: "sub-reg",
                width: 32,
                rd: target,
                rn: fusedAdd.leftIsInt ? intReg : 9,
                rm: fusedAdd.leftIsInt ? 9 : intReg,
                shift: "lsl",
                amount: 0,
                setFlags: false,
              });
            const emitFusedAddSlow = (
              sIntReg: number,
              sFltReg: number,
              sTarget: number,
              sAdd: boolean,
              sLeftIsInt: boolean,
              sIsOptZero: boolean,
            ): void => {
              emit({ op: "scvtf-d-x", rd: 1, rn: sIntReg });
              let rhsReg = sFltReg;
              if (sIsOptZero) {
                emit({ op: "fmov-x-d", rd: 9, rn: sFltReg });
                absentFlags(9, 10);
                emit({ op: "fmov-d-x", rd: 2, rn: "zr" });
                emit({
                  op: "fcsel",
                  rd: 2,
                  rn: 2,
                  rm: sFltReg,
                  condition: "eq",
                });
                rhsReg = 2;
              }
              emit({
                op: sAdd ? "fadd" : "fsub",
                rd: 0,
                rn: sLeftIsInt ? 1 : rhsReg,
                rm: sLeftIsInt ? rhsReg : 1,
              });
              emit({ op: "fjcvtzs", rd: sTarget, rn: 0 });
            };
            if (canDeferColdStub()) {
              const resumeAt = instructions.length,
                capturedIntReg = intReg,
                capturedFltReg = fltReg,
                capturedTarget = target,
                capturedAdd = fusedAdd.add,
                capturedLeftIsInt = fusedAdd.leftIsInt,
                capturedOptZero = optOrigin !== undefined;
              clearWordCaches();
              deferredAllocSlowPaths.push(() => {
                clearWordCaches();
                patchInstruction(toSlow, {
                  op: "b.cond",
                  condition: "ne",
                  displacement: (instructions.length - toSlow) * 4,
                });
                emitFusedAddSlow(
                  capturedIntReg,
                  capturedFltReg,
                  capturedTarget,
                  capturedAdd,
                  capturedLeftIsInt,
                  capturedOptZero,
                );
                emit({
                  op: "b",
                  displacement: (resumeAt - instructions.length) * 4,
                });
              });
            } else {
              const toDone = instructions.length;
              emit({ op: "b", displacement: 0 });
              patchInstruction(toSlow, {
                op: "b.cond",
                condition: "ne",
                displacement: (instructions.length - toSlow) * 4,
              });
              emitFusedAddSlow(
                intReg,
                fltReg,
                target,
                fusedAdd.add,
                fusedAdd.leftIsInt,
                optOrigin !== undefined,
              );
              patchInstruction(toDone, {
                op: "b",
                displacement: (instructions.length - toDone) * 4,
              });
            }
            if (
              !storedAsWord(op.id) &&
              wantsInteger(op.id) &&
              lowWordStoreValues[opIdx] !== 1
            ) {
              emit({ op: "sxtw", rd: target, rn: target });
              extended = true;
            }
          } else {
            // `x | 0` and `x ^ 0`: the other operand's low 32 bits,
            // sign-extended at once for an int64 result.
            const source = wordOperand(
              zeroConstants[rightIndex] === 1 ? op.left : op.right,
              9,
            );
            if (
              !storedAsWord(op.id) &&
              wantsInteger(op.id) &&
              lowWordStoreValues[opIdx] !== 1
            ) {
              emit({ op: "sxtw", rd: target, rn: source });
              extended = true;
            } else if (target !== source)
              emit({
                op: "orr-reg",
                width: 32,
                rd: target,
                rn: "zr",
                rm: source,
              });
          }
        } else if (immediate !== undefined && op.operator === "imul") {
          // Low 32 bits of x * 2^k (LSL), x * (2^k + 1) (ADD
          // shifted) or x * (2^k - 1) (LSL, then SUB).
          const constant = deferredIntegers.get(immediate),
            form = constant === undefined ? 0 : wordMultiplierShift(constant),
            k = form % 32,
            source = wordOperand(
              immediate === op.right ? op.left : op.right,
              9,
            );
          if (form === 0) throw "word multiplier invariant";
          if (form < 32 || form >= 64)
            emit({
              op: "ubfm",
              width: 32,
              rd: form < 32 ? target : 10,
              rn: source,
              immr: 32 - k,
              imms: 31 - k,
            });
          if (form >= 64)
            emit({
              op: "sub-reg",
              width: 32,
              rd: target,
              rn: 10,
              rm: source,
              shift: "lsl",
              amount: 0,
              setFlags: false,
            });
          else if (form >= 32)
            emit({
              op: "add-reg",
              width: 32,
              rd: target,
              rn: source,
              rm: source,
              shift: "lsl",
              amount: k,
              setFlags: false,
            });
        } else if (immediate !== undefined) {
          // A logical immediate, or an identity (`& -1`, and
          // `| 0` or `^ 0` with a deferred zero) whose result is
          // the other operand's word (see binaryImmediate).
          const constant = deferredIntegers.get(immediate);
          if (constant === undefined) throw "logical immediate invariant";
          const fields = logicalImmediate32(constant >>> 0),
            source = wordOperand(
              immediate === op.right ? op.left : op.right,
              9,
            );
          if (fields !== undefined) {
            emit({
              op:
                op.operator === "&"
                  ? "and-imm"
                  : op.operator === "|"
                    ? "orr-imm"
                    : "eor-imm",
              width: 32,
              rd: target,
              rn: source,
              n: fields.n,
              immr: fields.immr,
              imms: fields.imms,
            });
            if (op.operator === "&" && constant >>> 0 <= 0x7fffffff)
              extended = true;
          } else if (!storedAsWord(op.id) && wantsInteger(op.id)) {
            emit({ op: "sxtw", rd: target, rn: source });
            extended = true;
          } else
            emit({
              op: "orr-reg",
              width: 32,
              rd: target,
              rn: "zr",
              rm: source,
            });
        } else if (
          op.operator === "imul" &&
          (foldedConstants[valueIds.intern(op.right)] === 1 ||
            foldedConstants[valueIds.intern(op.left)] === 1)
        ) {
          const rightFolded = foldedConstants[valueIds.intern(op.right)] === 1,
            other = rightFolded ? op.left : op.right,
            constVal = numberConstant(rightFolded ? op.right : op.left);
          if (constVal === undefined) throw "imul constant invariant";
          const left = wordOperand(other, 13);
          const hoisted = hoistedImulConst.get(op.id);
          let mulReg = 10;
          if (hoisted !== undefined) mulReg = hoisted;
          else imm(10, constVal >>> 0);
          emit({
            op: "madd",
            width: 32,
            rd: target,
            rn: left,
            rm: mulReg,
            ra: "zr",
          });
        } else {
          // The left operand stays in x13 (or its home) while the
          // right one may call the conversion helper.
          const left = wordOperand(op.left, 13),
            right = wordOperand(op.right, 9);
          emit(
            op.operator === "&"
              ? {
                  op: "and-reg",
                  width: 32,
                  rd: target,
                  rn: left,
                  rm: right,
                }
              : op.operator === "|"
                ? {
                    op: "orr-reg",
                    width: 32,
                    rd: target,
                    rn: left,
                    rm: right,
                  }
                : op.operator === "^"
                  ? {
                      op: "eor-reg",
                      width: 32,
                      rd: target,
                      rn: left,
                      rm: right,
                    }
                  : op.operator === "<<"
                    ? {
                        op: "lslv",
                        width: 32,
                        rd: target,
                        rn: left,
                        rm: right,
                      }
                    : op.operator === ">>"
                      ? {
                          op: "asrv",
                          width: 32,
                          rd: target,
                          rn: left,
                          rm: right,
                        }
                      : op.operator === "imul"
                        ? {
                            // Low 32 bits of the product (signed).
                            op: "madd",
                            width: 32,
                            rd: target,
                            rn: left,
                            rm: right,
                            ra: "zr",
                          }
                        : {
                            op: "lsrv",
                            width: 32,
                            rd: target,
                            rn: left,
                            rm: right,
                          },
          );
        }
        const sum =
          op.operator === "imul" && !storedAsWord(op.id) && wantsInteger(op.id)
            ? soleSum(op.id)
            : undefined;
        if (
          sum !== undefined &&
          sum.kind === "binary" &&
          wantsInteger(sum.id) &&
          truncatableAddend(sum.left === op.id ? sum.right : sum.left)
        ) {
          // Its sum reads only its low word (truncatedSums).
          truncatedSums[valueIds.intern(sum.id)] = 1;
          extended = true;
        }
        if (storedAsWord(op.id)) {
          if (direct === 0) saveRaw(target, op.id);
          else {
            emittedDirectStore[opIdx] = 1;
            if ((valueUses[opIdx] ?? 0) > 1) directIntAlias.set(op.id, target);
          }
        } else if (wantsInteger(op.id)) {
          // A W-register result is zero-extended: right for >>>,
          // and integer typed-array stores read only low bits.
          if (
            op.operator !== ">>>" &&
            !extended &&
            lowWordStoreValues[opIdx] !== 1
          )
            emit({ op: "sxtw", rd: target, rn: target });
          if (direct === 0) saveRaw(target, op.id);
          else {
            emittedDirectStore[opIdx] = 1;
            if ((valueUses[opIdx] ?? 0) > 1) directIntAlias.set(op.id, target);
          }
          markInteger(op.id);
        } else {
          const ftarget = floatTarget(op.id, 0);
          emit(
            op.operator === ">>>"
              ? { op: "ucvtf-d-w", rd: ftarget, rn: target }
              : { op: "scvtf-d-w", rd: ftarget, rn: target },
          );
          floatStore(ftarget, op.id);
        }
      } else if (
        ["===", "!==", "==", "!=", "<", ">", "<=", ">="].includes(op.operator)
      ) {
        const leftAbsent = undefinedValues[valueIds.intern(op.left)] === 1,
          rightAbsent = undefinedValues[valueIds.intern(op.right)] === 1;
        if (leftAbsent || rightAbsent) {
          // Equality with undefined (an optional number, as the
          // verifier equates operand types) observes only presence.
          // Flags: EQ exactly when the other side is absent.
          if (leftAbsent && rightAbsent) {
            imm(9, 0);
            emit({
              op: "sub-imm",
              width: 64,
              rd: "zr",
              rn: 9,
              immediate: 0,
              shift: 0,
              setFlags: true,
            });
          } else
            absentFlags(rawRegister(leftAbsent ? op.right : op.left, 9), 10);
          const condition: Condition =
            op.operator === "===" || op.operator === "==" ? "eq" : "ne";
          if (op.id === comparisonValue) comparisonBranch = condition;
          else {
            const target = rawTarget(op.id, 9);
            emit({ op: "cset", rd: target, condition });
            saveRaw(target, op.id);
          }
          break;
        }
        if (typeOf(op.left) === "optional-number") {
          // Numerically equal (`undefined` is a NaN, so unordered),
          // or both `undefined`: identical bits, the left absent.
          const left = rawRegister(op.left, 9),
            right = rawRegister(op.right, 10);
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
          emit({ op: "cset", rd: 11, condition: "eq" });
          absentFlags(left, 12);
          emit({ op: "cset", rd: 12, condition: "eq" });
          emit({ op: "and-reg", width: 32, rd: 11, rn: 11, rm: 12 });
          emit({ op: "fmov-d-x", rd: 0, rn: left });
          emit({ op: "fmov-d-x", rd: 1, rn: right });
          emit({ op: "fcmp", rn: 0, rm: 1 });
          emit({ op: "cset", rd: 12, condition: "eq" });
          emit({ op: "orr-reg", width: 32, rd: 11, rn: 11, rm: 12 });
          if (op.operator === "!==" || op.operator === "!=") {
            imm(9, 1);
            emit({ op: "eor-reg", width: 32, rd: 11, rn: 11, rm: 9 });
          }
          saveRaw(11, op.id);
          break;
        }
        if (typeOf(op.left) === "optional-boolean") {
          rawLoad(9, value(op.left).offset + 8);
          rawLoad(10, value(op.right).offset + 8);
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
          emit({ op: "cset", rd: 11, condition: "eq" });
          const absentBranch = instructions.length;
          emit({ op: "cbz", width: 64, rt: 9, displacement: 0 });
          rawValue(9, op.left);
          rawValue(10, op.right);
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
          emit({ op: "cset", rd: 12, condition: "eq" });
          emit({ op: "and-reg", width: 32, rd: 11, rn: 11, rm: 12 });
          patchInstruction(absentBranch, {
            op: "cbz",
            width: 64,
            rt: 9,
            displacement: (instructions.length - absentBranch) * 4,
          });
          if (op.operator === "!==" || op.operator === "!=") {
            imm(9, 1);
            emit({ op: "eor-reg", width: 32, rd: 11, rn: 11, rm: 9 });
          }
          saveRaw(11, op.id);
          break;
        }
        // Exact integers (no NaN) compare as int64 once either side is
        // already held as one; -0 and +0 both convert to 0.
        const integerComparison =
          typeOf(op.left) === "number" &&
          (storedAsInteger(op.left) || storedAsInteger(op.right)) &&
          exactInteger(op.left) &&
          exactInteger(op.right);
        if (integerComparison) {
          // A right constant compares as an immediate: a uint32
          // word constant, or a deferred one (binaryImmediate),
          // negative ones with CMN.
          const rightIndex = valueIds.intern(op.right),
            constant =
              immediate === op.right
                ? deferredIntegers.get(op.right)
                : !storedAsInteger(op.right) &&
                    wordKinds[rightIndex] === 3 &&
                    (wordConstants[rightIndex] ?? 0) <= 4095
                  ? (wordConstants[rightIndex] ?? 0)
                  : undefined;
          const left = intRegister(op.left, 9);
          if (constant !== undefined) {
            const magnitude = Math.abs(constant),
              shifted = magnitude > 4095;
            emit({
              op: constant < 0 ? "add-imm" : "sub-imm",
              width: 64,
              rd: "zr",
              rn: left,
              immediate: shifted ? magnitude / 4096 : magnitude,
              shift: shifted ? 12 : 0,
              setFlags: true,
            });
          } else
            emit({
              op: "sub-reg",
              width: 64,
              rd: "zr",
              rn: left,
              rm: intRegister(op.right, 10),
              shift: "lsl",
              amount: 0,
              setFlags: true,
            });
        } else if (typeOf(op.left) === "number") {
          const left = floatOperand(op.left, 0),
            right = floatOperand(op.right, 1);
          emit({ op: "fcmp", rn: left, rm: right });
        } else
          emit({
            op: "sub-reg",
            width: 64,
            rd: "zr",
            rn: rawRegister(op.left, 9),
            rm: rawRegister(op.right, 10),
            shift: "lsl",
            amount: 0,
            setFlags: true,
          });
        const condition: Condition =
          op.operator === "===" || op.operator === "=="
            ? "eq"
            : op.operator === "!==" || op.operator === "!="
              ? "ne"
              : op.operator === "<"
                ? integerComparison
                  ? "lt"
                  : "mi"
                : op.operator === "<="
                  ? integerComparison
                    ? "le"
                    : "ls"
                  : op.operator === ">"
                    ? "gt"
                    : "ge";
        if (op.id === comparisonValue) comparisonBranch = condition;
        else {
          const target = rawTarget(op.id, 9);
          emit({ op: "cset", rd: target, condition });
          saveRaw(target, op.id);
        }
      } else
        fail(
          "UNSUPPORTED",
          "native binary operator not implemented: " + op.operator,
        );
      break;
    }
    default:
      throw "binary op invariant";
  }
  return comparisonBranch;
}
