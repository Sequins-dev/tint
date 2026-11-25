import {
  createNativeBlockingPool,
  runNativeBlockingHelper,
} from "../blocking-pool.ts";
import type { ReactorEventLoop } from "../event-loop-reactor.ts";
import {
  hostedThreadEntry,
  joinNativeThread,
  startNativeThread,
} from "../intrinsics/memory.ts";
import {
  nativeSharedMemoryHost,
  nativeWaiterParkingHost,
} from "../shared-blocks.ts";
import {
  initializeCryptoJobs,
  performCryptoJob,
  type CryptoJobs,
} from "./crypto-jobs.ts";
export type { CryptoJobs } from "./crypto-jobs.ts";

export function createCryptoJobHost(events: ReactorEventLoop): CryptoJobs {
  const pool = createNativeBlockingPool(
    nativeSharedMemoryHost(),
    nativeWaiterParkingHost(),
    {
      entry: hostedThreadEntry(),
      wakeTarget: (): number => events.wakeTarget(),
      start: (entry: number, argument: number): number =>
        startNativeThread(entry, argument),
      join: (handle: number): number => joinNativeThread(handle),
    },
    4,
    65536,
  );
  return initializeCryptoJobs(events.loop, pool);
}

export function runCryptoBlockingHelper(
  address: number,
  signal: (owner: number) => void,
): number {
  return runNativeBlockingHelper(
    nativeSharedMemoryHost(),
    nativeWaiterParkingHost(),
    address,
    performCryptoJob,
    signal,
  );
}
