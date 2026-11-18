import {
  planLocalSignatures,
  type LocalSignatureBinding,
} from "./signature-groups.ts";
export type { LocalSignatureBinding } from "./signature-groups.ts";
import {
  nativeContextDomainOffset,
  nativeEngineThrowOffset,
  nativeStackOverflowPayload,
  nativeStackLimitOffset,
  nativeCStackReserveBytes,
  nativeHeaderFlagUnit,
  nativeHeaderFlagsShift,
  nativeStringLengthOffset,
  nativeStringDataOffset,
  nativeArrayLengthOffset,
  nativeArrayDataOffset,
  nativeArrayInlineOffset,
  nativeArrayOwnerOffset,
  nativeArrayViewByteLength,
} from "@tint/abi/host";
import {
  nativeWeakSlotMarker,
  nativeWeakSlotByteLength,
  nativeWeakSlotKeyOffset,
  nativeWeakSlotKeyPayloadOffset,
  nativeWeakSlotValueOffset,
  nativeWeakSlotValuePayloadOffset,
} from "@tint/abi/weak-slot";
import {
  nativeFunctionByteLength,
  nativeFunctionDescriptorOffset,
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
import {
  temporaryRegisters,
  nonAllocatingBlocks,
} from "./temporary-registers.ts";
import {
  recordDispatchChains,
  type RecordDispatchChain,
} from "./record-dispatch.ts";
import {
  deadSlotClearPlan,
  prologueClearWords,
  poolClearPlan,
  preSafepointResults,
} from "./pool-clears.ts";
import { shareFrameSlots, type SlotSharing } from "./slot-sharing.ts";
import { aliasedSlotLoads } from "./slot-aliases.ts";
import { slotHomes, type SlotHomes } from "./slot-registers.ts";
import {
  canUseLeafRegisters,
  canInlineCellRead,
  canInlineCellWrite,
  leafStorageRegisters,
} from "./leaf-registers.ts";
import { promoteStackWords } from "./stack-registers.ts";
import {
  createDebugTracker,
  type NativeFunctionDebug,
} from "./debug-variables.ts";
export type {
  NativeDebugLocation,
  NativeDebugVariable,
  NativeDebugWord,
  NativeFunctionDebug,
  NativeInlineRange,
} from "./debug-variables.ts";
import { forwardRegisterRoundTrips } from "./register-moves.ts";
import { fallsThrough, forwardableEntries } from "./block-entries.ts";
import {
  createWordBuffer,
  appendWord,
  readWord,
  truncateWords,
  writeWord,
} from "@tint/foundation/binary/word-buffer";
import {
  createNumberIndex,
  createStringIndex,
} from "@tint/foundation/collections/key-index";
import {
  nativeStackMapFooterBytes,
  nativeStackMapFooterMagic,
  nativeStackMapRegistryEntryBytes,
  nativeStackMapRegistryHeaderBytes,
  nativeStackMapRegistryOffset,
  nativeStackMapSaveBlockOffset,
  nativeStackMapRegisterShift,
  nativeTargetOSDarwin,
  nativeTargetOSLinux,
  type PosixHostABI,
} from "@tint/abi/host";
import {
  encodeStackMapTable,
  safepointLiveSlots,
  type SafepointEntry,
  type SafepointSite,
} from "./stack-maps.ts";
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
import {
  emitDualMappingMap,
  emitDualMappingUnmap,
  emitDualMappingWrite,
  dualMappingOf,
  type InlineFixup,
  type InlineSequenceBuilder,
} from "./executable-memory.ts";
import { rememberedBarrier } from "./barrier.ts";
export type LeafHelperKind =
  | SharedMemoryPrimitive
  | NumericHelper
  | StringHelper
  | "array-initialize"
  | "memory-move"
  | "array-copy"
  | "remember-object"
  | "stack-overflow";
import {
  cachedListReadPrefix,
  listVectorPrefix,
  verify,
  maximumStringLength,
  scalarByteLength,
  recordHeaderBytes,
  deadSlotsAtEntry,
  liveSlotsIntoEntry,
  analyzeLiveSlots,
  analyzeLiveSlotsPrecisely,
  provenRecordGuards,
  dataflowRecordGuards,
  provenRecordFacts,
  provenWordFacts,
  provenWordArguments,
  provenInductionWords,
  wordOnlyValues,
  provenNoSafepoints,
  provenDirectOnlyFunctions,
  stableRecordLayouts,
  stableDescriptors,
  instructionResult,
  visitInstructionOperands,
  visitTerminatorOperands,
  planTemporarySlots,
  hostReturnType,
  foreignCallTypes,
  foreignMemoryTypes,
  dynamicCallFrame,
  callbackTransition,
  callbackState,
  naturalLoops,
  blockSuccessors,
  type LoopForest,
  type SlotLiveness,
  type WordFacts,
  type ModuleIR,
  type RecordFlowFacts,
  type FunctionIR,
  type Verification,
  type RecordLayout,
  type ScalarType,
  type Span,
  type Instruction as IRInstruction,
  type Terminator as IRTerminator,
  type ForeignCall,
  instructionEffects as irInstructionEffects,
  effectAllocate as irEffectAllocate,
} from "@tint/ir/scalar";
import { compactSlots } from "@tint/ir/optimization";
import type { BaseRegister } from "../isa.ts";
import {
  classifyCCall,
  cTypeName,
  cScalarBytes,
  cScalarSigned,
  type CScalar,
  type CSignature,
  type CType,
  type CTarget,
  type CValueLocation,
} from "@tint/abi/c";
import {
  numericScalar,
  planForeignCall,
  type ForeignCallPlan,
} from "./foreign-calls.ts";
import type { UnwindRow, UnwindRule, UnwindSave } from "@tint/abi/unwind";
import { dwarfFloatRegister, dwarfStackPointer } from "../unwind.ts";
import {
  patchBranch,
  branchInReach,
  patchRelativeAddress,
  patchAddress,
  pageAddress,
  patchPageAddress,
  relativeAddress,
  float64Immediate,
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
export {
  nativeAllocationStateOffset,
  nativeContextBytes,
  nativeExternalMemoryOffset,
} from "./abi.ts";
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
  /** Source variables and inline scopes (debug builds with IR metadata). */
  readonly debug?: NativeFunctionDebug | undefined;
  /** Call-frame rule of the body (absent for imports). */
  readonly unwind?: UnwindRule | undefined;
  /** Frame words that may hold references (stack-pointer relative): the
   * closure environment, managed and general slots and temporary pools.
   * Safepoint maps list the live subset; when the liveness budget runs out,
   * every collecting call lists them all. Absent without such words. */
  readonly frameRoots?: NativeFrameRoots | undefined;
}
export interface NativeFrameRoots {
  readonly references: readonly number[];
  /** Tagged 16-byte general values, by their tag word. */
  readonly generals: readonly number[];
}
/** Private leaf helpers and cell helpers never touch the stack, frame pointer
 * or link register (see `unwindRanges` in ../unwind.ts). */
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
/** A safepoint table inside a module's code (see nativeStackMapMagic): it
 * maps return offsets relative to codeOffset, for codeLength bytes, to the
 * frame words holding live references while that call runs. Composition
 * registers each table with the hosted stack-map registry. */
export { decodeStackMaps, type DecodedSafepoint } from "./stack-maps.ts";
export interface NativeStackMapTable {
  readonly codeOffset: number;
  readonly codeLength: number;
  readonly tableOffset: number;
  /** The table's bytes (with the footer, for an emitted module's own table). */
  readonly byteLength: number;
  /** Safepoints in the table (diagnostics). */
  readonly entries: number;
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
/** The instructions one IR operation lowered to, for cost analysis tools.
 * `index` is the instruction's position in its block, or -1 for the
 * terminator. `operation` names the IR kind (and operator); `operands`
 * describes each operand's and the result's representation as emitted. */
export interface NativeOperationRange {
  readonly function: number;
  readonly block: number;
  readonly index: number;
  readonly operation: string;
  readonly operands: string;
  readonly offset: number;
  readonly byteLength: number;
}
/** Branch and address forms by function name. An emission reports the forms
 * it settled on; a later emission of a module sharing those functions can
 * start from them instead of rediscovering each out-of-reach site through
 * full re-emissions. Any hint is valid: it only selects longer forms. */
export interface EmissionFormHints {
  readonly calls: boolean;
  readonly longBranches: readonly string[];
  readonly islands: readonly string[];
  readonly longAddresses: readonly string[];
}
/** A BL whose target the hosted startup composition supplies: a diagnostics
 * routine outside the module (see EmissionOptions.throwTraces). */
export interface NativeStartupCall {
  readonly offset: number;
  readonly target: "trace-capture" | "jit-descriptor" | "jit-register";
}
export interface NativeModule {
  /** Calls into hosted diagnostics routines (throwTraces and the jit-debug
   * host operations); startup patches each BL. */
  readonly startupCalls?: readonly NativeStartupCall[] | undefined;
  /** The branch and address forms this emission settled on. */
  readonly formHints?: EmissionFormHints | undefined;
  /** Inline allocations require the context extension at byte 56. */
  readonly linearAllocation?: boolean | undefined;
  readonly generationalBarriers?: boolean | undefined;
  readonly sourceRanges: readonly NativeSourceRange[];
  /** Present when requested with the operationRanges option. */
  readonly operationRanges?: readonly NativeOperationRange[] | undefined;
  readonly imports: readonly NativeImportReference[];
  readonly linkage: "local" | "unresolved-managed";
  readonly managedImports: readonly NativeManagedPointerImport[];
  /** Five-instruction managed pointer loads. AOT composition can replace the
   * slot address/load with a direct relative address after contract preflight. */
  readonly managedReferences?: readonly NativeManagedAddressReference[];
  readonly functionDescriptorImport: NativeManagedPointerImport | undefined;
  readonly signatures: readonly NativeSignatureDescriptor[];
  /** Explicit synthetic function brand; ordinary matching layouts have no role. */
  readonly functionDescriptor: NativeRecordDescriptor | undefined;
  readonly records: readonly NativeRecordDescriptor[];
  /** Safepoint tables; one per emission, more after service-unit linking.
   * An emitted module also ends with a footer naming its own table. */
  readonly stackMaps: readonly NativeStackMapTable[];
  readonly strings: readonly NativeStringLiteral[];
  readonly cellHelpers: readonly NativeCellHelper[];
  readonly helpers: readonly NativeHelper[];
  readonly code: Uint8Array;
  readonly functions: readonly NativeFunction[];
  /** Callback entry thunks, contiguous (one registry range whose frames
   * the stack walk crosses through their transition records). */
  readonly callbackThunks?:
    | {
        readonly offset: number;
        readonly byteLength: number;
        readonly thunks: readonly {
          readonly slot: number;
          readonly offset: number;
        }[];
      }
    | undefined;
}
export interface NativeManagedAddressReference {
  readonly offset: number;
  readonly rd: number;
  readonly import: number;
  /** ADR + LDR (8 bytes) instead of the relocatable five-instruction load;
   * only emitted under compactManagedReferences and never relocated. */
  readonly compact?: true;
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
/** A frameless early exit's returned value and parameter test. */
type EarlyValue =
  | { readonly kind: "none" }
  | { readonly kind: "zero" }
  | { readonly kind: "bits"; readonly lo: number; readonly hi: number }
  | { readonly kind: "integer"; readonly register: number }
  | { readonly kind: "float"; readonly register: number };
interface EarlyPlan {
  readonly test: EarlyTest;
  readonly whenTrue: boolean;
  readonly value: EarlyValue;
}
type EarlyTest =
  | {
      readonly kind: "null";
      readonly register: number;
      readonly operator: "===" | "!==";
    }
  | {
      readonly kind: "float";
      readonly register: number;
      readonly operator: EarlyOperator;
      readonly constant: number;
    };
type EarlyOperator = "===" | "!==" | "<" | "<=" | ">" | ">=";
/** The condition after FCMP that holds exactly when `left op right` (false
 * for unordered operands except `!==`). */
function floatCondition(
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
/** The condition holding exactly when `condition` does not. */
function invertCondition(condition: Condition): Condition {
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
/** Stable version-1 descriptor encoding; zero is reserved for a void result. */
/** Local slots proven to hold 32-bit integers: induction certificates and
 * the optimizer's interval facts (FunctionIR.integerSlots). */
function provenIntegerSlots(
  fn: FunctionIR,
  maxWork: number,
): Uint8Array | undefined {
  const induction = provenInductionWords(fn, maxWork),
    facts = fn.integerSlots;
  if (facts === undefined || facts.length === 0) return induction;
  const words = induction ?? new Uint8Array(fn.slots.length);
  for (const slot of facts) if (slot !== undefined) words[slot] = 1;
  return words;
}

/** The header layout of a dense reference-list read or has accessor
 * generated by buildReferenceListAccessors (the vector holds the elements;
 * null is a hole), recognized from its IR so record renumbering cannot
 * invalidate it. Reads must use direct references (the vector itself marks a
 * stored undefined; string lists store each string's word the same way);
 * has accessors answer whether the element is non-null. */
interface ListReadShape {
  readonly header: number;
  readonly field: number;
  /** cached: a cacheListVectors reader (vector, list, index) whose first
   * argument is the list's current root vector or none. */
  readonly mode: "read" | "has" | "cached";
}
function listReadShape(fn: FunctionIR): ListReadShape | undefined {
  if (fn.name.startsWith(cachedListReadPrefix))
    return fn.returnType === "optional-reference" &&
      fn.parameters.length === 3 &&
      fn.slots[0] === "optional-reference" &&
      fn.slots[1] === "reference" &&
      fn.slots[2] === "number"
      ? { header: -1, field: -1, mode: "cached" }
      : undefined;
  const mode = fn.name.startsWith("__tint_reference_list_read$")
    ? "read"
    : fn.name.startsWith("__tint_reference_list_has$")
      ? "has"
      : undefined;
  if (
    mode === undefined ||
    (mode === "read"
      ? fn.returnType !== "optional-reference" &&
        fn.returnType !== "optional-string"
      : fn.returnType !== "boolean") ||
    fn.parameters.length !== 2 ||
    fn.parameters[0] !== 0 ||
    fn.parameters[1] !== 1 ||
    fn.slots[0] !== "reference" ||
    fn.slots[1] !== "number"
  )
    return undefined;
  const entry = fn.blocks[fn.entry];
  if (entry === undefined || entry.id !== fn.entry) return undefined;
  const first = entry.instructions[0],
    term = entry.terminator;
  if (
    entry.instructions.length !== 1 ||
    first === undefined ||
    first.kind !== "load" ||
    first.slot !== 0 ||
    term.kind !== "record" ||
    term.operation !== "read" ||
    term.object !== first.id ||
    term.field !== 1
  )
    return undefined;
  let vectorTest = false,
    vectorRead = false,
    selfTest = false;
  for (const block of fn.blocks) {
    if (block === undefined) return undefined;
    for (const op of block.instructions) {
      if (op === undefined) return undefined;
      if (op.kind === "reference-vector-is") vectorTest = true;
      else if (op.kind === "reference-vector-read") vectorRead = true;
      else if (op.kind === "binary" && op.operator === "===") selfTest = true;
      // Delete accessors clear the element.
      else if (op.kind === "reference-vector-write") return undefined;
    }
    const t = block.terminator;
    // The cell-based read variant reads payloads through cell records.
    if (t.kind === "record" && block !== entry) return undefined;
  }
  if (!vectorTest || !vectorRead) return undefined;
  if (mode === "has")
    return { header: term.record, field: term.field, mode: "has" };
  return selfTest
    ? { header: term.record, field: term.field, mode: "read" }
    : undefined;
}

/** The header record of a cacheListVectors vector accessor: (list or none)
 * to the list's root when that root is a reference vector, else none. */
function listVectorShape(fn: FunctionIR): number | undefined {
  if (
    !fn.name.startsWith(listVectorPrefix) ||
    fn.returnType !== "optional-reference" ||
    fn.parameters.length !== 1 ||
    fn.parameters[0] !== 0 ||
    fn.slots[0] !== "optional-reference"
  )
    return undefined;
  for (const block of fn.blocks) {
    const t = block?.terminator;
    if (t !== undefined && t.kind === "record")
      return t.operation === "read" && t.field === 1 ? t.record : undefined;
  }
  return undefined;
}

/** A dense reference-list write accessor with direct references (header
 * field 0 the logical length, field 1 the root; a stored undefined is the
 * vector itself), recognized from its IR like listReadShape. */
interface ListWriteShape {
  readonly header: number;
}
function listWriteShape(fn: FunctionIR): ListWriteShape | undefined {
  if (
    !fn.name.startsWith("__tint_reference_list_write$") ||
    fn.returnType !== "void" ||
    fn.parameters.length !== 3 ||
    fn.parameters[0] !== 0 ||
    fn.parameters[1] !== 1 ||
    fn.parameters[2] !== 2 ||
    fn.slots[0] !== "reference" ||
    fn.slots[1] !== "number" ||
    (fn.slots[2] !== "optional-reference" && fn.slots[2] !== "optional-string")
  )
    return undefined;
  let header = -1,
    vectorWrite = false,
    lengthWrite = false;
  for (const block of fn.blocks) {
    if (block === undefined) return undefined;
    for (const op of block.instructions) {
      if (op === undefined) return undefined;
      // The cell-based variant boxes payloads in cell records.
      if (op.kind === "record-new") return undefined;
      if (op.kind === "reference-vector-write") vectorWrite = true;
    }
    const t = block.terminator;
    if (t.kind === "record") {
      if (header < 0) header = t.record;
      else if (header !== t.record) return undefined;
      if (t.field === 0 && t.operation === "write") lengthWrite = true;
    } else if (t.kind === "record-cell" || t.kind === "cell") return undefined;
  }
  return header >= 0 && vectorWrite && lengthWrite ? { header } : undefined;
}

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
/** Fused union dispatch chains at least this long test membership with one
 * bitset lookup (about 20 instructions) instead of a comparison per layout. */
const dispatchBitsetThreshold = 10;
/** A branch emitted with displacement 0, patched to a label later. */
interface LocalBranch {
  readonly index: number;
  readonly branch: Branch;
}
/** Family words before each local record descriptor (below its index word):
 * bit f of word f >> 6 marks membership in dispatch family f, so frequent
 * union dispatches test one loaded word instead of an indexed bitset. */
const dispatchFamilyWords = 2;
/** Bytes before each record descriptor that hold its dispatch family words
 * and record index. */
const descriptorPrefixBytes = dispatchFamilyWords * 8 + 8;
/** Codegen analyses that still have a per-function size limit. */
export type CodegenAnalysis =
  | "slot-homes"
  | "slot-home-sharing"
  | "entry-live-homes"
  | "dead-slot-roots"
  | "join-record-guards"
  | "safepoint-liveness";

export interface EmissionOptions {
  readonly maxByteLength?: number | undefined;
  /** Ahead-of-time builds: lift the work limits of codegen analyses (each
   * of which otherwise falls back to slower, conservative code on large
   * functions). Live compilation keeps them for responsiveness. */
  readonly unboundedAnalysis?: boolean | undefined;
  /** Called when a size-limited analysis gives up on a function, which then
   * gets conservative code (pass statistics report these fallbacks). */
  readonly analysisLimit?:
    ((analysis: CodegenAnalysis, fn: FunctionIR) => void) | undefined;
  /** Single-ADR local addresses: undefined uses a module-size estimate,
   * true always attempts them (out-of-reach functions still fall back). */
  readonly compactAddresses?: boolean | undefined;
  /** Slot loads may use their slot word as home (default). False keeps a
   * separate home per load, for tests that pin temporary-pool layouts. */
  readonly aliasSlotLoads?: boolean | undefined;
  /** False zeroes every managed slot word in the prologue, even those every
   * path stores before any collection or read (tests pinning root layouts). */
  readonly prologueSlotProof?: boolean | undefined;
  /** False emits the conservative regime precise maps fall back to when the
   * liveness budget runs out: every frame root listed at each collecting
   * call, kept valid by entry zeroing and dead-slot and pool clears (tests
   * pinning that regime). */
  readonly preciseStackMaps?: boolean | undefined;
  /** Managed slot loads may use ADR+LDR. Only for modules whose managed
   * references are never relocated by service-unit linking. */
  readonly compactManagedReferences?: boolean | undefined;
  /** The module's code is placed at a 4 KiB aligned address, so local
   * addresses out of ADR reach use ADRP+ADD (two instructions) instead of the
   * four-instruction PC-relative sequence. */
  readonly pageAlignedCode?: boolean | undefined;
  readonly hostABI?: PosixHostABI | undefined;
  readonly debugSpans?: boolean | undefined;
  /** Record NativeOperationRange entries (analysis tooling only). */
  readonly operationRanges?: boolean | undefined;
  readonly linearAllocation?: boolean | undefined;
  readonly generationalBarriers?: boolean | undefined;
  readonly closedRoots?: readonly number[] | undefined;
  readonly managedABI?: ManagedABIRequest | undefined;
  readonly localSignatures?: readonly LocalSignatureBinding[] | undefined;
  /** Retain physical entry descriptors for separately composed native calls. */
  readonly signatureRoots?: readonly number[] | undefined;
  /** Start from these forms (see EmissionFormHints). */
  readonly formHints?: EmissionFormHints | undefined;
  /** Diagnostics: each throw origin (throw terminator) calls the hosted
   * image's trace-capture routine (see NativeModule.startupCalls). */
  readonly throwTraces?: boolean | undefined;
}
const compactRangeMessage: string =
  "compact branch or call target out of range";
/** IR instructions below which local addresses start as a single ADR. */
const compactAddressInstructions: number = 65536;
/** Module facts every emission attempt needs and none of the branch forms
 * affect: computed by the first attempt, reused by compact-range retries. */
interface EmissionFacts {
  verified: Verification | undefined;
  wordReturns: Uint8Array | undefined;
  wordArguments: readonly Uint8Array[] | undefined;
  wordArgumentsKnown: boolean;
  recordFlows: RecordFlowFacts | undefined;
  recordFlowsKnown: boolean;
  noSafepoints: Uint8Array | undefined;
  noSafepointsKnown: boolean;
  directReturns: Uint8Array | undefined;
  directReturnsKnown: boolean;
}
interface BranchForms {
  /** BL for local calls; false after any call target was out of reach. */
  calls: boolean;
  /** Whether local addresses are attempted as a single ADR at all. */
  readonly addresses: boolean;
  /** Functions emitting two-instruction conditional branches. */
  readonly longBranches: Set<number>;
  /** Functions that overflowed conditional reach once: they place skipped
   * trap and branch-veneer islands between blocks before any long form. */
  readonly islands: Set<number>;
  /** Functions materializing local addresses with four instructions. */
  readonly longAddresses: Set<number>;
}
/** Conditional branches (±1 MiB), calls (±128 MiB) and local addresses
 * (±1 MiB) are emitted in their single-instruction forms. Out-of-reach
 * targets are collected and emission restarts with long forms for exactly
 * those functions (or for all calls), so output is a pure function of the
 * input. */
/** Inline raw-word host operations sharing the memory-read-word window
 * contract (address, byteLength, offset, ...). */
function rawWordOperation(operation: string): boolean {
  return (
    operation === "memory-read-word" ||
    operation === "memory-write-word" ||
    operation === "memory-move" ||
    operation === "memory-compare-exchange-word" ||
    operation === "memory-fetch-add-word" ||
    operation === "memory-load-acquire-word" ||
    operation === "memory-store-release-word"
  );
}
/** A root-head binding's own body: one block that only loads slots and
 * reads the root head. Its frame is popped before the walk it starts. */
function rootHeadBinding(fn: FunctionIR): boolean {
  const block = fn.blocks.length === 1 ? fn.blocks[0] : undefined;
  if (block === undefined) return false;
  let reads = false;
  for (const op of block.instructions) {
    if (op?.kind === "host-call" && op.operation === "root-head") reads = true;
    else if (op?.kind !== "load") return false;
  }
  return reads;
}
export function emitModule(
  module: ModuleIR,
  options: EmissionOptions = {},
): Emission {
  // Single-instruction local addresses only pay off below ADR's 1 MiB reach;
  // larger modules start with the four-instruction form instead of retrying.
  let size = 0;
  for (const fn of module.functions)
    for (const block of fn?.blocks ?? [])
      size += 1 + (block?.instructions.length ?? 0);
  const forms: BranchForms = {
    calls: true,
    addresses: options.compactAddresses ?? size < compactAddressInstructions,
    longBranches: new Set(),
    longAddresses: new Set(),
    islands: new Set(),
  };
  const facts: EmissionFacts = {
    verified: undefined,
    wordReturns: undefined,
    wordArguments: undefined,
    wordArgumentsKnown: false,
    recordFlows: undefined,
    recordFlowsKnown: false,
    noSafepoints: undefined,
    noSafepointsKnown: false,
    directReturns: undefined,
    directReturnsKnown: false,
  };
  const hints = options.formHints;
  if (hints !== undefined) {
    const ids = createStringIndex<number>();
    for (const fn of module.functions)
      if (fn !== undefined) ids.set(fn.name, fn.id);
    function seed(names: readonly string[], into: Set<number>): void {
      for (const name of names) {
        if (name === undefined) throw "form hint invariant";
        const id = ids.get(name);
        if (id !== undefined) into.add(id);
      }
    }
    if (!hints.calls) forms.calls = false;
    seed(hints.longBranches, forms.longBranches);
    seed(hints.islands, forms.islands);
    if (forms.addresses) seed(hints.longAddresses, forms.longAddresses);
  }
  // Each retry moves calls or at least one function a step towards long
  // forms (compact, islands, long), so emission terminates; larger forms only
  // grow code, so retries may cascade.
  while (true) {
    const before =
        forms.longBranches.size + forms.longAddresses.size + forms.islands.size,
      calls = forms.calls;
    const emitted = emitModuleForms(module, options, forms, facts);
    if (emitted.ok)
      return {
        ok: true,
        value: { ...emitted.value, formHints: describeForms(module, forms) },
      };
    if (emitted.error.message !== compactRangeMessage) return emitted;
    // Defensive: a retry that moved nothing to long forms cannot succeed.
    if (
      forms.calls === calls &&
      forms.longBranches.size +
        forms.longAddresses.size +
        forms.islands.size ===
        before
    )
      return emitted;
  }
}
function describeForms(
  module: ModuleIR,
  forms: BranchForms,
): EmissionFormHints {
  function names(ids: Set<number>): string[] {
    const result: string[] = [];
    for (const fn of module.functions)
      if (fn !== undefined && ids.has(fn.id)) result.push(fn.name);
    return result;
  }
  return {
    calls: forms.calls,
    longBranches: names(forms.longBranches),
    islands: names(forms.islands),
    longAddresses: names(forms.longAddresses),
  };
}
function emitModuleForms(
  module: ModuleIR,
  options: EmissionOptions,
  forms: BranchForms,
  facts: EmissionFacts,
): Emission {
  /** An analysis work limit: unlimited for ahead-of-time builds. */
  const work = (limit: number): number =>
    options.unboundedAnalysis === true ? Number.MAX_SAFE_INTEGER : limit;
  const analysisLimit = options.analysisLimit;
  function limited<T>(
    analysis: CodegenAnalysis,
    fn: FunctionIR,
    result: T | undefined,
  ): T | undefined {
    if (result === undefined && analysisLimit !== undefined)
      analysisLimit(analysis, fn);
    return result;
  }
  const compactCalls = forms.calls;
  const maxByteLength =
      options.maxByteLength === undefined ? 0xffffffff : options.maxByteLength,
    debugSpans = options.debugSpans ?? false,
    recordOperations = options.operationRanges ?? false,
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
  const operationRanges: NativeOperationRange[] = [];
  const instructions = createWordBuffer(),
    functions: NativeFunction[] = [],
    blockOffsets: { readonly offsets: readonly (number | undefined)[] }[] = [],
    fixups: Fixup[] = [];
  // Fixups already patched in place to a nearby veneer (branchIsland).
  const resolvedFixups = new Set<number>();
  const imports: NativeImportReference[] = [];
  const throwTraces = options.throwTraces ?? false,
    startupCalls: NativeStartupCall[] = [];
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
  // Safepoints of every emitted function, by return offset.
  const safepoints: SafepointEntry[] = [];
  const helpers: NativeHelper[] = [],
    helperFixups: { offset: number; kind: LeafHelperKind }[] = [],
    helperOffsets = new Map<LeafHelperKind, number>();
  const cellRequests = new Map<string, CellAccess>(),
    cellFixups: { offset: number; key: string }[] = [];
  const cellHelpers: NativeCellHelper[] = [];
  const strings: NativeStringLiteral[] = [],
    stringFixups: { offset: number; value: string }[] = [],
    // Union dispatch membership: per candidate set, a bitset over record
    // indices (key "set:<ids>"), plus the record descriptor region bounds
    // ("start"/"end") that keep foreign descriptors out of the bitset.
    dispatchFixups: { offset: number; key: string }[] = [];
  const dispatchSets = new Map<
    string,
    { readonly first: number; readonly records: readonly number[] }
  >();
  /** Candidate sets with a family bit, in first-use order. */
  const dispatchFamilies = new Map<string, number>();
  function callHelper(kind: LeafHelperKind): void {
    helperFixups.push({ offset: instructions.length * 4, kind });
    callRelative();
  }
  /** Generational write barrier for the object in x9 (context in x10).
   * Objects at or above the nursery's start need no remembering, which is
   * exactly when the helper would return at once, so that test is inline:
   * the generational state (context +56, zero until published) holds the
   * nursery's offset from the managed base (context +8) at +8. Clobbers
   * x10..x16 like the helper. */
  function rememberObject(): void {
    emit({ op: "ldr", width: 64, rt: 12, rn: 10, offset: 56 });
    const unpublished = instructions.length;
    emit({ op: "cbz", width: 64, rt: 12, displacement: 0 });
    emit({ op: "ldr", width: 32, rt: 13, rn: 12, offset: 8 });
    emit({ op: "ldr", width: 64, rt: 14, rn: 10, offset: 8 });
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
      op: "sub-reg",
      width: 64,
      rd: "zr",
      rn: 9,
      rm: 13,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
    const young = instructions.length;
    emit({ op: "b.cond", condition: "cs", displacement: 0 });
    callHelper("remember-object");
    const done = instructions.length;
    patchInstruction(unpublished, {
      op: "cbz",
      width: 64,
      rt: 12,
      displacement: (done - unpublished) * 4,
    });
    patchInstruction(young, {
      op: "b.cond",
      condition: "cs",
      displacement: (done - young) * 4,
    });
  }
  /** x9/x10 string objects -> w9 (1 equal, 0 different). Identical objects
   * are equal and different lengths unequal without the content helper,
   * which covers most discriminant comparisons. */
  function stringEqual(): void {
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
    const same = instructions.length;
    emit({ op: "b.cond", condition: "eq", displacement: 0 });
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
      op: "sub-reg",
      width: 32,
      rd: "zr",
      rn: 11,
      rm: 12,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
    const different = instructions.length;
    emit({ op: "b.cond", condition: "ne", displacement: 0 });
    callHelper("string-equal");
    const compared = instructions.length;
    emit({ op: "b", displacement: 0 });
    patchInstruction(same, {
      op: "b.cond",
      condition: "eq",
      displacement: (instructions.length - same) * 4,
    });
    emit({ op: "movz", width: 64, rd: 9, immediate: 1, shift: 0 });
    const equalDone = instructions.length;
    emit({ op: "b", displacement: 0 });
    patchInstruction(different, {
      op: "b.cond",
      condition: "ne",
      displacement: (instructions.length - different) * 4,
    });
    emit({ op: "movz", width: 64, rd: 9, immediate: 0, shift: 0 });
    patchInstruction(compared, {
      op: "b",
      displacement: (instructions.length - compared) * 4,
    });
    patchInstruction(equalDone, {
      op: "b",
      displacement: (instructions.length - equalDone) * 4,
    });
  }
  function callRelative(): void {
    // Compact calls are a BL patched at layout; modules beyond its 128 MiB
    // reach use x16/x17, which the ABI reserves for call/address scratch.
    if (compactCalls) {
      emit({ op: "bl", displacement: 0 });
      return;
    }
    relativePointer(16);
    emit({ op: "blr", rn: 16 });
  }
  function host(): PosixHostABI {
    const abi = options.hostABI;
    if (abi === undefined)
      fail("UNSUPPORTED", "target host ABI is required for this operation");
    return abi;
  }
  function cTarget(): CTarget {
    const target = host().c;
    if (target === undefined)
      fail("UNSUPPORTED", "target has no C calling convention");
    return target;
  }
  const foreignPlans = new Map<ForeignCall, ForeignCallPlan>();
  /** The classified frame plan of a c-call on the target's C ABI. */
  function foreignPlan(call: ForeignCall): ForeignCallPlan {
    const cached = foreignPlans.get(call);
    if (cached !== undefined) return cached;
    const plan = planForeignCall(call, cTarget());
    if (!plan.ok) fail("UNSUPPORTED", call.symbol + ": " + plan.error);
    foreignPlans.set(call, plan.value);
    return plan.value;
  }
  // Out-of-range compact forms are collected; emission then restarts with
  // long forms for exactly those calls and functions.
  let compactOverflow = false;
  function compactFailure(error: string, fixup: Fixup | undefined): void {
    // An unconditional B has no longer form: report its range failure as is.
    if (error !== "OUT_OF_RANGE" || fixup?.branch.op === "b")
      fail("ENCODING", error);
    compactOverflow = true;
    if (fixup === undefined || fixup.branch.op === "bl") forms.calls = false;
    else conditionalOverflow(fixup.function);
  }
  /** A conditional site out of reach: islands first, long forms only when
   * this emission already used islands for the function. */
  const islandsBefore = new Set<number>(forms.islands);
  function conditionalOverflow(fn: number): void {
    if (islandsBefore.has(fn)) forms.longBranches.add(fn);
    else forms.islands.add(fn);
  }
  function fail(code: Diagnostic["code"], message: string): never {
    failure = { code, message, function: functionId, block: blockId, span };
    throw abort;
  }
  // Store-to-load forwarding for frame words: which GP register still holds
  // each 64-bit stack word last stored or loaded. Valid within straight-line
  // code: cleared at every branch, call, other memory write, unknown
  // instruction and branch target (`joins`). A block start keeps what every
  // edge into it agrees on when all its edges are already emitted
  // (`forwardableEntries`); otherwise it clears too.
  const stackWords = new Map<number, number>(),
    joins = new Set<number>();
  let lastJoin = -1;
  // Per function: the words every emitted edge into a block agrees on, the
  // number of branch fixups those edges include, the counts each seeded block
  // start relied on (checked against the function's final fixups) and the
  // island veneers that only relay an already recorded edge.
  const edgeWords = new Map<number, Map<number, number>>(),
    edgeBranches = new Map<number, number>(),
    seededEntries = new Map<number, number>(),
    veneerFixups = new Set<number>();
  function recordEdge(block: number, isBranch: boolean): void {
    const known = edgeWords.get(block);
    if (known === undefined) {
      const words = new Map<number, number>();
      for (const [offset, held] of stackWords) words.set(offset, held);
      edgeWords.set(block, words);
    } else {
      const disagreeing: number[] = [];
      for (const [offset, held] of known)
        if (stackWords.get(offset) !== held) disagreeing.push(offset);
      for (const offset of disagreeing)
        if (offset !== undefined) known.delete(offset);
    }
    if (isBranch) edgeBranches.set(block, (edgeBranches.get(block) ?? 0) + 1);
  }
  function forgetRegister(register: number): void {
    for (const [offset, held] of stackWords)
      if (held === register) stackWords.delete(offset);
  }
  /** GP registers an instruction writes (read from its encoding: Rd/Rt in
   * bits 0-4, LDP's Rt2 in bits 10-14; 31 is the zero register), or
   * undefined when it may do more than write registers (branches, calls,
   * memory writes, unknown operations). */
  function registerWrites(
    i: Instruction,
    word: number,
  ): readonly number[] | undefined {
    const rd = word & 31,
      own = rd === 31 ? [] : [rd];
    switch (i.op) {
      case "movz":
      case "movk":
      case "add-imm":
      case "sub-imm":
      case "add-reg":
      case "sub-reg":
      case "and-reg":
      case "orr-reg":
      case "eor-reg":
      case "orn-reg":
      case "lslv":
      case "lsrv":
      case "asrv":
      case "sdiv":
      case "madd":
      case "msub":
      case "ubfm":
      case "sbfm":
      case "extr":
      case "cset":
      case "csel":
      case "sxtw":
      case "adr":
      case "adrp":
      case "fmov-x-d":
      case "fcvtzs-w-d":
      case "fcvtzs-x-d":
      case "ldr":
      case "ldrb":
      case "ldrh":
        return own;
      case "ldp": {
        const rt2 = (word >>> 10) & 31;
        return rt2 === 31 ? own : [rd, rt2];
      }
      case "ldr-indexed":
        return i.fp ? [] : own;
      case "fadd":
      case "fsub":
      case "fmul":
      case "fdiv":
      case "fmin":
      case "fmax":
      case "fneg":
      case "fabs":
      case "fmov-d-d":
      case "frintp":
      case "frintz":
      case "fsqrt":
      case "ucvtf-d-w":
      case "scvtf-d-w":
      case "scvtf-d-x":
      case "fmov-d-x":
      case "fmov-d-imm":
      case "fcmp":
      case "ldr-d":
      case "ldp-d":
      case "nop":
      case "ldr-q":
      case "add-4s":
      case "mov-16b":
      case "sha256h":
      case "sha256h2":
      case "sha256su0":
      case "sha256su1":
        return [];
      default:
        return undefined;
    }
  }
  /** Forget the forwarded words when a branch joins at the next index. */
  function settleJoin(): void {
    if (joins.has(instructions.length)) {
      joins.delete(instructions.length);
      stackWords.clear();
    }
  }
  function emit(i: Instruction): void {
    settleJoin();
    if (i.op === "ldr" || i.op === "str") {
      const rt = i.rt,
        offset = i.offset;
      if (i.width === 64 && i.rn === "sp" && offset <= 32760) {
        if (typeof rt === "number" && i.op === "ldr") {
          const held = stackWords.get(offset);
          if (held !== undefined) {
            // Dropping an instruction would shift fixed-displacement
            // targets still ahead; a register move keeps the count.
            if (held === rt && lastJoin < instructions.length) return;
            if (held !== rt) {
              forgetRegister(rt);
              emitWord({
                op: "orr-reg",
                width: 64,
                rd: rt,
                rn: "zr",
                rm: held,
              });
              return;
            }
          }
          forgetRegister(rt);
          emitWord(i);
          stackWords.set(offset, rt);
          return;
        }
        emitWord(i);
        if (typeof rt === "number") stackWords.set(offset, rt);
        else stackWords.delete(offset);
        return;
      }
    }
    if (i.op === "str-d" && i.rn === "sp") {
      emitWord(i);
      stackWords.delete(i.offset);
      return;
    }
    const encoded = encode(i),
      writes = registerWrites(i, encoded.ok ? encoded.value : 0);
    if (writes === undefined || !encoded.ok) stackWords.clear();
    else
      for (const register of writes)
        if (register !== undefined) forgetRegister(register);
    if (
      (i.op === "b" ||
        i.op === "b.cond" ||
        i.op === "cbz" ||
        i.op === "cbnz") &&
      i.displacement > 0
    ) {
      const target = instructions.length + i.displacement / 4;
      joins.add(target);
      if (target > lastJoin) lastJoin = target;
    }
    emitWord(i);
  }
  function emitWord(i: Instruction): void {
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
    if (
      (instruction.op === "b" ||
        instruction.op === "b.cond" ||
        instruction.op === "cbz" ||
        instruction.op === "cbnz") &&
      instruction.displacement > 0
    ) {
      const target = index + instruction.displacement / 4;
      if (target <= instructions.length) stackWords.clear();
      else {
        joins.add(target);
        if (target > lastJoin) lastJoin = target;
      }
    } else stackWords.clear();
    const encoded = encode(instruction);
    if (!encoded.ok) fail("ENCODING", encoded.error);
    writeWord(instructions, index, encoded.value);
  }
  /** Call the imported C symbol `name` through its bound slot (x16, x17). */
  function importCall(name: string): void {
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
  /** The address of import `name`'s slot in `rd` (`scratch` is clobbered). */
  /** rd = the address of callback thunk `thunk` (resolved at link time). */
  function thunkAddress(rd: number, thunk: number | undefined): void {
    if (thunk === undefined) throw "callback thunk invariant";
    importAddress(rd, 17, "tint:callback-thunk:" + String(thunk));
  }
  function importAddress(rd: number, scratch: number, name: string): void {
    imports.push({
      offset: instructions.length * 4,
      rd,
      scratch,
      target: { kind: "import", name },
    });
    const sequence = relativeAddress(rd, scratch, 0);
    if (!sequence.ok) fail("ENCODING", sequence.error);
    for (const instruction of sequence.value) {
      if (instruction === undefined) throw "import address invariant";
      emit(instruction);
    }
  }
  function relativePointer(rd: number): void {
    const sequence = relativeAddress(rd, 17, 0);
    if (!sequence.ok) fail("ENCODING", sequence.error);
    for (const instruction of sequence.value) {
      if (instruction === undefined) throw "relative pointer invariant";
      emit(instruction);
    }
  }
  /** Address of a target inside this module: one ADR when in reach, else
   * ADRP+ADD in page-aligned code, else the PC-relative sequence. */
  const compactSites = new Map<number, number>(),
    pageSites = new Set<number>();
  function localPointer(rd: number, pages: boolean = true): void {
    const owner = functionId;
    if (
      forms.addresses &&
      owner !== undefined &&
      !forms.longAddresses.has(owner)
    ) {
      compactSites.set(instructions.length * 4, owner);
      emit({ op: "adr", rd, displacement: 0 });
    } else if (pages && options.pageAlignedCode === true) {
      pageSites.add(instructions.length * 4);
      const sequence = pageAddress(rd, 0, 0);
      if (!sequence.ok) fail("ENCODING", sequence.error);
      for (const instruction of sequence.value) {
        if (instruction === undefined) throw "page pointer invariant";
        emit(instruction);
      }
    } else relativePointer(rd);
  }
  function managedPointer(rd: number, request: number): void {
    managedPointerFixups.push({ offset: instructions.length * 4, request, rd });
    // Service-unit linking patches managed sites itself: ADR or the long
    // sequence only.
    if (options.compactManagedReferences === true) localPointer(rd, false);
    else relativePointer(rd);
    emit({ op: "ldr", width: 64, rt: rd, rn: rd, offset: 0 });
  }
  function functionEntryPointer(rd: number, target: number): void {
    functionAddresses.push({ offset: instructions.length * 4, target, rd });
    localPointer(rd);
  }
  function functionSignaturePointer(rd: number, target: number): void {
    const imported = signatureImports.get(target);
    if (imported !== undefined) managedPointer(rd, imported);
    else {
      signatureFixups.push({ offset: instructions.length * 4, target, rd });
      localPointer(rd);
    }
  }
  /** Callback thunks this module's may-callback calls pass to C, one per
   * (C prototype, callback position) (docs/native-ffi.md, "Callbacks");
   * startup resolves `tint:callback-thunk:<index>` to each one's entry. */
  const callbackThunkRequests: {
    readonly key: string;
    /** Undefined: a universal thunk (dynamic callbacks). */
    readonly signature: CSignature | undefined;
    readonly ordinal: number;
  }[] = [];
  function callbackThunk(
    signature: CSignature | undefined,
    ordinal: number,
  ): number {
    const names: string[] = [];
    for (const parameter of signature?.parameters ?? []) {
      if (parameter === undefined) throw "callback parameter invariant";
      names.push(cTypeName(parameter));
    }
    const key =
      String(ordinal) +
      ":" +
      (signature === undefined
        ? "universal"
        : cTypeName(signature.result) + "(" + names.join(",") + ")");
    for (let index = 0; index < callbackThunkRequests.length; index++)
      if (callbackThunkRequests[index]?.key === key) return index;
    callbackThunkRequests.push({ key, signature, ordinal });
    return callbackThunkRequests.length - 1;
  }
  /** A callback thunk: C calls it with `signature`'s ABI during a
   * may-callback call, and it calls the call's `ordinal`th callback (a
   * function value in the innermost transition record) with numbers; a
   * negative `ordinal` makes registered callback `-1 - ordinal`'s thunk,
   * which calls the transition's dispatcher with that id first.
   * Frame (192 bytes, x29 = sp): the frame record, the callback's result
   * record at +16, the transition at +48 (the stack walk reads it), C's
   * x0..x7 at +64 and d0..d7 at +128; C's stack arguments follow the
   * frame. Traps unless this thread has a callback state (pthread key)
   * whose innermost transition is not already running a callback. */
  function emitCallbackThunk(
    signature: CSignature | undefined,
    ordinal: number,
  ): void {
    // A universal thunk (no prototype) passes the callback its frame's
    // address instead: the dynamic layer reads the saved C arguments there
    // and writes x0 and d0 back (docs/native-ffi.md, "Dynamic callbacks").
    const classified =
      signature === undefined ? undefined : classifyCCall(signature, cTarget());
    if (classified !== undefined && !classified.ok)
      fail("UNSUPPORTED", "callback: " + classified.error);
    const locations: readonly CValueLocation[] =
      classified === undefined || !classified.ok
        ? []
        : classified.value.arguments;
    const registered = ordinal < 0,
      first = registered ? 1 : 0;
    if (locations.length + first > 8)
      fail("UNSUPPORTED", "callbacks take at most eight arguments");
    const frame = 192;
    const traps: { at: number; branch: Branch }[] = [];
    function trapBranch(branch: Branch): void {
      traps.push({ at: instructions.length, branch });
      emit({ ...branch, displacement: 0 });
    }
    const t = callbackTransition;
    emit({
      op: "stp",
      width: 64,
      rt: 29,
      rt2: 30,
      rn: "sp",
      offset: -frame,
      mode: "pre",
    });
    emit({
      op: "add-imm",
      width: 64,
      rd: 29,
      rn: "sp",
      immediate: 0,
      shift: 0,
      setFlags: false,
    });
    for (let register = 0; register < 8; register += 2) {
      emit({
        op: "stp",
        width: 64,
        rt: register,
        rt2: register + 1,
        rn: 29,
        offset: 64 + register * 8,
        mode: "offset",
      });
      emit({
        op: "stp-d",
        rt: register,
        rt2: register + 1,
        rn: 29,
        offset: 128 + register * 8,
      });
    }
    // This thread's callback state block.
    importAddress(9, 17, "tint:callback-key");
    emit({ op: "ldr", width: 64, rt: 0, rn: 9, offset: 0 });
    importCall(host().symbolPrefix + "pthread_getspecific");
    trapBranch({ op: "cbz", width: 64, rt: 0 });
    // The innermost transition: present, not already running a callback,
    // and entered on this very thread.
    emit({ op: "ldr", width: 64, rt: 11, rn: 0, offset: 0 });
    trapBranch({ op: "cbz", width: 64, rt: 11 });
    emit({ op: "ldr", width: 64, rt: 12, rn: 11, offset: t.entered });
    trapBranch({ op: "cbnz", width: 64, rt: 12 });
    emit({ op: "ldr", width: 64, rt: 12, rn: 11, offset: t.thread });
    emit({ op: "mrs-thread", rt: 13, readOnly: host().os === "darwin" });
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
    trapBranch({ op: "b.cond", condition: "ne" });
    imm(12, 1);
    emit({ op: "str", width: 64, rt: 12, rn: 11, offset: t.entered });
    emit({ op: "str", width: 64, rt: 11, rn: 29, offset: 48 });
    // C arguments to numbers in d16.., then d0.. (the callback's numbers).
    for (let index = 0; index < locations.length; index++) {
      const location = locations[index],
        type = signature?.parameters[index];
      if (location === undefined || type === undefined)
        throw "callback argument invariant";
      const rd = 16 + index;
      if (location.class === "float") {
        const from =
          location.stackOffset >= 0
            ? frame + location.stackOffset
            : 128 + location.fp * 8;
        if (location.size === 4) {
          emit({ op: "ldr", width: 32, rt: 14, rn: 29, offset: from });
          emit({ op: "fmov-s-w", rd, rn: 14 });
          emit({ op: "fcvt-d-s", rd, rn: rd });
        } else emit({ op: "ldr-d", rt: rd, rn: 29, offset: from });
        continue;
      }
      if (location.class !== "integer")
        fail("UNSUPPORTED", "callback arguments are scalars or pointers");
      emit({
        op: "ldr",
        width: 64,
        rt: 14,
        rn: 29,
        offset:
          location.stackOffset >= 0
            ? frame + location.stackOffset
            : 64 + location.gp * 8,
      });
      const scalar: CScalar =
        type.kind === "pointer" ? "usize" : numericScalar(type);
      const bytes = cScalarBytes(scalar),
        signed = scalar !== "bool" && cScalarSigned(scalar, cTarget());
      // The callee extends narrow integers (AAPCS64 leaves upper bits
      // unspecified); 64-bit values convert directly.
      if (bytes < 8)
        emit({
          op: signed ? "sbfm" : "ubfm",
          width: 64,
          rd: 14,
          rn: 14,
          immr: 0,
          imms: bytes * 8 - 1,
        });
      if (signed) emit({ op: "scvtf-d-x", rd, rn: 14 });
      else emit({ op: "ucvtf-d-x", rd, rn: 14 });
    }
    for (let index = 0; index < locations.length; index++)
      emit({ op: "fmov-d-d", rd: first + index, rn: 16 + index });
    if (registered) {
      imm(14, -1 - ordinal);
      emit({ op: "scvtf-d-x", rd: 0, rn: 14 });
    }
    if (signature === undefined) emit({ op: "scvtf-d-x", rd: 0, rn: 29 });
    // Call the function value with the caller's context.
    emit({ op: "ldr", width: 64, rt: 11, rn: 29, offset: 48 });
    emit({
      op: "ldr",
      width: 64,
      rt: 12,
      rn: 11,
      offset: registered ? t.registered : t.callbacks + ordinal * 8,
    });
    emit({ op: "ldr", width: 64, rt: 0, rn: 11, offset: t.context });
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
    imm(2, 0);
    emit({
      op: "add-imm",
      width: 64,
      rd: 3,
      rn: 29,
      immediate: 16,
      shift: 0,
      setFlags: false,
    });
    emit({ op: "blr", rn: 16 });
    // The generated callback catches every exception: anything but a
    // normal completion is an invariant failure.
    emit({
      op: "sub-imm",
      width: 32,
      rd: "zr",
      rn: 0,
      immediate: 1,
      shift: 0,
      setFlags: true,
    });
    trapBranch({ op: "b.cond", condition: "ne" });
    if (signature === undefined) {
      // The dynamic layer wrote the result words over the saved x0, d0.
      emit({ op: "ldr", width: 64, rt: 0, rn: 29, offset: 64 });
      emit({ op: "ldr-d", rt: 0, rn: 29, offset: 128 });
    } else emit({ op: "ldr-d", rt: 0, rn: 29, offset: 32 });
    const result: CType =
      signature === undefined ? { kind: "void" } : signature.result;
    if (result.kind === "scalar" && result.scalar === "f32")
      emit({ op: "fcvt-s-d", rd: 0, rn: 0 });
    else if (result.kind === "scalar" && result.scalar !== "f64") {
      const scalar = result.scalar;
      if (scalar === "bool") emit({ op: "fcvtzu-w-d", rd: 0, rn: 0 });
      else if (cScalarSigned(scalar, cTarget()))
        emit({ op: "fcvtzs-x-d", rd: 0, rn: 0 });
      else emit({ op: "fcvtzu-x-d", rd: 0, rn: 0 });
    } else if (result.kind === "pointer")
      emit({ op: "fcvtzu-x-d", rd: 0, rn: 0 });
    else if (result.kind !== "void" && result.kind !== "scalar")
      fail("UNSUPPORTED", "callback results are scalars or pointers");
    emit({ op: "ldr", width: 64, rt: 11, rn: 29, offset: 48 });
    emit({ op: "str", width: 64, rt: "zr", rn: 11, offset: t.entered });
    emit({
      op: "ldp",
      width: 64,
      rt: 29,
      rt2: 30,
      rn: "sp",
      offset: frame,
      mode: "post",
    });
    emit({ op: "ret", rn: 30 });
    // Outside a may-callback call, on a thread without callback state, or
    // while a callback already runs (a leaf call that called back): a
    // contract violation, so trap loudly.
    const trap = instructions.length;
    emit({ op: "brk", immediate: 3 });
    for (const site of traps) {
      if (site === undefined) throw "callback trap invariant";
      patchInstruction(site.at, {
        ...site.branch,
        displacement: (trap - site.at) * 4,
      });
    }
  }
  function imm(rd: number, value: number): void {
    imm64(rd, value % 4294967296, Math.floor(value / 4294967296));
  }
  /** Materialize the 64-bit pattern hi:lo (unsigned 32-bit halves): MOVZ
   * for its first nonzero 16-bit part and MOVK for each other nonzero part. */
  function imm64(rd: number, lo: number, hi: number): void {
    let first = true;
    for (let part = 0; part < 4; part++) {
      const word = part < 2 ? lo : hi,
        half = part % 2 === 0 ? word % 65536 : Math.floor(word / 65536) % 65536;
      if (half === 0) continue;
      emit({
        op: first ? "movz" : "movk",
        width: 64,
        rd,
        immediate: half,
        shift: part === 0 ? 0 : part === 1 ? 16 : part === 2 ? 32 : 48,
      });
      first = false;
    }
    if (first) emit({ op: "movz", width: 64, rd, immediate: 0, shift: 0 });
  }
  /** The NaN-boxed `undefined` optional number (see
   * optionalNumberAbsentHigh): NOT 0x0008_0000_0000_0000. */
  function absentNumber(rd: number): void {
    emit({ op: "movz", width: 64, rd, immediate: 8, shift: 48 });
    emit({ op: "orn-reg", width: 64, rd, rn: "zr", rm: rd });
  }
  /** Sets EQ exactly when the optional-number bits in `rn` are `undefined`:
   * rotated right by 51, the reserved word is -2. Clobbers `scratch`. */
  function absentFlags(rn: number, scratch: number): void {
    emit({ op: "extr", width: 64, rd: scratch, rn, rm: rn, lsb: 51 });
    emit({
      op: "add-imm",
      width: 64,
      rd: "zr",
      rn: scratch,
      immediate: 2,
      shift: 0,
      setFlags: true,
    });
  }
  /** FMAX d, d: the identity on every non-NaN (signed zeros included) and a
   * quiet NaN for every NaN, so the result never has the reserved
   * signalling `undefined` bits. */
  function quietNumber(rd: number, rn: number): void {
    emit({ op: "fmax", rd, rn, rm: rn });
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
  /** Zero stack words whose order is unobservable (no label or safepoint
   * between them). These are frame words the collector may scan (roots,
   * temporary pools, result buffers): they are written in memory even when
   * a slot's value lives in a register home. Adjacent words share one STP. */
  function zeroWords(offsets: readonly number[]): void {
    const sorted: number[] = [];
    for (const offset of offsets) {
      if (offset === undefined) throw "zero word invariant";
      sorted.push(offset);
    }
    sorted.sort((a, b) => a - b);
    let previous = -1,
      // Pairs beyond STP's reach from SP address from x16 = SP + base
      // (x16 is scratch wherever words are zeroed); -1 until materialized.
      base = -1;
    for (let index = 0; index < sorted.length; index++) {
      const offset = sorted[index];
      if (offset === undefined) throw "zero word invariant";
      if (offset === previous) continue;
      previous = offset;
      const next = sorted[index + 1];
      if (
        next !== undefined &&
        next === offset + 8 &&
        offset % 8 === 0 &&
        offset >= 0 &&
        offset <= 4095
      ) {
        let rn: number | "sp" = "sp",
          relative = offset;
        if (offset > 504) {
          if (base < 0 || offset - base > 504) {
            base = offset;
            emit({
              op: "add-imm",
              width: 64,
              rd: 16,
              rn: "sp",
              immediate: base,
              shift: 0,
              setFlags: false,
            });
          }
          rn = 16;
          relative = offset - base;
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
        previous = next;
        index++;
      } else emit({ op: "str", width: 64, rt: "zr", rn: "sp", offset });
    }
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
  function inverseCondition(condition: Condition): Condition {
    const index = conditions.indexOf(condition),
      inverse = conditions[index % 2 === 0 ? index + 1 : index - 1];
    if (index < 0 || inverse === undefined) throw "branch condition invariant";
    return inverse;
  }
  function branch(
    branch: Branch,
    targetFunction: number,
    targetBlock: number | undefined,
  ): void {
    if (branch.op === "bl" && targetBlock === undefined) {
      if (compactCalls) {
        if (module.functions[targetFunction]?.import === true)
          fail("INVALID_IR", "imported function has no local code address");
        fixups.push({
          offset: instructions.length * 4,
          branch,
          function: targetFunction,
          block: undefined,
        });
      } else
        functionAddresses.push({
          offset: instructions.length * 4,
          target: targetFunction,
          rd: 16,
        });
      callRelative();
      return;
    }
    const localBlock =
      branch.op !== "bl" &&
      targetFunction === functionId &&
      targetBlock !== undefined &&
      targetBlock >= 0
        ? targetBlock
        : undefined;
    if (localBlock !== undefined) {
      settleJoin();
      recordEdge(localBlock, true);
    }
    if (branch.op !== "bl" && !forms.longBranches.has(targetFunction)) {
      fixups.push({
        offset: instructions.length * 4,
        branch,
        function: targetFunction,
        block: targetBlock,
      });
      if (
        branch.op !== "b" &&
        targetBlock !== undefined &&
        targetFunction === functionId
      ) {
        const labels = blockOffsets[blockOffsets.length - 1]?.offsets;
        if (labels?.[blockLabel(targetBlock)] === undefined)
          forwardSites.push({
            fixup: fixups.length - 1,
            index: instructions.length,
            branch,
            block: targetBlock,
          });
      }
      // A conditional branch writes no register: the fallthrough keeps the
      // words its edge was recorded with.
      const kept = new Map<number, number>();
      if (localBlock !== undefined)
        for (const [offset, held] of stackWords) kept.set(offset, held);
      if (branch.op === "b.cond")
        emit({ op: "b.cond", condition: branch.condition, displacement: 0 });
      else if (branch.op === "cbz" || branch.op === "cbnz")
        emit({
          op: branch.op,
          width: branch.width,
          rt: branch.rt,
          displacement: 0,
        });
      else {
        emit({ op: "b", displacement: 0 });
        return;
      }
      for (const [offset, held] of kept) stackWords.set(offset, held);
      return;
    }
    // Long form: conditional A64 branches reach only 1 MiB. Keep their
    // displacement local and relocate an unconditional branch (128 MiB).
    if (
      branch.op === "b.cond" &&
      branch.condition !== "al" &&
      branch.condition !== "nv"
    ) {
      emit({
        op: "b.cond",
        condition: inverseCondition(branch.condition),
        displacement: 8,
      });
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
  /** Invariant failure sites of the current function: each is one
   * conditional branch to a shared BRK #3, emitted at the function's end or
   * in a skipped island between blocks (trapIsland).
   * Functions on long branches keep the inline skip-over-BRK pair. */
  let trapSites: { readonly index: number; readonly branch: Branch }[] = [];
  function trapIf(branch: Branch): void {
    const owner = functionId;
    if (owner !== undefined && forms.longBranches.has(owner)) {
      if (branch.op === "b.cond")
        emit({
          op: "b.cond",
          condition: inverseCondition(branch.condition),
          displacement: 8,
        });
      else if (branch.op === "cbz" || branch.op === "cbnz")
        emit({
          op: branch.op === "cbz" ? "cbnz" : "cbz",
          width: branch.width,
          rt: branch.rt,
          displacement: 8,
        });
      else throw "trap branch invariant";
      emit({ op: "brk", immediate: 3 });
      return;
    }
    trapSites.push({ index: instructions.length, branch });
    if (branch.op === "b.cond")
      emit({ op: "b.cond", condition: branch.condition, displacement: 0 });
    else if (branch.op === "cbz" || branch.op === "cbnz")
      emit({
        op: branch.op,
        width: branch.width,
        rt: branch.rt,
        displacement: 0,
      });
    else throw "trap branch invariant";
  }
  /** Between blocks, once the oldest pending trap site is half a conditional
   * range away, emit `b +8; brk #3` and point the pending sites there, so
   * large functions keep single-branch guards. Block labels follow it. */
  function blockLabel(block: number): number {
    return block < 0 ? -block * 2 - 1 : block * 2;
  }
  /** Compact conditional branches of the current function whose target label
   * is not yet emitted. Once the oldest is half a conditional range away, a
   * skipped island of unconditional branches (one per distinct target, 128
   * MiB reach) takes them, so large functions with far-away handlers keep
   * single-instruction conditional branches instead of long forms. */
  let forwardSites: {
    readonly fixup: number;
    readonly index: number;
    readonly branch: Branch;
    readonly block: number;
  }[] = [];
  function branchIsland(): void {
    stackWords.clear();
    const owner = functionId;
    if (owner === undefined || !forms.islands.has(owner)) return;
    const oldest = forwardSites[0];
    if (
      oldest === undefined ||
      (instructions.length - oldest.index) * 4 <= 524288
    )
      return;
    const sites = forwardSites;
    forwardSites = [];
    const labels = blockOffsets[blockOffsets.length - 1]?.offsets;
    const targets: number[] = [],
      veneers = new Map<number, number>();
    for (const site of sites) {
      if (site === undefined) throw "veneer site invariant";
      if (labels?.[blockLabel(site.block)] !== undefined) continue;
      if (!veneers.has(site.block)) {
        veneers.set(site.block, -1);
        targets.push(site.block);
      }
    }
    if (targets.length === 0) return;
    emit({ op: "b", displacement: (targets.length + 1) * 4 });
    for (const target of targets) {
      if (target === undefined) throw "veneer target invariant";
      veneers.set(target, instructions.length);
      veneerFixups.add(fixups.length);
      fixups.push({
        offset: instructions.length * 4,
        branch: { op: "b" },
        function: owner,
        block: target,
      });
      emit({ op: "b", displacement: 0 });
    }
    for (const site of sites) {
      if (site === undefined) throw "veneer site invariant";
      const veneer = veneers.get(site.block);
      if (veneer === undefined || veneer < 0) continue;
      const displacement = (veneer - site.index) * 4,
        branch = site.branch;
      const patched: Instruction =
        branch.op === "b.cond"
          ? { op: "b.cond", condition: branch.condition, displacement }
          : branch.op === "cbz" || branch.op === "cbnz"
            ? {
                op: branch.op,
                width: branch.width,
                rt: branch.rt,
                displacement,
              }
            : { op: "b", displacement };
      const encoded = encode(patched);
      // Out of reach even of the island: keep the fixup; the end-of-module
      // patch then moves the function to long branches as before.
      if (!encoded.ok) {
        if (encoded.error !== "OUT_OF_RANGE") fail("ENCODING", encoded.error);
        continue;
      }
      writeWord(instructions, site.index, encoded.value);
      resolvedFixups.add(site.fixup);
    }
  }
  function trapIsland(): void {
    stackWords.clear();
    const owner = functionId;
    if (owner === undefined || !forms.islands.has(owner)) return;
    const oldest = trapSites[0];
    if (
      oldest === undefined ||
      (instructions.length - oldest.index) * 4 <= 524288
    )
      return;
    emit({ op: "b", displacement: 8 });
    flushTraps();
  }
  /** Emit the function's shared trap and point every trap site at it; a site
   * beyond conditional reach moves the function to long branches. */
  function flushTraps(): void {
    const sites = trapSites;
    trapSites = [];
    if (sites.length === 0) return;
    const trap = instructions.length;
    emit({ op: "brk", immediate: 3 });
    const owner = functionId;
    for (const site of sites) {
      if (site === undefined) throw "trap site invariant";
      const displacement = (trap - site.index) * 4,
        branch = site.branch;
      const patched: Instruction =
        branch.op === "b.cond"
          ? { op: "b.cond", condition: branch.condition, displacement }
          : branch.op === "cbz" || branch.op === "cbnz"
            ? {
                op: branch.op,
                width: branch.width,
                rt: branch.rt,
                displacement,
              }
            : { op: "b", displacement };
      const encoded = encode(patched);
      if (!encoded.ok) {
        if (encoded.error !== "OUT_OF_RANGE" || owner === undefined)
          fail("ENCODING", encoded.error);
        compactOverflow = true;
        conditionalOverflow(owner);
        continue;
      }
      writeWord(instructions, site.index, encoded.value);
    }
  }
  try {
    if (
      !Number.isInteger(maxByteLength) ||
      maxByteLength < 4 ||
      maxByteLength > 0xffffffff
    )
      fail("CODE_LIMIT", "invalid byte budget");
    const valid = facts.verified ?? verify(module);
    facts.verified = valid;
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
      (fn) => compactSlots(fn, work(1000000))?.fn ?? fn,
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
          byteLength: recordHeaderBytes + 8,
          fields: [
            { offset: recordHeaderBytes, type: "string", mutable: false },
          ],
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
    const stableLayouts = stableRecordLayouts(module),
      // Intraprocedural descriptor proofs need descriptor stability only.
      stableGuards = stableDescriptors(module);
    const stableSlots =
      stableLayouts &&
      !module.functions.some((fn) => fn.environment !== undefined);
    /** Numeric outcomes of each function's returns (word-facts masks, 0
     * unknown), swept to a fixpoint: each sweep proves calls with the
     * previous sweep's returns, so words flow through functions returning
     * other calls' results. Each sweep's masks are met with the previous
     * ones (both sound), so they only shrink and the sweeps terminate. */
    function provenWordReturns(): Uint8Array {
      let proven = new Uint8Array(module.functions.length);
      if (stableSlots) {
        let budget = work(10000000),
          first = true;
        for (;;) {
          const next = new Uint8Array(module.functions.length);
          for (const fn of module.functions) {
            if (fn === undefined) throw "word return function invariant";
            const proof = provenWordFacts(
              fn,
              Math.min(work(1000000), budget),
              first ? undefined : proven,
            );
            if (proof !== undefined) {
              next[fn.id] = proof.returned;
              budget -= proof.work;
            }
          }
          let changed = first;
          for (let id = 0; id < next.length; id++) {
            const a = proven[id] ?? 0,
              b = next[id] ?? 0;
            const met = first ? b : a === 0 ? b : b === 0 ? a : a & b;
            next[id] = met;
            if (met !== a) changed = true;
          }
          proven = next;
          first = false;
          if (!changed) break;
        }
      }
      facts.wordReturns = proven;
      return proven;
    }
    const wordReturns: Uint8Array = facts.wordReturns ?? provenWordReturns();
    if (!facts.wordArgumentsKnown) {
      facts.wordArguments =
        stableSlots && closedRoots !== undefined
          ? provenWordArguments(
              module,
              closedRoots,
              wordReturns,
              work(10000000),
            )
          : undefined;
      facts.wordArgumentsKnown = true;
    }
    const wordArguments = facts.wordArguments;
    if (!facts.recordFlowsKnown) {
      facts.recordFlows =
        closedRoots === undefined
          ? undefined
          : provenRecordFacts(module, work(10000000), true, closedRoots);
      facts.recordFlowsKnown = true;
    }
    const recordValues = facts.recordFlows,
      recordFlows = recordValues?.blocks;
    if (!facts.noSafepointsKnown) {
      facts.noSafepoints = provenNoSafepoints(module, work(10000000));
      facts.noSafepointsKnown = true;
    }
    const noSafepoints = facts.noSafepoints;
    // Root-head bindings: functions whose own body only reads the root head
    // (see the root-head operation). Their callers start stack walks.
    const rootHeadBindings = new Uint8Array(module.functions.length);
    for (const fn of module.functions)
      if (fn !== undefined && rootHeadBinding(fn)) rootHeadBindings[fn.id] = 1;
    if (!facts.directReturnsKnown) {
      facts.directReturns =
        closedRoots === undefined
          ? undefined
          : provenDirectOnlyFunctions(module, closedRoots, work(10000000));
      facts.directReturnsKnown = true;
    }
    const directReturns = facts.directReturns;
    const signatures = module.functions.map((fn): SignatureLayout => {
      if (fn === undefined) throw "function invariant";
      return signatureLayout(fn);
    });
    const listShapes = module.functions.map((fn): ListReadShape | undefined =>
      fn === undefined ? undefined : listReadShape(fn),
    );
    function listReadShapes(id: number): ListReadShape | undefined {
      return listShapes[id];
    }
    const vectorShapes = module.functions.map((fn): number | undefined =>
      fn === undefined ? undefined : listVectorShape(fn),
    );
    const writeShapes = module.functions.map(
      (fn): ListWriteShape | undefined =>
        fn === undefined ? undefined : listWriteShape(fn),
    );
    /** Whether a conditional branch recorded since `firstFixup` that
     * targets a block of `owner` cannot reach it in compact form. */
    function ownBranchesOutOfReach(owner: number, firstFixup: number): boolean {
      const labels = blockOffsets[owner];
      if (labels === undefined) return false;
      for (let index = firstFixup; index < fixups.length; index++) {
        const fixup = fixups[index];
        if (fixup === undefined) throw "fixup invariant";
        const block = fixup.block;
        if (
          fixup.function !== owner ||
          block === undefined ||
          fixup.branch.op === "b" ||
          fixup.branch.op === "bl" ||
          resolvedFixups.has(index)
        )
          continue;
        const target = labels.offsets[block < 0 ? -block * 2 - 1 : block * 2];
        if (target === undefined) throw "native label invariant";
        if (!branchInReach(fixup.branch, target - fixup.offset)) return true;
      }
      return false;
    }
    function rollBack(mark: {
      readonly words: number;
      readonly functions: number;
      readonly blockOffsets: number;
      readonly fixups: number;
      readonly helperFixups: number;
      readonly recordFixups: number;
      readonly functionAddresses: number;
      readonly managedPointerFixups: number;
      readonly signatureFixups: number;
      readonly cellFixups: number;
      readonly stringFixups: number;
      readonly dispatchFixups: number;
      readonly safepoints: number;
      readonly sourceRanges: number;
      readonly operationRanges: number;
      readonly startupCalls: number;
      readonly imports: number;
    }): void {
      for (let index = mark.fixups; index < fixups.length; index++)
        resolvedFixups.delete(index);
      const firstByte = mark.words * 4;
      for (
        let offset = firstByte;
        offset < instructions.length * 4;
        offset += 4
      ) {
        compactSites.delete(offset);
        pageSites.delete(offset);
      }
      truncateWords(instructions, mark.words);
      // Forwarding state describes only the code that remains.
      stackWords.clear();
      for (const join of joins) if (join >= mark.words) joins.delete(join);
      lastJoin = -1;
      for (const join of joins) if (join > lastJoin) lastJoin = join;
      while (functions.length > mark.functions) functions.pop();
      while (blockOffsets.length > mark.blockOffsets) blockOffsets.pop();
      while (fixups.length > mark.fixups) fixups.pop();
      while (helperFixups.length > mark.helperFixups) helperFixups.pop();
      while (recordFixups.length > mark.recordFixups) recordFixups.pop();
      while (functionAddresses.length > mark.functionAddresses)
        functionAddresses.pop();
      while (managedPointerFixups.length > mark.managedPointerFixups)
        managedPointerFixups.pop();
      while (signatureFixups.length > mark.signatureFixups)
        signatureFixups.pop();
      while (cellFixups.length > mark.cellFixups) cellFixups.pop();
      while (stringFixups.length > mark.stringFixups) stringFixups.pop();
      while (dispatchFixups.length > mark.dispatchFixups) dispatchFixups.pop();
      while (safepoints.length > mark.safepoints) safepoints.pop();
      while (sourceRanges.length > mark.sourceRanges) sourceRanges.pop();
      while (operationRanges.length > mark.operationRanges)
        operationRanges.pop();
      while (startupCalls.length > mark.startupCalls) startupCalls.pop();
      // Import call sites in re-emitted code are recorded again.
      while (imports.length > mark.imports) imports.pop();
    }
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
      // A function whose own conditional branches end out of reach is
      // re-emitted alone with islands (then long forms) instead of failing
      // and re-emitting the whole module: functions precede everything that
      // depends on their layout, so truncating to its start is complete.
      // Analyses of the function itself do not depend on its branch forms:
      // the first attempt computes them and retries reuse them (`known`
      // tells an analysis that gave up from one not yet run).
      let integerFactsKnown = false,
        cachedIntegerFacts: WordFacts | undefined,
        depthForestKnown = false,
        cachedDepthForest: LoopForest | undefined,
        sharingKnown = false,
        cachedSharing: SlotSharing | undefined,
        homesKnown = false,
        cachedHomes: SlotHomes | undefined,
        entryLivenessKnown = false,
        cachedEntryLiveness: SlotLiveness | undefined,
        deadSlotsKnown = false,
        cachedDeadSlots: readonly (readonly number[])[] | undefined,
        safepointLivenessKnown = false,
        cachedSafepointLiveness: SlotLiveness | undefined,
        recordGuardsKnown = false,
        cachedChainGuards: Uint8Array | undefined,
        cachedJoinGuards: Uint8Array | undefined;
      // Numbers whose uses all want integers take GP homes, but one computed
      // as a double moves between banks at its definition and at each use.
      // The first attempt records those; one re-emission gives them FP homes.
      let floatWordsKnown = false;
      const floatWords = new Set<number>();
      while (true) {
        const overflowBefore: boolean = compactOverflow,
          islandsWere: boolean = forms.islands.has(fn.id),
          longWere: boolean = forms.longBranches.has(fn.id);
        const mark = {
          words: instructions.length,
          functions: functions.length,
          blockOffsets: blockOffsets.length,
          fixups: fixups.length,
          helperFixups: helperFixups.length,
          recordFixups: recordFixups.length,
          functionAddresses: functionAddresses.length,
          managedPointerFixups: managedPointerFixups.length,
          signatureFixups: signatureFixups.length,
          cellFixups: cellFixups.length,
          stringFixups: stringFixups.length,
          dispatchFixups: dispatchFixups.length,
          safepoints: safepoints.length,
          sourceRanges: sourceRanges.length,
          operationRanges: operationRanges.length,
          startupCalls: startupCalls.length,
          imports: imports.length,
        };
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
                  op.kind === "string-allocate" ||
                  ((op.kind === "call" || op.kind === "call-indirect") &&
                    op.id !== undefined &&
                    (managed(module.functions[op.target]?.returnType ?? "") ||
                      module.functions[op.target]?.returnType === "general")),
              ),
            ));
        // Facts describe actual IR operations, never unchecked source annotations.
        // 1: a constant modulo word; 2: a signed/unsigned 32-bit integer result;
        // 3: an exact unsigned 32-bit constant, also valid as a memory argument.
        // 4: an optional 32-bit integer; 5: a 32-bit integer or NaN after unwrap.
        // 6/7: a bounded safe integer, without/with possible NaN. Magnitudes
        // prove signed-64 conversion safe, but do not imply valid array indices.
        if (!integerFactsKnown) {
          cachedIntegerFacts = stableSlots
            ? provenWordFacts(
                fn,
                work(1000000),
                wordReturns,
                provenIntegerSlots(fn, work(200000)),
                wordArguments === undefined ? undefined : wordArguments[fn.id],
              )
            : undefined;
          integerFactsKnown = true;
        }
        const integerFacts = cachedIntegerFacts;
        const slotIntegerFacts =
          integerFacts === undefined ? undefined : integerFacts.slots;
        // Integer slots hold an exact int64 instead of a double: number
        // slots whose every assignment is proven a 32-bit integer, that only
        // instruction loads and stores access (the facts never admit -0), and
        // whose loads are all used as integers (see below).
        const integerSlots = new Uint8Array(fn.slots.length);
        if (slotIntegerFacts !== undefined) {
          for (let slot = 0; slot < fn.slots.length; slot++)
            if (fn.slots[slot] === "number" && slotIntegerFacts[slot] === 1)
              integerSlots[slot] = 1;
          if (fn.receiverSlot !== undefined) integerSlots[fn.receiverSlot] = 0;
          for (const parameter of fn.parameters)
            if (parameter !== undefined) integerSlots[parameter] = 0;
          for (const block of fn.blocks) {
            if (block === undefined) throw "integer slot block invariant";
            if (block.exception !== undefined)
              integerSlots[block.exception.slot] = 0;
            const t = block.terminator;
            if (
              t.kind === "record" ||
              t.kind === "record-cell" ||
              t.kind === "cell"
            )
              integerSlots[t.slot] = 0;
          }
        }
        const valueIds = createNumberIndex(),
          values: (Value | undefined)[] = [];
        // Exact integers. A numeric result whose every use is a bitwise
        // operation, a store to an integer slot, a +/- whose own result
        // qualifies, a numeric comparison, or a typed-array index or element
        // observes only its integer value (bitwise operations erase -0 and NaN;
        // integer slots receive only proven 32-bit integers; comparisons and
        // element accesses read int64 storage exactly, see intOperand,
        // floatLoad and arrayIndex). Such a result may be held as an int64
        // when its producer is exact: see the integer slot load, bitwise,
        // constant and +/- cases.
        let resultBound = 1;
        for (const block of fn.blocks)
          if (block !== undefined) resultBound += block.instructions.length;
        // Value indexes are interned instruction results, so this bounds them.
        let integerUses: Uint8Array = new Uint8Array(resultBound);
        // Number slots proven never to hold -0 (every write a proven 32-bit
        // integer), before the weighting below drops slots to doubles.
        const nonNegativeZeroSlots = integerSlots.slice();
        const comparisonOperators = [
          "===",
          "!==",
          "==",
          "!=",
          "<",
          ">",
          "<=",
          ">=",
        ];
        /** Results whose zero sign an accepted integer use still observes:
         * optional payloads, Float64Array element values and the operands
         * of +, - and * results that may be -0 and are so observed. Such
         * results are recorded in zeroSignResults. */
        function findZeroSignResults(): Uint8Array {
          const signs = new Uint8Array(resultBound),
            results = new Uint8Array(resultBound),
            // Arrays proven integer-typed (their elements store no -0).
            integerArrays = new Uint8Array(resultBound),
            // Results never -0 (for optionals: never a present -0), and
            // positive constants.
            signless = new Uint8Array(resultBound),
            positive = new Uint8Array(resultBound);
          for (const block of fn.blocks) {
            if (block === undefined) throw "zero sign block invariant";
            for (const op of block.instructions) {
              if (op === undefined) throw "zero sign instruction invariant";
              const result = instructionResult(op);
              if (result === undefined) continue;
              const index = valueIds.intern(result),
                slotType = op.kind === "load" ? fn.slots[op.slot] : undefined;
              if (
                slotType === "Uint8Array" ||
                slotType === "Uint16Array" ||
                slotType === "Uint32Array" ||
                (op.kind === "array-new" && op.type !== "Float64Array") ||
                (op.kind === "array-subarray" &&
                  integerArrays[valueIds.intern(op.array)] === 1)
              )
                integerArrays[index] = 1;
              const literal = op.kind === "constant" ? op.value : undefined;
              if (typeof literal === "number") {
                if (literal !== 0 || 1 / literal > 0) signless[index] = 1;
                if (literal > 0) positive[index] = 1;
              } else if (
                (op.kind === "load" && nonNegativeZeroSlots[op.slot] === 1) ||
                op.kind === "array-length" ||
                op.kind === "string-length" ||
                op.kind === "string-code-unit" ||
                (op.kind === "unary" &&
                  (op.operator === "~" ||
                    op.operator === "uint32" ||
                    op.operator === "boolean-number")) ||
                (op.kind === "binary" &&
                  ["&", "|", "^", "<<", ">>", ">>>", "imul"].includes(
                    op.operator,
                  )) ||
                ((op.kind === "array-read" || op.kind === "array-element") &&
                  integerArrays[valueIds.intern(op.array)] === 1) ||
                ((op.kind === "optional-wrap" ||
                  op.kind === "optional-value") &&
                  signless[valueIds.intern(op.value)] === 1) ||
                (op.kind === "optional-value-or" &&
                  signless[valueIds.intern(op.value)] === 1 &&
                  signless[valueIds.intern(op.fallback)] === 1)
              )
                signless[index] = 1;
              else if (op.kind === "binary") {
                const left = valueIds.intern(op.left),
                  right = valueIds.intern(op.right);
                // -0 + -0 and -0 - (+0) are the only -0 sums; a zero
                // product takes the sign of the factors.
                if (
                  (op.operator === "+" &&
                    (signless[left] === 1 || signless[right] === 1)) ||
                  (op.operator === "-" && signless[left] === 1) ||
                  (op.operator === "*" &&
                    ((positive[left] === 1 && signless[right] === 1) ||
                      (positive[right] === 1 && signless[left] === 1)))
                )
                  signless[index] = 1;
              }
            }
            for (let i = block.instructions.length - 1; i >= 0; i--) {
              const op = block.instructions[i];
              if (op === undefined) throw "zero sign instruction invariant";
              if (op.kind === "optional-wrap")
                signs[valueIds.intern(op.value)] = 1;
              else if (
                (op.kind === "array-write" || op.kind === "array-store") &&
                integerArrays[valueIds.intern(op.array)] !== 1
              )
                signs[valueIds.intern(op.value)] = 1;
              else if (
                op.kind === "binary" &&
                (op.operator === "+" ||
                  op.operator === "-" ||
                  op.operator === "*")
              ) {
                const index = valueIds.intern(op.id);
                if (signs[index] === 1 && signless[index] !== 1) {
                  results[index] = 1;
                  signs[valueIds.intern(op.left)] = 1;
                  signs[valueIds.intern(op.right)] = 1;
                }
              }
            }
          }
          return results;
        }
        function findIntegerUses(): Uint8Array {
          const uses = new Uint8Array(resultBound),
            rejected = new Uint8Array(resultBound);
          for (const block of fn.blocks) {
            if (block === undefined) throw "integer use block invariant";
            visitTerminatorOperands(block.terminator, (id) => {
              rejected[valueIds.intern(id)] = 1;
            });
            for (let i = block.instructions.length - 1; i >= 0; i--) {
              const op = block.instructions[i];
              if (op === undefined) throw "integer use instruction invariant";
              const result = instructionResult(op);
              if (result !== undefined) {
                const index = valueIds.intern(result);
                if (rejected[index] !== 1) uses[index] = 1;
              }
              const accepts =
                (op.kind === "store" && integerSlots[op.slot] === 1) ||
                (op.kind === "unary" && op.operator === "~") ||
                (op.kind === "binary" &&
                  (["&", "|", "^", "<<", ">>", ">>>", "imul"].includes(
                    op.operator,
                  ) ||
                    ((op.operator === "+" ||
                      op.operator === "-" ||
                      op.operator === "*") &&
                      uses[valueIds.intern(op.id)] === 1) ||
                    comparisonOperators.includes(op.operator))) ||
                op.kind === "array-read" ||
                op.kind === "array-element" ||
                op.kind === "array-valid" ||
                op.kind === "array-write" ||
                op.kind === "array-store" ||
                op.kind === "reference-vector-read" ||
                op.kind === "reference-vector-write" ||
                // Inline code units index with an int64 (the helper path
                // converts with floatLoad).
                op.kind === "string-code-unit" ||
                // Slice bounds load through floatLoad, and optional
                // payloads are converted when wrapped.
                op.kind === "string-slice" ||
                op.kind === "optional-wrap" ||
                // C integer arguments convert from an int64 directly
                // (numberToInteger); C double arguments through floatLoad.
                op.kind === "c-call" ||
                // Inline list reads and writes index with an int64; their
                // fallback calls convert the argument (floatLoad).
                (op.kind === "call" &&
                  op.environment === undefined &&
                  (listReadShapes(op.target) !== undefined ||
                    (op.id === undefined &&
                      writeShapes[op.target] !== undefined)));
              if (!accepts)
                visitInstructionOperands(op, (id) => {
                  rejected[valueIds.intern(id)] = 1;
                });
            }
          }
          return uses;
        }
        // Keep integer slots whose loads used as integers outweigh those
        // used as doubles (weighted by loop depth, 4 per level); the others
        // convert at the load (see the load case). Dropping a slot can reject
        // the uses of values stored to it, so iterate to a fixpoint.
        // +, - and * results that may be -0 where the sign is observed. Int64
        // arithmetic turns -0 into +0, so these keep double arithmetic (see
        // the +/-/* case).
        const zeroSignResults = findZeroSignResults();
        let anyIntegerSlot = false;
        for (let slot = 0; slot < fn.slots.length; slot++)
          if (integerSlots[slot] === 1) anyIntegerSlot = true;
        const slotLoadDepth = new Uint8Array(
          anyIntegerSlot ? fn.blocks.length : 0,
        );
        if (!depthForestKnown) {
          cachedDepthForest = anyIntegerSlot
            ? naturalLoops(fn, work(1000000))
            : undefined;
          depthForestKnown = true;
        }
        const depthForest = cachedDepthForest;
        if (depthForest !== undefined)
          for (const loop of depthForest.loops) {
            if (loop === undefined) throw "integer slot loop invariant";
            for (const body of loop.body) {
              if (body === undefined) throw "integer slot body invariant";
              if (body < slotLoadDepth.length)
                slotLoadDepth[body] = Math.min(
                  (slotLoadDepth[body] ?? 0) + 1,
                  6,
                );
            }
          }
        const integerLoadWeights = new Float64Array(fn.slots.length),
          floatLoadWeights = new Float64Array(fn.slots.length);
        for (let changed = true; changed;) {
          changed = false;
          integerUses = findIntegerUses();
          integerLoadWeights.fill(0);
          floatLoadWeights.fill(0);
          for (const block of fn.blocks) {
            if (block === undefined) throw "integer slot block invariant";
            const weight =
              [1, 4, 16, 64, 256, 1024, 4096][slotLoadDepth[block.id] ?? 0] ??
              4096;
            for (const op of block.instructions)
              if (
                op !== undefined &&
                op.kind === "load" &&
                integerSlots[op.slot] === 1
              ) {
                if (integerUses[valueIds.intern(op.id)] === 1)
                  integerLoadWeights[op.slot] =
                    (integerLoadWeights[op.slot] ?? 0) + weight;
                else
                  floatLoadWeights[op.slot] =
                    (floatLoadWeights[op.slot] ?? 0) + weight;
              }
          }
          for (let slot = 0; slot < fn.slots.length; slot++)
            if (
              integerSlots[slot] === 1 &&
              (floatLoadWeights[slot] ?? 0) > (integerLoadWeights[slot] ?? 0)
            ) {
              integerSlots[slot] = 0;
              changed = true;
            }
        }
        // Numeric constants used only as shift amounts fold into immediate
        // shifts, and undefined values used only as an operand of an optional
        // equality fold into a presence test; neither is materialized.
        // String literal values by result ID, for inline comparisons.
        const stringLiterals = new Map<number, string>();
        for (const block of fn.blocks) {
          if (block === undefined) throw "string literal block invariant";
          for (const op of block.instructions)
            if (op !== undefined && op.kind === "string-literal")
              stringLiterals.set(op.id, op.value);
        }
        const foldedConstants = new Uint8Array(resultBound),
          undefinedValues = new Uint8Array(resultBound),
          // reference-none and string-none: one zero word. Used only as an
          // equality operand, they fold into a test of the other side.
          noneValues = new Uint8Array(resultBound),
          // `typedArray[i] ?? 0`: an out-of-range read already yields an
          // all-zero element word, so a read whose only use is an
          // optional-value-or with fallback +0 writes that result directly
          // (fusedReads maps the read to the result ID + 1) and neither the
          // presence word nor the selection is emitted.
          fusedReads = new Uint32Array(resultBound),
          fusedDefaults = new Uint8Array(resultBound),
          fusedArrays = new Map<number, number>(),
          // Constant fallbacks of fused reads (kind 2), by read ID.
          fusedFallbacks = new Map<number, number>(),
          // `(x >>> n) | (x << (32 - n))` with single-use shifts: the `|`
          // emits one ROR (rotateAmounts holds n + 1) and the shifts none.
          rotateAmounts = new Uint8Array(resultBound),
          rotateSources = new Uint32Array(resultBound),
          rotatedShifts = new Uint8Array(resultBound);
        /** The typed array a fused read (by its result ID) indexed. */
        function arrayOf(read: number): number {
          const array = fusedArrays.get(read);
          if (array === undefined) throw "fused read array invariant";
          return array;
        }
        {
          const literalValues = new Uint8Array(resultBound);
          for (const [literal] of stringLiterals)
            literalValues[valueIds.intern(literal)] = 1;
          const numericConstants = new Uint8Array(resultBound),
            uses = new Uint32Array(resultBound),
            folded = new Uint32Array(resultBound);
          for (const block of fn.blocks) {
            if (block === undefined) throw "constant use block invariant";
            visitTerminatorOperands(block.terminator, (id) => {
              const index = valueIds.intern(id);
              uses[index] = (uses[index] ?? 0) + 1;
            });
            // Exact uint32 constants defined earlier in this block: memory
            // host operations take them as immediates (wordKinds 3, set as
            // each constant is emitted) and never read their frame words.
            const wordImmediates = new Set<number>();
            for (const op of block.instructions) {
              if (op === undefined) throw "constant use instruction invariant";
              if (op.kind === "constant") {
                const constant = op.value;
                if (typeof constant === "number") {
                  numericConstants[valueIds.intern(op.id)] = 1;
                  if (constant >>> 0 === constant) wordImmediates.add(op.id);
                }
              }
              if (op.kind === "host-call" && rawWordOperation(op.operation))
                for (const argument of op.arguments)
                  if (argument !== undefined && wordImmediates.has(argument)) {
                    const index = valueIds.intern(argument);
                    folded[index] = (folded[index] ?? 0) + 1;
                  }
              if (op.kind === "undefined")
                undefinedValues[valueIds.intern(op.id)] = 1;
              if (op.kind === "reference-none" || op.kind === "string-none")
                noneValues[valueIds.intern(op.id)] = 1;
              visitInstructionOperands(op, (id) => {
                const index = valueIds.intern(id);
                uses[index] = (uses[index] ?? 0) + 1;
              });
              if (
                op.kind === "binary" &&
                (op.operator === "<<" ||
                  op.operator === ">>" ||
                  op.operator === ">>>")
              ) {
                const index = valueIds.intern(op.right);
                if (numericConstants[index] === 1)
                  folded[index] = (folded[index] ?? 0) + 1;
              }
              // A short literal compared inline is read as an immediate
              // (see the string equality case: the right literal if any).
              if (
                op.kind === "binary" &&
                ["===", "!==", "==", "!="].includes(op.operator)
              ) {
                const chosen = stringLiterals.has(op.right)
                  ? op.right
                  : stringLiterals.has(op.left)
                    ? op.left
                    : -1;
                const text =
                  chosen < 0 ? undefined : stringLiterals.get(chosen);
                if (text !== undefined && text.length <= 8) {
                  const index = valueIds.intern(chosen);
                  folded[index] = (folded[index] ?? 0) + 1;
                }
              }
              if (
                op.kind === "binary" &&
                ["===", "!==", "==", "!="].includes(op.operator)
              )
                for (let side = 0; side < 2; side++) {
                  const index = valueIds.intern(
                    side === 0 ? op.left : op.right,
                  );
                  if (undefinedValues[index] === 1 || noneValues[index] === 1)
                    folded[index] = (folded[index] ?? 0) + 1;
                }
            }
          }
          const positiveZero = new Uint8Array(resultBound),
            constantValues = new Map<number, number>();
          for (const block of fn.blocks) {
            if (block === undefined) throw "rotate block invariant";
            const shifts = new Map<number, IRInstruction>();
            for (const op of block.instructions) {
              if (op === undefined) throw "rotate instruction invariant";
              if (op.kind === "constant") {
                const constant = op.value;
                if (typeof constant === "number")
                  constantValues.set(op.id, constant);
              }
              if (
                op.kind === "binary" &&
                (op.operator === ">>>" || op.operator === "<<")
              )
                shifts.set(op.id, op);
              if (op.kind !== "binary" || op.operator !== "|") continue;
              const left = shifts.get(op.left),
                right = shifts.get(op.right);
              if (
                left === undefined ||
                right === undefined ||
                left.kind !== "binary" ||
                right.kind !== "binary" ||
                left.left !== right.left ||
                left.operator === right.operator ||
                uses[valueIds.intern(left.id)] !== 1 ||
                uses[valueIds.intern(right.id)] !== 1
              )
                continue;
              const unsigned = left.operator === ">>>" ? left : right,
                shifted = left.operator === ">>>" ? right : left,
                down = constantValues.get(unsigned.right),
                up = constantValues.get(shifted.right);
              if (
                down === undefined ||
                up === undefined ||
                !Number.isInteger(down) ||
                !Number.isInteger(up) ||
                ((down % 32) + 32 + (up % 32)) % 32 !== 0
              )
                continue;
              rotateAmounts[valueIds.intern(op.id)] =
                (((down % 32) + 32) % 32) + 1;
              rotateSources[valueIds.intern(op.id)] = unsigned.left;
              rotatedShifts[valueIds.intern(left.id)] = 1;
              rotatedShifts[valueIds.intern(right.id)] = 1;
            }
          }
          for (const block of fn.blocks) {
            if (block === undefined) throw "fused read block invariant";
            const reads = new Map<number, number>();
            for (const op of block.instructions) {
              if (op === undefined) throw "fused read instruction invariant";
              if (
                op.kind === "constant" &&
                op.value === 0 &&
                typeof op.value === "number" &&
                1 / op.value > 0
              )
                positiveZero[valueIds.intern(op.id)] = 1;
              if (op.kind === "array-read") reads.set(op.id, op.array);
              const fallbackConstant =
                op.kind === "optional-value-or"
                  ? constantValues.get(op.fallback)
                  : undefined;
              if (
                op.kind === "optional-value-or" &&
                reads.has(op.value) &&
                uses[valueIds.intern(op.value)] === 1 &&
                fallbackConstant !== undefined
              ) {
                // 1: `?? +0` (an absent read's element word is zero);
                // 2: another numeric constant, selected at the read.
                const zero = positiveZero[valueIds.intern(op.fallback)] === 1;
                fusedReads[valueIds.intern(op.value)] = op.id + 1;
                fusedArrays.set(op.value, reads.get(op.value) ?? 0);
                fusedDefaults[valueIds.intern(op.id)] = zero ? 1 : 2;
                if (!zero) fusedFallbacks.set(op.value, fallbackConstant);
                const fallback = valueIds.intern(op.fallback);
                folded[fallback] = (folded[fallback] ?? 0) + 1;
              }
            }
          }
          for (let index = 0; index < resultBound; index++)
            if (
              (numericConstants[index] === 1 ||
                undefinedValues[index] === 1 ||
                noneValues[index] === 1 ||
                literalValues[index] === 1) &&
              (folded[index] ?? 0) > 0 &&
              (uses[index] ?? 0) === (folded[index] ?? 0)
            )
              foldedConstants[index] = 1;
        }
        const leafRegisters =
          !hasRoots &&
          noSafepoints !== undefined &&
          noSafepoints[fn.id] === 1 &&
          canUseLeafRegisters(fn);
        // Slot register homes are chosen after frame sharing (below).
        let homes: SlotHomes | undefined;
        /** Safepoints: operations during which the collector may run. */
        // May-callback calls (docs/native-ffi.md, "Callbacks"): C frames
        // between this frame and a callback may save x19..x28 anywhere, so
        // the frame keeps no reference in a register across them and saves
        // all of x19..x28 for its callers' register-held references.
        let callsBack = false;
        for (const block of fn.blocks)
          for (const op of block?.instructions ?? [])
            if (op?.kind === "c-call" && op.call.mayCallback === true)
              callsBack = true;
        function mayCollect(op: IRInstruction): boolean {
          return op.kind === "call"
            ? closedRoots === undefined ||
                noSafepoints === undefined ||
                noSafepoints[op.target] !== 1
            : op.kind === "call-indirect" ||
                (irInstructionEffects(op) & irEffectAllocate) !== 0;
        }
        /** Slot register homes: d8..d15 for numbers, x22..x28 for integers,
         * booleans and references. */
        function slotRegister(slot: number): number {
          return homes === undefined ? 0 : (homes.registers[slot] ?? 0);
        }
        functionId = fn.id;
        // Debug variables and inline scopes; never changes emitted code.
        const tracker = debugSpans ? createDebugTracker(fn) : undefined;
        trapSites = [];
        // Calls that may reach a collection, by return offset: each gets a
        // stack map of the frame words live while it runs (see stack-maps.ts).
        const callSites: { offset: number; block: number; index: number }[] =
          [];
        // Frame words outside slots and temporaries that a safepoint's map
        // must list (a may-callback call's callback function values).
        const siteReferences = new Map<number, readonly number[]>();
        let siteIndex = 0;
        function safepoint(): void {
          const block = blockId;
          if (block === undefined) throw "safepoint block invariant";
          callSites.push({
            offset: instructions.length * 4,
            block,
            index: siteIndex,
          });
        }
        forwardSites = [];
        const forwardable = forwardableEntries(fn),
          functionFixups = fixups.length;
        edgeWords.clear();
        edgeBranches.clear();
        seededEntries.clear();
        veneerFixups.clear();
        // Blocks whose labels share one address (`labelRunAt`): every block
        // but the last emitted no code (fused dispatch blocks never do), so
        // their entry edges fall through to the next block's start. Blocks
        // in a seeded start's run are `accountedLabels`.
        let labelRunAt = -1,
          labelRunFused = false,
          labelRun: number[] = [];
        const accountedLabels = new Set<number>();
        function joinLabelRun(block: number, fused: boolean): void {
          if (labelRunAt !== instructions.length) {
            labelRunAt = instructions.length;
            labelRunFused = false;
            labelRun = [];
          }
          labelRun.push(block);
          if (fused) labelRunFused = true;
        }
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
            if (op.kind === "host-call" && op.operation === "processor-count") {
              const processors = host().processors;
              // The affinity mask is filled in the outgoing area: whole
              // 16-byte units, within one add-immediate.
              if (
                processors.kind === "affinity" &&
                (!Number.isInteger(processors.maskBytes) ||
                  processors.maskBytes < 16 ||
                  processors.maskBytes > 4080 ||
                  processors.maskBytes % 16 !== 0)
              )
                fail("UNSUPPORTED", "invalid processor mask size");
              if (processors.kind === "affinity")
                outgoingBytes = Math.max(outgoingBytes, processors.maskBytes);
            }
            if (op.kind === "call" || op.kind === "call-indirect") {
              const s = signatures[op.target];
              if (s === undefined) throw "callee signature invariant";
              outgoingBytes = Math.max(outgoingBytes, s.stackBytes);
            }
            if (op.kind === "c-call")
              outgoingBytes = Math.max(
                outgoingBytes,
                foreignPlan(op.call).frameBytes,
              );
          }
        }
        const resultOffset = outgoingBytes,
          contextOffset = resultOffset + 32,
          resultPointerOffset = contextOffset + 8,
          borrowedEnvironmentOffset = resultPointerOffset + 8,
          allocationOffset =
            borrowedEnvironmentOffset + (fn.environment === undefined ? 0 : 8),
          // Frame words owned by the function start here: the collector finds
          // the live ones through per-safepoint stack maps (no frame header).
          localsBase =
            allocationOffset +
            (fn.blocks.some((b) =>
              b.instructions.some(
                (op) =>
                  op.kind === "string-from-code-units" ||
                  op.kind === "string-concat" ||
                  op.kind === "string-slice" ||
                  op.kind === "string-allocate" ||
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
              : localsBase,
          localsOffset =
            localsBase + (fn.closureEnvironment === undefined ? 0 : 8);
        let cursor = localsOffset;
        const slotOffsets: number[] = [];
        // Frames share offsets between same-typed slots whose live ranges
        // never meet: fewer words to zero at entry (every root word is
        // cleared before the first safepoint) and offsets that stay within
        // the scaled-immediate range. Only tiny frames skip the analysis.
        let slotBytes = 0;
        for (const type of fn.slots) {
          if (type === undefined) throw "slot type invariant";
          slotBytes += scalarByteLength(type);
        }
        const privateSlots = new Uint8Array(fn.slots.length);
        if (fn.receiverSlot !== undefined) privateSlots[fn.receiverSlot] = 1;
        for (const parameter of fn.parameters) {
          if (parameter === undefined) throw "parameter slot invariant";
          privateSlots[parameter] = 1;
        }
        for (const block of fn.blocks) {
          if (block === undefined) throw "block invariant";
          const handler = block.exception;
          if (handler !== undefined) privateSlots[handler.slot] = 1;
        }
        if (!sharingKnown) {
          cachedSharing =
            slotBytes > 64 && !leafRegisters
              ? shareFrameSlots(
                  fn,
                  (slot) => privateSlots[slot] !== 1,
                  work(40000000),
                  // Integer slots hold int64, other numbers doubles: their
                  // groups take different register classes.
                  (slot) =>
                    integerSlots[slot] === 1
                      ? "integer"
                      : (fn.slots[slot] ?? ""),
                )
              : undefined;
          sharingKnown = true;
        }
        const sharing = cachedSharing;
        if (!homesKnown) {
          cachedHomes = leafRegisters
            ? undefined
            : limited<SlotHomes>(
                "slot-homes",
                fn,
                slotHomes(
                  fn,
                  integerSlots,
                  sharing === undefined ? undefined : sharing.color,
                  [28, 27, 26, 25, 24, 23, 22],
                  {
                    // Single-word managed references; the collector sees them
                    // through their frame words, refreshed around safepoints.
                    eligible: (slot: number): boolean => {
                      const type = fn.slots[slot];
                      return (
                        !callsBack &&
                        type !== undefined &&
                        managed(type) &&
                        scalarByteLength(type) === 8
                      );
                    },
                    collects: mayCollect,
                  },
                  work(2000000),
                ),
              );
          // Homes planned without interference: one register per group.
          if (
            cachedHomes !== undefined &&
            !cachedHomes.shared &&
            analysisLimit !== undefined
          )
            analysisLimit("slot-home-sharing", fn);
          homesKnown = true;
        }
        homes = cachedHomes;
        /** Register-homed reference slots live while an instruction that
         * may collect runs: its stack map lists their registers. */
        function registerRoots(
          block: number,
          index: number,
        ): readonly number[] | undefined {
          return homes === undefined
            ? undefined
            : homes.registerRoots[block]?.[index];
        }
        const preservedCount = homes === undefined ? 0 : homes.floatCount;
        const groupOffsets: number[] = [];
        for (let slot = 0; slot < fn.slots.length; slot++) {
          const type = fn.slots[slot];
          if (type === undefined) throw "slot type invariant";
          const group =
            sharing === undefined ? -1 : (sharing.color[slot] ?? 0) - 1;
          if (group < 0) {
            slotOffsets.push(cursor);
            cursor += scalarByteLength(type);
            continue;
          }
          let offset = groupOffsets[group];
          if (offset === undefined) {
            offset = cursor;
            groupOffsets[group] = offset;
            cursor += scalarByteLength(type);
          }
          slotOffsets.push(offset);
        }
        function slotOffset(slot: number): number {
          const offset = slotOffsets[slot];
          if (offset === undefined) throw "slot layout invariant";
          return offset;
        }
        function value(id: number): Value {
          const v = values[valueIds.intern(id)];
          if (v === undefined) throw "verified value invariant";
          return v;
        }
        const valuesOffset = cursor;
        if (homes !== undefined) {
          const storage = new Uint8Array(Math.ceil(valuesOffset / 8));
          for (let slot = 0; slot < fn.slots.length; slot++)
            storage[slotOffset(slot) / 8] = slotRegister(slot);
          scalarRegisters = storage;
        }
        let maximumCursor = cursor;
        // Loads whose slot word can serve as their home (see slot-aliases.ts).
        const slotAliases =
          options.aliasSlotLoads === false
            ? undefined
            : aliasedSlotLoads(fn, work(1000000));
        // A load aliasing a register-homed reference slot keeps the reference
        // in that register, which is refreshed after a safepoint only while
        // the slot itself is live: such a load needs its own home unless no
        // safepoint falls within its lifetime (values are block-local).
        if (slotAliases !== undefined && homes !== undefined)
          for (const block of fn.blocks) {
            if (block === undefined) throw "alias block invariant";
            const instructions = block.instructions,
              term = block.terminator;
            for (let index = 0; index < instructions.length; index++) {
              const op = instructions[index];
              if (op === undefined) throw "alias instruction invariant";
              if (op.kind !== "load" || slotAliases[op.id] !== 1) continue;
              const type = fn.slots[op.slot];
              if (
                slotRegister(op.slot) < 32 ||
                type === undefined ||
                !managed(type)
              )
                continue;
              const loaded = op.id;
              let collected = false,
                pending = false;
              for (
                let later = index + 1;
                later < instructions.length;
                later++
              ) {
                const next = instructions[later];
                if (next === undefined) throw "alias instruction invariant";
                let used = false;
                visitInstructionOperands(next, (id) => {
                  if (id === loaded) used = true;
                });
                // Calls read their arguments before collecting; other
                // operations read theirs after allocating.
                const collects =
                  next.kind === "call"
                    ? closedRoots === undefined ||
                      noSafepoints === undefined ||
                      noSafepoints[next.target] !== 1
                    : next.kind === "call-indirect" ||
                      (irInstructionEffects(next) & irEffectAllocate) !== 0;
                const call =
                  next.kind === "call" || next.kind === "call-indirect";
                if (used && (collected || (collects && !call))) pending = true;
                if (collects) collected = true;
              }
              let terminatorUse = false;
              visitTerminatorOperands(term, (id) => {
                if (id === loaded) terminatorUse = true;
              });
              if (
                pending ||
                (terminatorUse &&
                  (collected ||
                    (term.kind !== "branch" &&
                      term.kind !== "return" &&
                      term.kind !== "record")))
              )
                slotAliases[op.id] = 0;
            }
          }
        // A double-valued load of an integer slot converts its int64 word.
        if (slotAliases !== undefined)
          for (const block of fn.blocks) {
            if (block === undefined) throw "alias block invariant";
            for (const op of block.instructions) {
              if (op === undefined) throw "alias instruction invariant";
              if (
                op.kind === "load" &&
                integerSlots[op.slot] === 1 &&
                integerUses[valueIds.intern(op.id)] !== 1
              )
                slotAliases[op.id] = 0;
            }
          }
        function aliasedLoad(id: number): boolean {
          return slotAliases !== undefined && slotAliases[id] === 1;
        }
        // Leaf functions map each frame word to one register for the whole
        // function (see leafStorageRegisters), so values whose block-local
        // lifetimes are disjoint share words: a word is free after its
        // value's last use (operands after their instruction, so a result
        // never overwrites one). Words are reused within one size and class
        // (integer or boolean, managed reference, other) only.
        const shareValueWords = leafRegisters && !hasRoots,
          leafWords = shareValueWords
            ? wordOnlyValues(fn, work(1000000))
            : undefined;
        for (const b of fn.blocks) {
          if (b === undefined) throw "block invariant";
          if (!hasRoots) cursor = valuesOffset;
          // By interned value index: last use + 1 (0: unused) and the free
          // list key of a value holding a shareable word.
          const lastUse: number[] = [],
            freeWords = new Map<string, number[]>(),
            wordKeys: (string | undefined)[] = [];
          if (shareValueWords) {
            for (let index = 0; index < b.instructions.length; index++) {
              const op = b.instructions[index];
              if (op === undefined) throw "instruction invariant";
              visitInstructionOperands(op, (id) => {
                lastUse[valueIds.intern(id)] = index + 1;
              });
            }
            visitTerminatorOperands(b.terminator, (id) => {
              lastUse[valueIds.intern(id)] = b.instructions.length + 1;
            });
          }
          const releaseWord = (id: number): void => {
            const index = valueIds.intern(id),
              key = wordKeys[index],
              storage = values[index];
            if (key === undefined || storage === undefined) return;
            wordKeys[index] = undefined;
            const list = freeWords.get(key);
            if (list === undefined) freeWords.set(key, [storage.offset]);
            else list.push(storage.offset);
          };
          for (
            let operationIndex = 0;
            operationIndex < b.instructions.length;
            operationIndex++
          ) {
            const op = b.instructions[operationIndex];
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
              case "string-allocate":
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
              case "c-call":
              case "c-memory": {
                const types =
                  op.kind === "c-call"
                    ? foreignCallTypes(op.call)
                    : foreignMemoryTypes(op.access);
                if (!types.ok) throw "verified c-call invariant";
                const resultType = types.value.result;
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
              case "string-reference":
              case "function-environment":
                id = op.id;
                type = "optional-reference";
                break;
              case "reference-string":
                id = op.id;
                type = "optional-string";
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
              case "general-is":
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
              case "optional-value-or":
                id = op.id;
                type = "number";
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
              case "array-element":
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
                type = [
                  "===",
                  "!==",
                  "==",
                  "!=",
                  "<",
                  ">",
                  "<=",
                  ">=",
                ].includes(op.operator)
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
              if (op.kind === "load" && aliasedLoad(id))
                values[valueIds.intern(id)] = {
                  offset: slotOffset(op.slot),
                  type,
                };
              else if (shareValueWords) {
                const key =
                  String(scalarByteLength(type)) +
                  (type === "boolean" ||
                  (type === "number" &&
                    (integerUses[valueIds.intern(id)] === 1 ||
                      (leafWords !== undefined && leafWords[id] === 1)))
                    ? ":integer"
                    : managed(type) && type !== "primitive"
                      ? ":reference"
                      : ":" + type);
                const reused = freeWords.get(key)?.pop();
                if (reused !== undefined)
                  values[valueIds.intern(id)] = { offset: reused, type };
                else {
                  values[valueIds.intern(id)] = { offset: cursor, type };
                  cursor += scalarByteLength(type);
                }
                wordKeys[valueIds.intern(id)] = key;
              } else {
                values[valueIds.intern(id)] = { offset: cursor, type };
                cursor += scalarByteLength(type);
              }
            }
            if (shareValueWords) {
              const position = operationIndex + 1;
              visitInstructionOperands(op, (operand) => {
                if (lastUse[valueIds.intern(operand)] === position)
                  releaseWord(operand);
              });
              const defined: number = id ?? -1;
              if (
                defined >= 0 &&
                (lastUse[valueIds.intern(defined)] ?? 0) === 0
              )
                releaseWord(defined);
            }
          }
          maximumCursor = Math.max(maximumCursor, cursor);
        }
        let transientRegisters: Uint8Array | undefined;
        if (!leafRegisters && maximumCursor <= 8000000) {
          // Candidates are indexed by raw value ID, which may be sparse.
          let maximumId = 0;
          for (const block of fn.blocks) {
            if (block === undefined) throw "temporary block invariant";
            for (const op of block.instructions) {
              if (op === undefined) throw "temporary instruction invariant";
              const id = instructionResult(op);
              if (id !== undefined && id > maximumId) maximumId = id;
            }
          }
          const candidates = new Uint8Array(maximumId + 1);
          for (const block of fn.blocks) {
            if (block === undefined) throw "temporary block invariant";
            for (const op of block.instructions) {
              if (op === undefined) throw "temporary instruction invariant";
              const id = instructionResult(op);
              if (
                id !== undefined &&
                id < candidates.length &&
                !aliasedLoad(id)
              ) {
                const type = value(id).type;
                // Booleans and numbers whose every use wants an integer live
                // in GP homes (x19..x28): no bank moves at their uses.
                if (
                  type === "boolean" ||
                  (type === "number" &&
                    integerUses[valueIds.intern(id)] === 1 &&
                    !floatWords.has(id))
                )
                  candidates[id] = 3;
                // NaN-boxed optional numbers are single FP words too.
                else if (type === "number" || type === "optional-number")
                  candidates[id] = 1;
                else if (managed(type) && type !== "primitive" && !callsBack)
                  candidates[id] = 2;
              }
            }
          }
          transientRegisters = temporaryRegisters(
            fn,
            candidates,
            work(1000000),
            10 - (homes === undefined ? 0 : homes.saved.length),
            closedRoots === undefined
              ? undefined
              : (op: IRInstruction): boolean =>
                  op.kind === "call"
                    ? noSafepoints === undefined ||
                      noSafepoints[op.target] !== 1
                    : op.kind === "call-indirect" ||
                      (irInstructionEffects(op) & irEffectAllocate) !== 0,
          );
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
              if (op === undefined)
                throw "temporary class instruction invariant";
              const id = instructionResult(op);
              if (id !== undefined && id < classes.length && !aliasedLoad(id)) {
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
          const temporaryPlan = planTemporarySlots(fn, classes, work(1000000));
          let referenceCount = 0,
            generalCount = 0,
            registerReferenceCount = 0;
          // Pseudo-home index per register home, x4 (36) through x28 (60):
          // references may also live in callee-saved word registers.
          const referenceHomes = new Uint8Array(25);
          const referenceCounts: number[] = [],
            generalCounts: number[] = [];
          for (const block of fn.blocks) {
            if (block === undefined) throw "block invariant";
            let references = 0,
              generals = 0;
            for (const op of block.instructions) {
              if (op === undefined) throw "instruction invariant";
              const id = instructionResult(op);
              if (id === undefined || aliasedLoad(id)) continue;
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
            if (term.kind === "jump")
              incoming(term.target, references, generals);
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
              // Aliased loads keep their slot word as home.
              if (id === undefined || aliasedLoad(id)) continue;
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
          // Shared slot offsets are one root each.
          const rooted = new Set<number>();
          for (let slot = 0; slot < fn.slots.length; slot++) {
            const type = fn.slots[slot];
            if (type === undefined) throw "slot invariant";
            const offset = slotOffset(slot);
            if (rooted.has(offset)) continue;
            rooted.add(offset);
            if (managed(type)) rootSlots.push(offset);
            if (type === "general") generalSlots.push(offset);
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
        // Precise stack maps: each safepoint lists only the root words live
        // across it (slot liveness here, block-local temporaries by their
        // uses), so no root word needs entry zeroing or clearing for the
        // collector: only slots that may be read before any store are zeroed,
        // as the program itself observes them. When the liveness budget runs
        // out, every root word is listed at each collecting call and kept
        // valid as before (entry zeroing, dead-slot and pool clears).
        if (!safepointLivenessKnown) {
          const tracked: number[] = [];
          for (let slot = 0; slot < fn.slots.length; slot++) {
            const type = fn.slots[slot];
            if (type !== undefined && (managed(type) || type === "general"))
              tracked.push(slot);
          }
          cachedSafepointLiveness =
            hasRoots && options.preciseStackMaps !== false
              ? limited<SlotLiveness>(
                  "safepoint-liveness",
                  fn,
                  analyzeLiveSlotsPrecisely(fn, work(50000000), tracked),
                )
              : undefined;
          safepointLivenessKnown = true;
        }
        const safepointLiveness = cachedSafepointLiveness,
          preciseRoots = safepointLiveness !== undefined;
        let deferredRootBlocks =
          hasRoots &&
          !preciseRoots &&
          closedRoots !== undefined &&
          noSafepoints !== undefined
            ? nonAllocatingBlocks(fn, noSafepoints)
            : undefined;
        if (deferredRootBlocks !== undefined) {
          const candidateBlocks: Uint8Array = deferredRootBlocks;
          const poolWords =
            temporaryRoots.length + temporaryGenerals.length * 2;
          let originalStores = poolWords,
            deferredStores = 0,
            directStores: boolean = true;
          for (const offset of temporaryRoots) {
            if (offset === undefined) throw "root cleanup offset invariant";
            if (offset > 32760) directStores = false;
          }
          for (const offset of temporaryGenerals) {
            if (offset === undefined) throw "general cleanup offset invariant";
            if (offset + 8 > 32760) directStores = false;
          }
          for (const block of fn.blocks) {
            if (block === undefined) throw "root cleanup cost block invariant";
            originalStores +=
              (incomingReferences[block.id] ?? 0) +
              (incomingGenerals[block.id] ?? 0) * 2;
            if (candidateBlocks[block.id] !== 1) deferredStores += poolWords;
          }
          // Each accepted store is one scaled-immediate STR. Never multiply a
          // large initializer's root pool across its allocating CFG blocks, or
          // introduce additional large-offset address materialization.
          if (!directStores || deferredStores > originalStores)
            deferredRootBlocks = undefined;
        }
        const rootClearBlocks = deferredRootBlocks;
        if (transientRegisters !== undefined) {
          const storage = new Uint8Array(Math.ceil(maximumCursor / 8));
          for (let slot = 0; slot < fn.slots.length; slot++)
            storage[slotOffset(slot) / 8] = slotRegister(slot);
          scalarRegisters = storage;
        }
        // Leaf frame words holding only integer slots, booleans and numbers
        // used as integers prefer GP homes (see leafStorageRegisters).
        let integerWords: Uint8Array | undefined;
        if (leafRegisters) {
          // Word-only values hold raw 32-bit words.
          const leafWordStorage = wordOnlyValues(fn, work(1000000));
          const words = new Uint8Array(Math.ceil(maximumCursor / 8)),
            rejected = new Uint8Array(words.length);
          const occupy = (offset: number, integral: boolean): void => {
            const word = offset / 8;
            if (integral && rejected[word] !== 1) words[word] = 1;
            else {
              rejected[word] = 1;
              words[word] = 0;
            }
          };
          for (let slot = 0; slot < fn.slots.length; slot++) {
            const type = fn.slots[slot];
            if (type === undefined) throw "leaf word slot invariant";
            const offset = slotOffset(slot);
            occupy(offset, integerSlots[slot] === 1 || type === "boolean");
            for (let byte = 8; byte < scalarByteLength(type); byte += 8)
              occupy(offset + byte, false);
          }
          for (const block of fn.blocks) {
            if (block === undefined) throw "leaf word block invariant";
            for (const op of block.instructions) {
              if (op === undefined) throw "leaf word instruction invariant";
              const id = instructionResult(op);
              if (id === undefined) continue;
              const storage = value(id);
              occupy(
                storage.offset,
                storage.type === "boolean" ||
                  (storage.type === "number" &&
                    (integerUses[valueIds.intern(id)] === 1 ||
                      (leafWordStorage !== undefined &&
                        leafWordStorage[id] === 1))),
              );
              for (
                let byte = 8;
                byte < scalarByteLength(storage.type);
                byte += 8
              )
                occupy(storage.offset + byte, false);
            }
          }
          integerWords = words;
        }
        const leafStorage = leafRegisters
          ? leafStorageRegisters(
              fn,
              slotOffsets,
              value,
              localsOffset,
              maximumCursor,
              work(1000000),
              signature,
              integerWords,
            )
          : undefined;
        const leafBase =
            leafStorage === undefined ? undefined : leafStorage.registers,
          leafReferences =
            leafStorage === undefined ? undefined : leafStorage.references;
        if (leafBase !== undefined)
          scalarRegisters =
            leafReferences === undefined ? leafBase : new Uint8Array(leafBase);
        // Callee-saved GP homes in use (word temporaries), saved after d8...
        const savedWords: number[] = [];
        const transientHomes = transientRegisters;
        if (transientHomes !== undefined) {
          const used = new Uint8Array(10);
          for (let id = 0; id < transientHomes.length; id++) {
            const home = transientHomes[id] ?? 0;
            if (home >= 51 && home <= 60) used[home - 51] = 1;
          }
          for (let r = 0; r < 10; r++)
            if (used[r] === 1) savedWords.push(19 + r);
        }
        if (homes !== undefined)
          for (const register of homes.saved)
            if (register !== undefined && !savedWords.includes(register))
              savedWords.push(register);
        if (leafStorage !== undefined)
          for (const register of leafStorage.saved)
            if (register !== undefined && !savedWords.includes(register))
              savedWords.push(register);
        // A frame that reads the root head, or calls a binding that does,
        // starts the collector's stack walk: it saves all of x19..x28, in
        // order, so every callee-saved register its callers hold (references
        // among them) is in its save block. A binding's own body is popped
        // before the walk, which starts at its caller's frame.
        const ownRootHead = rootHeadBindings[fn.id] === 1;
        let walkStart = false;
        for (const block of fn.blocks)
          for (const op of block?.instructions ?? [])
            if (
              (op?.kind === "host-call" && op.operation === "root-head") ||
              (op?.kind === "call" && rootHeadBindings[op.target] === 1)
            )
              walkStart = true;
        if ((walkStart && !ownRootHead) || callsBack) {
          savedWords.length = 0;
          for (let register = 19; register <= 28; register++)
            savedWords.push(register);
        }
        const calleeSaveOffset = Math.ceil(maximumCursor / 8) * 8;
        const frameBytes =
          Math.ceil(
            (calleeSaveOffset + (preservedCount + savedWords.length) * 8) / 16,
          ) * 16;
        if (!Number.isSafeInteger(frameBytes) || frameBytes > 0xffffffff)
          fail(
            "FRAME_LIMIT",
            "scalar frame exceeds supported 32-bit byte offsets",
          );
        // Calls into managed code can drive the stack to its limit, and frames
        // this large could step past the guard page. Small leaf frames, inline
        // host operations and bounded OS imports fit in the headroom. C
        // callees get an explicit reserve: a function containing c-calls
        // checks for it with its frame (docs/native-ffi.md).
        const callsC = fn.blocks.some(
          (block) =>
            block !== undefined &&
            block.instructions.some((op) => op.kind === "c-call"),
        );
        const guardsStack =
          frameBytes > 4096 ||
          callsC ||
          fn.blocks.some(
            (block) =>
              block !== undefined &&
              block.instructions.some(
                (op) =>
                  op.kind === "call" ||
                  op.kind === "call-indirect" ||
                  (op.kind === "host-call" &&
                    (op.operation === "executable-call-managed" ||
                      op.operation === "executable-call-value")),
              ),
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
        /** Throw-origin diagnostics: the hosted trace-capture routine takes
         * the thrown payload in x17 and its tag in x16 (read from the result
         * record, which the throw has just written) and preserves every other
         * register; the frame record already saved the link register. */
        function traceThrow(payload: number, tag: number | undefined): void {
          emit({ op: "orr-reg", width: 64, rd: 17, rn: "zr", rm: payload });
          if (tag === undefined) rawLoad(16, resultOffset + 16);
          else
            emit({ op: "movz", width: 64, rd: 16, immediate: tag, shift: 0 });
          startupCalls.push({
            offset: instructions.length * 4,
            target: "trace-capture",
          });
          emit({ op: "bl", displacement: 0 });
        }
        /** d8.. at calleeSaveOffset + 8i, paired while in LDP/STP reach. */
        function calleeSaves(load: boolean): void {
          // Pairs need a signed offset within 504 bytes of their base: a save
          // area beyond that addresses from x16 = SP + calleeSaveOffset (x16
          // is scratch in prologues and epilogues).
          const saved = preservedCount + savedWords.length,
            based =
              saved >= 2 &&
              calleeSaveOffset + saved * 8 > 512 &&
              calleeSaveOffset <= 4095;
          const rn: number | "sp" = based ? 16 : "sp",
            origin = based ? calleeSaveOffset : 0;
          if (based)
            emit({
              op: "add-imm",
              width: 64,
              rd: 16,
              rn: "sp",
              immediate: calleeSaveOffset,
              shift: 0,
              setFlags: false,
            });
          for (let index = 0; index < preservedCount; index++) {
            const offset = calleeSaveOffset + index * 8 - origin,
              rt = 8 + index;
            if (index + 1 < preservedCount && offset + 8 <= 504) {
              emit(
                load
                  ? { op: "ldp-d", rt, rt2: rt + 1, rn, offset }
                  : { op: "stp-d", rt, rt2: rt + 1, rn, offset },
              );
              index++;
            } else
              emit(
                load
                  ? { op: "ldr-d", rt, rn, offset }
                  : { op: "str-d", rt, rn, offset },
              );
          }
          const wordBase = calleeSaveOffset + preservedCount * 8 - origin;
          for (let index = 0; index < savedWords.length; index++) {
            const offset = wordBase + index * 8,
              rt = savedWords[index] ?? 0,
              rt2 = savedWords[index + 1] ?? 0;
            if (index + 1 < savedWords.length && offset + 8 <= 504) {
              emit(
                load
                  ? {
                      op: "ldp",
                      width: 64,
                      rt,
                      rt2,
                      rn,
                      offset,
                      mode: "offset",
                    }
                  : {
                      op: "stp",
                      width: 64,
                      rt,
                      rt2,
                      rn,
                      offset,
                      mode: "offset",
                    },
              );
              index++;
            } else
              emit(
                load
                  ? { op: "ldr", width: 64, rt, rn, offset }
                  : { op: "str", width: 64, rt, rn, offset },
              );
          }
        }
        function epilogue(): void {
          endFrameRange();
          calleeSaves(true);
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
        // Frameless early exit (shrink-wrapping for base cases): when the
        // entry block only tests one parameter (a reference against none, or
        // a number against a constant) and one of its successors returns a
        // constant or a parameter, that path runs before the frame exists,
        // straight from the argument registers. Other paths fall through to
        // the ordinary prologue, which repeats the test.
        /** A return block's value from constants and parameters only. */
        function earlyValue(
          returned: number | undefined,
          local: ReadonlyMap<number, IRInstruction>,
        ): EarlyValue | undefined {
          const none: EarlyValue = { kind: "none" },
            zero: EarlyValue = { kind: "zero" };
          if (returned === undefined)
            return fn.returnType === "void" ? none : undefined;
          const op = local.get(returned);
          if (op === undefined) return undefined;
          if (op.kind === "reference-none") return zero;
          if (op.kind === "constant") {
            const constant = op.value;
            if (typeof constant === "boolean") {
              const one: EarlyValue = { kind: "bits", lo: 1, hi: 0 };
              return constant ? one : zero;
            }
            if (typeof constant !== "number" || fn.returnType !== "number")
              return undefined;
            const bits = encodeFloat64(constant);
            const pattern: EarlyValue = {
              kind: "bits",
              lo: bits.lo,
              hi: bits.hi,
            };
            return bits.lo === 0 && bits.hi === 0 ? zero : pattern;
          }
          if (op.kind !== "load" || signature === undefined) return undefined;
          const index = fn.parameters.indexOf(op.slot),
            location = signature.parameters[index],
            slotType = fn.slots[op.slot];
          if (index < 0 || location === undefined || slotType !== fn.returnType)
            return undefined;
          if (location.kind === "integer" && slotType !== "number") {
            const integer: EarlyValue = {
              kind: "integer",
              register: location.index,
            };
            return integer;
          }
          if (location.kind === "float" && slotType === "number") {
            const float: EarlyValue = {
              kind: "float",
              register: location.index,
            };
            return float;
          }
          return undefined;
        }
        function earlyExitPlan(): EarlyPlan | undefined {
          const entry = fn.blocks[fn.entry];
          if (
            entry === undefined ||
            entry.exception !== undefined ||
            signature === undefined
          )
            return undefined;
          const term = entry.terminator;
          if (term.kind !== "branch" || term.consequent === term.alternate)
            return undefined;
          const definitions = new Map<number, IRInstruction>();
          for (const op of entry.instructions) {
            if (op === undefined) return undefined;
            if (
              op.kind !== "load" &&
              op.kind !== "constant" &&
              op.kind !== "reference-none" &&
              op.kind !== "binary"
            )
              return undefined;
            const id = instructionResult(op);
            if (id !== undefined) definitions.set(id, op);
          }
          /** The argument register of a parameter loaded by `id`. */
          function argument(
            id: number,
            kind: "integer" | "float",
          ): number | undefined {
            const op = definitions.get(id);
            if (op === undefined || op.kind !== "load") return undefined;
            const index = fn.parameters.indexOf(op.slot),
              location = signature?.parameters[index];
            return index >= 0 &&
              location !== undefined &&
              location.kind === kind
              ? location.index
              : undefined;
          }
          const condition = definitions.get(term.condition);
          if (condition === undefined || condition.kind !== "binary")
            return undefined;
          const operator = condition.operator;
          if (
            operator !== "===" &&
            operator !== "!==" &&
            operator !== "<" &&
            operator !== "<=" &&
            operator !== ">" &&
            operator !== ">="
          )
            return undefined;
          let test: EarlyTest | undefined;
          for (let side = 0; side < 2; side++) {
            const swapped = side === 1;
            const parameter = swapped ? condition.right : condition.left,
              other = definitions.get(
                swapped ? condition.left : condition.right,
              );
            if (other === undefined || test !== undefined) continue;
            if (
              other.kind === "reference-none" &&
              (operator === "===" || operator === "!==")
            ) {
              const register = argument(parameter, "integer");
              const slotType = value(parameter).type;
              if (
                register !== undefined &&
                (slotType === "reference" || slotType === "optional-reference")
              ) {
                const nullTest: EarlyTest = {
                  kind: "null",
                  register,
                  operator,
                };
                test = nullTest;
              }
            } else if (other.kind === "constant") {
              const literal = other.value;
              const register = argument(parameter, "float");
              // `k < x` is `x > k`.
              const mirrored: EarlyOperator = !swapped
                ? operator
                : operator === "<"
                  ? ">"
                  : operator === "<="
                    ? ">="
                    : operator === ">"
                      ? "<"
                      : operator === ">="
                        ? "<="
                        : operator;
              if (
                typeof literal === "number" &&
                register !== undefined &&
                value(parameter).type === "number"
              ) {
                const floatTest: EarlyTest = {
                  kind: "float",
                  register,
                  operator: mirrored,
                  constant: literal,
                };
                test = floatTest;
              }
            }
          }
          const decided = test;
          if (decided === undefined) return undefined;
          if (fn.returnType !== "void" && scalarByteLength(fn.returnType) > 8)
            return undefined;
          for (let side = 0; side < 2; side++) {
            const whenTrue = side === 0;
            const target =
              fn.blocks[whenTrue ? term.consequent : term.alternate];
            if (
              target === undefined ||
              target.id === entry.id ||
              target.exception !== undefined
            )
              continue;
            const exit = target.terminator;
            if (exit.kind !== "return") continue;
            const local = new Map<number, IRInstruction>();
            let simple = true;
            for (const op of target.instructions) {
              if (
                op === undefined ||
                (op.kind !== "load" &&
                  op.kind !== "constant" &&
                  op.kind !== "reference-none")
              )
                simple = false;
              else local.set(op.id, op);
            }
            if (!simple) continue;
            const returned = exit.value;
            const value = earlyValue(returned, local);
            if (value === undefined) continue;
            const plan: EarlyPlan = { test: decided, whenTrue, value };
            return plan;
          }
          return undefined;
        }
        const earlyExit = earlyExitPlan();
        let framePush = 0;
        if (earlyExit !== undefined) {
          const test = earlyExit.test;
          let skip: Branch;
          if (test.kind === "null") {
            // early <=> (x === null) === earlyWhenTrue for ===, inverted for !==.
            const earlyOnNull =
              (test.operator === "===") === earlyExit.whenTrue;
            skip = {
              op: earlyOnNull ? "cbnz" : "cbz",
              width: 64,
              rt: test.register,
            };
          } else {
            const bits = encodeFloat64(test.constant);
            if (bits.lo === 0 && bits.hi === 0)
              emit({ op: "fmov-d-x", rd: 16, rn: "zr" });
            else {
              imm64(9, bits.lo, bits.hi);
              emit({ op: "fmov-d-x", rd: 16, rn: 9 });
            }
            emit({ op: "fcmp", rn: test.register, rm: 16 });
            const holds = floatCondition(test.operator);
            skip = {
              op: "b.cond",
              condition: earlyExit.whenTrue ? invertCondition(holds) : holds,
            };
          }
          const site = instructions.length;
          emit(
            skip.op === "b.cond"
              ? { op: "b.cond", condition: skip.condition, displacement: 0 }
              : skip.op === "cbz" || skip.op === "cbnz"
                ? { op: skip.op, width: 64, rt: skip.rt, displacement: 0 }
                : { op: "b", displacement: 0 },
          );
          const result = earlyExit.value;
          const direct =
              directReturns !== undefined && directReturns[fn.id] === 1,
            target = direct ? 1 : 9;
          if (result.kind === "bits") imm64(target, result.lo, result.hi);
          else if (result.kind === "integer")
            emit({
              op: "orr-reg",
              width: 64,
              rd: target,
              rn: "zr",
              rm: result.register,
            });
          else if (result.kind === "float")
            emit({ op: "fmov-x-d", rd: target, rn: result.register });
          else if (result.kind === "zero")
            emit({ op: "orr-reg", width: 64, rd: target, rn: "zr", rm: "zr" });
          imm(0, 1);
          if (!direct) {
            if (result.kind !== "none")
              emit({ op: "str", width: 64, rt: 9, rn: 3, offset: 16 });
            emit({ op: "str", width: 32, rt: 0, rn: 3, offset: 0 });
          }
          emit({ op: "ret", rn: 30 });
          const displacement = (instructions.length - site) * 4;
          patchInstruction(
            site,
            skip.op === "b.cond"
              ? { op: "b.cond", condition: skip.condition, displacement }
              : skip.op === "cbz" || skip.op === "cbnz"
                ? { op: skip.op, width: 64, rt: skip.rt, displacement }
                : { op: "b", displacement },
          );
          framePush = instructions.length * 4 - start;
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
        if (guardsStack) {
          // Before any frame store: a frame below the context's stack limit
          // undoes itself and completes the call by throwing (stack overflow),
          // instead of reaching the guard page. Emergency mode sets the limit
          // to 0, so the throw path is never rechecked.
          emit({
            op: "ldr",
            width: 64,
            rt: 16,
            rn: 0,
            offset: nativeStackLimitOffset,
          });
          // With c-calls, the C stack reserve must fit below the frame too.
          emit({
            op: callsC ? "sub-imm" : "add-imm",
            width: 64,
            rd: 17,
            rn: "sp",
            immediate: callsC ? nativeCStackReserveBytes / 4096 : 0,
            shift: callsC ? 12 : 0,
            setFlags: false,
          });
          emit({
            op: "sub-reg",
            width: 64,
            rd: "zr",
            rn: 17,
            rm: 16,
            shift: "lsl",
            amount: 0,
            setFlags: true,
          });
          const fits = instructions.length;
          emit({ op: "b.cond", condition: "cs", displacement: 0 });
          // The helper is a stack-free leaf: it records the overflow and the
          // throw in the result record and leaves status 2 in x0; this frame
          // then returns exceptionally to its caller.
          callHelper("stack-overflow");
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
          patchInstruction(fits, {
            op: "b.cond",
            condition: "cs",
            displacement: (instructions.length - fits) * 4,
          });
        }
        calleeSaves(false);
        // Register homes start as their frame words do: zero. Verified IR may
        // read a slot before any store and rely on the absent value, and
        // stack maps list a homed reference's register at safepoints, so a
        // home live at entry must not keep the caller's register value.
        // Homes that parameters or the receiver fill below are skipped.
        if (homes !== undefined) {
          const filled = new Set<number>();
          for (const parameter of fn.parameters)
            if (parameter !== undefined) filled.add(slotRegister(parameter));
          if (fn.receiverSlot !== undefined)
            filled.add(slotRegister(fn.receiverSlot));
          const homed: number[] = [];
          for (let slot = 0; slot < fn.slots.length; slot++)
            if (slotRegister(slot) !== 0) homed.push(slot);
          const entryLive = new Uint8Array(fn.slots.length);
          if (!entryLivenessKnown) {
            cachedEntryLiveness =
              homed.length === 0
                ? undefined
                : limited<SlotLiveness>(
                    "entry-live-homes",
                    fn,
                    liveSlotsIntoEntry(fn, work(2000000), homed),
                  );
            entryLivenessKnown = true;
          }
          const liveness = cachedEntryLiveness;
          if (liveness === undefined) entryLive.fill(1);
          else
            for (const slot of liveness.slots[0] ?? [])
              if (slot !== undefined) entryLive[slot] = 1;
          const zeroed = new Set<number>();
          for (let slot = 0; slot < fn.slots.length; slot++) {
            const home = slotRegister(slot);
            if (home === 0 || filled.has(home) || zeroed.has(home)) continue;
            if (entryLive[slot] !== 1) continue;
            zeroed.add(home);
            if (home >= 32)
              emit({
                op: "orr-reg",
                width: 64,
                rd: home - 32,
                rn: "zr",
                rm: "zr",
              });
            else emit({ op: "fmov-d-x", rd: home, rn: "zr" });
          }
        }
        rawStore(0, contextOffset);
        rawStore(3, resultPointerOffset);
        frameStart = instructions.length * 4;
        // Words the prologue stores below before publishing the frame record
        // (environment, receiver, parameters) need no zeroing first.
        const prologueStores = new Set<number>();
        if (fn.environment !== undefined || fn.closureEnvironment !== undefined)
          prologueStores.add(environmentOffset);
        const receiverSlot = fn.receiverSlot;
        if (receiverSlot !== undefined) {
          prologueStores.add(slotOffset(receiverSlot));
          prologueStores.add(slotOffset(receiverSlot) + 8);
        }
        for (const parameter of fn.parameters) {
          if (parameter === undefined) throw "parameter layout invariant";
          const type = fn.slots[parameter];
          // A register-homed parameter's prologue store targets its register:
          // its frame (root) word still needs zeroing.
          if (slotRegister(parameter) === 0)
            prologueStores.add(slotOffset(parameter));
          if (type === "general") prologueStores.add(slotOffset(parameter) + 8);
        }
        const trackedSlots: number[] = [];
        if (hasRoots) {
          for (let slot = 0; slot < fn.slots.length; slot++) {
            const type = fn.slots[slot];
            if (type !== undefined && (managed(type) || type === "general"))
              trackedSlots.push(slot);
          }
        }
        if (!deadSlotsKnown) {
          cachedDeadSlots =
            hasRoots && !preciseRoots
              ? limited<readonly (readonly number[])[]>(
                  "dead-slot-roots",
                  fn,
                  deadSlotsAtEntry(fn, work(10000000), trackedSlots),
                )
              : undefined;
          deadSlotsKnown = true;
        }
        const deadSlots = cachedDeadSlots;
        // Deferred dead-slot clears: a slot that dies at a block entry is
        // zeroed at the next block that may collect, unless its word is stored
        // first; blocks proven free of safepoints (closed IR) clear nothing.
        const deadCollecting =
          deadSlots !== undefined &&
          closedRoots !== undefined &&
          noSafepoints !== undefined
            ? nonAllocatingBlocks(fn, noSafepoints)
            : undefined;
        const slotWordIndex = new Map<number, number>(),
          slotWordOffsets: number[] = [];
        function addRootWord(offset: number): void {
          if (slotWordIndex.has(offset)) return;
          slotWordIndex.set(offset, slotWordOffsets.length);
          slotWordOffsets.push(offset);
        }
        for (let slot = 0; slot < fn.slots.length; slot++) {
          const type = fn.slots[slot];
          if (type === undefined) throw "slot invariant";
          if (!managed(type) && type !== "general") continue;
          addRootWord(slotOffset(slot));
          if (type === "general") addRootWord(slotOffset(slot) + 8);
        }
        function rootWordsOf(slot: number): readonly number[] {
          const type = fn.slots[slot];
          if (type === undefined || (!managed(type) && type !== "general"))
            return [];
          const offset = slotOffset(slot),
            words: number[] = [];
          const first = slotWordIndex.get(offset);
          if (first !== undefined) words.push(first);
          if (type === "general") {
            const second = slotWordIndex.get(offset + 8);
            if (second !== undefined) words.push(second);
          }
          return words;
        }
        /** Root words a `store` to the slot writes. A register-homed slot's
         * store targets its register, so it writes none, and its word is
         * zeroed like any other unwritten root word (precise maps list the
         * register instead; the conservative regime lists the zero word). */
        function storeWordsOf(slot: number): readonly number[] {
          return slotRegister(slot) !== 0 ? [] : rootWordsOf(slot);
        }
        const deadClears =
          deadSlots !== undefined && deadCollecting !== undefined
            ? deadSlotClearPlan(
                fn,
                slotWordOffsets.length,
                (block) => {
                  const words: number[] = [];
                  for (const slot of deadSlots[block] ?? []) {
                    if (slot === undefined) throw "dead slot invariant";
                    // A live slot sharing this offset still owns the word.
                    if (
                      sharing !== undefined &&
                      sharing.otherLiveIn(slot, block)
                    )
                      continue;
                    for (const word of rootWordsOf(slot)) {
                      if (word === undefined) throw "dead word invariant";
                      words.push(word);
                    }
                  }
                  return words;
                },
                (block) => {
                  const words: number[] = [];
                  const current = fn.blocks[block];
                  if (current === undefined) throw "dead write block invariant";
                  for (const op of current.instructions) {
                    if (op === undefined) throw "dead write invariant";
                    if (op.kind === "store")
                      for (const word of storeWordsOf(op.slot)) {
                        if (word === undefined) throw "dead word invariant";
                        words.push(word);
                      }
                  }
                  return words;
                },
                rootWordsOf,
                (block) => deadCollecting[block] !== 1,
                work(50000000),
              )
            : undefined;
        // Slot words every path stores before any collection or read of them
        // need no prologue zero; temporaries keep their own pool clears.
        const initialWords: number[] = [];
        for (const offset of prologueStores) {
          const word = slotWordIndex.get(offset);
          if (word !== undefined) initialWords.push(word);
        }
        const slotClears =
          hasRoots && !preciseRoots && options.prologueSlotProof !== false
            ? prologueClearWords(
                fn,
                slotWordOffsets.length,
                initialWords,
                storeWordsOf,
                closedRoots === undefined ? undefined : noSafepoints,
                work(50000000),
              )
            : undefined;
        function slotNeedsZero(offset: number): boolean {
          if (prologueStores.has(offset)) return false;
          if (slotClears === undefined) return true;
          const word = slotWordIndex.get(offset);
          return word === undefined || slotClears[word] === 1;
        }
        const initialRoots: number[] = [];
        if (safepointLiveness !== undefined) {
          // Slots the function may read before storing them. A register-homed
          // slot's frame word is never used, and its register is zeroed
          // above.
          const zeroed = new Set<number>();
          for (const slot of safepointLiveness.slots[fn.entry] ?? []) {
            if (slot === undefined) throw "entry live slot invariant";
            const type = fn.slots[slot];
            if (type === undefined || slotRegister(slot) !== 0) continue;
            const offset = slotOffset(slot);
            for (
              let word = offset;
              word < offset + (type === "general" ? 16 : 8);
              word += 8
            )
              if (!prologueStores.has(word) && !zeroed.has(word)) {
                zeroed.add(word);
                initialRoots.push(word);
              }
          }
        } else
          for (let i = 0; i < rootSlots.length; i++) {
            const temporary = i >= rootSlots.length - temporaryRoots.length;
            if (rootClearBlocks !== undefined && temporary) continue;
            const offset = rootSlots[i];
            if (offset === undefined) throw "root slot invariant";
            if (temporary ? !prologueStores.has(offset) : slotNeedsZero(offset))
              initialRoots.push(offset);
          }
        if (safepointLiveness === undefined)
          for (let i = 0; i < generalSlots.length; i++) {
            const temporary =
              i >= generalSlots.length - temporaryGenerals.length;
            if (rootClearBlocks !== undefined && temporary) continue;
            const offset = generalSlots[i];
            if (offset === undefined) throw "general root slot invariant";
            for (let word = offset; word <= offset + 8; word += 8)
              if (temporary ? !prologueStores.has(word) : slotNeedsZero(word))
                initialRoots.push(word);
          }
        zeroWords(initialRoots);
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
        if (fn.blocks[0]?.id !== fn.entry) branch({ op: "b" }, fn.id, fn.entry);
        const nonNullValues = new Uint8Array(values.length),
          // Numbers whose bits are never a signalling NaN, so wrapping them
          // as optional numbers needs no quieting: FP arithmetic results
          // (AArch64 never returns a signalling NaN), non-NaN constants and
          // quieted unwraps. Moves, FNEG and memory reads keep raw bits.
          quietValues = new Uint8Array(values.length),
          wordKinds = new Uint8Array(values.length),
          wordConstants = new Uint32Array(values.length),
          wordMagnitudes = new Float64Array(values.length),
          slotWordBlocks = new Uint32Array(fn.slots.length),
          slotWordValues = new Uint32Array(fn.slots.length);
        const wordStorage = wordOnlyValues(fn, work(1000000));
        function quietValue(id: number): boolean {
          const index = valueIds.intern(id),
            kind = wordKinds[index] ?? 0;
          // Kinds 2 and 3 are exact 32-bit integers.
          return quietValues[index] === 1 || kind === 2 || kind === 3;
        }
        function storedAsWord(id: number): boolean {
          return wordStorage !== undefined && wordStorage[id] === 1;
        }
        function wantsInteger(id: number): boolean {
          return (
            integerUses[valueIds.intern(id)] === 1 &&
            value(id).type === "number"
          );
        }
        const integerStorage = new Uint8Array(values.length);
        function storedAsInteger(id: number): boolean {
          return integerStorage[valueIds.intern(id)] === 1;
        }
        function markInteger(id: number): void {
          integerStorage[valueIds.intern(id)] = 1;
        }
        /** An exact integer operand as an int64 in rt (see exactInteger). */
        function intOperand(id: number, rt: number): void {
          if (storedAsInteger(id)) rawValue(rt, id);
          else {
            const index = valueIds.intern(id);
            if (wordKinds[index] === 3) imm(rt, wordConstants[index] ?? 0);
            else emit({ op: "fcvtzs-x-d", rd: rt, rn: floatOperand(id, 0) });
          }
        }
        /** Proven integral without NaN: int64 storage, a 32-bit integer or
         * exact uint32 constant, or a bounded safe integer. */
        function exactInteger(id: number): boolean {
          if (storedAsInteger(id)) return true;
          const kind = wordKinds[valueIds.intern(id)] ?? 0;
          return kind === 2 || kind === 3 || kind === 6;
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
          if (storedAsWord(id) || storedAsInteger(id)) {
            rawLoad(9, value(id).offset);
            return;
          }
          const index = valueIds.intern(id),
            kind = wordKinds[index];
          if (kind === 1 || kind === 3) imm(9, wordConstants[index] ?? 0);
          else if (kind === 2 || kind === 5 || kind === 6 || kind === 7)
            emit({ op: "fcvtzs-x-d", rd: 9, rn: floatOperand(id, 0) });
          else {
            // Most unknown operands already hold an integral binary64. An exact
            // round trip through int64 yields ToUint32's low 32 bits directly;
            // only 2^63 survives saturation, so INT64_MAX (cmn sets V) also
            // takes the helper with fractional, non-finite and huge inputs.
            const operand = floatOperand(id, 0);
            emit({ op: "fcvtzs-x-d", rd: 9, rn: operand });
            emit({ op: "scvtf-d-x", rd: 1, rn: 9 });
            emit({ op: "fcmp", rn: operand, rm: 1 });
            const inexact = instructions.length;
            emit({ op: "b.cond", condition: "ne", displacement: 0 });
            emit({
              op: "add-imm",
              width: 64,
              rd: "zr",
              rn: 9,
              immediate: 1,
              shift: 0,
              setFlags: true,
            });
            const exact = instructions.length;
            emit({ op: "b.cond", condition: "vc", displacement: 0 });
            patchInstruction(inexact, {
              op: "b.cond",
              condition: "ne",
              displacement: (instructions.length - inexact) * 4,
            });
            rawValue(9, id);
            callHelper("to-uint32");
            patchInstruction(exact, {
              op: "b.cond",
              condition: "vc",
              displacement: (instructions.length - exact) * 4,
            });
          }
        }
        /** A GP register whose low 32 bits are ToInt32/ToUint32 of `id`:
         * the GP home of a word or int64 value, else `scratch` (computed
         * through x9 by wordValue, which may call the conversion helper). */
        function wordOperand(id: number, scratch: number): number {
          if (storedAsWord(id) || storedAsInteger(id)) {
            const home = homeOf(id);
            if (home >= 32) return home - 32;
          }
          wordValue(id);
          if (scratch !== 9)
            emit({ op: "orr-reg", width: 64, rd: scratch, rn: "zr", rm: 9 });
          return scratch;
        }
        function floatLoad(
          rt: number,
          id: number,
          byteOffset: number = 0,
        ): void {
          if (byteOffset === 0 && storedAsInteger(id)) {
            // Exact (|x| < 2^53), so the conversion is too.
            emit({ op: "scvtf-d-x", rd: rt, rn: rawRegister(id, 17) });
            return;
          }
          const storage = scalarRegisters,
            offset = value(id).offset + byteOffset,
            register = storage === undefined ? 0 : (storage[offset / 8] ?? 0);
          if (register >= 32)
            emit({ op: "fmov-d-x", rd: rt, rn: register - 32 });
          else if (register !== 0)
            emit({ op: "fmov-d-d", rd: rt, rn: register });
          else emit({ op: "ldr-d", rt, rn: "sp", offset });
        }
        function floatStore(rt: number, id: number): void {
          const storage = scalarRegisters,
            offset = value(id).offset,
            register = storage === undefined ? 0 : (storage[offset / 8] ?? 0);
          if (register >= 32) {
            emit({ op: "fmov-x-d", rd: register - 32, rn: rt });
            if (!floatWordsKnown && value(id).type === "number")
              floatWords.add(id);
          } else if (register !== 0) {
            if (register !== rt) emit({ op: "fmov-d-d", rd: register, rn: rt });
          } else emit({ op: "str-d", rt, rn: "sp", offset });
          if (tracker !== undefined) tracker.saved(id, instructions.length * 4);
        }
        /** The register home of `id` (32 + GP register, an FP register, or 0
         * for memory). */
        function homeOf(id: number): number {
          const storage = scalarRegisters;
          return storage === undefined
            ? 0
            : (storage[value(id).offset / 8] ?? 0);
        }
        /** The FP register a numeric result is computed into: its FP home,
         * else `scratch` (floatStore then writes it back). */
        function floatTarget(id: number, scratch: number): number {
          const home = homeOf(id);
          return home !== 0 && home < 32 ? home : scratch;
        }
        /** A GP register holding int64 operand `id`: its GP home, else
         * `scratch` loaded with it (see intOperand). */
        function intRegister(id: number, scratch: number): number {
          if (storedAsInteger(id)) {
            const home = homeOf(id);
            if (home >= 32) return home - 32;
          }
          intOperand(id, scratch);
          return scratch;
        }
        /** The GP register an int64 result is computed into: its GP home,
         * else `scratch` (saveRaw then writes it back). */
        function intTarget(id: number, scratch: number): number {
          const home = homeOf(id);
          return home >= 32 ? home - 32 : scratch;
        }
        /** Ordinary numeric ALU operands may name their existing FP homes. Only
         * stack-backed values need a scratch load; no conversion or guard changes. */
        function floatOperand(id: number, scratch: number): number {
          const storage = scalarRegisters,
            offset = value(id).offset,
            register = storage === undefined ? 0 : (storage[offset / 8] ?? 0);
          if (register !== 0 && register < 32 && !storedAsInteger(id))
            return register;
          floatLoad(scratch, id);
          return scratch;
        }
        function rawValue(rt: number, id: number): void {
          rawLoad(rt, value(id).offset);
        }
        /** The GP register a word result is computed into: its GP home, else
         * `scratch` (saveRaw then writes it back). */
        function rawTarget(id: number, scratch: number): number {
          const home = homeOf(id);
          return home >= 32 ? home - 32 : scratch;
        }
        /** A GP register holding the word of `id` for reading only: its GP
         * home, else `scratch` loaded with it. */
        function rawRegister(id: number, scratch: number): number {
          const home = homeOf(id);
          if (home >= 32) return home - 32;
          rawValue(scratch, id);
          return scratch;
        }
        function saveRaw(rt: number, id: number): void {
          rawStore(rt, value(id).offset);
          if (tracker !== undefined) tracker.saved(id, instructions.length * 4);
        }
        // C value helpers shared by c-call and c-memory lowering
        // (docs/native-ffi.md). KNOWN DEFECT (typed-pipeline gap,
        // docs/native-ffi.md#known-defects): the integerToFloat/floatToInteger/narrowLoad/narrowStore
        // helpers exist because a ternary choosing between opcodes
        // of different ISA union members inside emit({...}) fails
        // contextual typing in the native checker.
        /** SCVTF/UCVTF dd, (w|x)n. */
        function integerToFloat(
          rd: number,
          rn: number,
          signed: boolean,
          wide: boolean,
        ): void {
          if (signed && wide) emit({ op: "scvtf-d-x", rd, rn });
          else if (signed) emit({ op: "scvtf-d-w", rd, rn });
          else if (wide) emit({ op: "ucvtf-d-x", rd, rn });
          else emit({ op: "ucvtf-d-w", rd, rn });
        }
        /** LDRH/LDRB (halfword when `half`), zero-extending. */
        function narrowLoad(
          half: boolean,
          rt: number,
          rn: BaseRegister,
          offset: number,
        ): void {
          if (half) emit({ op: "ldrh", rt, rn, offset });
          else emit({ op: "ldrb", rt, rn, offset });
        }
        function narrowStore(
          half: boolean,
          rt: number,
          rn: BaseRegister,
          offset: number,
        ): void {
          if (half) emit({ op: "strh", rt, rn, offset });
          else emit({ op: "strb", rt, rn, offset });
        }
        /** FCVTZS/FCVTZU xd, dn. */
        function floatToInteger(rd: number, rn: number, signed: boolean): void {
          if (signed) emit({ op: "fcvtzs-x-d", rd, rn });
          else emit({ op: "fcvtzu-x-d", rd, rn });
        }
        /** rd = the kind flags of the object header at [rn]. */
        function headerFlags(rd: number, rn: number): void {
          emit({ op: "ldr", width: 64, rt: rd, rn, offset: 0 });
          emit({
            op: "ubfm",
            width: 64,
            rd,
            rn: rd,
            immr: nativeHeaderFlagsShift,
            imms: nativeHeaderFlagsShift + 2,
          });
        }
        function compareImmediate(rn: number, value: number): void {
          if (value <= 4095)
            emit({
              op: "sub-imm",
              width: 64,
              rd: "zr",
              rn,
              immediate: value,
              shift: 0,
              setFlags: true,
            });
          else {
            imm(11, value);
            emit({
              op: "sub-reg",
              width: 64,
              rd: "zr",
              rn,
              rm: 11,
              shift: "lsl",
              amount: 0,
              setFlags: true,
            });
          }
        }
        /** Trap when the 64-bit `rn` is the saturation bound of its
         * signedness (2^64-1 or 2^63-1): neither is a binary64 value,
         * yet a float round trip through FCVTZ* reproduces it (2^64
         * and 2^63 saturate back), so the exactness compare alone
         * would accept a rounded value. CMN rn, #1 sets Z for
         * all-ones and V for 2^63-1. */
        function rejectSaturated(rn: number, signed: boolean): void {
          emit({
            op: "add-imm",
            width: 64,
            rd: "zr",
            rn,
            immediate: 1,
            shift: 0,
            setFlags: true,
          });
          trapIf({
            op: "b.cond",
            condition: signed ? "vs" : "eq",
          });
        }
        /** Exact integer conversion of number `id` into `rd`; inexact
         * or out-of-range values trap (d0, d1, x9 scratch). */
        /** Push a may-callback call's transition record at `record` (an
         * outgoing-area offset) onto callback state `state` (docs/native-
         * ffi.md, "Callbacks"), before any argument register is loaded:
         * this frame's x29, the call's return address (an ADR patched by
         * popTransition), the previous record, a clear entered flag, the
         * thread, the context, the dispatcher and the `callees` function
         * values. Appends the words holding function values (for the
         * call's stack map) to `words`; returns the ADR's index. */
        function pushTransition(
          state: number,
          dispatcher: number,
          callees: readonly number[],
          record: number,
          words: number[],
        ): number {
          const t = callbackTransition;
          dataPointer(state, 14, false, callbackState.size);
          emit({
            op: "add-imm",
            width: 64,
            rd: 13,
            rn: "sp",
            immediate: record,
            shift: 0,
            setFlags: false,
          });
          emit({
            op: "ldr",
            width: 64,
            rt: 12,
            rn: 14,
            offset: callbackState.current,
          });
          emit({ op: "str", width: 64, rt: 12, rn: 13, offset: t.previous });
          emit({ op: "str", width: 64, rt: 29, rn: 13, offset: t.frame });
          const returnAddressAt = instructions.length;
          emit({ op: "adr", rd: 12, displacement: 0 });
          emit({
            op: "str",
            width: 64,
            rt: 12,
            rn: 13,
            offset: t.returnAddress,
          });
          emit({ op: "str", width: 64, rt: "zr", rn: 13, offset: t.entered });
          emit({ op: "mrs-thread", rt: 12, readOnly: host().os === "darwin" });
          emit({ op: "str", width: 64, rt: 12, rn: 13, offset: t.thread });
          rawLoad(12, contextOffset);
          emit({ op: "str", width: 64, rt: 12, rn: 13, offset: t.context });
          rawValue(9, dispatcher);
          emit({ op: "str", width: 64, rt: 9, rn: 13, offset: t.registered });
          words.push(record + t.registered);
          for (let ordinal = 0; ordinal < callees.length; ordinal++) {
            const callee = callees[ordinal];
            if (callee === undefined) throw "transition callee invariant";
            rawValue(9, callee);
            emit({
              op: "str",
              width: 64,
              rt: 9,
              rn: 13,
              offset: t.callbacks + ordinal * 8,
            });
            words.push(record + t.callbacks + ordinal * 8);
          }
          emit({
            op: "str",
            width: 64,
            rt: 13,
            rn: 14,
            offset: callbackState.current,
          });
          return returnAddressAt;
        }
        /** After a may-callback call's BLR: its return address is here (a
         * safepoint whose map also lists the transition's function-value
         * `words`), then pop the record. x0, x1 and d0-d3 are untouched. */
        function popTransition(
          state: number,
          record: number,
          returnAddressAt: number,
          words: readonly number[],
        ): void {
          patchInstruction(returnAddressAt, {
            op: "adr",
            rd: 12,
            displacement: (instructions.length - returnAddressAt) * 4,
          });
          safepoint();
          siteReferences.set(callSites.length - 1, words);
          dataPointer(state, 14, false, 0);
          emit({
            op: "ldr",
            width: 64,
            rt: 12,
            rn: "sp",
            offset: record + callbackTransition.previous,
          });
          emit({
            op: "str",
            width: 64,
            rt: 12,
            rn: 14,
            offset: callbackState.current,
          });
        }
        /** The universal trampoline (docs/native-ffi.md, "Dynamic
         * calls"): a leaf call of the address in operand 0 with every
         * register and stack argument taken from the frame (operand 1, see
         * dynamicCallFrame). Inside the call nothing moves, so the frame's
         * patches form borrowed addresses here: the bases are the frame's
         * and the byte operands' data addresses. Scratch: x9-x15, d0-d1. */
        function dynamicCall(call: ForeignCall, all: readonly number[]): void {
          const frame = dynamicCallFrame,
            mayCallback = call.mayCallback === true;
          // A may-callback trampoline takes the callback state and
          // dispatcher first and its callback function values last; its
          // transition is pushed before anything else.
          const operands = mayCallback ? all.slice(2) : all;
          const callees: number[] = [];
          for (let index = 0; index < frame.callbackOperands; index++) {
            const callee = operands[2 + frame.byteOperands + index];
            if (mayCallback && callee !== undefined) callees.push(callee);
          }
          const record = frame.stackCapacity,
            words: number[] = [];
          let returnAddressAt = -1;
          if (mayCallback) {
            const state = all[0],
              dispatcher = all[1];
            if (state === undefined || dispatcher === undefined)
              throw "dynamic c-call state invariant";
            returnAddressAt = pushTransition(
              state,
              dispatcher,
              callees,
              record,
              words,
            );
          }
          function operand(index: number): number {
            const id = operands[index];
            if (id === undefined) throw "dynamic c-call argument invariant";
            return id;
          }
          function forward(branch: Branch): number {
            const at = instructions.length;
            emit({ ...branch, displacement: 0 });
            return at;
          }
          function land(at: number, branch: Branch): void {
            patchInstruction(at, {
              ...branch,
              displacement: (instructions.length - at) * 4,
            });
          }
          numberToInteger(operand(0), 15, "usize");
          trapIf({ op: "cbz", width: 64, rt: 15 });
          // Bases: the frame, then each borrowed byte operand.
          dataPointer(operand(1), 12, false, frame.size);
          emit({ op: "str", width: 64, rt: 12, rn: 12, offset: frame.bases });
          for (let index = 0; index < frame.byteOperands; index++) {
            dataPointer(operand(2 + index), 14, false, 0);
            emit({
              op: "str",
              width: 64,
              rt: 14,
              rn: 12,
              offset: frame.bases + 8 + index * 8,
            });
          }
          // Universal callback thunks' entries for the callback operands.
          const bases =
            1 + frame.byteOperands + (mayCallback ? frame.callbackOperands : 0);
          for (let index = 0; index < callees.length; index++) {
            importAddress(
              14,
              17,
              "tint:callback-thunk:" + String(callbackThunk(undefined, index)),
            );
            emit({
              op: "str",
              width: 64,
              rt: 14,
              rn: 12,
              offset: frame.bases + (1 + frame.byteOperands + index) * 8,
            });
          }
          // Patches: frame[target] = bases[base] + addend.
          emit({
            op: "ldr",
            width: 64,
            rt: 13,
            rn: 12,
            offset: frame.patchCount,
          });
          compareImmediate(13, frame.patchCapacity);
          trapIf({ op: "b.cond", condition: "hi" });
          emit({
            op: "add-imm",
            width: 64,
            rd: 10,
            rn: 12,
            immediate: frame.patches,
            shift: 0,
            setFlags: false,
          });
          const patchLoop = instructions.length,
            patchDone = forward({ op: "cbz", width: 64, rt: 13 });
          emit({
            op: "ldr",
            width: 64,
            rt: 14,
            rn: 10,
            offset: frame.patchArray,
          });
          compareImmediate(14, bases - 1);
          trapIf({ op: "b.cond", condition: "hi" });
          emit({
            op: "add-reg",
            width: 64,
            rd: 14,
            rn: 12,
            rm: 14,
            shift: "lsl",
            amount: 3,
            setFlags: false,
          });
          emit({ op: "ldr", width: 64, rt: 14, rn: 14, offset: frame.bases });
          emit({
            op: "ldr",
            width: 64,
            rt: 11,
            rn: 10,
            offset: frame.patchArray * 2,
          });
          emit({
            op: "add-reg",
            width: 64,
            rd: 14,
            rn: 14,
            rm: 11,
            shift: "lsl",
            amount: 0,
            setFlags: false,
          });
          emit({ op: "ldr", width: 64, rt: 11, rn: 10, offset: 0 });
          // An 8-aligned word below the scratch area.
          compareImmediate(11, frame.scratch - 8);
          trapIf({ op: "b.cond", condition: "hi" });
          emit({ op: "ubfm", width: 64, rd: 9, rn: 11, immr: 0, imms: 2 });
          trapIf({ op: "cbnz", width: 64, rt: 9 });
          emit({
            op: "str-indexed",
            size: 3,
            fp: false,
            rt: 14,
            rn: 12,
            rm: 11,
            scaled: false,
          });
          emit({
            op: "add-imm",
            width: 64,
            rd: 10,
            rn: 10,
            immediate: 8,
            shift: 0,
            setFlags: false,
          });
          emit({
            op: "sub-imm",
            width: 64,
            rd: 13,
            rn: 13,
            immediate: 1,
            shift: 0,
            setFlags: false,
          });
          emit({
            op: "b",
            displacement: (patchLoop - instructions.length) * 4,
          });
          land(patchDone, { op: "cbz", width: 64, rt: 13 });
          // Stack arguments: whole words into the outgoing area at sp.
          emit({
            op: "ldr",
            width: 64,
            rt: 13,
            rn: 12,
            offset: frame.stackBytes,
          });
          compareImmediate(13, frame.stackCapacity);
          trapIf({ op: "b.cond", condition: "hi" });
          emit({ op: "ubfm", width: 64, rd: 9, rn: 13, immr: 0, imms: 2 });
          trapIf({ op: "cbnz", width: 64, rt: 9 });
          emit({
            op: "add-imm",
            width: 64,
            rd: 10,
            rn: 12,
            immediate: frame.stack,
            shift: 0,
            setFlags: false,
          });
          emit({
            op: "add-imm",
            width: 64,
            rd: 11,
            rn: "sp",
            immediate: 0,
            shift: 0,
            setFlags: false,
          });
          const copyLoop = instructions.length,
            copyDone = forward({ op: "cbz", width: 64, rt: 13 });
          emit({ op: "ldr", width: 64, rt: 14, rn: 10, offset: 0 });
          emit({ op: "str", width: 64, rt: 14, rn: 11, offset: 0 });
          emit({
            op: "add-imm",
            width: 64,
            rd: 10,
            rn: 10,
            immediate: 8,
            shift: 0,
            setFlags: false,
          });
          emit({
            op: "add-imm",
            width: 64,
            rd: 11,
            rn: 11,
            immediate: 8,
            shift: 0,
            setFlags: false,
          });
          emit({
            op: "sub-imm",
            width: 64,
            rd: 13,
            rn: 13,
            immediate: 8,
            shift: 0,
            setFlags: false,
          });
          emit({
            op: "b",
            displacement: (copyLoop - instructions.length) * 4,
          });
          land(copyDone, { op: "cbz", width: 64, rt: 13 });
          // Registers: x8, d0-d7, then x0-x7 (x12 last read).
          emit({
            op: "ldr",
            width: 64,
            rt: 8,
            rn: 12,
            offset: frame.indirect,
          });
          for (let register = 0; register < 8; register += 2)
            emit({
              op: "ldp-d",
              rt: register,
              rt2: register + 1,
              rn: 12,
              offset: frame.floats + register * 8,
            });
          for (let register = 0; register < 8; register += 2)
            emit({
              op: "ldp",
              width: 64,
              rt: register,
              rt2: register + 1,
              rn: 12,
              offset: frame.registers + register * 8,
              mode: "offset",
            });
          emit({ op: "blr", rn: 15 });
          // A may-callback trampoline's return address is its safepoint.
          if (mayCallback) {
            const state = all[0];
            if (state === undefined) throw "dynamic c-call state invariant";
            popTransition(state, record, returnAddressAt, words);
          }
          // Results: x0, x1 and d0-d3 back into the frame.
          rawValue(9, operand(1));
          emit({
            op: "ldr",
            width: 64,
            rt: 12,
            rn: 9,
            offset: nativeArrayDataOffset,
          });
          emit({
            op: "stp",
            width: 64,
            rt: 0,
            rt2: 1,
            rn: 12,
            offset: frame.registers,
            mode: "offset",
          });
          emit({ op: "stp-d", rt: 0, rt2: 1, rn: 12, offset: frame.floats });
          emit({
            op: "stp-d",
            rt: 2,
            rt2: 3,
            rn: 12,
            offset: frame.floats + 16,
          });
        }
        function numberToInteger(
          id: number,
          rd: number,
          scalar: CScalar,
        ): void {
          const bytes = cScalarBytes(scalar),
            signed = cScalarSigned(scalar, cTarget());
          if (storedAsInteger(id)) {
            // An exact int64 already: only the C type's range is
            // checked (sign for 64-bit unsigned, else the extension of
            // its low bits, which then also is the register's value).
            rawValue(rd, id);
            if (bytes === 8) {
              if (!signed) {
                emit({
                  op: "sub-reg",
                  width: 64,
                  rd: "zr",
                  rn: rd,
                  rm: "zr",
                  shift: "lsl",
                  amount: 0,
                  setFlags: true,
                });
                trapIf({ op: "b.cond", condition: "mi" });
              }
              return;
            }
            emit({
              op: signed ? "sbfm" : "ubfm",
              width: 64,
              rd: 9,
              rn: rd,
              immr: 0,
              imms: bytes * 8 - 1,
            });
            emit({
              op: "sub-reg",
              width: 64,
              rd: "zr",
              rn: 9,
              rm: rd,
              shift: "lsl",
              amount: 0,
              setFlags: true,
            });
            trapIf({ op: "b.cond", condition: "ne" });
            return;
          }
          floatLoad(0, id);
          if (bytes === 8) {
            floatToInteger(rd, 0, signed);
            integerToFloat(1, rd, signed, true);
            rejectSaturated(rd, signed);
          } else if (bytes === 4 && !signed) {
            emit({ op: "fcvtzu-w-d", rd, rn: 0 });
            emit({ op: "ucvtf-d-w", rd: 1, rn: rd });
          } else {
            emit({ op: "fcvtzs-w-d", rd, rn: 0 });
            emit({ op: "scvtf-d-w", rd: 1, rn: rd });
          }
          emit({ op: "fcmp", rn: 0, rm: 1 });
          trapIf({ op: "b.cond", condition: "ne" });
          if (bytes < 4) {
            // In range exactly when extending the low bits gives the
            // value back; the register then holds the extension the
            // caller owes on Apple targets.
            emit({
              op: signed ? "sbfm" : "ubfm",
              width: 32,
              rd: 9,
              rn: rd,
              immr: 0,
              imms: bytes * 8 - 1,
            });
            emit({
              op: "sub-reg",
              width: 32,
              rd: "zr",
              rn: 9,
              rm: rd,
              shift: "lsl",
              amount: 0,
              setFlags: true,
            });
            trapIf({ op: "b.cond", condition: "ne" });
          }
        }
        /** Convert number `id` to C integer `scalar` in `rd`, its
         * value already proven exact and in range (C view stores). */
        function provenInteger(id: number, rd: number, scalar: CScalar): void {
          const bytes = cScalarBytes(scalar),
            signed = cScalarSigned(scalar, cTarget());
          floatLoad(0, id);
          if (bytes === 8) floatToInteger(rd, 0, signed);
          else if (bytes === 4 && !signed)
            emit({ op: "fcvtzu-w-d", rd, rn: 0 });
          else emit({ op: "fcvtzs-w-d", rd, rn: 0 });
        }
        /** A Uint8Array operand's data pointer in `rd` (x9-x11
         * scratch): NUL-terminated arrays must be nonempty and end
         * in 0; record pointees need `minimum` bytes. A negative
         * `rd` checks the length only. */
        function dataPointer(
          id: number,
          rd: number,
          terminated: boolean,
          minimum: number,
        ): void {
          rawValue(9, id);
          if (terminated || minimum > 0 || rd < 0)
            emit({
              op: "ldr",
              width: 32,
              rt: 10,
              rn: 9,
              offset: nativeArrayLengthOffset,
            });
          if (minimum > 0) {
            compareImmediate(10, minimum);
            trapIf({ op: "b.cond", condition: "cc" });
          }
          if (rd < 0) return;
          emit({
            op: "ldr",
            width: 64,
            rt: rd,
            rn: 9,
            offset: nativeArrayDataOffset,
          });
          if (terminated) {
            trapIf({ op: "cbz", width: 32, rt: 10 });
            emit({
              op: "add-reg",
              width: 64,
              rd: 11,
              rn: rd,
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
            trapIf({ op: "cbnz", width: 32, rt: 11 });
          }
        }
        /** `bytes` (1-8) little-endian bytes at [base + offset] into
         * rd, without reading past them (x13 scratch). */
        function loadBytes(
          rd: number,
          base: BaseRegister,
          offset: number,
          bytes: number,
        ): void {
          if (bytes === 8) {
            emit({ op: "ldr", width: 64, rt: rd, rn: base, offset });
            return;
          }
          let done = 0;
          for (const width of [4, 2, 1]) {
            if (width === undefined) throw "load width invariant";
            if (bytes - done < width) continue;
            const part = done === 0 ? rd : 13;
            if (width === 4)
              emit({
                op: "ldr",
                width: 32,
                rt: part,
                rn: base,
                offset: offset + done,
              });
            else narrowLoad(width === 2, part, base, offset + done);
            if (done !== 0)
              emit({
                op: "add-reg",
                width: 64,
                rd,
                rn: rd,
                rm: 13,
                shift: "lsl",
                amount: done * 8,
                setFlags: false,
              });
            done += width;
          }
          if (done !== bytes) throw "partial load invariant";
        }
        /** The low `bytes` (1-8) bytes of rs to [base + offset],
         * little-endian (x13 scratch). */
        function storeBytes(
          rs: number,
          base: BaseRegister,
          offset: number,
          bytes: number,
        ): void {
          if (bytes === 8) {
            emit({ op: "str", width: 64, rt: rs, rn: base, offset });
            return;
          }
          let done = 0;
          while (done < bytes) {
            const left = bytes - done,
              width =
                left >= 4 && done % 4 === 0
                  ? 4
                  : left >= 2 && done % 2 === 0
                    ? 2
                    : 1;
            let part = rs;
            if (done !== 0) {
              // LSR x13, rs, #(8 * done)
              emit({
                op: "ubfm",
                width: 64,
                rd: 13,
                rn: rs,
                immr: done * 8,
                imms: 63,
              });
              part = 13;
            }
            if (width === 4)
              emit({
                op: "str",
                width: 32,
                rt: part,
                rn: base,
                offset: offset + done,
              });
            else narrowStore(width === 2, part, base, offset + done);
            done += width;
          }
        }
        /** Copy `bytes` from [x12] to [sp + offset] (x14 scratch). */
        function copyToFrame(offset: number, bytes: number): void {
          for (let at = 0; at < bytes; at += 8) {
            const piece = Math.min(8, bytes - at);
            loadBytes(14, 12, at, piece);
            storeBytes(14, "sp", offset + at, piece);
          }
        }
        /** 2 when record flow proves `list` is always a `header` record and
         * never null, 1 when it is that record or null, 0 otherwise. */
        function provenListHeader(list: number, header: number): number {
          if (
            recordValues === undefined ||
            recordValues.descriptor(fn.id, list) !== header
          )
            return 0;
          return recordValues.nonNull(fn.id, list) ? 2 : 1;
        }
        function descriptorPointer(record: number): void {
          if (record === functionRecord && brandImport !== undefined)
            managedPointer(11, brandImport);
          else {
            const imported = recordImports.get(record);
            if (imported !== undefined) managedPointer(11, imported);
            else {
              recordFixups.push({ offset: instructions.length * 4, record });
              localPointer(11);
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
            trapIf({ op: "cbz", width: 64, rt: pointer });
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
            trapIf({ op: "b.cond", condition: "ne" });
          }
        }
        /** One null check and descriptor load, then a direct equality branch to
         * the shared field read for each candidate layout of the fused chain. */
        function dispatchDescriptor(
          pointer: number,
          chain: {
            readonly records: readonly number[];
            readonly failure: number;
          },
          nonNullKnown: boolean,
          /** Collects membership failures for the caller to patch to a
           * local label (a later placement group) instead of `failure`;
           * a null object still goes to `failure`. */
          local?: LocalBranch[],
        ): void {
          function miss(op: Branch): void {
            if (local === undefined) {
              branch(op, fn.id, chain.failure);
              return;
            }
            local.push({ index: instructions.length, branch: op });
            emitBranch(op, 0);
          }
          if (!nonNullKnown)
            branch({ op: "cbz", width: 64, rt: pointer }, fn.id, chain.failure);
          emit({ op: "ldr", width: 64, rt: 10, rn: pointer, offset: 0 });
          if (
            chain.records.length >= dispatchBitsetThreshold &&
            chain.records.every(
              (record) =>
                record !== undefined &&
                !recordImports.has(record) &&
                !(record === functionRecord && brandImport !== undefined),
            )
          ) {
            // Each local descriptor is preceded by its record index. A
            // descriptor inside this module's descriptor region is tested
            // against the candidates' bitset; anything else fails, as a
            // chain of comparisons would.
            let first = Number.MAX_SAFE_INTEGER,
              last = -1;
            for (const record of chain.records) {
              if (record === undefined) throw "dispatch record invariant";
              first = Math.min(first, record);
              last = Math.max(last, record);
            }
            const ordered = chain.records.slice().sort((a, b) => a - b);
            const key = "set:" + ordered.join(",");
            if (!dispatchSets.has(key))
              dispatchSets.set(key, { first, records: ordered });
            // Below the first or above the last local descriptor: foreign.
            function bound(key: string, condition: "cc" | "hi"): void {
              dispatchFixups.push({ offset: instructions.length * 4, key });
              localPointer(11);
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
              miss({ op: "b.cond", condition });
            }
            bound("start", "cc");
            bound("end", "hi");
            let family = dispatchFamilies.get(key);
            if (
              family === undefined &&
              dispatchFamilies.size < dispatchFamilyWords * 64
            ) {
              family = dispatchFamilies.size;
              dispatchFamilies.set(key, family);
            }
            if (family !== undefined) {
              emit({
                op: "sub-imm",
                width: 64,
                rd: 12,
                rn: 10,
                immediate: 16 + (family >>> 6) * 8,
                shift: 0,
                setFlags: false,
              });
              emit({ op: "ldr", width: 64, rt: 12, rn: 12, offset: 0 });
              emit({
                op: "ubfm",
                width: 64,
                rd: 12,
                rn: 12,
                immr: family & 63,
                imms: family & 63,
              });
              miss({ op: "cbz", width: 64, rt: 12 });
              return;
            }
            emit({
              op: "sub-imm",
              width: 64,
              rd: 12,
              rn: 10,
              immediate: 8,
              shift: 0,
              setFlags: false,
            });
            emit({ op: "ldr", width: 64, rt: 12, rn: 12, offset: 0 });
            if (first > 0) {
              imm(13, first);
              emit({
                op: "sub-reg",
                width: 64,
                rd: 12,
                rn: 12,
                rm: 13,
                shift: "lsl",
                amount: 0,
                setFlags: false,
              });
            }
            imm(13, last - first + 1);
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
            miss({ op: "b.cond", condition: "cs" });
            dispatchFixups.push({ offset: instructions.length * 4, key });
            localPointer(11);
            emit({ op: "ubfm", width: 64, rd: 13, rn: 12, immr: 3, imms: 63 });
            emit({
              op: "add-reg",
              width: 64,
              rd: 11,
              rn: 11,
              rm: 13,
              shift: "lsl",
              amount: 0,
              setFlags: false,
            });
            emit({ op: "ldrb", rt: 13, rn: 11, offset: 0 });
            emit({ op: "ubfm", width: 64, rd: 12, rn: 12, immr: 0, imms: 2 });
            emit({ op: "lsrv", width: 32, rd: 13, rn: 13, rm: 12 });
            emit({ op: "ubfm", width: 32, rd: 13, rn: 13, immr: 0, imms: 0 });
            miss({ op: "cbz", width: 32, rt: 13 });
            return;
          }
          const matches: number[] = [];
          for (const record of chain.records) {
            if (record === undefined) throw "dispatch record invariant";
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
            matches.push(instructions.length);
            emit({ op: "b.cond", condition: "eq", displacement: 0 });
          }
          miss({ op: "b" });
          const read = instructions.length;
          for (const index of matches) {
            if (index === undefined) throw "dispatch branch invariant";
            patchInstruction(index, {
              op: "b.cond",
              condition: "eq",
              displacement: (read - index) * 4,
            });
          }
        }
        /** Emit a branch with a byte displacement (0 for a later patch). */
        function emitBranch(op: Branch, displacement: number): void {
          if (op.op === "b.cond")
            emit({ op: "b.cond", condition: op.condition, displacement });
          else if (op.op === "cbz" || op.op === "cbnz")
            emit({ op: op.op, width: op.width, rt: op.rt, displacement });
          else if (op.op === "b") emit({ op: "b", displacement });
          else throw "local branch invariant";
        }
        /** Point collected local branches at the current instruction. */
        function patchLocalBranches(branches: readonly LocalBranch[]): void {
          const here = instructions.length;
          for (const site of branches) {
            if (site === undefined) throw "local branch invariant";
            const op = site.branch,
              displacement = (here - site.index) * 4;
            if (op.op === "b.cond")
              patchInstruction(site.index, {
                op: "b.cond",
                condition: op.condition,
                displacement,
              });
            else if (op.op === "cbz" || op.op === "cbnz")
              patchInstruction(site.index, {
                op: op.op,
                width: op.width,
                rt: op.rt,
                displacement,
              });
            else if (op.op === "b")
              patchInstruction(site.index, { op: "b", displacement });
            else throw "local branch invariant";
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
                  emit({
                    op: "ldr",
                    width: 32,
                    rt: 9,
                    rn: 9,
                    offset: nativeStringLengthOffset,
                  });
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
            // An absent optional number is a NaN, which is falsy too.
            floatLoad(0, operand);
            emit({ op: "fmov-d-x", rd: 1, rn: "zr" });
            emit({ op: "fcmp", rn: 0, rm: 1 });
            imm(9, invert ? 1 : 0);
            // Unordered (NaN) is falsy. Skip the ordered condition result.
            emit({ op: "b.cond", condition: "vs", displacement: 8 });
            emit({ op: "cset", rd: 9, condition: invert ? "eq" : "ne" });
          } else {
            rawValue(9, operand);
            if (v.type === "optional-boolean") {
              rawLoad(10, v.offset + 8);
              emit({ op: "and-reg", width: 32, rd: 9, rn: 9, rm: 10 });
            }
            if (v.type === "optional-string")
              emit({ op: "cbz", width: 64, rt: 9, displacement: 8 });
            if (v.type === "string" || v.type === "optional-string")
              emit({
                op: "ldr",
                width: 32,
                rt: 9,
                rn: 9,
                offset: nativeStringLengthOffset,
              });
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
        function allocate(
          prepare: () => void,
          size: (rd: number) => void,
        ): void {
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
            // One start bit per 8-byte granule: word top >> 8, bit (top >> 3) & 31.
            emit({ op: "ubfm", width: 32, rd: 14, rn: 11, immr: 8, imms: 31 });
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
            emit({ op: "ubfm", width: 32, rd: 15, rn: 11, immr: 3, imms: 7 });
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
          zeroWords([
            resultOffset,
            resultOffset + 8,
            resultOffset + 16,
            resultOffset + 24,
          ]);
          rawLoad(0, contextOffset);
          emit({ op: "ldr", width: 64, rt: 1, rn: 0, offset: 24 });
          emit({ op: "ldr", width: 64, rt: 16, rn: 0, offset: 16 });
          trapIf({ op: "cbz", width: 64, rt: 16 });
          imm(2, 0);
          address(3, resultOffset);
          size(9);
          emit({ op: "ucvtf-d-w", rd: 0, rn: 9 });
          emit({ op: "blr", rn: 16 });
          safepoint();
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
          // The allocator returns `number | undefined` (one NaN-boxed
          // word); `undefined` is an invariant failure.
          rawLoad(9, resultOffset + 16);
          absentFlags(9, 10);
          trapIf({ op: "b.cond", condition: "eq" });
          // Validate the allocator's numeric offset (still in x9) before
          // forming a native pointer.
          callHelper("to-uint32");
          emit({ op: "ucvtf-d-w", rd: 0, rn: 9 });
          emit({ op: "ldr-d", rt: 1, rn: "sp", offset: resultOffset + 16 });
          emit({ op: "fcmp", rn: 0, rm: 1 });
          trapIf({ op: "b.cond", condition: "ne" });
          emit({ op: "ubfm", width: 32, rd: 10, rn: 9, immr: 0, imms: 2 });
          trapIf({ op: "cbnz", width: 32, rt: 10 });
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
          trapIf({ op: "b.cond", condition: "hi" });
          emit({ op: "ldr", width: 64, rt: 10, rn: 10, offset: 8 });
          trapIf({ op: "cbz", width: 64, rt: 10 });
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
          // align8(16 + 2 * length) must fit the uint32 allocation contract.
          // A longer string can never exist: clamp it to the maximum, whose
          // extent (0xfffffff0) exceeds every heap's capacity (each is below
          // 2^31), so the allocator throws its catchable RangeError value
          // before anything is written.
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
          emit({
            op: "add-reg",
            width: 64,
            rd: 11,
            rn: "zr",
            rm: 12,
            shift: "lsl",
            amount: 0,
            setFlags: false,
          });
          // align8(16 + 2 * max(length, 1)), which equals
          // align8(16 + 2 * max(length, 4)): every string spans at least four
          // units, which inline literal comparisons read unchecked.
          emit({
            op: "sub-imm",
            width: 64,
            rd: "zr",
            rn: 11,
            immediate: 0,
            shift: 0,
            setFlags: true,
          });
          emit({ op: "cset", rd: 12, condition: "eq" });
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
          emit({
            op: "add-imm",
            width: 64,
            rd: 12,
            rn: 12,
            immediate: nativeStringDataOffset + 7,
            shift: 0,
            setFlags: false,
          });
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
            immr: 3,
            imms: 63,
          });
          emit({
            op: "add-reg",
            width: 64,
            rd: 12,
            rn: "zr",
            rm: 12,
            shift: "lsl",
            amount: 3,
            setFlags: false,
          });
          rawStore(12, allocationOffset);
        }
        // Typed-array object: marker +0, flags +8, length +16, data pointer +24.
        // Returns index in x9, data pointer in x10, validity in x13.
        /** Bounds-checks `index` against `array`: x13 holds whether it is a
         * valid element index, x10 the element base, x11 the length; returns
         * the GP register holding the index as an integer (x9 or its home). */
        function arrayIndex(
          array: number,
          index: number,
          vector: boolean = false,
        ): number {
          const fact = valueIds.intern(index),
            integer = storedAsInteger(index),
            kind = integer ? 2 : wordKinds[fact];
          if (kind === 1) {
            // A constant that is not an exact uint32 can never be an index.
            imm(13, 0);
            return 9;
          }
          // An exact int64 index needs only the unsigned length check, which
          // also rejects negatives.
          let register = 9;
          if (integer) register = rawRegister(index, 9);
          else if (kind === 3) imm(9, wordConstants[fact] ?? 0);
          else emit({ op: "fcvtzs-x-d", rd: 9, rn: floatOperand(index, 0) });
          if (kind !== 2 && kind !== 3) {
            // Unknown numbers require an exact uint32 round trip. For proved
            // signed/unsigned words, the unsigned length check also rejects negatives.
            emit({ op: "ucvtf-d-w", rd: 0, rn: 9 });
            emit({ op: "fcmp", rn: 0, rm: floatOperand(index, 1) });
            emit({ op: "cset", rd: 13, condition: "eq" });
          }
          const base = rawRegister(array, 10);
          emit({
            op: "ldr",
            width: 32,
            rt: 11,
            rn: base,
            offset: nativeArrayLengthOffset,
          });
          if (vector)
            emit({
              op: "add-imm",
              width: 64,
              rd: 10,
              rn: base,
              immediate: nativeArrayInlineOffset,
              shift: 0,
              setFlags: false,
            });
          else
            emit({
              op: "ldr",
              width: 64,
              rt: 10,
              rn: base,
              offset: nativeArrayDataOffset,
            });
          emit({
            op: "sub-reg",
            width: 64,
            rd: "zr",
            rn: register,
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
          return register;
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
              trapIf({ op: "b.cond", condition: "ne" });
              rawStore(9, allocationOffset + 8);
              imm(11, nativeArrayInlineOffset + 7);
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
              trapIf({ op: "b.cond", condition: "hi" });
              emit({
                op: "ubfm",
                width: 64,
                rd: 11,
                rn: 11,
                immr: 3,
                imms: 63,
              });
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
              rawStore(11, allocationOffset);
            },
            (rd) => rawLoad(rd, allocationOffset),
          );
          rawLoad(10, allocationOffset + 8);
          rawLoad(11, allocationOffset);
          imm(12, marker);
          callHelper("array-initialize");
          if (marker === 6)
            emit({
              op: "str",
              width: 64,
              rt: "zr",
              rn: 9,
              offset: nativeArrayDataOffset,
            });
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
          trapIf({ op: "b.cond", condition: "ne" });
          rawLoad(10, value(cell).offset + 8);
          trapIf({ op: "cbz", width: 64, rt: 10 });
          emit({ op: "ldr", width: 64, rt: 11, rn: 10, offset: 0 });
          // Header bits 0-47: the layout marker.
          emit({ op: "ubfm", width: 64, rd: 11, rn: 11, immr: 0, imms: 47 });
          emit({
            op: "sub-imm",
            width: 64,
            rd: "zr",
            rn: 11,
            immediate: nativeWeakSlotMarker,
            shift: 0,
            setFlags: true,
          });
          trapIf({ op: "b.cond", condition: "ne" });
        }
        function vectorHeader(vector: number): void {
          rawValue(10, vector);
          trapIf({ op: "cbz", width: 64, rt: 10 });
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
          trapIf({ op: "b.cond", condition: "ne" });
        }
        const flowGuards =
          recordFlows === undefined ? undefined : recordFlows[fn.id];
        if (!recordGuardsKnown) {
          cachedChainGuards = provenRecordGuards(
            fn,
            Math.min(
              work(100000),
              values.length * 8 + fn.blocks.length * 8 + 256,
            ),
            stableGuards,
          );
          // Join-crossing proofs; emission-only, never fed back into the IR.
          cachedJoinGuards = limited<Uint8Array>(
            "join-record-guards",
            fn,
            dataflowRecordGuards(fn, work(2000000), stableGuards),
          );
          recordGuardsKnown = true;
        }
        const chainGuards = cachedChainGuards,
          joinGuards = cachedJoinGuards;
        let recordGuards = chainGuards ?? joinGuards;
        if (chainGuards !== undefined && joinGuards !== undefined) {
          const merged = new Uint8Array(fn.blocks.length);
          for (let block = 0; block < merged.length; block++)
            merged[block] =
              chainGuards[block] === 1 || joinGuards[block] === 1 ? 1 : 0;
          recordGuards = merged;
        }
        const dispatch = recordDispatchChains(fn, module.records, (block) => {
          if (recordGuards !== undefined && recordGuards[block] === 1)
            return false;
          return (
            flowGuards === undefined || ((flowGuards[block] ?? 0) & 1) === 0
          );
        });
        // Exact block-entry clears: zero only pool words some path may have
        // written since the last clear. Collecting blocks still observe an
        // all-zero pool, as with whole-prefix or whole-pool clears.
        const referenceWords = temporaryRoots.length,
          poolWordCount = referenceWords + temporaryGenerals.length * 2,
          generalPoolOffset = valuesOffset + referenceWords * 8,
          generalPoolEnd = generalPoolOffset + temporaryGenerals.length * 16;
        function poolWordOffset(word: number): number {
          if (word < referenceWords) {
            const offset = temporaryRoots[word];
            if (offset === undefined) throw "pool word invariant";
            return offset;
          }
          const general = temporaryGenerals[(word - referenceWords) >>> 1];
          if (general === undefined) throw "pool word invariant";
          return general + ((word - referenceWords) & 1) * 8;
        }
        function poolWords(results: readonly number[]): readonly number[] {
          const words: number[] = [];
          for (const id of results) {
            if (id === undefined) throw "pool write invariant";
            const offset = value(id).offset;
            if (offset >= valuesOffset && offset < generalPoolOffset)
              words.push((offset - valuesOffset) / 8);
            else if (offset >= generalPoolOffset && offset < generalPoolEnd) {
              const word =
                referenceWords + ((offset - generalPoolOffset) / 16) * 2;
              words.push(word, word + 1);
            }
          }
          return words;
        }
        // Deferred clears rely on the closed-IR safepoint proof; leaf register
        // homes may skip their stores, so they keep every dirty word cleared.
        const coverWrites =
          rootClearBlocks !== undefined && leafReferences === undefined;
        const poolClears =
          hasRoots && !preciseRoots && poolWordCount > 0
            ? poolClearPlan(
                fn,
                poolWordCount,
                (block) => {
                  const current = fn.blocks[block];
                  if (current === undefined) throw "pool write block invariant";
                  const results: number[] = [];
                  for (const op of current.instructions) {
                    if (op === undefined) throw "pool write invariant";
                    const id = instructionResult(op);
                    if (id !== undefined) results.push(id);
                  }
                  return poolWords(results);
                },
                (block) => {
                  const current = fn.blocks[block];
                  if (current === undefined) throw "pool write block invariant";
                  if (!coverWrites) return [];
                  // Only words whose store reaches the stack slot itself.
                  const registers = scalarRegisters,
                    stored: number[] = [];
                  for (const word of poolWords(
                    preSafepointResults(current, noSafepoints),
                  )) {
                    if (word === undefined) throw "covered word invariant";
                    if (
                      registers === undefined ||
                      (registers[poolWordOffset(word) / 8] ?? 0) === 0
                    )
                      stored.push(word);
                  }
                  return stored;
                },
                (block) =>
                  dispatch?.fused[block] !== 1 &&
                  (rootClearBlocks === undefined ||
                    rootClearBlocks[block] !== 1),
                rootClearBlocks !== undefined,
                work(50000000),
              )
            : undefined;
        // Operation ranges (analysis tooling): each IR operation owns the
        // words emitted from its start to the next operation, terminator or
        // block boundary. Representations are read after emission, once
        // integer/word storage and register homes are settled.
        let openOperation: IRInstruction | IRTerminator | undefined,
          openBlock = 0,
          openIndex = 0,
          openOffset = 0;
        function operandCode(id: number): string {
          const v = value(id),
            register = scalarRegisters?.[v.offset / 8] ?? 0,
            home = register === 0 ? "@m" : "@r";
          if (storedAsInteger(id)) return "int" + home;
          if (storedAsWord(id)) return "word" + home;
          if (v.type === "number") {
            const kind = wordKinds[valueIds.intern(id)] ?? 0;
            return (
              (kind === 1 || kind === 3
                ? "const"
                : kind === 2
                  ? "i32"
                  : kind === 6
                    ? "safe"
                    : "f64") + home
            );
          }
          return v.type + home;
        }
        function slotCode(slot: number): string {
          const register = scalarRegisters?.[slotOffset(slot) / 8] ?? 0;
          return (
            (integerSlots[slot] === 1 ? "int" : (fn.slots[slot] ?? "?")) +
            (register === 0 ? "@m" : "@r")
          );
        }
        function endOperation(): void {
          const op = openOperation;
          if (op === undefined) return;
          openOperation = undefined;
          const byteLength = instructions.length * 4 - openOffset;
          if (byteLength === 0) return;
          let operation: string = op.kind;
          if (op.kind === "binary" || op.kind === "unary")
            operation += ":" + op.operator;
          else if (op.kind === "host-call") operation += ":" + op.operation;
          else if (op.kind === "c-call") operation += ":" + op.call.symbol;
          else if (
            op.kind === "record" ||
            op.kind === "cell" ||
            op.kind === "record-cell"
          )
            operation += ":" + op.operation;
          const parts: string[] = [];
          if (op.kind === "load" || op.kind === "store")
            parts.push("slot:" + slotCode(op.slot));
          if (openIndex >= 0) {
            const instruction = fn.blocks[openBlock]?.instructions[openIndex];
            if (instruction !== undefined) {
              visitInstructionOperands(instruction, (id) => {
                parts.push(operandCode(id));
              });
              const result = instructionResult(instruction);
              if (result !== undefined) parts.push("->" + operandCode(result));
            }
          } else {
            const terminator = fn.blocks[openBlock]?.terminator;
            if (terminator !== undefined)
              visitTerminatorOperands(terminator, (id) => {
                parts.push(operandCode(id));
              });
          }
          operationRanges.push({
            function: fn.id,
            block: openBlock,
            index: openIndex,
            operation,
            operands: parts.join(" "),
            offset: openOffset,
            byteLength,
          });
        }
        function beginOperation(
          block: number,
          index: number,
          op: IRInstruction,
        ): void {
          endOperation();
          openOperation = op;
          openBlock = block;
          openIndex = index;
          openOffset = instructions.length * 4;
        }
        function beginTerminator(
          block: number,
          terminator: IRTerminator,
        ): void {
          endOperation();
          openOperation = terminator;
          openBlock = block;
          openIndex = -1;
          openOffset = instructions.length * 4;
        }
        // C view data pointers (docs/native-ffi.md, "C views"): after a
        // view access, x11 holds the data pointer of the view whose identity
        // token is `viewToken` (-1: none). Tokens name the object a
        // Uint8Array value holds: a slot load takes the slot's token (fresh
        // when unknown) and a slot store gives the slot the stored value's,
        // so copies through temporaries keep one token (only stores write
        // slots; collections move objects, not identities). View accesses,
        // slot loads and stores and constants leave x11 alone and are not
        // safepoints, so the next access with the same token reuses it; any
        // other operation forgets x11. A block
        // inherits x11 and the slot tokens from a sole predecessor ending in
        // a jump or branch (neither touches x11), so the tokens follow that
        // path; other blocks start with unknown slots.
        // Slot tokens are kept for Uint8Array slots only, densely indexed
        // (`viewSlots`); functions without view accesses track nothing.
        let viewToken = -1,
          nextViewToken = 0,
          viewSlotTokens: number[] = [],
          viewAccesses = false;
        const viewValueTokens = new Map<number, number>(),
          viewExitTokens = new Map<number, number>(),
          viewExitSlots = new Map<number, number[]>(),
          viewEntries = new Map<number, number>(),
          viewSlots = new Map<number, number>();
        for (const block of fn.blocks) {
          if (block === undefined) throw "view entry invariant";
          for (const op of block.instructions) {
            if (op === undefined) throw "view access invariant";
            if (
              op.kind === "c-memory" &&
              (op.access.operation === "load" ||
                op.access.operation === "store")
            )
              viewAccesses = true;
          }
        }
        if (viewAccesses)
          for (let slot = 0; slot < fn.slots.length; slot++)
            if (fn.slots[slot] === "Uint8Array")
              viewSlots.set(slot, viewSlots.size);
        for (const block of viewAccesses ? fn.blocks : []) {
          if (block === undefined) throw "view entry invariant";
          const term = block.terminator,
            plain = term.kind === "jump" || term.kind === "branch";
          for (const successor of blockSuccessors(block)) {
            if (successor === undefined) throw "view successor invariant";
            viewEntries.set(
              successor,
              viewEntries.has(successor) || !plain ? -1 : block.id,
            );
          }
          // Exceptional entries come from the middle of a block.
          const exception = block.exception;
          if (exception !== undefined) viewEntries.set(exception.target, -1);
        }
        /** The token of Uint8Array value `id` (fresh when unknown). */
        function viewValueToken(id: number): number {
          const known = viewValueTokens.get(id);
          if (known !== undefined) return known;
          const token = nextViewToken++;
          viewValueTokens.set(id, token);
          return token;
        }
        for (let blockIndex = 0; blockIndex < fn.blocks.length; blockIndex++) {
          const b = fn.blocks[blockIndex],
            nextBlock = fn.blocks[blockIndex + 1]?.id;
          if (b === undefined) throw "block invariant";
          // Fused dispatch continuations are unreachable; their head tests
          // every candidate layout.
          if (dispatch?.fused[b.id] === 1) {
            stackWords.clear();
            offsets[b.id * 2] = instructions.length * 4;
            joinLabelRun(b.id, true);
            continue;
          }
          const transient = transientRegisters,
            storage = scalarRegisters;
          if (transient !== undefined && storage !== undefined)
            for (const op of b.instructions) {
              if (op === undefined) throw "temporary instruction invariant";
              const id = instructionResult(op);
              if (id !== undefined && transient[id] !== 0)
                storage[value(id).offset / 8] = transient[id] ?? 0;
            }
          if (leafReferences !== undefined && storage !== undefined)
            for (const op of b.instructions) {
              if (op === undefined)
                throw "leaf reference instruction invariant";
              const id = instructionResult(op);
              if (id === undefined) continue;
              const v = value(id),
                register = leafReferences[v.offset / 8] ?? 0;
              if (register !== 0 && managed(v.type) && v.type !== "primitive")
                storage[v.offset / 8] = register;
            }
          if (recordOperations) endOperation();
          // A pending join here is an unrecorded edge; a fused label's edges
          // are not recorded either.
          const emptyBefore = labelRunAt === instructions.length;
          let entry: Map<number, number> | undefined,
            runRecorded = false;
          if (
            forwardable.has(b.id) &&
            !(emptyBefore && labelRunFused) &&
            !joins.has(instructions.length)
          ) {
            const last = readWord(instructions, instructions.length - 1);
            if (emptyBefore) {
              recordEdge(b.id, false);
              runRecorded = true;
            } else if (last !== undefined && fallsThrough(last))
              recordEdge(b.id, false);
            entry = edgeWords.get(b.id);
          }
          // Islands are skipped by the fallthrough path: their branches to
          // this start carry the fallthrough's words.
          branchIsland();
          trapIsland();
          blockId = b.id;
          stackWords.clear();
          if (entry !== undefined) {
            for (const [offset, held] of entry) stackWords.set(offset, held);
            joins.delete(instructions.length);
            seededEntries.set(b.id, edgeBranches.get(b.id) ?? 0);
            accountedLabels.add(b.id);
            if (runRecorded)
              for (const block of labelRun)
                if (block !== undefined) accountedLabels.add(block);
          }
          offsets[b.id * 2] = instructions.length * 4;
          joinLabelRun(b.id, false);
          if (tracker !== undefined)
            tracker.block(
              b.id,
              (slot, word) => {
                const storage = scalarRegisters;
                return storage === undefined
                  ? 0
                  : (storage[slotOffset(slot) / 8 + word] ?? 0);
              },
              (id) => homeOf(id),
            );
          span = undefined;
          const clears: number[] = [];
          const deferredDead = deadClears?.[b.id];
          if (deferredDead !== undefined)
            for (const word of deferredDead) {
              if (word === undefined) throw "deferred dead clear invariant";
              const offset = slotWordOffsets[word];
              if (offset === undefined) throw "deferred dead clear invariant";
              clears.push(offset);
            }
          for (const slot of deferredDead !== undefined
            ? []
            : (deadSlots?.[b.id] ?? [])) {
            if (slot === undefined) throw "dead slot invariant";
            // A live slot sharing this offset still owns the word.
            if (sharing !== undefined && sharing.otherLiveIn(slot, b.id))
              continue;
            const type = fn.slots[slot];
            if (type === undefined) throw "dead slot invariant";
            if (managed(type) || type === "general")
              clears.push(slotOffset(slot));
            if (type === "general") clears.push(slotOffset(slot) + 8);
          }
          // Nonallocating blocks may retain stale temporary roots, but no
          // collection can observe them. Clear the whole pool before any block
          // that may collect; a predecessor prefix is insufficient after deferral.
          // Without a complete closed-IR proof, preserve predecessor cleanup.
          const plannedClears = poolClears?.[b.id];
          if (plannedClears !== undefined)
            for (const word of plannedClears) {
              if (word === undefined) throw "planned clear invariant";
              clears.push(poolWordOffset(word));
            }
          const referenceClears =
            plannedClears !== undefined || preciseRoots
              ? 0
              : rootClearBlocks === undefined
                ? (incomingReferences[b.id] ?? 0)
                : rootClearBlocks[b.id] === 1
                  ? 0
                  : temporaryRoots.length;
          const generalClears =
            plannedClears !== undefined || preciseRoots
              ? 0
              : rootClearBlocks === undefined
                ? (incomingGenerals[b.id] ?? 0)
                : rootClearBlocks[b.id] === 1
                  ? 0
                  : temporaryGenerals.length;
          for (let i = 0; i < referenceClears; i++) {
            const offset = temporaryRoots[i];
            if (offset === undefined) throw "root offset invariant";
            clears.push(offset);
          }
          for (let i = 0; i < generalClears; i++) {
            const offset = temporaryGenerals[i];
            if (offset === undefined) throw "general offset invariant";
            clears.push(offset, offset + 8);
          }
          zeroWords(clears);
          const viewPredecessor = viewEntries.get(b.id) ?? -1,
            inheritedSlots =
              viewPredecessor < 0
                ? undefined
                : viewExitSlots.get(viewPredecessor);
          viewToken =
            inheritedSlots === undefined
              ? -1
              : (viewExitTokens.get(viewPredecessor) ?? -1);
          if (inheritedSlots !== undefined)
            viewSlotTokens = inheritedSlots.slice();
          else {
            viewSlotTokens = [];
            for (let index = 0; index < viewSlots.size; index++)
              viewSlotTokens.push(-1);
          }
          // SSA values are block-local. A final comparison used by the branch
          // has no other consumer, so its flags can replace a boolean carrier.
          const finalInstruction = b.instructions[b.instructions.length - 1];
          let comparisonValue: number | undefined = undefined;
          if (
            finalInstruction !== undefined &&
            (finalInstruction.kind === "binary" ||
              finalInstruction.kind === "optional-present")
          ) {
            const terminator = b.terminator;
            if (
              terminator.kind === "branch" &&
              finalInstruction.id === terminator.condition
            )
              comparisonValue = finalInstruction.id;
          }
          let comparisonBranch: Condition | undefined = undefined;
          for (
            let operationIndex = 0;
            operationIndex < b.instructions.length;
            operationIndex++
          ) {
            const op: IRInstruction | undefined =
              b.instructions[operationIndex];
            if (op === undefined) throw "instruction invariant";
            siteIndex = operationIndex;
            if (
              op.kind !== "load" &&
              op.kind !== "store" &&
              op.kind !== "constant" &&
              !(
                op.kind === "c-memory" &&
                (op.access.operation === "load" ||
                  op.access.operation === "store" ||
                  op.access.operation === "fits" ||
                  op.access.operation === "available")
              )
            )
              viewToken = -1;
            else if (op.kind === "load") {
              const index = viewSlots.get(op.slot) ?? -1,
                known = index < 0 ? -1 : (viewSlotTokens[index] ?? -1);
              if (known >= 0) viewValueTokens.set(op.id, known);
              else if (index >= 0)
                viewSlotTokens[index] = viewValueToken(op.id);
            } else if (op.kind === "store") {
              const index = viewSlots.get(op.slot) ?? -1;
              if (index >= 0) viewSlotTokens[index] = viewValueToken(op.value);
            }
            if (recordOperations) beginOperation(b.id, operationIndex, op);
            if (tracker !== undefined)
              tracker.operation(
                b.id,
                operationIndex,
                op.inline ?? -1,
                instructions.length * 4,
              );
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
            if (
              (op.kind === "binary" &&
                ["+", "-", "*", "/", "min", "max"].includes(op.operator)) ||
              (op.kind === "unary" &&
                (op.operator === "sqrt" ||
                  op.operator === "ceil" ||
                  op.operator === "trunc" ||
                  op.operator === "boolean-number"))
            )
              quietValues[valueIds.intern(op.id)] = 1;
            if (op.kind === "constant") {
              const constant = op.value;
              if (typeof constant === "number") {
                const index = valueIds.intern(op.id);
                if (constant === constant) quietValues[index] = 1;
                const word = constant >>> 0;
                // -0 is kind 3 too: it indexes element 0, and arithmetic
                // whose result's zero sign is observed keeps doubles (see
                // zeroSignResults).
                wordKinds[index] = word === constant ? 3 : 1;
                wordConstants[index] = word;
                if (Number.isSafeInteger(constant))
                  wordMagnitudes[index] = constant < 0 ? -constant : constant;
              }
            } else if (
              (op.kind === "unary" &&
                (op.operator === "~" || op.operator === "uint32")) ||
              (op.kind === "binary" &&
                ["&", "|", "^", "<<", ">>", ">>>", "imul"].includes(
                  op.operator,
                ))
            )
              wordKinds[valueIds.intern(op.id)] = 2;
            else if (
              op.kind === "array-length" ||
              (op.kind === "string-code-unit" && op.inBounds === true)
            )
              wordKinds[valueIds.intern(op.id)] = 2;
            else if (
              op.kind === "array-read" &&
              value(op.array).type !== "Float64Array"
            )
              wordKinds[valueIds.intern(op.id)] = 4;
            else if (
              op.kind === "array-element" &&
              value(op.array).type !== "Float64Array"
            )
              wordKinds[valueIds.intern(op.id)] = 2;
            else if (
              op.kind === "optional-value" &&
              wordKinds[valueIds.intern(op.value)] === 4
            )
              wordKinds[valueIds.intern(op.id)] = 5;
            else if (op.kind === "optional-value-or") {
              // A present 32-bit integer, else a 32-bit integer fallback.
              const fallback = wordKinds[valueIds.intern(op.fallback)] ?? 0;
              if (
                wordKinds[valueIds.intern(op.value)] === 4 &&
                (fallback === 2 || fallback === 3)
              )
                wordKinds[valueIds.intern(op.id)] = 2;
            } else if (op.kind === "optional-wrap") {
              const kind = wordKinds[valueIds.intern(op.value)];
              if (kind === 2 || kind === 3)
                wordKinds[valueIds.intern(op.id)] = 4;
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
              quietValues[index] = quietValues[stored] ?? 0;
              wordConstants[index] = wordConstants[stored] ?? 0;
              wordMagnitudes[index] = wordMagnitudes[stored] ?? 0;
            }
            if (
              op.kind === "binary" &&
              (op.operator === "+" ||
                op.operator === "-" ||
                op.operator === "*")
            ) {
              const left = valueIds.intern(op.left),
                right = valueIds.intern(op.right),
                leftBound = wordMagnitude(left),
                rightBound = wordMagnitude(right),
                bound =
                  op.operator === "*"
                    ? leftBound * rightBound
                    : leftBound + rightBound;
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
                if (
                  directReturns !== undefined &&
                  directReturns[op.target] === 1
                )
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
              case "general-is": {
                const tag =
                  op.type === "undefined"
                    ? 0
                    : op.type === "number"
                      ? 1
                      : op.type === "boolean"
                        ? 2
                        : op.type === "string"
                          ? 3
                          : op.type === "null"
                            ? 4
                            : 5;
                rawValue(9, op.value);
                imm(12, 0);
                emit({
                  op: "sub-imm",
                  width: 64,
                  rd: "zr",
                  rn: 9,
                  immediate: tag,
                  shift: 0,
                  setFlags: true,
                });
                if (op.type !== "Uint8Array") {
                  emit({ op: "cset", rd: 12, condition: "eq" });
                  saveRaw(12, op.id);
                  break;
                }
                // An object whose header marker (bits 0-47) is 2: a typed
                // array of 1-byte elements, as general-value checks.
                const nonObject = instructions.length;
                emit({ op: "b.cond", condition: "ne", displacement: 0 });
                rawLoad(9, value(op.value).offset + 8);
                const absent = instructions.length;
                emit({ op: "cbz", width: 64, rt: 9, displacement: 0 });
                emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
                emit({
                  op: "ubfm",
                  width: 64,
                  rd: 10,
                  rn: 10,
                  immr: 0,
                  imms: nativeHeaderFlagsShift - 1,
                });
                emit({
                  op: "sub-imm",
                  width: 64,
                  rd: "zr",
                  rn: 10,
                  immediate: 2,
                  shift: 0,
                  setFlags: true,
                });
                emit({ op: "cset", rd: 12, condition: "eq" });
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
                saveRaw(12, op.id);
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
                    localPointer(9);
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
                  localPointer(9);
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
                trapIf({ op: "b.cond", condition: "hi" });
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
                stringEqual();
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
                  if (at === undefined)
                    throw "general equality fixup invariant";
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
                  (rd) => imm(rd, recordHeaderBytes + 8),
                );
                descriptorPointer(
                  typeErrorRecord + (op.error === "RangeError" ? 1 : 0),
                );
                emit({ op: "str", width: 64, rt: 11, rn: 9, offset: 0 });
                rawValue(10, op.message);
                emit({
                  op: "str",
                  width: 64,
                  rt: 10,
                  rn: 9,
                  offset: recordHeaderBytes,
                });
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
                trapIf({ op: "b.cond", condition: "ne" });
                rawLoad(9, value(op.value).offset + 8);
                if (op.type === "Uint8Array") {
                  // The object's header marker (bits 0-47) must be 2:
                  // a typed array of 1-byte elements (any storage kind).
                  emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
                  emit({
                    op: "ubfm",
                    width: 64,
                    rd: 10,
                    rn: 10,
                    immr: 0,
                    imms: nativeHeaderFlagsShift - 1,
                  });
                  emit({
                    op: "sub-imm",
                    width: 64,
                    rd: "zr",
                    rn: 10,
                    immediate: 2,
                    shift: 0,
                    setFlags: true,
                  });
                  trapIf({ op: "b.cond", condition: "ne" });
                }
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
                      trapIf({ op: "b.cond", condition: "ne" });
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
                    emit({
                      op: "ldr",
                      width: 32,
                      rt: 10,
                      rn: 10,
                      offset: nativeArrayLengthOffset,
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
                    trapIf({ op: "b.cond", condition: "hi" });
                  },
                  (rd) => imm(rd, nativeArrayViewByteLength),
                );
                rawValue(10, op.array);
                rawLoad(11, allocationOffset + 8);
                rawLoad(12, allocationOffset + 16);
                emit({ op: "ldr", width: 64, rt: 13, rn: 10, offset: 0 });
                // The source's marker with the view flag.
                emit({
                  op: "ubfm",
                  width: 64,
                  rd: 13,
                  rn: 13,
                  immr: 0,
                  imms: 47,
                });
                imm64(14, 0, 2 * (nativeHeaderFlagUnit / 4294967296));
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
                emit({ op: "str", width: 64, rt: 13, rn: 9, offset: 0 });
                emit({
                  op: "str",
                  width: 64,
                  rt: 12,
                  rn: 9,
                  offset: nativeArrayLengthOffset,
                });
                emit({
                  op: "ldr",
                  width: 64,
                  rt: 13,
                  rn: 10,
                  offset: nativeArrayDataOffset,
                });
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
                emit({
                  op: "str",
                  width: 64,
                  rt: 13,
                  rn: 9,
                  offset: nativeArrayDataOffset,
                });
                emit({
                  op: "str",
                  width: 64,
                  rt: 10,
                  rn: 9,
                  offset: nativeArrayOwnerOffset,
                });
                emit({
                  op: "str",
                  width: 64,
                  rt: "zr",
                  rn: 9,
                  offset: nativeArrayViewByteLength - 8,
                });
                saveRaw(9, op.id);
                break;
              }
              case "weak-slot-new": {
                allocate(
                  () => {},
                  (rd) => imm(rd, nativeWeakSlotByteLength),
                );
                // Reload operands after allocation: a slow allocation can move both.
                rawValue(10, op.ephemeron);
                imm(11, nativeWeakSlotMarker);
                emit({
                  op: "add-reg",
                  width: 64,
                  rd: 11,
                  rn: 11,
                  rm: 10,
                  shift: "lsl",
                  amount: nativeHeaderFlagsShift,
                  setFlags: false,
                });
                emit({ op: "str", width: 64, rt: 11, rn: 9, offset: 0 });
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
                  offset: 0,
                });
                // Header bits 48-50: the kind flags.
                emit({
                  op: "ubfm",
                  width: 64,
                  rd: 11,
                  rn: 11,
                  immr: 48,
                  imms: 50,
                });
                trapIf({ op: "cbz", width: 64, rt: 11 });
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
                if (generationalBarriers) {
                  // An old cell may now refer to a young value.
                  emit({
                    op: "orr-reg",
                    width: 64,
                    rd: 9,
                    rn: "zr",
                    rm: 10,
                  });
                  rawLoad(10, contextOffset);
                  rememberObject();
                }
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
                // Used only by inline equality tests: never materialized.
                if (foldedConstants[valueIds.intern(op.id)] === 1) break;
                stringFixups.push({
                  offset: instructions.length * 4,
                  value: op.value,
                });
                localPointer(9);
                saveRaw(9, op.id);
                break;
              case "string-length": {
                // A uint32 length: an exact int64 for integer uses.
                const string = rawRegister(op.string, 9);
                if (wantsInteger(op.id)) {
                  const target = rawTarget(op.id, 9);
                  emit({
                    op: "ldr",
                    width: 32,
                    rt: target,
                    rn: string,
                    offset: nativeStringLengthOffset,
                  });
                  saveRaw(target, op.id);
                  markInteger(op.id);
                  break;
                }
                emit({
                  op: "ldr",
                  width: 32,
                  rt: 9,
                  rn: string,
                  offset: nativeStringLengthOffset,
                });
                emit({ op: "ucvtf-d-w", rd: floatTarget(op.id, 0), rn: 9 });
                floatStore(floatTarget(op.id, 0), op.id);
                break;
              }
              case "string-starts-with":
                rawValue(9, op.string);
                rawValue(10, op.search);
                floatLoad(0, op.position);
                callHelper("string-starts-with");
                saveRaw(9, op.id);
                break;
              case "string-code-unit": {
                if (op.inBounds === true) {
                  // Proven a non-negative integer index below the length:
                  // one halfword load (an int64 for integer uses).
                  const string = rawRegister(op.string, 9),
                    index = intRegister(op.index, 12);
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
                    emit({
                      op: "ldr-indexed",
                      size: 1,
                      fp: false,
                      rt: target,
                      rn: 10,
                      rm: index,
                      scaled: true,
                    });
                    saveRaw(target, op.id);
                    markInteger(op.id);
                    break;
                  }
                  emit({
                    op: "ldr-indexed",
                    size: 1,
                    fp: false,
                    rt: 11,
                    rn: 10,
                    rm: index,
                    scaled: true,
                  });
                  const target = floatTarget(op.id, 0);
                  emit({ op: "ucvtf-d-w", rd: target, rn: 11 });
                  floatStore(target, op.id);
                  break;
                }
                const indexFact = valueIds.intern(op.index),
                  target = floatTarget(op.id, 0);
                rawValue(9, op.string);
                if (storedAsInteger(op.index) || wordKinds[indexFact] === 3) {
                  // An exact integer index reads the unit inline after an
                  // unsigned length check; the helper yields NaN otherwise.
                  let index = 12;
                  if (storedAsInteger(op.index))
                    index = intRegister(op.index, 12);
                  else imm(12, wordConstants[indexFact] ?? 0);
                  emit({
                    op: "ldr",
                    width: 32,
                    rt: 10,
                    rn: 9,
                    offset: nativeStringLengthOffset,
                  });
                  emit({
                    op: "sub-reg",
                    width: 64,
                    rd: "zr",
                    rn: index,
                    rm: 10,
                    shift: "lsl",
                    amount: 0,
                    setFlags: true,
                  });
                  const outside = instructions.length;
                  emit({ op: "b.cond", condition: "cs", displacement: 0 });
                  emit({
                    op: "add-imm",
                    width: 64,
                    rd: 10,
                    rn: 9,
                    immediate: nativeStringDataOffset,
                    shift: 0,
                    setFlags: false,
                  });
                  emit({
                    op: "ldr-indexed",
                    size: 1,
                    fp: false,
                    rt: 11,
                    rn: 10,
                    rm: index,
                    scaled: true,
                  });
                  emit({ op: "ucvtf-d-w", rd: target, rn: 11 });
                  const done = instructions.length;
                  emit({ op: "b", displacement: 0 });
                  patchInstruction(outside, {
                    op: "b.cond",
                    condition: "cs",
                    displacement: (instructions.length - outside) * 4,
                  });
                  floatLoad(0, op.index);
                  callHelper("string-code-unit");
                  if (target !== 0) emit({ op: "fmov-d-d", rd: target, rn: 0 });
                  patchInstruction(done, {
                    op: "b",
                    displacement: (instructions.length - done) * 4,
                  });
                  floatStore(target, op.id);
                  break;
                }
                floatLoad(0, op.index);
                callHelper("string-code-unit");
                floatStore(0, op.id);
                break;
              }
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
                imm(10, op.values.length);
                emit({
                  op: "str",
                  width: 64,
                  rt: 10,
                  rn: 9,
                  offset: nativeStringLengthOffset,
                });
                for (let index = 0; index < op.values.length; index++) {
                  const input = op.values[index];
                  if (input === undefined) throw "string code unit invariant";
                  rawValue(9, input);
                  // ToUint16 is ToUint32 modulo 65536; strh stores those low bits.
                  callHelper("to-uint32");
                  rawValue(10, op.id);
                  imm(11, nativeStringDataOffset + index * 2);
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
                    rawValue(10, op.limit);
                    absentFlags(10, 10);
                    emit({ op: "cset", rd: 10, condition: "ne" });
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
              case "string-allocate": {
                // The builder writes every unit before any other use, so the
                // contents are left as allocated.
                allocate(
                  () => {
                    floatLoad(0, op.length);
                    emit({ op: "fcvtzs-x-d", rd: 11, rn: 0 });
                    prepareStringSize();
                  },
                  (rd) => rawLoad(rd, allocationOffset),
                );
                saveRaw(9, op.id);
                imm(10, 1);
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
              case "string-write":
                rawValue(9, op.target);
                rawValue(10, op.source);
                floatLoad(0, op.offset);
                emit({ op: "fcvtzs-x-d", rd: 11, rn: 0 });
                callHelper("string-write-copy");
                break;
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
                // Folded into the equality tests that are its only uses.
                if (foldedConstants[valueIds.intern(op.id)] === 1) break;
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
                trapIf({ op: "cbz", width: 64, rt: 9 });
                saveRaw(9, op.id);
                break;
              case "string-reference":
              case "reference-string":
                // The same managed word under the other type.
                rawValue(9, op.value);
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
                  const record =
                    module.functions[op.target]?.closureEnvironment;
                  if (record === undefined)
                    throw "closure environment invariant";
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
                for (let i = 0; i < layout.fields.length; i++) {
                  const field = layout.fields[i],
                    arg = op.arguments[i];
                  if (field === undefined) throw "record field invariant";
                  for (
                    let word = 0;
                    word < scalarByteLength(field.type);
                    word += 8
                  ) {
                    // A missing optional number is `undefined`, not +0.
                    if (arg === undefined && field.type === "optional-number")
                      absentNumber(10);
                    else if (arg === undefined) imm(10, 0);
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
                if (foldedConstants[valueIds.intern(op.id)] === 1) break;
                const constant = op.value,
                  home = value(op.id).offset,
                  register = scalarRegisters?.[home / 8] ?? 0;
                if (typeof constant === "boolean") {
                  if (constant) {
                    imm(9, 1);
                    saveRaw(9, op.id);
                  } else rawStore("zr", home);
                  break;
                }
                if (
                  wantsInteger(op.id) &&
                  Number.isSafeInteger(constant) &&
                  !(constant === 0 && 1 / constant < 0)
                ) {
                  // Two's complement int64 halves of a safe integer.
                  const lo =
                      ((constant % 4294967296) + 4294967296) % 4294967296,
                    hi =
                      (Math.floor(constant / 4294967296) + 4294967296) %
                      4294967296;
                  if (lo === 0 && hi === 0) rawStore("zr", home);
                  else {
                    imm64(9, lo, hi);
                    saveRaw(9, op.id);
                  }
                  markInteger(op.id);
                  break;
                }
                const bits = encodeFloat64(constant);
                if (bits.lo === 0 && bits.hi === 0) {
                  // +0: no materialized bits in either register class.
                  rawStore("zr", home);
                  break;
                }
                const immediate =
                  register > 0 && register < 32
                    ? float64Immediate(constant)
                    : undefined;
                if (immediate !== undefined) {
                  emit({ op: "fmov-d-imm", rd: register, imm8: immediate });
                  break;
                }
                imm64(9, bits.lo, bits.hi);
                saveRaw(9, op.id);
                break;
              }
              case "record-read": {
                const field = module.records?.[op.record]?.fields[op.field];
                if (field === undefined) throw "proven record field invariant";
                let offset = field.offset;
                const bytes = scalarByteLength(field.type);
                // A single-word read addresses through the object's GP home
                // and loads into the result's home (multi-word results could
                // overwrite the base with their first word).
                let object = 9;
                if (bytes === 8) object = rawRegister(op.object, 9);
                else rawValue(9, op.object);
                if (offset > 32768 - bytes) {
                  imm(12, offset);
                  emit({
                    op: "add-reg",
                    width: 64,
                    rd: 9,
                    rn: object,
                    rm: 12,
                    shift: "lsl",
                    amount: 0,
                    setFlags: false,
                  });
                  object = 9;
                  offset = 0;
                }
                const home = homeOf(op.id);
                if (bytes === 8 && home >= 32)
                  emit({
                    op: "ldr",
                    width: 64,
                    rt: home - 32,
                    rn: object,
                    offset,
                  });
                else if (bytes === 8 && home !== 0)
                  emit({ op: "ldr-d", rt: home, rn: object, offset });
                else
                  for (let word = 0; word < bytes; word += 8) {
                    emit({
                      op: "ldr",
                      width: 64,
                      rt: 10,
                      rn: object,
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
                rawStore("zr", value(op.id).offset);
                rawStore("zr", value(op.id).offset + 8);
                break;
              case "undefined": {
                if (foldedConstants[valueIds.intern(op.id)] === 1) break;
                const target = rawTarget(op.id, 9);
                absentNumber(target);
                saveRaw(target, op.id);
                break;
              }
              case "boolean-wrap":
                rawValue(9, op.value);
                saveRaw(9, op.id);
                imm(10, 1);
                rawStore(10, value(op.id).offset + 8);
                break;
              case "optional-wrap":
                if (storedAsInteger(op.value) || quietValue(op.value)) {
                  // Exact integers (converted) and quiet values (see
                  // quietValues) never have the `undefined` bits.
                  if (storedAsInteger(op.value)) {
                    const target = floatTarget(op.id, 0);
                    floatLoad(target, op.value);
                    floatStore(target, op.id);
                  } else
                    copyRawWord(value(op.value).offset, value(op.id).offset);
                } else {
                  const target = floatTarget(op.id, 0);
                  quietNumber(target, floatOperand(op.value, 0));
                  floatStore(target, op.id);
                }
                quietValues[valueIds.intern(op.id)] = 1;
                break;
              case "boolean-present":
                rawLoad(9, value(op.value).offset + 8);
                saveRaw(9, op.id);
                break;
              case "optional-present": {
                absentFlags(rawRegister(op.value, 9), 10);
                if (op.id === comparisonValue) comparisonBranch = "ne";
                else {
                  const target = rawTarget(op.id, 9);
                  emit({ op: "cset", rd: target, condition: "ne" });
                  saveRaw(target, op.id);
                }
                break;
              }
              case "boolean-value":
                rawLoad(10, value(op.value).offset + 8);
                trapIf({ op: "cbz", width: 64, rt: 10 });
                rawValue(9, op.value);
                saveRaw(9, op.id);
                break;
              case "optional-value-or": {
                if (fusedDefaults[valueIds.intern(op.id)] === 2) {
                  // The fused read already selected the number.
                  copyRawWord(value(op.value).offset, value(op.id).offset);
                  break;
                }
                if (fusedDefaults[valueIds.intern(op.id)] === 1) {
                  // A fused typed-array read left its element word (zero when
                  // absent) in the payload word: convert it, no selection.
                  rawValue(11, op.value);
                  if (value(arrayOf(op.value)).type === "Float64Array")
                    saveRaw(11, op.id);
                  else if (wantsInteger(op.id)) {
                    saveRaw(11, op.id);
                    markInteger(op.id);
                  } else {
                    emit({ op: "ucvtf-d-w", rd: 0, rn: 11 });
                    floatStore(0, op.id);
                  }
                  break;
                }
                // Present selects the payload; absent the fallback.
                const optional = rawRegister(op.value, 9);
                absentFlags(optional, 10);
                // The fallback is never int64 storage (see the integer
                // operand acceptance list).
                const fallback = rawRegister(op.fallback, 11);
                const target = rawTarget(op.id, 9);
                emit({
                  op: "csel",
                  width: 64,
                  rd: target,
                  rn: fallback,
                  rm: optional,
                  condition: "eq",
                });
                saveRaw(target, op.id);
                break;
              }
              case "optional-value": {
                // Quieting turns `undefined` into a quiet NaN; present
                // numbers are already quiet or unchanged non-NaNs.
                const target = floatTarget(op.id, 0);
                quietNumber(target, floatOperand(op.value, 0));
                floatStore(target, op.id);
                quietValues[valueIds.intern(op.id)] = 1;
                break;
              }
              case "array-buffer":
              case "array-byte-offset": {
                rawValue(10, op.array);
                emit({
                  op: "ldr",
                  width: 64,
                  rt: 11,
                  rn: 10,
                  offset: nativeArrayDataOffset,
                });
                // A view has kind flag 2 and holds its parent (the owner word).
                emit({ op: "ldr", width: 64, rt: 12, rn: 10, offset: 0 });
                // Header bits 48-50: the kind flags.
                emit({
                  op: "ubfm",
                  width: 64,
                  rd: 12,
                  rn: 12,
                  immr: 48,
                  imms: 50,
                });
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
                emit({
                  op: "ldr",
                  width: 64,
                  rt: 10,
                  rn: 10,
                  offset: nativeArrayOwnerOffset,
                });
                emit({ op: "b", displacement: -20 });
                if (op.kind === "array-buffer") saveRaw(10, op.id);
                else {
                  emit({
                    op: "ldr",
                    width: 64,
                    rt: 12,
                    rn: 10,
                    offset: nativeArrayDataOffset,
                  });
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
              case "c-memory": {
                // C memory through a Uint8Array (docs/native-ffi.md): not a
                // safepoint; x9-x13, d0 and d1 are scratch.
                const access = op.access,
                  operands = op.arguments,
                  base = operands[0],
                  resultId = op.id;
                if (access.operation === "stable") {
                  // Borrowed (flag 1), or a view (flag 2) of a borrowed
                  // owner: data that no collection moves.
                  const array = op.arguments[0];
                  if (resultId === undefined || array === undefined)
                    throw "c-memory stable invariant";
                  rawValue(9, array);
                  const flags = (): void => {
                    emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
                    emit({
                      op: "ubfm",
                      width: 64,
                      rd: 10,
                      rn: 10,
                      immr: nativeHeaderFlagsShift,
                      imms: nativeHeaderFlagsShift + 2,
                    });
                  };
                  flags();
                  emit({
                    op: "sub-imm",
                    width: 64,
                    rd: "zr",
                    rn: 10,
                    immediate: 2,
                    shift: 0,
                    setFlags: true,
                  });
                  const notView = instructions.length;
                  emit({ op: "b.cond", condition: "ne", displacement: 0 });
                  emit({
                    op: "ldr",
                    width: 64,
                    rt: 9,
                    rn: 9,
                    offset: nativeArrayOwnerOffset,
                  });
                  flags();
                  patchInstruction(notView, {
                    op: "b.cond",
                    condition: "ne",
                    displacement: (instructions.length - notView) * 4,
                  });
                  emit({
                    op: "sub-imm",
                    width: 64,
                    rd: "zr",
                    rn: 10,
                    immediate: 1,
                    shift: 0,
                    setFlags: true,
                  });
                  emit({ op: "cset", rd: 9, condition: "eq" });
                  saveRaw(9, resultId);
                  break;
                }
                if (access.operation === "callback-address") {
                  // A registered callback thunk's entry.
                  const prototype = access.callback,
                    slot = access.slot;
                  if (
                    resultId === undefined ||
                    prototype === undefined ||
                    slot === undefined
                  )
                    throw "c-memory callback address invariant";
                  importAddress(
                    9,
                    10,
                    "tint:callback-thunk:" +
                      String(callbackThunk(prototype, -1 - slot)),
                  );
                  emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
                  floatStore(0, resultId);
                  break;
                }
                if (access.operation === "callback-key") {
                  // The image's callback key word (startup resolves it).
                  if (resultId === undefined)
                    throw "c-memory callback key invariant";
                  importAddress(9, 10, "tint:callback-key");
                  emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
                  floatStore(0, resultId);
                  break;
                }
                if (access.operation === "available") {
                  // An absent weak import reads as zero.
                  const symbol = access.symbol;
                  if (resultId === undefined || symbol === undefined)
                    throw "c-memory availability invariant";
                  importAddress(9, 10, host().symbolPrefix + symbol);
                  emit({ op: "ldr", width: 64, rt: 9, rn: 9, offset: 0 });
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
                  saveRaw(9, resultId);
                  break;
                }
                if (base === undefined) throw "c-memory operand invariant";
                if (access.operation === "fits") {
                  // The exact round trip of the c-call conversions, as a
                  // boolean (w9): integral, in range, and for 64-bit types
                  // not a saturation bound.
                  if (resultId === undefined) throw "c-memory fits invariant";
                  const scalar = numericScalar(access.type),
                    bytes = cScalarBytes(scalar),
                    signed = cScalarSigned(scalar, cTarget());
                  floatLoad(0, base);
                  if (bytes === 8) {
                    floatToInteger(12, 0, signed);
                    integerToFloat(1, 12, signed, true);
                    emit({
                      op: "add-imm",
                      width: 64,
                      rd: "zr",
                      rn: 12,
                      immediate: 1,
                      shift: 0,
                      setFlags: true,
                    });
                    emit({
                      op: "cset",
                      rd: 10,
                      condition: signed ? "vc" : "ne",
                    });
                  } else if (bytes === 4 && !signed) {
                    emit({ op: "fcvtzu-w-d", rd: 12, rn: 0 });
                    emit({ op: "ucvtf-d-w", rd: 1, rn: 12 });
                  } else {
                    emit({ op: "fcvtzs-w-d", rd: 12, rn: 0 });
                    emit({ op: "scvtf-d-w", rd: 1, rn: 12 });
                  }
                  emit({ op: "fcmp", rn: 0, rm: 1 });
                  emit({ op: "cset", rd: 9, condition: "eq" });
                  if (bytes < 4) {
                    emit({
                      op: signed ? "sbfm" : "ubfm",
                      width: 32,
                      rd: 10,
                      rn: 12,
                      immr: 0,
                      imms: bytes * 8 - 1,
                    });
                    emit({
                      op: "sub-reg",
                      width: 32,
                      rd: "zr",
                      rn: 10,
                      rm: 12,
                      shift: "lsl",
                      amount: 0,
                      setFlags: true,
                    });
                    emit({ op: "cset", rd: 10, condition: "eq" });
                  }
                  if (bytes !== 4)
                    emit({ op: "and-reg", width: 32, rd: 9, rn: 9, rm: 10 });
                  saveRaw(9, resultId);
                  break;
                }
                if (access.operation === "address") {
                  // The data address of an external (borrowed) array, or -1:
                  // owned and view storage moves with collections.
                  if (resultId === undefined) throw "c-memory result invariant";
                  rawValue(9, base);
                  emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
                  emit({
                    op: "ubfm",
                    width: 64,
                    rd: 10,
                    rn: 10,
                    immr: nativeHeaderFlagsShift,
                    imms: nativeHeaderFlagsShift + 2,
                  });
                  emit({
                    op: "ldr",
                    width: 64,
                    rt: 11,
                    rn: 9,
                    offset: nativeArrayDataOffset,
                  });
                  emit({
                    op: "orn-reg",
                    width: 64,
                    rd: 12,
                    rn: "zr",
                    rm: "zr",
                  });
                  emit({
                    op: "sub-imm",
                    width: 64,
                    rd: "zr",
                    rn: 10,
                    immediate: 1,
                    shift: 0,
                    setFlags: true,
                  });
                  emit({
                    op: "csel",
                    width: 64,
                    rd: 11,
                    rn: 11,
                    rm: 12,
                    condition: "eq",
                  });
                  // Exact: user-space addresses are below 2^53.
                  emit({ op: "scvtf-d-x", rd: 0, rn: 11 });
                  floatStore(0, resultId);
                  break;
                }
                if (access.operation === "retarget") {
                  // An external array (borrowed flag exactly) gets a new data
                  // address, or a view whose owner is one (foreign views):
                  // then both. Lengths are unchanged; collectors never move
                  // external data, so the pair stays consistent.
                  const address = operands[1];
                  if (address === undefined)
                    throw "c-memory retarget invariant";
                  numberToInteger(address, 12, "usize");
                  rawValue(9, base);
                  headerFlags(10, 9);
                  compareImmediate(10, 1);
                  const external = instructions.length;
                  emit({ op: "b.cond", condition: "eq", displacement: 0 });
                  compareImmediate(10, 2);
                  trapIf({ op: "b.cond", condition: "ne" });
                  emit({
                    op: "ldr",
                    width: 64,
                    rt: 11,
                    rn: 9,
                    offset: nativeArrayOwnerOffset,
                  });
                  headerFlags(10, 11);
                  compareImmediate(10, 1);
                  trapIf({ op: "b.cond", condition: "ne" });
                  emit({
                    op: "str",
                    width: 64,
                    rt: 12,
                    rn: 11,
                    offset: nativeArrayDataOffset,
                  });
                  patchInstruction(external, {
                    op: "b.cond",
                    condition: "eq",
                    displacement: (instructions.length - external) * 4,
                  });
                  emit({
                    op: "str",
                    width: 64,
                    rt: 12,
                    rn: 9,
                    offset: nativeArrayDataOffset,
                  });
                  break;
                }
                if (access.operation === "adopt") {
                  // Owned and empty (header exactly the Uint8Array marker,
                  // length 0) becomes an external view: borrowed flag, the
                  // length and the address. The extent is unchanged (both
                  // round to 32 bytes), so collectors see a valid object.
                  const address = operands[1],
                    length = operands[2];
                  if (
                    address === undefined ||
                    length === undefined ||
                    resultId === undefined
                  )
                    throw "c-memory adopt invariant";
                  numberToInteger(address, 12, "usize");
                  numberToInteger(length, 13, "u32");
                  rawValue(9, base);
                  emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
                  emit({
                    op: "sub-imm",
                    width: 64,
                    rd: "zr",
                    rn: 10,
                    immediate: 2,
                    shift: 0,
                    setFlags: true,
                  });
                  trapIf({ op: "b.cond", condition: "ne" });
                  emit({
                    op: "ldr",
                    width: 32,
                    rt: 10,
                    rn: 9,
                    offset: nativeArrayLengthOffset,
                  });
                  trapIf({ op: "cbnz", width: 32, rt: 10 });
                  imm64(10, 2, nativeHeaderFlagUnit / 4294967296);
                  emit({ op: "str", width: 64, rt: 10, rn: 9, offset: 0 });
                  emit({
                    op: "str",
                    width: 64,
                    rt: 13,
                    rn: 9,
                    offset: nativeArrayLengthOffset,
                  });
                  emit({
                    op: "str",
                    width: 64,
                    rt: 12,
                    rn: 9,
                    offset: nativeArrayDataOffset,
                  });
                  saveRaw(9, resultId);
                  break;
                }
                // A C view member: the view's creation proved its size
                // and the lowering checked a stored value and an element
                // index, so this is the data pointer and one access at the
                // constant offset (plus the index times the stride).
                const type = access.type,
                  scalar = numericScalar(type),
                  bytes = cScalarBytes(scalar),
                  signed = cScalarSigned(scalar, cTarget()),
                  stride = access.stride;
                const value = operands[stride === undefined ? 1 : 2];
                if (access.operation === "store") {
                  if (value === undefined) throw "c-memory store invariant";
                  if (scalar === "f64" || scalar === "f32") {
                    floatLoad(0, value);
                    if (scalar === "f32") {
                      emit({ op: "fcvt-s-d", rd: 0, rn: 0 });
                      emit({ op: "fmov-w-s", rd: 12, rn: 0 });
                    }
                  } else if (scalar === "bool") rawValue(12, value);
                  else provenInteger(value, 12, scalar);
                }
                // x11 keeps the view's data pointer for the next access to
                // the same view (viewData); element and unaligned
                // addresses are formed in x13.
                const baseToken = viewValueToken(base);
                if (baseToken !== viewToken) {
                  rawValue(9, base);
                  emit({
                    op: "ldr",
                    width: 64,
                    rt: 11,
                    rn: 9,
                    offset: nativeArrayDataOffset,
                  });
                }
                viewToken = baseToken;
                let at = 11;
                if (stride !== undefined) {
                  // The index is an integer in range (checked before).
                  const index = operands[1];
                  if (index === undefined) throw "c-memory index invariant";
                  let position = 10;
                  if (storedAsInteger(index)) position = rawRegister(index, 10);
                  else {
                    floatLoad(1, index);
                    emit({ op: "fcvtzu-x-d", rd: 10, rn: 1 });
                  }
                  let shift = -1;
                  for (let power = 0; power < 4; power++)
                    if (stride === 1 << power) shift = power;
                  if (shift >= 0)
                    emit({
                      op: "add-reg",
                      width: 64,
                      rd: 13,
                      rn: 11,
                      rm: position,
                      shift: "lsl",
                      amount: shift,
                      setFlags: false,
                    });
                  else {
                    imm(14, stride);
                    emit({
                      op: "madd",
                      width: 64,
                      rd: 13,
                      rn: position,
                      rm: 14,
                      ra: 11,
                    });
                  }
                  at = 13;
                }
                // Scaled immediate when aligned and in reach, else the
                // address is formed first (packed or distant members).
                let offset = access.offset;
                if (offset % bytes !== 0 || offset / bytes > 4095) {
                  if (offset <= 4095)
                    emit({
                      op: "add-imm",
                      width: 64,
                      rd: 13,
                      rn: at,
                      immediate: offset,
                      shift: 0,
                      setFlags: false,
                    });
                  else {
                    imm(10, offset);
                    emit({
                      op: "add-reg",
                      width: 64,
                      rd: 13,
                      rn: at,
                      rm: 10,
                      shift: "lsl",
                      amount: 0,
                      setFlags: false,
                    });
                  }
                  at = 13;
                  offset = 0;
                }
                if (access.operation === "store") {
                  if (scalar === "f64")
                    emit({ op: "str-d", rt: 0, rn: at, offset });
                  else if (bytes === 8)
                    emit({ op: "str", width: 64, rt: 12, rn: at, offset });
                  else if (bytes === 4)
                    emit({ op: "str", width: 32, rt: 12, rn: at, offset });
                  else narrowStore(bytes === 2, 12, at, offset);
                  break;
                }
                if (resultId === undefined) throw "c-memory load invariant";
                if (scalar === "f64") {
                  emit({ op: "ldr-d", rt: 0, rn: at, offset });
                  floatStore(0, resultId);
                  break;
                }
                if (bytes === 8)
                  emit({ op: "ldr", width: 64, rt: 12, rn: at, offset });
                else if (bytes === 4)
                  emit({ op: "ldr", width: 32, rt: 12, rn: at, offset });
                else narrowLoad(bytes === 2, 12, at, offset);
                if (scalar === "bool") {
                  // C's _Bool holds 0 or 1; normalize anyway.
                  emit({
                    op: "sub-imm",
                    width: 32,
                    rd: "zr",
                    rn: 12,
                    immediate: 0,
                    shift: 0,
                    setFlags: true,
                  });
                  emit({ op: "cset", rd: 12, condition: "ne" });
                  saveRaw(12, resultId);
                  break;
                }
                if (scalar === "f32") {
                  emit({ op: "fmov-s-w", rd: 0, rn: 12 });
                  emit({ op: "fcvt-d-s", rd: 0, rn: 0 });
                } else if (bytes === 8) {
                  // Exact or trap, as c-call results.
                  rejectSaturated(12, signed);
                  integerToFloat(0, 12, signed, true);
                  floatToInteger(13, 0, signed);
                  emit({
                    op: "sub-reg",
                    width: 64,
                    rd: "zr",
                    rn: 13,
                    rm: 12,
                    shift: "lsl",
                    amount: 0,
                    setFlags: true,
                  });
                  trapIf({ op: "b.cond", condition: "ne" });
                } else {
                  if (bytes < 4 && signed)
                    emit({
                      op: "sbfm",
                      width: 32,
                      rd: 12,
                      rn: 12,
                      immr: 0,
                      imms: bytes * 8 - 1,
                    });
                  integerToFloat(0, 12, signed, false);
                }
                floatStore(0, resultId);
                break;
              }
              case "c-call": {
                if (op.call.dynamic === true) {
                  dynamicCall(op.call, op.arguments);
                  break;
                }
                // Leaf C call (docs/native-ffi.md): not a safepoint, so no
                // stack map; x19-x28 and d8-d15 homes survive per AAPCS64.
                // Order: stack arguments and indirect copies, X registers
                // (and X8), then V registers last, because integer
                // conversions use d0/d1 as scratch. Helpers use x9-x14,
                // d16 and x16/x17 (the import sequence) only.
                const call = op.call,
                  plan = foreignPlan(call),
                  layout = plan.layout,
                  target = cTarget();
                // An indirect call's callee address comes first: convert
                // it into x15 (untouched by the helpers below) before any
                // argument register is loaded.
                const indirect = call.indirect === true,
                  mayCallback = call.mayCallback === true,
                  // The prototype's operand forms (a may-callback call's
                  // state operand comes first).
                  forms = mayCallback ? call.operands.slice(2) : call.operands;
                let operands = op.arguments;
                // A may-callback call pushes its transition record onto the
                // calling thread's callback state block (operand 0) before
                // any argument register is loaded: previous record, this
                // frame's x29, the call's return address (patched once the
                // blr is emitted) and a clear entered flag.
                let returnAddressAt = -1,
                  stateOperand = -1;
                // Callback operands: their thunks, and the transition words
                // holding their function values.
                const callbackThunks: number[] = [],
                  callbackWords: number[] = [];
                if (mayCallback) {
                  const state = operands[0],
                    dispatcher = operands[1];
                  if (state === undefined || dispatcher === undefined)
                    throw "c-call state invariant";
                  stateOperand = state;
                  operands = operands.slice(2);
                  const callees: number[] = [];
                  for (let index = 0; index < operands.length; index++) {
                    if (call.operands[index + 2] !== "callback") continue;
                    const prototype = call.callbacks?.[index],
                      callee = operands[index];
                    if (prototype === undefined || callee === undefined)
                      throw "c-call callback invariant";
                    callbackThunks[index] = callbackThunk(
                      prototype,
                      callees.length,
                    );
                    callees.push(callee);
                  }
                  returnAddressAt = pushTransition(
                    state,
                    dispatcher,
                    callees,
                    plan.transition,
                    callbackWords,
                  );
                }
                if (indirect) {
                  const callee = operands[0];
                  if (callee === undefined) throw "c-call callee invariant";
                  numberToInteger(callee, 15, "usize");
                  trapIf({ op: "cbz", width: 64, rt: 15 });
                  operands = operands.slice(1);
                }
                function operand(index: number): number {
                  const id = operands[index];
                  if (id === undefined) throw "c-call argument invariant";
                  return id;
                }
                // Stack arguments and indirect copies.
                for (let index = 0; index < layout.arguments.length; index++) {
                  const location = layout.arguments[index],
                    form = forms[index],
                    type = call.signature.parameters[index];
                  if (
                    location === undefined ||
                    form === undefined ||
                    type === undefined
                  )
                    throw "c-call location invariant";
                  const id = operand(index);
                  if (location.class === "indirect") {
                    const copy = plan.copies[index] ?? -1;
                    dataPointer(id, 12, false, plan.minimums[index] ?? 0);
                    copyToFrame(copy, location.size);
                    if (location.stackOffset >= 0) {
                      address(14, copy);
                      emit({
                        op: "str",
                        width: 64,
                        rt: 14,
                        rn: "sp",
                        offset: location.stackOffset,
                      });
                    }
                    continue;
                  }
                  if (location.stackOffset < 0) continue;
                  const offset = location.stackOffset;
                  if (
                    location.class === "composite" ||
                    location.class === "hfa"
                  ) {
                    dataPointer(id, 12, false, plan.minimums[index] ?? 0);
                    copyToFrame(offset, location.size);
                  } else if (location.class === "float") {
                    floatLoad(16, id);
                    if (location.size === 4 && !location.variadic) {
                      emit({ op: "fcvt-s-d", rd: 16, rn: 16 });
                      emit({ op: "fmov-w-s", rd: 14, rn: 16 });
                      emit({ op: "str", width: 32, rt: 14, rn: "sp", offset });
                    } else emit({ op: "str-d", rt: 16, rn: "sp", offset });
                  } else if (form === "callback") {
                    thunkAddress(14, callbackThunks[index]);
                    emit({ op: "str", width: 64, rt: 14, rn: "sp", offset });
                  } else if (form === "bytes" || form === "terminated-bytes") {
                    dataPointer(
                      id,
                      14,
                      form === "terminated-bytes",
                      plan.minimums[index] ?? 0,
                    );
                    emit({ op: "str", width: 64, rt: 14, rn: "sp", offset });
                  } else {
                    const scalar = numericScalar(type);
                    // A promoted variadic integer is range-checked as its
                    // declared type and fills its 8-byte slot.
                    if (form === "boolean") rawValue(14, id);
                    else numberToInteger(id, 14, scalar);
                    const bytes = location.variadic ? 8 : cScalarBytes(scalar);
                    if (bytes === 8)
                      emit({ op: "str", width: 64, rt: 14, rn: "sp", offset });
                    else if (bytes === 4)
                      emit({ op: "str", width: 32, rt: 14, rn: "sp", offset });
                    else narrowStore(bytes === 2, 14, "sp", offset);
                  }
                }
                // X registers.
                for (let index = 0; index < layout.arguments.length; index++) {
                  const location = layout.arguments[index],
                    form = forms[index],
                    type = call.signature.parameters[index];
                  if (
                    location === undefined ||
                    form === undefined ||
                    type === undefined
                  )
                    throw "c-call location invariant";
                  if (location.stackOffset >= 0 || location.gp < 0) continue;
                  const id = operand(index),
                    rd = location.gp;
                  if (location.class === "indirect")
                    address(rd, plan.copies[index] ?? 0);
                  else if (location.class === "composite") {
                    dataPointer(id, 12, false, plan.minimums[index] ?? 0);
                    for (let word = 0; word < location.registers; word++)
                      loadBytes(
                        rd + word,
                        12,
                        word * 8,
                        Math.min(8, location.size - word * 8),
                      );
                  } else if (form === "callback")
                    thunkAddress(rd, callbackThunks[index]);
                  else if (form === "bytes" || form === "terminated-bytes")
                    dataPointer(
                      id,
                      rd,
                      form === "terminated-bytes",
                      plan.minimums[index] ?? 0,
                    );
                  else if (form === "boolean") rawValue(rd, id);
                  else numberToInteger(id, rd, numericScalar(type));
                }
                const results = operands.length - layout.arguments.length;
                if (results === 1) {
                  dataPointer(
                    operand(layout.arguments.length),
                    layout.result.class === "indirect" ? 8 : -1,
                    false,
                    plan.resultBytes,
                  );
                }
                // V registers.
                for (let index = 0; index < layout.arguments.length; index++) {
                  const location = layout.arguments[index];
                  if (location === undefined) throw "c-call location invariant";
                  if (location.stackOffset >= 0 || location.fp < 0) continue;
                  const id = operand(index),
                    rd = location.fp;
                  if (location.class === "float") {
                    floatLoad(rd, id);
                    if (location.size === 4)
                      emit({ op: "fcvt-s-d", rd, rn: rd });
                  } else {
                    dataPointer(id, 12, false, plan.minimums[index] ?? 0);
                    for (
                      let member = 0;
                      member < location.registers;
                      member++
                    ) {
                      if (location.memberBytes === 8)
                        emit({
                          op: "ldr-d",
                          rt: rd + member,
                          rn: 12,
                          offset: member * 8,
                        });
                      else {
                        emit({
                          op: "ldr",
                          width: 32,
                          rt: 13,
                          rn: 12,
                          offset: member * 4,
                        });
                        emit({ op: "fmov-s-w", rd: rd + member, rn: 13 });
                      }
                    }
                  }
                }
                if (indirect) emit({ op: "blr", rn: 15 });
                else importCall(host().symbolPrefix + call.symbol);
                if (mayCallback)
                  popTransition(
                    stateOperand,
                    plan.transition,
                    returnAddressAt,
                    callbackWords,
                  );
                const resultId = op.id,
                  result = layout.result,
                  resultType = call.signature.result;
                if (call.result === "record") {
                  if (result.class !== "indirect") {
                    // Reload the result buffer's data pointer (its home is
                    // callee-saved or in the frame).
                    rawValue(9, operand(layout.arguments.length));
                    emit({
                      op: "ldr",
                      width: 64,
                      rt: 12,
                      rn: 9,
                      offset: nativeArrayDataOffset,
                    });
                    if (result.class === "composite")
                      for (let word = 0; word < result.registers; word++)
                        storeBytes(
                          word,
                          12,
                          word * 8,
                          Math.min(8, result.size - word * 8),
                        );
                    else
                      for (
                        let member = 0;
                        member < result.registers;
                        member++
                      ) {
                        if (result.memberBytes === 8)
                          emit({
                            op: "str-d",
                            rt: member,
                            rn: 12,
                            offset: member * 8,
                          });
                        else {
                          emit({ op: "fmov-w-s", rd: 13, rn: member });
                          emit({
                            op: "str",
                            width: 32,
                            rt: 13,
                            rn: 12,
                            offset: member * 4,
                          });
                        }
                      }
                  }
                  break;
                }
                if (call.result === "void") break;
                if (resultId === undefined)
                  throw "verified c-call result invariant";
                const scalar = numericScalar(resultType);
                if (call.result === "boolean") {
                  emit({
                    op: "ubfm",
                    width: 32,
                    rd: 0,
                    rn: 0,
                    immr: 0,
                    imms: 7,
                  });
                  saveRaw(0, resultId);
                  break;
                }
                if (scalar === "f32" || scalar === "f64") {
                  if (scalar === "f32") emit({ op: "fcvt-d-s", rd: 0, rn: 0 });
                  floatStore(0, resultId);
                  break;
                }
                const bytes = cScalarBytes(scalar),
                  signed = cScalarSigned(scalar, target),
                  wide = bytes === 8;
                if (bytes < 4)
                  emit({
                    op: signed ? "sbfm" : "ubfm",
                    width: 32,
                    rd: 0,
                    rn: 0,
                    immr: 0,
                    imms: bytes * 8 - 1,
                  });
                let success = -1,
                  finish = -1;
                if (call.signature.errno === "negated-result") {
                  // Exactly the host operations' -errno protocol.
                  emit({
                    op: "sub-imm",
                    width: wide ? 64 : 32,
                    rd: "zr",
                    rn: 0,
                    immediate: 0,
                    shift: 0,
                    setFlags: true,
                  });
                  success = instructions.length;
                  emit({ op: "b.cond", condition: "ge", displacement: 0 });
                  importCall(host().errnoSymbol);
                  emit({ op: "ldr", width: 32, rt: 9, rn: 0, offset: 0 });
                  emit({ op: "scvtf-d-w", rd: 0, rn: 9 });
                  emit({ op: "fneg", rd: 0, rn: 0 });
                  finish = instructions.length;
                  emit({ op: "b", displacement: 0 });
                }
                const good = instructions.length;
                if (wide) {
                  // 64-bit results must be exact numbers (|x| <= 2^53 or
                  // otherwise representable); anything else traps.
                  rejectSaturated(0, signed);
                  integerToFloat(0, 0, signed, true);
                  floatToInteger(9, 0, signed);
                  emit({
                    op: "sub-reg",
                    width: 64,
                    rd: "zr",
                    rn: 9,
                    rm: 0,
                    shift: "lsl",
                    amount: 0,
                    setFlags: true,
                  });
                  trapIf({ op: "b.cond", condition: "ne" });
                } else integerToFloat(0, 0, signed || bytes < 4, false);
                const done = instructions.length;
                if (success >= 0) {
                  patchInstruction(success, {
                    op: "b.cond",
                    condition: "ge",
                    displacement: (good - success) * 4,
                  });
                  patchInstruction(finish, {
                    op: "b",
                    displacement: (done - finish) * 4,
                  });
                }
                floatStore(0, resultId);
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
                  trapIf({ op: "b.cond", condition: "ne" });
                }
                function bytes(
                  index: number,
                  register: number,
                  path: boolean,
                ): void {
                  rawValue(9, argument(index));
                  emit({
                    op: "ldr",
                    width: 32,
                    rt: 10,
                    rn: 9,
                    offset: nativeArrayLengthOffset,
                  });
                  emit({
                    op: "ldr",
                    width: 64,
                    rt: register,
                    rn: 9,
                    offset: nativeArrayDataOffset,
                  });
                  if (path) {
                    trapIf({ op: "cbz", width: 32, rt: 10 });
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
                    trapIf({ op: "cbnz", width: 32, rt: 11 });
                  }
                }
                /** futex(2) through `syscall(number, cell, operation,
                 * ...)`: a wait passes the expected word and a relative
                 * timespec (null for an indefinite park, timeout 0); a
                 * wake releases one waiter or, when `all` is 1, every
                 * waiter. Leaves the raw status in x0, -errno on failure
                 * (the statuses the Darwin ulock calls report). */
                function futexCall(
                  wait: boolean,
                  symbol: string,
                  number: number,
                  operation: number,
                ): void {
                  integer(0, 1, true);
                  if (wait) {
                    integer(1, 3, true);
                    integer(2, 9, true);
                    imm(4, 0);
                    const indefinite = instructions.length;
                    emit({ op: "cbz", width: 64, rt: 9, displacement: 0 });
                    imm(10, 1000000000);
                    emit({ op: "sdiv", width: 64, rd: 11, rn: 9, rm: 10 });
                    emit({
                      op: "msub",
                      width: 64,
                      rd: 12,
                      rn: 11,
                      rm: 10,
                      ra: 9,
                    });
                    emit({
                      op: "str",
                      width: 64,
                      rt: 11,
                      rn: "sp",
                      offset: resultOffset,
                    });
                    emit({
                      op: "str",
                      width: 64,
                      rt: 12,
                      rn: "sp",
                      offset: resultOffset + 8,
                    });
                    address(4, resultOffset);
                    patchInstruction(indefinite, {
                      op: "cbz",
                      width: 64,
                      rt: 9,
                      displacement: (instructions.length - indefinite) * 4,
                    });
                  } else {
                    // all is an already validated 0/1 scalar.
                    integer(1, 9);
                    imm(3, 1);
                    const one = instructions.length;
                    emit({ op: "cbz", width: 32, rt: 9, displacement: 0 });
                    imm(3, 2147483647);
                    patchInstruction(one, {
                      op: "cbz",
                      width: 32,
                      rt: 9,
                      displacement: (instructions.length - one) * 4,
                    });
                  }
                  imm(0, number);
                  imm(2, operation);
                  importCall(symbol);
                  emit({
                    op: "sub-imm",
                    width: 64,
                    rd: "zr",
                    rn: 0,
                    immediate: 0,
                    shift: 0,
                    setFlags: true,
                  });
                  const success = instructions.length;
                  emit({ op: "b.cond", condition: "ge", displacement: 0 });
                  importCall(host().errnoSymbol);
                  emit({ op: "ldr", width: 32, rt: 9, rn: 0, offset: 0 });
                  emit({
                    op: "sub-reg",
                    width: 64,
                    rd: 0,
                    rn: "zr",
                    rm: 9,
                    shift: "lsl",
                    amount: 0,
                    setFlags: false,
                  });
                  patchInstruction(success, {
                    op: "b.cond",
                    condition: "ge",
                    displacement: (instructions.length - success) * 4,
                  });
                }
                /** One SHA-256 block over typed arrays (state: 8 words,
                 * schedule: 64 words, the first 16 holding the block's
                 * big-endian words as numbers; constants: 64 words), with
                 * the ARMv8 SHA-256 instructions: as the portable
                 * compressSha256RoundsPortable, it writes schedule words 16-63 and
                 * adds the compressed block into state. Short views trap.
                 * Uses only v0-v7 (d8-d15 homes and d16-d31 temporaries
                 * stay untouched) and x9-x14. */
                function sha256Rounds(
                  state: number,
                  schedule: number,
                  constants: number,
                ): void {
                  const views = [state, schedule, constants],
                    minimums = [8, 64, 64];
                  for (let view = 0; view < 3; view++) {
                    rawValue(9, views[view] ?? 0);
                    emit({
                      op: "ldr",
                      width: 32,
                      rt: 10,
                      rn: 9,
                      offset: nativeArrayLengthOffset,
                    });
                    emit({
                      op: "sub-imm",
                      width: 64,
                      rd: "zr",
                      rn: 10,
                      immediate: minimums[view] ?? 0,
                      shift: 0,
                      setFlags: true,
                    });
                    trapIf({ op: "b.cond", condition: "cc" });
                    emit({
                      op: "ldr",
                      width: 64,
                      rt: 12 + view,
                      rn: 9,
                      offset: nativeArrayDataOffset,
                    });
                  }
                  // v0 = ABCD, v1 = EFGH, v4-v7 = schedule words 4j..4j+3.
                  emit({ op: "ldr-q", qt: 0, rn: 12, offset: 0 });
                  emit({ op: "ldr-q", qt: 1, rn: 12, offset: 16 });
                  for (let j = 0; j < 4; j++)
                    emit({ op: "ldr-q", qt: 4 + j, rn: 13, offset: 16 * j });
                  for (let group = 0; group < 16; group++) {
                    const w = 4 + (group % 4);
                    emit({ op: "ldr-q", qt: 3, rn: 14, offset: 16 * group });
                    emit({ op: "add-4s", vd: 3, vn: 3, vm: w });
                    if (group < 12)
                      emit({
                        op: "sha256su0",
                        vd: w,
                        vn: 4 + ((group + 1) % 4),
                      });
                    emit({ op: "mov-16b", vd: 2, vn: 0 });
                    emit({ op: "sha256h", vd: 0, vn: 1, vm: 3 });
                    emit({ op: "sha256h2", vd: 1, vn: 2, vm: 3 });
                    if (group < 12) {
                      emit({
                        op: "sha256su1",
                        vd: w,
                        vn: 4 + ((group + 2) % 4),
                        vm: 4 + ((group + 3) % 4),
                      });
                      // Schedule words 16 + 4 * group .. + 3.
                      emit({
                        op: "str-q",
                        qt: w,
                        rn: 13,
                        offset: 64 + 16 * group,
                      });
                    }
                  }
                  emit({ op: "ldr-q", qt: 2, rn: 12, offset: 0 });
                  emit({ op: "add-4s", vd: 0, vn: 0, vm: 2 });
                  emit({ op: "ldr-q", qt: 2, rn: 12, offset: 16 });
                  emit({ op: "add-4s", vd: 1, vn: 1, vm: 2 });
                  emit({ op: "str-q", qt: 0, rn: 12, offset: 0 });
                  emit({ op: "str-q", qt: 1, rn: 12, offset: 16 });
                }
                const foreign = importCall;
                const operation = op.operation;
                /** Inline control flow with named labels for host
                 * sequences built outside this emitter; `finish` patches
                 * the branches. A label forgets forwarded stack words,
                 * since its branches arrive with other register contents. */
                function inlineSequence(): InlineSequenceBuilder {
                  const labels = new Map<string, number>(),
                    fixups: InlineFixup[] = [];
                  function label(name: string): void {
                    if (labels.has(name)) throw "duplicate inline label";
                    labels.set(name, instructions.length);
                    stackWords.clear();
                  }
                  function branch(
                    name: string,
                    condition: Condition | undefined = undefined,
                  ): void {
                    fixups.push({
                      index: instructions.length,
                      label: name,
                      condition,
                    });
                    if (condition === undefined)
                      emit({ op: "b", displacement: 0 });
                    else emit({ op: "b.cond", condition, displacement: 0 });
                  }
                  function load(rt: number, word: number): void {
                    emit({
                      op: "ldr",
                      width: 64,
                      rt,
                      rn: "sp",
                      offset: resultOffset + word * 8,
                    });
                  }
                  function store(rt: number | "zr", word: number): void {
                    emit({
                      op: "str",
                      width: 64,
                      rt,
                      rn: "sp",
                      offset: resultOffset + word * 8,
                    });
                  }
                  function constant(
                    rd: number,
                    lo: number,
                    hi: number = 0,
                  ): void {
                    imm64(rd, lo, hi);
                  }
                  function wordAddress(rd: number, word: number): void {
                    address(rd, resultOffset + word * 8);
                  }
                  function finish(): void {
                    for (const fixup of fixups) {
                      if (fixup === undefined) throw "inline fixup invariant";
                      const target = labels.get(fixup.label);
                      if (target === undefined) throw "missing inline label";
                      const displacement = (target - fixup.index) * 4,
                        condition = fixup.condition;
                      if (condition === undefined)
                        patchInstruction(fixup.index, {
                          op: "b",
                          displacement,
                        });
                      else
                        patchInstruction(fixup.index, {
                          op: "b.cond",
                          condition,
                          displacement,
                        });
                    }
                  }
                  return {
                    emit,
                    label,
                    branch,
                    call: importCall,
                    load,
                    store,
                    constant,
                    address: wordAddress,
                    finish,
                  };
                }
                if (operation === "cpu-pause") {
                  emit({ op: "yield" });
                  break;
                }
                if (operation === "sha256-rounds") {
                  sha256Rounds(argument(0), argument(1), argument(2));
                  break;
                }
                if (operation === "collect-garbage") {
                  // Allocation slow-path ABI with request size 0, which the
                  // runtime allocators reserve for a forced full collection
                  // (no allocation producer passes 0). Exhaustion throws through
                  // the exceptional edge; any other result is an invariant trap.
                  zeroWords([
                    resultOffset,
                    resultOffset + 8,
                    resultOffset + 16,
                    resultOffset + 24,
                  ]);
                  rawLoad(0, contextOffset);
                  emit({ op: "ldr", width: 64, rt: 1, rn: 0, offset: 24 });
                  emit({ op: "ldr", width: 64, rt: 16, rn: 0, offset: 16 });
                  emit({ op: "cbnz", width: 64, rt: 16, displacement: 8 });
                  emit({ op: "brk", immediate: 3 });
                  imm(2, 0);
                  address(3, resultOffset);
                  imm(9, 0);
                  emit({ op: "ucvtf-d-w", rd: 0, rn: 9 });
                  emit({ op: "blr", rn: 16 });
                  safepoint();
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
                  // The acknowledgement is the number +0 (all-zero bits),
                  // which also rules out `undefined` (one NaN-boxed word).
                  rawLoad(9, resultOffset + 16);
                  emit({ op: "cbz", width: 64, rt: 9, displacement: 8 });
                  emit({ op: "brk", immediate: 3 });
                  break;
                }
                if (operation === "jit-debug-register") {
                  // The hosted __jit_debug_register_code (jitDebugInterface
                  // images), where an attached debugger loads new entries.
                  startupCalls.push({
                    offset: instructions.length * 4,
                    target: "jit-register",
                  });
                  emit({ op: "bl", displacement: 0 });
                  break;
                }
                const resultId = op.id;
                if (resultId === undefined)
                  throw "verified host result invariant";
                if (operation === "word-park" || operation === "word-wake") {
                  const parking = host().parking;
                  if (parking === undefined)
                    fail("UNSUPPORTED", "target has no word parking ABI");
                  if (parking.kind === "linux-futex") {
                    futexCall(
                      operation === "word-park",
                      parking.syscallSymbol,
                      parking.futexSyscall,
                      operation === "word-park"
                        ? parking.waitOperation
                        : parking.wakeOperation,
                    );
                    emit({ op: "scvtf-d-x", rd: 0, rn: 0 });
                    floatStore(0, resultId);
                    break;
                  }
                  const flags = parking.compareOperation + parking.noErrnoFlag;
                  integer(0, 1, true);
                  if (operation === "word-park") {
                    integer(1, 2, true);
                    integer(2, 3, true);
                    imm(0, flags);
                    imm(4, 0);
                    // XNU's locked copyin cannot fault a new mapping in. Touch the
                    // caller-owned cell first; this is not waiter linearization.
                    emit({ op: "ldr", width: 32, rt: 9, rn: 1, offset: 0 });
                    foreign(parking.waitSymbol);
                  } else {
                    integer(1, 9);
                    imm(0, flags);
                    // all is an already validated 0/1 scalar, not a Script value.
                    const one = instructions.length;
                    emit({ op: "cbz", width: 32, rt: 9, displacement: 0 });
                    imm(0, flags + parking.wakeAllFlag);
                    patchInstruction(one, {
                      op: "cbz",
                      width: 32,
                      rt: 9,
                      displacement: (instructions.length - one) * 4,
                    });
                    imm(2, 0);
                    foreign(parking.wakeSymbol);
                  }
                  emit({ op: "scvtf-d-w", rd: 0, rn: 0 });
                  floatStore(0, resultId);
                  break;
                }
                if (
                  operation === "hosted-thread-entry" ||
                  operation === "collector-worker-entry"
                ) {
                  imports.push({
                    offset: instructions.length * 4,
                    rd: 9,
                    scratch: 17,
                    target: {
                      kind: "import",
                      name: "tint:" + operation,
                    },
                  });
                  relativePointer(9);
                  emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
                  floatStore(0, resultId);
                  break;
                }
                if (
                  operation === "thread-start" ||
                  operation === "thread-join"
                ) {
                  const threads = host().threads;
                  if (threads === undefined)
                    fail("UNSUPPORTED", "target has no thread lifecycle ABI");
                  rawStore("zr", resultOffset);
                  if (operation === "thread-start") {
                    address(0, resultOffset);
                    imm(1, 0);
                    integer(0, 2, true);
                    integer(1, 3, true);
                    foreign(threads.createSymbol);
                  } else {
                    integer(0, 0, true);
                    address(1, resultOffset);
                    foreign(threads.joinSymbol);
                  }
                  // pthread routines return an error number directly, not errno.
                  emit({ op: "scvtf-d-w", rd: 0, rn: 0 });
                  emit({ op: "fneg", rd: 0, rn: 0 });
                  const failed = instructions.length;
                  emit({ op: "cbnz", width: 32, rt: 0, displacement: 0 });
                  rawLoad(9, resultOffset);
                  emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
                  patchInstruction(failed, {
                    op: "cbnz",
                    width: 32,
                    rt: 0,
                    displacement: (instructions.length - failed) * 4,
                  });
                  floatStore(0, resultId);
                  break;
                }
                if (operation === "executable-call-managed") {
                  if (host().executableMemory === undefined)
                    fail("UNSUPPORTED", "target has no executable-memory ABI");
                  zeroWords([
                    resultOffset,
                    resultOffset + 8,
                    resultOffset + 16,
                    resultOffset + 24,
                  ]);
                  rawLoad(0, contextOffset);
                  imm(1, 0);
                  imm(2, 0);
                  address(3, resultOffset);
                  rawValue(4, argument(1));
                  integer(0, 16, true);
                  emit({ op: "blr", rn: 16 });
                  safepoint();
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
                  safepoint();
                  emit({
                    op: "sub-imm",
                    width: 32,
                    rd: "zr",
                    rn: 0,
                    immediate: 1,
                    shift: 0,
                    setFlags: true,
                  });
                  trapIf({ op: "b.cond", condition: "ne" });
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
                if (
                  operation === "executable-write" ||
                  operation === "memory-write-bytes"
                ) {
                  // memory-write-bytes is the same bounded copy into an
                  // ordinary writable window: no protection toggles, cache
                  // maintenance or instruction alignment.
                  const raw = operation === "memory-write-bytes";
                  const executable = host().executableMemory;
                  if (executable === undefined && !raw)
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
                  for (const register of raw ? [] : [0, 2, 10]) {
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
                  // Darwin toggles the thread's MAP_JIT protection around
                  // the copy; Linux copies through the arena's writable view.
                  const dualMapping = raw ? undefined : dualMappingOf(host());
                  if (dualMapping !== undefined) {
                    const sequence = inlineSequence();
                    emitDualMappingWrite(sequence, dualMapping.symbols, reject);
                    sequence.finish();
                  } else {
                    let writeProtect = "",
                      cacheInvalidate = "";
                    if (
                      !raw &&
                      executable !== undefined &&
                      executable.kind === "darwin-jit"
                    ) {
                      writeProtect = executable.writeProtectSymbol;
                      cacheInvalidate = executable.instructionCacheSymbol;
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
                    if (writeProtect !== "") {
                      imm(0, 0);
                      foreign(writeProtect);
                    }
                    rawLoad(0, resultOffset);
                    rawLoad(1, resultOffset + 8);
                    rawLoad(2, resultOffset + 16);
                    foreign(host().symbolPrefix + "memmove");
                    if (writeProtect !== "") {
                      rawLoad(0, resultOffset);
                      rawLoad(1, resultOffset + 16);
                      foreign(cacheInvalidate);
                      imm(0, 1);
                      foreign(writeProtect);
                    }
                  }
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
                      throw "executable guard invariant";
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
                if (operation === "jit-debug-descriptor") {
                  // The hosted routine returns the descriptor's address in x0.
                  startupCalls.push({
                    offset: instructions.length * 4,
                    target: "jit-descriptor",
                  });
                  emit({ op: "bl", displacement: 0 });
                  emit({ op: "scvtf-d-x", rd: 0, rn: 0 });
                  floatStore(0, resultId);
                  break;
                }
                if (operation === "target-os") {
                  imm(
                    9,
                    host().os === "darwin"
                      ? nativeTargetOSDarwin
                      : nativeTargetOSLinux,
                  );
                  emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
                  floatStore(0, resultId);
                  break;
                }
                if (operation === "process-id") {
                  foreign(host().symbolPrefix + "getpid");
                  emit({ op: "scvtf-d-w", rd: 0, rn: 0 });
                  floatStore(0, resultId);
                  break;
                }
                if (operation === "memory-page-bytes") {
                  const pageSize = host().pageSize;
                  if (pageSize.kind === "fixed") imm(0, pageSize.bytes);
                  else foreign(pageSize.symbol);
                  emit({ op: "scvtf-d-w", rd: 0, rn: 0 });
                  floatStore(0, resultId);
                  break;
                }
                if (operation === "processor-count") {
                  const processors = host().processors;
                  if (processors.kind === "sysconf") {
                    // sysconf returns -1 when the count is unknown: 0.
                    imm(0, processors.name);
                    foreign(processors.symbol);
                    emit({
                      op: "sub-imm",
                      width: 64,
                      rd: "zr",
                      rn: 0,
                      immediate: 0,
                      shift: 0,
                      setFlags: true,
                    });
                    emit({
                      op: "csel",
                      width: 64,
                      rd: 10,
                      rn: 0,
                      rm: "zr",
                      condition: "gt",
                    });
                  } else {
                    // sched_getaffinity(0, maskBytes, outgoing area): 0 on
                    // success (a failure, such as a mask wider than the
                    // buffer, counts 0: unknown). Then count the set bits
                    // of each mask word (x9 &= x9 - 1 until zero).
                    const maskBytes = processors.maskBytes;
                    imm(0, 0);
                    imm(1, maskBytes);
                    address(2, 0);
                    foreign(processors.symbol);
                    imm(10, 0);
                    const failed = instructions.length;
                    emit({ op: "cbnz", width: 32, rt: 0, displacement: 0 });
                    imm(11, 0);
                    const word = instructions.length;
                    emit({
                      op: "ldr-indexed",
                      size: 3,
                      fp: false,
                      rt: 9,
                      rn: "sp",
                      rm: 11,
                      scaled: false,
                    });
                    const bit = instructions.length;
                    emit({ op: "cbz", width: 64, rt: 9, displacement: 20 });
                    emit({
                      op: "sub-imm",
                      width: 64,
                      rd: 12,
                      rn: 9,
                      immediate: 1,
                      shift: 0,
                      setFlags: false,
                    });
                    emit({ op: "and-reg", width: 64, rd: 9, rn: 9, rm: 12 });
                    emit({
                      op: "add-imm",
                      width: 64,
                      rd: 10,
                      rn: 10,
                      immediate: 1,
                      shift: 0,
                      setFlags: false,
                    });
                    emit({
                      op: "b",
                      displacement: (bit - instructions.length) * 4,
                    });
                    emit({
                      op: "add-imm",
                      width: 64,
                      rd: 11,
                      rn: 11,
                      immediate: 8,
                      shift: 0,
                      setFlags: false,
                    });
                    emit({
                      op: "sub-imm",
                      width: 64,
                      rd: "zr",
                      rn: 11,
                      immediate: maskBytes,
                      shift: 0,
                      setFlags: true,
                    });
                    emit({
                      op: "b.cond",
                      condition: "ne",
                      displacement: (word - instructions.length) * 4,
                    });
                    patchInstruction(failed, {
                      op: "cbnz",
                      width: 32,
                      rt: 0,
                      displacement: (instructions.length - failed) * 4,
                    });
                  }
                  emit({ op: "scvtf-d-x", rd: 0, rn: 10 });
                  floatStore(0, resultId);
                  break;
                }
                if (operation === "cpu-sha256") {
                  const sha256 = host().sha256Instructions;
                  if (sha256.kind === "baseline") imm(9, 1);
                  else {
                    // symbol(type) & mask, as 1 or 0.
                    imm(0, sha256.type);
                    foreign(sha256.symbol);
                    imm(10, sha256.mask);
                    emit({ op: "and-reg", width: 64, rd: 9, rn: 0, rm: 10 });
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
                  emit({ op: "scvtf-d-w", rd: 0, rn: 9 });
                  floatStore(0, resultId);
                  break;
                }
                if (operation === "random-word") {
                  const random = host().random;
                  if (random.kind === "fill") {
                    // getrandom(&word, 4, 0): small requests from an
                    // initialized pool never return short; anything else
                    // (an unsupported kernel) traps.
                    address(0, resultOffset);
                    imm(1, 4);
                    imm(2, 0);
                    foreign(random.symbol);
                    emit({
                      op: "sub-imm",
                      width: 64,
                      rd: "zr",
                      rn: 0,
                      immediate: 4,
                      shift: 0,
                      setFlags: true,
                    });
                    trapIf({ op: "b.cond", condition: "ne" });
                    emit({
                      op: "ldr",
                      width: 32,
                      rt: 0,
                      rn: "sp",
                      offset: resultOffset,
                    });
                  } else foreign(random.symbol);
                  emit({ op: "ucvtf-d-w", rd: 0, rn: 0 });
                  floatStore(0, resultId);
                  break;
                }
                if (
                  operation === "monotonic-time" ||
                  operation === "wall-clock-time"
                ) {
                  const clock = host().clock;
                  imm(
                    0,
                    operation === "monotonic-time"
                      ? clock.monotonicId
                      : clock.wallId,
                  );
                  if (clock.kind === "timespec") {
                    // clock_gettime(id, &timespec) cannot fail for the
                    // supported clocks; nanoseconds = seconds * 1e9 + nsec.
                    address(1, resultOffset);
                    foreign(clock.symbol);
                    trapIf({ op: "cbnz", width: 32, rt: 0 });
                    emit({
                      op: "ldr",
                      width: 64,
                      rt: 9,
                      rn: "sp",
                      offset: resultOffset,
                    });
                    emit({
                      op: "ldr",
                      width: 64,
                      rt: 10,
                      rn: "sp",
                      offset: resultOffset + 8,
                    });
                    imm(11, 1000000000);
                    emit({
                      op: "madd",
                      width: 64,
                      rd: 0,
                      rn: 9,
                      rm: 11,
                      ra: 10,
                    });
                  } else foreign(clock.symbol);
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
                    emit({
                      op: "ldr",
                      width: 32,
                      rt: 10,
                      rn: 9,
                      offset: nativeArrayLengthOffset,
                    });
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
                    emit({
                      op: "ldr",
                      width: 64,
                      rt: 0,
                      rn: 9,
                      offset: nativeArrayDataOffset,
                    });
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
                  for (const instruction of externalMemoryCapability(
                    configure,
                  )) {
                    if (instruction === undefined)
                      throw "external memory instruction invariant";
                    emit(instruction);
                  }
                  emit({ op: "scvtf-d-x", rd: 0, rn: 0 });
                  floatStore(0, resultId);
                  break;
                }
                if (
                  operation === "permanent-function-address" ||
                  operation === "permanent-array-address"
                ) {
                  rawValue(9, argument(0));
                  // Typed arrays keep their data address after the length.
                  if (operation === "permanent-array-address")
                    emit({
                      op: "ldr",
                      width: 64,
                      rt: 9,
                      rn: 9,
                      offset: nativeArrayDataOffset,
                    });
                  emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
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
                  emit({
                    op: "ldr",
                    width: 32,
                    rt: 9,
                    rn: 10,
                    offset: nativeArrayLengthOffset,
                  });
                  imm(12, generational ? 16 : 8);
                  compareState(9, 12);
                  requireState("cc");
                  emit({
                    op: "ldr",
                    width: 32,
                    rt: 13,
                    rn: 11,
                    offset: nativeArrayLengthOffset,
                  });
                  emit({
                    op: "ldr",
                    width: 64,
                    rt: 12,
                    rn: 10,
                    offset: nativeArrayDataOffset,
                  });
                  emit({
                    op: "ldr",
                    width: 64,
                    rt: 14,
                    rn: 11,
                    offset: nativeArrayDataOffset,
                  });
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
                    immediate: 255,
                    shift: 0,
                    setFlags: false,
                  });
                  emit({
                    op: "ubfm",
                    width: 64,
                    rd: 9,
                    rn: 9,
                    immr: 8,
                    imms: 63,
                  });
                  compareState(13, 9);
                  requireState("cc");
                  if (generational) {
                    rawValue(15, argument(2));
                    emit({
                      op: "ldr",
                      width: 32,
                      rt: 13,
                      rn: 15,
                      offset: nativeArrayLengthOffset,
                    });
                    emit({
                      op: "ldr",
                      width: 64,
                      rt: 15,
                      rn: 15,
                      offset: nativeArrayDataOffset,
                    });
                    emit({
                      op: "add-imm",
                      width: 64,
                      rd: 9,
                      rn: 17,
                      immediate: 63,
                      shift: 0,
                      setFlags: false,
                    });
                    emit({
                      op: "ubfm",
                      width: 64,
                      rd: 9,
                      rn: 9,
                      immr: 6,
                      imms: 63,
                    });
                    compareState(13, 9);
                    requireState("cc");
                    rawValue(16, argument(3));
                    emit({
                      op: "ldr",
                      width: 32,
                      rt: 13,
                      rn: 16,
                      offset: nativeArrayLengthOffset,
                    });
                    imm(9, 1);
                    compareState(13, 9);
                    requireState("cc");
                    emit({
                      op: "ldr",
                      width: 64,
                      rt: 16,
                      rn: 16,
                      offset: nativeArrayDataOffset,
                    });
                    emit({ op: "str", width: 64, rt: 15, rn: 12, offset: 32 });
                    emit({ op: "str", width: 64, rt: 16, rn: 12, offset: 40 });
                    emit({
                      op: "str",
                      width: 32,
                      rt: "zr",
                      rn: 12,
                      offset: 48,
                    });
                    emit({ op: "str", width: 32, rt: 13, rn: 12, offset: 52 });
                    emit({
                      op: "str",
                      width: 64,
                      rt: "zr",
                      rn: 12,
                      offset: 56,
                    });
                    emit({ op: "str", width: 32, rt: 9, rn: 12, offset: 24 });
                  } else {
                    // A copying-runtime publication cannot accidentally enable barriers.
                    emit({
                      op: "str",
                      width: 64,
                      rt: "zr",
                      rn: 12,
                      offset: 24,
                    });
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
                if (operation === "engine-range-error") {
                  // Tag 0 (undefined) with the reserved payload: the value a
                  // JavaScript boundary converts to a RangeError. Emergency
                  // mode is untouched, so catch landings leave the limit alone.
                  imm(9, 0);
                  saveRaw(9, resultId);
                  imm(10, nativeStackOverflowPayload);
                  rawStore(10, value(resultId).offset + 8);
                  break;
                }
                if (operation === "stack-overflow-is") {
                  // The overflow's value is tag 0 with the reserved payload; any
                  // other undefined has payload 0. The result is 1 or 0.
                  const thrown = op.arguments[0];
                  if (thrown === undefined)
                    throw "stack overflow identity argument invariant";
                  rawValue(9, thrown);
                  rawLoad(10, value(thrown).offset + 8);
                  imm(11, nativeStackOverflowPayload);
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
                  emit({ op: "cset", rd: 10, condition: "eq" });
                  emit({ op: "cbz", width: 64, rt: 9, displacement: 8 });
                  emit({
                    op: "movz",
                    width: 64,
                    rd: 10,
                    immediate: 0,
                    shift: 0,
                  });
                  emit({ op: "scvtf-d-x", rd: 0, rn: 10 });
                  floatStore(0, resultId);
                  break;
                }
                if (operation === "root-head") {
                  // The stack-map registry, after recording the calling
                  // function's frame as the start of the next walk (which
                  // visits its callers) and its save block (all of x19..x28,
                  // see savedWords). In the binding's own (not inlined) body
                  // this frame is popped before the walk: record the
                  // caller's, whose record x29 points to, and one plus the
                  // return address into it, whose map describes its saves.
                  rawLoad(9, contextOffset);
                  emit({
                    op: "ldr",
                    width: 64,
                    rt: 9,
                    rn: 9,
                    offset: nativeStackMapRegistryOffset,
                  });
                  const absent = instructions.length;
                  emit({ op: "cbz", width: 64, rt: 9, displacement: 0 });
                  if (ownRootHead) {
                    emit({
                      op: "ldp",
                      width: 64,
                      rt: 10,
                      rt2: 11,
                      rn: 29,
                      offset: 0,
                      mode: "offset",
                    });
                    emit({
                      op: "add-imm",
                      width: 64,
                      rd: 11,
                      rn: 11,
                      immediate: 1,
                      shift: 0,
                      setFlags: false,
                    });
                  } else address(11, calleeSaveOffset + preservedCount * 8);
                  emit({
                    op: "str",
                    width: 64,
                    rt: ownRootHead ? 10 : 29,
                    rn: 9,
                    offset: 16,
                  });
                  emit({
                    op: "str",
                    width: 64,
                    rt: 11,
                    rn: 9,
                    offset: nativeStackMapSaveBlockOffset,
                  });
                  patchInstruction(absent, {
                    op: "cbz",
                    width: 64,
                    rt: 9,
                    displacement: (instructions.length - absent) * 4,
                  });
                  emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
                  floatStore(0, resultId);
                  break;
                }
                if (operation === "stack-maps-register") {
                  // Appends (code start, code length, table) to the registry
                  // in context word 0. Inputs are exact nonnegative integers
                  // with a nonzero, 8-byte aligned table; else -1.
                  const failures: {
                    index: number;
                    branch: "ne" | "le" | "cs" | "cbz" | "cbnz";
                  }[] = [];
                  for (let index = 0; index < 3; index++) {
                    floatLoad(0, argument(index));
                    emit({ op: "fcvtzs-x-d", rd: 12 + index, rn: 0 });
                    emit({ op: "scvtf-d-x", rd: 1, rn: 12 + index });
                    emit({ op: "fcmp", rn: 0, rm: 1 });
                    failures.push({ index: instructions.length, branch: "ne" });
                    emit({ op: "b.cond", condition: "ne", displacement: 0 });
                    emit({
                      op: "sub-reg",
                      width: 64,
                      rd: "zr",
                      rn: 12 + index,
                      rm: "zr",
                      shift: "lsl",
                      amount: 0,
                      setFlags: true,
                    });
                    failures.push({ index: instructions.length, branch: "le" });
                    emit({ op: "b.cond", condition: "le", displacement: 0 });
                  }
                  emit({
                    op: "ubfm",
                    width: 64,
                    rd: 9,
                    rn: 14,
                    immr: 0,
                    imms: 2,
                  });
                  failures.push({ index: instructions.length, branch: "cbnz" });
                  emit({ op: "cbnz", width: 64, rt: 9, displacement: 0 });
                  rawLoad(9, contextOffset);
                  emit({
                    op: "ldr",
                    width: 64,
                    rt: 9,
                    rn: 9,
                    offset: nativeStackMapRegistryOffset,
                  });
                  failures.push({ index: instructions.length, branch: "cbz" });
                  emit({ op: "cbz", width: 64, rt: 9, displacement: 0 });
                  emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
                  emit({ op: "ldr", width: 64, rt: 11, rn: 9, offset: 8 });
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
                  failures.push({ index: instructions.length, branch: "cs" });
                  emit({ op: "b.cond", condition: "cs", displacement: 0 });
                  imm(11, nativeStackMapRegistryEntryBytes);
                  emit({
                    op: "madd",
                    width: 64,
                    rd: 11,
                    rn: 10,
                    rm: 11,
                    ra: 9,
                  });
                  emit({
                    op: "str",
                    width: 64,
                    rt: 12,
                    rn: 11,
                    offset: nativeStackMapRegistryHeaderBytes,
                  });
                  emit({
                    op: "str",
                    width: 64,
                    rt: 13,
                    rn: 11,
                    offset: nativeStackMapRegistryHeaderBytes + 8,
                  });
                  emit({
                    op: "str",
                    width: 64,
                    rt: 14,
                    rn: 11,
                    offset: nativeStackMapRegistryHeaderBytes + 16,
                  });
                  emit({
                    op: "add-imm",
                    width: 64,
                    rd: 10,
                    rn: 10,
                    immediate: 1,
                    shift: 0,
                    setFlags: false,
                  });
                  emit({ op: "str", width: 64, rt: 10, rn: 9, offset: 0 });
                  const done = instructions.length;
                  emit({ op: "b", displacement: 0 });
                  const failed = instructions.length;
                  for (const failure of failures) {
                    if (failure === undefined)
                      throw "stack map failure invariant";
                    const displacement = (failed - failure.index) * 4,
                      kind = failure.branch;
                    if (kind === "cbz" || kind === "cbnz")
                      patchInstruction(failure.index, {
                        op: kind,
                        width: 64,
                        rt: 9,
                        displacement,
                      });
                    else
                      patchInstruction(failure.index, {
                        op: "b.cond",
                        condition: kind,
                        displacement,
                      });
                  }
                  imm(9, 1);
                  emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
                  emit({ op: "fneg", rd: 0, rn: 0 });
                  const failedDone = instructions.length;
                  emit({ op: "b", displacement: 0 });
                  patchInstruction(done, {
                    op: "b",
                    displacement: (instructions.length - done) * 4,
                  });
                  imm(9, 0);
                  emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
                  patchInstruction(failedDone, {
                    op: "b",
                    displacement: (instructions.length - failedDone) * 4,
                  });
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
                if (rawWordOperation(operation)) {
                  const failures: {
                    index: number;
                    condition: "eq" | "ne" | "hi" | "cc";
                    register: number;
                  }[] = [];
                  function reject(condition: "eq" | "ne" | "hi" | "cc"): void {
                    failures.push({
                      index: instructions.length,
                      condition,
                      register: -1,
                    });
                    emit({ op: "b.cond", condition, displacement: 0 });
                  }
                  /** Rejects when `register` is zero ("eq") or not ("ne"). */
                  function rejectRegister(
                    register: number,
                    condition: "eq" | "ne",
                  ): void {
                    failures.push({
                      index: instructions.length,
                      condition,
                      register,
                    });
                    emit(
                      condition === "eq"
                        ? {
                            op: "cbz",
                            width: 64,
                            rt: register,
                            displacement: 0,
                          }
                        : {
                            op: "cbnz",
                            width: 64,
                            rt: register,
                            displacement: 0,
                          },
                    );
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
                  /** Rejects `register` above Number.MAX_SAFE_INTEGER (any
                   * of bits 53..63 set, as an unsigned word). */
                  function rejectUnsafe(register: number): void {
                    emit({
                      op: "ubfm",
                      width: 64,
                      rd: 9,
                      rn: register,
                      immr: 53,
                      imms: 63,
                    });
                    rejectRegister(9, "ne");
                  }
                  const arity =
                    operation === "memory-move" ||
                    operation === "memory-compare-exchange-word"
                      ? 5
                      : operation === "memory-write-word" ||
                          operation === "memory-fetch-add-word" ||
                          operation === "memory-store-release-word"
                        ? 4
                        : 3;
                  // A fetch-add delta may be negative: it needs only an
                  // exact integer, not the unsigned address-domain check.
                  const signedArgument =
                    operation === "memory-fetch-add-word" ? 3 : -1;
                  // Exact constant bounds are checked by the compiler; the
                  // offset then folds into the address and the window
                  // arguments are never materialized.
                  const lengthFact = valueIds.intern(argument(1)),
                    offsetFact = valueIds.intern(argument(2)),
                    windowLength = wordConstants[lengthFact] ?? 0,
                    windowOffset = wordConstants[offsetFact] ?? 0,
                    fixedBounds =
                      operation !== "memory-move" &&
                      wordKinds[lengthFact] === 3 &&
                      wordKinds[offsetFact] === 3 &&
                      windowLength >= 8 &&
                      windowOffset <= windowLength - 8,
                    directAddress = fixedBounds && windowOffset === 0,
                    effective = directAddress ? 0 : 10;
                  for (let index = 0; index < arity; index++) {
                    if (fixedBounds && (index === 1 || index === 2)) continue;
                    const fact = valueIds.intern(argument(index));
                    if (wordKinds[fact] === 3) {
                      imm(index, wordConstants[fact] ?? 0);
                      continue;
                    }
                    if (storedAsInteger(argument(index))) {
                      // Already an exact integer: only the range remains.
                      rawValue(index, argument(index));
                    } else {
                      const operand = floatOperand(argument(index), 0);
                      emit({ op: "fcvtzs-x-d", rd: index, rn: operand });
                      emit({ op: "scvtf-d-x", rd: 1, rn: index });
                      emit({ op: "fcmp", rn: operand, rm: 1 });
                      reject("ne");
                    }
                    // At a fixed zero offset the address is the effective
                    // address, whose check below subsumes this one (with an
                    // offset, a negative address could wrap past 2^64).
                    if (
                      !(directAddress && index === 0) &&
                      index !== signedArgument
                    )
                      rejectUnsafe(index);
                  }
                  rejectRegister(0, "eq");
                  if (operation === "memory-move") {
                    callHelper("memory-move");
                  } else {
                    // Dynamic windows retain the runtime range checks.
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
                    // Effective address in x10 (address plus offset), or x0
                    // itself at a fixed zero offset.
                    if (fixedBounds && windowOffset > 0 && windowOffset <= 4095)
                      emit({
                        op: "add-imm",
                        width: 64,
                        rd: 10,
                        rn: 0,
                        immediate: windowOffset,
                        shift: 0,
                        setFlags: false,
                      });
                    else if (!directAddress) {
                      // Dynamic offsets are already in x2.
                      if (fixedBounds) imm(2, windowOffset);
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
                    }
                    // An aligned word within MAX_SAFE_INTEGER - 7: rotated
                    // right by 3, the low three bits join bits 53..63 as
                    // bits 50..63, which must all be zero.
                    emit({
                      op: "extr",
                      width: 64,
                      rd: 9,
                      rn: effective,
                      rm: effective,
                      lsb: 3,
                    });
                    emit({
                      op: "ubfm",
                      width: 64,
                      rd: 9,
                      rn: 9,
                      immr: 50,
                      imms: 63,
                    });
                    rejectRegister(9, "ne");
                    if (operation === "memory-read-word") {
                      emit({
                        op: "ldr",
                        width: 64,
                        rt: 0,
                        rn: effective,
                        offset: 0,
                      });
                      rejectUnsafe(0);
                    } else if (operation === "memory-load-acquire-word") {
                      emit({ op: "ldar", width: 64, rt: 0, rn: effective });
                      rejectUnsafe(0);
                    } else if (operation === "memory-store-release-word") {
                      emit({ op: "stlr", width: 64, rt: 3, rn: effective });
                      imm(0, 0);
                    } else if (
                      operation === "memory-compare-exchange-word" ||
                      operation === "memory-fetch-add-word"
                    ) {
                      // Exclusive-pair loop: x11 observes the word; x9 is the
                      // new value (fetch-add) and x1 the store status (the
                      // window length is dead once the address is checked).
                      const exchange =
                        operation === "memory-compare-exchange-word";
                      const loop = instructions.length;
                      emit({ op: "ldaxr", width: 64, rt: 11, rn: effective });
                      let mismatch = -1;
                      if (exchange) {
                        compare(11, 3);
                        mismatch = instructions.length;
                        emit({
                          op: "b.cond",
                          condition: "ne",
                          displacement: 0,
                        });
                      } else
                        emit({
                          op: "add-reg",
                          width: 64,
                          rd: 9,
                          rn: 11,
                          rm: 3,
                          shift: "lsl",
                          amount: 0,
                          setFlags: false,
                        });
                      emit({
                        op: "stlxr",
                        width: 64,
                        rs: 1,
                        rt: exchange ? 4 : 9,
                        rn: effective,
                      });
                      emit({
                        op: "cbnz",
                        width: 32,
                        rt: 1,
                        displacement: (loop - instructions.length) * 4,
                      });
                      if (exchange) {
                        const over = instructions.length;
                        emit({ op: "b", displacement: 0 });
                        patchInstruction(mismatch, {
                          op: "b.cond",
                          condition: "ne",
                          displacement: (instructions.length - mismatch) * 4,
                        });
                        emit({ op: "clrex" });
                        patchInstruction(over, {
                          op: "b",
                          displacement: (instructions.length - over) * 4,
                        });
                      }
                      emit({
                        op: "add-imm",
                        width: 64,
                        rd: 0,
                        rn: 11,
                        immediate: 0,
                        shift: 0,
                        setFlags: false,
                      });
                      rejectUnsafe(0);
                    } else {
                      emit({
                        op: "str",
                        width: 64,
                        rt: 3,
                        rn: effective,
                        offset: 0,
                      });
                      imm(0, 0);
                    }
                  }
                  // Integer consumers take the exact word (or -1) as int64.
                  const integral =
                    operation !== "memory-move" && wantsInteger(resultId);
                  if (!integral) emit({ op: "scvtf-d-x", rd: 0, rn: 0 });
                  const skip = instructions.length;
                  emit({ op: "b", displacement: 0 });
                  const invalid = instructions.length;
                  if (integral)
                    emit({
                      op: "orn-reg",
                      width: 64,
                      rd: 0,
                      rn: "zr",
                      rm: "zr",
                    });
                  else {
                    imm(9, 1);
                    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
                    emit({ op: "fneg", rd: 0, rn: 0 });
                  }
                  const done = instructions.length;
                  for (const failure of failures) {
                    if (failure === undefined) throw "memory guard invariant";
                    const index = failure.index,
                      displacement = (invalid - index) * 4;
                    patchInstruction(
                      index,
                      failure.register < 0
                        ? {
                            op: "b.cond",
                            condition: failure.condition,
                            displacement,
                          }
                        : failure.condition === "eq"
                          ? {
                              op: "cbz",
                              width: 64,
                              rt: failure.register,
                              displacement,
                            }
                          : {
                              op: "cbnz",
                              width: 64,
                              rt: failure.register,
                              displacement,
                            },
                    );
                  }
                  patchInstruction(skip, {
                    op: "b",
                    displacement: (done - skip) * 4,
                  });
                  if (integral) {
                    saveRaw(0, resultId);
                    markInteger(resultId);
                  } else floatStore(0, resultId);
                  break;
                }
                const executableMemory = host().executableMemory,
                  dualMapping = dualMappingOf(host());
                if (
                  (operation === "executable-map" ||
                    operation === "executable-unmap") &&
                  dualMapping !== undefined
                ) {
                  // Integral results: the executable view's address (or
                  // 0) or -errno, in x0.
                  const sequence = inlineSequence();
                  if (operation === "executable-map") {
                    integer(0, 1, true);
                    emitDualMappingMap(sequence, dualMapping);
                  } else {
                    integer(0, 0, true);
                    integer(1, 1, true);
                    emitDualMappingUnmap(sequence, dualMapping.symbols);
                  }
                  sequence.finish();
                  emit({ op: "scvtf-d-x", rd: 0, rn: 0 });
                  floatStore(0, resultId);
                  break;
                }
                let symbol = "";
                if (
                  operation === "memory-map" ||
                  operation === "executable-map"
                ) {
                  let flags = host().anonymousPrivateFlags;
                  if (operation === "executable-map") {
                    if (executableMemory === undefined)
                      fail(
                        "UNSUPPORTED",
                        "target has no executable-memory ABI",
                      );
                    else if (executableMemory.kind === "darwin-jit")
                      flags = executableMemory.mappingFlags;
                  }
                  integer(0, 1, true);
                  imm(0, 0);
                  imm(2, operation === "executable-map" ? 7 : 3);
                  imm(3, flags);
                  imm(4, 0xffffffff);
                  imm(5, 0);
                  symbol = "mmap";
                } else if (
                  operation === "memory-unmap" ||
                  operation === "executable-unmap"
                ) {
                  // A Darwin arena is one MAP_JIT mapping.
                  if (
                    operation === "executable-unmap" &&
                    executableMemory === undefined
                  )
                    fail("UNSUPPORTED", "target has no executable-memory ABI");
                  integer(0, 0, true);
                  integer(1, 1, true);
                  symbol = "munmap";
                } else if (operation === "memory-release") {
                  // A fixed anonymous mapping over the range: fresh zero
                  // pages replace (and release) the old ones.
                  const fixed = host().fixedMappingFlag;
                  if (fixed === undefined)
                    fail("UNSUPPORTED", "target has no fixed-mapping ABI");
                  integer(0, 0, true);
                  integer(1, 1, true);
                  imm(2, 3);
                  imm(3, host().anonymousPrivateFlags | fixed);
                  imm(4, 0xffffffff);
                  imm(5, 0);
                  symbol = "mmap";
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
                  operation === "memory-release" ||
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
                // A fixed mapping returns its own address: report success.
                if (operation === "memory-release") imm(0, 0);
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
                emit({
                  op: "ldr",
                  width: 32,
                  rt: 9,
                  rn: 10,
                  offset: nativeArrayLengthOffset,
                });
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
              case "array-length": {
                // A uint32 length: an exact int64 for integer uses.
                const array = rawRegister(op.array, 10);
                if (wantsInteger(op.id)) {
                  const target = rawTarget(op.id, 9);
                  emit({
                    op: "ldr",
                    width: 32,
                    rt: target,
                    rn: array,
                    offset: nativeArrayLengthOffset,
                  });
                  saveRaw(target, op.id);
                  markInteger(op.id);
                  break;
                }
                emit({
                  op: "ldr",
                  width: 32,
                  rt: 9,
                  rn: array,
                  offset: nativeArrayLengthOffset,
                });
                emit({ op: "ucvtf-d-w", rd: floatTarget(op.id, 0), rn: 9 });
                floatStore(floatTarget(op.id, 0), op.id);
                break;
              }
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
                emit({
                  op: "ldr",
                  width: 32,
                  rt: 9,
                  rn: 10,
                  offset: nativeArrayLengthOffset,
                });
                emit({ op: "ucvtf-d-w", rd: 0, rn: 9 });
                floatStore(0, op.id);
                break;
              case "reference-vector-read":
                vectorHeader(op.vector);
                const vectorReadIndex = arrayIndex(op.vector, op.index, true);
                imm(11, 0);
                emit({ op: "cbz", width: 32, rt: 13, displacement: 12 });
                emit({
                  op: "add-reg",
                  width: 64,
                  rd: 10,
                  rn: 10,
                  rm: vectorReadIndex,
                  shift: "lsl",
                  amount: 3,
                  setFlags: false,
                });
                emit({ op: "ldr", width: 64, rt: 11, rn: 10, offset: 0 });
                saveRaw(11, op.id);
                break;
              case "reference-vector-write":
                vectorHeader(op.vector);
                const vectorWriteIndex = arrayIndex(op.vector, op.index, true);
                trapIf({ op: "cbz", width: 32, rt: 13 });
                emit({
                  op: "add-reg",
                  width: 64,
                  rd: 10,
                  rn: 10,
                  rm: vectorWriteIndex,
                  shift: "lsl",
                  amount: 3,
                  setFlags: false,
                });
                rawValue(11, op.value);
                emit({ op: "str", width: 64, rt: 11, rn: 10, offset: 0 });
                if (generationalBarriers) {
                  rawValue(9, op.vector);
                  rawLoad(10, contextOffset);
                  rememberObject();
                }
                break;
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
                  rememberObject();
                }
                patchInstruction(emptyCopy, {
                  op: "cbz",
                  width: 64,
                  rt: 9,
                  displacement: (instructions.length - emptyCopy) * 4,
                });
                break;
              }
              case "array-read":
                const readIndex = arrayIndex(op.array, op.index);
                if (
                  fusedFallbacks.get(op.id) === undefined &&
                  fusedReads[valueIds.intern(op.id)] === 0
                ) {
                  // The boxed result starts as `undefined`; only an
                  // in-range element replaces it, as a quiet number: words
                  // convert exactly, and doubles are quieted, as their raw
                  // bits could be the reserved `undefined` NaN.
                  const type = value(op.array).type,
                    scale =
                      type === "Uint8Array"
                        ? 0
                        : type === "Uint16Array"
                          ? 1
                          : type === "Float64Array"
                            ? 3
                            : 2;
                  absentNumber(11);
                  emit({ op: "cbz", width: 32, rt: 13, displacement: 16 });
                  emit({
                    op: "ldr-indexed",
                    size: scale,
                    fp: type === "Float64Array",
                    rt: type === "Float64Array" ? 0 : 11,
                    rn: 10,
                    rm: readIndex,
                    scaled: scale !== 0,
                  });
                  if (type === "Float64Array") quietNumber(0, 0);
                  else emit({ op: "ucvtf-d-w", rd: 0, rn: 11 });
                  emit({ op: "fmov-x-d", rd: 11, rn: 0 });
                  saveRaw(11, op.id);
                  break;
                }
                imm(11, 0);
                emit({ op: "cbz", width: 32, rt: 13, displacement: 12 });
                emit({
                  op: "add-reg",
                  width: 64,
                  rd: 10,
                  rn: 10,
                  rm: readIndex,
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
                const constantFallback = fusedFallbacks.get(op.id);
                if (constantFallback !== undefined) {
                  // `?? constant`: the read's own home receives the final
                  // number, the converted element or the constant's bits.
                  const absent = instructions.length;
                  emit({ op: "cbz", width: 32, rt: 13, displacement: 0 });
                  if (value(op.array).type !== "Float64Array") {
                    emit({ op: "ucvtf-d-w", rd: 0, rn: 11 });
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
              case "array-element":
              case "array-store": {
                // The index is a proven integer within the fixed length:
                // address the element directly, without checks.
                const type = value(op.array).type,
                  scale =
                    type === "Uint8Array"
                      ? 0
                      : type === "Uint16Array"
                        ? 1
                        : type === "Float64Array"
                          ? 3
                          : 2;
                // Word elements convert first (possibly through a helper,
                // which clobbers scratch registers) and are staged; doubles
                // are stored from their register after the address.
                if (op.kind === "array-store" && type !== "Float64Array") {
                  wordValue(op.value);
                  rawStore(9, resultOffset + 24);
                }
                const fact = valueIds.intern(op.index);
                let index = 12;
                if (storedAsInteger(op.index))
                  index = intRegister(op.index, 12);
                else if (wordKinds[fact] === 3)
                  imm(12, wordConstants[fact] ?? 0);
                else {
                  floatLoad(0, op.index);
                  emit({ op: "fcvtzs-x-d", rd: 12, rn: 0 });
                }
                rawValue(10, op.array);
                emit({
                  op: "ldr",
                  width: 64,
                  rt: 10,
                  rn: 10,
                  offset: nativeArrayDataOffset,
                });
                if (op.kind === "array-store" && type === "Float64Array") {
                  let element = 0;
                  if (storedAsInteger(op.value)) floatLoad(0, op.value);
                  else element = floatOperand(op.value, 0);
                  emit({
                    op: "str-indexed",
                    size: 3,
                    fp: true,
                    rt: element,
                    rn: 10,
                    rm: index,
                    scaled: true,
                  });
                  break;
                }
                if (op.kind === "array-store") {
                  rawLoad(11, resultOffset + 24);
                  emit({
                    op: "str-indexed",
                    size: scale,
                    fp: false,
                    rt: 11,
                    rn: 10,
                    rm: index,
                    scaled: scale !== 0,
                  });
                  break;
                }
                if (type === "Float64Array") {
                  // Straight into the result's FP home when it has one.
                  const target = floatTarget(op.id, 0);
                  emit({
                    op: "ldr-indexed",
                    size: 3,
                    fp: true,
                    rt: target,
                    rn: 10,
                    rm: index,
                    scaled: true,
                  });
                  floatStore(target, op.id);
                  break;
                }
                emit({
                  op: "ldr-indexed",
                  size: scale,
                  fp: false,
                  rt: 11,
                  rn: 10,
                  rm: index,
                  scaled: scale !== 0,
                });
                const target = floatTarget(op.id, 0);
                emit({ op: "ucvtf-d-w", rd: target, rn: 11 });
                floatStore(target, op.id);
                break;
              }
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
                if (value(op.array).type === "Float64Array") {
                  if (storedAsInteger(op.value)) {
                    floatLoad(0, op.value);
                    emit({ op: "fmov-x-d", rd: 9, rn: 0 });
                  } else rawValue(9, op.value);
                } else wordValue(op.value);
                rawStore(9, resultOffset + 24);
                const storeIndex = arrayIndex(op.array, op.index);
                emit({ op: "cbz", width: 32, rt: 13, displacement: 16 });
                rawLoad(11, resultOffset + 24);
                emit({
                  op: "add-reg",
                  width: 64,
                  rd: 10,
                  rn: 10,
                  rm: storeIndex,
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
                if (integerSlots[op.slot] === 1) {
                  if (wantsInteger(op.id)) {
                    copyRawWord(slotOffset(op.slot), value(op.id).offset);
                    markInteger(op.id);
                    if (tracker !== undefined)
                      tracker.saved(op.id, instructions.length * 4);
                  } else {
                    // A proven 32-bit integer (never -0) converts exactly.
                    rawLoad(9, slotOffset(op.slot));
                    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
                    floatStore(0, op.id);
                  }
                  break;
                }
                copyRawWord(slotOffset(op.slot), value(op.id).offset);
                if (
                  value(op.id).type === "general" ||
                  value(op.id).type === "optional-boolean"
                ) {
                  copyRawWord(slotOffset(op.slot) + 8, value(op.id).offset + 8);
                }
                if (tracker !== undefined)
                  tracker.saved(op.id, instructions.length * 4);
                break;
              case "store":
                if (integerSlots[op.slot] === 1) {
                  if (storedAsInteger(op.value))
                    copyRawWord(value(op.value).offset, slotOffset(op.slot));
                  else {
                    intOperand(op.value, 9);
                    rawStore(9, slotOffset(op.slot));
                  }
                  break;
                }
                copyRawWord(value(op.value).offset, slotOffset(op.slot));
                if (
                  value(op.value).type === "general" ||
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
                  const operand = floatOperand(op.operand, 0),
                    target = floatTarget(op.id, 0);
                  emit(
                    op.operator === "sqrt"
                      ? { op: "fsqrt", rd: target, rn: operand }
                      : op.operator === "ceil"
                        ? { op: "frintp", rd: target, rn: operand }
                        : { op: "frintz", rd: target, rn: operand },
                  );
                  floatStore(target, op.id);
                } else if (op.operator === "is-integer") {
                  const operandKind =
                    wordKinds[valueIds.intern(op.operand)] ?? 0;
                  if (
                    value(op.operand).type === "number" &&
                    (operandKind === 2 ||
                      operandKind === 3 ||
                      operandKind === 6)
                  )
                    imm(9, 1);
                  else if (
                    value(op.operand).type === "optional-number" &&
                    operandKind === 4
                  ) {
                    // An exact 32-bit integer or `undefined`.
                    absentFlags(rawRegister(op.operand, 9), 10);
                    emit({ op: "cset", rd: 9, condition: "ne" });
                  } else if (
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
                    // `undefined` is a NaN: its exponent rejects it too.
                    emit({ op: "and-reg", width: 32, rd: 9, rn: 9, rm: 10 });
                  }
                  saveRaw(9, op.id);
                } else if (op.operator === "boolean-number") {
                  rawValue(9, op.operand);
                  emit({ op: "ucvtf-d-w", rd: 0, rn: 9 });
                  floatStore(0, op.id);
                } else if (op.operator === "+") {
                  rawValue(9, op.operand);
                  saveRaw(9, op.id);
                } else if (op.operator === "uint32") {
                  // An exact uint32 by contract: as int64 when every use
                  // wants an integer, otherwise the unchanged double.
                  if (wantsInteger(op.id)) {
                    const target = intTarget(op.id, 9);
                    intOperand(op.operand, target);
                    saveRaw(target, op.id);
                    markInteger(op.id);
                  } else {
                    rawValue(9, op.operand);
                    saveRaw(9, op.id);
                  }
                } else if (op.operator === "-") {
                  const operand = floatOperand(op.operand, 0),
                    target = floatTarget(op.id, 0);
                  emit({ op: "fneg", rd: target, rn: operand });
                  floatStore(target, op.id);
                } else if (op.operator === "~") {
                  wordValue(op.operand);
                  emit({ op: "orn-reg", width: 32, rd: 9, rn: "zr", rm: 9 });
                  if (storedAsWord(op.id)) saveRaw(9, op.id);
                  else if (wantsInteger(op.id)) {
                    emit({ op: "sxtw", rd: 9, rn: 9 });
                    saveRaw(9, op.id);
                    markInteger(op.id);
                  } else {
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
                if (
                  value(op.left).type === "string" &&
                  literal !== undefined &&
                  literal.length <= 8
                ) {
                  // Equality with a short literal: compare the length and
                  // the UTF-16 units (flat strings, units after the length) inline.
                  // Up to four units, the eight bytes of units lie inside any
                  // string's allocation (at least 24 bytes), so the length
                  // and units combine without branches.
                  const other = rawRegister(
                    rightLiteral !== undefined ? op.left : op.right,
                    9,
                  );
                  const units = literal.length,
                    equal: Condition =
                      op.operator === "===" || op.operator === "=="
                        ? "eq"
                        : "ne";
                  emit({
                    op: "ldr",
                    width: 32,
                    rt: 11,
                    rn: other,
                    offset: nativeStringLengthOffset,
                  });
                  emit({
                    op: "sub-imm",
                    width: 64,
                    rd: 11,
                    rn: 11,
                    immediate: units,
                    shift: 0,
                    setFlags: false,
                  });
                  let shortcut = -1;
                  if (units > 4) {
                    shortcut = instructions.length;
                    emit({ op: "cbnz", width: 64, rt: 11, displacement: 0 });
                  }
                  for (let unit = 0; unit < units;) {
                    const take =
                      units - unit >= 4 ? 4 : units - unit >= 2 ? 2 : 1;
                    let lo = 0,
                      hi = 0;
                    for (let k = 0; k < take; k++) {
                      const code = literal.charCodeAt(unit + k);
                      if (k < 2) lo += code * (k === 0 ? 1 : 65536);
                      else hi += code * (k === 2 ? 1 : 65536);
                    }
                    const offset = nativeStringDataOffset + unit * 2;
                    if (take === 4)
                      emit({ op: "ldr", width: 64, rt: 12, rn: other, offset });
                    else if (take === 2)
                      emit({ op: "ldr", width: 32, rt: 12, rn: other, offset });
                    else emit({ op: "ldrh", rt: 12, rn: other, offset });
                    imm64(13, lo, hi);
                    emit({ op: "eor-reg", width: 64, rd: 12, rn: 12, rm: 13 });
                    emit({ op: "orr-reg", width: 64, rd: 11, rn: 11, rm: 12 });
                    unit += take;
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
                  value(op.left).type === "string" &&
                  value(op.right).type === "string" &&
                  literal !== undefined &&
                  literal.length <= 32
                ) {
                  // Equality with a longer literal: a length mismatch (the
                  // usual outcome in a chain of tests) costs a load and a
                  // branch; equal lengths compare the units with the
                  // literal's pool copy inline, never past either string's
                  // last unit.
                  const literalId =
                      rightLiteral !== undefined ? op.right : op.left,
                    other = rawRegister(
                      rightLiteral !== undefined ? op.left : op.right,
                      9,
                    ),
                    pool = rawRegister(literalId, 10);
                  const units = literal.length,
                    equal: Condition =
                      op.operator === "===" || op.operator === "=="
                        ? "eq"
                        : "ne";
                  emit({
                    op: "ldr",
                    width: 32,
                    rt: 11,
                    rn: other,
                    offset: nativeStringLengthOffset,
                  });
                  emit({
                    op: "sub-imm",
                    width: 64,
                    rd: 11,
                    rn: 11,
                    immediate: units,
                    shift: 0,
                    setFlags: false,
                  });
                  const shortcut = instructions.length;
                  emit({ op: "cbnz", width: 64, rt: 11, displacement: 0 });
                  for (let unit = 0; unit < units;) {
                    const take =
                      units - unit >= 4 ? 4 : units - unit >= 2 ? 2 : 1;
                    const offset = nativeStringDataOffset + unit * 2;
                    if (take === 4) {
                      emit({ op: "ldr", width: 64, rt: 12, rn: other, offset });
                      emit({ op: "ldr", width: 64, rt: 13, rn: pool, offset });
                    } else if (take === 2) {
                      emit({ op: "ldr", width: 32, rt: 12, rn: other, offset });
                      emit({ op: "ldr", width: 32, rt: 13, rn: pool, offset });
                    } else {
                      emit({ op: "ldrh", rt: 12, rn: other, offset });
                      emit({ op: "ldrh", rt: 13, rn: pool, offset });
                    }
                    emit({ op: "eor-reg", width: 64, rd: 12, rn: 12, rm: 13 });
                    emit({ op: "orr-reg", width: 64, rd: 11, rn: 11, rm: 12 });
                    unit += take;
                  }
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
                    stringEqual();
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
                  } else stringEqual();
                  if (op.operator === "!==" || op.operator === "!=") {
                    imm(10, 1);
                    emit({ op: "eor-reg", width: 32, rd: 9, rn: 9, rm: 10 });
                  }
                  saveRaw(9, op.id);
                  break;
                }
                if (
                  (op.operator === "+" ||
                    op.operator === "-" ||
                    op.operator === "*") &&
                  wantsInteger(op.id) &&
                  zeroSignResults[valueIds.intern(op.id)] !== 1 &&
                  wordKinds[valueIds.intern(op.id)] === 6 &&
                  exactInteger(op.left) &&
                  exactInteger(op.right)
                ) {
                  // Bounded below 2^53 (kind 6), so the int64 result is
                  // exact but for -0 (from a product, or a -0 operand),
                  // which becomes +0: its uses do not observe the sign (see
                  // findIntegerUses).
                  const left = intRegister(op.left, 9),
                    right = intRegister(op.right, 10),
                    target = intTarget(op.id, 9);
                  emit(
                    op.operator === "*"
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
                  saveRaw(target, op.id);
                  markInteger(op.id);
                } else if (
                  ["+", "-", "*", "/", "min", "max"].includes(op.operator)
                ) {
                  const left = floatOperand(op.left, 0),
                    right = floatOperand(op.right, 1),
                    target = floatTarget(op.id, 0);
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
                  ["&", "|", "^", "<<", ">>", ">>>", "imul"].includes(
                    op.operator,
                  )
                ) {
                  if (rotatedShifts[valueIds.intern(op.id)] === 1) break;
                  const rightIndex = valueIds.intern(op.right),
                    rightKind = wordKinds[rightIndex] ?? 0,
                    rotation = rotateAmounts[valueIds.intern(op.id)] ?? 0;
                  // Word and int64 results are computed into their GP home.
                  const target =
                    storedAsWord(op.id) || wantsInteger(op.id)
                      ? rawTarget(op.id, 9)
                      : 9;
                  if (rotation !== 0) {
                    const source = wordOperand(
                      rotateSources[valueIds.intern(op.id)] ?? 0,
                      9,
                    );
                    emit({
                      op: "extr",
                      width: 32,
                      rd: target,
                      rn: source,
                      rm: source,
                      lsb: rotation - 1,
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
                  if (storedAsWord(op.id)) saveRaw(target, op.id);
                  else if (wantsInteger(op.id)) {
                    // A W-register result is zero-extended: right for >>>.
                    if (op.operator !== ">>>")
                      emit({ op: "sxtw", rd: target, rn: target });
                    saveRaw(target, op.id);
                    markInteger(op.id);
                  } else {
                    emit(
                      op.operator === ">>>"
                        ? { op: "ucvtf-d-w", rd: 0, rn: target }
                        : { op: "scvtf-d-w", rd: 0, rn: target },
                    );
                    floatStore(0, op.id);
                  }
                } else if (
                  ["===", "!==", "==", "!=", "<", ">", "<=", ">="].includes(
                    op.operator,
                  )
                ) {
                  const leftAbsent =
                      undefinedValues[valueIds.intern(op.left)] === 1,
                    rightAbsent =
                      undefinedValues[valueIds.intern(op.right)] === 1;
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
                      absentFlags(
                        rawRegister(leftAbsent ? op.right : op.left, 9),
                        10,
                      );
                    const condition: Condition =
                      op.operator === "===" || op.operator === "=="
                        ? "eq"
                        : "ne";
                    if (op.id === comparisonValue) comparisonBranch = condition;
                    else {
                      const target = rawTarget(op.id, 9);
                      emit({ op: "cset", rd: target, condition });
                      saveRaw(target, op.id);
                    }
                    break;
                  }
                  if (value(op.left).type === "optional-number") {
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
                  if (value(op.left).type === "optional-boolean") {
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
                    value(op.left).type === "number" &&
                    (storedAsInteger(op.left) || storedAsInteger(op.right)) &&
                    exactInteger(op.left) &&
                    exactInteger(op.right);
                  if (integerComparison) {
                    const rightIndex = valueIds.intern(op.right),
                      rightConstant =
                        !storedAsInteger(op.right) &&
                        wordKinds[rightIndex] === 3 &&
                        (wordConstants[rightIndex] ?? 0) <= 4095;
                    const left = intRegister(op.left, 9);
                    if (rightConstant)
                      emit({
                        op: "sub-imm",
                        width: 64,
                        rd: "zr",
                        rn: left,
                        immediate: wordConstants[rightIndex] ?? 0,
                        shift: 0,
                        setFlags: true,
                      });
                    else
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
                  } else if (value(op.left).type === "number") {
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
              case "call-indirect":
              case "call": {
                const target = signatures[op.target];
                if (target === undefined) throw "call signature invariant";
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
                  if (list === undefined)
                    throw "list vector argument invariant";
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
                  if (
                    list === undefined ||
                    index === undefined ||
                    element === undefined
                  )
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
                  const writeHeader = provenListHeader(list, writeShape.header);
                  rawValue(9, list);
                  if (writeHeader !== 2) slowZero(9);
                  if (writeHeader === 0) {
                    emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
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
                    rn: 9,
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
                    rt: 13,
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
                    rn: 9,
                    offset: lengthField.offset,
                  });
                  emit({ op: "fcmp", rn: 1, rm: 0 });
                  const within = instructions.length;
                  emit({ op: "b.cond", condition: "ls", displacement: 0 });
                  emit({
                    op: "str-d",
                    rt: 1,
                    rn: 9,
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
                    rememberObject();
                  }
                  listReadDone = instructions.length;
                  emit({ op: "b", displacement: 0 });
                  for (const entry of slow) {
                    if (entry === undefined)
                      throw "list write branch invariant";
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
                  const cachedRead = listShape.mode === "cached",
                    list = op.arguments[cachedRead ? 1 : 0],
                    index = op.arguments[cachedRead ? 2 : 1],
                    field = cachedRead
                      ? undefined
                      : module.records?.[listShape.header]?.fields[
                          listShape.field
                        ];
                  if (list === undefined || index === undefined)
                    throw "list read argument invariant";
                  if (
                    !cachedRead &&
                    (field === undefined || field.offset > 32760)
                  )
                    throw "list read layout invariant";
                  const slow: { site: number; branch: Branch }[] = [];
                  const toSlow = (branch: Branch): void => {
                    slow.push({ site: instructions.length, branch });
                    emit(
                      branch.op === "b.cond"
                        ? {
                            op: "b.cond",
                            condition: branch.condition,
                            displacement: 0,
                          }
                        : branch.op === "cbz" || branch.op === "cbnz"
                          ? {
                              op: branch.op,
                              width: branch.width,
                              rt: branch.rt,
                              displacement: 0,
                            }
                          : { op: branch.op, displacement: 0 },
                    );
                  };
                  // The root vector: the cached argument, or read from the
                  // list header and tested to be a reference vector.
                  let vectorRegister = 10;
                  if (cachedRead) {
                    const vector = op.arguments[0];
                    if (vector === undefined)
                      throw "list read argument invariant";
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
                  if (storedAsInteger(index))
                    indexRegister = intRegister(index, 12);
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
                  saveRaw(resultRegister, listResult);
                  listReadDone = instructions.length;
                  emit({ op: "b", displacement: 0 });
                  for (const entry of slow) {
                    if (entry === undefined) throw "list read branch invariant";
                    const branch = entry.branch,
                      displacement = (instructions.length - entry.site) * 4;
                    patchInstruction(
                      entry.site,
                      branch.op === "b.cond"
                        ? {
                            op: "b.cond",
                            condition: branch.condition,
                            displacement,
                          }
                        : branch.op === "cbz" || branch.op === "cbnz"
                          ? {
                              op: branch.op,
                              width: branch.width,
                              rt: branch.rt,
                              displacement,
                            }
                          : { op: branch.op, displacement },
                    );
                  }
                }
                const importedEntry = entryImports.get(op.target);
                for (let i = 0; i < op.arguments.length; i++) {
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
                  directCallee === undefined ||
                  directCallee.import === true ||
                  directCallee.environment !== undefined ||
                  directCallee.closureEnvironment !== undefined
                )
                  imm(1, 0);
                if (op.receiver !== undefined)
                  address(2, value(op.receiver).offset);
                else if (
                  directCallee === undefined ||
                  directCallee.import === true ||
                  directCallee.receiverSlot !== undefined
                )
                  imm(2, 0);
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
                  trapIf({ op: "b.cond", condition: "ne" });
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
                safepoint();
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
                    value(resultId).type === "optional-boolean"
                  ) {
                    if (registerResult) rawStore(2, value(resultId).offset + 8);
                    else {
                      rawLoad(10, resultOffset + 24);
                      rawStore(10, value(resultId).offset + 8);
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
            }
          }
          const t = b.terminator;
          if (viewAccesses) {
            viewExitTokens.set(b.id, viewToken);
            viewExitSlots.set(b.id, viewSlotTokens);
          }
          siteIndex = b.instructions.length;
          if (recordOperations) beginTerminator(b.id, t);
          if (tracker !== undefined)
            tracker.operation(
              b.id,
              -1,
              t.inline ?? -1,
              instructions.length * 4,
            );
          span = { start: t.start, end: t.end };
          if (t.kind === "trap") emit({ op: "brk", immediate: 0 });
          else if (t.kind === "throw") {
            rawValue(9, t.value);
            rawStore(9, resultOffset + 16);
            rawLoad(9, value(t.value).offset + 8);
            rawStore(9, resultOffset + 24);
            if (throwTraces) traceThrow(9, undefined);
            imm(0, 2);
            exceptionalBranch({ op: "b" });
          } else if (t.kind === "throw-literal") {
            stringFixups.push({
              offset: instructions.length * 4,
              value: t.value,
            });
            localPointer(9);
            rawStore(9, resultOffset + 24);
            if (throwTraces) traceThrow(9, 3);
            imm(9, 3);
            rawStore(9, resultOffset + 16);
            imm(0, 2);
            exceptionalBranch({ op: "b" });
          } else if (t.kind === "jump") {
            if (t.target !== nextBlock) branch({ op: "b" }, fn.id, t.target);
          } else if (t.kind === "branch") {
            if (comparisonBranch !== undefined) {
              if (t.consequent === nextBlock)
                branch(
                  {
                    op: "b.cond",
                    condition: inverseCondition(comparisonBranch),
                  },
                  fn.id,
                  t.alternate,
                );
              else {
                branch(
                  { op: "b.cond", condition: comparisonBranch },
                  fn.id,
                  t.consequent,
                );
                if (t.alternate !== nextBlock)
                  branch({ op: "b" }, fn.id, t.alternate);
              }
            } else {
              const condition = rawRegister(t.condition, 9);
              if (t.consequent === nextBlock)
                branch(
                  { op: "cbz", width: 64, rt: condition },
                  fn.id,
                  t.alternate,
                );
              else {
                branch(
                  { op: "cbnz", width: 64, rt: condition },
                  fn.id,
                  t.consequent,
                );
                if (t.alternate !== nextBlock)
                  branch({ op: "b" }, fn.id, t.alternate);
              }
            }
          } else if (t.kind === "record") {
            const layout = module.records?.[t.record],
              field = layout?.fields[t.field];
            if (layout === undefined || field === undefined)
              throw "verified record invariant";
            const chain = dispatch?.chains.get(b.id);
            const byteLength = scalarByteLength(field.type);
            const nonNull =
              nonNullValues[valueIds.intern(t.object)] === 1 ||
              (flowGuards !== undefined && ((flowGuards[b.id] ?? 0) & 2) !== 0);
            /** Move field `index` of `placed` between the object in `object`
             * and the transfer slot. */
            function transfer(
              placed: RecordLayout,
              index: number,
              object: number,
            ): void {
              if (t.kind !== "record") throw "record transfer invariant";
              const moved = placed.fields[index];
              if (moved === undefined) throw "verified record invariant";
              let offset = moved.offset;
              if (offset > 32768 - byteLength) {
                imm(12, offset);
                emit({
                  op: "add-reg",
                  width: 64,
                  rd: 9,
                  rn: object,
                  rm: 12,
                  shift: "lsl",
                  amount: 0,
                  setFlags: false,
                });
                object = 9;
                offset = 0;
              }
              for (let word = 0; word < byteLength; word += 8) {
                const slotWord = slotOffset(t.slot) + word,
                  home =
                    scalarRegisters === undefined
                      ? 0
                      : (scalarRegisters[slotWord / 8] ?? 0);
                if (t.operation === "read") {
                  // Straight into a single-word slot's register home.
                  if (byteLength === 8 && home >= 32)
                    emit({
                      op: "ldr",
                      width: 64,
                      rt: home - 32,
                      rn: object,
                      offset,
                    });
                  else if (byteLength === 8 && home !== 0)
                    emit({ op: "ldr-d", rt: home, rn: object, offset });
                  else {
                    emit({
                      op: "ldr",
                      width: 64,
                      rt: 10,
                      rn: object,
                      offset: offset + word,
                    });
                    rawStore(10, slotWord);
                  }
                } else if (byteLength === 8 && home !== 0 && home < 32)
                  emit({ op: "str-d", rt: home, rn: object, offset });
                else {
                  let source = 10;
                  if (byteLength === 8 && home >= 32) source = home - 32;
                  else rawLoad(10, slotWord);
                  emit({
                    op: "str",
                    width: 64,
                    rt: source,
                    rn: object,
                    offset: offset + word,
                  });
                }
              }
            }
            if (chain !== undefined && chain.groups.length > 1) {
              // One membership test and read per placement group; a group's
              // misses fall through to the next group's test.
              let misses: LocalBranch[] = [];
              for (let index = 0; index < chain.groups.length; index++) {
                const group = chain.groups[index],
                  placed = module.records?.[group?.record ?? -1];
                if (group === undefined || placed === undefined)
                  throw "dispatch group invariant";
                const last = index === chain.groups.length - 1;
                if (index > 0) {
                  patchLocalBranches(misses);
                  stackWords.clear();
                  misses = [];
                }
                rawValue(9, t.object);
                dispatchDescriptor(
                  9,
                  { records: group.records, failure: chain.failure },
                  nonNull || index > 0,
                  last ? undefined : misses,
                );
                transfer(placed, group.field, 9);
                if (!last) branch({ op: "b" }, fn.id, t.consequent);
              }
            } else {
              // A single-word access may address through the object's own
              // GP home; fused dispatch chains and multi-word reads (whose
              // first word could overwrite that home) use a copy in x9.
              let object = 9;
              if (chain === undefined && byteLength === 8)
                object = rawRegister(t.object, 9);
              else rawValue(9, t.object);
              if (chain !== undefined) dispatchDescriptor(9, chain, nonNull);
              else if (recordGuards === undefined || recordGuards[b.id] !== 1)
                guardDescriptor(
                  object,
                  t.record,
                  t.alternate,
                  flowGuards !== undefined &&
                    ((flowGuards[b.id] ?? 0) & 1) !== 0,
                  nonNull,
                );
              transfer(layout, t.field, object);
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
              rememberObject();
            }
            if (t.consequent !== nextBlock)
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
                  flowGuards !== undefined &&
                    ((flowGuards[b.id] ?? 0) & 1) !== 0,
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
              // A proven-initialized cell needs no state test.
              if (t.kind !== "record-cell" || t.initialized !== true) {
                emit({
                  op: "ldrb",
                  rt: 10,
                  rn: 9,
                  offset: access.stateOffset,
                });
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
              }
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
              if (t.consequent !== nextBlock)
                branch({ op: "b" }, fn.id, t.consequent);
            } else if (canInlineCellWrite(fn, t)) {
              // The generic helper's contract inline: a write needs state 1
              // and a mutable cell; an initialization needs state 0 and sets
              // it to 1. Failures take the alternate edge, as the helper's
              // nonzero status does; the value words come from the frame.
              if (t.kind === "record-cell") rawValue(9, t.object);
              else rawLoad(9, environmentOffset);
              const proven = t.kind === "record-cell" && t.initialized === true;
              if (!proven)
                emit({
                  op: "ldrb",
                  rt: 10,
                  rn: 9,
                  offset: access.stateOffset,
                });
              if (t.operation === "write" && !access.mutable)
                branch({ op: "b" }, fn.id, t.alternate);
              else {
                // A proven-initialized mutable cell is written directly.
                if (!proven && t.operation === "write") {
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
                } else if (!proven)
                  branch({ op: "cbnz", width: 32, rt: 10 }, fn.id, t.alternate);
                for (let offset = 0; offset < access.byteLength; offset += 8) {
                  rawLoad(10, slotOffset(t.slot) + offset);
                  emit({
                    op: "str",
                    width: 64,
                    rt: 10,
                    rn: 9,
                    offset: access.valueOffset + offset,
                  });
                }
                if (t.operation === "initialize") {
                  emit({
                    op: "movz",
                    width: 32,
                    rd: 10,
                    immediate: 1,
                    shift: 0,
                  });
                  emit({
                    op: "strb",
                    rt: 10,
                    rn: 9,
                    offset: access.stateOffset,
                  });
                }
                if (generationalBarriers && t.kind === "record-cell") {
                  const field = module.records?.[t.record]?.fields[t.field];
                  if (field === undefined) throw "barrier cell invariant";
                  if (managed(field.type) || field.type === "general") {
                    rawValue(9, t.object);
                    rawLoad(10, contextOffset);
                    rememberObject();
                  }
                }
                if (t.consequent !== nextBlock)
                  branch({ op: "b" }, fn.id, t.consequent);
              }
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
                  rememberObject();
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
          if (recordOperations) endOperation();
          if (tracker !== undefined) tracker.end(instructions.length * 4);
          if (transient !== undefined && storage !== undefined)
            for (const op of b.instructions) {
              if (op === undefined) throw "temporary instruction invariant";
              const id = instructionResult(op);
              if (id !== undefined && transient[id] !== 0)
                storage[value(id).offset / 8] = 0;
            }
          if (
            leafReferences !== undefined &&
            leafBase !== undefined &&
            storage !== undefined
          )
            for (const op of b.instructions) {
              if (op === undefined)
                throw "leaf reference instruction invariant";
              const id = instructionResult(op);
              if (id !== undefined)
                storage[value(id).offset / 8] =
                  leafBase[value(id).offset / 8] ?? 0;
            }
        }
        for (const block of fn.blocks) {
          if (block === undefined) throw "exception block invariant";
          const handler = block.exception;
          if (handler === undefined) continue;
          stackWords.clear();
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
          // A handler frame predates the overflow, so it fits the normal limit:
          // leave emergency mode here. The thrown value identifies the overflow
          // itself, so no context state outlives this restore.
          rawLoad(9, contextOffset);
          emit({
            op: "ldr",
            width: 64,
            rt: 10,
            rn: 9,
            offset: nativeEngineThrowOffset,
          });
          emit({ op: "cbz", width: 64, rt: 10, displacement: 12 });
          emit({
            op: "str",
            width: 64,
            rt: 10,
            rn: 9,
            offset: nativeStackLimitOffset,
          });
          emit({
            op: "str",
            width: 64,
            rt: "zr",
            rn: 9,
            offset: nativeEngineThrowOffset,
          });
          // No safepoint occurs between receiving the payload and publishing its tag.
          branch({ op: "b" }, fn.id, handler.target);
        }
        if (throwExit) {
          stackWords.clear();
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
        flushTraps();
        endFrameRange();
        // Every branch into a seeded block start must be one whose words
        // were intersected there, and every label at that address one whose
        // edges were; a later edge would invalidate the seed.
        if (seededEntries.size !== 0) {
          // Labels laid out after a seeded block that emitted nothing share
          // its address but get their own entry state.
          const seededStarts = new Set<number>();
          for (let index = fn.blocks.length - 1; index >= 0; index--) {
            const block = fn.blocks[index];
            if (block === undefined) throw "block invariant";
            const start = offsets[block.id * 2];
            if (start === undefined) continue;
            if (seededStarts.has(start) && !accountedLabels.has(block.id))
              throw "cross-block forwarding invariant";
            if (seededEntries.has(block.id)) seededStarts.add(start);
          }
          const branchesInto = new Map<number, number>();
          for (let index = functionFixups; index < fixups.length; index++) {
            const fixup = fixups[index];
            if (fixup === undefined) throw "fixup invariant";
            const block = fixup.block;
            if (
              fixup.function === fn.id &&
              block !== undefined &&
              !veneerFixups.has(index)
            )
              branchesInto.set(block, (branchesInto.get(block) ?? 0) + 1);
          }
          for (const [block, count] of seededEntries)
            if ((branchesInto.get(block) ?? 0) !== count)
              throw "cross-block forwarding invariant";
        }
        if (leafRegisters && leafStorage === undefined)
          promoteStackWords(
            instructions,
            start / 4,
            instructions.length,
            localsOffset,
            maximumCursor,
            work(1000000),
            tracker === undefined
              ? undefined
              : (byteOffset: number, register: number): void => {
                  tracker.promoted(byteOffset, register);
                },
          );
        // A1: scalar-register round trips; block offsets cover branches whose
        // displacements are patched after this function is emitted.
        const entries: number[] = [start / 4];
        for (const offset of offsets)
          if (offset !== undefined) entries.push(offset / 4);
        forwardRegisterRoundTrips(
          instructions,
          start / 4,
          instructions.length,
          entries,
        );
        // Preserved FP registers sit at the top of the frame, below the frame
        // record: d(8+i) at sp + calleeSaveOffset + 8i, sp = fp - frameBytes
        // and CFA = fp + 16.
        const unwindSaves: UnwindSave[] = [];
        for (let index = 0; index < preservedCount; index++)
          unwindSaves.push({
            register: dwarfFloatRegister(8 + index),
            offset: calleeSaveOffset + index * 8 - frameBytes - 16,
          });
        for (let index = 0; index < savedWords.length; index++)
          unwindSaves.push({
            register: savedWords[index] ?? 0,
            offset:
              calleeSaveOffset + (preservedCount + index) * 8 - frameBytes - 16,
          });
        // A frameless early exit runs before the frame push: rows describe
        // that prefix, then the frame.
        let unwindRule: UnwindRule = { kind: "frame", saves: unwindSaves };
        if (framePush !== 0) {
          const noSaves: UnwindSave[] = [],
            frameSaves: UnwindSave[] = [
              { register: 29, offset: -16 },
              { register: 30, offset: -8 },
            ];
          for (const save of unwindSaves) {
            if (save === undefined) throw "unwind save invariant";
            frameSaves.push(save);
          }
          const rows: UnwindRow[] = [
            {
              offset: 0,
              cfaRegister: dwarfStackPointer,
              cfaOffset: 0,
              saves: noSaves,
            },
            {
              offset: framePush,
              cfaRegister: 29,
              cfaOffset: 16,
              saves: frameSaves,
            },
          ];
          unwindRule = { kind: "rows", rows };
        }
        // Stack maps: per call site, the frame words holding live references
        // while it runs. Calls that cannot collect list none: a walk passes
        // them only in runtime frames, whose references are permanent.
        {
          // Every map ends with the register word and the frame's save
          // offsets of x19..x28 (stack-pointer relative, register order), so
          // walks can locate registers its callers keep references in.
          const savedOrder = savedWords.slice();
          savedOrder.sort((left, right) => left - right);
          let savedMask = 0;
          const saveOffsets: number[] = [];
          for (const register of savedOrder) {
            if (register === undefined || register < 19 || register > 28)
              throw "saved register invariant";
            savedMask |= 1 << (register - 19);
            saveOffsets.push(
              calleeSaveOffset +
                (preservedCount + savedWords.indexOf(register)) * 8,
            );
          }
          const savedWord: number = savedMask,
            heldScale: number = 1 << nativeStackMapRegisterShift;
          function registerSection(map: number[], held: number): void {
            map.push(savedWord + held * heldScale);
            for (const offset of saveOffsets)
              if (offset !== undefined) map.push(offset);
          }
          const empty: number[] = [frameBytes, 0, 0];
          registerSection(empty, 0);
          const collecting: boolean[] = [];
          for (const site of callSites) {
            if (site === undefined) throw "safepoint site invariant";
            const block = fn.blocks[site.block];
            if (block === undefined) throw "safepoint block invariant";
            const op = block.instructions[site.index];
            collecting.push(hasRoots && (op === undefined || mayCollect(op)));
          }
          let liveSlots: (readonly number[])[] | undefined;
          if (safepointLiveness !== undefined) {
            const tracked = new Uint8Array(fn.slots.length),
              sites: SafepointSite[] = [];
            for (let slot = 0; slot < fn.slots.length; slot++) {
              const type = fn.slots[slot];
              if (
                type !== undefined &&
                (managed(type) || type === "general") &&
                slotRegister(slot) === 0
              )
                tracked[slot] = 1;
            }
            for (let index = 0; index < callSites.length; index++) {
              const site = callSites[index];
              if (site === undefined) throw "safepoint site invariant";
              if (collecting[index] === true)
                sites.push({ block: site.block, index: site.index });
            }
            liveSlots = safepointLiveSlots(
              fn,
              safepointLiveness.slots,
              tracked,
              sites,
            );
          }
          // Root words of temporaries: pool words, and slot words of loads
          // aliasing a frame-homed slot. Folded constants are never stored.
          const referenceWords = new Set<number>(),
            generalWords = new Set<number>();
          for (const offset of temporaryRoots)
            if (offset !== undefined) referenceWords.add(offset);
          for (const offset of temporaryGenerals)
            if (offset !== undefined) generalWords.add(offset);
          for (let slot = 0; slot < fn.slots.length; slot++) {
            const type = fn.slots[slot];
            if (type === undefined || slotRegister(slot) !== 0) continue;
            if (type === "general") generalWords.add(slotOffset(slot));
            else if (managed(type)) referenceWords.add(slotOffset(slot));
          }
          // Per block with collecting sites: [definition, last use, offset,
          // general] of each temporary with a root word.
          const temporaries = new Map<number, number[]>();
          function temporariesOf(blockId: number): readonly number[] {
            const known = temporaries.get(blockId);
            if (known !== undefined) return known;
            const block = fn.blocks[blockId];
            if (block === undefined) throw "safepoint block invariant";
            const lastUse = new Map<number, number>();
            for (let index = 0; index < block.instructions.length; index++) {
              const op = block.instructions[index];
              if (op === undefined) throw "safepoint instruction invariant";
              visitInstructionOperands(op, (id) => {
                lastUse.set(id, index);
              });
            }
            visitTerminatorOperands(block.terminator, (id) => {
              lastUse.set(id, block.instructions.length);
            });
            const found: number[] = [];
            for (let index = 0; index < block.instructions.length; index++) {
              const op = block.instructions[index];
              if (op === undefined) throw "safepoint instruction invariant";
              const id = instructionResult(op);
              if (id === undefined) continue;
              const last = lastUse.get(id);
              if (last === undefined || last <= index) continue;
              if (foldedConstants[valueIds.intern(id)] === 1) continue;
              const stored = value(id);
              if (stored.type === "general") {
                if (generalWords.has(stored.offset))
                  found.push(index, last, stored.offset, 1);
              } else if (
                managed(stored.type) &&
                referenceWords.has(stored.offset)
              )
                found.push(index, last, stored.offset, 0);
            }
            temporaries.set(blockId, found);
            return found;
          }
          let collectingIndex = 0;
          for (let index = 0; index < callSites.length; index++) {
            const site = callSites[index];
            if (site === undefined) throw "safepoint site invariant";
            if (collecting[index] !== true) {
              safepoints.push({ offset: site.offset, map: empty });
              continue;
            }
            const references: number[] = [],
              generals: number[] = [];
            if (liveSlots === undefined) {
              for (const offset of rootSlots)
                if (offset !== undefined) references.push(offset);
              for (const offset of generalSlots)
                if (offset !== undefined) generals.push(offset);
            } else {
              const live = liveSlots[collectingIndex++];
              if (live === undefined) throw "safepoint live invariant";
              if (fn.closureEnvironment !== undefined)
                references.push(environmentOffset);
              for (const slot of live) {
                if (slot === undefined) throw "safepoint slot invariant";
                if (fn.slots[slot] === "general")
                  generals.push(slotOffset(slot));
                else references.push(slotOffset(slot));
              }
              const found = temporariesOf(site.block);
              for (let at = 0; at < found.length; at += 4)
                if (
                  (found[at] ?? 0) < site.index &&
                  (found[at + 1] ?? 0) >= site.index
                ) {
                  const offset = found[at + 2] ?? 0;
                  if (found[at + 3] === 1) generals.push(offset);
                  else references.push(offset);
                }
            }
            for (const offset of siteReferences.get(index) ?? []) {
              if (offset === undefined) throw "site reference invariant";
              references.push(offset);
            }
            const map: number[] = [frameBytes];
            for (const list of [references, generals]) {
              if (list === undefined) throw "safepoint map invariant";
              list.sort((left, right) => left - right);
              const unique: number[] = [];
              for (const offset of list)
                if (
                  offset !== undefined &&
                  unique[unique.length - 1] !== offset
                )
                  unique.push(offset);
              map.push(unique.length);
              for (const offset of unique)
                if (offset !== undefined) map.push(offset);
            }
            // Register-homed references: the walk finds each where the
            // nearest callee saved its register.
            let held = 0;
            for (const slot of registerRoots(site.block, site.index) ?? []) {
              if (slot === undefined) throw "register root invariant";
              const register = slotRegister(slot) - 32;
              if (
                register < 19 ||
                register > 28 ||
                !savedWords.includes(register)
              )
                throw "register root invariant";
              held |= 1 << (register - 19);
            }
            // C frames between a may-callback call and its callbacks may
            // save x19..x28 anywhere: no reference may be register-held
            // across one (docs/native-ffi.md, "Callbacks").
            const siteBlock = fn.blocks[site.block],
              siteOp =
                siteBlock === undefined
                  ? undefined
                  : siteBlock.instructions[site.index];
            if (
              held !== 0 &&
              siteOp !== undefined &&
              siteOp.kind === "c-call" &&
              siteOp.call.mayCallback === true
            )
              throw "register root across a may-callback call";
            registerSection(map, held);
            safepoints.push({ offset: site.offset, map });
          }
        }
        functions.push({
          id: fn.id,
          name: fn.name,
          exported: fn.exported,
          offset: start,
          byteLength: instructions.length * 4 - start,
          frameBytes,
          signature,
          unwind: unwindRule,
          frameRoots: hasRoots
            ? { references: rootSlots.slice(), generals: generalSlots.slice() }
            : undefined,
          debugFrame: debugSpans
            ? {
                register: 29,
                contextOffset: contextOffset - frameBytes,
                resultOffset: resultPointerOffset - frameBytes,
                ranges: frameRanges,
              }
            : undefined,
          ...(tracker === undefined
            ? {}
            : {
                debug: tracker.finish({
                  slotOffset,
                  valueStorage: (id) => {
                    const index = valueIds.intern(id),
                      stored = values[index];
                    if (
                      stored === undefined ||
                      storedAsWord(id) ||
                      foldedConstants[index] === 1 ||
                      fusedReads[index] !== 0 ||
                      rotatedShifts[index] === 1
                    )
                      return undefined;
                    return {
                      offset: stored.offset,
                      type: stored.type,
                      integer: stored.type === "number" && storedAsInteger(id),
                    };
                  },
                  frameBytes,
                  integerSlots,
                  managed,
                  collects: mayCollect,
                  frameRanges,
                }),
              }),
        });
        // Trap islands patched during the function report their own range
        // failures (and may already have escalated its forms).
        const trapOverflow = compactOverflow && !overflowBefore;
        if (!floatWordsKnown) {
          floatWordsKnown = true;
          if (floatWords.size > 0) {
            rollBack(mark);
            compactOverflow = overflowBefore;
            continue;
          }
        }
        if (!trapOverflow && !ownBranchesOutOfReach(fn.id, mark.fixups)) break;
        if (longWere) break;
        rollBack(mark);
        compactOverflow = overflowBefore;
        if (
          forms.islands.has(fn.id) === islandsWere &&
          forms.longBranches.has(fn.id) === longWere
        ) {
          if (islandsWere) forms.longBranches.add(fn.id);
          else forms.islands.add(fn.id);
        }
      }
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
                    : kind === "stack-overflow"
                      ? stackOverflowHelper()
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
    // Callback entry thunks, after the helpers: one contiguous range.
    const thunkStart = instructions.length * 4,
      thunkOffsets: { slot: number; offset: number }[] = [];
    for (let index = 0; index < callbackThunkRequests.length; index++) {
      const thunk = callbackThunkRequests[index];
      if (thunk === undefined) throw "callback thunk invariant";
      thunkOffsets.push({ slot: index, offset: instructions.length * 4 });
      emitCallbackThunk(thunk.signature, thunk.ordinal);
    }
    const thunkEnd = instructions.length * 4;
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
        // At least four units, like heap strings (inline comparisons read
        // that many unchecked).
        const byteLength =
          Math.ceil(
            (nativeStringDataOffset + Math.max(fixup.value.length, 4) * 2) / 16,
          ) * 16;
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
      // Dispatch family words and an 8-byte record index precede each
      // descriptor (union dispatch membership); descriptor readers start at
      // the descriptor itself.
      const header = descriptorPrefixBytes,
        size =
          header + 24 + (referenceOffsets.length + generalOffsets.length) * 8;
      if (size > maxByteLength - codeLength)
        fail("CODE_LIMIT", "record descriptors exceed byte budget");
      records.push({
        record,
        offset: codeLength + header,
        byteLength: layout.byteLength,
        referenceOffsets,
        generalOffsets,
      });
      codeLength += size;
    }
    const dispatchOffsets = new Map<string, number>();
    const firstDescriptor = records[0],
      lastDescriptor = records[records.length - 1];
    if (firstDescriptor !== undefined && lastDescriptor !== undefined) {
      dispatchOffsets.set("start", firstDescriptor.offset);
      dispatchOffsets.set("end", lastDescriptor.offset);
    }
    for (const [key, set] of dispatchSets) {
      const last = set.records[set.records.length - 1] ?? set.first,
        byteLength = Math.ceil((last - set.first + 1) / 8);
      if (byteLength > maxByteLength - codeLength)
        fail("CODE_LIMIT", "dispatch sets exceed byte budget");
      dispatchOffsets.set(key, codeLength);
      codeLength += byteLength;
    }
    // Only address-taken functions and indirect-call witnesses need identities.
    // Their addresses are relocated within this image; even identical bytes in
    // another image deliberately remain a different identity.
    const signatureOffsets = new Map<number, number>();
    const signatureTargets = signatureFixups.map((fixup) => fixup.target);
    for (const id of options.signatureRoots ?? []) {
      if (
        id === undefined ||
        !Number.isInteger(id) ||
        id < 0 ||
        module.functions[id] === undefined ||
        module.functions[id]?.import === true
      )
        fail("INVALID_IR", "invalid retained signature root");
      signatureTargets.push(id);
    }
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
    // The safepoint table, then the footer naming it, end the module.
    const stackMapWords = encodeStackMapTable(safepoints);
    if (stackMapWords === undefined)
      fail("CODE_LIMIT", "stack map table exceeds its encoding");
    codeLength = Math.ceil(codeLength / 8) * 8;
    const stackMapOffset = codeLength,
      stackMapBytes = stackMapWords.length * 8 + nativeStackMapFooterBytes;
    if (stackMapBytes > maxByteLength - codeLength)
      fail("CODE_LIMIT", "stack map table exceeds byte budget");
    codeLength += stackMapBytes;
    codeLength = Math.ceil(codeLength / 4) * 4;
    if (codeLength > maxByteLength)
      fail("CODE_LIMIT", "aligned literal pool exceeds byte budget");
    // Pool units preserve UTF-16 code units, including lone surrogates.
    const code = new Uint8Array(codeLength);
    for (const literal of strings) {
      if (literal === undefined) throw "literal invariant";
      const n = literal.value.length;
      code[literal.offset] = 1;
      const lengthWritten = writeUnsigned(
        code,
        literal.offset + nativeStringLengthOffset,
        4,
        n,
        "little",
      );
      if (!lengthWritten.ok) fail("ENCODING", lengthWritten.error);
      for (let i = 0; i < n; i++) {
        const unit = literal.value.charCodeAt(i);
        code[literal.offset + nativeStringDataOffset + i * 2] = unit % 256;
        code[literal.offset + nativeStringDataOffset + 1 + i * 2] = Math.floor(
          unit / 256,
        );
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
    for (const [key, set] of dispatchSets) {
      const base = dispatchOffsets.get(key);
      if (base === undefined) throw "dispatch set layout invariant";
      for (const record of set.records) {
        if (record === undefined) throw "dispatch set invariant";
        const bit = record - set.first,
          at = base + (bit >>> 3);
        code[at] = (code[at] ?? 0) | (1 << (bit & 7));
      }
    }
    // Family words: low and high 32-bit halves per descriptor word.
    const familyHalves = new Uint32Array(
      recordLayouts.length * dispatchFamilyWords * 2,
    );
    for (const [key, family] of dispatchFamilies) {
      const set = dispatchSets.get(key);
      if (set === undefined) throw "dispatch family invariant";
      for (const record of set.records) {
        if (record === undefined) throw "dispatch family record invariant";
        const half =
          (record * dispatchFamilyWords + (family >>> 6)) * 2 +
          ((family & 63) >>> 5);
        familyHalves[half] =
          ((familyHalves[half] ?? 0) | (1 << (family & 31))) >>> 0;
      }
    }
    for (const record of records) {
      if (record === undefined) throw "record descriptor invariant";
      for (let word = 0; word < dispatchFamilyWords; word++) {
        const half = (record.record * dispatchFamilyWords + word) * 2;
        const written = writeWord64(
          code,
          record.offset - 16 - word * 8,
          { lo: familyHalves[half] ?? 0, hi: familyHalves[half + 1] ?? 0 },
          "little",
        );
        if (!written.ok) fail("ENCODING", written.error);
      }
      poolWord(record.offset - 8, record.record);
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
    for (let index = 0; index < stackMapWords.length; index++)
      poolWord(stackMapOffset + index * 8, stackMapWords[index] ?? 0);
    poolWord(codeLength - 16, nativeStackMapFooterMagic);
    poolWord(codeLength - 8, stackMapOffset);
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
    for (let fixupIndex = 0; fixupIndex < fixups.length; fixupIndex++) {
      const fixup = fixups[fixupIndex];
      if (fixup === undefined) throw "fixup invariant";
      if (resolvedFixups.has(fixupIndex)) continue;
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
      if (!r.ok) compactFailure(r.error, fixup);
    }
    /** Patch a helper call: a BL in compact form, otherwise an x16 address. */
    function patchCall(offset: number, targetOffset: number): boolean {
      if (!compactCalls)
        return patchRelativeAddress(code, {
          offset,
          targetOffset,
          rd: 16,
          scratch: 17,
        }).ok;
      const r = patchBranch(code, {
        offset,
        targetOffset,
        branch: { op: "bl" },
      });
      if (!r.ok) compactFailure(r.error, undefined);
      return true;
    }
    for (const fixup of helperFixups) {
      if (fixup === undefined) throw "fixup invariant";
      const targetOffset = helperOffsets.get(fixup.kind);
      if (targetOffset === undefined) throw "helper layout invariant";
      if (!patchCall(fixup.offset, targetOffset))
        fail("ENCODING", "helper call failed");
    }
    for (const fixup of cellFixups) {
      if (fixup === undefined) throw "fixup invariant";
      const targetOffset = cellOffsets.get(fixup.key);
      if (targetOffset === undefined) throw "cell helper layout invariant";
      if (!patchCall(fixup.offset, targetOffset))
        fail("ENCODING", "cell helper branch failed");
    }
    /** Patch a local address: an in-reach ADR, else the long sequence.
     * An out-of-reach ADR moves its function to long addresses. */
    function patchLocal(
      offset: number,
      targetOffset: number,
      rd: number,
    ): boolean {
      const owner = compactSites.get(offset);
      if (owner === undefined && pageSites.has(offset))
        return patchPageAddress(code, { offset, targetOffset, rd }).ok;
      if (owner === undefined)
        return patchRelativeAddress(code, {
          scratch: 17,
          offset,
          targetOffset,
          rd,
        }).ok;
      const patched = patchAddress(code, { offset, targetOffset, rd });
      if (patched.ok) return true;
      if (patched.error !== "OUT_OF_RANGE") return false;
      compactOverflow = true;
      forms.longAddresses.add(owner);
      return true;
    }
    for (const fixup of stringFixups) {
      if (fixup === undefined) throw "fixup invariant";
      const targetOffset = stringOffsets.get(fixup.value);
      if (targetOffset === undefined) throw "literal pool invariant";
      if (!patchLocal(fixup.offset, targetOffset, 9))
        fail("ENCODING", "string address failed");
    }
    for (const fixup of functionAddresses) {
      if (fixup === undefined) throw "fixup invariant";
      if (functions[fixup.target]?.import === true)
        fail("INVALID_IR", "imported function has no local code address");
      const targetOffset = functions[fixup.target]?.offset;
      if (targetOffset === undefined) throw "function address invariant";
      if (!patchLocal(fixup.offset, targetOffset, fixup.rd))
        fail("ENCODING", "local address failed");
    }
    for (const fixup of signatureFixups) {
      if (fixup === undefined) throw "signature fixup invariant";
      const identity = signatureIds[fixup.target];
      const targetOffset =
        identity === undefined ? undefined : signatureOffsets.get(identity);
      if (targetOffset === undefined) throw "signature address invariant";
      if (!patchLocal(fixup.offset, targetOffset, fixup.rd))
        fail("ENCODING", "local address failed");
    }
    for (const fixup of managedPointerFixups) {
      if (fixup === undefined) throw "managed pointer fixup invariant";
      const target = managedImports[fixup.request];
      if (target === undefined) throw "managed pointer slot invariant";
      if (!patchLocal(fixup.offset, target.offset, fixup.rd))
        fail("ENCODING", "managed slot address failed");
    }
    for (const fixup of dispatchFixups) {
      if (fixup === undefined) throw "fixup invariant";
      const targetOffset = dispatchOffsets.get(fixup.key);
      if (targetOffset === undefined) throw "dispatch fixup invariant";
      if (!patchLocal(fixup.offset, targetOffset, 11))
        fail("ENCODING", "dispatch set address failed");
    }
    for (const fixup of recordFixups) {
      if (fixup === undefined) throw "fixup invariant";
      const record = records[fixup.record];
      if (record === undefined) throw "record descriptor invariant";
      if (!patchLocal(fixup.offset, record.offset, 11))
        fail("ENCODING", "record descriptor address failed");
    }
    if (compactOverflow) fail("ENCODING", compactRangeMessage);
    return {
      ok: true,
      value: {
        code,
        linearAllocation,
        generationalBarriers,
        sourceRanges,
        operationRanges: recordOperations ? operationRanges : undefined,
        startupCalls: startupCalls.length > 0 ? startupCalls : undefined,
        functions,
        callbackThunks:
          thunkOffsets.length === 0
            ? undefined
            : {
                offset: thunkStart,
                byteLength: thunkEnd - thunkStart,
                thunks: thunkOffsets,
              },
        helpers,
        cellHelpers,
        strings,
        stackMaps: [
          {
            codeOffset: 0,
            codeLength,
            tableOffset: stackMapOffset,
            byteLength: stackMapBytes,
            entries: safepoints.length,
          },
        ],
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
        managedReferences: managedPointerFixups.map(
          (fixup): NativeManagedAddressReference =>
            compactSites.has(fixup.offset)
              ? {
                  offset: fixup.offset,
                  rd: fixup.rd,
                  import: fixup.request,
                  compact: true,
                }
              : { offset: fixup.offset, rd: fixup.rd, import: fixup.request },
        ),
      },
    };
  } catch (error) {
    if (error !== abort) throw error;
  }
  if (failure === undefined) throw "emission failure invariant";
  return { ok: false, error: failure };
}

/** Stack overflow completion, called from a prologue before any frame store:
 * x0 context, x3 result record. Uses no stack.
 * Enters emergency mode once (saves the limit, disables checks) and completes
 * the call by throwing undefined. The first catch landing restores the limit
 * and leaves 1 (overflow pending) for a JavaScript boundary to convert. */
function stackOverflowHelper(): readonly Instruction[] {
  // Enter emergency mode unless already unwinding an overflow: save the limit
  // and disable checks so the throw path and epilogues run in the headroom.
  // Then complete the call by throwing undefined with the reserved payload.
  const payload = nativeStackOverflowPayload;
  return [
    { op: "ldr", width: 64, rt: 16, rn: 0, offset: nativeEngineThrowOffset },
    { op: "cbnz", width: 64, rt: 16, displacement: 16 },
    { op: "ldr", width: 64, rt: 16, rn: 0, offset: nativeStackLimitOffset },
    { op: "str", width: 64, rt: 16, rn: 0, offset: nativeEngineThrowOffset },
    { op: "str", width: 64, rt: "zr", rn: 0, offset: nativeStackLimitOffset },
    { op: "str", width: 64, rt: "zr", rn: 3, offset: 16 },
    { op: "movz", width: 64, rd: 16, immediate: payload % 65536, shift: 0 },
    {
      op: "movk",
      width: 64,
      rd: 16,
      immediate: Math.floor(payload / 65536) % 65536,
      shift: 16,
    },
    {
      op: "movk",
      width: 64,
      rd: 16,
      immediate: Math.floor(payload / 4294967296) % 65536,
      shift: 32,
    },
    {
      op: "movk",
      width: 64,
      rd: 16,
      immediate: Math.floor(payload / 281474976710656) % 65536,
      shift: 48,
    },
    { op: "str", width: 64, rt: 16, rn: 3, offset: 24 },
    { op: "movz", width: 64, rd: 0, immediate: 2, shift: 0 },
    { op: "str", width: 32, rt: 0, rn: 3, offset: 0 },
    { op: "ret", rn: 30 },
  ];
}
