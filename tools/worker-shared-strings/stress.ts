// The main side of the shared string stress fixture: four Workers make bursts
// of fresh bodies at once, the main isolate forwards each string to the next
// Worker, which verifies it, and every few rounds all isolates collect. At
// the end every body is freed, none fell back to a copy and each burst string
// made exactly one body. Prints "shared strings stress: ok".
import { Worker } from "node:worker_threads";
import { collectGarbage } from "gc";
import {
  burst,
  check,
  createdBodies,
  fallbacks,
  intact,
  liveBodies,
  refusedReleases,
  residentGranules,
} from "./strings.ts";

type Reply = (message: unknown) => void;
interface Peer {
  readonly worker: Worker;
  readonly replies: Reply[];
}
const workers = 4;
const rounds = 24;
const peers: Peer[] = [];
let pending = 0;
let round = 0;

function start(entry: string, ready: () => void): void {
  const replies: Reply[] = [];
  const peer: Peer = { worker: new Worker(entry), replies };
  replies.push((message: unknown): void => {
    check(message === "ready", "ready");
    ready();
  });
  peer.worker.on("message", (message: unknown): void => {
    const next = replies.shift();
    if (next === undefined) throw new TypeError("unexpected reply");
    next(message);
  });
  peers.push(peer);
}
function peerAt(index: number): Peer {
  const peer = peers[index % workers];
  if (peer === undefined) throw new TypeError("no Worker " + String(index));
  return peer;
}

export function run(entry: string): number {
  let ready = 0;
  for (let index = 0; index < workers; index++)
    start(entry, (): void => {
      ready++;
      if (ready === workers) next();
    });
  return 42;
}

/** One reply fewer to wait for; the round ends with the last. */
function settle(): void {
  pending--;
  if (pending > 0) return;
  round++;
  if (round === rounds) finish();
  else if (round % 6 === 0) collect();
  else next();
}
function next(): void {
  // Each Worker's burst (its strings, then "done") and the check of each
  // string by the following Worker.
  pending = workers * (burst * 2 + 1);
  for (let index = 0; index < workers; index++) {
    const peer = peerAt(index),
      base = round * 1000 + index * 100;
    for (let offset = 0; offset < burst; offset++) {
      const seed = base + offset;
      peer.replies.push((value: unknown): void => {
        check(intact(value, seed), "burst string " + String(seed));
        forward(peerAt(index + 1), seed, value);
        settle();
      });
    }
    peer.replies.push((message: unknown): void => {
      check(message === "done", "burst done");
      settle();
    });
    peer.worker.postMessage("burst");
    peer.worker.postMessage(base);
  }
}
function forward(peer: Peer, seed: number, value: unknown): void {
  peer.replies.push((message: unknown): void => {
    check(message === 1, "forwarded string " + String(seed));
    settle();
  });
  peer.worker.postMessage("check");
  peer.worker.postMessage(seed);
  peer.worker.postMessage(value);
}
function collect(): void {
  collectGarbage();
  pending = workers;
  for (let index = 0; index < workers; index++) {
    const peer = peerAt(index);
    peer.replies.push((message: unknown): void => {
      check(message === "collected", "collected");
      pending--;
      if (pending === 0) next();
    });
    peer.worker.postMessage("gc");
  }
}
function finish(): void {
  let exited = 0;
  for (let index = 0; index < workers; index++) {
    const peer = peerAt(index);
    peer.worker.once("exit", (_code: unknown): void => {
      exited++;
      if (exited < workers) return;
      collectGarbage();
      check(fallbacks() === 0, "fallbacks: " + String(fallbacks()));
      check(
        createdBodies() === rounds * workers * burst,
        "bodies made: " + String(createdBodies()),
      );
      check(liveBodies() === 0, "every body freed: " + String(liveBodies()));
      check(refusedReleases() === 0, "refused: " + String(refusedReleases()));
      check(
        residentGranules() === 0,
        "resident: " + String(residentGranules()),
      );
      console.log("shared strings stress: ok");
    });
    peer.worker.postMessage("stop");
  }
}
