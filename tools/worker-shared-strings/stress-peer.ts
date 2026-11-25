// A Worker of the shared string stress fixture. "burst" + seed posts a burst
// of fresh strings (new bodies, made concurrently with the other Workers);
// "check" + seed + string verifies a string another Worker made and keeps
// some; "gc" drops what it keeps and collects.
import { parentPort, type MessagePort } from "node:worker_threads";
import { collectGarbage } from "gc";
import { burst, intact, text } from "./strings.ts";

function workerPort(): MessagePort {
  const value = parentPort;
  if (value === null) throw new TypeError("the peer must run in a Worker");
  return value;
}
const port = workerPort();
const kept: string[] = [];
let command = "";
let seed = 0;

function operand(value: unknown): void {
  const current = command;
  command = "";
  if (current === "burst" && typeof value === "number") {
    for (let index = 0; index < burst; index++)
      port.postMessage(text(value + index));
    port.postMessage("done");
  } else if (current === "check" && typeof value === "number") {
    seed = value;
    command = "check-text";
  } else if (current === "check-text" && typeof value === "string") {
    const ok = intact(value, seed);
    if (seed % 3 === 0) kept.push(value);
    port.postMessage(ok ? 1 : 0);
  } else throw new TypeError("unexpected operand for " + current);
}
port.on("message", (value: unknown): void => {
  if (command !== "" || typeof value !== "string" || value.length > 64) {
    operand(value);
    return;
  }
  if (value === "gc") {
    kept.length = 0;
    collectGarbage();
    port.postMessage("collected");
  } else if (value === "stop") port.close();
  else command = value;
});
port.postMessage("ready");
