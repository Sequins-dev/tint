// Typed Worker entry for typed-transport.ts: echoes numbers and strings,
// sums a batch and adds to the shared counter it receives.
import { parentPort } from "node:worker_threads";

const port = parentPort;
if (port === null) throw new TypeError("the transport peer needs a port");
let remaining = 0,
  sum = 0;
// A typed parameter views a received realm typed array natively once.
function add(counters: Uint32Array): void {
  for (let i = 0; i < 100000; i++) Atomics.add(counters, 0, 1);
}
port.on("message", (value: unknown): void => {
  if (value === "stop") port.close();
  else if (value === "batch") {
    remaining = 10000;
    sum = 0;
  } else if (typeof value === "number" && remaining > 0) {
    sum += value;
    remaining--;
    if (remaining === 0) port.postMessage(sum);
  } else if (typeof value === "number" || typeof value === "string")
    port.postMessage(value);
  else if (value instanceof Uint32Array) {
    add(value);
    port.postMessage("added");
  } else throw new TypeError("unexpected request");
});
port.postMessage("ready");
