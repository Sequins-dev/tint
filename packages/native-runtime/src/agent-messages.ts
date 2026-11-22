import type { SharedResult } from "@tint/js-runtime/bytes/shared";
import type { NativeWaiterParkingHost } from "./shared-waiters.ts";
import {
  compareNumber,
  integer,
  readNumber,
  writeNumber,
  lockRegistryWord,
  unlockRegistryWord,
  type NativeSharedMemoryHost,
  type NativeSharedBlockRegistry,
} from "./shared-memory-host.ts";

/** A facade belongs to one managed context. Only the scalar descriptor and raw
 * mappings cross threads. Keep the registry mapped until every agent is joined. */
export interface NativeAgentMailbox {
  readonly registry: NativeSharedBlockRegistry;
  send(message: string): SharedResult<undefined>;
  /** Copies into the receiving heap and releases the detached raw payload. */
  receive(): string | undefined;
}
export interface NativeAgentMessage {
  /** Notify inside the queue lock so a reader cannot miss the new payload. */
  publish(notify?: () => void): void;
  discard(): void;
}
// Mappings are sized in quanta of 16 KiB and always mapped and unmapped
// whole, so the kernel rounding them to its own page (4, 16 or 64 KiB)
// is harmless.
const MAPPING_QUANTUM = 16384,
  MAGIC = 0x54414d31,
  MAGIC_AT = 8,
  ENGINE = 16,
  HEAD = 24,
  TAIL = 32,
  // Recycling mailboxes keep released single-quantum payloads on a free
  // stack instead of unmapping them (docs/design-worker-runtime.md).
  FREE = 40,
  FREE_COUNT = 48,
  RECYCLE = 56,
  // One released multi-quantum packet mapping, kept for the next large send
  // (warm pages, no mmap); its byte length follows.
  LARGE = 64,
  LARGE_BYTES = 72,
  MESSAGE_HEADER = 16,
  MAX_UNITS = 8 * 1024 * 1024;
/** Most payload blocks one recycling mailbox keeps for reuse. */
export const recycledMessageBlocks = 128;

/** With `recycle`, consumed single-quantum payloads return to the mailbox
 * for the next send; the mailbox's final owner must then call
 * releaseNativeAgentMailboxBlocks before unmapping the registry. */
export function createNativeAgentMailbox(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  engineId: number,
  recycle: boolean = false,
): SharedResult<NativeAgentMailbox> {
  if (!integer(engineId) || engineId === 0)
    return { ok: false, error: "invalid-handle" };
  const base = host.mapMemory(MAPPING_QUANTUM);
  if (!integer(base) || base <= 0 || base % 8 !== 0)
    return { ok: false, error: "allocation-limit" };
  const registry = { base, byteLength: MAPPING_QUANTUM, engineId };
  writeNumber(host, registry, ENGINE, engineId);
  writeNumber(host, registry, MAGIC_AT, MAGIC);
  if (recycle) writeNumber(host, registry, RECYCLE, 1);
  return { ok: true, value: mailbox(host, parking, registry) };
}
/** Unmaps a recycling mailbox's free payload blocks. Only the mailbox's final
 * owner calls this, after every producer and consumer has stopped. */
export function releaseNativeAgentMailboxBlocks(
  host: NativeSharedMemoryHost,
  registry: NativeSharedBlockRegistry,
): void {
  const scratch = new Uint32Array(2);
  const header = {
    base: 0,
    byteLength: MESSAGE_HEADER,
    engineId: registry.engineId,
  };
  let block = readNumber(host, registry, FREE, scratch);
  while (block !== 0) {
    header.base = block;
    const next = readNumber(host, header, 0, scratch);
    if (host.unmapMemory(block, MAPPING_QUANTUM) !== 0)
      throw "NATIVE_AGENT_MESSAGE_RELEASE";
    block = next;
  }
  writeNumber(host, registry, FREE, 0);
  writeNumber(host, registry, FREE_COUNT, 0);
  const large = readNumber(host, registry, LARGE, scratch);
  if (large !== 0) {
    if (
      host.unmapMemory(
        large,
        readNumber(host, registry, LARGE_BYTES, scratch),
      ) !== 0
    )
      throw "NATIVE_AGENT_MESSAGE_RELEASE";
    writeNumber(host, registry, LARGE, 0);
    writeNumber(host, registry, LARGE_BYTES, 0);
  }
}
/** Takes the cached large mapping when it holds `byteLength` bytes without
 * wasting more than three quarters of itself, or returns undefined. */
function takeLarge(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  registry: NativeSharedBlockRegistry,
  byteLength: number,
  scratch: Uint32Array,
): NativeAgentPacket | undefined {
  if (readNumber(host, registry, RECYCLE, scratch) === 0) return undefined;
  lock(host, parking, registry, scratch);
  try {
    const base = readNumber(host, registry, LARGE, scratch);
    if (base === 0) return undefined;
    const cached = readNumber(host, registry, LARGE_BYTES, scratch);
    if (cached < byteLength || cached > byteLength * 4) return undefined;
    writeNumber(host, registry, LARGE, 0);
    writeNumber(host, registry, LARGE_BYTES, 0);
    return { base, byteLength: cached, segment: 0 };
  } finally {
    unlock(host, parking, registry, scratch);
  }
}
/** Keeps the larger of a released large mapping and the cached one; the
 * other is unmapped. */
function returnLarge(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  registry: NativeSharedBlockRegistry,
  packet: NativeAgentPacket,
  scratch: Uint32Array,
): void {
  let unmap = packet.base,
    unmapBytes = packet.byteLength;
  if (readNumber(host, registry, RECYCLE, scratch) !== 0) {
    lock(host, parking, registry, scratch);
    try {
      const cached = readNumber(host, registry, LARGE_BYTES, scratch);
      if (cached < packet.byteLength) {
        unmap = readNumber(host, registry, LARGE, scratch);
        unmapBytes = cached;
        writeNumber(host, registry, LARGE, packet.base);
        writeNumber(host, registry, LARGE_BYTES, packet.byteLength);
      }
    } finally {
      unlock(host, parking, registry, scratch);
    }
  }
  if (unmap !== 0 && host.unmapMemory(unmap, unmapBytes) !== 0)
    throw "NATIVE_AGENT_MESSAGE_RELEASE";
}
/** Pops a free payload block, or returns 0. */
function takeBlock(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  registry: NativeSharedBlockRegistry,
  scratch: Uint32Array,
): number {
  if (readNumber(host, registry, RECYCLE, scratch) === 0) return 0;
  lock(host, parking, registry, scratch);
  try {
    const block = readNumber(host, registry, FREE, scratch);
    if (block === 0) return 0;
    const header = {
      base: block,
      byteLength: MESSAGE_HEADER,
      engineId: registry.engineId,
    };
    writeNumber(host, registry, FREE, readNumber(host, header, 0, scratch));
    writeNumber(
      host,
      registry,
      FREE_COUNT,
      readNumber(host, registry, FREE_COUNT, scratch) - 1,
    );
    return block;
  } finally {
    unlock(host, parking, registry, scratch);
  }
}
/** Pushes a consumed payload block for reuse; false when it must be unmapped. */
function returnBlock(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  registry: NativeSharedBlockRegistry,
  block: number,
  scratch: Uint32Array,
): boolean {
  if (readNumber(host, registry, RECYCLE, scratch) === 0) return false;
  lock(host, parking, registry, scratch);
  try {
    const count = readNumber(host, registry, FREE_COUNT, scratch);
    if (count >= recycledMessageBlocks) return false;
    const header = {
      base: block,
      byteLength: MESSAGE_HEADER,
      engineId: registry.engineId,
    };
    writeNumber(host, header, 0, readNumber(host, registry, FREE, scratch));
    writeNumber(host, registry, FREE, block);
    writeNumber(host, registry, FREE_COUNT, count + 1);
    return true;
  } finally {
    unlock(host, parking, registry, scratch);
  }
}
/** A binary message packet: `byteLength` bytes at `base`, owned by its
 * sender until published and by its receiver once taken. Bytes
 * [0, nativeAgentPacketHeader) hold the queue link, the payload length, the
 * packet's size and its segment; the payload follows, eight-byte aligned.
 * A small packet lives in a shared segment (a recycled block whose first
 * word counts the packets in it, plus one for its producer); a large one
 * is a whole mapping of its own (`segment` 0). Packet mailboxes carry only
 * packets. */
export interface NativeAgentPacket {
  readonly base: number;
  readonly byteLength: number;
  readonly segment: number;
}
const PACKET_HEADER = 32;
export const nativeAgentPacketHeader = PACKET_HEADER;
// Packets start after the segment's reference count, at a cache line.
const SEGMENT_HEADER = 64;
// A packet starts in a segment only with at least this much payload room.
const SEGMENT_MINIMUM = 4096;
function packetBytes(payload: number): number {
  return (
    Math.ceil((PACKET_HEADER + payload) / MAPPING_QUANTUM) * MAPPING_QUANTUM
  );
}
/** A packet with room for `payload` bytes in a mapping of its own: a recycled
 * block when one quantum suffices, else a fresh zero-filled mapping;
 * undefined when none is mapped. */
export function allocateNativeAgentPacket(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  registry: NativeSharedBlockRegistry,
  payload: number,
): NativeAgentPacket | undefined {
  if (!integer(payload) || payload > MAX_UNITS * 4) return undefined;
  const byteLength = packetBytes(payload);
  const scratch = new Uint32Array(2);
  if (byteLength > MAPPING_QUANTUM) {
    const cached = takeLarge(host, parking, registry, byteLength, scratch);
    if (cached !== undefined) return cached;
  }
  const recycled =
    byteLength === MAPPING_QUANTUM
      ? takeBlock(host, parking, registry, scratch)
      : 0;
  const base = recycled !== 0 ? recycled : host.mapMemory(byteLength);
  if (!integer(base) || base <= 0 || base % 8 !== 0) return undefined;
  return { base, byteLength, segment: 0 };
}
/** Adds `delta` to a segment's reference count and returns the new count. */
function adjustSegment(
  host: NativeSharedMemoryHost,
  segment: number,
  delta: number,
  scratch: Uint32Array,
): number {
  const window = { base: segment, byteLength: SEGMENT_HEADER, engineId: 1 };
  let count = readNumber(host, window, 0, scratch);
  for (;;) {
    const next = count + delta;
    if (next < 0) throw "NATIVE_AGENT_SEGMENT_COUNT";
    const observed = compareNumber(host, window, 0, count, next, scratch);
    if (observed === count) return next;
    count = observed;
  }
}
/** Recycle a block nobody references any more, or unmap it. */
function retireBlock(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  registry: NativeSharedBlockRegistry,
  block: number,
  scratch: Uint32Array,
): void {
  if (
    !returnBlock(host, parking, registry, block, scratch) &&
    host.unmapMemory(block, MAPPING_QUANTUM) !== 0
  )
    throw "NATIVE_AGENT_MESSAGE_RELEASE";
}
/** Return an unpublished or consumed packet: a segment packet drops its
 * segment reference; a single-quantum mapping goes back to a recycling
 * mailbox; others are unmapped. */
export function releaseNativeAgentPacket(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  registry: NativeSharedBlockRegistry,
  packet: NativeAgentPacket,
): void {
  const scratch = new Uint32Array(2);
  if (packet.segment !== 0) {
    if (adjustSegment(host, packet.segment, -1, scratch) === 0)
      retireBlock(host, parking, registry, packet.segment, scratch);
    return;
  }
  if (packet.byteLength === MAPPING_QUANTUM)
    retireBlock(host, parking, registry, packet.base, scratch);
  else returnLarge(host, parking, registry, packet, scratch);
}
/** One sender's packet allocator for one mailbox. Small packets are carved
 * from the sender's current segment, one open packet at a time; a nested or
 * growing allocation while one is open, or a large one, gets a mapping of
 * its own. */
export interface NativeAgentPacketProducer {
  allocate(payload: number): NativeAgentPacket | undefined;
  /** Close the open packet at `used` payload bytes before publishing it. */
  commit(packet: NativeAgentPacket, used: number): void;
  release(packet: NativeAgentPacket): void;
  /** Drop the producer's segment reference; the producer stays usable. */
  close(): void;
}
export function createNativeAgentPacketProducer(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  registry: NativeSharedBlockRegistry,
): NativeAgentPacketProducer {
  const scratch = new Uint32Array(2);
  let segment = 0,
    offset = 0,
    open = 0;
  function close(): void {
    if (segment === 0) return;
    const retired = segment;
    segment = 0;
    if (adjustSegment(host, retired, -1, scratch) === 0)
      retireBlock(host, parking, registry, retired, scratch);
  }
  return {
    allocate: (payload: number): NativeAgentPacket | undefined => {
      if (
        open !== 0 ||
        !integer(payload) ||
        payload > MAPPING_QUANTUM - SEGMENT_HEADER - PACKET_HEADER
      )
        return allocateNativeAgentPacket(host, parking, registry, payload);
      const room = Math.max(payload, SEGMENT_MINIMUM) + PACKET_HEADER;
      if (segment === 0 || MAPPING_QUANTUM - offset < room) {
        close();
        const block = takeBlock(host, parking, registry, scratch);
        const fresh = block !== 0 ? block : host.mapMemory(MAPPING_QUANTUM);
        if (!integer(fresh) || fresh <= 0 || fresh % 8 !== 0) return undefined;
        // The producer's own reference keeps a drained segment alive.
        writeNumber(
          host,
          { base: fresh, byteLength: SEGMENT_HEADER, engineId: 1 },
          0,
          1,
        );
        segment = fresh;
        offset = SEGMENT_HEADER;
      }
      adjustSegment(host, segment, 1, scratch);
      const packet = {
        base: segment + offset,
        byteLength: MAPPING_QUANTUM - offset,
        segment,
      };
      open = packet.base;
      return packet;
    },
    commit: (packet: NativeAgentPacket, used: number): void => {
      if (packet.base !== open) return;
      open = 0;
      offset += Math.ceil((PACKET_HEADER + used) / 8) * 8;
    },
    release: (packet: NativeAgentPacket): void => {
      if (packet.base === open) open = 0;
      releaseNativeAgentPacket(host, parking, registry, packet);
    },
    close,
  };
}
/** Link `packet`, whose payload is `used` bytes, at the tail of the queue.
 * `signal` runs inside the queue lock, where a reader that drains the queue
 * dry decides to sleep, so the two cannot miss each other; its result is
 * returned so the caller can wake the reader after the lock is released. */
export function publishNativeAgentPacket(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  registry: NativeSharedBlockRegistry,
  packet: NativeAgentPacket,
  used: number,
  signal?: () => boolean,
): boolean {
  if (!integer(used) || used > packet.byteLength - PACKET_HEADER)
    throw "NATIVE_AGENT_PACKET_LENGTH";
  const scratch = new Uint32Array(2);
  const header = {
    base: packet.base,
    byteLength: PACKET_HEADER,
    engineId: registry.engineId,
  };
  // A recycled block still holds its free-stack link where the queue keeps
  // its next pointer.
  writeNumber(host, header, 0, 0);
  writeNumber(host, header, 8, used);
  writeNumber(host, header, 16, packet.byteLength);
  writeNumber(host, header, 24, packet.segment);
  let wake = false;
  lock(host, parking, registry, scratch);
  try {
    if (signal !== undefined) wake = signal();
    const tail = readNumber(host, registry, TAIL, scratch);
    if (tail === 0) writeNumber(host, registry, HEAD, packet.base);
    else {
      header.base = tail;
      writeNumber(host, header, 0, packet.base);
    }
    writeNumber(host, registry, TAIL, packet.base);
  } finally {
    unlock(host, parking, registry, scratch);
  }
  return wake;
}
/** A packet taken from the queue and the length of its payload. */
export interface NativeAgentPacketEntry {
  readonly packet: NativeAgentPacket;
  readonly used: number;
}
/** Detach every queued packet under one lock, in order. The receiver owns
 * each and releases it with releaseNativeAgentPacket. `empty` runs inside
 * the lock when there is none (see publishNativeAgentPacket). */
export function drainNativeAgentPackets(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  registry: NativeSharedBlockRegistry,
  empty?: () => void,
): NativeAgentPacketEntry[] {
  const scratch = new Uint32Array(2);
  let head = 0;
  lock(host, parking, registry, scratch);
  try {
    head = readNumber(host, registry, HEAD, scratch);
    if (head !== 0) {
      writeNumber(host, registry, HEAD, 0);
      writeNumber(host, registry, TAIL, 0);
    } else if (empty !== undefined) empty();
  } finally {
    unlock(host, parking, registry, scratch);
  }
  const entries: NativeAgentPacketEntry[] = [];
  const header = {
    base: 0,
    byteLength: PACKET_HEADER,
    engineId: registry.engineId,
  };
  while (head !== 0) {
    header.base = head;
    const next = readNumber(host, header, 0, scratch);
    const used = readNumber(host, header, 8, scratch);
    const byteLength = readNumber(host, header, 16, scratch);
    const segment = readNumber(host, header, 24, scratch);
    if (
      (segment === 0
        ? byteLength % MAPPING_QUANTUM !== 0
        : head < segment || head + byteLength !== segment + MAPPING_QUANTUM) ||
      used > byteLength - PACKET_HEADER
    )
      throw "NATIVE_AGENT_PACKET_LENGTH";
    entries.push({ packet: { base: head, byteLength, segment }, used });
    head = next;
  }
  return entries;
}
/** Whether a packet is queued: one unlocked read, for a receiver that polls
 * before it parks. A packet published concurrently may be missed; only
 * settleNativeAgentPackets decides under the lock. */
export function nativeAgentPacketsQueued(
  host: NativeSharedMemoryHost,
  registry: NativeSharedBlockRegistry,
  scratch: Uint32Array,
): boolean {
  return readNumber(host, registry, HEAD, scratch, 0) !== 0;
}
/** Under the queue lock, whether a packet is queued; when none is, `empty`
 * runs inside the lock, as in drainNativeAgentPackets. */
export function settleNativeAgentPackets(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  registry: NativeSharedBlockRegistry,
  empty: () => void,
): boolean {
  const scratch = new Uint32Array(2);
  lock(host, parking, registry, scratch);
  try {
    if (readNumber(host, registry, HEAD, scratch) !== 0) return true;
    empty();
    return false;
  } finally {
    unlock(host, parking, registry, scratch);
  }
}
/** Relink packets detached by drainNativeAgentPackets, in order, ahead of
 * every packet queued since: a transferred or closed watcher leaves its
 * undelivered packets for the next owner. */
export function restoreNativeAgentPackets(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  registry: NativeSharedBlockRegistry,
  entries: readonly NativeAgentPacketEntry[],
): void {
  if (entries.length === 0) return;
  const scratch = new Uint32Array(2);
  const header = {
    base: 0,
    byteLength: PACKET_HEADER,
    engineId: registry.engineId,
  };
  for (let index = 0; index + 1 < entries.length; index++) {
    const entry = entries[index],
      next = entries[index + 1];
    if (entry === undefined || next === undefined)
      throw "NATIVE_AGENT_PACKET_INVARIANT";
    header.base = entry.packet.base;
    writeNumber(host, header, 0, next.packet.base);
  }
  const first = entries[0],
    last = entries[entries.length - 1];
  if (first === undefined || last === undefined)
    throw "NATIVE_AGENT_PACKET_INVARIANT";
  lock(host, parking, registry, scratch);
  try {
    const head = readNumber(host, registry, HEAD, scratch);
    header.base = last.packet.base;
    writeNumber(host, header, 0, head);
    if (head === 0) writeNumber(host, registry, TAIL, last.packet.base);
    writeNumber(host, registry, HEAD, first.packet.base);
  } finally {
    unlock(host, parking, registry, scratch);
  }
}
export function attachNativeAgentMailbox(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  registry: NativeSharedBlockRegistry,
): SharedResult<NativeAgentMailbox> {
  if (
    !integer(registry.base) ||
    registry.base <= 0 ||
    registry.base % 8 !== 0 ||
    registry.byteLength !== MAPPING_QUANTUM ||
    !integer(registry.engineId) ||
    registry.engineId === 0
  )
    return { ok: false, error: "invalid-handle" };
  const scratch = new Uint32Array(2);
  if (
    readNumber(host, registry, MAGIC_AT, scratch) !== MAGIC ||
    readNumber(host, registry, ENGINE, scratch) !== registry.engineId
  )
    return { ok: false, error: "invalid-handle" };
  return { ok: true, value: mailbox(host, parking, registry) };
}
function messageBytes(units: number): number {
  return (
    Math.ceil((MESSAGE_HEADER + units * 2) / MAPPING_QUANTUM) * MAPPING_QUANTUM
  );
}
function lock(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  registry: NativeSharedBlockRegistry,
  scratch: Uint32Array,
): void {
  lockRegistryWord(host, parking, registry, 0, scratch);
}
function unlock(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  registry: NativeSharedBlockRegistry,
  scratch: Uint32Array,
): void {
  unlockRegistryWord(host, parking, registry, 0, scratch);
}
/** Allocate and copy before entering the caller's publication lock. The
 * registry must belong to a mailbox already attached to this context. */
export function prepareNativeAgentMessage(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  registry: NativeSharedBlockRegistry,
  message: string,
): SharedResult<NativeAgentMessage> {
  if (message.length > MAX_UNITS)
    return { ok: false, error: "allocation-limit" };
  const scratch = new Uint32Array(2);
  const length = messageBytes(message.length),
    recycled =
      length === MAPPING_QUANTUM
        ? takeBlock(host, parking, registry, scratch)
        : 0,
    base = recycled !== 0 ? recycled : host.mapMemory(length);
  if (!integer(base) || base <= 0 || base % 8 !== 0)
    return { ok: false, error: "allocation-limit" };
  const payload = { base, byteLength: length, engineId: registry.engineId };
  // Payload preparation and every managed allocation precede publication.
  let prepared = false;
  try {
    // A recycled block still holds its free-stack link where the queue keeps
    // its next pointer; a fresh mapping is zero-filled.
    if (recycled !== 0) writeNumber(host, payload, 0, 0);
    writeNumber(host, payload, 8, message.length);
    for (let i = 0; i < message.length; i++)
      if (
        host.writeSharedUnsigned(
          base,
          length,
          MESSAGE_HEADER + i * 2,
          2,
          message.charCodeAt(i),
          0,
        ) !== 0
      )
        throw "NATIVE_AGENT_MESSAGE_WRITE";
    const previous = {
      base: 0,
      byteLength: MESSAGE_HEADER,
      engineId: registry.engineId,
    };
    let open = true;
    const transfer: NativeAgentMessage = {
      publish: (notify): void => {
        if (!open) throw "NATIVE_AGENT_MESSAGE_NOT_OWNED";
        lock(host, parking, registry, scratch);
        try {
          if (notify !== undefined) notify();
          const tail = readNumber(host, registry, TAIL, scratch);
          if (tail === 0) writeNumber(host, registry, HEAD, base);
          else {
            // Only the fixed header of the previous payload is needed here.
            previous.base = tail;
            writeNumber(host, previous, 0, base);
          }
          writeNumber(host, registry, TAIL, base);
          open = false;
        } finally {
          unlock(host, parking, registry, scratch);
        }
      },
      discard: (): void => {
        if (!open) return;
        open = false;
        if (host.unmapMemory(base, length) !== 0)
          throw "NATIVE_AGENT_MESSAGE_RELEASE";
      },
    };
    const result: SharedResult<NativeAgentMessage> = {
      ok: true,
      value: transfer,
    };
    prepared = true;
    return result;
  } finally {
    if (!prepared) host.unmapMemory(base, length);
  }
}
function mailbox(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  registry: NativeSharedBlockRegistry,
): NativeAgentMailbox {
  function send(message: string): SharedResult<undefined> {
    const prepared = prepareNativeAgentMessage(
      host,
      parking,
      registry,
      message,
    );
    if (!prepared.ok) return { ok: false, error: prepared.error };
    try {
      prepared.value.publish();
      return { ok: true, value: undefined };
    } finally {
      prepared.value.discard();
    }
  }
  function receive(): string | undefined {
    const scratch = new Uint32Array(2);
    const header = {
      base: 0,
      byteLength: MESSAGE_HEADER,
      engineId: registry.engineId,
    };
    let base = 0,
      units = 0;
    lock(host, parking, registry, scratch);
    try {
      base = readNumber(host, registry, HEAD, scratch);
      if (base !== 0) {
        header.base = base;
        const next = readNumber(host, header, 0, scratch);
        units = readNumber(host, header, 8, scratch);
        if (units > MAX_UNITS) throw "NATIVE_AGENT_MESSAGE_LENGTH";
        writeNumber(host, registry, HEAD, next);
        if (next === 0) writeNumber(host, registry, TAIL, 0);
      }
    } finally {
      unlock(host, parking, registry, scratch);
    }
    if (base === 0) return undefined;
    const length = messageBytes(units);
    // Detachment transfers unique payload ownership to this receiving context.
    const payload = base;
    function unit(index: number): number {
      const value = host.readSharedUnsigned(
        payload,
        length,
        MESSAGE_HEADER + index * 2,
        2,
        0,
      );
      if (value < 0) throw "NATIVE_AGENT_MESSAGE_READ";
      return value;
    }
    try {
      // Eight units per string and one join: linear in the message length.
      const parts: string[] = [];
      let i = 0;
      for (; i + 8 <= units; i += 8)
        parts.push(
          String.fromCharCode(
            unit(i),
            unit(i + 1),
            unit(i + 2),
            unit(i + 3),
            unit(i + 4),
            unit(i + 5),
            unit(i + 6),
            unit(i + 7),
          ),
        );
      for (; i < units; i++) parts.push(String.fromCharCode(unit(i)));
      return parts.join("");
    } finally {
      if (
        !(
          length === MAPPING_QUANTUM &&
          returnBlock(host, parking, registry, payload, scratch)
        ) &&
        host.unmapMemory(payload, length) !== 0
      )
        throw "NATIVE_AGENT_MESSAGE_RELEASE";
    }
  }
  return { registry, send, receive };
}
