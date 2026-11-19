/** Caller-authorized startup capabilities. Argument bytes exclude the NUL.
 * Index/buffer failures return -1. Bootstrap Node never executes these leaves. */
export function argumentCount(): number {
  throw "HOST_UNAVAILABLE";
}
export function argumentByteLength(index: number): number {
  throw "HOST_UNAVAILABLE";
}
export function copyArgument(index: number, destination: Uint8Array): number {
  throw "HOST_UNAVAILABLE";
}
/** The operating system this image was compiled for: a nativeTargetOS* code
 * of @tint/abi/host that code generation fixes from the build target (the
 * `target-os` host operation); nothing is probed at run time. */
export function targetOperatingSystem(): number {
  throw "HOST_UNAVAILABLE";
}

/** Compile-time architecture code (nativeTargetArch* in @tint/abi/host). */
export function targetArchitecture(): number {
  throw "HOST_UNAVAILABLE";
}
/** Copy an environment value as bytes, excluding its trailing NUL. The key
 * is a NUL-terminated UTF-8 byte array. Missing keys or short buffers return
 * -1 without touching the destination. */
export function copyEnvironment(
  key: Uint8Array,
  destination: Uint8Array,
): number {
  throw "HOST_UNAVAILABLE";
}
