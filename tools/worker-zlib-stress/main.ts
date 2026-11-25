// Typed main entry for the zlib stress. `run` returns 42 at once; each later
// check throws, which fails the program on both hosts.
import { Worker } from "node:worker_threads";
import {
  intact,
  retainedCount,
  rounds,
  stressRound,
  type Churned,
  type Kept,
} from "./common.ts";

function check(condition: boolean, message: string): void {
  if (!condition) throw new TypeError(message);
}

export function run(peer: string): number {
  const worker = new Worker(peer);
  const churned: Churned[] = [];
  const outputs: Kept[] = [];
  let round = 0,
    finished = false;
  function next(): void {
    worker.postMessage(round);
    // This isolate's round runs while the Worker runs its own.
    check(stressRound(churned, outputs, round), "main zlib round");
  }
  worker.on("message", (value: unknown): void => {
    if (finished) {
      check(value === retainedCount, "peer zlib outputs");
      return;
    }
    check(value === round, "peer round");
    round++;
    if (round < rounds) next();
    else {
      check(intact(outputs), "main zlib outputs");
      finished = true;
      worker.postMessage("finish");
    }
  });
  worker.once("exit", (code: unknown): void => {
    check(code === 0 && finished, "peer exit");
    console.log(
      "zlib stress: " +
        String(rounds) +
        " rounds in both isolates, " +
        String(outputs.length) +
        " zlib outputs per isolate retained and re-verified",
    );
  });
  next();
  return 42;
}
