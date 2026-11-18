import type { BindingSpec } from "../spec.ts";

/** Raw memory services behind `tint:ffi` external storage. */
export default {
  library: "memory",
  summary: [
    "Raw memory services of the C library behind `tint:ffi` external storage.",
    "Darwin resolves them through libSystem, Linux through glibc (libc.so.6).",
  ],
  targets: ["darwin-arm64", "linux-arm64"],
  headers: ["sys/mman.h", "unistd.h", "string.h"],
  constants: [
    "PROT_NONE",
    "PROT_READ",
    "PROT_WRITE",
    "MAP_PRIVATE",
    "MAP_ANONYMOUS",
  ],
  functions: [
    "getpagesize",
    {
      name: "mmap",
      parameters: {
        0: { name: "address", as: "Address" },
        1: { name: "length" },
        2: { name: "protection" },
        3: { name: "flags" },
        4: { name: "descriptor" },
        5: { name: "offset" },
      },
      result: "OrErrno",
      doc: "The mapping's address, or -errno (MAP_FAILED).",
    },
    {
      name: "munmap",
      parameters: {
        0: { name: "address", as: "Address" },
        1: { name: "length" },
      },
      result: "OrErrno",
    },
    { name: "strlen", parameters: { 0: { name: "text", as: "Address" } } },
    {
      name: "memcpy",
      parameters: {
        0: { name: "destination" },
        1: { name: "source", as: "Address" },
        2: { name: "count" },
      },
      result: "void",
      doc: "Copies out of C memory, into it, and between byte views.",
    },
    {
      name: "memcpy",
      variant: "into",
      parameters: {
        0: { name: "destination", as: "Address" },
        1: { name: "source", as: "Ptr" },
        2: { name: "count" },
      },
      result: "void",
    },
    {
      name: "memcpy",
      variant: "bytes",
      parameters: {
        0: { name: "destination" },
        1: { name: "source", as: "Ptr" },
        2: { name: "count" },
      },
      result: "void",
    },
  ],
} satisfies BindingSpec;
