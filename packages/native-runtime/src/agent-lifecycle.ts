import type { SharedResult } from "@tint/js-runtime/bytes/shared";
import type { NativeWaiterParkingHost } from "./shared-waiters.ts";
import {
  createNativeAgentMailbox,
  attachNativeAgentMailbox,
  type NativeAgentMailbox,
} from "./agent-messages.ts";
import {
  integer,
  readNumber,
  writeNumber,
  compareNumber,
  type NativeSharedMemoryHost,
  type NativeSharedBlockRegistry,
} from "./shared-memory-host.ts";
/** Context-local trusted adapter; start receives only a raw record address. */
export interface NativeAgentThreads {
  readonly entry: number;
  start(entry: number, argument: number): number;
  join(thread: number): number;
  now(): number;
}
export interface NativeAgentCluster {
  readonly registry: NativeSharedBlockRegistry;
  start(source: string): SharedResult<number>;
  check(): void;
  broadcast(block: number, identifier: string, bigInt: boolean): void;
  getReport(): string | undefined;
  joinAll(): void;
}
export interface NativeAgentWorker {
  readonly sharedBlocks: NativeSharedBlockRegistry | undefined;
  readonly sharedWaiters: NativeSharedBlockRegistry | undefined;
  source(): string;
  running(): void;
  report(message: string): SharedResult<undefined>;
  leaving(): void;
  failed(message: string): void;
  pollBroadcast(): NativeAgentBroadcast | undefined;
}
export interface NativeAgentBroadcast {
  readonly block: number;
  readonly identifier: string;
  readonly bigInt: boolean;
}
const PAGE = 16384,
  HEADER = 128,
  ROW = 128,
  MAGIC = 0x54414731;
// Header: magic, engine, capacity, report queue. Worker: cluster descriptor,
// index, lifecycle state, native handle, source/error queue. Never heap addresses.
const STATE = 32,
  THREAD = 40,
  INBOX = 48,
  EPOCH = 56,
  ACK = 64,
  BLOCK = 72,
  BIGINT = 80,
  ERROR_READY = 88,
  ERROR_QUEUE = 96;
export function createNativeAgentCluster(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  threads: NativeAgentThreads,
  engineId: number,
  capacity: number,
  timeoutMilliseconds: number,
  shared?: {
    readonly blocks: NativeSharedBlockRegistry;
    readonly waiters: NativeSharedBlockRegistry;
  },
): SharedResult<NativeAgentCluster> {
  if (
    !integer(engineId) ||
    engineId === 0 ||
    !integer(capacity) ||
    capacity < 1 ||
    capacity > 256 ||
    !Number.isFinite(timeoutMilliseconds) ||
    timeoutMilliseconds <= 0
  )
    return { ok: false, error: "invalid-length" };
  if (
    shared !== undefined &&
    (!validGrant(shared.blocks, engineId) ||
      !validGrant(shared.waiters, engineId))
  )
    return { ok: false, error: "invalid-handle" };
  const length = Math.ceil((HEADER + capacity * ROW) / PAGE) * PAGE,
    base = host.mapMemory(length);
  if (!integer(base) || base <= 0 || base % 8 !== 0)
    return { ok: false, error: "allocation-limit" };
  const registry = { base, byteLength: length, engineId };
  const reports = createNativeAgentMailbox(host, parking, engineId);
  if (!reports.ok) {
    host.unmapMemory(base, length);
    return reports;
  }
  writeNumber(host, registry, 0, MAGIC);
  writeNumber(host, registry, 8, engineId);
  writeNumber(host, registry, 16, capacity);
  writeNumber(host, registry, 24, reports.value.registry.base);
  if (shared !== undefined) {
    writeNumber(host, registry, 32, shared.blocks.base);
    writeNumber(host, registry, 40, shared.blocks.byteLength);
    writeNumber(host, registry, 48, shared.waiters.base);
    writeNumber(host, registry, 56, shared.waiters.byteLength);
  }
  const scratch = new Uint32Array(2),
    inboxes: NativeAgentMailbox[] = [],
    errorQueues: NativeAgentMailbox[] = [],
    failures: string[] = [];
  let count = 0;
  let epoch = 0;
  function row(index: number): number {
    return HEADER + index * ROW;
  }
  function check(): void {
    for (let i = 0; i < count; i++)
      if (readNumber(host, registry, row(i) + STATE, scratch) === 4) {
        const cached = failures[i];
        if (cached !== undefined) throw cached;
        const inbox = errorQueues[i];
        let detail: string = "NATIVE_AGENT_FAILURE";
        if (
          inbox !== undefined &&
          readNumber(host, registry, row(i) + ERROR_READY, scratch) === 1
        ) {
          const received = inbox.receive();
          if (received !== undefined) detail = received;
        }
        failures[i] = detail;
        throw detail;
      }
  }
  function wait(index: number, expected: number): void {
    const started = threads.now();
    if (!Number.isFinite(started)) throw "NATIVE_AGENT_CLOCK";
    const deadline = started + timeoutMilliseconds;
    while (true) {
      check();
      const state = readNumber(host, registry, row(index) + STATE, scratch);
      if (state === expected || (expected === 2 && state === 3)) return;
      const now = threads.now();
      if (!Number.isFinite(now) || now < started) throw "NATIVE_AGENT_CLOCK";
      if (now >= deadline) throw "NATIVE_AGENT_TIMEOUT";
      parking.park(base + row(index) + STATE, state, 1000000);
    }
  }
  function start(source: string): SharedResult<number> {
    check();
    if (count >= capacity) return { ok: false, error: "allocation-limit" };
    const created = createNativeAgentMailbox(host, parking, engineId);
    if (!created.ok) return created;
    const inbox = created.value;
    const errorQueue = createNativeAgentMailbox(host, parking, engineId);
    if (!errorQueue.ok) {
      releaseUnpublished(host, inbox.registry);
      return errorQueue;
    }
    const sent = inbox.send(source);
    if (!sent.ok) {
      releaseUnpublished(host, inbox.registry);
      releaseUnpublished(host, errorQueue.value.registry);
      return sent;
    }
    const index = count,
      offset = row(index);
    inboxes.push(inbox);
    errorQueues.push(errorQueue.value);
    count++;
    writeNumber(host, registry, offset, base);
    writeNumber(host, registry, offset + 8, length);
    writeNumber(host, registry, offset + 16, engineId);
    writeNumber(host, registry, offset + 24, index);
    writeNumber(host, registry, offset + INBOX, inbox.registry.base);
    writeNumber(
      host,
      registry,
      offset + ERROR_QUEUE,
      errorQueue.value.registry.base,
    );
    writeNumber(host, registry, offset + STATE, 1);
    const thread = threads.start(threads.entry, base + offset);
    if (!integer(thread) || thread === 0) {
      failures[index] = "NATIVE_AGENT_THREAD_START";
      writeNumber(host, registry, offset + STATE, 4);
      throw "NATIVE_AGENT_THREAD_START";
    }
    writeNumber(host, registry, offset + THREAD, thread);
    wait(index, 2);
    return { ok: true, value: index };
  }
  return {
    ok: true,
    value: {
      registry,
      start,
      check,
      broadcast: (block: number, identifier: string, bigInt: boolean): void => {
        check();
        if (!integer(block) || block === 0 || epoch >= Number.MAX_SAFE_INTEGER)
          throw "NATIVE_AGENT_BROADCAST_ARGUMENT";
        const recipients: number[] = [];
        epoch++;
        for (let i = 0; i < count; i++) {
          const offset = row(i);
          if (readNumber(host, registry, offset + STATE, scratch) !== 2)
            continue;
          const inbox = inboxes[i];
          if (inbox === undefined) throw "NATIVE_AGENT_INBOX";
          const sent = inbox.send(identifier);
          if (!sent.ok) throw "NATIVE_AGENT_BROADCAST_ALLOCATION";
          writeNumber(host, registry, offset + BLOCK, block);
          writeNumber(host, registry, offset + BIGINT, bigInt ? 1 : 0);
          writeNumber(host, registry, offset + EPOCH, epoch);
          recipients.push(i);
          parking.wake(base + offset + EPOCH);
        }
        const started = threads.now(),
          deadline = started + timeoutMilliseconds;
        if (!Number.isFinite(started)) throw "NATIVE_AGENT_CLOCK";
        for (let r = 0; r < recipients.length; r++) {
          const index = recipients[r];
          if (index === undefined) throw "NATIVE_AGENT_RECIPIENT";
          const offset = row(index);
          while (true) {
            const acknowledged = readNumber(
              host,
              registry,
              offset + ACK,
              scratch,
            );
            if (acknowledged === epoch) break;
            check();
            if (readNumber(host, registry, offset + STATE, scratch) === 3)
              break;
            const now = threads.now();
            if (!Number.isFinite(now) || now < started)
              throw "NATIVE_AGENT_CLOCK";
            if (now >= deadline) throw "NATIVE_AGENT_BROADCAST_TIMEOUT";
            parking.park(base + offset + ACK, acknowledged, 1000000);
          }
        }
      },
      getReport: (): string | undefined => {
        check();
        return reports.value.receive();
      },
      joinAll: (): void => {
        for (let i = 0; i < count; i++) {
          wait(i, 3);
          const status = threads.join(
            readNumber(host, registry, row(i) + THREAD, scratch),
          );
          if (status !== 0) throw "NATIVE_AGENT_THREAD_EXIT";
        }
      },
    },
  };
}
export function attachNativeAgentWorker(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  address: number,
): SharedResult<NativeAgentWorker> {
  if (!integer(address) || address <= 0 || address % 8 !== 0)
    return { ok: false, error: "invalid-handle" };
  const scratch = new Uint32Array(2),
    record = { base: address, byteLength: ROW, engineId: 0 };
  const base = readNumber(host, record, 0, scratch),
    byteLength = readNumber(host, record, 8, scratch),
    engineId = readNumber(host, record, 16, scratch),
    index = readNumber(host, record, 24, scratch);
  if (
    base <= 0 ||
    base % 8 !== 0 ||
    byteLength < HEADER + ROW ||
    engineId === 0 ||
    address !== base + HEADER + index * ROW ||
    address + ROW > base + byteLength
  )
    return { ok: false, error: "invalid-handle" };
  const registry = { base, byteLength, engineId };
  if (
    readNumber(host, registry, 0, scratch) !== MAGIC ||
    readNumber(host, registry, 8, scratch) !== engineId ||
    index >= readNumber(host, registry, 16, scratch) ||
    readNumber(host, record, STATE, scratch) !== 1
  )
    return { ok: false, error: "invalid-handle" };
  const inbox = attachNativeAgentMailbox(host, parking, {
    base: readNumber(host, record, INBOX, scratch),
    byteLength: PAGE,
    engineId,
  });
  if (!inbox.ok) return inbox;
  const errors = attachNativeAgentMailbox(host, parking, {
    base: readNumber(host, record, ERROR_QUEUE, scratch),
    byteLength: PAGE,
    engineId,
  });
  if (!errors.ok) return errors;
  const reports = attachNativeAgentMailbox(host, parking, {
    base: readNumber(host, registry, 24, scratch),
    byteLength: PAGE,
    engineId,
  });
  if (!reports.ok) return reports;
  let consumed = false;
  const blockBase = readNumber(host, registry, 32, scratch),
    blockBytes = readNumber(host, registry, 40, scratch),
    waitBase = readNumber(host, registry, 48, scratch),
    waitBytes = readNumber(host, registry, 56, scratch);
  function transition(from: number, to: number): void {
    if (compareNumber(host, record, STATE, from, to, scratch) !== from)
      throw "NATIVE_AGENT_STATE";
    parking.wake(address + STATE);
  }
  return {
    ok: true,
    value: {
      sharedBlocks:
        blockBase === 0
          ? undefined
          : { base: blockBase, byteLength: blockBytes, engineId },
      sharedWaiters:
        waitBase === 0
          ? undefined
          : { base: waitBase, byteLength: waitBytes, engineId },
      pollBroadcast: (): NativeAgentBroadcast | undefined => {
        const epoch = readNumber(host, record, EPOCH, scratch);
        if (epoch === readNumber(host, record, ACK, scratch)) return undefined;
        const identifier = inbox.value.receive();
        if (identifier === undefined || !consumed)
          throw "NATIVE_AGENT_BROADCAST_MESSAGE";
        const block = readNumber(host, record, BLOCK, scratch),
          bigInt = readNumber(host, record, BIGINT, scratch) === 1;
        // Retrieval completes before any managed callback is invoked by the host.
        writeNumber(host, record, ACK, epoch);
        parking.wake(address + ACK);
        return { block, identifier, bigInt };
      },
      source: (): string => {
        if (consumed) throw "NATIVE_AGENT_SOURCE_CONSUMED";
        const text = inbox.value.receive();
        if (text === undefined) throw "NATIVE_AGENT_SOURCE_MISSING";
        consumed = true;
        return text;
      },
      running: (): void => transition(1, 2),
      report: (message: string): SharedResult<undefined> =>
        reports.value.send(message),
      leaving: (): void => transition(2, 3),
      failed: (message: string): void => {
        // Even diagnostic allocation failure must publish a terminal state.
        // The owner uses a fixed fallback when no copied diagnostic is available.
        const sent = errors.value.send(message);
        if (sent.ok) writeNumber(host, record, ERROR_READY, 1);
        writeNumber(host, record, STATE, 4);
        parking.wake(address + STATE);
      },
    },
  };
}
function validGrant(
  grant: NativeSharedBlockRegistry,
  engineId: number,
): boolean {
  return (
    grant.engineId === engineId &&
    integer(grant.base) &&
    grant.base > 0 &&
    grant.base % 8 === 0 &&
    integer(grant.byteLength) &&
    grant.byteLength > 0 &&
    integer(grant.base + grant.byteLength)
  );
}
function releaseUnpublished(
  host: NativeSharedMemoryHost,
  registry: NativeSharedBlockRegistry,
): void {
  if (host.unmapMemory(registry.base, registry.byteLength) !== 0)
    throw "NATIVE_AGENT_ROLLBACK";
}
