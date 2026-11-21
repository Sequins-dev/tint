import type { SharedResult } from "@tint/js-runtime/bytes/shared";
import {
  attachNativeAgentMailbox,
  createNativeAgentMailbox,
  type NativeAgentMailbox,
} from "./agent-messages.ts";
import {
  integer,
  readNumber,
  writeNumber,
  type NativeSharedBlockRegistry,
  type NativeSharedMemoryHost,
} from "./shared-memory-host.ts";
import type { NativeWaiterParkingHost } from "./shared-waiters.ts";

export interface NativeBlockingPoolHost {
  readonly entry: number;
  wakeTarget(): number;
  start(entry: number, argument: number): number;
  join(thread: number): number;
}
export interface NativeBlockingResult {
  readonly id: number;
  readonly failed: boolean;
  readonly result: string;
}
export interface NativeBlockingPool {
  /** Returns allocation-limit on saturation. A successful result is a
   * completion id; keep the isolate referenced until its completion arrives. */
  submit(request: string): SharedResult<number>;
  receive(): NativeBlockingResult | undefined;
  /** The owner has collected all work. Only idle helper threads are joined. */
  close(): void;
  /** Stop accepting work, skip queued requests and join running helpers.
   * The owner can release abandoned payloads once this returns. */
  abort(): void;
}

interface PoolState {
  readonly record: NativeSharedBlockRegistry;
  readonly requests: NativeAgentMailbox;
  readonly replies: NativeAgentMailbox;
  readonly threads: number[];
  generation: number;
  outstanding: number;
  lastId: number;
}

const PAGE = 16384;
const MAGIC = 0x54425031;
const REQUESTS = 8;
const REPLIES = 16;
const OWNER = 24;
const GENERATION = 32;
const CLOSED = 40;
const FAILED = 48;
const SEPARATOR: string = String.fromCharCode(0);

/** Allocate the queues and threads on first submission. Requests and results
 * are copied through raw mailboxes; a helper never sees the owner's heap. */
export function createNativeBlockingPool(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  threads: NativeBlockingPoolHost,
  size: number,
  capacity: number,
): NativeBlockingPool {
  if (
    !integer(size) ||
    size < 1 ||
    size > 32 ||
    !integer(capacity) ||
    capacity < size ||
    capacity > 65536
  )
    throw new RangeError("invalid blocking pool size or capacity");
  let state: PoolState | undefined;
  let closed = false;

  function wakeWorkers(pool: PoolState, all: boolean): void {
    pool.generation = (pool.generation + 1) % 4294967296;
    writeNumber(host, pool.record, GENERATION, pool.generation);
    parking.wake(pool.record.base + GENERATION, all);
  }
  function release(address: number): void {
    if (host.unmapMemory(address, PAGE) !== 0)
      throw "BLOCKING_POOL_MAPPING_RELEASE";
  }
  function stop(pool: PoolState): void {
    writeNumber(host, pool.record, CLOSED, 1);
    wakeWorkers(pool, true);
    let failed = false;
    for (let i = 0; i < pool.threads.length; i++) {
      const handle = pool.threads[i];
      if (handle === undefined) throw "BLOCKING_POOL_THREAD_INVARIANT";
      const joined = threads.join(handle);
      if (joined < 0) throw new Error("could not join blocking helper");
      if (joined !== 0) failed = true;
    }
    release(pool.requests.registry.base);
    release(pool.replies.registry.base);
    release(pool.record.base);
    if (failed) throw new Error("blocking helper thread failed");
  }
  function launch(): SharedResult<PoolState> {
    const owner = threads.wakeTarget();
    if (!integer(owner) || owner > 2147483647 || threads.entry <= 0)
      return { ok: false, error: "invalid-handle" };
    const base = host.mapMemory(PAGE);
    if (base <= 0) return { ok: false, error: "allocation-limit" };
    const record = { base, byteLength: PAGE, engineId: base };
    const requests = createNativeAgentMailbox(host, parking, base);
    if (!requests.ok) {
      release(base);
      return requests;
    }
    const replies = createNativeAgentMailbox(host, parking, base);
    if (!replies.ok) {
      release(requests.value.registry.base);
      release(base);
      return replies;
    }
    writeNumber(host, record, 0, MAGIC);
    writeNumber(host, record, REQUESTS, requests.value.registry.base);
    writeNumber(host, record, REPLIES, replies.value.registry.base);
    writeNumber(host, record, OWNER, owner);
    const pool: PoolState = {
      record,
      requests: requests.value,
      replies: replies.value,
      threads: [],
      generation: 0,
      outstanding: 0,
      lastId: 0,
    };
    for (let index = 0; index < size; index++) {
      const thread = threads.start(threads.entry, base);
      if (!integer(thread) || thread === 0) {
        stop(pool);
        return { ok: false, error: "allocation-limit" };
      }
      pool.threads.push(thread);
    }
    return { ok: true, value: pool };
  }
  function requireHealthy(pool: PoolState): void {
    if (readNumber(host, pool.record, FAILED, new Uint32Array(2)) !== 0)
      throw new Error("blocking helper could not publish its completion");
  }
  function send(pool: PoolState, request: string): SharedResult<number> {
    requireHealthy(pool);
    const id = pool.lastId + 1;
    if (pool.outstanding >= capacity || !integer(id))
      return { ok: false, error: "allocation-limit" };
    const sent = pool.requests.send(String(id) + SEPARATOR + request);
    if (!sent.ok) return sent;
    pool.lastId = id;
    pool.outstanding++;
    wakeWorkers(pool, false);
    return { ok: true, value: id };
  }
  return {
    submit: (request): SharedResult<number> => {
      if (closed) throw new Error("blocking pool is closed");
      const existing = state;
      if (existing !== undefined) return send(existing, request);
      const started = launch();
      if (!started.ok) return started;
      state = started.value;
      return send(started.value, request);
    },
    receive: (): NativeBlockingResult | undefined => {
      const pool = state;
      if (pool === undefined) return undefined;
      requireHealthy(pool);
      const message = pool.replies.receive();
      if (message === undefined) return undefined;
      const separator = message.indexOf(SEPARATOR);
      const id = Number(message.slice(0, separator));
      const status = message.charAt(separator + 1);
      if (
        separator < 1 ||
        !integer(id) ||
        id === 0 ||
        id > pool.lastId ||
        (status !== "0" && status !== "1") ||
        pool.outstanding === 0
      )
        throw "BLOCKING_POOL_COMPLETION_INVARIANT";
      pool.outstanding--;
      return {
        id,
        failed: status === "1",
        result: message.slice(separator + 2),
      };
    },
    close: (): void => {
      const pool = state;
      if (pool !== undefined && pool.outstanding !== 0)
        throw new Error("blocking pool has pending work");
      closed = true;
      state = undefined;
      if (pool !== undefined) stop(pool);
    },
    abort: (): void => {
      const pool = state;
      closed = true;
      state = undefined;
      if (pool !== undefined) stop(pool);
    },
  };
}

/** The raw hosted entry dispatches to this before creating a language realm. */
export function runNativeBlockingHelper(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  address: number,
  perform: (request: string) => string,
  signal: (owner: number) => void,
): number {
  const record = { base: address, byteLength: PAGE, engineId: address };
  const scratch = new Uint32Array(2);
  if (readNumber(host, record, 0, scratch) !== MAGIC)
    throw "BLOCKING_POOL_STARTUP_RECORD";
  const owner = readNumber(host, record, OWNER, scratch);
  try {
    const requests = attachNativeAgentMailbox(host, parking, {
      base: readNumber(host, record, REQUESTS, scratch),
      byteLength: PAGE,
      engineId: address,
    });
    const replies = attachNativeAgentMailbox(host, parking, {
      base: readNumber(host, record, REPLIES, scratch),
      byteLength: PAGE,
      engineId: address,
    });
    if (!requests.ok || !replies.ok) throw "BLOCKING_POOL_ATTACH";
    for (;;) {
      const generation = readNumber(host, record, GENERATION, scratch);
      if (readNumber(host, record, CLOSED, scratch) !== 0) return 0;
      const request = requests.value.receive();
      if (request === undefined) {
        if (readNumber(host, record, CLOSED, scratch) !== 0) return 0;
        parking.park(address + GENERATION, generation, 0);
        continue;
      }
      const separator = request.indexOf(SEPARATOR);
      if (separator <= 0) throw "BLOCKING_POOL_REQUEST_INVARIANT";
      const prefix = request.slice(0, separator + 1);
      let message: string;
      try {
        message = "0" + perform(request.slice(separator + 1));
      } catch (error) {
        message =
          "1" +
          (typeof error === "string" ? error : "blocking operation failed");
      }
      if (!replies.value.send(prefix + message).ok)
        throw "BLOCKING_POOL_COMPLETION_ALLOCATION";
      signal(owner);
    }
  } catch (error) {
    writeNumber(host, record, FAILED, 1);
    signal(owner);
    return 1;
  }
}
