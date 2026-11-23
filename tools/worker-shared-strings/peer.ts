// The Worker side of the shared string body fixture: echoes, holds and
// releases strings on request and reports what its isolate holds. A request
// is a short command string, then its operand (a test string or a number);
// replies are numbers or strings.
import { parentPort, type MessagePort } from "node:worker_threads";
import { collectGarbage } from "gc";
import { monotonicMilliseconds } from "clock";
import {
  addressOf,
  churn,
  hold,
  holdAt,
  intact,
  references,
} from "./strings.ts";

function workerPort(): MessagePort {
  const value = parentPort;
  if (value === null) throw new TypeError("the peer must run in a Worker");
  return value;
}
const port = workerPort();
const held: string[] = [];
let kept: string[] = [];
let keptAddress = 0;
// The command awaiting its operand, and the seed a "read" announced.
let command = "";
let seed = 0;

function keep(value: string): void {
  kept = [value];
  keptAddress = addressOf(value);
}
function operand(value: unknown): void {
  const current = command;
  command = "";
  if (current === "echo") port.postMessage(value);
  else if (current === "hold" && typeof value === "string") {
    held.push(value);
    port.postMessage(hold(value) + 10 * references(value));
  } else if (current === "promote" && typeof value === "string") {
    // Queued now; a minor collection (the churn) finds it reachable and
    // makes the hold old.
    keep(value);
    const queued = holdAt(keptAddress);
    churn();
    port.postMessage(queued * 10 + holdAt(keptAddress));
  } else if (current === "block" && typeof value === "number") {
    const until = monotonicMilliseconds() + value;
    while (monotonicMilliseconds() < until);
    port.postMessage("unblocked");
  } else if (current === "read" && typeof value === "number") {
    seed = value;
    command = "read-text";
  } else if (current === "read-text" && typeof value === "string")
    port.postMessage(
      (intact(value, seed) ? 1 : 0) +
        10 * hold(value) +
        100 * references(value),
    );
  else throw new TypeError("unexpected operand for " + current);
}
port.on("message", (value: unknown): void => {
  if (command !== "" || typeof value !== "string" || value.length > 64) {
    operand(value);
    return;
  }
  if (value === "echo-held") port.postMessage(held[0] ?? "");
  else if (value === "release") {
    // Old holds outlive minor collections; a full one frees the hold.
    kept = [];
    held.length = 0;
    churn();
    const afterMinor = holdAt(keptAddress);
    collectGarbage();
    port.postMessage(afterMinor * 10 + holdAt(keptAddress));
  } else if (value === "stop") port.close();
  else command = value;
});
port.postMessage("ready");
