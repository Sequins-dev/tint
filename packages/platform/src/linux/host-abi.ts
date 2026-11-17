import type { PosixHostABI } from "@tint/abi/host";
import { linuxArm64CTarget } from "@tint/abi/c";
/** glibc on Linux arm64 (docs/linux-aarch64-target.md). Constants are the
 * generic Linux values (asm-generic/fcntl.h, mman-common.h, errno-base.h;
 * futex.h; unistd.h syscall numbers for arm64). Executable memory (live
 * code publication) is not provided yet, so programs that publish native
 * code fail to compile for this target; so do runtime signposts. */
export function linuxHostABI(): PosixHostABI {
  return {
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
    },
    // Kernels may use 4, 16 or 64 KiB pages.
    pageSize: { kind: "query", symbol: "getpagesize" },
    // The affinity mask also reflects cpusets (taskset, container CPU
    // pinning); glibc's cpu_set_t covers 1024 CPUs.
    processors: {
      kind: "affinity",
      symbol: "sched_getaffinity",
      maskBytes: 128,
    },
    // getauxval(AT_HWCAP) & HWCAP_SHA2 (asm/hwcap.h).
    sha256Instructions: {
      kind: "hwcap",
      symbol: "getauxval",
      type: 16,
      mask: 64,
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
