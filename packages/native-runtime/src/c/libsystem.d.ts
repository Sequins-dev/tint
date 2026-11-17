declare module "tint:c/libsystem" {
  // libSystem (Darwin): POSIX calls the runtime binds as leaf c-calls
  // (docs/native-ffi.md). Linux targets will supply their own declarations.
  import type { i32, u16, CStringBytes, OrErrno } from "tint:ffi";
  /** unistd.h */
  export function getpid(): i32;
  export function close(fd: i32): OrErrno<i32>;
  export function unlink(path: CStringBytes): OrErrno<i32>;
  /** sys/stat.h (mode_t is u16 on Darwin). */
  export function fchmod(fd: i32, mode: u16): OrErrno<i32>;
  /** stdio.h */
  export function rename(from: CStringBytes, to: CStringBytes): OrErrno<i32>;
}
