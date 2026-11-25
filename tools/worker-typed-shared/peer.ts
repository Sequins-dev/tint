// A typed Worker entry that adds to the counters it receives: either a realm
// SharedArrayBuffer itself or a realm Uint32Array over the main isolate's
// typed SharedArrayBuffer, both viewed natively by typed code.
import { parentPort, workerData } from "node:worker_threads";

const port = parentPort;
if (port === null) throw new TypeError("the peer must run in a Worker");
const rounds: number = typeof workerData === "number" ? workerData : 0;

function check(condition: boolean, message: string): void {
  if (!condition) throw new TypeError(message);
}

function forward(buffer: SharedArrayBuffer): SharedArrayBuffer {
  check(buffer.byteLength === 16, "typed parameter byteLength");
  return buffer;
}

port.on("message", (value: unknown): void => {
  if (value instanceof SharedArrayBuffer) {
    check(
      !(value instanceof Uint8Array),
      "SharedArrayBuffer is not Uint8Array",
    );
    check(value.byteLength === 16, "narrowed byteLength");
    const counters = new Uint32Array(value, 4, 2);
    const typed: SharedArrayBuffer = forward(value);
    const bytes = new Uint8Array(typed);
    bytes[12] = 99;
    // A native typed SharedArrayBuffer boxed into unknown stays distinct from
    // Uint8Array and ArrayBuffer.
    const localSab: unknown = new SharedArrayBuffer(8);
    check(localSab instanceof SharedArrayBuffer, "native sab instanceof");
    check(!(localSab instanceof Uint8Array), "native sab not Uint8Array");
    const view: unknown = new Uint8Array(typed);
    check(!(view instanceof SharedArrayBuffer), "view not SharedArrayBuffer");
    const ordinary: unknown = new ArrayBuffer(8);
    check(
      !(ordinary instanceof SharedArrayBuffer),
      "ArrayBuffer not SharedArrayBuffer",
    );
    for (let round = 0; round < rounds; round++) Atomics.add(counters, 0, 1);
    Atomics.add(counters, 1, 1);
    port.postMessage("done");
    port.close();
    return;
  }
  if (!(value instanceof Uint32Array))
    throw new TypeError("expected the shared counters or buffer");
  check(!(value instanceof SharedArrayBuffer), "view not SharedArrayBuffer");
  for (let round = 0; round < rounds; round++) Atomics.add(value, 0, 1);
  Atomics.add(value, 1, 1);
  port.postMessage("done");
  port.close();
});
