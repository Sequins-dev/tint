import type { CTarget } from "./c/types.ts";
/** Hosted contexts reserve the last word for an opaque process-local domain.
 * The issuer retains a dedicated identity mapping permanently, even after heap
 * teardown, so virtual-address reuse cannot make stale code match a new heap.
 * Realms within one context share this token; it is not an agent identifier. */
export const nativeContextDomainOffset = 88;
export const nativeHostedContextByteLength = 96;
/** Lowest stack pointer a managed frame may establish: the stack's low guard
 * page plus headroom. A stack overflow saves it in the engine-throw word and
 * sets it to 0 (emergency mode: no check, the guard page is the last resort)
 * so the throw path can run; the first exception landing pad reached while
 * unwinding restores it. */
export const nativeStackLimitOffset = 72;
/** Saved stack limit while a stack overflow unwinds to its first landing pad
 * (emergency mode), else 0. It never identifies the thrown value. */
export const nativeEngineThrowOffset = 80;
/** A stack overflow throws the general value with tag 0 (undefined) and this
 * payload, and so do the allocators for a request that can never fit (the
 * engine-range-error host operation); JavaScript boundaries turn it into a
 * RangeError. Every other general undefined has payload 0: general values are
 * produced only by general-none (0, 0), general-null (4, 0) and general-wrap
 * (tags 1, 2, 3, 5), and general storage is only written from such values.
 * So no JavaScript value equals it, and it keeps its identity through
 * catches, rethrows and storage. It is
 * odd, so it is never an aligned address. Code that ignores the payload sees
 * undefined. Below 2^53 so codegen materializes it exactly. */
export const nativeStackOverflowPayload = 0x15_7ac6_0f10_4b21;
/** Upper bound on the headroom above the guard page (a quarter of smaller
 * stacks); the throw and conversion path must fit in it. */
export const nativeStackHeadroomBytes = 65536;
/** Stack a C callee may use (docs/native-ffi.md, "C stack headroom"): a
 * function containing c-calls requires this much stack below its frame
 * above the stack limit at entry (frames are fixed-size, so that is the
 * stack every call site sees), on top of the headroom below the limit.
 * Overflow throws the ordinary stack-overflow RangeError before C runs. */
export const nativeCStackReserveBytes = 65536;

/** Target policy for POSIX-shaped file and clock calls.
 * Constants, symbol names, variadic mode placement are target
 * facts; image format is separate. */
export interface PosixHostABI {
  /** Other hosts can add a different publication strategy without leaking Darwin
   * protection rules into the portable code-memory contract. */
  readonly executableMemory?: {
    readonly kind: "darwin-jit";
    readonly mappingFlags: number;
    readonly writeProtectSymbol: string;
    readonly instructionCacheSymbol: string;
  };
  /** Raw system-thread lifecycle. Entries obey the platform (void*) -> void*
   * ABI and must establish an isolated managed context before running Tint code.
   * No managed callback or object may be passed through this boundary. */
  readonly threads?: {
    readonly createSymbol: string;
    readonly joinSymbol: string;
  };
  /** Kernel compare-and-park/wake ABI. Callers own aligned raw 32-bit cells;
   * kernel wakeups are advisory, never ECMAScript waiter completion authority. */
  readonly parking?:
    | {
        readonly kind: "darwin-ulock";
        readonly waitSymbol: string;
        readonly wakeSymbol: string;
        readonly compareOperation: number;
        readonly noErrnoFlag: number;
        readonly wakeAllFlag: number;
      }
    | {
        /** futex(2) through the C library's variadic `syscall`: waits take
         * a relative timespec (none for an indefinite park); failures
         * report -errno like the Darwin statuses. */
        readonly kind: "linux-futex";
        readonly syscallSymbol: string;
        readonly futexSyscall: number;
        /** FUTEX_WAIT and FUTEX_WAKE with FUTEX_PRIVATE_FLAG: parked cells
         * are only shared between threads of one process. */
        readonly waitOperation: number;
        readonly wakeOperation: number;
      };
  /** How the kernel's process entry reaches the hosted entry, when the
   * image format does not call it as `main` (Mach-O's LC_MAIN does): an
   * ELF `_start` hands it to glibc's `__libc_start_main`. Startup first
   * rejects kernels whose page size exceeds `maximumPageBytes` (the
   * runtime's release granule), naming the problem on stderr. */
  readonly processStart?: {
    readonly kind: "glibc-start-main";
    readonly startMainSymbol: string;
    readonly pageSizeSymbol: string;
    readonly maximumPageBytes: number;
  };
  /** The target's C calling convention for foreign (c-call) calls; targets
   * without it cannot emit them. */
  readonly c?: CTarget;
  readonly symbolPrefix: string;
  readonly errnoSymbol: string;
  readonly readFlags: number;
  readonly exclusiveFlags: number;
  readonly creationModeOnStack: boolean;
  readonly anonymousPrivateFlags: number;
  /** MAP_FIXED: combined with anonymousPrivateFlags, a mapping over an
   * existing range replaces its pages with fresh zero pages, which releases
   * them immediately (madvise MADV_FREE does not lower RSS on Darwin).
   * Targets without it cannot emit memory-release. */
  readonly fixedMappingFlag?: number;
  /** `nanoseconds`: `symbol(clockId)` returns 64-bit nanoseconds
   * (Darwin's clock_gettime_nsec_np); `timespec`: POSIX
   * `symbol(clockId, &timespec)` fills seconds and nanoseconds. */
  readonly clock: {
    readonly kind: "nanoseconds" | "timespec";
    readonly symbol: string;
    readonly monotonicId: number;
    readonly wallId: number;
  };
  /** OS entropy: `word` returns an unsigned 32-bit word (arc4random);
   * `fill` fills a buffer as `symbol(buffer, length, 0)` and returns the
   * byte count (getrandom). */
  readonly random: {
    readonly kind: "word" | "fill";
    readonly symbol: string;
  };
  /** Opt-in runtime signposts (docs/runtime-diagnostics.md). */
  readonly signposts?: HostSignpostFacility;
}
/** How a target exposes runtime intervals to external tracers.
 * `darwin-os-signpost`: the main image's header, log-handle creation and an
 * os_signpost-style emitter whose name/format strings must lie in the
 * image's C-string section. `elf-usdt`: statically defined tracing probes
 * (`nop` sites described by `.note.stapsdt` notes of `provider`), which
 * perf, bpftrace and GDB attach to; no library call is involved. */
export type HostSignpostFacility =
  | {
      readonly kind: "darwin-os-signpost";
      readonly imageHeaderSymbol: string;
      readonly logCreateSymbol: string;
      readonly enabledSymbol: string;
      readonly emitSymbol: string;
    }
  | { readonly kind: "elf-usdt"; readonly provider: string };

/** Hosted context word 0: the permanent stack-map registry that collectors
 * walk the native stack with (layout: native-runtime tracing/scan.ts, which
 * repeats these constants). Each emitted module carries one safepoint table
 * per registered code range; startup registers the image's modules and JIT
 * publication registers each published module through its footer. */
export const nativeStackMapRegistryOffset = 0;
export const nativeStackMapMagic = 0x50414d53;
export const nativeStackMapVersion = 2;
/** Wide tables (emitted only when a packed table's map index would exceed
 * 2^21 words): two words per safepoint, its return offset then its map word
 * index, instead of one packed map index * 2^32 + offset word. */
export const nativeStackMapWideVersion = 3;
/** Registry: count, capacity, walk start, the walk start's save block of
 * x19..x28 (0: unknown); then entries of code start, code byte length and
 * table address (0: transparent frames). */
export const nativeStackMapRegistryHeaderBytes = 32;
export const nativeStackMapSaveBlockOffset = 24;
/** Map register word: bit i when the frame saves x(19 + i), bit
 * nativeStackMapRegisterShift + i when x(19 + i) holds a live reference. */
export const nativeStackMapRegisterShift = 10;
export const nativeStackMapRegistryEntryBytes = 24;
/** Table: magic, version, entry count, then one word per safepoint (two in
 * a wide table). */
export const nativeStackMapTableHeaderBytes = 24;
/** A module's last 16 bytes: this magic, then its table's byte offset. */
export const nativeStackMapFooterMagic = 0x544f4f46;
export const nativeStackMapFooterBytes = 16;

/** Managed object header: one word. Bits 0-47 hold the layout marker (1
 * string, 2-5 typed arrays of 1-, 2-, 4- and 8-byte elements, 6 reference
 * vector, 7 weak slot) or the address of a record or function descriptor;
 * bits 48-50 hold the kind flags (arrays: 0 owned, 1 borrowed, 2 view; weak
 * slots: 0 weak, 1 ephemeron). Records, functions, strings and vectors
 * always have flags 0, so their header equals the marker or descriptor.
 * Collectors reserve bit 51 (an evacuation in progress) and bit 52 (a
 * forwarded object: the low bits hold its destination). Every header is
 * below 2^53, so runtime code reads it exactly as a number. */
export const nativeHeaderByteLength = 8;
/** Kind flags start at this bit; also the marker bit width. */
export const nativeHeaderFlagsShift = 48;
/** One kind-flag unit: 2^48. A header is marker + flags * unit. */
export const nativeHeaderFlagUnit = 281474976710656;
/** Collector-only: an evacuation claimed this object (2^51). */
export const nativeHeaderClaimed = 2251799813685248;
/** Collector-only: forwarded to the destination in the low bits (2^52). */
export const nativeHeaderForwarded = 4503599627370496;
/** Strings: UTF-16 code-unit length, then the code units. */
export const nativeStringLengthOffset = 8;
export const nativeStringDataOffset = 16;
/** Typed arrays and reference vectors: element count (vectors: capacity),
 * then the data address (vectors: a reserved zero word); owned elements
 * follow inline. A view holds its owner after the data address. */
export const nativeArrayLengthOffset = 8;
export const nativeArrayDataOffset = 16;
export const nativeArrayInlineOffset = 24;
export const nativeArrayOwnerOffset = 24;
/** Extents of borrowed arrays and views. */
export const nativeArrayBorrowedByteLength = 24;
export const nativeArrayViewByteLength = 40;
