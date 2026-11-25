// Typed main entry for the typed shared-memory Worker fixture: the main
// isolate and two Workers add to counters in a typed SharedArrayBuffer
// concurrently. `run` returns 42 at once; each later check throws, which
// fails the program on both hosts.
import { Worker } from "node:worker_threads";

function check(condition: boolean, message: string): void {
  if (!condition) throw new TypeError(message);
}

export function run(peer: string): number {
  const rounds = 20000,
    workers = 2;
  const buffer = new SharedArrayBuffer(16);
  // A view of the buffer: posting either the view or the buffer itself shares
  // the underlying block across Workers.
  const counters = new Uint32Array(buffer, 4, 2);
  let replies = 0;
  for (let index = 0; index < workers; index++) {
    const worker = new Worker(peer, { workerData: rounds });
    worker.on("message", (value: unknown): void => {
      check(value === "done", "unexpected reply");
      replies++;
      if (replies === workers) {
        const total = Atomics.load(counters, 0);
        check(total === (workers + 1) * rounds, "lost adds: " + String(total));
        check(Atomics.load(counters, 1) === workers, "arrivals");
        // The Workers wrote the buffer's own bytes.
        check(new Uint8Array(buffer)[8] === workers, "shared bytes");
        // Worker 0 received the SharedArrayBuffer directly and stamped byte 12.
        check(new Uint8Array(buffer)[12] === 99, "shared buffer direct write");
      }
    });
    // Worker 0 receives the SharedArrayBuffer itself; Worker 1 receives a view.
    if (index === 0) worker.postMessage(buffer);
    else worker.postMessage(counters);
  }
  // The main isolate adds while the Workers do.
  for (let round = 0; round < rounds; round++) Atomics.add(counters, 0, 1);
  return 42;
}
