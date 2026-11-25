import assert from "node:assert/strict";
import { after, test } from "node:test";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
import type * as objects from "../src/objects/index.ts";

const views = bindHostRecordViews();
after(() => views.deregister());
const o = await import("../src/objects/index.ts");
const codec = await import("../src/objects/structured-clone.ts");
type ObjectValue = objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;

function isolate() {
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
  return { root, hooks, realm: o.createErrorRealm(root, hooks) };
}

/** An in-memory packet: native hosts back the same interfaces with raw
 * mappings. */
function serialize(
  value: unknown,
  realm: objects.ErrorRealm,
  attachments?: objects.WorkerCloneAttachments,
): Uint8Array {
  const sink: objects.WorkerCloneSink = {
    bytes: new Uint8Array(8),
    grow(used, needed) {
      const bytes = new Uint8Array(
        Math.max(sink.bytes.length * 2, used + needed),
      );
      bytes.set(sink.bytes.subarray(0, used));
      sink.bytes = bytes;
    },
    writeFloat64(offset, value) {
      assert.equal(offset % 8, 0, "aligned binary64");
      new DataView(sink.bytes.buffer).setFloat64(offset, value, true);
    },
    writeString(offset, value) {
      for (let index = 0; index < value.length; index++) {
        sink.bytes[offset + index * 2] = value.charCodeAt(index) & 255;
        sink.bytes[offset + index * 2 + 1] = value.charCodeAt(index) >> 8;
      }
    },
  };
  const end = codec.serializeWorkerValue(value, realm, sink, 0, attachments);
  return sink.bytes.slice(0, end);
}
function deserialize(
  bytes: Uint8Array,
  realm: objects.ErrorRealm,
  attachments?: objects.WorkerCloneAttachments,
): unknown {
  const source: objects.WorkerCloneSource = {
    bytes,
    readFloat64: (offset) =>
      new DataView(bytes.buffer).getFloat64(offset, true),
    readString: (offset, units) => {
      let text = "";
      for (let index = 0; index < units; index++)
        text += String.fromCharCode(
          bytes[offset + index * 2]! + bytes[offset + index * 2 + 1]! * 256,
        );
      return text;
    },
  };
  return codec.deserializeWorkerValue(
    source,
    0,
    bytes.length,
    realm,
    attachments,
  );
}

test("worker clone carries cyclic aliases across realm boundaries", () => {
  const source = isolate();
  const target = isolate();
  const outer = o.createObject(source.root);
  const inner = o.createObject(source.root);
  o.createDataProperty(outer, "left", inner, source.hooks);
  o.createDataProperty(outer, "right", inner, source.hooks);
  o.createDataProperty(inner, "parent", outer, source.hooks);
  o.createDataProperty(inner, "zero", -0, source.hooks);
  o.createDataProperty(inner, "nan", NaN, source.hooks);
  o.createDataProperty(inner, "units", "\ud800\u0000", source.hooks);
  const copy = deserialize(
    serialize(outer, source.realm),
    target.realm,
  ) as ObjectValue;
  const child = o.getOwnProperty(copy, "left")!.value as ObjectValue;
  assert.equal(copy.prototype, target.root);
  assert.notEqual(child, inner);
  assert.equal(o.getOwnProperty(copy, "right")!.value, child);
  assert.equal(o.getOwnProperty(child, "parent")!.value, copy);
  assert.ok(Object.is(o.getOwnProperty(child, "zero")!.value, -0));
  assert.ok(Number.isNaN(o.getOwnProperty(child, "nan")!.value));
  assert.equal(o.getOwnProperty(child, "units")!.value, "\ud800\u0000");
});

test("worker clone preserves Error causes and shared backing among copied views", () => {
  const source = isolate();
  const target = isolate();
  const object = o.createObject(source.root);
  const buffer = o.createObject(source.realm.arrayBufferPrototype);
  const bytes = new Uint8Array([10, 20, 30, 40]);
  const storage = {
    kind: "ordinary" as const,
    data: bytes,
    immutable: false,
    maxByteLength: 4,
    resizable: false,
    allocationLimit: 4,
  };
  o.ensureExoticSlots(buffer).internalArrayBufferData = storage;
  const view = o.createTypedArrayView(
    source.realm.typedArrayPrototypes.get("Uint8"),
    {
      buffer,
      storage,
      byteOffset: 1,
      length: 2,
      kind: "Uint8",
      endian: "little",
    },
    source.realm,
    source.hooks,
  );
  const error = o.createRuntimeError(source.realm, "type");
  o.createDataProperty(error, "message", "failure", source.hooks);
  o.createDataProperty(error, "cause", object, source.hooks);
  o.createDataProperty(object, "first", view, source.hooks);
  o.createDataProperty(object, "backing", buffer, source.hooks);
  o.createDataProperty(object, "error", error, source.hooks);
  const copy = deserialize(
    serialize(object, source.realm),
    target.realm,
  ) as ObjectValue;
  const clonedView = o.getOwnProperty(copy, "first")!.value as ObjectValue;
  const backing = o.getOwnProperty(copy, "backing")!.value as ObjectValue;
  assert.equal(
    o.exoticSlots(clonedView).internalTypedArrayData?.buffer,
    backing,
  );
  assert.equal(o.exoticSlots(clonedView).internalTypedArrayData?.byteOffset, 1);
  assert.equal(o.exoticSlots(clonedView).internalTypedArrayData?.length, 2);
  assert.notEqual(backing, buffer);
  assert.deepEqual(o.exoticSlots(backing).internalArrayBufferData?.data, bytes);
  const cloneError = o.getOwnProperty(copy, "error")!.value as ObjectValue;
  assert.equal(cloneError.prototype, target.realm.prototypes.get("type"));
  assert.equal(o.getOwnProperty(cloneError, "message")!.value, "failure");
  assert.equal(o.getOwnProperty(cloneError, "cause")!.value, copy);
});

test("worker clone carries every number, long keys and dates", () => {
  const source = isolate();
  const target = isolate();
  const values = [
    0,
    -0,
    1,
    -1,
    2147483647,
    -2147483648,
    2147483648,
    -2147483649,
    4294967296,
    Number.MAX_SAFE_INTEGER,
    -Number.MAX_SAFE_INTEGER,
    0.1,
    -2.5,
    1e300,
    -1e-300,
    5e-324,
    Number.MAX_VALUE,
    Infinity,
    -Infinity,
    NaN,
  ];
  const array = o.createArrayObject<objects.ScriptPropertyKey, unknown>(
    values.length,
    source.realm.arrayPrototype,
    source.realm.arrayHooks,
    source.hooks,
  );
  values.forEach((value, index) =>
    o.createDataProperty(array, String(index), value, source.hooks),
  );
  // A key longer than one 16-bit unit of length, and a date.
  const key = "k".repeat(70000);
  const holder = o.createObject(source.root);
  o.createDataProperty(holder, key, array, source.hooks);
  const date = o.createObject(source.realm.datePrototype);
  o.ensureExoticSlots(date).internalDateValue = -8.64e15;
  o.createDataProperty(holder, "date", date, source.hooks);
  const invalid = o.createObject(source.realm.datePrototype);
  o.ensureExoticSlots(invalid).internalDateValue = NaN;
  o.createDataProperty(holder, "invalid", invalid, source.hooks);
  const copy = deserialize(
    serialize(holder, source.realm),
    target.realm,
  ) as ObjectValue;
  const cloned = o.getOwnProperty(copy, key)!.value as ObjectValue;
  assert.equal(o.getOwnProperty(cloned, "length")!.value, values.length);
  values.forEach((value, index) =>
    assert.ok(
      Object.is(o.getOwnProperty(cloned, String(index))!.value, value),
      String(index),
    ),
  );
  const copiedDate = o.getOwnProperty(copy, "date")!.value as ObjectValue;
  assert.equal(o.exoticSlots(copiedDate).internalDateValue, -8.64e15);
  const copiedInvalid = o.getOwnProperty(copy, "invalid")!.value as ObjectValue;
  assert.ok(Number.isNaN(o.exoticSlots(copiedInvalid).internalDateValue));
});

test("worker clone keeps length-tracking views and rejects truncated packets", () => {
  const source = isolate();
  const target = isolate();
  const buffer = o.createObject(source.realm.arrayBufferPrototype);
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const storage = {
    kind: "ordinary" as const,
    data: bytes,
    immutable: false,
    maxByteLength: 16,
    resizable: true,
    allocationLimit: 16,
  };
  o.ensureExoticSlots(buffer).internalArrayBufferData = storage;
  const tracking = o.createTypedArrayView(
    source.realm.typedArrayPrototypes.get("Uint16"),
    {
      buffer,
      storage,
      byteOffset: 2,
      length: undefined,
      kind: "Uint16",
      endian: "little",
    },
    source.realm,
    source.hooks,
  );
  const packet = serialize(tracking, source.realm);
  const copy = deserialize(packet, target.realm) as ObjectValue;
  assert.equal(o.exoticSlots(copy).internalTypedArrayData?.length, undefined);
  assert.equal(o.exoticSlots(copy).internalTypedArrayData?.byteOffset, 2);
  const backing = o.exoticSlots(copy).internalTypedArrayData
    ?.buffer as ObjectValue;
  assert.equal(
    o.exoticSlots(backing).internalArrayBufferData?.maxByteLength,
    16,
  );
  assert.equal(o.exoticSlots(backing).internalArrayBufferData?.resizable, true);
  for (let cut = 0; cut < packet.length; cut++)
    assert.throws(() => deserialize(packet.slice(0, cut), target.realm));
});

function arrayOf(
  realm: objects.ErrorRealm,
  hooks: objects.ObjectHooks<unknown>,
  values: readonly unknown[],
): ObjectValue {
  const array = o.createArrayObject<objects.ScriptPropertyKey, unknown>(
    0,
    realm.arrayPrototype,
    realm.arrayHooks,
    hooks,
  );
  values.forEach((value, index) =>
    o.createDataProperty(array, String(index), value, hooks),
  );
  return array;
}

test("packed number arrays travel as one binary64 run with their properties", () => {
  const source = isolate();
  const target = isolate();
  const numbers = [0, -0, 1.5, NaN, -Infinity, 2 ** 53, 7];
  const array = arrayOf(source.realm, source.hooks, numbers);
  assert.ok(array.internalArrayElements?.numbers !== undefined);
  o.createDataProperty(array, "label", "tail", source.hooks);
  const packet = serialize(array, source.realm);
  // The tag, varint length and count, padding, then the run.
  assert.equal(packet[0], "P".charCodeAt(0));
  const copy = deserialize(packet, target.realm) as ObjectValue;
  assert.ok(copy.internalArrayElements?.numbers !== undefined);
  assert.equal(o.getOwnProperty(copy, "length")!.value, numbers.length);
  numbers.forEach((value, index) =>
    assert.ok(Object.is(o.getOwnProperty(copy, String(index))!.value, value)),
  );
  assert.equal(o.getOwnProperty(copy, "label")!.value, "tail");
  const empty = deserialize(
    serialize(arrayOf(source.realm, source.hooks, []), source.realm),
    target.realm,
  ) as ObjectValue;
  assert.equal(o.getOwnProperty(empty, "length")!.value, 0);
});

test("dense arrays skip elements a getter removes, like EnumerableOwnProperties", () => {
  const source = isolate();
  const target = isolate();
  const array = arrayOf(source.realm, source.hooks, ["a", "b", "c", "d"]);
  const trap = o.createObject(source.root);
  // Visiting element 1's object deletes index 3 and redefines index 2.
  const getter = o.builtinFunction(
    source.root,
    "get",
    0,
    () => {
      assert.ok(o.deleteProperty(array, "3"));
      o.createDataProperty(array, "2", "C", source.hooks);
      return 1;
    },
    source.hooks,
  );
  assert.equal(
    o.defineOwnProperty(
      trap,
      "x",
      {
        fields: 60,
        value: undefined,
        writable: false,
        get: getter,
        set: undefined,
        enumerable: true,
        configurable: true,
      },
      source.hooks,
    ),
    "accepted",
  );
  o.createDataProperty(array, "1", trap, source.hooks);
  const copy = deserialize(
    serialize(array, source.realm),
    target.realm,
  ) as ObjectValue;
  assert.equal(o.getOwnProperty(copy, "length")!.value, 4);
  assert.equal(o.getOwnProperty(copy, "0")!.value, "a");
  assert.equal(o.getOwnProperty(copy, "2")!.value, "C");
  assert.equal(o.getOwnProperty(copy, "3"), undefined);
});

test("repeated property keys are written once and shared by the copies", () => {
  const source = isolate();
  const target = isolate();
  const records: unknown[] = [];
  for (let index = 0; index < 3; index++) {
    const record = o.createObject(source.root);
    o.createDataProperty(record, "identifier", index, source.hooks);
    o.createDataProperty(record, "description", "r" + index, source.hooks);
    records.push(record);
  }
  const packet = serialize(
    arrayOf(source.realm, source.hooks, records),
    source.realm,
  );
  const text = String.fromCharCode(...packet);
  assert.equal(text.split("identifier").length - 1, 1, "one key copy");
  const copy = deserialize(packet, target.realm) as ObjectValue;
  for (let index = 0; index < 3; index++) {
    const record = o.getOwnProperty(copy, String(index))!.value as ObjectValue;
    assert.equal(o.getOwnProperty(record, "identifier")!.value, index);
    assert.equal(o.getOwnProperty(record, "description")!.value, "r" + index);
  }
});

test("a lone primitive takes the same bytes with or without the graph encoder", () => {
  const { realm } = isolate();
  // A sink too small for the primitive path makes the graph encoder run; a
  // roomy one takes the fast path. Starting at offset 3 exercises padding.
  function bytesFrom(value: unknown, room: number): Uint8Array {
    const sink: objects.WorkerCloneSink = {
      bytes: new Uint8Array(room),
      grow(used, needed) {
        const bytes = new Uint8Array(used + needed + 32);
        bytes.set(sink.bytes.subarray(0, used));
        sink.bytes = bytes;
      },
      writeFloat64(offset, value) {
        assert.equal(offset % 8, 0, "aligned binary64");
        new DataView(sink.bytes.buffer).setFloat64(offset, value, true);
      },
      writeString: () => assert.fail("no strings"),
    };
    const end = codec.serializeWorkerValue(value, realm, sink, 3);
    return sink.bytes.slice(0, end);
  }
  const values = [
    undefined,
    null,
    true,
    false,
    0,
    -0,
    1,
    -1,
    63,
    -64,
    2147483647,
    -2147483648,
    2147483648,
    -2147483649,
    0.5,
    NaN,
    Infinity,
    -Infinity,
    Number.MAX_VALUE,
    Number.MIN_VALUE,
  ];
  for (const value of values) {
    const slow = bytesFrom(value, 4);
    const fast = bytesFrom(value, 64);
    assert.deepEqual(fast, slow, String(value));
    const source: objects.WorkerCloneSource = {
      bytes: fast,
      readFloat64: (offset) =>
        new DataView(fast.buffer).getFloat64(offset, true),
      readString: () => assert.fail("no strings"),
    };
    assert.ok(
      Object.is(
        codec.deserializeWorkerValue(source, 3, fast.length, realm),
        value,
      ),
      String(value),
    );
  }
  // Truncated or overlong primitive payloads still fail as the graph
  // decoder reports them.
  for (const bytes of [
    [0, 0, 0, 73, 200],
    [0, 0, 0, 73, 2, 0],
    [0, 0, 0, 73, 255, 255, 255, 255, 127],
    [0, 0, 0, 78, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 95, 95],
  ]) {
    const packet = Uint8Array.from(bytes);
    assert.throws(() =>
      codec.deserializeWorkerValue(
        {
          bytes: packet,
          readFloat64: (offset) =>
            new DataView(packet.buffer).getFloat64(offset, true),
          readString: () => assert.fail("no strings"),
        },
        3,
        packet.length,
        realm,
      ),
    );
  }
});

test("a typed program's native typed array arrives as the realm typed array it reads as", () => {
  const { realm } = isolate();
  // Natively, typed code's Uint16Array is a native array that the realm
  // sees as an opaque reference; under Node it is a host typed array.
  const backing = new Uint8Array(12);
  for (let index = 0; index < backing.length; index++) backing[index] = index;
  const view = new Uint16Array(backing.buffer, 4, 3);
  const copy = deserialize(serialize(view, realm), realm) as ObjectValue;
  const data = o.exoticSlots(copy).internalTypedArrayData;
  assert.ok(data !== undefined);
  assert.equal(data.kind, "Uint16");
  assert.equal(data.byteOffset, 4);
  assert.equal(data.length, 3);
  assert.deepEqual(
    [...(o.exoticSlots(data.buffer).internalArrayBufferData?.data ?? [])],
    [...backing],
  );
  // The rest of the HTML algorithm still applies to realm values.
  assert.throws(() => serialize(Symbol("x"), realm));
});

test("lone string fast path handles empty, inline, bulk, shared and malformed payloads", () => {
  const { realm } = isolate();
  const sharedBodies = new Map<number, string>();
  let nextGrant = 1;
  const attachments: objects.WorkerCloneAttachments = {
    sharedStringUnits: 128,
    encodeString(value) {
      if (value.startsWith("copy:")) return undefined;
      const grant = nextGrant++;
      sharedBodies.set(grant, value);
      return grant;
    },
    decodeString(grant) {
      return sharedBodies.get(grant);
    },
  };
  const samples = [
    "",
    "ready",
    "a\0b😀\ud800x\udfff",
    "0123456789abcdef",
    "worker-message-".repeat(69).slice(0, 1024),
    "copy:" + "z".repeat(200),
  ];
  for (const text of samples) {
    const encoded = serialize(text, realm, attachments);
    const decoded = deserialize(encoded, realm, attachments);
    assert.equal(decoded, text);
  }
  // Malformed lone tagString (99) and tagSharedString (115) payloads still throw.
  for (const bytes of [
    [99],
    [99, 2, 65, 0],
    [99, 1, 65, 0, 0],
    [115],
    [115, 99],
    [115, 1, 0],
  ]) {
    const packet = Uint8Array.from(bytes);
    assert.throws(() =>
      codec.deserializeWorkerValue(
        {
          bytes: packet,
          readFloat64: () => assert.fail("no floats"),
          readString: (offset, units) => {
            let out = "";
            for (let i = 0; i < units; i++)
              out += String.fromCharCode(
                packet[offset + i * 2]! + packet[offset + i * 2 + 1]! * 256,
              );
            return out;
          },
        },
        0,
        packet.length,
        realm,
        attachments,
      ),
    );
  }
});

test("native typed arrays keep later references aligned and share a shared block once", () => {
  const source = isolate();
  const target = isolate();
  // Natively these are typed code's views; the host reports that the
  // first two view one shared block (grant 7) and the third an ordinary
  // buffer, which is copied.
  const block = new ArrayBuffer(16);
  const words = new Uint32Array(block, 4, 2);
  const bytes = new Uint8Array(block);
  const copied = new Uint16Array(3);
  const inner = o.createObject(source.root);
  const outer = o.createObject(source.root);
  o.createDataProperty(outer, "words", words, source.hooks);
  o.createDataProperty(outer, "bytes", bytes, source.hooks);
  o.createDataProperty(outer, "copied", copied, source.hooks);
  o.createDataProperty(outer, "left", inner, source.hooks);
  o.createDataProperty(outer, "right", inner, source.hooks);
  const encoded = serialize(outer, source.realm, {
    encodeNativeBuffer: (buffer) => (buffer === block ? 7 : undefined),
  });
  const shared = o.createObject<objects.ScriptPropertyKey, unknown>(
    target.realm.arrayBufferPrototype,
  );
  o.ensureExoticSlots(shared).internalArrayBufferData = {
    kind: "ordinary" as const,
    data: new Uint8Array(16),
    immutable: false,
    maxByteLength: 16,
    resizable: false,
    allocationLimit: 16,
  };
  let decoded = 0;
  const copy = deserialize(encoded, target.realm, {
    decode: (index) => {
      assert.equal(index, 7);
      decoded++;
      return shared;
    },
  }) as ObjectValue;
  assert.equal(decoded, 1);
  const read = (name: string): ObjectValue =>
    o.getProperty(copy, name, copy, target.hooks) as ObjectValue;
  const wordView = o.exoticSlots(read("words")).internalTypedArrayData;
  const byteView = o.exoticSlots(read("bytes")).internalTypedArrayData;
  assert.equal(wordView?.buffer, shared);
  assert.equal(byteView?.buffer, shared);
  assert.equal(wordView?.byteOffset, 4);
  assert.equal(wordView?.length, 2);
  assert.notEqual(
    o.exoticSlots(read("copied")).internalTypedArrayData?.buffer,
    shared,
  );
  // Two indices per native view kept the later alias aligned.
  assert.equal(read("left"), read("right"));
});

test("native SharedArrayBuffer shares its block with views and preserves aliases", () => {
  const source = isolate();
  const target = isolate();
  const block = new SharedArrayBuffer(16);
  const words = new Uint32Array(block, 4, 2);
  const inner = o.createObject(source.root);
  const outer = o.createObject(source.root);
  o.createDataProperty(outer, "buffer", block, source.hooks);
  o.createDataProperty(outer, "words", words, source.hooks);
  o.createDataProperty(outer, "left", inner, source.hooks);
  o.createDataProperty(outer, "right", inner, source.hooks);
  const encoded = serialize(outer, source.realm, {
    encodeNativeBuffer: (buffer) => (buffer === block ? 9 : undefined),
  });
  const shared = o.createObject<objects.ScriptPropertyKey, unknown>(
    target.realm.sharedArrayBufferPrototype,
  );
  o.ensureExoticSlots(shared).internalArrayBufferData = {
    kind: "ordinary" as const,
    data: new Uint8Array(16),
    immutable: false,
    maxByteLength: 16,
    resizable: false,
    allocationLimit: 16,
  };
  let decoded = 0;
  const copy = deserialize(encoded, target.realm, {
    decode: (index) => {
      assert.equal(index, 9);
      decoded++;
      return shared;
    },
  }) as ObjectValue;
  assert.equal(decoded, 1);
  const read = (name: string): ObjectValue =>
    o.getProperty(copy, name, copy, target.hooks) as ObjectValue;
  assert.equal(read("buffer"), shared);
  const wordView = o.exoticSlots(read("words")).internalTypedArrayData;
  assert.equal(wordView?.buffer, shared);
  assert.equal(wordView?.byteOffset, 4);
  assert.equal(wordView?.length, 2);
  assert.equal(read("left"), read("right"));
});

test("shape-cached fast objects preserve spilled slots, cycles, and getter-deleted properties", () => {
  const source = isolate();
  const target = isolate();
  // Two objects sharing a 10-key shape (crossing the 8-slot inline spill boundary)
  // plus a self-cycle and an alias.
  const makeRecord = (base: number): ObjectValue => {
    const obj = o.createObject<objects.ScriptPropertyKey, unknown>(source.root);
    for (let i = 0; i < 10; i++)
      o.createDataProperty(obj, "k" + i, base + i, source.hooks);
    return obj;
  };
  const first = makeRecord(10);
  const second = makeRecord(20);
  o.createDataProperty(first, "self", first, source.hooks);
  o.createDataProperty(second, "self", first, source.hooks);
  const pair = o.createArrayObject(
    0,
    source.realm.arrayPrototype,
    source.realm.arrayHooks,
    source.hooks,
  );
  o.createDataProperty(pair, "0", first, source.hooks);
  o.createDataProperty(pair, "1", second, source.hooks);
  const encoded = serialize(pair, source.realm);
  const copy = deserialize(encoded, target.realm) as ObjectValue;
  const copy0 = o.getProperty(copy, "0", copy, target.hooks) as ObjectValue;
  const copy1 = o.getProperty(copy, "1", copy, target.hooks) as ObjectValue;
  assert.equal(o.getProperty(copy0, "k0", copy0, target.hooks), 10);
  assert.equal(o.getProperty(copy0, "k9", copy0, target.hooks), 19);
  assert.equal(o.getProperty(copy1, "k0", copy1, target.hooks), 20);
  assert.equal(o.getProperty(copy1, "k9", copy1, target.hooks), 29);
  assert.equal(o.getProperty(copy0, "self", copy0, target.hooks), copy0);
  assert.equal(o.getProperty(copy1, "self", copy1, target.hooks), copy0);
  // Both copies share the same target shape.
  assert.equal(copy0.internalShape, copy1.internalShape);
  // A nested getter deleting a later property on a shape-cached parent omits it.
  const parent1 = o.createObject<objects.ScriptPropertyKey, unknown>(
    source.root,
  );
  const parent2 = o.createObject<objects.ScriptPropertyKey, unknown>(
    source.root,
  );
  const trigger = o.createObject<objects.ScriptPropertyKey, unknown>(
    source.root,
  );
  const getter = o.createCallableObject<objects.ScriptPropertyKey, unknown>(
    source.realm.functionPrototype,
    () => {
      o.deleteProperty(parent2, "gone");
      return "ran";
    },
  );
  o.createAccessorProperty(trigger, "hit", getter, false, source.hooks);
  o.createDataProperty(parent1, "a", 1, source.hooks);
  o.createDataProperty(parent1, "gone", "kept", source.hooks);
  o.createDataProperty(parent2, "a", trigger, source.hooks);
  o.createDataProperty(parent2, "gone", "dropped", source.hooks);
  const list = o.createArrayObject(
    0,
    source.realm.arrayPrototype,
    source.realm.arrayHooks,
    source.hooks,
  );
  o.createDataProperty(list, "0", parent1, source.hooks);
  o.createDataProperty(list, "1", parent2, source.hooks);
  const mutatedCopy = deserialize(
    serialize(list, source.realm),
    target.realm,
  ) as ObjectValue;
  const p1 = o.getProperty(
    mutatedCopy,
    "0",
    mutatedCopy,
    target.hooks,
  ) as ObjectValue;
  const p2 = o.getProperty(
    mutatedCopy,
    "1",
    mutatedCopy,
    target.hooks,
  ) as ObjectValue;
  assert.equal(o.getProperty(p1, "gone", p1, target.hooks), "kept");
  assert.equal(o.getOwnProperty(p2, "gone"), undefined);
  const a2 = o.getProperty(p2, "a", p2, target.hooks) as ObjectValue;
  assert.equal(o.getProperty(a2, "hit", a2, target.hooks), "ran");
});

test("repeated short strings share recent-string slots and malformed slots fail cleanly", () => {
  const source = isolate();
  const target = isolate();
  const list = o.createArrayObject(
    0,
    source.realm.arrayPrototype,
    source.realm.arrayHooks,
    source.hooks,
  );
  const values = [
    "leaf",
    "node1",
    "leaf",
    "node1",
    "snow\u2603",
    "leaf",
    "snow\u2603",
  ];
  for (let i = 0; i < values.length; i++)
    o.createDataProperty(list, String(i), values[i], source.hooks);
  const packet = serialize(list, source.realm);
  // Repeated "leaf" and "node1" must use 2-byte tagRecentString references.
  const copy = deserialize(packet, target.realm) as ObjectValue;
  for (let i = 0; i < values.length; i++)
    assert.equal(o.getProperty(copy, String(i), copy, target.hooks), values[i]);
  // Malformed tagRecentString (empty slot or out-of-range slot) throws DataCloneError.
  for (const bad of [new Uint8Array([114, 0]), new Uint8Array([114, 99])]) {
    assert.throws(
      () => deserialize(bad, target.realm),
      (err: unknown) => {
        const obj = err as ObjectValue;
        return (
          o.getProperty(obj, "name", obj, target.hooks) === "DataCloneError"
        );
      },
    );
  }
});
