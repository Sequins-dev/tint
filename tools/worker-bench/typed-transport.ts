// Typed transport workloads (docs/results/worker-runtime-baseline-v1.md): the
// runtime's messaging cost without the untyped await path. A typed main
// program drives a typed Worker entry with callbacks: small round trips,
// batches and 1 KiB string round trips. Typed code cannot create a
// SharedArrayBuffer yet (the program realm lacks the global), so shared
// memory stays in transport.mjs.
// Output lines match transport.mjs:
//   WORKER_BENCH {"operation":...,"count":...,"elapsed":ms}
import { Worker } from "node:worker_threads";

const samples = 3;

function measure(operation: string, count: number, elapsed: number): void {
  console.log(
    'WORKER_BENCH {"operation":"' +
      operation +
      '","count":' +
      String(count) +
      ',"elapsed":' +
      String(elapsed) +
      "}",
  );
}

/** Runs each phase in order; `done` receives 42 or a failure status. */
export function runTypedTransport(
  peer: string,
  now: () => number,
  done: (status: number) => void,
): void {
  const worker = new Worker(peer);
  let phase = 0,
    sample = -1,
    sent = 0,
    start = 0,
    status = 42;
  const text = "worker-message-".repeat(69).slice(0, 1024);
  function fail(code: number): void {
    if (status === 42) status = code;
    worker.postMessage("stop");
  }
  function next(): void {
    sample++;
    if (sample >= samples) {
      sample = -1;
      phase++;
      next();
      return;
    }
    sent = 0;
    start = now();
    if (phase === 0) worker.postMessage(0);
    else if (phase === 1) {
      worker.postMessage("batch");
      for (let i = 0; i < 10000; i++) worker.postMessage(i);
    } else if (phase === 2) worker.postMessage(text);
    else worker.postMessage("stop");
  }
  worker.on("message", (reply: unknown): void => {
    if (reply === "ready") {
      next();
      return;
    }
    if (phase === 0) {
      if (reply !== sent) return fail(2);
      sent++;
      if (sent < 1000) {
        worker.postMessage(sent);
        return;
      }
      if (sample >= 0) measure("typed-round-trip", 1000, now() - start);
    } else if (phase === 1) {
      if (reply !== 49995000) return fail(3);
      if (sample >= 0) measure("typed-batch", 10000, now() - start);
    } else if (phase === 2) {
      if (reply !== text) return fail(4);
      sent++;
      if (sent < 1000) {
        worker.postMessage(text);
        return;
      }
      if (sample >= 0) measure("typed-string-1KiB", 1000, now() - start);
    }
    next();
  });
  worker.once("exit", (code: unknown): void => {
    done(code === 0 ? status : 7);
  });
}
