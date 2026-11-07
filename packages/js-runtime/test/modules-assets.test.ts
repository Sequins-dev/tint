import assert from "node:assert/strict";
import test from "node:test";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
import type { ObjectHooks, ScriptPropertyKey } from "../src/objects/index.ts";
bindHostRecordViews();
const objects = await import("../src/objects/index.ts");
const modules = await import("../src/modules/index.ts");
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => assert.fail("unexpected JS call"),
};
function setup() {
  const global = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(global, hooks);
  objects.installArrayBufferIntrinsics(global, realm, hooks);
  objects.installTypedArrayIntrinsics(global, realm, hooks, "little");
  return realm;
}
function evaluate(module: import("../src/modules/index.ts").ModuleRecord) {
  assert.equal(
    modules.settledModulePromise(
      modules.loadRequestedModules(module, hooks, undefined),
      module.realm,
    ).kind,
    "fulfilled",
  );
  assert.deepEqual(modules.linkModule(module), { ok: true });
  assert.equal(
    modules.settledModulePromise(
      modules.evaluateModule(module, hooks),
      module.realm,
    ).kind,
    "fulfilled",
  );
  const ns = modules.getModuleNamespace(module);
  return objects.getProperty(ns, "default", ns, hooks);
}
test("text modules export the exact string as their sole stable default", () => {
  const realm = setup();
  const module = modules.createTextModule("\ufeff\ud800\n", realm, "resource");
  assert.equal(module.hostDefined, "resource");
  assert.equal(evaluate(module), "\ufeff\ud800\n");
  assert.deepEqual(modules.getExportedNames(module), ["default"]);
  assert.equal(evaluate(module), "\ufeff\ud800\n");
});
test("bytes modules copy raw bytes into immutable Uint8Array backing", () => {
  const realm = setup(),
    input = new Uint8Array([0, 137, 255]);
  const completion = modules.createBytesModule(input, realm, hooks, undefined);
  assert.ok(completion.ok);
  const value = evaluate(completion.module),
    object = objects.viewObjectValue(value, realm.objectPrototype);
  assert.ok(object?.internalTypedArrayData);
  assert.equal(object.prototype, realm.typedArrayPrototypes.get("Uint8"));
  const storage = object.internalTypedArrayData.storage;
  assert.equal(storage.kind, "ordinary");
  if (storage.kind !== "ordinary") assert.fail("ordinary backing required");
  assert.equal(storage.immutable, true);
  assert.equal(storage.resizable, false);
  input[1] = 4;
  assert.deepEqual([...storage.data!], [0, 137, 255]);
  assert.equal(
    objects.setProperty(object, "1", 3, { value: object, object }, hooks),
    false,
  );
  assert.equal(evaluate(completion.module), value);
});
test("bytes modules accept empty input and reject the embedding allocation limit", () => {
  const realm = setup();
  const empty = modules.createBytesModule(
    new Uint8Array(0),
    realm,
    hooks,
    undefined,
  );
  assert.ok(empty.ok);
  assert.equal(
    objects.viewObjectValue(evaluate(empty.module), realm.objectPrototype)
      ?.internalTypedArrayData?.length,
    0,
  );
  realm.bufferMaxBytes = 1;
  const large = modules.createBytesModule(
    new Uint8Array(2),
    realm,
    hooks,
    undefined,
  );
  assert.equal(large.ok, false);
});
