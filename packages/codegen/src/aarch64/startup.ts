import {
  nativeFunctionEntryOffset,
  nativeFunctionEnvironmentOffset,
} from "@tint/abi/function";
import {
  nativeContextDomainOffset,
  nativeEngineThrowOffset,
  nativeStackHeadroomBytes,
  nativeStackLimitOffset,
  type PosixHostABI,
} from "@tint/abi/host";
import { readUnsigned } from "@tint/foundation/binary/bytes";
import {
  encode,
  writeInstruction,
  relativeAddress,
  patchRelativeAddress,
  type Instruction,
  type Condition,
} from "./isa.ts";
import {
  nativeContextBytes,
  type NativeModule,
  type NativeImportReference,
} from "./scalar/index.ts";
import type { UnwindRange, UnwindRow, UnwindSave } from "@tint/abi/unwind";
import { dwarfStackPointer } from "./unwind.ts";
import {
  emitDiagnostics,
  type DiagnosticsBlock,
  type SignpostClassification,
  diagnosticAllocationEntryOffset,
  diagnosticDataBytes,
  diagnosticJitDescriptorOffset,
  type SignpostSite,
} from "./diagnostics.ts";
/** A SignpostSite whose offset is relative to its module. */
export interface HostSignpostSite {
  readonly module: number;
  readonly offset: number;
  readonly name: number;
  readonly stackBytes: number;
  readonly classify?: SignpostClassification | undefined;
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
}
export interface HostedDiagnostics {
  /** Initial `__DATA` contents of the diagnostic state. */
  readonly data: Uint8Array;
  readonly dataReferences: readonly {
    readonly offset: number;
    readonly rd: number;
    readonly scratch: number;
    readonly target: number;
  }[];
  /** Code offset at which the trace table must be appended (the code's end). */
  readonly tableOffset: number;
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
}
export interface HostRequest {
  /** Opt in to a raw pthread entry and a one-number application entry. */
  readonly threaded?: boolean;
  readonly allocator: {
    readonly native: NativeModule;
    readonly initialize: number;
    readonly allocate: number;
    readonly environmentBytes: number;
  };
  readonly runtime: { readonly native: NativeModule; readonly entry: number };
  readonly program: { readonly native: NativeModule; readonly entry: number };
  readonly managedBytes: number;
  readonly controlBytes: number;
  readonly allocationCapacity: number;
  readonly rootCapacity: number;
  readonly stackBytes: number;
  readonly pageSize: number;
  readonly abi: PosixHostABI;
  readonly diagnostics?: HostDiagnostics | undefined;
}
export interface HostedCode {
  /** Placement of allocator, runtime, and program code, in that order. */
  readonly moduleOffsets: readonly number[];
  readonly code: Uint8Array;
  readonly entryOffset: number;
  readonly workerEntryOffset: number | undefined;
  readonly imports: readonly NativeImportReference[];
  /** Call-frame rows of the entry code (process and worker entry). */
  readonly entryUnwind: UnwindRange;
  readonly diagnostics?: HostedDiagnostics | undefined;
}
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
      ? main.signature.parameters.length !== 1 ||
        main.signature.parameters[0]?.kind !== "float" ||
        main.signature.parameters[0]?.index !== 0
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
    }[] = [];
  const diagnostics = request.diagnostics;
  const labels = new Map<string, number>(),
    branches: {
      offset: number;
      label: string;
      condition: Condition | undefined;
    }[] = [];
  const allocatorEnvironmentOffset = 96 + nativeContextBytes;
  const frameBytes = Math.max(
    512,
    align(allocatorEnvironmentOffset + request.allocator.environmentBytes, 16),
  );
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
    const value = relativeAddress(register, 17, 0);
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
    });
    pointer(register);
  }
  function foreign(name: string): void {
    imports.push({
      offset: instructions.length * 4,
      rd: 16,
      scratch: 17,
      target: { kind: "import", name: abi.symbolPrefix + name },
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
  function number(register: number, value: number): void {
    imm(9, value);
    emit({ op: "scvtf-d-x", rd: register, rn: 9 });
  }
  let workerEntryOffset: number | undefined;
  if (request.threaded === true) {
    // Root process forwards zero; worker forwards only its raw scalar argument.
    imm(2, 0);
    branch("host-start");
    workerEntryOffset = instructions.length * 4;
    move(2, 0);
    imm(0, 0);
    imm(1, 0);
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
  if (
    diagnostics !== undefined &&
    (diagnostics.signposts.length > 0 || diagnostics.allocationSignposts)
  ) {
    diagnostic(16, "signpost-init");
    emit({ op: "blr", rn: 16 });
  }
  imm(20, 0);
  imm(21, 0);
  imm(22, 0);
  imm(25, 71);
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
  // One never-recycled identity page per hosted context. This tiny tombstone
  // deliberately outlives cleanup of its heap/control mappings, preventing ABA
  // aliasing when another context is initialized at reused virtual addresses.
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
  address(9, 22, page + stackHeadroom);
  store(9, 96 + nativeStackLimitOffset);
  imm(9, 0);
  store(9, 96 + nativeEngineThrowOffset);
  // Mapped storage is initially zero; borrowed array headers are permanent control state.
  for (const item of arrays) {
    if (item === undefined) throw "host array invariant";
    address(10, 20, item.header);
    imm(11, item.kind);
    emit({ op: "str", width: 64, rt: 11, rn: 10, offset: 0 });
    imm(11, 1);
    emit({ op: "str", width: 64, rt: 11, rn: 10, offset: 8 });
    imm(11, item.length);
    emit({ op: "str", width: 64, rt: 11, rn: 10, offset: 16 });
    address(11, 20, item.data);
    emit({ op: "str", width: 64, rt: 11, rn: 10, offset: 24 });
  }
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
  number(1, request.managedBytes);
  emit({ op: "scvtf-d-x", rd: 2, rn: 20 });
  number(3, controlLength);
  local(26, -1, 0);
  emit({ op: "scvtf-d-x", rd: 4, rn: 26 });
  const imageLengthInstruction = instructions.length;
  number(5, 0);
  address(9, 22, page);
  emit({ op: "scvtf-d-x", rd: 6, rn: 9 });
  number(7, request.stackBytes);
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
  emit({ op: "ldr", width: 64, rt: 9, rn: 10, offset: 16 });
  if (diagnostics?.allocationSignposts === true) {
    // The slow path runs through the signpost routine, which forwards to it.
    dataAddress(11, diagnosticAllocationEntryOffset);
    emit({ op: "str", width: 64, rt: 9, rn: 11, offset: 0 });
    diagnostic(9, "allocation-signpost");
  }
  store(9, 112);
  emit({ op: "ldr", width: 64, rt: 9, rn: 10, offset: 24 });
  store(9, 120);
  store(21, 104);
  imm(9, request.managedBytes);
  store(9, 128);
  if (request.threaded === true) emit({ op: "scvtf-d-x", rd: 0, rn: 27 });
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
  emit({
    op: "add-imm",
    width: 64,
    rd: "sp",
    rn: 19,
    immediate: 0,
    shift: 0,
    setFlags: false,
  });
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
  // Modules start on 4 KiB boundaries (the image places this code on one):
  // their local addresses use page-relative ADRP+ADD.
  const prefix = align(instructions.length * 4, 4096),
    runtimeBase = align(prefix + allocator.code.length, 4096),
    programBase = align(runtimeBase + runtime.code.length, 4096);
  const bases = [prefix, runtimeBase, programBase];
  let codeLength = programBase + program.code.length;
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
      });
    }
    const facility = abi.signposts;
    const signpostABI =
      facility === undefined
        ? undefined
        : {
            imageHeaderSymbol: facility.imageHeaderSymbol,
            logCreateSymbol: facility.logCreateSymbol,
            enabledSymbol: facility.enabledSymbol,
            emitSymbol: facility.emitSymbol,
          };
    const emitted = emitDiagnostics({
      base: diagnosticsBase,
      stackTraces: diagnostics.stackTraces,
      signposts: sites,
      allocationSignposts: diagnostics.allocationSignposts,
      jitDebug: diagnostics.jitDebug,
      symbolPrefix: abi.symbolPrefix,
      signpostABI,
    });
    if (!emitted.ok) return { ok: false, error: emitted.error };
    block = emitted.value;
    codeLength = diagnosticsBase + block.code.length;
  }
  if (!uint(codeLength))
    return { ok: false, error: "host image exceeds address domain" };
  // Patch the fixed-width Number constant for the final concatenated code extent.
  for (let index = 0; index < 4; index++) {
    const immediate =
      index === 0
        ? codeLength % 65536
        : index === 1
          ? Math.floor(codeLength / 65536)
          : 0;
    if (index === 0)
      instructions[imageLengthInstruction] = {
        op: "movz",
        width: 64,
        rd: 9,
        immediate,
        shift: 0,
      };
    else if (index === 1)
      instructions[imageLengthInstruction + index] = {
        op: "movk",
        width: 64,
        rd: 9,
        immediate,
        shift: 16,
      };
    else if (index === 2)
      instructions[imageLengthInstruction + index] = {
        op: "movk",
        width: 64,
        rd: 9,
        immediate,
        shift: 32,
      };
    else
      instructions[imageLengthInstruction + index] = {
        op: "movk",
        width: 64,
        rd: 9,
        immediate,
        shift: 48,
      };
  }
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
  const code = new Uint8Array(codeLength);
  for (let index = 0; index < instructions.length; index++) {
    const instruction = instructions[index];
    if (instruction === undefined) throw "host instruction invariant";
    const encoded = writeInstruction(code, index * 4, instruction);
    if (!encoded.ok)
      return {
        ok: false,
        error: "host instruction encoding: " + encoded.error,
      };
  }
  const modules = [allocator, runtime, program];
  for (let index = 0; index < modules.length; index++) {
    const module = modules[index],
      base = bases[index];
    if (module === undefined || base === undefined)
      throw "host module invariant";
    code.set(module.code, base);
    for (const fixup of module.imports) {
      if (fixup === undefined) throw "host import invariant";
      if (fixup.target.name === "tint:collector-worker-entry") {
        if (collectorWorkerOffset === undefined)
          throw "collector worker thunk invariant";
        const patched = patchRelativeAddress(code, {
          offset: base + fixup.offset,
          rd: fixup.rd,
          scratch: fixup.scratch,
          targetOffset: collectorWorkerOffset,
        });
        if (!patched.ok)
          return {
            ok: false,
            error: "collector worker relocation: " + patched.error,
          };
        continue;
      }
      if (fixup.target.name === "tint:hosted-thread-entry") {
        if (workerEntryOffset === undefined)
          return {
            ok: false,
            error: "thread entry requires threaded hosted startup",
          };
        const patched = patchRelativeAddress(code, {
          offset: base + fixup.offset,
          rd: fixup.rd,
          scratch: fixup.scratch,
          targetOffset: workerEntryOffset,
        });
        if (!patched.ok)
          return {
            ok: false,
            error: "thread entry relocation: " + patched.error,
          };
        continue;
      }
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
      const written = writeInstruction(code, base + call.offset, {
        op: "bl",
        displacement: diagnosticsBase + entry - (base + call.offset),
      });
      if (!written.ok)
        return { ok: false, error: "diagnostics call: " + written.error };
    }
  }
  let hostedDiagnostics: HostedDiagnostics | undefined;
  const composed = block;
  if (composed !== undefined && diagnostics !== undefined) {
    const block = composed;
    code.set(block.code, diagnosticsBase);
    const tableOffset = codeLength;
    for (const fixup of block.codeReferences) {
      if (fixup === undefined) throw "diagnostic reference invariant";
      const patched = patchRelativeAddress(code, {
        offset: diagnosticsBase + fixup.offset,
        rd: fixup.rd,
        scratch: 17,
        targetOffset: fixup.target,
      });
      if (!patched.ok)
        return { ok: false, error: "diagnostic address: " + patched.error };
    }
    for (const fixup of block.tableReferences) {
      if (fixup === undefined) throw "diagnostic table invariant";
      const patched = patchRelativeAddress(code, {
        offset: diagnosticsBase + fixup.offset,
        rd: fixup.rd,
        scratch: 17,
        targetOffset: tableOffset,
      });
      if (!patched.ok)
        return { ok: false, error: "diagnostic table: " + patched.error };
    }
    for (const fixup of block.imports) {
      if (fixup === undefined) throw "diagnostic import invariant";
      imports.push({
        offset: diagnosticsBase + fixup.offset,
        rd: fixup.rd,
        scratch: 17,
        target: { kind: "import", name: fixup.name },
      });
    }
    for (const fixup of block.dataReferences) {
      if (fixup === undefined) throw "diagnostic data invariant";
      dataReferences.push({
        offset: diagnosticsBase + fixup.offset,
        rd: fixup.rd,
        scratch: 17,
        target: fixup.target,
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
      const first = readUnsigned(code, at, 4, "little");
      if (!first.ok || first.value !== push.value)
        return { ok: false, error: "signposted function lacks a frame push" };
      const written = writeInstruction(code, at, {
        op: "b",
        displacement: diagnosticsBase + thunk - at,
      });
      if (!written.ok)
        return { ok: false, error: "signpost entry: " + written.error };
    }
    const data = new Uint8Array(diagnosticDataBytes);
    // The JIT descriptor's version word.
    data[diagnosticJitDescriptorOffset] = 1;
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
    const unwind: UnwindRange[] = [];
    for (const range of block.unwind) {
      if (range === undefined) throw "diagnostic unwind invariant";
      unwind.push({ ...range, offset: diagnosticsBase + range.offset });
    }
    unwind.sort((a, b) => a.offset - b.offset);
    hostedDiagnostics = {
      data,
      dataReferences,
      tableOffset,
      cstring: {
        offset: diagnosticsBase + block.cstringOffset,
        byteLength: block.cstringLength,
      },
      routines,
      codeSymbols,
      dataSymbols,
      unwind,
    };
  }
  for (const fixup of diagnosticReferences) {
    if (fixup === undefined) throw "diagnostic routine reference invariant";
    const entry = block?.entries.get(fixup.entry);
    if (entry === undefined) throw "diagnostic routine invariant";
    const patched = patchRelativeAddress(code, {
      offset: fixup.offset,
      rd: fixup.register,
      scratch: 17,
      targetOffset: diagnosticsBase + entry,
    });
    if (!patched.ok)
      return { ok: false, error: "diagnostic routine: " + patched.error };
  }
  for (const fixup of references) {
    if (fixup === undefined) throw "host reference invariant";
    const base = fixup.module < 0 ? 0 : bases[fixup.module];
    if (base === undefined) throw "host reference module invariant";
    const patched = patchRelativeAddress(code, {
      offset: fixup.offset,
      rd: fixup.register,
      scratch: 17,
      targetOffset: base + fixup.target,
    });
    if (!patched.ok)
      return { ok: false, error: "host relative address: " + patched.error };
  }
  return {
    ok: true,
    value: {
      code,
      entryOffset: 0,
      workerEntryOffset,
      imports,
      moduleOffsets: bases,
      entryUnwind: {
        offset: 0,
        byteLength: entryLength,
        rule: { kind: "rows", rows: entryRows },
      },
      diagnostics: hostedDiagnostics,
    },
  };
}
