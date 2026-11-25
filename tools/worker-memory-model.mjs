// Memory-model litmus tests over SharedArrayBuffer with real Worker threads.
// Every spin is bounded by a pure counter, so an optimization that caches,
// hoists or eliminates a shared read shows up as a failure code instead of a
// hang. The same source runs under Node (tools/worker-memory-model.test.ts)
// and natively (tools/build-worker-memory-model-fixture.ts).
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";

const spinLimit = 100000000;
const pingPongRounds = 20000;
const storeBufferRounds = 40000;
const counterWorkers = 4;
const counterRounds = 20000;
const notifyRounds = 4000;
const payloadWords = 16;

// Int32 word indexes shared by the modes. Each mode gets a fresh buffer.
const turn = 0;
const status = 1;
const payload = 2;
// Store buffering keeps x and y on separate 128-byte cache lines.
const start = 0;
const observed = 2;
const done = 3;
const x = 16;
const y = 48;

/** Spins on an Atomics.load in a callee so inlining is exercised too. */
function awaitWord(words, index, value) {
  let spins = 0;
  while (Atomics.load(words, index) !== value)
    if (++spins > spinLimit) return false;
  return true;
}

function fail(words, code) {
  Atomics.store(words, status, code);
  Atomics.notify(words, turn);
}

function pingPongWorker(words, wide) {
  for (let round = 1; round <= pingPongRounds; round++) {
    // Inline spin: the loop body is only the atomic read and a counter.
    let spins = 0;
    while (Atomics.load(words, turn) !== 2 * round - 1)
      if (++spins > spinLimit) return fail(words, 101);
    for (let i = 0; i < payloadWords; i++)
      if (words[payload + i] !== round * 3 + i) return fail(words, 102);
    if (wide[3] !== round + 0.5) return fail(words, 103);
    for (let i = 0; i < payloadWords; i++) words[payload + i] = round * 5 + i;
    wide[3] = round + 0.25;
    // The plain stores above must be visible before this store is.
    Atomics.store(words, turn, 2 * round);
  }
}

function storeBufferWorker(words, plain) {
  for (let round = 1; round <= storeBufferRounds; round++) {
    if (!awaitWord(words, start, round)) return fail(words, 201);
    for (let delay = (round * 5) & 7; delay > 0; delay--);
    let seen;
    if (plain) {
      words[y] = 1;
      seen = words[x];
    } else {
      Atomics.store(words, y, 1);
      seen = Atomics.load(words, x);
    }
    Atomics.store(words, observed, seen);
    Atomics.store(words, done, round);
  }
}

function counterWorker(shared) {
  const words = new Int32Array(shared.words);
  const bytes = new Uint8Array(shared.words);
  const halves = new Uint16Array(shared.words);
  const wide = new BigInt64Array(shared.wide);
  const plain = new Float64Array(shared.wide);
  for (let round = 0; round < counterRounds; round++) {
    Atomics.add(words, 4, 1);
    Atomics.sub(words, 5, 1);
    Atomics.add(wide, 0, 3n);
    // Compare-exchange retry loops at byte and half-word width.
    for (;;) {
      const old = Atomics.load(bytes, 24);
      if (Atomics.compareExchange(bytes, 24, old, (old + 1) & 255) === old)
        break;
    }
    for (;;) {
      const old = Atomics.load(halves, 14);
      if (Atomics.compareExchange(halves, 14, old, (old + 1) & 65535) === old)
        break;
    }
    // A compare-exchange spinlock guards plain read-modify-writes: the plain
    // accesses must stay between the acquiring exchange and releasing store.
    let spins = 0;
    while (Atomics.compareExchange(words, 0, 0, 1) !== 0)
      if (++spins > spinLimit) return fail(words, 301);
    plain[1] = plain[1] + 1;
    words[8] = words[8] + 2;
    Atomics.store(words, 0, 0);
  }
}

function notifyWorker(words) {
  for (let round = 1; round <= notifyRounds; round++) {
    let timeouts = 0;
    while (Atomics.load(words, turn) !== 2 * round - 1)
      if (
        Atomics.wait(words, turn, 2 * round - 2, 1000) === "timed-out" &&
        ++timeouts > 5
      )
        return fail(words, 401);
    if (words[payload] !== round * 7) return fail(words, 402);
    words[payload + 1] = round * 11;
    Atomics.store(words, turn, 2 * round);
    Atomics.notify(words, turn);
  }
}

if (!isMainThread) {
  const { mode, shared } = workerData;
  if (mode === "ping-pong")
    pingPongWorker(new Int32Array(shared.words), new Float64Array(shared.wide));
  else if (mode === "store-buffer")
    storeBufferWorker(new Int32Array(shared), false);
  else if (mode === "store-buffer-plain")
    storeBufferWorker(new Int32Array(shared), true);
  else if (mode === "counter") counterWorker(shared);
  else if (mode === "notify") notifyWorker(new Int32Array(shared));
}

function once(target, event) {
  return new Promise((resolve) => target.once(event, resolve));
}

async function joined(worker, words) {
  const code = await once(worker, "exit");
  if (code !== 0) return 2;
  const reported = Atomics.load(words, status);
  return reported === 0 ? 42 : reported;
}

async function pingPong(filename) {
  const shared = {
    words: new SharedArrayBuffer(4 * (payload + payloadWords)),
    wide: new SharedArrayBuffer(64),
  };
  const words = new Int32Array(shared.words);
  const wide = new Float64Array(shared.wide);
  const worker = new Worker(filename, {
    workerData: { mode: "ping-pong", shared },
  });
  const exit = joined(worker, words);
  for (let round = 1; round <= pingPongRounds; round++) {
    for (let i = 0; i < payloadWords; i++) words[payload + i] = round * 3 + i;
    wide[3] = round + 0.5;
    Atomics.store(words, turn, 2 * round - 1);
    if (!awaitWord(words, turn, 2 * round)) {
      await worker.terminate();
      return Atomics.load(words, status) || 111;
    }
    for (let i = 0; i < payloadWords; i++)
      if (words[payload + i] !== round * 5 + i) return 112;
    if (wide[3] !== round + 0.25) return 113;
  }
  return exit;
}

/** Returns [status, rounds where both threads read 0]. */
async function storeBuffer(filename, plain) {
  const shared = new SharedArrayBuffer(256);
  const words = new Int32Array(shared);
  const worker = new Worker(filename, {
    workerData: { mode: plain ? "store-buffer-plain" : "store-buffer", shared },
  });
  const exit = joined(worker, words);
  let forbidden = 0;
  for (let round = 1; round <= storeBufferRounds; round++) {
    Atomics.store(words, x, 0);
    Atomics.store(words, y, 0);
    Atomics.store(words, start, round);
    for (let delay = (round * 3) & 7; delay > 0; delay--);
    let seen;
    if (plain) {
      words[x] = 1;
      seen = words[y];
    } else {
      Atomics.store(words, x, 1);
      seen = Atomics.load(words, y);
    }
    if (!awaitWord(words, done, round)) {
      await worker.terminate();
      return [Atomics.load(words, status) || 211, forbidden];
    }
    if (seen === 0 && Atomics.load(words, observed) === 0) forbidden++;
  }
  return [await exit, forbidden];
}

async function counters(filename) {
  const shared = {
    words: new SharedArrayBuffer(64),
    wide: new SharedArrayBuffer(16),
  };
  const words = new Int32Array(shared.words);
  const workers = [];
  for (let i = 0; i < counterWorkers; i++)
    workers.push(
      new Worker(filename, { workerData: { mode: "counter", shared } }),
    );
  const exits = workers.map((worker) => joined(worker, words));
  for (const exit of exits) {
    const code = await exit;
    if (code !== 42) return code;
  }
  const total = counterWorkers * counterRounds;
  if (Atomics.load(words, 4) !== total) return 311;
  if (Atomics.load(words, 5) !== -total) return 312;
  if (Atomics.load(new BigInt64Array(shared.wide), 0) !== BigInt(total * 3))
    return 313;
  if (Atomics.load(new Uint8Array(shared.words), 24) !== (total & 255))
    return 314;
  if (Atomics.load(new Uint16Array(shared.words), 14) !== (total & 65535))
    return 315;
  if (new Float64Array(shared.wide)[1] !== total) return 316;
  if (words[8] !== total * 2) return 317;
  return 42;
}

async function notifyOrdering(filename) {
  const shared = new SharedArrayBuffer(32);
  const words = new Int32Array(shared);
  const worker = new Worker(filename, {
    workerData: { mode: "notify", shared },
  });
  const exit = joined(worker, words);
  for (let round = 1; round <= notifyRounds; round++) {
    words[payload] = round * 7;
    Atomics.store(words, turn, 2 * round - 1);
    Atomics.notify(words, turn);
    let timeouts = 0;
    while (Atomics.load(words, turn) !== 2 * round) {
      if (Atomics.load(words, status) !== 0) return Atomics.load(words, status);
      if (
        Atomics.wait(words, turn, 2 * round - 1, 1000) === "timed-out" &&
        ++timeouts > 5
      ) {
        await worker.terminate();
        return 411;
      }
    }
    if (words[payload + 1] !== round * 11) return 412;
  }
  return exit;
}

/** Hosts give Worker the module designation for this same source. */
export async function run(filename) {
  if (!isMainThread) return 1;
  const ordered = await pingPong(filename);
  if (ordered !== 42) return ordered;
  const [sequential, forbidden] = await storeBuffer(filename, false);
  if (sequential !== 42) return sequential;
  if (forbidden !== 0) return 221;
  const [unordered, relaxed] = await storeBuffer(filename, true);
  if (unordered !== 42) return unordered;
  const counted = await counters(filename);
  if (counted !== 42) return counted;
  const notified = await notifyOrdering(filename);
  if (notified !== 42) return notified;
  console.log(
    "memory model: ping-pong " +
      pingPongRounds +
      ", store buffering " +
      storeBufferRounds +
      " (Atomics 0 forbidden, plain " +
      relaxed +
      " relaxed), counters " +
      counterWorkers * counterRounds +
      ", notify " +
      notifyRounds,
  );
  return 42;
}
