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
