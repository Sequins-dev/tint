// The main side of the shared string body fixture
// (tools/build-worker-shared-strings-fixture.ts). `run` returns 42 at once;
// the conversation then runs on the event loop, and a failed check throws,
// which fails the program. The last step prints "shared strings: ok".
import { Worker } from "node:worker_threads";
import { collectGarbage } from "gc";
import {
  addressOf,
  check,
  createdBodies,
  hold,
  intact,
  liveBodies,
  references,
  refusedReleases,
  residentGranules,
  referencesAt,
  text,
} from "./strings.ts";

type Reply = (message: unknown) => void;
interface Peer {
  readonly worker: Worker;
  readonly replies: Reply[];
}
function start(entry: string, ready: (peer: Peer) => void): Peer {
  const replies: Reply[] = [];
  const peer: Peer = { worker: new Worker(entry), replies };
  replies.push((message: unknown): void => {
    check(message === "ready", "ready");
    ready(peer);
  });
  peer.worker.on("message", (message: unknown): void => {
    const next = replies.shift();
    if (next === undefined) throw new TypeError("unexpected reply");
    next(message);
  });
  return peer;
}
/** Posts a command and its operand and awaits the reply. */
function ask(peer: Peer, command: string, value: unknown, reply: Reply): void {
  peer.replies.push(reply);
  peer.worker.postMessage(command);
  peer.worker.postMessage(value);
}
function number(message: unknown): number {
  return typeof message === "number" ? message : -1;
}

let entry = "";
let generational = true;
// The string every echo sends; dropped at the end.
let shared = text(1);
// The string four isolates hold; dropped once two of them are terminated.
let fourWay = "";

export function run(peer: string, collector: string): number {
  entry = peer;
  generational = collector !== "copying";
  start(entry, (first: Peer): void => echo(first, 0));
  return 42;
}

/** Ten round trips of one string: one body, no copy after the first send. */
function echo(first: Peer, round: number): void {
  if (round === 10) {
    check(createdBodies() === 1, "one body for ten round trips");
    unreceived(first);
    return;
  }
  ask(first, "echo", shared, (value: unknown): void => {
    check(intact(value, 1), "echo intact");
    if (typeof value === "string") {
      check(hold(value) >= 1, "main holds the echoed body");
      // The main isolate's hold and the Worker's.
      check(references(value) >= 2, "echo references");
    }
    echo(first, round + 1);
  });
}

/** A message the receiver never takes: its Worker is terminated while busy.
 * Its reference is dropped, and the sender's goes with its string. */
function unreceived(first: Peer): void {
  const before = liveBodies();
  start(entry, (busy: Peer): void => {
    ask(busy, "block", 200, (_message: unknown): void => {});
    postRead(busy, 3);
    check(liveBodies() === before + 1, "unreceived body allocated");
    busy.worker.once("exit", (_code: unknown): void => {
      collectGarbage();
      check(liveBodies() === before, "unreceived body freed");
      threeIsolates(first);
    });
    busy.worker.terminate();
  });
}
/** Posts "read" with a fresh text(seed) the caller keeps no reference to. */
function postRead(peer: Peer, seed: number): void {
  peer.worker.postMessage("read");
  peer.worker.postMessage(seed);
  peer.worker.postMessage(text(seed));
}

/** One body held by four isolates; terminating two drops their holds. */
function threeIsolates(first: Peer): void {
  fourWay = text(5);
  const peers: Peer[] = [first];
  function held(): void {
    if (peers.length < 3) return;
    let replies = 0;
    for (const peer of peers)
      ask(peer, "hold", fourWay, (message: unknown): void => {
        check(
          number(message) % 10 >= 1,
          "Worker hold " + String(number(message)),
        );
        replies++;
        if (replies === 3) counted(first, peers);
      });
  }
  for (let started = 0; started < 2; started++)
    start(entry, (peer: Peer): void => {
      peers.push(peer);
      held();
    });
}
function counted(first: Peer, peers: readonly Peer[]): void {
  first.replies.push((value: unknown): void => {
    check(intact(value, 5), "held echo");
    if (typeof value === "string") terminateTwo(first, peers, value);
  });
  first.worker.postMessage("echo-held");
}
function terminateTwo(
  first: Peer,
  peers: readonly Peer[],
  echoed: string,
): void {
  check(references(echoed) === 4, "four holds: " + String(references(echoed)));
  // Observed by address, so the listeners keep no reference to the body.
  const address = addressOf(echoed);
  let exited = 0;
  for (let index = 1; index < peers.length; index++) {
    const peer = peers[index];
    if (peer === undefined) continue;
    peer.worker.once("exit", (_code: unknown): void => {
      exited++;
      if (exited < 2) return;
      check(referencesAt(address) === 2, "terminated holds dropped");
      promote(first);
    });
    peer.worker.terminate();
  }
}

/** A minor collection makes a reachable young hold old; minors keep old
 * holds and a full collection frees them (every collection is full for the
 * copying runtime). */
function promote(first: Peer): void {
  fourWay = "";
  ask(first, "promote", text(7), (message: unknown): void => {
    // Queued, then old.
    check(number(message) === 13, "promoted hold " + String(number(message)));
    first.replies.push((released: unknown): void => {
      const expected = generational ? 30 : 0;
      check(
        number(released) === expected,
        "released " + String(number(released)),
      );
      inFlight(first);
    });
    first.worker.postMessage("release");
  });
}

/** The sender drops its hold while the message waits in a busy Worker's
 * queue: the message's reference keeps the body. The sender collects in a
 * later turn (a helper Worker's reply), so no frame of the sending turn can
 * still hold the string, while the receiver is still busy. */
function inFlight(first: Peer): void {
  // Settle the main isolate's earlier holds (text(7) is still held until a
  // full collection) so the count below moves only with this body.
  collectGarbage();
  const before = liveBodies();
  start(entry, (helper: Peer): void => {
    ask(first, "block", 1000, (_message: unknown): void => {});
    postRead(first, 9);
    ask(helper, "echo", 1, (_message: unknown): void => {
      collectGarbage();
      check(liveBodies() === before + 1, "in-flight body kept");
      helper.worker.postMessage("stop");
    });
    first.replies.push((message: unknown): void => {
      // Intact, queued, and only the receiver's reference.
      check(
        number(message) === 111,
        "in-flight read " + String(number(message)),
      );
      first.replies.push((_message: unknown): void => {
        check(liveBodies() === before, "in-flight body freed");
        finish(first);
      });
      first.worker.postMessage("release");
    });
  });
}

function finish(first: Peer): void {
  first.worker.once("exit", (_code: unknown): void => {
    shared = "";
    collectGarbage();
    check(liveBodies() === 0, "every body freed: " + String(liveBodies()));
    // Every freed body's pages went back to the OS: none refused, none
    // left resident after the full collection.
    check(refusedReleases() === 0, "refused: " + String(refusedReleases()));
    check(residentGranules() === 0, "resident: " + String(residentGranules()));
    console.log("shared strings: ok");
  });
  first.worker.postMessage("stop");
}
