import assert from "node:assert/strict";
import test from "node:test";
import type * as objectTypes from "../src/objects/index.ts";
import type { ModuleRequest } from "../src/modules/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
import {
  findBinding,
  bindingCount,
} from "../src/environments/records/index.ts";
bindHostRecordViews();
const objects = await import("../src/objects/index.ts");
const modules = await import("../src/modules/index.ts");
const realmWitness = objects.createObject<
  objectTypes.ScriptPropertyKey,
  unknown
>(undefined);
const hooks: objectTypes.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: (callee, receiver, arguments_) => {
    const fn = objects.viewObjectValue(callee, realmWitness);
    assert.ok(fn?.internalCall);
    return fn.internalCall(receiver, arguments_);
  },
};
function fixture() {
  const realm = objects.createErrorRealm(
    objects.createObject<objectTypes.ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const log: string[] = [];
  const make = (name: string, requests: ModuleRequest[] = []) =>
    modules.createSourceTextModule(
      realm,
      {
        requests,
        imports: [],
        localExports: [],
        indirectExports: [],
        starExports: [],
        hasTopLevelAwait: false,
      },
      name,
      () => {},
      () => {
        log.push(name + ":link");
      },
      () => {
        log.push(name + ":execute");
      },
    );
  return { realm, make, log };
}
test("source import of JavaScript rejects with SyntaxError without linking or evaluating its graph", () => {
  const { realm, make, log } = fixture();
  const target = make("target", [{ specifier: "unloaded", attributes: [] }]);
  realm.moduleLoader = (referrer, request, _host, payload) => {
    modules.finishLoadingImportedModule(referrer, request, payload, {
      ok: true,
      module: target,
    });
  };
  const promise = modules.evaluateImportCall(
    "target",
    undefined,
    hooks,
    realm,
    "source",
  );
  objects.drainScriptJobs(realm.agent, () => assert.fail("job failed"));
  assert.equal(promise.internalPromiseData?.state, "rejected");
  assert.equal(
    objects.viewObjectValue(
      promise.internalPromiseData?.result,
      realm.objectPrototype,
    )?.prototype,
    realm.prototypes.get("syntax"),
  );
  assert.deepEqual(log, []);
  assert.equal(target.status, "new");
});
test("source phase reaches the loader after coercion and preserves its host source identity", () => {
  const { realm, make, log } = fixture(),
    target = make("target");
  const source = objects.createObject<objectTypes.ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  target.moduleSource = source;
  realm.moduleLoader = (referrer, request, _host, payload) => {
    assert.equal(request.phase, "source");
    modules.finishLoadingImportedModule(referrer, request, payload, {
      ok: true,
      module: target,
    });
  };
  const promise = modules.evaluateImportCall(
    "target",
    undefined,
    hooks,
    realm,
    "source",
  );
  assert.equal(promise.internalPromiseData?.state, "fulfilled");
  assert.equal(promise.internalPromiseData?.result, source);
  assert.deepEqual(log, []);
});
test("static source edges load only their target and initialize an immutable source binding", () => {
  const { realm, make, log } = fixture(),
    target = make("target", [{ specifier: "unloaded", attributes: [] }]);
  const source = objects.createObject<objectTypes.ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  target.moduleSource = source;
  const importer = modules.createSourceTextModule(
    realm,
    {
      requests: [{ specifier: "target", attributes: [], phase: "source" }],
      imports: [{ request: 0, importName: "source", localName: "value" }],
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
  const loads: string[] = [];
  realm.moduleLoader = (referrer, request, _host, payload) => {
    loads.push(request.specifier);
    assert.equal(request.specifier, "target");
    modules.finishLoadingImportedModule(referrer, request, payload, {
      ok: true,
      module: target,
    });
  };
  const loading = modules.loadRequestedModules(importer, hooks, undefined);
  assert.equal(loading.internalPromiseData?.state, "fulfilled");
  assert.deepEqual(loads, ["target"]);
  assert.equal(target.status, "new");
  assert.deepEqual(modules.linkModule(importer), { ok: true });
  const binding = findBinding(importer.environment, "value");
  assert.equal(binding?.value, source);
  assert.equal(binding?.mutable, false);
  assert.deepEqual(log, []);
});
test("a source re-export resolves to the source object and stays distinct from a namespace export", () => {
  const { realm, make } = fixture(),
    target = make("target");
  const source = objects.createObject<objectTypes.ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  target.moduleSource = source;
  const wrapper = modules.createSourceTextModule(
    realm,
    {
      requests: [{ specifier: "target", attributes: [], phase: "source" }],
      imports: [],
      localExports: [],
      indirectExports: [
        { exportName: "value", request: 0, importName: "source" },
      ],
      starExports: [],
      hasTopLevelAwait: false,
    },
    undefined,
    () => {},
    () => {},
    () => {},
  );
  wrapper.status = "unlinked";
  wrapper.loaded[0] = target;
  assert.deepEqual(modules.resolveExport(wrapper, "value"), {
    module: target,
    bindingName: undefined,
    source: true,
  });
  assert.equal(
    objects.getProperty(
      modules.getModuleNamespace(wrapper),
      "value",
      undefined,
      hooks,
    ),
    source,
  );
});

test("AbstractModuleSource has realm-owned constructor and prototype descriptors and cannot be called", () => {
  const { realm } = fixture();
  const constructor = realm.abstractModuleSourceConstructor;
  const prototype = realm.abstractModuleSourcePrototype;
  assert.ok(constructor);
  assert.equal(constructor.prototype, realm.functionPrototype);
  assert.equal(prototype.prototype, realm.objectPrototype);
  assert.deepEqual(objects.getOwnProperty(constructor, "prototype"), {
    accessor: false,
    value: prototype,
    writable: false,
    get: undefined,
    set: undefined,
    enumerable: false,
    configurable: false,
  });
  assert.equal(
    objects.getProperty(prototype, "constructor", prototype, hooks),
    constructor,
  );
  assert.equal(
    objects.getProperty(constructor, "name", constructor, hooks),
    "AbstractModuleSource",
  );
  assert.equal(
    objects.getProperty(constructor, "length", constructor, hooks),
    0,
  );
  const typeError = (error: unknown) =>
    objects.viewObjectValue(error, realm.objectPrototype)?.prototype ===
    realm.prototypes.get("type");
  assert.throws(() => constructor.internalCall!(undefined, []), typeError);
  assert.throws(
    () => constructor.internalConstruct!([], constructor),
    typeError,
  );
});
test("module source toStringTag accessor uses its internal brand, never inherited properties", () => {
  const { realm } = fixture(),
    prototype = realm.abstractModuleSourcePrototype;
  assert.ok(prototype);
  const tag = objects.wellKnownSymbol(realm.symbolRegistry, "toStringTag");
  const descriptor = objects.getOwnProperty(prototype, tag);
  assert.equal(descriptor?.accessor, true);
  assert.equal(descriptor?.enumerable, false);
  assert.equal(descriptor?.configurable, true);
  assert.equal(objects.getProperty(prototype, tag, 42, hooks), undefined);
  const hostPrototype = objects.createObject<
    objectTypes.ScriptPropertyKey,
    unknown
  >(prototype);
  const source = objects.createModuleSourceObject(
    realm,
    hostPrototype,
    "HostSource",
  );
  assert.equal(objects.getProperty(source, tag, source, hooks), "HostSource");
  const inherited = objects.createObject<
    objectTypes.ScriptPropertyKey,
    unknown
  >(source);
  assert.equal(
    objects.getProperty(inherited, tag, inherited, hooks),
    undefined,
  );
});

test("a missing static source rejects before any importer bindings are committed", () => {
  const { realm, make } = fixture(),
    ordinary = make("ordinary"),
    noSource = make("JavaScript");
  const importer = modules.createSourceTextModule(
    realm,
    {
      requests: [
        { specifier: "ordinary", attributes: [] },
        { specifier: "JavaScript", attributes: [], phase: "source" },
      ],
      imports: [
        { request: 0, importName: undefined, localName: "ns" },
        { request: 1, importName: "source", localName: "source" },
      ],
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
  importer.status = "unlinked";
  ordinary.status = "unlinked";
  importer.loaded[0] = ordinary;
  importer.loaded[1] = noSource;
  const linked = modules.linkModule(importer);
  assert.equal(linked.ok, false);
  assert.equal(bindingCount(importer.environment), 0);
});
