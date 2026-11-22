import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  adoptByteStorage,
  byteStorageData,
  detachByteStorage,
  type ByteStorage,
} from "@tint/js-runtime/bytes";
import type * as objects from "@tint/js-runtime/objects";
import type {
  NativeWorkerBacking,
  NativeWorkerBackingGrant,
} from "../packages/native-runtime/src/worker-backing.ts";
import type { NativeMessagePort } from "../packages/native-runtime/src/worker-ports.ts";
import type {
  NativeAgentPacket,
  NativeAgentPacketEntry,
} from "../packages/native-runtime/src/agent-messages.ts";
import type { NativePacketMemory } from "../packages/native-runtime/src/packet-memory.ts";
import { bindHostRecordViews } from "../packages/js-runtime/test/ordinary-object-host-record-views.ts";

const views = bindHostRecordViews();
after(() => views.deregister());
const o = await import("@tint/js-runtime/objects");
const { createNativeWorkerMessages } =
  await import("../packages/native-runtime/src/worker-messages.ts");
type ObjectValue = objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;

function fixture() {
  const root = o.createObject<objects.ScriptPropertyKey, unknown>(undefined);
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: (fn, receiver, args) => {
      const result = o.callObject(fn as ObjectValue, receiver, args, undefined);
      assert.equal(result.error, "none");
      return result.value;
    },
  };
  const realm = o.createErrorRealm(root, hooks);
  const mapped = new Map<number, Uint8Array>();
  let nextAddress = 16384;
  function allocate(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    mapped.set(nextAddress, bytes);
    nextAddress += 16384;
    return bytes;
  }
  const backing: NativeWorkerBacking = {
    allocate,
    inspect(storage): NativeWorkerBackingGrant | undefined {
      for (const [address, bytes] of mapped)
        if (bytes === byteStorageData(storage))
          return {
            address,
            length: bytes.length,
            maximum: storage.maxByteLength,
            resizable: storage.resizable,
          };
      return undefined;
    },
    move(storage, grant): void {
      assert.equal(mapped.get(grant.address), byteStorageData(storage));
      detachByteStorage(storage);
    },
    adopt(grant, limit): ByteStorage {
      const bytes = mapped.get(grant.address);
      assert.ok(bytes);
      const storage = adoptByteStorage(
        bytes,
        grant.maximum,
        grant.resizable,
        limit,
        allocate,
      );
      assert.ok(storage.ok);
      return storage.value;
    },
    discard(grant): void {
      assert.ok(mapped.delete(grant.address));
    },
    close(): void {
      mapped.clear();
    },
  };
  // Packets live in ordinary byte arrays keyed by a fake address.
  const packets = new Map<number, Uint8Array>();
  let nextPacket = 1 << 30;
  function packet(base: number): Uint8Array {
    const bytes = packets.get(base);
    assert.ok(bytes, "live packet");
    return bytes;
  }
  const memory: NativePacketMemory = {
    view: (address, byteLength) => {
      const bytes = packet(address);
      assert.equal(bytes.length, byteLength);
      return bytes;
    },
    readFloat64: (address, _length, offset) =>
      new DataView(packet(address).buffer).getFloat64(offset, true),
    writeFloat64: (address, _length, offset, value) => {
      assert.equal(offset % 8, 0);
      new DataView(packet(address).buffer).setFloat64(offset, value, true);
      return 0;
    },
    readString: (address, _length, offset, units) => {
      const bytes = packet(address);
      let text = "";
      for (let index = 0; index < units; index++)
        text += String.fromCharCode(
          bytes[offset + index * 2]! + bytes[offset + index * 2 + 1]! * 256,
        );
      return text;
    },
    writeString: (address, _length, offset, value) => {
      const bytes = packet(address);
      for (let index = 0; index < value.length; index++) {
        bytes[offset + index * 2] = value.charCodeAt(index) & 255;
        bytes[offset + index * 2 + 1] = value.charCodeAt(index) >> 8;
      }
      return 0;
    },
  };
  function allocatePacket(payload: number): NativeAgentPacket {
    const byteLength = Math.ceil((32 + payload) / 16384) * 16384;
    const base = nextPacket;
    nextPacket += byteLength;
    packets.set(base, new Uint8Array(byteLength));
    return { base, byteLength, segment: 0 };
  }
  function releasePacket(value: NativeAgentPacket): void {
    assert.ok(packets.delete(value.base), "packet released once");
  }
  const messages = createNativeWorkerMessages({
    realm,
    shared: undefined,
    backing,
    packets: memory,
    ports: {
      create() {
        throw new Error("unexpected port creation");
      },
      adopt() {
        throw new Error("unexpected port adoption");
      },
      discard() {
        throw new Error("unexpected port disposal");
      },
    },
    portForObject: () => undefined,
    objectForPort: () => {
      throw new Error("unexpected port");
    },
  });
  /** A port whose sends hand `publish` the packet and its payload length. */
  function target(
    publish: (entry: NativeAgentPacketEntry, commit?: () => void) => boolean,
  ): NativeMessagePort {
    return port((packet, used, commit) => publish({ packet, used }, commit));
  }
  function port(send: NativeMessagePort["send"]): NativeMessagePort {
    return {
      allocate: allocatePacket,
      release: releasePacket,
      send,
      inspect: () => ({ base: 1, side: 0, generation: 0 }),
      take: () => undefined,
      watch: () => {
        throw new Error("unexpected watch");
      },
      transfer: () => {
        throw new Error("unexpected transfer");
      },
      close: () => {},
    };
  }
  return { root, hooks, realm, mapped, messages, packets, target, port };
}

function buffer(f: ReturnType<typeof fixture>, byteLength = 2097152) {
  const object = o.createObject(f.realm.arrayBufferPrototype);
  const bytes = new Uint8Array(byteLength);
  bytes[0] = 42;
  bytes[bytes.length - 1] = 69;
  const storage = adoptByteStorage(
    bytes,
    bytes.length * 2,
    true,
    bytes.length * 2,
    (length) => new Uint8Array(length),
  );
  assert.ok(storage.ok);
  object.internalArrayBufferData = storage.value;
  return { object, bytes, storage: storage.value };
}

test("worker messages put large cloned buffer bytes in a mapping and preserve aliases", () => {
  const f = fixture();
  const original = buffer(f);
  const graph = o.createObject(f.root);
  o.createDataProperty(graph, "left", original.object, f.hooks);
  o.createDataProperty(graph, "right", original.object, f.hooks);
  let sent: NativeAgentPacketEntry | undefined;
  const port = f.target((entry, commit) => {
    commit?.();
    sent = entry;
    return true;
  });
  f.messages.send(port, graph, []);
  assert.ok(sent !== undefined);
  assert.ok(sent.used < 256, "buffer bytes went into the packet");
  assert.equal(f.mapped.size, 1);
  original.bytes[0] = 9;
  const copy = f.messages.receive(port, sent) as ObjectValue;
  assert.equal(f.packets.size, 0, "the receiver released the packet");
  const left = o.getOwnProperty(copy, "left")?.value as ObjectValue;
  assert.equal(o.getOwnProperty(copy, "right")?.value, left);
  assert.notEqual(left, original.object);
  assert.equal(left.internalArrayBufferData?.resizable, true);
  assert.equal(
    left.internalArrayBufferData?.maxByteLength,
    original.bytes.length * 2,
  );
  assert.equal(left.internalArrayBufferData?.data?.[0], 42);
  assert.equal(left.internalArrayBufferData?.data?.at(-1), 69);
  assert.equal(byteStorageData(original.storage), original.bytes);
});

test("small cloned buffers travel inside the packet", () => {
  const f = fixture();
  const original = buffer(f, 4096);
  let sent: NativeAgentPacketEntry | undefined;
  const port = f.target((entry, commit) => {
    commit?.();
    sent = entry;
    return true;
  });
  f.messages.send(port, original.object, []);
  assert.ok(sent !== undefined);
  assert.ok(sent.used > 4096, "the bytes are in the packet");
  assert.equal(f.mapped.size, 0);
  const copy = f.messages.receive(port, sent) as ObjectValue;
  assert.equal(copy.internalArrayBufferData?.data?.[0], 42);
  assert.equal(copy.internalArrayBufferData?.data?.at(-1), 69);
  assert.equal(f.packets.size, 0);
});

test("unpublished buffer copies release their mappings and keep the original live", () => {
  const f = fixture();
  const original = buffer(f);
  f.messages.send(
    f.target((_packet, commit) => {
      assert.equal(f.mapped.size, 1);
      commit?.();
      return false;
    }),
    original.object,
    [],
  );
  assert.equal(f.mapped.size, 0);
  assert.equal(f.packets.size, 0, "the unsent packet was released");
  assert.equal(byteStorageData(original.storage), original.bytes);
});

test("a clone error releases earlier buffer copies without publishing", () => {
  const f = fixture();
  const original = buffer(f);
  const graph = o.createObject(f.root);
  o.createDataProperty(graph, "buffer", original.object, f.hooks);
  o.createDataProperty(graph, "invalid", Symbol("cannot clone"), f.hooks);
  let published = false;
  assert.throws(() =>
    f.messages.send(
      f.target(() => {
        published = true;
        return true;
      }),
      graph,
      [],
    ),
  );
  assert.equal(published, false);
  assert.equal(f.mapped.size, 0);
  assert.equal(f.packets.size, 0);
  assert.equal(byteStorageData(original.storage), original.bytes);
});
