import {
  nativeFunctionEntryOffset,
  nativeFunctionEnvironmentOffset,
} from "@tint/abi/function";
import {
  nativeAllocatorShutdownRequest,
  nativeArrayDataOffset,
  nativeArrayLengthOffset,
  nativeContextDomainOffset,
  nativeHeaderFlagUnit,
  nativeStackLimitOffset,
  nativeStackMapRegistryEntryBytes,
  nativeStackMapRegistryHeaderBytes,
  nativeStackMapRegistryOffset,
  nativeStackMapTransitionTable,
  nativeThreadExitReadOffset,
  nativeWorkerStopPointerOffset,
  nativeWorkerStopStateOffset,
  nativeThreadExitWriteOffset,
  type PosixHostFacts,
} from "@tint/abi/host";
import type {
  CodeOutput,
  CodePlan,
  ImageAddressPatcher,
  ImageAddressReference,
  ImageAddressTarget,
} from "@tint/abi/relocation";
import {
  encodeLayout,
  patchRelative,
  type Gpr,
  type Instruction,
  type RelativeFixup,
} from "./isa.ts";
import type { X64Module } from "./scalar/index.ts";
import type { X64Probe } from "./probes.ts";
import type { UnwindRange } from "@tint/abi/unwind";
import {
  dwarfStackPointer,
  frameRows,
  frameSave,
  returnSave,
  resolveUnwind,
} from "./unwind.ts";
import {
  allocationStateOffset,
  allocatorEntryOffset,
  allocatorEnvironmentOffset,
  argumentCountOffset,
  argumentsOffset,
  contextBytes,
  heapCursorOffset,
  heapEndOffset,
  hostedThreadEntryLabel,
  bits,
  gpr,
  imageRelocations,
  imm,
  label,
  managedBaseOffset,
  managedLengthOffset,
  mem,
  normal,
  resultBytes,
  resultPayload,
  rip,
  word,
  xmm,
  type ImageRelocations,
} from "./scalar/machine.ts";

interface HostedEntry {
  readonly native: X64Module;
  readonly host: PosixHostFacts;
  readonly invocation: number;
  readonly runtime?: {
    readonly native: X64Module;
    readonly entry: number;
    readonly controlBytes: number;
    readonly allocationCapacity: number;
    readonly rootCapacity: number;
  };
  readonly returnType: "number" | "boolean" | "void" | "general";
  readonly stackBytes: number;
  readonly threaded?: boolean;
  readonly threadExitPipe?: boolean;
  readonly workerSafepoints?: boolean;
  readonly allowJit?: boolean;
  readonly managedBytes: number;
  readonly pageBytes: number;
  /** Unoccupied placement between the program and the hosted runtime. */
  readonly programPaddingBytes?: number;
  readonly programCodePlan?: CodePlan;
}

interface ImageSymbol {
  readonly name: string;
  readonly offset: number;
}

interface HostedImage extends ImageRelocations {
  readonly codePlan: CodePlan;
  readonly data: Uint8Array;
  readonly entryOffset: number;
  readonly maxByteLength: number;
  readonly imports: readonly string[];
  readonly symbols: readonly ImageSymbol[];
  readonly dataSymbols: readonly ImageSymbol[];
  readonly runtimeOffset: number;
  readonly unwind: readonly UnwindRange[];
  readonly probes: readonly X64Probe[];
}

/** A hosted stack, collector control storage and managed region live in
 * one guarded mapping. The optional collector initializer runs on a
 * permanent control bump arena before managed allocation is published. */
export function appendHostedEntry(request: HostedEntry): HostedImage {
  const native = request.native,
    host = request.host,
    stackBytes = request.stackBytes,
    managedBytes = request.managedBytes,
    pageBytes = request.pageBytes;
  const threaded = request.threaded === true;
  const live = request.allowJit === true;
  const processStart = host.processStart;
  if (processStart === undefined) throw "glibc startup policy required";
  const stackEnd = pageBytes + stackBytes;
  const app = native;
  const runtime = request.runtime;
  const runtimeCode = runtime?.native;
  const far = native.far || runtimeCode?.far === true;
  const appPlan = request.programCodePlan;
  const appLength = appPlan?.byteLength ?? app.code.length;
  const appEnd = appLength + (request.programPaddingBytes ?? 0);
  if (!Number.isSafeInteger(appEnd) || appEnd < appLength)
    throw "invalid program padding";
  const codeOffset =
    runtimeCode === undefined ? appEnd : Math.ceil(appEnd / 8) * 8;
  const dataOffset =
    runtimeCode === undefined
      ? app.data.length
      : Math.ceil(app.data.length / 8) * 8;
  const imageLength = codeOffset + (runtimeCode?.code.length ?? 0);
  const stackMaps = app.stackMaps.slice();
  if (runtimeCode !== undefined)
    for (const table of runtimeCode.stackMaps) {
      if (table === undefined) throw "runtime stack map invariant";
      stackMaps.push({
        codeOffset: codeOffset + table.codeOffset,
        codeLength: table.codeLength,
        tableOffset:
          table.tableOffset < 0
            ? table.tableOffset
            : codeOffset + table.tableOffset,
      });
    }
  const registryStart =
    stackEnd + pageBytes + (request.workerSafepoints ? 16 : 0);
  const registryCapacity = stackMaps.length + (live ? 16384 : 0);
  const registryBytes =
    nativeStackMapRegistryHeaderBytes +
    registryCapacity * nativeStackMapRegistryEntryBytes;
  const afterRegistry = registryStart + registryBytes;
  const heapAlignment = runtime === undefined ? 16 : pageBytes;
  const heapStart = Math.ceil(afterRegistry / heapAlignment) * heapAlignment;
  const controlStart = Math.ceil((heapStart + managedBytes) / 16) * 16;
  const arrays: {
    kind: number;
    length: number;
    width: number;
    data: number;
  }[] = [];
  let controlCursor = controlStart;
  let controlEnd = heapStart + managedBytes;
  if (runtime !== undefined) {
    if (
      !Number.isSafeInteger(runtime.controlBytes) ||
      runtime.controlBytes < 16 ||
      !Number.isSafeInteger(runtime.rootCapacity) ||
      runtime.rootCapacity < 1
    )
      throw "invalid collector control or root capacity";
    const capacity = runtime.allocationCapacity;
    arrays.push(
      { kind: 4, length: capacity * 3 + 96, width: 4, data: 0 },
      { kind: 4, length: capacity, width: 4, data: 0 },
      { kind: 4, length: capacity, width: 4, data: 0 },
      {
        kind: 5,
        length: capacity + Math.ceil(managedBytes / 4096) + 1,
        width: 8,
        data: 0,
      },
      { kind: 2, length: capacity, width: 1, data: 0 },
      { kind: 4, length: capacity, width: 4, data: 0 },
      { kind: 5, length: runtime.rootCapacity, width: 8, data: 0 },
    );
    controlCursor += arrays.length * 24;
    for (const array of arrays) {
      if (array === undefined) throw "collector workspace invariant";
      array.data = Math.ceil(controlCursor / 16) * 16;
      controlCursor = array.data + array.length * array.width;
    }
    controlCursor = Math.ceil(controlCursor / 16) * 16;
    controlEnd = controlCursor + runtime.controlBytes;
  }
  const mappingBytes = controlEnd;
  if (!Number.isSafeInteger(mappingBytes) || mappingBytes >= 281474976710656)
    throw "invalid hosted mapping size";
  const rsp = gpr(4),
    rbp = gpr(5),
    rax = gpr(0);
  const rdi = gpr(7),
    rsi = gpr(6),
    rdx = gpr(2);
  const edi = word(7),
    esi = word(6),
    edx = word(2),
    eax = word(0);
  const r12 = gpr(12),
    r13 = gpr(13);
  const machine: Instruction[] = [];
  const imports = new Map<string, ImageAddressTarget>();
  const importNames = native.imports.slice();
  if (runtimeCode !== undefined)
    for (const symbol of runtimeCode.imports)
      if (symbol !== undefined && !importNames.includes(symbol))
        importNames.push(symbol);
  const emit = (insn: Instruction): void => {
    machine.push(insn);
  };
  function constantAddress(dst: Gpr<64>, value: number): void {
    if (value <= 0x7fffffff) emit({ op: "mov", dst, src: imm(value) });
    else
      emit({
        op: "mov",
        dst,
        src: bits(value >>> 0, Math.floor(value / 0x100000000)),
      });
  }
  function mappedAddress(dst: Gpr<64>, offset: number): void {
    if (offset <= 0x7fffffff) {
      emit({ op: "lea", dst, src: mem(13, offset) });
      return;
    }
    constantAddress(dst, offset);
    emit({
      op: "lea",
      dst,
      src: {
        kind: "mem",
        width: 64,
        address: { kind: "base", base: 13, index: dst.index, disp: 0 },
      },
    });
  }
  function mappingLength(): void {
    if (mappingBytes <= 0x7fffffff)
      emit({ op: "mov", dst: esi, src: imm(mappingBytes) });
    else constantAddress(rsi, mappingBytes);
  }
  function call(symbol: string): void {
    imports.set(symbol, { kind: "import", name: symbol });
    if (!importNames.includes(symbol)) importNames.push(symbol);
    emit({ op: "call", target: rip(symbol) });
  }

  emit({ op: "label", name: "_start" });
  // The loader's destructor arrives in RDX. argc/argv are on the kernel
  // stack. SysV stack_end is the seventh argument, above the return PC.
  emit({ op: "xor", dst: word(5), src: word(5) });
  emit({ op: "mov", dst: gpr(9), src: rdx });
  emit({ op: "pop", dst: rsi });
  emit({ op: "mov", dst: rdx, src: rsp });
  emit({ op: "and", dst: rsp, src: imm(-16) });
  emit({ op: "push", src: imm(0) });
  emit({ op: "push", src: rsp });
  emit({ op: "xor", dst: word(1), src: word(1) });
  emit({ op: "xor", dst: word(8), src: word(8) });
  emit({ op: "lea", dst: rdi, src: rip("main") });
  call(processStart.startMainSymbol);
  emit({ op: "ud2" });

  emit({ op: "label", name: "main" });
  const cfi = frameRows(emit, "main");
  const savedFrame = [returnSave, frameSave];
  const save12 = { register: 12, offset: -24 };
  const save13 = { register: 13, offset: -32 };
  const saved12 = [returnSave, frameSave, save12];
  const saved = [returnSave, frameSave, save12, save13];
  const saveOffset = contextBytes + (threaded ? 32 : 16);
  const contextFrameBytes = saveOffset + (far ? 16 : 0);
  const threadArgumentOffset = contextBytes + 16;
  const threadModeOffset = threadArgumentOffset + 8;
  if (threaded) {
    const hostedRun = "hosted-run";
    emit({ op: "xor", dst: edx, src: edx });
    emit({ op: "xor", dst: word(1), src: word(1) });
    emit({
      op: "jmp",
      target: { kind: "label", label: hostedRun, near: true },
    });
    emit({ op: "label", name: hostedThreadEntryLabel });
    emit({ op: "mov", dst: rdx, src: rdi });
    emit({ op: "xor", dst: edi, src: edi });
    emit({ op: "xor", dst: esi, src: esi });
    emit({ op: "mov", dst: word(1), src: imm(1) });
    emit({ op: "label", name: hostedRun });
  }
  emit({ op: "push", src: rbp });
  cfi.record(dwarfStackPointer, 16, savedFrame);
  emit({ op: "mov", dst: rbp, src: rsp });
  emit({ op: "push", src: r12 });
  cfi.record(dwarfStackPointer, 24, saved12);
  emit({ op: "push", src: r13 });
  cfi.record(dwarfStackPointer, 32, saved);
  emit({ op: "sub", dst: rsp, src: imm(contextFrameBytes) });
  cfi.record(dwarfStackPointer, contextFrameBytes + 32, saved);
  emit({ op: "mov", dst: r12, src: rsp });
  cfi.record(12, contextFrameBytes + 32, saved);
  if (far) {
    emit({ op: "mov", dst: mem(12, saveOffset), src: gpr(14) });
    emit({ op: "mov", dst: mem(12, saveOffset + 8), src: gpr(15) });
    const farSaved = saved.slice();
    farSaved.push({ register: 14, offset: -48 }, { register: 15, offset: -40 });
    cfi.record(12, contextFrameBytes + 32, farSaved);
  }
  emit({ op: "mov", dst: mem(12, contextBytes + 8), src: rbp });
  for (let offset = 0; offset < contextBytes; offset += 8)
    emit({ op: "mov", dst: mem(12, offset), src: imm(0) });
  emit({
    op: "mov",
    dst: { ...mem(12, argumentCountOffset), width: 32 },
    src: edi,
  });
  emit({ op: "mov", dst: mem(12, argumentsOffset), src: rsi });
  if (threaded) {
    emit({ op: "mov", dst: mem(12, threadArgumentOffset), src: rdx });
    emit({ op: "mov", dst: mem(12, threadModeOffset), src: gpr(1) });
  }
  emit({ op: "xor", dst: edi, src: edi });
  mappingLength();
  emit({ op: "mov", dst: edx, src: imm(3) }); // PROT_READ | PROT_WRITE
  emit({ op: "mov", dst: word(1), src: imm(host.anonymousPrivateFlags) });
  emit({ op: "mov", dst: word(8), src: imm(-1) });
  emit({ op: "xor", dst: word(9), src: word(9) });
  call(host.symbolPrefix + "mmap");
  emit({ op: "cmp", dst: rax, src: imm(-1) });
  emit({ op: "jcc", cc: "e", target: label("mapping-failed") });
  emit({ op: "mov", dst: r13, src: rax });
  // Keep every byte that could become a managed address below bit 48,
  // including on kernels with five-level paging.
  emit({ op: "mov", dst: gpr(11), src: bits(0, 0x10000) });
  mappedAddress(rax, mappingBytes - 1);
  emit({ op: "cmp", dst: rax, src: gpr(11) });
  emit({ op: "jcc", cc: "ae", target: label("guard-failed") });

  for (const offset of [0, stackEnd]) {
    emit({ op: "lea", dst: rdi, src: mem(13, offset) });
    emit({ op: "mov", dst: esi, src: imm(pageBytes) });
    emit({ op: "xor", dst: edx, src: edx }); // PROT_NONE
    call(host.symbolPrefix + "mprotect");
    emit({ op: "test", dst: eax, src: eax });
    emit({ op: "jcc", cc: "ne", target: label("guard-failed") });
  }
  emit({ op: "lea", dst: rax, src: mem(13, pageBytes) });
  emit({ op: "mov", dst: mem(12, nativeStackLimitOffset), src: rax });
  if (threaded || live) {
    // The inaccessible identity page outlives this heap and prevents address
    // reuse from aliasing context-owned values after a join.
    emit({ op: "xor", dst: edi, src: edi });
    emit({ op: "mov", dst: esi, src: imm(pageBytes) });
    emit({ op: "xor", dst: edx, src: edx });
    emit({ op: "mov", dst: word(1), src: imm(host.anonymousPrivateFlags) });
    emit({ op: "mov", dst: word(8), src: imm(-1) });
    emit({ op: "xor", dst: word(9), src: word(9) });
    call(host.symbolPrefix + "mmap");
    emit({ op: "mov", dst: gpr(11), src: bits(0xffffffff, 0x1fffff) });
    emit({ op: "cmp", dst: rax, src: gpr(11) });
    emit({ op: "jcc", cc: "a", target: label("guard-failed") });
    emit({ op: "mov", dst: mem(12, nativeContextDomainOffset), src: rax });
  }

  const local = new Map<string, number>();
  local.set("invoke", request.invocation);
  const callbackKeyOffset = native.callbackKeyOffset;
  if (callbackKeyOffset !== undefined) {
    const key = "callback-key-storage";
    const keyReady = "callback-key-ready";
    if (threaded) {
      emit({ op: "cmp", dst: mem(12, threadModeOffset), src: imm(0) });
      emit({ op: "jcc", cc: "ne", target: label(keyReady) });
    }
    imports.set(key, { kind: "data", offset: callbackKeyOffset });
    emit({ op: "lea", dst: rdi, src: rip(key) });
    emit({ op: "xor", dst: esi, src: esi });
    call(host.symbolPrefix + "pthread_key_create");
    emit({ op: "test", dst: eax, src: eax });
    emit({ op: "jcc", cc: "ne", target: label("guard-failed") });
    if (threaded) emit({ op: "label", name: keyReady });
  }
  emit({ op: "lea", dst: rax, src: mem(13, registryStart) });
  if (request.workerSafepoints === true) {
    emit({ op: "mov", dst: gpr(10), src: mem(12, threadArgumentOffset) });
    emit({ op: "test", dst: gpr(10), src: imm(1) });
    emit({ op: "jcc", cc: "e", target: label("worker-stop-pointer-ready") });
    emit({
      op: "lea",
      dst: gpr(10),
      src: mem(10, nativeWorkerStopStateOffset - 1),
    });
    emit({
      op: "mov",
      dst: mem(0, nativeWorkerStopPointerOffset),
      src: gpr(10),
    });
    emit({ op: "label", name: "worker-stop-pointer-ready" });
  }
  emit({ op: "mov", dst: mem(12, nativeStackMapRegistryOffset), src: rax });
  emit({ op: "mov", dst: mem(0, 0), src: imm(stackMaps.length) });
  emit({ op: "mov", dst: mem(0, 8), src: imm(registryCapacity) });
  for (let index = 0; index < stackMaps.length; index++) {
    const table = stackMaps[index];
    if (table === undefined) throw "stack map registry entry invariant";
    const codeName = "stack-maps-code:" + String(index);
    const tableName = "stack-maps-table:" + String(index);
    local.set(codeName, table.codeOffset);
    if (table.tableOffset >= 0) local.set(tableName, table.tableOffset);
    const entry =
      nativeStackMapRegistryHeaderBytes +
      index * nativeStackMapRegistryEntryBytes;
    emit({ op: "lea", dst: gpr(11), src: rip(codeName) });
    emit({ op: "mov", dst: mem(0, entry), src: gpr(11) });
    emit({ op: "mov", dst: mem(0, entry + 8), src: imm(table.codeLength) });
    if (table.tableOffset < 0)
      emit({
        op: "mov",
        dst: gpr(11),
        src: imm(nativeStackMapTransitionTable),
      });
    else emit({ op: "lea", dst: gpr(11), src: rip(tableName) });
    emit({ op: "mov", dst: mem(0, entry + 16), src: gpr(11) });
  }

  mappedAddress(rax, runtime === undefined ? heapStart : controlCursor);
  emit({ op: "mov", dst: mem(12, heapCursorOffset), src: rax });
  mappedAddress(rax, mappingBytes);
  emit({ op: "mov", dst: mem(12, heapEndOffset), src: rax });
  // A zero frame link on the managed stack terminates the walk. Keep the
  // system frame separately because it is outside the managed stack region.
  emit({ op: "lea", dst: rbp, src: mem(13, stackEnd - 16) });
  emit({ op: "lea", dst: rsp, src: mem(5, -resultBytes) });

  if (runtime !== undefined) {
    const pointer = gpr(11);
    const outgoing = 48;
    local.set("runtime", codeOffset + runtime.entry);
    local.set("image", 0);
    emit({ op: "sub", dst: rsp, src: imm(outgoing) });
    const extents = [
      heapStart,
      managedBytes,
      controlStart,
      controlEnd - controlStart,
      0,
      imageLength,
      pageBytes,
      stackBytes,
    ];
    for (let index = 0; index < extents.length; index++) {
      const value = extents[index];
      if (value === undefined) throw "runtime window invariant";
      if (index === 4) emit({ op: "lea", dst: rax, src: rip("image") });
      else if (index % 2 === 0) mappedAddress(rax, value);
      else constantAddress(rax, value);
      if (index === 0)
        emit({ op: "mov", dst: mem(12, managedBaseOffset), src: rax });
      if (index === 1)
        emit({ op: "mov", dst: mem(12, managedLengthOffset), src: rax });
      emit({ op: "cvtsi2sd", dst: xmm(index), src: rax });
    }
    for (let index = 0; index < arrays.length; index++) {
      const array = arrays[index];
      if (array === undefined) throw "runtime array invariant";
      const header = controlStart + index * 24;
      emit({
        op: "mov",
        dst: rax,
        src: bits(array.kind, nativeHeaderFlagUnit / 4294967296),
      });
      const headerRegister = gpr(10);
      let headerBase = 13,
        headerOffset = header;
      if (header > 0x7ffffff0) {
        mappedAddress(headerRegister, header);
        headerBase = headerRegister.index;
        headerOffset = 0;
      }
      emit({ op: "mov", dst: mem(headerBase, headerOffset), src: rax });
      emit({
        op: "mov",
        dst: mem(headerBase, headerOffset + nativeArrayLengthOffset),
        src: imm(array.length),
      });
      mappedAddress(pointer, array.data);
      emit({
        op: "mov",
        dst: mem(headerBase, headerOffset + nativeArrayDataOffset),
        src: pointer,
      });
      if (index < 2) mappedAddress(gpr(8 + index), header);
      else {
        mappedAddress(rax, header);
        emit({ op: "mov", dst: mem(4, (index - 2) * 8), src: rax });
      }
    }
    emit({ op: "mov", dst: rdi, src: r12 });
    emit({ op: "xor", dst: esi, src: esi });
    emit({ op: "xor", dst: edx, src: edx });
    emit({ op: "lea", dst: gpr(1), src: mem(4, outgoing) });
    emit({ op: "call", target: label("runtime") });
    emit({ op: "add", dst: rsp, src: imm(outgoing) });
    emit({ op: "cmp", dst: eax, src: imm(normal) });
    emit({ op: "jcc", cc: "ne", target: label("program-failed") });
    emit({ op: "mov", dst: rax, src: mem(4, resultPayload) });
    emit({ op: "test", dst: rax, src: rax });
    emit({ op: "jcc", cc: "e", target: label("guard-failed") });
    emit({ op: "cmp", dst: mem(12, allocationStateOffset), src: imm(0) });
    emit({ op: "jcc", cc: "e", target: label("guard-failed") });
    emit({ op: "mov", dst: pointer, src: mem(0, nativeFunctionEntryOffset) });
    emit({ op: "mov", dst: mem(12, allocatorEntryOffset), src: pointer });
    emit({
      op: "mov",
      dst: pointer,
      src: mem(0, nativeFunctionEnvironmentOffset),
    });
    emit({ op: "mov", dst: mem(12, allocatorEnvironmentOffset), src: pointer });
    // A collector constructor after startup violates its non-allocating contract.
    emit({ op: "mov", dst: mem(12, heapCursorOffset), src: imm(0) });
    emit({ op: "mov", dst: mem(12, heapEndOffset), src: imm(0) });
  }

  emit({ op: "mov", dst: rdi, src: r12 });
  emit({ op: "xor", dst: esi, src: esi });
  emit({ op: "xor", dst: edx, src: edx });
  emit({ op: "mov", dst: gpr(1), src: rsp });
  emit({ op: "mov", dst: mem(4, 0), src: imm(0) });
  emit({ op: "mov", dst: mem(4, 8), src: imm(0) });
  if (threaded)
    emit({
      op: "cvtsi2sd",
      dst: xmm(0),
      src: mem(12, threadArgumentOffset),
    });
  emit({ op: "call", target: label("invoke") });
  emit({ op: "cmp", dst: eax, src: imm(normal) });
  emit({ op: "jcc", cc: "ne", target: label("program-failed") });

  const general = request.returnType === "general";
  if (general) {
    emit({ op: "mov", dst: rax, src: mem(4, resultPayload) });
    emit({ op: "test", dst: rax, src: rax });
    emit({ op: "jcc", cc: "e", target: label("unmap") });
    emit({ op: "cmp", dst: rax, src: imm(2) });
    emit({ op: "jcc", cc: "e", target: label("boolean-status") });
    emit({ op: "cmp", dst: rax, src: imm(1) });
    emit({ op: "jcc", cc: "ne", target: label("program-failed") });
  }
  if (request.returnType === "number" || general) {
    const payload = mem(4, resultPayload + (general ? 8 : 0));
    emit({ op: "cvttsd2si", dst: rax, src: payload });
    emit({ op: "cmp", dst: rax, src: imm(255) });
    emit({ op: "jcc", cc: "a", target: label("program-failed") });
    emit({ op: "cvtsi2sd", dst: xmm(0), src: rax });
    emit({ op: "ucomisd", dst: xmm(0), src: payload });
    emit({ op: "jcc", cc: "ne", target: label("program-failed") });
    if (general) emit({ op: "jmp", target: label("unmap") });
  }
  if (request.returnType === "boolean" || general) {
    emit({ op: "label", name: "boolean-status" });
    emit({
      op: "mov",
      dst: rax,
      src: mem(4, resultPayload + (general ? 8 : 0)),
    });
  } else if (request.returnType === "void")
    emit({ op: "xor", dst: eax, src: eax });
  emit({ op: "jmp", target: label("unmap") });
  emit({ op: "label", name: "program-failed" });
  emit({ op: "mov", dst: eax, src: imm(1) });
  if (threaded) {
    emit({ op: "cmp", dst: mem(12, threadModeOffset), src: imm(0) });
    emit({ op: "mov", dst: word(10), src: imm(70) });
    emit({ op: "cmovcc", cc: "ne", dst: eax, src: word(10) });
  }
  emit({ op: "jmp", target: label("unmap") });
  emit({ op: "label", name: "guard-failed" });
  emit({ op: "mov", dst: eax, src: imm(71) });
  emit({ op: "label", name: "unmap" });
  emit({ op: "mov", dst: mem(12, contextBytes), src: rax });
  if (threaded && runtime !== undefined) {
    const cleanup = "unmap-hosted-context";
    const allocator = mem(12, allocatorEntryOffset);
    emit({ op: "cmp", dst: allocator, src: imm(0) });
    emit({ op: "jcc", cc: "e", target: label(cleanup) });
    emit({ op: "mov", dst: rdi, src: r12 });
    emit({ op: "mov", dst: rsi, src: mem(12, allocatorEnvironmentOffset) });
    emit({ op: "xor", dst: edx, src: edx });
    emit({ op: "mov", dst: gpr(1), src: rsp });
    emit({ op: "mov", dst: rax, src: imm(nativeAllocatorShutdownRequest) });
    emit({ op: "cvtsi2sd", dst: xmm(0), src: rax });
    emit({ op: "call", target: allocator });
    emit({ op: "cmp", dst: eax, src: imm(normal) });
    emit({ op: "jcc", cc: "e", target: label(cleanup) });
    // An unjoined worker could still access the context's storage.
    emit({ op: "jmp", target: label("mapping-failed") });
    emit({ op: "label", name: cleanup });
  }
  emit({ op: "mov", dst: rsp, src: r12 });
  emit({ op: "mov", dst: rdi, src: r13 });
  mappingLength();
  call(host.symbolPrefix + "munmap");
  emit({ op: "mov", dst: rax, src: mem(12, contextBytes) });
  emit({ op: "jmp", target: label("return") });
  emit({ op: "label", name: "mapping-failed" });
  emit({ op: "mov", dst: eax, src: imm(71) });
  emit({ op: "label", name: "return" });
  if (threaded && request.threadExitPipe === true) {
    emit({ op: "mov", dst: rdx, src: mem(12, threadArgumentOffset) });
    emit({ op: "test", dst: rdx, src: imm(1) });
    emit({ op: "jcc", cc: "e", target: label("thread-exit-done") });
    emit({ op: "mov", dst: rsp, src: r12 });
    emit({ op: "mov", dst: mem(12, contextBytes), src: rax });
    emit({ op: "sub", dst: rdx, src: imm(1) });
    // Copy the descriptors into dead system-frame slots before publishing.
    emit({ op: "mov", dst: gpr(8), src: mem(2, nativeThreadExitWriteOffset) });
    emit({ op: "mov", dst: gpr(9), src: mem(2, nativeThreadExitReadOffset) });
    emit({ op: "mov", dst: mem(12, threadArgumentOffset), src: gpr(8) });
    emit({ op: "mov", dst: mem(12, threadModeOffset), src: gpr(9) });
    emit({ op: "add", dst: rax, src: imm(1) });
    emit({ op: "mov", dst: mem(2, 0), src: rax });
    emit({ op: "mov", dst: mem(12, argumentCountOffset), src: imm(1) });

    emit({ op: "label", name: "thread-exit-write" });
    emit({ op: "mov", dst: rdi, src: mem(12, threadArgumentOffset) });
    emit({ op: "lea", dst: rsi, src: mem(12, argumentCountOffset) });
    emit({ op: "mov", dst: edx, src: imm(1) });
    call(host.symbolPrefix + "write");
    emit({ op: "cmp", dst: rax, src: imm(0) });
    emit({ op: "jcc", cc: "ge", target: label("thread-exit-close") });
    call(host.errnoSymbol);
    emit({ op: "cmp", dst: { ...mem(0, 0), width: 32 }, src: imm(4) });
    emit({ op: "jcc", cc: "e", target: label("thread-exit-write") });
    emit({ op: "label", name: "thread-exit-close" });
    emit({ op: "mov", dst: rdi, src: mem(12, threadArgumentOffset) });
    call(host.symbolPrefix + "close");
    emit({ op: "mov", dst: rdi, src: mem(12, threadModeOffset) });
    call(host.symbolPrefix + "close");
    emit({ op: "mov", dst: rax, src: mem(12, contextBytes) });
    emit({ op: "label", name: "thread-exit-done" });
  }
  if (far) {
    emit({ op: "mov", dst: gpr(14), src: mem(12, saveOffset) });
    emit({ op: "mov", dst: gpr(15), src: mem(12, saveOffset + 8) });
  }
  emit({ op: "mov", dst: rbp, src: mem(12, contextBytes + 8) });
  emit({ op: "lea", dst: rsp, src: mem(5, -16) });
  cfi.record(dwarfStackPointer, 32, saved);
  emit({ op: "pop", dst: r13 });
  cfi.record(dwarfStackPointer, 24, saved12);
  emit({ op: "pop", dst: r12 });
  cfi.record(dwarfStackPointer, 16, savedFrame);
  emit({ op: "pop", dst: rbp });
  cfi.record(dwarfStackPointer, 8, [returnSave]);
  emit({ op: "ret" });
  emit({ op: "label", name: "main:end" });

  const stub = encodeLayout(
    machine,
    (name) => local.has(name) || imports.has(name),
    far,
  );
  const base = imageLength;
  let data = native.data;
  if (runtimeCode !== undefined) {
    data = new Uint8Array(dataOffset + runtimeCode.data.length);
    data.set(native.data);
    data.set(runtimeCode.data, dataOffset);
  }
  const threadEntry = stub.labels.get(hostedThreadEntryLabel);
  const external: RelativeFixup[] = [];
  for (const fixup of stub.externalFixups) {
    if (fixup === undefined) throw "startup fixup invariant";
    const name = fixup.ref.label;
    const offset = local.get(name);
    if (offset !== undefined) {
      const status = patchRelative(
        stub.bytes,
        fixup,
        fixup.fieldOffset,
        offset,
        base + fixup.fieldOffset,
      );
      if (status === "range") throw "x86-64 rel32 displacement out of range";
      if (status !== "complete") throw "startup fixup invariant";
    } else
      external.push({
        ...fixup,
        fieldOffset: base + fixup.fieldOffset,
        nextOffset: base + fixup.nextOffset,
      });
  }
  function writeUnit(
    output: CodeOutput,
    origin: number,
    unit: X64Module,
    offset: number,
  ): string | undefined {
    if (offset === 0 && appPlan !== undefined) {
      const error = appPlan.write(output, origin);
      if (error !== undefined) return error;
    } else output.write(unit.code, origin + offset);
    for (const fixup of unit.hostedThreadFixups) {
      if (fixup === undefined || threadEntry === undefined)
        return "hosted thread entry fixup invariant";
      const address = offset + fixup.fieldOffset;
      const target = base + threadEntry;
      const error = output.patch(
        origin + address,
        fixup.byteLength,
        (bytes, site) => {
          const status = patchRelative(bytes, fixup, site, target, address);
          return status === "complete"
            ? undefined
            : "thread entry fixup " + status;
        },
      );
      if (error !== undefined) return error;
    }
    return undefined;
  }
  const codePlan: CodePlan = {
    byteLength: base + stub.bytes.length,
    write(output, origin) {
      const appError = writeUnit(output, origin, native, 0);
      if (appError !== undefined) return appError;
      if (runtimeCode !== undefined) {
        const runtimeError = writeUnit(output, origin, runtimeCode, codeOffset);
        if (runtimeError !== undefined) return runtimeError;
      }
      output.write(stub.bytes, origin + base);
      return undefined;
    },
  };
  const relocations = imageRelocations(external, imports);
  const appFixups = native.addressFixups.length;
  const runtimeFixups = runtimeCode?.addressFixups.length ?? 0;
  const patchAddress: ImageAddressPatcher = (
    bytes,
    index,
    site,
    target,
    address,
  ) => {
    if (index < appFixups)
      return native.patchAddress(bytes, index, site, target, address);
    if (runtimeCode !== undefined && index < appFixups + runtimeFixups)
      return runtimeCode.patchAddress(
        bytes,
        index - appFixups,
        site,
        target,
        address,
      );
    return relocations.patchAddress(
      bytes,
      index - appFixups - runtimeFixups,
      site,
      target,
      address,
    );
  };
  const main = stub.labels.get("main");
  if (main === undefined) throw "startup label invariant";
  const symbols: ImageSymbol[] = [];
  const dataSymbols: ImageSymbol[] = [];
  const unwind = native.unwind.slice();
  const probes = native.probes.slice();
  for (const fn of native.functions) {
    if (fn === undefined) throw "program symbol invariant";
    if (fn.import !== true) symbols.push({ name: fn.name, offset: fn.offset });
  }
  if (runtimeCode !== undefined) {
    for (const fn of runtimeCode.functions) {
      if (fn === undefined) throw "runtime symbol invariant";
      symbols.push({ name: fn.name, offset: codeOffset + fn.offset });
    }
    for (const range of runtimeCode.unwind) {
      if (range === undefined) throw "runtime unwind range invariant";
      unwind.push({ ...range, offset: codeOffset + range.offset });
    }
    for (const probe of runtimeCode.probes) {
      if (probe === undefined) throw "runtime probe invariant";
      probes.push({ ...probe, offset: codeOffset + probe.offset });
    }
  }
  const startupUnwind = resolveUnwind(
    [
      { start: "_start", end: "main", rule: "outermost", rows: [] },
      { start: "main", end: "main:end", rule: "rows", rows: cfi.rows },
    ],
    stub.labels,
  );
  for (const range of startupUnwind) {
    if (range === undefined) throw "startup unwind range invariant";
    unwind.push({ ...range, offset: base + range.offset });
  }
  symbols.push({ name: "_start", offset: base });
  symbols.push({ name: "main", offset: base + main });
  const debug = native.jitDebug;
  if (debug !== undefined) {
    dataSymbols.push({
      name: "__jit_debug_descriptor",
      offset: debug.descriptorOffset,
    });
    symbols.push({
      name: "__jit_debug_register_code",
      offset: debug.registerOffset,
    });
  }
  const addressFixups: ImageAddressReference[] = native.addressFixups.slice();
  if (runtimeCode !== undefined)
    for (const reference of runtimeCode.addressFixups) {
      if (reference === undefined) throw "runtime address fixup invariant";
      const target = reference.target;
      addressFixups.push({
        ...reference,
        offset: codeOffset + reference.offset,
        target:
          target.kind === "data"
            ? { kind: "data", offset: dataOffset + target.offset }
            : target,
      });
    }
  for (const reference of relocations.addressFixups) {
    if (reference === undefined) throw "startup address fixup invariant";
    addressFixups.push(reference);
  }
  return {
    codePlan,
    entryOffset: base,
    data,
    maxByteLength: Number.MAX_SAFE_INTEGER,
    imports: importNames,
    symbols,
    dataSymbols,
    runtimeOffset: codeOffset,
    unwind,
    probes,
    addressFixups,
    patchAddress,
  };
}
