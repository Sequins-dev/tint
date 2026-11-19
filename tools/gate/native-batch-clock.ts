import { readFileSync, statSync } from "node:fs";

/** Pause only when every registered test file worker is in the launch queue.
 * A helper subprocess, such as the JIT fixture builder, reports its owning
 * test worker so that its wait can be accounted for too. */
export function nativeBatchWaiting(journal: string): () => boolean {
  let size: number | undefined;
  let waiting = false;
  return () => {
    const nextSize = statSync(journal, { throwIfNoEntry: false })?.size;
    if (size === nextSize) return waiting;
    size = nextSize;
    waiting = false;
    if (!size) return waiting;

    const workers = new Map<number, boolean>();
    // A worker may be appending the last event as we read the file.
    const complete = readFileSync(journal, "utf8").split("\n").slice(0, -1);
    for (const line of complete) {
      if (!line) continue;
      const { phase, worker } = JSON.parse(line) as {
        phase: string;
        worker?: number;
      };
      if (worker === undefined) continue;
      if (phase === "worker-start") workers.set(worker, false);
      else if (phase === "worker-end") workers.delete(worker);
      else if (workers.has(worker)) {
        if (phase === "lock-wait-start") workers.set(worker, true);
        else if (phase === "lock-wait") workers.set(worker, false);
      }
    }
    waiting = workers.size > 0 && [...workers.values()].every(Boolean);
    return waiting;
  };
}
