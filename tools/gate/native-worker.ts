// Preloaded by Node's isolated native test file workers.
import { appendFileSync } from "node:fs";
import { relative } from "node:path";
import { isMainThread } from "node:worker_threads";

const journal = process.env.TINT_GATE_NATIVE_IMAGES;
if (journal && isMainThread && !process.env.TINT_GATE_NATIVE_WORKER_PID) {
  const worker = process.pid;
  process.env.TINT_GATE_NATIVE_WORKER_PID = String(worker);
  // The test file and times let native-costs.ts attribute work to files.
  const file = process.argv[1] && relative(process.cwd(), process.argv[1]);
  const record = (phase: string) =>
    appendFileSync(
      journal,
      JSON.stringify({ phase, worker, file, at: Date.now() }) + "\n",
    );
  record("worker-start");
  process.once("exit", () => record("worker-end"));
}
