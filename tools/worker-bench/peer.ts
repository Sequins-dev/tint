// Worker entry for the kernel placements: "idle" waits for its stop message;
// "kernels" runs each requested kernel and replies with its checksum.
import { parentPort, workerData } from "node:worker_threads";
import { kernelScale, runKernel } from "./kernels.ts";

const port = parentPort;
if (port === null) throw new Error("the kernel peer needs a parent port");
port.on("message", (message: unknown): void => {
  if (message === "stop") port.close();
  else if (workerData === "kernels" && typeof message === "string")
    port.postMessage(runKernel(message, kernelScale(message)));
  else throw new Error("unexpected kernel request");
});
port.postMessage("ready");
