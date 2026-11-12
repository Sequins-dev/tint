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
} from "@tint/abi/host";
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
import { shareFrameSlots } from "./slot-sharing.ts";
import { aliasedSlotLoads } from "./slot-aliases.ts";
import { slotHomes, type SlotHomes } from "./slot-registers.ts";
import {
  canUseLeafRegisters,
  canInlineCellRead,
  canInlineCellWrite,
  leafStorageRegisters,
} from "./leaf-registers.ts";
import { promoteStackWords } from "./stack-registers.ts";
import { forwardRegisterRoundTrips } from "./register-moves.ts";
import {
  createWordBuffer,
  appendWord,
  truncateWords,
  writeWord,
} from "@tint/foundation/binary/word-buffer";
import {
  createNumberIndex,
  createStringIndex,
} from "@tint/foundation/collections/key-index";
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
  | "remember-object"
  | "stack-overflow";
import {
  verify,
  maximumStringLength,
  scalarByteLength,
  deadSlotsAtEntry,
  provenRecordGuards,
  dataflowRecordGuards,
  provenRecordFlows,
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
  type ModuleIR,
  type FunctionIR,
  type Verification,
  type RecordLayout,
  type ScalarType,
  type Span,
  type Instruction as IRInstruction,
  type Terminator as IRTerminator,
  instructionEffects as irInstructionEffects,
  effectAllocate as irEffectAllocate,
} from "@tint/ir/scalar";
import { compactSlots } from "@tint/ir/optimization";
import type { UnwindRule, UnwindSave } from "@tint/abi/unwind";
import { dwarfFloatRegister } from "../unwind.ts";
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
  /** Call-frame rule of the body (absent for imports). */
  readonly unwind?: UnwindRule | undefined;
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
export interface NativeModule {
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
  readonly roots: readonly NativeRootFrame[];
  readonly strings: readonly NativeStringLiteral[];
  readonly cellHelpers: readonly NativeCellHelper[];
  readonly helpers: readonly NativeHelper[];
  readonly code: Uint8Array;
  readonly functions: readonly NativeFunction[];
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
/** Stable version-1 descriptor encoding; zero is reserved for a void result. */
/** Local slots proven to hold 32-bit integers: induction certificates and
 * the optimizer's interval facts (FunctionIR.integerSlots). */
function provenIntegerSlots(fn: FunctionIR): Uint8Array | undefined {
  const induction = provenInductionWords(fn),
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
 * stored undefined); has accessors answer whether the element is non-null. */
interface ListReadShape {
  readonly header: number;
  readonly field: number;
  readonly mode: "read" | "has";
}
function listReadShape(fn: FunctionIR): ListReadShape | undefined {
  const mode = fn.name.startsWith("__tint_reference_list_read$")
    ? "read"
    : fn.name.startsWith("__tint_reference_list_has$")
      ? "has"
      : undefined;
  if (
    mode === undefined ||
    fn.returnType !== (mode === "read" ? "optional-reference" : "boolean") ||
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
    fn.slots[2] !== "optional-reference"
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
/** Family words before each local record descriptor (below its index word):
 * bit f of word f >> 6 marks membership in dispatch family f, so frequent
 * union dispatches test one loaded word instead of an indexed bitset. */
const dispatchFamilyWords = 2;
export interface EmissionOptions {
  readonly maxByteLength?: number | undefined;
  /** Single-ADR local addresses: undefined uses a module-size estimate,
   * true always attempts them (out-of-reach functions still fall back). */
  readonly compactAddresses?: boolean | undefined;
  /** Slot loads may use their slot word as home (default). False keeps a
   * separate home per load, for tests that pin temporary-pool layouts. */
  readonly aliasSlotLoads?: boolean | undefined;
  /** False zeroes every managed slot word in the prologue, even those every
   * path stores before any collection or read (tests pinning root layouts). */
  readonly prologueSlotProof?: boolean | undefined;
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
  recordFlows: readonly Uint8Array[] | undefined;
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
    emit({ op: "ldr", width: 32, rt: 11, rn: 9, offset: 16 });
    emit({ op: "ldr", width: 32, rt: 12, rn: 10, offset: 16 });
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
  // each 64-bit stack word last stored or loaded. Valid only within
  // straight-line code: cleared at every branch, call, other memory write,
  // unknown instruction, block start and branch target (`joins`).
  const stackWords = new Map<number, number>(),
    joins = new Set<number>();
  let lastJoin = -1;
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
      case "madd":
      case "ubfm":
      case "sbfm":
      case "extr":
      case "cset":
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
        return [];
      default:
        return undefined;
    }
  }
  function emit(i: Instruction): void {
    if (joins.has(instructions.length)) {
      joins.delete(instructions.length);
      stackWords.clear();
    }
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
      if (branch.op === "b.cond")
        emit({ op: "b.cond", condition: branch.condition, displacement: 0 });
      else if (branch.op === "cbz" || branch.op === "cbnz")
        emit({
          op: branch.op,
          width: branch.width,
          rt: branch.rt,
          displacement: 0,
        });
      else emit({ op: "b", displacement: 0 });
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
    const stableLayouts = stableRecordLayouts(module),
      // Intraprocedural descriptor proofs need descriptor stability only.
      stableGuards = stableDescriptors(module);
    const stableSlots =
      stableLayouts &&
      !module.functions.some((fn) => fn.environment !== undefined);
    function provenWordReturns(): Uint8Array {
      const proven = new Uint8Array(module.functions.length);
      if (stableSlots) {
        let budget = 10000000;
        for (const fn of module.functions) {
          if (fn === undefined) throw "word return function invariant";
          const proof = provenWordFacts(fn, Math.min(1000000, budget));
          if (proof !== undefined) {
            proven[fn.id] = proof.returned;
            budget -= proof.work;
          }
        }
      }
      facts.wordReturns = proven;
      return proven;
    }
    const wordReturns: Uint8Array = facts.wordReturns ?? provenWordReturns();
    if (!facts.wordArgumentsKnown) {
      facts.wordArguments =
        stableSlots && closedRoots !== undefined
          ? provenWordArguments(module, closedRoots, wordReturns)
          : undefined;
      facts.wordArgumentsKnown = true;
    }
    const wordArguments = facts.wordArguments;
    if (!facts.recordFlowsKnown) {
      facts.recordFlows =
        closedRoots === undefined
          ? undefined
          : provenRecordFlows(module, 10000000, true, closedRoots);
      facts.recordFlowsKnown = true;
    }
    const recordFlows = facts.recordFlows;
    if (!facts.noSafepointsKnown) {
      facts.noSafepoints = provenNoSafepoints(module);
      facts.noSafepointsKnown = true;
    }
    const noSafepoints = facts.noSafepoints;
    if (!facts.directReturnsKnown) {
      facts.directReturns =
        closedRoots === undefined
          ? undefined
          : provenDirectOnlyFunctions(module, closedRoots);
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
      readonly roots: number;
      readonly rootRequests: number;
      readonly sourceRanges: number;
      readonly operationRanges: number;
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
      while (roots.length > mark.roots) roots.pop();
      while (rootRequests.length > mark.rootRequests) rootRequests.pop();
      while (sourceRanges.length > mark.sourceRanges) sourceRanges.pop();
      while (operationRanges.length > mark.operationRanges)
        operationRanges.pop();
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
          roots: roots.length,
          rootRequests: rootRequests.length,
          sourceRanges: sourceRanges.length,
          operationRanges: operationRanges.length,
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
        const integerFacts = stableSlots
          ? provenWordFacts(
              fn,
              1000000,
              wordReturns,
              provenIntegerSlots(fn),
              wordArguments === undefined ? undefined : wordArguments[fn.id],
            )
          : undefined;
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
                // The inline list read indexes with an int64; its fallback
                // call converts the argument (floatLoad).
                (op.kind === "call" &&
                  op.environment === undefined &&
                  listReadShapes(op.target) !== undefined);
              if (!accepts)
                visitInstructionOperands(op, (id) => {
                  rejected[valueIds.intern(id)] = 1;
                });
            }
          }
          return uses;
        }
        // Keep only integer slots whose every load is used as an integer, so
        // no load converts back to a double. Dropping a slot can reject the
        // uses of values stored to it, so iterate to a fixpoint.
        for (let changed = true; changed;) {
          changed = false;
          integerUses = findIntegerUses();
          for (const block of fn.blocks) {
            if (block === undefined) throw "integer slot block invariant";
            for (const op of block.instructions)
              if (
                op !== undefined &&
                op.kind === "load" &&
                integerSlots[op.slot] === 1 &&
                integerUses[valueIds.intern(op.id)] !== 1
              ) {
                integerSlots[op.slot] = 0;
                changed = true;
              }
          }
        }
        // Numeric constants used only as shift amounts fold into immediate
        // shifts, and undefined values used only as an operand of an optional
        // equality fold into a presence test; neither is materialized.
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
              if (
                op.kind === "host-call" &&
                (op.operation === "memory-read-word" ||
                  op.operation === "memory-write-word" ||
                  op.operation === "memory-move")
              )
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
              if (
                op.kind === "optional-value-or" &&
                reads.has(op.value) &&
                uses[valueIds.intern(op.value)] === 1 &&
                positiveZero[valueIds.intern(op.fallback)] === 1
              ) {
                fusedReads[valueIds.intern(op.value)] = op.id + 1;
                fusedArrays.set(op.value, reads.get(op.value) ?? 0);
                fusedDefaults[valueIds.intern(op.id)] = 1;
                const fallback = valueIds.intern(op.fallback);
                folded[fallback] = (folded[fallback] ?? 0) + 1;
              }
            }
          }
          for (let index = 0; index < resultBound; index++)
            if (
              (numericConstants[index] === 1 ||
                undefinedValues[index] === 1 ||
                noneValues[index] === 1) &&
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
        /** Slot register homes: d8..d15 for numbers, x24..x28 for integers. */
        function slotRegister(slot: number): number {
          return homes === undefined ? 0 : (homes.registers[slot] ?? 0);
        }
        functionId = fn.id;
        trapSites = [];
        forwardSites = [];
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
              : rootOffset + (hasRoots ? 16 : 0),
          localsOffset =
            rootOffset +
            (hasRoots ? 16 : 0) +
            (fn.closureEnvironment === undefined ? 0 : 8);
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
        const sharing =
          slotBytes > 64 && !leafRegisters
            ? shareFrameSlots(
                fn,
                (slot) => privateSlots[slot] !== 1,
                40000000,
                // Integer slots hold int64, other numbers doubles: their
                // groups take different register classes.
                (slot) =>
                  integerSlots[slot] === 1 ? "integer" : (fn.slots[slot] ?? ""),
              )
            : undefined;
        homes = leafRegisters
          ? undefined
          : slotHomes(
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
                    type !== undefined &&
                    managed(type) &&
                    scalarByteLength(type) === 8
                  );
                },
                collects: (op: IRInstruction): boolean =>
                  op.kind === "call"
                    ? closedRoots === undefined ||
                      noSafepoints === undefined ||
                      noSafepoints[op.target] !== 1
                    : op.kind === "call-indirect" ||
                      (irInstructionEffects(op) & irEffectAllocate) !== 0,
              },
            );
        /** Register-homed reference slots live after an instruction that may
         * collect: stored before it, reloaded after it. */
        function referenceSpills(
          block: number,
          index: number,
        ): readonly number[] | undefined {
          return homes === undefined ? undefined : homes.spills[block]?.[index];
        }
        // Reference homes whose frame word already holds the register's value
        // (stored or reloaded since the slot was last written in this block).
        const cleanHomes = new Set<number>();
        function spillReferences(
          slots: readonly number[],
          load: boolean,
        ): void {
          for (const slot of slots) {
            if (slot === undefined) throw "reference spill invariant";
            const home = slotRegister(slot);
            if (home < 32) throw "reference spill home invariant";
            if (!load && cleanHomes.has(home)) continue;
            cleanHomes.add(home);
            emit(
              load
                ? {
                    op: "ldr",
                    width: 64,
                    rt: home - 32,
                    rn: "sp",
                    offset: slotOffset(slot),
                  }
                : {
                    op: "str",
                    width: 64,
                    rt: home - 32,
                    rn: "sp",
                    offset: slotOffset(slot),
                  },
            );
          }
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
            : aliasedSlotLoads(fn, 1000000);
        // A load aliasing a register-homed reference slot would keep the
        // reference in that register across safepoints: give it its own home.
        if (slotAliases !== undefined && homes !== undefined)
          for (const block of fn.blocks) {
            if (block === undefined) throw "alias block invariant";
            for (const op of block.instructions) {
              if (op === undefined) throw "alias instruction invariant";
              if (op.kind !== "load" || slotAliases[op.id] !== 1) continue;
              const type = fn.slots[op.slot];
              if (
                slotRegister(op.slot) >= 32 &&
                type !== undefined &&
                managed(type)
              )
                slotAliases[op.id] = 0;
            }
          }
        function aliasedLoad(id: number): boolean {
          return slotAliases !== undefined && slotAliases[id] === 1;
        }
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
              else {
                values[valueIds.intern(id)] = { offset: cursor, type };
                cursor += scalarByteLength(type);
              }
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
                  (type === "number" && integerUses[valueIds.intern(id)] === 1)
                )
                  candidates[id] = 3;
                else if (type === "number") candidates[id] = 1;
                else if (managed(type) && type !== "primitive")
                  candidates[id] = 2;
              }
            }
          }
          transientRegisters = temporaryRegisters(
            fn,
            candidates,
            1000000,
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
          const temporaryPlan = planTemporarySlots(fn, classes);
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
        let deferredRootBlocks =
          hasRoots && closedRoots !== undefined && noSafepoints !== undefined
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
        const leafStorage = leafRegisters
          ? leafStorageRegisters(
              fn,
              slotOffsets,
              value,
              localsOffset,
              maximumCursor,
              1000000,
              signature,
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
        // host operations and bounded OS imports fit in the headroom.
        const guardsStack =
          frameBytes > 4096 ||
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
          if (hasRoots) {
            rawLoad(10, contextOffset);
            rawLoad(9, rootOffset);
            emit({ op: "str", width: 64, rt: 9, rn: 10, offset: 0 });
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
          emit({
            op: "add-imm",
            width: 64,
            rd: 17,
            rn: "sp",
            immediate: 0,
            shift: 0,
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
        const deadSlots = hasRoots
          ? deadSlotsAtEntry(fn, 10000000, trackedSlots)
          : undefined;
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
                      for (const word of rootWordsOf(op.slot)) {
                        if (word === undefined) throw "dead word invariant";
                        words.push(word);
                      }
                  }
                  return words;
                },
                rootWordsOf,
                (block) => deadCollecting[block] !== 1,
                50000000,
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
          hasRoots && options.prologueSlotProof !== false
            ? prologueClearWords(
                fn,
                slotWordOffsets.length,
                initialWords,
                rootWordsOf,
                closedRoots === undefined ? undefined : noSafepoints,
                50000000,
              )
            : undefined;
        function slotNeedsZero(offset: number): boolean {
          if (prologueStores.has(offset)) return false;
          if (slotClears === undefined) return true;
          const word = slotWordIndex.get(offset);
          return word === undefined || slotClears[word] === 1;
        }
        const initialRoots: number[] = [];
        for (let i = 0; i < rootSlots.length; i++) {
          const temporary = i >= rootSlots.length - temporaryRoots.length;
          if (rootClearBlocks !== undefined && temporary) continue;
          const offset = rootSlots[i];
          if (offset === undefined) throw "root slot invariant";
          if (temporary ? !prologueStores.has(offset) : slotNeedsZero(offset))
            initialRoots.push(offset);
        }
        for (let i = 0; i < generalSlots.length; i++) {
          const temporary = i >= generalSlots.length - temporaryGenerals.length;
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
          localPointer(9);
          rawStore(9, rootOffset + 8);
          address(9, rootOffset);
          emit({ op: "str", width: 64, rt: 9, rn: 10, offset: 0 });
        }
        if (fn.blocks[0]?.id !== fn.entry) branch({ op: "b" }, fn.id, fn.entry);
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
            else {
              floatLoad(0, id);
              emit({ op: "fcvtzs-x-d", rd: rt, rn: 0 });
            }
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
          else if (kind === 2 || kind === 5 || kind === 6 || kind === 7) {
            floatLoad(0, id);
            emit({ op: "fcvtzs-x-d", rd: 9, rn: 0 });
          } else {
            // Most unknown operands already hold an integral binary64. An exact
            // round trip through int64 yields ToUint32's low 32 bits directly;
            // only 2^63 survives saturation, so INT64_MAX (cmn sets V) also
            // takes the helper with fractional, non-finite and huge inputs.
            floatLoad(0, id);
            emit({ op: "fcvtzs-x-d", rd: 9, rn: 0 });
            emit({ op: "scvtf-d-x", rd: 1, rn: 9 });
            emit({ op: "fcmp", rn: 0, rm: 1 });
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
        function floatLoad(
          rt: number,
          id: number,
          byteOffset: number = 0,
        ): void {
          if (byteOffset === 0 && storedAsInteger(id)) {
            // Exact (|x| < 2^53), so the conversion is too.
            rawLoad(17, value(id).offset);
            emit({ op: "scvtf-d-x", rd: rt, rn: 17 });
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
          if (register >= 32)
            emit({ op: "fmov-x-d", rd: register - 32, rn: rt });
          else if (register !== 0) {
            if (register !== rt) emit({ op: "fmov-d-d", rd: register, rn: rt });
          } else emit({ op: "str-d", rt, rn: "sp", offset });
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
          chain: RecordDispatchChain,
          nonNullKnown: boolean,
        ): void {
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
              branch({ op: "b.cond", condition }, fn.id, chain.failure);
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
              branch({ op: "cbz", width: 64, rt: 12 }, fn.id, chain.failure);
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
            branch({ op: "b.cond", condition: "cs" }, fn.id, chain.failure);
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
            branch({ op: "cbz", width: 32, rt: 13 }, fn.id, chain.failure);
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
          branch({ op: "b" }, fn.id, chain.failure);
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
          trapIf({ op: "b.cond", condition: "ne" });
          // Validate the allocator's numeric offset before forming a native pointer.
          rawLoad(9, resultOffset + 16);
          callHelper("to-uint32");
          emit({ op: "ucvtf-d-w", rd: 0, rn: 9 });
          emit({ op: "ldr-d", rt: 1, rn: "sp", offset: resultOffset + 16 });
          emit({ op: "fcmp", rn: 0, rm: 1 });
          trapIf({ op: "b.cond", condition: "ne" });
          emit({ op: "ubfm", width: 32, rd: 10, rn: 9, immr: 0, imms: 3 });
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
          // align16(24 + 2 * length) must fit the uint32 allocation contract.
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
            integer = storedAsInteger(index),
            kind = integer ? 2 : wordKinds[fact];
          if (kind === 1) {
            // A constant that is not an exact uint32 can never be an index.
            imm(13, 0);
            return;
          }
          // An exact int64 index needs only the unsigned length check, which
          // also rejects negatives.
          if (integer) rawValue(9, index);
          else if (kind === 3) imm(9, wordConstants[fact] ?? 0);
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
              trapIf({ op: "b.cond", condition: "ne" });
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
              trapIf({ op: "b.cond", condition: "hi" });
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
          trapIf({ op: "b.cond", condition: "ne" });
          rawLoad(10, value(cell).offset + 8);
          trapIf({ op: "cbz", width: 64, rt: 10 });
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
        const chainGuards = provenRecordGuards(
            fn,
            Math.min(100000, values.length * 8 + fn.blocks.length * 8 + 256),
            stableGuards,
          ),
          // Join-crossing proofs; emission-only, never fed back into the IR.
          joinGuards = dataflowRecordGuards(fn, 2000000, stableGuards);
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
          hasRoots && poolWordCount > 0
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
                50000000,
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
        for (let blockIndex = 0; blockIndex < fn.blocks.length; blockIndex++) {
          const b = fn.blocks[blockIndex],
            nextBlock = fn.blocks[blockIndex + 1]?.id;
          if (b === undefined) throw "block invariant";
          // Fused dispatch continuations are unreachable; their head tests
          // every candidate layout.
          if (dispatch?.fused[b.id] === 1) {
            stackWords.clear();
            offsets[b.id * 2] = instructions.length * 4;
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
          branchIsland();
          trapIsland();
          blockId = b.id;
          stackWords.clear();
          cleanHomes.clear();
          stackWords.clear();
          offsets[b.id * 2] = instructions.length * 4;
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
            plannedClears !== undefined
              ? 0
              : rootClearBlocks === undefined
                ? (incomingReferences[b.id] ?? 0)
                : rootClearBlocks[b.id] === 1
                  ? 0
                  : temporaryRoots.length;
          const generalClears =
            plannedClears !== undefined
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
          // SSA values are block-local. A final comparison used by the branch
          // has no other consumer, so its flags can replace a boolean carrier.
          const finalInstruction = b.instructions[b.instructions.length - 1];
          let comparisonValue: number | undefined = undefined;
          if (
            finalInstruction !== undefined &&
            finalInstruction.kind === "binary"
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
            const op = b.instructions[operationIndex];
            if (op === undefined) throw "instruction invariant";
            if (recordOperations) beginOperation(b.id, operationIndex, op);
            span = { start: op.start, end: op.end };
            const spills = referenceSpills(b.id, operationIndex);
            if (spills !== undefined) spillReferences(spills, false);
            if (op.kind === "store") cleanHomes.delete(slotRegister(op.slot));
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
              (op.kind === "unary" &&
                (op.operator === "~" || op.operator === "uint32")) ||
              (op.kind === "binary" &&
                ["&", "|", "^", "<<", ">>", ">>>", "imul"].includes(
                  op.operator,
                ))
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
                trapIf({ op: "b.cond", condition: "ne" });
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
                    trapIf({ op: "b.cond", condition: "hi" });
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
                localPointer(9);
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
              case "string-code-unit": {
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
                  emit({ op: "ldr", width: 32, rt: 10, rn: 9, offset: 16 });
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
                    immediate: 24,
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
                emit({ op: "str", width: 64, rt: "zr", rn: 9, offset: 8 });
                floatLoad(0, op.length);
                emit({ op: "fcvtzs-x-d", rd: 10, rn: 0 });
                emit({ op: "str", width: 64, rt: 10, rn: 9, offset: 16 });
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
                if (foldedConstants[valueIds.intern(op.id)] === 1) break;
                rawStore("zr", value(op.id).offset);
                rawStore("zr", value(op.id).offset + 8);
                break;
              case "boolean-wrap":
              case "optional-wrap":
                // The payload is always a double; int64 operands convert.
                if (storedAsInteger(op.value)) {
                  floatLoad(0, op.value);
                  emit({ op: "fmov-x-d", rd: 9, rn: 0 });
                } else rawValue(9, op.value);
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
                trapIf({ op: "cbz", width: 64, rt: 10 });
                rawValue(9, op.value);
                saveRaw(9, op.id);
                break;
              case "optional-value-or": {
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
                // Present selects the payload; absent loads the fallback.
                rawValue(9, op.value);
                rawLoad(10, value(op.value).offset + 8);
                const present = instructions.length;
                emit({ op: "cbnz", width: 64, rt: 10, displacement: 0 });
                rawValue(9, op.fallback);
                patchInstruction(present, {
                  op: "cbnz",
                  width: 64,
                  rt: 10,
                  displacement: (instructions.length - present) * 4,
                });
                saveRaw(9, op.id);
                break;
              }
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
                  trapIf({ op: "b.cond", condition: "ne" });
                }
                function bytes(
                  index: number,
                  register: number,
                  path: boolean,
                ): void {
                  rawValue(9, argument(index));
                  emit({ op: "ldr", width: 32, rt: 10, rn: 9, offset: 16 });
                  emit({
                    op: "ldr",
                    width: 64,
                    rt: register,
                    rn: 9,
                    offset: 24,
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
                  // The acknowledgement is the number +0 (all-zero bits).
                  rawLoad(9, resultOffset + 16);
                  emit({ op: "cbz", width: 64, rt: 9, displacement: 8 });
                  emit({ op: "brk", immediate: 3 });
                  break;
                }
                const resultId = op.id;
                if (resultId === undefined)
                  throw "verified host result invariant";
                if (operation === "word-park" || operation === "word-wake") {
                  const parking = host().parking;
                  if (parking === undefined)
                    fail("UNSUPPORTED", "target has no word parking ABI");
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
                if (operation === "hosted-thread-entry") {
                  imports.push({
                    offset: instructions.length * 4,
                    rd: 9,
                    scratch: 17,
                    target: {
                      kind: "import",
                      name: "tint:hosted-thread-entry",
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
                    operation === "memory-move"
                      ? 5
                      : operation === "memory-write-word"
                        ? 4
                        : 3;
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
                      floatLoad(0, argument(index));
                      emit({ op: "fcvtzs-x-d", rd: index, rn: 0 });
                      emit({ op: "scvtf-d-x", rd: 1, rn: index });
                      emit({ op: "fcmp", rn: 0, rm: 1 });
                      reject("ne");
                    }
                    // At a fixed zero offset the address is the effective
                    // address, whose check below subsumes this one (with an
                    // offset, a negative address could wrap past 2^64).
                    if (!(directAddress && index === 0)) rejectUnsafe(index);
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
                let symbol = "";
                if (
                  operation === "memory-map" ||
                  operation === "executable-map"
                ) {
                  const executable = host().executableMemory;
                  if (
                    operation === "executable-map" &&
                    executable === undefined
                  )
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
                trapIf({ op: "cbz", width: 32, rt: 13 });
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
                if (fusedReads[valueIds.intern(op.id)] !== 0) {
                  // `?? 0`: keep the element word (zero when absent) in the
                  // read's own home; the fused default converts it there, as
                  // the result's home may not be free before that point.
                  saveRaw(11, op.id);
                  break;
                }
                emit(
                  value(op.array).type === "Float64Array"
                    ? { op: "fmov-d-x", rd: 0, rn: 11 }
                    : { op: "ucvtf-d-w", rd: 0, rn: 11 },
                );
                floatStore(0, op.id);
                rawStore(13, value(op.id).offset + 8);
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
                emit({ op: "ldr", width: 64, rt: 10, rn: 10, offset: 24 });
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
                if (integerSlots[op.slot] === 1) {
                  // Every load of an integer slot has only integer uses.
                  if (!wantsInteger(op.id)) throw "integer slot load invariant";
                  copyRawWord(slotOffset(op.slot), value(op.id).offset);
                  markInteger(op.id);
                  break;
                }
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
                  floatLoad(0, op.operand);
                  emit({ op: "fneg", rd: 0, rn: 0 });
                  floatStore(0, op.id);
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
                    emit({ op: "cset", rd: 9, condition });
                    saveRaw(9, op.id);
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
                  wordKinds[valueIds.intern(op.id)] === 6 &&
                  exactInteger(op.left) &&
                  exactInteger(op.right)
                ) {
                  // Bounded below 2^53 (kind 6), so the int64 result is
                  // exact. A product's -0 becomes +0, which integer uses
                  // (see findIntegerUses) cannot observe.
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
                } else if (["+", "-", "*", "/"].includes(op.operator)) {
                  const left = floatOperand(op.left, 0),
                    right = floatOperand(op.right, 1),
                    target = floatTarget(op.id, 0);
                  emit(
                    op.operator === "+"
                      ? { op: "fadd", rd: target, rn: left, rm: right }
                      : op.operator === "-"
                        ? { op: "fsub", rd: target, rn: left, rm: right }
                        : op.operator === "*"
                          ? { op: "fmul", rd: target, rn: left, rm: right }
                          : { op: "fdiv", rd: target, rn: left, rm: right },
                  );
                  floatStore(target, op.id);
                } else if (op.operator === "%") {
                  floatLoad(0, op.left);
                  floatLoad(1, op.right);
                  callHelper("remainder");
                  floatStore(0, op.id);
                } else if (
                  ["&", "|", "^", "<<", ">>", ">>>", "imul"].includes(
                    op.operator,
                  )
                ) {
                  if (rotatedShifts[valueIds.intern(op.id)] === 1) break;
                  const rightIndex = valueIds.intern(op.right),
                    rightKind = wordKinds[rightIndex] ?? 0,
                    rotation = rotateAmounts[valueIds.intern(op.id)] ?? 0;
                  if (rotation !== 0) {
                    wordValue(rotateSources[valueIds.intern(op.id)] ?? 0);
                    emit({
                      op: "extr",
                      width: 32,
                      rd: 9,
                      rn: 9,
                      rm: 9,
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
                    wordValue(op.left);
                    emit(
                      op.operator === "<<"
                        ? {
                            op: "ubfm",
                            width: 32,
                            rd: 9,
                            rn: 9,
                            immr: (32 - count) % 32,
                            imms: 31 - count,
                          }
                        : {
                            op: op.operator === ">>" ? "sbfm" : "ubfm",
                            width: 32,
                            rd: 9,
                            rn: 9,
                            immr: count,
                            imms: 31,
                          },
                    );
                  } else {
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
                                ? {
                                    op: "asrv",
                                    width: 32,
                                    rd: 9,
                                    rn: 13,
                                    rm: 9,
                                  }
                                : op.operator === "imul"
                                  ? {
                                      // Low 32 bits of the product (signed).
                                      op: "madd",
                                      width: 32,
                                      rd: 9,
                                      rn: 13,
                                      rm: 9,
                                      ra: "zr",
                                    }
                                  : {
                                      op: "lsrv",
                                      width: 32,
                                      rd: 9,
                                      rn: 13,
                                      rm: 9,
                                    },
                    );
                  }
                  if (storedAsWord(op.id)) saveRaw(9, op.id);
                  else if (wantsInteger(op.id)) {
                    // A W-register result is zero-extended: right for >>>.
                    if (op.operator !== ">>>")
                      emit({ op: "sxtw", rd: 9, rn: 9 });
                    saveRaw(9, op.id);
                    markInteger(op.id);
                  } else {
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
                  const leftAbsent =
                      undefinedValues[valueIds.intern(op.left)] === 1,
                    rightAbsent =
                      undefinedValues[valueIds.intern(op.right)] === 1;
                  if (leftAbsent || rightAbsent) {
                    // Equality with undefined (an optional number, as the
                    // verifier equates operand types) observes only presence.
                    if (leftAbsent && rightAbsent) imm(9, 0);
                    else
                      rawLoad(
                        9,
                        value(leftAbsent ? op.right : op.left).offset + 8,
                      );
                    const condition: Condition =
                      op.operator === "===" || op.operator === "=="
                        ? "eq"
                        : "ne";
                    emit({
                      op: "sub-imm",
                      width: 64,
                      rd: "zr",
                      rn: 9,
                      immediate: 0,
                      shift: 0,
                      setFlags: true,
                    });
                    if (op.id === comparisonValue) comparisonBranch = condition;
                    else {
                      emit({ op: "cset", rd: 9, condition });
                      saveRaw(9, op.id);
                    }
                    break;
                  }
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
                    emit({ op: "cset", rd: 9, condition });
                    saveRaw(9, op.id);
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
                  rawValue(9, list);
                  slowZero(9);
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
                  emit({ op: "ldr", width: 32, rt: 11, rn: 10, offset: 16 });
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
                    immediate: 32,
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
                    callHelper("remember-object");
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
                  const list = op.arguments[0],
                    index = op.arguments[1],
                    field =
                      module.records?.[listShape.header]?.fields[
                        listShape.field
                      ];
                  if (list === undefined || index === undefined)
                    throw "list read argument invariant";
                  if (field === undefined || field.offset > 32760)
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
                  rawValue(9, list);
                  toSlow({ op: "cbz", width: 64, rt: 9 });
                  emit({ op: "ldr", width: 64, rt: 10, rn: 9, offset: 0 });
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
                  emit({
                    op: "ldr",
                    width: 64,
                    rt: 10,
                    rn: 9,
                    offset: field.offset,
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
                  emit({ op: "ldr", width: 32, rt: 11, rn: 10, offset: 16 });
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
                    rn: 10,
                    immediate: 32,
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
                    emit({ op: "cset", rd: 11, condition: "ne" });
                  } else {
                    // A stored undefined is the vector itself; a hole is null.
                    emit({
                      op: "sub-reg",
                      width: 64,
                      rd: "zr",
                      rn: 11,
                      rm: 10,
                      shift: "lsl",
                      amount: 0,
                      setFlags: true,
                    });
                    const present = instructions.length;
                    emit({ op: "b.cond", condition: "ne", displacement: 0 });
                    imm(11, 0);
                    patchInstruction(present, {
                      op: "b.cond",
                      condition: "ne",
                      displacement: (instructions.length - present) * 4,
                    });
                  }
                  saveRaw(11, listResult);
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
                  zeroWords([
                    resultOffset,
                    resultOffset + 8,
                    resultOffset + 16,
                    resultOffset + 24,
                  ]);
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
                if (listReadDone !== undefined)
                  patchInstruction(listReadDone, {
                    op: "b",
                    displacement: (instructions.length - listReadDone) * 4,
                  });
                break;
              }
            }
            // The collector may have moved what the frame words point to.
            if (spills !== undefined) spillReferences(spills, true);
          }
          const t = b.terminator;
          if (recordOperations) beginTerminator(b.id, t);
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
            localPointer(9);
            rawStore(9, resultOffset + 24);
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
              rawValue(9, t.condition);
              if (t.consequent === nextBlock)
                branch({ op: "cbz", width: 64, rt: 9 }, fn.id, t.alternate);
              else {
                branch({ op: "cbnz", width: 64, rt: 9 }, fn.id, t.consequent);
                if (t.alternate !== nextBlock)
                  branch({ op: "b" }, fn.id, t.alternate);
              }
            }
          } else if (t.kind === "record") {
            const layout = module.records?.[t.record],
              field = layout?.fields[t.field];
            if (field === undefined) throw "verified record invariant";
            rawValue(9, t.object);
            const chain = dispatch?.chains.get(b.id);
            if (chain !== undefined)
              dispatchDescriptor(
                9,
                chain,
                nonNullValues[valueIds.intern(t.object)] === 1 ||
                  (flowGuards !== undefined &&
                    ((flowGuards[b.id] ?? 0) & 2) !== 0),
              );
            else if (recordGuards === undefined || recordGuards[b.id] !== 1)
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
              if (t.consequent !== nextBlock)
                branch({ op: "b" }, fn.id, t.consequent);
            } else if (canInlineCellWrite(fn, t)) {
              // The generic helper's contract inline: a write needs state 1
              // and a mutable cell; an initialization needs state 0 and sets
              // it to 1. Failures take the alternate edge, as the helper's
              // nonzero status does; the value words come from the frame.
              if (t.kind === "record-cell") rawValue(9, t.object);
              else rawLoad(9, environmentOffset);
              emit({ op: "ldrb", rt: 10, rn: 9, offset: access.stateOffset });
              if (t.operation === "write" && !access.mutable)
                branch({ op: "b" }, fn.id, t.alternate);
              else {
                if (t.operation === "write") {
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
                } else
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
                    callHelper("remember-object");
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
          if (recordOperations) endOperation();
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
        if (leafRegisters && leafStorage === undefined)
          promoteStackWords(
            instructions,
            start / 4,
            instructions.length,
            localsOffset,
            maximumCursor,
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
        functions.push({
          id: fn.id,
          name: fn.name,
          exported: fn.exported,
          offset: start,
          byteLength: instructions.length * 4 - start,
          frameBytes,
          signature,
          unwind: { kind: "frame", saves: unwindSaves },
          debugFrame: debugSpans
            ? {
                register: 29,
                contextOffset: contextOffset - frameBytes,
                resultOffset: resultPointerOffset - frameBytes,
                ranges: frameRanges,
              }
            : undefined,
        });
        // Trap islands patched during the function report their own range
        // failures (and may already have escalated its forms).
        const trapOverflow = compactOverflow && !overflowBefore;
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
      // Dispatch family words and an 8-byte record index precede each
      // descriptor (union dispatch membership); descriptor readers start at
      // the descriptor itself.
      const header = dispatchFamilyWords * 8 + 8,
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
    for (let i = 0; i < rootRequests.length; i++) {
      const request = rootRequests[i],
        root = roots[i];
      if (request === undefined || root === undefined)
        throw "root descriptor invariant";
      if (!patchLocal(request.fixup, root.descriptorOffset, 9))
        fail("ENCODING", "root descriptor address failed");
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
