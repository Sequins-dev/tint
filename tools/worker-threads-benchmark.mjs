import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";

const bufferBytes = 4 * 1024 * 1024;
const readWords = 256 * 1024;
const readPasses = 4;
const wakeCount = 1000;
const idleMs = 2000;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function measure(operation, count, elapsed, unit, amount) {
  console.log(
    "WORKER_BENCH " +
      JSON.stringify({ operation, count, elapsed, unit, amount }),
  );
}

function bufferView(buffer) {
  const bytes = new Uint8Array(buffer);
  check(
    bytes.length === bufferBytes &&
      bytes[0] === 42 &&
      bytes[bytes.length - 1] === 69,
    "buffer contents changed",
  );
  return bytes;
}

function scan(words) {
  let sum = 0;
  for (let pass = 0; pass < readPasses; pass++)
    for (let i = 0; i < words.length; i++) sum += words[i];
  return sum;
}

if (!isMainThread) {
  if (workerData.mode === "wake") {
    const words = new Int32Array(workerData.shared);
    parentPort.postMessage("ready");
    for (let i = 1; i <= wakeCount; i++) {
      check(Atomics.wait(words, 0, 0, 5000) === "ok", "worker wake timed out");
      Atomics.store(words, 1, i);
      Atomics.notify(words, 1, 1);
    }
    parentPort.close();
  } else {
    parentPort.on("message", (request) => {
      const operation = request[0];
      if (operation === "stop") {
        parentPort.close();
      } else if (operation === "echo") {
        parentPort.postMessage(request[1]);
      } else if (operation === "read") {
        parentPort.postMessage(scan(new Uint32Array(request[1])));
      } else {
        const buffer = request[1];
        bufferView(buffer);
        if (operation === "transfer") {
          parentPort.postMessage(buffer, [buffer]);
          check(buffer.byteLength === 0, "worker's buffer did not detach");
        } else {
          check(operation === "clone", "unexpected message");
          parentPort.postMessage(buffer);
        }
      }
    });
    parentPort.postMessage("ready");
  }
}

function launch(filename, data) {
  const worker = new Worker(filename, { workerData: data });
  let error;
  const inbox = [];
  let pending;
  worker.on("message", (message) => {
    if (pending === undefined) inbox.push(message);
    else {
      const deliver = pending;
      pending = undefined;
      deliver(message);
    }
  });
  worker.on("error", (failure) => {
    error = failure;
  });
  let exitStatus;
  const exited = new Promise((resolve) => {
    worker.once("exit", (status) => {
      exitStatus = status;
      if (pending !== undefined) pending(undefined);
      resolve(status);
    });
  });
  async function receive() {
    check(pending === undefined, "overlapping receives");
    if (inbox.length !== 0) return inbox.shift();
    if (error !== undefined) throw error;
    check(exitStatus === undefined, "worker exited before replying");
    const message = await new Promise((resolve) => {
      pending = resolve;
    });
    if (error !== undefined) throw error;
    check(message !== undefined, "worker exited before replying");
    return message;
  }
  async function finish(stop) {
    if (stop) worker.postMessage(["stop"]);
    check((await exited) === 0, "worker exit failure");
  }
  return { worker, receive, finish };
}

function elapsed(now, start) {
  const duration = now() - start;
  check(duration >= 0, "benchmark clock moved backwards");
  return duration;
}

async function startup(filename, now) {
  for (let i = 0; i < 10; i++) {
    const start = now();
    const child = launch(filename, { mode: "messages" });
    check((await child.receive()) === "ready", "expected ready");
    measure("startup", 1, elapsed(now, start), "workers", 1);
    await child.finish(true);
  }
}

async function messages(filename, now) {
  const child = launch(filename, { mode: "messages" });
  check((await child.receive()) === "ready", "expected ready");
  for (let sample = -1; sample < 5; sample++) {
    const count = sample < 0 ? 100 : 1000;
    const start = now();
    for (let i = 0; i < count; i++) {
      child.worker.postMessage(["echo", i]);
      check((await child.receive()) === i, "echo changed");
    }
    if (sample >= 0)
      measure("round-trip", count, elapsed(now, start), "messages", count);
  }
  const seed = new ArrayBuffer(bufferBytes);
  const bytes = new Uint8Array(seed);
  bytes[0] = 42;
  bytes[bytes.length - 1] = 69;
  let transferable = seed.slice(0);
  for (let sample = -1; sample < 5; sample++) {
    for (let variant = 0; variant < 2; variant++) {
      const move = (sample + variant) % 2 === 0;
      const count = sample < 0 ? 1 : 8;
      const start = now();
      for (let i = 0; i < count; i++) {
        const original = move ? transferable : seed;
        if (move) child.worker.postMessage(["transfer", original], [original]);
        else child.worker.postMessage(["clone", original]);
        check(
          original.byteLength === (move ? 0 : bufferBytes),
          "sender's buffer ownership changed",
        );
        const response = await child.receive();
        bufferView(response);
        if (move) transferable = response;
      }
      if (sample >= 0)
        measure(
          move ? "transfer" : "clone",
          count,
          elapsed(now, start),
          "bytes",
          2 * bufferBytes * count,
        );
    }
  }
  for (const shared of [false, true]) {
    const buffer = shared
      ? new SharedArrayBuffer(4 * readWords)
      : new ArrayBuffer(4 * readWords);
    const words = new Uint32Array(buffer);
    words[0] = 11;
    words[words.length - 1] = 31;
    for (let sample = -1; sample < 3; sample++) {
      const start = now();
      child.worker.postMessage(["read", buffer]);
      check((await child.receive()) === 42 * readPasses, "worker read changed");
      if (sample >= 0)
        measure(
          shared ? "shared-read" : "ordinary-read",
          readPasses,
          elapsed(now, start),
          "bytes",
          readWords * 4 * readPasses,
        );
    }
  }
  await child.finish(true);
}

async function wakes(filename, now) {
  for (let sample = 0; sample < 5; sample++) {
    const shared = new SharedArrayBuffer(8);
    const words = new Int32Array(shared);
    const child = launch(filename, { mode: "wake", shared });
    check((await child.receive()) === "ready", "expected ready");
    const start = now();
    for (let i = 0; i < wakeCount; i++) {
      while (Atomics.notify(words, 0, 1) === 0)
        check(elapsed(now, start) < 5000, "worker failed to park");
      while (Atomics.load(words, 1) === i)
        check(
          Atomics.wait(words, 1, i, 5000) !== "timed-out",
          "parent wake timed out",
        );
      check(Atomics.load(words, 1) === i + 1, "wake went out of order");
    }
    measure("wait-notify", wakeCount, elapsed(now, start), "wakes", wakeCount);
    await child.finish(false);
  }
}

async function idle(filename, now) {
  const words = new Int32Array(new SharedArrayBuffer(4));
  for (const count of [0, 4]) {
    const children = [];
    for (let i = 0; i < count; i++) {
      const child = launch(filename, { mode: "messages" });
      check((await child.receive()) === "ready", "expected ready");
      children.push(child);
    }
    console.log("WORKER_BENCH_IDLE_BEGIN " + count);
    const start = now();
    check(
      Atomics.wait(words, 0, 0, idleMs) === "timed-out",
      "idle ended early",
    );
    console.log("WORKER_BENCH_IDLE_END " + count);
    measure("idle", count, elapsed(now, start), "workers", count);
    for (const child of children) await child.finish(true);
    // Leave time for the external CPU sampler to read its final process sample.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function run(filename, now, mode = "all") {
  try {
    if (mode === "all" || mode === "startup") await startup(filename, now);
    if (mode === "all" || mode === "messages") await messages(filename, now);
    if (mode === "all" || mode === "wakes") await wakes(filename, now);
    if (mode === "all" || mode === "idle") await idle(filename, now);
    return 42;
  } catch (error) {
    console.log("WORKER_BENCH_FAILURE " + String(error));
    return 1;
  }
}
