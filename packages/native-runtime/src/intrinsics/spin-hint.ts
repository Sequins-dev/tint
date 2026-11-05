/** Trusted nonallocating CPU spin hint. Explicit native binding is required.
 * This is neither an OS scheduler yield nor a sleep/wait operation. */
export function cpuPause(): void {
  throw "HOST_UNAVAILABLE";
}
