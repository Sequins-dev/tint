import type { PosixHostABI } from "@tint/abi/host";
import { darwinArm64CTarget } from "@tint/abi/c";
export function darwinHostABI(): PosixHostABI {
  return {
    os: "darwin",
    executableMemory: {
      kind: "darwin-jit",
      mappingFlags: 0x1802,
      writeProtectSymbol: "_pthread_jit_write_protect_np",
      instructionCacheSymbol: "_sys_icache_invalidate",
    },
    threads: {
      createSymbol: "_pthread_create",
      joinSymbol: "_pthread_join",
    },
    parking: {
      kind: "darwin-ulock",
      waitSymbol: "___ulock_wait2",
      wakeSymbol: "___ulock_wake",
      compareOperation: 1,
      noErrnoFlag: 0x01000000,
      wakeAllFlag: 0x100,
    },
    pageSize: { kind: "fixed", bytes: 16384 },
    // sysconf(_SC_NPROCESSORS_ONLN).
    processors: { kind: "sysconf", symbol: "_sysconf", name: 58 },
    // Every Apple silicon core implements FEAT_SHA256.
    sha256Instructions: { kind: "baseline" },
    c: darwinArm64CTarget,
    symbolPrefix: "_",
    errnoSymbol: "___error",
    readFlags: 0,
    exclusiveFlags: 0xa01,
    creationModeOnStack: true,
    anonymousPrivateFlags: 0x1002,
    fixedMappingFlag: 0x10,
    clock: {
      kind: "nanoseconds",
      symbol: "_clock_gettime_nsec_np",
      monotonicId: 4,
      wallId: 0,
    },
    random: { kind: "word", symbol: "_arc4random" },
    signposts: {
      kind: "darwin-os-signpost",
      imageHeaderSymbol: "__dyld_get_image_header",
      logCreateSymbol: "_os_log_create",
      enabledSymbol: "_os_signpost_enabled",
      emitSymbol: "__os_signpost_emit_with_name_impl",
    },
  };
}
