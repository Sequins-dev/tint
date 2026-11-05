import { existsSync, writeFileSync, renameSync, rmSync } from "node:fs";
export interface NativeDiagnosticPause {
  readonly kind: "diagnostic-pause";
  readonly elapsedMs: number;
}
/** Cooperatively hand off native execution only between completed variants.
 * The requester creates a marker, waits for its .ack, runs diagnostics, then
 * removes the marker after cleaning up its inferiors. Use a unique path per run. */
export function pauseNativeRun(
  request: string | undefined,
  record: (event: NativeDiagnosticPause) => void,
): void {
  if (request === undefined || !existsSync(request)) return;
  const started = performance.now();
  const ack = request + ".ack",
    staging = ack + ".pending";
  if (existsSync(ack))
    throw Error("stale native pause acknowledgement: " + ack);
  writeFileSync(
    staging,
    JSON.stringify({ pid: process.pid, state: "between-variants" }) + "\n",
    { flag: "wx" },
  );
  renameSync(staging, ack);
  const wait = new Int32Array(new SharedArrayBuffer(4));
  try {
    while (existsSync(request)) Atomics.wait(wait, 0, 0, 100);
  } finally {
    rmSync(ack);
  }
  record({ kind: "diagnostic-pause", elapsedMs: performance.now() - started });
}
