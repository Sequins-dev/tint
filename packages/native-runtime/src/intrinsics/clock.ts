/** Monotonic milliseconds from a caller-authorized native clock binding.
 * Absolute values are opaque; only differences within one process are meaningful. */
export function monotonicMilliseconds(): number {
  throw "HOST_UNAVAILABLE";
}

/** Milliseconds since the Unix epoch from an explicit wall-clock host binding.
 * Unlike monotonic time this can jump when the system clock is adjusted. */
export function wallClockMilliseconds(): number {
  throw "HOST_UNAVAILABLE";
}
