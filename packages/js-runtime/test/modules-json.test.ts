import assert from "node:assert/strict";
import test from "node:test";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
import type {
  ObjectHooks,
  ScriptPropertyKey,
  OrdinaryObject,
} from "../src/objects/index.ts";
bindHostRecordViews();
const modules = await import("../src/modules/index.ts"),
  objects = await import("../src/objects/index.ts");
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => assert.fail("unexpected JS call"),
};
function setup() {
  const witness = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  return objects.createErrorRealm(witness, hooks);
}
function linked(source: string) {
  const realm = setup(),
    result = modules.parseJSONModule(source, realm, hooks, "json-file");
  if (!result.ok) assert.fail("valid JSON rejected");
  const module = result.module;
  assert.equal(
    modules.settledModulePromise(
      modules.loadRequestedModules(module, hooks, undefined),
      realm,
    ).kind,
    "fulfilled",
  );
  assert.deepEqual(modules.linkModule(module), { ok: true });
  const namespace = modules.getModuleNamespace(module);
  assert.equal(
    objects.getProperty(namespace, "default", namespace, hooks),
    undefined,
  );
  assert.equal(
    modules.settledModulePromise(modules.evaluateModule(module, hooks), realm)
      .kind,
    "fulfilled",
  );
  return {
    realm,
    module,
    namespace,
    value: objects.getProperty(namespace, "default", namespace, hooks),
  };
}
test("JSON modules parse at load and export one stable default object", () => {
  const { realm, module, namespace, value } = linked(
    '{"answer":42,"__proto__":7,"answer":43}',
  );
  assert.equal(module.hostDefined, "json-file");
  assert.deepEqual(modules.getExportedNames(module, []), ["default"]);
  const object = objects.viewObjectValue(value, realm.objectPrototype);
  assert.ok(object);
  assert.equal(objects.getProperty(object, "answer", object, hooks), 43);
  assert.equal(objects.getProperty(object, "__proto__", object, hooks), 7);
  assert.equal(object.prototype, realm.objectPrototype);
  modules.evaluateModule(module, hooks);
  assert.equal(
    objects.getProperty(namespace, "default", namespace, hooks),
    value,
  );
  assert.equal(modules.resolveExport(module, "answer", []), undefined);
});
test("JSON modules retain primitive, array, and raw UTF16 JSON values", () => {
  for (const [source, expected] of [
    ["null", null],
    ["true", true],
    ["-0", -0],
    ['"\ud800"', "\ud800"],
  ] as const) {
    assert.ok(Object.is(linked(source).value, expected));
  }
  const { value, realm } = linked("[1,2]"),
    array = objects.viewObjectValue(value, realm.objectPrototype);
  assert.ok(array);
  assert.equal(objects.getProperty(array, "length", array, hooks), 2);
});
test("malformed JSON returns the loading realm's SyntaxError before a record exists", () => {
  const realm = setup();
  for (const source of [
    "",
    "undefined",
    "[1,]",
    '{"x":}',
    "0 1",
    '"\\uZZZZ"',
  ]) {
    const result = modules.parseJSONModule(source, realm, hooks, undefined);
    assert.equal(result.ok, false);
    if (result.ok) assert.fail("invalid JSON accepted");
    assert.equal(
      (result.error as OrdinaryObject<ScriptPropertyKey, unknown>).prototype,
      realm.prototypes.get("syntax"),
    );
  }
});

test("the host selects supported import attributes when creating a realm", () => {
  const witness = objects.createObject<ScriptPropertyKey, unknown>(undefined),
    supported = ["type"],
    realm = objects.createErrorRealm(
      witness,
      hooks,
      undefined,
      undefined,
      supported,
    );
  assert.deepEqual(realm.supportedImportAttributes, ["type"]);
  supported.push("other");
  assert.deepEqual(realm.supportedImportAttributes, ["type"]);
  assert.deepEqual(setup().supportedImportAttributes, []);
});
