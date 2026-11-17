import type { PosixHostABI } from "@tint/abi/host";
import type { Condition, Instruction } from "../isa.ts";

/** Linux executable arenas (host ABI `linux-dual-mapping`): one address
 * reservation holds a read-only header page, then the read/execute view
 * (the address `mapExecutableMemory` returns) and the read/write view of
 * the same memory-file pages, each `size` bytes (the request rounded up to
 * the granule). No page is writable and executable at once.
 *
 *     reservation: [header | read/execute view | read/write view]
 *
 * The executable view is a private mapping of the file: until a page is
 * copied on write it maps the file's own page, so writes through the
 * writable view appear in it, and a debugger can still plant software
 * breakpoints (ptrace cannot write a read-only shared mapping). A page the
 * debugger copied stops seeing the file; emitDualMappingWrite detects that
 * and writes such a page directly.
 *
 * The header lets a write or release validate the caller's window before
 * touching either view: it names the executable view, the view size and the
 * writable view. A window that does not start at a mapping's executable
 * address (or extends past its size) is rejected instead of writing through
 * an unrelated alias. */
/** The arena granule: the largest supported kernel page (16 KiB, 2^14; see
 * docs/linux-aarch64-target.md), so views and the header page are page
 * aligned on every supported kernel. */
export const dualMappingGranuleBytes = 16384;
/** "TINT" and "XMAP" as little-endian words. */
export const dualMappingMagicLow = 0x544e4954;
export const dualMappingMagicHigh = 0x50414d58;
export const dualMappingHeaderMagicOffset = 0;
export const dualMappingHeaderExecutableOffset = 8;
export const dualMappingHeaderSizeOffset = 16;
export const dualMappingHeaderWritableOffset = 24;
/** Largest request: keeps the reservation (header plus two views) exact
 * in a double and far below the 48-bit user address space. */
export const dualMappingMaximumBytes = 1099511627776;
const EINVAL = 22,
  ENOMEM = 12;

export interface DualMappingSymbols {
  readonly map: string;
  readonly unmap: string;
  readonly protect: string;
  readonly memoryFile: string;
  readonly truncate: string;
  readonly close: string;
  readonly move: string;
  readonly compare: string;
  readonly errno: string;
}
export interface DualMappingFlags {
  readonly memoryFile: number;
  readonly shared: number;
  readonly private: number;
  readonly fixed: number;
  readonly reservation: number;
}
export interface DualMapping {
  readonly symbols: DualMappingSymbols;
  readonly flags: DualMappingFlags;
}
/** The host's dual-mapping facts, when it publishes code that way. */
export function dualMappingOf(host: PosixHostABI): DualMapping | undefined {
  const memory = host.executableMemory;
  if (memory === undefined) return undefined;
  if (memory.kind !== "linux-dual-mapping") return undefined;
  const fixed = host.fixedMappingFlag;
  if (fixed === undefined) throw "dual mapping requires MAP_FIXED";
  const prefix = host.symbolPrefix;
  return {
    symbols: {
      map: prefix + "mmap",
      unmap: prefix + "munmap",
      protect: prefix + memory.protectSymbol,
      memoryFile: prefix + memory.memoryFileSymbol,
      truncate: prefix + memory.truncateSymbol,
      close: prefix + "close",
      move: prefix + "memmove",
      compare: prefix + "memcmp",
      errno: host.errnoSymbol,
    },
    flags: {
      memoryFile: memory.memoryFileFlags,
      shared: memory.sharedFlag,
      private: memory.privateFlag,
      fixed,
      reservation: memory.reservationFlags,
    },
  };
}
/** An InlineSequence whose branches are patched once its labels are all
 * placed. */
export interface InlineSequenceBuilder extends InlineSequence {
  readonly finish: () => void;
}
export interface InlineFixup {
  readonly index: number;
  readonly label: string;
  readonly condition: Condition | undefined;
}
/** The emitting function's inline services: instructions, local labels,
 * C calls through the image's import table (clobbering x0-x18 and x30) and
 * four scratch words that survive those calls. */
export interface InlineSequence {
  readonly emit: (instruction: Instruction) => void;
  readonly label: (name: string) => void;
  readonly branch: (name: string, condition?: Condition) => void;
  readonly call: (symbol: string) => void;
  readonly load: (rt: number, word: number) => void;
  readonly store: (rt: number | "zr", word: number) => void;
  /** rd = the 64-bit pattern hi:lo (unsigned 32-bit halves). */
  readonly constant: (rd: number, lo: number, hi?: number) => void;
  /** rd = the address of a scratch word. */
  readonly address: (rd: number, word: number) => void;
}

function add(
  s: InlineSequence,
  rd: number,
  rn: number,
  rm: number,
  setFlags: boolean = false,
): void {
  s.emit({
    op: "add-reg",
    width: 64,
    rd,
    rn,
    rm,
    shift: "lsl",
    amount: 0,
    setFlags,
  });
}
function compare(s: InlineSequence, rn: number, rm: number): void {
  s.emit({
    op: "sub-reg",
    width: 64,
    rd: "zr",
    rn,
    rm,
    shift: "lsl",
    amount: 0,
    setFlags: true,
  });
}
function compareZero(s: InlineSequence, rn: number, width: 32 | 64): void {
  s.emit({
    op: "sub-imm",
    width,
    rd: "zr",
    rn,
    immediate: 0,
    shift: 0,
    setFlags: true,
  });
}
/** rd = rn + the header page (rn - it when `down`). */
function offsetByGranule(
  s: InlineSequence,
  rd: number,
  rn: number,
  down: boolean,
): void {
  const immediate = dualMappingGranuleBytes / 4096;
  if (down)
    s.emit({
      op: "sub-imm",
      width: 64,
      rd,
      rn,
      immediate,
      shift: 12,
      setFlags: false,
    });
  else
    s.emit({
      op: "add-imm",
      width: 64,
      rd,
      rn,
      immediate,
      shift: 12,
      setFlags: false,
    });
}
function magic(s: InlineSequence, rd: number): void {
  s.constant(rd, dualMappingMagicLow, dualMappingMagicHigh);
}
/** Reads the header below the window at x0 into x11 (its address), x12
 * (view size) and x13 (writable view), calling `reject` with the failing
 * condition after each check: the header must be a dual mapping's whose
 * executable view starts at x0 and whose size is at least the window length
 * in x1. Clobbers x9. Reading the page below an address that is no arena
 * faults like any write to unmapped memory would. */
export function emitDualMappingLookup(
  s: InlineSequence,
  reject: (condition: "ne" | "hi") => void,
): void {
  offsetByGranule(s, 11, 0, true);
  s.emit({
    op: "ldr",
    width: 64,
    rt: 12,
    rn: 11,
    offset: dualMappingHeaderMagicOffset,
  });
  magic(s, 9);
  compare(s, 12, 9);
  reject("ne");
  s.emit({
    op: "ldr",
    width: 64,
    rt: 12,
    rn: 11,
    offset: dualMappingHeaderExecutableOffset,
  });
  compare(s, 12, 0);
  reject("ne");
  s.emit({
    op: "ldr",
    width: 64,
    rt: 13,
    rn: 11,
    offset: dualMappingHeaderWritableOffset,
  });
  s.emit({
    op: "ldr",
    width: 64,
    rt: 12,
    rn: 11,
    offset: dualMappingHeaderSizeOffset,
  });
  compare(s, 1, 12);
  reject("hi");
}

/** mapExecutableMemory with x1 = the requested byte length (an exact
 * integer). Leaves the executable view's address in x0, or -errno (an
 * invalid length reports EINVAL, an oversized one ENOMEM). Every failure
 * releases whatever the sequence mapped or opened. Scratch words: 0 the
 * reservation, 1 the view size, 2 the name and then the file descriptor,
 * 3 the error number. */
export function emitDualMappingMap(
  s: InlineSequence,
  mapping: DualMapping,
): void {
  const symbols = mapping.symbols,
    flags = mapping.flags;
  const emit = s.emit;
  // Reject lengths outside (0, maximum].
  compareZero(s, 1, 64);
  s.constant(9, EINVAL);
  s.store(9, 3);
  s.branch("failed", "le");
  s.constant(9, 0, dualMappingMaximumBytes / 4294967296);
  compare(s, 1, 9);
  s.constant(9, ENOMEM);
  s.store(9, 3);
  s.branch("failed", "hi");
  // size = length rounded up to the granule: ((length - 1) >> 14 + 1) << 14.
  emit({
    op: "sub-imm",
    width: 64,
    rd: 1,
    rn: 1,
    immediate: 1,
    shift: 0,
    setFlags: false,
  });
  emit({ op: "ubfm", width: 64, rd: 1, rn: 1, immr: 14, imms: 63 });
  emit({
    op: "add-imm",
    width: 64,
    rd: 1,
    rn: 1,
    immediate: 1,
    shift: 0,
    setFlags: false,
  });
  emit({ op: "ubfm", width: 64, rd: 1, rn: 1, immr: 50, imms: 49 });
  s.store(1, 1);
  // The reservation: mmap(NULL, header + 2 * size, RW, reservation, -1, 0).
  add(s, 1, 1, 1);
  offsetByGranule(s, 1, 1, false);
  s.constant(0, 0);
  s.constant(2, 3);
  s.constant(3, flags.reservation);
  s.constant(4, 0xffffffff);
  s.constant(5, 0);
  s.call(symbols.map);
  compareZero(s, 0, 64);
  s.branch("error", "lt");
  s.store(0, 0);
  // memfd_create("tint-jit", flags): the name lives in words 2 and 3.
  s.constant(9, 0x746e6974, 0x74696a2d);
  s.store(9, 2);
  s.store("zr", 3);
  s.address(0, 2);
  s.constant(1, flags.memoryFile);
  s.call(symbols.memoryFile);
  compareZero(s, 0, 32);
  s.branch("error-mapped", "lt");
  emit({ op: "sbfm", width: 64, rd: 0, rn: 0, immr: 0, imms: 31 });
  s.store(0, 2);
  // ftruncate(fd, size)
  s.load(1, 1);
  s.call(symbols.truncate);
  compareZero(s, 0, 32);
  s.branch("error-open", "ne");
  // Both views: mmap(address, size, protection, flags | MAP_FIXED, fd, 0);
  // the executable view (private: see emitDualMappingWrite) first, then
  // the shared writable one after it.
  for (let view = 0; view < 2; view++) {
    const writable = view === 1;
    s.load(0, 0);
    offsetByGranule(s, 0, 0, false);
    s.load(1, 1);
    if (writable) add(s, 0, 0, 1);
    s.constant(2, writable ? 3 : 5);
    s.constant(3, (writable ? flags.shared : flags.private) | flags.fixed);
    s.load(4, 2);
    s.constant(5, 0);
    s.call(symbols.map);
    compareZero(s, 0, 64);
    s.branch("error-open", "lt");
  }
  s.load(0, 2);
  s.call(symbols.close);
  // The header, then make its page read-only.
  s.load(10, 0);
  magic(s, 9);
  emit({
    op: "str",
    width: 64,
    rt: 9,
    rn: 10,
    offset: dualMappingHeaderMagicOffset,
  });
  offsetByGranule(s, 11, 10, false);
  emit({
    op: "str",
    width: 64,
    rt: 11,
    rn: 10,
    offset: dualMappingHeaderExecutableOffset,
  });
  s.load(12, 1);
  emit({
    op: "str",
    width: 64,
    rt: 12,
    rn: 10,
    offset: dualMappingHeaderSizeOffset,
  });
  add(s, 11, 11, 12);
  emit({
    op: "str",
    width: 64,
    rt: 11,
    rn: 10,
    offset: dualMappingHeaderWritableOffset,
  });
  emit({ op: "orr-reg", width: 64, rd: 0, rn: "zr", rm: 10 });
  s.constant(1, dualMappingGranuleBytes);
  s.constant(2, 1);
  s.call(symbols.protect);
  compareZero(s, 0, 32);
  s.branch("error-mapped", "ne");
  s.load(0, 0);
  offsetByGranule(s, 0, 0, false);
  s.branch("done");
  // Failure paths: capture errno, then undo in reverse order.
  s.label("error-open");
  captureErrno(s, symbols);
  s.load(0, 2);
  s.call(symbols.close);
  s.branch("release");
  s.label("error-mapped");
  captureErrno(s, symbols);
  s.label("release");
  s.load(1, 1);
  add(s, 1, 1, 1);
  offsetByGranule(s, 1, 1, false);
  s.load(0, 0);
  s.call(symbols.unmap);
  s.branch("failed");
  s.label("error");
  captureErrno(s, symbols);
  s.label("failed");
  negate(s, 0, 3);
  s.label("done");
}
/** x`rd` = -(scratch word `word`). */
function negate(s: InlineSequence, rd: number, word: number): void {
  s.load(9, word);
  s.emit({
    op: "sub-reg",
    width: 64,
    rd,
    rn: "zr",
    rm: 9,
    shift: "lsl",
    amount: 0,
    setFlags: false,
  });
}
function captureErrno(s: InlineSequence, symbols: DualMappingSymbols): void {
  s.call(symbols.errno);
  s.emit({ op: "ldr", width: 32, rt: 9, rn: 0, offset: 0 });
  s.store(9, 3);
}

/** unmapExecutableMemory with x0 = address and x1 = byte length (exact
 * integers): releases the whole reservation of the dual mapping whose
 * executable view starts at x0, leaving 0 or -errno in x0; an empty window
 * or one that is not such a mapping reports -EINVAL without unmapping
 * anything. */
export function emitDualMappingUnmap(
  s: InlineSequence,
  symbols: DualMappingSymbols,
): void {
  compareZero(s, 1, 64);
  s.branch("invalid", "le");
  emitDualMappingLookup(s, (condition: "ne" | "hi"): void =>
    s.branch("invalid", condition),
  );
  // munmap(header, header + 2 * size)
  s.emit({ op: "orr-reg", width: 64, rd: 0, rn: "zr", rm: 11 });
  add(s, 1, 12, 12);
  offsetByGranule(s, 1, 1, false);
  s.call(symbols.unmap);
  compareZero(s, 0, 32);
  s.constant(0, 0);
  s.branch("done", "eq");
  captureErrno(s, symbols);
  negate(s, 0, 3);
  s.branch("done");
  s.label("invalid");
  s.constant(9, EINVAL);
  s.store(9, 3);
  negate(s, 0, 3);
  s.label("done");
}

/** rd = rn rounded down to the granule. */
function granuleFloor(s: InlineSequence, rd: number, rn: number): void {
  s.emit({ op: "ubfm", width: 64, rd, rn, immr: 14, imms: 63 });
  s.emit({ op: "ubfm", width: 64, rd, rn: rd, immr: 50, imms: 49 });
}
/** mprotect(the granules spanning the written executable range,
 * protection): scratch word 3 holds the first granule, words 0 and 2 the
 * executable start and length. Rejects a failure. */
function protectWritten(
  s: InlineSequence,
  symbols: DualMappingSymbols,
  protection: number,
  reject: (condition: "ne" | "hi") => void,
): void {
  s.load(0, 0);
  s.load(1, 2);
  add(s, 1, 0, 1);
  s.emit({
    op: "sub-imm",
    width: 64,
    rd: 1,
    rn: 1,
    immediate: 1,
    shift: 0,
    setFlags: false,
  });
  granuleFloor(s, 1, 1);
  offsetByGranule(s, 1, 1, false);
  s.load(0, 3);
  s.emit({
    op: "sub-reg",
    width: 64,
    rd: 1,
    rn: 1,
    rm: 0,
    shift: "lsl",
    amount: 0,
    setFlags: false,
  });
  s.constant(2, protection);
  s.call(symbols.protect);
  compareZero(s, 0, 32);
  reject("ne");
}
/** writeExecutableMemory after the window checks: x0 = address, x1 =
 * capacity, x2 = offset, x3 = the bytes, x10 = their length (all
 * validated and aligned). Copies through the writable view, then reads the
 * executable view back: a page a debugger copied on write (to plant a
 * breakpoint) no longer shows the file, so the copy is repeated there under
 * a temporary read/write (never executable) protection. Finishes with the
 * instruction-cache sequence and leaves x0 = 0; failures call `reject`.
 * Scratch words: 0 the executable destination, 1 the bytes, 2 the length,
 * 3 the writable destination and then the first granule to reprotect. */
export function emitDualMappingWrite(
  s: InlineSequence,
  symbols: DualMappingSymbols,
  reject: (condition: "ne" | "hi") => void,
): void {
  emitDualMappingLookup(s, reject);
  add(s, 13, 13, 2);
  s.store(13, 3);
  add(s, 0, 0, 2);
  s.store(0, 0);
  s.store(3, 1);
  s.store(10, 2);
  for (let pass = 0; pass < 2; pass++) {
    const repair = pass === 1;
    s.load(0, repair ? 0 : 3);
    s.load(1, 1);
    s.load(2, 2);
    s.call(symbols.move);
    if (repair) {
      protectWritten(s, symbols, 5, reject);
      break;
    }
    s.load(0, 0);
    s.load(1, 1);
    s.load(2, 2);
    s.call(symbols.compare);
    compareZero(s, 0, 32);
    s.branch("visible", "eq");
    s.load(0, 0);
    granuleFloor(s, 0, 0);
    s.store(0, 3);
    protectWritten(s, symbols, 3, reject);
  }
  s.label("visible");
  s.load(0, 0);
  s.load(1, 2);
  for (const instruction of instructionCacheSync()) {
    if (instruction === undefined) throw "cache sync invariant";
    s.emit(instruction);
  }
  s.constant(0, 0);
}

/** Makes `length` bytes just written visible to instruction fetch at the
 * executable view: x0 = executable start, x1 = length (> 0). Data caches
 * behave as physically indexed, so cleaning by the executable alias also
 * cleans what the writable view stored. The architectural sequence (Arm ARM
 * B2.4.4, as libgcc's __aarch64_sync_cache_range): clean each data line to
 * the point of unification, DSB ISH, invalidate each instruction line, DSB
 * ISH, ISB. Line sizes come from CTR_EL0 (Linux traps and emulates EL0
 * reads where needed); CTR_EL0.IDC/DIC skip the loops the hardware makes
 * unnecessary. The ISB synchronizes only this thread: the publication
 * contract already excludes execution of the written range elsewhere.
 * Clobbers x9-x14 and flags. */
export function instructionCacheSync(): readonly Instruction[] {
  const code: Instruction[] = [];
  const emit = (instruction: Instruction): void => {
    code.push(instruction);
  };
  emit({ op: "mrs-ctr", rt: 9 });
  for (let pass = 0; pass < 2; pass++) {
    const instructions = pass === 1;
    // Skip the loop when CTR_EL0.IDC (bit 28) / DIC (bit 29) is set.
    const bit = instructions ? 29 : 28;
    emit({ op: "ubfm", width: 64, rd: 10, rn: 9, immr: bit, imms: bit });
    const skip = code.length;
    emit({ op: "cbnz", width: 64, rt: 10, displacement: 0 });
    // line = 4 << CTR_EL0.IminLine (bits 3:0) / DminLine (bits 19:16).
    const field = instructions ? 0 : 16;
    emit({
      op: "ubfm",
      width: 64,
      rd: 10,
      rn: 9,
      immr: field,
      imms: field + 3,
    });
    emit({ op: "movz", width: 64, rd: 11, immediate: 4, shift: 0 });
    emit({ op: "lslv", width: 64, rd: 11, rn: 11, rm: 10 });
    // x13 = start rounded down to a line, x14 = end.
    emit({
      op: "sub-imm",
      width: 64,
      rd: 12,
      rn: 11,
      immediate: 1,
      shift: 0,
      setFlags: false,
    });
    emit({ op: "orn-reg", width: 64, rd: 12, rn: "zr", rm: 12 });
    emit({ op: "and-reg", width: 64, rd: 13, rn: 0, rm: 12 });
    emit({
      op: "add-reg",
      width: 64,
      rd: 14,
      rn: 0,
      rm: 1,
      shift: "lsl",
      amount: 0,
      setFlags: false,
    });
    const loop = code.length;
    if (instructions) emit({ op: "ic-ivau", rt: 13 });
    else emit({ op: "dc-cvau", rt: 13 });
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
      op: "sub-reg",
      width: 64,
      rd: "zr",
      rn: 13,
      rm: 14,
      shift: "lsl",
      amount: 0,
      setFlags: true,
    });
    emit({
      op: "b.cond",
      condition: "cc",
      displacement: (loop - code.length) * 4,
    });
    if (instructions) emit({ op: "dsb", domain: "ish" });
    code[skip] = {
      op: "cbnz",
      width: 64,
      rt: 10,
      displacement: (code.length - skip) * 4,
    };
    // The data barrier also follows an IDC skip: prior stores must be
    // complete before instruction fetch can observe them.
    if (!instructions) emit({ op: "dsb", domain: "ish" });
  }
  emit({ op: "isb" });
  return code;
}
