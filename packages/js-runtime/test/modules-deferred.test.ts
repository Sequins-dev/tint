import assert from "node:assert/strict";
import test from "node:test";
import type {
  ModuleRecord,
  ModuleRequest,
  ModuleCapability,
} from "../src/modules/index.ts";
import type {
  ObjectHooks,
  ScriptPropertyKey,
  OrdinaryObject,
} from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
import {
  createMutableBinding,
  initializeBinding,
} from "../src/environments/records/index.ts";
bindHostRecordViews();
const objects = await import("../src/objects/index.ts");
const modules = await import("../src/modules/index.ts");
function fixture() {
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => assert.fail("unexpected user call"),
  };
  const realm = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const log: string[] = [],
    pending = new Map<string, ModuleCapability>();
  function make(
    name: string,
    dependencies: ModuleRecord[] = [],
    phases: ModuleRequest["phase"][] = [],
    async = false,
    action: (module: ModuleRecord) => void = () => {},
  ) {
    let module: ModuleRecord;
    module = modules.createSourceTextModule(
      realm,
      {
        requests: dependencies.map((_, i) => ({
          specifier: String(i),
          attributes: [],
          ...(phases[i] === undefined ? {} : { phase: phases[i] }),
        })),
        imports: [],
        localExports: [
          { exportName: "value", localName: "value" },
          { exportName: "then", localName: "then" },
        ],
        indirectExports: [],
        starExports: [],
        hasTopLevelAwait: async,
      },
      name,
      (environment) => {
        createMutableBinding(environment, "value", false);
        createMutableBinding(environment, "then", false);
      },
      () => {},
      () => {
        log.push(name);
        initializeBinding(module.environment, "value", 42);
        initializeBinding(module.environment, "then", 99);
        action(module);
      },
      async
        ? (capability: ModuleCapability): void => {
            log.push(name + ":start");
            pending.set(name, capability);
          }
        : undefined,
    );
    module.status = "unlinked";
    for (let i = 0; i < dependencies.length; i++)
      module.loaded[i] = dependencies[i];
    return module;
  }
  const link = (module: ModuleRecord) =>
    assert.deepEqual(modules.linkModule(module), { ok: true });
  const drain = () =>
    objects.drainScriptJobs(realm.agent, (error) => {
      throw error;
    });
  return { realm, hooks, log, pending, make, link, drain };
}
test("a deferred namespace has a separate stable identity and evaluates once on a string read", () => {
  const f = fixture(),
    target = f.make("target");
  f.link(target);
  const deferred = modules.getModuleNamespace(target, "defer"),
    eager = modules.getModuleNamespace(target);
  assert.notEqual(deferred, eager);
  assert.equal(modules.getModuleNamespace(target, "defer"), deferred);
  const tag = objects.wellKnownSymbol(f.realm.symbolRegistry, "toStringTag");
  assert.equal(
    objects.getProperty(deferred, tag, deferred, f.hooks),
    "Deferred Module",
  );
  assert.equal(
    objects.getProperty(deferred, "then", deferred, f.hooks),
    undefined,
  );
  assert.deepEqual(f.log, []);
  assert.equal(
    objects.getProperty(deferred, "missing", deferred, f.hooks),
    undefined,
  );
  assert.deepEqual(f.log, ["target"]);
  assert.equal(objects.getProperty(deferred, "value", deferred, f.hooks), 42);
  assert.deepEqual(f.log, ["target"]);
});
test("deferred namespace existence, descriptors, deletion and enumeration each trigger evaluation", () => {
  for (const operation of ["has", "descriptor", "delete", "keys"]) {
    const f = fixture(),
      target = f.make("target");
    f.link(target);
    const namespace = modules.getModuleNamespace(target, "defer");
    if (operation === "has")
      assert.equal(objects.hasProperty(namespace, "missing"), false);
    else if (operation === "descriptor")
      assert.equal(objects.getOwnProperty(namespace, "missing"), undefined);
    else if (operation === "delete")
      assert.equal(objects.deleteProperty(namespace, "missing"), true);
    else
      assert.deepEqual(
        objects.ownKeys(namespace, () => 0),
        [
          "then",
          "value",
          objects.wellKnownSymbol(f.realm.symbolRegistry, "toStringTag"),
        ],
      );
    assert.deepEqual(f.log, ["target"], operation);
  }
});
test("deferred edges are linked but synchronous bodies wait until first namespace access", () => {
  const f = fixture(),
    leaf = f.make("leaf"),
    target = f.make("target", [leaf]),
    root = f.make("root", [target], ["defer"]);
  f.link(root);
  const promise = modules.evaluateModule(root, f.hooks);
  assert.equal(promise.internalPromiseData?.state, "fulfilled");
  assert.deepEqual(f.log, ["root"]);
  const ns = modules.getModuleNamespace(target, "defer");
  assert.equal(objects.getProperty(ns, "value", ns, f.hooks), 42);
  assert.deepEqual(f.log, ["root", "leaf", "target"]);
});
test("a deferred edge eagerly evaluates asynchronous transitive dependencies but leaves synchronous ancestors deferred", () => {
  const f = fixture(),
    async = f.make("async", [], [], true),
    sync = f.make("sync"),
    target = f.make("target", [async, sync]),
    root = f.make("root", [target], ["defer"]);
  f.link(root);
  const promise = modules.evaluateModule(root, f.hooks);
  assert.deepEqual(f.log, ["async:start"]);
  assert.equal(promise.internalPromiseData?.state, "pending");
  f.pending.get("async")!.functions.resolve(undefined);
  f.drain();
  assert.deepEqual(f.log, ["async:start", "root"]);
  assert.equal(promise.internalPromiseData?.state, "fulfilled");
  const ns = modules.getModuleNamespace(target, "defer");
  objects.getProperty(ns, "value", ns, f.hooks);
  assert.deepEqual(f.log, ["async:start", "root", "sync", "target"]);
});
test("a pending asynchronous dependency prevents synchronous triggering before any body executes", () => {
  const f = fixture(),
    async = f.make("async", [], [], true),
    target = f.make("target", [async]);
  f.link(target);
  modules.evaluateModule(async, f.hooks);
  const ns = modules.getModuleNamespace(target, "defer");
  assert.throws(
    () => objects.getProperty(ns, "value", ns, f.hooks),
    (error) =>
      objects.viewObjectValue(error, f.realm.objectPrototype)?.prototype ===
      f.realm.prototypes.get("type"),
  );
  assert.deepEqual(f.log, ["async:start"]);
});
test("deferred namespace re-entrance throws TypeError and repeated failed accesses preserve the original error", () => {
  const f = fixture();
  let ns: OrdinaryObject<ScriptPropertyKey, unknown>;
  const target = f.make("target", [], [], false, () => {
    objects.getProperty(ns, "value", ns, f.hooks);
  });
  f.link(target);
  ns = modules.getModuleNamespace(target, "defer");
  let first: unknown;
  try {
    objects.getProperty(ns, "value", ns, f.hooks);
  } catch (error) {
    first = error;
  }
  assert.equal(
    objects.viewObjectValue(first, f.realm.objectPrototype)?.prototype,
    f.realm.prototypes.get("type"),
  );
  assert.throws(
    () => objects.getProperty(ns, "value", ns, f.hooks),
    (error) => error === first,
  );
  assert.deepEqual(f.log, ["target"]);
});
test("import.defer resolves a deferred namespace without assimilating an exported then or executing synchronous code", () => {
  const f = fixture(),
    target = f.make("target");
  f.realm.moduleLoader = (referrer, request, _host, payload) => {
    assert.equal(request.phase, "defer");
    modules.finishLoadingImportedModule(referrer, request, payload, {
      ok: true,
      module: target,
    });
  };
  const promise = modules.evaluateImportCall(
    "target",
    undefined,
    f.hooks,
    f.realm,
    "defer",
  );
  f.drain();
  assert.equal(promise.internalPromiseData?.state, "fulfilled");
  assert.deepEqual(f.log, []);
  const namespace = promise.internalPromiseData?.result;
  assert.equal(namespace, modules.getModuleNamespace(target, "defer"));
});

test("import.defer waits for asynchronous leaves and resolves before executing synchronous ancestors", () => {
  const f = fixture(),
    leaf = f.make("leaf", [], [], true),
    target = f.make("target", [leaf]);
  f.realm.moduleLoader = (referrer, request, _host, payload) =>
    modules.finishLoadingImportedModule(referrer, request, payload, {
      ok: true,
      module: target,
    });
  const promise = modules.evaluateImportCall(
    "target",
    undefined,
    f.hooks,
    f.realm,
    "defer",
  );
  f.drain();
  assert.deepEqual(f.log, ["leaf:start"]);
  assert.equal(promise.internalPromiseData?.state, "pending");
  f.pending.get("leaf")!.functions.resolve(undefined);
  f.drain();
  assert.deepEqual(f.log, ["leaf:start"]);
  assert.equal(promise.internalPromiseData?.state, "fulfilled");
});

test("successful source, deferred and ordinary loads cannot change a resource's module identity", async () => {
  const { recordLoadedModule } = await import("../src/modules/referrer.ts");
  const f = fixture(),
    first = f.make("first"),
    second = f.make("second"),
    referrer = modules.realmReferrer(f.realm);
  recordLoadedModule(
    referrer,
    { specifier: "m", attributes: [], phase: "defer" },
    first,
  );
  assert.throws(
    () =>
      recordLoadedModule(referrer, { specifier: "m", attributes: [] }, second),
    (error) => error === "MODULE_LOAD_IDENTITY_INVARIANT",
  );
});
test("static requests of different phases share one successful load and still traverse the eager graph", () => {
  const f = fixture(),
    target = f.make("target");
  const root = modules.createSourceTextModule(
    f.realm,
    {
      requests: [
        { specifier: "m", attributes: [], phase: "defer" },
        { specifier: "m", attributes: [] },
      ],
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
  target.status = "new";
  let loads = 0;
  f.realm.moduleLoader = (referrer, request, _host, payload) => {
    loads++;
    modules.finishLoadingImportedModule(referrer, request, payload, {
      ok: true,
      module: target,
    });
  };
  const promise = modules.loadRequestedModules(root, f.hooks, undefined);
  assert.equal(promise.internalPromiseData?.state, "fulfilled");
  assert.equal(loads, 1);
  assert.equal(target.status, "unlinked");
});
