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

if (!isMainThread) {
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
  const worker = await verifyWorker(filename);
  if (worker !== 42) return worker;
  return verifyLifecycle(filename);
}
