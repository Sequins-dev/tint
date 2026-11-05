/** Trusted normal-memory leaves. The caller proves a live owned mapping and
 * supplies its full authorized byte extent. These are never Script capabilities.
 * All numeric inputs must be nonnegative exact safe integers; base is nonzero.
 * Accesses must fit, be naturally aligned and end in the exact address domain.
 * order is 0 (unordered) or 1 (seq-cst); no reads may be elided or coalesced.
 * Status is 0 or -1; unsigned reads return uint32 or disjoint -1 on invalid input.
 * Leaves allocate nothing, invoke no callbacks and touch no runtime context. */
export function readSharedUnsigned(
  address: number,
  byteLength: number,
  offset: number,
  width: number,
  order: number,
): number {
  throw "HOST_UNAVAILABLE";
}
export function writeSharedUnsigned(
  address: number,
  byteLength: number,
  offset: number,
  width: number,
  value: number,
  order: number,
): number {
  throw "HOST_UNAVAILABLE";
}
/** scratch must be a live, exclusively caller-owned Uint32Array with at least two
 * elements, disjoint from the payload word. Its data is untouched on failure.
 * Capture one whole 64-bit payload, then write lo/hi into scratch[0]/scratch[1]. */
export function readSharedWord64(
  address: number,
  byteLength: number,
  offset: number,
  order: number,
  scratch: Uint32Array,
): number {
  throw "HOST_UNAVAILABLE";
}
/** lo and hi are exact uint32 halves, assembled before one 64-bit store. */
export function writeSharedWord64(
  address: number,
  byteLength: number,
  offset: number,
  order: number,
  lo: number,
  hi: number,
): number {
  throw "HOST_UNAVAILABLE";
}
/** Seq-cst 64-bit compare/exchange, including mismatch/equal replacement. Return
 * the observed word through scratch, with the same contract as readSharedWord64.
 * 0 means a valid operation, not necessarily a successful exchange: compare both
 * observed halves against expected to decide. Payloads never pass through Number. */
export function compareExchangeSharedWord64(
  address: number,
  byteLength: number,
  offset: number,
  expectedLo: number,
  expectedHi: number,
  replacementLo: number,
  replacementHi: number,
  scratch: Uint32Array,
): number {
  throw "HOST_UNAVAILABLE";
}

/** Seq-cst compare/exchange of exactly 1, 2 or 4 bytes, naturally aligned.
 * expected and replacement must be exact unsigned integers fitting that width.
 * Returns the observed unsigned value, or disjoint -1 for invalid arguments.
 * Mismatch clears the exclusive reservation; equal replacement still performs
 * an RMW. No scratch or containing-word access, allocation or callbacks. */
export function compareExchangeSharedUnsigned(
  address: number,
  byteLength: number,
  offset: number,
  width: number,
  expected: number,
  replacement: number,
): number {
  throw "HOST_UNAVAILABLE";
}
