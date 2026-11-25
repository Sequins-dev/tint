import type { BindingSpec } from "../spec.ts";

/** Dynamic loading and the universal trampoline's call frame. */
export default {
  library: "dl",
  summary: [
    "Dynamic loading (dlfcn.h), the universal trampoline's call frame and",
    "the callback state key (pthread_setspecific)",
    '(docs/native-ffi.md, "Dynamic calls"): libSystem on Darwin, glibc',
    "(libc.so.6, which holds dlopen since 2.34) on Linux.",
  ],
  targets: ["darwin-arm64", "linux-arm64"],
  linuxX86_64: { constants: { TARGET_AAPCS64: "2" } },
  headers: ["dlfcn.h", "pthread.h", "stdint.h"],
  // Records Tint defines: a handle as its two 32-bit halves (Darwin's
  // dlopen(NULL) handle has high bits set, which no number holds), and the
  // trampoline's frame (dynamicCallFrame in @tint/ir/scalar).
  prelude: `
#ifdef __APPLE__
#define TARGET_AAPCS64 0
#else
#define TARGET_AAPCS64 1
#endif
struct Handle { uint32_t low; uint32_t high; };
struct WordHalves { uint32_t low; uint32_t high; };
union Word {
  uint64_t u; int64_t i; double d; float s; void *address;
  struct WordHalves halves; uint8_t bytes[8];
};
struct DynamicFrame {
  union Word x[8]; union Word d[8]; union Word x8;
  uint64_t stackBytes; uint64_t patchCount; void *bases[13];
  uint64_t patchTargets[16]; uint64_t patchBases[16]; int64_t patchAddends[16];
  uint8_t stack[512]; uint8_t scratch[512];
};
struct DynamicScalarFrame {
  union Word x[8]; union Word d[8];
  uint64_t stackBytes; struct Handle target;
};
union Cell {
  int8_t i8; uint8_t u8; int16_t i16; uint16_t u16; int32_t i32; uint32_t u32;
  int64_t i64; uint64_t u64; float f32; double f64; void *address;
  struct WordHalves halves; uint8_t bytes[8];
};
`,
  constants: [
    "RTLD_LAZY",
    "RTLD_NOW",
    "RTLD_LOCAL",
    "RTLD_GLOBAL",
    "TARGET_AAPCS64",
  ],
  records: [
    {
      name: "Handle",
      layout: false,
      doc: "A library handle or symbol address as its exact 64-bit word, passed and returned exactly like the pointer it is (one X register).",
    },
    {
      name: "Word",
      layout: false,
      doc: "One 64-bit register or stack word, by type.",
    },
    { name: "WordHalves", layout: false },
    {
      name: "DynamicFrame",
      doc: "The universal trampoline's call frame (dynamicCallFrame in @tint/ir/scalar; a test checks the two agree).",
    },
    {
      name: "DynamicScalarFrame",
      doc: "The growable scalar trampoline's header, followed by stack words.",
    },
    {
      name: "Cell",
      doc: "A scalar of any C type, converted through one 8-byte cell.",
    },
  ],
  functions: [
    {
      name: "dlopen",
      parameters: { 0: { name: "path" }, 1: { name: "mode" } },
      result: { record: "Handle" },
      doc: "A handle, or {0, 0} (the reason is dlerror's).",
    },
    {
      name: "dlopen",
      variant: "self",
      parameters: { 0: { name: "path", as: "Address" }, 1: { name: "mode" } },
      result: { record: "Handle" },
      doc: "dlopen(NULL, mode): the main program and its loaded libraries.",
    },
    {
      name: "dlsym",
      parameters: {
        0: { name: "handle", record: "Handle" },
        1: { name: "name" },
      },
      result: { record: "Handle" },
    },
    {
      name: "dlclose",
      parameters: { 0: { name: "handle", record: "Handle" } },
    },
    {
      name: "dlerror",
      doc: "The last dlfcn error's text (C-owned, cleared by the call), or 0.",
    },
    {
      name: "pthread_setspecific",
      parameters: { 0: { name: "key" }, 1: { name: "value", as: "Address" } },
      doc: 'Sets the calling thread\'s value of `key` (callback state blocks; docs/native-ffi.md, "Callbacks").',
    },
  ],
} satisfies BindingSpec;
