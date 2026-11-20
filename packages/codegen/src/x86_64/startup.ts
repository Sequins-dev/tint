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
  type PosixHostFacts,
} from "@tint/abi/host";
import type {
  ImageAddressPatcher,
  ImageAddressReference,
  ImageAddressTarget,
} from "@tint/abi/relocation";
import {
  encodeLayout,
  writeRel32,
  type Instruction,
  type NearFixup,
} from "./isa.ts";
import type { X64Module } from "./scalar/index.ts";
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
  readonly managedBytes: number;
  readonly pageBytes: number;
}

interface ImageSymbol {
  readonly name: string;
  readonly offset: number;
}

interface HostedImage extends ImageRelocations {
  readonly code: Uint8Array;
  readonly data: Uint8Array;
  readonly entryOffset: number;
  readonly maxByteLength: number;
  readonly imports: readonly string[];
  readonly symbols: readonly ImageSymbol[];
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
  const processStart = host.processStart;
  if (processStart === undefined) throw "glibc startup policy required";
  const stackEnd = pageBytes + stackBytes;
  const app = native;
  const runtime = request.runtime;
  const runtimeCode = runtime?.native;
  const codeOffset =
    runtimeCode === undefined
      ? app.code.length
      : Math.ceil(app.code.length / 8) * 8;
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
        tableOffset: codeOffset + table.tableOffset,
      });
    }
  const registryStart = stackEnd + pageBytes;
  const registryBytes =
    nativeStackMapRegistryHeaderBytes +
    stackMaps.length * nativeStackMapRegistryEntryBytes;
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
  if (mappingBytes > 0x7fffffff) throw "invalid hosted mapping size";
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
  const threadArgumentOffset = contextBytes + 16;
  const threadModeOffset = threadArgumentOffset + 8;
  if (threaded) {
    const hostedRun = "hosted-run";
    emit({ op: "xor", dst: edx, src: edx });
    emit({ op: "xor", dst: word(1), src: word(1) });
    emit({ op: "jmp", target: label(hostedRun) });
    emit({ op: "label", name: hostedThreadEntryLabel });
    emit({ op: "mov", dst: rdx, src: rdi });
    emit({ op: "xor", dst: edi, src: edi });
    emit({ op: "xor", dst: esi, src: esi });
    emit({ op: "mov", dst: word(1), src: imm(1) });
    emit({ op: "label", name: hostedRun });
  }
  emit({ op: "push", src: rbp });
  emit({ op: "mov", dst: rbp, src: rsp });
  emit({ op: "push", src: r12 });
  emit({ op: "push", src: r13 });
  emit({ op: "sub", dst: rsp, src: imm(contextBytes + (threaded ? 32 : 16)) });
  emit({ op: "mov", dst: r12, src: rsp });
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
  emit({ op: "mov", dst: esi, src: imm(mappingBytes) });
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
  emit({ op: "lea", dst: rax, src: mem(13, mappingBytes - 1) });
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
  if (threaded) {
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
  emit({ op: "lea", dst: rax, src: mem(13, registryStart) });
  emit({ op: "mov", dst: mem(12, nativeStackMapRegistryOffset), src: rax });
  emit({ op: "mov", dst: mem(0, 0), src: imm(stackMaps.length) });
  emit({ op: "mov", dst: mem(0, 8), src: imm(stackMaps.length) });
  for (let index = 0; index < stackMaps.length; index++) {
    const table = stackMaps[index];
    if (table === undefined) throw "stack map registry entry invariant";
    const codeName = "stack-maps-code:" + String(index);
    const tableName = "stack-maps-table:" + String(index);
    local.set(codeName, table.codeOffset);
    local.set(tableName, table.tableOffset);
    const entry =
      nativeStackMapRegistryHeaderBytes +
      index * nativeStackMapRegistryEntryBytes;
    emit({ op: "lea", dst: gpr(11), src: rip(codeName) });
    emit({ op: "mov", dst: mem(0, entry), src: gpr(11) });
    emit({ op: "mov", dst: mem(0, entry + 8), src: imm(table.codeLength) });
    emit({ op: "lea", dst: gpr(11), src: rip(tableName) });
    emit({ op: "mov", dst: mem(0, entry + 16), src: gpr(11) });
  }

  emit({
    op: "lea",
    dst: rax,
    src: mem(13, runtime === undefined ? heapStart : controlCursor),
  });
  emit({ op: "mov", dst: mem(12, heapCursorOffset), src: rax });
  emit({ op: "lea", dst: rax, src: mem(13, mappingBytes) });
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
      else if (index % 2 === 0)
        emit({ op: "lea", dst: rax, src: mem(13, value) });
      else emit({ op: "mov", dst: rax, src: imm(value) });
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
      emit({ op: "mov", dst: mem(13, header), src: rax });
      emit({
        op: "mov",
        dst: mem(13, header + nativeArrayLengthOffset),
        src: imm(array.length),
      });
      emit({ op: "lea", dst: pointer, src: mem(13, array.data) });
      emit({
        op: "mov",
        dst: mem(13, header + nativeArrayDataOffset),
        src: pointer,
      });
      if (index < 2)
        emit({ op: "lea", dst: gpr(8 + index), src: mem(13, header) });
      else {
        emit({ op: "lea", dst: rax, src: mem(13, header) });
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
  emit({ op: "mov", dst: esi, src: imm(mappingBytes) });
  call(host.symbolPrefix + "munmap");
  emit({ op: "mov", dst: rax, src: mem(12, contextBytes) });
  emit({ op: "jmp", target: label("return") });
  emit({ op: "label", name: "mapping-failed" });
  emit({ op: "mov", dst: eax, src: imm(71) });
  emit({ op: "label", name: "return" });
  emit({ op: "mov", dst: rbp, src: mem(12, contextBytes + 8) });
  emit({ op: "lea", dst: rsp, src: mem(5, -16) });
  emit({ op: "pop", dst: r13 });
  emit({ op: "pop", dst: r12 });
  emit({ op: "pop", dst: rbp });
  emit({ op: "ret" });

  const stub = encodeLayout(
    machine,
    (name) => local.has(name) || imports.has(name),
  );
  const base = imageLength;
  const code = new Uint8Array(base + stub.bytes.length);
  code.set(native.code);
  let data = native.data;
  if (runtimeCode !== undefined) {
    code.set(runtimeCode.code, codeOffset);
    data = new Uint8Array(dataOffset + runtimeCode.data.length);
    data.set(native.data);
    data.set(runtimeCode.data, dataOffset);
  }
  code.set(stub.bytes, base);
  function patchThreadEntry(unit: X64Module, unitOffset: number): void {
    if (unit.hostedThreadFixups.length === 0) return;
    const offset = stub.labels.get(hostedThreadEntryLabel);
    if (offset === undefined)
      throw "thread entry requires threaded hosted startup";
    for (const fixup of unit.hostedThreadFixups) {
      if (fixup === undefined) throw "thread entry fixup invariant";
      writeRel32(
        code,
        unitOffset + fixup.fieldOffset,
        unitOffset + fixup.nextOffset,
        base + offset,
      );
    }
  }
  patchThreadEntry(native, 0);
  if (runtimeCode !== undefined) patchThreadEntry(runtimeCode, codeOffset);
  const external: NearFixup[] = [];
  for (const fixup of stub.externalFixups) {
    if (fixup === undefined) throw "startup fixup invariant";
    const name = fixup.ref.label;
    const offset = local.get(name);
    if (offset !== undefined)
      writeRel32(
        code,
        base + fixup.fieldOffset,
        base + fixup.nextOffset,
        offset,
      );
    else
      external.push({
        ...fixup,
        fieldOffset: base + fixup.fieldOffset,
        nextOffset: base + fixup.nextOffset,
      });
  }
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
  for (const fn of native.functions) {
    if (fn === undefined) throw "program symbol invariant";
    symbols.push({ name: fn.name, offset: fn.offset });
  }
  if (runtimeCode !== undefined)
    for (const fn of runtimeCode.functions) {
      if (fn === undefined) throw "runtime symbol invariant";
      symbols.push({ name: fn.name, offset: codeOffset + fn.offset });
    }
  symbols.push({ name: "_start", offset: base });
  symbols.push({ name: "main", offset: base + main });
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
    code,
    entryOffset: base,
    data,
    maxByteLength: Number.MAX_SAFE_INTEGER,
    imports: importNames,
    symbols,
    addressFixups,
    patchAddress,
  };
}
