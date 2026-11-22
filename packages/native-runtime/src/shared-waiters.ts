import type {
  SharedResult,
  SharedNotificationBatch,
} from "@tint/js-runtime/bytes/shared";
import { parkNativeWord, wakeNativeWord } from "./intrinsics/memory.ts";
import {
  integer,
  readNumber,
  writeNumber,
  lockRegistryWord,
  unlockRegistryWord,
  type NativeSharedMemoryHost,
  type NativeSharedBlockRegistry,
} from "./shared-memory-host.ts";

/** Raw cells remain mapped through engine shutdown. Each facade and its scratch
 * belong to one managed context; only scalar table contents cross agents. */
export interface NativeWaiterParkingHost {
  park(address: number, expected: number, timeoutNanoseconds: number): number;
  wake(address: number, all?: boolean): number;
  readonly wakeAsync?: ((target: number) => void) | undefined;
}
export function nativeWaiterParkingHost(
  wakeAsync?: (target: number) => void,
): NativeWaiterParkingHost {
  return {
    park: (address, expected, timeout): number =>
      parkNativeWord(address, expected, timeout),
    wake: (address, all): number =>
      wakeNativeWord(address, all === true ? 1 : 0),
    wakeAsync,
  };
}
export interface NativeWaitLocation {
  readonly engineId: number;
  readonly blockId: number;
  /** Trusted stable backing grant, obtained after view validation. Never a heap. */
  readonly address: number;
  readonly byteLength: number;
  readonly byteOffset: number;
  readonly width: 4 | 8;
}
export type NativeWaitState = "waiting" | "notified" | "timed-out";
export interface NativeWaitRegistration {
  readonly state: "waiting" | "not-equal" | "timed-out";
  /** Zero for immediate results; otherwise a never-reissued registration token. */
  readonly ticket: number;
}
export interface NativeWaitEvents {
  /** Sample before checking completion records, then park on that version. */
  eventVersion(): number;
  parkEvents(version: number, timeoutNanoseconds: number): SharedResult<number>;
  /** Wake checkpoints to observe an embedding event such as worker failure. */
  interruptEvents(): void;
}
export interface NativeWaitRegistry extends NativeWaitEvents {
  notifyOrdered(
    blockId: number,
    offset: number,
    width: 4 | 8,
    count: number,
  ): SharedResult<SharedNotificationBatch>;
  readonly registry: NativeSharedBlockRegistry;
  register(
    location: NativeWaitLocation,
    lo: number,
    hi: number,
    zeroTimeout: boolean,
  ): SharedResult<NativeWaitRegistration>;
  notify(
    blockId: number,
    offset: number,
    width: 4 | 8,
    count: number,
  ): SharedResult<number>;
  poll(ticket: number): SharedResult<NativeWaitState>;
  order(ticket: number): SharedResult<number>;
  /** Publish an owning reactor's wake target while the wait is live. */
  setWakeTarget(ticket: number, target: number): SharedResult<undefined>;
  expire(ticket: number): SharedResult<boolean>;
  take(ticket: number): SharedResult<NativeWaitState>;
  park(ticket: number, timeoutNanoseconds: number): SharedResult<number>;
}
const MAGIC = 0x54575231,
  HEADER = 64,
  ROW = 48;
// Header: lock, magic, capacity, next ticket, engine. Row: state, ticket,
// block identity, absolute byte offset. Width never participates in queue identity.
const LOCK = 0,
  MAGIC_AT = 8,
  CAPACITY = 16,
  NEXT = 24,
  ENGINE = 32,
  NEXT_COMPLETION = 40,
  EVENT_VERSION = 48,
  // One past the last occupied row, maintained under the registry lock.
  USED_ROWS = 56;
const STATE = 0,
  TICKET = 8,
  BLOCK = 16,
  OFFSET = 24,
  COMPLETION = 32,
  WAKE_TARGET = 40;
function word(value: number): boolean {
  return integer(value) && value <= 4294967295;
}
export function createNativeWaitRegistry(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  engineId: number,
  capacity: number,
): SharedResult<NativeWaitRegistry> {
  if (
    !integer(engineId) ||
    engineId === 0 ||
    !integer(capacity) ||
    capacity < 1 ||
    capacity > 65536
  )
    return { ok: false, error: "invalid-length" };
  // Whole 16 KiB quanta; the kernel rounds the mapping to its own page.
  const length = Math.ceil((HEADER + capacity * ROW) / 16384) * 16384;
  const base = host.mapMemory(length);
  if (!integer(base) || base <= 0 || base % 8 !== 0 || !integer(base + length))
    return { ok: false, error: "allocation-limit" };
  const registry = { base, byteLength: length, engineId };
  writeNumber(host, registry, CAPACITY, capacity);
  writeNumber(host, registry, ENGINE, engineId);
  writeNumber(host, registry, MAGIC_AT, MAGIC);
  return { ok: true, value: facade(host, parking, registry, capacity) };
}
export function attachNativeWaitRegistry(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  registry: NativeSharedBlockRegistry,
): SharedResult<NativeWaitRegistry> {
  if (
    !integer(registry.base) ||
    registry.base <= 0 ||
    registry.base % 8 !== 0 ||
    !integer(registry.byteLength) ||
    registry.byteLength < HEADER ||
    !integer(registry.engineId) ||
    registry.engineId === 0
  )
    return { ok: false, error: "invalid-handle" };
  const scratch = new Uint32Array(2);
  const capacity = readNumber(host, registry, CAPACITY, scratch);
  if (
    readNumber(host, registry, MAGIC_AT, scratch) !== MAGIC ||
    readNumber(host, registry, ENGINE, scratch) !== registry.engineId ||
    capacity < 1 ||
    capacity > 65536 ||
    HEADER + capacity * ROW > registry.byteLength
  )
    return { ok: false, error: "invalid-handle" };
  return { ok: true, value: facade(host, parking, registry, capacity) };
}
function facade(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  registry: NativeSharedBlockRegistry,
  capacity: number,
): NativeWaitRegistry {
  function lock(scratch: Uint32Array): void {
    lockRegistryWord(host, parking, registry, LOCK, scratch);
  }
  const unlockScratch = new Uint32Array(2);
  function unlock(): void {
    unlockRegistryWord(host, parking, registry, LOCK, unlockScratch);
  }
  function find(ticket: number, scratch: Uint32Array): number {
    const used = readNumber(host, registry, USED_ROWS, scratch);
    for (let i = 0; i < used; i++) {
      const row = HEADER + i * ROW;
      if (
        readNumber(host, registry, row + TICKET, scratch) === ticket &&
        readNumber(host, registry, row + STATE, scratch) !== 0
      )
        return row;
    }
    return -1;
  }
  function state(code: number): NativeWaitState {
    if (code === 1) return "waiting";
    if (code === 2) return "notified";
    if (code === 3) return "timed-out";
    throw "NATIVE_WAITER_STATE";
  }
  function validTicket(ticket: number): boolean {
    return integer(ticket) && ticket > 0;
  }
  function register(
    location: NativeWaitLocation,
    lo: number,
    hi: number,
    zeroTimeout: boolean,
  ): SharedResult<NativeWaitRegistration> {
    if (
      location.engineId !== registry.engineId ||
      !integer(location.blockId) ||
      location.blockId === 0
    )
      return { ok: false, error: "invalid-handle" };
    const width = location.width;
    if (width !== 4 && width !== 8)
      return { ok: false, error: "invalid-width" };
    if (
      !integer(location.address) ||
      location.address === 0 ||
      !integer(location.byteLength) ||
      !integer(location.byteOffset) ||
      !integer(location.address + location.byteLength) ||
      location.byteOffset > location.byteLength ||
      width > location.byteLength - location.byteOffset ||
      (location.address + location.byteOffset) % width !== 0
    )
      return { ok: false, error: "invalid-range" };
    if (!word(lo) || !word(hi) || (width === 4 && hi !== 0))
      return { ok: false, error: "invalid-value" };
    const scratch = new Uint32Array(2);
    lock(scratch);
    let matches = false,
      fault = false;
    if (width === 4) {
      const observed = host.readSharedUnsigned(
        location.address,
        location.byteLength,
        location.byteOffset,
        4,
        1,
      );
      fault = observed < 0;
      matches = observed === lo;
    } else {
      fault =
        host.readSharedWord64(
          location.address,
          location.byteLength,
          location.byteOffset,
          1,
          scratch,
        ) !== 0;
      matches = scratch[0] === lo && scratch[1] === hi;
    }
    let result: "waiting" | "not-equal" | "timed-out" = "not-equal",
      ticket = 0,
      full = false;
    if (!fault && matches) {
      result = "timed-out";
      if (!zeroTimeout) {
        const used = readNumber(host, registry, USED_ROWS, scratch);
        const end = HEADER + used * ROW;
        let free = end;
        for (let at: number = HEADER; at < end; at += ROW)
          if (readNumber(host, registry, at + STATE, scratch) === 0) {
            free = at;
            break;
          }
        const next = readNumber(host, registry, NEXT, scratch) + 1;
        full = free >= HEADER + capacity * ROW || !integer(next);
        if (!full) {
          ticket = next;
          result = "waiting";
          writeNumber(host, registry, NEXT, next);
          writeNumber(host, registry, free + TICKET, ticket);
          writeNumber(host, registry, free + BLOCK, location.blockId);
          writeNumber(host, registry, free + OFFSET, location.byteOffset);
          writeNumber(host, registry, free + COMPLETION, 0);
          writeNumber(host, registry, free + WAKE_TARGET, 0);
          writeNumber(host, registry, free + STATE, 1);
          if (free === end) writeNumber(host, registry, USED_ROWS, used + 1);
        }
      }
    }
    unlock();
    if (fault) throw "NATIVE_WAITER_PAYLOAD_READ";
    if (full) return { ok: false, error: "allocation-limit" };
    return { ok: true, value: { state: result, ticket } };
  }
  function notifyOrdered(
    block: number,
    offset: number,
    width: 4 | 8,
    count: number,
  ): SharedResult<SharedNotificationBatch> {
    if (!integer(block) || block === 0)
      return { ok: false, error: "invalid-handle" };
    if (width !== 4 && width !== 8)
      return { ok: false, error: "invalid-width" };
    if (!integer(offset) || offset % width !== 0)
      return { ok: false, error: "invalid-range" };
    if (count < 0 || (count !== Infinity && !integer(count)))
      return { ok: false, error: "invalid-value" };
    const scratch = new Uint32Array(2);
    lock(scratch);
    try {
      const used = readNumber(host, registry, USED_ROWS, scratch);
      const firstCompletion =
        readNumber(host, registry, NEXT_COMPLETION, scratch) + 1;
      let notified = 0;
      while (notified < count) {
        let row = -1,
          first = Infinity;
        for (let i = 0; i < used; i++) {
          const at = HEADER + i * ROW;
          if (
            readNumber(host, registry, at + STATE, scratch) === 1 &&
            readNumber(host, registry, at + BLOCK, scratch) === block &&
            readNumber(host, registry, at + OFFSET, scratch) === offset
          ) {
            const ticket = readNumber(host, registry, at + TICKET, scratch);
            if (ticket < first) {
              first = ticket;
              row = at;
            }
          }
        }
        if (row < 0) break;
        complete(row, scratch);
        writeNumber(host, registry, row + STATE, 2);
        parking.wake(registry.base + row + STATE);
        const target = readNumber(host, registry, row + WAKE_TARGET, scratch);
        if (target !== 0) {
          const wake = parking.wakeAsync;
          if (wake === undefined) throw "NATIVE_WAITER_ASYNC_WAKE";
          wake(target - 1);
        }
        notified++;
      }
      const last = readNumber(host, registry, NEXT_COMPLETION, scratch);
      if (notified > 0) signalEvents(scratch);
      return {
        ok: true,
        value: {
          count: notified,
          first: notified === 0 ? 0 : firstCompletion,
          last: notified === 0 ? 0 : last,
        },
      };
    } finally {
      unlock();
    }
  }
  function notify(
    block: number,
    offset: number,
    width: 4 | 8,
    count: number,
  ): SharedResult<number> {
    const result = notifyOrdered(block, offset, width, count);
    return result.ok ? { ok: true, value: result.value.count } : result;
  }
  function inspect(
    ticket: number,
    consume: boolean,
  ): SharedResult<NativeWaitState> {
    if (!validTicket(ticket)) return { ok: false, error: "invalid-handle" };
    const scratch = new Uint32Array(2);
    lock(scratch);
    const row = find(ticket, scratch);
    const code = row < 0 ? 0 : readNumber(host, registry, row + STATE, scratch);
    if (consume && row >= 0 && code !== 1) {
      writeNumber(host, registry, row + TICKET, 0);
      writeNumber(host, registry, row + STATE, 0);
      const used = readNumber(host, registry, USED_ROWS, scratch);
      let end = used;
      if (row === HEADER + (used - 1) * ROW) {
        do end--;
        while (
          end > 0 &&
          readNumber(
            host,
            registry,
            HEADER + (end - 1) * ROW + STATE,
            scratch,
          ) === 0
        );
        writeNumber(host, registry, USED_ROWS, end);
      }
    }
    unlock();
    if (row < 0) return { ok: false, error: "invalid-handle" };
    return { ok: true, value: state(code) };
  }
  function expire(ticket: number): SharedResult<boolean> {
    if (!validTicket(ticket)) return { ok: false, error: "invalid-handle" };
    const scratch = new Uint32Array(2);
    lock(scratch);
    const row = find(ticket, scratch);
    const won =
      row >= 0 && readNumber(host, registry, row + STATE, scratch) === 1;
    if (won) {
      complete(row, scratch);
      writeNumber(host, registry, row + STATE, 3);
      parking.wake(registry.base + row + STATE);
    }
    unlock();
    if (row < 0) return { ok: false, error: "invalid-handle" };
    return { ok: true, value: won };
  }
  function complete(row: number, scratch: Uint32Array): void {
    const sequence = readNumber(host, registry, NEXT_COMPLETION, scratch) + 1;
    writeNumber(host, registry, NEXT_COMPLETION, sequence);
    writeNumber(host, registry, row + COMPLETION, sequence);
  }
  function signalEvents(scratch: Uint32Array): void {
    const next = readNumber(host, registry, EVENT_VERSION, scratch) + 1;
    writeNumber(host, registry, EVENT_VERSION, next % 4294967296);
    parking.wake(registry.base + EVENT_VERSION, true);
  }
  function eventVersion(): number {
    const version = host.readSharedUnsigned(
      registry.base,
      registry.byteLength,
      EVENT_VERSION,
      4,
      1,
    );
    if (version < 0) throw "NATIVE_WAITER_EVENT_VERSION";
    return version;
  }
  function interruptEvents(): void {
    const scratch = new Uint32Array(2);
    lock(scratch);
    try {
      signalEvents(scratch);
    } finally {
      unlock();
    }
  }
  function parkEvents(version: number, timeout: number): SharedResult<number> {
    if (!word(version) || !integer(timeout))
      return { ok: false, error: "invalid-value" };
    return {
      ok: true,
      value:
        version !== eventVersion()
          ? 0
          : parking.park(registry.base + EVENT_VERSION, version, timeout),
    };
  }
  function order(ticket: number): SharedResult<number> {
    if (!validTicket(ticket)) return { ok: false, error: "invalid-handle" };
    const scratch = new Uint32Array(2);
    lock(scratch);
    const row = find(ticket, scratch);
    const sequence =
      row < 0 ? 0 : readNumber(host, registry, row + COMPLETION, scratch);
    unlock();
    return row < 0
      ? { ok: false, error: "invalid-handle" }
      : { ok: true, value: sequence };
  }
  function setWakeTarget(
    ticket: number,
    target: number,
  ): SharedResult<undefined> {
    if (!validTicket(ticket)) return { ok: false, error: "invalid-handle" };
    const wake = parking.wakeAsync;
    if (wake === undefined || !integer(target) || target >= 2147483647)
      return { ok: false, error: "invalid-value" };
    const scratch = new Uint32Array(2);
    lock(scratch);
    try {
      const row = find(ticket, scratch);
      if (row < 0) return { ok: false, error: "invalid-handle" };
      if (readNumber(host, registry, row + STATE, scratch) === 1)
        writeNumber(host, registry, row + WAKE_TARGET, target + 1);
      else wake(target);
      return { ok: true, value: undefined };
    } finally {
      unlock();
    }
  }
  function park(ticket: number, timeout: number): SharedResult<number> {
    if (!validTicket(ticket)) return { ok: false, error: "invalid-handle" };
    if (!integer(timeout)) return { ok: false, error: "invalid-value" };
    const scratch = new Uint32Array(2);
    lock(scratch);
    const row = find(ticket, scratch);
    unlock();
    if (row < 0) return { ok: false, error: "invalid-handle" };
    return {
      ok: true,
      value: parking.park(registry.base + row + STATE, 1, timeout),
    };
  }
  return {
    registry,
    register,
    order,
    setWakeTarget,
    notify,
    notifyOrdered,
    poll: (ticket) => inspect(ticket, false),
    take: (ticket) => inspect(ticket, true),
    expire,
    park,
    eventVersion,
    parkEvents,
    interruptEvents,
  };
}
