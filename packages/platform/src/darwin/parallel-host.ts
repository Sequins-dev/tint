import type { ParallelPlatformHost } from "../parallel-host.ts";
import { createNativeWorkerThreadHost } from "../workers.ts";
import { createReactor, residentSetBytes } from "./reactor.ts";

export function createParallelPlatformHost(): ParallelPlatformHost | undefined {
  return {
    createReactor,
    createWorkerThreadHost: createNativeWorkerThreadHost,
    residentSetBytes,
  };
}
