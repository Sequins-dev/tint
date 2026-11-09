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
  readonly parking?: {
    readonly kind: "darwin-ulock";
    readonly waitSymbol: string;
    readonly wakeSymbol: string;
    readonly compareOperation: number;
    readonly noErrnoFlag: number;
    readonly wakeAllFlag: number;
  };
  readonly symbolPrefix: string;
  readonly errnoSymbol: string;
  readonly readFlags: number;
  readonly exclusiveFlags: number;
  readonly creationModeOnStack: boolean;
  readonly anonymousPrivateFlags: number;
  readonly clockNanosecondsSymbol: string;
  readonly monotonicClockId: number;
  readonly wallClockId: number;
  /** OS entropy provider returning an unsigned 32-bit word. */
  readonly randomWordSymbol: string;
}
