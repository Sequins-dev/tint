import type { PosixHostFacts } from "@tint/abi/host";

/** Linux executable arenas (host ABI `linux-dual-mapping`): one address
 * reservation holds a read-only header page, then the read/execute view
 * (the address `mapExecutableMemory` returns) and the read/write view of
 * the same memory-file pages, each `size` bytes (the request rounded up to
 * the granule). No page is writable and executable at once. The views
 * start on a granule boundary even where the kernel's pages are smaller
 * (the reservation has a granule of slack), so the granules a write
 * reprotects never reach past its arena's executable view.
 *
 *     reservation: [slack | header | read/execute view | read/write view | slack]
 *
 * Kernels that refuse executable memory files (vm.memfd_noexec=2 on Linux
 * 6.3+: memfd_create fails with EACCES) get a single mapping instead: the
 * executable view is anonymous memory, the header names it as its own
 * writable view, the read/write range stays an unused reservation, and
 * every write makes the granules it spans read/write (never executable),
 * copies, and makes them read/execute again. Systems that forbid making
 * once-writable memory executable (PaX MPROTECT) refuse that protection
 * change, so the write fails.
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
/** The whole reservation's address; its length is two granules (header
 * and slack) plus both views. */
export const dualMappingHeaderReservationOffset = 32;
/** Largest request: keeps the reservation (two granules plus two views) exact
 * in a double and far below the 48-bit user address space. */
export const dualMappingMaximumBytes = 1099511627776;
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
  readonly executableFile: number;
  /** MAP_PRIVATE | MAP_ANONYMOUS (the single-mapping fallback's view). */
  readonly anonymous: number;
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
export function dualMappingOf(host: PosixHostFacts): DualMapping | undefined {
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
      executableFile: memory.executableFileFlag,
      anonymous: host.anonymousPrivateFlags,
      shared: memory.sharedFlag,
      private: memory.privateFlag,
      fixed,
      reservation: memory.reservationFlags,
    },
  };
}
