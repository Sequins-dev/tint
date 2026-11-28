import type { WordBuffer } from "@tint/foundation/binary/word-buffer";
import {
  isNativeTypedArray,
  type Block as IRBlock,
  type Instruction as IRInstruction,
  type ScalarType,
} from "@tint/ir/scalar";
import type {
  Condition,
  Instruction,
  Instruction as MachineInstruction,
} from "../isa.ts";
import type { ColdReciprocalStub } from "./index.ts";

export function managed(type: string): boolean {
  return (
    [
      "primitive",
      "reference",
      "optional-reference",
      "optional-string",
      "string",
    ].includes(type) || isNativeTypedArray(type)
  );
}

export function floatCondition(
  operator: "===" | "!==" | "<" | "<=" | ">" | ">=",
): Condition {
  return operator === "==="
    ? "eq"
    : operator === "!=="
      ? "ne"
      : operator === "<"
        ? "mi"
        : operator === "<="
          ? "ls"
          : operator === ">"
            ? "gt"
            : "ge";
}

export function invertCondition(condition: Condition): Condition {
  const pairs: Condition[] = [
    "eq",
    "ne",
    "cs",
    "cc",
    "mi",
    "pl",
    "vs",
    "vc",
    "hi",
    "ls",
    "ge",
    "lt",
    "gt",
    "le",
  ];
  const index = pairs.indexOf(condition);
  const inverse = pairs[index % 2 === 0 ? index + 1 : index - 1];
  if (index < 0 || inverse === undefined) throw "condition inversion invariant";
  return inverse;
}

export function trailingStringPresent(block: IRBlock):
  | {
      readonly id: number;
      readonly value: number;
      readonly index: number;
    }
  | undefined {
  const terminator = block.terminator;
  if (terminator.kind !== "branch") return undefined;
  let index = block.instructions.length - 1;
  while (index >= 0) {
    const trailing = block.instructions[index];
    if (trailing === undefined || trailing.kind !== "store") break;
    index--;
  }
  const op = block.instructions[index];
  return op !== undefined &&
    op.kind === "string-present" &&
    op.id === terminator.condition
    ? { id: op.id, value: op.value, index }
    : undefined;
}

export function presentSourceSurvivesTrailingStores(
  block: IRBlock,
  afterIndex: number,
  sourceOffset: number,
  sourceHome: number,
  slotOffsets: readonly number[],
  registers: Uint8Array | undefined,
): boolean {
  for (let i = afterIndex + 1; i < block.instructions.length; i++) {
    const op = block.instructions[i];
    if (op === undefined || op.kind !== "store") return false;
    const dstOffset = slotOffsets[op.slot];
    if (dstOffset === undefined || dstOffset === sourceOffset) return false;
    if (
      sourceHome !== 0 &&
      registers !== undefined &&
      sourceHome === (registers[dstOffset / 8] ?? 0)
    )
      return false;
  }
  return true;
}

export function emitStoreReciprocal(
  emit: (instruction: MachineInstruction) => void,
  rawLoad: (rt: number, offset: number) => void,
  rawStore: (rt: number | "zr", offset: number) => void,
  slotWordOffset: number,
  recip: number,
): void {
  rawLoad(9, slotWordOffset);
  emit({ op: "movz", width: 64, rd: 11, immediate: 1, shift: 32 });
  emit({ op: "sdiv", width: 64, rd: 11, rn: 11, rm: 9 });
  emit({
    op: "sub-imm",
    width: 64,
    rd: "zr",
    rn: 11,
    immediate: 0,
    shift: 0,
    setFlags: true,
  });
  emit({ op: "csel", width: 64, rd: 11, rn: 11, rm: "zr", condition: "gt" });
  rawStore(11, recip);
}

export function emitReciprocalRemainder(
  emit: (instruction: MachineInstruction) => void,
  patchInstruction: (index: number, instruction: MachineInstruction) => void,
  rawLoad: (rt: number, offset: number) => void,
  instructions: { readonly length: number },
  target: number,
  recip: number,
  coldStubs?: ColdReciprocalStub[],
  zeroSentinel: boolean = false,
): void {
  emit({ op: "ubfm", width: 64, rd: 11, rn: 9, immr: 32, imms: 63 });
  const wideDividend = instructions.length;
  emit({ op: "cbnz", width: 64, rt: 11, displacement: 0 });
  rawLoad(11, recip);
  const noRecip = instructions.length;
  emit({ op: "cbz", width: 64, rt: 11, displacement: 0 });
  emit({ op: "madd", width: 64, rd: 11, rn: 9, rm: 11, ra: "zr" });
  emit({ op: "ubfm", width: 64, rd: 11, rn: 11, immr: 32, imms: 63 });
  emit({ op: "msub", width: 64, rd: target, rn: 11, rm: 10, ra: 9 });
  emit({
    op: "sub-reg",
    width: 64,
    rd: 12,
    rn: target,
    rm: 10,
    shift: "lsl",
    amount: 0,
    setFlags: true,
  });
  emit({
    op: "csel",
    width: 64,
    rd: target,
    rn: 12,
    rm: target,
    condition: "cs",
  });
  if (coldStubs !== undefined) {
    coldStubs.push({
      wideDividend,
      noRecip,
      target,
      resume: instructions.length,
      zeroSentinel,
    });
    return;
  }
  const done = instructions.length;
  emit({ op: "b", displacement: 0 });
  const slow = instructions.length;
  patchInstruction(wideDividend, {
    op: "cbnz",
    width: 64,
    rt: 11,
    displacement: (slow - wideDividend) * 4,
  });
  patchInstruction(noRecip, {
    op: "cbz",
    width: 64,
    rt: 11,
    displacement: (slow - noRecip) * 4,
  });
  if (zeroSentinel) {
    const zeroDiv = instructions.length;
    emit({ op: "cbz", width: 64, rt: 10, displacement: 0 });
    emit({ op: "sdiv", width: 64, rd: 11, rn: 9, rm: 10 });
    emit({ op: "msub", width: 64, rd: target, rn: 11, rm: 10, ra: 9 });
    const slowDone = instructions.length;
    emit({ op: "b", displacement: 0 });
    patchInstruction(zeroDiv, {
      op: "cbz",
      width: 64,
      rt: 10,
      displacement: (instructions.length - zeroDiv) * 4,
    });
    emit({
      op: "movz",
      width: 64,
      rd: target,
      immediate: 0x6000,
      shift: 48,
    });
    patchInstruction(slowDone, {
      op: "b",
      displacement: (instructions.length - slowDone) * 4,
    });
  } else {
    emit({ op: "sdiv", width: 64, rd: 11, rn: 9, rm: 10 });
    emit({ op: "msub", width: 64, rd: target, rn: 11, rm: 10, ra: 9 });
  }
  patchInstruction(done, {
    op: "b",
    displacement: (instructions.length - done) * 4,
  });
}
