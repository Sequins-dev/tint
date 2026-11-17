import type { PosixHostABI } from "@tint/abi/host";
import { linuxArm64CTarget } from "@tint/abi/c";
/** glibc on Linux arm64 (docs/linux-aarch64-target.md). Constants are the
 * generic Linux values (asm-generic/fcntl.h, mman-common.h, errno-base.h;
 * futex.h; unistd.h syscall numbers for arm64; memfd.h). Runtime
 * signposts are not provided, so programs requesting them fail to compile
 * for this target. */
export function linuxHostABI(): PosixHostABI {
  return {
    executableMemory: {
      kind: "linux-dual-mapping",
      memoryFileSymbol: "memfd_create",
      // MFD_CLOEXEC
      memoryFileFlags: 1,
      truncateSymbol: "ftruncate",
      protectSymbol: "mprotect",
      // MAP_SHARED, MAP_PRIVATE
      sharedFlag: 1,
      privateFlag: 2,
      // MAP_PRIVATE | MAP_ANONYMOUS | MAP_NORESERVE
      reservationFlags: 0x4022,
    },
    threads: {
      createSymbol: "pthread_create",
      joinSymbol: "pthread_join",
    },
    parking: {
      kind: "linux-futex",
      syscallSymbol: "syscall",
      futexSyscall: 98,
      waitOperation: 128,
      wakeOperation: 129,
    },
    processStart: {
      kind: "glibc-start-main",
      startMainSymbol: "__libc_start_main",
      pageSizeSymbol: "getpagesize",
      maximumPageBytes: 16384,
    },
    c: linuxArm64CTarget,
    symbolPrefix: "",
    errnoSymbol: "__errno_location",
    readFlags: 0,
    // O_WRONLY | O_CREAT | O_EXCL
    exclusiveFlags: 0xc1,
    // AAPCS64 passes variadic arguments like fixed ones.
    creationModeOnStack: false,
    // MAP_PRIVATE | MAP_ANONYMOUS
    anonymousPrivateFlags: 0x22,
    fixedMappingFlag: 0x10,
    clock: {
      kind: "timespec",
      symbol: "clock_gettime",
      monotonicId: 1,
      wallId: 0,
    },
    random: { kind: "fill", symbol: "getrandom" },
  };
}
