import type { BindingSpec } from "../spec.ts";

export default {
  library: "ffi-callbacks",
  summary: [
    "Thread identity and fatal exit for runtime-registered FFI callbacks",
  ],
  targets: ["darwin-arm64", "linux-arm64"],
  linuxX86_64: {},
  headers: ["pthread.h"],
  // The platform declaration of abort adds a noreturn attribute. Declare
  // its C calling convention so the oracle can inspect its prototype.
  prelude: "void abort(void);",
  functions: [{ name: "pthread_self" }, { name: "abort" }],
} satisfies BindingSpec;
