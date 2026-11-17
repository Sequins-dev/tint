/** Trusted external-storage primitives (docs/native-ffi.md, "External
 * storage"). Each declaration's body is replaced by one c-memory access
 * through an explicit NativeForeignMemoryBinding (see
 * `foreignRuntimeBindings` in the compiler); names alone grant nothing. */

/** Turn `empty`, an owned zero-length byte array, into an external view of
 * `byteLength` bytes at `address`, and return it. The caller owns the
 * memory and keeps it mapped while the view is reachable. */
export function adoptExternal(
  empty: Uint8Array,
  address: number,
  byteLength: number,
): Uint8Array {
  throw "HOST_UNAVAILABLE";
}
/** The data address of an external (borrowed) array, or -1 for any other
 * array: owned storage and views move with collections. */
export function externalAddress(view: Uint8Array): number {
  throw "HOST_UNAVAILABLE";
}
/** Point external view `view` at `address` (a released view moves to an
 * inaccessible guard at least as long as the view). */
export function retargetExternal(view: Uint8Array, address: number): void {
  throw "HOST_UNAVAILABLE";
}
