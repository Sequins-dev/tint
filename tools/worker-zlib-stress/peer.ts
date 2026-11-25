// Typed Worker entry for the zlib stress: each round number from the main
// isolate starts a stress round here; the reply is the round, or a negative
// failure code.
import { parentPort } from "node:worker_threads";
import { intact, stressRound, type Churned, type Kept } from "./common.ts";

const port = parentPort;
if (port === null) throw new TypeError("the zlib stress peer needs a port");
const churned: Churned[] = [];
const outputs: Kept[] = [];
port.on("message", (value: unknown): void => {
  if (value === "finish") {
    // Re-verify the zlib output this isolate kept across its collections.
    port.postMessage(intact(outputs) ? outputs.length : -2);
    port.close();
  } else if (typeof value === "number")
    port.postMessage(stressRound(churned, outputs, value + 1) ? value : -1);
  else port.postMessage(-3);
});
