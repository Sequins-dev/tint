import type { SharedResult } from "@tint/js-runtime/bytes/shared";
import type { NativeWaiterParkingHost } from "./shared-waiters.ts";
import {
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
  MESSAGE_HEADER = 16,
  MAX_UNITS = 8 * 1024 * 1024;
/** Most payload blocks one recycling mailbox keeps for reuse. */
export const recycledMessageBlocks = 32;

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
