import { cpus } from "node:os";

type CpuTimes = { idle: number; total: number };

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
