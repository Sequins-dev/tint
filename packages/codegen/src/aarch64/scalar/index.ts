import {
  planLocalSignatures,
  type LocalSignatureBinding,
} from "./signature-groups.ts";
export type { LocalSignatureBinding } from "./signature-groups.ts";
import { nativeContextDomainOffset } from "@tint/abi/host";
import {
  nativeWeakSlotMarker,
  nativeWeakSlotByteLength,
  nativeWeakSlotFlagsOffset,
  nativeWeakSlotKeyOffset,
  nativeWeakSlotKeyPayloadOffset,
  nativeWeakSlotValueOffset,
  nativeWeakSlotValuePayloadOffset,
} from "@tint/abi/weak-slot";
import {
  nativeFunctionByteLength,
  nativeFunctionDescriptorOffset,
  nativeFunctionFlagsOffset,
  nativeFunctionEntryOffset,
  nativeFunctionEnvironmentOffset,
  nativeFunctionSignatureOffset,
  nativeFunctionReservedOffset,
  nativeSignatureVersion,
  nativeSignatureHeaderByteLength,
  nativeSignatureVersionOffset,
  nativeSignatureByteLengthOffset,
  nativeSignatureParameterCountOffset,
  nativeSignatureResultOffset,
  nativeSignatureParametersOffset,
  nativeSignatureParameterByteLength,
  nativeSignatureVoidCode,
  nativeSignatureGeneralCode,
  nativeSignatureOptionalBooleanCode,
  nativeSignaturePrimitiveCode,
  nativeSignatureStringCode,
  nativeSignatureReferenceCode,
  nativeSignatureOptionalReferenceCode,
  nativeSignatureOptionalStringCode,
  nativeSignatureNumberCode,
  nativeSignatureBooleanCode,
  nativeSignatureUint8ArrayCode,
  nativeSignatureUint16ArrayCode,
  nativeSignatureUint32ArrayCode,
  nativeSignatureFloat64ArrayCode,
  nativeSignatureOptionalNumberCode,
} from "@tint/abi/function";
import { temporaryRegisters } from "./temporary-registers.ts";
import { calleeSavedSlots } from "./callee-registers.ts";
import {
  canUseLeafRegisters,
  canInlineCellRead,
  leafStorageRegisters,
} from "./leaf-registers.ts";
import { promoteStackWords } from "./stack-registers.ts";
import {
  createWordBuffer,
  appendWord,
  writeWord,
} from "@tint/foundation/binary/word-buffer";
import { createNumberIndex } from "@tint/foundation/collections/key-index";
import type { PosixHostABI } from "@tint/abi/host";
import {
  encodeFloat64,
  writeUnsigned,
  writeWord64,
} from "@tint/foundation/binary/bytes";
import { emitCellAccess, type CellAccess } from "../cell.ts";
import { numericHelper, type NumericHelper } from "./numeric.ts";
import { stringHelper, type StringHelper } from "./strings.ts";
import { arrayInitializer } from "./arrays.ts";
import {
  sharedMemoryPrimitive,
  type SharedMemoryPrimitive,
} from "./shared-memory.ts";
import { memoryMover } from "./memory.ts";
import { externalMemoryCapability } from "./external-memory.ts";
import { rememberedBarrier } from "./barrier.ts";
export type LeafHelperKind =
  | SharedMemoryPrimitive
  | NumericHelper
  | StringHelper
  | "array-initialize"
  | "memory-move"
  | "array-copy"
  | "remember-object";
import {
  verify,
  maximumStringLength,
  scalarByteLength,
  deadSlotsAtEntry,
  provenRecordGuards,
  provenRecordFlows,
  provenWordFacts,
  provenWordArguments,
  provenInductionWords,
  wordOnlyValues,
  provenNoSafepoints,
  provenDirectOnlyFunctions,
  stableRecordLayouts,
  instructionResult,
  planTemporarySlots,
  hostReturnType,
  type ModuleIR,
  type RecordLayout,
  type ScalarType,
  type Span,
} from "@tint/ir/scalar";
import { compactSlots } from "@tint/ir/optimization";
import {
  patchBranch,
  patchRelativeAddress,
  relativeAddress,
  encode,
  type Instruction,
  type Branch,
  type Condition,
} from "../isa.ts";
import {
  signatureLayout,
  nativeAllocationStateOffset,
  type SignatureLayout,
} from "./abi.ts";
export { nativeContextBytes, nativeExternalMemoryOffset } from "./abi.ts";
export type { ParameterLocation, SignatureLayout } from "./abi.ts";
export type { NumericHelper } from "./numeric.ts";
export interface NativeDebugFrame {
  readonly register: number;
  readonly contextOffset: number;
  readonly resultOffset: number;
  /** Offsets are relative to the native module, matching NativeFunction.offset. */
  readonly ranges: readonly {
    readonly offset: number;
    readonly byteLength: number;
  }[];
}
export interface NativeFunction {
  /** ABI-only entry; it has no local code or debug symbol. */
  readonly import?: true;
  readonly id: number;
  readonly name: string;
  readonly exported: boolean;
  readonly offset: number;
  readonly byteLength: number;
  readonly frameBytes: number;
  readonly signature: SignatureLayout;
  readonly debugFrame?: NativeDebugFrame | undefined;
}
export interface NativeHelper {
  readonly kind: LeafHelperKind;
  readonly offset: number;
  readonly byteLength: number;
}
export interface NativeCellHelper {
  readonly access: CellAccess;
  readonly offset: number;
  readonly byteLength: number;
}
export interface NativeStringLiteral {
  readonly value: string;
  readonly offset: number;
  readonly byteLength: number;
}
export interface NativeRootFrame {
  readonly function: number;
  readonly frameOffset: number;
  readonly descriptorOffset: number;
  /** Reference locations relative to the root frame header. */
  readonly offsets: readonly number[];
  /** Offsets of tagged 16-byte general values, scanned by category. */
  readonly generalOffsets: readonly number[];
}
export interface NativeRecordDescriptor {
  readonly record: number;
  readonly offset: number;
  readonly byteLength: number;
  readonly referenceOffsets: readonly number[];
  readonly generalOffsets: readonly number[];
}
/** Image-private permanent identity for a local physical calling signature.
 * Version 1 stores four u64 words (version, byteLength, parameter count, result
 * encoding), followed by one scalar encoding per ordered parameter. This is not
 * a semantic record-shape contract or permission for cross-image interchange. */
export interface NativeSignatureDescriptor {
  readonly identity?: ManagedIdentityImport | undefined;
  readonly version: 1;
  /** Local function IDs with this exact ordered scalar parameter/result key. */
  readonly functions: readonly number[];
  readonly offset: number;
  readonly byteLength: number;
  readonly parameters: readonly ScalarType[];
  readonly returnType: ScalarType | "void";
}
export interface NativeImportReference {
  readonly offset: number;
  readonly rd: number;
  readonly scratch: number;
  readonly target: { readonly kind: "import"; readonly name: string };
}
export interface NativeSourceRange extends Span {
  readonly function: number;
  readonly offset: number;
  readonly byteLength: number;
}
export interface NativeModule {
  /** Inline allocations require the context extension at byte 56. */
  readonly linearAllocation?: boolean | undefined;
  readonly generationalBarriers?: boolean | undefined;
  readonly sourceRanges: readonly NativeSourceRange[];
  readonly imports: readonly NativeImportReference[];
  readonly linkage: "local" | "unresolved-managed";
  readonly managedImports: readonly NativeManagedPointerImport[];
  readonly functionDescriptorImport: NativeManagedPointerImport | undefined;
  readonly signatures: readonly NativeSignatureDescriptor[];
  /** Explicit synthetic function brand; ordinary matching layouts have no role. */
  readonly functionDescriptor: NativeRecordDescriptor | undefined;
  readonly records: readonly NativeRecordDescriptor[];
  readonly roots: readonly NativeRootFrame[];
  readonly strings: readonly NativeStringLiteral[];
  readonly cellHelpers: readonly NativeCellHelper[];
  readonly helpers: readonly NativeHelper[];
  readonly code: Uint8Array;
  readonly functions: readonly NativeFunction[];
}
export interface Diagnostic {
  readonly code:
    "INVALID_IR" | "UNSUPPORTED" | "FRAME_LIMIT" | "CODE_LIMIT" | "ENCODING";
  readonly message: string;
  readonly function: number | undefined;
  readonly block: number | undefined;
  readonly span: Span | undefined;
}
export type Emission =
  | { readonly ok: true; readonly value: NativeModule }
  | { readonly ok: false; readonly error: Diagnostic };
interface Value {
  readonly offset: number;
  readonly type: ScalarType;
}
interface Fixup {
  readonly offset: number;
  readonly branch: Branch;
  readonly function: number;
  readonly block: number | undefined;
}
function managed(type: string): boolean {
  return [
    "primitive",
    "reference",
    "optional-reference",
    "optional-string",
    "string",
    "Uint8Array",
    "Uint16Array",
    "Uint32Array",
    "Float64Array",
  ].includes(type);
}
/** Stable version-1 descriptor encoding; zero is reserved for a void result. */
export function nativeSignatureTypeCode(type: ScalarType | "void"): number {
  switch (type) {
    case "void":
      return nativeSignatureVoidCode;
    case "general":
      return nativeSignatureGeneralCode;
    case "optional-boolean":
      return nativeSignatureOptionalBooleanCode;
    case "primitive":
      return nativeSignaturePrimitiveCode;
    case "string":
      return nativeSignatureStringCode;
    case "reference":
      return nativeSignatureReferenceCode;
    case "optional-reference":
      return nativeSignatureOptionalReferenceCode;
    case "optional-string":
      return nativeSignatureOptionalStringCode;
    case "number":
      return nativeSignatureNumberCode;
    case "boolean":
      return nativeSignatureBooleanCode;
    case "Uint8Array":
      return nativeSignatureUint8ArrayCode;
    case "Uint16Array":
      return nativeSignatureUint16ArrayCode;
    case "Uint32Array":
      return nativeSignatureUint32ArrayCode;
    case "Float64Array":
      return nativeSignatureFloat64ArrayCode;
    case "optional-number":
      return nativeSignatureOptionalNumberCode;
  }
}

export interface ManagedIdentityImport {
  readonly name: string;
  readonly contract: string;
}
export interface ManagedSignatureBinding extends ManagedIdentityImport {
  /** Explicit compiler-authorized local members of this semantic function-type
   * contract. Equal machine signatures alone never grant membership. */
  readonly localFunctions?: readonly number[];
  readonly witness?: number;
  readonly parameters: readonly ScalarType[];
  readonly returnType: ScalarType | "void";
}
export interface ManagedRecordBinding extends ManagedIdentityImport {
  /** Record ID in this verified IR module; semantic identity is the contract. */
  readonly witness: number;
}
export interface ManagedFunctionEntryBinding extends ManagedIdentityImport {
  readonly function: number;
  readonly parameters: readonly ScalarType[];
  readonly returnType: ScalarType | "void";
}
export interface ManagedABIRequest {
  readonly version: 1;
  readonly functions?: readonly ManagedFunctionEntryBinding[];
  readonly functionBrand?: ManagedIdentityImport;
  readonly signatures: readonly ManagedSignatureBinding[];
  readonly records?: readonly ManagedRecordBinding[];
}
export interface NativeManagedPointerImport extends ManagedIdentityImport {
  readonly role: "function-brand" | "signature" | "record" | "function-entry";
  readonly recordLayout?: RecordLayout | undefined;
  readonly offset: number;
  readonly byteLength: 8;
  /** Role-specific ABI representative (function/record ID), never authority. */
  readonly witness: number | undefined;
  readonly parameters: readonly ScalarType[];
  readonly returnType: ScalarType | "void" | undefined;
}
export interface EmissionOptions {
  readonly maxByteLength?: number | undefined;
  readonly hostABI?: PosixHostABI | undefined;
  readonly debugSpans?: boolean | undefined;
  readonly linearAllocation?: boolean | undefined;
  readonly generationalBarriers?: boolean | undefined;
  readonly closedRoots?: readonly number[] | undefined;
  readonly managedABI?: ManagedABIRequest | undefined;
  readonly localSignatures?: readonly LocalSignatureBinding[] | undefined;
}
export function emitModule(
  module: ModuleIR,
  options: EmissionOptions = {},
): Emission {
  const maxByteLength =
      options.maxByteLength === undefined ? 0xffffffff : options.maxByteLength,
    debugSpans = options.debugSpans ?? false,
    linearAllocation = options.linearAllocation ?? false,
    generationalBarriers = options.generationalBarriers ?? false,
    closedRoots = options.closedRoots;
  let functionId: number | undefined,
    blockId: number | undefined,
    span: Span | undefined,
    failure: Diagnostic | undefined;
  const abort = {};
  const sourceRanges: {
    function: number;
    offset: number;
    byteLength: number;
    start: number;
    end: number;
  }[] = [];
  const instructions = createWordBuffer(),
    functions: NativeFunction[] = [],
    blockOffsets: { readonly offsets: readonly (number | undefined)[] }[] = [],
    fixups: Fixup[] = [];
  const imports: NativeImportReference[] = [];
  const managedRequests: NativeManagedPointerImport[] = [],
    managedImports: NativeManagedPointerImport[] = [],
    managedPointerFixups: { offset: number; request: number; rd: number }[] =
      [],
    entryImports = new Map<number, number>(),
    signatureImports = new Map<number, number>(),
    managedSignatureRequests: number[] = [],
    recordImports = new Map<number, number>();
  let brandImport: number | undefined;
  const nativeSignatures: NativeSignatureDescriptor[] = [],
    signatureFixups: { offset: number; target: number; rd: number }[] = [];

  const records: NativeRecordDescriptor[] = [],
    recordFixups: { offset: number; record: number }[] = [];
  const functionAddresses: { offset: number; target: number; rd: number }[] =
    [];
  const roots: NativeRootFrame[] = [],
    rootRequests: {
      function: number;
      frameOffset: number;
      offsets: number[];
      generalOffsets: number[];
      fixup: number;
    }[] = [];
  const helpers: NativeHelper[] = [],
    helperFixups: { offset: number; kind: LeafHelperKind }[] = [],
    helperOffsets = new Map<LeafHelperKind, number>();
  const cellRequests = new Map<string, CellAccess>(),
    cellFixups: { offset: number; key: string }[] = [];
  const cellHelpers: NativeCellHelper[] = [];
  const strings: NativeStringLiteral[] = [],
    stringFixups: { offset: number; value: string }[] = [];
  function callHelper(kind: LeafHelperKind): void {
    helperFixups.push({ offset: instructions.length * 4, kind });
    callRelative();
  }
  function callRelative(): void {
    // Large modules can place call targets beyond BL's 128 MiB reach.
    // The ABI reserves x16/x17 for call/address scratch.
    relativePointer(16);
    emit({ op: "blr", rn: 16 });
  }
  function host(): PosixHostABI {
    const abi = options.hostABI;
    if (abi === undefined)
      fail("UNSUPPORTED", "target host ABI is required for this operation");
    return abi;
  }
  function fail(code: Diagnostic["code"], message: string): never {
    failure = { code, message, function: functionId, block: blockId, span };
    throw abort;
  }
  function emit(i: Instruction): void {
    if (
      (i.op === "ldr" ||
        i.op === "str" ||
        i.op === "ldr-d" ||
        i.op === "str-d") &&
      i.rn === "sp" &&
      i.offset > 32760
    ) {
      // x17 is reserved scratch for stack addressing. x16 can hold a live
      // allocator/callback address while arguments are being prepared.
      address(17, i.offset);
      if (i.op === "ldr" || i.op === "str")
        emit({ op: i.op, width: i.width, rt: i.rt, rn: 17, offset: 0 });
      else if (i.op === "ldr-d")
        emit({ op: "ldr-d", rt: i.rt, rn: 17, offset: 0 });
      else if (i.op === "str-d")
        emit({ op: "str-d", rt: i.rt, rn: 17, offset: 0 });
      return;
    }
    if (instructions.length >= Math.floor(maxByteLength / 4))
      fail("CODE_LIMIT", "native code exceeds byte budget");
    const valid = encode(i);
    if (!valid.ok) fail("ENCODING", valid.error);
    if (
      debugSpans &&
      functionId !== undefined &&
      span !== undefined &&
      span.end > span.start
    ) {
      const offset = instructions.length * 4,
        previous = sourceRanges.at(-1);
      if (
        previous !== undefined &&
        previous.function === functionId &&
        previous.start === span.start &&
        previous.end === span.end &&
        previous.offset + previous.byteLength === offset
      )
        previous.byteLength = previous.byteLength + 4;
      else
        sourceRanges.push({
          function: functionId,
          offset,
          byteLength: 4,
          start: span.start,
          end: span.end,
        });
    }
    appendWord(instructions, valid.value);
  }
  function patchInstruction(index: number, instruction: Instruction): void {
    const encoded = encode(instruction);
    if (!encoded.ok) fail("ENCODING", encoded.error);
    writeWord(instructions, index, encoded.value);
  }
  function relativePointer(rd: number): void {
    const sequence = relativeAddress(rd, 17, 0);
    if (!sequence.ok) fail("ENCODING", sequence.error);
    for (const instruction of sequence.value) {
      if (instruction === undefined) throw "relative pointer invariant";
      emit(instruction);
    }
  }
  function managedPointer(rd: number, request: number): void {
    managedPointerFixups.push({ offset: instructions.length * 4, request, rd });
    relativePointer(rd);
    emit({ op: "ldr", width: 64, rt: rd, rn: rd, offset: 0 });
  }
  function functionEntryPointer(rd: number, target: number): void {
    functionAddresses.push({ offset: instructions.length * 4, target, rd });
    relativePointer(rd);
  }
  function functionSignaturePointer(rd: number, target: number): void {
    const imported = signatureImports.get(target);
    if (imported !== undefined) managedPointer(rd, imported);
    else {
      signatureFixups.push({ offset: instructions.length * 4, target, rd });
      relativePointer(rd);
    }
  }
  function imm(rd: number, value: number): void {
    emit({ op: "movz", width: 64, rd, immediate: value % 65536, shift: 0 });
    if (value >= 65536)
      emit({
        op: "movk",
        width: 64,
        rd,
        immediate: Math.floor(value / 65536) % 65536,
        shift: 16,
      });
    if (value >= 4294967296)
      emit({
        op: "movk",
        width: 64,
        rd,
        immediate: Math.floor(value / 4294967296) % 65536,
        shift: 32,
      });
    if (value >= 281474976710656)
      emit({
        op: "movk",
        width: 64,
        rd,
        immediate: Math.floor(value / 281474976710656) % 65536,
        shift: 48,
      });
  }
  function address(rd: number, offset: number): void {
    let high = Math.floor(offset / 4096);
    const low = offset % 4096;
    let first = true;
    while (high > 0) {
      const chunk = Math.min(high, 4095);
      emit({
        op: "add-imm",
        width: 64,
        rd,
        rn: first ? "sp" : rd,
        immediate: chunk,
        shift: 12,
        setFlags: false,
      });
      high -= chunk;
      first = false;
    }
    if (low !== 0 || first)
      emit({
        op: "add-imm",
        width: 64,
        rd,
        rn: first ? "sp" : rd,
        immediate: low,
        shift: 0,
        setFlags: false,
      });
  }
  function adjust(op: "add-imm" | "sub-imm", amount: number): void {
    let high = Math.floor(amount / 4096);
    const low = amount % 4096;
    while (high > 0) {
      const chunk = Math.min(high, 4095);
      emit({
        op,
        width: 64,
        rd: "sp",
        rn: "sp",
        immediate: chunk,
        shift: 12,
        setFlags: false,
      });
      high -= chunk;
    }
    if (low !== 0)
      emit({
        op,
        width: 64,
        rd: "sp",
        rn: "sp",
        immediate: low,
        shift: 0,
        setFlags: false,
      });
  }
  let scalarRegisters: Uint8Array | undefined;
  function rawLoad(rt: number, offset: number): void {
    const registers = scalarRegisters,
      register = registers === undefined ? 0 : (registers[offset / 8] ?? 0);
    if (register >= 32) {
      if (rt !== register - 32)
        emit({ op: "orr-reg", width: 64, rd: rt, rn: "zr", rm: register - 32 });
    } else if (register !== 0) emit({ op: "fmov-x-d", rd: rt, rn: register });
    else emit({ op: "ldr", width: 64, rt, rn: "sp", offset });
  }
  function rawStore(rt: number | "zr", offset: number): void {
    const registers = scalarRegisters,
      register = registers === undefined ? 0 : (registers[offset / 8] ?? 0);
    if (register >= 32) {
      if (rt !== register - 32)
        emit({ op: "orr-reg", width: 64, rd: register - 32, rn: "zr", rm: rt });
    } else if (register !== 0) emit({ op: "fmov-d-x", rd: register, rn: rt });
    else emit({ op: "str", width: 64, rt, rn: "sp", offset });
  }
  /** Copy storage bits without crossing register banks. This is a bitwise move,
   * including references, signed zero and NaN payloads; register eligibility and
   * GC visibility remain entirely the existing allocation planner's decision. */
  function copyRawWord(source: number, target: number): void {
    if (source === target) return;
    const registers = scalarRegisters,
      from = registers === undefined ? 0 : (registers[source / 8] ?? 0),
      to = registers === undefined ? 0 : (registers[target / 8] ?? 0);
    if (from >= 32) {
      if (to >= 32) {
        if (from !== to)
          emit({
            op: "orr-reg",
            width: 64,
            rd: to - 32,
            rn: "zr",
            rm: from - 32,
          });
      } else if (to !== 0) emit({ op: "fmov-d-x", rd: to, rn: from - 32 });
      else
        emit({ op: "str", width: 64, rt: from - 32, rn: "sp", offset: target });
    } else if (to >= 32) {
      if (from !== 0) emit({ op: "fmov-x-d", rd: to - 32, rn: from });
      else
        emit({ op: "ldr", width: 64, rt: to - 32, rn: "sp", offset: source });
    } else if (from !== 0 && to !== 0) {
      if (from !== to) emit({ op: "fmov-d-d", rd: to, rn: from });
    } else if (from !== 0)
      emit({ op: "str-d", rt: from, rn: "sp", offset: target });
    else if (to !== 0) emit({ op: "ldr-d", rt: to, rn: "sp", offset: source });
    else {
      rawLoad(9, source);
      rawStore(9, target);
    }
  }
  const conditions: Condition[] = [
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
  function branch(
    branch: Branch,
    targetFunction: number,
    targetBlock: number | undefined,
  ): void {
    if (branch.op === "bl" && targetBlock === undefined) {
      functionAddresses.push({
        offset: instructions.length * 4,
        target: targetFunction,
        rd: 16,
      });
      callRelative();
      return;
    }
    // Conditional A64 branches reach only 1 MiB. Keep their displacement
    // local and relocate an unconditional branch with its 128 MiB reach.
    if (
      branch.op === "b.cond" &&
      branch.condition !== "al" &&
      branch.condition !== "nv"
    ) {
      const index = conditions.indexOf(branch.condition);
      const inverse = conditions[index % 2 === 0 ? index + 1 : index - 1];
      if (index < 0 || inverse === undefined)
        throw "branch condition invariant";
      emit({ op: "b.cond", condition: inverse, displacement: 8 });
    } else if (branch.op === "cbz" || branch.op === "cbnz") {
      emit({
        op: branch.op === "cbz" ? "cbnz" : "cbz",
        width: branch.width,
        rt: branch.rt,
        displacement: 8,
      });
    }
    const op: "bl" | "b" = branch.op === "bl" ? "bl" : "b";
    fixups.push({
      offset: instructions.length * 4,
      branch: { op },
      function: targetFunction,
      block: targetBlock,
    });
    emit({ op, displacement: 0 });
  }
  try {
    if (
      !Number.isInteger(maxByteLength) ||
      maxByteLength < 4 ||
      maxByteLength > 0xffffffff
    )
      fail("CODE_LIMIT", "invalid byte budget");
    const valid = verify(module);
    if (!valid.ok) {
      const error = valid.error;
      functionId = error.function;
      blockId = error.block;
      const invalid = module.functions.find(
        (fn) => fn !== undefined && fn.id === functionId,
      );
      const block = invalid?.blocks.find(
        (block) => block !== undefined && block.id === blockId,
      );
      const instruction = error.instruction;
      const operation =
        instruction === undefined
          ? undefined
          : block?.instructions[instruction];
      if (operation !== undefined)
        span = { start: operation.start, end: operation.end };
      fail("INVALID_IR", error.message);
    }
    // Optional scalar optimization can exhaust its module budget before slot
    // cleanup. Plan frames from used locals, retaining ABI and transfer slots.
    // Normalize before slot-indexed analyses; a bounded failure keeps the input.
    const frameFunctions = module.functions.map(
      (fn) => compactSlots(fn, 1000000)?.fn ?? fn,
    );
    if (frameFunctions.some((fn, index) => fn !== module.functions[index]))
      module = { ...module, functions: frameFunctions };
    const managedABI = options.managedABI;
    if (managedABI !== undefined) {
      if (managedABI.version !== 1)
        fail("UNSUPPORTED", "unsupported managed ABI version");
      const names = new Set<string>();
      function validName(value: string): boolean {
        return value.length > 0 && value.indexOf("\0") < 0;
      }
      function identity(name: string, contract: string): void {
        if (!validName(name) || !validName(contract) || names.has(name))
          fail(
            "INVALID_IR",
            "invalid or duplicate managed import name/contract",
          );
        names.add(name);
      }
      const brand = managedABI.functionBrand;
      if (brand === undefined) {
        if (managedABI.signatures.length > 0)
          fail(
            "INVALID_IR",
            "managed signature imports require a function brand",
          );
      } else {
        identity(brand.name, brand.contract);
        brandImport = managedRequests.length;
        managedRequests.push({
          role: "function-brand",
          name: brand.name,
          contract: brand.contract,
          offset: 0,
          byteLength: 8,
          witness: undefined,
          parameters: [],
          returnType: undefined,
        });
      }
      for (const binding of managedABI.signatures) {
        if (binding === undefined) throw "managed signature binding invariant";
        identity(binding.name, binding.contract);
        const witness = binding.witness;
        if (witness === undefined) {
          if ((binding.localFunctions?.length ?? 0) === 0)
            fail(
              "INVALID_IR",
              "managed signature binding requires a witness or local members",
            );
        } else {
          const target = module.functions[witness];
          if (
            !Number.isInteger(witness) ||
            witness < 0 ||
            target === undefined ||
            signatureImports.has(witness)
          )
            fail(
              "INVALID_IR",
              "invalid or duplicate managed signature witness",
            );
          if (
            target.returnType !== binding.returnType ||
            target.parameters.length !== binding.parameters.length
          )
            fail(
              "INVALID_IR",
              "managed signature contract does not match witness",
            );
          for (let index = 0; index < target.parameters.length; index++) {
            const slot = target.parameters[index];
            if (
              slot === undefined ||
              target.slots[slot] !== binding.parameters[index]
            )
              fail(
                "INVALID_IR",
                "managed signature parameter contract does not match witness",
              );
          }
          let used = false;
          for (const input of module.functions) {
            if (input === undefined) throw "managed function invariant";
            for (const block of input.blocks) {
              if (block === undefined) throw "managed block invariant";
              for (const op of block.instructions) {
                if (op === undefined) throw "managed instruction invariant";
                if (op.kind === "function-new" && op.target === witness)
                  fail(
                    "INVALID_IR",
                    "cannot create a local function using an imported signature witness",
                  );
                if (op.kind === "call-indirect" && op.target === witness)
                  used = true;
              }
            }
          }
          if (!used)
            fail(
              "INVALID_IR",
              "managed signature binding has no indirect-call witness",
            );
          signatureImports.set(witness, managedRequests.length);
        }
        managedSignatureRequests.push(managedRequests.length);
        managedRequests.push({
          role: "signature",
          name: binding.name,
          contract: binding.contract,
          offset: 0,
          byteLength: 8,
          // Permanent link metadata keeps an ABI representative even when this
          // contract has members but no indirect-call placeholder.
          witness: binding.witness ?? binding.localFunctions?.[0],
          parameters: binding.parameters.slice(),
          returnType: binding.returnType,
        });
      }
      // Imported witnesses remain non-callable local placeholders. Only explicit
      // type-contract membership lets a real local body share their identity.
      for (let index = 0; index < managedABI.signatures.length; index++) {
        const binding = managedABI.signatures[index];
        if (binding === undefined) throw "managed signature binding invariant";
        const request = managedSignatureRequests[index];
        if (request === undefined) throw "managed signature request invariant";
        for (const id of binding.localFunctions ?? []) {
          if (id === undefined) throw "managed signature member invariant";
          const target = module.functions[id];
          if (
            !Number.isInteger(id) ||
            id < 0 ||
            target === undefined ||
            signatureImports.has(id) ||
            target.import === true
          )
            fail("INVALID_IR", "invalid or duplicate local signature member");
          if (
            target.returnType !== binding.returnType ||
            target.parameters.length !== binding.parameters.length
          )
            fail(
              "INVALID_IR",
              "local signature member contract does not match",
            );
          for (let index = 0; index < target.parameters.length; index++) {
            const slot = target.parameters[index];
            if (
              slot === undefined ||
              target.slots[slot] !== binding.parameters[index]
            )
              fail(
                "INVALID_IR",
                "local signature member parameter contract does not match",
              );
          }
          signatureImports.set(id, request);
        }
      }
      for (const binding of managedABI.records ?? []) {
        if (binding === undefined) throw "managed record binding invariant";
        const layout = module.records?.[binding.witness];
        if (
          !Number.isInteger(binding.witness) ||
          binding.witness < 0 ||
          layout === undefined ||
          recordImports.has(binding.witness)
        )
          fail("INVALID_IR", "invalid or duplicate managed record witness");
        identity(binding.name, binding.contract);
        recordImports.set(binding.witness, managedRequests.length);
        managedRequests.push({
          role: "record",
          name: binding.name,
          contract: binding.contract,
          offset: 0,
          byteLength: 8,
          witness: binding.witness,
          parameters: [],
          returnType: undefined,
          recordLayout: {
            byteLength: layout.byteLength,
            fields: layout.fields.map((field) => ({ ...field })),
          },
        });
      }
      for (const binding of managedABI.functions ?? []) {
        if (binding === undefined) throw "managed entry binding invariant";
        const target = module.functions[binding.function];
        if (
          !Number.isInteger(binding.function) ||
          binding.function < 0 ||
          target === undefined ||
          target.import !== true
        )
          fail(
            "INVALID_IR",
            "function-entry binding requires an imported function",
          );
        if (entryImports.has(binding.function))
          fail("INVALID_IR", "duplicate imported function-entry binding");
        if (
          target.returnType !== binding.returnType ||
          target.parameters.length !== binding.parameters.length
        )
          fail("INVALID_IR", "imported function ABI mismatch");
        for (let i = 0; i < target.parameters.length; i++) {
          const slot = target.parameters[i];
          if (
            slot === undefined ||
            target.slots[slot] !== binding.parameters[i]
          )
            fail("INVALID_IR", "imported function ABI mismatch");
        }
        identity(binding.name, binding.contract);
        entryImports.set(binding.function, managedRequests.length);
        managedRequests.push({
          role: "function-entry",
          name: binding.name,
          contract: binding.contract,
          offset: 0,
          byteLength: 8,
          witness: binding.function,
          parameters: binding.parameters.slice(),
          returnType: binding.returnType,
        });
      }
    }
    for (const fn of module.functions) {
      if (fn === undefined) throw "function entry invariant";
      if (fn.import === true && !entryImports.has(fn.id))
        fail(
          "UNSUPPORTED",
          "unbound imported function requires a function-entry binding",
        );
    }
    for (const root of closedRoots ?? []) {
      if (root !== undefined && module.functions[root]?.import === true)
        fail("INVALID_IR", "imported functions cannot be executable roots");
    }
    if (generationalBarriers) {
      if (
        module.functions.some((fn) =>
          fn.blocks.some((block) =>
            block.instructions.some(
              (op) =>
                op.kind === "weak-slot-new" ||
                op.kind === "weak-slot-key" ||
                op.kind === "weak-slot-value" ||
                op.kind === "weak-slot-set-value" ||
                op.kind === "weak-slot-clear",
            ),
          ),
        )
      )
        fail(
          "UNSUPPORTED",
          "weak cells require copying collection; generational weak barriers are not supported",
        );
      if (!stableRecordLayouts(module))
        fail(
          "INVALID_IR",
          "generational mutator requires tracked managed writes; raw memory capabilities are unsupported",
        );
      for (const fn of module.functions) {
        if (fn === undefined) throw "function invariant";
        const environment = fn.environment;
        if (
          environment !== undefined &&
          environment.cells.some(
            (cell) => managed(cell.type) || cell.type === "general",
          )
        )
          fail(
            "INVALID_IR",
            "generational mutator cannot track a borrowed reference environment",
          );
      }
    }
    const functionRecord = module.records?.length ?? 0;
    const hasFunctions =
      brandImport !== undefined ||
      module.functions.some((f) =>
        f.blocks.some((b) =>
          b.instructions.some(
            (op) =>
              op.kind === "function-new" ||
              op.kind === "call-indirect" ||
              op.kind === "function-environment" ||
              (op.kind === "host-call" &&
                (op.operation === "native-function-descriptor" ||
                  op.operation === "native-function-signature" ||
                  op.operation === "native-value-function-descriptor" ||
                  op.operation === "native-value-function-signature")),
          ),
        ),
      );
    const recordLayouts: RecordLayout[] = [];
    for (const record of module.records ?? []) {
      if (record === undefined) throw "record layout invariant";
      recordLayouts.push(record);
    }
    if (hasFunctions)
      recordLayouts.push({
        byteLength: nativeFunctionByteLength,
        fields: [
          {
            offset: nativeFunctionEnvironmentOffset,
            type: "optional-reference",
            mutable: false,
          },
        ],
      });
    const typeErrorRecord = recordLayouts.length;
    const hasTypeErrors = module.functions.some((f) =>
      f.blocks.some((b) =>
        b.instructions.some(
          (op) => op.kind === "error-new" || op.kind === "error-is",
        ),
      ),
    );
    if (hasTypeErrors)
      for (let i = 0; i < 2; i++)
        recordLayouts.push({
          byteLength: 32,
          fields: [{ offset: 16, type: "string", mutable: false }],
        });
    const localSignatures = planLocalSignatures(
      module.functions,
      options.localSignatures ?? [],
      signatureImports,
      managedRequests.map((request) => request.name),
      managedRequests.map((request) => request.contract),
    );
    if (!localSignatures.ok) fail("INVALID_IR", localSignatures.error);
    const localGroups = localSignatures.groups;
    const signatureIds = module.functions.map((input): number => {
      const f = input;
      if (f === undefined) throw "function invariant";
      const group = localSignatures.byFunction[f.id] ?? 0;
      if (group !== 0) return module.functions.length + group;
      return (
        module.functions.findIndex((candidate): boolean => {
          const other = candidate;
          if (other === undefined) throw "function invariant";
          if (
            f.returnType !== other.returnType ||
            f.parameters.length !== other.parameters.length
          )
            return false;
          for (let i = 0; i < f.parameters.length; i++) {
            const slot = f.parameters[i],
              otherSlot = other.parameters[i];
            if (slot === undefined || otherSlot === undefined)
              throw "parameter invariant";
            if (f.slots[slot] !== other.slots[otherSlot]) return false;
          }
          return true;
        }) + 1
      );
    });
    const stableLayouts = stableRecordLayouts(module);
    const stableSlots =
      stableLayouts &&
      !module.functions.some((fn) => fn.environment !== undefined);
    const wordReturns = new Uint8Array(module.functions.length);
    if (stableSlots) {
      let budget = 10000000;
      for (const fn of module.functions) {
        if (fn === undefined) throw "word return function invariant";
        const proof = provenWordFacts(fn, Math.min(1000000, budget));
        if (proof !== undefined) {
          wordReturns[fn.id] = proof.returned;
          budget -= proof.work;
        }
      }
    }
    const wordArguments =
      stableSlots && closedRoots !== undefined
        ? provenWordArguments(module, closedRoots, wordReturns)
        : undefined;
    const recordFlows =
      closedRoots === undefined
        ? undefined
        : provenRecordFlows(module, 10000000, true, closedRoots);
    const noSafepoints = provenNoSafepoints(module);
    const directReturns =
      closedRoots === undefined
        ? undefined
        : provenDirectOnlyFunctions(module, closedRoots);
    const signatures = module.functions.map((fn): SignatureLayout => {
      if (fn === undefined) throw "function invariant";
      return signatureLayout(fn);
    });
    for (const inputFunction of module.functions) {
      if (inputFunction === undefined) throw "function invariant";
      const fn = inputFunction;
      if (fn.import === true) {
        const signature = signatures[fn.id];
        if (signature === undefined) throw "import signature layout invariant";
        functions.push({
          id: fn.id,
          import: true,
          name: fn.name,
          exported: false,
          offset: 0,
          byteLength: 0,
          frameBytes: 0,
          signature,
        });
        blockOffsets.push({ offsets: [] });
        continue;
      }
      scalarRegisters = undefined;
      const hasRoots =
        (closedRoots === undefined ||
          noSafepoints === undefined ||
          noSafepoints[fn.id] !== 1) &&
        (fn.closureEnvironment !== undefined ||
          fn.slots.some((type) => managed(type) || type === "general") ||
          fn.blocks.some((b) =>
            b.instructions.some(
              (op) =>
                (op.kind === "host-call" &&
                  op.operation === "executable-call-managed") ||
                op.kind === "general-kind" ||
                op.kind === "general-wrap" ||
                op.kind === "general-none" ||
                op.kind === "general-null" ||
                op.kind === "array-subarray" ||
                op.kind === "array-new" ||
                op.kind === "weak-slot-new" ||
                op.kind === "reference-vector-new" ||
                op.kind === "error-new" ||
                op.kind === "record-new" ||
                op.kind === "function-new" ||
                op.kind === "string-literal" ||
                op.kind === "string-from-code-units" ||
                op.kind === "string-concat" ||
                op.kind === "string-slice" ||
                ((op.kind === "call" || op.kind === "call-indirect") &&
                  op.id !== undefined &&
                  (managed(module.functions[op.target]?.returnType ?? "") ||
                    module.functions[op.target]?.returnType === "general")),
            ),
          ));
      const leafRegisters =
        !hasRoots &&
        noSafepoints !== undefined &&
        noSafepoints[fn.id] === 1 &&
        canUseLeafRegisters(fn);
      const preserved =
        closedRoots === undefined || leafRegisters
          ? undefined
          : calleeSavedSlots(fn);
      const preservedCount = preserved === undefined ? 0 : preserved.count;
      functionId = fn.id;
      blockId = undefined;
      span = undefined;
      const signature = signatures[fn.id];
      if (signature === undefined) throw "signature layout invariant";
      let outgoingBytes = 0;
      for (const b of fn.blocks) {
        if (b === undefined) throw "block invariant";
        for (const op of b.instructions) {
          if (op === undefined) throw "instruction invariant";
          if (
            op.kind === "host-call" &&
            op.operation === "open-exclusive" &&
            host().creationModeOnStack
          )
            outgoingBytes = Math.max(outgoingBytes, 16);
          if (op.kind === "call" || op.kind === "call-indirect") {
            const s = signatures[op.target];
            if (s === undefined) throw "callee signature invariant";
            outgoingBytes = Math.max(outgoingBytes, s.stackBytes);
          }
        }
      }
      const resultOffset = outgoingBytes,
        contextOffset = resultOffset + 32,
        resultPointerOffset = contextOffset + 8,
        borrowedEnvironmentOffset = resultPointerOffset + 8,
        allocationOffset =
          borrowedEnvironmentOffset + (fn.environment === undefined ? 0 : 8),
        rootOffset =
          allocationOffset +
          (fn.blocks.some((b) =>
            b.instructions.some(
              (op) =>
                op.kind === "string-from-code-units" ||
                op.kind === "string-concat" ||
                op.kind === "string-slice" ||
                op.kind === "array-new" ||
                op.kind === "weak-slot-new" ||
                op.kind === "reference-vector-new" ||
                op.kind === "array-subarray",
            ),
          )
            ? 24
            : 0),
        environmentOffset =
          fn.closureEnvironment === undefined
            ? borrowedEnvironmentOffset
            : rootOffset + (hasRoots ? 16 : 0),
        localsOffset =
          rootOffset +
          (hasRoots ? 16 : 0) +
          (fn.closureEnvironment === undefined ? 0 : 8);
      let cursor = localsOffset;
      const slotOffsets: number[] = [];
      for (const type of fn.slots) {
        if (type === undefined) throw "slot type invariant";
        slotOffsets.push(cursor);
        cursor += scalarByteLength(type);
      }
      function slotOffset(slot: number): number {
        const offset = slotOffsets[slot];
        if (offset === undefined) throw "slot layout invariant";
        return offset;
      }
      const valueIds = createNumberIndex(),
        values: (Value | undefined)[] = [];
      function value(id: number): Value {
        const v = values[valueIds.intern(id)];
        if (v === undefined) throw "verified value invariant";
        return v;
      }
      const valuesOffset = cursor;
      if (preserved !== undefined) {
        const storage = new Uint8Array(Math.ceil(valuesOffset / 8));
        for (let slot = 0; slot < fn.slots.length; slot++)
          storage[slotOffset(slot) / 8] = preserved.registers[slot] ?? 0;
        scalarRegisters = storage;
      }
      let maximumCursor = cursor;
      for (const b of fn.blocks) {
        if (b === undefined) throw "block invariant";
        if (!hasRoots) cursor = valuesOffset;
        for (const op of b.instructions) {
          if (op === undefined) throw "instruction invariant";
          let id: number | undefined, type: ScalarType | undefined;
          switch (op.kind) {
            case "general-null":
            case "general-none":
            case "general-wrap":
            case "weak-slot-new":
            case "weak-slot-key":
            case "weak-slot-value":
              id = op.id;
              type = "general";
              break;
            case "general-value":
              id = op.id;
              type = op.type;
              break;
            case "array-subarray":
              id = op.id;
              type = value(op.array).type;
              break;
            case "array-new":
              id = op.id;
              type = op.type;
              break;
            case "general-kind":
            case "string-literal":
            case "string-from-code-units":
            case "string-concat":
            case "string-slice":
              id = op.id;
              type = "string";
              break;
            case "string-length":
            case "string-code-unit":
              id = op.id;
              type = "number";
              break;
            case "host-call": {
              const resultType = hostReturnType(op.operation);
              if (resultType === undefined)
                throw "verified host return invariant";
              if (resultType !== "void") {
                id = op.id;
                type = resultType;
              }
              break;
            }
            case "string-none":
            case "string-wrap":
              id = op.id;
              type = "optional-string";
              break;
            case "string-value":
              id = op.id;
              type = "string";
              break;
            case "string-present":
              id = op.id;
              type = "boolean";
              break;
            case "primitive-wrap":
              id = op.id;
              type = "primitive";
              break;
            case "primitive-reference":
              id = op.id;
              type = "reference";
              break;
            case "reference-none":
            case "reference-wrap":
            case "reference-vector-read":
            case "function-environment":
              id = op.id;
              type = "optional-reference";
              break;
            case "reference-value":
              id = op.id;
              type = op.type ?? "reference";
              break;
            case "closure-environment":
            case "function-new":
            case "error-new":
            case "record-new":
            case "reference-vector-new":
              id = op.id;
              type = "reference";
              break;
            case "constant":
              id = op.id;
              type = typeof op.value === "number" ? "number" : "boolean";
              break;
            case "boolean-none":
            case "boolean-wrap":
              id = op.id;
              type = "optional-boolean";
              break;
            case "function-address":
            case "record-descriptor-address":
            case "general-record-descriptor":
              id = op.id;
              type = "number";
              break;
            case "record-read": {
              const field = module.records?.[op.record]?.fields[op.field];
              if (field === undefined) throw "record read layout invariant";
              id = op.id;
              type = field.type;
              break;
            }
            case "error-is":
            case "general-equal":
            case "record-has":
            case "general-record-is":
            case "boolean-value":
            case "boolean-present":
              id = op.id;
              type = "boolean";
              break;
            case "undefined":
            case "optional-wrap":
              id = op.id;
              type = "optional-number";
              break;
            case "string-starts-with":
            case "optional-present":
            case "optional-value":
              id = op.id;
              type = op.kind === "optional-value" ? "number" : "boolean";
              break;
            case "array-buffer":
              id = op.id;
              type = "reference";
              break;
            case "array-byte-offset":
            case "array-byte-length":
            case "reference-vector-is":
            case "array-copy":
              id = op.id;
              type = "boolean";
              break;
            case "reference-vector-length":
            case "array-length":
            case "array-read":
            case "array-valid":
              id = op.id;
              type =
                op.kind === "array-valid"
                  ? "boolean"
                  : op.kind === "array-read"
                    ? "optional-number"
                    : "number";
              break;
            case "load":
              id = op.id;
              type = fn.slots[op.slot];
              break;
            case "unary":
              id = op.id;
              type =
                op.operator === "!" ||
                op.operator === "truthy" ||
                op.operator === "is-integer"
                  ? "boolean"
                  : "number";
              break;
            case "binary":
              id = op.id;
              type = ["===", "!==", "==", "!=", "<", ">", "<=", ">="].includes(
                op.operator,
              )
                ? "boolean"
                : "number";
              break;
            case "call-indirect":
            case "call": {
              id = op.id;
              const t = module.functions[op.target]?.returnType;
              if (t !== undefined && t !== "void") type = t;
              break;
            }
          }
          if (id !== undefined) {
            if (type === undefined) throw "result type invariant";
            values[valueIds.intern(id)] = { offset: cursor, type };
            cursor += scalarByteLength(type);
          }
        }
        maximumCursor = Math.max(maximumCursor, cursor);
      }
      let transientRegisters: Uint8Array | undefined;
      if (!leafRegisters && maximumCursor <= 8000000) {
        const candidates = new Uint8Array(values.length * 4 + 16);
        for (const block of fn.blocks) {
          if (block === undefined) throw "temporary block invariant";
          for (const op of block.instructions) {
            if (op === undefined) throw "temporary instruction invariant";
            const id = instructionResult(op);
            if (id !== undefined && id < candidates.length) {
              const type = value(id).type;
              if (type === "number" || type === "boolean") candidates[id] = 1;
              else if (managed(type) && type !== "primitive")
                candidates[id] = 2;
            }
          }
        }
        transientRegisters = temporaryRegisters(fn, candidates);
      }
      function referenceTemporary(id: number): number {
        const type = value(id).type;
        return managed(type) && type !== "primitive"
          ? (transientRegisters?.[id] ?? 0)
          : 0;
      }
      const temporaryRoots: number[] = [],
        temporaryGenerals: number[] = [],
        incomingReferences: number[] = [],
        incomingGenerals: number[] = [];
      if (hasRoots) {
        // Verified instruction results never cross block boundaries. Partition a
        // shared temporary area by root representation, then clear it at entry
        // to every block (including catch targets). Locals/environments persist.
        const classes = new Uint8Array(values.length * 4 + 16);
        for (const block of fn.blocks) {
          if (block === undefined) throw "temporary class block invariant";
          for (const op of block.instructions) {
            if (op === undefined) throw "temporary class instruction invariant";
            const id = instructionResult(op);
            if (id !== undefined && id < classes.length) {
              const type = value(id).type;
              classes[id] =
                referenceTemporary(id) !== 0
                  ? 0
                  : managed(type)
                    ? 1
                    : type === "general"
                      ? 2
                      : 0;
            }
          }
        }
        const temporaryPlan = planTemporarySlots(fn, classes);
        let referenceCount = 0,
          generalCount = 0,
          registerReferenceCount = 0;
        const referenceHomes = new Uint8Array(5);
        const referenceCounts: number[] = [],
          generalCounts: number[] = [];
        for (const block of fn.blocks) {
          if (block === undefined) throw "block invariant";
          let references = 0,
            generals = 0;
          for (const op of block.instructions) {
            if (op === undefined) throw "instruction invariant";
            const id = instructionResult(op);
            if (id === undefined) continue;
            const type = value(id).type;
            const register = referenceTemporary(id);
            if (register !== 0) {
              if (referenceHomes[register - 36] === 0)
                referenceHomes[register - 36] = ++registerReferenceCount;
            } else if (managed(type)) references++;
            else if (type === "general") generals++;
          }
          if (temporaryPlan !== undefined) {
            references = temporaryPlan.references[block.id] ?? 0;
            generals = temporaryPlan.generals[block.id] ?? 0;
          }
          referenceCount = Math.max(referenceCount, references);
          generalCount = Math.max(generalCount, generals);
          referenceCounts[block.id] = references;
          generalCounts[block.id] = generals;
        }
        function incoming(
          target: number,
          references: number,
          generals: number,
        ): void {
          incomingReferences[target] = Math.max(
            incomingReferences[target] ?? 0,
            references,
          );
          incomingGenerals[target] = Math.max(
            incomingGenerals[target] ?? 0,
            generals,
          );
        }
        for (const block of fn.blocks) {
          if (block === undefined) throw "block invariant";
          const references = referenceCounts[block.id] ?? 0,
            generals = generalCounts[block.id] ?? 0,
            term = block.terminator;
          if (term.kind === "jump") incoming(term.target, references, generals);
          else if (
            term.kind === "branch" ||
            term.kind === "cell" ||
            term.kind === "record" ||
            term.kind === "record-cell"
          ) {
            incoming(term.consequent, references, generals);
            incoming(term.alternate, references, generals);
          }
          if (block.exception !== undefined)
            incoming(block.exception.target, references, generals);
        }
        const generalOffset = valuesOffset + referenceCount * 8;
        // Register-only reference payloads have compact pseudo-homes outside
        // the GC pools. Each home names its register, never stale stack memory.
        const registerReferenceOffset = generalOffset + generalCount * 16;
        const scalarOffset =
          registerReferenceOffset + registerReferenceCount * 8;
        for (let i = 0; i < referenceCount; i++)
          temporaryRoots.push(valuesOffset + i * 8);
        for (let i = 0; i < generalCount; i++)
          temporaryGenerals.push(generalOffset + i * 16);
        maximumCursor = scalarOffset;
        for (const block of fn.blocks) {
          if (block === undefined) throw "block invariant";
          let referenceCursor = valuesOffset,
            generalCursor = generalOffset;
          cursor = scalarOffset;
          for (const op of block.instructions) {
            if (op === undefined) throw "instruction invariant";
            const id = instructionResult(op);
            if (id === undefined) continue;
            const type = value(id).type,
              register = referenceTemporary(id);
            if (register !== 0) {
              values[valueIds.intern(id)] = {
                type,
                offset:
                  registerReferenceOffset +
                  ((referenceHomes[register - 36] ?? 0) - 1) * 8,
              };
            } else if (managed(type)) {
              values[valueIds.intern(id)] = {
                type,
                offset:
                  temporaryPlan === undefined
                    ? referenceCursor
                    : valuesOffset + (temporaryPlan.slots[id] ?? 0) * 8,
              };
              referenceCursor += 8;
            } else if (type === "general") {
              values[valueIds.intern(id)] = {
                type,
                offset:
                  temporaryPlan === undefined
                    ? generalCursor
                    : generalOffset + (temporaryPlan.slots[id] ?? 0) * 16,
              };
              generalCursor += 16;
            } else {
              values[valueIds.intern(id)] = { type, offset: cursor };
              cursor += scalarByteLength(type);
            }
          }
          maximumCursor = Math.max(maximumCursor, cursor);
        }
      }
      const rootSlots: number[] = [],
        generalSlots: number[] = [];
      if (hasRoots) {
        if (fn.closureEnvironment !== undefined)
          rootSlots.push(environmentOffset);
        for (let slot = 0; slot < fn.slots.length; slot++) {
          const type = fn.slots[slot];
          if (type === undefined) throw "slot invariant";
          if (managed(type)) rootSlots.push(slotOffset(slot));
          if (type === "general") generalSlots.push(slotOffset(slot));
        }
        for (const offset of temporaryRoots) {
          if (offset === undefined) throw "root offset invariant";
          rootSlots.push(offset);
        }
        for (const offset of temporaryGenerals) {
          if (offset === undefined) throw "general offset invariant";
          generalSlots.push(offset);
        }
      }
      if (transientRegisters !== undefined) {
        const storage = new Uint8Array(Math.ceil(maximumCursor / 8));
        if (preserved !== undefined)
          for (let slot = 0; slot < fn.slots.length; slot++)
            storage[slotOffset(slot) / 8] = preserved.registers[slot] ?? 0;
        scalarRegisters = storage;
      }
      const leafStorage = leafRegisters
        ? leafStorageRegisters(
            fn,
            slotOffsets,
            value,
            localsOffset,
            maximumCursor,
          )
        : undefined;
      if (leafStorage !== undefined) scalarRegisters = leafStorage;
      const calleeSaveOffset = Math.ceil(maximumCursor / 8) * 8;
      const frameBytes =
        Math.ceil((calleeSaveOffset + preservedCount * 8) / 16) * 16;
      if (!Number.isSafeInteger(frameBytes) || frameBytes > 0xffffffff)
        fail(
          "FRAME_LIMIT",
          "scalar frame exceeds supported 32-bit byte offsets",
        );
      const start = instructions.length * 4,
        offsets: (number | undefined)[] = [];
      blockOffsets.push({ offsets });
      const frameRanges: { offset: number; byteLength: number }[] = [];
      let frameStart: number | undefined;
      function endFrameRange(): void {
        const end = instructions.length * 4;
        if (debugSpans && frameStart !== undefined && end > frameStart)
          frameRanges.push({
            offset: frameStart,
            byteLength: end - frameStart,
          });
      }
      let throwExit = false;
      function exceptionalBranch(condition: Branch): void {
        const handler =
          blockId === undefined ? undefined : fn.blocks[blockId]?.exception;
        if (handler === undefined) {
          throwExit = true;
          branch(condition, fn.id, -1);
        } else branch(condition, fn.id, -2 - (blockId ?? 0));
      }
      function epilogue(): void {
        endFrameRange();
        if (hasRoots) {
          rawLoad(10, contextOffset);
          rawLoad(9, rootOffset);
          emit({ op: "str", width: 64, rt: 9, rn: 10, offset: 0 });
        }
        for (let index = 0; index < preservedCount; index++)
          emit({
            op: "ldr-d",
            rt: 8 + index,
            rn: "sp",
            offset: calleeSaveOffset + index * 8,
          });
        adjust("add-imm", frameBytes);
        emit({
          op: "ldp",
          width: 64,
          rt: 29,
          rt2: 30,
          rn: "sp",
          offset: 16,
          mode: "post",
        });
        emit({ op: "ret", rn: 30 });
        // Later blocks are entered with this frame still live, not by falling
        // through the preceding return. Their scopes begin after its teardown.
        frameStart = instructions.length * 4;
      }
      emit({
        op: "stp",
        width: 64,
        rt: 29,
        rt2: 30,
        rn: "sp",
        offset: -16,
        mode: "pre",
      });
      address(29, 0);
      adjust("sub-imm", frameBytes);
      for (let index = 0; index < preservedCount; index++)
        emit({
          op: "str-d",
          rt: 8 + index,
          rn: "sp",
          offset: calleeSaveOffset + index * 8,
        });
      rawStore(0, contextOffset);
      rawStore(3, resultPointerOffset);
      frameStart = instructions.length * 4;
      for (const offset of rootSlots) {
        if (offset === undefined) throw "root slot invariant";
        rawStore("zr", offset);
      }
      for (const offset of generalSlots) {
        if (offset === undefined) throw "general root slot invariant";
        rawStore("zr", offset);
        rawStore("zr", offset + 8);
      }
      if (fn.environment !== undefined || fn.closureEnvironment !== undefined)
        rawStore(1, environmentOffset);
      if (fn.receiverSlot !== undefined) {
        const offset = slotOffset(fn.receiverSlot);
        // Copy the caller-rooted value before any safepoint; never retain its address.
        rawStore("zr", offset);
        rawStore("zr", offset + 8);
        const absent = instructions.length;
        emit({ op: "cbz", width: 64, rt: 2, displacement: 0 });
        emit({ op: "ldr", width: 64, rt: 10, rn: 2, offset: 0 });
        emit({ op: "ldr", width: 64, rt: 11, rn: 2, offset: 8 });
        rawStore(10, offset);
        rawStore(11, offset + 8);
        patchInstruction(absent, {
          op: "cbz",
          width: 64,
          rt: 2,
          displacement: (instructions.length - absent) * 4,
        });
      }
      for (let i = 0; i < fn.parameters.length; i++) {
        const slot = fn.parameters[i],
          location = signature.parameters[i];
        if (slot === undefined || location === undefined)
          throw "parameter layout invariant";
        const offset = slotOffset(slot);
        if (
          fn.slots[slot] === "general" ||
          fn.slots[slot] === "optional-number" ||
          fn.slots[slot] === "optional-boolean"
        ) {
          if (location.kind === "integer")
            emit({
              op: "orr-reg",
              width: 64,
              rd: 9,
              rn: "zr",
              rm: location.index,
            });
          else
            emit({
              op: "ldr",
              width: 64,
              rt: 9,
              rn: 29,
              offset: 16 + location.index,
            });
          emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
          emit({ op: "ldr", width: 64, rt: 11, rn: 9, offset: 8 });
          rawStore(10, offset);
          rawStore(11, offset + 8);
        } else if (location.kind === "float") {
          const register =
            scalarRegisters === undefined
              ? 0
              : (scalarRegisters[offset / 8] ?? 0);
          if (register !== 0)
            emit({ op: "fmov-d-d", rd: register, rn: location.index });
          else emit({ op: "str-d", rt: location.index, rn: "sp", offset });
        } else if (location.kind === "integer")
          rawStore(location.index, offset);
        else {
          emit({
            op: "ldr",
            width: 64,
            rt: 9,
            rn: 29,
            offset: 16 + location.index,
          });
          rawStore(9, offset);
        }
      }
      if (hasRoots) {
        rawLoad(10, contextOffset);
        emit({ op: "ldr", width: 64, rt: 9, rn: 10, offset: 0 });
        rawStore(9, rootOffset);
        rootRequests.push({
          function: fn.id,
          frameOffset: rootOffset,
          offsets: rootSlots.map((offset) => offset - rootOffset),
          generalOffsets: generalSlots.map((offset) => offset - rootOffset),
          fixup: instructions.length * 4,
        });
        relativePointer(9);
        rawStore(9, rootOffset + 8);
        address(9, rootOffset);
        emit({ op: "str", width: 64, rt: 9, rn: 10, offset: 0 });
      }
      if (fn.blocks[0]?.id !== fn.entry) branch({ op: "b" }, fn.id, fn.entry);
      // Facts describe actual IR operations, never unchecked source annotations.
      // 1: a constant modulo word; 2: a signed/unsigned 32-bit integer result;
      // 3: an exact unsigned 32-bit constant, also valid as a memory argument.
      // 4: an optional 32-bit integer; 5: a 32-bit integer or NaN after unwrap.
      // 6/7: a bounded safe integer, without/with possible NaN. Magnitudes
      // prove signed-64 conversion safe, but do not imply valid array indices.
      const integerFacts = stableSlots
        ? provenWordFacts(
            fn,
            1000000,
            wordReturns,
            provenInductionWords(fn),
            wordArguments === undefined ? undefined : wordArguments[fn.id],
          )
        : undefined;
      const slotIntegerFacts =
        integerFacts === undefined ? undefined : integerFacts.slots;
      const nonNullValues = new Uint8Array(values.length),
        wordKinds = new Uint8Array(values.length),
        wordConstants = new Uint32Array(values.length),
        wordMagnitudes = new Float64Array(values.length),
        slotWordBlocks = new Uint32Array(fn.slots.length),
        slotWordValues = new Uint32Array(fn.slots.length);
      const wordStorage = wordOnlyValues(fn);
      function storedAsWord(id: number): boolean {
        return wordStorage !== undefined && wordStorage[id] === 1;
      }
      function wordMagnitude(index: number): number {
        const kind = wordKinds[index] ?? 0;
        if (kind === 2 || kind === 5) return 4294967295;
        if (kind === 3) return wordConstants[index] ?? 0;
        if (kind === 1 || kind === 6 || kind === 7) {
          const magnitude = wordMagnitudes[index] ?? 0;
          if (magnitude > 0) return magnitude;
        }
        return -1;
      }
      function wordValue(id: number): void {
        if (storedAsWord(id)) {
          rawLoad(9, value(id).offset);
          return;
        }
        const index = valueIds.intern(id),
          kind = wordKinds[index];
        if (kind === 1 || kind === 3) imm(9, wordConstants[index] ?? 0);
        else if (kind === 2 || kind === 5 || kind === 6 || kind === 7) {
          floatLoad(0, id);
          emit({ op: "fcvtzs-x-d", rd: 9, rn: 0 });
        } else {
          rawValue(9, id);
          callHelper("to-uint32");
        }
      }
      function floatLoad(rt: number, id: number, byteOffset: number = 0): void {
        const storage = scalarRegisters,
          offset = value(id).offset + byteOffset,
          register = storage === undefined ? 0 : (storage[offset / 8] ?? 0);
        if (register >= 32) emit({ op: "fmov-d-x", rd: rt, rn: register - 32 });
        else if (register !== 0) emit({ op: "fmov-d-d", rd: rt, rn: register });
        else emit({ op: "ldr-d", rt, rn: "sp", offset });
      }
      function floatStore(rt: number, id: number): void {
        const storage = scalarRegisters,
          offset = value(id).offset,
          register = storage === undefined ? 0 : (storage[offset / 8] ?? 0);
        if (register >= 32) emit({ op: "fmov-x-d", rd: register - 32, rn: rt });
        else if (register !== 0) emit({ op: "fmov-d-d", rd: register, rn: rt });
        else emit({ op: "str-d", rt, rn: "sp", offset });
      }
      /** Ordinary numeric ALU operands may name their existing FP homes. Only
       * stack-backed values need a scratch load; no conversion or guard changes. */
      function floatOperand(id: number, scratch: number): number {
        const storage = scalarRegisters,
          offset = value(id).offset,
          register = storage === undefined ? 0 : (storage[offset / 8] ?? 0);
        if (register !== 0 && register < 32) return register;
        floatLoad(scratch, id);
        return scratch;
      }
      function rawValue(rt: number, id: number): void {
        rawLoad(rt, value(id).offset);
      }
      function saveRaw(rt: number, id: number): void {
        rawStore(rt, value(id).offset);
      }
      function descriptorPointer(record: number): void {
        if (record === functionRecord && brandImport !== undefined)
          managedPointer(11, brandImport);
        else {
          const imported = recordImports.get(record);
          if (imported !== undefined) managedPointer(11, imported);
          else {
            recordFixups.push({ offset: instructions.length * 4, record });
            relativePointer(11);
          }
        }
      }
      function guardDescriptor(
        pointer: number,
        record: number,
        failure?: number,
        layoutKnown: boolean = false,
        nonNullKnown: boolean = false,
      ): void {
        if (!nonNullKnown && failure !== undefined)
          branch({ op: "cbz", width: 64, rt: pointer }, fn.id, failure);
        else if (!nonNullKnown) {
          emit({ op: "cbnz", width: 64, rt: pointer, displacement: 8 });
          emit({ op: "brk", immediate: 3 });
        }
        if (layoutKnown) return;
        emit({ op: "ldr", width: 64, rt: 10, rn: pointer, offset: 0 });
        descriptorPointer(record);
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
        if (failure !== undefined)
          branch({ op: "b.cond", condition: "ne" }, fn.id, failure);
        else {
          emit({ op: "b.cond", condition: "eq", displacement: 8 });
          emit({ op: "brk", immediate: 3 });
        }
      }
      function truth(operand: number, invert: boolean): void {
        const v = value(operand);
        if (v.type === "general") {
          const exits: number[] = [];
          // Dispatch on the value category, never on the payload address:
          // zero numbers and empty strings can have nonzero stored bits/pointers.
          for (let tag = 0; tag <= 6; tag++) {
            rawValue(9, operand);
            emit({
              op: "sub-imm",
              width: 64,
              rd: "zr",
              rn: 9,
              immediate: tag,
              shift: 0,
              setFlags: true,
            });
            const skip = instructions.length;
            emit({ op: "b.cond", condition: "ne", displacement: 0 });
            if (tag === 0 || tag === 4) imm(9, 0);
            else if (tag === 5 || tag === 6) imm(9, 1);
            else {
              rawLoad(9, v.offset + 8);
              if (tag === 1) {
                emit({ op: "fmov-d-x", rd: 0, rn: 9 });
                emit({ op: "fmov-d-x", rd: 1, rn: "zr" });
                emit({ op: "fcmp", rn: 0, rm: 1 });
                imm(9, 0);
                emit({ op: "b.cond", condition: "vs", displacement: 8 });
                emit({ op: "cset", rd: 9, condition: "ne" });
              } else if (tag === 3) {
                emit({ op: "ldr", width: 32, rt: 9, rn: 9, offset: 16 });
                emit({
                  op: "sub-imm",
                  width: 64,
                  rd: "zr",
                  rn: 9,
                  immediate: 0,
                  shift: 0,
                  setFlags: true,
                });
                emit({ op: "cset", rd: 9, condition: "ne" });
              }
            }
            exits.push(instructions.length);
            emit({ op: "b", displacement: 0 });
            patchInstruction(skip, {
              op: "b.cond",
              condition: "ne",
              displacement: (instructions.length - skip) * 4,
            });
          }
          // BigInt has no native payload contract yet; do not silently guess.
          emit({ op: "brk", immediate: 3 });
          for (const exit of exits) {
            if (exit === undefined) throw "general truth fixup invariant";
            patchInstruction(exit, {
              op: "b",
              displacement: (instructions.length - exit) * 4,
            });
          }
          if (invert) {
            imm(10, 1);
            emit({ op: "eor-reg", width: 32, rd: 9, rn: 9, rm: 10 });
          }
        } else if (v.type === "number" || v.type === "optional-number") {
          const numericInvert = invert && v.type === "number";
          floatLoad(0, operand);
          emit({ op: "fmov-d-x", rd: 1, rn: "zr" });
          emit({ op: "fcmp", rn: 0, rm: 1 });
          imm(9, numericInvert ? 1 : 0);
          // Unordered (NaN) is falsy. Skip the ordered condition result.
          emit({ op: "b.cond", condition: "vs", displacement: 8 });
          emit({ op: "cset", rd: 9, condition: numericInvert ? "eq" : "ne" });
          if (v.type === "optional-number") {
            rawLoad(10, v.offset + 8);
            emit({ op: "and-reg", width: 32, rd: 9, rn: 9, rm: 10 });
            if (invert) {
              imm(10, 1);
              emit({ op: "eor-reg", width: 32, rd: 9, rn: 9, rm: 10 });
            }
          }
        } else {
          rawValue(9, operand);
          if (v.type === "optional-boolean") {
            rawLoad(10, v.offset + 8);
            emit({ op: "and-reg", width: 32, rd: 9, rn: 9, rm: 10 });
          }
          if (v.type === "optional-string")
            emit({ op: "cbz", width: 64, rt: 9, displacement: 8 });
          if (v.type === "string" || v.type === "optional-string")
            emit({ op: "ldr", width: 32, rt: 9, rn: 9, offset: 16 });
          emit({
            op: "sub-imm",
            width: 64,
            rd: "zr",
            rn: 9,
            immediate: 0,
            shift: 0,
            setFlags: true,
          });
          emit({ op: "cset", rd: 9, condition: invert ? "eq" : "ne" });
        }
      }
      // Size emission must be nonallocating and preserve x9 when writing x10.
      // prepare runs before the callback; size can reload stable stack metadata after it.
      // Returns an uninitialized object in x9. Initialize and publish before any safepoint.
      function allocate(prepare: () => void, size: (rd: number) => void): void {
        prepare();
        let fastDone = -1;
        if (linearAllocation) {
          // All allocation producers pass positive aligned uint32 extents. The
          // runtime publishes stable control storage and maintains its cursor.
          size(9);
          rawLoad(10, contextOffset);
          emit({
            op: "ldr",
            width: 64,
            rt: 12,
            rn: 10,
            offset: nativeAllocationStateOffset,
          });
          const absent = instructions.length;
          emit({ op: "cbz", width: 64, rt: 12, displacement: 0 });
          emit({ op: "ldr", width: 32, rt: 11, rn: 12, offset: 0 });
          emit({ op: "ldr", width: 32, rt: 13, rn: 12, offset: 4 });
          emit({
            op: "sub-reg",
            width: 64,
            rd: 14,
            rn: 13,
            rm: 11,
            shift: "lsl",
            amount: 0,
            setFlags: false,
          });
          emit({
            op: "sub-reg",
            width: 64,
            rd: "zr",
            rn: 9,
            rm: 14,
            shift: "lsl",
            amount: 0,
            setFlags: true,
          });
          const exhausted = instructions.length;
          emit({ op: "b.cond", condition: "hi", displacement: 0 });
          emit({
            op: "add-reg",
            width: 32,
            rd: 13,
            rn: 11,
            rm: 9,
            shift: "lsl",
            amount: 0,
            setFlags: false,
          });
          emit({ op: "str", width: 32, rt: 13, rn: 12, offset: 0 });
          emit({ op: "ldr", width: 64, rt: 13, rn: 12, offset: 16 });
          emit({ op: "ubfm", width: 32, rd: 14, rn: 11, immr: 9, imms: 31 });
          emit({
            op: "add-reg",
            width: 64,
            rd: 14,
            rn: 13,
            rm: 14,
            shift: "lsl",
            amount: 2,
            setFlags: false,
          });
          emit({ op: "ubfm", width: 32, rd: 15, rn: 11, immr: 4, imms: 8 });
          imm(9, 1);
          emit({ op: "lslv", width: 32, rd: 9, rn: 9, rm: 15 });
          emit({ op: "ldr", width: 32, rt: 15, rn: 14, offset: 0 });
          emit({ op: "orr-reg", width: 32, rd: 15, rn: 15, rm: 9 });
          emit({ op: "str", width: 32, rt: 15, rn: 14, offset: 0 });
          emit({ op: "ldr", width: 32, rt: 9, rn: 12, offset: 8 });
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
          emit({ op: "ldr", width: 64, rt: 10, rn: 10, offset: 8 });
          emit({
            op: "add-reg",
            width: 64,
            rd: 9,
            rn: 10,
            rm: 9,
            shift: "lsl",
            amount: 0,
            setFlags: false,
          });
          fastDone = instructions.length;
          emit({ op: "b", displacement: 0 });
          const slow = instructions.length;
          patchInstruction(absent, {
            op: "cbz",
            width: 64,
            rt: 12,
            displacement: (slow - absent) * 4,
          });
          patchInstruction(exhausted, {
            op: "b.cond",
            condition: "hi",
            displacement: (slow - exhausted) * 4,
          });
        }
        for (let offset = 0; offset < 32; offset += 8)
          rawStore("zr", resultOffset + offset);
        rawLoad(0, contextOffset);
        emit({ op: "ldr", width: 64, rt: 1, rn: 0, offset: 24 });
        emit({ op: "ldr", width: 64, rt: 16, rn: 0, offset: 16 });
        emit({ op: "cbnz", width: 64, rt: 16, displacement: 8 });
        emit({ op: "brk", immediate: 3 });
        imm(2, 0);
        address(3, resultOffset);
        size(9);
        emit({ op: "ucvtf-d-w", rd: 0, rn: 9 });
        emit({ op: "blr", rn: 16 });
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
        rawLoad(9, resultOffset + 24);
        emit({
          op: "sub-imm",
          width: 64,
          rd: "zr",
          rn: 9,
          immediate: 1,
          shift: 0,
          setFlags: true,
        });
        emit({ op: "b.cond", condition: "eq", displacement: 8 });
        emit({ op: "brk", immediate: 3 });
        // Validate the allocator's numeric offset before forming a native pointer.
        rawLoad(9, resultOffset + 16);
        callHelper("to-uint32");
        emit({ op: "ucvtf-d-w", rd: 0, rn: 9 });
        emit({ op: "ldr-d", rt: 1, rn: "sp", offset: resultOffset + 16 });
        emit({ op: "fcmp", rn: 0, rm: 1 });
        emit({ op: "b.cond", condition: "eq", displacement: 8 });
        emit({ op: "brk", immediate: 3 });
        emit({ op: "ubfm", width: 32, rd: 10, rn: 9, immr: 0, imms: 3 });
        emit({ op: "cbz", width: 32, rt: 10, displacement: 8 });
        emit({ op: "brk", immediate: 3 });
        size(10);
        emit({
          op: "add-reg",
          width: 64,
          rd: 11,
          rn: 9,
          rm: 10,
          shift: "lsl",
          amount: 0,
          setFlags: false,
        });
        rawLoad(10, contextOffset);
        emit({ op: "ldr", width: 64, rt: 12, rn: 10, offset: 32 });
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
        emit({ op: "b.cond", condition: "ls", displacement: 8 });
        emit({ op: "brk", immediate: 3 });
        emit({ op: "ldr", width: 64, rt: 10, rn: 10, offset: 8 });
        emit({ op: "cbnz", width: 64, rt: 10, displacement: 8 });
        emit({ op: "brk", immediate: 3 });
        emit({
          op: "add-reg",
          width: 64,
          rd: 9,
          rn: 10,
          rm: 9,
          shift: "lsl",
          amount: 0,
          setFlags: false,
        });
        if (fastDone >= 0)
          patchInstruction(fastDone, {
            op: "b",
            displacement: (instructions.length - fastDone) * 4,
          });
      }
      // Combined code-unit count in x11; checked rounded extent saved across allocation.
      function prepareStringSize(): void {
        // align16(24 + 2 * length) must fit the uint32 allocation contract.
        imm(12, maximumStringLength);
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
        emit({ op: "b.cond", condition: "ls", displacement: 8 });
        emit({ op: "brk", immediate: 3 });
        imm(12, 39);
        emit({
          op: "add-reg",
          width: 64,
          rd: 12,
          rn: 12,
          rm: 11,
          shift: "lsl",
          amount: 1,
          setFlags: false,
        });
        emit({
          op: "ubfm",
          width: 64,
          rd: 12,
          rn: 12,
          immr: 4,
          imms: 63,
        });
        emit({
          op: "add-reg",
          width: 64,
          rd: 12,
          rn: "zr",
          rm: 12,
          shift: "lsl",
          amount: 4,
          setFlags: false,
        });
        rawStore(12, allocationOffset);
      }
      // Typed-array object: marker +0, flags +8, length +16, data pointer +24.
      // Returns index in x9, data pointer in x10, validity in x13.
      function arrayIndex(
        array: number,
        index: number,
        vector: boolean = false,
      ): void {
        const fact = valueIds.intern(index),
          kind = wordKinds[fact];
        if (kind === 1) {
          // A constant that is not an exact uint32 can never be an index.
          imm(13, 0);
          return;
        }
        if (kind === 3) imm(9, wordConstants[fact] ?? 0);
        else {
          floatLoad(0, index);
          emit({ op: "fcvtzs-x-d", rd: 9, rn: 0 });
        }
        if (kind !== 2 && kind !== 3) {
          // Unknown numbers require an exact uint32 round trip. For proved
          // signed/unsigned words, the unsigned length check also rejects negatives.
          emit({ op: "ucvtf-d-w", rd: 0, rn: 9 });
          floatLoad(1, index);
          emit({ op: "fcmp", rn: 0, rm: 1 });
          emit({ op: "cset", rd: 13, condition: "eq" });
        }
        rawValue(10, array);
        emit({ op: "ldr", width: 32, rt: 11, rn: 10, offset: 16 });
        if (vector)
          emit({
            op: "add-imm",
            width: 64,
            rd: 10,
            rn: 10,
            immediate: 32,
            shift: 0,
            setFlags: false,
          });
        else emit({ op: "ldr", width: 64, rt: 10, rn: 10, offset: 24 });
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
        if (kind === 2 || kind === 3)
          emit({ op: "cset", rd: 13, condition: "cc" });
        else {
          emit({ op: "cset", rd: 12, condition: "cc" });
          emit({ op: "and-reg", width: 32, rd: 13, rn: 13, rm: 12 });
        }
      }
      function allocateIndexed(
        id: number,
        length: number,
        elementShift: number,
        marker: number,
      ): void {
        allocate(
          () => {
            rawValue(9, length);
            callHelper("to-uint32");
            emit({ op: "ucvtf-d-w", rd: 0, rn: 9 });
            floatLoad(1, length);
            emit({ op: "fcmp", rn: 0, rm: 1 });
            emit({ op: "b.cond", condition: "eq", displacement: 8 });
            emit({ op: "brk", immediate: 3 });
            rawStore(9, allocationOffset + 8);
            imm(11, 47);
            emit({
              op: "add-reg",
              width: 64,
              rd: 11,
              rn: 11,
              rm: 9,
              shift: "lsl",
              amount: elementShift,
              setFlags: false,
            });
            imm(12, 0xffffffff);
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
            emit({ op: "b.cond", condition: "ls", displacement: 8 });
            emit({ op: "brk", immediate: 3 });
            emit({
              op: "ubfm",
              width: 64,
              rd: 11,
              rn: 11,
              immr: 4,
              imms: 63,
            });
            emit({
              op: "add-reg",
              width: 64,
              rd: 11,
              rn: "zr",
              rm: 11,
              shift: "lsl",
              amount: 4,
              setFlags: false,
            });
            rawStore(11, allocationOffset);
          },
          (rd) => rawLoad(rd, allocationOffset),
        );
        rawLoad(10, allocationOffset + 8);
        rawLoad(11, allocationOffset);
        imm(12, marker);
        callHelper("array-initialize");
        if (marker === 6)
          emit({ op: "str", width: 64, rt: "zr", rn: 9, offset: 24 });
        saveRaw(9, id);
      }
      /** Only trusted cell operations accept these general handles. Check the
       * tag and physical marker before any field access; there is no fake record
       * descriptor or source-level brand property on this allocation kind. */
      function weakHeader(cell: number): void {
        rawValue(11, cell);
        emit({
          op: "sub-imm",
          width: 64,
          rd: "zr",
          rn: 11,
          immediate: 5,
          shift: 0,
          setFlags: true,
        });
        emit({ op: "b.cond", condition: "eq", displacement: 8 });
        emit({ op: "brk", immediate: 3 });
        rawLoad(10, value(cell).offset + 8);
        emit({ op: "cbnz", width: 64, rt: 10, displacement: 8 });
        emit({ op: "brk", immediate: 3 });
        emit({ op: "ldr", width: 64, rt: 11, rn: 10, offset: 0 });
        emit({
          op: "sub-imm",
          width: 64,
          rd: "zr",
          rn: 11,
          immediate: nativeWeakSlotMarker,
          shift: 0,
          setFlags: true,
        });
        emit({ op: "b.cond", condition: "eq", displacement: 8 });
        emit({ op: "brk", immediate: 3 });
      }
      function vectorHeader(vector: number): void {
        rawValue(10, vector);
        emit({ op: "cbnz", width: 64, rt: 10, displacement: 8 });
        emit({ op: "brk", immediate: 3 });
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
        emit({ op: "b.cond", condition: "eq", displacement: 8 });
        emit({ op: "brk", immediate: 3 });
      }
      const flowGuards =
        recordFlows === undefined ? undefined : recordFlows[fn.id];
      const recordGuards = provenRecordGuards(
        fn,
        Math.min(100000, values.length * 8 + fn.blocks.length * 8 + 256),
        stableLayouts,
      );
      const trackedSlots: number[] = [];
      if (hasRoots) {
        for (let slot = 0; slot < fn.slots.length; slot++) {
          const type = fn.slots[slot];
          if (type !== undefined && (managed(type) || type === "general"))
            trackedSlots.push(slot);
        }
      }
      const deadSlots = hasRoots
        ? deadSlotsAtEntry(fn, 10000000, trackedSlots)
        : undefined;
      for (let blockIndex = 0; blockIndex < fn.blocks.length; blockIndex++) {
        const b = fn.blocks[blockIndex],
          nextBlock = fn.blocks[blockIndex + 1]?.id;
        if (b === undefined) throw "block invariant";
        const transient = transientRegisters,
          storage = scalarRegisters;
        if (transient !== undefined && storage !== undefined)
          for (const op of b.instructions) {
            if (op === undefined) throw "temporary instruction invariant";
            const id = instructionResult(op);
            if (id !== undefined && transient[id] !== 0)
              storage[value(id).offset / 8] = transient[id] ?? 0;
          }
        blockId = b.id;
        offsets[b.id * 2] = instructions.length * 4;
        span = undefined;
        for (const slot of deadSlots?.[b.id] ?? []) {
          if (slot === undefined) throw "dead slot invariant";
          const type = fn.slots[slot];
          if (type === undefined) throw "dead slot invariant";
          if (managed(type) || type === "general")
            rawStore("zr", slotOffset(slot));
          if (type === "general") rawStore("zr", slotOffset(slot) + 8);
        }
        // Each block defines a prefix of each pool. Clear the largest prefix
        // any predecessor can leave, including exceptional predecessors. This
        // bounds emitted cleanup by CFG edges rather than blocks * frame size.
        for (let i = 0; i < (incomingReferences[b.id] ?? 0); i++) {
          const offset = temporaryRoots[i];
          if (offset === undefined) throw "root offset invariant";
          rawStore("zr", offset);
        }
        for (let i = 0; i < (incomingGenerals[b.id] ?? 0); i++) {
          const offset = temporaryGenerals[i];
          if (offset === undefined) throw "general offset invariant";
          rawStore("zr", offset);
          rawStore("zr", offset + 8);
        }
        for (const op of b.instructions) {
          if (op === undefined) throw "instruction invariant";
          span = { start: op.start, end: op.end };
          if (op.kind === "load" && slotIntegerFacts !== undefined) {
            const mask = slotIntegerFacts[op.slot] ?? 0,
              index = valueIds.intern(op.id);
            if (fn.slots[op.slot] === "number") {
              if (mask === 1) wordKinds[index] = 2;
              else if (mask !== 0 && (mask & ~3) === 0) wordKinds[index] = 5;
            } else if (
              fn.slots[op.slot] === "optional-number" &&
              mask !== 0 &&
              (mask & ~9) === 0
            )
              wordKinds[index] = 4;
          }
          if (stableLayouts) {
            if (
              op.kind === "reference-value" ||
              op.kind === "primitive-wrap" ||
              op.kind === "primitive-reference"
            )
              nonNullValues[valueIds.intern(op.id)] = 1;
            else if (op.kind === "reference-wrap")
              nonNullValues[valueIds.intern(op.id)] =
                nonNullValues[valueIds.intern(op.value)] ?? 0;
            else if (
              op.kind === "load" &&
              slotWordBlocks[op.slot] === b.id + 1
            ) {
              const stored = slotWordValues[op.slot];
              if (stored === undefined) throw "nonnull slot invariant";
              nonNullValues[valueIds.intern(op.id)] =
                nonNullValues[stored] ?? 0;
            }
          }
          if (op.kind === "call" && op.id !== undefined && stableSlots) {
            const resultId = op.id;
            if (resultId === undefined) throw "word call result invariant";
            const mask = wordReturns[op.target] ?? 0,
              index = valueIds.intern(resultId);
            if (value(resultId).type === "number") {
              if (mask === 1) wordKinds[index] = 2;
              else if (mask !== 0 && (mask & ~3) === 0) wordKinds[index] = 5;
            } else if (
              value(resultId).type === "optional-number" &&
              mask !== 0 &&
              (mask & ~9) === 0
            )
              wordKinds[index] = 4;
          }
          if (op.kind === "constant") {
            const constant = op.value;
            if (typeof constant === "number") {
              const index = valueIds.intern(op.id);
              const word = constant >>> 0;
              wordKinds[index] = word === constant ? 3 : 1;
              wordConstants[index] = word;
              if (Number.isSafeInteger(constant))
                wordMagnitudes[index] = constant < 0 ? -constant : constant;
            }
          } else if (
            (op.kind === "unary" && op.operator === "~") ||
            (op.kind === "binary" &&
              ["&", "|", "^", "<<", ">>", ">>>"].includes(op.operator))
          )
            wordKinds[valueIds.intern(op.id)] = 2;
          else if (op.kind === "array-length")
            wordKinds[valueIds.intern(op.id)] = 2;
          else if (
            op.kind === "array-read" &&
            value(op.array).type !== "Float64Array"
          )
            wordKinds[valueIds.intern(op.id)] = 4;
          else if (
            op.kind === "optional-value" &&
            wordKinds[valueIds.intern(op.value)] === 4
          )
            wordKinds[valueIds.intern(op.id)] = 5;
          else if (op.kind === "optional-wrap") {
            const kind = wordKinds[valueIds.intern(op.value)];
            if (kind === 2 || kind === 3) wordKinds[valueIds.intern(op.id)] = 4;
          } else if (op.kind === "store") {
            // Slot addresses do not escape this IR. Only stores in this block
            // establish facts; joins and exception-entry assignments stay unknown.
            slotWordBlocks[op.slot] = b.id + 1;
            slotWordValues[op.slot] = valueIds.intern(op.value);
          } else if (
            op.kind === "load" &&
            slotWordBlocks[op.slot] === b.id + 1
          ) {
            const stored = slotWordValues[op.slot];
            if (stored === undefined) throw "word slot invariant";
            const index = valueIds.intern(op.id);
            const storedKind = wordKinds[stored] ?? 0;
            if (storedKind !== 0) wordKinds[index] = storedKind;
            wordConstants[index] = wordConstants[stored] ?? 0;
            wordMagnitudes[index] = wordMagnitudes[stored] ?? 0;
          }
          if (
            op.kind === "binary" &&
            (op.operator === "+" || op.operator === "-")
          ) {
            const left = valueIds.intern(op.left),
              right = valueIds.intern(op.right),
              leftBound = wordMagnitude(left),
              rightBound = wordMagnitude(right),
              bound = leftBound + rightBound;
            if (
              leftBound >= 0 &&
              rightBound >= 0 &&
              bound <= 9007199254740991
            ) {
              const index = valueIds.intern(op.id),
                leftKind = wordKinds[left],
                rightKind = wordKinds[right];
              wordKinds[index] =
                leftKind === 5 ||
                leftKind === 7 ||
                rightKind === 5 ||
                rightKind === 7
                  ? 7
                  : 6;
              wordMagnitudes[index] = Math.max(1, bound);
            }
          }
          switch (op.kind) {
            case "function-address":
              if (directReturns !== undefined && directReturns[op.target] === 1)
                fail(
                  "INVALID_IR",
                  "function address target uses a private call ABI",
                );
              if (op.part === "entry") functionEntryPointer(10, op.target);
              else functionSignaturePointer(10, op.target);
              emit({ op: "scvtf-d-x", rd: 0, rn: 10 });
              floatStore(0, op.id);
              break;
            case "record-descriptor-address":
              descriptorPointer(op.record);
              emit({ op: "scvtf-d-x", rd: 0, rn: 11 });
              floatStore(0, op.id);
              break;
            case "general-record-is":
            case "general-record-descriptor": {
              const reflection = op.kind === "general-record-descriptor";
              rawValue(9, op.value);
              if (reflection) {
                imm(12, 1);
                emit({ op: "scvtf-d-x", rd: 0, rn: 12 });
                emit({ op: "fneg", rd: 0, rn: 0 });
              } else imm(12, 0);
              emit({
                op: "sub-imm",
                width: 64,
                rd: "zr",
                rn: 9,
                immediate: 5,
                shift: 0,
                setFlags: true,
              });
              const nonObject = instructions.length;
              emit({ op: "b.cond", condition: "ne", displacement: 0 });
              rawLoad(9, value(op.value).offset + 8);
              const absent = instructions.length;
              emit({ op: "cbz", width: 64, rt: 9, displacement: 0 });
              emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
              descriptorPointer(op.record);
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
              let different: number | undefined, tooLarge: number | undefined;
              if (reflection) {
                different = instructions.length;
                emit({ op: "b.cond", condition: "ne", displacement: 0 });
                imm(12, Number.MAX_SAFE_INTEGER);
                emit({
                  op: "sub-reg",
                  width: 64,
                  rd: "zr",
                  rn: 10,
                  rm: 12,
                  shift: "lsl",
                  amount: 0,
                  setFlags: true,
                });
                tooLarge = instructions.length;
                emit({ op: "b.cond", condition: "hi", displacement: 0 });
                emit({ op: "scvtf-d-x", rd: 0, rn: 10 });
              } else emit({ op: "cset", rd: 12, condition: "eq" });
              if (different !== undefined)
                patchInstruction(different, {
                  op: "b.cond",
                  condition: "ne",
                  displacement: (instructions.length - different) * 4,
                });
              if (tooLarge !== undefined)
                patchInstruction(tooLarge, {
                  op: "b.cond",
                  condition: "hi",
                  displacement: (instructions.length - tooLarge) * 4,
                });
              patchInstruction(nonObject, {
                op: "b.cond",
                condition: "ne",
                displacement: (instructions.length - nonObject) * 4,
              });
              patchInstruction(absent, {
                op: "cbz",
                width: 64,
                rt: 9,
                displacement: (instructions.length - absent) * 4,
              });
              if (reflection) floatStore(0, op.id);
              else saveRaw(12, op.id);
              break;
            }
            case "general-kind": {
              const names: string[] = [
                "undefined",
                "number",
                "boolean",
                "string",
                "object",
                "object",
                "symbol",
                "bigint",
              ];
              const exits: number[] = [];
              for (let tag = 0; tag < names.length; tag++) {
                const name = names[tag];
                if (name === undefined) throw "general category invariant";
                rawValue(9, op.value);
                emit({
                  op: "sub-imm",
                  width: 64,
                  rd: "zr",
                  rn: 9,
                  immediate: tag,
                  shift: 0,
                  setFlags: true,
                });
                const skip = instructions.length;
                emit({ op: "b.cond", condition: "ne", displacement: 0 });
                if (tag === 5 && hasFunctions) {
                  rawLoad(9, value(op.value).offset + 8);
                  emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
                  descriptorPointer(functionRecord);
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
                  const ordinaryObject = instructions.length;
                  emit({ op: "b.cond", condition: "ne", displacement: 0 });
                  stringFixups.push({
                    offset: instructions.length * 4,
                    value: "function",
                  });
                  relativePointer(9);
                  exits.push(instructions.length);
                  emit({ op: "b", displacement: 0 });
                  patchInstruction(ordinaryObject, {
                    op: "b.cond",
                    condition: "ne",
                    displacement: (instructions.length - ordinaryObject) * 4,
                  });
                }
                stringFixups.push({
                  offset: instructions.length * 4,
                  value: name,
                });
                relativePointer(9);
                exits.push(instructions.length);
                emit({ op: "b", displacement: 0 });
                patchInstruction(skip, {
                  op: "b.cond",
                  condition: "ne",
                  displacement: (instructions.length - skip) * 4,
                });
              }
              emit({ op: "brk", immediate: 3 });
              const done = instructions.length;
              for (const at of exits) {
                if (at === undefined) throw "general typeof fixup invariant";
                patchInstruction(at, {
                  op: "b",
                  displacement: (done - at) * 4,
                });
              }
              saveRaw(9, op.id);
              break;
            }
            case "general-equal": {
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
              const different = instructions.length;
              emit({ op: "b.cond", condition: "ne", displacement: 0 });
              // BigInt equality requires its payload runtime, which is not implemented yet.
              emit({
                op: "sub-imm",
                width: 64,
                rd: "zr",
                rn: 9,
                immediate: 6,
                shift: 0,
                setFlags: true,
              });
              emit({ op: "b.cond", condition: "ls", displacement: 8 });
              emit({ op: "brk", immediate: 3 });
              const empty = instructions.length;
              emit({ op: "cbz", width: 64, rt: 9, displacement: 0 });
              emit({
                op: "sub-imm",
                width: 64,
                rd: "zr",
                rn: 9,
                immediate: 4,
                shift: 0,
                setFlags: true,
              });
              const nullValue = instructions.length;
              emit({ op: "b.cond", condition: "eq", displacement: 0 });
              emit({
                op: "sub-imm",
                width: 64,
                rd: "zr",
                rn: 9,
                immediate: 1,
                shift: 0,
                setFlags: true,
              });
              const numeric = instructions.length;
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
              const text = instructions.length;
              emit({ op: "b.cond", condition: "eq", displacement: 0 });
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
              emit({ op: "cset", rd: 9, condition: "eq" });
              const finishRaw = instructions.length;
              emit({ op: "b", displacement: 0 });
              const numberLabel = instructions.length;
              floatLoad(0, op.left, 8);
              floatLoad(1, op.right, 8);
              emit({ op: "fcmp", rn: 0, rm: 1 });
              emit({ op: "cset", rd: 9, condition: "eq" });
              const finishNumber = instructions.length;
              emit({ op: "b", displacement: 0 });
              const textLabel = instructions.length;
              rawLoad(9, value(op.left).offset + 8);
              rawLoad(10, value(op.right).offset + 8);
              callHelper("string-equal");
              const finishText = instructions.length;
              emit({ op: "b", displacement: 0 });
              const trueLabel = instructions.length;
              imm(9, 1);
              const finishTrue = instructions.length;
              emit({ op: "b", displacement: 0 });
              const falseLabel = instructions.length;
              imm(9, 0);
              const done = instructions.length;
              patchInstruction(different, {
                op: "b.cond",
                condition: "ne",
                displacement: (falseLabel - different) * 4,
              });
              patchInstruction(empty, {
                op: "cbz",
                width: 64,
                rt: 9,
                displacement: (trueLabel - empty) * 4,
              });
              patchInstruction(nullValue, {
                op: "b.cond",
                condition: "eq",
                displacement: (trueLabel - nullValue) * 4,
              });
              patchInstruction(numeric, {
                op: "b.cond",
                condition: "eq",
                displacement: (numberLabel - numeric) * 4,
              });
              patchInstruction(text, {
                op: "b.cond",
                condition: "eq",
                displacement: (textLabel - text) * 4,
              });
              for (const at of [
                finishRaw,
                finishNumber,
                finishText,
                finishTrue,
              ]) {
                if (at === undefined) throw "general equality fixup invariant";
                patchInstruction(at, {
                  op: "b",
                  displacement: (done - at) * 4,
                });
              }
              saveRaw(9, op.id);
              break;
            }
            case "error-new": {
              allocate(
                () => {},
                (rd) => imm(rd, 32),
              );
              descriptorPointer(
                typeErrorRecord + (op.error === "RangeError" ? 1 : 0),
              );
              emit({ op: "str", width: 64, rt: 11, rn: 9, offset: 0 });
              emit({ op: "str", width: 64, rt: "zr", rn: 9, offset: 8 });
              rawValue(10, op.message);
              emit({ op: "str", width: 64, rt: 10, rn: 9, offset: 16 });
              emit({ op: "str", width: 64, rt: "zr", rn: 9, offset: 24 });
              saveRaw(9, op.id);
              break;
            }
            case "error-is": {
              rawValue(9, op.value);
              emit({
                op: "sub-imm",
                width: 64,
                rd: "zr",
                rn: 9,
                immediate: 5,
                shift: 0,
                setFlags: true,
              });
              const notObject = instructions.length;
              emit({ op: "b.cond", condition: "ne", displacement: 0 });
              rawLoad(10, value(op.value).offset + 8);
              emit({ op: "ldr", width: 64, rt: 10, rn: 10, offset: 0 });
              descriptorPointer(
                typeErrorRecord + (op.error === "RangeError" ? 1 : 0),
              );
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
              const doneBranch = instructions.length;
              emit({ op: "b", displacement: 0 });
              const no = instructions.length;
              imm(9, 0);
              const done = instructions.length;
              patchInstruction(notObject, {
                op: "b.cond",
                condition: "ne",
                displacement: (no - notObject) * 4,
              });
              patchInstruction(doneBranch, {
                op: "b",
                displacement: (done - doneBranch) * 4,
              });
              saveRaw(9, op.id);
              break;
            }
            case "general-null":
            case "general-none":
              imm(9, op.kind === "general-null" ? 4 : 0);
              saveRaw(9, op.id);
              rawStore("zr", value(op.id).offset + 8);
              break;
            case "general-wrap": {
              const t = value(op.value).type;
              const tag =
                t === "number"
                  ? 1
                  : t === "boolean"
                    ? 2
                    : t === "string"
                      ? 3
                      : 5;
              rawValue(9, op.value);
              rawStore(9, value(op.id).offset + 8);
              imm(9, tag);
              saveRaw(9, op.id);
              break;
            }
            case "general-value": {
              rawValue(9, op.value);
              const tag =
                op.type === "number"
                  ? 1
                  : op.type === "boolean"
                    ? 2
                    : op.type === "string"
                      ? 3
                      : 5;
              emit({
                op: "sub-imm",
                width: 64,
                rd: "zr",
                rn: 9,
                immediate: tag,
                shift: 0,
                setFlags: true,
              });
              emit({ op: "b.cond", condition: "eq", displacement: 8 });
              emit({ op: "brk", immediate: 3 });
              rawLoad(9, value(op.value).offset + 8);
              saveRaw(9, op.id);
              break;
            }
            case "array-subarray": {
              allocate(
                () => {
                  function bound(id: number, offset: number): void {
                    rawValue(9, id);
                    callHelper("to-uint32");
                    emit({ op: "ucvtf-d-w", rd: 0, rn: 9 });
                    floatLoad(1, id);
                    emit({ op: "fcmp", rn: 0, rm: 1 });
                    emit({ op: "b.cond", condition: "eq", displacement: 8 });
                    emit({ op: "brk", immediate: 3 });
                    rawStore(9, offset);
                  }
                  bound(op.begin, allocationOffset + 8);
                  bound(op.length, allocationOffset + 16);
                  rawLoad(10, allocationOffset + 8);
                  emit({
                    op: "add-reg",
                    width: 64,
                    rd: 9,
                    rn: 9,
                    rm: 10,
                    shift: "lsl",
                    amount: 0,
                    setFlags: false,
                  });
                  rawValue(10, op.array);
                  emit({ op: "ldr", width: 32, rt: 10, rn: 10, offset: 16 });
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
                  emit({ op: "b.cond", condition: "ls", displacement: 8 });
                  emit({ op: "brk", immediate: 3 });
                },
                (rd) => imm(rd, 48),
              );
              rawValue(10, op.array);
              rawLoad(11, allocationOffset + 8);
              rawLoad(12, allocationOffset + 16);
              emit({ op: "ldr", width: 64, rt: 13, rn: 10, offset: 0 });
              emit({ op: "str", width: 64, rt: 13, rn: 9, offset: 0 });
              imm(13, 2);
              emit({ op: "str", width: 64, rt: 13, rn: 9, offset: 8 });
              emit({ op: "str", width: 64, rt: 12, rn: 9, offset: 16 });
              emit({ op: "ldr", width: 64, rt: 13, rn: 10, offset: 24 });
              emit({
                op: "add-reg",
                width: 64,
                rd: 13,
                rn: 13,
                rm: 11,
                shift: "lsl",
                amount:
                  value(op.array).type === "Uint8Array"
                    ? 0
                    : value(op.array).type === "Uint16Array"
                      ? 1
                      : value(op.array).type === "Float64Array"
                        ? 3
                        : 2,
                setFlags: false,
              });
              emit({ op: "str", width: 64, rt: 13, rn: 9, offset: 24 });
              emit({ op: "str", width: 64, rt: 10, rn: 9, offset: 32 });
              emit({ op: "str", width: 64, rt: "zr", rn: 9, offset: 40 });
              saveRaw(9, op.id);
              break;
            }
            case "weak-slot-new": {
              allocate(
                () => {},
                (rd) => imm(rd, nativeWeakSlotByteLength),
              );
              // Reload operands after allocation: a slow allocation can move both.
              imm(10, nativeWeakSlotMarker);
              emit({ op: "str", width: 64, rt: 10, rn: 9, offset: 0 });
              rawValue(10, op.ephemeron);
              emit({
                op: "str",
                width: 64,
                rt: 10,
                rn: 9,
                offset: nativeWeakSlotFlagsOffset,
              });
              rawValue(11, op.key);
              emit({
                op: "str",
                width: 64,
                rt: 11,
                rn: 9,
                offset: nativeWeakSlotKeyOffset,
              });
              rawLoad(11, value(op.key).offset + 8);
              emit({
                op: "str",
                width: 64,
                rt: 11,
                rn: 9,
                offset: nativeWeakSlotKeyPayloadOffset,
              });
              emit({
                op: "str",
                width: 64,
                rt: "zr",
                rn: 9,
                offset: nativeWeakSlotValueOffset,
              });
              emit({
                op: "str",
                width: 64,
                rt: "zr",
                rn: 9,
                offset: nativeWeakSlotValuePayloadOffset,
              });
              const weak = instructions.length;
              emit({ op: "cbz", width: 64, rt: 10, displacement: 0 });
              rawValue(11, op.value);
              emit({
                op: "str",
                width: 64,
                rt: 11,
                rn: 9,
                offset: nativeWeakSlotValueOffset,
              });
              rawLoad(11, value(op.value).offset + 8);
              emit({
                op: "str",
                width: 64,
                rt: 11,
                rn: 9,
                offset: nativeWeakSlotValuePayloadOffset,
              });
              patchInstruction(weak, {
                op: "cbz",
                width: 64,
                rt: 10,
                displacement: (instructions.length - weak) * 4,
              });
              rawStore(9, value(op.id).offset + 8);
              imm(9, 5);
              saveRaw(9, op.id);
              break;
            }
            case "weak-slot-key":
            case "weak-slot-value": {
              weakHeader(op.cell);
              const offset =
                op.kind === "weak-slot-key"
                  ? nativeWeakSlotKeyOffset
                  : nativeWeakSlotValueOffset;
              emit({ op: "ldr", width: 64, rt: 9, rn: 10, offset });
              emit({
                op: "ldr",
                width: 64,
                rt: 11,
                rn: 10,
                offset: offset + 8,
              });
              saveRaw(9, op.id);
              rawStore(11, value(op.id).offset + 8);
              break;
            }
            case "weak-slot-set-value":
              weakHeader(op.cell);
              emit({
                op: "ldr",
                width: 64,
                rt: 11,
                rn: 10,
                offset: nativeWeakSlotFlagsOffset,
              });
              emit({ op: "cbnz", width: 64, rt: 11, displacement: 8 });
              emit({ op: "brk", immediate: 3 });
              rawValue(11, op.value);
              emit({
                op: "str",
                width: 64,
                rt: 11,
                rn: 10,
                offset: nativeWeakSlotValueOffset,
              });
              rawLoad(11, value(op.value).offset + 8);
              emit({
                op: "str",
                width: 64,
                rt: 11,
                rn: 10,
                offset: nativeWeakSlotValuePayloadOffset,
              });
              break;
            case "weak-slot-clear":
              weakHeader(op.cell);
              for (
                let offset: number = nativeWeakSlotKeyOffset;
                offset <= nativeWeakSlotValuePayloadOffset;
                offset += 8
              )
                emit({ op: "str", width: 64, rt: "zr", rn: 10, offset });
              break;
            case "reference-vector-new":
              allocateIndexed(op.id, op.length, 3, 6);
              break;
            case "array-new":
              allocateIndexed(
                op.id,
                op.length,
                op.type === "Uint8Array"
                  ? 0
                  : op.type === "Uint16Array"
                    ? 1
                    : op.type === "Float64Array"
                      ? 3
                      : 2,
                op.type === "Uint8Array"
                  ? 2
                  : op.type === "Uint16Array"
                    ? 3
                    : op.type === "Float64Array"
                      ? 5
                      : 4,
              );
              break;
            case "string-literal":
              stringFixups.push({
                offset: instructions.length * 4,
                value: op.value,
              });
              relativePointer(9);
              saveRaw(9, op.id);
              break;
            case "string-length":
              rawValue(9, op.string);
              emit({ op: "ldr", width: 32, rt: 9, rn: 9, offset: 16 });
              emit({ op: "ucvtf-d-w", rd: 0, rn: 9 });
              floatStore(0, op.id);
              break;
            case "string-starts-with":
              rawValue(9, op.string);
              rawValue(10, op.search);
              floatLoad(0, op.position);
              callHelper("string-starts-with");
              saveRaw(9, op.id);
              break;
            case "string-code-unit":
              rawValue(9, op.string);
              floatLoad(0, op.index);
              callHelper("string-code-unit");
              floatStore(0, op.id);
              break;
            case "string-from-code-units": {
              allocate(
                () => {
                  imm(11, op.values.length);
                  prepareStringSize();
                },
                (rd) => rawLoad(rd, allocationOffset),
              );
              saveRaw(9, op.id);
              imm(10, 1);
              emit({ op: "str", width: 64, rt: 10, rn: 9, offset: 0 });
              emit({ op: "str", width: 64, rt: "zr", rn: 9, offset: 8 });
              imm(10, op.values.length);
              emit({ op: "str", width: 64, rt: 10, rn: 9, offset: 16 });
              for (let index = 0; index < op.values.length; index++) {
                const input = op.values[index];
                if (input === undefined) throw "string code unit invariant";
                rawValue(9, input);
                // ToUint16 is ToUint32 modulo 65536; strh stores those low bits.
                callHelper("to-uint32");
                rawValue(10, op.id);
                imm(11, 24 + index * 2);
                emit({
                  op: "add-reg",
                  width: 64,
                  rd: 10,
                  rn: 10,
                  rm: 11,
                  shift: "lsl",
                  amount: 0,
                  setFlags: false,
                });
                emit({ op: "strh", rt: 9, rn: 10, offset: 0 });
              }
              break;
            }
            case "string-slice": {
              allocate(
                () => {
                  rawValue(9, op.string);
                  floatLoad(0, op.begin);
                  floatLoad(1, op.limit);
                  rawLoad(10, value(op.limit).offset + 8);
                  callHelper("string-slice-bounds");
                  rawStore(12, allocationOffset + 8);
                  rawStore(13, allocationOffset + 16);
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
                  prepareStringSize();
                },
                (rd) => rawLoad(rd, allocationOffset),
              );
              rawValue(10, op.string);
              rawLoad(11, allocationOffset + 8);
              rawLoad(12, allocationOffset + 16);
              callHelper("string-slice-copy");
              saveRaw(9, op.id);
              break;
            }
            case "string-concat": {
              allocate(
                () => {
                  rawValue(9, op.left);
                  rawValue(10, op.right);
                  emit({ op: "ldr", width: 32, rt: 11, rn: 9, offset: 16 });
                  emit({ op: "ldr", width: 32, rt: 12, rn: 10, offset: 16 });
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
                  prepareStringSize();
                },
                (rd) => rawLoad(rd, allocationOffset),
              );
              // Inputs may move at the allocation safepoint: reload their rooted slots.
              rawValue(10, op.left);
              rawValue(11, op.right);
              callHelper("string-concat-copy");
              saveRaw(9, op.id);
              break;
            }
            case "string-present":
              rawValue(9, op.value);
              emit({
                op: "sub-imm",
                width: 64,
                rd: "zr",
                rn: 9,
                immediate: 0,
                shift: 0,
                setFlags: true,
              });
              emit({ op: "cset", rd: 9, condition: "ne" });
              saveRaw(9, op.id);
              break;
            case "string-none":
            case "reference-none":
              imm(9, 0);
              saveRaw(9, op.id);
              break;
            case "string-wrap":
            case "string-value":
            case "reference-wrap":
            case "reference-value":
            case "primitive-wrap":
            case "primitive-reference":
              rawValue(9, op.value);
              emit({ op: "cbnz", width: 64, rt: 9, displacement: 8 });
              emit({ op: "brk", immediate: 3 });
              saveRaw(9, op.id);
              break;
            case "closure-environment":
              rawLoad(9, environmentOffset);
              saveRaw(9, op.id);
              break;
            case "function-environment":
              rawValue(9, op.callee);
              guardDescriptor(9, functionRecord);
              emit({
                op: "ldr",
                width: 64,
                rt: 10,
                rn: 9,
                offset: nativeFunctionEnvironmentOffset,
              });
              saveRaw(10, op.id);
              break;
            case "function-new": {
              if (op.environment !== undefined) {
                const record = module.functions[op.target]?.closureEnvironment;
                if (record === undefined) throw "closure environment invariant";
                rawValue(12, op.environment);
                guardDescriptor(12, record);
              }
              allocate(
                () => {},
                (rd) => imm(rd, nativeFunctionByteLength),
              );
              descriptorPointer(functionRecord);
              emit({
                op: "str",
                width: 64,
                rt: 11,
                rn: 9,
                offset: nativeFunctionDescriptorOffset,
              });
              emit({
                op: "str",
                width: 64,
                rt: "zr",
                rn: 9,
                offset: nativeFunctionFlagsOffset,
              });
              functionEntryPointer(10, op.target);
              emit({
                op: "str",
                width: 64,
                rt: 10,
                rn: 9,
                offset: nativeFunctionEntryOffset,
              });
              if (op.environment === undefined)
                emit({
                  op: "str",
                  width: 64,
                  rt: "zr",
                  rn: 9,
                  offset: nativeFunctionEnvironmentOffset,
                });
              else {
                rawValue(10, op.environment);
                emit({
                  op: "str",
                  width: 64,
                  rt: 10,
                  rn: 9,
                  offset: nativeFunctionEnvironmentOffset,
                });
              }
              functionSignaturePointer(10, op.target);
              emit({
                op: "str",
                width: 64,
                rt: 10,
                rn: 9,
                offset: nativeFunctionSignatureOffset,
              });
              emit({
                op: "str",
                width: 64,
                rt: "zr",
                rn: 9,
                offset: nativeFunctionReservedOffset,
              });
              saveRaw(9, op.id);
              break;
            }
            case "record-new": {
              const layout = module.records?.[op.record];
              if (layout === undefined) throw "record constructor invariant";
              allocate(
                () => {},
                (rd) => imm(rd, layout.byteLength),
              );
              descriptorPointer(op.record);
              emit({ op: "str", width: 64, rt: 11, rn: 9, offset: 0 });
              emit({ op: "str", width: 64, rt: "zr", rn: 9, offset: 8 });
              for (let i = 0; i < layout.fields.length; i++) {
                const field = layout.fields[i],
                  arg = op.arguments[i];
                if (field === undefined) throw "record field invariant";
                for (
                  let word = 0;
                  word < scalarByteLength(field.type);
                  word += 8
                ) {
                  if (arg === undefined) imm(10, 0);
                  else rawLoad(10, value(arg).offset + word);
                  const offset = field.offset + word;
                  if (offset <= 32760)
                    emit({ op: "str", width: 64, rt: 10, rn: 9, offset });
                  else {
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
                    emit({ op: "str", width: 64, rt: 10, rn: 12, offset: 0 });
                  }
                }
                const stateOffset = field.stateOffset ?? field.presenceOffset;
                if (stateOffset !== undefined) {
                  const presence = op.presence?.[i];
                  if (presence === undefined)
                    imm(10, arg === undefined ? 0 : 1);
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
              // No safepoint occurs between allocation, initialization and root publication.
              saveRaw(9, op.id);
              break;
            }
            case "constant": {
              const constant = op.value;
              if (typeof constant === "boolean") imm(9, constant ? 1 : 0);
              else {
                const bits = encodeFloat64(constant),
                  lo = bits.lo,
                  hi = bits.hi;
                imm(9, lo);
                emit({
                  op: "movk",
                  width: 64,
                  rd: 9,
                  immediate: hi % 65536,
                  shift: 32,
                });
                emit({
                  op: "movk",
                  width: 64,
                  rd: 9,
                  immediate: Math.floor(hi / 65536),
                  shift: 48,
                });
              }
              saveRaw(9, op.id);
              break;
            }
            case "record-read": {
              const field = module.records?.[op.record]?.fields[op.field];
              if (field === undefined) throw "proven record field invariant";
              rawValue(9, op.object);
              let offset = field.offset;
              const bytes = scalarByteLength(field.type);
              if (offset > 32768 - bytes) {
                imm(12, offset);
                emit({
                  op: "add-reg",
                  width: 64,
                  rd: 9,
                  rn: 9,
                  rm: 12,
                  shift: "lsl",
                  amount: 0,
                  setFlags: false,
                });
                offset = 0;
              }
              for (let word = 0; word < bytes; word += 8) {
                emit({
                  op: "ldr",
                  width: 64,
                  rt: 10,
                  rn: 9,
                  offset: offset + word,
                });
                rawStore(10, value(op.id).offset + word);
              }
              break;
            }
            case "record-has": {
              const field = module.records?.[op.record]?.fields[op.field];
              if (field === undefined) throw "record presence invariant";
              rawValue(9, op.object);
              imm(12, 0);
              const absent = instructions.length;
              emit({ op: "cbz", width: 64, rt: 9, displacement: 0 });
              emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
              descriptorPointer(op.record);
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
              const different = instructions.length;
              emit({ op: "b.cond", condition: "ne", displacement: 0 });
              if (field.presenceOffset === undefined) imm(12, 1);
              else {
                imm(10, field.presenceOffset);
                emit({
                  op: "add-reg",
                  width: 64,
                  rd: 9,
                  rn: 9,
                  rm: 10,
                  shift: "lsl",
                  amount: 0,
                  setFlags: false,
                });
                emit({ op: "ldrb", rt: 12, rn: 9, offset: 0 });
              }
              const done = instructions.length;
              patchInstruction(absent, {
                op: "cbz",
                width: 64,
                rt: 9,
                displacement: (done - absent) * 4,
              });
              patchInstruction(different, {
                op: "b.cond",
                condition: "ne",
                displacement: (done - different) * 4,
              });
              saveRaw(12, op.id);
              break;
            }
            case "boolean-none":
            case "undefined":
              rawStore("zr", value(op.id).offset);
              rawStore("zr", value(op.id).offset + 8);
              break;
            case "boolean-wrap":
            case "optional-wrap":
              rawValue(9, op.value);
              saveRaw(9, op.id);
              imm(10, 1);
              rawStore(10, value(op.id).offset + 8);
              break;
            case "boolean-present":
            case "optional-present":
              rawLoad(9, value(op.value).offset + 8);
              saveRaw(9, op.id);
              break;
            case "boolean-value":
              rawLoad(10, value(op.value).offset + 8);
              emit({ op: "cbnz", width: 64, rt: 10, displacement: 8 });
              emit({ op: "brk", immediate: 3 });
              rawValue(9, op.value);
              saveRaw(9, op.id);
              break;
            case "optional-value":
              rawValue(9, op.value);
              rawLoad(10, value(op.value).offset + 8);
              emit({ op: "cbnz", width: 64, rt: 10, displacement: 12 });
              imm(9, 0);
              emit({
                op: "movk",
                width: 64,
                rd: 9,
                immediate: 0x7ff8,
                shift: 48,
              });
              saveRaw(9, op.id);
              break;
            case "array-buffer":
            case "array-byte-offset": {
              rawValue(10, op.array);
              emit({ op: "ldr", width: 64, rt: 11, rn: 10, offset: 24 });
              // A view has flag 2 and holds its parent at +32.
              emit({ op: "ldr", width: 64, rt: 12, rn: 10, offset: 8 });
              emit({
                op: "sub-imm",
                width: 64,
                rd: "zr",
                rn: 12,
                immediate: 2,
                shift: 0,
                setFlags: true,
              });
              emit({ op: "b.cond", condition: "ne", displacement: 12 });
              emit({ op: "ldr", width: 64, rt: 10, rn: 10, offset: 32 });
              emit({ op: "b", displacement: -16 });
              if (op.kind === "array-buffer") saveRaw(10, op.id);
              else {
                emit({ op: "ldr", width: 64, rt: 12, rn: 10, offset: 24 });
                emit({
                  op: "sub-reg",
                  width: 64,
                  rd: 9,
                  rn: 11,
                  rm: 12,
                  shift: "lsl",
                  amount: 0,
                  setFlags: false,
                });
                emit({ op: "ucvtf-d-w", rd: 0, rn: 9 });
                floatStore(0, op.id);
              }
              break;
            }
            case "host-call": {
              const args = op.arguments;
              function argument(index: number): number {
                const id = args[index];
                if (id === undefined) throw "host argument invariant";
                return id;
              }
              function integer(
                index: number,
                register: number,
                wide: boolean = false,
              ): void {
                floatLoad(0, argument(index));
                if (wide) {
                  emit({ op: "fcvtzs-x-d", rd: register, rn: 0 });
                  emit({ op: "scvtf-d-x", rd: 1, rn: register });
                } else {
                  emit({ op: "fcvtzs-w-d", rd: register, rn: 0 });
                  emit({ op: "scvtf-d-w", rd: 1, rn: register });
                }
                emit({ op: "fcmp", rn: 0, rm: 1 });
                emit({ op: "b.cond", condition: "eq", displacement: 8 });
                emit({ op: "brk", immediate: 3 });
              }
              function bytes(
                index: number,
                register: number,
                path: boolean,
              ): void {
                rawValue(9, argument(index));
                emit({ op: "ldr", width: 32, rt: 10, rn: 9, offset: 16 });
                emit({ op: "ldr", width: 64, rt: register, rn: 9, offset: 24 });
                if (path) {
                  emit({ op: "cbnz", width: 32, rt: 10, displacement: 8 });
                  emit({ op: "brk", immediate: 3 });
                  emit({
                    op: "add-reg",
                    width: 64,
                    rd: 11,
                    rn: register,
                    rm: 10,
                    shift: "lsl",
                    amount: 0,
                    setFlags: false,
                  });
                  emit({
                    op: "sub-imm",
                    width: 64,
                    rd: 11,
                    rn: 11,
                    immediate: 1,
                    shift: 0,
                    setFlags: false,
                  });
                  emit({ op: "ldrb", rt: 11, rn: 11, offset: 0 });
                  emit({ op: "cbz", width: 32, rt: 11, displacement: 8 });
                  emit({ op: "brk", immediate: 3 });
                }
              }
              function foreign(name: string): void {
                imports.push({
                  offset: instructions.length * 4,
                  rd: 16,
                  scratch: 17,
                  target: { kind: "import", name },
                });
                relativePointer(16);
                emit({ op: "ldr", width: 64, rt: 16, rn: 16, offset: 0 });
                emit({ op: "blr", rn: 16 });
              }
              const operation = op.operation;
              if (operation === "cpu-pause") {
                emit({ op: "yield" });
                break;
              }
              const resultId = op.id;
              if (resultId === undefined)
                throw "verified host result invariant";
              if (operation === "executable-call-managed") {
                if (host().executableMemory === undefined)
                  fail("UNSUPPORTED", "target has no executable-memory ABI");
                for (const offset of [0, 8, 16, 24]) {
                  if (offset === undefined) throw "completion offset invariant";
                  rawStore("zr", resultOffset + offset);
                }
                rawLoad(0, contextOffset);
                imm(1, 0);
                imm(2, 0);
                address(3, resultOffset);
                rawValue(4, argument(1));
                integer(0, 16, true);
                emit({ op: "blr", rn: 16 });
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
                // No safepoint may separate the returned payload and tag handoff.
                rawLoad(9, resultOffset + 16);
                rawLoad(10, resultOffset + 24);
                saveRaw(9, resultId);
                rawStore(10, value(resultId).offset + 8);
                break;
              }
              if (
                operation === "executable-call-number" ||
                operation === "executable-call-value"
              ) {
                if (host().executableMemory === undefined)
                  fail("UNSUPPORTED", "target has no executable-memory ABI");
                if (operation === "executable-call-value")
                  address(4, value(argument(1)).offset);
                rawLoad(0, contextOffset);
                imm(1, 0);
                imm(2, 0);
                address(3, resultOffset);
                integer(0, 16, true);
                emit({ op: "blr", rn: 16 });
                emit({
                  op: "sub-imm",
                  width: 32,
                  rd: "zr",
                  rn: 0,
                  immediate: 1,
                  shift: 0,
                  setFlags: true,
                });
                emit({ op: "b.cond", condition: "eq", displacement: 8 });
                emit({ op: "brk", immediate: 3 });
                if (operation === "executable-call-value") {
                  rawLoad(9, resultOffset + 16);
                  rawLoad(10, resultOffset + 24);
                  saveRaw(9, resultId);
                  rawStore(10, value(resultId).offset + 8);
                } else {
                  emit({
                    op: "ldr-d",
                    rt: 0,
                    rn: "sp",
                    offset: resultOffset + 16,
                  });
                  floatStore(0, resultId);
                }
                break;
              }
              if (operation === "executable-write") {
                const executable = host().executableMemory;
                if (executable === undefined)
                  fail("UNSUPPORTED", "target has no executable-memory ABI");
                const failures: {
                  index: number;
                  condition: "hi" | "eq" | "ne";
                }[] = [];
                function reject(condition: "hi" | "eq" | "ne"): void {
                  failures.push({ index: instructions.length, condition });
                  emit({ op: "b.cond", condition, displacement: 0 });
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
                }
                // This leaf cannot allocate or call generated code while writes
                // are enabled. Scratch words live in its reserved result area.
                for (let index = 0; index < 3; index++) {
                  floatLoad(0, argument(index));
                  emit({ op: "fcvtzs-x-d", rd: index, rn: 0 });
                  emit({ op: "scvtf-d-x", rd: 1, rn: index });
                  emit({ op: "fcmp", rn: 0, rm: 1 });
                  reject("ne");
                }
                bytes(3, 3, false);
                imm(9, 0x1fffffffffffff);
                for (const register of [0, 1, 2]) {
                  if (register === undefined)
                    throw "executable argument invariant";
                  compare(register, 9);
                  reject("hi");
                }
                imm(9, 0);
                compare(0, 9);
                reject("eq");
                compare(1, 9);
                reject("eq");
                compare(10, 9);
                reject("eq");
                compare(2, 1);
                reject("hi");
                emit({
                  op: "sub-reg",
                  width: 64,
                  rd: 11,
                  rn: 1,
                  rm: 2,
                  shift: "lsl",
                  amount: 0,
                  setFlags: false,
                });
                compare(10, 11);
                reject("hi");
                emit({
                  op: "add-reg",
                  width: 64,
                  rd: 11,
                  rn: 0,
                  rm: 1,
                  shift: "lsl",
                  amount: 0,
                  setFlags: false,
                });
                imm(9, 0x1fffffffffffff);
                compare(11, 9);
                reject("hi");
                for (const register of [0, 2, 10]) {
                  if (register === undefined)
                    throw "executable alignment invariant";
                  imm(9, 3);
                  emit({
                    op: "and-reg",
                    width: 64,
                    rd: 11,
                    rn: register,
                    rm: 9,
                  });
                  imm(9, 0);
                  compare(11, 9);
                  reject("ne");
                }
                emit({
                  op: "add-reg",
                  width: 64,
                  rd: 0,
                  rn: 0,
                  rm: 2,
                  shift: "lsl",
                  amount: 0,
                  setFlags: false,
                });
                rawStore(0, resultOffset);
                rawStore(3, resultOffset + 8);
                rawStore(10, resultOffset + 16);
                imm(0, 0);
                foreign(executable.writeProtectSymbol);
                rawLoad(0, resultOffset);
                rawLoad(1, resultOffset + 8);
                rawLoad(2, resultOffset + 16);
                foreign(host().symbolPrefix + "memmove");
                rawLoad(0, resultOffset);
                rawLoad(1, resultOffset + 16);
                foreign(executable.instructionCacheSymbol);
                imm(0, 1);
                foreign(executable.writeProtectSymbol);
                emit({ op: "fmov-d-x", rd: 0, rn: "zr" });
                const skip = instructions.length;
                emit({ op: "b", displacement: 0 });
                const invalid = instructions.length;
                imm(9, 1);
                emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
                emit({ op: "fneg", rd: 0, rn: 0 });
                const done = instructions.length;
                for (const failure of failures) {
                  if (failure === undefined) throw "executable guard invariant";
                  patchInstruction(failure.index, {
                    op: "b.cond",
                    condition: failure.condition,
                    displacement: (invalid - failure.index) * 4,
                  });
                }
                patchInstruction(skip, {
                  op: "b",
                  displacement: (done - skip) * 4,
                });
                floatStore(0, resultId);
                break;
              }
              if (operation === "random-word") {
                foreign(host().randomWordSymbol);
                emit({ op: "ucvtf-d-w", rd: 0, rn: 0 });
                floatStore(0, resultId);
                break;
              }
              if (
                operation === "monotonic-time" ||
                operation === "wall-clock-time"
              ) {
                imm(
                  0,
                  operation === "monotonic-time"
                    ? host().monotonicClockId
                    : host().wallClockId,
                );
                foreign(host().clockNanosecondsSymbol);
                emit({ op: "scvtf-d-x", rd: 0, rn: 0 });
                imm(9, 1000000);
                emit({ op: "scvtf-d-x", rd: 1, rn: 9 });
                emit({ op: "fdiv", rd: 0, rn: 0, rm: 1 });
                floatStore(0, resultId);
                break;
              }
              if (operation === "argument-count") {
                rawLoad(9, contextOffset);
                emit({ op: "ldr", width: 32, rt: 9, rn: 9, offset: 40 });
                emit({ op: "scvtf-d-w", rd: 0, rn: 9 });
                floatStore(0, resultId);
                break;
              }
              if (
                operation === "argument-length" ||
                operation === "argument-copy"
              ) {
                integer(0, 9);
                rawLoad(10, contextOffset);
                emit({ op: "ldr", width: 32, rt: 11, rn: 10, offset: 40 });
                emit({
                  op: "sub-reg",
                  width: 32,
                  rd: "zr",
                  rn: 9,
                  rm: 11,
                  shift: "lsl",
                  amount: 0,
                  setFlags: true,
                });
                const invalidIndex = instructions.length;
                emit({ op: "b.cond", condition: "cs", displacement: 0 });
                emit({ op: "ldr", width: 64, rt: 10, rn: 10, offset: 48 });
                emit({
                  op: "add-reg",
                  width: 64,
                  rd: 10,
                  rn: 10,
                  rm: 9,
                  shift: "lsl",
                  amount: 3,
                  setFlags: false,
                });
                emit({ op: "ldr", width: 64, rt: 0, rn: 10, offset: 0 });
                rawStore(0, resultOffset);
                if (operation === "argument-copy") {
                  rawValue(9, argument(1));
                  rawStore(9, resultOffset + 8);
                }
                foreign(host().symbolPrefix + "strlen");
                imm(9, 0xffffffff);
                emit({
                  op: "sub-reg",
                  width: 64,
                  rd: "zr",
                  rn: 0,
                  rm: 9,
                  shift: "lsl",
                  amount: 0,
                  setFlags: true,
                });
                const tooLong = instructions.length;
                emit({ op: "b.cond", condition: "hi", displacement: 0 });
                let shortBuffer = -1;
                if (operation === "argument-copy") {
                  rawLoad(9, resultOffset + 8);
                  emit({ op: "ldr", width: 32, rt: 10, rn: 9, offset: 16 });
                  emit({
                    op: "sub-reg",
                    width: 64,
                    rd: "zr",
                    rn: 0,
                    rm: 10,
                    shift: "lsl",
                    amount: 0,
                    setFlags: true,
                  });
                  shortBuffer = instructions.length;
                  emit({ op: "b.cond", condition: "hi", displacement: 0 });
                  rawStore(0, resultOffset + 16);
                  emit({
                    op: "add-imm",
                    width: 64,
                    rd: 2,
                    rn: 0,
                    immediate: 0,
                    shift: 0,
                    setFlags: false,
                  });
                  rawLoad(1, resultOffset);
                  emit({ op: "ldr", width: 64, rt: 0, rn: 9, offset: 24 });
                  foreign(host().symbolPrefix + "memcpy");
                  rawLoad(0, resultOffset + 16);
                }
                emit({ op: "scvtf-d-x", rd: 0, rn: 0 });
                const skip = instructions.length;
                emit({ op: "b", displacement: 0 });
                const invalid = instructions.length;
                imm(9, 1);
                emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
                emit({ op: "fneg", rd: 0, rn: 0 });
                const done = instructions.length;
                patchInstruction(invalidIndex, {
                  op: "b.cond",
                  condition: "cs",
                  displacement: (invalid - invalidIndex) * 4,
                });
                patchInstruction(tooLong, {
                  op: "b.cond",
                  condition: "hi",
                  displacement: (invalid - tooLong) * 4,
                });
                if (shortBuffer >= 0)
                  patchInstruction(shortBuffer, {
                    op: "b.cond",
                    condition: "hi",
                    displacement: (invalid - shortBuffer) * 4,
                  });
                patchInstruction(skip, {
                  op: "b",
                  displacement: (done - skip) * 4,
                });
                floatStore(0, resultId);
                break;
              }
              if (
                operation === "external-memory-configure" ||
                operation === "external-memory-register"
              ) {
                rawLoad(0, contextOffset);
                const configure = operation === "external-memory-configure";
                if (configure) rawValue(1, argument(0));
                else {
                  floatLoad(0, argument(0));
                  floatLoad(1, argument(1));
                }
                for (const instruction of externalMemoryCapability(configure)) {
                  if (instruction === undefined)
                    throw "external memory instruction invariant";
                  emit(instruction);
                }
                emit({ op: "scvtf-d-x", rd: 0, rn: 0 });
                floatStore(0, resultId);
                break;
              }
              if (
                operation === "allocation-state" ||
                operation === "generational-state"
              ) {
                const generational = operation === "generational-state";
                // State and bitmap are permanent, caller-owned control storage.
                // Context +56 is zero until this checked publication succeeds.
                const failures: {
                  index: number;
                  condition: "cc" | "hi" | "ne";
                }[] = [];
                function requireState(condition: "cc" | "hi" | "ne"): void {
                  failures.push({ index: instructions.length, condition });
                  emit({ op: "b.cond", condition, displacement: 0 });
                }
                function compareState(left: number, right: number): void {
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
                }
                rawValue(10, argument(0));
                rawValue(11, argument(1));
                emit({ op: "ldr", width: 32, rt: 9, rn: 10, offset: 16 });
                imm(12, generational ? 16 : 8);
                compareState(9, 12);
                requireState("cc");
                emit({ op: "ldr", width: 32, rt: 13, rn: 11, offset: 16 });
                emit({ op: "ldr", width: 64, rt: 12, rn: 10, offset: 24 });
                emit({ op: "ldr", width: 64, rt: 14, rn: 11, offset: 24 });
                imm(10, 0);
                emit({ op: "ldr", width: 32, rt: 9, rn: 12, offset: 0 });
                compareState(9, 10);
                requireState("ne");
                if (generational) {
                  emit({ op: "ldr", width: 32, rt: 17, rn: 12, offset: 28 });
                  imm(10, 512);
                  compareState(17, 10);
                  requireState("cc");
                  emit({
                    op: "ubfm",
                    width: 32,
                    rd: 10,
                    rn: 17,
                    immr: 0,
                    imms: 8,
                  });
                  imm(11, 0);
                  compareState(10, 11);
                  requireState("ne");
                  emit({ op: "ldr", width: 32, rt: 9, rn: 12, offset: 8 });
                  compareState(9, 17);
                  requireState("ne");
                  emit({ op: "ldr", width: 32, rt: 9, rn: 12, offset: 12 });
                  compareState(9, 11);
                  requireState("ne");
                } else {
                  emit({ op: "ldr", width: 32, rt: 9, rn: 12, offset: 8 });
                  compareState(9, 10);
                  requireState("ne");
                }
                emit({ op: "ldr", width: 32, rt: 9, rn: 12, offset: 4 });
                imm(10, 16);
                compareState(9, 10);
                requireState("cc");
                imm(10, 0x7ffffff0);
                compareState(9, 10);
                requireState("hi");
                if (generational) {
                  emit({
                    op: "add-reg",
                    width: 64,
                    rd: 10,
                    rn: 9,
                    rm: 17,
                    shift: "lsl",
                    amount: 0,
                    setFlags: false,
                  });
                  imm(11, 0x7ffffff0);
                  compareState(10, 11);
                  requireState("hi");
                }
                emit({
                  op: "ubfm",
                  width: 32,
                  rd: 10,
                  rn: 9,
                  immr: 0,
                  imms: 3,
                });
                imm(11, 0);
                compareState(10, 11);
                requireState("ne");
                emit({
                  op: "add-imm",
                  width: 64,
                  rd: 9,
                  rn: 9,
                  immediate: 511,
                  shift: 0,
                  setFlags: false,
                });
                emit({
                  op: "ubfm",
                  width: 64,
                  rd: 9,
                  rn: 9,
                  immr: 9,
                  imms: 63,
                });
                compareState(13, 9);
                requireState("cc");
                if (generational) {
                  rawValue(15, argument(2));
                  emit({ op: "ldr", width: 32, rt: 13, rn: 15, offset: 16 });
                  emit({ op: "ldr", width: 64, rt: 15, rn: 15, offset: 24 });
                  emit({
                    op: "add-imm",
                    width: 64,
                    rd: 9,
                    rn: 17,
                    immediate: 127,
                    shift: 0,
                    setFlags: false,
                  });
                  emit({
                    op: "ubfm",
                    width: 64,
                    rd: 9,
                    rn: 9,
                    immr: 7,
                    imms: 63,
                  });
                  compareState(13, 9);
                  requireState("cc");
                  rawValue(16, argument(3));
                  emit({ op: "ldr", width: 32, rt: 13, rn: 16, offset: 16 });
                  imm(9, 1);
                  compareState(13, 9);
                  requireState("cc");
                  emit({ op: "ldr", width: 64, rt: 16, rn: 16, offset: 24 });
                  emit({ op: "str", width: 64, rt: 15, rn: 12, offset: 32 });
                  emit({ op: "str", width: 64, rt: 16, rn: 12, offset: 40 });
                  emit({ op: "str", width: 32, rt: "zr", rn: 12, offset: 48 });
                  emit({ op: "str", width: 32, rt: 13, rn: 12, offset: 52 });
                  emit({ op: "str", width: 64, rt: "zr", rn: 12, offset: 56 });
                  emit({ op: "str", width: 32, rt: 9, rn: 12, offset: 24 });
                } else {
                  // A copying-runtime publication cannot accidentally enable barriers.
                  emit({ op: "str", width: 64, rt: "zr", rn: 12, offset: 24 });
                }
                emit({ op: "str", width: 64, rt: 14, rn: 12, offset: 16 });
                rawLoad(10, contextOffset);
                emit({
                  op: "str",
                  width: 64,
                  rt: 12,
                  rn: 10,
                  offset: nativeAllocationStateOffset,
                });
                emit({ op: "fmov-d-x", rd: 0, rn: "zr" });
                const skip = instructions.length;
                emit({ op: "b", displacement: 0 });
                const invalid = instructions.length;
                imm(9, 1);
                emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
                emit({ op: "fneg", rd: 0, rn: 0 });
                const done = instructions.length;
                for (const failure of failures) {
                  if (failure === undefined)
                    throw "allocation state guard invariant";
                  patchInstruction(failure.index, {
                    op: "b.cond",
                    condition: failure.condition,
                    displacement: (invalid - failure.index) * 4,
                  });
                }
                patchInstruction(skip, {
                  op: "b",
                  displacement: (done - skip) * 4,
                });
                floatStore(0, resultId);
                break;
              }
              if (
                operation === "native-function-descriptor" ||
                operation === "native-function-signature" ||
                operation === "native-value-function-descriptor" ||
                operation === "native-value-function-signature"
              ) {
                const callback = op.arguments[0];
                if (callback === undefined)
                  throw "native function reflection argument invariant";
                rawValue(9, callback);
                const general =
                  operation === "native-value-function-descriptor" ||
                  operation === "native-value-function-signature";
                const rejected: number[] = [];
                let nullValue: number | undefined = undefined;
                if (general) {
                  // A general value owns a tag/payload pair. Only tag 5 carries
                  // a managed reference; primitives must never be dereferenced.
                  emit({
                    op: "sub-imm",
                    width: 64,
                    rd: "zr",
                    rn: 9,
                    immediate: 5,
                    shift: 0,
                    setFlags: true,
                  });
                  rejected.push(instructions.length);
                  emit({ op: "b.cond", condition: "ne", displacement: 0 });
                  rawLoad(9, value(callback).offset + 8);
                  nullValue = instructions.length;
                  emit({ op: "cbz", width: 64, rt: 9, displacement: 0 });
                  emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
                  descriptorPointer(functionRecord);
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
                  rejected.push(instructions.length);
                  emit({ op: "b.cond", condition: "ne", displacement: 0 });
                } else guardDescriptor(9, functionRecord);
                emit({
                  op: "ldr",
                  width: 64,
                  rt: 9,
                  rn: 9,
                  offset:
                    operation === "native-function-descriptor" ||
                    operation === "native-value-function-descriptor"
                      ? nativeFunctionDescriptorOffset
                      : nativeFunctionSignatureOffset,
                });
                const zero = instructions.length;
                emit({ op: "cbz", width: 64, rt: 9, displacement: 0 });
                imm(10, Number.MAX_SAFE_INTEGER);
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
                const tooLarge = instructions.length;
                emit({ op: "b.cond", condition: "hi", displacement: 0 });
                emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
                const skip = instructions.length;
                emit({ op: "b", displacement: 0 });
                const invalid = instructions.length;
                imm(9, 1);
                emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
                emit({ op: "fneg", rd: 0, rn: 0 });
                const done = instructions.length;
                for (const at of rejected) {
                  if (at === undefined)
                    throw "function reflection rejection invariant";
                  patchInstruction(at, {
                    op: "b.cond",
                    condition: "ne",
                    displacement: (invalid - at) * 4,
                  });
                }
                if (nullValue !== undefined)
                  patchInstruction(nullValue, {
                    op: "cbz",
                    width: 64,
                    rt: 9,
                    displacement: (invalid - nullValue) * 4,
                  });
                patchInstruction(zero, {
                  op: "cbz",
                  width: 64,
                  rt: 9,
                  displacement: (invalid - zero) * 4,
                });
                patchInstruction(tooLarge, {
                  op: "b.cond",
                  condition: "hi",
                  displacement: (invalid - tooLarge) * 4,
                });
                patchInstruction(skip, {
                  op: "b",
                  displacement: (done - skip) * 4,
                });
                floatStore(0, resultId);
                break;
              }
              if (operation === "context-domain") {
                rawLoad(9, contextOffset);
                emit({
                  op: "ldr",
                  width: 64,
                  rt: 9,
                  rn: 9,
                  offset: nativeContextDomainOffset,
                });
                emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
                floatStore(0, resultId);
                break;
              }
              if (operation === "root-head") {
                rawLoad(9, contextOffset);
                emit({ op: "ldr", width: 64, rt: 9, rn: 9, offset: 0 });
                emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
                floatStore(0, resultId);
                break;
              }
              if (
                operation === "shared-read-unsigned" ||
                operation === "shared-write-unsigned" ||
                operation === "shared-read-word64" ||
                operation === "shared-write-word64" ||
                operation === "shared-compare-exchange-word64" ||
                operation === "shared-compare-exchange-unsigned"
              ) {
                const failures: { index: number; condition: "ne" | "hi" }[] =
                  [];
                const numeric =
                  operation === "shared-compare-exchange-word64"
                    ? 7
                    : operation === "shared-read-word64"
                      ? 4
                      : operation === "shared-read-unsigned"
                        ? 5
                        : 6;
                for (let index = 0; index < numeric; index++) {
                  floatLoad(0, argument(index));
                  emit({ op: "fcvtzs-x-d", rd: index, rn: 0 });
                  emit({ op: "scvtf-d-x", rd: 1, rn: index });
                  emit({ op: "fcmp", rn: 0, rm: 1 });
                  failures.push({
                    index: instructions.length,
                    condition: "ne",
                  });
                  emit({ op: "b.cond", condition: "ne", displacement: 0 });
                  imm(9, Number.MAX_SAFE_INTEGER);
                  emit({
                    op: "sub-reg",
                    width: 64,
                    rd: "zr",
                    rn: index,
                    rm: 9,
                    shift: "lsl",
                    amount: 0,
                    setFlags: true,
                  });
                  failures.push({
                    index: instructions.length,
                    condition: "hi",
                  });
                  emit({ op: "b.cond", condition: "hi", displacement: 0 });
                }
                if (operation === "shared-read-word64")
                  rawValue(4, argument(4));
                else if (operation === "shared-compare-exchange-word64")
                  rawValue(7, argument(7));
                callHelper(operation);
                emit({ op: "scvtf-d-x", rd: 0, rn: 0 });
                const skip = instructions.length;
                emit({ op: "b", displacement: 0 });
                const invalid = instructions.length;
                imm(9, 1);
                emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
                emit({ op: "fneg", rd: 0, rn: 0 });
                const done = instructions.length;
                for (const failure of failures) {
                  if (failure === undefined) throw "shared guard invariant";
                  patchInstruction(failure.index, {
                    op: "b.cond",
                    condition: failure.condition,
                    displacement: (invalid - failure.index) * 4,
                  });
                }
                patchInstruction(skip, {
                  op: "b",
                  displacement: (done - skip) * 4,
                });
                floatStore(0, resultId);
                break;
              }
              if (
                operation === "memory-read-word" ||
                operation === "memory-write-word" ||
                operation === "memory-move"
              ) {
                const failures: {
                  index: number;
                  condition: "eq" | "ne" | "hi" | "cc";
                }[] = [];
                function reject(condition: "eq" | "ne" | "hi" | "cc"): void {
                  failures.push({ index: instructions.length, condition });
                  emit({ op: "b.cond", condition, displacement: 0 });
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
                }
                function maximum(): void {
                  // Number.MAX_SAFE_INTEGER is a contiguous 53-bit mask.
                  emit({ op: "orn-reg", width: 64, rd: 9, rn: "zr", rm: "zr" });
                  emit({
                    op: "ubfm",
                    width: 64,
                    rd: 9,
                    rn: 9,
                    immr: 0,
                    imms: 52,
                  });
                }
                const arity =
                  operation === "memory-move"
                    ? 5
                    : operation === "memory-write-word"
                      ? 4
                      : 3;
                for (let index = 0; index < arity; index++) {
                  const fact = valueIds.intern(argument(index));
                  if (wordKinds[fact] === 3) {
                    imm(index, wordConstants[fact] ?? 0);
                    continue;
                  }
                  floatLoad(0, argument(index));
                  emit({ op: "fcvtzs-x-d", rd: index, rn: 0 });
                  emit({ op: "scvtf-d-x", rd: 1, rn: index });
                  emit({ op: "fcmp", rn: 0, rm: 1 });
                  reject("ne");
                  maximum();
                  compare(index, 9);
                  reject("hi");
                }
                imm(9, 0);
                compare(0, 9);
                reject("eq");
                if (operation === "memory-move") {
                  callHelper("memory-move");
                } else {
                  // Exact constant bounds are checked by the compiler. Dynamic
                  // windows retain the same runtime range and alignment checks.
                  const lengthFact = valueIds.intern(argument(1)),
                    offsetFact = valueIds.intern(argument(2)),
                    length = wordConstants[lengthFact] ?? 0,
                    offset = wordConstants[offsetFact] ?? 0,
                    fixedBounds =
                      wordKinds[lengthFact] === 3 &&
                      wordKinds[offsetFact] === 3 &&
                      length >= 8 &&
                      offset <= length - 8;
                  if (!fixedBounds) {
                    // An eight-byte access must fit the caller-authorized window.
                    imm(9, 8);
                    compare(1, 9);
                    reject("cc");
                    emit({
                      op: "sub-imm",
                      width: 64,
                      rd: 10,
                      rn: 1,
                      immediate: 8,
                      shift: 0,
                      setFlags: false,
                    });
                    compare(2, 10);
                    reject("hi");
                  }
                  emit({
                    op: "add-reg",
                    width: 64,
                    rd: 10,
                    rn: 0,
                    rm: 2,
                    shift: "lsl",
                    amount: 0,
                    setFlags: false,
                  });
                  maximum();
                  emit({
                    op: "sub-imm",
                    width: 64,
                    rd: 9,
                    rn: 9,
                    immediate: 7,
                    shift: 0,
                    setFlags: false,
                  });
                  compare(10, 9);
                  reject("hi");
                  imm(9, 7);
                  emit({ op: "and-reg", width: 64, rd: 11, rn: 10, rm: 9 });
                  imm(9, 0);
                  compare(11, 9);
                  reject("ne");
                  if (operation === "memory-read-word") {
                    emit({ op: "ldr", width: 64, rt: 0, rn: 10, offset: 0 });
                    maximum();
                    compare(0, 9);
                    reject("hi");
                  } else {
                    emit({ op: "str", width: 64, rt: 3, rn: 10, offset: 0 });
                    imm(0, 0);
                  }
                }
                emit({ op: "scvtf-d-x", rd: 0, rn: 0 });
                const skip = instructions.length;
                emit({ op: "b", displacement: 0 });
                const invalid = instructions.length;
                imm(9, 1);
                emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
                emit({ op: "fneg", rd: 0, rn: 0 });
                const done = instructions.length;
                for (const failure of failures) {
                  if (failure === undefined) throw "memory guard invariant";
                  const index = failure.index;
                  patchInstruction(index, {
                    op: "b.cond",
                    condition: failure.condition,
                    displacement: (invalid - index) * 4,
                  });
                }
                patchInstruction(skip, {
                  op: "b",
                  displacement: (done - skip) * 4,
                });
                floatStore(0, resultId);
                break;
              }
              let symbol = "";
              if (
                operation === "memory-map" ||
                operation === "executable-map"
              ) {
                const executable = host().executableMemory;
                if (operation === "executable-map" && executable === undefined)
                  fail("UNSUPPORTED", "target has no executable-memory ABI");
                integer(0, 1, true);
                imm(0, 0);
                imm(2, operation === "executable-map" ? 7 : 3);
                imm(
                  3,
                  operation === "executable-map" && executable !== undefined
                    ? executable.mappingFlags
                    : host().anonymousPrivateFlags,
                );
                imm(4, 0xffffffff);
                imm(5, 0);
                symbol = "mmap";
              } else if (operation === "memory-unmap") {
                integer(0, 0, true);
                integer(1, 1, true);
                symbol = "munmap";
              } else if (
                operation === "open-read" ||
                operation === "open-exclusive"
              ) {
                bytes(0, 0, true);
                imm(
                  1,
                  operation === "open-read"
                    ? host().readFlags
                    : host().exclusiveFlags,
                );
                if (operation === "open-exclusive") {
                  integer(1, host().creationModeOnStack ? 9 : 2);
                  if (host().creationModeOnStack) rawStore(9, 0);
                }
                symbol = "open";
              } else if (
                operation === "read" ||
                operation === "write" ||
                operation === "read-link"
              ) {
                if (operation === "read-link") bytes(0, 0, true);
                else integer(0, 0);
                bytes(1, 1, false);
                emit({
                  op: "add-reg",
                  width: 64,
                  rd: 2,
                  rn: "zr",
                  rm: 10,
                  shift: "lsl",
                  amount: 0,
                  setFlags: false,
                });
                symbol =
                  operation === "read-link"
                    ? "readlink"
                    : operation === "read"
                      ? "read"
                      : "write";
              } else if (operation === "close") {
                integer(0, 0);
                symbol = "close";
              } else if (operation === "chmod") {
                integer(0, 0);
                integer(1, 1);
                symbol = "fchmod";
              } else if (operation === "rename") {
                bytes(0, 0, true);
                bytes(1, 1, true);
                symbol = "rename";
              } else if (operation === "unlink") {
                bytes(0, 0, true);
                symbol = "unlink";
              } else throw "verified host operation invariant";
              foreign(host().symbolPrefix + symbol);
              const wide =
                operation === "read" ||
                operation === "write" ||
                operation === "read-link" ||
                operation === "memory-map" ||
                operation === "executable-map";
              emit({
                op: "sub-imm",
                width: wide ? 64 : 32,
                rd: "zr",
                rn: 0,
                immediate: 0,
                shift: 0,
                setFlags: true,
              });
              const success = instructions.length;
              emit({ op: "b.cond", condition: "ge", displacement: 0 });
              foreign(host().errnoSymbol);
              emit({ op: "ldr", width: 32, rt: 9, rn: 0, offset: 0 });
              emit({ op: "scvtf-d-w", rd: 0, rn: 9 });
              emit({ op: "fneg", rd: 0, rn: 0 });
              const finish = instructions.length;
              emit({ op: "b", displacement: 0 });
              const good = instructions.length;
              if (wide) emit({ op: "scvtf-d-x", rd: 0, rn: 0 });
              else emit({ op: "scvtf-d-w", rd: 0, rn: 0 });
              const done = instructions.length;
              patchInstruction(success, {
                op: "b.cond",
                condition: "ge",
                displacement: (good - success) * 4,
              });
              patchInstruction(finish, {
                op: "b",
                displacement: (done - finish) * 4,
              });
              floatStore(0, resultId);
              break;
            }
            case "array-byte-length": {
              rawValue(10, op.array);
              emit({ op: "ldr", width: 32, rt: 9, rn: 10, offset: 16 });
              const shift =
                value(op.array).type === "Uint8Array"
                  ? 0
                  : value(op.array).type === "Uint16Array"
                    ? 1
                    : value(op.array).type === "Float64Array"
                      ? 3
                      : 2;
              if (shift !== 0)
                emit({
                  op: "add-reg",
                  width: 64,
                  rd: 9,
                  rn: "zr",
                  rm: 9,
                  shift: "lsl",
                  amount: shift,
                  setFlags: false,
                });
              emit({ op: "ucvtf-d-w", rd: 0, rn: 9 });
              floatStore(0, op.id);
              break;
            }
            case "array-length":
              rawValue(10, op.array);
              emit({ op: "ldr", width: 32, rt: 9, rn: 10, offset: 16 });
              emit({ op: "ucvtf-d-w", rd: 0, rn: 9 });
              floatStore(0, op.id);
              break;
            case "array-valid":
              arrayIndex(op.array, op.index);
              saveRaw(13, op.id);
              break;
            case "reference-vector-is":
              rawValue(10, op.vector);
              imm(9, 0);
              emit({ op: "cbz", width: 64, rt: 10, displacement: 16 });
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
              emit({ op: "cset", rd: 9, condition: "eq" });
              saveRaw(9, op.id);
              break;
            case "reference-vector-length":
              vectorHeader(op.vector);
              emit({ op: "ldr", width: 32, rt: 9, rn: 10, offset: 16 });
              emit({ op: "ucvtf-d-w", rd: 0, rn: 9 });
              floatStore(0, op.id);
              break;
            case "reference-vector-read":
              vectorHeader(op.vector);
              arrayIndex(op.vector, op.index, true);
              imm(11, 0);
              emit({ op: "cbz", width: 32, rt: 13, displacement: 12 });
              emit({
                op: "add-reg",
                width: 64,
                rd: 10,
                rn: 10,
                rm: 9,
                shift: "lsl",
                amount: 3,
                setFlags: false,
              });
              emit({ op: "ldr", width: 64, rt: 11, rn: 10, offset: 0 });
              saveRaw(11, op.id);
              break;
            case "reference-vector-write":
              vectorHeader(op.vector);
              arrayIndex(op.vector, op.index, true);
              emit({ op: "cbnz", width: 32, rt: 13, displacement: 8 });
              emit({ op: "brk", immediate: 3 });
              emit({
                op: "add-reg",
                width: 64,
                rd: 10,
                rn: 10,
                rm: 9,
                shift: "lsl",
                amount: 3,
                setFlags: false,
              });
              rawValue(11, op.value);
              emit({ op: "str", width: 64, rt: 11, rn: 10, offset: 0 });
              if (generationalBarriers) {
                rawValue(9, op.vector);
                rawLoad(10, contextOffset);
                callHelper("remember-object");
              }
              break;
            case "array-read":
              arrayIndex(op.array, op.index);
              imm(11, 0);
              emit({ op: "cbz", width: 32, rt: 13, displacement: 12 });
              emit({
                op: "add-reg",
                width: 64,
                rd: 10,
                rn: 10,
                rm: 9,
                shift: "lsl",
                amount:
                  value(op.array).type === "Uint8Array"
                    ? 0
                    : value(op.array).type === "Uint16Array"
                      ? 1
                      : value(op.array).type === "Float64Array"
                        ? 3
                        : 2,
                setFlags: false,
              });
              emit(
                value(op.array).type === "Uint8Array"
                  ? { op: "ldrb", rt: 11, rn: 10, offset: 0 }
                  : value(op.array).type === "Uint16Array"
                    ? { op: "ldrh", rt: 11, rn: 10, offset: 0 }
                    : {
                        op: "ldr",
                        width:
                          value(op.array).type === "Float64Array" ? 64 : 32,
                        rt: 11,
                        rn: 10,
                        offset: 0,
                      },
              );
              emit(
                value(op.array).type === "Float64Array"
                  ? { op: "fmov-d-x", rd: 0, rn: 11 }
                  : { op: "ucvtf-d-w", rd: 0, rn: 11 },
              );
              floatStore(0, op.id);
              rawStore(13, value(op.id).offset + 8);
              break;
            case "array-copy": {
              rawValue(0, op.array);
              rawValue(1, op.source);
              floatLoad(0, op.offset);
              const type = value(op.array).type;
              imm(
                5,
                type === "Uint8Array"
                  ? 0
                  : type === "Uint16Array"
                    ? 1
                    : type === "Uint32Array"
                      ? 2
                      : 3,
              );
              callHelper("array-copy");
              saveRaw(0, op.id);
              break;
            }
            case "array-write":
              if (value(op.array).type === "Float64Array")
                rawValue(9, op.value);
              else wordValue(op.value);
              rawStore(9, resultOffset + 24);
              arrayIndex(op.array, op.index);
              emit({ op: "cbz", width: 32, rt: 13, displacement: 16 });
              rawLoad(11, resultOffset + 24);
              emit({
                op: "add-reg",
                width: 64,
                rd: 10,
                rn: 10,
                rm: 9,
                shift: "lsl",
                amount:
                  value(op.array).type === "Uint8Array"
                    ? 0
                    : value(op.array).type === "Uint16Array"
                      ? 1
                      : value(op.array).type === "Float64Array"
                        ? 3
                        : 2,
                setFlags: false,
              });
              emit(
                value(op.array).type === "Uint8Array"
                  ? { op: "strb", rt: 11, rn: 10, offset: 0 }
                  : value(op.array).type === "Uint16Array"
                    ? { op: "strh", rt: 11, rn: 10, offset: 0 }
                    : {
                        op: "str",
                        width:
                          value(op.array).type === "Float64Array" ? 64 : 32,
                        rt: 11,
                        rn: 10,
                        offset: 0,
                      },
              );
              break;
            case "load":
              copyRawWord(slotOffset(op.slot), value(op.id).offset);
              if (
                value(op.id).type === "general" ||
                value(op.id).type === "optional-number" ||
                value(op.id).type === "optional-boolean"
              ) {
                copyRawWord(slotOffset(op.slot) + 8, value(op.id).offset + 8);
              }
              break;
            case "store":
              copyRawWord(value(op.value).offset, slotOffset(op.slot));
              if (
                value(op.value).type === "general" ||
                value(op.value).type === "optional-number" ||
                value(op.value).type === "optional-boolean"
              ) {
                copyRawWord(
                  value(op.value).offset + 8,
                  slotOffset(op.slot) + 8,
                );
              }
              break;
            case "unary": {
              if (
                op.operator === "ceil" ||
                op.operator === "trunc" ||
                op.operator === "sqrt"
              ) {
                floatLoad(0, op.operand);
                emit(
                  op.operator === "sqrt"
                    ? { op: "fsqrt", rd: 0, rn: 0 }
                    : op.operator === "ceil"
                      ? { op: "frintp", rd: 0, rn: 0 }
                      : { op: "frintz", rd: 0, rn: 0 },
                );
                floatStore(0, op.id);
              } else if (op.operator === "is-integer") {
                const operandKind = wordKinds[valueIds.intern(op.operand)] ?? 0;
                if (
                  value(op.operand).type === "number" &&
                  (operandKind === 2 || operandKind === 3 || operandKind === 6)
                )
                  imm(9, 1);
                else if (
                  value(op.operand).type === "optional-number" &&
                  operandKind === 4
                )
                  rawLoad(9, value(op.operand).offset + 8);
                else if (
                  value(op.operand).type === "number" &&
                  (operandKind === 5 || operandKind === 7)
                ) {
                  // Every non-NaN possibility is a bounded integer. Missing
                  // optional values unwrap to NaN, so retain that distinction.
                  floatLoad(0, op.operand);
                  emit({ op: "fcmp", rn: 0, rm: 0 });
                  emit({ op: "cset", rd: 9, condition: "eq" });
                } else if (
                  value(op.operand).type !== "number" &&
                  value(op.operand).type !== "optional-number"
                )
                  imm(9, 0);
                else {
                  floatLoad(0, op.operand);
                  emit({ op: "frintz", rd: 1, rn: 0 });
                  emit({ op: "fcmp", rn: 0, rm: 1 });
                  emit({ op: "cset", rd: 10, condition: "eq" });
                  rawValue(9, op.operand);
                  emit({
                    op: "ubfm",
                    width: 64,
                    rd: 9,
                    rn: 9,
                    immr: 52,
                    imms: 62,
                  });
                  emit({
                    op: "sub-imm",
                    width: 64,
                    rd: "zr",
                    rn: 9,
                    immediate: 2047,
                    shift: 0,
                    setFlags: true,
                  });
                  emit({ op: "cset", rd: 9, condition: "ne" });
                  emit({ op: "and-reg", width: 32, rd: 9, rn: 9, rm: 10 });
                  if (value(op.operand).type === "optional-number") {
                    rawLoad(10, value(op.operand).offset + 8);
                    emit({ op: "and-reg", width: 32, rd: 9, rn: 9, rm: 10 });
                  }
                }
                saveRaw(9, op.id);
              } else if (op.operator === "boolean-number") {
                rawValue(9, op.operand);
                emit({ op: "ucvtf-d-w", rd: 0, rn: 9 });
                floatStore(0, op.id);
              } else if (op.operator === "+") {
                rawValue(9, op.operand);
                saveRaw(9, op.id);
              } else if (op.operator === "-") {
                floatLoad(0, op.operand);
                emit({ op: "fneg", rd: 0, rn: 0 });
                floatStore(0, op.id);
              } else if (op.operator === "~") {
                wordValue(op.operand);
                emit({ op: "orn-reg", width: 32, rd: 9, rn: "zr", rm: 9 });
                if (storedAsWord(op.id)) saveRaw(9, op.id);
                else {
                  emit({ op: "scvtf-d-w", rd: 0, rn: 9 });
                  floatStore(0, op.id);
                }
              } else if (op.operator === "!" || op.operator === "truthy") {
                truth(op.operand, op.operator === "!");
                saveRaw(9, op.id);
              } else
                fail(
                  "UNSUPPORTED",
                  "native unary operator not implemented: " + op.operator,
                );
              break;
            }
            case "binary": {
              if (
                value(op.left).type === "string" ||
                value(op.left).type === "optional-string"
              ) {
                rawValue(9, op.left);
                rawValue(10, op.right);
                if (value(op.left).type === "optional-string") {
                  // Both present: compare content. Either absent: compare the zero sentinels.
                  const absentLeft = instructions.length;
                  emit({ op: "cbz", width: 64, rt: 9, displacement: 0 });
                  const absentRight = instructions.length;
                  emit({ op: "cbz", width: 64, rt: 10, displacement: 0 });
                  callHelper("string-equal");
                  emit({ op: "b", displacement: 12 });
                  patchInstruction(absentLeft, {
                    op: "cbz",
                    width: 64,
                    rt: 9,
                    displacement: (instructions.length - absentLeft) * 4,
                  });
                  patchInstruction(absentRight, {
                    op: "cbz",
                    width: 64,
                    rt: 10,
                    displacement: (instructions.length - absentRight) * 4,
                  });
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
                } else callHelper("string-equal");
                if (op.operator === "!==" || op.operator === "!=") {
                  imm(10, 1);
                  emit({ op: "eor-reg", width: 32, rd: 9, rn: 9, rm: 10 });
                }
                saveRaw(9, op.id);
                break;
              }
              if (["+", "-", "*", "/"].includes(op.operator)) {
                const left = floatOperand(op.left, 0),
                  right = floatOperand(op.right, 1);
                emit(
                  op.operator === "+"
                    ? { op: "fadd", rd: 0, rn: left, rm: right }
                    : op.operator === "-"
                      ? { op: "fsub", rd: 0, rn: left, rm: right }
                      : op.operator === "*"
                        ? { op: "fmul", rd: 0, rn: left, rm: right }
                        : { op: "fdiv", rd: 0, rn: left, rm: right },
                );
                floatStore(0, op.id);
              } else if (op.operator === "%") {
                floatLoad(0, op.left);
                floatLoad(1, op.right);
                callHelper("remainder");
                floatStore(0, op.id);
              } else if (
                ["&", "|", "^", "<<", ">>", ">>>"].includes(op.operator)
              ) {
                wordValue(op.left);
                emit({ op: "orr-reg", width: 32, rd: 13, rn: "zr", rm: 9 });
                wordValue(op.right);
                emit(
                  op.operator === "&"
                    ? { op: "and-reg", width: 32, rd: 9, rn: 13, rm: 9 }
                    : op.operator === "|"
                      ? { op: "orr-reg", width: 32, rd: 9, rn: 13, rm: 9 }
                      : op.operator === "^"
                        ? { op: "eor-reg", width: 32, rd: 9, rn: 13, rm: 9 }
                        : op.operator === "<<"
                          ? { op: "lslv", width: 32, rd: 9, rn: 13, rm: 9 }
                          : op.operator === ">>"
                            ? { op: "asrv", width: 32, rd: 9, rn: 13, rm: 9 }
                            : { op: "lsrv", width: 32, rd: 9, rn: 13, rm: 9 },
                );
                if (storedAsWord(op.id)) saveRaw(9, op.id);
                else {
                  emit(
                    op.operator === ">>>"
                      ? { op: "ucvtf-d-w", rd: 0, rn: 9 }
                      : { op: "scvtf-d-w", rd: 0, rn: 9 },
                  );
                  floatStore(0, op.id);
                }
              } else if (
                ["===", "!==", "==", "!=", "<", ">", "<=", ">="].includes(
                  op.operator,
                )
              ) {
                if (
                  value(op.left).type === "optional-number" ||
                  value(op.left).type === "optional-boolean"
                ) {
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
                  if (value(op.left).type === "optional-boolean") {
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
                  } else {
                    floatLoad(0, op.left);
                    floatLoad(1, op.right);
                    emit({ op: "fcmp", rn: 0, rm: 1 });
                  }
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
                if (value(op.left).type === "number") {
                  const left = floatOperand(op.left, 0),
                    right = floatOperand(op.right, 1);
                  emit({ op: "fcmp", rn: left, rm: right });
                } else {
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
                }
                const condition: Condition =
                  op.operator === "===" || op.operator === "=="
                    ? "eq"
                    : op.operator === "!==" || op.operator === "!="
                      ? "ne"
                      : op.operator === "<"
                        ? "mi"
                        : op.operator === "<="
                          ? "ls"
                          : op.operator === ">"
                            ? "gt"
                            : "ge";
                emit({ op: "cset", rd: 9, condition });
                saveRaw(9, op.id);
              } else
                fail(
                  "UNSUPPORTED",
                  "native binary operator not implemented: " + op.operator,
                );
              break;
            }
            case "call-indirect":
            case "call": {
              const target = signatures[op.target];
              if (target === undefined) throw "call signature invariant";
              const importedEntry = entryImports.get(op.target);
              for (let i = 0; i < op.arguments.length; i++) {
                const arg = op.arguments[i],
                  location = target.parameters[i];
                if (arg === undefined || location === undefined)
                  throw "call argument invariant";
                if (
                  value(arg).type === "general" ||
                  value(arg).type === "optional-number" ||
                  value(arg).type === "optional-boolean"
                ) {
                  if (location.kind === "integer")
                    address(location.index, value(arg).offset);
                  else {
                    address(9, value(arg).offset);
                    rawStore(9, location.index);
                  }
                } else if (location.kind === "float")
                  floatLoad(location.index, arg);
                else if (location.kind === "integer")
                  rawValue(location.index, arg);
                else {
                  rawValue(9, arg);
                  rawStore(9, location.index);
                }
              }
              // Verified direct callees overwrite every consumed completion field.
              // The result buffer is not a GC root; no safepoint separates return
              // from payload consumption. Opaque calls retain initialization.
              if (op.kind === "call-indirect" || importedEntry !== undefined)
                for (let offset = 0; offset < 32; offset += 8)
                  rawStore("zr", resultOffset + offset);
              rawLoad(0, contextOffset);
              if (op.kind === "call" && op.environment === "inherit")
                rawLoad(1, environmentOffset);
              else imm(1, 0);
              if (op.receiver === undefined) imm(2, 0);
              else address(2, value(op.receiver).offset);
              address(3, resultOffset);
              if (op.kind === "call-indirect") {
                rawValue(12, op.callee);
                guardDescriptor(12, functionRecord);
                emit({
                  op: "ldr",
                  width: 64,
                  rt: 10,
                  rn: 12,
                  offset: nativeFunctionSignatureOffset,
                });
                functionSignaturePointer(11, op.target);
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
                emit({ op: "b.cond", condition: "eq", displacement: 8 });
                emit({ op: "brk", immediate: 3 });
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
                emit({ op: "blr", rn: 16 });
              } else if (importedEntry !== undefined) {
                managedPointer(16, importedEntry);
                emit({ op: "blr", rn: 16 });
              } else branch({ op: "bl" }, op.target, undefined);
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
                  op.kind === "call" &&
                  importedEntry === undefined &&
                  directReturns !== undefined &&
                  directReturns[op.target] === 1;
                if (registerResult) saveRaw(1, resultId);
                else {
                  rawLoad(9, resultOffset + 16);
                  saveRaw(9, resultId);
                }
                if (
                  value(resultId).type === "general" ||
                  value(resultId).type === "optional-number" ||
                  value(resultId).type === "optional-boolean"
                ) {
                  if (registerResult) rawStore(2, value(resultId).offset + 8);
                  else {
                    rawLoad(10, resultOffset + 24);
                    rawStore(10, value(resultId).offset + 8);
                  }
                }
              }
              break;
            }
          }
        }
        const t = b.terminator;
        span = { start: t.start, end: t.end };
        if (t.kind === "trap") emit({ op: "brk", immediate: 0 });
        else if (t.kind === "throw") {
          rawValue(9, t.value);
          rawStore(9, resultOffset + 16);
          rawLoad(9, value(t.value).offset + 8);
          rawStore(9, resultOffset + 24);
          imm(0, 2);
          exceptionalBranch({ op: "b" });
        } else if (t.kind === "throw-literal") {
          stringFixups.push({
            offset: instructions.length * 4,
            value: t.value,
          });
          relativePointer(9);
          rawStore(9, resultOffset + 24);
          imm(9, 3);
          rawStore(9, resultOffset + 16);
          imm(0, 2);
          exceptionalBranch({ op: "b" });
        } else if (t.kind === "jump") {
          if (t.target !== nextBlock) branch({ op: "b" }, fn.id, t.target);
        } else if (t.kind === "branch") {
          rawValue(9, t.condition);
          if (t.consequent === nextBlock)
            branch({ op: "cbz", width: 64, rt: 9 }, fn.id, t.alternate);
          else {
            branch({ op: "cbnz", width: 64, rt: 9 }, fn.id, t.consequent);
            if (t.alternate !== nextBlock)
              branch({ op: "b" }, fn.id, t.alternate);
          }
        } else if (t.kind === "record") {
          const layout = module.records?.[t.record],
            field = layout?.fields[t.field];
          if (field === undefined) throw "verified record invariant";
          rawValue(9, t.object);
          if (recordGuards === undefined || recordGuards[b.id] !== 1)
            guardDescriptor(
              9,
              t.record,
              t.alternate,
              flowGuards !== undefined && ((flowGuards[b.id] ?? 0) & 1) !== 0,
              nonNullValues[valueIds.intern(t.object)] === 1 ||
                (flowGuards !== undefined &&
                  ((flowGuards[b.id] ?? 0) & 2) !== 0),
            );
          let offset = field.offset;
          const byteLength = scalarByteLength(field.type);
          if (offset > 32768 - byteLength) {
            imm(12, offset);
            emit({
              op: "add-reg",
              width: 64,
              rd: 9,
              rn: 9,
              rm: 12,
              shift: "lsl",
              amount: 0,
              setFlags: false,
            });
            offset = 0;
          }
          for (let word = 0; word < byteLength; word += 8) {
            if (t.operation === "read") {
              emit({
                op: "ldr",
                width: 64,
                rt: 10,
                rn: 9,
                offset: offset + word,
              });
              rawStore(10, slotOffset(t.slot) + word);
            } else {
              rawLoad(10, slotOffset(t.slot) + word);
              emit({
                op: "str",
                width: 64,
                rt: 10,
                rn: 9,
                offset: offset + word,
              });
            }
          }
          const presenceOffset = field.presenceOffset;
          if (t.operation === "write" && presenceOffset !== undefined) {
            rawValue(9, t.object);
            imm(10, 1);
            imm(12, presenceOffset);
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
          if (
            generationalBarriers &&
            t.operation === "write" &&
            (managed(field.type) || field.type === "general")
          ) {
            rawValue(9, t.object);
            rawLoad(10, contextOffset);
            callHelper("remember-object");
          }
          branch({ op: "b" }, fn.id, t.consequent);
        } else if (t.kind === "cell" || t.kind === "record-cell") {
          let access: CellAccess;
          if (t.kind === "record-cell") {
            const field = module.records?.[t.record]?.fields[t.field];
            if (field === undefined) throw "managed cell invariant";
            const stateOffset = field.stateOffset;
            if (stateOffset === undefined) throw "managed cell invariant";
            rawValue(9, t.object);
            if (recordGuards === undefined || recordGuards[b.id] !== 1)
              guardDescriptor(
                9,
                t.record,
                t.alternate,
                flowGuards !== undefined && ((flowGuards[b.id] ?? 0) & 1) !== 0,
                nonNullValues[valueIds.intern(t.object)] === 1 ||
                  (flowGuards !== undefined &&
                    ((flowGuards[b.id] ?? 0) & 2) !== 0),
              );
            access = {
              operation: t.operation,
              stateOffset,
              valueOffset: field.offset,
              byteLength: scalarByteLength(field.type),
              mutable: field.mutable,
            };
          } else {
            const cell = fn.environment?.cells[t.cell];
            if (cell === undefined) throw "verified cell invariant";
            access = {
              operation: t.operation,
              stateOffset: cell.stateOffset,
              valueOffset: cell.valueOffset,
              byteLength: scalarByteLength(cell.type),
              mutable: cell.mutable,
            };
          }
          if (canInlineCellRead(fn, t)) {
            // A cell read has only a success/failure edge. Inline the exact state
            // test, preserving invalid/uninitialized failure without touching the
            // transfer slot. No allocation or safepoint occurs during the copy.
            if (t.kind === "record-cell") rawValue(9, t.object);
            else rawLoad(9, environmentOffset);
            emit({ op: "ldrb", rt: 10, rn: 9, offset: access.stateOffset });
            emit({
              op: "sub-imm",
              width: 32,
              rd: "zr",
              rn: 10,
              immediate: 1,
              shift: 0,
              setFlags: true,
            });
            branch({ op: "b.cond", condition: "ne" }, fn.id, t.alternate);
            for (let offset = 0; offset < access.byteLength; offset += 8) {
              emit({
                op: "ldr",
                width: 64,
                rt: 10,
                rn: 9,
                offset: access.valueOffset + offset,
              });
              rawStore(10, slotOffset(t.slot) + offset);
            }
            branch({ op: "b" }, fn.id, t.consequent);
          } else {
            const key =
              access.operation +
              ":" +
              access.stateOffset +
              ":" +
              access.valueOffset +
              ":" +
              access.byteLength +
              ":" +
              access.mutable;
            cellRequests.set(key, access);
            if (t.kind === "record-cell") rawValue(0, t.object);
            else rawLoad(0, environmentOffset);
            address(1, slotOffset(t.slot));
            cellFixups.push({ offset: instructions.length * 4, key });
            callRelative();
            if (
              generationalBarriers &&
              t.kind === "record-cell" &&
              t.operation !== "read"
            ) {
              const field = module.records?.[t.record]?.fields[t.field];
              if (field === undefined) throw "barrier cell invariant";
              if (managed(field.type) || field.type === "general") {
                rawValue(9, t.object);
                rawLoad(10, contextOffset);
                // The barrier preserves the cell helper's w0 completion status.
                callHelper("remember-object");
              }
            }
            branch({ op: "cbz", width: 32, rt: 0 }, fn.id, t.consequent);
            branch({ op: "b" }, fn.id, t.alternate);
          }
        } else {
          if (directReturns !== undefined && directReturns[fn.id] === 1) {
            const returned = t.value;
            if (returned !== undefined) {
              rawValue(1, returned);
              if (scalarByteLength(value(returned).type) > 8)
                rawLoad(2, value(returned).offset + 8);
            }
            imm(0, 1);
          } else {
            rawLoad(10, resultPointerOffset);
            const returned = t.value;
            if (returned !== undefined) {
              rawValue(9, returned);
              emit({ op: "str", width: 64, rt: 9, rn: 10, offset: 16 });
              if (
                value(returned).type === "general" ||
                value(returned).type === "optional-number" ||
                value(returned).type === "optional-boolean"
              ) {
                rawLoad(11, value(returned).offset + 8);
                emit({ op: "str", width: 64, rt: 11, rn: 10, offset: 24 });
              }
            }
            imm(0, 1);
            emit({ op: "str", width: 32, rt: 0, rn: 10, offset: 0 });
          }
          epilogue();
        }
        if (transient !== undefined && storage !== undefined)
          for (const op of b.instructions) {
            if (op === undefined) throw "temporary instruction invariant";
            const id = instructionResult(op);
            if (id !== undefined && transient[id] !== 0)
              storage[value(id).offset / 8] = 0;
          }
      }
      for (const block of fn.blocks) {
        if (block === undefined) throw "exception block invariant";
        const handler = block.exception;
        if (handler === undefined) continue;
        offsets[block.id * 2 + 3] = instructions.length * 4;
        emit({
          op: "sub-imm",
          width: 32,
          rd: "zr",
          rn: 0,
          immediate: 2,
          shift: 0,
          setFlags: true,
        });
        emit({ op: "b.cond", condition: "eq", displacement: 8 });
        emit({ op: "brk", immediate: 0 });
        rawLoad(9, resultOffset + 16);
        rawLoad(10, resultOffset + 24);
        rawStore(9, slotOffset(handler.slot));
        rawStore(10, slotOffset(handler.slot) + 8);
        // No safepoint occurs between receiving the payload and publishing its tag.
        branch({ op: "b" }, fn.id, handler.target);
      }
      if (throwExit) {
        offsets[1] = instructions.length * 4;
        emit({
          op: "sub-imm",
          width: 32,
          rd: "zr",
          rn: 0,
          immediate: 2,
          shift: 0,
          setFlags: true,
        });
        emit({ op: "b.cond", condition: "eq", displacement: 8 });
        emit({ op: "brk", immediate: 0 });
        rawLoad(10, resultPointerOffset);
        rawLoad(9, resultOffset + 16);
        rawLoad(11, resultOffset + 24);
        emit({ op: "str", width: 64, rt: 9, rn: 10, offset: 16 });
        emit({ op: "str", width: 64, rt: 11, rn: 10, offset: 24 });
        emit({ op: "str", width: 32, rt: 0, rn: 10, offset: 0 });
        epilogue();
      }
      endFrameRange();
      if (leafRegisters && leafStorage === undefined)
        promoteStackWords(
          instructions,
          start / 4,
          instructions.length,
          localsOffset,
          maximumCursor,
        );
      functions.push({
        id: fn.id,
        name: fn.name,
        exported: fn.exported,
        offset: start,
        byteLength: instructions.length * 4 - start,
        frameBytes,
        signature,
        debugFrame: debugSpans
          ? {
              register: 29,
              contextOffset: contextOffset - frameBytes,
              resultOffset: resultPointerOffset - frameBytes,
              ranges: frameRanges,
            }
          : undefined,
      });
    }
    scalarRegisters = undefined;
    // Each private leaf helper is appended once, regardless of the number of call sites.
    functionId = undefined;
    blockId = undefined;
    span = undefined;
    for (const fixup of helperFixups) {
      if (fixup === undefined) throw "helper fixup invariant";
      const kind = fixup.kind;
      if (!helperOffsets.has(kind)) {
        const offset = instructions.length * 4;
        helperOffsets.set(kind, offset);
        const body =
          kind === "shared-read-unsigned" ||
          kind === "shared-write-unsigned" ||
          kind === "shared-read-word64" ||
          kind === "shared-write-word64" ||
          kind === "shared-compare-exchange-word64" ||
          kind === "shared-compare-exchange-unsigned"
            ? sharedMemoryPrimitive(kind)
            : kind === "to-uint32" || kind === "remainder"
              ? numericHelper(kind)
              : kind === "array-initialize"
                ? arrayInitializer()
                : kind === "memory-move" || kind === "array-copy"
                  ? memoryMover(kind === "array-copy")
                  : kind === "remember-object"
                    ? rememberedBarrier()
                    : stringHelper(kind);
        for (const instruction of body) {
          if (instruction === undefined) throw "helper instruction invariant";
          emit(instruction);
        }
        helpers.push({
          kind,
          offset,
          byteLength: instructions.length * 4 - offset,
        });
      }
    }
    let codeLength = instructions.length * 4;
    const cellOffsets = new Map<string, number>(),
      cellBytes: { offset: number; bytes: Uint8Array }[] = [];
    for (const [key, access] of cellRequests) {
      const emitted = emitCellAccess(access, maxByteLength - codeLength);
      if (!emitted.ok)
        fail(
          emitted.error === "CODE_LIMIT" ? "CODE_LIMIT" : "ENCODING",
          "cell helper emission failed",
        );
      cellOffsets.set(key, codeLength);
      cellBytes.push({ offset: codeLength, bytes: emitted.value });
      cellHelpers.push({
        access,
        offset: codeLength,
        byteLength: emitted.value.length,
      });
      codeLength += emitted.value.length;
    }
    const stringOffsets = new Map<string, number>();
    for (const fixup of stringFixups) {
      if (fixup === undefined) throw "string fixup invariant";
      if (!stringOffsets.has(fixup.value)) {
        codeLength = Math.ceil(codeLength / 16) * 16;
        const byteLength = Math.ceil((24 + fixup.value.length * 2) / 16) * 16;
        if (byteLength > maxByteLength - codeLength)
          fail("CODE_LIMIT", "literal string pool exceeds byte budget");
        stringOffsets.set(fixup.value, codeLength);
        strings.push({ value: fixup.value, offset: codeLength, byteLength });
        codeLength += byteLength;
      }
    }
    for (let record = 0; record < recordLayouts.length; record++) {
      const layout = recordLayouts[record];
      if (layout === undefined) throw "record layout invariant";
      codeLength = Math.ceil(codeLength / 8) * 8;
      const referenceOffsets: number[] = [],
        generalOffsets: number[] = [];
      for (const field of layout.fields) {
        if (field === undefined) throw "record field invariant";
        if (managed(field.type)) referenceOffsets.push(field.offset);
        if (field.type === "general") generalOffsets.push(field.offset);
      }
      const size = 24 + (referenceOffsets.length + generalOffsets.length) * 8;
      if (size > maxByteLength - codeLength)
        fail("CODE_LIMIT", "record descriptors exceed byte budget");
      records.push({
        record,
        offset: codeLength,
        byteLength: layout.byteLength,
        referenceOffsets,
        generalOffsets,
      });
      codeLength += size;
    }
    for (const request of rootRequests) {
      if (request === undefined) throw "root request invariant";
      codeLength = Math.ceil(codeLength / 8) * 8;
      const size =
        16 + (request.offsets.length + request.generalOffsets.length) * 8;
      if (size > maxByteLength - codeLength)
        fail("CODE_LIMIT", "root descriptors exceed byte budget");
      roots.push({
        function: request.function,
        frameOffset: request.frameOffset,
        descriptorOffset: codeLength,
        offsets: request.offsets.slice(),
        generalOffsets: request.generalOffsets.slice(),
      });
      codeLength += size;
    }
    // Only address-taken functions and indirect-call witnesses need identities.
    // Their addresses are relocated within this image; even identical bytes in
    // another image deliberately remain a different identity.
    const signatureOffsets = new Map<number, number>();
    const signatureTargets = signatureFixups.map((fixup) => fixup.target);
    for (const group of localGroups) {
      if (group === undefined) throw "local signature group invariant";
      const first = group.functions[0];
      if (first === undefined) throw "local signature group member invariant";
      signatureTargets.push(first);
    }
    for (const targetId of signatureTargets) {
      if (targetId === undefined) throw "signature target invariant";
      const identity = signatureIds[targetId];
      if (identity === undefined) throw "signature identity invariant";
      if (signatureOffsets.has(identity)) continue;
      const target = module.functions[targetId];
      if (target === undefined) throw "signature target invariant";
      const parameters: ScalarType[] = [];
      for (const slot of target.parameters) {
        if (slot === undefined) throw "signature parameter slot invariant";
        const type = target.slots[slot];
        if (type === undefined) throw "signature parameter invariant";
        parameters.push(type);
      }
      codeLength = Math.ceil(codeLength / 8) * 8;
      const byteLength =
        nativeSignatureHeaderByteLength +
        parameters.length * nativeSignatureParameterByteLength;
      if (byteLength > maxByteLength - codeLength)
        fail("CODE_LIMIT", "signature descriptors exceed byte budget");
      signatureOffsets.set(identity, codeLength);
      const functionIds: number[] = [];
      for (const candidate of module.functions) {
        if (candidate === undefined) throw "signature function invariant";
        if (
          candidate.import !== true &&
          signatureIds[candidate.id] === identity &&
          !signatureImports.has(candidate.id)
        )
          functionIds.push(candidate.id);
      }
      const group = localGroups[identity - module.functions.length - 1];
      nativeSignatures.push({
        identity:
          group === undefined
            ? undefined
            : { name: group.name, contract: group.contract },
        version: nativeSignatureVersion,
        functions: functionIds,
        offset: codeLength,
        byteLength,
        parameters,
        returnType: target.returnType,
      });
      codeLength += byteLength;
    }
    for (const request of managedRequests) {
      if (request === undefined) throw "managed import request invariant";
      codeLength = Math.ceil(codeLength / 8) * 8;
      if (8 > maxByteLength - codeLength)
        fail("CODE_LIMIT", "managed pointer slots exceed byte budget");
      managedImports.push({
        role: request.role,
        name: request.name,
        contract: request.contract,
        offset: codeLength,
        byteLength: 8,
        witness: request.witness,
        parameters: request.parameters,
        returnType: request.returnType,
        recordLayout: request.recordLayout,
      });
      codeLength += 8;
    }
    codeLength = Math.ceil(codeLength / 4) * 4;
    if (codeLength > maxByteLength)
      fail("CODE_LIMIT", "aligned literal pool exceeds byte budget");
    // Pool units preserve UTF-16 code units, including lone surrogates.
    const code = new Uint8Array(codeLength);
    for (const literal of strings) {
      if (literal === undefined) throw "literal invariant";
      const n = literal.value.length;
      code[literal.offset] = 1;
      code[literal.offset + 8] = 1;
      const lengthWritten = writeUnsigned(
        code,
        literal.offset + 16,
        4,
        n,
        "little",
      );
      if (!lengthWritten.ok) fail("ENCODING", lengthWritten.error);
      for (let i = 0; i < n; i++) {
        const unit = literal.value.charCodeAt(i);
        code[literal.offset + 24 + i * 2] = unit % 256;
        code[literal.offset + 25 + i * 2] = Math.floor(unit / 256);
      }
    }
    function poolWord(offset: number, word: number): void {
      const written = writeWord64(
        code,
        offset,
        { lo: word % 4294967296, hi: Math.floor(word / 4294967296) },
        "little",
      );
      if (!written.ok) fail("ENCODING", written.error);
    }
    for (const signature of nativeSignatures) {
      if (signature === undefined) throw "signature descriptor invariant";
      poolWord(
        signature.offset + nativeSignatureVersionOffset,
        signature.version,
      );
      poolWord(
        signature.offset + nativeSignatureByteLengthOffset,
        signature.byteLength,
      );
      poolWord(
        signature.offset + nativeSignatureParameterCountOffset,
        signature.parameters.length,
      );
      poolWord(
        signature.offset + nativeSignatureResultOffset,
        nativeSignatureTypeCode(signature.returnType),
      );
      for (let index = 0; index < signature.parameters.length; index++) {
        const type = signature.parameters[index];
        if (type === undefined) throw "signature parameter encoding invariant";
        poolWord(
          signature.offset +
            nativeSignatureParametersOffset +
            index * nativeSignatureParameterByteLength,
          nativeSignatureTypeCode(type),
        );
      }
    }
    for (const record of records) {
      if (record === undefined) throw "record descriptor invariant";
      poolWord(record.offset, record.byteLength);
      poolWord(record.offset + 8, record.referenceOffsets.length);
      for (let index = 0; index < record.referenceOffsets.length; index++) {
        const offset = record.referenceOffsets[index];
        if (offset === undefined) throw "reference offset invariant";
        poolWord(record.offset + 16 + index * 8, offset);
      }
      const generalBase =
        record.offset + 16 + record.referenceOffsets.length * 8;
      poolWord(generalBase, record.generalOffsets.length);
      for (let i = 0; i < record.generalOffsets.length; i++) {
        const offset = record.generalOffsets[i];
        if (offset === undefined) throw "general offset invariant";
        poolWord(generalBase + 8 + i * 8, offset);
      }
    }
    for (const root of roots) {
      if (root === undefined) throw "root descriptor invariant";
      poolWord(root.descriptorOffset, root.offsets.length);
      for (let index = 0; index < root.offsets.length; index++) {
        const offset = root.offsets[index];
        if (offset === undefined) throw "root offset invariant";
        poolWord(root.descriptorOffset + 8 + index * 8, offset);
      }
      const generalBase = root.descriptorOffset + 8 + root.offsets.length * 8;
      poolWord(generalBase, root.generalOffsets.length);
      for (let i = 0; i < root.generalOffsets.length; i++) {
        const offset = root.generalOffsets[i];
        if (offset === undefined) throw "general root offset invariant";
        poolWord(generalBase + 8 + i * 8, offset);
      }
    }
    for (const part of cellBytes) {
      if (part === undefined) throw "cell code invariant";
      code.set(part.bytes, part.offset);
    }
    let wordBase = 0;
    for (const page of instructions.pages) {
      if (page === undefined) throw "instruction page invariant";
      const count = Math.min(page.length, instructions.length - wordBase);
      for (let i = 0; i < count; i++) {
        const instruction = page[i];
        if (instruction === undefined) throw "instruction invariant";
        const r = writeUnsigned(
          code,
          (wordBase + i) * 4,
          4,
          instruction,
          "little",
        );
        if (!r.ok) fail("ENCODING", r.error);
      }
      wordBase += count;
    }
    for (const fixup of fixups) {
      if (fixup === undefined) throw "fixup invariant";
      functionId = fixup.function;
      blockId = fixup.block;
      span = undefined;
      const block = fixup.block,
        functionBlocks = blockOffsets[fixup.function];
      const targetOffset =
        block === undefined
          ? functions[fixup.function]?.offset
          : functionBlocks === undefined
            ? undefined
            : functionBlocks.offsets[block < 0 ? -block * 2 - 1 : block * 2];
      if (targetOffset === undefined) throw "native label invariant";
      const r = patchBranch(code, {
        offset: fixup.offset,
        targetOffset,
        branch: fixup.branch,
      });
      if (!r.ok) fail("ENCODING", r.error);
    }
    for (const fixup of helperFixups) {
      if (fixup === undefined) throw "fixup invariant";
      const targetOffset = helperOffsets.get(fixup.kind);
      if (targetOffset === undefined) throw "helper layout invariant";
      const r = patchRelativeAddress(code, {
        offset: fixup.offset,
        targetOffset,
        rd: 16,
        scratch: 17,
      });
      if (!r.ok) fail("ENCODING", r.error);
    }
    for (const fixup of cellFixups) {
      if (fixup === undefined) throw "fixup invariant";
      const targetOffset = cellOffsets.get(fixup.key);
      if (targetOffset === undefined) throw "cell helper layout invariant";
      if (
        !patchRelativeAddress(code, {
          offset: fixup.offset,
          targetOffset,
          rd: 16,
          scratch: 17,
        }).ok
      )
        fail("ENCODING", "cell helper branch failed");
    }
    for (const fixup of stringFixups) {
      if (fixup === undefined) throw "fixup invariant";
      const targetOffset = stringOffsets.get(fixup.value);
      if (targetOffset === undefined) throw "literal pool invariant";
      const patched = patchRelativeAddress(code, {
        scratch: 17,
        offset: fixup.offset,
        targetOffset,
        rd: 9,
      });
      if (!patched.ok) fail("ENCODING", patched.error);
    }
    for (const fixup of functionAddresses) {
      if (fixup === undefined) throw "fixup invariant";
      if (functions[fixup.target]?.import === true)
        fail("INVALID_IR", "imported function has no local code address");
      const targetOffset = functions[fixup.target]?.offset;
      if (targetOffset === undefined) throw "function address invariant";
      const patched = patchRelativeAddress(code, {
        scratch: 17,
        offset: fixup.offset,
        targetOffset,
        rd: fixup.rd,
      });
      if (!patched.ok) fail("ENCODING", patched.error);
    }
    for (const fixup of signatureFixups) {
      if (fixup === undefined) throw "signature fixup invariant";
      const identity = signatureIds[fixup.target];
      const targetOffset =
        identity === undefined ? undefined : signatureOffsets.get(identity);
      if (targetOffset === undefined) throw "signature address invariant";
      const patched = patchRelativeAddress(code, {
        scratch: 17,
        offset: fixup.offset,
        targetOffset,
        rd: fixup.rd,
      });
      if (!patched.ok) fail("ENCODING", patched.error);
    }
    for (const fixup of managedPointerFixups) {
      if (fixup === undefined) throw "managed pointer fixup invariant";
      const target = managedImports[fixup.request];
      if (target === undefined) throw "managed pointer slot invariant";
      const patched = patchRelativeAddress(code, {
        scratch: 17,
        offset: fixup.offset,
        targetOffset: target.offset,
        rd: fixup.rd,
      });
      if (!patched.ok) fail("ENCODING", patched.error);
    }
    for (const fixup of recordFixups) {
      if (fixup === undefined) throw "fixup invariant";
      const record = records[fixup.record];
      if (record === undefined) throw "record descriptor invariant";
      const patched = patchRelativeAddress(code, {
        scratch: 17,
        offset: fixup.offset,
        targetOffset: record.offset,
        rd: 11,
      });
      if (!patched.ok) fail("ENCODING", patched.error);
    }
    for (let i = 0; i < rootRequests.length; i++) {
      const request = rootRequests[i],
        root = roots[i];
      if (request === undefined || root === undefined)
        throw "root descriptor invariant";
      const patched = patchRelativeAddress(code, {
        scratch: 17,
        offset: request.fixup,
        targetOffset: root.descriptorOffset,
        rd: 9,
      });
      if (!patched.ok) fail("ENCODING", patched.error);
    }
    return {
      ok: true,
      value: {
        code,
        linearAllocation,
        generationalBarriers,
        sourceRanges,
        functions,
        helpers,
        cellHelpers,
        strings,
        roots,
        records,
        imports,
        signatures: nativeSignatures,
        functionDescriptor:
          hasFunctions && brandImport === undefined
            ? records[functionRecord]
            : undefined,
        functionDescriptorImport:
          brandImport === undefined ? undefined : managedImports[brandImport],
        linkage: managedImports.length === 0 ? "local" : "unresolved-managed",
        managedImports,
      },
    };
  } catch (error) {
    if (error !== abort) throw error;
  }
  if (failure === undefined) throw "emission failure invariant";
  return { ok: false, error: failure };
}
