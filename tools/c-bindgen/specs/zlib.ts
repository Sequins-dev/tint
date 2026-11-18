import type { BindingSpec } from "../spec.ts";

/** zlib's stream codecs behind `node:zlib` (packages/native-runtime/src/node/zlib.ts). */
export default {
  library: "zlib",
  summary: [
    "zlib (<zlib.h>), loaded from /usr/lib/libz.1.dylib on Darwin and",
    "libz.so.1 on Linux through the C library manifest. zlib keeps",
    "`strm->state->strm == strm` and retains next_in/next_out across calls,",
    "so streams and their windows live in external storage (tint:ffi).",
  ],
  targets: ["darwin-arm64", "linux-arm64"],
  headers: ["zlib.h"],
  aliases: ["uInt", "uLong"],
  records: [
    {
      name: "z_stream",
      // The allocator hooks stay null (zlib's defaults) until Phase 4.
      opaque: ["zalloc", "zfree"],
    },
  ],
  functions: [
    {
      name: "zlibVersion",
      doc: "The library's version string (passed back to the init functions).",
    },
    {
      name: "deflateInit2_",
      parameters: { version: "Address" },
    },
    "deflate",
    "deflateEnd",
    {
      name: "inflateInit2_",
      parameters: { version: "Address" },
    },
    "inflate",
    "inflateReset",
    "inflateEnd",
  ],
} satisfies BindingSpec;
