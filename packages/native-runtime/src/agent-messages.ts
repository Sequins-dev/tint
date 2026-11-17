import type { SharedResult } from "@tint/js-runtime/bytes/shared";
import {
  createStringBuilder,
  appendString,
  finishString,
} from "@tint/foundation/text/string-builder";
import type { NativeWaiterParkingHost } from "./shared-waiters.ts";
import {
  integer,
  readNumber,
  writeNumber,
  compareNumber,
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
// Mappings are sized in quanta of 16 KiB and always mapped and unmapped
// whole, so the kernel rounding them to its own page (4, 16 or 64 KiB)
// is harmless.
const MAPPING_QUANTUM = 16384,
  MAGIC = 0x54414d31,
  MAGIC_AT = 8,
  ENGINE = 16,
  HEAD = 24,
  TAIL = 32,
  MESSAGE_HEADER = 16,
  MAX_UNITS = 8 * 1024 * 1024;

export function createNativeAgentMailbox(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  engineId: number,
): SharedResult<NativeAgentMailbox> {
  if (!integer(engineId) || engineId === 0)
    return { ok: false, error: "invalid-handle" };
  const base = host.mapMemory(MAPPING_QUANTUM);
  if (!integer(base) || base <= 0 || base % 8 !== 0)
    return { ok: false, error: "allocation-limit" };
  const registry = { base, byteLength: MAPPING_QUANTUM, engineId };
  writeNumber(host, registry, ENGINE, engineId);
  writeNumber(host, registry, MAGIC_AT, MAGIC);
  return { ok: true, value: mailbox(host, parking, registry) };
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
function mailbox(
  host: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  registry: NativeSharedBlockRegistry,
): NativeAgentMailbox {
  function lock(scratch: Uint32Array): void {
    while (compareNumber(host, registry, 0, 0, 1, scratch) !== 0)
      parking.park(registry.base, 1, 1000000);
  }
  function unlock(): void {
    writeNumber(host, registry, 0, 0);
    parking.wake(registry.base);
  }
  function send(message: string): SharedResult<undefined> {
    if (message.length > MAX_UNITS)
      return { ok: false, error: "allocation-limit" };
    const length = messageBytes(message.length),
      base = host.mapMemory(length);
    if (!integer(base) || base <= 0 || base % 8 !== 0)
      return { ok: false, error: "allocation-limit" };
    const payload = { base, byteLength: length, engineId: registry.engineId };
    // Payload preparation and every managed allocation precede publication.
    let published = false;
    try {
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
      const scratch = new Uint32Array(2);
      const previous = {
        base: 0,
        byteLength: MESSAGE_HEADER,
        engineId: registry.engineId,
      };
      lock(scratch);
      try {
        const tail = readNumber(host, registry, TAIL, scratch);
        if (tail === 0) writeNumber(host, registry, HEAD, base);
        else {
          // Only the fixed header of the previous payload is needed here.
          previous.base = tail;
          writeNumber(host, previous, 0, base);
        }
        writeNumber(host, registry, TAIL, base);
        published = true;
      } finally {
        unlock();
      }
    } finally {
      if (!published) host.unmapMemory(base, length);
    }
    return { ok: true, value: undefined };
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
    lock(scratch);
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
      unlock();
    }
    if (base === 0) return undefined;
    const length = messageBytes(units);
    // Detachment transfers unique payload ownership to this receiving context.
    try {
      const result = createStringBuilder();
      for (let i = 0; i < units; i++) {
        const unit = host.readSharedUnsigned(
          base,
          length,
          MESSAGE_HEADER + i * 2,
          2,
          0,
        );
        if (unit < 0) throw "NATIVE_AGENT_MESSAGE_READ";
        appendString(result, String.fromCharCode(unit));
      }
      return finishString(result);
    } finally {
      if (host.unmapMemory(base, length) !== 0)
        throw "NATIVE_AGENT_MESSAGE_RELEASE";
    }
  }
  return { registry, send, receive };
}
