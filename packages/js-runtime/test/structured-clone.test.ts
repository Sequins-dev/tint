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
