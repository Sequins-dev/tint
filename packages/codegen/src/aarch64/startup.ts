import {
  nativeFunctionEntryOffset,
  nativeFunctionEnvironmentOffset,
} from "@tint/abi/function";
import {
  nativeAllocatorShutdownRequest,
  nativeHeaderFlagUnit,
  nativeArrayLengthOffset,
  nativeArrayDataOffset,
  nativeContextDomainOffset,
  nativeEngineThrowOffset,
  nativeStackHeadroomBytes,
  nativeStackLimitOffset,
  nativeStackMapRegistryEntryBytes,
  nativeStackMapRegistryHeaderBytes,
  nativeStackMapTransitionTable,
  nativeStackMapRegistryOffset,
  nativeThreadExitReadOffset,
  nativeWorkerStopPointerOffset,
  nativeWorkerStopStateOffset,
  nativeWorkerStackBytesOffset,
  nativeWorkerHeapBytesOffset,
  nativeThreadExitWriteOffset,
  type PosixHostABI,
} from "@tint/abi/host";
import {
  heapDebugContextOffset,
  heapDebugDescriptorBytes,
  heapDebugSampleIntervalOffset,
  heapDebugSampleLimitOffset,
  heapDebugSampleSymbol,
  heapDebugSampleThunkSymbol,
  heapDebugSymbol,
} from "@tint/abi/heap-debug";
import {
  contiguousCodeOutput,
  type CodeOutput,
  type CodePlan,
} from "@tint/abi/relocation";
import { readUnsigned } from "@tint/foundation/binary/bytes";
import {
  encode,
  writeInstruction,
  relativeAddress,
  farRelativeAddress,
  patchRelativeAddress,
  type Instruction,
  type Condition,
} from "./isa.ts";
import {
  nativeAllocationStateOffset,
  nativeContextBytes,
  type NativeModule,
  type NativeImportReference,
} from "./scalar/index.ts";
import type { UnwindRange, UnwindRow, UnwindSave } from "@tint/abi/unwind";
import { dwarfStackPointer } from "./unwind.ts";
import {
  emitDiagnostics,
  type DiagnosticsBlock,
  type DiagnosticProbe,
  type SignpostClassification,
  diagnosticAllocationEntryOffset,
  diagnosticDataLength,
  diagnosticHeapDescriptorOffset,
  diagnosticJitDescriptorOffset,
  diagnosticSampleEntryOffset,
  type SignpostSite,
} from "./diagnostics.ts";
/** A SignpostSite whose offset is relative to its module. */
export interface HostSignpostSite {
  readonly module: number;
  readonly offset: number;
  readonly name: number;
  readonly stackBytes: number;
  readonly classify?: SignpostClassification | undefined;
  /** End the interval with collection metrics (SignpostSite.metrics). */
  readonly metrics?: boolean | undefined;
  readonly majorRegister?: number | undefined;
}
/** Opt-in runtime diagnostics composed into the image (see
 * docs/runtime-diagnostics.md); absent in default images. */
export interface HostDiagnostics {
  /** Throw-origin capture (modules emitted with throwTraces) and an
   * uncaught-throw report; the image's trace table follows the code. */
  readonly stackTraces: boolean;
  /** Function entries (by module: 0 allocator, 1 runtime, 2 program) that
   * emit os_signpost intervals. */
  readonly signposts: readonly HostSignpostSite[];
  /** An interval around each runtime allocation slow-path call. */
  readonly allocationSignposts: boolean;
  /** The GDB/LLDB JIT registration interface. */
  readonly jitDebug: boolean;
  /** The heap debugger descriptor (`__tint_heap_descriptor`) and the
   * allocation sampling thunk and hook (docs/native-heap-profiling.md). */
  readonly heapIntrospection?: boolean | undefined;
}
export interface HostedDiagnostics {
  /** Initial `__DATA` contents of the diagnostic state. */
  readonly data: Uint8Array;
  readonly dataReferences: readonly {
    readonly offset: number;
    readonly rd: number;
    readonly scratch: number;
    readonly target: number;
    readonly far?: true | undefined;
  }[];
  /** Code offset at which the trace table must be appended (the code's end). */
  readonly tableOffset: number;
  readonly wideTrace: boolean;
  readonly cstring: { readonly offset: number; readonly byteLength: number };
  /** Routine names at code offsets, for symbol tables. */
  readonly routines: readonly {
    readonly name: string;
    readonly offset: number;
    readonly byteLength: number;
  }[];
  /** Exported names: code entries and data words. */
  readonly codeSymbols: readonly {
    readonly name: string;
    readonly offset: number;
  }[];
  readonly dataSymbols: readonly {
    readonly name: string;
    readonly offset: number;
  }[];
  readonly unwind: readonly UnwindRange[];
  /** USDT probe sites at code offsets (elf-usdt targets). */
  readonly probes: readonly DiagnosticProbe[];
}
export interface HostRequest {
  /** Opt in to a raw pthread entry and a one-number application entry. */
  readonly threaded?: boolean;
  readonly nodeWorkerLibrary?: boolean;
  readonly threadExitPipe?: boolean;
  readonly workerSafepoints?: boolean;
  readonly forceFarReach?: boolean | undefined;
  readonly allocator: {
    readonly native: NativeModule;
    readonly initialize: number;
    readonly allocate: number;
    readonly environmentBytes: number;
  };
  readonly runtime: { readonly native: NativeModule; readonly entry: number };
  readonly program: { readonly native: NativeModule; readonly entry: number };
  readonly programCode?: CodePlan | undefined;
  readonly managedBytes: number;
  readonly controlBytes: number;
  readonly allocationCapacity: number;
  readonly rootCapacity: number;
  /** Stack-map registry entries for code published at run time (JIT); the
   * image's own safepoint tables are registered in addition. */
  readonly stackMapCapacity?: number | undefined;
  readonly stackBytes: number;
  readonly pageSize: number;
  readonly abi: PosixHostABI;
  readonly diagnostics?: HostDiagnostics | undefined;
}
interface HostedMetadata {
  /** Placement of allocator, runtime, and program code, in that order. */
  readonly moduleOffsets: readonly number[];
  /** The hosted entry: a C `main(argc, argv)` returning the exit status. */
  readonly entryOffset: number;
  /** The image's process entry when the target's startup does not call
   * `main` itself (abi.processStart): it hands the hosted entry to libc. */
  readonly processStartOffset?: number | undefined;
  readonly workerEntryOffset: number | undefined;
  readonly imports: readonly NativeImportReference[];
  /** Call-frame rows of the entry code (process and worker entry). */
  readonly entryUnwind: UnwindRange;
  /** The process entry's call-frame rule (the outermost frame), when the
   * target has one. */
  readonly processStartUnwind?: UnwindRange | undefined;
  readonly diagnostics?: HostedDiagnostics | undefined;
  /** Writable data the program's callbacks share (docs/native-ffi.md,
   * "Callbacks"): the pthread key under which each thread's callback state
   * is found (created at startup), and the code sites addressing it. */
  readonly callbackData?:
    | {
        readonly byteLength: number;
        readonly references: readonly {
          readonly offset: number;
          readonly rd: number;
          readonly scratch: number;
          readonly target: number;
          /** A 20-byte far-model site. */
          readonly far?: true | undefined;
        }[];
      }
    | undefined;
}
export interface HostedCode extends HostedMetadata {
  readonly code: Uint8Array;
}
interface HostedCodePlan extends HostedMetadata {
  readonly codePlan: CodePlan;
}
type HostPlanning =
  | { readonly ok: true; readonly value: HostedCodePlan }
  | { readonly ok: false; readonly error: string };
export type HostEmission =
  | { readonly ok: true; readonly value: HostedCode }
  | { readonly ok: false; readonly error: string };
interface ArrayStorage {
  readonly header: number;
  readonly data: number;
  readonly kind: number;
  readonly length: number;
}
interface LocalReference {
  readonly offset: number;
  readonly register: number;
  readonly module: number;
  readonly target: number;
}
function uint(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}
function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}
/** Emits a POSIX-shaped startup adapter. Image format/signing remain separate.
 * All modules use Tint's private ABI; process entry uses the platform main ABI. */
export function emitHostedEntry(request: HostRequest): HostEmission {
  const planned = planHostedEntry(request);
  if (!planned.ok) return planned;
  const plan = planned.value.codePlan;
  let code: Uint8Array;
  try {
    code = new Uint8Array(plan.byteLength);
  } catch {
    return { ok: false, error: "host image allocation failed" };
  }
  const error = plan.write(contiguousCodeOutput(code, 0), 0);
  if (error !== undefined) return { ok: false, error };
  const hosted = planned.value;
  return {
    ok: true,
    value: {
      code,
      moduleOffsets: hosted.moduleOffsets,
      entryOffset: hosted.entryOffset,
      processStartOffset: hosted.processStartOffset,
      workerEntryOffset: hosted.workerEntryOffset,
      imports: hosted.imports,
      entryUnwind: hosted.entryUnwind,
      processStartUnwind: hosted.processStartUnwind,
      diagnostics: hosted.diagnostics,
      callbackData: hosted.callbackData,
    },
  };
}

export function planHostedEntry(request: HostRequest): HostPlanning {
  if (request.threaded === true && request.abi.threads === undefined)
    return { ok: false, error: "target has no thread lifecycle ABI" };
  for (const native of [
    request.allocator.native,
    request.runtime.native,
    request.program.native,
  ]) {
    if (native === undefined) throw "host native module invariant";
    if (
      native.linkage !== "local" ||
      native.managedImports.length !== 0 ||
      native.functionDescriptorImport !== undefined
    )
      return {
        ok: false,
        error:
          "unresolved managed imports cannot be composed as ordinary hosted AOT code",
      };
  }
  const abi = request.abi,
    page = request.pageSize;
  if (
    !uint(page) ||
    page < 4096 ||
    page > 65536 ||
    (page & (page - 1)) !== 0 ||
    !uint(request.managedBytes) ||
    request.managedBytes === 0 ||
    request.managedBytes % 16 !== 0 ||
    !uint(request.controlBytes) ||
    request.controlBytes < 4096 ||
    request.controlBytes % 16 !== 0 ||
    !uint(request.allocationCapacity) ||
    request.allocationCapacity === 0 ||
    !uint(request.rootCapacity) ||
    request.rootCapacity === 0 ||
    !uint(request.stackBytes) ||
    request.stackBytes < page ||
    request.stackBytes % page !== 0 ||
    !uint(request.allocator.environmentBytes) ||
    request.allocator.environmentBytes > 4096
  )
    return { ok: false, error: "invalid host memory policy" };
  const allocator = request.allocator.native,
    runtime = request.runtime.native,
    program = request.program.native;
  const programCode = request.programCode;
  const programLength = programCode?.byteLength ?? program.code.length;
  const far =
    request.forceFarReach === true ||
    allocator.code.length + runtime.code.length + programLength >= 0x80000000;
  const farReference: true | undefined = far ? true : undefined;
  const init = allocator.functions[request.allocator.initialize],
    allocate = allocator.functions[request.allocator.allocate],
    initialize = runtime.functions[request.runtime.entry],
    main = program.functions[request.program.entry];
  if (
    init === undefined ||
    allocate === undefined ||
    initialize === undefined ||
    main === undefined
  )
    return { ok: false, error: "missing host entry" };
  if (
    init.signature.parameters.length !== 3 ||
    allocate.signature.parameters.length !== 1 ||
    initialize.signature.parameters.length !== 15 ||
    (request.threaded === true
      ? main.signature.parameters.length !==
          (request.nodeWorkerLibrary === true ? 2 : 1) ||
        main.signature.parameters.some(
          (parameter, index) =>
            parameter === undefined ||
            parameter.kind !== "float" ||
            parameter.index !== index,
        )
      : main.signature.parameters.length !== 0) ||
    initialize.signature.stackBytes !== 32
  )
    return { ok: false, error: "invalid host entry signature" };
  for (let i = 0; i < 15; i++) {
    const location = initialize.signature.parameters[i];
    if (
      location === undefined ||
      location.kind !== (i < 8 ? "float" : i < 12 ? "integer" : "stack") ||
      location.index !== (i < 8 ? i : i < 12 ? i - 4 : (i - 12) * 8)
    )
      return { ok: false, error: "invalid runtime parameter layout" };
  }
  const controlCapacity = request.controlBytes / 16,
    arrays: ArrayStorage[] = [];
  let cursor = 256;
  function array(
    header: number,
    kind: number,
    length: number,
    width: number,
  ): void {
    cursor = align(cursor, 16);
    arrays.push({ header, data: cursor, kind, length });
    cursor += length * width;
  }
  array(0, 4, controlCapacity * 3 + 96, 4);
  array(32, 4, request.allocationCapacity * 3 + 96, 4);
  array(64, 4, request.allocationCapacity, 4);
  array(96, 4, request.allocationCapacity, 4);
  // Keep page-lookup scratch available even at descriptor exhaustion. The
  // collector borrows the tail after its immutable allocation-start prefix.
  array(
    128,
    5,
    request.allocationCapacity + Math.ceil(request.managedBytes / 4096) + 1,
    8,
  );
  array(160, 2, request.allocationCapacity, 1);
  array(192, 4, request.allocationCapacity, 4);
  array(224, 5, request.rootCapacity, 8);
  // Stack-map registry (context word 0): the image's safepoint tables, a
  // transparent range for diagnostics thunks, then run-time publications.
  const staticStackMaps: {
    module: number;
    codeOffset: number;
    codeLength: number;
    tableOffset: number;
  }[] = [];
  // Callback entry thunks first: the walk takes the first range holding a
  // return address, and the thunks lie inside the program's range. Their
  // table word is the transition sentinel (docs/gc-stack-maps.md,
  // "Transition records").
  const callbackThunks = request.program.native.callbackThunks;
  if (callbackThunks !== undefined)
    staticStackMaps.push({
      module: 2,
      codeOffset: callbackThunks.offset,
      codeLength: callbackThunks.byteLength,
      tableOffset: -1,
    });
  for (let index = 0; index < 3; index++) {
    const native =
      index === 0
        ? request.allocator.native
        : index === 1
          ? request.runtime.native
          : request.program.native;
    for (const table of native.stackMaps) {
      if (table === undefined) throw "host stack map invariant";
      staticStackMaps.push({
        module: index,
        codeOffset: table.codeOffset,
        codeLength: table.codeLength,
        tableOffset: table.tableOffset,
      });
    }
  }
  const stackMapCapacity =
      staticStackMaps.length +
      (request.diagnostics === undefined ? 0 : 1) +
      (request.stackMapCapacity ?? 16384),
    stackMapRegistry = align(cursor + (request.workerSafepoints ? 8 : 0), 16);
  if (!uint(stackMapCapacity) || stackMapCapacity > 1048576)
    return { ok: false, error: "invalid stack map capacity" };
  cursor =
    stackMapRegistry +
    nativeStackMapRegistryHeaderBytes +
    stackMapCapacity * nativeStackMapRegistryEntryBytes;
  const controlHeap = align(cursor, 16),
    controlLength = align(controlHeap + request.controlBytes, page),
    stackLength = request.stackBytes + page * 2,
    stackHeadroom = Math.min(
      nativeStackHeadroomBytes,
      Math.floor(request.stackBytes / 64) * 16,
    );
  if (!uint(controlLength) || !uint(stackLength))
    return { ok: false, error: "host memory policy exceeds region domain" };
  const instructions: Instruction[] = [],
    imports: NativeImportReference[] = [],
    references: LocalReference[] = [],
    diagnosticReferences: {
      offset: number;
      register: number;
      entry: string;
    }[] = [],
    dataReferences: {
      offset: number;
      rd: number;
      scratch: number;
      target: number;
      far?: true | undefined;
    }[] = [],
    // Sites addressing the callback key word (docs/native-ffi.md,
    // "Callbacks"), in the callback data after the diagnostic state.
    callbackKeyReferences: {
      offset: number;
      rd: number;
      scratch: number;
      target: number;
      far?: true | undefined;
    }[] = [];
  const diagnostics = request.diagnostics;
  const labels = new Map<string, number>(),
    branches: {
      offset: number;
      label: string;
      condition: Condition | undefined;
    }[] = [];
  const allocatorEnvironmentOffset = 96 + nativeContextBytes;
  // The frame ends with the entry frame record (see below).
  const entryRecordOffset = Math.max(
      496,
      align(
        allocatorEnvironmentOffset + request.allocator.environmentBytes,
        16,
      ),
    ),
    frameBytes = entryRecordOffset + 16;
  function emit(instruction: Instruction): void {
    instructions.push(instruction);
  }
  function imm(register: number, value: number): void {
    emit({
      op: "movz",
      width: 64,
      rd: register,
      immediate: value % 65536,
      shift: 0,
    });
    emit({
      op: "movk",
      width: 64,
      rd: register,
      immediate: Math.floor(value / 65536) % 65536,
      shift: 16,
    });
    emit({
      op: "movk",
      width: 64,
      rd: register,
      immediate: Math.floor(value / 4294967296) % 65536,
      shift: 32,
    });
    emit({
      op: "movk",
      width: 64,
      rd: register,
      immediate: Math.floor(value / 281474976710656) % 65536,
      shift: 48,
    });
  }
  function move(to: number, from: number): void {
    emit({
      op: "add-imm",
      width: 64,
      rd: to,
      rn: from,
      immediate: 0,
      shift: 0,
      setFlags: false,
    });
  }
  function zeroFramePointer(): void {
    emit({ op: "orr-reg", width: 64, rd: 29, rn: "zr", rm: "zr" });
  }
  function address(to: number, from: number, offset: number): void {
    imm(9, offset);
    emit({
      op: "add-reg",
      width: 64,
      rd: to,
      rn: from,
      rm: 9,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
  }
  function stackAddress(to: number, offset: number): void {
    emit({
      op: "add-imm",
      width: 64,
      rd: to,
      rn: "sp",
      immediate: offset,
      shift: 0,
      setFlags: false,
    });
  }
  function store(register: number, offset: number): void {
    emit({ op: "str", width: 64, rt: register, rn: "sp", offset });
  }
  function load(register: number, offset: number): void {
    emit({ op: "ldr", width: 64, rt: register, rn: "sp", offset });
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
  function branch(label: string, condition?: Condition): void {
    branches.push({ offset: instructions.length, label, condition });
    if (condition === undefined) emit({ op: "b", displacement: 0 });
    else emit({ op: "b.cond", condition, displacement: 0 });
  }
  function label(name: string): void {
    labels.set(name, instructions.length);
  }
  function pointer(register: number): void {
    const value = far
      ? farRelativeAddress(register, 17, 0)
      : relativeAddress(register, 17, 0);
    if (!value.ok) throw "host address invariant";
    for (const instruction of value.value) {
      if (instruction === undefined) throw "host address instruction invariant";
      emit(instruction);
    }
  }
  function local(register: number, module: number, target: number): void {
    references.push({
      offset: instructions.length * 4,
      register,
      module,
      target,
    });
    pointer(register);
  }
  /** Address of a diagnostics routine (resolved after module placement). */
  function diagnostic(register: number, entry: string): void {
    diagnosticReferences.push({
      offset: instructions.length * 4,
      register,
      entry,
    });
    pointer(register);
  }
  function dataAddress(register: number, target: number): void {
    dataReferences.push({
      offset: instructions.length * 4,
      rd: register,
      scratch: 17,
      target,
      far: farReference,
    });
    pointer(register);
  }
  /** Call C library function `name` (spelled without the target's symbol
   * prefix). */
  function foreign(name: string): void {
    importCall(abi.symbolPrefix + name);
  }
  /** Call the imported symbol `symbol`, spelled as the image names it. */
  function importCall(symbol: string): void {
    imports.push({
      offset: instructions.length * 4,
      rd: 16,
      scratch: 17,
      target: { kind: "import", name: symbol },
      far: farReference,
    });
    pointer(16);
    emit({ op: "ldr", width: 64, rt: 16, rn: 16, offset: 0 });
    emit({ op: "blr", rn: 16 });
  }
  function map(register: number, length: number): void {
    imm(0, 0);
    imm(1, length);
    imm(2, 3);
    imm(3, abi.anonymousPrivateFlags);
    imm(4, 0xffffffff);
    imm(5, 0);
    foreign("mmap");
    imm(9, 0);
    compare(0, 9);
    branch("cleanup", "le");
    move(register, 0);
  }
  function privateCall(
    module: number,
    offset: number,
    environment: boolean,
  ): void {
    stackAddress(0, 96);
    if (environment) stackAddress(1, allocatorEnvironmentOffset);
    else imm(1, 0);
    imm(2, 0);
    stackAddress(3, 64);
    local(16, module, offset);
    emit({ op: "blr", rn: 16 });
    imm(9, 1);
    compare(0, 9);
    branch("runtime-failure", "ne");
  }
  /** Rewrites the four-instruction `imm` at `at` to load `value`. */
  function patchImmediate(at: number, register: number, value: number): void {
    const scales = [1, 65536, 4294967296, 281474976710656];
    for (let index = 0; index < 4; index++) {
      const immediate = Math.floor(value / (scales[index] ?? 1)) % 65536;
      instructions[at + index] =
        index === 0
          ? { op: "movz", width: 64, rd: register, immediate, shift: 0 }
          : {
              op: "movk",
              width: 64,
              rd: register,
              immediate,
              shift: index === 1 ? 16 : index === 2 ? 32 : 48,
            };
    }
  }
  function number(register: number, value: number): void {
    imm(9, value);
    emit({ op: "scvtf-d-x", rd: register, rn: 9 });
  }
  /** x9 returns the configured ceiling. The startup record is a trusted
   * scalar capability, present only in tagged worker invocations. */
  function workerBytes(
    offset: number,
    maximum: number,
    minimum: number,
    site: string,
  ): void {
    imm(9, maximum);
    const ready = "worker-limit-ready-" + site;
    imm(11, 1);
    emit({ op: "and-reg", width: 64, rd: 10, rn: 27, rm: 11 });
    imm(11, 0);
    compare(10, 11);
    branch(ready, "eq");
    emit({
      op: "sub-imm",
      width: 64,
      rd: 10,
      rn: 27,
      immediate: 1,
      shift: 0,
      setFlags: false,
    });
    emit({ op: "ldr", width: 64, rt: 10, rn: 10, offset });
    compare(10, 11);
    branch(ready, "eq");
    compare(10, 9);
    branch("runtime-failure", "hi");
    imm(11, minimum);
    compare(10, 11);
    branch("runtime-failure", "cc");
    move(9, 10);
    label(ready);
  }
  let workerEntryOffset: number | undefined;
  if (request.threaded === true) {
    // Root process forwards zero; worker forwards only its raw scalar argument.
    imm(2, 0);
    branch("host-start");
    workerEntryOffset = instructions.length * 4;
    move(2, 0);
    imm(0, 0);
    if (request.nodeWorkerLibrary !== true) imm(1, 0);
    label("host-start");
  }
  // Preserve the system frame and all callee-saved registers used by startup.
  // The unwind rows follow each save; once x19 holds the save area it anchors
  // the CFA, since startup then moves sp to its own mapped stack.
  const entryRows: UnwindRow[] = [
    { offset: 0, cfaRegister: dwarfStackPointer, cfaOffset: 0, saves: [] },
  ];
  const entrySaves: UnwindSave[] = [];
  for (const first of [29, 19, 21, 23, 25, 27]) {
    if (first === undefined) throw "host save invariant";
    emit({
      op: "stp",
      width: 64,
      rt: first,
      rt2: first + 1,
      rn: "sp",
      offset: -16,
      mode: "pre",
    });
    const depth = (entrySaves.length / 2 + 1) * 16;
    entrySaves.push({ register: first, offset: -depth });
    entrySaves.push({ register: first + 1, offset: 8 - depth });
    entryRows.push({
      offset: instructions.length * 4,
      cfaRegister: dwarfStackPointer,
      cfaOffset: depth,
      saves: entrySaves.slice(),
    });
  }
  emit({
    op: "add-imm",
    width: 64,
    rd: 19,
    rn: "sp",
    immediate: 0,
    shift: 0,
    setFlags: false,
  });
  entryRows.push({
    offset: instructions.length * 4,
    cfaRegister: 19,
    cfaOffset: (entrySaves.length / 2) * 16,
    saves: entrySaves.slice(),
  });
  if (request.threaded === true) move(27, 2);
  move(23, 0);
  move(24, 1);
  // Only os_signpost needs a log handle; USDT probe sites need no setup.
  const signpostFacility = abi.signposts;
  if (
    diagnostics !== undefined &&
    (diagnostics.signposts.length > 0 || diagnostics.allocationSignposts) &&
    signpostFacility !== undefined &&
    signpostFacility.kind === "darwin-os-signpost"
  ) {
    diagnostic(16, "signpost-init");
    emit({ op: "blr", rn: 16 });
  }
  imm(20, 0);
  imm(21, 0);
  imm(22, 0);
  imm(25, 71);
  // x28 holds the runtime's allocator closure (a permanent object) once it
  // is published, and cleanup then sends it the shutdown request; managed
  // code preserves x19-x28.
  if (request.threaded === true) imm(28, 0);
  map(20, controlLength);
  map(21, request.managedBytes);
  map(22, stackLength);
  move(0, 22);
  imm(1, page);
  imm(2, 0);
  foreign("mprotect");
  imm(9, 0);
  compare(0, 9);
  branch("cleanup", "ne");
  address(0, 22, page + request.stackBytes);
  imm(1, page);
  imm(2, 0);
  foreign("mprotect");
  imm(9, 0);
  compare(0, 9);
  branch("cleanup", "ne");
  address(9, 22, page + request.stackBytes);
  emit({
    op: "add-imm",
    width: 64,
    rd: "sp",
    rn: 9,
    immediate: 0,
    shift: 0,
    setFlags: false,
  });
  if (frameBytes >= 4096)
    emit({
      op: "sub-imm",
      width: 64,
      rd: "sp",
      rn: "sp",
      immediate: Math.floor(frameBytes / 4096),
      shift: 12,
      setFlags: false,
    });
  emit({
    op: "sub-imm",
    width: 64,
    rd: "sp",
    rn: "sp",
    immediate: frameBytes % 4096,
    shift: 0,
    setFlags: false,
  });
  for (let offset = 0; offset < frameBytes; offset += 8)
    emit({ op: "str", width: 64, rt: "zr", rn: "sp", offset });
  // Managed frames chain to this zeroed entry record: the collector's stack
  // walk ends at the frame whose caller it is, while trace capture still sees
  // the return into the entry (unwinders use the rows above, anchored on x19).
  stackAddress(29, entryRecordOffset);
  // One never-recycled identity page per hosted context. This tiny tombstone
  // deliberately outlives cleanup of its heap/control mappings, preventing ABA
  // aliasing when another context is initialized at reused virtual addresses.
  // Its first words record the isolate's shared block registry
  // (native-runtime shared-buffers.ts).
  map(26, page);
  imm(9, 0);
  compare(26, 9);
  branch("cleanup", "eq");
  imm(9, Number.MAX_SAFE_INTEGER);
  compare(26, 9);
  branch("cleanup", "hi");
  store(26, 96 + nativeContextDomainOffset);
  // Managed prologues compare their new stack pointer against this limit and
  // throw instead of reaching the low guard page; the headroom above it runs
  // the throw path. Startup frames are not zeroed: clear the pending word.
  if (request.workerSafepoints === true) {
    workerBytes(
      nativeWorkerStackBytesOffset,
      request.stackBytes,
      stackHeadroom * 2,
      "stack-limit",
    );
    move(12, 9);
    address(9, 22, page + request.stackBytes + stackHeadroom);
    emit({
      op: "sub-reg",
      width: 64,
      rd: 9,
      rn: 9,
      rm: 12,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
  } else address(9, 22, page + stackHeadroom);
  store(9, 96 + nativeStackLimitOffset);
  imm(9, 0);
  store(9, 96 + nativeEngineThrowOffset);
  // Mapped storage is initially zero; borrowed array headers are permanent control state.
  for (const item of arrays) {
    if (item === undefined) throw "host array invariant";
    address(10, 20, item.header);
    // The kind marker with the borrowed flag (1).
    imm(11, item.kind + nativeHeaderFlagUnit);
    emit({ op: "str", width: 64, rt: 11, rn: 10, offset: 0 });
    imm(11, item.length);
    emit({
      op: "str",
      width: 64,
      rt: 11,
      rn: 10,
      offset: nativeArrayLengthOffset,
    });
    address(11, 20, item.data);
    emit({
      op: "str",
      width: 64,
      rt: 11,
      rn: 10,
      offset: nativeArrayDataOffset,
    });
  }
  // Callback thunks find each thread's callback state under one pthread
  // key, created here before any managed code (or agent) runs.
  if (request.program.native.callbackThunks !== undefined) {
    callbackKeyReferences.push({
      offset: instructions.length * 4,
      rd: 0,
      scratch: 17,
      target: 0,
      far: farReference,
    });
    pointer(0);
    imm(1, 0);
    foreign("pthread_key_create");
    imm(10, 0);
    compare(0, 10);
    branch("runtime-failure", "ne");
  }
  // Publish the registry before any managed code runs. Mapped control
  // storage is zero: the walk start and unused entries need no stores.
  address(10, 20, stackMapRegistry);
  if (request.workerSafepoints === true) {
    imm(11, 1);
    emit({ op: "and-reg", width: 64, rd: 12, rn: 27, rm: 11 });
    imm(11, 0);
    compare(12, 11);
    branch("worker-stop-pointer-ready", "eq");
    address(12, 27, nativeWorkerStopStateOffset - 1);
    address(11, 20, stackMapRegistry + nativeWorkerStopPointerOffset);
    emit({ op: "str", width: 64, rt: 12, rn: 11, offset: 0 });
    label("worker-stop-pointer-ready");
  }
  imm(11, staticStackMaps.length + (diagnostics === undefined ? 0 : 1));
  emit({ op: "str", width: 64, rt: 11, rn: 10, offset: 0 });
  imm(11, stackMapCapacity);
  emit({ op: "str", width: 64, rt: 11, rn: 10, offset: 8 });
  for (let index = 0; index < staticStackMaps.length; index++) {
    const table = staticStackMaps[index];
    if (table === undefined) throw "host stack map invariant";
    const entry =
      nativeStackMapRegistryHeaderBytes +
      index * nativeStackMapRegistryEntryBytes;
    local(11, table.module, table.codeOffset);
    emit({ op: "str", width: 64, rt: 11, rn: 10, offset: entry });
    imm(11, table.codeLength);
    emit({ op: "str", width: 64, rt: 11, rn: 10, offset: entry + 8 });
    if (table.tableOffset < 0) imm(11, nativeStackMapTransitionTable);
    else local(11, table.module, table.tableOffset);
    emit({ op: "str", width: 64, rt: 11, rn: 10, offset: entry + 16 });
  }
  // Diagnostics thunks (signposts) sit between managed frames and hold no
  // references; their length is patched once the block is emitted.
  let diagnosticsLengthInstruction = -1;
  if (diagnostics !== undefined) {
    const entry =
      nativeStackMapRegistryHeaderBytes +
      staticStackMaps.length * nativeStackMapRegistryEntryBytes;
    local(11, 3, 0);
    emit({ op: "str", width: 64, rt: 11, rn: 10, offset: entry });
    diagnosticsLengthInstruction = instructions.length;
    imm(11, 0);
    emit({ op: "str", width: 64, rt: 11, rn: 10, offset: entry + 8 });
  }
  store(10, 96 + nativeStackMapRegistryOffset);
  address(9, 20, controlHeap);
  store(9, 104);
  local(9, 0, allocate.offset);
  store(9, 112);
  stackAddress(9, allocatorEnvironmentOffset);
  store(9, 120);
  imm(9, request.controlBytes);
  store(9, 128);
  store(23, 136);
  store(24, 144);
  number(0, request.controlBytes);
  number(1, 16);
  move(4, 20);
  privateCall(0, init.offset, true);
  load(9, 80);
  imm(10, 1);
  compare(9, 10);
  branch("runtime-failure", "ne");
  // Runtime factory: eight numeric windows, then seven borrowed typed arrays.
  emit({ op: "scvtf-d-x", rd: 0, rn: 21 });
  if (request.workerSafepoints === true) {
    workerBytes(
      nativeWorkerHeapBytesOffset,
      request.managedBytes,
      page * 4,
      "heap-window",
    );
    emit({ op: "scvtf-d-x", rd: 1, rn: 9 });
  } else number(1, request.managedBytes);
  emit({ op: "scvtf-d-x", rd: 2, rn: 20 });
  number(3, controlLength);
  local(26, -1, 0);
  emit({ op: "scvtf-d-x", rd: 4, rn: 26 });
  const imageLengthInstruction = instructions.length;
  number(5, 0);
  if (request.workerSafepoints === true) {
    workerBytes(
      nativeWorkerStackBytesOffset,
      request.stackBytes,
      stackHeadroom * 2,
      "stack-window",
    );
    move(12, 9);
    address(9, 22, page + request.stackBytes);
    emit({
      op: "sub-reg",
      width: 64,
      rd: 9,
      rn: 9,
      rm: 12,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    emit({ op: "scvtf-d-x", rd: 6, rn: 9 });
    emit({ op: "scvtf-d-x", rd: 7, rn: 12 });
  } else {
    address(9, 22, page);
    emit({ op: "scvtf-d-x", rd: 6, rn: 9 });
    number(7, request.stackBytes);
  }
  for (let index = 0; index < 7; index++) {
    if (index < 4) address(index + 4, 20, 32 + index * 32);
    else {
      address(9, 20, 32 + index * 32);
      store(9, (index - 4) * 8);
    }
  }
  privateCall(1, initialize.offset, false);
  load(10, 80);
  imm(9, 0);
  compare(10, 9);
  branch("runtime-failure", "eq");
  emit({
    op: "ldr",
    width: 64,
    rt: 9,
    rn: 10,
    offset: nativeFunctionEntryOffset,
  });
  if (diagnostics?.allocationSignposts === true) {
    // The slow path runs through the signpost routine, which forwards to it.
    dataAddress(11, diagnosticAllocationEntryOffset);
    emit({ op: "str", width: 64, rt: 9, rn: 11, offset: 0 });
    diagnostic(9, "allocation-signpost");
  }
  if (diagnostics?.heapIntrospection === true) {
    // Allocation sampling forwards to the entry chosen so far; tools find
    // the heap through the published context (cleared again at cleanup).
    dataAddress(11, diagnosticSampleEntryOffset);
    emit({ op: "str", width: 64, rt: 9, rn: 11, offset: 0 });
    diagnostic(9, "allocation-sample");
    dataAddress(11, diagnosticHeapDescriptorOffset);
    stackAddress(12, 96);
    emit({
      op: "str",
      width: 64,
      rt: 12,
      rn: 11,
      offset: heapDebugContextOffset,
    });
    // A tool that launched the program armed sampling by writing only the
    // interval: save the published nursery limit and lower it now.
    emit({
      op: "ldr",
      width: 64,
      rt: 12,
      rn: 11,
      offset: heapDebugSampleIntervalOffset,
    });
    imm(13, 0);
    compare(12, 13);
    branch("heap-sampling-unarmed", "eq");
    load(13, 96 + nativeAllocationStateOffset);
    emit({ op: "ldr", width: 32, rt: 14, rn: 13, offset: 4 });
    emit({
      op: "str",
      width: 64,
      rt: 14,
      rn: 11,
      offset: heapDebugSampleLimitOffset,
    });
    emit({ op: "ldr", width: 32, rt: 15, rn: 13, offset: 0 });
    emit({
      op: "add-reg",
      width: 64,
      rd: 15,
      rn: 15,
      rm: 12,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    compare(15, 14);
    emit({ op: "csel", width: 64, rd: 15, rn: 15, rm: 14, condition: "cc" });
    emit({ op: "str", width: 32, rt: 15, rn: 13, offset: 4 });
    label("heap-sampling-unarmed");
  }
  store(9, 112);
  emit({
    op: "ldr",
    width: 64,
    rt: 9,
    rn: 10,
    offset: nativeFunctionEnvironmentOffset,
  });
  store(9, 120);
  if (request.threaded === true) move(28, 10);
  store(21, 104);
  if (request.workerSafepoints === true)
    workerBytes(
      nativeWorkerHeapBytesOffset,
      request.managedBytes,
      page * 4,
      "allocator-window",
    );
  else imm(9, request.managedBytes);
  store(9, 128);
  if (request.threaded === true) emit({ op: "scvtf-d-x", rd: 0, rn: 27 });
  if (request.nodeWorkerLibrary === true) {
    load(9, 144);
    emit({ op: "scvtf-d-x", rd: 1, rn: 9 });
  }
  if (diagnostics?.stackTraces === true) {
    // An uncaught throw reports its value and recorded trace, then exits as
    // any runtime failure does.
    stackAddress(0, 96);
    imm(1, 0);
    imm(2, 0);
    stackAddress(3, 64);
    local(16, 2, main.offset);
    emit({ op: "blr", rn: 16 });
    imm(9, 2);
    compare(0, 9);
    branch("main-returned", "ne");
    load(0, 80);
    load(1, 88);
    imm(2, 1);
    diagnostic(16, "trace-report");
    emit({ op: "blr", rn: 16 });
    branch("runtime-failure");
    label("main-returned");
    imm(9, 1);
    compare(0, 9);
    branch("runtime-failure", "ne");
  } else privateCall(2, main.offset, false);
  emit({ op: "ldr-d", rt: 0, rn: "sp", offset: 80 });
  emit({ op: "fcvtzs-w-d", rd: 25, rn: 0 });
  emit({ op: "scvtf-d-w", rd: 1, rn: 25 });
  emit({ op: "fcmp", rn: 0, rm: 1 });
  branch("runtime-failure", "ne");
  imm(9, 255);
  compare(25, 9);
  branch("runtime-failure", "hi");
  branch("cleanup");
  label("runtime-failure");
  imm(25, 70);
  label("cleanup");
  if (diagnostics?.heapIntrospection === true) {
    dataAddress(11, diagnosticHeapDescriptorOffset);
    emit({
      op: "str",
      width: 64,
      rt: "zr",
      rn: 11,
      offset: heapDebugContextOffset,
    });
  }
  if (request.threaded === true) {
    // The runtime joins its collector workers (and returns what it holds
    // outside the heap) before the heap and control mappings go, through
    // the allocation slow-path ABI with the shutdown request. x28 is nonzero
    // only once the runtime is published, when sp is the entry frame on the
    // mapped stack. An unjoined worker could still touch the mappings, so an
    // abrupt completion keeps them all and exits 71 (x28 stays 1).
    imm(9, 0);
    compare(28, 9);
    branch("shutdown-checked", "eq");
    stackAddress(0, 96);
    emit({
      op: "ldr",
      width: 64,
      rt: 1,
      rn: 28,
      offset: nativeFunctionEnvironmentOffset,
    });
    imm(2, 0);
    stackAddress(3, 64);
    number(0, -nativeAllocatorShutdownRequest);
    emit({ op: "fneg", rd: 0, rn: 0 });
    emit({
      op: "ldr",
      width: 64,
      rt: 16,
      rn: 28,
      offset: nativeFunctionEntryOffset,
    });
    emit({ op: "blr", rn: 16 });
    imm(9, 1);
    compare(0, 9);
    imm(28, 0);
    branch("shutdown-checked", "eq");
    imm(25, 71);
    imm(28, 1);
    label("shutdown-checked");
  }
  emit({
    op: "add-imm",
    width: 64,
    rd: "sp",
    rn: 19,
    immediate: 0,
    shift: 0,
    setFlags: false,
  });
  if (request.threaded === true) {
    imm(9, 0);
    compare(28, 9);
    branch("mappings-released", "ne");
  }
  const releaseRegisters = [21, 20, 22],
    releaseLengths = [request.managedBytes, controlLength, stackLength];
  for (let index = 0; index < releaseRegisters.length; index++) {
    const register = releaseRegisters[index],
      length = releaseLengths[index];
    if (register === undefined || length === undefined)
      throw "host release invariant";
    imm(9, 0);
    compare(register, 9);
    const skip = "skip-" + register;
    branch(skip, "eq");
    move(0, register);
    imm(1, length);
    foreign("munmap");
    label(skip);
  }
  label("mappings-released");
  if (request.threaded === true && request.threadExitPipe === true) {
    imm(9, 1);
    emit({
      op: "and-reg",
      width: 64,
      rd: 9,
      rn: 27,
      rm: 9,
    });
    imm(10, 0);
    compare(9, 10);
    branch("thread-exit-done", "eq");
    emit({
      op: "sub-imm",
      width: 64,
      rd: 27,
      rn: 27,
      immediate: 1,
      shift: 0,
      setFlags: false,
    });
    // The owner can release the record as soon as it sees the status.
    // Copy both worker-owned descriptors before publication.
    emit({
      op: "ldr",
      width: 64,
      rt: 23,
      rn: 27,
      offset: nativeThreadExitWriteOffset,
    });
    emit({
      op: "ldr",
      width: 64,
      rt: 24,
      rn: 27,
      offset: nativeThreadExitReadOffset,
    });
    emit({
      op: "add-imm",
      width: 64,
      rd: 9,
      rn: 25,
      immediate: 1,
      shift: 0,
      setFlags: false,
    });
    emit({ op: "stlr", width: 64, rt: 9, rn: 27 });
    emit({
      op: "sub-imm",
      width: 64,
      rd: "sp",
      rn: "sp",
      immediate: 16,
      shift: 0,
      setFlags: false,
    });
    imm(9, 1);
    store(9, 0);
    label("thread-exit-write");
    move(0, 23);
    stackAddress(1, 0);
    imm(2, 1);
    foreign("write");
    imm(9, 0);
    compare(0, 9);
    branch("thread-exit-close", "ge");
    importCall(abi.errnoSymbol);
    emit({ op: "ldr", width: 32, rt: 9, rn: 0, offset: 0 });
    imm(10, 4); // EINTR. EAGAIN already has a readable notification.
    compare(9, 10);
    branch("thread-exit-write", "eq");
    label("thread-exit-close");
    move(0, 23);
    foreign("close");
    move(0, 24);
    foreign("close");
    emit({
      op: "add-imm",
      width: 64,
      rd: "sp",
      rn: 19,
      immediate: 0,
      shift: 0,
      setFlags: false,
    });
    label("thread-exit-done");
  }
  move(0, 25);
  for (const first of [27, 25, 23, 21, 19, 29]) {
    if (first === undefined) throw "host restore invariant";
    emit({
      op: "ldp",
      width: 64,
      rt: first,
      rt2: first + 1,
      rn: "sp",
      offset: 16,
      mode: "post",
    });
  }
  emit({ op: "ret", rn: 30 });
  const entryLength = instructions.length * 4;
  // Collector worker thunk: a raw pthread entry whose argument is a collector
  // record in permanent control memory. Word 0 of the record holds the
  // runtime closure (a permanent native function object) taking the record
  // address as its one number. The thunk builds a minimal hosted context on
  // the thread's own stack: a stack limit and nothing else (no root chain,
  // allocator or domain), so collector workers can run compiled runtime code
  // that neither allocates nor touches a mutator's managed objects. Returns
  // the closure's numeric result, or 70 after an abrupt completion.
  let collectorWorkerOffset: number | undefined;
  let collectorWorkers = false;
  for (const module of [allocator, runtime, program]) {
    if (module === undefined) throw "collector worker module invariant";
    for (const fixup of module.imports) {
      if (fixup === undefined) throw "collector worker import invariant";
      if (fixup.target.name === "tint:collector-worker-entry")
        collectorWorkers = true;
    }
  }
  if (collectorWorkers) {
    collectorWorkerOffset = instructions.length * 4;
    for (const first of [29, 19, 21, 23, 25, 27]) {
      if (first === undefined) throw "collector worker save invariant";
      emit({
        op: "stp",
        width: 64,
        rt: first,
        rt2: first + 1,
        rn: "sp",
        offset: -16,
        mode: "pre",
      });
    }
    move(19, 0);
    emit({
      op: "sub-imm",
      width: 64,
      rd: "sp",
      rn: "sp",
      immediate: 256,
      shift: 0,
      setFlags: false,
    });
    for (let offset = 0; offset < 256; offset += 8)
      emit({ op: "str", width: 64, rt: "zr", rn: "sp", offset });
    // Secondary threads get at least 512 KiB of stack; collector workers
    // need little of it, and the limit keeps a deep fault a clean throw.
    emit({
      op: "sub-imm",
      width: 64,
      rd: 9,
      rn: "sp",
      immediate: 64,
      shift: 12,
      setFlags: false,
    });
    store(9, 96 + nativeStackLimitOffset);
    emit({ op: "ldr", width: 64, rt: 9, rn: 19, offset: 0 });
    emit({
      op: "ldr",
      width: 64,
      rt: 1,
      rn: 9,
      offset: nativeFunctionEnvironmentOffset,
    });
    emit({
      op: "ldr",
      width: 64,
      rt: 16,
      rn: 9,
      offset: nativeFunctionEntryOffset,
    });
    stackAddress(0, 96);
    imm(2, 0);
    stackAddress(3, 64);
    emit({ op: "scvtf-d-x", rd: 0, rn: 19 });
    zeroFramePointer();
    emit({ op: "blr", rn: 16 });
    imm(9, 1);
    compare(0, 9);
    imm(0, 70);
    branch("collector-worker-done", "ne");
    emit({ op: "ldr-d", rt: 0, rn: "sp", offset: 80 });
    emit({ op: "fcvtzs-x-d", rd: 0, rn: 0 });
    label("collector-worker-done");
    emit({
      op: "add-imm",
      width: 64,
      rd: "sp",
      rn: "sp",
      immediate: 256,
      shift: 0,
      setFlags: false,
    });
    for (const first of [27, 25, 23, 21, 19, 29]) {
      if (first === undefined) throw "collector worker restore invariant";
      emit({
        op: "ldp",
        width: 64,
        rt: first,
        rt2: first + 1,
        rn: "sp",
        offset: 16,
        mode: "post",
      });
    }
    emit({ op: "ret", rn: 30 });
  }
  // ELF process entry (`_start`): the kernel's initial stack holds argc,
  // argv and the environment, and x0 the dynamic loader's finalizer.
  // glibc's __libc_start_main(main, argc, argv, init, fini, rtld_fini,
  // stack_end) initializes the C library, calls the hosted entry above as
  // `main` and exits with its status; it never returns.
  let processStartOffset: number | undefined,
    processStartUnwind: UnwindRange | undefined;
  const processStart = abi.processStart;
  if (processStart !== undefined) {
    const startOffset = instructions.length * 4;
    processStartOffset = startOffset;
    // The outermost frame: no caller frame record or return address.
    zeroFramePointer();
    emit({ op: "orr-reg", width: 64, rd: 30, rn: "zr", rm: "zr" });
    move(5, 0);
    load(1, 0);
    stackAddress(2, 8);
    stackAddress(6, 0);
    local(0, -1, 0);
    imm(3, 0);
    imm(4, 0);
    importCall(processStart.startMainSymbol);
    emit({ op: "brk", immediate: 1 });
    processStartUnwind = {
      offset: startOffset,
      byteLength: instructions.length * 4 - startOffset,
      rule: { kind: "outermost" },
    };
  }
  // Modules start on 4 KiB boundaries (the image places this code on one):
  // their local addresses use page-relative ADRP+ADD.
  const prefix = align(instructions.length * 4, 4096),
    runtimeBase = align(prefix + allocator.code.length, 4096),
    programBase = align(runtimeBase + runtime.code.length, 4096);
  const bases = [prefix, runtimeBase, programBase];
  let codeLength = programBase + programLength;
  // Diagnostics routines follow the program; the trace table, when present,
  // is appended after them by the image composition.
  const diagnosticsBase = align(codeLength, 16);
  let block: DiagnosticsBlock | undefined;
  if (diagnostics !== undefined) {
    const sites: SignpostSite[] = [];
    for (const site of diagnostics.signposts) {
      if (site === undefined) throw "signpost site invariant";
      const base = bases[site.module];
      if (base === undefined)
        return { ok: false, error: "invalid signpost module" };
      sites.push({
        offset: base + site.offset,
        name: site.name,
        stackBytes: site.stackBytes,
        classify: site.classify,
        metrics: site.metrics,
        majorRegister: site.majorRegister,
      });
    }
    const emitted = emitDiagnostics({
      base: diagnosticsBase,
      farAddresses: far,
      wideTrace: far,
      stackTraces: diagnostics.stackTraces,
      signposts: sites,
      allocationSignposts: diagnostics.allocationSignposts,
      jitDebug: diagnostics.jitDebug,
      heapIntrospection: diagnostics.heapIntrospection === true,
      symbolPrefix: abi.symbolPrefix,
      signpostABI: abi.signposts,
    });
    if (!emitted.ok) return { ok: false, error: emitted.error };
    block = emitted.value;
    codeLength = diagnosticsBase + block.code.length;
    patchImmediate(diagnosticsLengthInstruction, 11, block.code.length);
  }
  if (!Number.isSafeInteger(codeLength))
    return { ok: false, error: "host image exceeds address domain" };
  // Patch the fixed-width Number constant for the final concatenated code extent.
  patchImmediate(imageLengthInstruction, 9, codeLength);
  for (const fixup of branches) {
    if (fixup === undefined) throw "host branch invariant";
    const target = labels.get(fixup.label);
    if (target === undefined)
      return { ok: false, error: "missing host branch label" };
    const displacement = (target - fixup.offset) * 4;
    const condition = fixup.condition;
    if (condition === undefined)
      instructions[fixup.offset] = { op: "b", displacement };
    else instructions[fixup.offset] = { op: "b.cond", condition, displacement };
  }
  const startup = new Uint8Array(instructions.length * 4);
  for (let index = 0; index < instructions.length; index++) {
    const instruction = instructions[index];
    if (instruction === undefined) throw "host instruction invariant";
    const encoded = writeInstruction(startup, index * 4, instruction);
    if (!encoded.ok)
      return {
        ok: false,
        error: "host instruction encoding: " + encoded.error,
      };
  }
  const patches: ((output: CodeOutput, base: number) => string | undefined)[] =
    [];
  function relative(
    offset: number,
    rd: number,
    scratch: number,
    target: number,
    label: string,
  ): void {
    patches.push((output, base) => {
      if (offset < 0 || offset > codeLength - 16)
        return label + ": OUT_OF_BOUNDS";
      return output.patch(
        base + offset,
        Math.min(20, codeLength - offset),
        (bytes, at) => {
          const result = patchRelativeAddress(bytes, {
            offset: at,
            rd,
            scratch,
            targetOffset: target,
            siteAddress: offset,
          });
          return result.ok ? undefined : label + ": " + result.error;
        },
      );
    });
  }
  const modules = [allocator, runtime, program];
  for (let index = 0; index < modules.length; index++) {
    const module = modules[index],
      base = bases[index];
    if (module === undefined || base === undefined)
      throw "host module invariant";
    for (const fixup of module.imports) {
      if (fixup === undefined) throw "host import invariant";
      // Callbacks (docs/native-ffi.md, "Callbacks"): a thunk's entry is a
      // program code address; the slot table is writable image data.
      const name = fixup.target.name;
      if (name.startsWith("tint:callback-thunk:")) {
        const slot = Number(name.slice(20));
        let thunkOffset = -1;
        for (const thunk of module.callbackThunks?.thunks ?? []) {
          if (thunk === undefined) throw "callback thunk invariant";
          if (thunk.slot === slot) thunkOffset = thunk.offset;
        }
        if (thunkOffset < 0)
          return { ok: false, error: "unknown callback thunk " + name };
        relative(
          base + fixup.offset,
          fixup.rd,
          fixup.scratch,
          base + thunkOffset,
          "callback thunk relocation",
        );
        continue;
      }
      if (name === "tint:callback-key") {
        // A far-model module's site is the 20-byte far sequence.
        if (fixup.far === true)
          callbackKeyReferences.push({
            offset: base + fixup.offset,
            rd: fixup.rd,
            scratch: fixup.scratch,
            target: 0,
            far: true,
          });
        else
          callbackKeyReferences.push({
            offset: base + fixup.offset,
            rd: fixup.rd,
            scratch: fixup.scratch,
            target: 0,
          });
        continue;
      }
      if (fixup.target.name === "tint:collector-worker-entry") {
        if (collectorWorkerOffset === undefined)
          throw "collector worker thunk invariant";
        relative(
          base + fixup.offset,
          fixup.rd,
          fixup.scratch,
          collectorWorkerOffset,
          "collector worker relocation",
        );
        continue;
      }
      if (fixup.target.name === "tint:hosted-thread-entry") {
        if (workerEntryOffset === undefined)
          return {
            ok: false,
            error: "thread entry requires threaded hosted startup",
          };
        relative(
          base + fixup.offset,
          fixup.rd,
          fixup.scratch,
          workerEntryOffset,
          "thread entry relocation",
        );
        continue;
      }
      if (fixup.far === true)
        imports.push({
          offset: base + fixup.offset,
          rd: fixup.rd,
          scratch: fixup.scratch,
          target: fixup.target,
          far: true,
        });
      else
        imports.push({
          offset: base + fixup.offset,
          rd: fixup.rd,
          scratch: fixup.scratch,
          target: fixup.target,
        });
    }
    for (const call of module.startupCalls ?? []) {
      if (call === undefined) throw "startup call invariant";
      const entry = block?.entries.get(call.target);
      if (entry === undefined)
        return {
          ok: false,
          error: "module requires the " + call.target + " diagnostics routine",
        };
      const at = base + call.offset;
      const target = diagnosticsBase + entry;
      if (call.far === true) relative(at, 30, 9, target, "diagnostics call");
      else
        patches.push((output, base) => {
          if (at < 0 || at > codeLength - 4)
            return "diagnostics call: OUT_OF_BOUNDS";
          return output.patch(base + at, 4, (bytes, pos) => {
            const written = writeInstruction(bytes, pos, {
              op: "bl",
              displacement: target - at,
            });
            return written.ok
              ? undefined
              : "diagnostics call: " + written.error;
          });
        });
    }
  }
  let hostedDiagnostics: HostedDiagnostics | undefined;
  const composed = block;
  if (composed !== undefined && diagnostics !== undefined) {
    const block = composed;
    const tableOffset = codeLength;
    for (const fixup of block.codeReferences) {
      if (fixup === undefined) throw "diagnostic reference invariant";
      relative(
        diagnosticsBase + fixup.offset,
        fixup.rd,
        17,
        fixup.target,
        "diagnostic address",
      );
    }
    for (const fixup of block.tableReferences) {
      if (fixup === undefined) throw "diagnostic table invariant";
      relative(
        diagnosticsBase + fixup.offset,
        fixup.rd,
        17,
        tableOffset,
        "diagnostic table",
      );
    }
    for (const fixup of block.imports) {
      if (fixup === undefined) throw "diagnostic import invariant";
      imports.push({
        offset: diagnosticsBase + fixup.offset,
        rd: fixup.rd,
        scratch: 17,
        target: { kind: "import", name: fixup.name },
        far: farReference,
      });
    }
    for (const fixup of block.dataReferences) {
      if (fixup === undefined) throw "diagnostic data invariant";
      dataReferences.push({
        offset: diagnosticsBase + fixup.offset,
        rd: fixup.rd,
        scratch: 17,
        target: fixup.target,
        far: farReference,
      });
    }
    // Signposted entries branch to their thunk; the thunk's stub re-executes
    // the displaced frame push. Only the standard push can be displaced.
    const push = encode({
      op: "stp",
      width: 64,
      rt: 29,
      rt2: 30,
      rn: "sp",
      offset: -16,
      mode: "pre",
    });
    if (!push.ok) throw "frame push encoding invariant";
    for (let index = 0; index < diagnostics.signposts.length; index++) {
      const site = diagnostics.signposts[index],
        thunk = block.thunks[index];
      if (site === undefined || thunk === undefined)
        throw "signpost thunk invariant";
      const at = (bases[site.module] ?? 0) + site.offset;
      patches.push((output, base) => {
        if (at < 0 || at > codeLength - 4)
          return "signposted function lacks a frame push";
        return output.patch(base + at, 4, (bytes, pos) => {
          const first = readUnsigned(bytes, pos, 4, "little");
          if (!first.ok || first.value !== push.value)
            return "signposted function lacks a frame push";
          const written = writeInstruction(bytes, pos, {
            op: "b",
            displacement: diagnosticsBase + thunk - at,
          });
          return written.ok ? undefined : "signpost entry: " + written.error;
        });
      });
    }
    const heap = diagnostics.heapIntrospection === true,
      data = new Uint8Array(diagnosticDataLength(heap));
    // The JIT descriptor's version word.
    data[diagnosticJitDescriptorOffset] = 1;
    if (heap)
      data.set(heapDebugDescriptorBytes(), diagnosticHeapDescriptorOffset);
    const routines: { name: string; offset: number; byteLength: number }[] = [];
    const ordered = block.routines;
    for (let index = 0; index < ordered.length; index++) {
      const item = ordered[index],
        next = ordered[index + 1];
      if (item === undefined) throw "diagnostic routine invariant";
      routines.push({
        name: "tint:diagnostics:" + item.name,
        offset: diagnosticsBase + item.offset,
        byteLength:
          (next === undefined ? block.cstringOffset : next.offset) -
          item.offset,
      });
    }
    const codeSymbols: { name: string; offset: number }[] = [],
      dataSymbols: { name: string; offset: number }[] = [];
    const register = block.entries.get("jit-register");
    if (register !== undefined) {
      codeSymbols.push({
        name: abi.symbolPrefix + "__jit_debug_register_code",
        offset: diagnosticsBase + register,
      });
      dataSymbols.push({
        name: abi.symbolPrefix + "__jit_debug_descriptor",
        offset: diagnosticJitDescriptorOffset,
      });
    }
    const hook = block.entries.get("allocation-sample-hook");
    if (heap) {
      if (hook === undefined) throw "heap introspection routine invariant";
      const thunk = block.entries.get("allocation-sample");
      if (thunk === undefined) throw "heap introspection thunk invariant";
      codeSymbols.push({
        name: abi.symbolPrefix + heapDebugSampleSymbol,
        offset: diagnosticsBase + hook,
      });
      codeSymbols.push({
        name: abi.symbolPrefix + heapDebugSampleThunkSymbol,
        offset: diagnosticsBase + thunk,
      });
      dataSymbols.push({
        name: abi.symbolPrefix + heapDebugSymbol,
        offset: diagnosticHeapDescriptorOffset,
      });
    }
    const unwind: UnwindRange[] = [];
    for (const range of block.unwind) {
      if (range === undefined) throw "diagnostic unwind invariant";
      unwind.push({ ...range, offset: diagnosticsBase + range.offset });
    }
    unwind.sort((a, b) => a.offset - b.offset);
    const probes: DiagnosticProbe[] = [];
    for (const site of block.probes) {
      if (site === undefined) throw "diagnostic probe invariant";
      probes.push({ ...site, offset: diagnosticsBase + site.offset });
    }
    hostedDiagnostics = {
      data,
      dataReferences,
      tableOffset,
      wideTrace: far,
      cstring: {
        offset: diagnosticsBase + block.cstringOffset,
        byteLength: block.cstringLength,
      },
      routines,
      codeSymbols,
      dataSymbols,
      unwind,
      probes,
    };
  }
  for (const fixup of diagnosticReferences) {
    if (fixup === undefined) throw "diagnostic routine reference invariant";
    const entry = block?.entries.get(fixup.entry);
    if (entry === undefined) throw "diagnostic routine invariant";
    relative(
      fixup.offset,
      fixup.register,
      17,
      diagnosticsBase + entry,
      "diagnostic routine",
    );
  }
  for (const fixup of references) {
    if (fixup === undefined) throw "host reference invariant";
    const base =
      fixup.module < 0
        ? 0
        : fixup.module === 3
          ? diagnosticsBase
          : bases[fixup.module];
    if (base === undefined) throw "host reference module invariant";
    relative(
      fixup.offset,
      fixup.register,
      17,
      base + fixup.target,
      "host relative address",
    );
  }
  const codePlan: CodePlan = {
    byteLength: codeLength,
    write: (output, base) => {
      output.write(startup, base);
      output.write(allocator.code, base + prefix);
      output.write(runtime.code, base + runtimeBase);
      if (programCode === undefined)
        output.write(program.code, base + programBase);
      else {
        const error = programCode.write(output, base + programBase);
        if (error !== undefined) return error;
      }
      if (composed !== undefined)
        output.write(composed.code, base + diagnosticsBase);
      for (const patch of patches) {
        if (patch === undefined) throw "host patch invariant";
        const error = patch(output, base);
        if (error !== undefined) return error;
      }
      return undefined;
    },
  };
  return {
    ok: true,
    value: {
      codePlan,
      entryOffset: 0,
      processStartOffset,
      workerEntryOffset,
      imports,
      moduleOffsets: bases,
      entryUnwind: {
        offset: 0,
        byteLength: entryLength,
        rule: { kind: "rows", rows: entryRows },
      },
      processStartUnwind,
      diagnostics: hostedDiagnostics,
      callbackData:
        callbackKeyReferences.length === 0 &&
        program.callbackThunks === undefined
          ? undefined
          : { byteLength: 16, references: callbackKeyReferences },
    },
  };
}
