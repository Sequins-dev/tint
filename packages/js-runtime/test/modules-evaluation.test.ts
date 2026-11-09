import assert from "node:assert/strict";
import test from "node:test";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
import type { ObjectHooks, ScriptPropertyKey } from "../src/objects/index.ts";
import type { ModuleRecord } from "../src/modules/records.ts";
bindHostRecordViews();
const objects = await import("../src/objects/index.ts");
const modules = await import("../src/modules/index.ts");
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => assert.fail("unexpected call"),
};
function fixture() {
  const realm = objects.createErrorRealm(
      objects.createObject<ScriptPropertyKey, unknown>(undefined),
      hooks,
    ),
    log: string[] = [];
  function make(
    name: string,
    dependencies: ModuleRecord[] = [],
    execute: () => void = () => {
      log.push(name);
    },
    tla = false,
  ): ModuleRecord {
    const module = modules.createSourceTextModule(
      realm,
      {
        requests: dependencies.map((dependency, index) => ({
          specifier: String(index),
          attributes: [],
        })),
        imports: [],
        localExports: [],
        indirectExports: [],
        starExports: [],
        hasTopLevelAwait: tla,
      },
      name,
      () => {},
      () => {},
      execute,
    );
    module.status = "unlinked";
    for (let i = 0; i < dependencies.length; i++)
      module.loaded[i] = dependencies[i];
    return module;
  }
  return { realm, log, make };
}
test("evaluation runs dependency post-order exactly once and reuses the root promise", () => {
  assert.equal(typeof modules.evaluateModule, "function");
  const { make, log } = fixture(),
    c = make("c"),
    a = make("a", [c]),
    b = make("b", [c]),
    root = make("root", [a, b]);
  assert.equal(modules.linkModule(root).ok, true);
  const promise = modules.evaluateModule(root, hooks);
  assert.equal(promise.internalPromiseData?.state, "fulfilled");
  assert.deepEqual(log, ["c", "a", "b", "root"]);
  assert.equal(modules.evaluateModule(root, hooks), promise);
  assert.equal(log.length, 4);
});
test("cyclic success shares one cycle root and never re-executes", () => {
  const { make, log } = fixture(),
    a = make("a"),
    root = make("root", [a]);
  const cycle = modules.createSourceTextModule(
    root.realm,
    { ...a.shape, requests: [{ specifier: "root", attributes: [] }] },
    "cycle",
    () => {},
    () => {},
    () => {
      log.push("cycle");
    },
  );
  cycle.status = "unlinked";
  root.loaded[0] = cycle;
  cycle.loaded[0] = root;
  assert.equal(modules.linkModule(root).ok, true);
  const promise = modules.evaluateModule(root, hooks);
  assert.deepEqual(log, ["cycle", "root"]);
  assert.equal(cycle.cycleRoot, root);
  assert.equal(modules.evaluateModule(cycle, hooks), promise);
});
test("an error marks every active cycle member, while later member evaluation makes a fresh rejection", () => {
  const { make, log, realm } = fixture(),
    error = objects.createObject<ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    ),
    a = make("a"),
    root = make("root", [a], () => {
      throw error;
    });
  const cycle = modules.createSourceTextModule(
    root.realm,
    { ...a.shape, requests: [{ specifier: "root", attributes: [] }] },
    undefined,
    () => {},
    () => {},
    () => {
      log.push("cycle");
    },
  );
  cycle.status = "unlinked";
  root.loaded[0] = cycle;
  cycle.loaded[0] = root;
  modules.linkModule(root);
  const promise = modules.evaluateModule(root, hooks);
  assert.equal(promise.internalPromiseData?.result, error);
  assert.equal(root.evaluationError?.error, error);
  assert.equal(cycle.evaluationError?.error, error);
  assert.equal(cycle.cycleRoot, undefined);
  const second = modules.evaluateModule(cycle, hooks);
  assert.notEqual(second, promise);
  assert.equal(second.internalPromiseData?.result, error);
  assert.equal(modules.evaluateModule(root, hooks), promise);
  assert.deepEqual(log, ["cycle"]);
});
test("completed child groups keep success and later siblings remain linked after a failure", () => {
  const { make, log, realm } = fixture(),
    error = objects.createObject<ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    ),
    child = make("child"),
    fail = make("fail", [], () => {
      throw error;
    }),
    later = make("later"),
    root = make("root", [child, fail, later]);
  modules.linkModule(root);
  const promise = modules.evaluateModule(root, hooks);
  assert.equal(promise.internalPromiseData?.result, error);
  assert.deepEqual(log, ["child"]);
  assert.equal(child.cycleRoot, child);
  assert.equal(child.evaluationError, undefined);
  assert.equal(later.status, "linked");
  modules.evaluateModule(later, hooks);
  assert.deepEqual(log, ["child", "later"]);
});
test("throw undefined is a cached rejection and the host handles its rejection tracker", () => {
  const { realm, make } = fixture(),
    events: string[] = [];
  realm.promiseRejectionTracker = (_promise, operation) => {
    events.push(operation);
  };
  const root = make("root", [], () => {
    throw undefined;
  });
  modules.linkModule(root);
  const promise = modules.evaluateModule(root, hooks);
  assert.deepEqual(root.evaluationError, { error: undefined });
  assert.deepEqual(modules.settledModulePromise(promise, realm), {
    kind: "rejected",
    error: undefined,
  });
  assert.deepEqual(events, ["reject", "handle"]);
  modules.settledModulePromise(promise, realm);
  assert.equal(events.length, 2);
});
test("module execution and its jobs retain module identity and restore the caller", () => {
  const { realm, make } = fixture(),
    seen: unknown[] = [],
    root = make("root", [], () => {
      seen.push(realm.agent.activeContext?.scriptOrModule);
      objects.enqueueScriptJob(
        realm.agent,
        () => {
          seen.push(realm.agent.activeContext?.scriptOrModule);
        },
        realm.executionContext,
      );
    });
  modules.linkModule(root);
  const outside = {};
  objects.runScriptContext(
    realm.agent,
    { realm, scriptOrModule: outside },
    () => {
      modules.evaluateModule(root, hooks);
      assert.equal(realm.agent.activeContext?.scriptOrModule, outside);
      assert.equal(seen.length, 1);
    },
  );
  objects.drainScriptJobs(realm.agent, () => assert.fail("job threw"));
  assert.deepEqual(seen, [root, root]);
});
test("top-level await rejects as unsupported before any graph effects or capability creation", () => {
  const { realm, make, log } = fixture(),
    first = make("first"),
    async = make("async", [], undefined, true),
    root = make("root", [first, async]);
  modules.linkModule(root);
  assert.throws(
    () => modules.evaluateModule(root, hooks),
    (error) => error === undefined,
  );
  assert.equal(realm.unsupported, true);
  assert.deepEqual(log, []);
  assert.equal(root.status, "linked");
  assert.equal(root.topLevelCapability, undefined);
});
test("host invariant faults propagate but identical strings thrown by module code are cached", () => {
  const { make } = fixture(),
    leaf = make("leaf"),
    root = make("root", [leaf]);
  modules.linkModule(root);
  root.loaded[0] = undefined;
  assert.throws(
    () => modules.evaluateModule(root, hooks),
    (error) => error === "MODULE_LOADED_INVARIANT",
  );
  assert.equal(root.evaluationError, undefined);
  const thrown = make("thrown", [], () => {
    throw "MODULE_LOADED_INVARIANT";
  });
  modules.linkModule(thrown);
  assert.equal(
    modules.evaluateModule(thrown, hooks).internalPromiseData?.result,
    "MODULE_LOADED_INVARIANT",
  );
});
test("evaluation requires linking first", () => {
  const { make } = fixture(),
    root = make("root");
  assert.throws(
    () => modules.evaluateModule(root, hooks),
    (error) => error === "MODULE_EVALUATE_INVARIANT",
  );
});
