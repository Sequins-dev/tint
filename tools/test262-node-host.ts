import { readFileSync, writeFileSync } from "node:fs";
import { executeNodeScript } from "./test262-node.ts";
import type { ExecutionJob, ExecutionOutcome } from "./test262-execution.ts";
const job = JSON.parse(readFileSync(0, "utf8")) as ExecutionJob;
let asynchronousError: ExecutionOutcome | undefined;
function failed(error: unknown): void {
  let type = "unknown",
    message = "";
  try {
    type = String(
      (error as { constructor?: { name?: unknown } })?.constructor?.name ??
        "unknown",
    );
    message = String(error);
  } catch {}
  asynchronousError = { kind: "error", phase: "runtime", type, message };
}
// Test262 may deliberately leave rejected promises unhandled. Rejection tracking
// is a host notification, not an abrupt Script completion or a $DONE failure.
process.on("unhandledRejection", () => {});
process.on("uncaughtException", failed);
let completion: ExecutionOutcome | undefined;
let completionCount = 0;
function printed(value: string): void {
  if (!job.plan.asynchronous) return;
  const success = value === "Test262:AsyncTestComplete";
  const prefix = "Test262:AsyncTestFailure:";
  if (!success && !value.startsWith(prefix)) return;
  completionCount++;
  if (completionCount > 1) {
    completion = {
      kind: "error",
      phase: "runtime",
      type: "Test262Error",
      message: "$DONE called more than once",
    };
  } else if (success) {
    completion = { kind: "completed" };
  } else {
    const detail = value.slice(prefix.length);
    const separator = detail.indexOf(":");
    completion = {
      kind: "error",
      phase: "runtime",
      type: separator < 0 ? "Test262Error" : detail.slice(0, separator),
      message: detail,
    };
  }
}
const outcome = executeNodeScript(job, printed);
function finish(result: ExecutionOutcome): void {
  writeFileSync(1, JSON.stringify(result));
  process.exit(0);
}
// Drain jobs before accepting completion, including a synchronous $DONE.
setImmediate(() =>
  setImmediate(() => {
    if (outcome.kind !== "completed") finish(outcome);
    else if (asynchronousError !== undefined) finish(asynchronousError);
    else if (!job.plan.asynchronous) finish(outcome);
    else if (completion !== undefined) finish(completion);
    else
      setTimeout(
        () => finish(asynchronousError ?? { kind: "timeout" }),
        job.timeoutMs,
      );
  }),
);
