declare module "tint:c/dl" {
  // Dynamic loading (dlfcn.h) and the universal trampoline's call frame
  // (docs/native-ffi.md, "Dynamic calls"): libSystem on Darwin, glibc
  // (libc.so.6, which holds dlopen since 2.34) on Linux.
  import type {
    ByTarget,
    i8,
    i16,
    i32,
    i64,
    u8,
    u16,
    u32,
    u64,
    f32,
    f64,
    char,
    Address,
    CString,
    FixedArray,
    Layout,
    Union,
  } from "tint:ffi";
  /** dlfcn.h mode bits. */
  export const RTLD_LAZY: 1;
  export const RTLD_NOW: 2;
  export const RTLD_LOCAL: ByTarget<{ "darwin-arm64": 4; "linux-arm64": 0 }>;
  export const RTLD_GLOBAL: ByTarget<{
    "darwin-arm64": 8;
    "linux-arm64": 0x100;
  }>;
  /** The C ABI the image was built for: 0 Apple arm64, 1 AAPCS64 (Linux). */
  export const TARGET_AAPCS64: ByTarget<{
    "darwin-arm64": 0;
    "linux-arm64": 1;
  }>;
  /** A library handle or symbol address as its exact 64-bit word, passed
   * and returned exactly like the pointer it is (one X register): Darwin's
   * dlopen(NULL) handle has high bits set, which no number holds. */
  export interface Handle {
    low: u32;
    high: u32;
  }
  /** A handle, or {0, 0} (the reason is dlerror's). */
  export function dlopen(path: CString, mode: i32): Handle;
  /** dlopen(NULL, mode): the main program and its loaded libraries. */
  export function dlopen$self(path: Address<char>, mode: i32): Handle;
  export function dlsym(handle: Handle, name: CString): Handle;
  export function dlclose(handle: Handle): i32;
  /** pthread.h: sets the calling thread's value of `key` (callback state
   * blocks; docs/native-ffi.md, "Callbacks"). pthread_key_t is unsigned
   * long on Darwin and unsigned int in glibc. */
  export function pthread_setspecific(
    key: ByTarget<{ "darwin-arm64": u64; "linux-arm64": u32 }>,
    value: Address<void>,
  ): i32;
  /** The last dlfcn error's text (C-owned, cleared by the call), or 0. */
  export function dlerror(): Address<char>;
  /** One 64-bit register or stack word, by type. */
  export interface Word extends Union {
    u: u64;
    i: i64;
    d: f64;
    s: f32;
    address: Address<void>;
    halves: WordHalves;
    bytes: FixedArray<u8, 8>;
  }
  export interface WordHalves {
    low: u32;
    high: u32;
  }
  /** The universal trampoline's call frame (dynamicCallFrame in
   * @tint/ir/scalar; a test checks the two agree). */
  export interface DynamicFrame {
    x: FixedArray<Word, 8>;
    d: FixedArray<Word, 8>;
    x8: Word;
    stackBytes: u64;
    patchCount: u64;
    /** The frame, the 8 byte operands, then 4 universal callback thunks
     * (may-callback calls). */
    bases: FixedArray<Address<void>, 13>;
    /** Patch k: frame word patchTargets[k] = bases[patchBases[k]] +
     * patchAddends[k]. */
    patchTargets: FixedArray<u64, 16>;
    patchBases: FixedArray<u64, 16>;
    patchAddends: FixedArray<i64, 16>;
    stack: FixedArray<u8, 512>;
    scratch: FixedArray<u8, 512>;
  }
  export const DynamicFrame: Layout<DynamicFrame>;
  /** A scalar of any C type, converted through one 8-byte cell. */
  export interface Cell extends Union {
    i8: i8;
    u8: u8;
    i16: i16;
    u16: u16;
    i32: i32;
    u32: u32;
    i64: i64;
    u64: u64;
    f32: f32;
    f64: f64;
    address: Address<void>;
    halves: WordHalves;
    bytes: FixedArray<u8, 8>;
  }
  export const Cell: Layout<Cell>;
}
