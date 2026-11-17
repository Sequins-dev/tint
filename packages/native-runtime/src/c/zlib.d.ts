declare module "tint:c/zlib" {
  // zlib (<zlib.h>), loaded from /usr/lib/libz.1.dylib on Darwin through the
  // C library manifest (docs/native-ffi.md). zlib keeps `strm->state->strm
  // == strm` and retains next_in/next_out across calls, so streams and
  // their windows live in external storage (tint:ffi).
  import type { i32, u32, u64, u8, char, Ptr, Address, Layout } from "tint:ffi";
  type uInt = u32;
  type uLong = u64;
  export interface z_stream {
    next_in: Address<u8>;
    avail_in: uInt;
    total_in: uLong;
    next_out: Address<u8>;
    avail_out: uInt;
    total_out: uLong;
    msg: Address<char>;
    state: Address<void>;
    zalloc: Address<void>;
    zfree: Address<void>;
    opaque: Address<void>;
    data_type: i32;
    adler: uLong;
    reserved: uLong;
  }
  export const z_stream: Layout<z_stream>;
  /** The library's version string (passed back to the init functions). */
  export function zlibVersion(): Address<char>;
  export function deflateInit2_(
    strm: Ptr<z_stream>,
    level: i32,
    method: i32,
    windowBits: i32,
    memLevel: i32,
    strategy: i32,
    version: Address<char>,
    stream_size: i32,
  ): i32;
  export function deflate(strm: Ptr<z_stream>, flush: i32): i32;
  export function deflateEnd(strm: Ptr<z_stream>): i32;
  export function inflateInit2_(
    strm: Ptr<z_stream>,
    windowBits: i32,
    version: Address<char>,
    stream_size: i32,
  ): i32;
  export function inflate(strm: Ptr<z_stream>, flush: i32): i32;
  export function inflateReset(strm: Ptr<z_stream>): i32;
  export function inflateEnd(strm: Ptr<z_stream>): i32;
}
