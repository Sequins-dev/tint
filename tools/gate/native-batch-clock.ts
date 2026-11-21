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

    const workers = new Map<
      number,
      { queued: number; holding: number; building: number }
    >();
    // A worker may be appending the last event as we read the file.
    const complete = readFileSync(journal, "utf8").split("\n").slice(0, -1);
    for (const line of complete) {
      if (!line) continue;
      const { phase, worker } = JSON.parse(line) as {
        phase: string;
        worker?: number;
      };
      if (worker === undefined) continue;
      if (phase === "worker-start")
        workers.set(worker, { queued: 0, holding: 0, building: 0 });
      else if (phase === "worker-end") workers.delete(worker);
      else {
        const state = workers.get(worker);
        if (!state) continue;
        if (phase === "lock-wait-start") state.queued++;
        else if (phase === "lock-wait") {
          state.queued--;
          state.holding++;
        } else if (phase === "lock-release") state.holding--;
        else if (phase === "build-start") state.building++;
        else if (phase === "build") state.building--;
      }
    }
    waiting =
      workers.size > 0 &&
      [...workers.values()].every(
        ({ queued, holding, building }) =>
          queued > 0 && holding === 0 && building === 0,
      );
    return waiting;
  };
}

/** A fixture's active budget starts once its scheduled build has a memory slot. */
export function nativeFixtureMemoryWaiting(
  journal: string,
  worker: number,
): () => boolean {
  let priorSize: number | undefined;
  let waiting = false;
  return () => {
    const size = statSync(journal, { throwIfNoEntry: false })?.size;
    if (size === priorSize) return waiting;
    priorSize = size;
    waiting = false;
    if (!size) return waiting;
    const lines = readFileSync(journal, "utf8").split("\n").slice(0, -1);
    for (const line of lines) {
      if (!line) continue;
      const row = JSON.parse(line) as { phase: string; worker?: number };
      if (row.worker !== worker) continue;
      if (row.phase === "memory-wait-start") waiting = true;
      else if (row.phase === "build-start" || row.phase === "worker-end")
        waiting = false;
    }
    return waiting;
  };
}
