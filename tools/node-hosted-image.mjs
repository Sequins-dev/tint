import { DynamicLibrary } from "node:ffi";
import { closeSync, realpathSync, writeSync } from "node:fs";
import { Socket } from "node:net";
import { Worker, parentPort, workerData } from "node:worker_threads";
import {
  nodeWorkerLaunchRecordBytes,
  nodeWorkerLaunchReplyOffset,
} from "@tint/abi/host";

const bootstrap = new URL(import.meta.url);
const protocol = "tint-node-hosted-image-v1";

/**
 * Load a Tint worker library into the current process. Node drives launches
 * on this event loop while the native isolates own their execution threads
 * and communicate through the image's native worker transport.
 */
export function runNodeHostedImage(filename) {
  const image = realpathSync(filename);
  let descriptors;
  {
    const path =
      process.platform === "darwin"
        ? "/usr/lib/libSystem.B.dylib"
        : "libc.so.6";
    using libc = new DynamicLibrary(path);
    const pipe = libc.getFunction("pipe", {
      arguments: ["pointer"],
      return: "int32",
    });
    descriptors = new Int32Array(2);
    if (pipe(descriptors) !== 0)
      throw new Error("Cannot open the Tint worker launch pipe");
  }
  const [input, output] = descriptors;
  let socket;
  try {
    socket = new Socket({ fd: input, readable: true, writable: false });
  } catch (error) {
    closeSync(input);
    closeSync(output);
    throw error;
  }

  return new Promise((resolve, reject) => {
    const workers = new Set();
    let stopped = false;
    let buffered = Buffer.alloc(0);

    function shutdownIfIdle() {
      if (!stopped || workers.size !== 0) return;
      socket.destroy();
      closeSync(output);
    }
    function rootExited(status, error) {
      if (stopped) return;
      stopped = true;
      socket.unref();
      for (const worker of workers) worker.unref();
      shutdownIfIdle();
      if (error === undefined) resolve(status);
      else reject(error);
    }
    function launch(argument, descriptor) {
      const root = descriptor === undefined;
      let worker;
      let started = false;
      let replied = false;
      let failure;
      function reply(status) {
        if (replied || root) return;
        const bytes = Buffer.alloc(4);
        bytes.writeInt32LE(status);
        const written = writeSync(descriptor, bytes);
        if (written !== bytes.length)
          throw new Error("Incomplete Tint worker launch reply");
        replied = true;
      }
      try {
        worker = new Worker(bootstrap, {
          workerData: { protocol, image, argument, broker: output },
        });
      } catch (error) {
        reply(-1);
        if (root) rootExited(0, error);
        return;
      }
      workers.add(worker);
      if (stopped) worker.unref();
      worker.once("message", (message) => {
        if (message !== "ready") return;
        reply(worker.threadId);
        started = true;
        worker.postMessage("start");
      });
      worker.on("error", (error) => {
        failure = error;
        if (!started) reply(-1);
      });
      worker.once("exit", (status) => {
        workers.delete(worker);
        if (!started) reply(-1);
        if (root) rootExited(status, failure);
        else shutdownIfIdle();
      });
    }

    socket.on("data", (chunk) => {
      const data =
        buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk]);
      let at = 0;
      while (at + nodeWorkerLaunchRecordBytes <= data.length) {
        const argument = data.readBigUInt64LE(at);
        const descriptor = data.readInt32LE(at + nodeWorkerLaunchReplyOffset);
        launch(argument, descriptor);
        at += nodeWorkerLaunchRecordBytes;
      }
      buffered = data.subarray(at);
    });
    socket.on("error", (error) => rootExited(0, error));
    launch(0n, undefined);
  });
}

if (workerData?.protocol === protocol) {
  using library = new DynamicLibrary(workerData.image);
  const entry = library.getFunction("tint_node_worker_entry", {
    arguments: ["uint64", "int32"],
    return: "int32",
  });
  await new Promise((resolve) => {
    parentPort.once("message", resolve);
    parentPort.postMessage("ready");
  });
  process.exitCode = entry(workerData.argument, workerData.broker);
} else if (import.meta.main) {
  const image = process.argv[2];
  if (image === undefined)
    throw new Error(
      "Usage - node --experimental-ffi node-hosted-image.mjs <Tint worker library>",
    );
  process.exitCode = await runNodeHostedImage(image);
}
