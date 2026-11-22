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
  const packet = codec.serializeWorkerValue(outer, source.realm);
  const copy = codec.deserializeWorkerValue(
    packet,
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
  buffer.internalArrayBufferData = storage;
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
  const copy = codec.deserializeWorkerValue(
    codec.serializeWorkerValue(object, source.realm),
    target.realm,
  ) as ObjectValue;
  const clonedView = o.getOwnProperty(copy, "first")!.value as ObjectValue;
  const backing = o.getOwnProperty(copy, "backing")!.value as ObjectValue;
  assert.equal(clonedView.internalTypedArrayData?.buffer, backing);
  assert.equal(clonedView.internalTypedArrayData?.byteOffset, 1);
  assert.equal(clonedView.internalTypedArrayData?.length, 2);
  assert.notEqual(backing, buffer);
  assert.deepEqual(backing.internalArrayBufferData?.data, bytes);
  const cloneError = o.getOwnProperty(copy, "error")!.value as ObjectValue;
  assert.equal(cloneError.prototype, target.realm.prototypes.get("type"));
  assert.equal(o.getOwnProperty(cloneError, "message")!.value, "failure");
  assert.equal(o.getOwnProperty(cloneError, "cause")!.value, copy);
});

test("worker clone encodes numbers and counts as fixed-width units", () => {
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
  date.internalDateValue = -8.64e15;
  o.createDataProperty(holder, "date", date, source.hooks);
  const invalid = o.createObject(source.realm.datePrototype);
  invalid.internalDateValue = NaN;
  o.createDataProperty(holder, "invalid", invalid, source.hooks);
  const packet = codec.serializeWorkerValue(holder, source.realm);
  // No count or number is decimal text any more.
  assert.equal(packet.includes("70000:"), false);
  const copy = codec.deserializeWorkerValue(
    packet,
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
  assert.equal(copiedDate.internalDateValue, -8.64e15);
  const copiedInvalid = o.getOwnProperty(copy, "invalid")!.value as ObjectValue;
  assert.ok(Number.isNaN(copiedInvalid.internalDateValue));
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
  buffer.internalArrayBufferData = storage;
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
  const packet = codec.serializeWorkerValue(tracking, source.realm);
  const copy = codec.deserializeWorkerValue(
    packet,
    target.realm,
  ) as ObjectValue;
  assert.equal(copy.internalTypedArrayData?.length, undefined);
  assert.equal(copy.internalTypedArrayData?.byteOffset, 2);
  const backing = copy.internalTypedArrayData?.buffer as ObjectValue;
  assert.equal(backing.internalArrayBufferData?.maxByteLength, 16);
  assert.equal(backing.internalArrayBufferData?.resizable, true);
  for (let cut = 0; cut < packet.length; cut++)
    assert.throws(() =>
      codec.deserializeWorkerValue(packet.slice(0, cut), target.realm),
    );
});
