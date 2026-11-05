import assert from "node:assert/strict";
import test from "node:test";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
import type { ModuleRecord, SourceModuleShape } from "../src/modules/index.ts";
import type { ObjectHooks, ScriptPropertyKey } from "../src/objects/index.ts";
bindHostRecordViews();
const modules = await import("../src/modules/index.ts"),
  objects = await import("../src/objects/index.ts"),
  bindings = await import("../src/environments/records/index.ts");
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => assert.fail("unexpected JS call"),
};
function setup() {
  const witness = objects.createObject<ScriptPropertyKey, unknown>(undefined),
    realm = objects.createErrorRealm(witness, hooks);
  return { realm, witness };
}
function link(module: ModuleRecord) {
  assert.equal(
    modules.settledModulePromise(
      modules.loadRequestedModules(module, hooks, undefined),
      module.realm,
    ).kind,
    "fulfilled",
  );
  assert.deepEqual(modules.linkModule(module), { ok: true });
}
function exported(module: ModuleRecord, name = "default") {
  const namespace = modules.getModuleNamespace(module);
  return objects.getProperty(namespace, name, namespace, hooks);
}

test("synthetic exports are initialized to undefined at link and assigned at evaluation", () => {
  const { realm } = setup();
  let calls = 0;
  const module = modules.createSyntheticModule(
    realm,
    ["default"],
    (current) => {
      calls++;
      modules.setSyntheticModuleExport(current, "default", 42);
    },
    undefined,
  );
  link(module);
  assert.equal(exported(module), undefined);
  assert.equal(calls, 0);
  assert.equal(
    modules.settledModulePromise(modules.evaluateModule(module, hooks), realm)
      .kind,
    "fulfilled",
  );
  assert.equal(exported(module), 42);
  assert.equal(calls, 1);
});
test("synthetic evaluation repeats with a fresh settled promise and its own context", () => {
  const { realm } = setup();
  let calls = 0;
  const module = modules.createSyntheticModule(
    realm,
    ["value"],
    (current) => {
      assert.equal(realm.agent.activeContext?.scriptOrModule, current);
      modules.setSyntheticModuleExport(current, "value", ++calls);
    },
    undefined,
  );
  link(module);
  let first: unknown, second: unknown;
  objects.runScriptContext<void>(
    realm.agent,
    { realm, scriptOrModule: "caller" },
    () => {
      first = modules.evaluateModule(module, hooks);
      second = modules.evaluateModule(module, hooks);
      assert.equal(realm.agent.activeContext?.scriptOrModule, "caller");
    },
  );
  assert.notEqual(first, second);
  assert.equal(calls, 2);
  assert.equal(exported(module, "value"), 2);
  assert.equal(realm.agent.activeContext, undefined);
  assert.equal(module.topLevelCapability, undefined);
  assert.equal(module.cycleRoot, undefined);
});
test("synthetic evaluation rethrows undefined through a settled rejection without caching the failure", () => {
  const { realm } = setup();
  let calls = 0;
  const module = modules.createSyntheticModule(
    realm,
    [],
    () => {
      calls++;
      throw undefined;
    },
    undefined,
  );
  link(module);
  for (let i = 0; i < 2; i++)
    assert.deepEqual(
      modules.settledModulePromise(
        modules.evaluateModule(module, hooks),
        realm,
      ),
      { kind: "rejected", error: undefined },
    );
  assert.equal(calls, 2);
  assert.equal(module.evaluationError, undefined);
  assert.equal(realm.agent.activeContext, undefined);
});
test("synthetic export resolution ignores cyclic traversal sets", () => {
  const { realm } = setup();
  const module = modules.createSyntheticModule(
    realm,
    ["b", "a"],
    () => {},
    undefined,
  );
  link(module);
  assert.deepEqual(modules.getExportedNames(module, [module]), ["b", "a"]);
  assert.deepEqual(
    modules.resolveExport(module, "a", [{ module, exportName: "a" }]),
    { module, bindingName: "a" },
  );
  assert.equal(modules.resolveExport(module, "missing"), undefined);
});
test("relinking synthetic exports preserves live import cells while resetting their values", () => {
  const { realm } = setup();
  let value = 40;
  const target = modules.createSyntheticModule(
    realm,
    ["default"],
    (current) => modules.setSyntheticModuleExport(current, "default", value++),
    undefined,
  );
  const shape: SourceModuleShape = {
    requests: [
      modules.canonicalModuleRequest({ specifier: "./value", attributes: [] }),
    ],
    imports: [{ request: 0, importName: "default", localName: "data" }],
    localExports: [],
    indirectExports: [],
    starExports: [],
    hasTopLevelAwait: false,
  };
  const importer = modules.createSourceTextModule(
    realm,
    shape,
    undefined,
    () => {},
    () => {},
    () => {},
  );
  realm.moduleLoader = (referrer, request, hostDefined, payload) =>
    modules.finishLoadingImportedModule(referrer, request, payload, {
      ok: true,
      module: target,
    });
  link(importer);
  const cell = importer.environment.bindings.get("data");
  assert.deepEqual(bindings.getBindingValue(importer.environment, "data"), {
    error: "none",
    value: undefined,
  });
  assert.equal(
    modules.settledModulePromise(modules.evaluateModule(importer, hooks), realm)
      .kind,
    "fulfilled",
  );
  assert.equal(
    bindings.getBindingValue(importer.environment, "data").value,
    40,
  );
  assert.deepEqual(modules.linkModule(target), { ok: true });
  assert.equal(importer.environment.bindings.get("data"), cell);
  assert.equal(
    bindings.getBindingValue(importer.environment, "data").value,
    undefined,
  );
  modules.evaluateModule(target, hooks);
  assert.equal(
    bindings.getBindingValue(importer.environment, "data").value,
    41,
  );
  assert.equal(
    bindings.setMutableBinding(importer.environment, "data", 99, true),
    "type",
  );
});
test("synthetic exports validate creation and writes without fabricating JS errors", () => {
  const { realm } = setup();
  assert.throws(
    () => modules.createSyntheticModule(realm, ["x", "x"], () => {}, undefined),
    (error) => error === "MODULE_SYNTHETIC_EXPORT_INVARIANT",
  );
  const module = modules.createSyntheticModule(
    realm,
    [""],
    () => {},
    undefined,
  );
  assert.throws(
    () => modules.setSyntheticModuleExport(module, "", 1),
    (error) => error === "MODULE_SYNTHETIC_EXPORT_INVARIANT",
  );
  link(module);
  modules.setSyntheticModuleExport(module, "", 7);
  assert.equal(exported(module, ""), 7);
  assert.throws(
    () => modules.setSyntheticModuleExport(module, "missing", 1),
    (error) => error === "MODULE_SYNTHETIC_EXPORT_INVARIANT",
  );
});
