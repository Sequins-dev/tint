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
  const messages = createNativeWorkerMessages({
    realm,
    shared: undefined,
    backing,
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
  return { root, hooks, realm, mapped, messages };
}

function target(send: NativeMessagePort["send"]): NativeMessagePort {
  return {
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

function buffer(f: ReturnType<typeof fixture>) {
  const object = o.createObject(f.realm.arrayBufferPrototype);
  const bytes = new Uint8Array(65536);
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
  o.ensureExoticSlots(object).internalArrayBufferData = storage.value;
  return { object, bytes, storage: storage.value };
}

test("worker messages put cloned buffer bytes in a mapping and preserve aliases", () => {
  const f = fixture();
  const original = buffer(f);
  const graph = o.createObject(f.root);
  o.createDataProperty(graph, "left", original.object, f.hooks);
  o.createDataProperty(graph, "right", original.object, f.hooks);
  let packet = "";
  f.messages.send(
    target((value, commit) => {
      commit?.();
      packet = value;
      return true;
    }),
    graph,
    [],
  );
  assert.ok(
    packet.length > 0 && packet.length < 256,
    "buffer bytes went into the text packet",
  );
  assert.equal(f.mapped.size, 1);
  original.bytes[0] = 9;
  const copy = f.messages.receive(packet) as ObjectValue;
  const left = o.getOwnProperty(copy, "left")?.value as ObjectValue;
  assert.equal(o.getOwnProperty(copy, "right")?.value, left);
  assert.notEqual(left, original.object);
  assert.equal(o.exoticSlots(left).internalArrayBufferData?.resizable, true);
  assert.equal(
    o.exoticSlots(left).internalArrayBufferData?.maxByteLength,
    original.bytes.length * 2,
  );
  assert.equal(o.exoticSlots(left).internalArrayBufferData?.data?.[0], 42);
  assert.equal(o.exoticSlots(left).internalArrayBufferData?.data?.at(-1), 69);
  assert.equal(byteStorageData(original.storage), original.bytes);
});

test("unpublished buffer copies release their mappings and keep the original live", () => {
  const f = fixture();
  const original = buffer(f);
  f.messages.send(
    target((_packet, commit) => {
      assert.equal(f.mapped.size, 1);
      commit?.();
      return false;
    }),
    original.object,
    [],
  );
  assert.equal(f.mapped.size, 0);
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
      target(() => {
        published = true;
        return true;
      }),
      graph,
      [],
    ),
  );
  assert.equal(published, false);
  assert.equal(f.mapped.size, 0);
  assert.equal(byteStorageData(original.storage), original.bytes);
});
