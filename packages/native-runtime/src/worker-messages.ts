import {
  byteStorageData,
  createByteStorage,
  type ByteStorage,
} from "@tint/js-runtime/bytes";
import {
  attachSharedStorage,
  type SharedBlockService,
} from "@tint/js-runtime/bytes/shared";
import {
  createObject,
  deserializeWorkerValue,
  serializeWorkerValue,
  throwWorkerCloneError,
  viewObjectValue,
  type ErrorRealm,
  type OrdinaryObject,
  type ScriptPropertyKey,
  type WorkerCloneSink,
  type WorkerCloneSource,
} from "@tint/js-runtime/objects";
import {
  nativeAgentPacketHeader,
  type NativeAgentPacket,
  type NativeAgentPacketEntry,
} from "./agent-messages.ts";
import type { NativePacketMemory } from "./packet-memory.ts";
import { externalAddress } from "./ffi/primitives.ts";
import type {
  NativeWorkerBacking,
  NativeWorkerBackingGrant,
} from "./worker-backing.ts";
import type {
  NativeMessagePort,
  NativeMessagePortGrant,
  NativeMessagePorts,
} from "./worker-ports.ts";

type ObjectValue = OrdinaryObject<ScriptPropertyKey, unknown>;
interface BufferGrant {
  readonly kind: "a";
  readonly backing: NativeWorkerBackingGrant;
}
interface PortGrant {
  readonly kind: "p";
  readonly port: NativeMessagePortGrant;
}
interface SharedGrant {
  readonly kind: "s";
  readonly engineId: number;
  readonly handle: number;
}
type Grant = BufferGrant | PortGrant | SharedGrant;
interface BufferMove {
  readonly kind: "a";
  readonly own: ByteStorage;
  readonly backing: NativeWorkerBackingGrant;
}
interface PortMove {
  readonly kind: "p";
  readonly own: NativeMessagePort;
  readonly port: NativeMessagePortGrant;
}
type Move = BufferMove | PortMove;

export interface NativeWorkerMessageOptions {
  readonly realm: ErrorRealm;
  readonly shared: SharedBlockService | undefined;
  /** The `shared` block whose payload starts at an address (0 for none),
   * so a typed SharedArrayBuffer, a byte array over its block, is shared
   * rather than copied (shared-buffers.ts). */
  readonly sharedBlockAt?: (address: number) => number;
  readonly backing: NativeWorkerBacking;
  readonly ports: NativeMessagePorts;
  readonly packets: NativePacketMemory;
  portForObject(object: ObjectValue): NativeMessagePort | undefined;
  objectForPort(port: NativeMessagePort): ObjectValue;
}
export interface NativeWorkerMessages {
  send(
    target: NativeMessagePort,
    value: unknown,
    transfer: readonly unknown[],
  ): void;
  /** Decodes a received packet into this realm and releases the packet to
   * `port` before returning. */
  receive(port: NativeMessagePort, entry: NativeAgentPacketEntry): unknown;
  /** Discards the grants of a packet that will never be delivered. */
  discard(entry: NativeAgentPacketEntry): void;
}

// Payload layout after the packet header: the grant table's offset (four
// bytes, then padding to eight), the serialized value, then the grant table:
// a varint count and, per grant, a kind byte and varint fields.
const payloadStart = nativeAgentPacketHeader + 8;
const grantBuffer = 97; // a
const grantPort = 112; // p
const grantShared = 115; // s
// Cloned ArrayBuffers up to this size travel inside the packet; larger ones
// are copied once into a mapping the receiver adopts.
const inlineBufferBytes = 1048576;

function writeVarint(bytes: Uint8Array, at: number, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw "NATIVE_WORKER_PACKET_FIELD";
  let position = at;
  while (value >= 128) {
    bytes[position++] = (value % 128) + 128;
    value = Math.floor(value / 128);
  }
  bytes[position++] = value;
  return position;
}
function decodeGrants(bytes: Uint8Array, at: number, end: number): Grant[] {
  let position = at;
  function next(): number {
    if (position >= end) throw "NATIVE_WORKER_PACKET_LENGTH";
    return bytes[position++] ?? 0;
  }
  function varint(): number {
    let value = 0,
      scale = 1;
    for (;;) {
      const byte = next();
      value += (byte % 128) * scale;
      if (byte < 128) break;
      scale *= 128;
      if (scale > 9007199254740992) throw "NATIVE_WORKER_PACKET_FIELD";
    }
    if (!Number.isSafeInteger(value)) throw "NATIVE_WORKER_PACKET_FIELD";
    return value;
  }
  const grants: Grant[] = [];
  const count = varint();
  if (count > end - position) throw "NATIVE_WORKER_PACKET_LENGTH";
  for (let index = 0; index < count; index++) {
    const kind = next();
    if (kind === grantBuffer) {
      const address = varint(),
        length = varint(),
        maximum = varint(),
        flag = varint();
      if (flag > 1) throw "NATIVE_WORKER_PACKET_FIELD";
      grants.push({
        kind: "a",
        backing: { address, length, maximum, resizable: flag === 1 },
      });
    } else if (kind === grantPort) {
      const base = varint(),
        side = varint(),
        generation = varint();
      grants.push({ kind: "p", port: { base, side, generation } });
    } else if (kind === grantShared) {
      const engineId = varint(),
        handle = varint();
      grants.push({ kind: "s", engineId, handle });
    } else throw "NATIVE_WORKER_PACKET_KIND";
  }
  if (position !== end) throw "NATIVE_WORKER_PACKET_LENGTH";
  return grants;
}
/** The grant table offset recorded at the payload's start. */
function grantTable(bytes: Uint8Array, end: number): number {
  const at = nativeAgentPacketHeader;
  const offset =
    (bytes[at] ?? 0) +
    (bytes[at + 1] ?? 0) * 256 +
    (bytes[at + 2] ?? 0) * 65536 +
    (bytes[at + 3] ?? 0) * 16777216;
  if (offset < payloadStart || offset > end)
    throw "NATIVE_WORKER_PACKET_LENGTH";
  return offset;
}

export function createNativeWorkerMessages(
  options: NativeWorkerMessageOptions,
): NativeWorkerMessages {
  const { realm, shared, backing, ports, packets } = options;
  function identity(object: ObjectValue): number {
    if (object.internalIdentity === 0)
      object.internalIdentity = realm.agent.nextObjectIdentity++;
    return object.internalIdentity;
  }
  function discardGrant(grant: Grant): void {
    if (grant.kind === "a") backing.discard(grant.backing);
    else if (grant.kind === "p") ports.discard(grant.port);
  }
  function error(message: string): never {
    return throwWorkerCloneError(realm, message);
  }
  function cloneBuffer(storage: ByteStorage): NativeWorkerBackingGrant {
    const source = byteStorageData(storage);
    if (source === undefined) return error("The ArrayBuffer is detached");
    const copy = createByteStorage(
      source.length,
      storage.maxByteLength,
      storage.resizable,
      realm.bufferMaxBytes,
      backing.allocate,
    );
    if (!copy.ok) return error("The ArrayBuffer could not be cloned");
    const bytes = byteStorageData(copy.value, "write");
    const grant = backing.inspect(copy.value);
    if (bytes === undefined || grant === undefined)
      throw "NATIVE_WORKER_CLONE_BACKING";
    bytes.set(source);
    backing.move(copy.value, grant);
    return grant;
  }
  function send(
    target: NativeMessagePort,
    value: unknown,
    transfer: readonly unknown[],
  ): void {
    const moves: Move[] = [];
    const grants: Grant[] = [];
    const copies: NativeWorkerBackingGrant[] = [];
    const indices = new Map<number, number>();
    // Grant indices of typed SharedArrayBuffers' blocks, by handle.
    const blockGrants = new Map<number, number>();
    const destination = target.inspect();
    for (const entry of transfer) {
      const object = viewObjectValue(entry, realm.objectPrototype);
      if (object === undefined) return error("Invalid object in transfer list");
      const id = identity(object);
      if (indices.has(id)) return error("Duplicate object in transfer list");
      indices.set(id, grants.length);
      const storage = object.internalArrayBufferData;
      if (storage !== undefined) {
        const grant = backing.inspect(storage);
        if (grant === undefined)
          return error("The ArrayBuffer cannot be transferred");
        moves.push({ kind: "a", own: storage, backing: grant });
        grants.push({ kind: "a", backing: grant });
      } else {
        const port = options.portForObject(object);
        const grant = port?.inspect();
        if (port === undefined || grant === undefined)
          return error("Invalid object in transfer list");
        if (destination !== undefined && grant.base === destination.base)
          return error("A message port cannot transfer its own channel");
        const next = {
          base: grant.base,
          side: grant.side,
          generation: grant.generation + 1,
        };
        moves.push({ kind: "p", own: port, port: next });
        grants.push({ kind: "p", port: next });
      }
    }
    let moved = 0;
    function commit(): void {
      for (const move of moves) {
        if (move.kind === "a") backing.move(move.own, move.backing);
        else move.own.transfer();
        moved++;
      }
    }
    let published = false;
    let packet: NativeAgentPacket = target.allocate(0);
    let packetBytes = packet.byteLength;
    const sink: WorkerCloneSink = {
      bytes: packets.view(packet.base, packetBytes),
      grow: (used, needed): void => {
        const larger = target.allocate(
          Math.max(used + needed, packetBytes * 2) - nativeAgentPacketHeader,
        );
        const bytes = packets.view(larger.base, larger.byteLength);
        bytes.set(sink.bytes.subarray(0, used));
        const previous = packet;
        packet = larger;
        packetBytes = larger.byteLength;
        sink.bytes = bytes;
        target.release(previous);
      },
      writeFloat64: (offset, value): void => {
        if (packets.writeFloat64(packet.base, packetBytes, offset, value) !== 0)
          throw "NATIVE_WORKER_PACKET_WRITE";
      },
      writeString: (offset, value): void => {
        if (packets.writeString(packet.base, packetBytes, offset, value) !== 0)
          throw "NATIVE_WORKER_PACKET_WRITE";
      },
    };
    try {
      const table = serializeWorkerValue(value, realm, sink, payloadStart, {
        encode: (object): number | undefined => {
          const known = indices.get(identity(object));
          if (known !== undefined) return known;
          if (options.portForObject(object) !== undefined)
            return error("A MessagePort must be listed in the transfer list");
          const index = grants.length;
          const buffer = object.internalArrayBufferData;
          if (buffer !== undefined) {
            const bytes = byteStorageData(buffer);
            if (bytes !== undefined && bytes.length <= inlineBufferBytes)
              return undefined;
            const copy = cloneBuffer(buffer);
            copies.push(copy);
            grants.push({ kind: "a", backing: copy });
            return index;
          }
          const storage = object.internalSharedArrayBufferData;
          if (storage === undefined) return undefined;
          if (shared === undefined || storage.engineId !== shared.engineId)
            return error("The SharedArrayBuffer belongs to another engine");
          grants.push({
            kind: "s",
            engineId: storage.engineId,
            handle: storage.handle,
          });
          return index;
        },
        encodeNativeBuffer: (buffer): number | undefined => {
          const lookup = options.sharedBlockAt;
          // A typed buffer is the byte array that roots it; only a typed
          // SharedArrayBuffer's is borrowed over a block payload.
          if (
            lookup === undefined ||
            shared === undefined ||
            !(buffer instanceof Uint8Array)
          )
            return undefined;
          const address = externalAddress(buffer);
          if (address < 0) return undefined;
          const handle = lookup(address);
          if (handle === 0) return undefined;
          const known = blockGrants.get(handle);
          if (known !== undefined) return known;
          const index = grants.length;
          grants.push({ kind: "s", engineId: shared.engineId, handle });
          blockGrants.set(handle, index);
          return index;
        },
      });
      // Getters can close ports or detach, grow and re-transfer buffers.
      // Revalidate every move before mutating any source.
      for (const move of moves) {
        if (move.kind === "a") {
          const current = backing.inspect(move.own);
          if (
            current === undefined ||
            current.address !== move.backing.address ||
            current.length !== move.backing.length
          )
            return error("ArrayBuffer changed during message serialization");
        } else {
          const current = move.own.inspect();
          if (
            current === undefined ||
            current.generation + 1 !== move.port.generation
          )
            return error("MessagePort changed during message serialization");
        }
      }
      // The grant table: at most 1 + 41 bytes per grant.
      if (table + 10 + grants.length * 41 > sink.bytes.length)
        sink.grow(table, 10 + grants.length * 41);
      const bytes = sink.bytes;
      let position = writeVarint(bytes, table, grants.length);
      for (const grant of grants) {
        if (grant.kind === "a") {
          bytes[position++] = grantBuffer;
          position = writeVarint(bytes, position, grant.backing.address);
          position = writeVarint(bytes, position, grant.backing.length);
          position = writeVarint(bytes, position, grant.backing.maximum);
          position = writeVarint(
            bytes,
            position,
            grant.backing.resizable ? 1 : 0,
          );
        } else if (grant.kind === "p") {
          bytes[position++] = grantPort;
          position = writeVarint(bytes, position, grant.port.base);
          position = writeVarint(bytes, position, grant.port.side);
          position = writeVarint(bytes, position, grant.port.generation);
        } else {
          bytes[position++] = grantShared;
          position = writeVarint(bytes, position, grant.engineId);
          position = writeVarint(bytes, position, grant.handle);
        }
      }
      if (table > 4294967295) throw "NATIVE_WORKER_PACKET_LENGTH";
      const at = nativeAgentPacketHeader;
      bytes[at] = table % 256;
      bytes[at + 1] = Math.floor(table / 256) % 256;
      bytes[at + 2] = Math.floor(table / 65536) % 256;
      bytes[at + 3] = Math.floor(table / 16777216);
      const used = position - nativeAgentPacketHeader;
      if (target.inspect() === undefined) commit();
      else published = target.send(packet, used, commit);
    } finally {
      if (!published) {
        target.release(packet);
        for (const copy of copies) {
          if (copy === undefined) throw "NATIVE_WORKER_CLONE_INDEX";
          backing.discard(copy);
        }
        for (let index = 0; index < moved; index++) {
          const grant = grants[index];
          if (grant === undefined) throw "NATIVE_WORKER_TRANSFER_INDEX";
          discardGrant(grant);
        }
      }
    }
  }
  function receive(
    port: NativeMessagePort,
    entry: NativeAgentPacketEntry,
  ): unknown {
    const packet = entry.packet;
    let grants: Grant[] = [];
    const used = new Set<number>();
    try {
      const bytes = packets.view(packet.base, packet.byteLength);
      const end = nativeAgentPacketHeader + entry.used;
      const table = grantTable(bytes, end);
      grants = decodeGrants(bytes, table, end);
      const source: WorkerCloneSource = {
        bytes,
        readFloat64: (offset): number =>
          packets.readFloat64(packet.base, packet.byteLength, offset),
        readString: (offset, units): string =>
          packets.readString(packet.base, packet.byteLength, offset, units),
      };
      return deserializeWorkerValue(source, payloadStart, table, realm, {
        decode: (index): ObjectValue | undefined => {
          const grant = grants[index];
          if (grant === undefined || used.has(index)) return undefined;
          if (grant.kind === "a") {
            const object = createObject<ScriptPropertyKey, unknown>(
              realm.arrayBufferPrototype,
            );
            object.internalArrayBufferData = backing.adopt(
              grant.backing,
              realm.bufferMaxBytes,
            );
            used.add(index);
            return object;
          }
          if (grant.kind === "p") {
            const adopted = ports.adopt(grant.port);
            used.add(index);
            try {
              return options.objectForPort(adopted);
            } catch (reason) {
              adopted.close();
              throw reason;
            }
          }
          if (shared === undefined || shared.engineId !== grant.engineId)
            return undefined;
          const storage = attachSharedStorage(shared, grant.handle);
          if (!storage.ok) return undefined;
          const object = createObject<ScriptPropertyKey, unknown>(
            realm.sharedArrayBufferPrototype,
          );
          object.internalSharedArrayBufferData = storage.value;
          used.add(index);
          return object;
        },
      });
    } finally {
      try {
        for (let index = 0; index < grants.length; index++) {
          const grant = grants[index];
          if (grant !== undefined && !used.has(index)) discardGrant(grant);
        }
      } finally {
        port.release(packet);
      }
    }
  }
  return {
    send,
    receive,
    discard: (entry): void => {
      const bytes = packets.view(entry.packet.base, entry.packet.byteLength);
      const end = nativeAgentPacketHeader + entry.used;
      for (const grant of decodeGrants(bytes, grantTable(bytes, end), end))
        discardGrant(grant);
    },
  };
}
