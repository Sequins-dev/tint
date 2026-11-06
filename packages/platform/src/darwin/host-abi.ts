import type { PosixHostABI } from "@tint/abi/host";
export function darwinHostABI(): PosixHostABI {
  return {
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
    symbolPrefix: "_",
    errnoSymbol: "___error",
    readFlags: 0,
    exclusiveFlags: 0xa01,
    creationModeOnStack: true,
    anonymousPrivateFlags: 0x1002,
    clockNanosecondsSymbol: "_clock_gettime_nsec_np",
    monotonicClockId: 4,
    wallClockId: 0,
    randomWordSymbol: "_arc4random",
  };
}
