import { cpus } from "node:os";
import { isMainThread, workerData } from "node:worker_threads";

type CpuTimes = { idle: number; total: number };

export const idleThreshold = 95;
export const idleMonitor = {
  lifecycle: 0,
  stop: 1,
  count: 2,
  busy: 3,
  samples: 4,
} as const;

export function cpuTimes(): CpuTimes {
  let idle = 0,
    total = 0;
  for (const { times } of cpus()) {
    idle += times.idle;
    total += times.idle + times.user + times.nice + times.sys + times.irq;
  }
  return { idle, total };
}

export function cpuIdlePercent(before: CpuTimes, after: CpuTimes): number {
  const elapsed = after.total - before.total;
  const idle = after.idle - before.idle;
  if (elapsed <= 0 || idle < 0 || idle > elapsed)
    throw Error("invalid CPU time sample");
  return (idle * 100) / elapsed;
}

if (!isMainThread) {
  // State slots hold ready/done, stop, sample count, and below-threshold flag.
  // The following slots store idle percentages in hundredths.
  const state = new Int32Array(workerData as SharedArrayBuffer);
  let before = cpuTimes();
  Atomics.store(state, idleMonitor.lifecycle, 1);
  Atomics.notify(state, idleMonitor.lifecycle);
  for (let index = idleMonitor.samples; index < state.length; index++) {
    // A complete final interval also covers the final native launch.
    const count = index - idleMonitor.samples;
    Atomics.wait(state, idleMonitor.count, count, 1000);
    const after = cpuTimes();
    const idle = Math.floor(cpuIdlePercent(before, after) * 100);
    Atomics.store(state, index, idle);
    Atomics.store(state, idleMonitor.count, count + 1);
    if (idle <= idleThreshold * 100) Atomics.store(state, idleMonitor.busy, 1);
    if (Atomics.load(state, idleMonitor.stop) !== 0) break;
    before = after;
  }
  Atomics.store(state, idleMonitor.lifecycle, 2);
  Atomics.notify(state, idleMonitor.lifecycle);
}
