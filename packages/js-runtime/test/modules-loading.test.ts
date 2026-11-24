import assert from "node:assert/strict";
import test from "node:test";
import type * as moduleTypes from "../src/modules/index.ts";
import type * as objectTypes from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
bindHostRecordViews();
const objects = await import("../src/objects/index.ts");
const modules = await import("../src/modules/index.ts");
import type { ModuleRecord, ModuleRequest } from "../src/modules/records.ts";
const hooks: objectTypes.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => assert.fail("unexpected call"),
};
function fixture() {
  const realm = objects.createErrorRealm(
    objects.createObject<objectTypes.ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const request = (specifier: string): ModuleRequest => ({
    specifier,
    attributes: [],
  });
  const make = (name: string, requests: ModuleRequest[] = []): ModuleRecord =>
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
      () => {},
      (): void => {},
    );
  return { realm, request, make };
}
test("synchronous graph loading follows source-order DFS and commits statuses together", () => {
  assert.equal(typeof modules.loadRequestedModules, "function");
  const { realm, request, make } = fixture(),
    b = make("b"),
    a = make("a", [request("b")]),
    c = make("c"),
    root = make("root", [request("a"), request("c")]);
  const records = new Map([
      ["a", a],
      ["b", b],
      ["c", c],
    ]),
    log: string[] = [];
  realm.moduleLoader = (referrer, req, host, payload) => {
    assert.equal(referrer.kind, "module");
    if (referrer.kind !== "module") assert.fail("unexpected referrer");
    log.push(`${referrer.hostDefined}->${req.specifier}`);
    assert.equal(root.status, "new");
    assert.equal(host, 42);
    const module = records.get(req.specifier);
    assert.ok(module);
    modules.finishLoadingImportedModule(referrer, req, payload, {
      ok: true,
      module,
    });
  };
  const promise = modules.loadRequestedModules(root, hooks, 42);
  assert.deepEqual(log, ["root->a", "a->b", "root->c"]);
  assert.equal(
    promise.internalExoticSlots?.internalPromiseData?.state,
    "fulfilled",
  );
  for (const module of [root, a, b, c]) assert.equal(module.status, "unlinked");
  assert.equal(
    modules.loadRequestedModules(root, hooks, undefined).internalExoticSlots
      ?.internalPromiseData?.state,
    "fulfilled",
  );
  assert.equal(log.length, 3);
});
test("asynchronous loads stay new until every completion, including cycles", () => {
  const { realm, request, make } = fixture(),
    root = make("root", [request("a"), request("c")]),
    a = make("a", [request("root")]),
    c = make("c");
  const pending: (() => void)[] = [];
  const records = new Map([
    ["root", root],
    ["a", a],
    ["c", c],
  ]);
  realm.moduleLoader = (referrer, req, _host, payload) => {
    const module = records.get(req.specifier);
    assert.ok(module);
    pending.push(() =>
      modules.finishLoadingImportedModule(referrer, req, payload, {
        ok: true,
        module,
      }),
    );
  };
  const promise = modules.loadRequestedModules(root, hooks, undefined);
  pending[1]!();
  assert.equal(c.status, "new");
  assert.equal(
    promise.internalExoticSlots?.internalPromiseData?.state,
    "pending",
  );
  pending[0]!();
  assert.equal(root.status, "new");
  pending[2]!();
  assert.equal(
    promise.internalExoticSlots?.internalPromiseData?.state,
    "fulfilled",
  );
  assert.equal(a.status, "unlinked");
});
test("first failure wins, late successes persist and retries load only missing slots", () => {
  const { realm, request, make } = fixture(),
    root = make("root", [request("a"), request("c")]),
    a = make("a"),
    c = make("c", [request("leaf")]),
    leaf = make("leaf");
  const pending: ((result: moduleTypes.ModuleCompletion) => void)[] = [],
    log: string[] = [];
  realm.moduleLoader = (referrer, req, _host, payload) => {
    log.push(req.specifier);
    pending.push((result) =>
      modules.finishLoadingImportedModule(referrer, req, payload, result),
    );
  };
  const promise = modules.loadRequestedModules(root, hooks, undefined),
    error = objects.createObject<objectTypes.ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    );
  pending[0]!({ ok: false, error });
  pending[1]!({ ok: true, module: c });
  assert.equal(
    promise.internalExoticSlots?.internalPromiseData?.state,
    "rejected",
  );
  assert.equal(promise.internalExoticSlots?.internalPromiseData?.result, error);
  assert.equal(root.loaded[1], c);
  assert.deepEqual(log, ["a", "c"]);
  assert.equal(root.status, "new");
  const retry = modules.loadRequestedModules(root, hooks, undefined);
  assert.deepEqual(log, ["a", "c", "a", "leaf"]);
  pending[2]!({ ok: true, module: a });
  pending[3]!({ ok: true, module: leaf });
  assert.equal(
    retry.internalExoticSlots?.internalPromiseData?.state,
    "fulfilled",
  );
});
test("synchronous failure stops requesting later siblings", () => {
  const { realm, request, make } = fixture(),
    root = make("root", [request("a"), request("b")]),
    error = objects.createObject<objectTypes.ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    ),
    log: string[] = [];
  realm.moduleLoader = (referrer, req, _host, payload) => {
    log.push(req.specifier);
    modules.finishLoadingImportedModule(referrer, req, payload, {
      ok: false,
      error,
    });
  };
  assert.equal(
    modules.loadRequestedModules(root, hooks, undefined).internalExoticSlots
      ?.internalPromiseData?.result,
    error,
  );
  assert.deepEqual(log, ["a"]);
});
test("unsupported attributes reject in the active realm before calling the loader", () => {
  const { realm, make } = fixture(),
    other = objects.createErrorRealm(
      objects.createObject<objectTypes.ScriptPropertyKey, unknown>(undefined),
      hooks,
      realm.symbolRegistry,
      realm.agent,
    ),
    root = make("root", [
      { specifier: "a", attributes: [{ key: "type", value: "json" }] },
    ]);
  realm.moduleLoader = () => assert.fail("unsupported request reached host");
  const promise = objects.runScriptContext(
    realm.agent,
    { realm: other, scriptOrModule: undefined },
    () => modules.loadRequestedModules(root, hooks, undefined),
  );
  const data = promise.internalExoticSlots?.internalPromiseData;
  assert.equal(data?.state, "rejected");
  assert.equal(
    (
      data?.result as objectTypes.OrdinaryObject<
        objectTypes.ScriptPropertyKey,
        unknown
      >
    ).prototype,
    other.prototypes.get("syntax"),
  );
});
test("request equality compares attribute sets rather than their order", () => {
  const a = {
    specifier: "a",
    attributes: [
      { key: "x", value: "1" },
      { key: "y", value: "2" },
    ],
  };
  assert.equal(
    modules.moduleRequestsEqual(a, {
      ...a,
      attributes: [...a.attributes].reverse(),
    }),
    true,
  );
  assert.equal(
    modules.moduleRequestsEqual(a, {
      ...a,
      attributes: [
        { key: "x", value: "2" },
        { key: "y", value: "2" },
      ],
    }),
    false,
  );
  assert.equal(modules.moduleRequestsEqual(a, { ...a, attributes: [] }), false);
  assert.equal(modules.moduleRequestsEqual(a, { ...a, specifier: "b" }), false);
});
test("host identity and unknown-request faults propagate without settling the graph", () => {
  const { realm, request, make } = fixture(),
    root = make("root", [request("a")]),
    a = make("a"),
    different = make("other");
  let finish: (() => void) | undefined;
  realm.moduleLoader = (referrer, req, _host, payload) => {
    root.loaded[0] = a;
    finish = () =>
      modules.finishLoadingImportedModule(referrer, req, payload, {
        ok: true,
        module: different,
      });
    assert.throws(
      () =>
        modules.finishLoadingImportedModule(
          referrer,
          request("unknown"),
          payload,
          { ok: true, module: a },
        ),
      (e) => e === "MODULE_REQUEST_INVARIANT",
    );
  };
  const promise = modules.loadRequestedModules(root, hooks, undefined);
  assert.ok(finish);
  assert.throws(finish, (e) => e === "MODULE_LOAD_IDENTITY_INVARIANT");
  assert.equal(
    promise.internalExoticSlots?.internalPromiseData?.state,
    "pending",
  );
});
test("missing loader sets sticky unsupported rather than manufacturing a rejection", () => {
  const { realm, request, make } = fixture(),
    root = make("root", [request("a")]);
  assert.throws(
    () => modules.loadRequestedModules(root, hooks, undefined),
    (error) => error === undefined,
  );
  assert.equal(realm.unsupported, true);
  assert.equal(root.status, "new");
});

test("overlapping loads preserve a module already linked and evaluated by another graph", () => {
  const { realm, request, make } = fixture(),
    leaf = make("leaf"),
    root = make("root", [request("leaf")]);
  const pending: (() => void)[] = [];
  realm.moduleLoader = (referrer, req, _host, payload) => {
    pending.push(() =>
      modules.finishLoadingImportedModule(referrer, req, payload, {
        ok: true,
        module: leaf,
      }),
    );
  };
  const first = modules.loadRequestedModules(root, hooks, undefined);
  const second = modules.loadRequestedModules(root, hooks, undefined);
  assert.equal(
    first.internalExoticSlots?.internalPromiseData?.state,
    "pending",
  );
  assert.equal(
    second.internalExoticSlots?.internalPromiseData?.state,
    "pending",
  );
  pending[0]!();
  assert.equal(
    first.internalExoticSlots?.internalPromiseData?.state,
    "fulfilled",
  );
  assert.equal(modules.linkModule(root).ok, true);
  assert.equal(
    modules.evaluateModule(root, hooks).internalExoticSlots?.internalPromiseData
      ?.state,
    "fulfilled",
  );
  assert.equal(root.status, "evaluated");
  pending[1]!();
  assert.equal(
    second.internalExoticSlots?.internalPromiseData?.state,
    "fulfilled",
  );
  assert.equal(root.status, "evaluated");
  assert.equal(leaf.status, "evaluated");
});

test("graph loading rejects non-static requests and non-module referrers", async () => {
  const { createModuleCapability } = await import("../src/modules/loading.ts");
  const { realm, make, request } = fixture(),
    root = make("root"),
    target = make("target");
  const state: moduleTypes.GraphLoadingState = {
    kind: "graph",
    capability: createModuleCapability(realm, hooks),
    isLoading: true,
    pendingModulesCount: 1,
    visited: [],
    hostDefined: undefined,
  };
  for (const referrer of [
    root,
    objects.createScriptRecord(realm, undefined),
    modules.realmReferrer(realm),
  ]) {
    assert.throws(
      () =>
        modules.finishLoadingImportedModule(
          referrer,
          request("missing"),
          state,
          { ok: true, module: target },
        ),
      (error) => error === "MODULE_REQUEST_INVARIANT",
    );
  }
});
test("dynamic loads cache successful requests and reject duplicate completions", async () => {
  const { createModuleCapability } = await import("../src/modules/loading.ts");
  const { realm, make, request } = fixture(),
    target = make("target");
  for (const referrer of [
    make("module"),
    objects.createScriptRecord(realm, undefined),
    modules.realmReferrer(realm),
  ]) {
    const state: moduleTypes.DynamicImportState = {
      kind: "dynamic",
      capability: createModuleCapability(realm, hooks),
      hooks,
      finished: false,
    };
    modules.finishLoadingImportedModule(referrer, request("dynamic"), state, {
      ok: true,
      module: target,
    });
    assert.equal(state.finished, true);
    assert.equal(referrer.loadedRequests[0]?.module, target);
    assert.throws(
      () =>
        modules.finishLoadingImportedModule(
          referrer,
          request("dynamic"),
          state,
          { ok: true, module: target },
        ),
      (error) => error === "MODULE_DYNAMIC_PAYLOAD_INVARIANT",
    );
  }
});
test("failed dynamic loads reject without recording a loaded module", async () => {
  const { createModuleCapability } = await import("../src/modules/loading.ts");
  const { realm, request } = fixture(),
    referrer = objects.createScriptRecord(realm, undefined),
    error = objects.createObject<objectTypes.ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    );
  const state: moduleTypes.DynamicImportState = {
    kind: "dynamic",
    capability: createModuleCapability(realm, hooks),
    hooks,
    finished: false,
  };
  modules.finishLoadingImportedModule(referrer, request("missing"), state, {
    ok: false,
    error,
  });
  assert.deepEqual(referrer.loadedRequests, []);
  assert.equal(state.finished, true);
  assert.equal(
    state.capability.promise.internalExoticSlots?.internalPromiseData?.state,
    "rejected",
  );
  assert.equal(
    state.capability.promise.internalExoticSlots?.internalPromiseData?.result,
    error,
  );
});

test("a completed dynamic load links and evaluates on jobs before resolving its namespace", async () => {
  const { createModuleCapability } = await import("../src/modules/loading.ts");
  const { realm, request } = fixture();
  let executed = 0;
  const target = modules.createSourceTextModule(
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
    () => {
      executed++;
    },
  );
  const referrer = objects.createScriptRecord(realm, undefined),
    state: moduleTypes.DynamicImportState = {
      kind: "dynamic",
      capability: createModuleCapability(realm, hooks),
      hooks,
      finished: false,
    };
  modules.finishLoadingImportedModule(referrer, request("target"), state, {
    ok: true,
    module: target,
  });
  assert.equal(executed, 0);
  assert.equal(
    state.capability.promise.internalExoticSlots?.internalPromiseData?.state,
    "pending",
  );
  assert.equal(
    objects.drainScriptJobs(realm.agent, () =>
      assert.fail("unexpected job failure"),
    ),
    2,
  );
  assert.equal(executed, 1);
  assert.equal(
    state.capability.promise.internalExoticSlots?.internalPromiseData?.state,
    "fulfilled",
  );
  assert.equal(
    state.capability.promise.internalExoticSlots?.internalPromiseData?.result,
    modules.getModuleNamespace(target),
  );
});
