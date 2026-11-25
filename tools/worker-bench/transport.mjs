// Worker transport, shared-memory and lifecycle workloads
// (docs/results/worker-runtime-baseline-v1.md). The same untyped module runs
// under Node and natively, as the main program and as every Worker. Payloads
// are built outside the timers. Each line is
//   WORKER_BENCH {"operation":...,"count":...,"elapsed":ms}
// where `count` is the number of operations the elapsed time covers.
import {
  MessageChannel,
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";

// Profiles may raise the sample count (build-native.ts transport <prefix> <n>).
let samples = 3;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

// Profiles select one operation by prefix (build-native.ts transport <prefix>).
let only;
function selected(operation) {
  return only === undefined || operation.startsWith(only);
}

function measure(operation, count, elapsed) {
  console.log("WORKER_BENCH " + JSON.stringify({ operation, count, elapsed }));
}

// --- Payloads -----------------------------------------------------------
function records(count) {
  const list = [];
  for (let i = 0; i < count; i++)
    list.push({ id: i, name: "record" + i, value: i * 0.5, flag: i % 2 === 0 });
  return list;
}
function numbers(count) {
  const list = [];
  for (let i = 0; i < count; i++) list.push(i * 3);
  return list;
}
function text(length) {
  // repeat() avoids quadratic setup outside the timers.
  const unit = "worker-message-";
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
}
function tree(depth) {
  if (depth === 0) return { leaf: true, label: "leaf" };
  return {
    leaf: false,
    label: "node" + depth,
    children: [tree(depth - 1), tree(depth - 1)],
  };
}
/** A cheap structural fingerprint both ends compute for every clone. */
function fingerprint(value) {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) {
    let total = value.length;
    if (value.length !== 0) total += fingerprint(value[0]);
    if (value.length > 1) total += fingerprint(value[value.length - 1]);
    return total;
  }
  if (value !== null && typeof value === "object") {
    if (value.children !== undefined)
      return (
        1 + fingerprint(value.children[0]) + fingerprint(value.children[1])
      );
    return 1 + (value.id ?? 0) + (value.name?.length ?? 0);
  }
  return typeof value === "number" ? 1 : 0;
}
const clonePayloads = [
  ["records-16", () => records(16), 500],
  ["records-1024", () => records(1024), 10],
  ["numbers-1024", () => numbers(1024), 100],
  ["numbers-65536", () => numbers(65536), 3],
  ["string-1KiB", () => text(1024), 1000],
  ["string-1MiB", () => text(1048576), 5],
  ["tree-4", () => tree(4), 500],
  ["tree-10", () => tree(10), 10],
];
const transferSizes = [65536, 8388608];

// --- Worker side --------------------------------------------------------
function serveMessages(port) {
  // A batch announces how many numbers follow; reply once with their sum.
  let remaining = 0;
  let sum = 0;
  port.on("message", (request) => {
    if (typeof request === "number") {
      check(remaining > 0, "unexpected batch number");
      sum += request;
      remaining--;
      if (remaining === 0) port.postMessage(sum);
      return;
    }
    const operation = request[0];
    if (operation === "stop") port.close();
    else if (operation === "echo") port.postMessage(request[1]);
    else if (operation === "clone")
      port.postMessage(["clone", fingerprint(request[1]), request[1]]);
    else if (operation === "transfer") {
      const buffer = request[1];
      port.postMessage(buffer, [buffer]);
    } else if (operation === "batch") {
      remaining = request[1];
      sum = 0;
    } else if (operation === "port") {
      const channel = request[1];
      channel.on("message", (value) => {
        if (value === "close") channel.close();
        else channel.postMessage(value);
      });
      port.postMessage("port-ready");
    } else throw new Error("unexpected transport request " + operation);
  });
  port.postMessage("ready");
}

function serveShared(port, data) {
  const words = new Int32Array(data.shared);
  if (data.mode === "wake") {
    port.postMessage("ready");
    for (let i = 1; i <= data.count; i++) {
      check(Atomics.wait(words, 0, 0, 5000) === "ok", "worker wake timed out");
      Atomics.store(words, 1, i);
      Atomics.notify(words, 1, 1);
    }
    port.close();
  } else if (data.mode === "counter") {
    port.postMessage("ready");
    check(Atomics.wait(words, 1, 0, 5000) !== "timed-out", "counter start");
    for (let i = 0; i < data.count; i++) Atomics.add(words, 0, 1);
    port.postMessage("done");
    port.close();
  } else throw new Error("unexpected shared mode " + data.mode);
}

if (!isMainThread) {
  if (workerData.mode === "messages") serveMessages(parentPort);
  else serveShared(parentPort, workerData);
}

// --- Main side ----------------------------------------------------------
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
  return { worker, receive, finish, exited };
}

function elapsed(now, start) {
  const duration = now() - start;
  check(duration >= 0, "benchmark clock moved backwards");
  return duration;
}

async function lifecycle(filename, now) {
  for (let sample = -1; sample < samples && selected("startup"); sample++) {
    const start = now();
    const child = launch(filename, { mode: "messages" });
    check((await child.receive()) === "ready", "expected ready");
    const ready = elapsed(now, start);
    const stopping = now();
    await child.worker.terminate();
    await child.exited;
    const stopped = elapsed(now, stopping);
    if (sample >= 0) {
      measure("startup", 1, ready);
      measure("terminate", 1, stopped);
    }
  }
  for (let sample = -1; sample < samples && selected("startup-8"); sample++) {
    const start = now();
    const children = [];
    for (let i = 0; i < 8; i++)
      children.push(launch(filename, { mode: "messages" }));
    for (const child of children)
      check((await child.receive()) === "ready", "expected ready");
    const ready = elapsed(now, start);
    for (const child of children) await child.finish(true);
    if (sample >= 0) measure("startup-8", 8, ready);
  }
}

async function messages(filename, now) {
  const child = launch(filename, { mode: "messages" });
  check((await child.receive()) === "ready", "expected ready");
  // Small round trips.
  for (let sample = -1; sample < samples && selected("round-trip"); sample++) {
    const count = sample < 0 ? 100 : 1000;
    const start = now();
    for (let i = 0; i < count; i++) {
      child.worker.postMessage(["echo", i]);
      check((await child.receive()) === i, "echo changed");
    }
    if (sample >= 0) measure("round-trip", count, elapsed(now, start));
  }
  // Structured clone round trips (both directions clone the payload).
  for (const [name, build, count] of clonePayloads) {
    if (!selected("clone-" + name)) continue;
    const payload = build();
    const expected = fingerprint(payload);
    for (let sample = -1; sample < samples; sample++) {
      const repeat = sample < 0 ? 1 : count;
      const start = now();
      for (let i = 0; i < repeat; i++) {
        child.worker.postMessage(["clone", payload]);
        const reply = await child.receive();
        check(
          reply[0] === "clone" &&
            reply[1] === expected &&
            fingerprint(reply[2]) === expected,
          "clone changed " + name,
        );
      }
      if (sample >= 0) measure("clone-" + name, repeat, elapsed(now, start));
    }
  }
  // Transferred buffers: the time should not depend on the size.
  for (const size of transferSizes) {
    if (!selected("transfer-" + size)) continue;
    let buffer = new ArrayBuffer(size);
    new Uint8Array(buffer)[size - 1] = 7;
    for (let sample = -1; sample < samples; sample++) {
      const repeat = sample < 0 ? 10 : 200;
      const start = now();
      for (let i = 0; i < repeat; i++) {
        child.worker.postMessage(["transfer", buffer], [buffer]);
        check(buffer.byteLength === 0, "sender's buffer did not detach");
        buffer = await child.receive();
        check(
          buffer.byteLength === size && new Uint8Array(buffer)[size - 1] === 7,
          "transferred buffer changed",
        );
      }
      if (sample >= 0) measure("transfer-" + size, repeat, elapsed(now, start));
    }
  }
  // Many small messages without waiting, then one reply.
  for (let sample = -1; sample < samples && selected("batch"); sample++) {
    const count = sample < 0 ? 1000 : 10000;
    const start = now();
    child.worker.postMessage(["batch", count]);
    let sum = 0;
    for (let i = 0; i < count; i++) {
      child.worker.postMessage(i);
      sum += i;
    }
    check((await child.receive()) === sum, "batch sum changed");
    if (sample >= 0) measure("batch", count, elapsed(now, start));
  }
  // Port-to-port round trips over a transferred MessageChannel port.
  const channel = new MessageChannel();
  child.worker.postMessage(["port", channel.port2], [channel.port2]);
  check((await child.receive()) === "port-ready", "port setup");
  let deliver;
  channel.port1.on("message", (value) => {
    const resolve = deliver;
    deliver = undefined;
    resolve(value);
  });
  for (
    let sample = -1;
    sample < samples && selected("port-round-trip");
    sample++
  ) {
    const count = sample < 0 ? 100 : 1000;
    const start = now();
    for (let i = 0; i < count; i++) {
      const reply = new Promise((resolve) => {
        deliver = resolve;
      });
      channel.port1.postMessage(i);
      check((await reply) === i, "port echo changed");
    }
    if (sample >= 0) measure("port-round-trip", count, elapsed(now, start));
  }
  channel.port1.postMessage("close");
  channel.port1.close();
  await child.finish(true);
}

async function shared(filename, now) {
  const wakes = 1000;
  // Atomics.wait/notify ping-pong (both threads block).
  for (let sample = -1; sample < samples && selected("wait-notify"); sample++) {
    const count = sample < 0 ? 100 : wakes;
    const buffer = new SharedArrayBuffer(8);
    const words = new Int32Array(buffer);
    const child = launch(filename, { mode: "wake", shared: buffer, count });
    check((await child.receive()) === "ready", "expected ready");
    const start = now();
    for (let i = 0; i < count; i++) {
      while (Atomics.notify(words, 0, 1) === 0)
        check(elapsed(now, start) < 10000, "worker failed to park");
      while (Atomics.load(words, 1) === i)
        check(
          Atomics.wait(words, 1, i, 5000) !== "timed-out",
          "parent wake timed out",
        );
    }
    if (sample >= 0) measure("wait-notify", count, elapsed(now, start));
    await child.finish(false);
  }
  // Atomics.waitAsync on the main thread against a blocking Worker.
  for (let sample = -1; sample < samples && selected("wait-async"); sample++) {
    const count = sample < 0 ? 100 : wakes;
    const buffer = new SharedArrayBuffer(8);
    const words = new Int32Array(buffer);
    const child = launch(filename, { mode: "wake", shared: buffer, count });
    check((await child.receive()) === "ready", "expected ready");
    const start = now();
    for (let i = 0; i < count; i++) {
      while (Atomics.notify(words, 0, 1) === 0)
        check(elapsed(now, start) < 10000, "worker failed to park");
      while (Atomics.load(words, 1) === i) {
        const result = Atomics.waitAsync(words, 1, i, 5000);
        if (result.async)
          check((await result.value) !== "timed-out", "async wake timed out");
      }
    }
    if (sample >= 0) measure("wait-async", count, elapsed(now, start));
    await child.finish(false);
  }
  // Contended counters: 1 and 4 Workers each add 100,000 times.
  for (const workers of [1, 4]) {
    for (
      let sample = -1;
      sample < samples && selected("counter-" + workers);
      sample++
    ) {
      const count = 100000;
      const buffer = new SharedArrayBuffer(8);
      const words = new Int32Array(buffer);
      const children = [];
      for (let i = 0; i < workers; i++)
        children.push(
          launch(filename, { mode: "counter", shared: buffer, count }),
        );
      for (const child of children)
        check((await child.receive()) === "ready", "expected ready");
      const start = now();
      Atomics.store(words, 1, 1);
      Atomics.notify(words, 1);
      for (const child of children)
        check((await child.receive()) === "done", "expected done");
      const duration = elapsed(now, start);
      check(Atomics.load(words, 0) === workers * count, "counter lost adds");
      for (const child of children) await child.finish(false);
      if (sample >= 0) measure("counter-" + workers, workers * count, duration);
    }
  }
}

export async function run(filename, now, operation, sampleCount) {
  only = operation;
  if (sampleCount !== undefined) samples = sampleCount;
  try {
    await lifecycle(filename, now);
    await messages(filename, now);
    await shared(filename, now);
    return 42;
  } catch (error) {
    console.log("WORKER_BENCH_FAILURE " + String(error));
    return 1;
  }
}
