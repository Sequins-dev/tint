import { after, test } from "node:test";
import assert from "node:assert/strict";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
const views = bindHostRecordViews();
after(() => views.deregister());
const objects = await import("../src/objects/index.ts");
import type {
  ObjectHooks,
  ScriptPropertyKey,
  OrdinaryObject,
} from "../src/objects/index.ts";
function setup() {
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call(callee, receiver, args) {
      const r = objects.callObjectValue(callee, receiver, args, root);
      assert.equal(r.error, "none");
      return r.value;
    },
  };
  const realm = objects.createErrorRealm(root, hooks);
  objects.installArrayIntrinsics(root, realm, hooks);
  const descriptor = objects.getOwnProperty(
    realm.arrayPrototype,
    "toLocaleString",
  );
  assert.ok(descriptor);
  const method = descriptor.value as OrdinaryObject<ScriptPropertyKey, unknown>;
  return { root, hooks, realm, method };
}
test("Array locale method has its own standard zero-argument metadata", () => {
  const { method } = setup();
  assert.equal(objects.getOwnProperty(method, "length")?.value, 0);
  assert.equal(objects.getOwnProperty(method, "name")?.value, "toLocaleString");
  assert.equal(method.internalRareSlots?.internalConstruct, undefined);
});
test("Array locale snapshots length and forwards original elements and exactly two options", () => {
  const { root, hooks, realm, method } = setup();
  const array = objects.createObject<ScriptPropertyKey, unknown>(root);
  const locale = {},
    options = {},
    log: string[] = [];
  const element = objects.createObject<ScriptPropertyKey, unknown>(root);
  const fn = objects.createCallableObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args) => {
      assert.equal(receiver, element);
      assert.deepEqual(args, [locale, options]);
      log.push("call");
      objects.createDataProperty(array, "length", 0, hooks);
      return "value";
    },
  );
  objects.createDataProperty(element, "toLocaleString", fn, hooks);
  objects.createDataProperty(array, "length", 3, hooks);
  objects.createDataProperty(array, "0", element, hooks);
  objects.createDataProperty(array, "2", element, hooks);
  assert.equal(
    method.internalRareSlots!.internalCall!(array, [
      locale,
      options,
      "ignored",
    ]),
    "value,,value",
  );
  assert.deepEqual(log, ["call", "call"]);
});

test("TypedArray locale method owns zero-argument metadata and validates its brand", async () => {
  const { realm, hooks } = setup();
  const { installTypedArrayText } =
    await import("../src/objects/typed-array-text.ts");
  installTypedArrayText(realm, hooks);
  const d = objects.getOwnProperty(realm.typedArrayPrototype, "toLocaleString");
  assert.ok(d);
  const method = d.value as OrdinaryObject<ScriptPropertyKey, unknown>;
  assert.equal(objects.getOwnProperty(method, "length")?.value, 0);
  assert.equal(method.internalRareSlots?.internalConstruct, undefined);
  assert.throws(() => method.internalRareSlots!.internalCall!({}, []));
});
