import type { BindingSpec } from "../spec.ts";

/** POSIX calls the runtime binds as leaf c-calls (file operations). */
export default {
  library: "libsystem",
  summary: [
    "POSIX calls the runtime binds as leaf c-calls: libSystem on Darwin,",
    "glibc (libc.so.6) on Linux.",
  ],
  targets: ["darwin-arm64", "linux-arm64"],
  linuxX86_64: {},
  headers: ["unistd.h", "stdio.h", "sys/stat.h"],
  aliases: ["mode_t"],
  functions: [
    "getpid",
    {
      name: "getcwd",
      parameters: { 0: { name: "buffer", as: "Ptr" }, 1: { name: "length" } },
    },
    { name: "close", parameters: { 0: { name: "fd" } }, result: "OrErrno" },
    {
      name: "unlink",
      parameters: { 0: { name: "path", as: "CStringBytes" } },
      result: "OrErrno",
    },
    {
      name: "fchmod",
      parameters: { 0: { name: "fd" }, 1: { name: "mode" } },
      result: "OrErrno",
    },
    {
      name: "rename",
      parameters: {
        0: { name: "from", as: "CStringBytes" },
        1: { name: "to", as: "CStringBytes" },
      },
      result: "OrErrno",
    },
  ],
} satisfies BindingSpec;
