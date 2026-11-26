// Typed Worker entry for typed Atomics.wait / Atomics.notify + terminate tests.
import { parentPort, workerData } from "node:worker_threads";

const port = parentPort;
if (port === null) throw new TypeError("peer must run in a Worker");
const mode: string = typeof workerData === "string" ? workerData : "";

port.on("message", (value: unknown): void => {
  if (!(value instanceof SharedArrayBuffer))
    throw new TypeError("expected SharedArrayBuffer");
  const i32 = new Int32Array(value, 0, 8);
  const bi64 = new BigInt64Array(value, 32, 8);
  if (mode === "i32-wait") {
    Atomics.add(i32, 2, 1);
    Atomics.notify(i32, 2, 1);
    const result = Atomics.wait(i32, 1, 77);
    if (result !== "ok") throw new TypeError("i32 wait returned: " + result);
    Atomics.add(i32, 3, 1);
    Atomics.notify(i32, 3, 1);
    port.close();
    return;
  }
  if (mode === "bi64-wait") {
    Atomics.add(bi64, 2, 1n);
    Atomics.notify(bi64, 2, 1);
    const result = Atomics.wait(bi64, 1, 0x500000009n);
    if (result !== "ok") throw new TypeError("bi64 wait returned: " + result);
    Atomics.add(bi64, 3, 1n);
    Atomics.notify(bi64, 3, 1);
    port.close();
    return;
  }
  if (mode === "i32-terminate") {
    Atomics.store(i32, 5, 1);
    Atomics.notify(i32, 5, 1);
    try {
      Atomics.wait(i32, 4, 123);
    } catch (_error) {
      // Termination must NOT be catchable!
      Atomics.store(i32, 6, 999);
    }
    Atomics.store(i32, 6, 999);
    port.close();
    return;
  }
  if (mode === "bi64-terminate") {
    Atomics.store(bi64, 5, 1n);
    Atomics.notify(bi64, 5, 1);
    try {
      Atomics.wait(bi64, 4, 0x300000001n);
    } catch (_error) {
      // Termination must NOT be catchable!
      Atomics.store(bi64, 6, 999n);
    }
    Atomics.store(bi64, 6, 999n);
    port.close();
    return;
  }
  throw new TypeError("unknown mode: " + mode);
});
