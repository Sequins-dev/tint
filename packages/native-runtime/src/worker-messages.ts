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
  type WorkerCloneAttachments,
  type WorkerCloneSink,
  type WorkerCloneSource,
} from "@tint/js-runtime/objects";
import {
  nativeAgentPacketHeader,
  type NativeAgentPacket,
  type NativeAgentPacketEntry,
} from "./agent-messages.ts";
import type { NativePacketMemory } from "./packet-memory.ts";
import type { NativeSharedStrings } from "./shared-strings.ts";
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
/** A shared string body and one reference to it (shared-strings.ts). */
interface StringGrant {
  readonly kind: "t";
  readonly body: number;
}
type Grant = BufferGrant | PortGrant | SharedGrant | StringGrant;
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
  /** Large strings travel as shared bodies; without it they are copied. */
  readonly strings?: NativeSharedStrings;
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
const grantString = 116; // t
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
const emptyBytes = new Uint8Array(0);
const emptyPacket: NativeAgentPacket = { base: 0, byteLength: 0, segment: 0 };

interface MutableCloneSource extends WorkerCloneSource {
  bytes: Uint8Array;
}
interface SendState {
  target: NativeMessagePort | undefined;
  packet: NativeAgentPacket;
  packetBytes: number;
  moved: number;
  readonly moves: Move[];
  readonly grants: Grant[];
  readonly copies: NativeWorkerBackingGrant[];
  readonly bodies: number[];
  readonly indices: Map<number, number>;
  readonly blockGrants: Map<number, number>;
  readonly commit: () => void;
  readonly sink: WorkerCloneSink;
  readonly attachments: WorkerCloneAttachments;
}
interface ReceiveState {
  packet: NativeAgentPacket;
  readonly grants: Grant[];
  readonly used: Set<number>;
  readonly source: MutableCloneSource;
  readonly attachments: WorkerCloneAttachments;
}

function decodeGrantsInto(
  bytes: Uint8Array,
  at: number,
  end: number,
  grants: Grant[],
): Grant[] {
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
    } else if (kind === grantString) grants.push({ kind: "t", body: varint() });
    else throw "NATIVE_WORKER_PACKET_KIND";
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
  const { realm, shared, backing, ports, packets, strings } = options;
  function sharedStrings(): NativeSharedStrings {
    if (strings === undefined) throw "NATIVE_WORKER_STRING_GRANT";
    return strings;
  }
  function identity(object: ObjectValue): number {
    if (object.internalIdentity === 0)
      object.internalIdentity = realm.agent.nextObjectIdentity++;
    return object.internalIdentity;
  }
  function discardGrant(grant: Grant): void {
    if (grant.kind === "a") backing.discard(grant.backing);
    else if (grant.kind === "p") ports.discard(grant.port);
    else if (grant.kind === "t") sharedStrings().discard(grant.body);
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
  // One reusable state slot each for send and receive, popped on entry and
  // restored in finally so re-entrant postMessage calls from getters get an
  // independent state while steady traffic allocates no per-message closures
  // or tables.
  let cachedSend: SendState | undefined;
  let cachedReceive: ReceiveState | undefined;
  function createSendState(): SendState {
    const moves: Move[] = [];
    const grants: Grant[] = [];
    const copies: NativeWorkerBackingGrant[] = [];
    const bodies: number[] = [];
    const indices = new Map<number, number>();
    const blockGrants = new Map<number, number>();
    const sink: WorkerCloneSink = {
      bytes: emptyBytes,
      grow: (used, needed): void => {
        const activeTarget = state.target;
        if (activeTarget === undefined) throw "NATIVE_WORKER_PACKET_TARGET";
        const larger = activeTarget.allocate(
          Math.max(used + needed, state.packetBytes * 2) -
            nativeAgentPacketHeader,
        );
        const bytes = packets.view(larger.base, larger.byteLength);
        bytes.set(sink.bytes.subarray(0, used));
        const previous = state.packet;
        state.packet = larger;
        state.packetBytes = larger.byteLength;
        sink.bytes = bytes;
        activeTarget.release(previous);
      },
      writeFloat64: (offset, value): void => {
        if (
          packets.writeFloat64(
            state.packet.base,
            state.packetBytes,
            offset,
            value,
          ) !== 0
        )
          throw "NATIVE_WORKER_PACKET_WRITE";
      },
      writeString: (offset, value): void => {
        if (
          packets.writeString(
            state.packet.base,
            state.packetBytes,
            offset,
            value,
          ) !== 0
        )
          throw "NATIVE_WORKER_PACKET_WRITE";
      },
    };
    const attachments: WorkerCloneAttachments = {
      encode: (object): number | undefined => {
        if (indices.size !== 0) {
          const known = indices.get(identity(object));
          if (known !== undefined) return known;
        }
        if (options.portForObject(object) !== undefined)
          return error("A MessagePort must be listed in the transfer list");
        const buffer = object.internalArrayBufferData;
        if (buffer !== undefined) {
          const bytes = byteStorageData(buffer);
          if (bytes !== undefined && bytes.length <= inlineBufferBytes)
            return undefined;
          const index = grants.length;
          const copy = cloneBuffer(buffer);
          copies.push(copy);
          grants.push({ kind: "a", backing: copy });
          return index;
        }
        const storage = object.internalSharedArrayBufferData;
        if (storage === undefined) return undefined;
        if (shared === undefined || storage.engineId !== shared.engineId)
          return error("The SharedArrayBuffer belongs to another engine");
        const index = grants.length;
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
      ...(strings === undefined
        ? {}
        : { sharedStringUnits: strings.minimumUnits }),
      encodeString: (value): number | undefined => {
        const body = strings?.send(value) ?? 0;
        if (body === 0) return undefined;
        bodies.push(body);
        grants.push({ kind: "t", body });
        return grants.length - 1;
      },
    };
    const state: SendState = {
      target: undefined,
      packet: emptyPacket,
      packetBytes: 0,
      moved: 0,
      moves,
      grants,
      copies,
      bodies,
      indices,
      blockGrants,
      commit: (): void => {
        for (let index = 0; index < moves.length; index++) {
          const move = moves[index];
          if (move === undefined) continue;
          if (move.kind === "a") backing.move(move.own, move.backing);
          else move.own.transfer();
          state.moved++;
        }
      },
      sink,
      attachments,
    };
    return state;
  }
  function createReceiveState(): ReceiveState {
    const grants: Grant[] = [];
    const used = new Set<number>();
    const source: MutableCloneSource = {
      bytes: emptyBytes,
      readFloat64: (offset): number =>
        packets.readFloat64(state.packet.base, state.packet.byteLength, offset),
      readString: (offset, units): string =>
        packets.readString(
          state.packet.base,
          state.packet.byteLength,
          offset,
          units,
        ),
    };
    const attachments: WorkerCloneAttachments = {
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
        if (
          grant.kind !== "s" ||
          shared === undefined ||
          shared.engineId !== grant.engineId
        )
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
      decodeString: (index): string | undefined => {
        const grant = grants[index];
        if (grant === undefined || grant.kind !== "t" || used.has(index))
          return undefined;
        used.add(index);
        return sharedStrings().receive(grant.body);
      },
    };
    const state: ReceiveState = {
      packet: emptyPacket,
      grants,
      used,
      source,
      attachments,
    };
    return state;
  }
  function send(
    target: NativeMessagePort,
    value: unknown,
    transfer: readonly unknown[],
  ): void {
    const active = cachedSend ?? createSendState();
    cachedSend = undefined;
    const { moves, grants, copies, bodies, indices, blockGrants, sink } =
      active;
    active.target = target;
    active.moved = 0;
    let allocated = false;
    let published = false;
    try {
      if (transfer.length !== 0) {
        const destination = target.inspect();
        for (let index = 0; index < transfer.length; index++) {
          const entry = transfer[index];
          const object = viewObjectValue(entry, realm.objectPrototype);
          if (object === undefined)
            return error("Invalid object in transfer list");
          const id = identity(object);
          if (indices.has(id))
            return error("Duplicate object in transfer list");
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
      }
      const initial = target.allocate(0);
      active.packet = initial;
      active.packetBytes = initial.byteLength;
      allocated = true;
      sink.bytes = packets.view(initial.base, initial.byteLength);
      const table = serializeWorkerValue(
        value,
        realm,
        sink,
        payloadStart,
        active.attachments,
      );
      // Getters can close ports or detach, grow and re-transfer buffers.
      // Revalidate every move before mutating any source.
      if (moves.length !== 0) {
        for (let index = 0; index < moves.length; index++) {
          const move = moves[index];
          if (move === undefined) continue;
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
      }
      let position: number;
      if (grants.length === 0) {
        if (table + 1 > sink.bytes.length) sink.grow(table, 1);
        sink.bytes[table] = 0;
        position = table + 1;
      } else {
        // The grant table: at most 1 + 41 bytes per grant.
        if (table + 10 + grants.length * 41 > sink.bytes.length)
          sink.grow(table, 10 + grants.length * 41);
        const bytes = sink.bytes;
        position = writeVarint(bytes, table, grants.length);
        for (let index = 0; index < grants.length; index++) {
          const grant = grants[index];
          if (grant === undefined) continue;
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
          } else if (grant.kind === "s") {
            bytes[position++] = grantShared;
            position = writeVarint(bytes, position, grant.engineId);
            position = writeVarint(bytes, position, grant.handle);
          } else {
            bytes[position++] = grantString;
            position = writeVarint(bytes, position, grant.body);
          }
        }
      }
      if (table > 4294967295) throw "NATIVE_WORKER_PACKET_LENGTH";
      const bytes = sink.bytes;
      const at = nativeAgentPacketHeader;
      bytes[at] = table % 256;
      bytes[at + 1] = Math.floor(table / 256) % 256;
      bytes[at + 2] = Math.floor(table / 65536) % 256;
      bytes[at + 3] = Math.floor(table / 16777216);
      const used = position - nativeAgentPacketHeader;
      const commitMoves = moves.length === 0 ? undefined : active.commit;
      if (target.inspect() === undefined) {
        if (commitMoves !== undefined) commitMoves();
      } else published = target.send(active.packet, used, commitMoves);
    } finally {
      if (!published) {
        if (allocated) target.release(active.packet);
        for (let index = 0; index < copies.length; index++) {
          const copy = copies[index];
          if (copy === undefined) throw "NATIVE_WORKER_CLONE_INDEX";
          backing.discard(copy);
        }
        for (let index = 0; index < bodies.length; index++) {
          const body = bodies[index];
          if (body !== undefined) sharedStrings().discard(body);
        }
        for (let index = 0; index < active.moved; index++) {
          const grant = grants[index];
          if (grant === undefined) throw "NATIVE_WORKER_TRANSFER_INDEX";
          discardGrant(grant);
        }
      }
      if (moves.length !== 0) moves.length = 0;
      if (grants.length !== 0) grants.length = 0;
      if (copies.length !== 0) copies.length = 0;
      if (bodies.length !== 0) bodies.length = 0;
      if (indices.size !== 0) indices.clear();
      if (blockGrants.size !== 0) blockGrants.clear();
      active.moved = 0;
      active.target = undefined;
      active.packet = emptyPacket;
      active.packetBytes = 0;
      sink.bytes = emptyBytes;
      if (cachedSend === undefined) cachedSend = active;
    }
  }
  function receive(
    port: NativeMessagePort,
    entry: NativeAgentPacketEntry,
  ): unknown {
    const packet = entry.packet;
    const active = cachedReceive ?? createReceiveState();
    cachedReceive = undefined;
    active.packet = packet;
    const { grants, used, source, attachments } = active;
    try {
      const bytes = packets.view(packet.base, packet.byteLength);
      const end = nativeAgentPacketHeader + entry.used;
      const table = grantTable(bytes, end);
      if (!(table < end && bytes[table] === 0 && table + 1 === end))
        decodeGrantsInto(bytes, table, end, grants);
      source.bytes = bytes;
      return deserializeWorkerValue(
        source,
        payloadStart,
        table,
        realm,
        attachments,
      );
    } finally {
      try {
        if (grants.length !== 0) {
          for (let index = 0; index < grants.length; index++) {
            const grant = grants[index];
            if (grant !== undefined && !used.has(index)) discardGrant(grant);
          }
          grants.length = 0;
        }
        if (used.size !== 0) used.clear();
        active.packet = emptyPacket;
        source.bytes = emptyBytes;
        if (cachedReceive === undefined) cachedReceive = active;
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
      const table = grantTable(bytes, end);
      if (table < end && bytes[table] === 0 && table + 1 === end) return;
      for (const grant of decodeGrantsInto(bytes, table, end, []))
        discardGrant(grant);
    },
  };
}
