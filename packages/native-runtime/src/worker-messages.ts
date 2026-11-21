import { type ByteStorage } from "@tint/js-runtime/bytes";
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
} from "@tint/js-runtime/objects";
import {
  appendString,
  createStringBuilder,
  finishString,
} from "@tint/foundation/text/string-builder";
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
interface Envelope {
  readonly payload: string;
  readonly grants: readonly Grant[];
}
export interface NativeWorkerMessageOptions {
  readonly realm: ErrorRealm;
  readonly shared: SharedBlockService | undefined;
  readonly backing: NativeWorkerBacking;
  readonly ports: NativeMessagePorts;
  portForObject(object: ObjectValue): NativeMessagePort | undefined;
  objectForPort(port: NativeMessagePort): ObjectValue;
}
export interface NativeWorkerMessages {
  send(
    target: NativeMessagePort,
    value: unknown,
    transfer: readonly unknown[],
  ): void;
  receive(packet: string): unknown;
  discard(packet: string): void;
}

function encodeEnvelope(payload: string, grants: readonly Grant[]): string {
  const result = createStringBuilder();
  function number(value: number): void {
    appendString(result, String(value) + ":");
  }
  number(grants.length);
  for (const grant of grants) {
    appendString(result, grant.kind);
    if (grant.kind === "a") {
      number(grant.backing.address);
      number(grant.backing.length);
      number(grant.backing.maximum);
      number(grant.backing.resizable ? 1 : 0);
    } else if (grant.kind === "p") {
      number(grant.port.base);
      number(grant.port.side);
      number(grant.port.generation);
    } else {
      number(grant.engineId);
      number(grant.handle);
    }
  }
  appendString(result, payload);
  return finishString(result);
}

function decodeEnvelope(packet: string): Envelope {
  let next = 0;
  function count(): number {
    const separator = packet.indexOf(":", next);
    if (separator < 0) throw "NATIVE_WORKER_PACKET_FIELD";
    const field = packet.slice(next, separator);
    const value = Number(field);
    if (!Number.isSafeInteger(value) || value < 0 || String(value) !== field)
      throw "NATIVE_WORKER_PACKET_FIELD";
    next = separator + 1;
    return value;
  }
  const grants: Grant[] = [];
  const length = count();
  if (length > packet.length - next) throw "NATIVE_WORKER_PACKET_LENGTH";
  for (let index = 0; index < length; index++) {
    const kind = packet.charAt(next++);
    if (kind === "a") {
      const address = count(),
        length = count(),
        maximum = count(),
        flag = count();
      if (flag > 1) throw "NATIVE_WORKER_PACKET_FIELD";
      grants.push({
        kind: "a",
        backing: { address, length, maximum, resizable: flag === 1 },
      });
    } else if (kind === "p") {
      const base = count(),
        side = count(),
        generation = count();
      grants.push({ kind: "p", port: { base, side, generation } });
    } else if (kind === "s") {
      const engineId = count(),
        handle = count();
      grants.push({ kind: "s", engineId, handle });
    } else throw "NATIVE_WORKER_PACKET_KIND";
  }
  return { payload: packet.slice(next), grants };
}

export function createNativeWorkerMessages(
  options: NativeWorkerMessageOptions,
): NativeWorkerMessages {
  const { realm, shared, backing, ports } = options;
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
  function send(
    target: NativeMessagePort,
    value: unknown,
    transfer: readonly unknown[],
  ): void {
    const moves: Move[] = [];
    const grants: Grant[] = [];
    const indices = new Map<number, number>();
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
    const payload = serializeWorkerValue(value, realm, {
      encode: (object): number | undefined => {
        const known = indices.get(identity(object));
        if (known !== undefined) return known;
        if (options.portForObject(object) !== undefined)
          return error("A MessagePort must be listed in the transfer list");
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
    });
    // Getters in the cloned graph can close ports or detach, grow, and
    // re-transfer buffers. Revalidate every move before mutating any source.
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
    const packet = encodeEnvelope(payload, grants);
    let moved = 0;
    function commit(): void {
      for (const move of moves) {
        if (move.kind === "a") backing.move(move.own, move.backing);
        else move.own.transfer();
        moved++;
      }
    }
    let published = false;
    try {
      if (target.inspect() === undefined) commit();
      else published = target.send(packet, commit);
    } finally {
      if (!published) {
        for (let index = 0; index < moved; index++) {
          const grant = grants[index];
          if (grant === undefined) throw "NATIVE_WORKER_TRANSFER_INDEX";
          discardGrant(grant);
        }
      }
    }
  }
  function receive(packet: string): unknown {
    const { payload, grants } = decodeEnvelope(packet);
    const used = new Set<number>();
    try {
      return deserializeWorkerValue(payload, realm, {
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
            const port = ports.adopt(grant.port);
            used.add(index);
            try {
              return options.objectForPort(port);
            } catch (reason) {
              port.close();
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
      for (let index = 0; index < grants.length; index++) {
        const grant = grants[index];
        if (grant !== undefined && !used.has(index)) discardGrant(grant);
      }
    }
  }
  return {
    send,
    receive,
    discard: (packet): void => {
      const envelope = decodeEnvelope(packet);
      for (const grant of envelope.grants) discardGrant(grant);
    },
  };
}
