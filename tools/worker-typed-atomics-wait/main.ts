// Typed main entry for typed Atomics.wait / Atomics.notify + worker.terminate()
// interruption tests across Int32Array and BigInt64Array.
import { Worker } from "node:worker_threads";

function check(condition: boolean, message: string): void {
  if (!condition) throw new TypeError(message);
}

function catchKind(fn: () => void): string {
  try {
    fn();
    return "none";
  } catch (error) {
    if (error instanceof TypeError) return "TypeError";
    if (error instanceof RangeError) return "RangeError";
    return "Other";
  }
}

export function run(peer: string): number {
  // 1. Single-thread ECMAScript error & boundary semantics on ordinary & shared views.
  const ordinaryI32 = new Int32Array(4);
  const ordinaryBi64 = new BigInt64Array(4);
  // Non-shared must throw TypeError BEFORE index validation (even for OOB -1!).
  check(
    catchKind((): void => {
      Atomics.wait(ordinaryI32, -1, 0);
    }) === "TypeError",
    "ordinary Int32Array wait must throw TypeError before OOB",
  );
  check(
    catchKind((): void => {
      Atomics.wait(ordinaryBi64, -1, 0n);
    }) === "TypeError",
    "ordinary BigInt64Array wait must throw TypeError before OOB",
  );
  // Ordinary notify validates index (RangeError on OOB) and returns 0 when valid.
  check(
    catchKind((): void => {
      Atomics.notify(ordinaryI32, 4, 1);
    }) === "RangeError",
    "ordinary Int32Array notify OOB must throw RangeError",
  );
  check(
    catchKind((): void => {
      Atomics.notify(ordinaryBi64, -1, 1);
    }) === "RangeError",
    "ordinary BigInt64Array notify OOB must throw RangeError",
  );
  check(Atomics.notify(ordinaryI32, 0, 1) === 0, "ordinary i32 notify -> 0");
  check(Atomics.notify(ordinaryBi64, 0, 1) === 0, "ordinary bi64 notify -> 0");
  check(Atomics.notify(ordinaryI32, 0) === 0, "ordinary i32 notify default");
  check(Atomics.notify(ordinaryBi64, 0, NaN) === 0, "ordinary bi64 notify NaN");

  // Shared views: OOB RangeError, not-equal, timed-out, 64-bit high-word mismatch.
  const sab = new SharedArrayBuffer(128);
  const i32 = new Int32Array(sab, 0, 8);
  const bi64 = new BigInt64Array(sab, 32, 8);
  check(
    catchKind((): void => {
      Atomics.wait(i32, 8, 0, 0);
    }) === "RangeError",
    "shared Int32Array wait OOB",
  );
  check(
    catchKind((): void => {
      Atomics.wait(bi64, -1, 0n, 0);
    }) === "RangeError",
    "shared BigInt64Array wait OOB",
  );
  Atomics.store(i32, 0, 10);
  check(Atomics.wait(i32, 0, 11, 1000) === "not-equal", "i32 wait not-equal");
  check(Atomics.wait(i32, 0, 10, 0) === "timed-out", "i32 wait 0 timeout");
  check(Atomics.wait(i32, 0, 10, -5) === "timed-out", "i32 wait neg timeout");
  check(Atomics.wait(i32, 0, 10, 5) === "timed-out", "i32 wait 5ms timeout");
  check(Atomics.notify(i32, 0, 0) === 0, "i32 notify count 0");
  check(Atomics.notify(i32, 0, -2) === 0, "i32 notify neg count");
  check(Atomics.notify(i32, 0, Infinity) === 0, "i32 notify no waiters");

  Atomics.store(bi64, 0, 0x100000007n);
  // Same low 32 bits (7), different high 32 bits (2 vs 1): must be not-equal!
  check(
    Atomics.wait(bi64, 0, 0x200000007n, 1000) === "not-equal",
    "bi64 wait high-word mismatch",
  );
  check(
    Atomics.wait(bi64, 0, 0x100000007n, 0) === "timed-out",
    "bi64 wait 0 timeout",
  );
  check(
    Atomics.wait(bi64, 0, 0x100000007n, 5) === "timed-out",
    "bi64 wait 5ms timeout",
  );
  check(Atomics.notify(bi64, 0, 1) === 0, "bi64 notify no waiters");

  // 2. Multi-thread Int32Array wait/notify: park 2 workers, wake 1 then 1.
  Atomics.store(i32, 1, 77); // wait cell
  Atomics.store(i32, 2, 0); // ready count
  Atomics.store(i32, 3, 0); // woke ok count
  const i32Workers: Worker[] = [];
  for (let w = 0; w < 2; w++) {
    const worker = new Worker(peer, { workerData: "i32-wait" });
    worker.on("error", (err: unknown): void => {
      throw new TypeError("i32 worker error: " + String(err));
    });
    worker.postMessage(sab);
    i32Workers.push(worker);
  }
  while (Atomics.load(i32, 2) < 2)
    Atomics.wait(i32, 2, Atomics.load(i32, 2), 1);
  // Spin-wait until both workers are registered in the wait queue.
  let woke1 = 0;
  while (woke1 === 0) woke1 = Atomics.notify(i32, 1, 1);
  check(woke1 === 1, "expected notify(1) to wake 1 i32 worker");
  while (Atomics.load(i32, 3) < 1) Atomics.wait(i32, 3, 0, 1);
  let woke2 = 0;
  while (woke2 === 0) woke2 = Atomics.notify(i32, 1, Infinity);
  check(woke2 === 1, "expected second notify to wake remaining i32 worker");
  while (Atomics.load(i32, 3) < 2) Atomics.wait(i32, 3, 1, 1);

  // 3. Multi-thread BigInt64Array wait/notify: park 2 workers, wake 1 then 1.
  Atomics.store(bi64, 1, 0x500000009n); // wait cell
  Atomics.store(bi64, 2, 0n); // ready count
  Atomics.store(bi64, 3, 0n); // woke ok count
  for (let w = 0; w < 2; w++) {
    const worker = new Worker(peer, { workerData: "bi64-wait" });
    worker.on("error", (err: unknown): void => {
      throw new TypeError("bi64 worker error: " + String(err));
    });
    worker.postMessage(sab);
  }
  while (Atomics.load(bi64, 2) < 2n)
    Atomics.wait(bi64, 2, Atomics.load(bi64, 2), 1);
  let bwoke1 = 0;
  while (bwoke1 === 0) bwoke1 = Atomics.notify(bi64, 1, 1);
  check(bwoke1 === 1, "expected notify(1) to wake 1 bi64 worker");
  while (Atomics.load(bi64, 3) < 1n) Atomics.wait(bi64, 3, 0n, 1);
  let bwoke2 = 0;
  while (bwoke2 === 0) bwoke2 = Atomics.notify(bi64, 1, 2);
  check(bwoke2 === 1, "expected second notify to wake remaining bi64 worker");
  while (Atomics.load(bi64, 3) < 2n) Atomics.wait(bi64, 3, 1n, 1);

  // 4. worker.terminate() must cleanly interrupt parked typed Atomics.wait
  // on both Int32Array and BigInt64Array, even inside try/catch!
  Atomics.store(i32, 4, 123);
  Atomics.store(i32, 5, 0);
  const termI32 = new Worker(peer, { workerData: "i32-terminate" });
  let termI32Exit = -1;
  termI32.on("exit", (code: unknown): void => {
    const status = typeof code === "number" ? code : -2;
    termI32Exit = status;
    check(status === 1, "i32 terminated worker exit code: " + String(status));
  });
  termI32.postMessage(sab);
  while (Atomics.load(i32, 5) === 0) Atomics.wait(i32, 5, 0, 1);
  // Brief pause so the worker enters the kernel park before terminate().
  Atomics.wait(i32, 4, 123, 20);
  termI32.terminate();

  Atomics.store(bi64, 4, 0x300000001n);
  Atomics.store(bi64, 5, 0n);
  const termBi64 = new Worker(peer, { workerData: "bi64-terminate" });
  termBi64.on("exit", (code: unknown): void => {
    const status = typeof code === "number" ? code : -2;
    check(status === 1, "bi64 terminated worker exit code: " + String(status));
    check(termI32Exit === 1 || termI32Exit === -1, "exit tracking");
  });
  termBi64.postMessage(sab);
  while (Atomics.load(bi64, 5) === 0n) Atomics.wait(bi64, 5, 0n, 1);
  Atomics.wait(bi64, 4, 0x300000001n, 20);
  termBi64.terminate();

  return 42;
}
