// Transfers and clones ArrayBuffers between two isolates while both run
// allocation-heavy loops, so each isolate's generational heap collects many
// times with buffers in flight. Backing stores must stay outside both managed
// heaps: every buffer is re-verified after the churn, including buffers
// retained across hundreds of collections. The same source runs under Node
// (tools/worker-transfer-stress.test.ts) and natively
// (tools/build-worker-transfer-stress-fixture.ts). Untyped programs that use
// Workers lower as general code, which cannot reach node:zlib's C bindings,
// so the typed variant in tools/worker-transfer-stress/ adds zlib.
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";

const rounds = 240;
const sizes = [16, 4096, 65536, 1048576];
const retainedCount = 24;
const churnRecords = 3000;
const stride = 61;

function fill(bytes, seed) {
  for (let i = 0; i < bytes.length; i += stride) bytes[i] = (seed + i) & 255;
  bytes[bytes.length - 1] = (seed * 7) & 255;
}

function filled(bytes, seed) {
  for (let i = 0; i < bytes.length - 1; i += stride)
    if (bytes[i] !== ((seed + i) & 255)) return false;
  return bytes[bytes.length - 1] === ((seed * 7) & 255);
}

/** Short-lived records plus a rolling set that survives minor collections. */
function churn(retained, round) {
  let total = 0;
  for (let i = 0; i < churnRecords; i++) {
    const record = {
      round,
      label: "r" + round + ":" + i,
      values: [i, i + 1, i + 2, round],
    };
    total += record.values.length + record.label.length;
    if ((i & 127) === 0) retained[(round * 31 + i) % retained.length] = record;
  }
  return total;
}

if (!isMainThread) {
  const churned = new Array(512);
  const kept = [];
  let failure = 0;
  parentPort.on("message", (message) => {
    if (message.finish) {
      // Re-verify the clones this isolate kept across its collections.
      for (const entry of kept)
        if (!filled(new Uint8Array(entry.buffer), entry.seed)) failure = 9;
      parentPort.postMessage({ failure, kept: kept.length });
      parentPort.close();
      return;
    }
    const { round, buffer, clone } = message;
    if (!filled(new Uint8Array(buffer), round)) failure ||= 1;
    if (!filled(new Uint8Array(clone), round + 3)) failure ||= 2;
    churn(churned, round);
    // Mutate the transferred backing in place and hand it back, with a fresh
    // buffer allocated in this isolate.
    fill(new Uint8Array(buffer), round + 1);
    const fresh = new ArrayBuffer(sizes[(round + 1) % sizes.length]);
    fill(new Uint8Array(fresh), round + 2);
    kept[round % retainedCount] = { buffer: clone, seed: round + 3 };
    parentPort.postMessage({ round, buffer, fresh, failure }, [buffer, fresh]);
    if (buffer.byteLength !== 0 || fresh.byteLength !== 0) failure ||= 4;
  });
}

function once(target, event) {
  return new Promise((resolve) => target.once(event, resolve));
}

/** Hosts give Worker the module designation for this same source. */
export async function run(filename) {
  if (!isMainThread) return 1;
  const worker = new Worker(filename);
  const exit = once(worker, "exit");
  const churned = new Array(512);
  const kept = [];
  for (let round = 0; round < rounds; round++) {
    const buffer = new ArrayBuffer(sizes[round % sizes.length]);
    fill(new Uint8Array(buffer), round);
    const clone = new ArrayBuffer(sizes[(round + 2) % sizes.length]);
    fill(new Uint8Array(clone), round + 3);
    const reply = once(worker, "message");
    worker.postMessage({ round, buffer, clone }, [buffer]);
    if (buffer.byteLength !== 0) return 11;
    // The clone stays usable here while the Worker verifies its own copy.
    churn(churned, round);
    fill(new Uint8Array(clone), round + 4);
    const message = await reply;
    if (message.failure !== 0) return 20 + message.failure;
    if (message.round !== round) return 12;
    if (!filled(new Uint8Array(message.buffer), round + 1)) return 13;
    if (!filled(new Uint8Array(message.fresh), round + 2)) return 14;
    if (!filled(new Uint8Array(clone), round + 4)) return 16;
    kept[round % retainedCount] = { buffer: message.fresh, seed: round + 2 };
    kept[retainedCount + (round % retainedCount)] = {
      buffer: message.buffer,
      seed: round + 1,
    };
  }
  for (const entry of kept)
    if (!filled(new Uint8Array(entry.buffer), entry.seed)) return 17;
  const summary = once(worker, "message");
  worker.postMessage({ finish: true });
  const result = await summary;
  if (result.failure !== 0) return 30 + result.failure;
  if (result.kept !== retainedCount) return 18;
  if ((await exit) !== 0) return 19;
  console.log(
    "transfer stress: " +
      rounds +
      " rounds, " +
      churnRecords * rounds +
      " churned records per isolate, " +
      kept.length +
      " transferred buffers retained and re-verified",
  );
  return 42;
}
