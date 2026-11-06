/** Hosted contexts reserve the last word for an opaque process-local domain.
 * The issuer retains a dedicated identity mapping permanently, even after heap
 * teardown, so virtual-address reuse cannot make stale code match a new heap.
 * Realms within one context share this token; it is not an agent identifier. */
export const nativeContextDomainOffset = 72;
export const nativeHostedContextByteLength = 80;

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
