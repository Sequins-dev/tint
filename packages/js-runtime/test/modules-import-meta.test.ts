import assert from "node:assert/strict";
import test from "node:test";
import * as modules from "../src/modules/index.ts";
import * as objects from "../src/objects/index.ts";
const hooks: objects.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => assert.fail("unexpected call"),
};
function record() {
  const realm = objects.createErrorRealm(
    objects.createObject<objects.ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  return modules.createSourceTextModule(
    realm,
    {
      requests: [],
      imports: [],
      localExports: [],
      indirectExports: [],
      starExports: [],
      hasTopLevelAwait: false,
    },
    undefined,
    () => {},
    () => {},
    () => {},
  );
}
test("import.meta is an empty extensible null-prototype ordinary object", () => {
  assert.equal(typeof modules.getImportMeta, "function");
  const meta = modules.getImportMeta(record());
  assert.equal(objects.getPrototype(meta), undefined);
  assert.equal(objects.isExtensible(meta), true);
  assert.deepEqual(
    objects.ownKeys(meta, () => -1),
    [],
  );
});
test("import.meta caches identity per module and preserves property mutations", () => {
  const module = record(),
    meta = modules.getImportMeta(module);
  assert.equal(objects.createDataProperty(meta, "answer", 42, hooks), true);
  assert.equal(modules.getImportMeta(module), meta);
  assert.deepEqual(objects.getOwnProperty(meta, "answer"), {
    accessor: false,
    value: 42,
    writable: true,
    get: undefined,
    set: undefined,
    enumerable: true,
    configurable: true,
  });
  assert.equal(objects.deleteProperty(meta, "answer"), true);
  assert.equal(
    objects.hasProperty(modules.getImportMeta(module), "answer"),
    false,
  );
});
test("distinct module records have distinct import.meta objects even with identical shapes", () => {
  const first = modules.getImportMeta(record()),
    second = modules.getImportMeta(record());
  assert.notEqual(first, second);
  objects.createDataProperty(first, "private", 1, hooks);
  assert.equal(objects.hasProperty(second, "private"), false);
});
