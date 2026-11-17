declare module "tint:c/memory" {
  // Raw memory services of the C library behind `tint:ffi` external storage
  // (docs/native-ffi.md). Darwin resolves them through libSystem, Linux
  // through glibc (libc.so.6).
  import type {
    ByTarget,
    i32,
    i64,
    isize,
    usize,
    u8,
    char,
    Ptr,
    Address,
    OrErrno,
  } from "tint:ffi";
  /** sys/mman.h protections and flags. Only MAP_ANONYMOUS differs
   * (Darwin's MAP_ANON is 0x1000; asm-generic/mman-common.h has 0x20). */
  export const PROT_NONE: 0;
  export const PROT_READ: 1;
  export const PROT_WRITE: 2;
  export const MAP_PRIVATE: 2;
  export const MAP_ANONYMOUS: ByTarget<{
    "darwin-arm64": 0x1000;
    "linux-arm64": 0x20;
  }>;
  /** unistd.h: the kernel's page size (16 KiB on Apple arm64; 4, 16 or
   * 64 KiB on Linux arm64). */
  export function getpagesize(): i32;
  /** sys/mman.h: the mapping's address, or -errno (MAP_FAILED). */
  export function mmap(
    address: Address<u8>,
    length: usize,
    protection: i32,
    flags: i32,
    descriptor: i32,
    offset: i64,
  ): OrErrno<isize>;
  export function munmap(address: Address<u8>, length: usize): OrErrno<i32>;
  /** string.h */
  export function strlen(text: Address<char>): usize;
  /** Copies out of C memory, into it, and between byte views. */
  export function memcpy(
    destination: Ptr<u8>,
    source: Address<u8>,
    count: usize,
  ): void;
  export function memcpy$into(
    destination: Address<u8>,
    source: Ptr<u8>,
    count: usize,
  ): void;
  export function memcpy$bytes(
    destination: Ptr<u8>,
    source: Ptr<u8>,
    count: usize,
  ): void;
}
