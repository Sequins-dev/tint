/** Trusted leaves for opt-in runtime diagnostics (docs/runtime-diagnostics.md);
 * the native compiler caller must authorize their HostOperation bindings.
 * Kept apart from the memory and process intrinsics so programs that do not
 * import them compile exactly as before. Node never runs these leaves. */

/** Copy bytes into a caller-owned raw writable window [address, address +
 * byteLength) at offset (no executable-memory protection changes). Returns 0,
 * or -1 for invalid bounds or inputs. */
export function writeMemoryBytes(
  address: number,
  byteLength: number,
  offset: number,
  bytes: Uint8Array,
): number {
  throw "HOST_UNAVAILABLE";
}
/** Address of the image's __jit_debug_descriptor (GDB/LLDB JIT interface;
 * images built with jitDebugInterface). */
export function jitDebugDescriptor(): number {
  throw "HOST_UNAVAILABLE";
}
/** Calls __jit_debug_register_code after the descriptor names an entry. */
export function notifyJitDebugger(): void {
  throw "HOST_UNAVAILABLE";
}
/** The operating-system process ID. */
export function processId(): number {
  throw "HOST_UNAVAILABLE";
}
