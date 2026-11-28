import {
  nativeActivationTopOffset,
  nativeArrayDataOffset,
  nativeArrayInlineOffset,
  nativeArrayLengthOffset,
  nativeArrayOwnerOffset,
  nativeArrayViewByteLength,
  nativeHeaderFlagUnit,
  nativeHeaderFlagsShift,
  nativeStringDataOffset,
  nativeStringLengthOffset,
} from "@tint/abi/host";
import {
  nativeFunctionByteLength,
  nativeFunctionDescriptorOffset,
  nativeFunctionEntryOffset,
  nativeFunctionEnvironmentOffset,
  nativeFunctionReservedOffset,
  nativeFunctionSignatureOffset,
} from "@tint/abi/function";
import {
  nativeWeakSlotByteLength,
  nativeWeakSlotKeyOffset,
  nativeWeakSlotKeyPayloadOffset,
  nativeWeakSlotMarker,
  nativeWeakSlotValueOffset,
  nativeWeakSlotValuePayloadOffset,
} from "@tint/abi/weak-slot";
import { encodeFloat64 } from "@tint/foundation/binary/bytes";
import { readWord, type WordBuffer } from "@tint/foundation/binary/word-buffer";
import type {
  KeyIndex,
  NumberIndex,
} from "@tint/foundation/collections/key-index";
import {
  instructionResult,
  recordHeaderBytes,
  scalarByteLength,
  typedArrayIntegerElements,
  typedArrayLayout,
  typedArrayMarker,
  typedArrayScale,
  visitInstructionOperands,
  visitTerminatorOperands,
  type ArrayAtomicOperation,
  type FunctionIR,
  type Instruction as IRInstruction,
  type ModuleIR,
  type NativeTypedArray,
  type RecordLayout,
  type ScalarType,
  type Span,
  type Terminator as IRTerminator,
} from "@tint/ir/scalar";
import {
  branchAt,
  float64Immediate,
  logicalImmediate32,
  type Branch,
  type Condition,
  type Instruction,
} from "../isa.ts";
import type { CellAccess } from "../cell.ts";
import type { FusedPropertyAccess } from "../../scalar/property-fusion.ts";
import type { SlotSharing } from "../../scalar/slot-sharing.ts";
import {
  activationArgumentsOffset,
  activationCalleeOffset,
  activationCountOffset,
  activationFrameOffset,
  scriptActualRegisterPairs,
  type SignatureLayout,
} from "./abi.ts";
import { emitArrayOp, type ArrayOpsEmitContext } from "./array-ops.ts";
import { emitBinaryOp } from "./binary-ops.ts";
import {
  fallsThrough,
  type NestedSelect,
  type SelectArm,
  type SelectDiamond,
  type SelectDiamondPlan,
} from "./block-entries.ts";
import {
  emitStoreReciprocal,
  floatCondition,
  invertCondition,
  managed,
  presentSourceSurvivesTrailingStores,
  trailingStringPresent,
} from "./block-helpers.ts";
import {
  emitCCall,
  emitCMemory,
  type CInteropEmitContext,
} from "./c-interop.ts";
import { emitCallOp } from "./call-ops.ts";
import type { DebugTracker } from "./debug-variables.ts";
import {
  emitGeneralElementAccess,
  emitSpecializedGeneralEqual,
  planDirectGeneralTargets,
} from "./general-elements.ts";
import { emitHostCall, type HostCallEmitContext } from "./host-calls.ts";
import { canInlineCellRead, canInlineCellWrite } from "./leaf-registers.ts";
import {
  emitBytesLoad,
  emitBytesStore,
  emitBytesWord64Load,
  emitBytesWord64Store,
  type BytesEmitContext,
} from "./memory.ts";
import {
  emitArrayWord64Element,
  emitArrayWord64Store,
  emitWord64Binary,
  emitWord64Constant,
  emitWord64FromNumber,
  emitWord64FromParts,
  emitWord64Part,
  emitWord64ToNumber,
  emitWord64Unary,
  type Word64EmitContext,
} from "./word64.ts";
import {
  emitElementAccess,
  emitGlobalCell,
  emitPropertyAccess,
  emitRecordNew,
  emitScriptEntry,
  type ObjectOpsEmitContext,
} from "./object-ops.ts";
import type {
  RecordDispatchGroup,
  RecordDispatchPlan,
} from "./record-dispatch.ts";
import type { LocalSignatureBinding } from "./signature-groups.ts";
import {
  emitStringCacheOp,
  emitStringCoreOp,
  emitStringTextOp,
  type StringOpsEmitContext,
} from "./string-ops.ts";
import type {
  BranchForms,
  ColdListReadStub,
  ColdReciprocalStub,
  Diagnostic,
  EmissionOptions,
  LeafHelperKind,
  ListReadShape,
  ListWriteShape,
  LocalBranch,
  PreheaderHoistPlan,
} from "./index.ts";

export interface ScalarValue {
  readonly offset: number;
  readonly type: ScalarType;
}

export interface BlockBitTest {
  readonly andId: number;
  readonly source: number;
  readonly n: 0 | 1;
  readonly immr: number;
  readonly imms: number;
}

export interface ActiveFusedAdd {
  readonly add: boolean;
  readonly left: number;
  readonly right: number;
  readonly leftIsInt: boolean;
}

export interface BlockEmitContext {
  readonly absentFlags: (rn: number, scratch: number) => void;
  readonly absentNumber: (rd: number) => void;
  readonly accountedLabels: Set<number>;
  readonly activationOffset: number;
  readonly address: (rd: number, offset: number) => void;
  readonly allocate: (
    prepare: () => void,
    size: (rd: number) => void,
    preserveFloats?: boolean,
    constSize?: number,
  ) => void;
  readonly allocateIndexed: (
    id: number,
    length: number,
    elementShift: number,
    marker: number,
    skipZero?: boolean,
  ) => void;
  readonly allocationOffset: number;
  readonly allocationScratchBytes: 0 | 32;
  readonly allowColdStubs: boolean;
  readonly arrayAtomic: (op: {
    readonly operation: ArrayAtomicOperation;
    readonly id: number | undefined;
    readonly array: number;
    readonly index: number;
    readonly operands: readonly number[];
  }) => void;
  readonly arrayAtomicWord64: (op: {
    readonly operation: ArrayAtomicOperation;
    readonly array: number;
    readonly index: number;
    readonly scratch: number;
  }) => void;
  readonly arrayIndex: (
    array: number,
    index: number,
    vector?: boolean,
  ) => number;
  readonly arrayOf: (read: number) => number;
  readonly arrayOpsCtx: () => ArrayOpsEmitContext;
  readonly arrayView: (op: {
    readonly id: number;
    readonly type: NativeTypedArray;
    readonly buffer: number;
    readonly byteOffset: number;
    readonly length: number;
  }) => void;
  readonly arrayWord64Fill: (op: {
    readonly array: number;
    readonly scratch: number;
    readonly from: number;
    readonly to: number;
  }) => void;
  readonly arrayWord64Read: (op: {
    readonly id: number;
    readonly array: number;
    readonly index: number;
    readonly scratch: number;
  }) => void;
  readonly arrayWord64Write: (op: {
    readonly array: number;
    readonly index: number;
    readonly scratch: number;
  }) => void;
  readonly beginOperation: (
    block: number,
    index: number,
    op: IRInstruction,
  ) => void;
  readonly beginTerminator: (block: number, terminator: IRTerminator) => void;
  readonly binaryImmediate: (op: IRInstruction) => number | undefined;
  readonly branchIsland: () => void;
  readonly bufferByteLength: (buffer: number, rd: number) => void;
  readonly bytesCtx: () => BytesEmitContext;
  readonly word64Ctx: () => Word64EmitContext;
  readonly cInteropCtx: () => CInteropEmitContext;
  readonly callHelper: (kind: LeafHelperKind) => void;
  readonly callRelative: () => void;
  readonly callSites: { offset: number; block: number; index: number }[];
  readonly canDeferColdStub: () => boolean;
  readonly cellFixups: { offset: number; key: string }[];
  readonly cellRequests: Map<string, CellAccess>;
  readonly clearWordCaches: () => void;
  readonly coldListReads: ColdListReadStub[];
  readonly coldReciprocals: ColdReciprocalStub[];
  readonly comparisonOperators: string[];
  readonly contextOffset: number;
  readonly copyFloatWord: (source: number, target: number) => void;
  readonly copyGeneralPair: (source: number, target: number) => void;
  readonly copyRawWord: (source: number, target: number) => void;
  readonly deadClears: readonly (readonly number[])[] | undefined;
  readonly deadSlots: readonly (readonly number[])[] | undefined;
  readonly deferRememberSlow: () =>
    ((emitSlow: () => void) => void) | undefined;
  readonly deferredAllocSlowPaths: (() => void)[];
  readonly deferredIntegers: Map<number, number>;
  readonly descriptorPointer: (record: number) => void;
  readonly directFloatAlias: Map<number, number>;
  readonly directFloatTarget: Uint8Array;
  readonly directIntAlias: Map<number, number>;
  readonly directIntTarget: Uint8Array;
  readonly directReturns: Uint8Array | undefined;
  readonly discardResultTargets: KeyIndex<string, number[]>;
  readonly dispatch: RecordDispatchPlan | undefined;
  readonly dispatchDescriptor: (
    pointer: number,
    chain: { readonly records: readonly number[]; readonly failure: number },
    nonNullKnown: boolean,
    local?: LocalBranch[],
  ) => void;
  readonly edgeBranches: Map<number, number>;
  readonly edgeNurseryBase: Map<number, boolean>;
  readonly edgeWords: Map<number, Map<number, number>>;
  readonly elementToDouble: (type: ScalarType, rd: number, rn: number) => void;
  readonly elidedStoreSource: Map<number, number>;
  readonly emit: (i: Instruction) => void;
  readonly emittedDirectStore: Uint8Array;
  readonly endOperation: () => void;
  readonly entryImports: Map<number, number>;
  readonly environmentOffset: number;
  readonly epilogue: () => void;
  readonly errorDescriptorCount: 4 | 3 | 2;
  readonly exactInteger: (id: number) => boolean;
  readonly exceptionalBranch: (condition: Branch) => void;
  readonly fail: (code: Diagnostic["code"], message: string) => never;
  readonly floatLoad: (rt: number, id: number, byteOffset?: number) => void;
  readonly floatOperand: (id: number, scratch: number) => number;
  readonly floatStore: (rt: number, id: number) => void;
  readonly floatTarget: (id: number, scratch: number) => number;
  readonly flowGuards: Uint8Array | undefined;
  readonly fn: FunctionIR;
  readonly foldedConstants: Uint8Array;
  readonly foldedOptionalWraps: Uint8Array;
  readonly foldedStringWraps: Uint8Array;
  readonly forms: BranchForms;
  readonly forwardable: Set<number>;
  readonly functionEntryPointer: (rd: number, target: number) => void;
  readonly functionRecord: number;
  readonly functionSignaturePointer: (rd: number, target: number) => void;
  readonly fusedAccesses: ReadonlyMap<number, FusedPropertyAccess> | undefined;
  readonly fusedBitTests: Uint8Array;
  readonly fusedDefaults: Uint8Array;
  readonly fusedShifts: Uint8Array;
  readonly generalEqualTags: ReadonlyMap<number, number> | undefined;
  readonly generalPair: (
    register: number,
    offset: number,
    load: boolean,
  ) => void;
  readonly generationalBarriers: boolean;
  readonly guardDescriptor: (
    pointer: number,
    record: number,
    failure?: number,
    layoutKnown?: boolean,
    nonNullKnown?: boolean,
  ) => void;
  readonly hasFunctions: boolean;
  readonly hasScriptOps: boolean;
  readonly hoistedArrayDataValues: Map<number, number>;
  readonly hoistedFloatConst: Map<number, number>;
  readonly hoistedImulConst: Map<number, number>;
  readonly hostCallCtx: () => HostCallEmitContext;
  readonly imm: (rd: number, value: number) => void;
  readonly imm64: (rd: number, lo: number, hi: number) => void;
  readonly incomingGenerals: number[];
  readonly incomingReferences: number[];
  readonly instructions: WordBuffer;
  readonly intOperand: (id: number, rt: number) => void;
  readonly intRegister: (id: number, scratch: number) => number;
  readonly intTarget: (id: number, scratch: number) => number;
  readonly integerArithmetic: (op: IRInstruction) => boolean;
  readonly integerSlots: Uint8Array;
  readonly integerUses: Uint8Array;
  readonly interruptible: boolean;
  readonly inverseCondition: (condition: Condition) => Condition;
  readonly joinLabelRun: (block: number, fused: boolean) => void;
  readonly joins: Set<number>;
  readonly jsConvert: boolean;
  readonly knownBoolFalse: ReadonlySet<number> | undefined;
  readonly knownBoolTrue: ReadonlySet<number> | undefined;
  readonly knownFalseBool: Set<number>;
  readonly knownTrueBool: Set<number>;
  readonly labelRun: number[];
  readonly getLabelRunAt: () => number;
  readonly getLabelRunFused: () => boolean;
  readonly latin1Count: (id: number) => void;
  readonly latin1Index: (id: number, rd: number) => void;
  readonly latin1Range: (lengthOffset: number) => void;
  readonly layoutPairs: Map<number, readonly number[]>;
  readonly lazyActivation: boolean;
  readonly leafBase: Uint8Array | undefined;
  readonly leafReferences: Uint8Array | undefined;
  readonly lengthOnlySlices: Uint8Array;
  readonly linearAllocation: boolean;
  readonly linkLazyActivation: () => void;
  readonly listReadShapes: (id: number) => ListReadShape | undefined;
  readonly literalTwo: Uint8Array;
  readonly localPointer: (rd: number, pages?: boolean) => void;
  readonly signatureGroups: Uint32Array;
  readonly loopPreheaderHoists: Map<number, PreheaderHoistPlan>;
  readonly low32Tree: Uint8Array;
  readonly lowWordStoreValues: Uint8Array;
  readonly managedPointer: (rd: number, request: number) => void;
  readonly materializeInteger: (id: number) => void;
  readonly module: ModuleIR;
  readonly multiplierShift: (constant: number) => number | undefined;
  readonly nanSentinelMagnitudes: Float64Array;
  readonly nanSentinelNonNegative: Uint8Array;
  readonly nanSentinelRemainders: Uint8Array;
  readonly nanSentinelSafe: Uint8Array;
  readonly nanSentinelWords: Uint8Array;
  readonly nonNegative: (id: number) => boolean;
  readonly nonNullValues: Uint8Array;
  readonly nonReferenceTag: (offset: number) => number[];
  readonly noneValues: Uint8Array;
  readonly nonzeroSlots: Uint8Array;
  readonly nonzeroValues: Uint8Array;
  readonly numberConstant: (id: number) => number | undefined;
  readonly objectOpsCtx: () => ObjectOpsEmitContext;
  readonly offsets: (number | undefined)[];
  readonly options: EmissionOptions;
  readonly parameterKeys: readonly string[];
  readonly patchInstruction: (index: number, instruction: Instruction) => void;
  readonly patchLocalBranches: (branches: readonly LocalBranch[]) => void;
  readonly pendingFusedAdd: Map<number, number>;
  readonly pollEntry: boolean;
  readonly pollHeaders: Set<number>;
  readonly pollWorkerStop: () => void;
  readonly poolClears: readonly (readonly number[])[] | undefined;
  readonly poolWordOffset: (word: number) => number;
  readonly preciseRoots: boolean;
  readonly provenListHeader: (list: number, header: number) => number;
  readonly provenNonNull: Uint8Array | undefined;
  readonly provenPresence: Set<IRInstruction>;
  readonly pureLeafNoActivation: Uint8Array | undefined;
  readonly quietNumber: (rd: number, rn: number) => void;
  readonly quietValue: (id: number) => boolean;
  readonly quietValues: Uint8Array;
  readonly rawLoad: (rt: number, offset: number) => void;
  readonly rawRegister: (id: number, scratch: number) => number;
  readonly rawStore: (rt: number | "zr", offset: number) => void;
  readonly rawTarget: (id: number, scratch: number) => number;
  readonly rawValue: (rt: number, id: number) => void;
  readonly reciprocalDivisorOffsets: Uint32Array;
  readonly reciprocalStoreOffsets: Uint32Array;
  readonly recordEdge: (block: number, isBranch: boolean) => void;
  readonly recordGuards: Uint8Array | undefined;
  readonly recordOperations: boolean;
  readonly rememberObject: (
    defer?: (emitSlow: () => void) => void,
    objReg?: number,
    loadContext?: () => void,
    unneeded?: () => readonly number[],
  ) => void;
  readonly resultOffset: number;
  readonly resultPointerOffset: number;
  readonly rootClearBlocks: Uint8Array | undefined;
  readonly rotateAmounts: Uint8Array;
  readonly rotateSources: Uint32Array;
  readonly rotatedShifts: Uint8Array;
  readonly safeSlotBounds: Float64Array;
  readonly safepoint: () => void;
  readonly saveRaw: (rt: number, id: number) => void;
  readonly scalarLoadedSlot: Uint32Array;
  readonly scalarRegisters: Uint8Array | undefined;
  readonly scriptActualPair: (
    index: number,
    offset: number,
    load: boolean,
    scratch: number,
  ) => void;
  readonly scriptArgumentsOffset: number;
  readonly scriptCountOffset: number;
  readonly scriptEntryCallees: ReadonlySet<number> | undefined;
  readonly seededEntries: Map<number, number>;
  readonly selects: SelectDiamondPlan;
  readonly sharing: SlotSharing | undefined;
  readonly shiftedOps: Map<
    number,
    {
      readonly other: number;
      readonly source: number;
      readonly shift: "lsl" | "lsr" | "asr";
      readonly amount: number;
    }
  >;
  readonly signatureImports: Map<number, number>;
  readonly signatures: readonly SignatureLayout[];
  readonly siteGeneralArguments: Map<number, number>;
  readonly skippedCasts: Uint8Array;
  readonly slotIntegerFacts: Uint8Array | undefined;
  readonly slotOffsets: number[];
  readonly slotWordBlocks: Uint32Array;
  readonly slotWordOffsets: number[];
  readonly slotWordValues: Uint32Array;
  readonly soleConsumers: (IRInstruction | undefined)[];
  readonly soleSum: (id: number) => IRInstruction | undefined;
  readonly stableLayouts: boolean;
  readonly stableSlots: boolean;
  readonly stackWords: Map<number, number>;
  readonly start: number;
  readonly storeBypassCandidate: Map<number, number>;
  readonly stringEqual: (
    leftPresent?: boolean,
    rightPresent?: boolean,
    branchTargets?: {
      readonly fnId: number;
      readonly equal: number;
      readonly different: number;
      readonly nextBlock: number | undefined;
    },
  ) => void;
  readonly stringFixups: { offset: number; value: string }[];
  readonly stringLiterals: Map<number, string>;
  readonly stringOpsCtx: () => StringOpsEmitContext;
  readonly teardown: (tail: boolean) => void;
  readonly temporaryGenerals: number[];
  readonly temporaryRoots: number[];
  readonly throwTraces: boolean;
  readonly traceThrow: (payload: number, tag: number | undefined) => void;
  readonly tracker: DebugTracker | undefined;
  readonly transientRegisters: Uint8Array | undefined;
  readonly trapIf: (branch: Branch) => void;
  readonly trapIsland: () => void;
  readonly truncatableAddend: (id: number) => boolean;
  readonly truncatedSums: Uint8Array;
  readonly truth: (operand: number, invert: boolean) => void;
  readonly typeErrorRecord: number;
  readonly typedArrayType: (type: ScalarType) => NativeTypedArray;
  readonly undefinedValues: Uint8Array;
  readonly unsignedTruncateCandidate: Uint8Array;
  readonly useCounts: Uint32Array;
  readonly valueIds: NumberIndex;
  readonly valueUses: Uint32Array;
  readonly vectorShapes: readonly (number | undefined)[];
  readonly viewAccesses: boolean;
  readonly viewEntries: Map<number, number>;
  readonly viewExitSlots: Map<number, number[]>;
  readonly viewExitTokens: Map<number, number>;
  readonly viewSlots: Map<number, number>;
  readonly viewValueToken: (id: number) => number;
  readonly viewValueTokens: Map<number, number>;
  readonly weakHeader: (cell: number) => void;
  readonly wordConstants: Uint32Array;
  readonly wordKinds: Uint8Array;
  readonly wordMagnitude: (index: number) => number;
  readonly wordMagnitudes: Float64Array;
  readonly wordMultiplierShift: (constant: number) => number;
  readonly wordOnlySlots: Uint8Array;
  readonly wordOperand: (id: number, scratch: number) => number;
  readonly wordReturns: Uint8Array;
  readonly wordValue: (id: number) => void;
  readonly workerStopPoll: () => void;
  readonly wrappedStringSources: Uint32Array;
  readonly wrappedStrings: Uint8Array;
  readonly writeInteger: (constant: number, offset: number) => void;
  readonly writeShapes: readonly (ListWriteShape | undefined)[];
  readonly zeroConstants: Uint8Array;
  readonly zeroSignResults: Uint8Array;
  readonly zeroValues: Uint8Array;
  readonly zeroWords: (offsets: readonly number[]) => void;
  readonly layout: readonly number[];
  readonly values: readonly (ScalarValue | undefined)[];
  readonly integerStorage: Uint8Array;
  readonly wordStorage: Uint8Array | undefined;
  readonly vectorHeader: (vector: number) => void;
  readonly branch: (
    branch: Branch,
    targetFunction: number,
    targetBlock: number | undefined,
  ) => void;
  readonly setBlockId: (id: number) => void;
  readonly setCachedNurseryBaseInX16: (v: boolean) => void;
  readonly setBatch: (kind: number, total: number) => void;
  readonly setFrameStart: (v: number) => void;
  readonly setSiteIndex: (v: number) => void;
  readonly setSpan: (s: Span | undefined) => void;
  readonly setTailExitBlock: (v: number) => void;
}

export function emitFunctionBlocks(ctx: BlockEmitContext): void {
  const {
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
    getLabelRunAt,
    getLabelRunFused,
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
    setBlockId,
    setCachedNurseryBaseInX16,
    setBatch,
    setFrameStart,
    setSiteIndex,
    setSpan,
    setTailExitBlock,
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
  let viewToken = -1;
  let viewSlotTokens: number[] = [];
  let siteIndex = 0;
  let tailExitBlock: number | undefined;
  for (let position = 0; position < layout.length; position++) {
    const b = fn.blocks[layout[position] ?? -1];
    if (b === undefined) throw "block invariant";
    deferredIntegers.clear();
    // Fused dispatch/select continuations are unreachable; their head
    // already executed them.
    if (dispatch?.fused[b.id] === 1 || selects.fused[b.id] === 1) {
      clearWordCaches();
      offsets[b.id * 2] = instructions.length * 4;
      joinLabelRun(b.id, true);
      continue;
    }
    let nextPosition = position + 1;
    while (nextPosition < layout.length) {
      const candidate = layout[nextPosition];
      if (
        candidate === undefined ||
        (dispatch?.fused[candidate] !== 1 && selects.fused[candidate] !== 1)
      )
        break;
      nextPosition++;
    }
    const nextBlock = layout[nextPosition];
    const transient = transientRegisters,
      storage = scalarRegisters;
    if (transient !== undefined && storage !== undefined)
      for (const op of b.instructions) {
        if (op === undefined) throw "temporary instruction invariant";
        const id = instructionResult(op);
        if (id !== undefined) {
          const reg = transient[valueIds.intern(id)] ?? 0;
          if (reg !== 0) storage[value(id).offset / 8] = reg;
        }
      }
    if (leafReferences !== undefined && storage !== undefined)
      for (const op of b.instructions) {
        if (op === undefined) throw "leaf reference instruction invariant";
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
    const emptyBefore = getLabelRunAt() === instructions.length;
    let entry: Map<number, number> | undefined,
      runRecorded = false;
    if (
      forwardable.has(b.id) &&
      !(emptyBefore && getLabelRunFused()) &&
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
    setBlockId(b.id);
    clearWordCaches();
    if (entry !== undefined) {
      for (const [offset, held] of entry) stackWords.set(offset, held);
      if (!forms.farBranches.has(fn.id) && edgeNurseryBase.get(b.id) === true)
        setCachedNurseryBaseInX16(true);
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
    setSpan(undefined);
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
      if (sharing !== undefined && sharing.otherLiveIn(slot, b.id)) continue;
      const type = fn.slots[slot];
      if (type === undefined) throw "dead slot invariant";
      if (managed(type) || type === "general") clears.push(slotOffset(slot));
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
        viewPredecessor < 0 ? undefined : viewExitSlots.get(viewPredecessor);
    viewToken =
      inheritedSlots === undefined
        ? -1
        : (viewExitTokens.get(viewPredecessor) ?? -1);
    if (inheritedSlots !== undefined) viewSlotTokens = inheritedSlots.slice();
    else {
      viewSlotTokens = [];
      for (let index = 0; index < viewSlots.size; index++)
        viewSlotTokens.push(-1);
    }
    if (pollHeaders.has(b.id) || (pollEntry && b.id === fn.entry))
      workerStopPoll();
    // SSA values are block-local. A comparison used by the branch has no
    // other consumer when followed only by flag-preserving stores of
    // other values, so its flags can replace a boolean carrier.
    const blockDiamond = selects.diamonds.get(b.id),
      blockTerm = b.terminator;
    if (knownTrueBool.size > 0) knownTrueBool.clear();
    if (knownFalseBool.size > 0) knownFalseBool.clear();
    let comparisonValue: number | undefined = undefined,
      comparisonIndex = -1;
    if (blockTerm.kind === "branch") {
      const condId = blockTerm.condition;
      let scan = b.instructions.length - 1;
      while (scan >= 0) {
        const tail = b.instructions[scan];
        if (
          tail !== undefined &&
          tail.kind === "store" &&
          tail.value !== condId &&
          (integerSlots[tail.slot] !== 1 || storedAsInteger(tail.value))
        )
          scan--;
        else break;
      }
      const candidate = scan >= 0 ? b.instructions[scan] : undefined;
      const nestedSafe =
        blockDiamond?.nested === undefined ||
        (scan === b.instructions.length - 1 &&
          candidate !== undefined &&
          (candidate.kind === "optional-present" ||
            (candidate.kind === "binary" &&
              (candidate.operator === "===" ||
                candidate.operator === "!==" ||
                candidate.operator === "==" ||
                candidate.operator === "!=" ||
                candidate.operator === "<" ||
                candidate.operator === "<=" ||
                candidate.operator === ">" ||
                candidate.operator === ">=") &&
              (typeOf(candidate.left) === "number" ||
                typeOf(candidate.left) === "boolean" ||
                typeOf(candidate.left) === "reference" ||
                typeOf(candidate.left) === "optional-reference"))));
      if (
        candidate !== undefined &&
        (candidate.kind === "binary" ||
          candidate.kind === "general-is" ||
          candidate.kind === "optional-present") &&
        candidate.id === condId &&
        nestedSafe
      ) {
        comparisonValue = candidate.id;
        comparisonIndex = scan;
      }
    }
    let comparisonBranch: Condition | "emitted" | undefined = undefined;
    const fusion = fusedAccesses?.get(b.id);
    if (
      fusion !== undefined &&
      fusion.test !== undefined &&
      comparisonValue === fusion.test
    ) {
      comparisonValue = -1;
      comparisonIndex = -1;
    }
    const presentOp = trailingStringPresent(b),
      foldedPresentOp =
        presentOp !== undefined &&
        (useCounts[valueIds.intern(presentOp.id)] ?? 0) === 1 &&
        presentSourceSurvivesTrailingStores(
          b,
          presentOp.index,
          value(presentOp.value).offset,
          homeOf(presentOp.value),
          slotOffsets,
          scalarRegisters,
        )
          ? presentOp
          : undefined,
      foldedPresent =
        foldedPresentOp === undefined ? undefined : foldedPresentOp.id,
      foldedPresentSource =
        foldedPresentOp === undefined ? undefined : foldedPresentOp.value;
    let blockBitTest:
      | {
          readonly andId: number;
          readonly source: number;
          readonly n: 0 | 1;
          readonly immr: number;
          readonly imms: number;
        }
      | undefined = undefined;
    if (
      comparisonValue !== undefined &&
      comparisonIndex >= 1 &&
      blockDiamond?.nested === undefined
    ) {
      const cmpOp = b.instructions[comparisonIndex];
      if (
        cmpOp !== undefined &&
        cmpOp.kind === "binary" &&
        (cmpOp.operator === "===" ||
          cmpOp.operator === "!==" ||
          cmpOp.operator === "==" ||
          cmpOp.operator === "!=") &&
        typeOf(cmpOp.left) === "number"
      ) {
        const rZero = zeroConstants[valueIds.intern(cmpOp.right)] === 1,
          lZero = zeroConstants[valueIds.intern(cmpOp.left)] === 1;
        if (rZero !== lZero) {
          const bitId = rZero ? cmpOp.left : cmpOp.right;
          if ((valueUses[valueIds.intern(bitId)] ?? 0) === 1) {
            let scanBit = comparisonIndex - 1;
            while (scanBit >= 0 && b.instructions[scanBit]?.kind === "constant")
              scanBit--;
            const bitOp = scanBit >= 0 ? b.instructions[scanBit] : undefined;
            if (
              bitOp !== undefined &&
              bitOp.kind === "binary" &&
              bitOp.operator === "&" &&
              bitOp.id === bitId &&
              bitOp.left !== bitOp.right &&
              !shiftedOps.has(bitOp.id) &&
              rotatedShifts[valueIds.intern(bitOp.id)] !== 1 &&
              fusedShifts[valueIds.intern(bitOp.id)] !== 1
            ) {
              const lc = numberConstant(bitOp.left),
                rc = numberConstant(bitOp.right);
              const mask = rc ?? lc;
              const source = rc !== undefined ? bitOp.left : bitOp.right;
              if (mask !== undefined) {
                const fields = logicalImmediate32(mask >>> 0);
                if (fields !== undefined) {
                  fusedBitTests[valueIds.intern(bitOp.id)] = 1;
                  blockBitTest = {
                    andId: bitOp.id,
                    source,
                    n: fields.n,
                    immr: fields.immr,
                    imms: fields.imms,
                  };
                }
              }
            }
          }
        }
      }
    }
    const activeFusedAdd = new Map<
      number,
      {
        readonly add: boolean;
        readonly left: number;
        readonly right: number;
        readonly leftIsInt: boolean;
      }
    >();
    /** Optional-number `?? 0` values elided directly into a fused
     * `(int +/- (opt ?? 0)) | 0`: FJCVTZS sets Z=0 for NaN (including
     * absentNumber), routing undefined cleanly to the slow path. */
    const elidedOptOr = new Map<number, number>();
    // Bitwise results feeding only an adjacent non-clamped integer
    // typed-array store need no sxtw (and redundant |0/^0/&0xff/&0xffff
    // masks can be bypassed when the source is already an exact integer).
    for (let at = 1; at < b.instructions.length; at++) {
      const op = b.instructions[at];
      if (op === undefined) continue;
      if (
        op.kind === "store" &&
        wordOnlySlots[op.slot] === 1 &&
        (valueUses[valueIds.intern(op.value)] ?? 0) === 1
      ) {
        lowWordStoreValues[valueIds.intern(op.value)] = 1;
        continue;
      }
      if (op.kind !== "array-store") continue;
      const arrType = value(op.array).type,
        elem = typedArrayLayout(typedArrayType(arrType)).element,
        scale = typedArrayScale(arrType);
      if (
        elem === "float" ||
        elem === "clamped" ||
        (valueUses[valueIds.intern(op.value)] ?? 0) !== 1
      )
        continue;
      const prev = b.instructions[at - 1];
      if (
        prev === undefined ||
        prev.kind !== "binary" ||
        prev.id !== op.value ||
        !["&", "|", "^", "<<", ">>", ">>>", "imul"].includes(prev.operator)
      )
        continue;
      lowWordStoreValues[valueIds.intern(prev.id)] = 1;
      if (
        (prev.operator === "|" || prev.operator === "^") &&
        !pendingFusedAdd.has(prev.left) &&
        !pendingFusedAdd.has(prev.right)
      ) {
        if (zeroConstants[valueIds.intern(prev.right)] === 1)
          storeBypassCandidate.set(prev.id, prev.left);
        else if (zeroConstants[valueIds.intern(prev.left)] === 1)
          storeBypassCandidate.set(prev.id, prev.right);
      } else if (prev.operator === "&" && (scale === 0 || scale === 1)) {
        const need = scale === 0 ? 0xff : 0xffff,
          rc = numberConstant(prev.right),
          lc = numberConstant(prev.left);
        if (rc !== undefined && Number.isInteger(rc) && (rc & need) === need)
          storeBypassCandidate.set(prev.id, prev.left);
        else if (
          lc !== undefined &&
          Number.isInteger(lc) &&
          (lc & need) === need
        )
          storeBypassCandidate.set(prev.id, prev.right);
      }
    }
    // Direct-to-slot register targeting: when a binary op feeds a store
    // into a register-homed slot (FP number slot or GP integer slot) and
    // nothing between them touches that register or throws, compute
    // directly into the slot register (eliminating 2-cycle FP fmov on
    // loop-carried sums/stencils and redundant GP mov on loop counters).
    directIntAlias.clear();
    directFloatAlias.clear();
    if (tracker === undefined && scalarRegisters !== undefined) {
      const regs = scalarRegisters;
      const claimedUntil = new Map<number, number>();
      function directTargetOf(id: number): number {
        const src = storeBypassCandidate.get(id) ?? id,
          idx = valueIds.intern(src),
          dInt = directIntTarget[idx] ?? 0;
        if (dInt !== 0) return dInt - 1 + 32;
        const dFloat = directFloatTarget[idx] ?? 0;
        if (dFloat !== 0) return dFloat - 1;
        return 0;
      }
      function definesDestReg(inst: IRInstruction, destReg: number): boolean {
        const res = instructionResult(inst);
        return (
          res !== undefined &&
          (homeOf(res) === destReg || directTargetOf(res) === destReg)
        );
      }
      for (let sIdx = 0; sIdx < b.instructions.length; sIdx++) {
        const sOp = b.instructions[sIdx];
        if (
          sOp === undefined ||
          sOp.kind !== "store" ||
          fn.slots[sOp.slot] !== "number"
        )
          continue;
        if ((reciprocalStoreOffsets[sOp.slot] ?? 0) > 0) continue;
        const isIntSlot = integerSlots[sOp.slot] === 1;
        const destReg = regs[slotOffset(sOp.slot) / 8] ?? 0;
        if (isIntSlot ? destReg < 32 : destReg === 0 || destReg >= 32) continue;
        const valIdx = valueIds.intern(sOp.value),
          useTotal = valueUses[valIdx] ?? 0;
        if (useTotal < 1) continue;
        if (isIntSlot && directIntTarget[valIdx] !== 0) continue;
        if (!isIntSlot && directFloatTarget[valIdx] !== 0) continue;
        if (isIntSlot && useTotal > 1 && wordOnlySlots[sOp.slot] === 1)
          continue;
        let defIdx = -1,
          safe = true;
        for (let k = sIdx - 1; k >= 0; k--) {
          const mid = b.instructions[k];
          if (mid === undefined) {
            safe = false;
            break;
          }
          if (
            (mid.kind === "binary" ||
              (isIntSlot &&
                mid.kind === "unary" &&
                mid.operator === "uint32")) &&
            mid.id === sOp.value
          ) {
            defIdx = k;
            break;
          }
          if (
            mid.kind !== "load" &&
            mid.kind !== "store" &&
            mid.kind !== "constant" &&
            mid.kind !== "binary" &&
            mid.kind !== "unary" &&
            mid.kind !== "array-element" &&
            mid.kind !== "array-store" &&
            mid.kind !== "array-length" &&
            mid.kind !== "string-length" &&
            mid.kind !== "reference-value" &&
            mid.kind !== "optional-wrap"
          ) {
            safe = false;
            break;
          }
          if (
            ((mid.kind === "load" || mid.kind === "store") &&
              (regs[slotOffset(mid.slot) / 8] ?? 0) === destReg) ||
            definesDestReg(mid, destReg)
          ) {
            safe = false;
            break;
          }
        }
        if (!safe || defIdx < 0) continue;
        let ins = b.instructions[defIdx],
          targetValId = sOp.value,
          targetValIdx = valIdx,
          bypassOrIdx = -1;
        // When storing `uint32(x)` to an integer slot where `x` is a
        // single-use integer `binary` op in this block, elide the
        // identity `uint32` copy and target `x` directly into `destReg`.
        if (
          isIntSlot &&
          ins !== undefined &&
          ins.kind === "unary" &&
          ins.operator === "uint32" &&
          !storeBypassCandidate.has(ins.id)
        ) {
          const innerId = ins.operand,
            innerIdx = valueIds.intern(innerId);
          if ((valueUses[innerIdx] ?? 0) === 1) {
            let innerDef = -1,
              innerSafe = true;
            for (let k = defIdx - 1; k >= 0; k--) {
              const mid = b.instructions[k];
              if (mid === undefined) {
                innerSafe = false;
                break;
              }
              if (mid.kind === "binary" && mid.id === innerId) {
                innerDef = k;
                break;
              }
              if (
                mid.kind !== "load" &&
                mid.kind !== "store" &&
                mid.kind !== "constant" &&
                mid.kind !== "binary" &&
                mid.kind !== "unary"
              ) {
                innerSafe = false;
                break;
              }
              if (
                ((mid.kind === "load" || mid.kind === "store") &&
                  (regs[slotOffset(mid.slot) / 8] ?? 0) === destReg) ||
                definesDestReg(mid, destReg)
              ) {
                innerSafe = false;
                break;
              }
            }
            const innerOp =
              innerSafe && innerDef >= 0 ? b.instructions[innerDef] : undefined;
            if (
              innerOp !== undefined &&
              innerOp.kind === "binary" &&
              (innerOp.operator === "+" ||
                innerOp.operator === "-" ||
                innerOp.operator === "*") &&
              !pendingFusedAdd.has(innerOp.id)
            ) {
              bypassOrIdx = defIdx;
              defIdx = innerDef;
              ins = innerOp;
              targetValId = innerId;
              targetValIdx = innerIdx;
            }
          }
        }
        if (
          ins === undefined ||
          ins.kind !== "binary" ||
          pendingFusedAdd.has(ins.id)
        )
          continue;
        // When storing `(x | 0)` / `(x ^ 0)` (with a signed 32-bit
        // bitwise `x`) or `(x >>> 0)` (with an exact integer `+`/`-` `x`)
        // to an integer slot, elide the identity mask/shift and compute
        // `x` directly into `destReg` (32-bit `add`/`sub` for `>>> 0`).
        let bypassTruncatedSum = false;
        const isBitwiseZero =
          isIntSlot &&
          (ins.operator === "|" || ins.operator === "^") &&
          !pendingFusedAdd.has(ins.left) &&
          !pendingFusedAdd.has(ins.right) &&
          !storeBypassCandidate.has(ins.id) &&
          (zeroConstants[valueIds.intern(ins.right)] === 1 ||
            zeroConstants[valueIds.intern(ins.left)] === 1);
        const isUnsignedZero =
          isIntSlot &&
          ins.operator === ">>>" &&
          !storeBypassCandidate.has(ins.id) &&
          zeroConstants[valueIds.intern(ins.right)] === 1;
        if (isBitwiseZero || isUnsignedZero) {
          const innerId = isUnsignedZero
              ? ins.left
              : zeroConstants[valueIds.intern(ins.right)] === 1
                ? ins.left
                : ins.right,
            innerIdx = valueIds.intern(innerId);
          if (
            (valueUses[innerIdx] ?? 0) === 1 &&
            directIntTarget[innerIdx] === 0
          ) {
            let innerDef = -1,
              innerSafe = true;
            for (let k = defIdx - 1; k >= 0; k--) {
              const mid = b.instructions[k];
              if (mid === undefined) {
                innerSafe = false;
                break;
              }
              if (mid.kind === "binary" && mid.id === innerId) {
                innerDef = k;
                break;
              }
              if (
                mid.kind !== "load" &&
                mid.kind !== "store" &&
                mid.kind !== "constant" &&
                mid.kind !== "binary" &&
                mid.kind !== "unary"
              ) {
                innerSafe = false;
                break;
              }
              if (
                ((mid.kind === "load" || mid.kind === "store") &&
                  (regs[slotOffset(mid.slot) / 8] ?? 0) === destReg) ||
                definesDestReg(mid, destReg)
              ) {
                innerSafe = false;
                break;
              }
            }
            const innerOp =
              innerSafe && innerDef >= 0 ? b.instructions[innerDef] : undefined;
            if (
              isBitwiseZero &&
              innerOp !== undefined &&
              innerOp.kind === "binary" &&
              ["&", "|", "^", "<<", ">>", "imul"].includes(innerOp.operator) &&
              (!storedAsWord(innerId) ||
                (useTotal === 1 && wordOnlySlots[sOp.slot] === 1)) &&
              rotatedShifts[innerIdx] !== 1 &&
              fusedShifts[innerIdx] !== 1 &&
              !storeBypassCandidate.has(innerOp.id) &&
              !pendingFusedAdd.has(innerOp.id)
            ) {
              bypassOrIdx = defIdx;
              defIdx = innerDef;
              ins = innerOp;
              targetValId = innerId;
              targetValIdx = innerIdx;
            } else if (
              isUnsignedZero &&
              innerOp !== undefined &&
              innerOp.kind === "binary" &&
              (innerOp.operator === "+" || innerOp.operator === "-") &&
              wantsInteger(innerOp.id) &&
              zeroSignResults[innerIdx] !== 1 &&
              !storeBypassCandidate.has(innerOp.id) &&
              !pendingFusedAdd.has(innerOp.id)
            ) {
              bypassOrIdx = defIdx;
              bypassTruncatedSum = true;
              defIdx = innerDef;
              ins = innerOp;
              targetValId = innerId;
              targetValIdx = innerIdx;
            }
          }
        }
        if (ins === undefined || ins.kind !== "binary") continue;
        if (isIntSlot) {
          if (
            ins.operator !== "+" &&
            ins.operator !== "-" &&
            ins.operator !== "*" &&
            ins.operator !== "&" &&
            ins.operator !== "|" &&
            ins.operator !== "^" &&
            ins.operator !== "<<" &&
            ins.operator !== ">>" &&
            ins.operator !== ">>>" &&
            ins.operator !== "imul"
          )
            continue;
          if (
            rotatedShifts[targetValIdx] === 1 ||
            fusedShifts[targetValIdx] === 1 ||
            storeBypassCandidate.has(ins.id)
          )
            continue;
        } else if (
          !["+", "-", "*", "/", "min", "max"].includes(ins.operator) ||
          integerUses[targetValIdx] === 1
        )
          continue;
        // For multi-use FP or GP integer values, every other consumer
        // must live in this block, read directly from the register home,
        // and no write to `destReg` (or call) may occur before the last
        // use of `sOp.value`.
        if (defIdx <= (claimedUntil.get(destReg) ?? -1)) continue;
        if (
          isIntSlot &&
          ((useTotal > 1 && !wantsInteger(targetValId)) ||
            (!wantsInteger(targetValId) && !storedAsWord(targetValId)))
        )
          continue;
        let lastUse = sIdx,
          blockUses = 0;
        if (useTotal > 1) {
          for (let k = defIdx + 1; k < b.instructions.length; k++) {
            const later = b.instructions[k];
            if (later === undefined) {
              safe = false;
              break;
            }
            let usesVal = false;
            visitInstructionOperands(later, (id) => {
              if (id === sOp.value) {
                usesVal = true;
                blockUses++;
              }
            });
            if (usesVal) {
              if (k > lastUse) lastUse = k;
              if (k !== sIdx) {
                const isCmp =
                  later.kind === "binary" &&
                  ["===", "!==", "==", "!=", "<", "<=", ">", ">="].includes(
                    later.operator,
                  );
                if (isCmp) lastUse = b.instructions.length - 1;
                const okConsumer = isIntSlot
                  ? (later.kind === "array-element" &&
                      later.index === sOp.value) ||
                    (later.kind === "array-store" &&
                      later.index === sOp.value &&
                      later.value !== sOp.value) ||
                    (later.kind === "binary" &&
                      ((wantsInteger(later.id) &&
                        zeroSignResults[valueIds.intern(later.id)] !== 1) ||
                        isCmp ||
                        ["&", "|", "^", "<<", ">>", ">>>", "imul"].includes(
                          later.operator,
                        )))
                  : (later.kind === "array-store" &&
                      later.value === sOp.value &&
                      later.index !== sOp.value &&
                      (value(later.array).type === "Float64Array" ||
                        value(later.array).type === "Float32Array" ||
                        value(later.array).type === "Float16Array")) ||
                    (later.kind === "binary" &&
                      ["+", "-", "*", "/", "min", "max"].includes(
                        later.operator,
                      ));
                if (!okConsumer) {
                  safe = false;
                  break;
                }
              }
            }
          }
          if (blockUses !== useTotal) safe = false;
          visitTerminatorOperands(b.terminator, (id) => {
            if (id === sOp.value) safe = false;
          });
          for (let k = defIdx + 1; safe && k <= lastUse; k++) {
            if (k === sIdx || k === bypassOrIdx) continue;
            const later = b.instructions[k];
            if (
              later === undefined ||
              (later.kind === "store" &&
                (regs[slotOffset(later.slot) / 8] ?? 0) === destReg) ||
              definesDestReg(later, destReg)
            )
              safe = false;
            else if (
              later.kind !== "load" &&
              later.kind !== "store" &&
              later.kind !== "constant" &&
              later.kind !== "binary" &&
              later.kind !== "unary" &&
              later.kind !== "array-element" &&
              later.kind !== "array-store" &&
              later.kind !== "array-length" &&
              later.kind !== "string-length" &&
              later.kind !== "reference-value" &&
              later.kind !== "optional-wrap"
            )
              safe = false;
          }
          if (!safe) continue;
        }
        const checkLiveReg = (id: number): void => {
          if (
            id !== sOp.value &&
            id !== targetValId &&
            (homeOf(id) === destReg || directTargetOf(id) === destReg)
          )
            safe = false;
        };
        for (let k = defIdx + 1; k < b.instructions.length; k++) {
          if (k === sIdx || k === bypassOrIdx) continue;
          const later = b.instructions[k];
          if (later !== undefined)
            visitInstructionOperands(later, checkLiveReg);
        }
        visitTerminatorOperands(b.terminator, checkLiveReg);
        if (!safe) continue;
        if (bypassOrIdx >= 0) {
          storeBypassCandidate.set(sOp.value, targetValId);
          if (bypassTruncatedSum) unsignedTruncateCandidate[targetValIdx] = 1;
          if (useTotal === 1 && wordOnlySlots[sOp.slot] === 1)
            lowWordStoreValues[targetValIdx] = 1;
        }
        if (isIntSlot) directIntTarget[targetValIdx] = destReg - 32 + 1;
        else directFloatTarget[targetValIdx] = destReg + 1;
        claimedUntil.set(
          destReg,
          Math.max(claimedUntil.get(destReg) ?? -1, lastUse),
        );
      }
    }
    const directGeneralTarget =
      hasScriptOps && tracker === undefined
        ? planDirectGeneralTargets({
            block: b,
            slots: fn.slots,
            slotOffset,
            valueUses,
            internValue: (id: number): number => valueIds.intern(id),
            foldedConstants,
            ...(fusion === undefined
              ? {}
              : {
                  skippedStores: fusion.skipped,
                  fusionAccessId: fusion.access,
                  ...(fusion.test === undefined
                    ? {}
                    : { fusionTestId: fusion.test }),
                }),
          })
        : undefined;
    const loadFloatSelectArm = (arm: SelectArm, scratch: number): number => {
      if (arm.kind === "load") {
        const offset = slotOffset(arm.slot),
          reg = scalarRegisters?.[offset / 8] ?? 0;
        if (integerSlots[arm.slot] === 1) {
          const intReg = reg >= 32 ? reg - 32 : 9;
          if (reg < 32) rawLoad(9, offset);
          emit({ op: "scvtf-d-x", rd: scratch, rn: intReg });
          return scratch;
        }
        if (reg > 0 && reg < 32) return reg;
        if (reg >= 32) emit({ op: "fmov-d-x", rd: scratch, rn: reg - 32 });
        else emit({ op: "ldr-d", rt: scratch, rn: "sp", offset });
        return scratch;
      }
      const constant = arm.value;
      if (typeof constant !== "number") throw "float select arm invariant";
      const bits = encodeFloat64(constant);
      if (bits.lo === 0 && bits.hi === 0) {
        emit({ op: "fmov-d-x", rd: scratch, rn: "zr" });
        return scratch;
      }
      const immediate = float64Immediate(constant);
      if (immediate !== undefined) {
        emit({ op: "fmov-d-imm", rd: scratch, imm8: immediate });
        return scratch;
      }
      imm64(9, bits.lo, bits.hi);
      emit({ op: "fmov-d-x", rd: scratch, rn: 9 });
      return scratch;
    };
    const loadRawSelectArm = (
      arm: SelectArm,
      scratch: number,
    ): number | "zr" => {
      if (arm.kind === "none") return "zr";
      if (arm.kind === "constant") {
        const constant = arm.value;
        if (typeof constant === "boolean") {
          if (!constant) return "zr";
          imm(scratch, 1);
          return scratch;
        }
        const lo = ((constant % 4294967296) + 4294967296) % 4294967296,
          hi = (Math.floor(constant / 4294967296) + 4294967296) % 4294967296;
        if (lo === 0 && hi === 0) return "zr";
        imm64(scratch, lo, hi);
        return scratch;
      }
      const offset = slotOffset(arm.slot),
        reg = scalarRegisters?.[offset / 8] ?? 0;
      if (reg >= 32) return reg - 32;
      rawLoad(scratch, offset);
      return scratch;
    };
    const emitNestedSelect = (nested: NestedSelect, isFloat: boolean): void => {
      clearWordCaches();
      const cmp = nested.compare;
      let innerCond: Condition;
      let cachedCmpLeftReg = -1,
        cachedCmpRightReg = -1;
      if (cmp.type === "number") {
        const isIntOperand = (arm: SelectArm): boolean =>
          arm.kind === "load"
            ? integerSlots[arm.slot] === 1
            : arm.kind === "constant" &&
              typeof arm.value === "number" &&
              Number.isSafeInteger(arm.value) &&
              !(arm.value === 0 && 1 / arm.value < 0);
        const integerCmp = isIntOperand(cmp.left) && isIntOperand(cmp.right);
        if (integerCmp) {
          const lReg = loadRawSelectArm(cmp.left, 9),
            rReg = loadRawSelectArm(cmp.right, 10);
          emit({
            op: "sub-reg",
            width: 64,
            rd: "zr",
            rn: lReg,
            rm: rReg,
            shift: "lsl",
            amount: 0,
            setFlags: true,
          });
        } else {
          const lReg = loadFloatSelectArm(cmp.left, 0),
            rReg = loadFloatSelectArm(cmp.right, 1);
          cachedCmpLeftReg = lReg;
          cachedCmpRightReg = rReg;
          emit({ op: "fcmp", rn: lReg, rm: rReg });
        }
        innerCond =
          cmp.operator === "===" || cmp.operator === "=="
            ? "eq"
            : cmp.operator === "!==" || cmp.operator === "!="
              ? "ne"
              : cmp.operator === "<"
                ? integerCmp
                  ? "lt"
                  : "mi"
                : cmp.operator === "<="
                  ? integerCmp
                    ? "le"
                    : "ls"
                  : cmp.operator === ">"
                    ? "gt"
                    : "ge";
      } else {
        const lReg = loadRawSelectArm(cmp.left, 9),
          rReg = loadRawSelectArm(cmp.right, 10);
        emit({
          op: "sub-reg",
          width: 64,
          rd: "zr",
          rn: lReg,
          rm: rReg,
          shift: "lsl",
          amount: 0,
          setFlags: true,
        });
        innerCond =
          cmp.operator === "===" || cmp.operator === "==" ? "eq" : "ne";
      }
      if (isFloat) {
        const sameFloat = (a: number | boolean, b: number | boolean): boolean =>
          typeof a === "number" &&
          typeof b === "number" &&
          a === b &&
          (a !== 0 || 1 / a === 1 / b);
        const reuseFloat = (arm: SelectArm, scratch: number): number => {
          if (
            cachedCmpRightReg >= 0 &&
            arm.kind === "constant" &&
            cmp.right.kind === "constant" &&
            sameFloat(arm.value, cmp.right.value)
          )
            return cachedCmpRightReg;
          if (
            cachedCmpLeftReg >= 0 &&
            arm.kind === "constant" &&
            cmp.left.kind === "constant" &&
            sameFloat(arm.value, cmp.left.value)
          )
            return cachedCmpLeftReg;
          return loadFloatSelectArm(arm, scratch);
        };
        const tReg = reuseFloat(nested.innerDiamond.trueArm, 0),
          fReg = reuseFloat(nested.innerDiamond.falseArm, tReg === 1 ? 0 : 1);
        emit({
          op: "fcsel",
          rd: 2,
          rn: tReg,
          rm: fReg,
          condition: innerCond,
        });
      } else {
        const tReg = loadRawSelectArm(nested.innerDiamond.trueArm, 9),
          fReg = loadRawSelectArm(nested.innerDiamond.falseArm, 10);
        emit({
          op: "csel",
          width: 64,
          rd: 14,
          rn: tReg,
          rm: fReg,
          condition: innerCond,
        });
      }
      clearWordCaches();
    };
    const blockNested = blockDiamond?.nested;
    const recordInstructionFacts = (op: IRInstruction): void => {
      if (op.kind === "load") {
        const index = valueIds.intern(op.id);
        if (slotIntegerFacts !== undefined) {
          const mask = slotIntegerFacts[op.slot] ?? 0,
            safeBound = safeSlotBounds[op.slot] ?? 0;
          if (fn.slots[op.slot] === "number") {
            if (mask === 1) {
              wordKinds[index] = 2;
              if (safeBound > 0) wordMagnitudes[index] = safeBound;
            } else if (safeBound > 0) {
              wordKinds[index] = 6;
              wordMagnitudes[index] = safeBound;
            } else if (mask !== 0 && (mask & ~3) === 0) wordKinds[index] = 5;
          } else if (
            fn.slots[op.slot] === "optional-number" &&
            mask !== 0 &&
            (mask & ~9) === 0
          )
            wordKinds[index] = 4;
        }
        if (fn.slots[op.slot] === "number") {
          if (integerSlots[op.slot] === 1)
            scalarLoadedSlot[index] = op.slot + 1;
          if (nonzeroSlots[op.slot] === 1) nonzeroValues[index] = 1;
        }
      }
      if (stableLayouts) {
        if (
          op.kind === "reference-value" ||
          op.kind === "primitive-wrap" ||
          op.kind === "primitive-reference" ||
          op.kind === "record-new" ||
          op.kind === "array-new" ||
          op.kind === "reference-vector-new" ||
          op.kind === "function-new" ||
          op.kind === "string-literal"
        )
          nonNullValues[valueIds.intern(op.id)] = 1;
        else if (op.kind === "reference-wrap")
          nonNullValues[valueIds.intern(op.id)] =
            nonNullValues[valueIds.intern(op.value)] ?? 0;
        else if (op.kind === "load" && slotWordBlocks[op.slot] === b.id + 1) {
          const stored = slotWordValues[op.slot];
          if (stored === undefined) throw "nonnull slot invariant";
          nonNullValues[valueIds.intern(op.id)] = nonNullValues[stored] ?? 0;
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
            op.operator === "fround" ||
            op.operator === "f16round" ||
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
          ["&", "|", "^", "<<", ">>", ">>>", "imul"].includes(op.operator))
      ) {
        const index = valueIds.intern(op.id);
        wordKinds[index] = 2;
        if (op.kind === "binary" && op.operator === "&") {
          const lc = numberConstant(op.left),
            rc = numberConstant(op.right);
          const mask =
            rc !== undefined &&
            Number.isInteger(rc) &&
            rc >= 0 &&
            rc <= 2147483647
              ? rc
              : lc !== undefined &&
                  Number.isInteger(lc) &&
                  lc >= 0 &&
                  lc <= 2147483647
                ? lc
                : undefined;
          if (mask !== undefined) wordMagnitudes[index] = Math.max(1, mask);
        } else if (op.kind === "binary" && op.operator === ">>>") {
          const rc = numberConstant(op.right);
          if (rc !== undefined && Number.isInteger(rc) && rc >= 1 && rc <= 31)
            wordMagnitudes[index] = Math.max(1, 0xffffffff >>> rc);
        }
      } else if (
        op.kind === "array-length" ||
        op.kind === "string-length" ||
        op.kind === "element-count" ||
        (op.kind === "string-code-unit" && op.inBounds === true)
      )
        wordKinds[valueIds.intern(op.id)] = 2;
      else if (
        op.kind === "array-read" &&
        typedArrayIntegerElements(typedArrayType(value(op.array).type))
      )
        wordKinds[valueIds.intern(op.id)] = 4;
      else if (
        op.kind === "array-element" &&
        typedArrayIntegerElements(typedArrayType(value(op.array).type))
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
        if (kind === 2 || kind === 3) wordKinds[valueIds.intern(op.id)] = 4;
      } else if (op.kind === "store") {
        // Slot addresses do not escape this IR. Only stores in this block
        // establish facts; joins and exception-entry assignments stay unknown.
        slotWordBlocks[op.slot] = b.id + 1;
        slotWordValues[op.slot] = valueIds.intern(op.value);
      } else if (op.kind === "load" && slotWordBlocks[op.slot] === b.id + 1) {
        const stored = slotWordValues[op.slot];
        if (stored === undefined) throw "word slot invariant";
        const index = valueIds.intern(op.id);
        const storedKind = wordKinds[stored] ?? 0;
        if (storedKind !== 0) wordKinds[index] = storedKind;
        quietValues[index] = quietValues[stored] ?? 0;
        wordConstants[index] = wordConstants[stored] ?? 0;
        wordMagnitudes[index] = wordMagnitudes[stored] ?? 0;
      }
      if (op.kind === "binary") {
        if (op.operator === "+" || op.operator === "-" || op.operator === "*") {
          const left = valueIds.intern(op.left),
            right = valueIds.intern(op.right),
            leftBound = wordMagnitude(left),
            rightBound = wordMagnitude(right),
            bound =
              op.operator === "*"
                ? leftBound * rightBound
                : leftBound + rightBound;
          if (leftBound >= 0 && rightBound >= 0 && bound <= 9007199254740991) {
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
        } else if (op.operator === "%") {
          // An exact integer modulo a nonzero integer constant d is an
          // integer below |d| in magnitude (-0 aside, as for sums); one
          // modulo a nonzero slot's value is below that value's bound,
          // and no larger than the dividend.
          const divisor = numberConstant(op.right),
            index = valueIds.intern(op.id);
          if (
            divisor !== undefined &&
            Number.isSafeInteger(divisor) &&
            divisor !== 0 &&
            exactInteger(op.left)
          ) {
            wordKinds[index] = 6;
            wordMagnitudes[index] = Math.max(1, Math.abs(divisor) - 1);
          } else if (
            nonzeroValues[valueIds.intern(op.right)] === 1 &&
            exactInteger(op.left) &&
            exactInteger(op.right)
          ) {
            const left = wordMagnitude(valueIds.intern(op.left)),
              right = wordMagnitude(valueIds.intern(op.right));
            if (left >= 0 && right >= 0) {
              wordKinds[index] = 6;
              wordMagnitudes[index] = Math.max(1, Math.min(left, right - 1));
            }
          }
        }
      } else if (
        op.kind === "unary" &&
        (op.operator === "trunc" || op.operator === "ceil") &&
        exactInteger(op.operand)
      ) {
        // Rounding an exact integer is the identity.
        const magnitude = wordMagnitude(valueIds.intern(op.operand));
        if (magnitude >= 0) {
          const index = valueIds.intern(op.id);
          wordKinds[index] = 6;
          wordMagnitudes[index] = Math.max(1, magnitude);
        }
      }
      if (op.kind === "binary" && op.operator === "%") {
        // An exact integer modulo a nonzero integer constant d is an
        // integer below |d| in magnitude (-0 aside, as for sums); one
        // modulo a nonzero slot's value is below that value's bound,
        // and no larger than the dividend.
        const divisor = numberConstant(op.right),
          index = valueIds.intern(op.id);
        if (
          divisor !== undefined &&
          Number.isSafeInteger(divisor) &&
          divisor !== 0 &&
          exactInteger(op.left)
        ) {
          wordKinds[index] = 6;
          wordMagnitudes[index] = Math.max(1, Math.abs(divisor) - 1);
        } else if (
          nonzeroValues[valueIds.intern(op.right)] === 1 &&
          exactInteger(op.left) &&
          exactInteger(op.right)
        ) {
          const left = wordMagnitude(valueIds.intern(op.left)),
            right = wordMagnitude(valueIds.intern(op.right));
          if (left >= 0 && right >= 0) {
            wordKinds[index] = 6;
            wordMagnitudes[index] = Math.max(1, Math.min(left, right - 1));
          }
        }
      }
    };
    // Batch contiguous constant-size nursery allocations separated only by
    // non-allocating, non-trapping instructions into one nursery check.
    let batchAllocKind: Uint8Array | undefined = undefined,
      batchAllocBytes: Uint16Array | undefined = undefined;
    if (
      linearAllocation &&
      !interruptible &&
      allocationScratchBytes >= 24 &&
      allocationOffset + 24 <= 32760 &&
      b.instructions.length >= 2
    ) {
      const batchSize = (inst: IRInstruction): number => {
        if (inst.kind === "record-new") {
          const layout = module.records?.[inst.record];
          return layout !== undefined &&
            layout.byteLength > 0 &&
            layout.byteLength <= 4095
            ? layout.byteLength
            : 0;
        }
        if (inst.kind === "array-new") {
          const constLen = numberConstant(inst.length);
          if (
            constLen !== undefined &&
            Number.isInteger(constLen) &&
            constLen >= 0 &&
            constLen <= 0xffffffff &&
            !(constLen === 0 && 1 / constLen < 0)
          ) {
            const scale = typedArrayScale(inst.type),
              rawExtent = nativeArrayInlineOffset + 7 + constLen * (1 << scale);
            if (rawExtent <= 0xffffffff) {
              const byteLen = Math.floor(rawExtent / 8) * 8;
              if (byteLen <= 4095 && byteLen - nativeArrayInlineOffset <= 64)
                return byteLen;
            }
          }
          return 0;
        }
        if (
          inst.kind === "function-new" &&
          inst.environment === undefined &&
          nativeFunctionByteLength <= 4095
        )
          return nativeFunctionByteLength;
        return 0;
      };
      const batchSafeOp = (inst: IRInstruction): boolean => {
        if (
          inst.kind === "constant" ||
          inst.kind === "load" ||
          inst.kind === "store" ||
          inst.kind === "array-store" ||
          inst.kind === "reference-none" ||
          inst.kind === "undefined" ||
          inst.kind === "boolean-wrap" ||
          inst.kind === "optional-wrap" ||
          inst.kind === "reference-wrap" ||
          inst.kind === "string-wrap" ||
          inst.kind === "primitive-wrap" ||
          inst.kind === "string-reference" ||
          inst.kind === "reference-string" ||
          inst.kind === "closure-environment"
        )
          return true;
        if (
          (inst.kind === "reference-value" ||
            inst.kind === "string-value" ||
            inst.kind === "primitive-reference") &&
          provenNonNull !== undefined &&
          provenNonNull[valueIds.intern(inst.value)] === 1
        )
          return true;
        if (inst.kind === "unary")
          return (
            inst.operator === "neg" ||
            inst.operator === "-" ||
            inst.operator === "~" ||
            inst.operator === "!" ||
            inst.operator === "uint32" ||
            inst.operator === "trunc" ||
            inst.operator === "ceil" ||
            inst.operator === "abs" ||
            inst.operator === "sqrt" ||
            inst.operator === "fround" ||
            inst.operator === "f16round" ||
            inst.operator === "boolean-number"
          );
        if (inst.kind === "binary") {
          if (
            inst.operator === "/" ||
            inst.operator === "%" ||
            inst.operator === "**"
          )
            return false;
          const lt = value(inst.left).type,
            rt = value(inst.right).type;
          return (
            (lt === "number" && rt === "number") ||
            (lt === "boolean" && rt === "boolean")
          );
        }
        return false;
      };
      let runIndices: number[] = [],
        runTotal = 0;
      const commitRun = (): void => {
        if (runIndices.length >= 2) {
          const kindArr =
              batchAllocKind ?? new Uint8Array(b.instructions.length),
            bytesArr =
              batchAllocBytes ?? new Uint16Array(b.instructions.length);
          batchAllocKind = kindArr;
          batchAllocBytes = bytesArr;
          const firstIdx = runIndices[0],
            lastIdx = runIndices[runIndices.length - 1];
          if (firstIdx !== undefined && lastIdx !== undefined) {
            kindArr[firstIdx] = 1;
            bytesArr[firstIdx] = runTotal;
            for (let r = 1; r < runIndices.length - 1; r++) {
              const midIdx = runIndices[r];
              if (midIdx !== undefined) kindArr[midIdx] = 2;
            }
            kindArr[lastIdx] = 3;
          }
        }
        runIndices = [];
        runTotal = 0;
      };
      for (let idx = 0; idx < b.instructions.length; idx++) {
        const inst = b.instructions[idx];
        if (inst === undefined) {
          commitRun();
          continue;
        }
        const sz = batchSize(inst);
        if (sz > 0) {
          if (runIndices.length > 0 && runTotal + sz <= 4095) {
            runIndices.push(idx);
            runTotal += sz;
          } else {
            commitRun();
            runIndices.push(idx);
            runTotal = sz;
          }
        } else if (runIndices.length > 0 && !batchSafeOp(inst)) {
          commitRun();
        }
      }
      commitRun();
    }
    let fusedNumberElement = -1;
    const wrappedNumberValues = new Map<number, number>();
    for (
      let operationIndex = 0;
      operationIndex < b.instructions.length;
      operationIndex++
    ) {
      if (
        blockDiamond !== undefined &&
        blockNested !== undefined &&
        operationIndex === comparisonIndex
      ) {
        const nestedFloat =
          fn.slots[blockDiamond.targetSlot] === "number" &&
          integerSlots[blockDiamond.targetSlot] !== 1;
        emitNestedSelect(blockNested, nestedFloat);
      }
      const op: IRInstruction | undefined = b.instructions[operationIndex];
      if (op === undefined) throw "instruction invariant";
      siteIndex = operationIndex;
      setSiteIndex(operationIndex);
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
        else if (index >= 0) viewSlotTokens[index] = viewValueToken(op.id);
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
      setSpan({ start: op.start, end: op.end });
      recordInstructionFacts(op);
      // Binary operations keep an immediate operand deferred, and
      // integer slot stores write a deferred constant directly.
      if (
        op.kind !== "binary" &&
        !(op.kind === "store" && integerSlots[op.slot] === 1)
      )
        visitInstructionOperands(op, materializeInteger);
      const currentBatchKind = batchAllocKind?.[operationIndex] ?? 0;
      setBatch(currentBatchKind, batchAllocBytes?.[operationIndex] ?? 0);
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
          if (
            !reflection &&
            (knownBoolTrue?.has(op.id) === true ||
              knownBoolFalse?.has(op.id) === true)
          ) {
            const isKnownTrue = knownBoolTrue?.has(op.id) === true;
            if (isKnownTrue) knownTrueBool.add(op.id);
            else knownFalseBool.add(op.id);
            if (
              blockTerm.kind === "branch" &&
              blockTerm.condition === op.id &&
              blockDiamond === undefined &&
              (valueUses[valueIds.intern(op.id)] ?? 0) === 1
            )
              break;
            imm(12, isKnownTrue ? 1 : 0);
            saveRaw(12, op.id);
            break;
          }
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
          if (
            knownBoolTrue?.has(op.id) === true ||
            knownBoolFalse?.has(op.id) === true
          ) {
            const isKnownTrue = knownBoolTrue?.has(op.id) === true;
            if (isKnownTrue) knownTrueBool.add(op.id);
            else knownFalseBool.add(op.id);
            if (
              blockTerm.kind === "branch" &&
              blockTerm.condition === op.id &&
              blockDiamond === undefined &&
              (valueUses[valueIds.intern(op.id)] ?? 0) === 1
            )
              break;
            const target = rawTarget(op.id, 12);
            imm(target, isKnownTrue ? 1 : 0);
            saveRaw(target, op.id);
            break;
          }
          if (op.type === "absent") {
            // property-load's miss: undefined's tag with payload 1. A
            // fused test is the load's own miss branches.
            if (fusion !== undefined && fusion.test === op.id) break;
            rawValue(9, op.value);
            rawLoad(10, value(op.value).offset + 8);
            emit({
              op: "sub-imm",
              width: 64,
              rd: "zr",
              rn: 9,
              immediate: 0,
              shift: 0,
              setFlags: true,
            });
            emit({
              op: "ccmp-imm",
              width: 64,
              rn: 10,
              immediate: 1,
              nzcv: 0,
              condition: "eq",
            });
            if (op.id === comparisonValue) comparisonBranch = "eq";
            else {
              const target = rawTarget(op.id, 12);
              emit({ op: "cset", rd: target, condition: "eq" });
              saveRaw(target, op.id);
            }
            break;
          }
          if (
            op.type === "number" &&
            fusedNumberElement === op.value &&
            op.id !== comparisonValue
          ) {
            const target = rawTarget(op.id, 12);
            imm(target, 1);
            saveRaw(target, op.id);
            break;
          }
          const tag =
            op.type === "undefined"
              ? 0
              : op.type === "number"
                ? 1
                : op.type === "boolean"
                  ? 2
                  : op.type === "string"
                    ? 3
                    : op.type === "null" || op.type === "nullish"
                      ? 4
                      : 5;
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
          // Undefined and null are tags 0 and 4. If the null
          // comparison already matched, preserve Z instead of
          // comparing the tag with undefined.
          if (op.type === "nullish")
            emit({
              op: "ccmp-imm",
              width: 64,
              rn: 9,
              immediate: 0,
              nzcv: 4,
              condition: "ne",
            });
          const marker = typedArrayMarker(op.type);
          if (marker === 0) {
            if (
              (op.branch === true || fn.scriptEntry === true) &&
              op.id === comparisonValue
            )
              comparisonBranch = "eq";
            else {
              const target = rawTarget(op.id, 12);
              emit({ op: "cset", rd: target, condition: "eq" });
              saveRaw(target, op.id);
            }
            break;
          }
          imm(12, 0);
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
            immediate: marker,
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
          const leftTag = generalEqualTags?.get(op.left);
          const rightTag = generalEqualTags?.get(op.right);
          if (leftTag !== undefined || rightTag !== undefined) {
            emitSpecializedGeneralEqual(
              {
                instructionCount: (): number => instructions.length,
                emit,
                patchInstruction,
                imm,
                generalPair,
                valueOffset: (id: number): number => value(id).offset,
                rawValue,
                rawLoad,
                floatLoad: (
                  target: number,
                  id: number,
                  delta: number,
                ): void => {
                  floatLoad(target, id, delta);
                },
                stringEqual: (): void => {
                  stringEqual();
                },
                saveRaw,
                clearStackWords: (): void => {
                  stackWords.clear();
                },
              },
              op.id,
              op.left,
              op.right,
              leftTag,
              rightTag,
            );
            break;
          }
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
          for (const at of [finishRaw, finishNumber, finishText, finishTrue]) {
            if (at === undefined) throw "general equality fixup invariant";
            patchInstruction(at, {
              op: "b",
              displacement: (done - at) * 4,
            });
          }
          saveRaw(9, op.id);
          break;
        }
        case "error-message": {
          rawValue(9, op.value);
          emit({
            op: "ldr",
            width: 64,
            rt: 9,
            rn: 9,
            offset: recordHeaderBytes,
          });
          saveRaw(9, op.id);
          break;
        }
        case "error-new": {
          allocate(
            () => {},
            (rd) => imm(rd, recordHeaderBytes + 8),
          );
          descriptorPointer(
            typeErrorRecord +
              (op.error === "RangeError"
                ? 1
                : op.error === "Error"
                  ? 2
                  : op.error === "ReferenceError"
                    ? 3
                    : 0),
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
            typeErrorRecord +
              (op.error === "RangeError"
                ? 1
                : op.error === "ReferenceError"
                  ? 3
                  : 0),
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
          if (op.error === "Error") {
            for (let i = 1; i < errorDescriptorCount; i++) {
              descriptorPointer(typeErrorRecord + i);
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
              emit({ op: "cset", rd: 12, condition: "eq" });
              emit({ op: "orr-reg", width: 64, rd: 9, rn: 9, rm: 12 });
            }
          }
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
        case "general-none": {
          // Folded into the record-new fields that are its only uses.
          if (foldedConstants[valueIds.intern(op.id)] === 1) break;
          const directOffset = directGeneralTarget?.get(op.id);
          if (directOffset !== undefined) {
            emittedDirectStore[valueIds.intern(op.id)] = 1;
            const pairSafe =
              directOffset <= 504 &&
              (scalarRegisters?.[directOffset / 8] ?? 0) === 0 &&
              (scalarRegisters?.[directOffset / 8 + 1] ?? 0) === 0;
            if (op.kind === "general-none") {
              if (pairSafe)
                emit({
                  op: "stp",
                  width: 64,
                  rt: "zr",
                  rt2: "zr",
                  rn: "sp",
                  offset: directOffset,
                  mode: "offset",
                });
              else {
                rawStore("zr", directOffset);
                rawStore("zr", directOffset + 8);
              }
            } else {
              imm(9, 4);
              if (pairSafe)
                emit({
                  op: "stp",
                  width: 64,
                  rt: 9,
                  rt2: "zr",
                  rn: "sp",
                  offset: directOffset,
                  mode: "offset",
                });
              else {
                rawStore(9, directOffset);
                rawStore("zr", directOffset + 8);
              }
            }
            break;
          }
          imm(9, op.kind === "general-null" ? 4 : 0);
          saveRaw(9, op.id);
          rawStore("zr", value(op.id).offset + 8);
          break;
        }
        case "script-argument-count":
          rawLoad(9, scriptCountOffset);
          emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
          floatStore(0, op.id);
          break;
        case "activation-read": {
          // Records: abi.ts activationRecordBytes.
          const record = op.record;
          if (record === undefined) {
            rawLoad(9, contextOffset);
            emit({
              op: "ldr",
              width: 64,
              rt: 9,
              rn: 9,
              offset: nativeActivationTopOffset,
            });
          } else
            emit({
              op: "fcvtzs-x-d",
              rd: 9,
              rn: floatOperand(record, 0),
            });
          if (op.field === "callee" || op.field === "argument") {
            const index = op.index;
            if (index === undefined) {
              emit({
                op: "ldp",
                width: 64,
                rt: 9,
                rt2: 10,
                rn: 9,
                offset: activationCalleeOffset,
                mode: "offset",
              });
            } else {
              // Missing actuals read undefined; the first ones are
              // in the record, the rest above the frame record.
              emit({
                op: "fcvtzs-x-d",
                rd: 11,
                rn: floatOperand(index, 1),
              });
              emit({
                op: "ldr",
                width: 64,
                rt: 12,
                rn: 9,
                offset: activationCountOffset,
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
              const absent = instructions.length;
              emit({ op: "b.cond", condition: "cs", displacement: 0 });
              emit({
                op: "add-imm",
                width: 64,
                rd: 13,
                rn: 9,
                immediate: activationArgumentsOffset,
                shift: 0,
                setFlags: false,
              });
              emit({
                op: "sub-imm",
                width: 64,
                rd: "zr",
                rn: 11,
                immediate: scriptActualRegisterPairs,
                shift: 0,
                setFlags: true,
              });
              const inRecord = instructions.length;
              emit({ op: "b.cond", condition: "cc", displacement: 0 });
              emit({
                op: "ldr",
                width: 64,
                rt: 13,
                rn: 9,
                offset: activationFrameOffset,
              });
              // Clear the kind bits: frame pointer + 16.
              emit({
                op: "ubfm",
                width: 64,
                rd: 13,
                rn: 13,
                immr: 4,
                imms: 63,
              });
              emit({
                op: "ubfm",
                width: 64,
                rd: 13,
                rn: 13,
                immr: 60,
                imms: 59,
              });
              emit({
                op: "add-imm",
                width: 64,
                rd: 13,
                rn: 13,
                immediate: 16,
                shift: 0,
                setFlags: false,
              });
              emit({
                op: "sub-imm",
                width: 64,
                rd: 11,
                rn: 11,
                immediate: scriptActualRegisterPairs,
                shift: 0,
                setFlags: false,
              });
              patchInstruction(inRecord, {
                op: "b.cond",
                condition: "cc",
                displacement: (instructions.length - inRecord) * 4,
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
              emit({
                op: "ldp",
                width: 64,
                rt: 9,
                rt2: 10,
                rn: 13,
                offset: 0,
                mode: "offset",
              });
              const loaded = instructions.length;
              emit({ op: "b", displacement: 0 });
              patchInstruction(absent, {
                op: "b.cond",
                condition: "cs",
                displacement: (instructions.length - absent) * 4,
              });
              imm(9, 0);
              imm(10, 0);
              patchInstruction(loaded, {
                op: "b",
                displacement: (instructions.length - loaded) * 4,
              });
            }
            saveRaw(9, op.id);
            rawStore(10, value(op.id).offset + 8);
            break;
          }
          if (op.field === "previous")
            emit({ op: "ldr", width: 64, rt: 9, rn: 9, offset: 0 });
          else if (op.field === "kind") {
            emit({
              op: "ldr",
              width: 64,
              rt: 9,
              rn: 9,
              offset: activationFrameOffset,
            });
            emit({
              op: "ubfm",
              width: 64,
              rd: 9,
              rn: 9,
              immr: 0,
              imms: 3,
            });
          } else if (op.field === "count")
            emit({
              op: "ldr",
              width: 64,
              rt: 9,
              rn: 9,
              offset: activationCountOffset,
            });
          emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
          floatStore(0, op.id);
          break;
        }
        case "script-argument": {
          const fact = valueIds.intern(op.index);
          const position =
            wordKinds[fact] === 3 ? wordConstants[fact] : undefined;
          if (position !== undefined && position < scriptActualRegisterPairs) {
            const offset = scriptArgumentsOffset + position * 16;
            generalPair(9, offset, true);
            saveRaw(9, op.id);
            rawStore(10, value(op.id).offset + 8);
            break;
          }
          if (position !== undefined && position < 2048) {
            const offset = 16 + (position - scriptActualRegisterPairs) * 16;
            rawLoad(9, scriptCountOffset);
            emit({
              op: "sub-imm",
              width: 64,
              rd: "zr",
              rn: 9,
              immediate: position,
              shift: 0,
              setFlags: true,
            });
            const outOfBounds = instructions.length;
            emit({ op: "b.cond", condition: "ls", displacement: 0 });
            emit({ op: "ldr", width: 64, rt: 9, rn: 29, offset });
            emit({
              op: "ldr",
              width: 64,
              rt: 10,
              rn: 29,
              offset: offset + 8,
            });
            const loaded = instructions.length;
            emit({ op: "b", displacement: 0 });
            patchInstruction(outOfBounds, {
              op: "b.cond",
              condition: "ls",
              displacement: (instructions.length - outOfBounds) * 4,
            });
            imm(9, 0);
            imm(10, 0);
            patchInstruction(loaded, {
              op: "b",
              displacement: (instructions.length - loaded) * 4,
            });
            saveRaw(9, op.id);
            rawStore(10, value(op.id).offset + 8);
            break;
          }
          const input = floatOperand(op.index, 0);
          const exact = input === 1 ? 0 : 1;
          emit({ op: "fcvtzs-x-d", rd: 9, rn: input });
          emit({ op: "scvtf-d-x", rd: exact, rn: 9 });
          emit({ op: "fcmp", rn: input, rm: exact });
          const nonInteger = instructions.length;
          emit({ op: "b.cond", condition: "ne", displacement: 0 });
          rawLoad(10, scriptCountOffset);
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
          const absent = instructions.length;
          emit({ op: "b.cond", condition: "cs", displacement: 0 });
          address(11, scriptArgumentsOffset);
          emit({
            op: "sub-imm",
            width: 64,
            rd: "zr",
            rn: 9,
            immediate: scriptActualRegisterPairs,
            shift: 0,
            setFlags: true,
          });
          const inRegister = instructions.length;
          emit({ op: "b.cond", condition: "cc", displacement: 0 });
          emit({
            op: "add-imm",
            width: 64,
            rd: 11,
            rn: 29,
            immediate: 16,
            shift: 0,
            setFlags: false,
          });
          emit({
            op: "sub-imm",
            width: 64,
            rd: 9,
            rn: 9,
            immediate: scriptActualRegisterPairs,
            shift: 0,
            setFlags: false,
          });
          patchInstruction(inRegister, {
            op: "b.cond",
            condition: "cc",
            displacement: (instructions.length - inRegister) * 4,
          });
          emit({
            op: "add-reg",
            width: 64,
            rd: 11,
            rn: 11,
            rm: 9,
            shift: "lsl",
            amount: 4,
            setFlags: false,
          });
          emit({
            op: "ldp",
            width: 64,
            rt: 9,
            rt2: 10,
            rn: 11,
            offset: 0,
            mode: "offset",
          });
          const loaded = instructions.length;
          emit({ op: "b", displacement: 0 });
          const missing = instructions.length;
          patchInstruction(nonInteger, {
            op: "b.cond",
            condition: "ne",
            displacement: (missing - nonInteger) * 4,
          });
          patchInstruction(absent, {
            op: "b.cond",
            condition: "cs",
            displacement: (missing - absent) * 4,
          });
          imm(9, 0);
          imm(10, 0);
          patchInstruction(loaded, {
            op: "b",
            displacement: (instructions.length - loaded) * 4,
          });
          saveRaw(9, op.id);
          rawStore(10, value(op.id).offset + 8);
          break;
        }
        case "general-wrap": {
          const t = value(op.value).type;
          if (t === "number") wrappedNumberValues.set(op.id, op.value);
          const tag =
            t === "number" ? 1 : t === "boolean" ? 2 : t === "string" ? 3 : 5;
          const directOffset = directGeneralTarget?.get(op.id);
          if (directOffset !== undefined) {
            emittedDirectStore[valueIds.intern(op.id)] = 1;
            if (t === "number" && storedAsInteger(op.value)) {
              floatLoad(0, op.value);
              emit({ op: "fmov-x-d", rd: 10, rn: 0 });
            } else {
              rawValue(10, op.value);
            }
            imm(9, tag);
            generalPair(9, directOffset, false);
            break;
          }
          if (t === "number" && storedAsInteger(op.value)) {
            floatLoad(0, op.value);
            emit({ op: "fmov-x-d", rd: 9, rn: 0 });
          } else {
            rawValue(9, op.value);
          }
          rawStore(9, value(op.id).offset + 8);
          imm(9, tag);
          saveRaw(9, op.id);
          break;
        }
        case "general-value": {
          const tag =
            op.type === "number"
              ? 1
              : op.type === "boolean"
                ? 2
                : op.type === "string"
                  ? 3
                  : 5;
          if (op.unchecked !== true) {
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
            trapIf({ op: "b.cond", condition: "ne" });
          }
          rawLoad(9, value(op.value).offset + 8);
          const marker = typedArrayMarker(op.type);
          if (marker !== 0) {
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
              immediate: marker,
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
            amount: typedArrayScale(value(op.array).type),
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
        case "array-view":
          arrayView(op);
          break;
        case "array-atomic":
          arrayAtomic(op);
          break;
        case "array-word64-read":
          arrayWord64Read(op);
          break;
        case "array-word64-write":
          arrayWord64Write(op);
          break;
        case "array-word64-fill":
          arrayWord64Fill(op);
          break;
        case "array-atomic-word64":
          arrayAtomicWord64(op);
          break;
        case "bytes-load":
          emitBytesLoad(bytesCtx(), op, hoistedArrayDataValues.get(op.array));
          break;
        case "bytes-store":
          emitBytesStore(bytesCtx(), op, hoistedArrayDataValues.get(op.array));
          break;
        case "bytes-word64-load":
          emitBytesWord64Load(
            bytesCtx(),
            op,
            hoistedArrayDataValues.get(op.array),
          );
          break;
        case "bytes-word64-store":
          emitBytesWord64Store(
            bytesCtx(),
            op,
            hoistedArrayDataValues.get(op.array),
          );
          break;
        case "word64-constant":
          emitWord64Constant(word64Ctx(), op);
          break;
        case "word64-from-number":
          emitWord64FromNumber(word64Ctx(), op);
          break;
        case "word64-to-number":
          emitWord64ToNumber(word64Ctx(), op);
          break;
        case "word64-binary":
          emitWord64Binary(word64Ctx(), op);
          break;
        case "word64-unary":
          emitWord64Unary(word64Ctx(), op);
          break;
        case "word64-part":
          emitWord64Part(word64Ctx(), op);
          break;
        case "word64-from-parts":
          emitWord64FromParts(word64Ctx(), op);
          break;
        case "array-word64-element":
          emitArrayWord64Element(
            word64Ctx(),
            op,
            hoistedArrayDataValues.get(op.array),
          );
          break;
        case "array-word64-store":
          emitArrayWord64Store(
            word64Ctx(),
            op,
            hoistedArrayDataValues.get(op.array),
          );
          break;
        case "array-buffer-byte-length":
          rawValue(10, op.buffer);
          bufferByteLength(10, 14);
          if (wantsInteger(op.id)) {
            saveRaw(14, op.id);
            markInteger(op.id);
          } else {
            emit({ op: "ucvtf-d-x", rd: 0, rn: 14 });
            floatStore(0, op.id);
          }
          break;
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
            rememberObject(deferRememberSlow());
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
        case "array-new": {
          const scale = typedArrayScale(op.type);
          let skipZero = false;
          const constLen = numberConstant(op.length);
          if (
            constLen !== undefined &&
            Number.isInteger(constLen) &&
            constLen >= 1 &&
            constLen <= 8
          ) {
            const rawExtent =
                nativeArrayInlineOffset + 7 + constLen * (1 << scale),
              byteLen = Math.floor(rawExtent / 8) * 8,
              payloadBytes = byteLen - nativeArrayInlineOffset;
            if (
              payloadBytes <= 64 &&
              constLen * (1 << scale) === payloadBytes
            ) {
              let covered = 0;
              const targetMask = (1 << constLen) - 1,
                localConst = new Map<number, number>();
              for (
                let look = operationIndex + 1;
                look < b.instructions.length;
                look++
              ) {
                const nextOp = b.instructions[look];
                if (nextOp === undefined) break;
                if (nextOp.kind === "constant") {
                  const nv = nextOp.value;
                  if (typeof nv === "number") {
                    localConst.set(nextOp.id, nv);
                    continue;
                  }
                }
                if (nextOp.kind === "array-store" && nextOp.array === op.id) {
                  const idx =
                    localConst.get(nextOp.index) ??
                    numberConstant(nextOp.index);
                  if (
                    idx !== undefined &&
                    Number.isInteger(idx) &&
                    idx >= 0 &&
                    idx < constLen
                  )
                    covered |= 1 << idx;
                  if (covered === targetMask) {
                    skipZero = true;
                    break;
                  }
                  continue;
                }
                if (
                  nextOp.kind !== "load" &&
                  nextOp.kind !== "unary" &&
                  nextOp.kind !== "binary"
                )
                  break;
              }
            }
          }
          allocateIndexed(
            op.id,
            op.length,
            scale,
            typedArrayMarker(op.type),
            skipZero,
          );
          break;
        }
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
        case "string-two-byte": {
          // Two-byte exactly when the one-byte flag (bit 48) is clear,
          // flat or sliced.
          const string = rawRegister(op.string, 9),
            target = rawTarget(op.id, 9);
          emit({ op: "ldr", width: 64, rt: 10, rn: string, offset: 0 });
          emit({
            op: "ubfm",
            width: 64,
            rd: 10,
            rn: 10,
            immr: 48,
            imms: 48,
          });
          emit({
            op: "sub-imm",
            width: 64,
            rd: "zr",
            rn: 10,
            immediate: 0,
            shift: 0,
            setFlags: true,
          });
          emit({ op: "cset", rd: target, condition: "eq" });
          saveRaw(target, op.id);
          break;
        }
        case "string-length": {
          if (lengthOnlySlices[valueIds.intern(op.string)] === 1) {
            // The slice was not materialized: its home holds the exact
            // uint32 count computed by sliceBounds.
            const count = rawRegister(op.string, 9);
            if (wantsInteger(op.id)) {
              const target = rawTarget(op.id, count);
              if (target !== count)
                emit({
                  op: "orr-reg",
                  width: 64,
                  rd: target,
                  rn: "zr",
                  rm: count,
                });
              saveRaw(target, op.id);
              markInteger(op.id);
              break;
            }
            emit({
              op: "ucvtf-d-w",
              rd: floatTarget(op.id, 0),
              rn: count,
            });
            floatStore(floatTarget(op.id, 0), op.id);
            break;
          }
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
        case "string-index-of":
          rawValue(9, op.string);
          rawValue(10, op.search);
          floatLoad(0, op.position);
          if (op.reverse) callHelper("string-last-index-of");
          else callHelper("string-index-of");
          floatStore(0, op.id);
          break;
        case "string-code-unit":
        case "string-from-code-units":
        case "string-slice":
        case "string-concat": {
          emitStringCoreOp(stringOpsCtx(), op, b.id, siteIndex);
          break;
        }
        case "string-allocate":
        case "string-write":
        case "string-from-latin1":
        case "string-from-utf8":
        case "string-index-cached":
        case "gc-epoch":
        case "reference-hash":
        case "string-index-cache":
        case "number-string-cached":
        case "number-string-cache": {
          emitStringCacheOp(stringOpsCtx(), op);
          break;
        }
        case "string-split-cached":
        case "string-split-cache":
        case "string-ascii-case":
        case "string-copy-latin1":
        case "string-ascii-prefix":
        case "string-utf8-length":
        case "string-write-utf8":
        case "string-flat":
        case "string-flatten-into": {
          emitStringTextOp(stringOpsCtx(), op);
          break;
        }
        case "bytes-ascii-prefix":
          latin1Index(op.begin, 11);
          latin1Index(op.limit, 12);
          rawValue(9, op.bytes);
          latin1Range(nativeArrayLengthOffset);
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
          callHelper("bytes-ascii-prefix");
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
        case "string-present":
          if (op.id === foldedPresent) break;
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
        case "string-wrap": {
          const wrapIndex = valueIds.intern(op.id),
            nextOp = b.instructions[operationIndex + 1];
          if (
            (useCounts[wrapIndex] ?? 0) === 1 &&
            nextOp !== undefined &&
            nextOp.kind === "binary" &&
            (nextOp.operator === "===" ||
              nextOp.operator === "!==" ||
              nextOp.operator === "==" ||
              nextOp.operator === "!=") &&
            (nextOp.left === op.id || nextOp.right === op.id)
          ) {
            foldedStringWraps[wrapIndex] = 1;
            break;
          }
          // A verified `string` value is non-null by IR invariant.
          rawValue(9, op.value);
          saveRaw(9, op.id);
          break;
        }
        case "string-value":
        case "reference-wrap":
        case "reference-value":
        case "primitive-wrap":
        case "primitive-reference":
          if (skippedCasts[valueIds.intern(op.id)] === 1) break;
          if (
            provenNonNull !== undefined &&
            provenNonNull[valueIds.intern(op.value)] === 1
          ) {
            const nextOp = b.instructions[siteIndex + 1];
            if (
              tracker === undefined &&
              nextOp !== undefined &&
              nextOp.kind === "store" &&
              nextOp.value === op.id &&
              (valueUses[valueIds.intern(op.id)] ?? 0) === 1 &&
              scalarByteLength(value(op.value).type) === 8
            ) {
              elidedStoreSource.set(op.id, op.value);
              break;
            }
            const target = rawTarget(op.id, 9);
            if (target === 9 && homeOf(op.value) >= 32) {
              saveRaw(homeOf(op.value) - 32, op.id);
              break;
            }
            rawValue(target, op.value);
            saveRaw(target, op.id);
            break;
          }
          const castSrc = rawRegister(op.value, 9);
          trapIf({ op: "cbz", width: 64, rt: castSrc });
          if (
            tracker === undefined &&
            (valueUses[valueIds.intern(op.id)] ?? 0) === 1 &&
            homeOf(op.value) >= 32
          ) {
            let elidedCast = false;
            for (
              let k = operationIndex + 1;
              k < b.instructions.length && k <= operationIndex + 5;
              k++
            ) {
              const nextAfterCast = b.instructions[k];
              if (nextAfterCast === undefined) break;
              if (
                nextAfterCast.kind === "call" &&
                writeShapes[nextAfterCast.target]?.unchecked === true &&
                nextAfterCast.arguments[0] === op.id
              ) {
                elidedCast = true;
                break;
              }
              if (
                nextAfterCast.kind !== "load" &&
                nextAfterCast.kind !== "constant"
              )
                break;
            }
            if (elidedCast) {
              elidedStoreSource.set(op.id, op.value);
              break;
            }
          }
          saveRaw(castSrc, op.id);
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
            const record = module.functions[op.target]?.closureEnvironment;
            if (record === undefined) throw "closure environment invariant";
            rawValue(12, op.environment);
            guardDescriptor(12, record);
          }
          allocate(
            () => {},
            (rd) => imm(rd, nativeFunctionByteLength),
            false,
            nativeFunctionByteLength,
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
          emitRecordNew(
            objectOpsCtx(),
            op,
            b,
            operationIndex,
            currentBatchKind,
          );
          break;
        }
        case "constant": {
          if (
            foldedConstants[valueIds.intern(op.id)] === 1 ||
            hoistedFloatConst.has(op.id)
          )
            break;
          const constant = op.value,
            home = value(op.id).offset,
            register = scalarRegisters?.[home / 8] ?? 0;
          // Materialized straight into a GP home when there is one.
          const target = rawTarget(op.id, 9);
          if (typeof constant === "boolean") {
            if (constant) {
              imm(target, 1);
              saveRaw(target, op.id);
            } else {
              rawStore("zr", home);
              if (tracker !== undefined)
                tracker.saved(op.id, instructions.length * 4);
            }
            break;
          }
          if (
            wantsInteger(op.id) &&
            Number.isSafeInteger(constant) &&
            !(constant === 0 && 1 / constant < 0)
          ) {
            // Written to its home only once a use needs it there.
            markInteger(op.id);
            deferredIntegers.set(op.id, constant);
            break;
          }
          const bits = encodeFloat64(constant);
          if (bits.lo === 0 && bits.hi === 0) {
            // +0: store in FP domain when stack-backed to avoid GP->FP STLF stalls.
            if (register === 0) {
              emit({ op: "fmov-d-x", rd: 0, rn: "zr" });
              emit({ op: "str-d", rt: 0, rn: "sp", offset: home });
            } else rawStore("zr", home);
            if (tracker !== undefined)
              tracker.saved(op.id, instructions.length * 4);
            break;
          }
          const immediate =
            register < 32 ? float64Immediate(constant) : undefined;
          if (immediate !== undefined) {
            if (register > 0)
              emit({ op: "fmov-d-imm", rd: register, imm8: immediate });
            else {
              emit({ op: "fmov-d-imm", rd: 0, imm8: immediate });
              emit({ op: "str-d", rt: 0, rn: "sp", offset: home });
            }
            if (tracker !== undefined)
              tracker.saved(op.id, instructions.length * 4);
            break;
          }
          if (register === 0) {
            imm64(9, bits.lo, bits.hi);
            emit({ op: "fmov-d-x", rd: 0, rn: 9 });
            emit({ op: "str-d", rt: 0, rn: "sp", offset: home });
            if (tracker !== undefined)
              tracker.saved(op.id, instructions.length * 4);
            break;
          }
          imm64(target, bits.lo, bits.hi);
          saveRaw(target, op.id);
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
        case "record-slot-read": {
          const field = module.records?.[op.record]?.fields[op.field];
          if (field === undefined) throw "record slot field invariant";
          const bytes = scalarByteLength(field.type);
          // The index must be an integer in [0, count).
          if (storedAsInteger(op.index)) rawValue(10, op.index);
          else {
            const index = floatOperand(op.index, 0);
            emit({ op: "fcvtzs-x-d", rd: 10, rn: index });
            emit({ op: "scvtf-d-x", rd: 1, rn: 10 });
            emit({ op: "fcmp", rn: index, rm: 1 });
            trapIf({ op: "b.cond", condition: "ne" });
          }
          emit({
            op: "sub-imm",
            width: 64,
            rd: "zr",
            rn: 10,
            immediate: op.count,
            shift: 0,
            setFlags: true,
          });
          trapIf({ op: "b.cond", condition: "cs" });
          rawValue(9, op.object);
          emit({
            op: "add-reg",
            width: 64,
            rd: 9,
            rn: 9,
            rm: 10,
            shift: "lsl",
            amount: bytes === 16 ? 4 : 3,
            setFlags: false,
          });
          let offset = field.offset;
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
          const home = homeOf(op.id);
          if (bytes === 8 && home >= 32)
            emit({ op: "ldr", width: 64, rt: home - 32, rn: 9, offset });
          else if (bytes === 8 && home !== 0)
            emit({ op: "ldr-d", rt: home, rn: 9, offset });
          else
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
        case "property-load":
        case "property-store": {
          emitPropertyAccess(objectOpsCtx(), op, directGeneralTarget, fusion);
          break;
        }
        case "script-entry": {
          emitScriptEntry(objectOpsCtx(), op, fusion);
          break;
        }
        case "global-cell": {
          emitGlobalCell(objectOpsCtx(), op);
          break;
        }
        case "element-load":
        case "element-store": {
          fusedNumberElement = emitElementAccess(
            objectOpsCtx(),
            op,
            fusion,
            wrappedNumberValues,
            fusedNumberElement,
          );
          break;
        }
        case "general-element-load":
        case "general-element-store":
        case "general-slot-load":
        case "general-slot-store": {
          const isElement =
            op.kind === "general-element-load" ||
            op.kind === "general-element-store";
          const fusedMiss =
            isElement && fusion !== undefined && fusion.access === op.id
              ? fusion.miss
              : undefined;
          const directOffset =
            op.kind === "general-element-load" ||
            op.kind === "general-slot-load"
              ? directGeneralTarget?.get(op.id)
              : undefined;
          if (directOffset !== undefined)
            emittedDirectStore[valueIds.intern(op.id)] = 1;
          const owner = fn.id;
          emitGeneralElementAccess(
            {
              records: module.records,
              jsConvert,
              contextOffset,
              fusedMiss,
              ...(directOffset === undefined
                ? {}
                : { directTargetOffset: directOffset }),
              instructionCount: (): number => instructions.length,
              emit,
              patchInstruction,
              branchCond: (
                condition: "ne" | "lt" | "cs",
                targetBlock: number,
              ): void =>
                branch({ op: "b.cond", condition }, owner, targetBlock),
              branchCbz: (rt: number, targetBlock: number): void =>
                branch({ op: "cbz", width: 64, rt }, owner, targetBlock),
              imm,
              generalPair,
              descriptorPointer,
              valueOffset: (id: number): number => value(id).offset,
              exactInteger,
              intRegister,
              floatOperand,
              rawValue,
              rawLoad,
              rawTarget,
              saveRaw,
              rememberDeferred: (): void => {
                rememberObject(deferRememberSlow());
              },
            },
            op,
          );
          break;
        }
        case "element-length": {
          const elementsField = module.records?.[op.record]?.fields[op.field],
            lengthField =
              module.records?.[op.elementsRecord]?.fields[op.lengthField];
          if (elementsField === undefined || lengthField === undefined)
            throw "element length layout invariant";
          const fusedMiss =
            fusion !== undefined && fusion.access === op.id
              ? fusion.miss
              : undefined;
          const misses: number[] = [];
          const cbzMisses: number[] = [];
          function missNe(): void {
            if (fusedMiss !== undefined)
              branch({ op: "b.cond", condition: "ne" }, fn.id, fusedMiss);
            else {
              misses.push(instructions.length);
              emit({ op: "b.cond", condition: "ne", displacement: 0 });
            }
          }
          // Check general tag 5 (reference), record descriptor, non-null
          // elements, then read the 64-bit IEEE-754 length bits directly
          // into GP registers (zero FP register usage).
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
          missNe();
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
          missNe();
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
          emit({
            op: "ldr",
            width: 64,
            rt: 10,
            rn: 10,
            offset: lengthField.offset,
          });
          imm(9, 1);
          const offset = value(op.id).offset;
          generalPair(9, offset, false);
          if (fusedMiss !== undefined) {
            fusedNumberElement = op.id;
            break;
          }
          const hit = instructions.length;
          emit({ op: "b", displacement: 0 });
          for (const site of misses)
            patchInstruction(site, {
              op: "b.cond",
              condition: "ne",
              displacement: (instructions.length - site) * 4,
            });
          for (const site of cbzMisses)
            patchInstruction(site, {
              op: "cbz",
              width: 64,
              rt: 10,
              displacement: (instructions.length - site) * 4,
            });
          emit({ op: "orr-reg", width: 64, rd: 9, rn: "zr", rm: "zr" });
          imm(10, 1);
          generalPair(9, offset, false);
          patchInstruction(hit, {
            op: "b",
            displacement: (instructions.length - hit) * 4,
          });
          break;
        }
        case "element-storage":
        case "element-count": {
          const elementsField = module.records?.[op.record]?.fields[op.field],
            elementFields = module.records?.[op.elementsRecord]?.fields,
            countField = elementFields?.[op.countField],
            storageField = elementFields?.[op.storageField];
          if (
            elementsField === undefined ||
            countField === undefined ||
            storageField === undefined
          )
            throw "element cache layout invariant";
          const misses: number[] = [];
          const cbzMisses: number[] = [];
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
          misses.push(instructions.length);
          emit({ op: "b.cond", condition: "ne", displacement: 0 });
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
          misses.push(instructions.length);
          emit({ op: "b.cond", condition: "ne", displacement: 0 });
          emit({
            op: "ldr",
            width: 64,
            rt: 10,
            rn: 10,
            offset: elementsField.offset,
          });
          cbzMisses.push(instructions.length);
          emit({ op: "cbz", width: 64, rt: 10, displacement: 0 });
          if (op.kind === "element-storage") {
            const target = rawTarget(op.id, 10);
            emit({
              op: "ldr",
              width: 64,
              rt: target,
              rn: 10,
              offset: storageField.offset,
            });
            const hit = instructions.length;
            emit({ op: "b", displacement: 0 });
            for (const site of misses)
              patchInstruction(site, {
                op: "b.cond",
                condition: "ne",
                displacement: (instructions.length - site) * 4,
              });
            for (const site of cbzMisses)
              patchInstruction(site, {
                op: "cbz",
                width: 64,
                rt: 10,
                displacement: (instructions.length - site) * 4,
              });
            emit({
              op: "orr-reg",
              width: 64,
              rd: target,
              rn: "zr",
              rm: "zr",
            });
            patchInstruction(hit, {
              op: "b",
              displacement: (instructions.length - hit) * 4,
            });
            saveRaw(target, op.id);
          } else if (wantsInteger(op.id)) {
            const target = intTarget(op.id, 12);
            emit({
              op: "ldr-d",
              rt: 0,
              rn: 10,
              offset: countField.offset,
            });
            emit({ op: "fcvtzu-x-d", rd: target, rn: 0 });
            const hit = instructions.length;
            emit({ op: "b", displacement: 0 });
            for (const site of misses)
              patchInstruction(site, {
                op: "b.cond",
                condition: "ne",
                displacement: (instructions.length - site) * 4,
              });
            for (const site of cbzMisses)
              patchInstruction(site, {
                op: "cbz",
                width: 64,
                rt: 10,
                displacement: (instructions.length - site) * 4,
              });
            emit({
              op: "orr-reg",
              width: 64,
              rd: target,
              rn: "zr",
              rm: "zr",
            });
            patchInstruction(hit, {
              op: "b",
              displacement: (instructions.length - hit) * 4,
            });
            markInteger(op.id);
            saveRaw(target, op.id);
          } else {
            const target = floatTarget(op.id, 0);
            emit({
              op: "ldr-d",
              rt: target,
              rn: 10,
              offset: countField.offset,
            });
            const hit = instructions.length;
            emit({ op: "b", displacement: 0 });
            for (const site of misses)
              patchInstruction(site, {
                op: "b.cond",
                condition: "ne",
                displacement: (instructions.length - site) * 4,
              });
            for (const site of cbzMisses)
              patchInstruction(site, {
                op: "cbz",
                width: 64,
                rt: 10,
                displacement: (instructions.length - site) * 4,
              });
            emit({ op: "fmov-d-x", rd: target, rn: "zr" });
            patchInstruction(hit, {
              op: "b",
              displacement: (instructions.length - hit) * 4,
            });
            floatStore(target, op.id);
          }
          break;
        }
        case "record-has": {
          const field = module.records?.[op.record]?.fields[op.field];
          if (field === undefined) throw "record presence invariant";
          // Record flow may prove the object is always this layout
          // and never null: then only the presence byte remains.
          const presence = field.presenceOffset;
          if (
            (provenListHeader(op.object, op.record) === 2 ||
              provenPresence.has(op)) &&
            (presence === undefined || presence < 4096)
          ) {
            if (presence === undefined) imm(12, 1);
            else {
              rawValue(9, op.object);
              emit({ op: "ldrb", rt: 12, rn: 9, offset: presence });
            }
            saveRaw(12, op.id);
            break;
          }
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
          if (foldedConstants[valueIds.intern(op.id)] === 1) break;
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
        case "optional-wrap": {
          const wrapIndex = valueIds.intern(op.id),
            nextOp = b.instructions[operationIndex + 1];
          if (
            (storedAsInteger(op.value) ||
              nanSentinelWords[valueIds.intern(op.value)] === 1) &&
            (useCounts[wrapIndex] ?? 0) === 1 &&
            nextOp !== undefined &&
            nextOp.kind === "string-slice" &&
            nextOp.limit === op.id
          ) {
            // Consumed immediately by string-slice as an integer limit.
            foldedOptionalWraps[wrapIndex] = 1;
            break;
          }
          if (storedAsInteger(op.value) || quietValue(op.value)) {
            // Exact integers (converted) and quiet values (see
            // quietValues) never have the `undefined` bits.
            if (storedAsInteger(op.value)) {
              const target = floatTarget(op.id, 0);
              floatLoad(target, op.value);
              floatStore(target, op.id);
            } else copyRawWord(value(op.value).offset, value(op.id).offset);
          } else {
            const target = floatTarget(op.id, 0);
            quietNumber(target, floatOperand(op.value, 0));
            floatStore(target, op.id);
          }
          quietValues[wrapIndex] = 1;
          break;
        }
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
            const elements = value(arrayOf(op.value)).type;
            if (!typedArrayIntegerElements(typedArrayType(elements)))
              saveRaw(11, op.id);
            else if (wantsInteger(op.id)) {
              saveRaw(11, op.id);
              markInteger(op.id);
            } else {
              elementToDouble(elements, 0, 11);
              floatStore(0, op.id);
            }
            break;
          }
          // Present selects the payload; absent the fallback.
          const optHome = homeOf(op.value),
            dstHome = homeOf(op.id);
          if (
            tracker === undefined &&
            options.hostABI?.javascriptConversion?.kind === "baseline" &&
            numberConstant(op.fallback) === 0 &&
            (valueUses[valueIds.intern(op.id)] ?? 0) === 1 &&
            optHome > 0 &&
            optHome < 32
          ) {
            let fusedOk = false;
            for (let k = operationIndex + 1; k < b.instructions.length; k++) {
              const cand = b.instructions[k];
              if (cand === undefined) break;
              if (
                cand.kind === "binary" &&
                (cand.operator === "+" || cand.operator === "-") &&
                (cand.left === op.id || cand.right === op.id)
              ) {
                const fusedOrId = pendingFusedAdd.get(cand.id);
                if (fusedOrId !== undefined) {
                  const otherId = cand.left === op.id ? cand.right : cand.left;
                  const otherIdx = valueIds.intern(otherId),
                    otherKind = wordKinds[otherIdx] ?? 0;
                  let otherFusable =
                    storedAsInteger(otherId) &&
                    (otherKind === 2 ||
                      otherKind === 3 ||
                      (otherKind === 6 &&
                        wordMagnitude(otherIdx) <= 0x10000000000000));
                  if (!otherFusable) {
                    for (let m = operationIndex + 1; m < k; m++) {
                      const mid = b.instructions[m];
                      if (
                        mid !== undefined &&
                        mid.kind === "load" &&
                        mid.id === otherId &&
                        integerSlots[mid.slot] === 1 &&
                        (otherKind === 2 ||
                          otherKind === 3 ||
                          (otherKind === 6 &&
                            wordMagnitude(otherIdx) <= 0x10000000000000))
                      ) {
                        otherFusable = true;
                        break;
                      }
                    }
                  }
                  if (otherFusable) {
                    // Verify no instruction between `cand` and `fusedOrId`
                    // clobbers `optHome`.
                    let safeToOr = true;
                    for (let m = k + 1; m < b.instructions.length; m++) {
                      const tail = b.instructions[m];
                      if (tail === undefined) {
                        safeToOr = false;
                        break;
                      }
                      if (tail.kind === "binary" && tail.id === fusedOrId)
                        break;
                      if (
                        tail.kind !== "load" &&
                        tail.kind !== "constant" &&
                        tail.kind !== "binary"
                      ) {
                        safeToOr = false;
                        break;
                      }
                    }
                    if (safeToOr) fusedOk = true;
                  }
                }
                break;
              }
              if (
                cand.kind !== "load" &&
                cand.kind !== "constant" &&
                cand.kind !== "binary"
              )
                break;
            }
            if (fusedOk) {
              elidedOptOr.set(op.id, op.value);
              break;
            }
          }
          if (optHome > 0 && optHome < 32 && dstHome > 0 && dstHome < 32) {
            const optional = rawRegister(op.value, 9);
            absentFlags(optional, 10);
            const fallback = floatOperand(op.fallback, 1);
            emit({
              op: "fcsel",
              rd: dstHome,
              rn: fallback,
              rm: optHome,
              condition: "eq",
            });
            if (tracker !== undefined)
              tracker.saved(op.id, instructions.length * 4);
            break;
          }
          const optional = rawRegister(op.value, 9);
          absentFlags(optional, 10);
          // The fallback is never int64 storage (see the integer
          // operand acceptance list).
          const fbConst = numberConstant(op.fallback),
            fallback: number | "zr" =
              fbConst === 0 && 1 / fbConst > 0
                ? "zr"
                : rawRegister(op.fallback, 11);
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
            // Signed and 64-bit, as on x86-64: a detached view's data
            // sits before its owner's, a negative offset.
            emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
            floatStore(0, op.id);
          }
          break;
        }
        case "c-memory": {
          viewToken = emitCMemory(cInteropCtx(), op, viewToken);
          break;
        }
        case "c-call": {
          emitCCall(cInteropCtx(), op);
          break;
        }
        case "host-call": {
          emitHostCall(hostCallCtx(), op);
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
          const shift = typedArrayScale(value(op.array).type);
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
          if (wantsInteger(op.id)) {
            const target = rawTarget(op.id, 9);
            emit({
              op: "ldr",
              width: 32,
              rt: target,
              rn: 10,
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
            rememberObject(deferRememberSlow());
          }
          break;
        case "reference-vector-copy":
        case "array-read":
        case "array-element":
        case "array-store":
        case "array-copy":
        case "array-fill":
        case "array-write": {
          operationIndex = emitArrayOp(arrayOpsCtx(), op, b, operationIndex);
          break;
        }
        case "load":
          if (integerSlots[op.slot] === 1) {
            if (wantsInteger(op.id)) {
              copyRawWord(slotOffset(op.slot), value(op.id).offset);
              markInteger(op.id);
              if (tracker !== undefined)
                tracker.saved(op.id, instructions.length * 4);
            } else {
              // A proven safe integer (never -0) converts exactly.
              rawLoad(9, slotOffset(op.slot));
              emit({ op: "scvtf-d-x", rd: 0, rn: 9 });
              floatStore(0, op.id);
            }
            break;
          }
          if (
            hasScriptOps &&
            (value(op.id).type === "general" ||
              value(op.id).type === "optional-boolean")
          ) {
            copyGeneralPair(slotOffset(op.slot), value(op.id).offset);
          } else if (value(op.id).type === "number") {
            copyFloatWord(slotOffset(op.slot), value(op.id).offset);
          } else {
            copyRawWord(slotOffset(op.slot), value(op.id).offset);
            if (
              value(op.id).type === "general" ||
              value(op.id).type === "optional-boolean"
            ) {
              copyRawWord(slotOffset(op.slot) + 8, value(op.id).offset + 8);
            }
          }
          if (tracker !== undefined)
            tracker.saved(op.id, instructions.length * 4);
          break;
        case "store": {
          // A copy only a fused miss test would read.
          if (
            fusion !== undefined &&
            fusion.skipped.indexOf(operationIndex) >= 0
          )
            break;
          const storeSrc = elidedStoreSource.get(op.value) ?? op.value,
            storeSrcIdx = valueIds.intern(storeSrc);
          if (emittedDirectStore[storeSrcIdx] === 1) {
            const dInt = directIntTarget[storeSrcIdx] ?? 0,
              dFloat = directFloatTarget[storeSrcIdx] ?? 0,
              slotReg =
                scalarRegisters === undefined
                  ? 0
                  : (scalarRegisters[slotOffset(op.slot) / 8] ?? 0);
            if (dInt !== 0) {
              if (slotReg === dInt - 1 + 32) break;
            } else if (dFloat !== 0) {
              if (slotReg === dFloat - 1) break;
            } else {
              break;
            }
          }
          if (integerSlots[op.slot] === 1) {
            const constant = deferredIntegers.get(storeSrc),
              aliasedInt = directIntAlias.get(storeSrc);
            if (constant !== undefined)
              writeInteger(constant, slotOffset(op.slot));
            else if (aliasedInt !== undefined)
              rawStore(aliasedInt, slotOffset(op.slot));
            else if (storedAsInteger(storeSrc))
              copyRawWord(value(storeSrc).offset, slotOffset(op.slot));
            else {
              intOperand(storeSrc, 9);
              rawStore(9, slotOffset(op.slot));
            }
            const recip = reciprocalStoreOffsets[op.slot] ?? 0;
            if (recip > 0)
              emitStoreReciprocal(
                emit,
                rawLoad,
                rawStore,
                slotOffset(op.slot),
                recip,
              );
            break;
          }
          if (
            value(storeSrc).type === "general" ||
            value(storeSrc).type === "optional-boolean"
          ) {
            copyGeneralPair(value(storeSrc).offset, slotOffset(op.slot));
            break;
          }
          if (value(storeSrc).type === "number" && !storedAsInteger(storeSrc)) {
            copyFloatWord(value(storeSrc).offset, slotOffset(op.slot));
            break;
          }
          copyRawWord(value(storeSrc).offset, slotOffset(op.slot));
          break;
        }
        case "unary": {
          if (
            (op.operator === "ceil" || op.operator === "trunc") &&
            wantsInteger(op.id) &&
            exactInteger(op.operand)
          ) {
            // Rounding an exact integer is the integer itself.
            const source = intRegister(op.operand, 9),
              target = intTarget(op.id, 9);
            if (source !== target)
              emit({
                op: "orr-reg",
                width: 64,
                rd: target,
                rn: "zr",
                rm: source,
              });
            saveRaw(target, op.id);
            markInteger(op.id);
          } else if (
            op.operator === "ceil" ||
            op.operator === "trunc" ||
            op.operator === "sqrt" ||
            op.operator === "fround" ||
            op.operator === "f16round"
          ) {
            const operand = floatOperand(op.operand, 0),
              target = floatTarget(op.id, 0);
            if (op.operator === "fround") {
              emit({ op: "fcvt-s-d", rd: target, rn: operand });
              emit({ op: "fcvt-d-s", rd: target, rn: target });
            } else if (op.operator === "f16round") {
              emit({ op: "fcvt-h-d", rd: target, rn: operand });
              emit({ op: "fcvt-d-h", rd: target, rn: target });
            } else {
              emit(
                op.operator === "sqrt"
                  ? { op: "fsqrt", rd: target, rn: operand }
                  : op.operator === "ceil"
                    ? { op: "frintp", rd: target, rn: operand }
                    : { op: "frintz", rd: target, rn: operand },
              );
            }
            floatStore(target, op.id);
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
            const bypass = storeBypassCandidate.get(op.id);
            if (bypass !== undefined && storedAsInteger(bypass)) {
              elidedStoreSource.set(op.id, bypass);
              const bypassDirect =
                directIntTarget[valueIds.intern(bypass)] ?? 0;
              if (bypassDirect !== 0) {
                directIntAlias.set(op.id, bypassDirect - 1);
                if (storedAsInteger(bypass)) markInteger(op.id);
              }
            } else if (wantsInteger(op.id)) {
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
            if (
              knownTrueBool.has(op.operand) ||
              knownFalseBool.has(op.operand)
            ) {
              const knownVal = knownTrueBool.has(op.operand),
                resultVal = op.operator === "!" ? !knownVal : knownVal;
              if (resultVal) knownTrueBool.add(op.id);
              else knownFalseBool.add(op.id);
              if (
                blockTerm.kind === "branch" &&
                blockTerm.condition === op.id &&
                blockDiamond === undefined &&
                (valueUses[valueIds.intern(op.id)] ?? 0) === 1
              )
                break;
              imm(9, resultVal ? 1 : 0);
              saveRaw(9, op.id);
              break;
            }
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
          if (fusion !== undefined && fusion.test === op.id) break;
          comparisonBranch = emitBinaryOp(
            ctx,
            op,
            b,
            blockBitTest,
            blockDiamond,
            comparisonIndex,
            comparisonValue,
            comparisonBranch,
            nextBlock,
            activeFusedAdd,
            elidedOptOr,
          );
          break;
        }
        case "call-indirect":
        case "call": {
          tailExitBlock = emitCallOp(
            ctx,
            op,
            b,
            operationIndex,
            directGeneralTarget,
            fusion,
            nextBlock,
            tailExitBlock,
          );
          break;
        }
      }
    }
    const t = b.terminator;
    visitTerminatorOperands(t, materializeInteger);
    if (viewAccesses) {
      viewExitTokens.set(b.id, viewToken);
      viewExitSlots.set(b.id, viewSlotTokens);
    }
    siteIndex = b.instructions.length;
    setSiteIndex(b.instructions.length);
    if (recordOperations) beginTerminator(b.id, t);
    if (tracker !== undefined)
      tracker.operation(b.id, -1, t.inline ?? -1, instructions.length * 4);
    setSpan({ start: t.start, end: t.end });
    if (tailExitBlock === b.id) {
      // The tail call already left this frame.
    } else if (t.kind === "trap") emit({ op: "brk", immediate: 0 });
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
      const preheaderHoists = loopPreheaderHoists.get(b.id);
      if (preheaderHoists !== undefined) {
        for (let hi = 0; hi < preheaderHoists.arraySlots.length; hi++) {
          const item = preheaderHoists.arraySlots[hi];
          if (item === undefined) continue;
          const offset = slotOffset(item.slot);
          const home = scalarRegisters?.[offset / 8] ?? 0;
          if (home >= 32)
            emit({
              op: "ldr",
              width: 64,
              rt: item.reg,
              rn: home - 32,
              offset: nativeArrayDataOffset,
            });
          else {
            rawLoad(item.reg, offset);
            emit({
              op: "ldr",
              width: 64,
              rt: item.reg,
              rn: item.reg,
              offset: nativeArrayDataOffset,
            });
          }
        }
        for (let hi = 0; hi < preheaderHoists.imulConsts.length; hi++) {
          const item = preheaderHoists.imulConsts[hi];
          if (item === undefined) continue;
          imm(item.reg, item.u32);
        }
        for (let hi = 0; hi < preheaderHoists.floatConsts.length; hi++) {
          const item = preheaderHoists.floatConsts[hi];
          if (item === undefined) continue;
          const immediate = float64Immediate(item.value);
          if (immediate !== undefined)
            emit({
              op: "fmov-d-imm",
              rd: item.reg,
              imm8: immediate,
            });
          else {
            const bits = encodeFloat64(item.value);
            imm64(17, bits.lo, bits.hi);
            emit({ op: "fmov-d-x", rd: item.reg, rn: 17 });
          }
        }
      }
      if (t.target !== nextBlock) branch({ op: "b" }, fn.id, t.target);
    } else if (
      t.kind === "branch" &&
      fusion !== undefined &&
      fusion.test !== undefined
    ) {
      // The access branched to its miss successor already.
      if (fusion.hit !== nextBlock) branch({ op: "b" }, fn.id, fusion.hit);
    } else if (t.kind === "branch") {
      const diamond = selects.diamonds.get(b.id);
      if (comparisonBranch === "emitted") {
        // The final comparison already branched to consequent/alternate.
      } else if (
        diamond === undefined &&
        (knownTrueBool.has(t.condition) || knownFalseBool.has(t.condition))
      ) {
        const target = knownTrueBool.has(t.condition)
          ? t.consequent
          : t.alternate;
        if (target !== nextBlock) branch({ op: "b" }, fn.id, target);
      } else if (diamond !== undefined) {
        const targetSlot = diamond.targetSlot,
          dstOffset = slotOffset(targetSlot),
          dstHome = scalarRegisters?.[dstOffset / 8] ?? 0,
          isFloat =
            fn.slots[targetSlot] === "number" && integerSlots[targetSlot] !== 1;
        const diamondNested = diamond.nested;
        if (diamondNested !== undefined && comparisonValue === undefined)
          emitNestedSelect(diamondNested, isFloat);
        let selectCondition: Condition;
        if (comparisonBranch !== undefined) selectCondition = comparisonBranch;
        else {
          const condReg = rawRegister(
            foldedPresentSource !== undefined && t.condition === foldedPresent
              ? foldedPresentSource
              : t.condition,
            11,
          );
          emit({
            op: "sub-imm",
            width: 64,
            rd: "zr",
            rn: condReg,
            immediate: 0,
            shift: 0,
            setFlags: true,
          });
          selectCondition = "ne";
        }
        if (isFloat) {
          const trueReg =
              diamond.nested?.inTrueArm === true
                ? 2
                : loadFloatSelectArm(diamond.trueArm, 0),
            falseReg =
              diamond.nested?.inTrueArm === false
                ? 2
                : loadFloatSelectArm(diamond.falseArm, 1),
            dstReg = dstHome > 0 && dstHome < 32 ? dstHome : 0;
          emit({
            op: "fcsel",
            rd: dstReg,
            rn: trueReg,
            rm: falseReg,
            condition: selectCondition,
          });
          if (dstHome >= 32)
            emit({ op: "fmov-x-d", rd: dstHome - 32, rn: dstReg });
          else if (dstHome === 0)
            emit({
              op: "str-d",
              rt: dstReg,
              rn: "sp",
              offset: dstOffset,
            });
        } else {
          const trueReg =
              diamond.nested?.inTrueArm === true
                ? 14
                : loadRawSelectArm(diamond.trueArm, 9),
            falseReg =
              diamond.nested?.inTrueArm === false
                ? 14
                : loadRawSelectArm(diamond.falseArm, 10),
            dstReg = dstHome >= 32 ? dstHome - 32 : 9;
          emit({
            op: "csel",
            width: 64,
            rd: dstReg,
            rn: trueReg,
            rm: falseReg,
            condition: selectCondition,
          });
          if (dstHome < 32) rawStore(dstReg, dstOffset);
        }
        clearWordCaches();
        if (diamond.join !== nextBlock)
          branch({ op: "b" }, fn.id, diamond.join);
      } else if (comparisonBranch !== undefined) {
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
        const condition = rawRegister(
          foldedPresentSource !== undefined && t.condition === foldedPresent
            ? foldedPresentSource
            : t.condition,
          9,
        );
        if (t.consequent === nextBlock)
          branch({ op: "cbz", width: 64, rt: condition }, fn.id, t.alternate);
        else {
          branch({ op: "cbnz", width: 64, rt: condition }, fn.id, t.consequent);
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
      // A fused chain needs no test when the object's two known
      // layouts share one placement group: read that placement.
      const pair = chain === undefined ? undefined : layoutPairs.get(b.id);
      let covering: RecordDispatchGroup | undefined;
      if (chain !== undefined && pair !== undefined)
        for (const group of chain.groups) {
          if (group === undefined) throw "dispatch group invariant";
          if (pair.every((record) => group.records.includes(record)))
            covering = group;
        }
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
          } else if (
            byteLength === 8 &&
            moved.type === "number" &&
            integerSlots[t.slot] === 1
          ) {
            const intReg = home >= 32 ? home - 32 : 10;
            if (home < 32) rawLoad(10, slotWord);
            emit({ op: "scvtf-d-x", rd: 0, rn: intReg });
            emit({ op: "str-d", rt: 0, rn: object, offset });
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
      if (covering !== undefined) {
        const placed = module.records?.[covering.record];
        if (placed === undefined) throw "dispatch group invariant";
        rawValue(9, t.object);
        transfer(placed, covering.field, 9);
      } else if (chain !== undefined && chain.groups.length > 1) {
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
            clearWordCaches();
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
            flowGuards !== undefined && ((flowGuards[b.id] ?? 0) & 1) !== 0,
            nonNull,
          );
        transfer(layout, t.field, object);
      }
      const presenceOffset = field.presenceOffset;
      if (t.operation !== "read" && presenceOffset !== undefined) {
        rawValue(9, t.object);
        imm(10, t.operation === "delete" ? 0 : 1);
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
        const written = slotOffset(t.slot);
        rememberObject(
          deferRememberSlow(),
          9,
          undefined,
          field.type === "general"
            ? (): readonly number[] => nonReferenceTag(written)
            : undefined,
        );
      }
      if (t.consequent !== nextBlock) branch({ op: "b" }, fn.id, t.consequent);
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
              (flowGuards !== undefined && ((flowGuards[b.id] ?? 0) & 2) !== 0),
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
              const written = slotOffset(t.slot);
              rememberObject(
                deferRememberSlow(),
                9,
                undefined,
                field.type === "general"
                  ? (): readonly number[] => nonReferenceTag(written)
                  : undefined,
              );
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
            // The barrier (and its tag filter, x12..x14) preserves the
            // cell helper's w0 completion status.
            const written = slotOffset(t.slot);
            rememberObject(
              deferRememberSlow(),
              9,
              undefined,
              field.type === "general"
                ? (): readonly number[] => nonReferenceTag(written)
                : undefined,
            );
          }
        }
        branch({ op: "cbz", width: 32, rt: 0 }, fn.id, t.consequent);
        branch({ op: "b" }, fn.id, t.alternate);
      }
    } else {
      if (
        fn.scriptEntry === true ||
        (directReturns !== undefined && directReturns[fn.id] === 1)
      ) {
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
    // Constants still deferred had only immediate uses.
    deferredIntegers.clear();
    if (transient !== undefined && storage !== undefined)
      for (const op of b.instructions) {
        if (op === undefined) throw "temporary instruction invariant";
        const id = instructionResult(op);
        if (id !== undefined && (transient[valueIds.intern(id)] ?? 0) !== 0)
          storage[value(id).offset / 8] = 0;
      }
    if (
      leafReferences !== undefined &&
      leafBase !== undefined &&
      storage !== undefined
    )
      for (const op of b.instructions) {
        if (op === undefined) throw "leaf reference instruction invariant";
        const id = instructionResult(op);
        if (id !== undefined)
          storage[value(id).offset / 8] = leafBase[value(id).offset / 8] ?? 0;
      }
  }
}
