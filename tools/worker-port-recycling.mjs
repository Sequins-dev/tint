// Recycled packet blocks across parentPort, a transferred MessageChannel port
// and Worker exit. A burst leaves drained blocks on each mailbox's free stack;
// later single messages then travel in recycled blocks, each the last message
// in its queue, and every Worker exit releases both mailboxes. Before
// 8d112612d a recycled block kept its free-stack link as its queue link, so
// this sequence corrupted the queue and the native transport benchmark faulted
// at Worker exit. The same source runs under Node
// (tools/worker-port-recycling.test.ts) and natively
// (tools/build-worker-port-recycling-fixture.ts).
import {
  MessageChannel,
  Worker,
  isMainThread,
  parentPort,
} from "node:worker_threads";

const lifetimes = 8;
const bursts = 4;
const burst = 256;
const echoes = 64;

/** Echoes single values and sums announced bursts on `port`. */
function serve(port, onRequest) {
  let remaining = 0;
  let sum = 0;
  port.on("message", (value) => {
    if (typeof value === "number" && remaining > 0) {
      sum += value;
      remaining--;
      if (remaining === 0) port.postMessage(sum);
    } else if (typeof value === "number" || typeof value === "string")
      port.postMessage(value);
    else if (value.kind === "burst") {
      remaining = value.count;
      sum = 0;
    } else onRequest(value);
  });
}

if (!isMainThread)
  serve(parentPort, (request) => {
    if (request.kind === "port") {
      serve(request.port, (inner) => {
        if (inner.kind === "close") request.port.close();
      });
      parentPort.postMessage("port-ready");
    } else if (request.kind === "stop") parentPort.close();
  });

function once(target, event) {
  return new Promise((resolve) => target.once(event, resolve));
}

/** Bursts, then single round trips that reuse the recycled blocks. */
async function exercise(port, next) {
  for (let round = 0; round < bursts; round++) {
    port.postMessage({ kind: "burst", count: burst });
    let sum = 0;
    for (let i = 0; i < burst; i++) {
      port.postMessage(i);
      sum += i;
    }
    if ((await next()) !== sum) return false;
    for (let i = 0; i < echoes; i++) {
      port.postMessage(round * 1000 + i);
      if ((await next()) !== round * 1000 + i) return false;
    }
  }
  return true;
}

function inbox(port) {
  const values = [];
  let waiting;
  port.on("message", (value) => {
    if (waiting === undefined) values.push(value);
    else {
      const resolve = waiting;
      waiting = undefined;
      resolve(value);
    }
  });
  return () =>
    values.length > 0
      ? Promise.resolve(values.shift())
      : new Promise((resolve) => {
          waiting = resolve;
        });
}

/** Hosts give Worker the module designation for this same source. */
export async function run(filename) {
  if (!isMainThread) return 1;
  for (let lifetime = 0; lifetime < lifetimes; lifetime++) {
    const worker = new Worker(filename);
    const exit = once(worker, "exit");
    const next = inbox(worker);
    if (!(await exercise(worker, next))) return 10;
    const channel = new MessageChannel();
    worker.postMessage({ kind: "port", port: channel.port2 }, [channel.port2]);
    if ((await next()) !== "port-ready") return 11;
    if (!(await exercise(channel.port1, inbox(channel.port1)))) return 12;
    channel.port1.postMessage({ kind: "close" });
    channel.port1.close();
    if (!(await exercise(worker, next))) return 13;
    worker.postMessage({ kind: "stop" });
    if ((await exit) !== 0) return 14;
  }
  console.log(
    "port recycling: " +
      lifetimes +
      " Worker lifetimes, each " +
      bursts * 3 +
      " bursts of " +
      burst +
      " and " +
      bursts * 3 * echoes +
      " round trips over parentPort and a transferred port",
  );
  return 42;
}
