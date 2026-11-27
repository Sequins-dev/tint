import {
  MessageChannel,
  MessagePort,
  Worker,
  isMainThread,
  parentPort,
  resourceLimits,
  threadId,
  workerData,
} from "node:worker_threads";

if (!isMainThread && workerData.mode === "notify") {
  const words = new Int32Array(workerData.shared);
  Atomics.wait(words, 1, 0, 5000);
  Atomics.store(words, 2, Atomics.notify(words, 0, 1));
  Atomics.wait(words, 3, 0, 5000);
  parentPort.close();
} else if (!isMainThread && workerData.mode === "oom-callback") {
  parentPort.on("message", (msg) => {
    if (msg === "boom") {
      parentPort.postMessage("queued-before-oom");
      const retained = [];
      for (;;) retained.push(new Array(2048).fill(1));
    }
  });
  parentPort.postMessage("ready");
} else if (!isMainThread) {
  if (workerData.mode === "error") throw new Error("worker failed");
  if (workerData.mode === "stop") {
    parentPort.postMessage("running");
    let length = 0;
    for (;;) {
      const bytes = new Uint8Array(32 + (length & 1));
      length = bytes.length;
    }
  }
  const shared = new Int32Array(workerData.shared);
  Atomics.store(shared, 0, 42);
  parentPort.postMessage({
    direct: workerData.alias === workerData.graph,
    cyclic: workerData.graph.self === workerData.graph,
    id: threadId,
    stackSizeMb: resourceLimits.stackSizeMb,
  });
  parentPort.once("message", (message) => {
    message.port.postMessage(message.buffer, [message.buffer]);
    message.port.close();
    parentPort.close();
  });
}

function once(target, event) {
  return new Promise((resolve) => target.once(event, resolve));
}

function rejectedTransfer(port, value, list) {
  try {
    port.postMessage(value, list);
    return false;
  } catch (error) {
    return error.name === "DataCloneError";
  }
}

async function verifyLocalClone() {
  const { port1, port2 } = new MessageChannel();
  try {
    if (!(port1 instanceof MessagePort) || !(port2 instanceof MessagePort))
      return 2;
    const list = [];
    list.length = 3;
    list[1] = "x";
    const sharedChild = { value: 11 };
    let gets = 0;
    const payload = {
      left: sharedChild,
      right: sharedChild,
      list,
      map: new Map([[sharedChild, list]]),
      set: new Set([sharedChild]),
      date: new Date(12345),
      expression: /ab/giu,
      error: new TypeError("bad"),
      big: 9007199254740993n,
      zero: -0,
      nan: NaN,
      get exposed() {
        gets++;
        return 21;
      },
    };
    payload.hidden = 1;
    Object.defineProperty(payload, "hidden", { enumerable: false });
    payload.self = payload;
    const unwired = new ArrayBuffer(8);
    if (!rejectedTransfer(port1, unwired, [unwired, unwired])) return 3;
    if (!rejectedTransfer(port1, () => {}, [])) return 4;
    if (!rejectedTransfer(port1, 0, [new SharedArrayBuffer(4)])) return 5;
    if (unwired.byteLength !== 8) return 6;
    const pending = once(port2, "message");
    port1.postMessage(payload, [unwired]);
    if (gets !== 1 || unwired.byteLength !== 0) return 7;
    const clone = await pending;
    if (
      clone.self !== clone ||
      clone.left !== clone.right ||
      clone.left === sharedChild ||
      clone.list.length !== 3 ||
      0 in clone.list ||
      clone.list[1] !== "x" ||
      2 in clone.list ||
      clone.map.get(clone.left) !== clone.list ||
      !clone.set.has(clone.left) ||
      clone.date.getTime() !== 12345 ||
      clone.expression.source !== "ab" ||
      clone.expression.flags !== "giu" ||
      !(clone.error instanceof TypeError) ||
      clone.error.message !== "bad" ||
      clone.big !== 9007199254740993n ||
      !Object.is(clone.zero, -0) ||
      !Number.isNaN(clone.nan) ||
      clone.exposed !== 21 ||
      "hidden" in clone
    )
      return 8;
    port2.ref();
    const closed = once(port2, "close");
    port1.close();
    await closed;
    return 42;
  } finally {
    port1.close();
    port2.close();
  }
}

async function verifyWorker(filename) {
  const graph = {};
  graph.self = graph;
  const shared = new SharedArrayBuffer(4);
  const worker = new Worker(filename, {
    workerData: { mode: "echo", graph, alias: graph, shared },
    resourceLimits: { stackSizeMb: 8 },
  });
  const { port1, port2 } = new MessageChannel();
  const childError = new Promise((resolve, reject) => {
    worker.once("error", reject);
  });
  try {
    const exit = once(worker, "exit");
    const response = await Promise.race([once(worker, "message"), childError]);
    if (
      !response.direct ||
      !response.cyclic ||
      response.id <= 0 ||
      response.id !== worker.threadId ||
      response.stackSizeMb !== 8 ||
      worker.resourceLimits.stackSizeMb !== 8 ||
      Atomics.load(new Int32Array(shared), 0) !== 42
    )
      return 9;
    const original = new Uint8Array([11, 21, 31, 41]);
    const responsePort = once(port2, "message");
    worker.postMessage({ buffer: original.buffer, port: port1 }, [
      original.buffer,
      port1,
    ]);
    if (original.byteLength !== 0) return 10;
    const returned = new Uint8Array(
      await Promise.race([responsePort, childError]),
    );
    if (returned.length !== 4 || returned[0] !== 11 || returned[3] !== 41)
      return 11;
    if ((await exit) !== 0 || worker.threadId !== -1) return 12;
    return 42;
  } finally {
    port1.close();
    port2.close();
    await worker.terminate();
  }
}

async function verifyLargeBufferClone() {
  const { port1, port2 } = new MessageChannel();
  try {
    const length = 8 * 1024 * 1024;
    const buffer = new ArrayBuffer(length, { maxByteLength: length + 8 });
    const view = new Uint8Array(buffer);
    view[0] = 11;
    view[length - 1] = 42;
    const message = once(port2, "message");
    port1.postMessage({ buffer, view });
    view[0] = 99;
    const copy = await message;
    if (
      !copy.buffer.resizable ||
      copy.buffer.maxByteLength !== length + 8 ||
      copy.view.buffer !== copy.buffer ||
      copy.view.byteLength !== length ||
      copy.view[0] !== 11 ||
      copy.view[length - 1] !== 42 ||
      buffer.byteLength !== length ||
      view[0] !== 99
    )
      return 19;
    return 42;
  } finally {
    port1.close();
    port2.close();
  }
}

async function verifyLifecycle(filename) {
  const worker = new Worker(filename, { workerData: { mode: "error" } });
  const order = [];
  worker.once("error", (error) => order.push(error.message));
  worker.once("exit", () => order.push("exit"));
  if (
    (await once(worker, "exit")) !== 1 ||
    order.join(",") !== "worker failed,exit"
  )
    return 13;
  const running = new Worker(filename, { workerData: { mode: "stop" } });
  try {
    const childError = new Promise((resolve, reject) => {
      running.once("error", reject);
    });
    if (
      (await Promise.race([once(running, "message"), childError])) !== "running"
    )
      return 14;
    const exit = once(running, "exit");
    if ((await running.terminate()) !== 1 || (await exit) !== 1) return 15;
    return 42;
  } finally {
    await running.terminate();
  }
}

async function verifyWaitAsync(filename) {
  const shared = new SharedArrayBuffer(16);
  const words = new Int32Array(shared);
  const worker = new Worker(filename, {
    workerData: { mode: "notify", shared },
  });
  let deadline;
  try {
    const exit = once(worker, "exit");
    const wait = Atomics.waitAsync(words, 0, 0, 2147483648);
    if (!wait.async) return 16;
    const timeout = new Promise((resolve) => {
      deadline = setTimeout(() => resolve("missing wake"), 3000);
    });
    Atomics.store(words, 1, 1);
    Atomics.notify(words, 1);
    if ((await Promise.race([wait.value, timeout])) !== "ok") return 17;
    Atomics.store(words, 3, 1);
    Atomics.notify(words, 3);
    return (await exit) === 0 && Atomics.load(words, 2) === 1 ? 42 : 18;
  } finally {
    clearTimeout(deadline);
    await worker.terminate();
  }
}

async function verifyOutOfMemory(filename) {
  const worker = new Worker(filename, {
    workerData: { mode: "oom-callback" },
    resourceLimits: { maxOldGenerationSizeMb: 8 },
  });
  let deadline;
  try {
    if ((await once(worker, "message")) !== "ready") return 20;
    const order = [];
    const done = new Promise((resolve) => {
      worker.on("message", (msg) => order.push(`msg:${msg}`));
      worker.once("error", (error) =>
        order.push(`err:${error.code ?? ""}:${error.message}`),
      );
      worker.once("exit", (code) => {
        order.push(`exit:${code}`);
        resolve(code);
      });
    });
    const timeout = new Promise((resolve) => {
      deadline = setTimeout(() => resolve("timeout"), 5000);
    });
    worker.postMessage("boom");
    worker.postMessage("after-boom");
    const status = await Promise.race([done, timeout]);
    if (status !== 1) return 21;
    if (
      order.join("|") !==
      "msg:queued-before-oom|err:ERR_WORKER_OUT_OF_MEMORY:Worker terminated due to reaching memory limit: JS heap out of memory|exit:1"
    )
      return 22;
    return 42;
  } finally {
    clearTimeout(deadline);
    await worker.terminate();
  }
}

/** Hosts give Worker the module designation for this same source. */
export async function run(filename) {
  if (
    !isMainThread ||
    threadId !== 0 ||
    parentPort !== null ||
    workerData !== null
  )
    return 1;
  const local = await verifyLocalClone();
  if (local !== 42) return local;
  const large = await verifyLargeBufferClone();
  if (large !== 42) return large;
  const worker = await verifyWorker(filename);
  if (worker !== 42) return worker;
  const lifecycle = await verifyLifecycle(filename);
  if (lifecycle !== 42) return lifecycle;
  const wait = await verifyWaitAsync(filename);
  return wait === 42 ? verifyOutOfMemory(filename) : wait;
}
