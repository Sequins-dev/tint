import { nativeStackLimitOffset, type PosixHostFacts } from "@tint/abi/host";
import type {
  ImageAddressPatcher,
  ImageAddressTarget,
} from "@tint/abi/relocation";
import { encodeLayout, writeRel32, type Instruction } from "./isa.ts";
import type { X64Module } from "./scalar/index.ts";
import {
  argumentCountOffset,
  argumentsOffset,
  contextBytes,
  heapCursorOffset,
  heapEndOffset,
  bits,
  gpr,
  imageRelocations,
  imm,
  label,
  mem,
  normal,
  resultBytes,
  resultPayload,
  rip,
  word,
} from "./scalar/machine.ts";

interface HostedEntry {
  readonly native: X64Module;
  readonly host: PosixHostFacts;
  readonly invocation: number;
  readonly returnType: "number" | "boolean" | "void";
  readonly stackBytes: number;
  readonly managedBytes: number;
  readonly pageBytes: number;
}

/** One process-local, non-collecting runtime. The guarded stack and zero-filled
 * allocation arena share a mapping, released after the managed entry returns. */
export function appendHostedEntry(request: HostedEntry) {
  const native = request.native,
    host = request.host,
    stackBytes = request.stackBytes,
    managedBytes = request.managedBytes,
    pageBytes = request.pageBytes;
  const processStart = host.processStart;
  if (processStart === undefined) throw "glibc startup policy required";
  const stackEnd = pageBytes + stackBytes;
  const heapStart = stackEnd + pageBytes;
  const mappingBytes = heapStart + managedBytes;
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
  const emit = (insn: Instruction): void => {
    machine.push(insn);
  };
  function call(symbol: string): void {
    imports.set(symbol, { kind: "import", name: symbol });
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
  emit({ op: "push", src: rbp });
  emit({ op: "mov", dst: rbp, src: rsp });
  emit({ op: "push", src: r12 });
  emit({ op: "push", src: r13 });
  emit({ op: "sub", dst: rsp, src: imm(contextBytes + 16) });
  emit({ op: "mov", dst: r12, src: rsp });
  for (let offset = 0; offset < contextBytes; offset += 8)
    emit({ op: "mov", dst: mem(12, offset), src: imm(0) });
  emit({
    op: "mov",
    dst: { ...mem(12, argumentCountOffset), width: 32 },
    src: edi,
  });
  emit({ op: "mov", dst: mem(12, argumentsOffset), src: rsi });
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
  emit({ op: "lea", dst: rax, src: mem(13, heapStart) });
  emit({ op: "mov", dst: mem(12, heapCursorOffset), src: rax });
  emit({ op: "lea", dst: rax, src: mem(13, mappingBytes) });
  emit({ op: "mov", dst: mem(12, heapEndOffset), src: rax });
  emit({ op: "lea", dst: rsp, src: mem(13, stackEnd - resultBytes) });

  emit({ op: "mov", dst: rdi, src: r12 });
  emit({ op: "xor", dst: esi, src: esi });
  emit({ op: "xor", dst: edx, src: edx });
  emit({ op: "mov", dst: gpr(1), src: rsp });
  emit({ op: "mov", dst: mem(4, 0), src: imm(0) });
  emit({ op: "mov", dst: mem(4, 8), src: imm(0) });
  emit({ op: "call", target: label("invoke") });
  emit({ op: "cmp", dst: eax, src: imm(normal) });
  emit({ op: "jcc", cc: "ne", target: label("program-failed") });

  if (request.returnType === "number") {
    emit({ op: "cvttsd2si", dst: rax, src: mem(4, resultPayload) });
    emit({ op: "cmp", dst: rax, src: imm(255) });
    emit({ op: "jcc", cc: "a", target: label("program-failed") });
  } else if (request.returnType === "boolean")
    emit({ op: "mov", dst: rax, src: mem(4, resultPayload) });
  else emit({ op: "xor", dst: eax, src: eax });
  emit({ op: "jmp", target: label("unmap") });
  emit({ op: "label", name: "program-failed" });
  emit({ op: "mov", dst: eax, src: imm(1) });
  emit({ op: "jmp", target: label("unmap") });
  emit({ op: "label", name: "guard-failed" });
  emit({ op: "mov", dst: eax, src: imm(71) });
  emit({ op: "label", name: "unmap" });
  emit({ op: "mov", dst: rsp, src: r12 });
  emit({ op: "mov", dst: mem(12, contextBytes), src: rax });
  emit({ op: "mov", dst: rdi, src: r13 });
  emit({ op: "mov", dst: esi, src: imm(mappingBytes) });
  call(host.symbolPrefix + "munmap");
  emit({ op: "mov", dst: rax, src: mem(12, contextBytes) });
  emit({ op: "jmp", target: label("return") });
  emit({ op: "label", name: "mapping-failed" });
  emit({ op: "mov", dst: eax, src: imm(71) });
  emit({ op: "label", name: "return" });
  emit({ op: "lea", dst: rsp, src: mem(5, -16) });
  emit({ op: "pop", dst: r13 });
  emit({ op: "pop", dst: r12 });
  emit({ op: "pop", dst: rbp });
  emit({ op: "ret" });

  const stub = encodeLayout(
    machine,
    (name) => name === "invoke" || imports.has(name),
  );
  const base = native.code.length;
  const code = new Uint8Array(base + stub.bytes.length);
  code.set(native.code);
  code.set(stub.bytes, base);
  const external = [];
  for (const fixup of stub.externalFixups) {
    if (fixup === undefined) throw "startup fixup invariant";
    const name = fixup.ref.label;
    if (name === "initialize" || name === "invoke")
      writeRel32(
        code,
        base + fixup.fieldOffset,
        base + fixup.nextOffset,
        request.invocation,
      );
    else
      external.push({
        ...fixup,
        fieldOffset: base + fixup.fieldOffset,
        nextOffset: base + fixup.nextOffset,
      });
  }
  const relocations = imageRelocations(external, imports);
  const nativeFixups = native.addressFixups.length;
  const patchAddress: ImageAddressPatcher = (
    bytes,
    index,
    site,
    target,
    address,
  ) =>
    index < nativeFixups
      ? native.patchAddress(bytes, index, site, target, address)
      : relocations.patchAddress(
          bytes,
          index - nativeFixups,
          site,
          target,
          address,
        );
  const symbols = new Set(native.imports);
  for (const symbol of imports.keys()) {
    if (symbol === undefined) throw "import symbol invariant";
    symbols.add(symbol);
  }
  const main = stub.labels.get("main");
  if (main === undefined) throw "startup label invariant";
  return {
    code,
    entryOffset: base,
    data: native.data,
    maxByteLength: Number.MAX_SAFE_INTEGER,
    imports: [...symbols],
    symbols: [
      ...native.functions.map((fn) => {
        if (fn === undefined) throw "program symbol invariant";
        return { name: fn.name, offset: fn.offset };
      }),
      { name: "_start", offset: base },
      { name: "main", offset: base + main },
    ],
    addressFixups: [...native.addressFixups, ...relocations.addressFixups],
    patchAddress,
  };
}
