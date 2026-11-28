import {
  bindManagedABI,
  type ManagedABIRequest,
  type ManagedIdentityImport,
  type NativeManagedPointerImport,
} from "../../scalar/managed-abi.ts";
import {
  planLocalSignatures,
  type LocalSignatureBinding,
} from "./signature-groups.ts";
import type { Word64EmitContext } from "./word64.ts";
export type { LocalSignatureBinding } from "./signature-groups.ts";
import {
  nativeActivationTopOffset,
  nativeContextDomainOffset,
  nativeContextManagedBaseOffset,
  nativeContextManagedLengthOffset,
  nativeGenerationalNurseryAddressOffset,
  nativeGenerationalStateWords,
  nativeIdentityReleasableBaseOffset,
  nativeIdentityReleasableLengthOffset,
  nativeEngineThrowOffset,
  nativeStackOverflowPayload,
  nativeWorkerStopObserved,
  nativeWorkerStopPayload,
  nativeWorkerStopPointerOffset,
  nativeWorkerStopRequested,
  nativeStackLimitOffset,
  nativeCStackReserveBytes,
  nativeHeaderFlagUnit,
  nativeHeaderFlagsShift,
  nativeBuiltinMarkerLimit,
  nativeStringLengthOffset,
  nativeStringIndexField,
  nativeStringIndexFieldOffset,
  nativeStringDataOffset,
  nativeStringOneByteFlag,
  nativeStringTwoByteHeader,
  nativeStringSlicedFlag,
  nativeStringMinimumDataBytes,
  nativeStringSlicedStartOffset,
  nativeStringParentOffset,
  nativeStringSlicedByteLength,
  nativeStringSlicedMinimumLength,
  nativeNumberStringCacheWord,
  nativeNumberStringCacheEntries,
  nativeStringSplitCacheWord,
  nativeStringSplitCacheEntries,
  nativeGcEpochWord,
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
} from "@tint/abi/function";
import { nativeSignatureTypeCode } from "../../scalar/signature.ts";
export { nativeSignatureTypeCode } from "../../scalar/signature.ts";
import {
  temporaryRegisters,
  nonAllocatingBlocks,
} from "./temporary-registers.ts";
import {
  recordDispatchChains,
  type RecordDispatchChain,
  type RecordDispatchGroup,
} from "./record-dispatch.ts";
import {
  deadSlotClearPlan,
  prologueClearWords,
  poolClearPlan,
  preSafepointResults,
} from "./pool-clears.ts";
import {
  shareFrameSlots,
  type SlotSharing,
} from "../../scalar/slot-sharing.ts";
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
import {
  chainedBlockOrder,
  fallsThrough,
  findSelectDiamonds,
  forwardableEntries,
  orderBlockIds,
  provenNonNullValues,
  type NestedSelect,
  type SelectArm,
} from "./block-entries.ts";
import {
  fusedPropertyAccesses,
  knownGeneralEqualTags,
  knownObjectFacts,
  scriptEntryCalleeValues,
} from "../../scalar/property-fusion.ts";
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
  nativeTargetArchAArch64,
  nativeTargetOSDarwin,
  nativeTargetOSLinux,
  type PosixHostABI,
} from "@tint/abi/host";
import {
  encodeStackMapTable,
  rootHeadBinding,
  safepointLiveSlots,
  type SafepointEntry,
  type SafepointSite,
} from "../../scalar/stack-maps.ts";
import {
  encodeFloat64,
  writeUnsigned,
  writeWord64,
} from "@tint/foundation/binary/bytes";
import { emitCellAccess, type CellAccess } from "../cell.ts";
import { numericHelper, type NumericHelper } from "./numeric.ts";
import {
  stringHelper,
  stringHelperAlignment,
  type StringHelper,
} from "./strings.ts";
import { isOneByteText, stringTextBytes } from "../../scalar/string-text.ts";
import { arrayInitializer } from "./arrays.ts";
import {
  sharedMemoryPrimitive,
  type SharedMemoryPrimitive,
} from "./shared-memory.ts";
import {
  emitBytesLoad,
  emitBytesStore,
  emitBytesWord64Load,
  emitBytesWord64Store,
  memoryFiller,
  memoryMover,
  type BytesEmitContext,
} from "./memory.ts";
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
import { allocationHelper, type AllocationHelper } from "./allocation.ts";
import {
  emitGeneralElementAccess,
  emitPolymorphicPropertyStore,
  emitSpecializedGeneralEqual,
  planDirectGeneralTargets,
} from "./general-elements.ts";
import {
  emitHostCall,
  rawWordOperation,
  type HostCallEmitContext,
} from "./host-calls.ts";
import {
  emitCCall,
  emitCMemory,
  type CInteropEmitContext,
} from "./c-interop.ts";
import {
  emitStringCacheOp,
  emitStringCoreOp,
  emitStringTextOp,
  oneByteHighBit,
  slicedBit,
  slicedHighBit,
  type ColdNaNStub,
  type ColdSliceStub,
  type StringOpsEmitContext,
} from "./string-ops.ts";
import {
  emitElementAccess,
  emitGlobalCell,
  emitPropertyAccess,
  emitRecordNew,
  emitScriptEntry,
  type ObjectOpsEmitContext,
} from "./object-ops.ts";
import { emitArrayOp, type ArrayOpsEmitContext } from "./array-ops.ts";
import { emitFunctionBlocks } from "./block-emitter.ts";
import {
  floatCondition,
  invertCondition,
  managed,
  presentSourceSurvivesTrailingStores,
  trailingStringPresent,
} from "./block-helpers.ts";
export type LeafHelperKind =
  | SharedMemoryPrimitive
  | AllocationHelper
  | NumericHelper
  | StringHelper
  | "array-initialize"
  | "memory-move"
  | "array-copy"
  | "array-fill"
  | "remember-object"
  | "stack-overflow";
import {
  cachedListReadPrefix,
  uncheckedListReadPrefix,
  uncheckedListWritePrefix,
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
  provenWordReturns,
  functionHeader,
  type FunctionBodySource,
  provenWordArguments,
  provenInductionWords,
  wordOnlyValues,
  provenNoSafepoints,
  provenDirectOnlyFunctions,
  stableRecordLayouts,
  stableDescriptors,
  trackedManagedWrites,
  instructionResult,
  visitInstructionOperands,
  visitTerminatorOperands,
  planTemporarySlots,
  hostReturnType,
  executableHostOperation,
  foreignCallTypes,
  foreignMemoryTypes,
  dynamicCallFrame,
  dynamicScalarFrame,
  callbackTransition,
  callbackEntered,
  callbackState,
  naturalLoops,
  blockSuccessors,
  isNativeTypedArray,
  nativeTypedArray,
  typedArrayIntegerElements,
  typedArrayNumericAtomics,
  typedArrayLayout,
  typedArrayMarker,
  typedArrayScale,
  activationFieldType,
  type LoopForest,
  type SlotLiveness,
  type WordFacts,
  type ModuleIR,
  type RecordFlowFacts,
  type FunctionIR,
  type Verification,
  type RecordLayout,
  type ScalarType,
  type NativeTypedArray,
  type Span,
  type Block as IRBlock,
  type Instruction as IRInstruction,
  type ArrayAtomicOperation,
  type Terminator as IRTerminator,
  type ForeignCall,
  instructionEffects as irInstructionEffects,
  effectAllocate as irEffectAllocate,
} from "@tint/ir/scalar";
import { compactSlots } from "@tint/ir/optimization";
import type {
  BaseRegister,
  Instruction as MachineInstruction,
  MemoryAccessWidth,
} from "../isa.ts";
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
  branchAt,
  patchRelativeAddress,
  patchAddress,
  pageAddress,
  patchPageAddress,
  relativeAddress,
  farRelativeAddress,
  float64Immediate,
  logicalImmediate32,
  encode,
  type EncodingResult,
  type Instruction,
  type Branch,
  type Condition,
} from "../isa.ts";
import {
  activationArgumentsOffset,
  activationCalleeOffset,
  activationCountOffset,
  activationFrameOffset,
  activationRecordBytes,
  signatureLayout,
  scriptArgumentLayout,
  scriptFirstActualRegister,
  scriptGpActualRegisterPairs,
  scriptActualRegisterPairs,
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
export {
  decodeStackMaps,
  encodeStackMapTable,
  type DecodedSafepoint,
  type SafepointEntry,
} from "../../scalar/stack-maps.ts";
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
  /** A farRelativeAddress site (20 bytes) of a far-model module; absent
   * for the 16-byte relativeAddress site. */
  readonly far?: true | undefined;
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
  /** Functions whose long branches use the register-indirect far form. */
  readonly farBranches?: readonly string[] | undefined;
  /** The far code model (EmissionOptions.farAddresses). */
  readonly far?: boolean | undefined;
}
/** A call whose target the hosted startup composition supplies: a diagnostics
 * routine outside the module (see EmissionOptions.throwTraces). */
export interface NativeStartupCall {
  readonly offset: number;
  readonly target: "trace-capture" | "jit-descriptor" | "jit-register";
  readonly far?: true | undefined;
}
export interface NativeModule {
  /** Calls into hosted diagnostics routines (throwTraces and the jit-debug
   * host operations); startup patches each call. */
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
  /** A register-indirect far branch: an x16 address sequence then BR. */
  readonly far?: true | undefined;
}
/** Bytes of each one-unit pool string: align16(16 + 8), as the literal pool
 * sizes every string with its minimum eight data bytes. */
const unitStringBytes: number = 32;
/** A private leaf helper's instructions, and whether it is a string helper
 * (whose loop heads are aligned, so it starts aligned). */
function leafHelperBody(kind: LeafHelperKind): {
  readonly body: readonly Instruction[];
  readonly aligned: boolean;
} {
  if (
    kind === "shared-read-unsigned" ||
    kind === "shared-write-unsigned" ||
    kind === "shared-read-word64" ||
    kind === "shared-write-word64" ||
    kind === "shared-compare-exchange-word64" ||
    kind === "shared-compare-exchange-unsigned"
  )
    return { body: sharedMemoryPrimitive(kind), aligned: false };
  if (kind === "to-uint32" || kind === "remainder")
    return { body: numericHelper(kind), aligned: false };
  if (kind === "array-initialize")
    return { body: arrayInitializer(), aligned: false };
  if (kind === "memory-move" || kind === "array-copy")
    return { body: memoryMover(kind === "array-copy"), aligned: false };
  if (kind === "array-fill") return { body: memoryFiller(), aligned: false };
  if (kind === "remember-object")
    return { body: rememberedBarrier(), aligned: false };
  if (kind === "stack-overflow")
    return { body: stackOverflowHelper(), aligned: false };
  if (kind === "allocate-call" || kind === "allocate-finish")
    return { body: allocationHelper(kind), aligned: false };
  return { body: stringHelper(kind), aligned: true };
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
/** The condition holding exactly when `condition` does not. */
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
export interface ListReadShape {
  readonly header: number;
  readonly field: number;
  /** cached: a cacheListVectors reader (vector, list, index) whose first
   * argument is the list's current root vector or none.
   * unchecked: a preheader-guarded reader (vector, list, index) whose vector
   * is proven non-null with length > index. */
  readonly mode: "read" | "has" | "cached" | "unchecked";
}
interface HoistedArraySlot {
  readonly slot: number;
  readonly reg: number;
}
interface HoistedImulConst {
  readonly u32: number;
  readonly reg: number;
}
interface HoistedFloatConst {
  readonly value: number;
  readonly reg: number;
}
export interface PreheaderHoistPlan {
  readonly arraySlots: readonly HoistedArraySlot[];
  readonly imulConsts: readonly HoistedImulConst[];
  readonly floatConsts: readonly HoistedFloatConst[];
}
function listReadShape(fn: FunctionIR): ListReadShape | undefined {
  if (fn.import === true) return undefined;
  if (fn.name.startsWith(uncheckedListReadPrefix))
    return (fn.returnType === "optional-reference" ||
      fn.returnType === "optional-string") &&
      fn.parameters.length === 3 &&
      fn.slots[0] === "optional-reference" &&
      fn.slots[1] === "reference" &&
      fn.slots[2] === "number"
      ? { header: -1, field: -1, mode: "unchecked" }
      : undefined;
  if (fn.name.startsWith(cachedListReadPrefix))
    return (fn.returnType === "optional-reference" ||
      fn.returnType === "optional-string") &&
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
export interface ListWriteShape {
  readonly header: number;
  readonly unchecked?: boolean;
}
function listWriteShape(fn: FunctionIR): ListWriteShape | undefined {
  if (fn.import === true) return undefined;
  if (fn.name.startsWith(uncheckedListWritePrefix))
    return fn.returnType === "void" &&
      fn.parameters.length === 4 &&
      fn.slots[0] === "reference" &&
      fn.slots[1] === "reference" &&
      fn.slots[2] === "number" &&
      (fn.slots[3] === "optional-reference" ||
        fn.slots[3] === "optional-string")
      ? { header: -1, unchecked: true }
      : undefined;
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

export type {
  ManagedABIRequest,
  ManagedFunctionEntryBinding,
  ManagedIdentityImport,
  ManagedRecordBinding,
  ManagedSignatureBinding,
  NativeManagedPointerImport,
} from "../../scalar/managed-abi.ts";
/** Fused union dispatch chains at least this long test membership with one
 * bitset lookup (about 20 instructions) instead of a comparison per layout. */
/** The sliced string kind flag's header bit, and that bit in the header's
 * high word (a 32-bit load at +4). */
const dispatchBitsetThreshold = 10;
/** A branch emitted with displacement 0, patched to a label later. */
export interface LocalBranch {
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
  | "proven-non-null"
  | "safepoint-liveness";

export interface EmissionOptions {
  readonly workerFunctions?: ReadonlySet<string> | undefined;
  /** The target implements FEAT_JSCVT (every Apple silicon core does), so
   * ToInt32 of an unproven binary64 is one FJCVTZS. */
  readonly jsConvert?: boolean | undefined;
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
  /** The large code model (docs/large-images.md): every relocatable
   * address, long call and import site uses the far (±2^48) sequence.
   * Undefined selects it automatically for modules of farModuleBytes or
   * more, or when a near form cannot reach its target; true forces it. */
  readonly farAddresses?: boolean | undefined;
  /** The module size from which emission switches to the far model
   * (default farModuleBytes; tests lower it). */
  readonly farModuleBytes?: number | undefined;
  /** Verification of the large code model on small programs: the far
   * model, register-indirect calls and far branches for every function,
   * the forms a multi-GiB image selects only where reach requires them. */
  readonly forceFarReach?: boolean | undefined;
  readonly hostABI?: PosixHostABI | undefined;
  readonly debugSpans?: boolean | undefined;
  /** Record NativeOperationRange entries (analysis tooling only). */
  readonly operationRanges?: boolean | undefined;
  readonly linearAllocation?: boolean | undefined;
  readonly generationalBarriers?: boolean | undefined;
  /** The image's trust boundary for run-time code: every executable entry it
   * calls was produced by its own unit linker under this image's barrier
   * policy, so generational emission accepts executable calls
   * (trackedManagedWrites). Only images built with allowJit may set it. */
  readonly trustedExecutableCode?: boolean | undefined;
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
/** Modules from this size on use the far code model: half the ±4 GiB reach
 * of near address sequences, so a near module and the image facts around
 * it (other modules, import slots, data) stay within near reach. */
export const farModuleBytes: number = 2147483648;
/** IR instructions below which local addresses start as a single ADR. */
const compactAddressInstructions: number = 65536;
/** Module facts every emission attempt needs and none of the branch forms
 * affect: computed by the first attempt, reused by compact-range retries. */
interface EmissionFacts {
  verified: Verification | undefined;
  frameModule: ModuleIR | undefined;
  wordReturns: Uint8Array | undefined;
  wordArguments: readonly Uint8Array[] | undefined;
  wordArgumentsKnown: boolean;
  recordFlows: RecordFlowFacts | undefined;
  recordFlowsKnown: boolean;
  noSafepoints: Uint8Array | undefined;
  noSafepointsKnown: boolean;
  directReturns: Uint8Array | undefined;
  directReturnsKnown: boolean;
  pureLeafNoActivation: Uint8Array | undefined;
}
export interface BranchForms {
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
  /** The far code model: relocatable addresses, long calls and import
   * sites use farRelativeAddress (docs/large-images.md). */
  far: boolean;
  /** Functions whose blocks long branches reach through x16 (an address
   * sequence and BR) because an unconditional B (±128 MiB) cannot: blocks
   * of functions larger than 128 MiB. */
  readonly farBranches: Set<number>;
}
/** Conditional branches (±1 MiB), calls (±128 MiB) and local addresses
 * (±1 MiB) are emitted in their single-instruction forms. Out-of-reach
 * targets are collected and emission restarts with long forms for exactly
 * those functions (or for all calls), so output is a pure function of the
 * input. */
/** Frame preparation may replace bodies with compacted slot layouts. */
export interface EmissionBodies extends FunctionBodySource {
  readonly put: (fn: FunctionIR) => void;
}
export function emitModule(
  module: ModuleIR,
  options: EmissionOptions = {},
): Emission {
  const functions = module.functions.slice();
  const bodies: EmissionBodies = {
    get: (id: number): FunctionIR => {
      const fn = functions[id];
      if (fn === undefined) throw "function body invariant";
      return fn;
    },
    put: (fn: FunctionIR): void => {
      functions[fn.id] = fn;
    },
    release: (_id: number): void => {},
  };
  return emitModuleFromStore(module, bodies, options);
}
/** Emit with function headers and a rereadable source of bodies. */
export function emitModuleFromStore(
  module: ModuleIR,
  bodies: EmissionBodies,
  options: EmissionOptions = {},
): Emission {
  // Single-instruction local addresses only pay off below ADR's 1 MiB reach;
  // larger modules start with the four-instruction form instead of retrying.
  let size = 0;
  if (options.compactAddresses === undefined)
    for (let id = 0; id < module.functions.length; id++) {
      if (size >= compactAddressInstructions) break;
      if (module.functions[id] === undefined) continue;
      const fn = bodies.get(id);
      try {
        for (const block of fn.blocks)
          size += 1 + (block?.instructions.length ?? 0);
      } finally {
        bodies.release(id);
      }
    }
  const forms: BranchForms = {
    calls: true,
    addresses: options.compactAddresses ?? size < compactAddressInstructions,
    longBranches: new Set(),
    longAddresses: new Set(),
    islands: new Set(),
    far: options.farAddresses === true || options.forceFarReach === true,
    farBranches: new Set(),
  };
  if (options.forceFarReach === true) {
    forms.calls = false;
    for (const fn of module.functions)
      if (fn !== undefined) {
        forms.longBranches.add(fn.id);
        forms.farBranches.add(fn.id);
      }
  }
  const facts: EmissionFacts = {
    verified: undefined,
    frameModule: undefined,
    wordReturns: undefined,
    wordArguments: undefined,
    wordArgumentsKnown: false,
    recordFlows: undefined,
    recordFlowsKnown: false,
    noSafepoints: undefined,
    noSafepointsKnown: false,
    directReturns: undefined,
    directReturnsKnown: false,
    pureLeafNoActivation: undefined,
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
    seed(hints.farBranches ?? [], forms.farBranches);
    for (const fn of forms.farBranches) forms.longBranches.add(fn);
    if (hints.far === true && options.farAddresses !== false) forms.far = true;
    if (forms.addresses) seed(hints.longAddresses, forms.longAddresses);
  }
  // Each retry moves calls or at least one function a step towards long
  // forms (compact, islands, long), so emission terminates; larger forms only
  // grow code, so retries may cascade.
  const farFrom = options.farModuleBytes ?? farModuleBytes;
  while (true) {
    const before =
        forms.longBranches.size +
        forms.longAddresses.size +
        forms.islands.size +
        forms.farBranches.size,
      calls = forms.calls,
      far = forms.far;
    const emitted = emitModuleForms(module, bodies, options, forms, facts);
    if (emitted.ok) {
      // A module this large re-emits in the far model, so its sites (and
      // those the image patches later) reach anywhere in a large image.
      if (
        !forms.far &&
        options.farAddresses !== false &&
        emitted.value.code.length >= farFrom
      ) {
        forms.far = true;
        continue;
      }
      return {
        ok: true,
        value: { ...emitted.value, formHints: describeForms(module, forms) },
      };
    }
    if (emitted.error.message !== compactRangeMessage) return emitted;
    // Defensive: a retry that moved nothing to long forms cannot succeed.
    if (
      forms.calls === calls &&
      forms.far === far &&
      forms.longBranches.size +
        forms.longAddresses.size +
        forms.islands.size +
        forms.farBranches.size ===
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
  const hints: EmissionFormHints = {
    calls: forms.calls,
    longBranches: names(forms.longBranches),
    islands: names(forms.islands),
    longAddresses: names(forms.longAddresses),
  };
  if (!forms.far && forms.farBranches.size === 0) return hints;
  return { ...hints, farBranches: names(forms.farBranches), far: forms.far };
}
/** Single-store integer slots used as a remainder divisor keep a precomputed
 * floor(2^32 / d) reciprocal word in the frame (0 when d <= 0 or d > 2^32),
 * hoisted to the outermost single-store integer copy origin when one exists. */
function planReciprocalOffsets(
  fn: FunctionIR,
  integerSlots: Uint8Array,
  baseCursor: number,
): {
  readonly storeOffsets: Uint32Array;
  readonly divisorOffsets: Uint32Array;
  readonly extraBytes: number;
} {
  const storeOffsets = new Uint32Array(fn.slots.length),
    divisorOffsets = new Uint32Array(fn.slots.length);
  const storeCount = new Uint32Array(fn.slots.length),
    copySource = new Uint32Array(fn.slots.length),
    divisorUse = new Uint8Array(fn.slots.length),
    parameterSlot = new Uint8Array(fn.slots.length);
  for (const p of fn.parameters) if (p !== undefined) parameterSlot[p] = 1;
  for (const block of fn.blocks) {
    if (block === undefined) continue;
    const loadSlot = new Map<number, number>();
    for (const op of block.instructions) {
      if (op === undefined) continue;
      if (op.kind === "load") loadSlot.set(op.id, op.slot);
      else if (op.kind === "store") {
        storeCount[op.slot] = (storeCount[op.slot] ?? 0) + 1;
        const src = loadSlot.get(op.value);
        copySource[op.slot] =
          src !== undefined && src !== op.slot ? src + 1 : 0;
      } else if (op.kind === "binary" && op.operator === "%") {
        const s = loadSlot.get(op.right);
        if (s !== undefined) divisorUse[s] = 1;
      }
    }
    const t = block.terminator;
    if (
      (t.kind === "record" || t.kind === "record-cell" || t.kind === "cell") &&
      t.operation === "read"
    )
      storeCount[t.slot] = (storeCount[t.slot] ?? 0) + 1;
    if (block.exception !== undefined)
      storeCount[block.exception.slot] =
        (storeCount[block.exception.slot] ?? 0) + 1;
  }
  let extraBytes = 0;
  for (let slot = 0; slot < fn.slots.length; slot++) {
    if (
      integerSlots[slot] === 1 &&
      parameterSlot[slot] !== 1 &&
      storeCount[slot] === 1 &&
      divisorUse[slot] === 1
    ) {
      let root = slot;
      for (let hop = 0; hop < 4; hop++) {
        const parent = (copySource[root] ?? 0) - 1;
        if (
          parent < 0 ||
          integerSlots[parent] !== 1 ||
          parameterSlot[parent] === 1 ||
          storeCount[parent] !== 1
        )
          break;
        root = parent;
      }
      let offset = storeOffsets[root] ?? 0;
      if (offset === 0) {
        if (baseCursor + extraBytes > 32752) continue;
        offset = baseCursor + extraBytes;
        storeOffsets[root] = offset;
        extraBytes += 8;
      }
      divisorOffsets[slot] = offset;
    }
  }
  return { storeOffsets, divisorOffsets, extraBytes };
}
/** Stores floor(2^32 / d) at frame offset `recip` (clamped to 0 for d <= 0
 * or d > 2^32 so the remainder fast path falls back cleanly to sdiv). */
/** Zero-spill inline nursery allocator for a 32-byte sliced-string view
 * (x9 source, x10 source header, x12 byte start, x13 count, x14 view header).
 * When `fastViews` is provided, jumps over an inline slow path; otherwise
 * falls straight through and returns the slow-path branch sites for a cold
 * slice stub. */
function emitColdSliceStubs(
  emit: (instruction: MachineInstruction) => void,
  patchInstruction: (index: number, instruction: MachineInstruction) => void,
  rawLoad: (rt: number, offset: number) => void,
  rawStore: (rt: number | "zr", offset: number) => void,
  rawValue: (rt: number, id: number) => void,
  imm: (rd: number, value: number) => void,
  prepareStringSize: (oneByte: number) => void,
  allocate: (prepare: () => void, size: (rd: number) => void) => void,
  callHelper: (kind: LeafHelperKind) => void,
  setSite: (block: number, index: number) => void,
  clearStackWords: () => void,
  instructions: { readonly length: number },
  contextOffset: number,
  allocationOffset: number,
  stubs: readonly ColdSliceStub[],
): void {
  for (const stub of stubs) {
    if (stub === undefined) continue;
    clearStackWords();
    setSite(stub.block, stub.index);
    // Narrow path: two-byte source, count >= 9, x14 = 1.
    // Flat 9..16 hits narrowExact with x15 = source + 16 + (begin << 1):
    // allocate 32 bytes and write two aligned non-overlapping 8-byte stores
    // without calling string-slice-narrow.
    const narrowExactTarget = instructions.length;
    patchInstruction(stub.narrowExact, {
      op: "b.cond",
      condition: "eq",
      displacement: (narrowExactTarget - stub.narrowExact) * 4,
    });
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 13,
      immediate: 16,
      shift: 0,
      setFlags: true,
    });
    const narrowExactLong = instructions.length;
    emit({ op: "b.cond", condition: "hi", displacement: 0 });
    emit({
      op: "add-reg",
      width: 64,
      rd: 10,
      rn: "zr",
      rm: 15,
      shift: "lsl",
      amount: 0,
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
    const narrow16NoState = instructions.length;
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
    const narrow16Full = instructions.length;
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
      rd: 9,
      rn: 15,
      rm: 16,
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
    emit({ op: "ldr-q", qt: 0, rn: 10, offset: 0 });
    emit({ op: "xtn-8b", vd: 0, vn: 0 });
    emit({ op: "str-d", rt: 0, rn: 9, offset: nativeStringDataOffset });
    emit({
      op: "add-reg",
      width: 64,
      rd: 14,
      rn: 10,
      rm: 13,
      shift: "lsl",
      amount: 1,
      setFlags: false,
    });
    emit({
      op: "sub-imm",
      width: 64,
      rd: 14,
      rn: 14,
      immediate: 16,
      shift: 0,
      setFlags: false,
    });
    emit({ op: "ldr-q", qt: 0, rn: 14, offset: 0 });
    emit({ op: "xtn-8b", vd: 0, vn: 0 });
    emit({ op: "fmov-x-d", rd: 16, rn: 0 });
    emit({ op: "movz", width: 64, rd: 11, immediate: 16, shift: 0 });
    emit({
      op: "sub-reg",
      width: 64,
      rd: 11,
      rn: 11,
      rm: 13,
      shift: "lsl",
      amount: 0,
      setFlags: false,
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
    emit({ op: "lsrv", width: 64, rd: 16, rn: 16, rm: 11 });
    emit({
      op: "str",
      width: 64,
      rt: 16,
      rn: 9,
      offset: nativeStringDataOffset + 8,
    });
    emit({ op: "b", displacement: (stub.resume - instructions.length) * 4 });
    const narrowTarget = instructions.length;
    patchInstruction(narrowExactLong, {
      op: "b.cond",
      condition: "hi",
      displacement: (narrowTarget - narrowExactLong) * 4,
    });
    patchInstruction(stub.narrowCall, {
      op: "cbnz",
      width: 64,
      rt: 14,
      displacement: (narrowTarget - stub.narrowCall) * 4,
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
    emit({ op: "b", displacement: (stub.resume - instructions.length) * 4 });
    // Short path: count < 9. Inline flat count === 8 in the nursery before
    // falling back to the general flat-copy path.
    clearStackWords();
    const shortTarget = instructions.length;
    patchInstruction(stub.short, {
      op: "b.cond",
      condition: "cc",
      displacement: (shortTarget - stub.short) * 4,
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
    const shortNotEight = instructions.length;
    emit({ op: "b.cond", condition: "ne", displacement: 0 });
    const shortSliced = instructions.length;
    emit({ op: "tbnz", rt: 10, bit: slicedBit, displacement: 0 });
    const shortEightOneByte = instructions.length;
    emit({ op: "tbnz", rt: 10, bit: nativeHeaderFlagsShift, displacement: 0 });
    // Flat two-byte count === 8: probe 8 units, allocate 24 (narrow) or 32 (wide).
    emit({
      op: "add-imm",
      width: 64,
      rd: 14,
      rn: 9,
      immediate: nativeStringDataOffset,
      shift: 0,
      setFlags: false,
    });
    emit({
      op: "add-reg",
      width: 64,
      rd: 14,
      rn: 14,
      rm: 12,
      shift: "lsl",
      amount: 1,
      setFlags: false,
    });
    emit({
      op: "ldp",
      width: 64,
      rt: 16,
      rt2: 17,
      rn: 14,
      offset: 0,
      mode: "offset",
    });
    emit({ op: "ldr-q", qt: 0, rn: 14, offset: 0 });
    emit({ op: "orr-reg", width: 64, rd: 16, rn: 16, rm: 17 });
    emit({
      op: "ands-imm",
      width: 64,
      rd: "zr",
      rn: 16,
      n: 0,
      immr: 8,
      imms: 39,
    });
    const shortEightWide = instructions.length;
    emit({ op: "b.cond", condition: "ne", displacement: 0 });
    rawLoad(15, contextOffset);
    emit({
      op: "ldr",
      width: 64,
      rt: 15,
      rn: 15,
      offset: nativeAllocationStateOffset,
    });
    const short8NarrowNoState = instructions.length;
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
      immediate: nativeStringDataOffset + 8,
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
    const short8NarrowFull = instructions.length;
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
      rd: 9,
      rn: 15,
      rm: 16,
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
    emit({ op: "xtn-8b", vd: 0, vn: 0 });
    emit({ op: "str-d", rt: 0, rn: 9, offset: nativeStringDataOffset });
    emit({ op: "b", displacement: (stub.resume - instructions.length) * 4 });
    patchInstruction(shortEightWide, {
      op: "b.cond",
      condition: "ne",
      displacement: (instructions.length - shortEightWide) * 4,
    });
    rawLoad(15, contextOffset);
    emit({
      op: "ldr",
      width: 64,
      rt: 15,
      rn: 15,
      offset: nativeAllocationStateOffset,
    });
    const short8WideNoState = instructions.length;
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
      immediate: nativeStringDataOffset + 16,
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
    const short8WideFull = instructions.length;
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
      rd: 9,
      rn: 15,
      rm: 16,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    emit({
      op: "stp",
      width: 64,
      rt: 10,
      rt2: 13,
      rn: 9,
      offset: 0,
      mode: "offset",
    });
    emit({ op: "str-q", qt: 0, rn: 9, offset: nativeStringDataOffset });
    emit({ op: "b", displacement: (stub.resume - instructions.length) * 4 });
    patchInstruction(shortEightOneByte, {
      op: "tbnz",
      rt: 10,
      bit: nativeHeaderFlagsShift,
      displacement: (instructions.length - shortEightOneByte) * 4,
    });
    // Flat one-byte count === 8: allocate 24 bytes and copy one 8-byte word.
    rawLoad(15, contextOffset);
    emit({
      op: "ldr",
      width: 64,
      rt: 15,
      rn: 15,
      offset: nativeAllocationStateOffset,
    });
    const short8OneNoState = instructions.length;
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
      immediate: nativeStringDataOffset + 8,
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
    const short8OneFull = instructions.length;
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
      op: "add-imm",
      width: 64,
      rd: 14,
      rn: 9,
      immediate: nativeStringDataOffset,
      shift: 0,
      setFlags: false,
    });
    emit({
      op: "ldr-indexed",
      size: 3,
      fp: false,
      rt: 16,
      rn: 14,
      rm: 12,
      scaled: false,
    });
    emit({
      op: "stp",
      width: 64,
      rt: 10,
      rt2: 13,
      rn: 15,
      offset: 0,
      mode: "offset",
    });
    emit({
      op: "str",
      width: 64,
      rt: 16,
      rn: 15,
      offset: nativeStringDataOffset,
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
    emit({ op: "b", displacement: (stub.resume - instructions.length) * 4 });
    const shortGeneral = instructions.length;
    patchInstruction(shortNotEight, {
      op: "b.cond",
      condition: "ne",
      displacement: (shortGeneral - shortNotEight) * 4,
    });
    patchInstruction(shortSliced, {
      op: "tbnz",
      rt: 10,
      bit: slicedBit,
      displacement: (shortGeneral - shortSliced) * 4,
    });
    patchInstruction(short8NarrowNoState, {
      op: "cbz",
      width: 64,
      rt: 15,
      displacement: (shortGeneral - short8NarrowNoState) * 4,
    });
    patchInstruction(short8NarrowFull, {
      op: "b.cond",
      condition: "hi",
      displacement: (shortGeneral - short8NarrowFull) * 4,
    });
    patchInstruction(short8WideNoState, {
      op: "cbz",
      width: 64,
      rt: 15,
      displacement: (shortGeneral - short8WideNoState) * 4,
    });
    patchInstruction(short8WideFull, {
      op: "b.cond",
      condition: "hi",
      displacement: (shortGeneral - short8WideFull) * 4,
    });
    patchInstruction(short8OneNoState, {
      op: "cbz",
      width: 64,
      rt: 15,
      displacement: (shortGeneral - short8OneNoState) * 4,
    });
    patchInstruction(short8OneFull, {
      op: "b.cond",
      condition: "hi",
      displacement: (shortGeneral - short8OneFull) * 4,
    });
    emit({ op: "movz", width: 64, rd: 14, immediate: 1, shift: 0 });
    const oneByteShort = instructions.length;
    emit({
      op: "tbnz",
      rt: 10,
      bit: nativeHeaderFlagsShift,
      displacement: 0,
    });
    callHelper("string-slice-kind");
    const flatSlow = instructions.length;
    patchInstruction(oneByteShort, {
      op: "tbnz",
      rt: 10,
      bit: nativeHeaderFlagsShift,
      displacement: (flatSlow - oneByteShort) * 4,
    });
    patchInstruction(narrow16NoState, {
      op: "cbz",
      width: 64,
      rt: 15,
      displacement: (flatSlow - narrow16NoState) * 4,
    });
    patchInstruction(narrow16Full, {
      op: "b.cond",
      condition: "hi",
      displacement: (flatSlow - narrow16Full) * 4,
    });
    patchInstruction(narrowNoState, {
      op: "cbz",
      width: 64,
      rt: 15,
      displacement: (flatSlow - narrowNoState) * 4,
    });
    patchInstruction(narrowFull, {
      op: "b.cond",
      condition: "hi",
      displacement: (flatSlow - narrowFull) * 4,
    });
    clearStackWords();
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
    const flatSized = instructions.length;
    emit({ op: "b", displacement: 0 });
    // View slow path: nursery exhausted or uninitialized for 32-byte view.
    clearStackWords();
    const viewSlow = instructions.length;
    patchInstruction(stub.noState, {
      op: "cbz",
      width: 64,
      rt: 15,
      displacement: (viewSlow - stub.noState) * 4,
    });
    patchInstruction(stub.viewFull, {
      op: "b.cond",
      condition: "hi",
      displacement: (viewSlow - stub.viewFull) * 4,
    });
    rawStore(13, allocationOffset + 16);
    rawStore(14, allocationOffset + 24);
    rawStore(12, allocationOffset + 8);
    imm(12, nativeStringSlicedByteLength);
    rawStore(12, allocationOffset);
    patchInstruction(flatSized, {
      op: "b",
      displacement: (instructions.length - flatSized) * 4,
    });
    clearStackWords();
    allocate(
      () => {},
      (rd) => rawLoad(rd, allocationOffset),
    );
    clearStackWords();
    rawValue(10, stub.string);
    rawLoad(11, allocationOffset + 8);
    rawLoad(12, allocationOffset + 16);
    rawLoad(13, allocationOffset + 24);
    const flat = instructions.length;
    emit({ op: "tbz", rt: 13, bit: slicedBit, displacement: 0 });
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
    emit({ op: "b", displacement: (stub.resume - instructions.length) * 4 });
    patchInstruction(flat, {
      op: "tbz",
      rt: 13,
      bit: slicedBit,
      displacement: (instructions.length - flat) * 4,
    });
    callHelper("string-slice-copy");
    emit({ op: "b", displacement: (stub.resume - instructions.length) * 4 });
  }
}
export interface ColdReciprocalStub {
  readonly wideDividend: number;
  readonly noRecip: number;
  readonly target: number;
  readonly resume: number;
  readonly zeroSentinel: boolean;
}
export interface ColdListReadStub {
  readonly slow: readonly { readonly site: number; readonly branch: Branch }[];
  readonly targetFn: number;
  readonly vecReg: number;
  readonly vecOffset: number;
  readonly listReg: number;
  readonly listOffset: number;
  readonly idxReg: number;
  readonly idxOffset: number;
  readonly resultReg: number;
  readonly resultOffset: number;
  readonly block: number;
  readonly index: number;
  readonly resume: number;
}
/** Fast Barrett remainder for 0 <= x9 < 2^32 and 1 <= x10 <= 2^32 using
 * precomputed floor(2^32 / d) at frame offset `recip`, falling back to sdiv. */
function emitColdReciprocalStubs(
  emit: (instruction: MachineInstruction) => void,
  patchInstruction: (index: number, instruction: MachineInstruction) => void,
  instructions: { readonly length: number },
  stubs: readonly ColdReciprocalStub[],
): void {
  for (const stub of stubs) {
    if (stub === undefined) continue;
    const slow = instructions.length;
    patchInstruction(stub.wideDividend, {
      op: "cbnz",
      width: 64,
      rt: 11,
      displacement: (slow - stub.wideDividend) * 4,
    });
    patchInstruction(stub.noRecip, {
      op: "cbz",
      width: 64,
      rt: 11,
      displacement: (slow - stub.noRecip) * 4,
    });
    if (stub.zeroSentinel) {
      const zeroDiv = instructions.length;
      emit({ op: "cbz", width: 64, rt: 10, displacement: 0 });
      emit({ op: "sdiv", width: 64, rd: 11, rn: 9, rm: 10 });
      emit({ op: "msub", width: 64, rd: stub.target, rn: 11, rm: 10, ra: 9 });
      emit({ op: "b", displacement: (stub.resume - instructions.length) * 4 });
      patchInstruction(zeroDiv, {
        op: "cbz",
        width: 64,
        rt: 10,
        displacement: (instructions.length - zeroDiv) * 4,
      });
      emit({
        op: "movz",
        width: 64,
        rd: stub.target,
        immediate: 0x6000,
        shift: 48,
      });
      emit({ op: "b", displacement: (stub.resume - instructions.length) * 4 });
    } else {
      emit({ op: "sdiv", width: 64, rd: 11, rn: 9, rm: 10 });
      emit({ op: "msub", width: 64, rd: stub.target, rn: 11, rm: 10, ra: 9 });
      emit({ op: "b", displacement: (stub.resume - instructions.length) * 4 });
    }
  }
}
function emitColdNaNStubs(
  emit: (instruction: MachineInstruction) => void,
  patchInstruction: (index: number, instruction: MachineInstruction) => void,
  instructions: { readonly length: number },
  stubs: readonly ColdNaNStub[],
): void {
  for (const stub of stubs) {
    if (stub === undefined) continue;
    patchInstruction(stub.branchSite, {
      op: "b.cond",
      condition: "cs",
      displacement: (instructions.length - stub.branchSite) * 4,
    });
    if (stub.word) {
      emit({
        op: "movz",
        width: 64,
        rd: stub.target,
        immediate: 0x6000,
        shift: 48,
      });
    } else {
      emit({ op: "movz", width: 64, rd: 11, immediate: 0x7ff8, shift: 48 });
      emit({ op: "fmov-d-x", rd: stub.target, rn: 11 });
    }
    emit({ op: "b", displacement: (stub.resume - instructions.length) * 4 });
  }
}
function emitColdListReadStubs(
  emit: (instruction: MachineInstruction) => void,
  patchInstruction: (index: number, instruction: MachineInstruction) => void,
  branch: (instruction: Branch, fn: number, block: number | undefined) => void,
  setSite: (block: number, index: number) => void,
  safepoint: () => void,
  exceptionalBranch: (condition: Branch) => void,
  instructions: { readonly length: number },
  contextOffset: number,
  stubs: readonly ColdListReadStub[],
): void {
  for (const stub of stubs) {
    if (stub === undefined) continue;
    setSite(stub.block, stub.index);
    const slowAt = instructions.length;
    for (const entry of stub.slow) {
      if (entry === undefined) continue;
      patchInstruction(
        entry.site,
        branchAt(entry.branch, (slowAt - entry.site) * 4),
      );
    }
    if (stub.vecReg >= 32)
      emit({
        op: "orr-reg",
        width: 64,
        rd: 4,
        rn: "zr",
        rm: stub.vecReg - 32,
      });
    else
      emit({ op: "ldr", width: 64, rt: 4, rn: "sp", offset: stub.vecOffset });
    if (stub.listReg >= 32)
      emit({
        op: "orr-reg",
        width: 64,
        rd: 5,
        rn: "zr",
        rm: stub.listReg - 32,
      });
    else
      emit({ op: "ldr", width: 64, rt: 5, rn: "sp", offset: stub.listOffset });
    if (stub.idxReg >= 32)
      emit({ op: "scvtf-d-x", rd: 0, rn: stub.idxReg - 32 });
    else {
      emit({ op: "ldr", width: 64, rt: 17, rn: "sp", offset: stub.idxOffset });
      emit({ op: "scvtf-d-x", rd: 0, rn: 17 });
    }
    emit({ op: "ldr", width: 64, rt: 0, rn: "sp", offset: contextOffset });
    emit({
      op: "add-imm",
      width: 64,
      rd: 3,
      rn: "sp",
      immediate: 0,
      shift: 0,
      setFlags: false,
    });
    branch({ op: "bl" }, stub.targetFn, undefined);
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
    if (stub.resultReg >= 32)
      emit({
        op: "orr-reg",
        width: 64,
        rd: stub.resultReg - 32,
        rn: "zr",
        rm: 1,
      });
    else
      emit({
        op: "str",
        width: 64,
        rt: 1,
        rn: "sp",
        offset: stub.resultOffset,
      });
    emit({ op: "b", displacement: (stub.resume - instructions.length) * 4 });
  }
}
/** Non-script functions with no calls, allocations, throws, or activation
 * reads cannot observe nativeActivationTop or trigger GC: lazyActivation
 * callers can invoke them directly without linking or zeroing extra actuals.
 * Skip completely when the module has no script entries (preserving zero work
 * on typed-only builds) or when `provenNoSafepoints` hit its budget. */
function computePureLeafNoActivation(
  module: ModuleIR,
  bodies: EmissionBodies,
  noSafepoints: Uint8Array | undefined,
): Uint8Array {
  const result = new Uint8Array(module.functions.length);
  if (noSafepoints === undefined) return result;
  let hasScriptEntry = false;
  for (let id = 0; id < module.functions.length; id++) {
    if (module.functions[id]?.scriptEntry === true) {
      hasScriptEntry = true;
      break;
    }
  }
  if (!hasScriptEntry) return result;
  for (let id = 0; id < module.functions.length; id++) {
    const header = module.functions[id];
    if (
      header === undefined ||
      header.import === true ||
      header.scriptEntry === true ||
      noSafepoints[id] !== 1
    )
      continue;
    const f = bodies.get(id);
    try {
      if (f !== undefined && f.blocks.length > 0) {
        let pure: boolean = true;
        for (const block of f.blocks) {
          if (block === undefined) {
            pure = false;
            break;
          }
          const tk = block.terminator.kind;
          if (tk === "throw" || tk === "throw-literal") {
            pure = false;
            break;
          }
          for (const op of block.instructions) {
            if (
              op === undefined ||
              op.kind === "call" ||
              op.kind === "call-indirect" ||
              op.kind === "c-call" ||
              op.kind === "host-call" ||
              op.kind === "activation-read" ||
              (irInstructionEffects(op) & irEffectAllocate) !== 0
            ) {
              pure = false;
              break;
            }
          }
          if (!pure) break;
        }
        if (pure) result[id] = 1;
      }
    } finally {
      bodies.release(id);
    }
  }
  return result;
}
function hasCViewAccesses(fn: FunctionIR): boolean {
  for (const block of fn.blocks) {
    if (block === undefined) throw "view entry invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "view access invariant";
      if (
        op.kind === "c-memory" &&
        (op.access.operation === "load" || op.access.operation === "store")
      )
        return true;
    }
  }
  return false;
}
interface ScriptEntryPlan {
  readonly hasCalls: boolean;
  readonly callCount: number;
  readonly hasHostOrCCall: boolean;
  readonly hasActivationRead: boolean;
  readonly hasNonCallSafepoint: boolean;
  readonly hasLoopCall: boolean;
  readonly usesArgCount: boolean;
  readonly readsDynamicArg: boolean;
  readonly maxConstArg: number;
  readonly readsParam0: boolean;
  readonly readsParam1: boolean;
  readonly readsParam2: boolean;
  readonly readsParam3: boolean;
}
const noScriptEntryPlan: ScriptEntryPlan = {
  hasCalls: false,
  callCount: 0,
  hasHostOrCCall: false,
  hasActivationRead: false,
  hasNonCallSafepoint: false,
  hasLoopCall: false,
  usesArgCount: false,
  readsDynamicArg: false,
  maxConstArg: -1,
  readsParam0: false,
  readsParam1: false,
  readsParam2: false,
  readsParam3: false,
};
function scriptPlanReadsParam(plan: ScriptEntryPlan, index: number): boolean {
  if (index === 0) return plan.readsParam0;
  if (index === 1) return plan.readsParam1;
  if (index === 2) return plan.readsParam2;
  if (index === 3) return plan.readsParam3;
  return false;
}
function analyzeScriptEntryFunction(
  fn: FunctionIR,
  entryImports: ReadonlyMap<number, number>,
  listShapes: readonly (ListReadShape | undefined)[],
  writeShapes: readonly (ListWriteShape | undefined)[],
  vectorShapes: readonly (number | undefined)[],
  maxLoopWork: number,
): ScriptEntryPlan {
  const loopBlocks = new Uint8Array(fn.blocks.length);
  const scriptLoops = naturalLoops(fn, maxLoopWork);
  if (scriptLoops === undefined) {
    for (let bi = 0; bi < loopBlocks.length; bi++) loopBlocks[bi] = 1;
  } else if (scriptLoops.loops.length > 0) {
    for (const loop of scriptLoops.loops) {
      if (loop === undefined) continue;
      for (const id of loop.body)
        if (id !== undefined && id < loopBlocks.length) loopBlocks[id] = 1;
    }
  }
  const p0 = fn.parameters[0],
    p1 = fn.parameters[1],
    p2 = fn.parameters[2],
    p3 = fn.parameters[3];
  const constNumbers = new Map<number, number>();
  let hasCalls: boolean = false,
    callCount: number = 0,
    hasHostOrCCall: boolean = false,
    hasActivationRead: boolean = false,
    hasNonCallSafepoint: boolean = false,
    hasLoopCall: boolean = false,
    usesArgCount: boolean = false,
    readsDynamicArg: boolean = false,
    maxConstArg: number = -1,
    readsParam0: boolean = false,
    readsParam1: boolean = false,
    readsParam2: boolean = false,
    readsParam3: boolean = false;
  for (const block of fn.blocks) {
    if (block === undefined) throw "script entry analysis block invariant";
    const inLoop = loopBlocks[block.id] === 1;
    const t = block.terminator;
    if (
      (t.kind === "record" || t.kind === "record-cell" || t.kind === "cell") &&
      t.operation !== "read"
    ) {
      const slot = t.slot;
      if (slot === p0) readsParam0 = true;
      else if (slot === p1) readsParam1 = true;
      else if (slot === p2) readsParam2 = true;
      else if (slot === p3) readsParam3 = true;
    }
    for (const op of block.instructions) {
      if (op === undefined) throw "script entry analysis instruction invariant";
      if (op.kind === "constant") {
        const constant = op.value;
        if (typeof constant === "number") constNumbers.set(op.id, constant);
      } else if (op.kind === "load") {
        const slot = op.slot;
        if (slot === p0) readsParam0 = true;
        else if (slot === p1) readsParam1 = true;
        else if (slot === p2) readsParam2 = true;
        else if (slot === p3) readsParam3 = true;
      } else if (op.kind === "script-argument-count") {
        usesArgCount = true;
      } else if (op.kind === "script-argument") {
        const c = constNumbers.get(op.index);
        if (c !== undefined) {
          if (c >>> 0 === c && c < 2048) {
            if (c > maxConstArg) maxConstArg = c;
          } else readsDynamicArg = true;
        } else readsDynamicArg = true;
      } else if (op.kind === "activation-read") {
        hasActivationRead = true;
      } else if (op.kind === "call") {
        hasCalls = true;
        callCount++;
        if (inLoop) hasLoopCall = true;
        if (
          op.environment === undefined &&
          !entryImports.has(op.target) &&
          (listShapes[op.target] !== undefined ||
            writeShapes[op.target] !== undefined ||
            vectorShapes[op.target] !== undefined)
        )
          hasNonCallSafepoint = true;
      } else if (op.kind === "call-indirect") {
        hasCalls = true;
        callCount++;
        if (inLoop) hasLoopCall = true;
      } else if (op.kind === "c-call" || op.kind === "host-call") {
        hasHostOrCCall = true;
      }
      if (
        op.kind !== "call" &&
        op.kind !== "call-indirect" &&
        (irInstructionEffects(op) & irEffectAllocate) !== 0
      )
        hasNonCallSafepoint = true;
    }
  }
  return {
    hasCalls,
    callCount,
    hasHostOrCCall,
    hasActivationRead,
    hasNonCallSafepoint,
    hasLoopCall,
    usesArgCount,
    readsDynamicArg,
    maxConstArg,
    readsParam0,
    readsParam1,
    readsParam2,
    readsParam3,
  };
}
function emitModuleForms(
  module: ModuleIR,
  bodies: EmissionBodies,
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
      options.maxByteLength === undefined
        ? Number.MAX_SAFE_INTEGER
        : options.maxByteLength,
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
  let emitting = -1;
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
  const jsConvert = options.jsConvert === true;
  const throwTraces = options.throwTraces ?? false,
    startupCalls: NativeStartupCall[] = [];
  const managedRequests: NativeManagedPointerImport[] = [],
    managedImports: NativeManagedPointerImport[] = [],
    managedPointerFixups: { offset: number; request: number; rd: number }[] =
      [],
    entryImports = new Map<number, number>(),
    signatureImports = new Map<number, number>(),
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
  /** Whether code takes one-unit strings from the table that heads the
   * literal pool (string-from-code-units). */
  let usesUnitStrings = false;
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
   * nursery's offset from the managed base (context +8) at +8. For an old
   * object, `unneeded` (when given) may first prove the store created no
   * edge to a managed object: it emits code using x12..x14 and returns the
   * sites of `b.ne` branches that skip the helper. Clobbers x10..x16 like
   * the helper. */
  function rememberObject(
    defer?: (emitSlow: () => void) => void,
    objReg: number = 9,
    loadContext?: () => void,
    unneeded?: () => readonly number[],
  ): void {
    if (cachedNurseryBaseInX16 && defer !== undefined) {
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: objReg,
        rm: 16,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
      const old = instructions.length;
      emit({ op: "b.cond", condition: "cc", displacement: 0 });
      const done = instructions.length;
      clearWordCaches();
      defer(() => {
        clearWordCaches();
        patchInstruction(old, {
          op: "b.cond",
          condition: "cc",
          displacement: (instructions.length - old) * 4,
        });
        const skips = unneeded === undefined ? [] : unneeded();
        if (objReg !== 9)
          emit({
            op: "orr-reg",
            width: 64,
            rd: 9,
            rn: "zr",
            rm: objReg,
          });
        if (loadContext !== undefined) loadContext();
        callHelper("remember-object");
        const back = instructions.length;
        for (const skip of skips)
          patchInstruction(skip, {
            op: "b.cond",
            condition: "ne",
            displacement: (back - skip) * 4,
          });
        emit({ op: "b", displacement: (done - instructions.length) * 4 });
      });
      return;
    }
    if (objReg !== 9)
      emit({ op: "orr-reg", width: 64, rd: 9, rn: "zr", rm: objReg });
    if (loadContext !== undefined) loadContext();
    emit({ op: "ldr", width: 64, rt: 12, rn: 10, offset: 56 });
    const unpublished = instructions.length;
    emit({ op: "cbz", width: 64, rt: 12, displacement: 0 });
    emit({
      op: "ldr",
      width: 64,
      rt: 13,
      rn: 12,
      offset: nativeGenerationalNurseryAddressOffset,
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
    if (defer !== undefined) {
      const old = instructions.length;
      emit({ op: "b.cond", condition: "cc", displacement: 0 });
      const done = instructions.length;
      patchInstruction(unpublished, {
        op: "cbz",
        width: 64,
        rt: 12,
        displacement: (done - unpublished) * 4,
      });
      clearWordCaches();
      defer(() => {
        clearWordCaches();
        patchInstruction(old, {
          op: "b.cond",
          condition: "cc",
          displacement: (instructions.length - old) * 4,
        });
        const skips = unneeded === undefined ? [] : unneeded();
        callHelper("remember-object");
        const back = instructions.length;
        for (const skip of skips)
          patchInstruction(skip, {
            op: "b.cond",
            condition: "ne",
            displacement: (back - skip) * 4,
          });
        emit({ op: "b", displacement: (done - instructions.length) * 4 });
      });
      return;
    }
    const young = instructions.length;
    emit({ op: "b.cond", condition: "cs", displacement: 0 });
    const skips = unneeded === undefined ? [] : unneeded();
    callHelper("remember-object");
    const done = instructions.length;
    for (const skip of skips)
      patchInstruction(skip, {
        op: "b.cond",
        condition: "ne",
        displacement: (done - skip) * 4,
      });
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
  /** For rememberObject: a `b.ne` site taken when the general value whose
   * tag word is at frame `offset` refers to no managed object. Only tags
   * 3, 5, 6 and 7 carry a reference (the collectors' general scan); the
   * others (undefined, number, boolean, null) need no remembering. */
  function nonReferenceTag(offset: number): number[] {
    rawLoad(13, offset);
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 13,
      immediate: 5,
      shift: 0,
      setFlags: true,
    });
    const reference = instructions.length;
    emit({ op: "b.cond", condition: "cs", displacement: 0 });
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 13,
      immediate: 3,
      shift: 0,
      setFlags: true,
    });
    const skip = instructions.length;
    emit({ op: "b.cond", condition: "ne", displacement: 0 });
    patchInstruction(reference, {
      op: "b.cond",
      condition: "cs",
      displacement: (instructions.length - reference) * 4,
    });
    return [skip];
  }
  /** x9/x10 string or optional-string objects -> w9 (1 equal, 0 different), or
   * direct branches to `branchTargets.equal` / `branchTargets.different`.
   * Identical values (including both absent) are equal; if either operand may
   * be absent, a zero word after the identity test is unequal. Different
   * lengths or incompatible kinds are unequal, and flat one-byte strings of
   * 1..8 units compare inline in one word without calling the content helper. */
  function stringEqual(
    leftPresent: boolean = true,
    rightPresent: boolean = true,
    branchTargets?: {
      readonly fnId: number;
      readonly equal: number;
      readonly different: number;
      readonly nextBlock: number | undefined;
    },
  ): void {
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
    let same = -1,
      absentLeft = -1,
      absentRight = -1,
      lengths = -1,
      differentKind = -1,
      inlineDone = -1;
    if (branchTargets !== undefined)
      branch(
        { op: "b.cond", condition: "eq" },
        branchTargets.fnId,
        branchTargets.equal,
      );
    else {
      same = instructions.length;
      emit({ op: "b.cond", condition: "eq", displacement: 0 });
    }
    if (!leftPresent) {
      if (branchTargets !== undefined)
        branch(
          { op: "cbz", width: 64, rt: 9 },
          branchTargets.fnId,
          branchTargets.different,
        );
      else {
        absentLeft = instructions.length;
        emit({ op: "cbz", width: 64, rt: 9, displacement: 0 });
      }
    }
    if (!rightPresent) {
      if (branchTargets !== undefined)
        branch(
          { op: "cbz", width: 64, rt: 10 },
          branchTargets.fnId,
          branchTargets.different,
        );
      else {
        absentRight = instructions.length;
        emit({ op: "cbz", width: 64, rt: 10, displacement: 0 });
      }
    }
    // The header's high word (the kind flags) and the length word of each:
    // equal strings have equal lengths and kinds (canonical). Unequal
    // lengths differ at once; flat one-byte pairs of 1..8 units compare
    // their single data word inline (every string allocates at least eight
    // data bytes). Equal headers outside that range, or pairs differing
    // only in the sliced flag (bit 17), call the content helper.
    emit({
      op: "ldp",
      width: 32,
      rt: 11,
      rt2: 12,
      rn: 9,
      offset: 4,
      mode: "offset",
    });
    emit({
      op: "ldp",
      width: 32,
      rt: 13,
      rt2: 14,
      rn: 10,
      offset: 4,
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
    if (branchTargets !== undefined)
      branch(
        { op: "b.cond", condition: "ne" },
        branchTargets.fnId,
        branchTargets.different,
      );
    else {
      lengths = instructions.length;
      emit({ op: "b.cond", condition: "ne", displacement: 0 });
    }
    // Both flat one-byte iff both header high words equal 0x10000 (0x10 << 12).
    const flatOneByteHigh = nativeHeaderFlagUnit / 4294967296 / 4096;
    emit({
      op: "sub-imm",
      width: 64,
      rd: 14,
      rn: 11,
      immediate: flatOneByteHigh,
      shift: 12,
      setFlags: false,
    });
    emit({
      op: "sub-imm",
      width: 64,
      rd: 15,
      rn: 13,
      immediate: flatOneByteHigh,
      shift: 12,
      setFlags: false,
    });
    emit({ op: "orr-reg", width: 64, rd: 14, rn: 14, rm: 15 });
    const nonFlatOneByte = instructions.length;
    emit({ op: "cbnz", width: 64, rt: 14, displacement: 0 });
    emit({
      op: "sub-imm",
      width: 64,
      rd: 15,
      rn: 12,
      immediate: 1,
      shift: 0,
      setFlags: false,
    });
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 15,
      immediate: 7,
      shift: 0,
      setFlags: true,
    });
    const outOfInlineRange = instructions.length;
    emit({ op: "b.cond", condition: "hi", displacement: 0 });
    emit({
      op: "ldr",
      width: 64,
      rt: 14,
      rn: 9,
      offset: nativeStringDataOffset,
    });
    emit({
      op: "ldr",
      width: 64,
      rt: 15,
      rn: 10,
      offset: nativeStringDataOffset,
    });
    emit({ op: "eor-reg", width: 64, rd: 14, rn: 14, rm: 15 });
    // (-length * 8) mod 64 = (8 - length) * 8 for length in 1..8.
    emit({
      op: "sub-reg",
      width: 64,
      rd: 13,
      rn: "zr",
      rm: 12,
      shift: "lsl",
      amount: 3,
      setFlags: false,
    });
    emit({ op: "lslv", width: 64, rd: 14, rn: 14, rm: 13 });
    if (branchTargets !== undefined) {
      branch(
        { op: "cbz", width: 64, rt: 14 },
        branchTargets.fnId,
        branchTargets.equal,
      );
      branch({ op: "b" }, branchTargets.fnId, branchTargets.different);
    } else {
      emit({
        op: "sub-imm",
        width: 64,
        rd: "zr",
        rn: 14,
        immediate: 0,
        shift: 0,
        setFlags: true,
      });
      emit({ op: "cset", rd: 9, condition: "eq" });
      inlineDone = instructions.length;
      emit({ op: "b", displacement: 0 });
    }
    patchInstruction(nonFlatOneByte, {
      op: "cbnz",
      width: 64,
      rt: 14,
      displacement: (instructions.length - nonFlatOneByte) * 4,
    });
    emit({ op: "eor-reg", width: 64, rd: 15, rn: 11, rm: 13 });
    const sameKind = instructions.length;
    emit({ op: "cbz", width: 64, rt: 15, displacement: 0 });
    // Only bit 17 (slicedHighBit, 0x20000 = 0x20 << 12) may differ between
    // equal strings of the same kind.
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 15,
      immediate: 0x20,
      shift: 12,
      setFlags: true,
    });
    if (branchTargets !== undefined)
      branch(
        { op: "b.cond", condition: "ne" },
        branchTargets.fnId,
        branchTargets.different,
      );
    else {
      differentKind = instructions.length;
      emit({ op: "b.cond", condition: "ne", displacement: 0 });
    }
    patchInstruction(sameKind, {
      op: "cbz",
      width: 64,
      rt: 15,
      displacement: (instructions.length - sameKind) * 4,
    });
    patchInstruction(outOfInlineRange, {
      op: "b.cond",
      condition: "hi",
      displacement: (instructions.length - outOfInlineRange) * 4,
    });
    callHelper("string-equal");
    if (branchTargets !== undefined) {
      if (branchTargets.equal === branchTargets.nextBlock)
        branch(
          { op: "cbz", width: 64, rt: 9 },
          branchTargets.fnId,
          branchTargets.different,
        );
      else {
        branch(
          { op: "cbnz", width: 64, rt: 9 },
          branchTargets.fnId,
          branchTargets.equal,
        );
        if (branchTargets.different !== branchTargets.nextBlock)
          branch({ op: "b" }, branchTargets.fnId, branchTargets.different);
      }
      return;
    }
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
    if (absentLeft >= 0)
      patchInstruction(absentLeft, {
        op: "cbz",
        width: 64,
        rt: 9,
        displacement: (instructions.length - absentLeft) * 4,
      });
    if (absentRight >= 0)
      patchInstruction(absentRight, {
        op: "cbz",
        width: 64,
        rt: 10,
        displacement: (instructions.length - absentRight) * 4,
      });
    patchInstruction(lengths, {
      op: "b.cond",
      condition: "ne",
      displacement: (instructions.length - lengths) * 4,
    });
    patchInstruction(differentKind, {
      op: "b.cond",
      condition: "ne",
      displacement: (instructions.length - differentKind) * 4,
    });
    emit({ op: "movz", width: 64, rd: 9, immediate: 0, shift: 0 });
    patchInstruction(inlineDone, {
      op: "b",
      displacement: (instructions.length - inlineDone) * 4,
    });
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
    if (error !== "OUT_OF_RANGE") fail("ENCODING", error);
    // An unconditional B beyond ±128 MiB moves its target function's long
    // branches to the register-indirect far form.
    if (fixup !== undefined && fixup.branch.op === "b") {
      if (forms.farBranches.has(fixup.function))
        fail("ENCODING", "far branch invariant");
      compactOverflow = true;
      forms.farBranches.add(fixup.function);
      forms.longBranches.add(fixup.function);
      return;
    }
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
  /** Code placed after the function body, before its shared trap: stubs
   * reached only from uncommon branches, so the common path keeps falling
   * through. Each stub patches its own entry branch. Functions emitted with
   * trap islands or long branches keep such code inline instead
   * (coldStubsAvailable). */
  let coldStubs: (() => void)[] = [];
  function coldStubsAvailable(): boolean {
    const owner = functionId;
    return (
      owner !== undefined &&
      !debugSpans &&
      !forms.islands.has(owner) &&
      !forms.longBranches.has(owner)
    );
  }
  function flushColdStubs(): void {
    while (coldStubs.length !== 0) {
      const stubs = coldStubs;
      coldStubs = [];
      for (const stub of stubs) stub();
    }
  }
  /** A branch between the body and its cold stubs: one beyond reach marks
   * the function for re-emission with islands, where stubs stay inline. */
  function farBranch(index: number, instruction: Instruction): void {
    const encoded = encode(instruction);
    if (!encoded.ok) {
      const owner = functionId;
      if (encoded.error !== "OUT_OF_RANGE" || owner === undefined)
        fail("ENCODING", encoded.error);
      compactOverflow = true;
      conditionalOverflow(owner);
      return;
    }
    patchInstruction(index, instruction);
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
    edgeNurseryBase = new Map<number, boolean>(),
    edgeBranches = new Map<number, number>(),
    seededEntries = new Map<number, number>(),
    veneerFixups = new Set<number>();
  function recordEdge(block: number, isBranch: boolean): void {
    const known = edgeWords.get(block);
    if (known === undefined) {
      const words = new Map<number, number>();
      for (const [offset, held] of stackWords) words.set(offset, held);
      edgeWords.set(block, words);
      edgeNurseryBase.set(block, cachedNurseryBaseInX16);
    } else {
      const disagreeing: number[] = [];
      for (const [offset, held] of known)
        if (stackWords.get(offset) !== held) disagreeing.push(offset);
      for (const offset of disagreeing)
        if (offset !== undefined) known.delete(offset);
      if (!cachedNurseryBaseInX16) edgeNurseryBase.set(block, false);
    }
    if (isBranch) edgeBranches.set(block, (edgeBranches.get(block) ?? 0) + 1);
  }
  /** Callee-saved GP register (>= 19) whose typed-array data pointer
   * `[reg, #nativeArrayDataOffset]` is currently cached in x15, or -1. */
  let cachedArrayDataReg: number = -1;
  /** SSA value ID of a just-constructed inline typed array whose data pointer
   * is currently cached in x15, or -1. */
  let cachedArrayDataVal: number = -1;
  /** Whether x16 currently holds the generational nursery base address (or 0
   * when generational GC is unpublished). */
  let cachedNurseryBaseInX16: boolean = false;
  let lastFloatSpillOffset: number = -1;
  let lastFloatSpillReg: number = -1;
  function clearWordCaches(): void {
    cachedArrayDataReg = -1;
    cachedArrayDataVal = -1;
    cachedNurseryBaseInX16 = false;
    lastFloatSpillOffset = -1;
    lastFloatSpillReg = -1;
    if (stackWords.size > 0) stackWords.clear();
  }
  function forgetRegister(register: number): void {
    if (register === 15) cachedArrayDataVal = -1;
    if (register === 15 || register === cachedArrayDataReg)
      cachedArrayDataReg = -1;
    if (register === 16) cachedNurseryBaseInX16 = false;
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
      case "and-imm":
      case "orr-imm":
      case "eor-imm":
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
      case "rbit":
      case "clz":
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
      case "fcsel":
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
      clearWordCaches();
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
        if (
          currentHasScriptOps &&
          typeof rt === "number" &&
          stackWords.get(offset) === rt &&
          lastJoin < instructions.length
        )
          return;
        emitWord(i);
        if (typeof rt === "number") stackWords.set(offset, rt);
        else stackWords.delete(offset);
        return;
      }
    }
    if (
      currentHasScriptOps &&
      (i.op === "ldp" || i.op === "stp") &&
      i.width === 64 &&
      i.rn === "sp" &&
      i.mode === "offset" &&
      i.offset >= 0 &&
      i.offset <= 504
    ) {
      const rt = i.rt,
        rt2 = i.rt2,
        offset = i.offset;
      if (i.op === "ldp" && typeof rt === "number" && typeof rt2 === "number") {
        const held0 = stackWords.get(offset),
          held1 = stackWords.get(offset + 8);
        if (held0 === rt && held1 === rt2 && lastJoin < instructions.length)
          return;
        forgetRegister(rt);
        forgetRegister(rt2);
        emitWord(i);
        stackWords.set(offset, rt);
        stackWords.set(offset + 8, rt2);
        return;
      }
      if (i.op === "stp") {
        if (
          typeof rt === "number" &&
          typeof rt2 === "number" &&
          stackWords.get(offset) === rt &&
          stackWords.get(offset + 8) === rt2 &&
          lastJoin < instructions.length
        )
          return;
        lastFloatSpillOffset = -1;
        lastFloatSpillReg = -1;
        emitWord(i);
        if (typeof rt === "number") stackWords.set(offset, rt);
        else stackWords.delete(offset);
        if (typeof rt2 === "number") stackWords.set(offset + 8, rt2);
        else stackWords.delete(offset + 8);
        return;
      }
    }
    if (i.op === "str-d" && i.rn === "sp") {
      emitWord(i);
      stackWords.delete(i.offset);
      if (i.offset <= 32760) {
        lastFloatSpillOffset = i.offset;
        lastFloatSpillReg = i.rt;
      } else {
        lastFloatSpillOffset = -1;
        lastFloatSpillReg = -1;
      }
      return;
    }
    if (
      i.op === "ldr-d" &&
      i.rn === "sp" &&
      i.offset === lastFloatSpillOffset &&
      lastFloatSpillReg >= 0
    ) {
      const held = lastFloatSpillReg;
      lastFloatSpillOffset = -1;
      lastFloatSpillReg = -1;
      if (held === i.rt && lastJoin < instructions.length) return;
      if (held !== i.rt) {
        emitWord({ op: "fmov-d-d", rd: i.rt, rn: held });
        return;
      }
    }
    lastFloatSpillOffset = -1;
    lastFloatSpillReg = -1;
    if (
      (i.op === "str" && i.rn !== "sp" && i.rn !== 17) ||
      (i.op === "stp" && i.mode === "offset" && i.rn !== "sp" && i.rn !== 17) ||
      i.op === "str-indexed" ||
      i.op === "str-d" ||
      (i.op === "stp-d" && i.rn !== "sp" && i.rn !== 17)
    ) {
      emitWord(i);
      return;
    }
    const encoded = encode(i),
      writes = registerWrites(i, encoded.ok ? encoded.value : 0);
    if (writes === undefined || !encoded.ok) clearWordCaches();
    else
      for (const register of writes)
        if (register !== undefined) forgetRegister(register);
    if (
      (i.op === "b" ||
        i.op === "b.cond" ||
        i.op === "cbz" ||
        i.op === "cbnz" ||
        i.op === "tbz" ||
        i.op === "tbnz") &&
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
        instruction.op === "cbnz" ||
        instruction.op === "tbz" ||
        instruction.op === "tbnz") &&
      instruction.displacement > 0
    ) {
      const target = index + instruction.displacement / 4;
      if (target <= instructions.length) clearWordCaches();
      else {
        joins.add(target);
        if (target > lastJoin) lastJoin = target;
      }
    } else clearWordCaches();
    const encoded = encode(instruction);
    if (!encoded.ok) fail("ENCODING", encoded.error);
    writeWord(instructions, index, encoded.value);
  }
  /** Call the imported C symbol `name` through its bound slot (x16, x17). */
  function importCall(name: string): void {
    importAddress(16, 17, name);
    emit({ op: "ldr", width: 64, rt: 16, rn: 16, offset: 0 });
    emit({ op: "blr", rn: 16 });
  }
  /** rd = the address of callback thunk `thunk` (resolved at link time). */
  function thunkAddress(rd: number, thunk: number | undefined): void {
    if (thunk === undefined) throw "callback thunk invariant";
    importAddress(rd, 17, "tint:callback-thunk:" + String(thunk));
  }
  /** The address of import `name`'s slot in `rd` (`scratch` is clobbered). */
  function importAddress(rd: number, scratch: number, name: string): void {
    imports.push({
      offset: instructions.length * 4,
      rd,
      scratch,
      target: { kind: "import", name },
      far: forms.far ? true : undefined,
    });
    const sequence = addressSequence(rd, scratch);
    if (!sequence.ok) fail("ENCODING", sequence.error);
    for (const instruction of sequence.value) {
      if (instruction === undefined) throw "import address invariant";
      emit(instruction);
    }
  }
  /** A relocatable PC-relative address placeholder in the module's model. */
  function addressSequence(
    rd: number,
    scratch: number,
  ): EncodingResult<readonly Instruction[]> {
    return forms.far
      ? farRelativeAddress(rd, scratch, 0)
      : relativeAddress(rd, scratch, 0);
  }
  function startupCall(target: NativeStartupCall["target"]): void {
    if (!forms.far) {
      startupCalls.push({ offset: instructions.length * 4, target });
      emit({ op: "bl", displacement: 0 });
      return;
    }
    // Trace capture consumes x16/x17 and promises to preserve x9. Use the
    // link register as the call target, and spill scratch for the window.
    emit({
      op: "stp",
      width: 64,
      rt: 9,
      rt2: "zr",
      rn: "sp",
      offset: -16,
      mode: "pre",
    });
    startupCalls.push({ offset: instructions.length * 4, target, far: true });
    const sequence = farRelativeAddress(30, 9, 0);
    if (!sequence.ok) throw "diagnostic call address invariant";
    for (const instruction of sequence.value) {
      if (instruction === undefined)
        throw "diagnostic call instruction invariant";
      emit(instruction);
    }
    emit({
      op: "ldp",
      width: 64,
      rt: 9,
      rt2: "zr",
      rn: "sp",
      offset: 16,
      mode: "post",
    });
    emit({ op: "blr", rn: 30 });
  }
  function relativePointer(rd: number): void {
    const sequence = addressSequence(rd, 17);
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
    } else if (pages && options.pageAlignedCode === true && !forms.far) {
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
    readonly runtimePrototype: boolean;
    /** A direct callback's thunk (calls the TypeScript function itself):
     * the parameters delivered as record views and their views' record
     * offsets; undefined for an adapter's. */
    readonly views: readonly number[] | undefined;
    readonly viewOffsets: readonly number[];
  }[] = [];
  function callbackThunk(
    signature: CSignature | undefined,
    ordinal: number,
    views: readonly number[] | undefined = undefined,
    viewOffsets: readonly number[] = [],
    runtimePrototype: boolean = false,
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
        : cTypeName(signature.result) + "(" + names.join(",") + ")") +
      (runtimePrototype ? ":runtime" : "") +
      (views === undefined
        ? ""
        : ":direct:" + views.join(",") + "@" + viewOffsets.join(","));
    for (let index = 0; index < callbackThunkRequests.length; index++)
      if (callbackThunkRequests[index]?.key === key) return index;
    callbackThunkRequests.push({
      key,
      signature,
      ordinal,
      runtimePrototype,
      views,
      viewOffsets,
    });
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
    runtimePrototype: boolean,
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
      runtimeRegistered =
        registered && (signature === undefined || runtimePrototype),
      first = registered ? 1 : 0;
    if (locations.length + first > 8)
      fail("UNSUPPORTED", "callbacks take at most eight arguments");
    const frame = 192;
    const traps: { at: number; branch: Branch; reason: number }[] = [];
    function trapBranch(branch: Branch, reason: number = 0): void {
      traps.push({ at: instructions.length, branch, reason });
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
    if (runtimeRegistered) {
      emit({ op: "str", width: 64, rt: 16, rn: 29, offset: 56 });
      emit({ op: "str", width: 64, rt: 15, rn: 29, offset: 40 });
    }
    saveArgumentRegisters(signature === undefined ? undefined : locations);
    if (runtimeRegistered) {
      importCall(host().symbolPrefix + "pthread_self");
      emit({ op: "ldr", width: 64, rt: 12, rn: 29, offset: 40 });
      emit({
        op: "sub-reg",
        width: 64,
        rd: "zr",
        rn: 0,
        rm: 12,
        shift: "lsl",
        amount: 0,
        setFlags: true,
      });
      trapBranch({ op: "b.cond", condition: "ne" }, 1);
    }
    // This thread's callback state block.
    importAddress(9, 17, "tint:callback-key");
    emit({ op: "ldr", width: 64, rt: 0, rn: 9, offset: 0 });
    importCall(host().symbolPrefix + "pthread_getspecific");
    trapBranch({ op: "cbz", width: 64, rt: 0 }, 1);
    // The innermost transition: present, not already running a callback,
    // and entered on this very thread.
    emit({ op: "ldr", width: 64, rt: 11, rn: 0, offset: 0 });
    trapBranch({ op: "cbz", width: 64, rt: 11 }, 2);
    // A callback already running under this record (a leaf call that called
    // back) traps; a failed direct callback's record (2) does not.
    emit({ op: "ldr", width: 64, rt: 12, rn: 11, offset: t.entered });
    emit({ op: "ubfm", width: 64, rd: 12, rn: 12, immr: 0, imms: 0 });
    trapBranch({ op: "cbnz", width: 64, rt: 12 }, 2);
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
    trapBranch({ op: "b.cond", condition: "ne" }, 1);
    emit({ op: "ldr", width: 64, rt: 12, rn: 11, offset: t.entered });
    emit({
      op: "add-imm",
      width: 64,
      rd: 12,
      rn: 12,
      immediate: 1,
      shift: 0,
      setFlags: false,
    });
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
    if (runtimeRegistered) {
      emit({ op: "ldr", width: 64, rt: 14, rn: 29, offset: 56 });
      emit({ op: "scvtf-d-x", rd: 0, rn: 14 });
      if (signature === undefined) emit({ op: "scvtf-d-x", rd: 1, rn: 29 });
    } else if (registered) {
      imm(14, -1 - ordinal);
      emit({ op: "scvtf-d-x", rd: 0, rn: 14 });
    } else if (signature === undefined)
      emit({ op: "scvtf-d-x", rd: 0, rn: 29 });
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
    emit({ op: "ldr", width: 64, rt: 12, rn: 11, offset: t.entered });
    emit({
      op: "sub-imm",
      width: 64,
      rd: 12,
      rn: 12,
      immediate: 1,
      shift: 0,
      setFlags: false,
    });
    emit({ op: "str", width: 64, rt: 12, rn: 11, offset: t.entered });
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
    const reasons: number[] = [];
    if (runtimeRegistered) {
      const messages = [
        "node:ffi callback dispatcher failed\n",
        "Callbacks can only be invoked on the system thread they were created on\n",
        "node:ffi callback outside an FFI transition\n",
      ];
      for (const message of messages) {
        if (message === undefined) throw "callback diagnostic invariant";
        reasons.push(instructions.length);
        // Reuse the saved arguments as a temporary raw diagnostic buffer.
        for (let i = 0; i < message.length; i += 4) {
          let bits = 0;
          let scale = 1;
          for (let byte = 0; byte < 4 && i + byte < message.length; byte++) {
            bits += message.charCodeAt(i + byte) * scale;
            scale *= 256;
          }
          imm(9, bits);
          emit({ op: "str", width: 32, rt: 9, rn: 29, offset: 64 + i });
        }
        imm(0, 2);
        emit({
          op: "add-imm",
          width: 64,
          rd: 1,
          rn: 29,
          immediate: 64,
          shift: 0,
          setFlags: false,
        });
        imm(2, message.length);
        importCall(host().symbolPrefix + "write");
        importCall(host().symbolPrefix + "abort");
        emit({ op: "brk", immediate: 3 });
      }
    } else emit({ op: "brk", immediate: 3 });
    for (const site of traps) {
      if (site === undefined) throw "callback trap invariant";
      const destination = reasons[site.reason] ?? trap;
      patchInstruction(site.at, {
        ...site.branch,
        displacement: (destination - site.at) * 4,
      });
    }
  }
  /** Save a callback thunk's C argument registers in its frame (x0..x7
   * at 64, d0..d7 at 128) before calls clobber them: the pairs holding
   * `locations`' register arguments, or all of them (`undefined`: a
   * universal thunk, whose callback reads the whole save area). */
  function saveArgumentRegisters(
    locations: readonly CValueLocation[] | undefined,
  ): void {
    const gp = new Uint8Array(8),
      fp = new Uint8Array(8);
    for (let index = 0; index < 8; index++) {
      gp[index] = locations === undefined ? 1 : 0;
      fp[index] = locations === undefined ? 1 : 0;
    }
    const known = locations ?? [];
    for (let index = 0; index < known.length; index++) {
      const location = known[index];
      if (location === undefined || location.stackOffset >= 0) continue;
      if (location.class === "float") fp[location.fp] = 1;
      else gp[location.gp] = 1;
    }
    for (let register = 0; register < 8; register += 2) {
      if (gp[register] === 1 || gp[register + 1] === 1)
        emit({
          op: "stp",
          width: 64,
          rt: register,
          rt2: register + 1,
          rn: 29,
          offset: 64 + register * 8,
          mode: "offset",
        });
      if (fp[register] === 1 || fp[register + 1] === 1)
        emit({
          op: "stp-d",
          rt: register,
          rt2: register + 1,
          rn: 29,
          offset: 128 + register * 8,
        });
    }
  }
  /** A direct callback's thunk (docs/native-ffi.md, "Callbacks"): like
   * an adapter's, but it calls the TypeScript function in the record's
   * `ordinal`th callback word itself. Parameters `views` arrive as the
   * record views at `viewOffsets` (retargeted to C's pointer; x4..x7), the
   * others as numbers (d0..); the number result converts exactly to the C
   * result type. An exception (status 2) calls the record's `onThrow` with
   * it, a null record pointer or an inexact result calls `onInvalid` with
   * 0 or 1; either marks the record failed and returns 0 to C, as does
   * every later entry under that record. Frame as an adapter thunk's. */
  function emitDirectCallbackThunk(
    signature: CSignature,
    ordinal: number,
    views: readonly number[],
    viewOffsets: readonly number[],
  ): void {
    const classified = classifyCCall(signature, cTarget());
    if (!classified.ok) fail("UNSUPPORTED", "callback: " + classified.error);
    const locations: readonly CValueLocation[] = classified.ok
      ? classified.value.arguments
      : [];
    const frame = 192,
      t = callbackTransition;
    const traps: { at: number; branch: Branch }[] = [],
      labels: { at: number; branch: Branch; label: string }[] = [];
    function trapBranch(branch: Branch): void {
      traps.push({ at: instructions.length, branch });
      emit({ ...branch, displacement: 0 });
    }
    function forward(branch: Branch, label: string): void {
      labels.push({ at: instructions.length, branch, label });
      emit({ ...branch, displacement: 0 });
    }
    const targets: { label: string; at: number }[] = [];
    function place(label: string): void {
      targets.push({ label, at: instructions.length });
    }
    function mov(rd: number, rn: number): void {
      emit({
        op: "add-imm",
        width: 64,
        rd,
        rn,
        immediate: 0,
        shift: 0,
        setFlags: false,
      });
    }
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
    saveArgumentRegisters(locations);
    importAddress(9, 17, "tint:callback-key");
    emit({ op: "ldr", width: 64, rt: 0, rn: 9, offset: 0 });
    importCall(host().symbolPrefix + "pthread_getspecific");
    trapBranch({ op: "cbz", width: 64, rt: 0 });
    emit({ op: "ldr", width: 64, rt: 11, rn: 0, offset: 0 });
    trapBranch({ op: "cbz", width: 64, rt: 11 });
    // Running (a leaf call inside a callback) traps; failed returns 0.
    emit({ op: "ldr", width: 64, rt: 12, rn: 11, offset: t.entered });
    emit({ op: "ubfm", width: 64, rd: 13, rn: 12, immr: 0, imms: 0 });
    trapBranch({ op: "cbnz", width: 64, rt: 13 });
    forward({ op: "cbnz", width: 64, rt: 12 }, "failed-return");
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
    imm(12, callbackEntered.running);
    emit({ op: "str", width: 64, rt: 12, rn: 11, offset: t.entered });
    emit({ op: "str", width: 64, rt: 11, rn: 29, offset: 48 });
    // Arguments: numbers into d16.. (then d0..), views into x4..x7.
    let numbers = 0,
      others = 0;
    for (let index = 0; index < locations.length; index++) {
      const location = locations[index],
        type = signature.parameters[index];
      if (location === undefined || type === undefined)
        throw "callback argument invariant";
      const viewAt = views.indexOf(index);
      if (viewAt >= 0) {
        const offset = viewOffsets[viewAt];
        if (offset === undefined || location.class !== "integer")
          throw "callback view invariant";
        if (others >= 4)
          fail("UNSUPPORTED", "callbacks take at most four record views");
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
        forward({ op: "cbz", width: 64, rt: 14 }, "null");
        emit({ op: "ldr", width: 64, rt: 9, rn: 11, offset });
        emit({
          op: "ldr",
          width: 64,
          rt: 10,
          rn: 9,
          offset: nativeArrayOwnerOffset,
        });
        emit({
          op: "str",
          width: 64,
          rt: 14,
          rn: 10,
          offset: nativeArrayDataOffset,
        });
        emit({
          op: "str",
          width: 64,
          rt: 14,
          rn: 9,
          offset: nativeArrayDataOffset,
        });
        mov(4 + others, 9);
        others++;
        continue;
      }
      if (numbers >= 8)
        fail("UNSUPPORTED", "callbacks take at most eight numbers");
      const rd = 16 + numbers;
      numbers++;
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
    for (let index = 0; index < numbers; index++)
      emit({ op: "fmov-d-d", rd: index, rn: 16 + index });
    // Call the function value with the caller's context.
    function callRecordFunction(offset: number): void {
      emit({ op: "ldr", width: 64, rt: 11, rn: 29, offset: 48 });
      emit({ op: "ldr", width: 64, rt: 12, rn: 11, offset });
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
    }
    callRecordFunction(t.callbacks + ordinal * 8);
    emit({
      op: "sub-imm",
      width: 32,
      rd: "zr",
      rn: 0,
      immediate: 1,
      shift: 0,
      setFlags: true,
    });
    forward({ op: "b.cond", condition: "ne" }, "abrupt");
    // The number result, exactly in the C result type's range.
    const result = signature.result;
    if (result.kind === "scalar" || result.kind === "pointer") {
      emit({ op: "ldr-d", rt: 0, rn: 29, offset: 32 });
      const scalar: CScalar =
        result.kind === "pointer" ? "usize" : result.scalar;
      if (scalar === "f32") emit({ op: "fcvt-s-d", rd: 0, rn: 0 });
      else if (scalar === "bool")
        fail("UNSUPPORTED", "direct callbacks return numbers");
      else if (scalar !== "f64") {
        const bytes = cScalarBytes(scalar),
          signed = cScalarSigned(scalar, cTarget());
        if (bytes === 8) {
          if (signed) {
            emit({ op: "fcvtzs-x-d", rd: 0, rn: 0 });
            emit({ op: "scvtf-d-x", rd: 1, rn: 0 });
          } else {
            emit({ op: "fcvtzu-x-d", rd: 0, rn: 0 });
            emit({ op: "ucvtf-d-x", rd: 1, rn: 0 });
          }
        } else if (bytes === 4 && !signed) {
          emit({ op: "fcvtzu-w-d", rd: 0, rn: 0 });
          emit({ op: "ucvtf-d-w", rd: 1, rn: 0 });
        } else {
          emit({ op: "fcvtzs-w-d", rd: 0, rn: 0 });
          emit({ op: "scvtf-d-w", rd: 1, rn: 0 });
        }
        emit({ op: "fcmp", rn: 0, rm: 1 });
        forward({ op: "b.cond", condition: "ne" }, "range");
        if (bytes === 8) {
          // The saturation bounds round-trip too: reject them.
          if (signed) imm64(9, 0xffffffff, 0x7fffffff);
          else imm64(9, 0xffffffff, 0xffffffff);
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
          forward({ op: "b.cond", condition: "eq" }, "range");
        } else if (bytes < 4) {
          emit({
            op: signed ? "sbfm" : "ubfm",
            width: 32,
            rd: 9,
            rn: 0,
            immr: 0,
            imms: bytes * 8 - 1,
          });
          emit({
            op: "sub-reg",
            width: 32,
            rd: "zr",
            rn: 9,
            rm: 0,
            shift: "lsl",
            amount: 0,
            setFlags: true,
          });
          forward({ op: "b.cond", condition: "ne" }, "range");
        }
      }
    } else if (result.kind !== "void")
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
    // Failures: tell the wrapper, then this record's callbacks return 0.
    place("abrupt");
    emit({
      op: "sub-imm",
      width: 32,
      rd: "zr",
      rn: 0,
      immediate: 2,
      shift: 0,
      setFlags: true,
    });
    trapBranch({ op: "b.cond", condition: "ne" });
    // The exception is a general value (two words at x3 + 16), passed by
    // reference like any general argument.
    emit({
      op: "add-imm",
      width: 64,
      rd: 4,
      rn: 29,
      immediate: 32,
      shift: 0,
      setFlags: false,
    });
    callRecordFunction(t.onThrow);
    forward({ op: "b" }, "noted");
    place("null");
    imm(9, 0);
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    forward({ op: "b" }, "invalid");
    place("range");
    imm(9, 1);
    emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
    place("invalid");
    callRecordFunction(t.onInvalid);
    place("noted");
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
    emit({ op: "ldr", width: 64, rt: 11, rn: 29, offset: 48 });
    imm(12, callbackEntered.failed);
    emit({ op: "str", width: 64, rt: 12, rn: 11, offset: t.entered });
    place("failed-return");
    imm(0, 0);
    emit({ op: "fmov-d-x", rd: 0, rn: 0 });
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
    const trap = instructions.length;
    emit({ op: "brk", immediate: 3 });
    for (let index = 0; index < traps.length; index++) {
      const site = traps[index];
      if (site === undefined) throw "direct callback trap invariant";
      patchInstruction(site.at, {
        ...site.branch,
        displacement: (trap - site.at) * 4,
      });
    }
    for (let index = 0; index < labels.length; index++) {
      const site = labels[index];
      if (site === undefined) throw "direct callback label invariant";
      let target = -1;
      for (let other = 0; other < targets.length; other++) {
        const candidate = targets[other];
        if (candidate !== undefined && candidate.label === site.label)
          target = candidate.at;
      }
      if (target < 0) throw "direct callback thunk label invariant";
      patchInstruction(site.at, {
        ...site.branch,
        displacement: (target - site.at) * 4,
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
  let currentHasScriptOps: boolean = false;
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
  function generalPair(register: number, offset: number, load: boolean): void {
    const homes = scalarRegisters;
    if (
      offset <= 504 &&
      (homes?.[offset / 8] ?? 0) === 0 &&
      (homes?.[offset / 8 + 1] ?? 0) === 0
    ) {
      emit({
        op: load ? "ldp" : "stp",
        width: 64,
        rt: register,
        rt2: register + 1,
        rn: "sp",
        offset,
        mode: "offset",
      });
    } else if (load) {
      rawLoad(register, offset);
      rawLoad(register + 1, offset + 8);
    } else {
      rawStore(register, offset);
      rawStore(register + 1, offset + 8);
    }
  }
  /** Load or store a script register actual (`index` in 0..scriptActualRegisterPairs-1):
   * indices 0..2 use GP pairs x10..x15; indices 3..6 use FP pairs d0..d7.
   * Memory accesses stay in the GP domain (moving through `fmov`) to avoid
   * cross-domain FP/GP store-to-load forwarding stalls on Apple Silicon.
   * When `load` is true, `scratch` is a free GP register; when `load` is false,
   * x10 and x11 are used as free GP temporaries (already spilled in prologue,
   * preserving x8/x9 which still hold `new.target` until parameters spill). */
  function scriptActualPair(
    index: number,
    offset: number,
    load: boolean,
    scratch: number,
  ): void {
    if (index < scriptGpActualRegisterPairs) {
      generalPair(scriptFirstActualRegister + index * 2, offset, load);
      return;
    }
    const d = (index - scriptGpActualRegisterPairs) * 2;
    if (load) {
      rawLoad(scratch, offset);
      emit({ op: "fmov-d-x", rd: d, rn: scratch });
      rawLoad(scratch, offset + 8);
      emit({ op: "fmov-d-x", rd: d + 1, rn: scratch });
    } else {
      emit({ op: "fmov-x-d", rd: 10, rn: d });
      emit({ op: "fmov-x-d", rd: 11, rn: d + 1 });
      generalPair(10, offset, false);
    }
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
  /** Copy a two-word value: one LDP/STP pair when all four words are frame
   * memory, else word by word. */
  function copyGeneralPair(source: number, target: number): void {
    if (source === target) return;
    const homes = scalarRegisters;
    if (
      (homes?.[source / 8] ?? 0) === 0 &&
      (homes?.[source / 8 + 1] ?? 0) === 0 &&
      (homes?.[target / 8] ?? 0) === 0 &&
      (homes?.[target / 8 + 1] ?? 0) === 0
    ) {
      if (source <= 504 && target <= 504) {
        generalPair(9, source, true);
        generalPair(9, target, false);
        return;
      }
      if (currentHasScriptOps) {
        rawLoad(9, source);
        rawLoad(10, source + 8);
        rawStore(9, target);
        rawStore(10, target + 8);
        return;
      }
    }
    copyRawWord(source, target);
    copyRawWord(source + 8, target + 8);
  }
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
  function copyFloatWord(source: number, target: number): void {
    if (source === target) return;
    const registers = scalarRegisters,
      from = registers === undefined ? 0 : (registers[source / 8] ?? 0),
      to = registers === undefined ? 0 : (registers[target / 8] ?? 0);
    if (from === 0 && to === 0) {
      emit({ op: "ldr-d", rt: 0, rn: "sp", offset: source });
      emit({ op: "str-d", rt: 0, rn: "sp", offset: target });
      return;
    }
    copyRawWord(source, target);
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
      // words its edge was recorded with (and x16's cached nursery base).
      const kept = new Map<number, number>(),
        keptNursery = cachedNurseryBaseInX16;
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
      if (keptNursery) cachedNurseryBaseInX16 = true;
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
    if (op === "b" && forms.farBranches.has(targetFunction)) {
      // Beyond B's ±128 MiB: x16 = target (x17 scratch, both reserved
      // for call/address scratch), then BR. A conditional skip above
      // jumps over the whole sequence.
      const sequence = addressSequence(16, 17);
      if (!sequence.ok) fail("ENCODING", sequence.error);
      const skip = instructions.length - 1;
      if (
        skip >= 0 &&
        (branch.op === "b.cond" || branch.op === "cbz" || branch.op === "cbnz")
      ) {
        const skipped = sequence.value.length + 1;
        if (
          branch.op === "b.cond" &&
          branch.condition !== "al" &&
          branch.condition !== "nv"
        )
          patchInstruction(skip, {
            op: "b.cond",
            condition: inverseCondition(branch.condition),
            displacement: (skipped + 1) * 4,
          });
        else if (branch.op === "cbz" || branch.op === "cbnz")
          patchInstruction(skip, {
            op: branch.op === "cbz" ? "cbnz" : "cbz",
            width: branch.width,
            rt: branch.rt,
            displacement: (skipped + 1) * 4,
          });
      }
      fixups.push({
        offset: instructions.length * 4,
        branch: { op },
        function: targetFunction,
        block: targetBlock,
        far: true,
      });
      for (const instruction of sequence.value) {
        if (instruction === undefined) throw "far branch invariant";
        emit(instruction);
      }
      emit({ op: "br", rn: 16 });
      return;
    }
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
    // A trap guard writes no register: its fallthrough keeps cached words and
    // the nursery base in x16.
    const kept = new Map<number, number>(),
      keptNursery = cachedNurseryBaseInX16;
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
    else throw "trap branch invariant";
    for (const [offset, held] of kept) stackWords.set(offset, held);
    if (keptNursery) cachedNurseryBaseInX16 = true;
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
    clearWordCaches();
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
    clearWordCaches();
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
      maxByteLength > Number.MAX_SAFE_INTEGER
    )
      fail("CODE_LIMIT", "invalid byte budget");
    const valid = facts.verified ?? verify(module, bodies);
    facts.verified = valid;
    if (!valid.ok) {
      const error = valid.error;
      functionId = error.function;
      blockId = error.block;
      const invalid = module.functions.findIndex(
        (fn) => fn !== undefined && fn.id === functionId,
      );
      if (invalid >= 0) {
        const fn = bodies.get(invalid);
        try {
          const block = fn.blocks.find(
            (block) => block !== undefined && block.id === blockId,
          );
          const instruction = error.instruction;
          const operation =
            instruction === undefined
              ? undefined
              : block?.instructions[instruction];
          if (operation !== undefined)
            span = { start: operation.start, end: operation.end };
        } finally {
          bodies.release(invalid);
        }
      }
      fail("INVALID_IR", error.message);
    }
    // Optional scalar optimization can exhaust its module budget before slot
    // cleanup. Plan frames from used locals, retaining ABI and transfer slots.
    // Normalize before slot-indexed analyses; a bounded failure keeps the input.
    const prepared = facts.frameModule;
    if (prepared === undefined) {
      const frameFunctions: FunctionIR[] = [];
      for (const header of module.functions) {
        if (header === undefined) throw "frame function invariant";
        const fn = bodies.get(header.id);
        try {
          const compacted = compactSlots(fn, work(1000000))?.fn ?? fn;
          if (compacted !== fn) bodies.put(compacted);
          frameFunctions.push(functionHeader(compacted));
        } finally {
          bodies.release(header.id);
        }
      }
      module = { ...module, functions: frameFunctions };
      facts.frameModule = module;
    } else module = prepared;
    const managedABI = options.managedABI;
    const witnesses = new Uint8Array(module.functions.length);
    const addressTaken = new Uint8Array(module.functions.length);
    const scanWitnesses =
      managedABI?.signatures.some(
        (binding) => binding?.witness !== undefined,
      ) ?? false;
    // Root-head bindings identify the calls that start stack walks.
    const rootHeadBindings = new Uint8Array(module.functions.length);
    const listShapes: (ListReadShape | undefined)[] = [];
    const vectorShapes: (number | undefined)[] = [];
    const writeShapes: (ListWriteShape | undefined)[] = [];
    let hasFunctionOperations = false,
      hasResultDiscard = false,
      hasTypeErrors = false,
      hasPlainErrors = false,
      hasReferenceErrors = false;
    for (const header of module.functions) {
      if (header === undefined) throw "feature function invariant";
      const fn = bodies.get(header.id);
      try {
        listShapes.push(listReadShape(fn));
        vectorShapes.push(listVectorShape(fn));
        writeShapes.push(listWriteShape(fn));
        if (rootHeadBinding(fn)) rootHeadBindings[fn.id] = 1;
        for (const block of fn.blocks) {
          if (block === undefined) throw "feature block invariant";
          for (const op of block.instructions) {
            if (op === undefined) throw "feature instruction invariant";
            if (op.kind === "function-new" || op.kind === "function-address")
              addressTaken[op.target] = 1;
            if (op.kind === "function-new" || op.kind === "call-indirect") {
              hasFunctionOperations = true;
              if (op.kind === "call-indirect" && op.discardResult === true)
                hasResultDiscard = true;
              if (scanWitnesses)
                witnesses[op.target] =
                  (witnesses[op.target] ?? 0) |
                  (op.kind === "function-new" ? 1 : 2);
            } else if (
              op.kind === "function-environment" ||
              (op.kind === "host-call" &&
                (op.operation === "native-function-descriptor" ||
                  op.operation === "native-function-signature" ||
                  op.operation === "native-value-function-descriptor" ||
                  op.operation === "native-value-function-signature"))
            )
              hasFunctionOperations = true;
            else if (op.kind === "error-new" || op.kind === "error-is") {
              hasTypeErrors = true;
              if (op.kind === "error-new" && op.error === "Error")
                hasPlainErrors = true;
              if (op.error === "ReferenceError") hasReferenceErrors = true;
            }
          }
        }
      } finally {
        bodies.release(header.id);
      }
    }
    if (managedABI !== undefined)
      brandImport = bindManagedABI(
        module,
        managedABI,
        witnesses,
        {
          requests: managedRequests,
          entries: entryImports,
          signatures: signatureImports,
          records: recordImports,
        },
        fail,
      );
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
        !trackedManagedWrites(
          module,
          bodies,
          options.trustedExecutableCode === true,
        )
      )
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
    const hasFunctions = brandImport !== undefined || hasFunctionOperations;
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
    // Native error descriptors: TypeError, RangeError, then Error and
    // ReferenceError when the module creates them.
    const typeErrorRecord = recordLayouts.length,
      errorDescriptorCount = hasReferenceErrors ? 4 : hasPlainErrors ? 3 : 2;
    if (hasTypeErrors)
      for (let i = 0; i < errorDescriptorCount; i++)
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
    const signatureIds = new Uint32Array(module.functions.length);
    const signatureKeys = createStringIndex<number>();
    const discardResultTargets = createStringIndex<number[]>();
    const parameterKeys: string[] = [];
    const seenDiscardSignatures = new Set<number>();
    for (const f of module.functions) {
      if (f === undefined) throw "function invariant";
      let parameters = f.scriptEntry === true ? ":javascript:" : ":";
      for (const slot of f.parameters) {
        if (slot === undefined) throw "parameter invariant";
        const type = f.slots[slot];
        if (type === undefined) throw "parameter type invariant";
        parameters += type + ":";
      }
      parameterKeys.push(parameters);
      const key = f.returnType + parameters;
      const prior = signatureKeys.get(key);
      const first = prior ?? f.id + 1;
      if (prior === undefined) signatureKeys.set(key, first);
      const group = localSignatures.byFunction[f.id] ?? 0;
      signatureIds[f.id] =
        group === 0 ? first : module.functions.length + group;
      // Managed identities also encode semantic contracts. Keep their
      // exact-pointer checks at service-unit boundaries.
      if (
        hasResultDiscard &&
        f.returnType !== "void" &&
        addressTaken[f.id] === 1 &&
        group === 0 &&
        !signatureImports.has(f.id) &&
        !seenDiscardSignatures.has(first)
      ) {
        seenDiscardSignatures.add(first);
        const targets = discardResultTargets.get(parameters);
        if (targets === undefined) discardResultTargets.set(parameters, [f.id]);
        else targets.push(f.id);
      }
    }
    const stableLayouts = stableRecordLayouts(module, bodies),
      // Intraprocedural descriptor proofs need descriptor stability only.
      stableGuards = stableDescriptors(module, bodies);
    const stableSlots =
      stableLayouts &&
      !module.functions.some((fn) => fn.environment !== undefined);
    const wordReturns =
      facts.wordReturns ??
      (stableSlots
        ? provenWordReturns(module, work(10000000), work(1000000), bodies)
        : new Uint8Array(module.functions.length));
    facts.wordReturns = wordReturns;
    if (!facts.wordArgumentsKnown) {
      facts.wordArguments =
        stableSlots && closedRoots !== undefined
          ? provenWordArguments(
              module,
              closedRoots,
              wordReturns,
              work(10000000),
              bodies,
            )
          : undefined;
      facts.wordArgumentsKnown = true;
    }
    const wordArguments = facts.wordArguments;
    if (!facts.recordFlowsKnown) {
      facts.recordFlows =
        closedRoots === undefined
          ? undefined
          : provenRecordFacts(
              module,
              work(10000000),
              true,
              closedRoots,
              bodies,
            );
      facts.recordFlowsKnown = true;
    }
    const recordValues = facts.recordFlows,
      recordFlows = recordValues?.blocks;
    if (!facts.noSafepointsKnown) {
      facts.noSafepoints = provenNoSafepoints(module, work(10000000), bodies);
      facts.noSafepointsKnown = true;
    }
    const noSafepoints = facts.noSafepoints;
    if (!facts.directReturnsKnown) {
      facts.directReturns =
        closedRoots === undefined
          ? undefined
          : provenDirectOnlyFunctions(
              module,
              closedRoots,
              work(10000000),
              bodies,
            );
      facts.directReturnsKnown = true;
    }
    const directReturns = facts.directReturns;
    let pureLeafNoActivation = facts.pureLeafNoActivation;
    if (pureLeafNoActivation === undefined) {
      pureLeafNoActivation = computePureLeafNoActivation(
        module,
        bodies,
        noSafepoints,
      );
      facts.pureLeafNoActivation = pureLeafNoActivation;
    }
    const signatures = module.functions.map((fn): SignatureLayout => {
      if (fn === undefined) throw "function invariant";
      return signatureLayout(fn);
    });
    function listReadShapes(id: number): ListReadShape | undefined {
      return listShapes[id];
    }
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
      clearWordCaches();
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
    for (const header of module.functions) {
      if (header === undefined) throw "function invariant";
      if (header.import === true) {
        const fn = header;
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
      emitting = header.id;
      const fn = bodies.get(emitting);
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
      // record-has instructions whose object the join dataflow proves.
      const provenPresence = new Set<IRInstruction>();
      /** Record terminators whose object is one of two known layouts. */
      const layoutPairs = new Map<number, readonly number[]>();
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
                  op.kind === "array-view" ||
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
                  op.kind === "string-from-latin1" ||
                  op.kind === "string-from-utf8" ||
                  op.kind === "string-ascii-case" ||
                  op.kind === "number-string-cache" ||
                  op.kind === "string-split-cache" ||
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
          cachedIntegerFacts =
            stableSlots ||
            (fn.environment === undefined &&
              fn.name.includes("__tint_spec_loop_"))
              ? provenWordFacts(
                  fn,
                  work(1000000),
                  wordReturns,
                  provenIntegerSlots(fn, work(200000)),
                  wordArguments === undefined
                    ? undefined
                    : wordArguments[fn.id],
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
        // whose loads are all used as integers (see below). Parameters arrive
        // as doubles: one that every direct call passes a proven 32-bit
        // integer (wordArguments; escaped functions have none) and that
        // arrives in a register converts once in the prologue.
        const integerSlots = new Uint8Array(fn.slots.length),
          // Safe integer slots (bounds): int64 slots whose loads are
          // bounded safe integers (word kind 6) of these magnitudes.
          safeSlotBounds = new Float64Array(fn.slots.length),
          // Nonzero slots (bounds): integers other than 0, divisors whose
          // remainders never divide by zero.
          nonzeroSlots = new Uint8Array(fn.slots.length);
        for (const slot of fn.nonzeroSlots ?? [])
          if (slot !== undefined) nonzeroSlots[slot] = 1;
        const safeIntegerBounds = fn.safeIntegerBounds ?? [];
        for (
          let index = 0;
          index < (fn.safeIntegerSlots?.length ?? 0);
          index++
        ) {
          const slot = fn.safeIntegerSlots?.[index],
            bound = safeIntegerBounds[index];
          if (slot === undefined || bound === undefined)
            throw "safe integer slot invariant";
          safeSlotBounds[slot] = Math.max(1, bound);
        }
        if (slotIntegerFacts !== undefined) {
          for (let slot = 0; slot < fn.slots.length; slot++)
            if (
              fn.slots[slot] === "number" &&
              (slotIntegerFacts[slot] === 1 || (safeSlotBounds[slot] ?? 0) > 0)
            )
              integerSlots[slot] = 1;
          if (fn.receiverSlot !== undefined) integerSlots[fn.receiverSlot] = 0;
          const parameterWords =
              wordArguments === undefined ? undefined : wordArguments[fn.id],
            parameterLocations = signatures[fn.id]?.parameters;
          for (let i = 0; i < fn.parameters.length; i++) {
            const parameter = fn.parameters[i];
            if (parameter === undefined) throw "parameter slot invariant";
            if (
              parameterWords === undefined ||
              parameterWords[parameter] !== 1 ||
              parameterLocations?.[i]?.kind !== "float"
            )
              integerSlots[parameter] = 0;
          }
          for (const block of fn.blocks) {
            if (block === undefined) throw "integer slot block invariant";
            if (block.exception !== undefined)
              integerSlots[block.exception.slot] = 0;
            const t = block.terminator;
            if (
              (t.kind === "record" && t.operation !== "write") ||
              t.kind === "record-cell" ||
              t.kind === "cell"
            )
              integerSlots[t.slot] = 0;
          }
          // Number slots whose every store writes `a +/- b` of two proven
          // non-(-0) 32-bit integers hold an exact int64 in [-2^33, 2^33],
          // keeping multi-term bitwise sums (e.g. `(sum + x + y) | 0` across
          // a split block) in GP integer registers instead of demoting `sum`.
          const sumBlocked = new Uint8Array(fn.slots.length),
            sumWritten = new Uint8Array(fn.slots.length);
          if (fn.receiverSlot !== undefined) sumBlocked[fn.receiverSlot] = 1;
          for (const p of fn.parameters) if (p !== undefined) sumBlocked[p] = 1;
          for (const block of fn.blocks) {
            if (block === undefined) continue;
            if (block.exception !== undefined)
              sumBlocked[block.exception.slot] = 1;
            const t = block.terminator;
            if (
              (t.kind === "record" && t.operation !== "write") ||
              t.kind === "record-cell" ||
              t.kind === "cell"
            )
              sumBlocked[t.slot] = 1;
            const wordVal = new Set<number>(),
              sumVal = new Set<number>();
            for (const op of block.instructions) {
              if (op === undefined) continue;
              if (
                op.kind === "load" &&
                integerSlots[op.slot] === 1 &&
                (slotIntegerFacts[op.slot] === 1 ||
                  ((safeSlotBounds[op.slot] ?? 0) > 0 &&
                    (safeSlotBounds[op.slot] ?? 0) <= 0xffffffff))
              )
                wordVal.add(op.id);
              else if (op.kind === "constant") {
                const v = op.value;
                if (
                  typeof v === "number" &&
                  Number.isInteger(v) &&
                  v >= -2147483648 &&
                  v <= 4294967295 &&
                  (v !== 0 || 1 / v > 0)
                )
                  wordVal.add(op.id);
              } else if (
                op.kind === "array-length" ||
                op.kind === "string-length" ||
                (op.kind === "unary" &&
                  (op.operator === "~" ||
                    op.operator === "uint32" ||
                    op.operator === "boolean-number")) ||
                (op.kind === "binary" &&
                  ["&", "|", "^", "<<", ">>", ">>>", "imul"].includes(
                    op.operator,
                  ))
              )
                wordVal.add(op.id);
              else if (
                op.kind === "binary" &&
                (op.operator === "+" || op.operator === "-") &&
                wordVal.has(op.left) &&
                wordVal.has(op.right)
              )
                sumVal.add(op.id);
              else if (op.kind === "store") {
                if (sumVal.has(op.value) || wordVal.has(op.value))
                  sumWritten[op.slot] = 1;
                else sumBlocked[op.slot] = 1;
              }
            }
          }
          for (let slot = 0; slot < fn.slots.length; slot++)
            if (
              fn.slots[slot] === "number" &&
              integerSlots[slot] === 0 &&
              sumBlocked[slot] === 0 &&
              sumWritten[slot] === 1
            ) {
              safeSlotBounds[slot] = 0x200000000;
              integerSlots[slot] = 1;
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
         * optional payloads, Float64Array element values, the operands of
         * +, - and * results that may be -0 and are so observed, and the
         * dividends of % results so observed (`results`, recorded in
         * zeroSignResults); and results that are never -0 (`signless`). */
        function findZeroSignResults(): {
          readonly results: Uint8Array;
          readonly signless: Uint8Array;
        } {
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
                slotArray = nativeTypedArray(
                  op.kind === "load" ? fn.slots[op.slot] : undefined,
                );
              if (
                (slotArray !== undefined &&
                  typedArrayIntegerElements(slotArray)) ||
                ((op.kind === "array-new" || op.kind === "array-view") &&
                  typedArrayIntegerElements(op.type)) ||
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
                op.kind === "element-count" ||
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
                (op.kind === "bytes-load" &&
                  op.element !== "f16" &&
                  op.element !== "f32" &&
                  op.element !== "f64") ||
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
                (op.kind === "array-write" ||
                  op.kind === "array-store" ||
                  op.kind === "array-fill") &&
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
              } else if (op.kind === "binary" && op.operator === "%") {
                // A zero remainder takes the dividend's sign.
                const index = valueIds.intern(op.id);
                if (signs[index] === 1) {
                  results[index] = 1;
                  signs[valueIds.intern(op.left)] = 1;
                }
              }
            }
          }
          return { results, signless };
        }
        let hasScriptOps = fn.scriptEntry === true;
        if (!hasScriptOps) {
          for (const b of fn.blocks) {
            if (b === undefined) continue;
            for (const op of b.instructions) {
              if (
                op !== undefined &&
                (op.kind === "element-load" ||
                  op.kind === "element-store" ||
                  op.kind === "general-element-load" ||
                  op.kind === "general-element-store" ||
                  op.kind === "general-slot-load" ||
                  op.kind === "general-slot-store" ||
                  op.kind === "property-load" ||
                  op.kind === "property-store")
              ) {
                hasScriptOps = true;
                break;
              }
            }
            if (hasScriptOps) break;
          }
        }
        currentHasScriptOps = hasScriptOps;
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
                // Rounding an integer is the identity (see the unary case);
                // uint32 passes its exact integer operand through when integer.
                (op.kind === "unary" &&
                  (op.operator === "trunc" ||
                    op.operator === "ceil" ||
                    op.operator === "uint32") &&
                  uses[valueIds.intern(op.id)] === 1) ||
                op.kind === "array-read" ||
                op.kind === "array-element" ||
                op.kind === "array-valid" ||
                op.kind === "array-write" ||
                op.kind === "array-store" ||
                op.kind === "array-fill" ||
                // Atomic operands convert like element writes (wordValue)
                // and the index like an element read (arrayIndex).
                op.kind === "array-atomic" ||
                op.kind === "array-word64-read" ||
                op.kind === "array-word64-write" ||
                op.kind === "array-word64-element" ||
                op.kind === "array-word64-store" ||
                op.kind === "array-word64-fill" ||
                op.kind === "array-atomic-word64" ||
                op.kind === "word64-from-number" ||
                op.kind === "word64-from-parts" ||
                op.kind === "bytes-load" ||
                op.kind === "bytes-store" ||
                op.kind === "bytes-word64-load" ||
                op.kind === "bytes-word64-store" ||
                op.kind === "reference-vector-read" ||
                op.kind === "reference-vector-write" ||
                // Packed element accesses compare integer indices and cached
                // counts directly when kept in int64 registers.
                op.kind === "element-load" ||
                op.kind === "element-store" ||
                op.kind === "general-element-load" ||
                op.kind === "general-element-store" ||
                op.kind === "general-slot-load" ||
                op.kind === "general-slot-store" ||
                // Inline code units index with an int64 (the helper path
                // converts with floatLoad).
                op.kind === "string-code-unit" ||
                // Slice bounds load through floatLoad, and optional/general
                // payloads and record number fields convert when stored/wrapped.
                op.kind === "string-slice" ||
                op.kind === "optional-wrap" ||
                op.kind === "record-new" ||
                // Code units load through wordValue, which reads an int64
                // directly.
                op.kind === "string-from-code-units" ||
                // Latin-1 and ASCII primitives take exact uint32 indices
                // from either representation (latin1Index).
                op.kind === "string-from-latin1" ||
                op.kind === "string-copy-latin1" ||
                op.kind === "string-ascii-prefix" ||
                op.kind === "bytes-ascii-prefix" ||
                op.kind === "string-utf8-length" ||
                op.kind === "string-write-utf8" ||
                op.kind === "string-from-utf8" ||
                // A raw window's bounds load like latin1Index's.
                op.kind === "string-flatten-into" ||
                (hasScriptOps && op.kind === "general-wrap") ||
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
              if (op.kind === "binary" && op.operator === "%") {
                // An int64 divisor divides directly (see the % case). The
                // dividend's zero sign shows in the remainder (-0 % 3 is
                // -0), so only a dividend that is never -0 is accepted.
                if (signlessResults[valueIds.intern(op.left)] !== 1)
                  rejected[valueIds.intern(op.left)] = 1;
              } else if (!accepts)
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
        const zeroSignFacts = findZeroSignResults(),
          zeroSignResults = zeroSignFacts.results,
          // Read by findIntegerUses, declared above.
          signlessResults: Uint8Array = zeroSignFacts.signless;
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
        // Integer slots whose every read feeds only 32-bit bitwise ops and
        // whose every write stores a 32-bit bitwise op or int32 constant need
        // no `sxtw` on stores (eliminating a 1-cycle critical-path stall in
        // loop-carried bitwise mixers).
        const wordOnlySlots = new Uint8Array(fn.slots.length);
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
        {
          const notWordOnly = new Uint8Array(fn.slots.length),
            boundInvalid = new Uint8Array(fn.slots.length),
            slotBound = new Float64Array(fn.slots.length);
          for (const p of fn.parameters)
            if (p !== undefined) {
              notWordOnly[p] = 1;
              boundInvalid[p] = 1;
            }
          if (fn.receiverSlot !== undefined) {
            notWordOnly[fn.receiverSlot] = 1;
            boundInvalid[fn.receiverSlot] = 1;
          }
          for (const block of fn.blocks) {
            if (block === undefined) continue;
            if (block.exception !== undefined) {
              notWordOnly[block.exception.slot] = 1;
              boundInvalid[block.exception.slot] = 1;
            }
            const t = block.terminator;
            if (
              t.kind === "record" ||
              t.kind === "record-cell" ||
              t.kind === "cell"
            ) {
              notWordOnly[t.slot] = 1;
              if (t.operation !== "write") boundInvalid[t.slot] = 1;
            }
            const loadSlots = new Map<number, number>(),
              wordVals = new Set<number>(),
              consts = new Map<number, number>(),
              valBounds = new Map<number, number>();
            for (const op of block.instructions) {
              if (op === undefined) continue;
              if (op.kind === "load") {
                loadSlots.set(op.id, op.slot);
              } else if (op.kind === "constant") {
                const v = op.value;
                if (typeof v === "number") {
                  consts.set(op.id, v);
                  if (
                    Number.isInteger(v) &&
                    v >= -2147483648 &&
                    v <= 2147483647
                  ) {
                    wordVals.add(op.id);
                    valBounds.set(op.id, Math.max(1, Math.abs(v)));
                  }
                }
              } else if (
                (op.kind === "binary" &&
                  ["&", "|", "^", "<<", ">>", ">>>", "imul"].includes(
                    op.operator,
                  )) ||
                (op.kind === "unary" && op.operator === "~")
              ) {
                wordVals.add(op.id);
                if (op.kind === "binary" && op.operator === "&") {
                  const lc = consts.get(op.left),
                    rc = consts.get(op.right);
                  const mask =
                    rc !== undefined &&
                    Number.isInteger(rc) &&
                    rc >= 0 &&
                    rc <= 67108863
                      ? rc
                      : lc !== undefined &&
                          Number.isInteger(lc) &&
                          lc >= 0 &&
                          lc <= 67108863
                        ? lc
                        : undefined;
                  if (mask !== undefined)
                    valBounds.set(op.id, Math.max(1, mask));
                } else if (op.kind === "binary" && op.operator === ">>>") {
                  const rc = consts.get(op.right);
                  if (
                    rc !== undefined &&
                    Number.isInteger(rc) &&
                    rc >= 6 &&
                    rc <= 31
                  )
                    valBounds.set(op.id, Math.max(1, 0xffffffff >>> rc));
                }
              } else if (op.kind === "store") {
                if (!wordVals.has(op.value)) notWordOnly[op.slot] = 1;
                const src = loadSlots.get(op.value);
                if (src !== undefined) notWordOnly[src] = 1;
                const b = valBounds.get(op.value);
                if (b === undefined) boundInvalid[op.slot] = 1;
                else if (b > (slotBound[op.slot] ?? 0)) slotBound[op.slot] = b;
              } else {
                visitInstructionOperands(op, (id) => {
                  const src = loadSlots.get(id);
                  if (src !== undefined) notWordOnly[src] = 1;
                });
              }
            }
            visitTerminatorOperands(t, (id) => {
              const src = loadSlots.get(id);
              if (src !== undefined) notWordOnly[src] = 1;
            });
          }
          for (let s = 0; s < fn.slots.length; s++) {
            if (integerSlots[s] === 1 && notWordOnly[s] === 0)
              wordOnlySlots[s] = 1;
            if (
              integerSlots[s] === 1 &&
              boundInvalid[s] === 0 &&
              (slotBound[s] ?? 0) > 0 &&
              ((safeSlotBounds[s] ?? 0) === 0 ||
                (slotBound[s] ?? 0) < (safeSlotBounds[s] ?? 0))
            )
              safeSlotBounds[s] = slotBound[s] ?? 0;
          }
        }
        // Numeric constants used only as shift amounts fold into immediate
        // shifts, and undefined values used only as an operand of an optional
        // equality fold into a presence test; neither is materialized.
        // String literal values by result ID, for inline comparisons.
        const stringLiterals = new Map<number, string>();
        // Numeric constants by value ID (a divisor's value, see `%`), and
        // values proven non-negative and never -0 (a dividend whose
        // remainder is never -0): such constants, lengths, code units,
        // uint32 and >>> words, & with a constant mask below 2^31, +, * and
        // % of such operands, and loads of non-negative slots: proven
        // 32-bit integer slots (never -0) whose every store is such a
        // value. Values are block-local, but slot facts are not, so the
        // forward pass repeats until no slot loses its fact (each round
        // only removes slots, from an optimistic start).
        const constantFlags = new Uint8Array(resultBound),
          constantNumbers = new Float64Array(resultBound),
          constantBooleans = new Uint8Array(resultBound),
          zeroRefValues = new Uint8Array(resultBound),
          nonNegativeValues = new Uint8Array(resultBound),
          nonNegativeSlots = nonNegativeZeroSlots.slice();
        /** The value of numeric constant `id`, else undefined. */
        function numberConstant(id: number): number | undefined {
          const index = valueIds.intern(id);
          return constantFlags[index] === 1
            ? constantNumbers[index]
            : undefined;
        }
        /** The value of boolean constant `id`, else undefined. */
        function booleanConstant(id: number): boolean | undefined {
          const v = constantBooleans[valueIds.intern(id)];
          return v === 1 ? false : v === 2 ? true : undefined;
        }
        function nonNegative(id: number): boolean {
          return nonNegativeValues[valueIds.intern(id)] === 1;
        }
        for (let changed = true; changed;) {
          changed = false;
          nonNegativeValues.fill(0);
          for (const block of fn.blocks) {
            if (block === undefined) throw "string literal block invariant";
            for (const op of block.instructions) {
              if (op === undefined) continue;
              if (
                op.kind === "store" &&
                nonNegativeSlots[op.slot] === 1 &&
                !nonNegative(op.value)
              ) {
                nonNegativeSlots[op.slot] = 0;
                changed = true;
              } else markNonNegative(op);
            }
          }
        }
        /** Records `op`'s literal, constant and non-negative facts. */
        function markNonNegative(op: IRInstruction): void {
          if (op.kind === "reference-none") {
            zeroRefValues[valueIds.intern(op.id)] = 1;
            return;
          }
          if (op.kind === "string-literal") stringLiterals.set(op.id, op.value);
          else if (op.kind === "constant") {
            const constant = op.value;
            if (typeof constant === "number") {
              const index = valueIds.intern(op.id);
              constantFlags[index] = 1;
              constantNumbers[index] = constant;
              if (constant > 0 || (constant === 0 && 1 / constant > 0))
                nonNegativeValues[index] = 1;
            } else if (typeof constant === "boolean") {
              constantBooleans[valueIds.intern(op.id)] = constant ? 2 : 1;
            }
          } else if (
            op.kind === "string-length" ||
            op.kind === "array-length" ||
            op.kind === "element-count" ||
            (op.kind === "bytes-load" &&
              (op.element === "u8" ||
                op.element === "u16" ||
                op.element === "u32")) ||
            (op.kind === "string-code-unit" && op.inBounds === true) ||
            (op.kind === "unary" && op.operator === "uint32") ||
            (op.kind === "binary" && op.operator === ">>>") ||
            (op.kind === "load" && nonNegativeSlots[op.slot] === 1)
          )
            nonNegativeValues[valueIds.intern(op.id)] = 1;
          else if (op.kind === "binary") {
            const left = nonNegative(op.left),
              right = nonNegative(op.right),
              leftMask = numberConstant(op.left) ?? -1,
              rightMask = numberConstant(op.right) ?? -1;
            if (
              // ToInt32 keeps a mask below 2^31 non-negative.
              (op.operator === "&" &&
                ((leftMask >= 0 && leftMask <= 2147483647) ||
                  (rightMask >= 0 && rightMask <= 2147483647))) ||
              ((op.operator === "+" || op.operator === "*") && left && right) ||
              (op.operator === "%" && left)
            )
              nonNegativeValues[valueIds.intern(op.id)] = 1;
          }
        }
        // Truncated sums: an imul whose only use is a `+` of an integer
        // addend (see truncatableAddend), where that sum's every use reads
        // only its low 32 bits (bitwise operators and imul), as in
        // `(h * 31 + u) | 0`. The sum is then a 32-bit add and the product
        // needs no sign extension: low bits of exact sums and products
        // depend only on low bits. The facts are use-based and block-local
        // (values are block-local); the addend is checked at the product.
        const soleConsumers: (IRInstruction | undefined)[] = [],
          useCounts = new Uint32Array(resultBound),
          low32UseCounts = new Uint32Array(resultBound),
          truncatedSums = new Uint8Array(resultBound),
          unsignedTruncateCandidate = new Uint8Array(resultBound);
        for (const block of fn.blocks) {
          if (block === undefined) throw "truncation block invariant";
          visitTerminatorOperands(block.terminator, (id) => {
            const index = valueIds.intern(id);
            useCounts[index] = (useCounts[index] ?? 0) + 1;
          });
          for (const op of block.instructions) {
            if (op === undefined) throw "truncation instruction invariant";
            const low32 =
              (op.kind === "binary" &&
                ["|", "&", "^", "<<", ">>", ">>>", "imul"].includes(
                  op.operator,
                )) ||
              (op.kind === "unary" && op.operator === "~");
            visitInstructionOperands(op, (id) => {
              const index = valueIds.intern(id);
              useCounts[index] = (useCounts[index] ?? 0) + 1;
              if (low32)
                low32UseCounts[index] = (low32UseCounts[index] ?? 0) + 1;
              soleConsumers[index] = op;
            });
          }
        }
        /** Whether every use of `id` reads only its low 32 bits. */
        function low32Only(id: number): boolean {
          const index = valueIds.intern(id),
            count = useCounts[index] ?? 0;
          return count > 0 && (low32UseCounts[index] ?? 0) === count;
        }
        /** The `+` that is the only use of `id`, if any. */
        function soleSum(id: number): IRInstruction | undefined {
          const index = valueIds.intern(id),
            consumer = soleConsumers[index];
          return (useCounts[index] ?? 0) === 1 &&
            consumer !== undefined &&
            consumer.kind === "binary" &&
            consumer.operator === "+" &&
            low32Only(consumer.id)
            ? consumer
            : undefined;
        }
        // Values whose every consumer is a low-32-bit bitwise/imul operator or
        // a +/- chain feeding only such operators. Unchecked code units and
        // exact +/- chains over them keep 64-bit integer words with bit63!=bit62
        // (0x6000<<48) as a NaN sentinel, eliminating FP round-trips.
        const low32Tree = new Uint8Array(resultBound),
          low32TreeUses = low32UseCounts.slice();
        for (const block of fn.blocks) {
          if (block === undefined) throw "low32 tree block invariant";
          for (let i = block.instructions.length - 1; i >= 0; i--) {
            const op = block.instructions[i];
            if (op === undefined) continue;
            const id = instructionResult(op);
            if (id === undefined) continue;
            const index = valueIds.intern(id),
              total = useCounts[index] ?? 0;
            if (total > 0 && (low32TreeUses[index] ?? 0) === total) {
              low32Tree[index] = 1;
              if (
                op.kind === "binary" &&
                (op.operator === "+" || op.operator === "-")
              ) {
                const l = valueIds.intern(op.left),
                  r = valueIds.intern(op.right);
                low32TreeUses[l] = (low32TreeUses[l] ?? 0) + 1;
                low32TreeUses[r] = (low32TreeUses[r] ?? 0) + 1;
              }
            }
          }
        }
        // Values whose every consumer safely decodes a 0x6000<<48 NaN-sentinel
        // int64 word: low32 ops, string-slice bounds (including immediately
        // folded optional-wrap limits), and numeric ALU (+, -, *, /, min, max),
        // which either propagate the sentinel in GP registers or decode via
        // floatOperand/floatLoad.
        const nanSentinelSafe = new Uint8Array(resultBound),
          nanSentinelSafeUses = low32UseCounts.slice();
        for (const block of fn.blocks) {
          if (block === undefined) throw "nan sentinel block invariant";
          for (let i = 0; i < block.instructions.length; i++) {
            const op = block.instructions[i];
            if (op === undefined) continue;
            if (op.kind === "string-slice") {
              const bIdx = valueIds.intern(op.begin);
              nanSentinelSafeUses[bIdx] = (nanSentinelSafeUses[bIdx] ?? 0) + 1;
            } else if (op.kind === "optional-wrap") {
              const nextOp = block.instructions[i + 1],
                wrapIdx = valueIds.intern(op.id);
              if (
                (useCounts[wrapIdx] ?? 0) === 1 &&
                nextOp !== undefined &&
                nextOp.kind === "string-slice" &&
                nextOp.limit === op.id
              ) {
                const vIdx = valueIds.intern(op.value);
                nanSentinelSafeUses[vIdx] =
                  (nanSentinelSafeUses[vIdx] ?? 0) + 1;
              }
            } else if (
              op.kind === "binary" &&
              ["+", "-", "*", "/", "min", "max"].includes(op.operator)
            ) {
              const l = valueIds.intern(op.left),
                r = valueIds.intern(op.right);
              nanSentinelSafeUses[l] = (nanSentinelSafeUses[l] ?? 0) + 1;
              nanSentinelSafeUses[r] = (nanSentinelSafeUses[r] ?? 0) + 1;
            }
          }
        }
        for (let i = 0; i < resultBound; i++) {
          const total = useCounts[i] ?? 0;
          if (total > 0 && (nanSentinelSafeUses[i] ?? 0) === total)
            nanSentinelSafe[i] = 1;
        }
        // Non-escaping string slices whose only uses are string-length: compute
        // the exact clamped length in an untraced integer word and skip heap
        // allocation and character scanning.
        const lengthOnlySlices = new Uint8Array(resultBound);
        {
          const sliceLengthUses = new Uint32Array(resultBound);
          for (const block of fn.blocks) {
            if (block === undefined) throw "slice length block invariant";
            for (const op of block.instructions) {
              if (op === undefined) continue;
              if (op.kind === "string-length") {
                const sIdx = valueIds.intern(op.string);
                sliceLengthUses[sIdx] = (sliceLengthUses[sIdx] ?? 0) + 1;
              }
            }
          }
          for (const block of fn.blocks) {
            if (block === undefined) throw "slice length mark invariant";
            for (const op of block.instructions) {
              if (op === undefined) continue;
              if (op.kind === "string-slice") {
                const idx = valueIds.intern(op.id),
                  total = useCounts[idx] ?? 0;
                if (total > 0 && (sliceLengthUses[idx] ?? 0) === total)
                  lengthOnlySlices[idx] = 1;
              }
            }
          }
        }
        // Optional numbers that are wrapped numbers, so present: a slice
        // limit among them needs no absence test (and when immediately
        // consumed by string-slice from an integer value, skips boxing).
        // Optional strings that are wrapped strings need no absence test in
        // equality comparisons.
        const wrappedNumbers = new Uint8Array(resultBound),
          wrappedNumberSources = new Uint32Array(resultBound),
          foldedOptionalWraps = new Uint8Array(resultBound),
          wrappedStrings = new Uint8Array(resultBound),
          wrappedStringSources = new Uint32Array(resultBound),
          foldedStringWraps = new Uint8Array(resultBound),
          // Remainders with non-negative integer dividend and possibly-zero
          // integer divisor whose sole consumer is a dense list read: stored
          // as int64 with -1 for NaN (fails unsigned bounds check; floatLoad
          // decodes -1 back to NaN for the fallback call).
          nanSentinelRemainders = new Uint8Array(resultBound);
        for (const block of fn.blocks) {
          if (block === undefined) throw "wrapped number block invariant";
          for (const op of block.instructions) {
            if (op === undefined) continue;
            if (op.kind === "optional-wrap") {
              const idx = valueIds.intern(op.id);
              wrappedNumbers[idx] = 1;
              wrappedNumberSources[idx] = op.value;
            } else if (op.kind === "string-wrap") {
              const idx = valueIds.intern(op.id);
              wrappedStrings[idx] = 1;
              wrappedStringSources[idx] = op.value;
            }
          }
        }
        const foldedConstants = new Uint8Array(resultBound),
          deferredImmediateConst = new Uint8Array(resultBound),
          // Numeric constants 0 or -0: `x | 0` and `x ^ 0` are ToInt32(x).
          zeroConstants = new Uint8Array(resultBound),
          undefinedValues = new Uint8Array(resultBound),
          // reference-none and string-none: one zero word. Used only as an
          // equality operand, they fold into a test of the other side.
          noneValues = new Uint8Array(resultBound),
          // Values whose every word is zero (none values, general-none,
          // boolean-none, false and +0): record-new stores them as XZR.
          zeroValues = new Uint8Array(resultBound),
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
          rotatedShifts = new Uint8Array(resultBound),
          // `a op (b shift k)` with single-use constant shift: emits one
          // shifted AND/ORR/EOR instruction and the shift none.
          shiftedOps = new Map<
            number,
            {
              readonly other: number;
              readonly source: number;
              readonly shift: "lsl" | "lsr" | "asr";
              readonly amount: number;
            }
          >(),
          fusedShifts = new Uint8Array(resultBound),
          // `(x & imm) === 0` / `!== 0` driving a branch: elides `&` and emits
          // one `ands-imm` (`tst`) at the comparison.
          fusedBitTests = new Uint8Array(resultBound),
          // Literal `constant 2` SSA values (not loaded slots) for `x * 2 -> fadd x, x`.
          literalTwo = new Uint8Array(resultBound),
          // Bitwise results used only by an integer typed-array store
          // (skipping redundant sxtw) and adjacent redundant masks/or-0.
          lowWordStoreValues = new Uint8Array(resultBound),
          storeBypassCandidate = new Map<number, number>(),
          elidedStoreSource = new Map<number, number>(),
          // `(int32 +/- f64) | 0` or `^ 0` with single-use `+/-` followed only
          // by constants before the bitwise op: maps add/sub id -> bitwise id.
          pendingFusedAdd = new Map<number, number>(),
          // Direct-to-slot register targeting: 0 = none, reg + 1 = target register.
          directFloatTarget = new Uint8Array(resultBound),
          directIntTarget = new Uint8Array(resultBound),
          emittedDirectStore = new Uint8Array(resultBound);
        /** The typed array a fused read (by its result ID) indexed. */
        function arrayOf(read: number): number {
          const array = fusedArrays.get(read);
          if (array === undefined) throw "fused read array invariant";
          return array;
        }
        const valueUses = new Uint32Array(resultBound);
        {
          const literalValues = new Uint8Array(resultBound);
          for (const [literal] of stringLiterals)
            literalValues[valueIds.intern(literal)] = 1;
          const numericConstants = new Uint8Array(resultBound),
            uses = valueUses,
            folded = new Uint32Array(resultBound);
          for (const block of fn.blocks) {
            if (block === undefined) throw "zero value block invariant";
            for (const op of block.instructions) {
              if (op === undefined) throw "zero value instruction invariant";
              if (
                op.kind === "reference-none" ||
                op.kind === "string-none" ||
                op.kind === "general-none" ||
                op.kind === "boolean-none" ||
                (op.kind === "constant" &&
                  (op.value === false || (op.value === 0 && 1 / op.value > 0)))
              )
                zeroValues[valueIds.intern(op.id)] = 1;
            }
          }
          for (const block of fn.blocks) {
            if (block === undefined) throw "constant use block invariant";
            visitTerminatorOperands(block.terminator, (id) => {
              const index = valueIds.intern(id);
              uses[index] = (uses[index] ?? 0) + 1;
            });
            // Exact uint32 constants defined earlier in this block: memory
            // host operations take them as immediates (wordKinds 3, set as
            // each constant is emitted) and never read their frame words.
            const wordImmediates = new Set<number>(),
              float64Arrays = new Set<number>(),
              scriptArgImmediates = new Set<number>();
            for (const op of block.instructions) {
              if (op === undefined) throw "constant use instruction invariant";
              if (
                (op.kind === "array-new" && op.type === "Float64Array") ||
                (op.kind === "load" && fn.slots[op.slot] === "Float64Array") ||
                (op.kind === "reference-value" && op.type === "Float64Array")
              )
                float64Arrays.add(op.id);
              if (op.kind === "constant") {
                const constant = op.value;
                if (typeof constant === "number") {
                  numericConstants[valueIds.intern(op.id)] = 1;
                  if (constant >>> 0 === constant) {
                    wordImmediates.add(op.id);
                    if (constant < 2048) scriptArgImmediates.add(op.id);
                  }
                  if (constant === 0) zeroConstants[valueIds.intern(op.id)] = 1;
                }
              }
              if (op.kind === "host-call" && rawWordOperation(op.operation))
                for (
                  let position = 0;
                  position < op.arguments.length;
                  position++
                ) {
                  const argument = op.arguments[position];
                  // A stored binary64 travels in a float register.
                  if (op.operation === "memory-write-float64" && position === 3)
                    continue;
                  if (argument !== undefined && wordImmediates.has(argument)) {
                    const index = valueIds.intern(argument);
                    folded[index] = (folded[index] ?? 0) + 1;
                  }
                }
              if (op.kind === "undefined")
                undefinedValues[valueIds.intern(op.id)] = 1;
              if (op.kind === "reference-none" || op.kind === "string-none")
                noneValues[valueIds.intern(op.id)] = 1;
              visitInstructionOperands(op, (id) => {
                const index = valueIds.intern(id);
                uses[index] = (uses[index] ?? 0) + 1;
              });
              // A constant field of a new record is stored as XZR or the
              // absent number's bits, not read from its frame word.
              if (op.kind === "record-new")
                for (const argument of op.arguments) {
                  if (argument === undefined) continue;
                  const index = valueIds.intern(argument);
                  if (zeroValues[index] === 1 || undefinedValues[index] === 1)
                    folded[index] = (folded[index] ?? 0) + 1;
                }
              // Constant script-argument positions (< 2048) are folded directly
              // into the frame offset (see case "script-argument").
              if (
                op.kind === "script-argument" &&
                scriptArgImmediates.has(op.index)
              ) {
                const index = valueIds.intern(op.index);
                folded[index] = (folded[index] ?? 0) + 1;
              }
              // Zero header/register actual operands of a native script call
              // are loaded as immediates instead of materialized to the frame.
              if (op.kind === "call-indirect") {
                const scriptArgs = op.scriptArguments;
                if (scriptArgs !== undefined) {
                  for (let i = 2; i < op.arguments.length; i++) {
                    const argument = op.arguments[i];
                    if (argument === undefined) continue;
                    const index = valueIds.intern(argument);
                    if (zeroValues[index] === 1)
                      folded[index] = (folded[index] ?? 0) + 1;
                  }
                  for (
                    let i = 0;
                    i < scriptActualRegisterPairs && i < scriptArgs.length;
                    i++
                  ) {
                    const argument = scriptArgs[i];
                    if (argument === undefined) continue;
                    const index = valueIds.intern(argument);
                    if (zeroValues[index] === 1)
                      folded[index] = (folded[index] ?? 0) + 1;
                  }
                }
              }
              if (
                (op.kind === "array-store" ||
                  op.kind === "array-element" ||
                  (op.kind === "array-read" &&
                    fusedFallbacks.get(op.id) === undefined &&
                    fusedReads[valueIds.intern(op.id)] === 0)) &&
                float64Arrays.has(op.array)
              ) {
                const idxVal = numberConstant(op.index);
                if (
                  idxVal !== undefined &&
                  Number.isInteger(idxVal) &&
                  idxVal >= 0 &&
                  idxVal <= 4095 &&
                  !(idxVal === 0 && 1 / idxVal < 0)
                ) {
                  const index = valueIds.intern(op.index);
                  folded[index] = (folded[index] ?? 0) + 1;
                }
              }
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
              if (
                op.kind === "array-new" ||
                op.kind === "reference-vector-new"
              ) {
                const len = numberConstant(op.length);
                const shift =
                  op.kind === "reference-vector-new"
                    ? 3
                    : typedArrayScale(op.type);
                if (
                  len !== undefined &&
                  Number.isInteger(len) &&
                  len >= 0 &&
                  len <= 0xffffffff &&
                  !(len === 0 && 1 / len < 0) &&
                  nativeArrayInlineOffset + 7 + len * (1 << shift) <= 0xffffffff
                ) {
                  const index = valueIds.intern(op.length);
                  folded[index] = (folded[index] ?? 0) + 1;
                }
              }
              if (
                op.kind === "binary" &&
                (op.operator === "|" || op.operator === "^")
              ) {
                // One zero operand folds into a plain ToInt32 of the other.
                const right = valueIds.intern(op.right),
                  left = valueIds.intern(op.left);
                if (zeroConstants[right] === 1)
                  folded[right] = (folded[right] ?? 0) + 1;
                else if (zeroConstants[left] === 1)
                  folded[left] = (folded[left] ?? 0) + 1;
              }
              if (op.kind === "binary" && op.operator === "imul") {
                const rc = numberConstant(op.right),
                  lc = numberConstant(op.left);
                if (
                  rc !== undefined &&
                  lc === undefined &&
                  Number.isInteger(rc) &&
                  rc >= -2147483648 &&
                  rc <= 4294967295
                ) {
                  const idx = valueIds.intern(op.right);
                  if (wordMultiplierShift(rc) === 0)
                    folded[idx] = (folded[idx] ?? 0) + 1;
                  else deferredImmediateConst[idx] = 1;
                } else if (
                  lc !== undefined &&
                  rc === undefined &&
                  Number.isInteger(lc) &&
                  lc >= -2147483648 &&
                  lc <= 4294967295
                ) {
                  const idx = valueIds.intern(op.left);
                  if (wordMultiplierShift(lc) === 0)
                    folded[idx] = (folded[idx] ?? 0) + 1;
                  else deferredImmediateConst[idx] = 1;
                }
              }
              if (
                op.kind === "binary" &&
                (op.operator === "&" ||
                  op.operator === "|" ||
                  op.operator === "^")
              ) {
                for (let side = 0; side < 2; side++) {
                  const cid = side === 0 ? op.right : op.left,
                    cv = numberConstant(cid);
                  if (
                    cv !== undefined &&
                    Number.isInteger(cv) &&
                    cv >= -2147483648 &&
                    cv <= 4294967295 &&
                    logicalImmediate32(cv >>> 0) !== undefined
                  )
                    deferredImmediateConst[valueIds.intern(cid)] = 1;
                }
              }
              if (
                op.kind === "binary" &&
                (op.operator === "+" ||
                  op.operator === "-" ||
                  op.operator === "*") &&
                integerUses[valueIds.intern(op.id)] === 1
              ) {
                for (let side = 0; side < 2; side++) {
                  const cid = side === 0 ? op.right : op.left,
                    cv = numberConstant(cid);
                  if (
                    cv !== undefined &&
                    Number.isInteger(cv) &&
                    ((op.operator === "*" &&
                      multiplierShift(cv) !== undefined) ||
                      ((op.operator === "+" || op.operator === "-") &&
                        Math.abs(cv) <= 4095))
                  )
                    deferredImmediateConst[valueIds.intern(cid)] = 1;
                }
              }
              if (op.kind === "record-new") {
                const layout = module.records?.[op.record];
                if (layout !== undefined)
                  for (let fi = 0; fi < layout.fields.length; fi++) {
                    const field = layout.fields[fi],
                      arg = op.arguments[fi];
                    if (
                      field === undefined ||
                      arg === undefined ||
                      field.offset > 32760
                    )
                      continue;
                    const argIdx = valueIds.intern(arg);
                    if (
                      zeroValues[argIdx] !== 1 &&
                      undefinedValues[argIdx] !== 1 &&
                      field.type === "number"
                    ) {
                      const constant = numberConstant(arg);
                      if (
                        constant !== undefined &&
                        float64Immediate(constant) !== undefined
                      )
                        folded[argIdx] = (folded[argIdx] ?? 0) + 1;
                    }
                  }
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
                // Literals of up to eight data bytes (see the string
                // equality case).
                if (text !== undefined && stringTextBytes(text) <= 8) {
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
            const shifts = new Map<number, IRInstruction>(),
              shiftPos = new Map<number, number>(),
              addIndex = new Map<number, number>();
            for (let at = 0; at < block.instructions.length; at++) {
              const op = block.instructions[at];
              if (op === undefined) throw "rotate instruction invariant";
              if (op.kind === "constant") {
                const constant = op.value;
                if (typeof constant === "number") {
                  constantValues.set(op.id, constant);
                  if (constant === 2) literalTwo[valueIds.intern(op.id)] = 1;
                }
              }
              if (
                op.kind === "binary" &&
                op.operator === "*" &&
                integerUses[valueIds.intern(op.id)] !== 1
              ) {
                const li = valueIds.intern(op.left),
                  ri = valueIds.intern(op.right);
                if ((literalTwo[li] === 1) !== (literalTwo[ri] === 1)) {
                  const twoIdx = literalTwo[ri] === 1 ? ri : li;
                  folded[twoIdx] = (folded[twoIdx] ?? 0) + 1;
                }
              }
              if (
                op.kind === "binary" &&
                (op.operator === "+" || op.operator === "-")
              )
                addIndex.set(op.id, at);
              if (
                op.kind === "binary" &&
                (op.operator === "|" || op.operator === "^")
              ) {
                const rightZero =
                    zeroConstants[valueIds.intern(op.right)] === 1,
                  leftZero = zeroConstants[valueIds.intern(op.left)] === 1;
                if (rightZero || leftZero) {
                  const candidate = rightZero ? op.left : op.right,
                    pos = addIndex.get(candidate);
                  if (
                    pos !== undefined &&
                    uses[valueIds.intern(candidate)] === 1
                  ) {
                    let pureBetween = true;
                    for (let mid = pos + 1; mid < at; mid++) {
                      const between = block.instructions[mid];
                      if (
                        between === undefined ||
                        between.kind !== "constant"
                      ) {
                        pureBetween = false;
                        break;
                      }
                    }
                    if (pureBetween) pendingFusedAdd.set(candidate, op.id);
                  }
                }
              }
              if (
                op.kind === "binary" &&
                (op.operator === ">>>" ||
                  op.operator === "<<" ||
                  op.operator === ">>")
              ) {
                shifts.set(op.id, op);
                shiftPos.set(op.id, at);
              }
              let matchedRotate = false;
              if (op.kind === "binary" && op.operator === "|") {
                const left = shifts.get(op.left),
                  right = shifts.get(op.right);
                if (
                  left !== undefined &&
                  right !== undefined &&
                  left.kind === "binary" &&
                  right.kind === "binary" &&
                  (left.operator === ">>>" || left.operator === "<<") &&
                  (right.operator === ">>>" || right.operator === "<<") &&
                  left.left === right.left &&
                  left.operator !== right.operator &&
                  uses[valueIds.intern(left.id)] === 1 &&
                  uses[valueIds.intern(right.id)] === 1
                ) {
                  const unsigned = left.operator === ">>>" ? left : right,
                    shifted = left.operator === ">>>" ? right : left,
                    down = constantValues.get(unsigned.right),
                    up = constantValues.get(shifted.right);
                  if (
                    down !== undefined &&
                    up !== undefined &&
                    Number.isInteger(down) &&
                    Number.isInteger(up) &&
                    ((down % 32) + 32 + (up % 32)) % 32 === 0
                  ) {
                    rotateAmounts[valueIds.intern(op.id)] =
                      (((down % 32) + 32) % 32) + 1;
                    rotateSources[valueIds.intern(op.id)] = unsigned.left;
                    rotatedShifts[valueIds.intern(left.id)] = 1;
                    rotatedShifts[valueIds.intern(right.id)] = 1;
                    matchedRotate = true;
                  }
                }
              }
              if (
                !matchedRotate &&
                op.kind === "binary" &&
                (op.operator === "&" ||
                  op.operator === "|" ||
                  op.operator === "^") &&
                zeroConstants[valueIds.intern(op.left)] !== 1 &&
                zeroConstants[valueIds.intern(op.right)] !== 1
              ) {
                const tryFuseShift = (
                  shiftId: number,
                  otherId: number,
                ): boolean => {
                  const s = shifts.get(shiftId);
                  if (
                    s === undefined ||
                    s.kind !== "binary" ||
                    uses[valueIds.intern(s.id)] !== 1 ||
                    rotatedShifts[valueIds.intern(s.id)] === 1
                  )
                    return false;
                  const countVal = constantValues.get(s.right);
                  if (countVal === undefined || !Number.isInteger(countVal))
                    return false;
                  const sAt = shiftPos.get(shiftId);
                  if (sAt === undefined) return false;
                  // Keep shift source live at `op`: either it IS `otherId`
                  // (already an operand of `op`) or only constants separate them.
                  if (s.left !== otherId) {
                    for (let mid = sAt + 1; mid < at; mid++) {
                      const between = block.instructions[mid];
                      if (between === undefined || between.kind !== "constant")
                        return false;
                    }
                  }
                  const amount = ((countVal % 32) + 32) % 32;
                  const shift =
                    s.operator === "<<"
                      ? "lsl"
                      : s.operator === ">>"
                        ? "asr"
                        : "lsr";
                  shiftedOps.set(op.id, {
                    other: otherId,
                    source: s.left,
                    shift,
                    amount,
                  });
                  fusedShifts[valueIds.intern(s.id)] = 1;
                  return true;
                };
                if (!tryFuseShift(op.right, op.left))
                  tryFuseShift(op.left, op.right);
              }
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
              } else if (
                op.kind === "string-slice" &&
                undefinedValues[valueIds.intern(op.limit)] === 1
              ) {
                const limit = valueIds.intern(op.limit);
                folded[limit] = (folded[limit] ?? 0) + 1;
              }
            }
          }
          const debugBoundValues = new Uint8Array(
            debugSpans && fn.debug !== undefined ? resultBound : 0,
          );
          if (debugSpans && fn.debug !== undefined)
            for (const binding of fn.debug.values)
              if (binding !== undefined) {
                const idx = valueIds.intern(binding.value);
                if (idx < debugBoundValues.length) debugBoundValues[idx] = 1;
              }
          for (let index = 0; index < resultBound; index++)
            if (
              debugBoundValues[index] !== 1 &&
              (numericConstants[index] === 1 ||
                undefinedValues[index] === 1 ||
                noneValues[index] === 1 ||
                zeroValues[index] === 1 ||
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
          if (
            op.kind === "call" &&
            op.environment === undefined &&
            listReadShapes(op.target)?.mode === "unchecked"
          )
            return false;
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
        const deferredAllocSlowPaths: (() => void)[] = [];
        coldStubs = [];
        // Calls that may reach a collection, by return offset: each gets a
        // stack map of the frame words live while it runs (see stack-maps.ts).
        const callSites: { offset: number; block: number; index: number }[] =
          [];
        // Frame words outside slots and temporaries that a safepoint's map
        // must list (a may-callback call's callback function values).
        const siteReferences = new Map<number, readonly number[]>();
        const siteGeneralArguments = new Map<number, number>();
        let siteIndex = 0;
        function safepointAt(at: number): void {
          const block = blockId;
          if (block === undefined) throw "safepoint block invariant";
          callSites.push({
            offset: at * 4,
            block,
            index: siteIndex,
          });
        }
        function safepoint(): void {
          safepointAt(instructions.length);
        }
        forwardSites = [];
        // Cached property misses branch to their block's slow successor
        // directly (not with C view tokens, which follow block ends).
        const fusedAccesses = hasCViewAccesses(fn)
          ? undefined
          : fusedPropertyAccesses(fn);
        // Script entries and functions with fused script property accesses use
        // hot-trace ordering (sinking IC misses and list-bridge fallbacks);
        // typed functions keep single-predecessor continuation chaining (P7).
        const inlineCall = (target: number): boolean =>
          listReadShapes(target) !== undefined ||
          writeShapes[target]?.unchecked === true;
        const layout =
          fn.scriptEntry === true ||
          (fusedAccesses !== undefined && fusedAccesses.size > 0)
            ? orderBlockIds(fn, fusedAccesses)
            : chainedBlockOrder(fn, inlineCall);
        let functionIrInstructions = 0;
        for (const block of fn.blocks)
          if (block !== undefined)
            functionIrInstructions += block.instructions.length;
        const forwardable = forwardableEntries(fn, layout),
          coldReciprocals: ColdReciprocalStub[] = [],
          coldNaNs: ColdNaNStub[] = [],
          coldListReads: ColdListReadStub[] = [],
          coldSlices: ColdSliceStub[] = [],
          allowColdStubs =
            !debugSpans &&
            !forms.far &&
            (hasScriptOps
              ? !forms.islands.has(fn.id) &&
                !forms.longBranches.has(fn.id) &&
                fn.blocks.length <= 3584 &&
                functionIrInstructions <= 16384
              : fn.blocks.length <= 512 && functionIrInstructions <= 4096),
          functionFixups = fixups.length;
        edgeWords.clear();
        edgeNurseryBase.clear();
        edgeBranches.clear();
        seededEntries.clear();
        veneerFixups.clear();
        // Blocks whose labels share one address (`labelRunAt`): every block
        // but the last emitted no code (fused dispatch blocks never do), so
        // their entry edges fall through to the next block's start. Blocks
        // in a seeded start's run are `accountedLabels`.
        let labelRunAt = -1,
          labelRunFused = false;
        const labelRun: number[] = [];
        const accountedLabels = new Set<number>();
        function joinLabelRun(block: number, fused: boolean): void {
          if (labelRunAt !== instructions.length) {
            labelRunAt = instructions.length;
            labelRunFused = false;
            labelRun.length = 0;
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
              if (
                op.kind === "call-indirect" &&
                op.scriptArguments !== undefined
              )
                outgoingBytes = Math.max(
                  outgoingBytes,
                  scriptArgumentLayout(op.scriptArguments.length).stackBytes,
                );
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
          allocationScratchBytes = fn.blocks.some((b) => {
            let batchCandidates = 0;
            for (const op of b.instructions) {
              if (
                op.kind === "string-from-code-units" ||
                op.kind === "string-concat" ||
                op.kind === "string-slice" ||
                op.kind === "string-allocate" ||
                op.kind === "string-from-latin1" ||
                op.kind === "string-from-utf8" ||
                op.kind === "string-ascii-case" ||
                op.kind === "number-string-cache" ||
                op.kind === "string-split-cache" ||
                op.kind === "array-new" ||
                op.kind === "weak-slot-new" ||
                op.kind === "reference-vector-new" ||
                op.kind === "array-subarray" ||
                op.kind === "array-view" ||
                (op.kind === "host-call" &&
                  op.operation === "memory-read-string")
              )
                return true;
              if (
                linearAllocation &&
                (op.kind === "record-new" || op.kind === "function-new")
              ) {
                batchCandidates++;
                if (batchCandidates >= 2) return true;
              }
            }
            return false;
          })
            ? 32
            : 0,
          // Record constructors with numeric fields keep numeric temporaries
          // (d16..d31) live across their allocation: the slow path saves
          // them here around the allocator call (see preservesFloats).
          floatSaveOffset = allocationOffset + allocationScratchBytes,
          floatSaveBytes =
            floatSaveOffset + 128 <= 32760 &&
            fn.blocks.some((b) =>
              b.instructions.some(
                (op) =>
                  op.kind === "record-new" &&
                  (module.records?.[op.record]?.fields ?? []).some(
                    (field) =>
                      field.type === "number" ||
                      field.type === "optional-number",
                  ),
              ),
            )
              ? 128
              : 0,
          // Frame words owned by the function start here: the collector finds
          // the live ones through per-safepoint stack maps (no frame header).
          localsBase = floatSaveOffset + floatSaveBytes,
          environmentOffset =
            fn.closureEnvironment === undefined
              ? borrowedEnvironmentOffset
              : localsBase,
          // A script entry's activation record, then its actual count and
          // register actuals (abi.ts activationRecordBytes).
          activationOffset =
            localsBase + (fn.closureEnvironment === undefined ? 0 : 8),
          scriptCountOffset =
            activationOffset +
            (fn.scriptEntry === true ? activationRecordBytes : 0),
          scriptArgumentsOffset = scriptCountOffset + 8,
          localsOffset =
            fn.scriptEntry === true
              ? scriptArgumentsOffset + scriptActualRegisterPairs * 16
              : scriptCountOffset;
        const scriptPlan =
          fn.scriptEntry === true
            ? analyzeScriptEntryFunction(
                fn,
                entryImports,
                listShapes,
                writeShapes,
                vectorShapes,
                work(100000),
              )
            : noScriptEntryPlan;
        const elideActivation =
          fn.scriptEntry === true &&
          !scriptPlan.hasCalls &&
          !scriptPlan.hasHostOrCCall &&
          !scriptPlan.hasActivationRead &&
          !scriptPlan.hasNonCallSafepoint;
        const lazyActivation =
          fn.scriptEntry === true &&
          !elideActivation &&
          !scriptPlan.hasHostOrCCall &&
          !scriptPlan.hasActivationRead &&
          !scriptPlan.hasLoopCall &&
          scriptPlan.callCount <= 64 &&
          scriptArgumentsOffset + (scriptActualRegisterPairs - 1) * 16 <= 504;
        const readsExtraActuals =
          fn.scriptEntry === true &&
          (scriptPlan.readsDynamicArg ||
            scriptPlan.maxConstArg >= scriptGpActualRegisterPairs);
        const needsExtraActualSlots =
          fn.scriptEntry === true && (!elideActivation || readsExtraActuals);
        const deferExtraActualZeroing =
          lazyActivation &&
          !readsExtraActuals &&
          !scriptPlan.hasNonCallSafepoint;
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
        if (!homesKnown) {
          cachedHomes = leafRegisters
            ? undefined
            : limited<SlotHomes>(
                "slot-homes",
                fn,
                slotHomes(
                  fn,
                  integerSlots,
                  undefined,
                  [28, 27, 26, 25, 24, 23, 22, 21],
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
                  undefined,
                  inlineCall,
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
        // Precise stack maps: each safepoint lists only the root words live
        // across it (slot liveness here, block-local temporaries by their
        // uses), so no root word needs entry zeroing or clearing for the
        // collector: only slots that may be read before any store are zeroed,
        // as the program itself observes them. Computing this before frame-slot
        // sharing lets `shareFrameSlots` skip live-in owner buffers whenever
        // precise maps succeed (dead-slot clearing is only used without them).
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
        if (!sharingKnown) {
          cachedSharing =
            slotBytes > 64 && !leafRegisters
              ? shareFrameSlots(
                  fn,
                  (slot) => privateSlots[slot] !== 1,
                  work(40000000),
                  // Slots that got the same register home (and managed-ness)
                  // may share a frame word without distorting scalarRegisters;
                  // spilled slots share by storage class as before.
                  (slot) => {
                    const reg =
                      homes === undefined ? 0 : (homes.registers[slot] ?? 0);
                    if (reg !== 0) {
                      const t = fn.slots[slot];
                      return (
                        (t !== undefined && managed(t) ? "rm" : "rn") +
                        String(reg)
                      );
                    }
                    return integerSlots[slot] === 1
                      ? "integer"
                      : (fn.slots[slot] ?? "");
                  },
                  hasRoots && !preciseRoots,
                )
              : undefined;
          sharingKnown = true;
        }
        const sharing = cachedSharing;
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
        /** Exact integer constants not yet in their homes, by value ID. A
         * use that takes one as an immediate reads it from here; any other
         * use materializes it first (materializeInteger), and value()
         * rejects a home access before that. Values are block-local, so
         * each block starts with none. */
        const deferredIntegers = new Map<number, number>();
        function value(id: number): Value {
          if (deferredIntegers.size !== 0 && deferredIntegers.has(id))
            throw "deferred constant read invariant";
          const v = values[valueIds.intern(id)];
          if (v === undefined) throw "verified value invariant";
          return v;
        }
        /** The representation of value `id`, which may still be deferred. */
        function typeOf(id: number): ScalarType {
          const v = values[valueIds.intern(id)];
          if (v === undefined) throw "verified value invariant";
          return v.type;
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
            : aliasedSlotLoads(fn, work(1000000), valueIds);
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
              if (op.kind !== "load") continue;
              const compact = valueIds.intern(op.id);
              if (slotAliases[compact] !== 1) continue;
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
                slotAliases[compact] = 0;
            }
          }
        // A double-valued load of an integer slot converts its int64 word.
        if (slotAliases !== undefined)
          for (const block of fn.blocks) {
            if (block === undefined) throw "alias block invariant";
            for (const op of block.instructions) {
              if (op === undefined) throw "alias instruction invariant";
              if (op.kind === "load" && integerSlots[op.slot] === 1) {
                const compact = valueIds.intern(op.id);
                if (integerUses[compact] !== 1) slotAliases[compact] = 0;
              }
            }
          }
        function aliasedLoad(id: number): boolean {
          return (
            slotAliases !== undefined && slotAliases[valueIds.intern(id)] === 1
          );
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
              case "script-argument":
              case "weak-slot-new":
              case "weak-slot-key":
              case "weak-slot-value":
                id = op.id;
                type = "general";
                break;
              case "script-argument-count":
                id = op.id;
                type = "number";
                break;
              case "activation-read":
                id = op.id;
                type = activationFieldType(op.field);
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
              case "array-view":
                id = op.id;
                type = op.type;
                break;
              case "array-buffer-byte-length":
                id = op.id;
                type = "number";
                break;
              case "array-atomic":
                if (op.id !== undefined) {
                  id = op.id;
                  type = "number";
                }
                break;
              case "array-word64-read":
                id = op.id;
                type = "boolean";
                break;
              case "word64-constant":
              case "word64-from-number":
              case "word64-binary":
              case "word64-unary":
              case "word64-from-parts":
              case "array-word64-element":
                id = op.id;
                type = "word64";
                break;
              case "word64-to-number":
              case "word64-part":
                id = op.id;
                type = "number";
                break;
              case "error-message":
              case "general-kind":
              case "string-literal":
              case "string-from-code-units":
              case "string-concat":
              case "string-slice":
              case "string-allocate":
              case "string-from-latin1":
              case "string-from-utf8":
              case "string-ascii-case":
              case "number-string-cached":
                id = op.id;
                type = "string";
                break;
              case "string-length":
              case "string-code-unit":
              case "string-index-of":
              case "string-copy-latin1":
              case "string-ascii-prefix":
              case "bytes-ascii-prefix":
              case "bytes-load":
              case "string-utf8-length":
              case "string-write-utf8":
              case "string-flat":
              case "string-flatten-into":
              case "string-index-cached":
              case "gc-epoch":
              case "reference-hash":
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
              case "string-split-cached":
              case "function-environment":
              case "script-entry":
              case "global-cell":
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
              case "record-slot-read": {
                const field = module.records?.[op.record]?.fields[op.field];
                if (field === undefined) throw "record slot layout invariant";
                id = op.id;
                type = field.type;
                break;
              }
              case "property-load":
                id = op.id;
                type = "general";
                break;
              case "property-store":
              case "element-store":
              case "general-element-store":
              case "general-slot-store":
                id = op.id;
                type = "boolean";
                break;
              case "element-load":
              case "general-element-load":
              case "general-slot-load":
              case "element-length":
                id = op.id;
                type = "general";
                break;
              case "element-storage":
                id = op.id;
                type = "optional-reference";
                break;
              case "element-count":
                id = op.id;
                type = "number";
                break;
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
              case "string-two-byte":
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
              case "reference-vector-is":
              case "array-copy":
                id = op.id;
                type = "boolean";
                break;
              case "array-byte-offset":
              case "array-byte-length":
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
                  type === "word64" ||
                  lengthOnlySlices[valueIds.intern(id)] === 1 ||
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
          // Candidates and returned register homes are indexed by compact
          // `valueIds` rather than sparse raw SSA result IDs.
          const candidates = new Uint8Array(values.length);
          for (const block of fn.blocks) {
            if (block === undefined) throw "temporary block invariant";
            for (const op of block.instructions) {
              if (op === undefined) throw "temporary instruction invariant";
              const id = instructionResult(op);
              if (id === undefined) continue;
              const compact = valueIds.intern(id);
              if (
                compact < candidates.length &&
                !aliasedLoad(id) &&
                foldedConstants[compact] !== 1 &&
                !(
                  deferredImmediateConst[compact] === 1 &&
                  (valueUses[compact] ?? 0) === 1
                )
              ) {
                const type = value(id).type;
                // Booleans, length-only slices, and numbers whose every use
                // wants an integer live in GP homes (x19..x28): no bank moves.
                if (
                  type === "boolean" ||
                  type === "word64" ||
                  lengthOnlySlices[compact] === 1 ||
                  (type === "number" &&
                    integerUses[compact] === 1 &&
                    !floatWords.has(id) &&
                    !(
                      op.kind === "optional-value-or" &&
                      fusedDefaults[compact] !== 1
                    ))
                )
                  candidates[compact] = 3;
                // NaN-boxed optional numbers are single FP words too.
                else if (type === "number" || type === "optional-number")
                  candidates[compact] = 1;
                else if (managed(type) && type !== "primitive" && !callsBack)
                  candidates[compact] = 2;
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
            floatSaveBytes === 0
              ? undefined
              : (op: IRInstruction): boolean => op.kind === "record-new",
            valueIds,
          );
        }
        // FP temporaries a record constructor's slow path saves: every
        // d16..d31 some numeric temporary of this function is homed in.
        let floatTemporaryMask = 0;
        const floatTemporaries = transientRegisters;
        if (floatSaveBytes !== 0 && floatTemporaries !== undefined)
          for (let compact = 0; compact < floatTemporaries.length; compact++) {
            const register = floatTemporaries[compact] ?? 0;
            const entry = values[compact];
            if (
              register >= 16 &&
              register <= 31 &&
              entry !== undefined &&
              (entry.type === "number" || entry.type === "optional-number")
            )
              floatTemporaryMask |= 1 << (register - 16);
          }
        function isManagedValue(id: number, type: ScalarType): boolean {
          return managed(type) && lengthOnlySlices[valueIds.intern(id)] !== 1;
        }
        function referenceTemporary(id: number): number {
          const type = value(id).type;
          return isManagedValue(id, type) && type !== "primitive"
            ? (transientRegisters?.[valueIds.intern(id)] ?? 0)
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
                    : isManagedValue(id, type)
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
              } else if (isManagedValue(id, type)) references++;
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
              } else if (isManagedValue(id, type)) {
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
        const reciprocalPlan = planReciprocalOffsets(
            fn,
            integerSlots,
            maximumCursor,
          ),
          reciprocalStoreOffsets = reciprocalPlan.storeOffsets,
          reciprocalDivisorOffsets = reciprocalPlan.divisorOffsets;
        maximumCursor += reciprocalPlan.extraBytes;
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
            occupy(
              offset,
              integerSlots[slot] === 1 ||
                type === "boolean" ||
                type === "word64",
            );
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
                  storage.type === "word64" ||
                  lengthOnlySlices[valueIds.intern(id)] === 1 ||
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
          offsets: (number | undefined)[] = [],
          canDeferColdStub = (): boolean =>
            allowColdStubs && instructions.length - start / 4 < 131072,
          deferRememberSlow = ():
            ((emitSlow: () => void) => void) | undefined =>
            canDeferColdStub()
              ? (emitSlow) => deferredAllocSlowPaths.push(emitSlow)
              : undefined;
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
        // The block whose tail call left the frame (it emits no return).
        let tailExitBlock = -1;
        const interruptible =
          options.workerFunctions?.has(
            fn.name.endsWith("$direct") ? fn.name.slice(0, -7) : fn.name,
          ) === true;
        // Worker functions poll for stop requests at loop headers and, when
        // they call, on entry: unbounded execution passes one of them (a
        // cycle or a recursion), and straight-line code needs no poll. This
        // also stops allocation-free loops. A function whose loops exceed the
        // analysis budget keeps the per-call and per-allocation polls.
        const stopLoops = interruptible
          ? naturalLoops(fn, work(1000000))
          : undefined;
        const callSitePolls = interruptible && stopLoops === undefined;
        const pollHeaders = new Set<number>();
        let pollEntry = false;
        if (stopLoops !== undefined) {
          for (const loop of stopLoops.loops) {
            if (loop === undefined) throw "stop poll loop invariant";
            pollHeaders.add(loop.header);
          }
          for (const block of fn.blocks) {
            if (block === undefined) throw "stop poll block invariant";
            for (const op of block.instructions)
              if (
                op !== undefined &&
                (op.kind === "call" || op.kind === "call-indirect")
              )
                pollEntry = true;
          }
        }
        function pollWorkerStop(): void {
          if (callSitePolls) workerStopPoll();
        }
        // Uses the IP registers, so it runs at a block start or before
        // allocating or setting up a managed call. The exceptional edge
        // publishes the usual two-word thrown value.
        function workerStopPoll(): void {
          rawLoad(17, contextOffset);
          emit({
            op: "ldr",
            width: 64,
            rt: 17,
            rn: 17,
            offset: nativeStackMapRegistryOffset,
          });
          emit({
            op: "sub-imm",
            width: 64,
            rd: 17,
            rn: 17,
            immediate: -nativeWorkerStopPointerOffset,
            shift: 0,
            setFlags: false,
          });
          emit({ op: "ldr", width: 64, rt: 17, rn: 17, offset: 0 });
          const noWorker = instructions.length;
          emit({ op: "cbz", width: 64, rt: 17, displacement: 0 });
          // A stop request is a monotonic signal: a plain load observes it
          // soon enough, and the observation below is a release store.
          emit({ op: "ldr", width: 64, rt: 16, rn: 17, offset: 0 });
          emit({
            op: "sub-imm",
            width: 64,
            rd: "zr",
            rn: 16,
            immediate: nativeWorkerStopRequested,
            shift: 0,
            setFlags: true,
          });
          const running = instructions.length;
          emit({ op: "b.cond", condition: "ne", displacement: 0 });
          imm(16, nativeWorkerStopObserved);
          emit({ op: "stlr", width: 64, rt: 16, rn: 17 });
          rawStore("zr", resultOffset + 16);
          imm(9, nativeWorkerStopPayload);
          rawStore(9, resultOffset + 24);
          imm(0, 2);
          throwExit = true;
          branch({ op: "b" }, fn.id, -1);
          patchInstruction(noWorker, {
            op: "cbz",
            width: 64,
            rt: 17,
            displacement: (instructions.length - noWorker) * 4,
          });
          patchInstruction(running, {
            op: "b.cond",
            condition: "ne",
            displacement: (instructions.length - running) * 4,
          });
        }
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
          startupCall("trace-capture");
        }
        /** d8.. at calleeSaveOffset + 8i, paired while in LDP/STP reach. */
        function calleeSaves(load: boolean): void {
          // Pairs need a signed offset within 504 bytes of their base, and
          // single loads/stores reach 32760 bytes: a save area beyond reach
          // addresses from x16 = SP + calleeSaveOffset (x16 is scratch in
          // prologues and epilogues).
          const saved = preservedCount + savedWords.length,
            based =
              saved > 0 &&
              (calleeSaveOffset + (saved - 1) * 8 > 32760 ||
                (saved >= 2 &&
                  calleeSaveOffset + saved * 8 > 512 &&
                  calleeSaveOffset <= 4095));
          const rn: number | "sp" = based ? 16 : "sp",
            origin = based ? calleeSaveOffset : 0;
          if (based) address(16, calleeSaveOffset);
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
        /** Pop the frame. A return keeps its completion in x0-x2; a tail
         * call keeps the callee's operands in x0-x15 and its entry in x17,
         * with the context in x0. */
        function teardown(tail: boolean): void {
          endFrameRange();
          // Unlink the activation record (elided for pure leaves and handled
          // around individual cold calls for lazyActivation functions).
          if (fn.scriptEntry === true && !elideActivation && !lazyActivation) {
            emit({
              op: "ldr",
              width: 64,
              rt: 16,
              rn: "sp",
              offset: activationOffset,
            });
            if (!tail) rawLoad(17, contextOffset);
            emit({
              op: "str",
              width: 64,
              rt: 16,
              rn: tail ? 0 : 17,
              offset: nativeActivationTopOffset,
            });
          }
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
        }
        function epilogue(): void {
          teardown(false);
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
              fn.scriptEntry === true ||
              (directReturns !== undefined && directReturns[fn.id] === 1),
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
          // Ahead of time the homes' own complete liveness covers every homed
          // slot; bounded analyses keep the separate entry query and budget.
          const homeEntry =
            options.unboundedAnalysis === true && homes !== undefined
              ? homes.entryLive
              : undefined;
          const entryLive = homeEntry ?? new Uint8Array(fn.slots.length);
          if (homeEntry === undefined) {
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
          }
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
        function zeroScriptActualSlot(index: number): void {
          const off = scriptArgumentsOffset + index * 16;
          if (off <= 504)
            emit({
              op: "stp",
              width: 64,
              rt: "zr",
              rt2: "zr",
              rn: "sp",
              offset: off,
              mode: "offset",
            });
          else {
            address(16, off);
            emit({
              op: "stp",
              width: 64,
              rt: "zr",
              rt2: "zr",
              rn: 16,
              offset: 0,
              mode: "offset",
            });
          }
        }
        function linkLazyActivation(): void {
          // x17 is free here; x0 holds context, x16 holds callee entry (if any).
          if (deferExtraActualZeroing) {
            rawLoad(17, scriptCountOffset);
            emit({
              op: "sub-imm",
              width: 64,
              rd: "zr",
              rn: 17,
              immediate: scriptGpActualRegisterPairs,
              shift: 0,
              setFlags: true,
            });
            const alreadySpilled = instructions.length;
            emit({ op: "b.cond", condition: "hi", displacement: 0 });
            for (
              let i: number = scriptGpActualRegisterPairs;
              i < scriptActualRegisterPairs;
              i++
            )
              zeroScriptActualSlot(i);
            patchInstruction(alreadySpilled, {
              op: "b.cond",
              condition: "hi",
              displacement: (instructions.length - alreadySpilled) * 4,
            });
          }
          emit({
            op: "ldr",
            width: 64,
            rt: 17,
            rn: 0,
            offset: nativeActivationTopOffset,
          });
          emit({
            op: "str",
            width: 64,
            rt: 17,
            rn: "sp",
            offset: activationOffset,
          });
          address(17, activationOffset);
          emit({
            op: "str",
            width: 64,
            rt: 17,
            rn: 0,
            offset: nativeActivationTopOffset,
          });
        }
        rawStore(0, contextOffset);
        rawStore(3, resultPointerOffset);
        if (fn.scriptEntry === true) {
          const listSlot = fn.parameters[3];
          if (listSlot === undefined) throw "script entry header invariant";
          const needsListSlot = !elideActivation || scriptPlan.readsParam3;
          const needsCount =
            !elideActivation ||
            scriptPlan.usesArgCount ||
            scriptPlan.readsDynamicArg ||
            scriptPlan.maxConstArg >= scriptGpActualRegisterPairs;
          if (needsListSlot || needsCount) {
            emit({
              op: "ands-imm",
              width: 64,
              rd: "zr",
              rn: 2,
              n: 1,
              immr: 0,
              imms: 0,
            });
          }
          if (needsListSlot) {
            emit({
              op: "csel",
              width: 64,
              rd: 16,
              rn: 2,
              rm: "zr",
              condition: "eq",
            });
            rawStore(16, slotOffset(listSlot));
          }
          if (needsCount) {
            emit({ op: "ubfm", width: 64, rd: 17, rn: 2, immr: 1, imms: 63 });
            emit({
              op: "csel",
              width: 64,
              rd: 17,
              rn: "zr",
              rm: 17,
              condition: "eq",
            });
            rawStore(17, scriptCountOffset);
          }
          const gpSpillCount = !elideActivation
            ? scriptGpActualRegisterPairs
            : scriptPlan.readsDynamicArg
              ? scriptGpActualRegisterPairs
              : Math.min(
                  scriptGpActualRegisterPairs,
                  scriptPlan.maxConstArg + 1,
                );
          for (let i = 0; i < gpSpillCount; i++) {
            const offset = scriptArgumentsOffset + i * 16;
            const register = scriptFirstActualRegister + i * 2;
            generalPair(register, offset, false);
          }
          if (needsExtraActualSlots) {
            const emitSpillCascade = (): void => {
              const zeroJumps: number[] = [];
              for (
                let i: number = scriptGpActualRegisterPairs;
                i < scriptActualRegisterPairs;
                i++
              ) {
                emit({
                  op: "sub-imm",
                  width: 64,
                  rd: "zr",
                  rn: 17,
                  immediate: i + 1,
                  shift: 0,
                  setFlags: true,
                });
                zeroJumps.push(instructions.length);
                emit({ op: "b.cond", condition: "cc", displacement: 0 });
                scriptActualPair(i, scriptArgumentsOffset + i * 16, false, 16);
              }
              const done = instructions.length;
              emit({ op: "b", displacement: 0 });
              for (
                let idx = 0;
                idx < scriptActualRegisterPairs - scriptGpActualRegisterPairs;
                idx++
              ) {
                const jumpAt = zeroJumps[idx];
                if (jumpAt === undefined)
                  throw "script extra actual jump invariant";
                patchInstruction(jumpAt, {
                  op: "b.cond",
                  condition: "cc",
                  displacement: (instructions.length - jumpAt) * 4,
                });
                zeroScriptActualSlot(scriptGpActualRegisterPairs + idx);
              }
              patchInstruction(done, {
                op: "b",
                displacement: (instructions.length - done) * 4,
              });
            };
            if (readsExtraActuals || !coldStubsAvailable()) {
              emitSpillCascade();
            } else {
              emit({
                op: "sub-imm",
                width: 64,
                rd: "zr",
                rn: 17,
                immediate: scriptGpActualRegisterPairs,
                shift: 0,
                setFlags: true,
              });
              const spillExtraBranch = instructions.length;
              emit({ op: "b.cond", condition: "hi", displacement: 0 });
              if (!deferExtraActualZeroing) {
                for (
                  let i: number = scriptGpActualRegisterPairs;
                  i < scriptActualRegisterPairs;
                  i++
                )
                  zeroScriptActualSlot(i);
              }
              const resumeAt = instructions.length;
              stackWords.clear();
              coldStubs.push((): void => {
                farBranch(spillExtraBranch, {
                  op: "b.cond",
                  condition: "hi",
                  displacement: (instructions.length - spillExtraBranch) * 4,
                });
                stackWords.clear();
                emitSpillCascade();
                const back = instructions.length;
                emit({ op: "b", displacement: 0 });
                farBranch(back, {
                  op: "b",
                  displacement: (resumeAt - back) * 4,
                });
              });
            }
          }
          // Link the activation record (abi.ts activationRecordBytes): the
          // callee pair is a root from here on; the kind is x2's list bit.
          if (!elideActivation) {
            const record = activationOffset;
            if (record + activationCalleeOffset + 8 > 504)
              fail("FRAME_LIMIT", "activation record beyond pair reach");
            emit({
              op: "stp",
              width: 64,
              rt: 4,
              rt2: 5,
              rn: "sp",
              offset: record + activationCalleeOffset,
              mode: "offset",
            });
            emit({ op: "ubfm", width: 64, rd: 17, rn: 2, immr: 0, imms: 0 });
            emit({ op: "orr-reg", width: 64, rd: 17, rn: 17, rm: 29 });
            if (lazyActivation) {
              // Store fp | kind now; link/unlink nativeActivationTopOffset
              // only around the cold calls in this function.
              emit({
                op: "str",
                width: 64,
                rt: 17,
                rn: "sp",
                offset: record + activationFrameOffset,
              });
            } else {
              emit({
                op: "ldr",
                width: 64,
                rt: 16,
                rn: 0,
                offset: nativeActivationTopOffset,
              });
              emit({
                op: "stp",
                width: 64,
                rt: 16,
                rt2: 17,
                rn: "sp",
                offset: record,
                mode: "offset",
              });
              address(16, record);
              emit({
                op: "str",
                width: 64,
                rt: 16,
                rn: 0,
                offset: nativeActivationTopOffset,
              });
            }
          }
        }
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
        for (let i = 0; i < fn.parameters.length; i++) {
          const parameter = fn.parameters[i];
          if (parameter === undefined) throw "parameter layout invariant";
          if (
            fn.scriptEntry === true &&
            i < 3 &&
            safepointLiveness !== undefined &&
            !scriptPlanReadsParam(scriptPlan, i)
          )
            continue;
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
          if (location.kind === "script-list") continue;
          if (
            fn.scriptEntry === true &&
            i < 3 &&
            safepointLiveness !== undefined &&
            !scriptPlanReadsParam(scriptPlan, i)
          )
            continue;
          const offset = slotOffset(slot);
          if (
            fn.slots[slot] === "general" ||
            fn.slots[slot] === "optional-boolean"
          ) {
            if (location.kind === "pair") {
              generalPair(location.index, offset, false);
              continue;
            }
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
            if (integerSlots[slot] === 1) {
              // A word parameter (see integerSlots): its exact int64.
              const target = register >= 32 ? register - 32 : 9;
              emit({ op: "fcvtzs-x-d", rd: target, rn: location.index });
              rawStore(target, offset);
            } else if (register !== 0)
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
          // Loads of nonzero slots: divisors that are never 0.
          nonzeroValues = new Uint8Array(values.length),
          scalarLoadedSlot = new Uint32Array(values.length),
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
        const integerStorage = new Uint8Array(values.length),
          // 64-bit integer words holding either an exact safe integer
          // (|x| <= 2^53, so bit 63 == bit 62) or a NaN sentinel starting at
          // 0x6000<<48 (bit 63 != bit 62, preserved across safe +/-).
          nanSentinelWords = new Uint8Array(values.length),
          nanSentinelMagnitudes = new Float64Array(values.length),
          nanSentinelNonNegative = new Uint8Array(values.length);
        /** Block-local GP integer values computed directly into a slot's GP
         * register home (multi-use `directIntTarget`). */
        const directIntAlias: Map<number, number> = new Map<number, number>();
        function storedAsInteger(id: number): boolean {
          return integerStorage[valueIds.intern(id)] === 1;
        }
        function markInteger(id: number): void {
          integerStorage[valueIds.intern(id)] = 1;
        }
        /** An exact integer operand as an int64 in rt (see exactInteger). */
        function intOperand(id: number, rt: number): void {
          const aliased = directIntAlias.get(id);
          if (aliased !== undefined) {
            if (rt !== aliased)
              emit({ op: "orr-reg", width: 64, rd: rt, rn: "zr", rm: aliased });
            return;
          }
          if (storedAsInteger(id)) rawValue(rt, id);
          else {
            const index = valueIds.intern(id);
            if (wordKinds[index] === 3) imm(rt, wordConstants[index] ?? 0);
            else emit({ op: "fcvtzs-x-d", rd: rt, rn: floatOperand(id, 0) });
          }
        }
        /** Whether `id` is an integer of magnitude at most 2^53 - 2^31,
         * so its double sum with any int32 is exact and the sum's low 32
         * bits are those of the addends' low bits (truncatedSums): a 32-bit
         * integer, a numeric constant (also one the block emits later) or
         * a bounded integer. Int64 storage alone does not bound it. */
        function truncatableAddend(id: number): boolean {
          const index = valueIds.intern(id),
            kind = wordKinds[index] ?? 0;
          if (nanSentinelWords[index] === 1) return false;
          if (kind === 2 || kind === 3) return true;
          const constant = numberConstant(id),
            limit = 9007197107257344;
          if (constant !== undefined)
            return (
              Number.isSafeInteger(constant) && Math.abs(constant) <= limit
            );
          const magnitude = kind === 6 ? wordMagnitude(index) : -1;
          return magnitude >= 0 && magnitude <= limit;
        }
        /** Proven integral without NaN: int64 storage, a 32-bit integer or
         * exact uint32 constant, or a bounded safe integer. */
        function exactInteger(id: number): boolean {
          const index = valueIds.intern(id);
          if (nanSentinelWords[index] === 1) return false;
          if (storedAsInteger(id)) return true;
          const kind = wordKinds[index] ?? 0;
          return kind === 2 || kind === 3 || kind === 6;
        }
        function wordMagnitude(index: number): number {
          const kind = wordKinds[index] ?? 0;
          if (kind === 2 || kind === 5) {
            const magnitude = wordMagnitudes[index] ?? 0;
            return magnitude > 0 ? magnitude : 4294967295;
          }
          if (kind === 3) return wordConstants[index] ?? 0;
          if (kind === 1 || kind === 6 || kind === 7) {
            const magnitude = wordMagnitudes[index] ?? 0;
            if (magnitude > 0) return magnitude;
          }
          return -1;
        }
        /** ToUint8Clamp of a number into x9: NaN and anything below 0.5
         * give 0, anything from 254.5 gives 255, and the rest round to
         * nearest, ties to even. */
        function clampedValue(id: number): void {
          if (storedAsInteger(id)) {
            const integer = intRegister(id, 9);
            emit({
              op: "sub-imm",
              width: 64,
              rd: "zr",
              rn: integer,
              immediate: 0,
              shift: 0,
              setFlags: true,
            });
            emit({
              op: "csel",
              width: 64,
              rd: 9,
              rn: "zr",
              rm: integer,
              condition: "lt",
            });
          } else
            // Saturates negatives to 0 and NaN to 0.
            emit({ op: "fcvtnu-w-d", rd: 9, rn: floatOperand(id, 0) });
          imm(10, 255);
          emit({
            op: "sub-imm",
            width: 64,
            rd: "zr",
            rn: 9,
            immediate: 255,
            shift: 0,
            setFlags: true,
          });
          emit({
            op: "csel",
            width: 64,
            rd: 9,
            rn: 10,
            rm: 9,
            condition: "hi",
          });
        }
        function wordValue(id: number): void {
          if (nanSentinelWords[valueIds.intern(id)] === 1) {
            const src = rawRegister(id, 9);
            emit({
              op: "add-reg",
              width: 64,
              rd: "zr",
              rn: src,
              rm: src,
              shift: "lsl",
              amount: 0,
              setFlags: true,
            });
            emit({
              op: "csel",
              width: 32,
              rd: 9,
              rn: "zr",
              rm: src,
              condition: "vs",
            });
            return;
          }
          if (storedAsWord(id) || storedAsInteger(id)) {
            rawValue(9, id);
            return;
          }
          const index = valueIds.intern(id),
            kind = wordKinds[index];
          if (kind === 1 || kind === 3) imm(9, wordConstants[index] ?? 0);
          else if (kind === 2 || kind === 5 || kind === 6 || kind === 7)
            emit({ op: "fcvtzs-x-d", rd: 9, rn: floatOperand(id, 0) });
          else if (jsConvert)
            // FJCVTZS is ECMAScript ToInt32 (truncation modulo 2^32, NaN and
            // infinities to 0); its low 32 bits are ToUint32's too.
            emit({ op: "fjcvtzs", rd: 9, rn: floatOperand(id, 0) });
          else {
            // fcvtzs truncates toward zero, ToUint32's first step, and maps
            // NaN to 0, so below 2^63 in magnitude its low 32 bits are
            // ToUint32's whether or not the operand is integral. Only
            // saturation (infinities and magnitudes from 2^63) is wrong:
            // doubling overflows (cmn sets V) from 2^62, and those operands
            // take the helper.
            emit({ op: "fcvtzs-x-d", rd: 9, rn: floatOperand(id, 0) });
            emit({
              op: "add-reg",
              width: 64,
              rd: "zr",
              rn: 9,
              rm: 9,
              shift: "lsl",
              amount: 0,
              setFlags: true,
            });
            const inRange = instructions.length;
            emit({ op: "b.cond", condition: "vc", displacement: 0 });
            rawValue(9, id);
            callHelper("to-uint32");
            patchInstruction(inRange, {
              op: "b.cond",
              condition: "vc",
              displacement: (instructions.length - inRange) * 4,
            });
          }
        }
        /** A GP register whose low 32 bits are ToInt32/ToUint32 of `id`:
         * the GP home of a word or int64 value, else `scratch` (computed
         * through x9 by wordValue, which may call the conversion helper). */
        function wordOperand(id: number, scratch: number): number {
          if (nanSentinelWords[valueIds.intern(id)] === 1) {
            const src = rawRegister(id, scratch);
            emit({
              op: "add-reg",
              width: 64,
              rd: "zr",
              rn: src,
              rm: src,
              shift: "lsl",
              amount: 0,
              setFlags: true,
            });
            emit({
              op: "csel",
              width: 32,
              rd: scratch,
              rn: "zr",
              rm: src,
              condition: "vs",
            });
            return scratch;
          }
          const aliasedWord = directIntAlias.get(id);
          if (aliasedWord !== undefined) return aliasedWord;
          if (storedAsWord(id) || storedAsInteger(id)) {
            const home = homeOf(id);
            if (home >= 32) return home - 32;
          }
          wordValue(id);
          if (scratch !== 9)
            emit({ op: "orr-reg", width: 64, rd: scratch, rn: "zr", rm: 9 });
          return scratch;
        }
        /** Block-local FP values computed directly into a slot's FP register
         * home (multi-use `directFloatTarget`). */
        const directFloatAlias = new Map<number, number>();
        /** FP constants hoisted into d3..d7 across a pure safepoint-free loop. */
        const hoistedFloatConst = new Map<number, number>();
        function floatLoad(
          rt: number,
          id: number,
          byteOffset: number = 0,
        ): void {
          if (byteOffset === 0) {
            const hoistedFp = hoistedFloatConst.get(id);
            if (hoistedFp !== undefined) {
              if (hoistedFp !== rt)
                emit({ op: "fmov-d-d", rd: rt, rn: hoistedFp });
              return;
            }
            const aliased = directFloatAlias.get(id);
            if (aliased !== undefined) {
              if (aliased !== rt) emit({ op: "fmov-d-d", rd: rt, rn: aliased });
              return;
            }
            const deferred = deferredIntegers.get(id);
            if (deferred !== undefined) {
              const bits = encodeFloat64(deferred);
              if (bits.lo === 0 && bits.hi === 0)
                emit({ op: "fmov-d-x", rd: rt, rn: "zr" });
              else {
                const immediate = float64Immediate(deferred);
                if (immediate !== undefined)
                  emit({ op: "fmov-d-imm", rd: rt, imm8: immediate });
                else {
                  imm64(17, bits.lo, bits.hi);
                  emit({ op: "fmov-d-x", rd: rt, rn: 17 });
                }
              }
              return;
            }
            if (nanSentinelWords[valueIds.intern(id)] === 1) {
              const reg = rawRegister(id, 17);
              emit({
                op: "add-reg",
                width: 64,
                rd: "zr",
                rn: reg,
                rm: reg,
                shift: "lsl",
                amount: 0,
                setFlags: true,
              });
              const finite = instructions.length;
              emit({ op: "b.cond", condition: "vc", displacement: 0 });
              emit({
                op: "movz",
                width: 64,
                rd: 17,
                immediate: 0x7ff8,
                shift: 48,
              });
              emit({ op: "fmov-d-x", rd: rt, rn: 17 });
              const done = instructions.length;
              emit({ op: "b", displacement: 0 });
              patchInstruction(finite, {
                op: "b.cond",
                condition: "vc",
                displacement: (instructions.length - finite) * 4,
              });
              emit({ op: "scvtf-d-x", rd: rt, rn: reg });
              patchInstruction(done, {
                op: "b",
                displacement: (instructions.length - done) * 4,
              });
              return;
            }
            if (storedAsInteger(id)) {
              const reg = rawRegister(id, 17);
              if (nanSentinelRemainders[valueIds.intern(id)] === 1) {
                const nonNegativeValue = instructions.length;
                emit({ op: "tbz", rt: reg, bit: 63, displacement: 0 });
                emit({
                  op: "movz",
                  width: 64,
                  rd: 17,
                  immediate: 0x7ff8,
                  shift: 48,
                });
                emit({ op: "fmov-d-x", rd: rt, rn: 17 });
                const done = instructions.length;
                emit({ op: "b", displacement: 0 });
                patchInstruction(nonNegativeValue, {
                  op: "tbz",
                  rt: reg,
                  bit: 63,
                  displacement: (instructions.length - nonNegativeValue) * 4,
                });
                emit({ op: "scvtf-d-x", rd: rt, rn: reg });
                patchInstruction(done, {
                  op: "b",
                  displacement: (instructions.length - done) * 4,
                });
                return;
              }
              // Exact (|x| < 2^53), so the conversion is too.
              emit({ op: "scvtf-d-x", rd: rt, rn: reg });
              return;
            }
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
          const aliased = directIntAlias.get(id);
          if (aliased !== undefined) return aliased;
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
        /** An index operand of the Latin-1 primitives as an exact uint32
         * in `rd`, from an int64 or an integral double; anything else
         * traps (a binding invariant). Clobbers x16, d0 and d1. */
        function latin1Index(id: number, rd: number): void {
          if (exactInteger(id)) intOperand(id, rd);
          else {
            const operand = floatOperand(id, 0);
            emit({ op: "fcvtzs-x-d", rd, rn: operand });
            emit({ op: "scvtf-d-x", rd: 1, rn: rd });
            emit({ op: "fcmp", rn: operand, rm: 1 });
            trapIf({ op: "b.cond", condition: "ne" });
          }
          emit({ op: "ubfm", width: 64, rd: 16, rn: rd, immr: 32, imms: 63 });
          trapIf({ op: "cbnz", width: 64, rt: 16 });
        }
        /** Traps unless x11 <= x12 <= the 32-bit length at [x9 + offset]
         * (loaded into x10): the range [begin, limit) of a string or byte
         * array. */
        function latin1Range(lengthOffset: number): void {
          emit({ op: "ldr", width: 32, rt: 10, rn: 9, offset: lengthOffset });
          emit({
            op: "sub-reg",
            width: 64,
            rd: "zr",
            rn: 12,
            rm: 10,
            shift: "lsl",
            amount: 0,
            setFlags: true,
          });
          trapIf({ op: "b.cond", condition: "hi" });
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
        }
        /** Saves the int64 count in x9 as numeric result `id`. */
        function latin1Count(id: number): void {
          if (wantsInteger(id)) {
            saveRaw(9, id);
            markInteger(id);
          } else {
            emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
            floatStore(0, id);
          }
        }
        /** Ordinary numeric ALU operands may name their existing FP homes. Only
         * stack-backed values need a scratch load; no conversion or guard changes. */
        function floatOperand(id: number, scratch: number): number {
          const hoistedFp = hoistedFloatConst.get(id);
          if (hoistedFp !== undefined) return hoistedFp;
          const aliased = directFloatAlias.get(id);
          if (aliased !== undefined) return aliased;
          if (deferredIntegers.has(id)) {
            floatLoad(scratch, id);
            return scratch;
          }
          const storage = scalarRegisters,
            offset = value(id).offset,
            register = storage === undefined ? 0 : (storage[offset / 8] ?? 0);
          if (
            register !== 0 &&
            register < 32 &&
            !storedAsInteger(id) &&
            nanSentinelWords[valueIds.intern(id)] !== 1
          )
            return register;
          floatLoad(scratch, id);
          return scratch;
        }
        function rawValue(rt: number, id: number): void {
          const aliased = directIntAlias.get(id);
          if (aliased !== undefined) {
            if (rt !== aliased)
              emit({ op: "orr-reg", width: 64, rd: rt, rn: "zr", rm: aliased });
            return;
          }
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
          const aliased = directIntAlias.get(id);
          if (aliased !== undefined) return aliased;
          const home = homeOf(id);
          if (home >= 32) return home - 32;
          rawValue(scratch, id);
          return scratch;
        }
        function saveRaw(rt: number, id: number): void {
          rawStore(rt, value(id).offset);
          if (tracker !== undefined) tracker.saved(id, instructions.length * 4);
        }
        /** Writes exact integer `constant` as an int64 to the frame word at
         * `offset`, building it directly in a GP home. */
        function writeInteger(constant: number, offset: number): void {
          // Two's complement int64 halves of a safe integer.
          const lo = ((constant % 4294967296) + 4294967296) % 4294967296,
            hi = (Math.floor(constant / 4294967296) + 4294967296) % 4294967296;
          if (lo === 0 && hi === 0) {
            rawStore("zr", offset);
            return;
          }
          const register = scalarRegisters?.[offset / 8] ?? 0,
            target = register >= 32 ? register - 32 : 9;
          imm64(target, lo, hi);
          rawStore(target, offset);
        }
        /** Writes deferred integer constant `id` (if still deferred) to its
         * home. */
        function materializeInteger(id: number): void {
          const constant = deferredIntegers.get(id);
          if (constant === undefined) return;
          deferredIntegers.delete(id);
          writeInteger(constant, value(id).offset);
          if (tracker !== undefined) tracker.saved(id, instructions.length * 4);
        }
        /** Int64 arithmetic: exact bounded integers (kind 6) whose -0
         * results are unobserved (see findIntegerUses). */
        function integerArithmetic(op: IRInstruction): boolean {
          return (
            op.kind === "binary" &&
            (op.operator === "+" ||
              op.operator === "-" ||
              op.operator === "*") &&
            wantsInteger(op.id) &&
            zeroSignResults[valueIds.intern(op.id)] !== 1 &&
            wordKinds[valueIds.intern(op.id)] === 6 &&
            exactInteger(op.left) &&
            exactInteger(op.right)
          );
        }
        /** k when `n` is 2^k (0 <= k <= 32), else -1. */
        function exactLog2(n: number): number {
          let k = 0,
            power = 1;
          while (power < n && k < 32) {
            power *= 2;
            k++;
          }
          return power === n ? k : -1;
        }
        /** k when `constant` is 2^k or 2^k + 1 (1 <= k <= 32): a multiplier
         * a shift or a shifted add replaces. */
        function multiplierShift(constant: number): number | undefined {
          const plain = exactLog2(constant);
          if (plain >= 1) return plain;
          const above = exactLog2(constant - 1);
          return above >= 1 ? above : undefined;
        }
        /** For a 32-bit multiplier (Math.imul) whose word is 2^k (k <= 31),
         * 2^k + 1 (k <= 30) or 2^k - 1 (2 <= k <= 31): k, k + 32 or k + 64
         * respectively (k >= 1); 0 for any other. */
        function wordMultiplierShift(constant: number): number {
          const word = constant >>> 0,
            plain = exactLog2(word);
          if (plain >= 1 && plain <= 31) return plain;
          const above = exactLog2(word - 1);
          if (above >= 1 && above <= 30) return above + 32;
          const below = exactLog2(word + 1);
          if (below >= 2 && below <= 31) return below + 64;
          return 0;
        }
        /** Whether `x op constant` is ToInt32(x): `| 0`, `^ 0` or `& -1`. */
        function wordIdentity(operator: string, constant: number): boolean {
          const word = constant >>> 0;
          return operator === "&" ? word === 4294967295 : word === 0;
        }
        /** An add/sub immediate magnitude: 12 bits, optionally shifted by 12. */
        function addImmediate(magnitude: number): boolean {
          return (
            magnitude <= 4095 ||
            (magnitude % 4096 === 0 && magnitude <= 16773120)
          );
        }
        /** The deferred operand binary `op` takes as an immediate, if any
         * (the other operand is a different value): int64 addition or
         * subtraction of an add immediate (a constant on the right of `-`),
         * int64 multiplication by 2^k or 2^k + 1, a 32-bit `&`, `|` or `^`
         * with a logical immediate, and an int64 comparison against an add
         * immediate on the right. The binary case consumes it on exactly
         * these paths. */
        function binaryImmediate(op: IRInstruction): number | undefined {
          if (op.kind !== "binary" || op.left === op.right) return undefined;
          const left = deferredIntegers.get(op.left),
            right = deferredIntegers.get(op.right);
          if (left === undefined && right === undefined) return undefined;
          const operand = right !== undefined ? op.right : op.left,
            constant = right ?? left ?? 0;
          if (integerArithmetic(op)) {
            if (op.operator === "*")
              return multiplierShift(constant) !== undefined
                ? operand
                : undefined;
            if (op.operator === "-" && right === undefined) return undefined;
            return addImmediate(Math.abs(constant)) ? operand : undefined;
          }
          if (op.operator === "imul")
            return wordMultiplierShift(constant) !== 0 ? operand : undefined;
          if (op.operator === "&" || op.operator === "|" || op.operator === "^")
            return rotatedShifts[valueIds.intern(op.id)] !== 1 &&
              fusedShifts[valueIds.intern(op.id)] !== 1 &&
              (rotateAmounts[valueIds.intern(op.id)] ?? 0) === 0 &&
              !shiftedOps.has(op.id) &&
              (logicalImmediate32(constant >>> 0) !== undefined ||
                wordIdentity(op.operator, constant))
              ? operand
              : undefined;
          if (
            right !== undefined &&
            ["===", "!==", "==", "!=", "<", ">", "<=", ">="].includes(
              op.operator,
            ) &&
            undefinedValues[valueIds.intern(op.left)] !== 1 &&
            typeOf(op.left) === "number" &&
            exactInteger(op.left) &&
            addImmediate(Math.abs(right))
          )
            return op.right;
          return undefined;
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
          notes: readonly number[] = [],
          views: readonly number[] = [],
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
          // Direct callbacks: the failure notes, then their views.
          const extras = [t.onThrow, t.onInvalid];
          for (let index = 0; index < notes.length; index++) {
            const note = notes[index],
              offset = extras[index];
            if (note === undefined || offset === undefined)
              throw "transition note invariant";
            rawValue(9, note);
            emit({ op: "str", width: 64, rt: 9, rn: 13, offset });
            words.push(record + offset);
          }
          for (let index = 0; index < views.length; index++) {
            const view = views[index];
            if (view === undefined) throw "transition view invariant";
            const offset = t.callbacks + (callees.length + index) * 8;
            rawValue(9, view);
            emit({ op: "str", width: 64, rt: 9, rn: 13, offset });
            words.push(record + offset);
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
          returnPC: number = instructions.length,
        ): void {
          patchInstruction(returnAddressAt, {
            op: "adr",
            rd: 12,
            displacement: (returnPC - returnAddressAt) * 4,
          });
          safepointAt(returnPC);
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
        /** A fixed prototype has ordinary outgoing space and emitted
         * register moves, while the binding still owns the exact target. */
        function fixedScalarCall(
          call: ForeignCall,
          frame: number,
          result: number,
        ): void {
          const layout = foreignPlan(call).layout;
          const shape = dynamicScalarFrame;
          dataPointer(frame, 12, false, shape.size + layout.stackBytes);
          for (let offset = 0; offset < layout.stackBytes; offset += 8) {
            emit({
              op: "ldr",
              width: 64,
              rt: 14,
              rn: 12,
              offset: shape.size + offset,
            });
            rawStore(14, offset);
          }
          emit({ op: "ldr", width: 64, rt: 15, rn: 12, offset: shape.target });
          trapIf({ op: "cbz", width: 64, rt: 15 });
          for (const location of layout.arguments) {
            if (location === undefined) throw "fixed FFI argument invariant";
            if (location.gp >= 0)
              emit({
                op: "ldr",
                width: 64,
                rt: location.gp,
                rn: 12,
                offset: shape.registers + location.gp * 8,
              });
            else if (location.fp >= 0)
              emit({
                op: "ldr-d",
                rt: location.fp,
                rn: 12,
                offset: shape.floats + location.fp * 8,
              });
          }
          emit({ op: "blr", rn: 15 });
          if (layout.result.class !== "void") {
            dataPointer(frame, 12, false, 0);
            if (layout.result.class === "float")
              emit({ op: "str-d", rt: 0, rn: 12, offset: shape.floats });
            else
              emit({
                op: "str",
                width: 64,
                rt: 0,
                rn: 12,
                offset: shape.registers,
              });
          }
          imm(9, 1);
          saveRaw(9, result);
        }
        /** Copy the classified stack image below the managed frame. The
         * saved transition and its roots stay at their normal frame offsets. */
        function scalarDynamicCall(
          call: ForeignCall,
          operands: readonly number[],
          result: number,
        ): void {
          const layout = dynamicScalarFrame;
          const mayCallback = call.mayCallback === true;
          const frame = operands[mayCallback ? 2 : 0];
          if (frame === undefined) throw "scalar dynamic frame invariant";
          dataPointer(frame, 12, false, layout.size);
          emit({
            op: "sub-imm",
            width: 64,
            rd: 10,
            rn: 10,
            immediate: layout.size,
            shift: 0,
            setFlags: false,
          });
          emit({
            op: "ldr",
            width: 64,
            rt: 13,
            rn: 12,
            offset: layout.stackBytes,
          });
          emit({
            op: "sub-reg",
            width: 64,
            rd: "zr",
            rn: 10,
            rm: 13,
            shift: "lsl",
            amount: 0,
            setFlags: true,
          });
          trapIf({ op: "b.cond", condition: "cc" });
          emit({ op: "ubfm", width: 64, rd: 9, rn: 13, immr: 0, imms: 3 });
          trapIf({ op: "cbnz", width: 64, rt: 9 });
          address(11, 0);
          emit({
            op: "sub-reg",
            width: 64,
            rd: 11,
            rn: 11,
            rm: 13,
            shift: "lsl",
            amount: 0,
            setFlags: false,
          });
          rawLoad(9, contextOffset);
          emit({
            op: "ldr",
            width: 64,
            rt: 9,
            rn: 9,
            offset: nativeStackLimitOffset,
          });
          emit({
            op: "sub-imm",
            width: 64,
            rd: 10,
            rn: 11,
            immediate: nativeCStackReserveBytes / 4096,
            shift: 12,
            setFlags: false,
          });
          emit({
            op: "sub-reg",
            width: 64,
            rd: "zr",
            rn: 10,
            rm: 9,
            shift: "lsl",
            amount: 0,
            setFlags: true,
          });
          const exhausted = instructions.length;
          emit({ op: "b.cond", condition: "cc", displacement: 0 });
          const words: number[] = [];
          const state = operands[0];
          let returnAddressAt = -1;
          if (mayCallback) {
            const dispatcher = operands[1];
            if (state === undefined || dispatcher === undefined)
              throw "scalar dynamic transition invariant";
            returnAddressAt = pushTransition(state, dispatcher, [], 0, words);
            dataPointer(frame, 12, false, 0);
            emit({
              op: "ldr",
              width: 64,
              rt: 13,
              rn: 12,
              offset: layout.stackBytes,
            });
          }
          emit({ op: "ldr", width: 64, rt: 15, rn: 12, offset: layout.target });
          trapIf({ op: "cbz", width: 64, rt: 15 });
          emit({
            op: "add-imm",
            width: 64,
            rd: "sp",
            rn: 11,
            immediate: 0,
            shift: 0,
            setFlags: false,
          });
          emit({
            op: "add-imm",
            width: 64,
            rd: 10,
            rn: 12,
            immediate: layout.size,
            shift: 0,
            setFlags: false,
          });
          const copy = instructions.length;
          emit({ op: "cbz", width: 64, rt: 13, displacement: 0 });
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
          emit({ op: "b", displacement: (copy - instructions.length) * 4 });
          patchInstruction(copy, {
            op: "cbz",
            width: 64,
            rt: 13,
            displacement: (instructions.length - copy) * 4,
          });
          for (let register = 0; register < 8; register += 2) {
            emit({
              op: "ldp-d",
              rt: register,
              rt2: register + 1,
              rn: 12,
              offset: layout.floats + register * 8,
            });
            emit({
              op: "ldp",
              width: 64,
              rt: register,
              rt2: register + 1,
              rn: 12,
              offset: layout.registers + register * 8,
              mode: "offset",
            });
          }
          emit({ op: "blr", rn: 15 });
          const returnPC = instructions.length;
          imm(10, frameBytes);
          emit({
            op: "sub-reg",
            width: 64,
            rd: 11,
            rn: 29,
            rm: 10,
            shift: "lsl",
            amount: 0,
            setFlags: false,
          });
          emit({
            op: "add-imm",
            width: 64,
            rd: "sp",
            rn: 11,
            immediate: 0,
            shift: 0,
            setFlags: false,
          });
          if (mayCallback && state !== undefined)
            popTransition(state, 0, returnAddressAt, words, returnPC);
          dataPointer(frame, 12, false, 0);
          emit({
            op: "str",
            width: 64,
            rt: 0,
            rn: 12,
            offset: layout.registers,
          });
          emit({ op: "str-d", rt: 0, rn: 12, offset: layout.floats });
          imm(9, 1);
          const completed = instructions.length;
          emit({ op: "b", displacement: 0 });
          patchInstruction(exhausted, {
            op: "b.cond",
            condition: "cc",
            displacement: (instructions.length - exhausted) * 4,
          });
          imm(9, 0);
          patchInstruction(completed, {
            op: "b",
            displacement: (instructions.length - completed) * 4,
          });
          saveRaw(9, result);
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
        // When `currentBatchKind` is 1 ("head"), the fast path reserves
        // `currentBatchTotal` bytes at once and stores the next object address
        // in `allocationOffset` (or 0 on the slow path); kinds 2 ("mid") and 3
        // ("tail") consume that cursor directly when non-zero.
        let currentBatchKind = 0;
        let currentBatchTotal = 0;
        function allocate(
          prepare: () => void,
          size: (rd: number) => void,
          preserveFloats: boolean = false,
          constSize?: number,
        ): void {
          const batchKind = currentBatchKind,
            batchTotal = currentBatchTotal;
          currentBatchKind = 0;
          currentBatchTotal = 0;
          pollWorkerStop();
          prepare();
          let fastDone = -1;
          const emitSlowPath = (
            slowSize: (rd: number) => void,
            clearBatch: boolean,
          ): void => {
            const saved = preserveFloats ? floatTemporaryMask : 0;
            for (let r = 0; r < 16; r++)
              if ((saved & (1 << r)) !== 0)
                emit({
                  op: "str-d",
                  rt: 16 + r,
                  rn: "sp",
                  offset: floatSaveOffset + r * 8,
                });
            rawLoad(0, contextOffset);
            address(3, resultOffset);
            slowSize(9);
            callHelper("allocate-call");
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
            // The allocator returns `number | undefined` (one NaN-boxed word);
            // allocate-finish checks it and forms the object's address in x9.
            rawLoad(9, resultOffset + 16);
            slowSize(10);
            rawLoad(11, contextOffset);
            callHelper("allocate-finish");
            for (let r = 0; r < 16; r++)
              if ((saved & (1 << r)) !== 0)
                emit({
                  op: "ldr-d",
                  rt: 16 + r,
                  rn: "sp",
                  offset: floatSaveOffset + r * 8,
                });
            if (clearBatch) rawStore("zr", allocationOffset);
          };
          if (linearAllocation) {
            // All allocation producers pass positive aligned uint32 extents. The
            // runtime publishes stable control storage and maintains its cursor.
            const immediateSize =
              constSize !== undefined && constSize >= 0 && constSize <= 4095
                ? constSize
                : -1;
            const deferSlow =
              immediateSize >= 0 &&
              allowColdStubs &&
              instructions.length - start / 4 < 131072;
            if ((batchKind === 2 || batchKind === 3) && immediateSize >= 0) {
              const hadNursery = cachedNurseryBaseInX16;
              const preservedWords: {
                readonly offset: number;
                readonly reg: number;
              }[] = [];
              for (const [off, reg] of stackWords)
                if ((reg >= 4 && reg <= 8) || reg === 15)
                  preservedWords.push({ offset: off, reg });
              rawLoad(9, allocationOffset);
              const batchSlow = instructions.length;
              emit({ op: "cbz", width: 64, rt: 9, displacement: 0 });
              if (batchKind === 2) {
                emit({
                  op: "add-imm",
                  width: 64,
                  rd: 13,
                  rn: 9,
                  immediate: immediateSize,
                  shift: 0,
                  setFlags: false,
                });
                rawStore(13, allocationOffset);
              }
              if (deferSlow) {
                const returnAt = instructions.length,
                  capturedBlock = blockId,
                  capturedSite = siteIndex,
                  capturedSpan = span,
                  capturedBytes = immediateSize,
                  isMiddle = batchKind === 2;
                clearWordCaches();
                if (isMiddle) stackWords.set(allocationOffset, 13);
                for (const entry of preservedWords)
                  if (entry !== undefined)
                    stackWords.set(entry.offset, entry.reg);
                if (hadNursery) cachedNurseryBaseInX16 = true;
                deferredAllocSlowPaths.push(() => {
                  const prevBlock = blockId,
                    prevSite = siteIndex,
                    prevSpan = span;
                  blockId = capturedBlock;
                  siteIndex = capturedSite;
                  span = capturedSpan;
                  clearWordCaches();
                  patchInstruction(batchSlow, {
                    op: "cbz",
                    width: 64,
                    rt: 9,
                    displacement: (instructions.length - batchSlow) * 4,
                  });
                  emitSlowPath((rd) => imm(rd, capturedBytes), false);
                  if (isMiddle) imm(13, 0);
                  for (const entry of preservedWords)
                    if (entry !== undefined) rawLoad(entry.reg, entry.offset);
                  if (hadNursery) {
                    rawLoad(10, contextOffset);
                    emit({
                      op: "ldr",
                      width: 64,
                      rt: 16,
                      rn: 10,
                      offset: nativeAllocationStateOffset,
                    });
                    const unpub = instructions.length;
                    emit({ op: "cbz", width: 64, rt: 16, displacement: 0 });
                    emit({
                      op: "ldr",
                      width: 64,
                      rt: 16,
                      rn: 16,
                      offset: nativeGenerationalNurseryAddressOffset,
                    });
                    patchInstruction(unpub, {
                      op: "cbz",
                      width: 64,
                      rt: 16,
                      displacement: (instructions.length - unpub) * 4,
                    });
                  }
                  emit({
                    op: "b",
                    displacement: (returnAt - instructions.length) * 4,
                  });
                  blockId = prevBlock;
                  siteIndex = prevSite;
                  span = prevSpan;
                });
                return;
              }
              fastDone = instructions.length;
              emit({ op: "b", displacement: 0 });
              patchInstruction(batchSlow, {
                op: "cbz",
                width: 64,
                rt: 9,
                displacement: (instructions.length - batchSlow) * 4,
              });
            } else {
              const reserveSize =
                batchKind === 1 && batchTotal > 0 && batchTotal <= 4095
                  ? batchTotal
                  : immediateSize;
              if (reserveSize < 0) size(9);
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
              emit({
                op: "ldp",
                width: 32,
                rt: 11,
                rt2: 13,
                rn: 12,
                offset: 0,
                mode: "offset",
              });
              // The limit may be lowered below the top at any time (a debugger
              // arming allocation sampling while an allocation was between
              // this check and its store), so compare top + size with it
              // rather than size with limit - top, which would wrap. Top,
              // limit and size are uint32 offsets zero-extended into 64-bit
              // registers, so the sum cannot wrap; the slow path rejects any
              // request of 2^31 bytes or more.
              if (reserveSize >= 0)
                emit({
                  op: "add-imm",
                  width: 64,
                  rd: 14,
                  rn: 11,
                  immediate: reserveSize,
                  shift: 0,
                  setFlags: false,
                });
              else
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
                op: "sub-reg",
                width: 64,
                rd: "zr",
                rn: 14,
                rm: 13,
                shift: "lsl",
                amount: 0,
                setFlags: true,
              });
              const exhausted = instructions.length;
              emit({ op: "b.cond", condition: "hi", displacement: 0 });
              emit({ op: "str", width: 32, rt: 14, rn: 12, offset: 0 });
              // The generational nursery keeps no start bits: it is
              // bump-allocated without gaps, so the compactor's rare fallback
              // and heap tools walk it by extents. Add the young top to the
              // nursery's absolute address (cached in x16 for subsequent
              // write barriers in the same block).
              emit({
                op: "ldr",
                width: 64,
                rt: 16,
                rn: 12,
                offset: nativeGenerationalNurseryAddressOffset,
              });
              emit({
                op: "add-reg",
                width: 64,
                rd: 9,
                rn: 16,
                rm: 11,
                shift: "lsl",
                amount: 0,
                setFlags: false,
              });
              if (batchKind === 1 && immediateSize >= 0) {
                emit({
                  op: "add-imm",
                  width: 64,
                  rd: 13,
                  rn: 9,
                  immediate: immediateSize,
                  shift: 0,
                  setFlags: false,
                });
                rawStore(13, allocationOffset);
              }
              if (deferSlow) {
                const returnAt = instructions.length,
                  capturedBlock = blockId,
                  capturedSite = siteIndex,
                  capturedSpan = span,
                  capturedBytes = immediateSize,
                  clearBatch = batchKind === 1;
                clearWordCaches();
                if (clearBatch) stackWords.set(allocationOffset, 13);
                cachedNurseryBaseInX16 = true;
                deferredAllocSlowPaths.push(() => {
                  const prevBlock = blockId,
                    prevSite = siteIndex,
                    prevSpan = span;
                  blockId = capturedBlock;
                  siteIndex = capturedSite;
                  span = capturedSpan;
                  clearWordCaches();
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
                  emitSlowPath((rd) => imm(rd, capturedBytes), clearBatch);
                  if (clearBatch) imm(13, 0);
                  rawLoad(10, contextOffset);
                  emit({
                    op: "ldr",
                    width: 64,
                    rt: 16,
                    rn: 10,
                    offset: nativeAllocationStateOffset,
                  });
                  const unpub = instructions.length;
                  emit({ op: "cbz", width: 64, rt: 16, displacement: 0 });
                  emit({
                    op: "ldr",
                    width: 64,
                    rt: 16,
                    rn: 16,
                    offset: nativeGenerationalNurseryAddressOffset,
                  });
                  patchInstruction(unpub, {
                    op: "cbz",
                    width: 64,
                    rt: 16,
                    displacement: (instructions.length - unpub) * 4,
                  });
                  emit({
                    op: "b",
                    displacement: (returnAt - instructions.length) * 4,
                  });
                  blockId = prevBlock;
                  siteIndex = prevSite;
                  span = prevSpan;
                });
                return;
              }
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
          }
          emitSlowPath(size, batchKind === 1);
          if (fastDone >= 0)
            patchInstruction(fastDone, {
              op: "b",
              displacement: (instructions.length - fastDone) * 4,
            });
        }
        /** string-slice-bounds' contract (x9 the source -> x12 begin, x13
         * count), inline when the bounds are integers: relative bounds clamped
         * to [0, length] in integer arithmetic. Other bounds (NaN, infinities,
         * fractions) fall back to the helper, which clamps doubles. */
        function sliceBounds(
          string: number,
          begin: number,
          limit: number,
          limitAbsent: boolean,
          limitPresent: boolean,
          limitSource: number,
        ): void {
          const slow: { index: number; branch: Branch }[] = [];
          const toSlow = (branch: Branch): void => {
            slow.push({ index: instructions.length, branch });
            emit(branchAt(branch, 0));
          };
          /** rd = the integer value of `id`, or slow. */
          const integerBound = (id: number, rd: number): void => {
            if (nanSentinelWords[valueIds.intern(id)] === 1) {
              rawValue(rd, id);
              emit({
                op: "add-reg",
                width: 64,
                rd: "zr",
                rn: rd,
                rm: rd,
                shift: "lsl",
                amount: 0,
                setFlags: true,
              });
              toSlow({ op: "b.cond", condition: "vs" });
              return;
            }
            if (storedAsInteger(id)) {
              rawValue(rd, id);
              return;
            }
            const fp = floatOperand(id, 0);
            emit({ op: "fcvtzs-x-d", rd, rn: fp });
            if (exactInteger(id)) return;
            emit({ op: "scvtf-d-x", rd: 2, rn: rd });
            emit({ op: "fcmp", rn: fp, rm: 2 });
            toSlow({ op: "b.cond", condition: "ne" });
          };
          const compareZero = (register: number): void => {
            emit({
              op: "sub-imm",
              width: 64,
              rd: "zr",
              rn: register,
              immediate: 0,
              shift: 0,
              setFlags: true,
            });
          };
          /** rd = clamp(rd < 0 ? rd + length : rd, 0, length), length in
           * x11. Clobbers x14. */
          const clampRelative = (rd: number, id: number): void => {
            if (
              !nonNegative(id) &&
              nanSentinelNonNegative[valueIds.intern(id)] !== 1
            ) {
              compareZero(rd);
              emit({
                op: "add-reg",
                width: 64,
                rd: 14,
                rn: rd,
                rm: 11,
                shift: "lsl",
                amount: 0,
                setFlags: false,
              });
              emit({
                op: "csel",
                width: 64,
                rd,
                rn: 14,
                rm: rd,
                condition: "lt",
              });
              compareZero(rd);
              emit({
                op: "csel",
                width: 64,
                rd,
                rn: "zr",
                rm: rd,
                condition: "lt",
              });
            }
            emit({
              op: "sub-reg",
              width: 64,
              rd: "zr",
              rn: rd,
              rm: 11,
              shift: "lsl",
              amount: 0,
              setFlags: true,
            });
            emit({
              op: "csel",
              width: 64,
              rd,
              rn: 11,
              rm: rd,
              condition: "gt",
            });
          };
          integerBound(begin, 12);
          emit({
            op: "ldr",
            width: 32,
            rt: 11,
            rn: 9,
            offset: nativeStringLengthOffset,
          });
          // An absent limit is the length, so length - begin is non-negative
          // after begin is clamped to [0, length].
          if (limitAbsent) {
            clampRelative(12, begin);
            emit({
              op: "sub-reg",
              width: 64,
              rd: 13,
              rn: 11,
              rm: 12,
              shift: "lsl",
              amount: 0,
              setFlags: false,
            });
          } else {
            if (!limitPresent)
              emit({
                op: "add-reg",
                width: 64,
                rd: 13,
                rn: "zr",
                rm: 11,
                shift: "lsl",
                amount: 0,
                setFlags: false,
              });
            let absent = -1;
            if (!limitPresent) {
              rawValue(10, limit);
              absentFlags(10, 10);
              absent = instructions.length;
              emit({ op: "b.cond", condition: "eq", displacement: 0 });
            }
            integerBound(limitSource, 13);
            clampRelative(13, limitSource);
            if (absent >= 0)
              patchInstruction(absent, {
                op: "b.cond",
                condition: "eq",
                displacement: (instructions.length - absent) * 4,
              });
            clampRelative(12, begin);
            // The count: limit - begin, at least zero.
            emit({
              op: "sub-reg",
              width: 64,
              rd: 13,
              rn: 13,
              rm: 12,
              shift: "lsl",
              amount: 0,
              setFlags: true,
            });
            emit({
              op: "csel",
              width: 64,
              rd: 13,
              rn: "zr",
              rm: 13,
              condition: "lt",
            });
          }
          if (slow.length > 0) {
            const done = instructions.length;
            emit({ op: "b", displacement: 0 });
            for (const site of slow) {
              if (site === undefined) throw "slice bounds invariant";
              patchInstruction(
                site.index,
                branchAt(site.branch, (instructions.length - site.index) * 4),
              );
            }
            floatLoad(0, begin);
            if (limitAbsent) imm(10, 0);
            else {
              floatLoad(1, limitSource);
              if (limitPresent) imm(10, 1);
              else {
                rawValue(10, limit);
                absentFlags(10, 10);
                emit({ op: "cset", rd: 10, condition: "ne" });
              }
            }
            // floatLoad may clobber x9 when converting spilled integers.
            rawValue(9, string);
            callHelper("string-slice-bounds");
            patchInstruction(done, {
              op: "b",
              displacement: (instructions.length - done) * 4,
            });
          }
        }
        // Combined code-unit count in x11; checked rounded extent saved across allocation.
        /** Code-unit count in x11 and the kind in `oneByte` (a register
         * holding 1 for a one-byte string, else 0): saves the checked
         * rounded extent at allocationOffset and the header at +24, both
         * across the allocation. Clobbers x11-x13 and x15. */
        function prepareStringSize(oneByte: number): void {
          // align8(16 + bytes) must fit the uint32 allocation contract.
          // A longer string can never exist: clamp it to the maximum, whose
          // extent exceeds every heap's capacity (each is below 2^31), so
          // the allocator throws its catchable RangeError value before
          // anything is written.
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
          // Data bytes: units << (1 - oneByte).
          imm(15, 1);
          emit({
            op: "sub-reg",
            width: 64,
            rd: 15,
            rn: 15,
            rm: oneByte,
            shift: "lsl",
            amount: 0,
            setFlags: false,
          });
          emit({ op: "lslv", width: 64, rd: 12, rn: 11, rm: 15 });
          // align8(16 + max(bytes, 1)), which equals align8(16 + max(bytes,
          // 8)): every string has at least eight data bytes, which inline
          // literal comparisons read unchecked.
          emit({
            op: "sub-imm",
            width: 64,
            rd: "zr",
            rn: 12,
            immediate: 0,
            shift: 0,
            setFlags: true,
          });
          emit({ op: "cset", rd: 13, condition: "eq" });
          emit({
            op: "add-reg",
            width: 64,
            rd: 12,
            rn: 12,
            rm: 13,
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
          // Header: marker 1 plus the one-byte kind flag (bit 48).
          emit({
            op: "ubfm",
            width: 64,
            rd: 13,
            rn: oneByte,
            immr: 16,
            imms: 15,
          });
          emit({
            op: "add-imm",
            width: 64,
            rd: 13,
            rn: 13,
            immediate: nativeStringTwoByteHeader,
            shift: 0,
            setFlags: false,
          });
          rawStore(13, allocationOffset + 24);
        }
        // Typed-array object: marker +0, flags +8, length +16, data pointer +24.
        // Returns index in x9, data pointer in x10, validity in x13.
        /** Bounds-checks `index` against `array`: x13 holds whether it is a
         * valid element index, x10 the element base, x11 the length; returns
         * the GP register holding the index as an integer (x9 or its home). */
        function typedArrayType(type: ScalarType): NativeTypedArray {
          const array = nativeTypedArray(type);
          if (array === undefined) throw "typed array element invariant";
          return array;
        }
        /** Load element `index` (a register, scaled by the element size) of
         * the typed array whose data pointer is in `base`: integer kinds as
         * an exact int64 in `integer` (zero- or sign-extended), floating-
         * point kinds as a double in FP register `float`. Returns whether
         * the element is a double. */
        function loadElement(
          type: ScalarType,
          base: number,
          index: number,
          integer: number,
          float: number,
        ): boolean {
          const layout = typedArrayLayout(typedArrayType(type)),
            scale = typedArrayScale(type);
          if (layout.element === "float") {
            emit({
              op: "ldr-indexed",
              size: scale,
              fp: true,
              rt: float,
              rn: base,
              rm: index,
              scaled: true,
            });
            if (scale === 1) emit({ op: "fcvt-d-h", rd: float, rn: float });
            else if (scale === 2)
              emit({ op: "fcvt-d-s", rd: float, rn: float });
            return true;
          }
          // LDRSB/LDRSH/LDRSW sign-extend to 64 bits in the load itself.
          emit({
            op: "ldr-indexed",
            size: scale,
            fp: false,
            rt: integer,
            rn: base,
            rm: index,
            scaled: scale !== 0,
            signed: layout.element === "signed",
          });
          return false;
        }
        /** An integer element loaded by loadElement as a double. */
        function elementToDouble(
          type: ScalarType,
          rd: number,
          rn: number,
        ): void {
          if (typedArrayLayout(typedArrayType(type)).element === "signed")
            emit({ op: "scvtf-d-x", rd, rn });
          else emit({ op: "ucvtf-d-w", rd, rn });
        }
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
        /** The byte length of typed ArrayBuffer `buffer` (an owning or
         * borrowed array: marker < nativeBuiltinMarkerLimit with low three
         * bits 2-5 for 1-, 2-, 4- and 8-byte elements) into `rd`; x13 keeps
         * the element width's shift. */
        function bufferByteLength(buffer: number, rd: number): void {
          emit({ op: "ldr", width: 64, rt: 13, rn: buffer, offset: 0 });
          emit({ op: "ubfm", width: 64, rd: 13, rn: 13, immr: 0, imms: 47 });
          emit({
            op: "sub-imm",
            width: 64,
            rd: "zr",
            rn: 13,
            immediate: nativeBuiltinMarkerLimit,
            shift: 0,
            setFlags: true,
          });
          trapIf({ op: "b.cond", condition: "cs" });
          emit({ op: "ubfm", width: 64, rd: 13, rn: 13, immr: 0, imms: 2 });
          emit({
            op: "sub-imm",
            width: 64,
            rd: 13,
            rn: 13,
            immediate: 2,
            shift: 0,
            setFlags: false,
          });
          emit({
            op: "sub-imm",
            width: 64,
            rd: "zr",
            rn: 13,
            immediate: 3,
            shift: 0,
            setFlags: true,
          });
          trapIf({ op: "b.cond", condition: "hi" });
          emit({
            op: "ldr",
            width: 32,
            rt: rd,
            rn: buffer,
            offset: nativeArrayLengthOffset,
          });
          emit({ op: "lslv", width: 64, rd, rn: rd, rm: 13 });
        }
        /** A typed-array view over a typed ArrayBuffer (`array-view`): the
         * subarray layout with the target type's marker, its data at the
         * buffer's data plus `byteOffset`, and the buffer as owner. */
        /** An Atomics operation on a native integer array (the IR's
         * `array-atomic`), sequentially consistent: full inner-shareable
         * fences around an acquire/release access, as the shared-memory
         * primitives use. Read-modify-writes are exclusive-pair loops: x11
         * observes the element, x12 is the value written (a
         * compare-exchange writes x15) and x13 the store status. */
        function arrayAtomic(op: {
          readonly operation: ArrayAtomicOperation;
          readonly id: number | undefined;
          readonly array: number;
          readonly index: number;
          readonly operands: readonly number[];
        }): void {
          const type = value(op.array).type,
            array = typedArrayType(type),
            layout = typedArrayLayout(array),
            scale = typedArrayScale(type),
            width: MemoryAccessWidth = scale === 0 ? 8 : scale === 1 ? 16 : 32;
          if (!typedArrayNumericAtomics(array))
            throw "atomic array type invariant";
          // Operands convert first (possibly through a helper, which
          // clobbers scratch registers) and are staged in the result area.
          for (let at = 0; at < op.operands.length; at++) {
            const operand = op.operands[at];
            if (operand === undefined) throw "atomic operand invariant";
            wordValue(operand);
            rawStore(9, resultOffset + 16 + at * 8);
          }
          const index = arrayIndex(op.array, op.index);
          // The lowering validated the index.
          emit({ op: "cbnz", width: 32, rt: 13, displacement: 8 });
          emit({ op: "brk", immediate: 3 });
          emit({
            op: "add-reg",
            width: 64,
            rd: 10,
            rn: 10,
            rm: index,
            shift: "lsl",
            amount: scale,
            setFlags: false,
          });
          if (op.operands.length > 0) rawLoad(14, resultOffset + 16);
          if (op.operands.length > 1) rawLoad(15, resultOffset + 24);
          if (op.operation === "add" && options.hostABI?.os === "darwin") {
            // Apple Silicon guarantees ARMv8.1 LSE: LDADDAL is a single
            // sequentially consistent atomic add without LL/SC retry or DMB.
            emit({ op: "ldaddal", width, rs: 14, rt: 11, rn: 10 });
          } else {
            emit({ op: "dmb", domain: "ish" });
            if (op.operation === "load")
              emit({ op: "ldar", width, rt: 11, rn: 10 });
            else if (op.operation === "store")
              emit({ op: "stlr", width, rt: 14, rn: 10 });
            else {
              const exchange = op.operation === "compare-exchange";
              // The element loads zero-extended, so the expected value
              // compares in the element's width.
              if (exchange && width < 32)
                emit({
                  op: "ubfm",
                  width: 64,
                  rd: 14,
                  rn: 14,
                  immr: 0,
                  imms: width - 1,
                });
              const loop = instructions.length;
              emit({ op: "ldaxr", width, rt: 11, rn: 10 });
              let mismatch = -1;
              if (exchange) {
                emit({
                  op: "sub-reg",
                  width: 32,
                  rd: "zr",
                  rn: 11,
                  rm: 14,
                  shift: "lsl",
                  amount: 0,
                  setFlags: true,
                });
                mismatch = instructions.length;
                emit({ op: "b.cond", condition: "ne", displacement: 0 });
              } else if (op.operation === "add" || op.operation === "sub")
                emit({
                  op: op.operation === "add" ? "add-reg" : "sub-reg",
                  width: 32,
                  rd: 12,
                  rn: 11,
                  rm: 14,
                  shift: "lsl",
                  amount: 0,
                  setFlags: false,
                });
              else if (op.operation !== "exchange") {
                const combine: "and-reg" | "orr-reg" | "eor-reg" =
                  op.operation === "and"
                    ? "and-reg"
                    : op.operation === "or"
                      ? "orr-reg"
                      : "eor-reg";
                emit({ op: combine, width: 32, rd: 12, rn: 11, rm: 14 });
              }
              const written: number = exchange
                ? 15
                : op.operation === "exchange"
                  ? 14
                  : 12;
              emit({ op: "stlxr", width, rs: 13, rt: written, rn: 10 });
              emit({
                op: "cbnz",
                width: 32,
                rt: 13,
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
            }
            emit({ op: "dmb", domain: "ish" });
          }
          const id = op.id;
          if (id === undefined) return;
          // The previous element, zero-extended in x11; sign-extend for signed kinds.
          const signed = layout.element === "signed";
          if (signed)
            emit({
              op: "sbfm",
              width: 64,
              rd: 11,
              rn: 11,
              immr: 0,
              imms: width - 1,
            });
          if (wantsInteger(id)) {
            saveRaw(11, id);
            markInteger(id);
          } else {
            const target = floatTarget(id, 0);
            if (signed) emit({ op: "scvtf-d-x", rd: target, rn: 11 });
            else emit({ op: "ucvtf-d-w", rd: target, rn: 11 });
            floatStore(target, id);
          }
        }
        function arrayWord64Read(op: {
          readonly id: number;
          readonly array: number;
          readonly index: number;
          readonly scratch: number;
        }): void {
          const readIndex = arrayIndex(op.array, op.index);
          const invalid = instructions.length;
          emit({ op: "cbz", width: 32, rt: 13, displacement: 0 });
          emit({
            op: "ldr-indexed",
            size: 3,
            fp: false,
            rt: 11,
            rn: 10,
            rm: readIndex,
            scaled: true,
          });
          rawValue(12, op.scratch);
          emit({
            op: "ldr",
            width: 64,
            rt: 12,
            rn: 12,
            offset: nativeArrayDataOffset,
          });
          emit({ op: "str", width: 64, rt: 11, rn: 12, offset: 0 });
          patchInstruction(invalid, {
            op: "cbz",
            width: 32,
            rt: 13,
            displacement: (instructions.length - invalid) * 4,
          });
          saveRaw(13, op.id);
        }
        function arrayWord64Write(op: {
          readonly array: number;
          readonly index: number;
          readonly scratch: number;
        }): void {
          const storeIndex = arrayIndex(op.array, op.index);
          const invalid = instructions.length;
          emit({ op: "cbz", width: 32, rt: 13, displacement: 0 });
          rawValue(12, op.scratch);
          emit({
            op: "ldr",
            width: 64,
            rt: 12,
            rn: 12,
            offset: nativeArrayDataOffset,
          });
          emit({ op: "ldr", width: 64, rt: 11, rn: 12, offset: 0 });
          emit({
            op: "str-indexed",
            size: 3,
            fp: false,
            rt: 11,
            rn: 10,
            rm: storeIndex,
            scaled: true,
          });
          patchInstruction(invalid, {
            op: "cbz",
            width: 32,
            rt: 13,
            displacement: (instructions.length - invalid) * 4,
          });
        }
        let cachedWord64Ctx: Word64EmitContext | undefined = undefined;
        function word64Ctx(): Word64EmitContext {
          if (cachedWord64Ctx === undefined) {
            cachedWord64Ctx = {
              emit,
              instructionCount: () => instructions.length,
              patchInstruction,
              storedAsInteger,
              intRegister,
              intTarget,
              rawRegister,
              rawValue,
              saveRaw,
              floatLoad: (rt, id) => floatLoad(rt, id),
              floatStore,
              arrayIndex: (array, index) => arrayIndex(array, index),
              getCachedArrayDataVal: () => cachedArrayDataVal,
              getCachedArrayDataReg: () => cachedArrayDataReg,
              setCachedArrayData: (reg, val) => {
                cachedArrayDataReg = reg;
                cachedArrayDataVal = val;
              },
            };
          }
          return cachedWord64Ctx;
        }
        let cachedBytesCtx: BytesEmitContext | undefined = undefined;
        function bytesCtx(): BytesEmitContext {
          if (cachedBytesCtx === undefined) {
            cachedBytesCtx = {
              wordKinds,
              wordConstants,
              jsConvert,
              resultOffset,
              internValue: (id) => valueIds.intern(id),
              emit,
              imm,
              storedAsInteger,
              storedAsWord,
              wantsInteger,
              booleanConstant,
              intRegister,
              intTarget,
              rawRegister,
              rawValue,
              rawLoad,
              rawStore: (rt, offset) => rawStore(rt, offset),
              saveRaw,
              markInteger,
              materializeInteger,
              wordValue,
              floatLoad: (rt, id) => floatLoad(rt, id),
              floatOperand,
              floatTarget,
              floatStore,
              getCachedArrayDataVal: () => cachedArrayDataVal,
              getCachedArrayDataReg: () => cachedArrayDataReg,
              setCachedArrayData: (reg, val) => {
                cachedArrayDataReg = reg;
                cachedArrayDataVal = val;
              },
            };
          }
          return cachedBytesCtx;
        }
        let cachedHostCallCtx: HostCallEmitContext | undefined = undefined;
        function hostCallCtx(): HostCallEmitContext {
          if (cachedHostCallCtx !== undefined) return cachedHostCallCtx;
          const created: HostCallEmitContext = {
            instructions,
            valueIds,
            wordKinds,
            wordConstants,
            allocationOffset,
            calleeSaveOffset,
            contextOffset,
            functionRecord,
            ownRootHead,
            preservedCount,
            resultOffset,
            value,
            address,
            allocate,
            callHelper,
            clearWordCaches,
            descriptorPointer,
            emit,
            exceptionalBranch,
            fail,
            floatLoad,
            floatOperand,
            floatStore,
            guardDescriptor,
            host,
            imm,
            imm64,
            importAddress,
            importCall,
            markInteger,
            numberConstant,
            patchInstruction,
            pollWorkerStop,
            prepareStringSize,
            rawLoad,
            rawStore,
            rawValue,
            safepoint,
            saveRaw,
            startupCall,
            storedAsInteger,
            trapIf,
            wantsInteger,
            zeroWords,
          };
          cachedHostCallCtx = created;
          return created;
        }
        let cachedCInteropCtx: CInteropEmitContext | undefined = undefined;
        function cInteropCtx(): CInteropEmitContext {
          if (cachedCInteropCtx !== undefined) return cachedCInteropCtx;
          const created: CInteropEmitContext = {
            instructions,
            address,
            cTarget,
            callbackThunk,
            compareImmediate,
            copyToFrame,
            dataPointer,
            dynamicCall,
            emit,
            fixedScalarCall,
            floatLoad,
            floatStore,
            floatToInteger,
            foreignPlan,
            headerFlags,
            host,
            imm,
            imm64,
            importAddress,
            importCall,
            integerToFloat,
            loadBytes,
            narrowLoad,
            narrowStore,
            numberToInteger,
            patchInstruction,
            popTransition,
            provenInteger,
            pushTransition,
            rawRegister,
            rawValue,
            rejectSaturated,
            saveRaw,
            scalarDynamicCall,
            storeBytes,
            storedAsInteger,
            thunkAddress,
            trapIf,
            viewValueToken,
          };
          cachedCInteropCtx = created;
          return created;
        }
        let cachedStringOpsCtx: StringOpsEmitContext | undefined = undefined;
        function stringOpsCtx(): StringOpsEmitContext {
          if (cachedStringOpsCtx !== undefined) return cachedStringOpsCtx;
          const created: StringOpsEmitContext = {
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
            markUnitStrings: () => {
              usesUnitStrings = true;
            },
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
            sliceBounds,
            storedAsInteger,
            trapIf,
            wantsInteger,
            wordValue,
          };
          cachedStringOpsCtx = created;
          return created;
        }
        function arrayWord64Fill(op: {
          readonly array: number;
          readonly scratch: number;
          readonly from: number;
          readonly to: number;
        }): void {
          rawValue(9, op.scratch);
          emit({
            op: "ldr",
            width: 64,
            rt: 9,
            rn: 9,
            offset: nativeArrayDataOffset,
          });
          emit({ op: "ldr", width: 64, rt: 9, rn: 9, offset: 0 });
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
            amount: 3,
            setFlags: false,
          });
          emit({
            op: "add-reg",
            width: 64,
            rd: 1,
            rn: "zr",
            rm: 1,
            shift: "lsl",
            amount: 3,
            setFlags: false,
          });
          rawLoad(2, resultOffset + 24);
          callHelper("array-fill");
          patchInstruction(empty, {
            op: "b.cond",
            condition: "le",
            displacement: (instructions.length - empty) * 4,
          });
        }
        function arrayAtomicWord64(op: {
          readonly operation: ArrayAtomicOperation;
          readonly array: number;
          readonly index: number;
          readonly scratch: number;
        }): void {
          const index = arrayIndex(op.array, op.index);
          emit({ op: "cbnz", width: 32, rt: 13, displacement: 8 });
          emit({ op: "brk", immediate: 3 });
          emit({
            op: "add-reg",
            width: 64,
            rd: 10,
            rn: 10,
            rm: index,
            shift: "lsl",
            amount: 3,
            setFlags: false,
          });
          rawValue(13, op.scratch);
          emit({
            op: "ldr",
            width: 64,
            rt: 13,
            rn: 13,
            offset: nativeArrayDataOffset,
          });
          rawStore(13, resultOffset + 16);
          if (op.operation !== "load") {
            emit({ op: "ldr", width: 64, rt: 14, rn: 13, offset: 0 });
            if (op.operation === "compare-exchange")
              emit({ op: "ldr", width: 64, rt: 15, rn: 13, offset: 8 });
          }
          if (op.operation === "add" && options.hostABI?.os === "darwin") {
            emit({ op: "ldaddal", width: 64, rs: 14, rt: 11, rn: 10 });
          } else {
            emit({ op: "dmb", domain: "ish" });
            if (op.operation === "load")
              emit({ op: "ldar", width: 64, rt: 11, rn: 10 });
            else if (op.operation === "store")
              emit({ op: "stlr", width: 64, rt: 14, rn: 10 });
            else {
              const exchange = op.operation === "compare-exchange";
              const loop = instructions.length;
              emit({ op: "ldaxr", width: 64, rt: 11, rn: 10 });
              let mismatch = -1;
              if (exchange) {
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
                mismatch = instructions.length;
                emit({ op: "b.cond", condition: "ne", displacement: 0 });
              } else if (op.operation === "add" || op.operation === "sub")
                emit({
                  op: op.operation === "add" ? "add-reg" : "sub-reg",
                  width: 64,
                  rd: 12,
                  rn: 11,
                  rm: 14,
                  shift: "lsl",
                  amount: 0,
                  setFlags: false,
                });
              else if (op.operation !== "exchange") {
                const combine: "and-reg" | "orr-reg" | "eor-reg" =
                  op.operation === "and"
                    ? "and-reg"
                    : op.operation === "or"
                      ? "orr-reg"
                      : "eor-reg";
                emit({ op: combine, width: 64, rd: 12, rn: 11, rm: 14 });
              }
              const written: number = exchange
                ? 15
                : op.operation === "exchange"
                  ? 14
                  : 12;
              emit({ op: "stlxr", width: 64, rs: 13, rt: written, rn: 10 });
              emit({
                op: "cbnz",
                width: 32,
                rt: 13,
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
            }
            emit({ op: "dmb", domain: "ish" });
          }
          if (op.operation !== "store") {
            rawLoad(13, resultOffset + 16);
            emit({ op: "str", width: 64, rt: 11, rn: 13, offset: 0 });
          }
        }
        function arrayView(op: {
          readonly id: number;
          readonly type: NativeTypedArray;
          readonly buffer: number;
          readonly byteOffset: number;
          readonly length: number;
        }): void {
          const shift = typedArrayScale(op.type);
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
              bound(op.byteOffset, allocationOffset + 8);
              bound(op.length, allocationOffset + 16);
              rawLoad(11, allocationOffset + 8);
              if (shift > 0) {
                // The offset is a multiple of the element width.
                emit({
                  op: "ubfm",
                  width: 64,
                  rd: 12,
                  rn: 11,
                  immr: 0,
                  imms: shift - 1,
                });
                emit({
                  op: "sub-imm",
                  width: 64,
                  rd: "zr",
                  rn: 12,
                  immediate: 0,
                  shift: 0,
                  setFlags: true,
                });
                trapIf({ op: "b.cond", condition: "ne" });
              }
              // The view's end lies within the buffer's bytes.
              rawLoad(12, allocationOffset + 16);
              emit({
                op: "add-reg",
                width: 64,
                rd: 9,
                rn: 11,
                rm: 12,
                shift: "lsl",
                amount: shift,
                setFlags: false,
              });
              rawValue(10, op.buffer);
              bufferByteLength(10, 14);
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
              trapIf({ op: "b.cond", condition: "hi" });
            },
            (rd) => imm(rd, nativeArrayViewByteLength),
          );
          // A slow allocation can move the buffer: reload it.
          rawValue(10, op.buffer);
          rawLoad(11, allocationOffset + 8);
          rawLoad(12, allocationOffset + 16);
          imm64(
            13,
            typedArrayMarker(op.type),
            2 * (nativeHeaderFlagUnit / 4294967296),
          );
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
            amount: 0,
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
        }
        function allocateIndexed(
          id: number,
          length: number,
          elementShift: number,
          marker: number,
          skipZero: boolean = false,
        ): void {
          const constLen = numberConstant(length);
          if (
            constLen !== undefined &&
            Number.isInteger(constLen) &&
            constLen >= 0 &&
            constLen <= 0xffffffff &&
            !(constLen === 0 && 1 / constLen < 0)
          ) {
            const rawExtent =
              nativeArrayInlineOffset + 7 + constLen * (1 << elementShift);
            if (rawExtent <= 0xffffffff) {
              const byteLen = Math.floor(rawExtent / 8) * 8;
              allocate(
                () => {},
                (rd) => imm(rd, byteLen),
                false,
                byteLen,
              );
              const payloadBytes = byteLen - nativeArrayInlineOffset;
              if (payloadBytes <= 64) {
                imm(12, marker);
                if (constLen === 0)
                  emit({
                    op: "stp",
                    width: 64,
                    rt: 12,
                    rt2: "zr",
                    rn: 9,
                    offset: 0,
                    mode: "offset",
                  });
                else {
                  imm(10, constLen);
                  emit({
                    op: "stp",
                    width: 64,
                    rt: 12,
                    rt2: 10,
                    rn: 9,
                    offset: 0,
                    mode: "offset",
                  });
                }
                if (marker === 6) {
                  emit({
                    op: "str",
                    width: 64,
                    rt: "zr",
                    rn: 9,
                    offset: nativeArrayDataOffset,
                  });
                } else {
                  emit({
                    op: "add-imm",
                    width: 64,
                    rd: 15,
                    rn: 9,
                    immediate: nativeArrayInlineOffset,
                    shift: 0,
                    setFlags: false,
                  });
                  emit({
                    op: "str",
                    width: 64,
                    rt: 15,
                    rn: 9,
                    offset: nativeArrayDataOffset,
                  });
                }
                if (!skipZero) {
                  let off: number = nativeArrayInlineOffset;
                  while (off + 16 <= byteLen) {
                    emit({
                      op: "stp",
                      width: 64,
                      rt: "zr",
                      rt2: "zr",
                      rn: 9,
                      offset: off,
                      mode: "offset",
                    });
                    off += 16;
                  }
                  if (off < byteLen)
                    emit({
                      op: "str",
                      width: 64,
                      rt: "zr",
                      rn: 9,
                      offset: off,
                    });
                }
                saveRaw(9, id);
                if (marker !== 6) {
                  cachedArrayDataVal = id;
                  cachedArrayDataReg = -1;
                }
                return;
              }
              imm(10, constLen);
              imm(11, byteLen);
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
              return;
            }
          }
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
          provenPresence.clear();
          layoutPairs.clear();
          cachedJoinGuards = limited<Uint8Array>(
            "join-record-guards",
            fn,
            dataflowRecordGuards(
              fn,
              work(2000000),
              stableGuards,
              undefined,
              provenPresence,
              layoutPairs,
            ),
          );
          // An exhausted analysis proves nothing.
          if (cachedJoinGuards === undefined) {
            provenPresence.clear();
            layoutPairs.clear();
          }
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
        const provenNonNull = limited<Uint8Array>(
          "proven-non-null",
          fn,
          provenNonNullValues(
            fn,
            (id) => valueIds.intern(id),
            values.length,
            work(2000000),
          ),
        );
        const skippedCasts = new Uint8Array(values.length);
        if (provenNonNull !== undefined)
          for (const block of fn.blocks) {
            if (block === undefined) throw "skipped cast block invariant";
            for (const op of block.instructions) {
              if (op === undefined) throw "skipped cast instruction invariant";
              if (
                (op.kind === "string-wrap" ||
                  op.kind === "string-value" ||
                  op.kind === "reference-wrap" ||
                  op.kind === "reference-value" ||
                  op.kind === "primitive-wrap" ||
                  op.kind === "primitive-reference") &&
                (valueUses[valueIds.intern(op.id)] ?? 0) === 0 &&
                provenNonNull[valueIds.intern(op.value)] === 1
              )
                skippedCasts[valueIds.intern(op.id)] = 1;
            }
          }
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
                  const written = preSafepointResults(
                    current,
                    noSafepoints,
                  ).filter((id) => skippedCasts[valueIds.intern(id)] !== 1);
                  for (const word of poolWords(written)) {
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
        const selects = findSelectDiamonds(
          fn,
          integerSlots,
          dispatch?.fused,
          (block) =>
            (deadClears?.[block]?.length ?? 0) === 0 &&
            (deadSlots?.[block]?.length ?? 0) === 0 &&
            (poolClears?.[block]?.length ?? 0) === 0 &&
            (preciseRoots ||
              poolClears !== undefined ||
              ((incomingReferences[block] ?? 0) === 0 &&
                (incomingGenerals[block] ?? 0) === 0)),
        );
        for (const [head, diamond] of selects.diamonds) {
          if (head < 0) continue;
          forwardable.delete(diamond.join);
        }
        // Operation ranges (analysis tooling): each IR operation owns the
        // words emitted from its start to the next operation, terminator or
        // block boundary. Representations are read after emission, once
        // integer/word storage and register homes are settled.
        let openOperation: IRInstruction | IRTerminator | undefined,
          openBlock = 0,
          openIndex = 0,
          openOffset = 0;
        function operandCode(id: number): string {
          // A constant still deferred was only ever read as an immediate.
          if (deferredIntegers.has(id)) return "imm";
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
        // Cached property misses use `fusedAccesses` computed before block ordering.
        const knownObjects = knownObjectFacts(fn, fusedAccesses);
        const knownObjectTag = knownObjects?.tagKnown;
        const knownBoolTrue = knownObjects?.boolKnownTrue;
        const knownBoolFalse = knownObjects?.boolKnownFalse;
        const knownTrueBool = new Set<number>();
        const knownFalseBool = new Set<number>();
        const scriptEntryCallees = scriptEntryCalleeValues(fn);
        const generalEqualTags = hasScriptOps
          ? knownGeneralEqualTags(
              fn,
              (id: number): ScalarType => value(id).type,
            )
          : undefined;
        // For pure-leaf outlined numeric loop kernels (`__tint_spec_loop_*`),
        // hoist up to two immutable Float64Array parameter data pointers into
        // scratch registers x14 and x15 once at function entry so inner
        // array-element/array-store operations index directly without reloading
        // `[array, #nativeArrayDataOffset]` on every access.
        const hoistedArrayDataValues = new Map<number, number>();
        if (
          fn.environment === undefined &&
          fn.name.includes("__tint_spec_loop_") &&
          fn.blocks[0]?.id === fn.entry
        ) {
          let pureLeaf = true;
          const storedSlots = new Uint8Array(fn.slots.length);
          for (const block of fn.blocks) {
            if (block === undefined) {
              pureLeaf = false;
              break;
            }
            const t = block.terminator;
            if (
              t.kind !== "jump" &&
              t.kind !== "branch" &&
              t.kind !== "return"
            ) {
              pureLeaf = false;
              break;
            }
            if (block.exception !== undefined) {
              pureLeaf = false;
              break;
            }
            for (const op of block.instructions) {
              if (op === undefined) {
                pureLeaf = false;
                break;
              }
              if (op.kind === "store") {
                storedSlots[op.slot] = 1;
              } else if (
                op.kind === "binary" &&
                (op.operator === "%" || op.operator === "**")
              ) {
                pureLeaf = false;
                break;
              } else if (
                op.kind !== "load" &&
                op.kind !== "constant" &&
                op.kind !== "unary" &&
                op.kind !== "binary" &&
                op.kind !== "array-element" &&
                op.kind !== "array-store" &&
                op.kind !== "array-length" &&
                op.kind !== "array-valid"
              ) {
                pureLeaf = false;
                break;
              }
            }
            if (!pureLeaf) break;
          }
          if (pureLeaf) {
            // Rank immutable Float64Array parameters by loop-weighted
            // array-element/store frequency so the two hottest inner-loop
            // arrays (e.g. `x` and `x0` in lin_solve, `d0` and `u` in advect)
            // get hoisted into x14 and x15 rather than epilogue out-buffers.
            const loadSlot = new Map<number, number>();
            const slotUseCount = new Map<number, number>();
            const loopForest = naturalLoops(fn, work(100000));
            const blockDepth = new Uint8Array(fn.blocks.length);
            if (loopForest !== undefined) {
              for (const loop of loopForest.loops) {
                if (loop === undefined) continue;
                for (const id of loop.body) {
                  if (id !== undefined && id < blockDepth.length)
                    blockDepth[id] = Math.min(4, (blockDepth[id] ?? 0) + 1);
                }
              }
            }
            for (const block of fn.blocks) {
              if (block === undefined) continue;
              const weight = 1 << ((blockDepth[block.id] ?? 0) * 3);
              for (const op of block.instructions) {
                if (op === undefined) continue;
                if (op.kind === "load") {
                  if (
                    fn.slots[op.slot] === "Float64Array" &&
                    storedSlots[op.slot] === 0
                  )
                    loadSlot.set(op.id, op.slot);
                } else if (
                  op.kind === "array-element" ||
                  op.kind === "array-store"
                ) {
                  const s = loadSlot.get(op.array);
                  if (s !== undefined)
                    slotUseCount.set(s, (slotUseCount.get(s) ?? 0) + weight);
                }
              }
            }
            let firstParam = -1,
              firstCount = 0,
              secondParam = -1,
              secondCount = 0;
            for (const param of fn.parameters) {
              if (
                param !== undefined &&
                fn.slots[param] === "Float64Array" &&
                storedSlots[param] === 0
              ) {
                const count = slotUseCount.get(param) ?? 0;
                if (count > firstCount) {
                  secondParam = firstParam;
                  secondCount = firstCount;
                  firstParam = param;
                  firstCount = count;
                } else if (count > secondCount) {
                  secondParam = param;
                  secondCount = count;
                }
              }
            }
            const hoistedSlots = new Map<number, number>();
            const top: number[] = [];
            if (firstParam >= 0) top.push(firstParam);
            if (secondParam >= 0) top.push(secondParam);
            const regs = [14, 15];
            for (let i = 0; i < top.length && i < regs.length; i++) {
              const param = top[i];
              const reg = regs[i];
              if (param === undefined || reg === undefined) continue;
              const offset = slotOffsets[param];
              if (offset !== undefined) {
                rawLoad(reg, offset);
                emit({
                  op: "ldr",
                  width: 64,
                  rt: reg,
                  rn: reg,
                  offset: nativeArrayDataOffset,
                });
                hoistedSlots.set(param, reg);
              }
            }
            if (hoistedSlots.size > 0) {
              for (const [id, s] of loadSlot) {
                const reg = hoistedSlots.get(s);
                if (reg !== undefined) hoistedArrayDataValues.set(id, reg);
              }
            }
          }
        }
        /** Multi-instruction `imul` constants hoisted into x4..x8 across a
         * pure safepoint-free innermost loop. */
        const hoistedImulConst = new Map<number, number>();
        const loopPreheaderHoists = new Map<number, PreheaderHoistPlan>();
        if (
          !hasScriptOps &&
          fn.scriptEntry !== true &&
          !(debugSpans && fn.debug !== undefined)
        ) {
          const loopForest = naturalLoops(fn, work(100000));
          if (loopForest !== undefined && loopForest.loops.length > 0) {
            const loops = loopForest.loops;
            // Collect every GP/FP home assigned anywhere in the function
            // (including pointer transients in x4..x8 live across loops).
            const funcUsedGP = new Set<number>();
            const funcUsedFP = new Set<number>();
            const sRegs = scalarRegisters;
            if (sRegs !== undefined) {
              for (let ri = 0; ri < sRegs.length; ri++) {
                const reg = sRegs[ri] ?? 0;
                if (reg >= 32) funcUsedGP.add(reg - 32);
                else if (reg > 0) funcUsedFP.add(reg);
              }
            }
            const tRegs = transientRegisters;
            if (tRegs !== undefined) {
              for (let ri = 0; ri < tRegs.length; ri++) {
                const reg = tRegs[ri] ?? 0;
                if (reg >= 32) funcUsedGP.add(reg - 32);
                else if (reg > 0) funcUsedFP.add(reg);
              }
            }
            // Build predecessor map for unique-preheader detection.
            const preds: number[][] = [];
            for (let i = 0; i < fn.blocks.length; i++) preds.push([]);
            for (const block of fn.blocks) {
              if (block === undefined) continue;
              for (const succ of blockSuccessors(block))
                preds[succ]?.push(block.id);
            }
            const pureWordInline = (
              id: number,
              intSlotLoads: ReadonlySet<number>,
            ): boolean => {
              if (jsConvert || storedAsWord(id) || intSlotLoads.has(id))
                return true;
              const idx = valueIds.intern(id),
                kind = wordKinds[idx] ?? 0;
              return (
                nanSentinelWords[idx] === 1 ||
                kind === 1 ||
                kind === 2 ||
                kind === 3 ||
                kind === 5 ||
                kind === 6 ||
                kind === 7
              );
            };
            for (let li = 0; li < loops.length; li++) {
              const loop = loops[li];
              if (loop === undefined) continue;
              if (loop.header === fn.entry) continue;
              // Innermost loops only so hoisted scratch registers never nest.
              let hasInner = false;
              for (let lj = 0; lj < loops.length; lj++) {
                if (lj === li) continue;
                const other = loops[lj];
                if (
                  other !== undefined &&
                  other.header !== loop.header &&
                  loop.body.has(other.header)
                ) {
                  hasInner = true;
                  break;
                }
              }
              if (hasInner) continue;
              // Unique jump-only preheader outside the loop.
              const headerPreds = preds[loop.header] ?? [];
              let preId = -1,
                preCount = 0;
              for (const p of headerPreds) {
                if (p !== undefined && !loop.body.has(p)) {
                  preId = p;
                  preCount++;
                }
              }
              if (preCount !== 1 || preId < 0) continue;
              const preBlock = fn.blocks[preId];
              if (
                preBlock === undefined ||
                preBlock.exception !== undefined ||
                dispatch?.fused[preId] === 1 ||
                selects.fused[preId] === 1 ||
                loopPreheaderHoists.has(preId)
              )
                continue;
              const preTerm = preBlock.terminator;
              if (preTerm.kind !== "jump" || preTerm.target !== loop.header)
                continue;
              // Verify the loop body is strictly safepoint-free and helper-free
              // (preserving x4..x8 and d3..d7 across every instruction).
              let pureLoop = true;
              const writtenSlots = new Set<number>();
              const usedGP = new Set<number>();
              const loopLoadSlot = new Map<number, number>();
              const intSlotLoads = new Set<number>();
              const arraySlotUses = new Map<number, number>();
              const imulOps: { readonly opId: number; readonly u32: number }[] =
                [];
              const floatCandOps: {
                readonly opId: number;
                readonly value: number;
                readonly blockId: number;
              }[] = [];
              for (const bid of loop.body) {
                const blk = fn.blocks[bid];
                if (
                  blk === undefined ||
                  blk.exception !== undefined ||
                  pollHeaders.has(bid) ||
                  dispatch?.fused[bid] === 1 ||
                  selects.fused[bid] === 1 ||
                  (blk.terminator.kind !== "jump" &&
                    blk.terminator.kind !== "branch")
                ) {
                  pureLoop = false;
                  break;
                }
                for (const op of blk.instructions) {
                  if (op === undefined || mayCollect(op)) {
                    pureLoop = false;
                    break;
                  }
                  const res = instructionResult(op);
                  if (res !== undefined && transientRegisters !== undefined) {
                    const tr = transientRegisters[valueIds.intern(res)] ?? 0;
                    if (tr >= 32) usedGP.add(tr - 32);
                  }
                  if (op.kind === "store") {
                    writtenSlots.add(op.slot);
                  } else if (op.kind === "load") {
                    if (integerSlots[op.slot] === 1) intSlotLoads.add(op.id);
                    const slotType = fn.slots[op.slot];
                    if (
                      slotType !== undefined &&
                      isNativeTypedArray(slotType) &&
                      !hoistedArrayDataValues.has(op.id)
                    )
                      loopLoadSlot.set(op.id, op.slot);
                  } else if (op.kind === "constant") {
                    const cVal = op.value;
                    if (
                      typeof cVal === "number" &&
                      Number.isFinite(cVal) &&
                      cVal !== 0 &&
                      !wantsInteger(op.id) &&
                      foldedConstants[valueIds.intern(op.id)] !== 1
                    )
                      floatCandOps.push({
                        opId: op.id,
                        value: cVal,
                        blockId: bid,
                      });
                  } else if (
                    op.kind === "array-element" ||
                    op.kind === "array-word64-element" ||
                    op.kind === "array-word64-store" ||
                    op.kind === "bytes-load" ||
                    op.kind === "bytes-word64-load" ||
                    op.kind === "bytes-word64-store"
                  ) {
                    const s = loopLoadSlot.get(op.array);
                    if (s !== undefined)
                      arraySlotUses.set(s, (arraySlotUses.get(s) ?? 0) + 1);
                  } else if (
                    op.kind === "word64-constant" ||
                    op.kind === "word64-from-number" ||
                    op.kind === "word64-to-number" ||
                    op.kind === "word64-binary" ||
                    op.kind === "word64-unary" ||
                    op.kind === "word64-part" ||
                    op.kind === "word64-from-parts"
                  ) {
                    // Pure inline word64 operations; preserve x4..x8 and d3..d7.
                  } else if (op.kind === "bytes-store") {
                    const isFloat =
                      op.element === "f16" ||
                      op.element === "f32" ||
                      op.element === "f64";
                    if (!isFloat && !pureWordInline(op.value, intSlotLoads)) {
                      pureLoop = false;
                      break;
                    }
                    const s = loopLoadSlot.get(op.array);
                    if (s !== undefined)
                      arraySlotUses.set(s, (arraySlotUses.get(s) ?? 0) + 1);
                  } else if (op.kind === "array-store") {
                    const arrType = value(op.array).type,
                      elem = typedArrayLayout(typedArrayType(arrType)).element,
                      sv = elidedStoreSource.get(op.value) ?? op.value;
                    if (
                      elem !== "float" &&
                      elem !== "clamped" &&
                      !pureWordInline(sv, intSlotLoads)
                    ) {
                      pureLoop = false;
                      break;
                    }
                    const s = loopLoadSlot.get(op.array);
                    if (s !== undefined)
                      arraySlotUses.set(s, (arraySlotUses.get(s) ?? 0) + 1);
                  } else if (
                    op.kind === "array-length" ||
                    op.kind === "array-valid" ||
                    op.kind === "optional-value" ||
                    op.kind === "reference-value" ||
                    op.kind === "record-read"
                  ) {
                    // Pure inline instructions; preserve x4..x8 and d3..d7.
                  } else if (op.kind === "unary") {
                    if (
                      op.operator === "~"
                        ? !pureWordInline(op.operand, intSlotLoads)
                        : op.operator !== "-" &&
                          op.operator !== "+" &&
                          op.operator !== "!" &&
                          op.operator !== "truthy" &&
                          op.operator !== "ceil" &&
                          op.operator !== "trunc" &&
                          op.operator !== "sqrt" &&
                          op.operator !== "fround" &&
                          op.operator !== "f16round" &&
                          op.operator !== "uint32" &&
                          op.operator !== "boolean-number" &&
                          op.operator !== "is-integer"
                    ) {
                      pureLoop = false;
                      break;
                    }
                  } else if (op.kind === "binary") {
                    const lt = value(op.left).type,
                      rt = value(op.right).type;
                    if (
                      (lt !== "number" && lt !== "boolean") ||
                      (rt !== "number" && rt !== "boolean")
                    ) {
                      pureLoop = false;
                      break;
                    }
                    if (
                      op.operator === "imul" ||
                      op.operator === "&" ||
                      op.operator === "|" ||
                      op.operator === "^" ||
                      op.operator === "<<" ||
                      op.operator === ">>" ||
                      op.operator === ">>>"
                    ) {
                      const rf =
                          foldedConstants[valueIds.intern(op.right)] === 1,
                        lf = foldedConstants[valueIds.intern(op.left)] === 1;
                      if (
                        (!lf && !pureWordInline(op.left, intSlotLoads)) ||
                        (!rf && !pureWordInline(op.right, intSlotLoads))
                      ) {
                        pureLoop = false;
                        break;
                      }
                      if (op.operator === "imul" && (rf || lf)) {
                        const cv = numberConstant(rf ? op.right : op.left);
                        if (cv !== undefined) {
                          const u32 = cv >>> 0;
                          if (u32 > 0xffff) imulOps.push({ opId: op.id, u32 });
                        }
                      }
                    } else if (
                      op.operator !== "+" &&
                      op.operator !== "-" &&
                      op.operator !== "*" &&
                      op.operator !== "/" &&
                      op.operator !== "min" &&
                      op.operator !== "max" &&
                      op.operator !== "<" &&
                      op.operator !== "<=" &&
                      op.operator !== ">" &&
                      op.operator !== ">=" &&
                      op.operator !== "===" &&
                      op.operator !== "!=="
                    ) {
                      pureLoop = false;
                      break;
                    }
                  } else {
                    pureLoop = false;
                    break;
                  }
                }
                if (!pureLoop) break;
              }
              if (!pureLoop) continue;
              // Allocate free GP scratch registers from x4..x8 (never clobbered
              // by pure numeric/array instructions, never assigned as any
              // function-wide transient/slot home, and not a GC root).
              const freeGP: number[] = [];
              const gpCandidates = [4, 5, 6, 7, 8];
              for (let gi = 0; gi < gpCandidates.length; gi++) {
                const r = gpCandidates[gi];
                if (r !== undefined && !usedGP.has(r) && !funcUsedGP.has(r))
                  freeGP.push(r);
              }
              const arraySlots: HoistedArraySlot[] = [];
              const imulConsts: HoistedImulConst[] = [];
              const floatConsts: HoistedFloatConst[] = [];
              // Exclude any loop-defined array load used outside the loop body
              // (so a later loop cannot clobber its hoisted data pointer).
              if (loopLoadSlot.size > 0) {
                for (let bi = 0; bi < fn.blocks.length; bi++) {
                  const blk = fn.blocks[bi];
                  if (blk === undefined || loop.body.has(blk.id)) continue;
                  visitTerminatorOperands(blk.terminator, (id) => {
                    loopLoadSlot.delete(id);
                  });
                  for (const op of blk.instructions) {
                    if (op === undefined) continue;
                    visitInstructionOperands(op, (id) => {
                      loopLoadSlot.delete(id);
                    });
                  }
                }
              }
              // Rank loop-invariant TypedArray slots by use count (selection
              // picks up to freeGP.length highest-use slots without sorting).
              const assignedArraySlots = new Map<number, number>();
              let gpCursor = 0;
              while (gpCursor < freeGP.length) {
                let bestSlot = -1,
                  bestCount = 0;
                for (const [slot, count] of arraySlotUses) {
                  if (
                    !writtenSlots.has(slot) &&
                    !assignedArraySlots.has(slot) &&
                    count > bestCount
                  ) {
                    bestSlot = slot;
                    bestCount = count;
                  }
                }
                if (bestSlot < 0) break;
                const reg = freeGP[gpCursor++];
                if (reg === undefined) break;
                arraySlots.push({ slot: bestSlot, reg });
                assignedArraySlots.set(bestSlot, reg);
              }
              if (assignedArraySlots.size > 0) {
                for (const [loadId, slot] of loopLoadSlot) {
                  const reg = assignedArraySlots.get(slot);
                  if (reg !== undefined)
                    hoistedArrayDataValues.set(loadId, reg);
                }
              }
              // Hoist distinct multi-instruction `imul` constants into remaining GP regs.
              if (imulOps.length > 0 && gpCursor < freeGP.length) {
                const imulRegByConst = new Map<number, number>();
                for (let ii = 0; ii < imulOps.length; ii++) {
                  const item = imulOps[ii];
                  if (item === undefined) continue;
                  let reg = imulRegByConst.get(item.u32);
                  if (reg === undefined && gpCursor < freeGP.length) {
                    const nextReg = freeGP[gpCursor++];
                    if (nextReg !== undefined) {
                      reg = nextReg;
                      imulRegByConst.set(item.u32, reg);
                      imulConsts.push({ u32: item.u32, reg });
                    }
                  }
                  if (reg !== undefined) hoistedImulConst.set(item.opId, reg);
                }
              }
              // Hoist pure FP constants into d3..d7 (never touched by pure ops).
              if (floatCandOps.length > 0) {
                const candIds = new Set<number>();
                for (let ci = 0; ci < floatCandOps.length; ci++) {
                  const c = floatCandOps[ci];
                  if (c !== undefined) candIds.add(c.opId);
                }
                const invalidFloatCands = new Set<number>();
                const usedFloatCands = new Set<number>();
                for (let bi = 0; bi < fn.blocks.length; bi++) {
                  const blk = fn.blocks[bi];
                  if (blk === undefined) continue;
                  if (!loop.body.has(blk.id)) {
                    visitTerminatorOperands(blk.terminator, (id) => {
                      if (candIds.has(id)) invalidFloatCands.add(id);
                    });
                    for (const op of blk.instructions) {
                      if (op === undefined) continue;
                      visitInstructionOperands(op, (id) => {
                        if (candIds.has(id)) invalidFloatCands.add(id);
                      });
                    }
                    continue;
                  }
                  visitTerminatorOperands(blk.terminator, (id) => {
                    if (candIds.has(id)) invalidFloatCands.add(id);
                  });
                  for (const op of blk.instructions) {
                    if (op === undefined) continue;
                    const pureFloatConsumer =
                      (op.kind === "binary" &&
                        (op.operator === "+" ||
                          op.operator === "-" ||
                          op.operator === "*" ||
                          op.operator === "/" ||
                          op.operator === "min" ||
                          op.operator === "max") &&
                        !wantsInteger(op.id)) ||
                      (op.kind === "unary" &&
                        (op.operator === "-" ||
                          op.operator === "sqrt" ||
                          op.operator === "fround" ||
                          op.operator === "f16round" ||
                          op.operator === "ceil" ||
                          op.operator === "trunc") &&
                        !wantsInteger(op.id));
                    const pureFloatStore =
                      op.kind === "array-store" &&
                      typedArrayLayout(typedArrayType(value(op.array).type))
                        .element === "float";
                    const storeValId =
                      pureFloatStore && op.kind === "array-store"
                        ? op.value
                        : -1;
                    const storeIdxId =
                      pureFloatStore && op.kind === "array-store"
                        ? op.index
                        : -1;
                    const storeArrId =
                      pureFloatStore && op.kind === "array-store"
                        ? op.array
                        : -1;
                    visitInstructionOperands(op, (id) => {
                      if (!candIds.has(id)) return;
                      if (
                        pureFloatConsumer ||
                        (pureFloatStore &&
                          storeValId === id &&
                          storeIdxId !== id &&
                          storeArrId !== id)
                      )
                        usedFloatCands.add(id);
                      else invalidFloatCands.add(id);
                    });
                  }
                }
                const freeFP: number[] = [];
                const fpCandidates = [3, 4, 5, 6, 7];
                for (let fi = 0; fi < fpCandidates.length; fi++) {
                  const r = fpCandidates[fi];
                  if (r !== undefined && !funcUsedFP.has(r)) freeFP.push(r);
                }
                let fpCursor = 0;
                const fpRegByBits = new Map<string, number>();
                for (let ci = 0; ci < floatCandOps.length; ci++) {
                  const c = floatCandOps[ci];
                  if (
                    c === undefined ||
                    invalidFloatCands.has(c.opId) ||
                    !usedFloatCands.has(c.opId)
                  )
                    continue;
                  const bits = encodeFloat64(c.value);
                  const key = String(bits.lo) + ":" + String(bits.hi);
                  let reg = fpRegByBits.get(key);
                  if (reg === undefined && fpCursor < freeFP.length) {
                    const nextReg = freeFP[fpCursor++];
                    if (nextReg !== undefined) {
                      reg = nextReg;
                      fpRegByBits.set(key, reg);
                      floatConsts.push({ value: c.value, reg });
                    }
                  }
                  if (reg !== undefined) hoistedFloatConst.set(c.opId, reg);
                }
              }
              if (
                arraySlots.length > 0 ||
                imulConsts.length > 0 ||
                floatConsts.length > 0
              )
                loopPreheaderHoists.set(preId, {
                  arraySlots,
                  imulConsts,
                  floatConsts,
                });
            }
          }
        }
        /** The token of Uint8Array value `id` (fresh when unknown). */
        function viewValueToken(id: number): number {
          const known = viewValueTokens.get(id);
          if (known !== undefined) return known;
          const token = nextViewToken++;
          viewValueTokens.set(id, token);
          return token;
        }
        let cachedObjectOpsCtx: ObjectOpsEmitContext | undefined = undefined;
        function objectOpsCtx(): ObjectOpsEmitContext {
          if (cachedObjectOpsCtx !== undefined) return cachedObjectOpsCtx;
          const created: ObjectOpsEmitContext = {
            module,
            fn,
            instructions,
            valueIds,
            stackWords,
            coldStubs,
            deferredIntegers,
            hoistedFloatConst,
            offsets,
            forwardable,
            scalarRegisters,
            tracker,
            contextOffset,
            floatSaveBytes,
            generationalBarriers,
            jsConvert,
            emittedDirectStore,
            foldedConstants,
            integerSlots,
            knownObjectTag,
            skippedCasts,
            undefinedValues,
            valueUses,
            zeroRefValues,
            zeroValues,
            deferRememberSlow,
            value,
            absentNumber,
            allocate,
            branch,
            coldStubsAvailable,
            descriptorPointer,
            emit,
            exactInteger,
            farBranch,
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
          };
          cachedObjectOpsCtx = created;
          return created;
        }
        let cachedArrayOpsCtx: ArrayOpsEmitContext | undefined = undefined;
        function arrayOpsCtx(): ArrayOpsEmitContext {
          if (cachedArrayOpsCtx !== undefined) return cachedArrayOpsCtx;
          const created: ArrayOpsEmitContext = {
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
            getCachedArrayDataReg: () => cachedArrayDataReg,
            getCachedArrayDataVal: () => cachedArrayDataVal,
            setCachedArrayData: (reg, val) => {
              cachedArrayDataReg = reg;
              cachedArrayDataVal = val;
            },
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
          };
          cachedArrayOpsCtx = created;
          return created;
        }
        emitFunctionBlocks({
          absentFlags,
          absentNumber,
          accountedLabels,
          activationOffset,
          address,
          allocate,
          allocateIndexed,
          allocationOffset,
          allocationScratchBytes,
          allowColdStubs,
          arrayAtomic,
          arrayAtomicWord64,
          arrayIndex,
          arrayOf,
          arrayOpsCtx,
          arrayView,
          arrayWord64Fill,
          arrayWord64Read,
          arrayWord64Write,
          beginOperation,
          beginTerminator,
          binaryImmediate,
          branchIsland,
          bufferByteLength,
          bytesCtx,
          word64Ctx,
          cInteropCtx,
          callHelper,
          callRelative,
          callSites,
          canDeferColdStub,
          cellFixups,
          cellRequests,
          clearWordCaches,
          coldListReads,
          coldReciprocals,
          comparisonOperators,
          contextOffset,
          copyFloatWord,
          copyGeneralPair,
          copyRawWord,
          deadClears,
          deadSlots,
          deferRememberSlow,
          deferredAllocSlowPaths,
          deferredIntegers,
          descriptorPointer,
          directFloatAlias,
          directFloatTarget,
          directIntAlias,
          directIntTarget,
          directReturns,
          discardResultTargets,
          dispatch,
          dispatchDescriptor,
          edgeBranches,
          edgeNurseryBase,
          edgeWords,
          elementToDouble,
          elidedStoreSource,
          emit,
          emittedDirectStore,
          endOperation,
          entryImports,
          environmentOffset,
          epilogue,
          errorDescriptorCount,
          exactInteger,
          exceptionalBranch,
          fail,
          floatLoad,
          floatOperand,
          floatStore,
          floatTarget,
          flowGuards,
          fn,
          foldedConstants,
          foldedOptionalWraps,
          foldedStringWraps,
          forms,
          forwardable,
          functionEntryPointer,
          functionRecord,
          functionSignaturePointer,
          fusedAccesses,
          fusedBitTests,
          fusedDefaults,
          fusedShifts,
          generalEqualTags,
          generalPair,
          generationalBarriers,
          guardDescriptor,
          hasFunctions,
          hasScriptOps,
          hoistedArrayDataValues,
          hoistedFloatConst,
          hoistedImulConst,
          hostCallCtx,
          imm,
          imm64,
          incomingGenerals,
          incomingReferences,
          instructions,
          intOperand,
          intRegister,
          intTarget,
          integerArithmetic,
          integerSlots,
          integerUses,
          interruptible,
          inverseCondition,
          joinLabelRun,
          joins,
          jsConvert,
          knownBoolFalse,
          knownBoolTrue,
          knownFalseBool,
          knownTrueBool,
          labelRun,
          getLabelRunAt: () => labelRunAt,
          getLabelRunFused: () => labelRunFused,
          latin1Count,
          latin1Index,
          latin1Range,
          layoutPairs,
          lazyActivation,
          leafBase,
          leafReferences,
          lengthOnlySlices,
          linearAllocation,
          linkLazyActivation,
          listReadShapes,
          literalTwo,
          localPointer,
          localSignatures,
          loopPreheaderHoists,
          low32Tree,
          lowWordStoreValues,
          managedPointer,
          materializeInteger,
          module,
          multiplierShift,
          nanSentinelMagnitudes,
          nanSentinelNonNegative,
          nanSentinelRemainders,
          nanSentinelSafe,
          nanSentinelWords,
          nonNegative,
          nonNullValues,
          nonReferenceTag,
          noneValues,
          nonzeroSlots,
          nonzeroValues,
          numberConstant,
          objectOpsCtx,
          offsets,
          options,
          parameterKeys,
          patchInstruction,
          patchLocalBranches,
          pendingFusedAdd,
          pollEntry,
          pollHeaders,
          pollWorkerStop,
          poolClears,
          poolWordOffset,
          preciseRoots,
          provenListHeader,
          provenNonNull,
          provenPresence,
          pureLeafNoActivation,
          quietNumber,
          quietValue,
          quietValues,
          rawLoad,
          rawRegister,
          rawStore,
          rawTarget,
          rawValue,
          reciprocalDivisorOffsets,
          reciprocalStoreOffsets,
          recordEdge,
          recordGuards,
          recordOperations,
          rememberObject,
          resultOffset,
          resultPointerOffset,
          rootClearBlocks,
          rotateAmounts,
          rotateSources,
          rotatedShifts,
          safeSlotBounds,
          safepoint,
          saveRaw,
          scalarLoadedSlot,
          scalarRegisters,
          scriptActualPair,
          scriptArgumentsOffset,
          scriptCountOffset,
          scriptEntryCallees,
          seededEntries,
          selects,
          sharing,
          shiftedOps,
          signatureImports,
          signatures,
          siteGeneralArguments,
          skippedCasts,
          slotIntegerFacts,
          slotOffsets,
          slotWordBlocks,
          slotWordOffsets,
          slotWordValues,
          soleConsumers,
          soleSum,
          stableLayouts,
          stableSlots,
          stackWords,
          start,
          storeBypassCandidate,
          stringEqual,
          stringFixups,
          stringLiterals,
          stringOpsCtx,
          teardown,
          temporaryGenerals,
          temporaryRoots,
          throwTraces,
          traceThrow,
          tracker,
          transientRegisters,
          trapIf,
          trapIsland,
          truncatableAddend,
          truncatedSums,
          truth,
          typeErrorRecord,
          typedArrayType,
          undefinedValues,
          unsignedTruncateCandidate,
          useCounts,
          valueIds,
          valueUses,
          vectorShapes,
          viewAccesses,
          viewEntries,
          viewExitSlots,
          viewExitTokens,
          viewSlots,
          viewValueToken,
          viewValueTokens,
          weakHeader,
          wordConstants,
          wordKinds,
          wordMagnitude,
          wordMagnitudes,
          wordMultiplierShift,
          wordOnlySlots,
          wordOperand,
          wordReturns,
          wordValue,
          workerStopPoll,
          wrappedStringSources,
          wrappedStrings,
          writeInteger,
          writeShapes,
          zeroConstants,
          zeroSignResults,
          zeroValues,
          zeroWords,
          layout,
          values,
          integerStorage,
          wordStorage,
          vectorHeader,
          branch,
          setBlockId: (id) => {
            blockId = id;
          },
          setCachedNurseryBaseInX16: (v) => {
            cachedNurseryBaseInX16 = v;
          },
          setBatch: (kind, total) => {
            currentBatchKind = kind;
            currentBatchTotal = total;
          },
          setFrameStart: (v) => {
            frameStart = v;
          },
          setSiteIndex: (v) => {
            siteIndex = v;
          },
          setSpan: (s) => {
            span = s;
          },
          setTailExitBlock: (v) => {
            tailExitBlock = v;
          },
        });
        for (const emitSlow of deferredAllocSlowPaths)
          if (emitSlow !== undefined) emitSlow();
        if (coldReciprocals.length > 0) {
          stackWords.clear();
          emitColdReciprocalStubs(
            emit,
            patchInstruction,
            instructions,
            coldReciprocals,
          );
        }
        if (coldNaNs.length > 0) {
          stackWords.clear();
          emitColdNaNStubs(emit, patchInstruction, instructions, coldNaNs);
        }
        if (coldListReads.length > 0) {
          stackWords.clear();
          emitColdListReadStubs(
            emit,
            patchInstruction,
            branch,
            (coldBlock, coldIndex) => {
              blockId = coldBlock;
              siteIndex = coldIndex;
            },
            safepoint,
            exceptionalBranch,
            instructions,
            contextOffset,
            coldListReads,
          );
        }
        if (coldSlices.length > 0) {
          emitColdSliceStubs(
            emit,
            patchInstruction,
            rawLoad,
            rawStore,
            rawValue,
            imm,
            prepareStringSize,
            (prepare, size) => allocate(prepare, size),
            callHelper,
            (coldBlock, coldIndex) => {
              blockId = coldBlock;
              siteIndex = coldIndex;
            },
            () => stackWords.clear(),
            instructions,
            contextOffset,
            allocationOffset,
            coldSlices,
          );
        }
        for (const block of fn.blocks) {
          if (block === undefined) throw "exception block invariant";
          const handler = block.exception;
          if (handler === undefined) continue;
          clearWordCaches();
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
          if (interruptible) {
            // Interruptions bypass handlers in worker-owned application code.
            // Trusted runtime frames retain their cleanup on the ordinary edge.
            const ordinary = instructions.length;
            emit({ op: "cbnz", width: 64, rt: 9, displacement: 0 });
            emit({
              op: "sub-imm",
              width: 64,
              rd: "zr",
              rn: 10,
              immediate: nativeWorkerStopPayload,
              shift: 0,
              setFlags: true,
            });
            throwExit = true;
            branch({ op: "b.cond", condition: "eq" }, fn.id, -1);
            patchInstruction(ordinary, {
              op: "cbnz",
              width: 64,
              rt: 9,
              displacement: (instructions.length - ordinary) * 4,
            });
          }
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
          clearWordCaches();
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
        flushColdStubs();
        flushTraps();
        endFrameRange();
        // Every branch into a seeded block start must be one whose words
        // were intersected there, and every label at that address one whose
        // edges were; a later edge would invalidate the seed.
        if (seededEntries.size !== 0) {
          // Labels laid out after a seeded block that emitted nothing share
          // its address but get their own entry state.
          const seededStarts = new Set<number>();
          for (let index = layout.length - 1; index >= 0; index--) {
            const block = fn.blocks[layout[index] ?? -1];
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
          let baseUniqueRoots: readonly number[] | undefined,
            baseUniqueGenerals: readonly number[] | undefined,
            baseRootSet: Set<number> | undefined,
            sharedFallbackMaps: Map<number, number[]> | undefined;
          if (liveSlots === undefined) {
            const sortedRoots = rootSlots.slice();
            sortedRoots.sort((left, right) => left - right);
            const dedupRoots: number[] = [];
            const rootSet = new Set<number>();
            for (const offset of sortedRoots)
              if (
                offset !== undefined &&
                dedupRoots[dedupRoots.length - 1] !== offset
              ) {
                dedupRoots.push(offset);
                rootSet.add(offset);
              }
            const sortedGenerals = generalSlots.slice();
            if (fn.scriptEntry === true && !elideActivation) {
              sortedGenerals.push(activationOffset + activationCalleeOffset);
              for (let i = 0; i < scriptActualRegisterPairs; i++)
                sortedGenerals.push(scriptArgumentsOffset + i * 16);
            }
            sortedGenerals.sort((left, right) => left - right);
            const dedupGenerals: number[] = [];
            for (const offset of sortedGenerals)
              if (
                offset !== undefined &&
                dedupGenerals[dedupGenerals.length - 1] !== offset
              )
                dedupGenerals.push(offset);
            baseUniqueRoots = dedupRoots;
            baseUniqueGenerals = dedupGenerals;
            baseRootSet = rootSet;
            sharedFallbackMaps = new Map<number, number[]>();
          }
          let collectingIndex = 0;
          for (let index = 0; index < callSites.length; index++) {
            const site = callSites[index];
            if (site === undefined) throw "safepoint site invariant";
            if (collecting[index] !== true) {
              safepoints.push({ offset: site.offset, start, map: empty });
              continue;
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
            const extraSiteRefs = siteReferences.get(index);
            const scriptOverflow = siteGeneralArguments.get(index) ?? 0;
            if (
              liveSlots === undefined &&
              baseUniqueRoots !== undefined &&
              baseUniqueGenerals !== undefined &&
              baseRootSet !== undefined &&
              sharedFallbackMaps !== undefined &&
              scriptOverflow === 0
            ) {
              let hasNewRef = false;
              if (extraSiteRefs !== undefined) {
                for (const offset of extraSiteRefs) {
                  if (offset === undefined) throw "site reference invariant";
                  if (!baseRootSet.has(offset)) {
                    hasNewRef = true;
                    break;
                  }
                }
              }
              if (!hasNewRef) {
                let shared = sharedFallbackMaps.get(held);
                if (shared === undefined) {
                  shared = [frameBytes, baseUniqueRoots.length];
                  for (const offset of baseUniqueRoots)
                    if (offset !== undefined) shared.push(offset);
                  shared.push(baseUniqueGenerals.length);
                  for (const offset of baseUniqueGenerals)
                    if (offset !== undefined) shared.push(offset);
                  registerSection(shared, held);
                  sharedFallbackMaps.set(held, shared);
                }
                safepoints.push({ offset: site.offset, start, map: shared });
                continue;
              }
            }
            const references: number[] = [],
              generals: number[] = [];
            if (liveSlots === undefined) {
              for (const offset of baseUniqueRoots ?? rootSlots)
                if (offset !== undefined) references.push(offset);
              for (const offset of baseUniqueGenerals ?? generalSlots)
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
            for (const offset of extraSiteRefs ?? []) {
              if (offset === undefined) throw "site reference invariant";
              references.push(offset);
            }
            if (
              liveSlots !== undefined &&
              fn.scriptEntry === true &&
              !elideActivation
            ) {
              generals.push(activationOffset + activationCalleeOffset);
              for (let i = 0; i < scriptActualRegisterPairs; i++)
                generals.push(scriptArgumentsOffset + i * 16);
            }
            for (let i = 0; i < scriptOverflow; i++) generals.push(i * 16);
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
            registerSection(map, held);
            safepoints.push({ offset: site.offset, start, map });
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
                      rotatedShifts[index] === 1 ||
                      fusedShifts[index] === 1 ||
                      fusedBitTests[index] === 1
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
      bodies.release(emitting);
      emitting = -1;
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
        const helper = leafHelperBody(kind),
          body = helper.body;
        // String helpers start on stringHelperAlignment boundaries (the
        // padding is never executed), so their aligned loop heads keep
        // their alignment in the image.
        if (helper.aligned)
          while ((instructions.length * 4) % stringHelperAlignment !== 0)
            emit({ op: "nop" });
        const offset = instructions.length * 4;
        helperOffsets.set(kind, offset);
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
      if (thunk.views !== undefined && thunk.signature !== undefined)
        emitDirectCallbackThunk(
          thunk.signature,
          thunk.ordinal,
          thunk.views,
          thunk.viewOffsets,
        );
      else
        emitCallbackThunk(
          thunk.signature,
          thunk.ordinal,
          thunk.runtimePrototype,
        );
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
    // The one-unit string table: the strings of units 0-255 in order, 32
    // bytes apart, first in the pool, so "\u0000"'s address is its base.
    if (usesUnitStrings) {
      codeLength = Math.ceil(codeLength / 16) * 16;
      if (256 * unitStringBytes > maxByteLength - codeLength)
        fail("CODE_LIMIT", "literal string pool exceeds byte budget");
      for (let unit = 0; unit < 256; unit++) {
        const value = String.fromCharCode(unit);
        stringOffsets.set(value, codeLength);
        strings.push({
          value,
          offset: codeLength,
          byteLength: unitStringBytes,
        });
        codeLength += unitStringBytes;
      }
    }
    for (const fixup of stringFixups) {
      if (fixup === undefined) throw "string fixup invariant";
      if (!stringOffsets.has(fixup.value)) {
        codeLength = Math.ceil(codeLength / 16) * 16;
        // The canonical kind, with at least eight data bytes like heap
        // strings (inline comparisons read that many unchecked).
        const byteLength =
          Math.ceil(
            (nativeStringDataOffset +
              Math.max(stringTextBytes(fixup.value), 8)) /
              16,
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
    codeLength = Math.ceil(codeLength / 8) * 8;
    const stackMapOffset = codeLength,
      stackMapWords = encodeStackMapTable(safepoints, stackMapOffset);
    if (stackMapWords === undefined)
      fail("CODE_LIMIT", "stack map table exceeds its encoding");
    const stackMapBytes = stackMapWords.length * 8 + nativeStackMapFooterBytes;
    if (stackMapBytes > maxByteLength - codeLength)
      fail("CODE_LIMIT", "stack map table exceeds byte budget");
    codeLength += stackMapBytes;
    codeLength = Math.ceil(codeLength / 4) * 4;
    if (codeLength > maxByteLength)
      fail("CODE_LIMIT", "aligned literal pool exceeds byte budget");
    // Pool strings take their canonical kind. Two-byte units preserve UTF-16
    // code units, including lone surrogates.
    const code = new Uint8Array(codeLength);
    for (const literal of strings) {
      if (literal === undefined) throw "literal invariant";
      const n = literal.value.length,
        oneByte = isOneByteText(literal.value);
      // The header's marker is byte 0; the one-byte kind flag is bit 48.
      code[literal.offset] = 1;
      if (oneByte) code[literal.offset + 6] = 1;
      const lengthWritten = writeUnsigned(
        code,
        literal.offset + nativeStringLengthOffset,
        4,
        n,
        "little",
      );
      if (!lengthWritten.ok) fail("ENCODING", lengthWritten.error);
      // Pool literals are read-only: their index field is precomputed.
      const indexField = nativeStringIndexField(literal.value);
      if (indexField !== 0) {
        const fieldWritten = writeUnsigned(
          code,
          literal.offset + nativeStringIndexFieldOffset,
          4,
          indexField,
          "little",
        );
        if (!fieldWritten.ok) fail("ENCODING", fieldWritten.error);
      }
      for (let i = 0; i < n; i++) {
        const unit = literal.value.charCodeAt(i);
        if (oneByte) code[literal.offset + nativeStringDataOffset + i] = unit;
        else {
          code[literal.offset + nativeStringDataOffset + i * 2] = unit % 256;
          code[literal.offset + nativeStringDataOffset + 1 + i * 2] =
            Math.floor(unit / 256);
        }
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
    /** A near address site whose target is beyond its reach moves the
     * module to the far model (one more emission) instead of failing. */
    function nearReach(patched: EncodingResult<undefined>): boolean {
      if (patched.ok) return true;
      if (patched.error !== "OUT_OF_RANGE" || forms.far) return false;
      compactOverflow = true;
      forms.far = true;
      return true;
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
      if (fixup.far === true) {
        if (
          !nearReach(
            patchRelativeAddress(code, {
              offset: fixup.offset,
              targetOffset,
              rd: 16,
              scratch: 17,
            }),
          )
        )
          fail("ENCODING", "far branch target out of reach");
        continue;
      }
      const r = patchBranch(code, {
        offset: fixup.offset,
        targetOffset,
        branch: fixup.branch,
      });
      if (!r.ok) compactFailure(r.error, fixup);
    }
    // Collapse chains of unconditional B trampolines (`b -> b -> target`).
    for (let fixupIndex = 0; fixupIndex < fixups.length; fixupIndex++) {
      const fixup = fixups[fixupIndex];
      if (
        fixup === undefined ||
        resolvedFixups.has(fixupIndex) ||
        fixup.far === true ||
        fixup.branch.op === "bl" ||
        fixup.block === undefined
      )
        continue;
      const functionBlocks = blockOffsets[fixup.function];
      const targetOffset =
        functionBlocks === undefined
          ? undefined
          : functionBlocks.offsets[
              fixup.block < 0 ? -fixup.block * 2 - 1 : fixup.block * 2
            ];
      if (targetOffset === undefined) continue;
      let finalTarget = targetOffset;
      for (let hop = 0; hop < 8; hop++) {
        if (finalTarget < 0 || finalTarget + 4 > code.length) break;
        const word =
          ((code[finalTarget] ?? 0) |
            ((code[finalTarget + 1] ?? 0) << 8) |
            ((code[finalTarget + 2] ?? 0) << 16) |
            ((code[finalTarget + 3] ?? 0) << 24)) >>>
          0;
        if ((word & 0xfc000000) >>> 0 !== 0x14000000) break;
        const imm26 = word & 0x03ffffff,
          signed = (imm26 & 0x02000000) !== 0 ? imm26 - 0x04000000 : imm26,
          next = finalTarget + signed * 4;
        if (next === finalTarget) break;
        finalTarget = next;
      }
      if (finalTarget !== targetOffset) {
        patchBranch(code, {
          offset: fixup.offset,
          targetOffset: finalTarget,
          branch: fixup.branch,
        });
      }
    }
    /** Patch a helper call: a BL in compact form, otherwise an x16 address. */
    function patchCall(offset: number, targetOffset: number): boolean {
      if (!compactCalls)
        return nearReach(
          patchRelativeAddress(code, {
            offset,
            targetOffset,
            rd: 16,
            scratch: 17,
          }),
        );
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
        return nearReach(patchPageAddress(code, { offset, targetOffset, rd }));
      if (owner === undefined)
        return nearReach(
          patchRelativeAddress(code, {
            scratch: 17,
            offset,
            targetOffset,
            rd,
          }),
        );
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
    if (emitting >= 0) bodies.release(emitting);
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
