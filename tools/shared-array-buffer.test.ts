import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, test } from "node:test";
import type * as objects from "../packages/js-runtime/src/objects/index.ts";
import { bindHostRecordViews } from "../packages/js-runtime/test/ordinary-object-host-record-views.ts";
const hostViews = bindHostRecordViews();
after(() => hostViews.deregister());
const o = await import("../packages/js-runtime/src/objects/index.ts");
const { builtinProperty } =
  await import("../packages/js-runtime/src/objects/intrinsics.ts");
import { NodeSharedBlockService } from "./node-shared-block-service.ts";
import {
  attachSharedStorage,
  readSharedByte,
  writeSharedUnsigned,
} from "@tint/js-runtime/bytes/shared";

type ObjectValue = objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
async function setup() {
  assert.ok(
    existsSync("packages/js-runtime/src/objects/shared-array-buffer.ts"),
    "portable SAB intrinsics must exist",
  );
  const api =
    await import("../packages/js-runtime/src/objects/shared-array-buffer.ts");
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call(fn, receiver, args) {
      const result = o.callObject(fn as ObjectValue, receiver, args, undefined);
      assert.equal(result.error, "none");
      return result.value;
    },
  };
  const global = o.createObject<objects.ScriptPropertyKey, unknown>(undefined);
  const realm = o.createErrorRealm(global, hooks);
  const service = new NodeSharedBlockService();
  assert.equal(o.getOwnProperty(global, "SharedArrayBuffer"), undefined);
  api.installSharedArrayBufferIntrinsics(global, realm, hooks, service);
  const constructor = o.getOwnProperty(global, "SharedArrayBuffer")!
    .value as ObjectValue;
  function construct(args: unknown[], target = constructor) {
    const result = o.constructObject(
      constructor,
      args,
      { object: target, value: target },
      undefined,
    );
    assert.equal(result.error, "none");
    return result.value as ObjectValue;
  }
  function get(value: ObjectValue, key: objects.ScriptPropertyKey) {
    return o.getProperty(value, key, value, hooks);
  }
  function invoke(value: ObjectValue, key: string, args: unknown[] = []) {
    return o.callObject(get(value, key) as ObjectValue, value, args, undefined)
      .value;
  }
  function throwsKind(run: () => unknown, kind: string) {
    assert.throws(
      run,
      (error: unknown) =>
        (error as ObjectValue).prototype === realm.prototypes.get(kind),
    );
  }
  return {
    api,
    hooks,
    global,
    realm,
    service,
    constructor,
    construct,
    get,
    invoke,
    throwsKind,
  };
}

test("SAB intrinsics use an explicit service and preserve metadata and distinct brands", async () => {
  const f = await setup();
  const prototype = f.realm.sharedArrayBufferPrototype;
  assert.equal(
    o.exoticSlots(prototype).internalSharedArrayBufferData,
    undefined,
  );
  assert.equal(prototype.prototype, f.realm.objectPrototype);
  assert.equal(f.get(f.constructor, "name"), "SharedArrayBuffer");
  assert.equal(f.get(f.constructor, "length"), 1);
  assert.equal(o.getOwnProperty(f.constructor, "prototype")!.writable, false);
  assert.equal(
    o.getOwnProperty(f.constructor, "prototype")!.configurable,
    false,
  );
  const fixed = f.construct([4]);
  assert.equal(f.get(fixed, "byteLength"), 4);
  assert.equal(f.get(fixed, "maxByteLength"), 4);
  assert.equal(f.get(fixed, "growable"), false);
  assert.equal(o.exoticSlots(fixed).internalArrayBufferData, undefined);
  f.throwsKind(() => o.detachArrayBuffer(fixed, f.realm), "type");
  f.throwsKind(
    () => o.callObject(f.constructor, undefined, [], undefined),
    "type",
  );
  for (const name of ["byteLength", "maxByteLength", "growable"]) {
    const descriptor = o.getOwnProperty(prototype, name)!;
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.configurable, true);
    assert.equal(descriptor.set, undefined);
    f.throwsKind(
      () =>
        o.callObject(descriptor.get as ObjectValue, prototype, [], undefined),
      "type",
    );
    f.throwsKind(
      () =>
        o.callObject(
          descriptor.get as ObjectValue,
          o.createObject(undefined),
          [],
          undefined,
        ),
      "type",
    );
  }
});

test("SAB grow rejects fixed backing before coercion and observes growth through aliases", async () => {
  const f = await setup();
  let conversions = 0;
  const coercion = o.createObject<objects.ScriptPropertyKey, unknown>(
    f.realm.objectPrototype,
  );
  const fn = o.createCallableObject<objects.ScriptPropertyKey, unknown>(
    f.realm.functionPrototype,
    () => {
      conversions++;
      return 12;
    },
  );
  builtinProperty(coercion, "valueOf", fn, true, true, f.hooks);
  f.throwsKind(() => f.invoke(f.construct([4]), "grow", [coercion]), "type");
  assert.equal(conversions, 0);
  const options = o.createObject<objects.ScriptPropertyKey, unknown>(undefined);
  builtinProperty(options, "maxByteLength", 16, true, true, f.hooks);
  const buffer = f.construct([4, options]);
  const storage = f.api.requireSharedArrayBuffer(buffer, f.realm);
  const alias = attachSharedStorage(f.service, storage.handle);
  assert.ok(alias.ok);
  assert.equal(
    writeSharedUnsigned(storage, 0, 4, 0xffffffff, "unordered"),
    "none",
  );
  assert.equal(f.invoke(buffer, "grow", [coercion]), undefined);
  assert.equal(conversions, 1);
  assert.equal(f.get(buffer, "byteLength"), 12);
  assert.deepEqual(readSharedByte(alias.value, 0), { ok: true, value: 255 });
  assert.deepEqual(readSharedByte(alias.value, 11), { ok: true, value: 0 });
  f.throwsKind(() => f.invoke(buffer, "grow", [8]), "range");
  f.throwsKind(() => f.invoke(buffer, "grow", [17]), "range");
  assert.equal(f.invoke(buffer, "grow", [12]), undefined);
});

test("SAB slice copies into a distinct block and rejects a distinct wrapper alias", async () => {
  const f = await setup();
  const source = f.construct([4]);
  const storage = f.api.requireSharedArrayBuffer(source, f.realm);
  for (let i = 0; i < 4; i++)
    writeSharedUnsigned(storage, i, 1, 19 + i, "unordered");
  const copy = f.invoke(source, "slice", [-3, -1]) as ObjectValue;
  const copied = f.api.requireSharedArrayBuffer(copy, f.realm);
  assert.equal(f.get(copy, "byteLength"), 2);
  assert.notEqual(copied.blockId, storage.blockId);
  assert.deepEqual(readSharedByte(copied, 0), { ok: true, value: 20 });
  assert.deepEqual(readSharedByte(copied, 1), { ok: true, value: 21 });
  const alias = attachSharedStorage(f.service, storage.handle);
  assert.ok(alias.ok);
  const wrapper = o.createObject<objects.ScriptPropertyKey, unknown>(
    f.realm.sharedArrayBufferPrototype,
  );
  o.ensureExoticSlots(wrapper).internalSharedArrayBufferData = alias.value;
  const species = o.createConstructorObject<objects.ScriptPropertyKey, unknown>(
    f.realm.functionPrototype,
    () => undefined,
    () => wrapper,
  );
  const selected = o.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  builtinProperty(
    selected,
    o.wellKnownSymbol(f.realm.symbolRegistry, "species"),
    species,
    true,
    true,
    f.hooks,
  );
  builtinProperty(source, "constructor", selected, true, true, f.hooks);
  f.throwsKind(() => f.invoke(source, "slice", [0, 0]), "type");
});

test("SAB allocation orders coercion and prototype lookup before the host quota check", async () => {
  const f = await setup();
  const events: string[] = [];
  const { builtinAccessor } =
    await import("../packages/js-runtime/src/objects/intrinsics.ts");
  function numeric(label: string, value: number) {
    const object = o.createObject<objects.ScriptPropertyKey, unknown>(
      f.realm.objectPrototype,
    );
    builtinProperty(
      object,
      "valueOf",
      o.createCallableObject<objects.ScriptPropertyKey, unknown>(
        f.realm.functionPrototype,
        () => {
          events.push(label);
          return value;
        },
      ),
      true,
      true,
      f.hooks,
    );
    return object;
  }
  const options = o.createObject<objects.ScriptPropertyKey, unknown>(undefined);
  builtinAccessor(
    options,
    "maxByteLength",
    o.createCallableObject<objects.ScriptPropertyKey, unknown>(
      f.realm.functionPrototype,
      () => {
        events.push("options");
        return numeric("maximum", 12);
      },
    ),
    undefined,
    f.hooks,
  );
  const target = o.createConstructorObject<objects.ScriptPropertyKey, unknown>(
    f.realm.functionPrototype,
    () => undefined,
    () => undefined,
  );
  builtinAccessor(
    target,
    "prototype",
    o.createCallableObject<objects.ScriptPropertyKey, unknown>(
      f.realm.functionPrototype,
      () => {
        events.push("prototype");
        return f.realm.sharedArrayBufferPrototype;
      },
    ),
    undefined,
    f.hooks,
  );
  f.realm.bufferMaxBytes = 8;
  f.throwsKind(
    () => f.construct([numeric("initial", 4), options], target),
    "range",
  );
  assert.deepEqual(events, ["initial", "options", "maximum", "prototype"]);
  assert.equal(f.service.blocks.size, 0);
  events.length = 0;
  f.throwsKind(
    () => f.construct([numeric("initial", 13), options], target),
    "range",
  );
  assert.deepEqual(events, ["initial", "options", "maximum"]);
});

test("SAB slice captures length before coercion and propagates abrupt completion", async () => {
  const f = await setup();
  const options = o.createObject<objects.ScriptPropertyKey, unknown>(undefined);
  builtinProperty(options, "maxByteLength", 16, true, true, f.hooks);
  const source = f.construct([4, options]);
  const start = o.createObject<objects.ScriptPropertyKey, unknown>(
    f.realm.objectPrototype,
  );
  builtinProperty(
    start,
    "valueOf",
    o.createCallableObject<objects.ScriptPropertyKey, unknown>(
      f.realm.functionPrototype,
      () => {
        f.invoke(source, "grow", [12]);
        return 0;
      },
    ),
    true,
    true,
    f.hooks,
  );
  const sliced = f.invoke(source, "slice", [start]) as ObjectValue;
  assert.equal(f.get(source, "byteLength"), 12);
  assert.equal(f.get(sliced, "byteLength"), 4);
  const sentinel = {};
  const fail = o.createObject<objects.ScriptPropertyKey, unknown>(
    f.realm.objectPrototype,
  );
  builtinProperty(
    fail,
    "valueOf",
    o.createCallableObject<objects.ScriptPropertyKey, unknown>(
      f.realm.functionPrototype,
      () => {
        throw sentinel;
      },
    ),
    true,
    true,
    f.hooks,
  );
  assert.throws(
    () => f.invoke(source, "slice", [fail]),
    (error) => error === sentinel,
  );
});

test("SAB and ArrayBuffer methods reject the opposite brand before conversion", async () => {
  const f = await setup();
  o.installArrayBufferIntrinsics(f.global, f.realm, f.hooks);
  const ordinaryCtor = f.get(f.global, "ArrayBuffer") as ObjectValue;
  const ordinary = o.constructObject(
    ordinaryCtor,
    [4],
    { object: ordinaryCtor, value: ordinaryCtor },
    undefined,
  ).value as ObjectValue;
  const shared = f.construct([4]);
  for (const name of [
    "resize",
    "slice",
    "sliceToImmutable",
    "transfer",
    "transferToFixedLength",
    "transferToImmutable",
  ]) {
    const method = f.get(f.realm.arrayBufferPrototype, name) as ObjectValue;
    f.throwsKind(() => o.callObject(method, shared, [], undefined), "type");
  }
  for (const name of ["grow", "slice"]) {
    const method = f.get(
      f.realm.sharedArrayBufferPrototype,
      name,
    ) as ObjectValue;
    f.throwsKind(() => o.callObject(method, ordinary, [], undefined), "type");
  }
  for (const name of [
    "byteLength",
    "maxByteLength",
    "resizable",
    "detached",
    "immutable",
  ]) {
    const getter = o.getOwnProperty(f.realm.arrayBufferPrototype, name)!
      .get as ObjectValue;
    f.throwsKind(() => o.callObject(getter, shared, [], undefined), "type");
  }
});

test("SAB species must return shared backing with enough bytes", async () => {
  const f = await setup();
  const source = f.construct([4]);
  const selected = o.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const key = o.wellKnownSymbol(f.realm.symbolRegistry, "species");
  let target = o.createObject<objects.ScriptPropertyKey, unknown>(undefined);
  const species = o.createConstructorObject<objects.ScriptPropertyKey, unknown>(
    f.realm.functionPrototype,
    () => undefined,
    () => target,
  );
  builtinProperty(selected, key, species, true, true, f.hooks);
  builtinProperty(source, "constructor", selected, true, true, f.hooks);
  f.throwsKind(() => f.invoke(source, "slice", [0, 2]), "type");
  target = f.construct([1]);
  f.throwsKind(() => f.invoke(source, "slice", [0, 2]), "type");
  target = f.construct([3]);
  assert.equal(f.invoke(source, "slice", [0, 2]), target);
});

test("DataView shares SAB bytes, supports unaligned endian access and tracks growth", async () => {
  const f = await setup();
  o.installDataViewIntrinsics(f.global, f.realm, f.hooks);
  const options = o.createObject<objects.ScriptPropertyKey, unknown>(undefined);
  builtinProperty(options, "maxByteLength", 32, true, true, f.hooks);
  const buffer = f.construct([8, options]);
  const constructor = f.get(f.global, "DataView") as ObjectValue;
  function view(args: unknown[]) {
    return o.constructObject(
      constructor,
      args,
      { object: constructor, value: constructor },
      undefined,
    ).value as ObjectValue;
  }
  const tracking = view([buffer, 1]);
  const fixed = view([buffer, 1, 7]);
  assert.equal(f.get(tracking, "buffer"), buffer);
  assert.equal(f.get(tracking, "byteLength"), 7);
  assert.equal(f.get(tracking, "byteOffset"), 1);
  f.invoke(tracking, "setUint32", [0, 0xffffffff, true]);
  assert.equal(f.invoke(fixed, "getUint32", [0, false]), 0xffffffff);
  f.invoke(tracking, "setUint16", [1, 0x1234, false]);
  assert.equal(f.invoke(fixed, "getUint16", [1, true]), 0x3412);
  f.invoke(buffer, "grow", [24]);
  assert.equal(f.get(tracking, "byteLength"), 23);
  assert.equal(f.get(fixed, "byteLength"), 7);
  assert.equal(f.invoke(tracking, "getUint8", [22]), 0);
  f.throwsKind(() => f.invoke(fixed, "getUint8", [7]), "range");
  f.invoke(tracking, "setFloat64", [3, -0, true]);
  assert.equal(
    Object.is(f.invoke(tracking, "getFloat64", [3, true]), -0),
    true,
  );
});

test("typed arrays use whole-width shared access and preserve bulk aliasing", async () => {
  const f = await setup();
  o.installTypedArrayIntrinsics(f.global, f.realm, f.hooks, "little");
  const buffer = f.construct([16]);
  const constructor = f.get(f.global, "Uint32Array") as ObjectValue;
  function view(offset = 0, length = 4) {
    return o.constructObject(
      constructor,
      [buffer, offset, length],
      { object: constructor, value: constructor },
      undefined,
    ).value as ObjectValue;
  }
  const values = view();
  assert.ok(
    f.get(values, "buffer") === buffer,
    "typed array must retain SAB backing",
  );
  assert.equal(f.get(values, "length"), 4);
  const writes: number[] = [],
    reads: number[] = [];
  const write = f.service.writeUnsigned.bind(f.service),
    read = f.service.readUnsigned.bind(f.service);
  f.service.writeUnsigned = (handle, offset, width, value, order) => {
    writes.push(width);
    return write(handle, offset, width, value, order);
  };
  f.service.readUnsigned = (handle, offset, width, order) => {
    reads.push(width);
    return read(handle, offset, width, order);
  };
  for (let index = 0; index < 4; index++)
    o.setProperty(
      values,
      String(index),
      index + 1,
      { object: values, value: values },
      f.hooks,
    );
  assert.equal(f.get(values, "2"), 3);
  assert.deepEqual(writes, [4, 4, 4, 4]);
  assert.deepEqual(reads, [4]);
  f.invoke(values, "copyWithin", [1, 0, 3]);
  assert.deepEqual(
    [0, 1, 2, 3].map((index) => f.get(values, String(index))),
    [1, 1, 2, 3],
  );
  f.invoke(values, "reverse");
  assert.deepEqual(
    [0, 1, 2, 3].map((index) => f.get(values, String(index))),
    [3, 2, 1, 1],
  );
  f.invoke(values, "set", [view(4, 3), 0]);
  assert.deepEqual(
    [0, 1, 2, 3].map((index) => f.get(values, String(index))),
    [2, 1, 1, 1],
  );
  assert.ok(writes.every((width) => width === 4));
  assert.ok(reads.every((width) => width === 4));
});

test("shared integer-index bounds use unordered length while explicit length synchronizes", async () => {
  const f = await setup();
  o.installTypedArrayIntrinsics(f.global, f.realm, f.hooks, "little");
  const buffer = f.construct([4]);
  const constructor = f.get(f.global, "Uint8Array") as ObjectValue;
  const view = o.constructObject(
    constructor,
    [buffer],
    { object: constructor, value: constructor },
    undefined,
  ).value as ObjectValue;
  const orders: string[] = [];
  const length = f.service.length.bind(f.service);
  f.service.length = (handle, order) => {
    orders.push(order);
    return length(handle, order);
  };
  assert.equal(f.get(view, "0"), 0);
  assert.ok(
    orders.length > 0 && orders.every((order) => order === "unordered"),
  );
  orders.length = 0;
  assert.equal(f.get(view, "length"), 4);
  assert.deepEqual(orders, ["seq-cst"]);
});

test("shared BigInt views transport full 64-bit payloads without Number rounding", async () => {
  const f = await setup();
  o.installTypedArrayIntrinsics(f.global, f.realm, f.hooks, "little");
  const buffer = f.construct([16]);
  function view(name: string) {
    const constructor = f.get(f.global, name) as ObjectValue;
    return o.constructObject(
      constructor,
      [buffer],
      { object: constructor, value: constructor },
      undefined,
    ).value as ObjectValue;
  }
  const unsigned = view("BigUint64Array"),
    signed = view("BigInt64Array");
  let reads = 0,
    writes = 0;
  const read = f.service.readWord64.bind(f.service),
    write = f.service.writeWord64.bind(f.service);
  f.service.readWord64 = (...args) => {
    reads++;
    return read(...args);
  };
  f.service.writeWord64 = (...args) => {
    writes++;
    return write(...args);
  };
  const value = o.bigIntFromString("18446744073709551615");
  assert.ok(value);
  o.setProperty(
    unsigned,
    "0",
    value,
    { object: unsigned, value: unsigned },
    f.hooks,
  );
  assert.equal(
    o.bigIntToString(f.get(unsigned, "0") as objects.BigIntValue, 10),
    "18446744073709551615",
  );
  assert.equal(
    o.bigIntToString(f.get(signed, "0") as objects.BigIntValue, 10),
    "-1",
  );
  assert.equal(writes, 1);
  assert.equal(reads, 2);
});

test("shared byte codecs commit valid prefixes before reporting syntax failures", async () => {
  const f = await setup();
  o.installTypedArrayIntrinsics(f.global, f.realm, f.hooks, "little");
  const buffer = f.construct([4]);
  const constructor = f.get(f.global, "Uint8Array") as ObjectValue;
  const view = o.constructObject(
    constructor,
    [buffer],
    { object: constructor, value: constructor },
    undefined,
  ).value as ObjectValue;
  f.throwsKind(() => f.invoke(view, "setFromHex", ["0102gg"]), "syntax");
  assert.equal(f.invoke(view, "toHex"), "01020000");
  f.invoke(view, "setFromBase64", ["Eyo="]);
  assert.equal(f.invoke(view, "toBase64"), "EyoAAA==");
});

test("fixed shared views can prevent extensions while growable tracking views cannot", async () => {
  const f = await setup();
  o.installTypedArrayIntrinsics(f.global, f.realm, f.hooks, "little");
  const options = o.createObject<objects.ScriptPropertyKey, unknown>(undefined);
  builtinProperty(options, "maxByteLength", 8, true, true, f.hooks);
  const buffer = f.construct([4, options]);
  const constructor = f.get(f.global, "Uint8Array") as ObjectValue;
  const make = (args: unknown[]) =>
    o.constructObject(
      constructor,
      args,
      { object: constructor, value: constructor },
      undefined,
    ).value as ObjectValue;
  const fixed = make([buffer, 0, 4]),
    tracking = make([buffer]);
  assert.equal(o.preventExtensions(fixed), true);
  assert.equal(o.preventExtensions(tracking), false);
  f.invoke(buffer, "grow", [8]);
  assert.equal(f.get(fixed, "length"), 4);
  assert.equal(f.get(tracking, "length"), 8);
});

test("DataView getters return zero for detached or out-of-bounds buffers and recover after growth", async () => {
  const f = await setup();
  o.installArrayBufferIntrinsics(f.global, f.realm, f.hooks);
  o.installDataViewIntrinsics(f.global, f.realm, f.hooks);
  const options = o.createObject<objects.ScriptPropertyKey, unknown>(undefined);
  builtinProperty(options, "maxByteLength", 5, true, true, f.hooks);
  const bufferConstructor = f.get(f.global, "ArrayBuffer") as ObjectValue;
  const buffer = o.constructObject(
    bufferConstructor,
    [4, options],
    { object: bufferConstructor, value: bufferConstructor },
    undefined,
  ).value as ObjectValue;
  const constructor = f.get(f.global, "DataView") as ObjectValue;
  const view = o.constructObject(
    constructor,
    [buffer, 1, 2],
    { object: constructor, value: constructor },
    undefined,
  ).value as ObjectValue;
  f.invoke(buffer, "resize", [2]);
  assert.equal(f.get(view, "byteLength"), 0);
  assert.equal(f.get(view, "byteOffset"), 0);
  f.throwsKind(() => f.invoke(view, "getUint8", [0]), "type");
  f.invoke(buffer, "resize", [3]);
  assert.equal(f.get(view, "byteLength"), 2);
  assert.equal(f.get(view, "byteOffset"), 1);
  o.detachArrayBuffer(buffer, f.realm);
  assert.equal(f.get(view, "byteLength"), 0);
  assert.equal(f.get(view, "byteOffset"), 0);
  assert.ok(f.get(view, "buffer") === buffer);
  f.throwsKind(() => f.get(f.realm.dataViewPrototype, "byteLength"), "type");
});

test("DataView shared bounds are unordered while explicit size getters synchronize", async () => {
  const f = await setup();
  o.installDataViewIntrinsics(f.global, f.realm, f.hooks);
  const buffer = f.construct([4]);
  const constructor = f.get(f.global, "DataView") as ObjectValue;
  const view = o.constructObject(
    constructor,
    [buffer],
    { object: constructor, value: constructor },
    undefined,
  ).value as ObjectValue;
  const orders: string[] = [];
  const length = f.service.length.bind(f.service);
  f.service.length = (handle, order) => {
    orders.push(order);
    return length(handle, order);
  };
  assert.equal(f.invoke(view, "getUint8", [0]), 0);
  assert.ok(
    orders.length > 0 && orders.every((order) => order === "unordered"),
  );
  orders.length = 0;
  assert.equal(f.get(view, "byteLength"), 4);
  assert.deepEqual(orders, ["seq-cst"]);
});
