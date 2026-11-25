// Typed main entry for the typed Worker entry fixture. `run` returns 42 at
// once; each later check throws, which fails the program on both hosts.
import { Worker } from "node:worker_threads";
import { bump } from "./shared.ts";

function check(condition: boolean, message: string): void {
  if (!condition) throw new TypeError(message);
}

export function run(peer: string, thrower: string): number {
  check(bump() === 4 && bump() === 5, "main module instance");
  const replies: number[] = [];
  const worker = new Worker(peer, { workerData: 10 });
  worker.on("message", (value: unknown): void => {
    if (typeof value !== "number") throw new TypeError("non-number reply");
    replies.push(value);
    // Ready (the Worker's own module instance), then 10+9, 19+16, stop.
    if (replies.length === 1) {
      check(value === 4, "Worker module instance " + String(value));
      worker.postMessage(3);
    } else if (replies.length === 2) {
      check(value === 19, "first sum " + String(value));
      worker.postMessage(4);
    } else if (replies.length === 3) {
      check(value === 35, "second sum " + String(value));
      worker.postMessage("stop");
    } else check(replies.length === 4 && value === 35, "final total");
  });
  worker.once("exit", (code: unknown): void => {
    check(code === 0 && replies.length === 4, "peer exit");
    const failing = new Worker(thrower);
    let order = "";
    failing.on("message", (value: unknown): void => {
      check(value === "before", "message before the throw");
      order += "m";
    });
    failing.on("error", (error: unknown): void => {
      check(error instanceof Error, "error event value");
      order += "e";
    });
    failing.once("exit", (status: unknown): void => {
      check(status === 1 && order === "me", "abrupt exit " + order);
    });
  });
  return 42;
}
