import type { PosixHostFacts } from "@tint/abi/host";
import { nativeArrayDataOffset, nativeArrayLengthOffset } from "@tint/abi/host";
import type { HostOperation } from "@tint/ir/scalar";
import {
  dualMappingOf,
  dualMappingGranuleBytes as granule,
  dualMappingMagicLow,
  dualMappingMagicHigh,
  dualMappingHeaderMagicOffset as magicOffset,
  dualMappingHeaderExecutableOffset as executeOffset,
  dualMappingHeaderSizeOffset as sizeOffset,
  dualMappingHeaderWritableOffset as writeOffset,
  dualMappingHeaderReservationOffset as reservationOffset,
  dualMappingMaximumBytes as maximum,
  type DualMapping,
} from "../../scalar/executable-memory.ts";
import type { Gpr, Memory } from "../isa.ts";
import { branch, exactInteger } from "./host.ts";
import { bits, gpr, imm, label, mem, word, xmm, type Emit } from "./machine.ts";
import { floatBits } from "./numbers.ts";

const rax = gpr(0),
  rdx = gpr(2),
  rbx = gpr(3);
const rsi = gpr(6),
  rdi = gpr(7),
  r8 = gpr(8),
  r9 = gpr(9);
const r10 = gpr(10),
  r11 = gpr(11);
const eax = word(0),
  edi = word(7),
  esi = word(6),
  edx = word(2);
const magic = bits(dualMappingMagicLow, dualMappingMagicHigh);
const addressLimit = bits(0, 0x10000);

/** Serialize the current instruction stream after a write or before a
 * published entry. Preserve the SysV nonvolatile RBX across CPUID. */
export function serializeCode(emit: Emit): void {
  emit({ op: "mov", dst: r11, src: rbx });
  emit({ op: "xor", dst: eax, src: eax });
  emit({ op: "cpuid" });
  emit({ op: "mov", dst: rbx, src: r11 });
}

interface ExecutableMemorySite {
  readonly emit: Emit;
  readonly call: (symbol: string) => void;
  readonly argument: (index: number) => Memory<64>;
  readonly privateWord: (index: number) => Memory<64>;
  readonly name: string;
}

function numberResult(emit: Emit): void {
  emit({ op: "cvtsi2sd", dst: xmm(0), src: rax });
  floatBits(emit, rax, xmm(0));
}

function mmap(
  site: ExecutableMemorySite,
  target: DualMapping,
  protection: number,
  flags: number,
): void {
  const emit = site.emit;
  emit({ op: "mov", dst: edx, src: imm(protection) });
  emit({ op: "mov", dst: word(1), src: imm(flags) });
  emit({ op: "xor", dst: word(9), src: word(9) });
  site.call(target.symbols.map);
}

function extent(emit: Emit, value: Gpr<64>, failed: string): void {
  emit({ op: "test", dst: value, src: value });
  branch(emit, "le", failed);
  emit({
    op: "mov",
    dst: r10,
    src: bits(maximum >>> 0, Math.floor(maximum / 0x100000000)),
  });
  emit({ op: "cmp", dst: value, src: r10 });
  branch(emit, "a", failed);
}

function roundUp(emit: Emit, value: Gpr<64>): void {
  emit({ op: "add", dst: value, src: imm(granule - 1) });
  emit({ op: "and", dst: value, src: imm(-granule) });
}

function map(site: ExecutableMemorySite, target: DualMapping): void {
  const emit = site.emit,
    argument = site.argument,
    slot = site.privateWord;
  const reservation = slot(0),
    reservationSize = slot(1),
    size = slot(2);
  const executable = slot(3),
    writable = slot(4),
    fd = slot(5),
    name = slot(6);
  const invalid = site.name + ":invalid",
    cleanup = site.name + ":cleanup";
  const closeFailed = site.name + ":close-failed";
  const attempt = site.name + ":memfd-result",
    opened = site.name + ":opened";
  const closeFallback = site.name + ":close-fallback",
    fallback = site.name + ":fallback";
  const header = site.name + ":header",
    done = site.name + ":done";
  exactInteger(emit, argument(0), rsi, invalid);
  extent(emit, rsi, invalid);
  roundUp(emit, rsi);
  emit({ op: "mov", dst: size, src: rsi });
  emit({ op: "add", dst: rsi, src: rsi });
  emit({ op: "add", dst: rsi, src: imm(2 * granule) });
  emit({ op: "mov", dst: reservationSize, src: rsi });
  emit({ op: "xor", dst: edi, src: edi });
  emit({ op: "mov", dst: word(8), src: imm(-1) });
  mmap(site, target, 0, target.flags.reservation);
  emit({ op: "cmp", dst: rax, src: imm(-1) });
  branch(emit, "e", invalid);
  emit({ op: "mov", dst: reservation, src: rax });
  emit({ op: "add", dst: rax, src: reservationSize });
  emit({ op: "mov", dst: r11, src: addressLimit });
  emit({ op: "cmp", dst: rax, src: r11 });
  branch(emit, "ae", cleanup);
  emit({ op: "mov", dst: rax, src: reservation });
  emit({ op: "add", dst: rax, src: imm(granule) });
  roundUp(emit, rax);
  emit({ op: "mov", dst: executable, src: rax });
  emit({ op: "add", dst: rax, src: size });
  emit({ op: "mov", dst: writable, src: rax });
  emit({ op: "mov", dst: name, src: imm(0x746e6974) }); // tint
  emit({ op: "lea", dst: rdi, src: name });
  emit({
    op: "mov",
    dst: esi,
    src: imm(target.flags.memoryFile | target.flags.executableFile),
  });
  site.call(target.symbols.memoryFile);
  emit({ op: "test", dst: eax, src: eax });
  branch(emit, "ns", opened);
  site.call(target.symbols.errno);
  emit({ op: "cmp", dst: { ...mem(0, 0), width: 32 }, src: imm(22) }); // EINVAL
  branch(emit, "ne", attempt);
  emit({ op: "lea", dst: rdi, src: name });
  emit({ op: "mov", dst: esi, src: imm(target.flags.memoryFile) });
  site.call(target.symbols.memoryFile);
  emit({ op: "test", dst: eax, src: eax });
  branch(emit, "ns", opened);
  site.call(target.symbols.errno);
  emit({ op: "label", name: attempt });
  for (const errno of [13, 1, 38]) {
    emit({ op: "cmp", dst: { ...mem(0, 0), width: 32 }, src: imm(errno) });
    branch(emit, "e", fallback);
  }
  emit({ op: "jmp", target: label(cleanup) });

  emit({ op: "label", name: opened });
  emit({ op: "mov", dst: fd, src: rax });
  emit({ op: "mov", dst: edi, src: eax });
  emit({ op: "mov", dst: rsi, src: size });
  site.call(target.symbols.truncate);
  emit({ op: "test", dst: eax, src: eax });
  branch(emit, "ne", closeFailed);
  emit({ op: "mov", dst: rdi, src: executable });
  emit({ op: "mov", dst: rsi, src: size });
  emit({ op: "mov", dst: r8, src: fd });
  mmap(site, target, 5, target.flags.private | target.flags.fixed);
  emit({ op: "cmp", dst: rax, src: imm(-1) });
  branch(emit, "e", closeFallback);
  emit({ op: "mov", dst: rdi, src: writable });
  emit({ op: "mov", dst: rsi, src: size });
  emit({ op: "mov", dst: r8, src: fd });
  mmap(site, target, 3, target.flags.shared | target.flags.fixed);
  emit({ op: "cmp", dst: rax, src: imm(-1) });
  branch(emit, "e", closeFailed);
  emit({ op: "mov", dst: rdi, src: fd });
  site.call(target.symbols.close);
  emit({ op: "jmp", target: label(header) });
  emit({ op: "label", name: closeFallback });
  emit({ op: "mov", dst: rdi, src: fd });
  site.call(target.symbols.close);
  emit({ op: "label", name: fallback });
  emit({ op: "mov", dst: rdi, src: executable });
  emit({ op: "mov", dst: writable, src: rdi });
  emit({ op: "mov", dst: rsi, src: size });
  emit({ op: "mov", dst: word(8), src: imm(-1) });
  mmap(site, target, 5, target.flags.anonymous | target.flags.fixed);
  emit({ op: "cmp", dst: rax, src: imm(-1) });
  branch(emit, "e", cleanup);

  emit({ op: "label", name: header });
  function protectHeader(mode: number): void {
    emit({ op: "mov", dst: rdi, src: executable });
    emit({ op: "sub", dst: rdi, src: imm(granule) });
    emit({ op: "mov", dst: esi, src: imm(granule) });
    emit({ op: "mov", dst: edx, src: imm(mode) });
    site.call(target.symbols.protect);
    emit({ op: "test", dst: eax, src: eax });
    branch(emit, "ne", cleanup);
  }
  protectHeader(3);
  emit({ op: "mov", dst: r11, src: executable });
  emit({ op: "sub", dst: r11, src: imm(granule) });
  emit({ op: "mov", dst: rax, src: magic });
  emit({ op: "mov", dst: mem(11, magicOffset), src: rax });
  const headerValues = [executable, size, writable, reservation];
  const headerOffsets = [
    executeOffset,
    sizeOffset,
    writeOffset,
    reservationOffset,
  ];
  for (let index = 0; index < headerValues.length; index++) {
    const value = headerValues[index],
      offset = headerOffsets[index];
    if (value === undefined || offset === undefined)
      throw "executable header invariant";
    emit({ op: "mov", dst: rax, src: value });
    emit({ op: "mov", dst: mem(11, offset), src: rax });
  }
  protectHeader(1);
  emit({ op: "mov", dst: rax, src: executable });
  emit({ op: "jmp", target: label(done) });
  emit({ op: "label", name: closeFailed });
  emit({ op: "mov", dst: rdi, src: fd });
  site.call(target.symbols.close);
  emit({ op: "label", name: cleanup });
  emit({ op: "mov", dst: rdi, src: reservation });
  emit({ op: "mov", dst: rsi, src: reservationSize });
  site.call(target.symbols.unmap);
  emit({ op: "label", name: invalid });
  emit({ op: "mov", dst: rax, src: imm(-1) });
  emit({ op: "label", name: done });
}

/** RDI names the view at the beginning of the authorized arena, RSI the
 * caller's window. On success R11 addresses the read-only header. */
function lookup(site: ExecutableMemorySite, failed: string): void {
  const emit = site.emit;
  exactInteger(emit, site.argument(0), rdi, failed);
  exactInteger(emit, site.argument(1), rsi, failed);
  extent(emit, rsi, failed);
  emit({ op: "cmp", dst: rdi, src: imm(granule) });
  branch(emit, "b", failed);
  emit({ op: "test", dst: rdi, src: imm(granule - 1) });
  branch(emit, "ne", failed);
  emit({ op: "mov", dst: r10, src: addressLimit });
  emit({ op: "cmp", dst: rdi, src: r10 });
  branch(emit, "ae", failed);
  emit({ op: "lea", dst: r11, src: mem(7, -granule) });
  emit({ op: "mov", dst: rax, src: magic });
  emit({ op: "cmp", dst: mem(11, magicOffset), src: rax });
  branch(emit, "ne", failed);
  emit({ op: "cmp", dst: mem(11, executeOffset), src: rdi });
  branch(emit, "ne", failed);
  emit({ op: "cmp", dst: rsi, src: mem(11, sizeOffset) });
  branch(emit, "a", failed);
}

function unmap(site: ExecutableMemorySite, target: DualMapping): void {
  const emit = site.emit;
  const failed = site.name + ":invalid",
    done = site.name + ":done";
  lookup(site, failed);
  roundUp(emit, rsi);
  emit({ op: "cmp", dst: mem(11, sizeOffset), src: rsi });
  branch(emit, "ne", failed);
  emit({ op: "mov", dst: rdi, src: mem(11, reservationOffset) });
  emit({ op: "add", dst: rsi, src: rsi });
  emit({ op: "add", dst: rsi, src: imm(2 * granule) });
  site.call(target.symbols.unmap);
  emit({ op: "movsx", dst: rax, src: eax });
  emit({ op: "jmp", target: label(done) });
  emit({ op: "label", name: failed });
  emit({ op: "mov", dst: rax, src: imm(-1) });
  emit({ op: "label", name: done });
}

function write(site: ExecutableMemorySite, target: DualMapping): void {
  const emit = site.emit,
    slot = site.privateWord;
  const executable = slot(0),
    writable = slot(1),
    source = slot(2),
    bytes = slot(3);
  const protectionBase = slot(4),
    protectionBytes = slot(5);
  const failed = site.name + ":invalid",
    repair = site.name + ":protect";
  const success = site.name + ":success",
    done = site.name + ":done";
  lookup(site, failed);
  exactInteger(emit, site.argument(2), rdx, failed);
  emit({ op: "cmp", dst: rdx, src: rsi });
  branch(emit, "a", failed);
  emit({ op: "sub", dst: rsi, src: rdx });
  emit({ op: "mov", dst: r8, src: site.argument(3) });
  emit({
    op: "mov",
    dst: word(9),
    src: { ...mem(8, nativeArrayLengthOffset), width: 32 },
  });
  emit({ op: "cmp", dst: r9, src: rsi });
  branch(emit, "a", failed);
  emit({ op: "test", dst: r9, src: r9 });
  branch(emit, "e", success);
  emit({ op: "mov", dst: bytes, src: r9 });
  emit({ op: "mov", dst: rax, src: mem(8, nativeArrayDataOffset) });
  emit({ op: "mov", dst: source, src: rax });
  emit({ op: "mov", dst: r10, src: mem(11, writeOffset) });
  emit({ op: "add", dst: rdi, src: rdx });
  emit({ op: "add", dst: r10, src: rdx });
  emit({ op: "mov", dst: executable, src: rdi });
  emit({ op: "mov", dst: writable, src: r10 });
  emit({ op: "cmp", dst: rdi, src: r10 });
  branch(emit, "e", repair);
  function transfer(address: Memory<64>, call: string): void {
    emit({ op: "mov", dst: rdi, src: address });
    emit({ op: "mov", dst: rsi, src: source });
    emit({ op: "mov", dst: rdx, src: bytes });
    site.call(call);
  }
  transfer(writable, target.symbols.move);
  // ptrace can make the private RX page diverge from the memfd.
  transfer(executable, target.symbols.compare);
  emit({ op: "test", dst: eax, src: eax });
  branch(emit, "e", success);
  emit({ op: "label", name: repair });
  emit({ op: "mov", dst: rdi, src: executable });
  emit({ op: "mov", dst: rsi, src: rdi });
  emit({ op: "and", dst: rdi, src: imm(-granule) });
  emit({ op: "add", dst: rsi, src: bytes });
  roundUp(emit, rsi);
  emit({ op: "sub", dst: rsi, src: rdi });
  emit({ op: "mov", dst: protectionBase, src: rdi });
  emit({ op: "mov", dst: protectionBytes, src: rsi });
  function protect(mode: number): void {
    emit({ op: "mov", dst: rdi, src: protectionBase });
    emit({ op: "mov", dst: rsi, src: protectionBytes });
    emit({ op: "mov", dst: edx, src: imm(mode) });
    site.call(target.symbols.protect);
    emit({ op: "test", dst: eax, src: eax });
    branch(emit, "ne", failed);
  }
  protect(3);
  transfer(executable, target.symbols.move);
  protect(5);
  emit({ op: "label", name: success });
  serializeCode(emit);
  emit({ op: "xor", dst: eax, src: eax });
  emit({ op: "jmp", target: label(done) });
  emit({ op: "label", name: failed });
  emit({ op: "mov", dst: rax, src: imm(-1) });
  emit({ op: "label", name: done });
}

export function emitExecutableMemory(
  site: ExecutableMemorySite,
  host: PosixHostFacts,
  operation: HostOperation,
): boolean {
  const target = dualMappingOf(host);
  if (target === undefined) return false;
  switch (operation) {
    case "executable-map":
      map(site, target);
      break;
    case "executable-unmap":
      unmap(site, target);
      break;
    case "executable-write":
      write(site, target);
      break;
    default:
      return false;
  }
  numberResult(site.emit);
  return true;
}
