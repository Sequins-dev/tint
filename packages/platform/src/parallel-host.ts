import type { NativeReactor } from "@tint/native-runtime/event-loop";
import type { NativeWorkerThreadHost } from "@tint/native-runtime/workers";

/** Target-selected native OS capabilities for parallel compiler workers. */
export interface ParallelPlatformHost {
  createReactor(): NativeReactor;
  createWorkerThreadHost(): NativeWorkerThreadHost;
  /** Current process resident set size in bytes, or 0 when unavailable. */
  residentSetBytes(): number;
}

/** Targets without native worker C bindings resolve to this stub. */
export function createParallelPlatformHost(): ParallelPlatformHost | undefined {
  return undefined;
}
