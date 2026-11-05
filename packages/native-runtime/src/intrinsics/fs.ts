/** Compiler-authorized leaves. Node bootstrap compiles these bodies but does not
 * execute them. NativeHostBinding replaces each verified signature in IR. */
export function openRead(path: Uint8Array): number {
  throw "HOST_UNAVAILABLE";
}
export function openExclusive(path: Uint8Array, mode: number): number {
  throw "HOST_UNAVAILABLE";
}
export function read(fd: number, buffer: Uint8Array): number {
  throw "HOST_UNAVAILABLE";
}
export function write(fd: number, buffer: Uint8Array): number {
  throw "HOST_UNAVAILABLE";
}
export function close(fd: number): number {
  throw "HOST_UNAVAILABLE";
}
export function chmod(fd: number, mode: number): number {
  throw "HOST_UNAVAILABLE";
}
export function rename(from: Uint8Array, to: Uint8Array): number {
  throw "HOST_UNAVAILABLE";
}
export function unlink(path: Uint8Array): number {
  throw "HOST_UNAVAILABLE";
}

/** Returns the number of target bytes written, without a trailing NUL. */
export function readlink(path: Uint8Array, destination: Uint8Array): number {
  throw "HOST_UNAVAILABLE";
}
