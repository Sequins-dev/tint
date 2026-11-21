import { readFileSync, statSync } from "node:fs";

/** Pause only when every registered test file worker is waiting for a resource.
 * A helper subprocess, such as the JIT fixture builder, reports its owning
 * test worker so that its wait can be accounted for too. */
export function nativeBatchWaiting(journal: string): () => boolean {
  const state = nativeBatchState(journal);
  return () => state().waiting;
}

export function nativeBatchState(journal: string) {
  let size: number | undefined;
  let state: { waiting: boolean; holder?: number | undefined } = {
    waiting: false,
  };
  return () => {
    const nextSize = statSync(journal, { throwIfNoEntry: false })?.size;
    if (size === nextSize) return state;
    size = nextSize;
    state = { waiting: false };
    if (!size) return state;

    const workers = new Map<
      number,
      { queued: number; holding: number; building: number; memory: number }
    >();
    // A worker may be appending the last event as we read the file.
    const complete = readFileSync(journal, "utf8").split("\n").slice(0, -1);
    for (const line of complete) {
      if (!line) continue;
      const { phase, worker, pid } = JSON.parse(line) as {
        phase: string;
        worker?: number;
        pid?: number;
      };
      if (phase === "lock-wait") state.holder = pid;
      else if (phase === "lock-release" && state.holder === pid)
        state.holder = undefined;
      if (worker === undefined) continue;
      if (phase === "worker-start")
        workers.set(worker, { queued: 0, holding: 0, building: 0, memory: 0 });
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
        else if (phase === "memory-wait-start") state.memory++;
        else if (phase === "memory-wait") state.memory--;
      }
    }
    state.waiting =
      workers.size > 0 &&
      [...workers.values()].every(
        ({ queued, holding, building, memory }) =>
          (queued > 0 || memory > 0) && holding === 0 && building === 0,
      );
    return state;
  };
}
