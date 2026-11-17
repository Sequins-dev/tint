declare module "tint:c/libsystem" {
  // POSIX calls the runtime binds as leaf c-calls (docs/native-ffi.md):
  // libSystem on Darwin, glibc (libc.so.6) on Linux.
  import type {
    ByTarget,
    i32,
    u16,
    u32,
    CStringBytes,
    OrErrno,
  } from "tint:ffi";
  /** sys/types.h: 16 bits on Darwin, 32 bits in glibc. */
  type mode_t = ByTarget<{ "darwin-arm64": u16; "linux-arm64": u32 }>;
  /** unistd.h */
  export function getpid(): i32;
  export function close(fd: i32): OrErrno<i32>;
  export function unlink(path: CStringBytes): OrErrno<i32>;
  /** sys/stat.h */
  export function fchmod(fd: i32, mode: mode_t): OrErrno<i32>;
  /** stdio.h */
  export function rename(from: CStringBytes, to: CStringBytes): OrErrno<i32>;
}
