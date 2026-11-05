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
