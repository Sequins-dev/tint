// Inline kernel driver shared by Node and the native images
// (docs/results/worker-runtime-baseline-v1.md). It imports no Worker API, so
// the program without Workers links none. Iteration 0 is the cold run; the
// remaining iterations are the steady state. Output lines:
//   WORKER_BENCH_KERNEL <placement> <kernel> <iteration> <ms> <checksum>
import { kernelNames, kernelScale, runKernel } from "./kernels.ts";

/** Steady iterations after the cold one. The in-Worker placement currently
 * takes about 30 s per pass over all kernels, which bounds this count. */
export const kernelIterations = 2;

export function reportKernel(
  placement: string,
  kernel: string,
  iteration: number,
  milliseconds: number,
  checksum: number,
): void {
  console.log(
    "WORKER_BENCH_KERNEL " +
      placement +
      " " +
      kernel +
      " " +
      String(iteration) +
      " " +
      String(milliseconds) +
      " " +
      String(checksum),
  );
}

/** Runs each named kernel on the calling thread. Returns 42, or 10 + the
 * index of the first kernel whose checksum differs from `expected`. */
export function runKernelList(
  placement: string,
  now: () => number,
  expected: readonly number[],
  names: readonly string[],
  scaleOf: (name: string) => number,
  run: (name: string, scale: number) => number,
): number {
  for (let k = 0; k < names.length; k++) {
    const name = names[k];
    if (name === undefined) throw "kernel name";
    const scale = scaleOf(name);
    for (let iteration = 0; iteration <= kernelIterations; iteration++) {
      const start = now();
      const checksum = run(name, scale);
      const elapsed = now() - start;
      if (checksum !== expected[k]) return 10 + k;
      reportKernel(placement, name, iteration, elapsed, checksum);
    }
  }
  return 42;
}

export function runKernelsInline(
  placement: string,
  now: () => number,
  expected: readonly number[],
): number {
  return runKernelList(
    placement,
    now,
    expected,
    kernelNames,
    (name: string): number => kernelScale(name),
    (name: string, scale: number): number => runKernel(name, scale),
  );
}
