import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ExecutionJob, ExecutionOutcome } from "./test262-execution.ts";
export function executeNodeProcess(job: ExecutionJob): ExecutionOutcome {
  const result = spawnSync(
    process.execPath,
    [
      "--expose-gc",
      fileURLToPath(new URL("./test262-node-host.ts", import.meta.url)),
    ],
    {
      input: JSON.stringify(job),
      encoding: "utf8",
      timeout: job.timeoutMs + 2000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.error !== undefined) {
    if ("code" in result.error && result.error.code === "ETIMEDOUT")
      return { kind: "timeout" };
    throw result.error;
  }
  if (result.signal !== null || result.status !== 0)
    return {
      kind: "crash",
      detail:
        (result.signal ?? String(result.status)) +
        ": " +
        result.stderr.slice(0, 2048),
    };
  const outcome: unknown = JSON.parse(result.stdout);
  if (typeof outcome !== "object" || outcome === null || !("kind" in outcome))
    throw new Error("invalid execution protocol response");
  switch (outcome.kind) {
    case "completed":
    case "timeout":
      return { kind: outcome.kind };
    case "error":
      if (
        "phase" in outcome &&
        ["parse", "resolution", "runtime", "harness"].includes(
          String(outcome.phase),
        ) &&
        "type" in outcome &&
        typeof outcome.type === "string" &&
        "message" in outcome &&
        typeof outcome.message === "string"
      )
        return outcome as ExecutionOutcome;
      break;
    case "unsupported":
      if ("reason" in outcome && typeof outcome.reason === "string")
        return { kind: "unsupported", reason: outcome.reason };
      break;
  }
  throw new Error("invalid execution protocol outcome");
}
