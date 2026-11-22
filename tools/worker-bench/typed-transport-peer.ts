// Typed Worker entry for typed-transport.ts: echoes numbers and strings and
// sums a batch.
import { parentPort } from "node:worker_threads";

const port = parentPort;
if (port === null) throw new TypeError("the transport peer needs a port");
let remaining = 0,
  sum = 0;
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
  else throw new TypeError("unexpected request");
});
port.postMessage("ready");
