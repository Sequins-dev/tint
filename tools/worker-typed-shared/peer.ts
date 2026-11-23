// A typed Worker entry that adds to the counters it receives: a realm
// Uint32Array over the main isolate's typed SharedArrayBuffer, which typed
// code views natively.
import { parentPort, workerData } from "node:worker_threads";

const port = parentPort;
if (port === null) throw new TypeError("the peer must run in a Worker");
const rounds: number = typeof workerData === "number" ? workerData : 0;
port.on("message", (value: unknown): void => {
  if (!(value instanceof Uint32Array))
    throw new TypeError("expected the shared counters");
  for (let round = 0; round < rounds; round++) Atomics.add(value, 0, 1);
  Atomics.add(value, 1, 1);
  port.postMessage("done");
  port.close();
});
