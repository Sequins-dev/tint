import assert from "node:assert/strict";
import test from "node:test";
import type * as objectTypes from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
bindHostRecordViews();
const modules = await import("../src/modules/index.ts");
const objects = await import("../src/objects/index.ts");
const hooks: objectTypes.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => assert.fail("unexpected call"),
};
function realm() {
  return objects.createErrorRealm(
    objects.createObject<objectTypes.ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
}
function record(owner: objectTypes.ErrorRealm) {
  return modules.createSourceTextModule(
    owner,
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
test("realm referrers are cached independently per realm", () => {
  assert.equal(typeof modules.realmReferrer, "function");
  const first = realm(),
    second = realm(),
    referrer = modules.realmReferrer(first);
  assert.equal(referrer.kind, "realm");
  assert.equal(referrer.realm, first);
  assert.equal(modules.realmReferrer(first), referrer);
  assert.notEqual(modules.realmReferrer(second), referrer);
  assert.deepEqual(referrer.loadedRequests, []);
});
test("active importer preserves module and Script identities across realms", () => {
  const owner = realm(),
    caller = objects.createErrorRealm(
      objects.createObject<objectTypes.ScriptPropertyKey, unknown>(undefined),
      hooks,
      owner.symbolRegistry,
      owner.agent,
    );
  const module = record(owner),
    script = objects.createScriptRecord(owner, 42);
  for (const identity of [module, script]) {
    objects.runScriptContext(
      owner.agent,
      { realm: caller, scriptOrModule: identity },
      () => {
        assert.equal(modules.activeModuleReferrer(owner), identity);
      },
    );
  }
});
test("absent identities use the active realm, or the supplied realm without a context", () => {
  const owner = realm(),
    caller = objects.createErrorRealm(
      objects.createObject<objectTypes.ScriptPropertyKey, unknown>(undefined),
      hooks,
      owner.symbolRegistry,
      owner.agent,
    );
  assert.equal(
    modules.activeModuleReferrer(owner),
    modules.realmReferrer(owner),
  );
  objects.runScriptContext(
    owner.agent,
    { realm: caller, scriptOrModule: undefined },
    () => {
      assert.equal(
        modules.activeModuleReferrer(owner),
        modules.realmReferrer(caller),
      );
    },
  );
});
test("opaque identities set unsupported in the active realm", () => {
  const owner = realm(),
    caller = objects.createErrorRealm(
      objects.createObject<objectTypes.ScriptPropertyKey, unknown>(undefined),
      hooks,
      owner.symbolRegistry,
      owner.agent,
    );
  objects.runScriptContext(
    owner.agent,
    { realm: caller, scriptOrModule: {} },
    () => {
      assert.throws(
        () => modules.activeModuleReferrer(owner),
        (error) => error === undefined,
      );
    },
  );
  assert.equal(caller.unsupported, true);
  assert.equal(owner.unsupported, false);
});
test("Script records own distinct empty dynamic-request caches", () => {
  const owner = realm(),
    first = objects.createScriptRecord(owner, undefined),
    second = objects.createScriptRecord(owner, undefined);
  assert.deepEqual(first.loadedRequests, []);
  assert.deepEqual(second.loadedRequests, []);
  assert.notEqual(first.loadedRequests, second.loadedRequests);
});

test("active import.meta resolves the defining module rather than the current realm", () => {
  const owner = realm(),
    module = record(owner);
  objects.runScriptContext(
    owner.agent,
    { realm: owner, scriptOrModule: module },
    () => {
      assert.equal(
        modules.getActiveImportMeta(owner),
        modules.getImportMeta(module),
      );
    },
  );
});
test("active import.meta rejects missing or non-module identities as invariants", () => {
  const owner = realm();
  assert.throws(
    () => modules.getActiveImportMeta(owner),
    (error) => error === "IMPORT_META_REFERRER_INVARIANT",
  );
  for (const identity of [
    undefined,
    objects.createScriptRecord(owner, undefined),
    {},
  ]) {
    objects.runScriptContext(
      owner.agent,
      { realm: owner, scriptOrModule: identity },
      () => {
        assert.throws(
          () => modules.getActiveImportMeta(owner),
          (error) => error === "IMPORT_META_REFERRER_INVARIANT",
        );
      },
    );
  }
});

test("loaded dynamic requests reuse static slots and preserve module identity", async () => {
  const referrers = await import("../src/modules/referrer.ts");
  assert.equal(typeof referrers.recordLoadedModule, "function");
  const owner = realm(),
    target = record(owner),
    other = record(owner),
    request = { specifier: "./target", attributes: [] };
  const importer = modules.createSourceTextModule(
    owner,
    {
      requests: [request],
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
  referrers.recordLoadedModule(importer, request, target);
  assert.equal(importer.loaded[0], target);
  assert.deepEqual(importer.loadedRequests, []);
  referrers.recordLoadedModule(
    importer,
    { specifier: "./target", attributes: [] },
    target,
  );
  assert.throws(
    () => referrers.recordLoadedModule(importer, request, other),
    (error) => error === "MODULE_LOAD_IDENTITY_INVARIANT",
  );
});
test("Script, module and realm dynamic caches enforce identity per equal request", async () => {
  const { recordLoadedModule } = await import("../src/modules/referrer.ts");
  const owner = realm(),
    target = record(owner),
    other = record(owner),
    request = { specifier: "./dynamic", attributes: [] };
  for (const importer of [
    record(owner),
    objects.createScriptRecord(owner, undefined),
    modules.realmReferrer(owner),
  ]) {
    recordLoadedModule(importer, request, target);
    recordLoadedModule(
      importer,
      { specifier: "./dynamic", attributes: [] },
      target,
    );
    assert.equal(importer.loadedRequests.length, 1);
    assert.equal(importer.loadedRequests[0]?.module, target);
    assert.throws(
      () => recordLoadedModule(importer, request, other),
      (error) => error === "MODULE_LOAD_IDENTITY_INVARIANT",
    );
    assert.equal(importer.loadedRequests[0]?.module, target);
  }
});
test("different import attributes identify distinct loaded requests", async () => {
  const { recordLoadedModule } = await import("../src/modules/referrer.ts");
  const owner = realm(),
    importer = objects.createScriptRecord(owner, undefined),
    first = record(owner),
    second = record(owner);
  recordLoadedModule(importer, { specifier: "./same", attributes: [] }, first);
  recordLoadedModule(
    importer,
    { specifier: "./same", attributes: [{ key: "type", value: "json" }] },
    second,
  );
  assert.equal(importer.loadedRequests.length, 2);
  assert.equal(importer.loadedRequests[0]?.module, first);
  assert.equal(importer.loadedRequests[1]?.module, second);
});
