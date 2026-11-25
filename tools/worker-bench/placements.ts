// Kernel placements in a program that uses Workers
// (docs/results/worker-runtime-baseline-v1.md): on the main thread beside an
// idle Worker, or inside a Worker that the main thread drives one iteration
// at a time and times through each reply (one small round trip per
// iteration).
import { Worker } from "node:worker_threads";
import { kernelNames } from "./kernels.ts";
import { kernelIterations, reportKernel, runKernelsInline } from "./inline.ts";

export function runKernelsBesideWorker(
  peer: string,
  now: () => number,
  expected: readonly number[],
  done: (status: number) => void,
): void {
  const worker = new Worker(peer, { workerData: "idle" });
  let status = 0;
  worker.once("message", (ready: unknown): void => {
    if (ready !== "ready") throw "idle Worker did not start";
    status = runKernelsInline("main", now, expected);
    worker.postMessage("stop");
  });
  worker.once("exit", (code: unknown): void => {
    done(code === 0 ? status : 2);
  });
}

export function runKernelsInWorker(
  peer: string,
  now: () => number,
  expected: readonly number[],
  done: (status: number) => void,
): void {
  const worker = new Worker(peer, { workerData: "kernels" });
  let kernel = 0,
    iteration = 0,
    start = 0,
    status = 42;
  function request(): void {
    const name = kernelNames[kernel];
    if (name === undefined) {
      worker.postMessage("stop");
      return;
    }
    start = now();
    worker.postMessage(name);
  }
  worker.on("message", (reply: unknown): void => {
    if (reply === "ready") {
      request();
      return;
    }
    const elapsed = now() - start;
    const name = kernelNames[kernel];
    if (name === undefined) throw "unexpected kernel reply";
    if (reply !== expected[kernel] || typeof reply !== "number") {
      if (status === 42) status = 10 + kernel;
    } else reportKernel("worker", name, iteration, elapsed, reply);
    iteration++;
    if (iteration > kernelIterations) {
      iteration = 0;
      kernel++;
    }
    request();
  });
  worker.once("exit", (code: unknown): void => {
    done(code === 0 ? status : 2);
  });
}
