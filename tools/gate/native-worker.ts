// Preloaded by Node's isolated native test file workers.
import { appendFileSync } from "node:fs";
import { isMainThread } from "node:worker_threads";

const journal = process.env.TINT_GATE_NATIVE_IMAGES;
if (journal && isMainThread && !process.env.TINT_GATE_NATIVE_WORKER_PID) {
  const worker = process.pid;
  process.env.TINT_GATE_NATIVE_WORKER_PID = String(worker);
  const record = (phase: string) =>
    appendFileSync(journal, JSON.stringify({ phase, worker }) + "\n");
  record("worker-start");
  process.once("exit", () => record("worker-end"));
}
