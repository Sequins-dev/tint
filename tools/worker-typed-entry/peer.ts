// A typed Worker entry with top-level control flow, mutable module state and
// a shared module (docs/design-worker-runtime.md, "Typed code inside Workers").
import {
  isMainThread,
  parentPort,
  threadId,
  workerData,
} from "node:worker_threads";
import { bump, square } from "./shared.ts";
import { record } from "./tally.ts";

const port = parentPort;
if (port === null || isMainThread || threadId <= 0)
  throw new TypeError("the peer must run in a Worker");
const base: number = typeof workerData === "number" ? workerData : -1;
let total: number = base;
port.on("message", (value: unknown): void => {
  if (value === "stop") {
    port.postMessage(total);
    port.close();
  } else if (typeof value === "number") {
    total += square(value) + record(value) - record(value) + 1;
    port.postMessage(total);
  } else throw new TypeError("unexpected request");
});
// This isolate's own instance of the shared module: 4, not the main's 5.
port.postMessage(bump());
