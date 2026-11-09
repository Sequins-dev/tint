import assert from "node:assert/strict";
import test from "node:test";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
import type { ObjectHooks, ScriptPropertyKey } from "../src/objects/index.ts";
import type { ModuleRecord } from "../src/modules/records.ts";
import type { ModuleCapability } from "../src/modules/loading.ts";
bindHostRecordViews();
const objects = await import("../src/objects/index.ts");
const modules = await import("../src/modules/index.ts");
function fixture() {
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => assert.fail("unexpected Script call"),
  };
  const realm = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const log: string[] = [];
  const pending = new Map<string, ModuleCapability>();
  function make(
    name: string,
    dependencies: ModuleRecord[] = [],
    async = false,
    action: () => void = () => {
      log.push(name);
    },
  ): ModuleRecord {
    const module = modules.createSourceTextModule(
      realm,
      {
        requests: dependencies.map((_, index) => ({
          specifier: String(index),
          attributes: [],
        })),
        imports: [],
        localExports: [],
        indirectExports: [],
        starExports: [],
        hasTopLevelAwait: async,
      },
      name,
      () => {},
      () => {},
      action,
      async
        ? (capability: ModuleCapability): void => {
            log.push(name + ":start");
            pending.set(name, capability);
          }
        : undefined,
    );
    module.status = "unlinked";
    for (let index = 0; index < dependencies.length; index++)
      module.loaded[index] = dependencies[index];
    return module;
  }
  function finish(name: string, error?: { value: unknown }) {
    const capability = pending.get(name);
    assert.ok(capability);
    pending.delete(name);
    log.push(name + (error === undefined ? ":finish" : ":reject"));
    if (error === undefined) capability.functions.resolve(undefined);
    else capability.functions.reject(error.value);
  }
  function drain() {
    objects.drainScriptJobs(realm.agent, (error) => {
      throw error;
    });
  }
  function evaluate(module: ModuleRecord) {
    assert.equal(modules.linkModule(module).ok, true);
    return modules.evaluateModule(module, hooks);
  }
  return { realm, hooks, log, make, finish, drain, evaluate };
}
test("async module evaluation remains pending until its completion job and reuses its promise", () => {
  const f = fixture(),
    root = f.make("root", [], true),
    promise = f.evaluate(root);
  assert.deepEqual(f.log, ["root:start"]);
  assert.equal(root.status, "evaluating-async");
  assert.equal(promise.internalPromiseData?.state, "pending");
  assert.equal(modules.evaluateModule(root, f.hooks), promise);
  f.finish("root");
  assert.equal(promise.internalPromiseData?.state, "pending");
  f.drain();
  assert.equal(promise.internalPromiseData?.state, "fulfilled");
  assert.equal(root.status, "evaluated");
  assert.equal(f.realm.agent.activeContext, undefined);
});
test("a suspended dependency does not block its sibling and delays its parent", () => {
  const f = fixture(),
    a = f.make("a", [], true),
    b = f.make("b"),
    root = f.make("root", [a, b]),
    promise = f.evaluate(root);
  assert.deepEqual(f.log, ["a:start", "b"]);
  assert.equal(promise.internalPromiseData?.state, "pending");
  f.finish("a");
  f.drain();
  assert.deepEqual(f.log, ["a:start", "b", "a:finish", "root"]);
  assert.equal(promise.internalPromiseData?.state, "fulfilled");
});
test("available ancestors of a diamond execute in async evaluation order", () => {
  const f = fixture(),
    leaf = f.make("leaf", [], true),
    a = f.make("a", [leaf]),
    b = f.make("b", [leaf]),
    root = f.make("root", [a, b]),
    promise = f.evaluate(root);
  assert.deepEqual(f.log, ["leaf:start"]);
  f.finish("leaf");
  f.drain();
  assert.deepEqual(f.log, ["leaf:start", "leaf:finish", "a", "b", "root"]);
  assert.equal(promise.internalPromiseData?.state, "fulfilled");
});
test("async rejection preserves undefined and prevents every waiting ancestor from executing", () => {
  const f = fixture(),
    leaf = f.make("leaf", [], true),
    a = f.make("a", [leaf]),
    b = f.make("b", [leaf]),
    root = f.make("root", [a, b]),
    promise = f.evaluate(root);
  f.finish("leaf", { value: undefined });
  f.drain();
  assert.deepEqual(f.log, ["leaf:start", "leaf:reject"]);
  for (const module of [leaf, a, b, root]) {
    assert.equal(module.status, "evaluated");
    assert.deepEqual(module.evaluationError, { error: undefined });
  }
  assert.equal(promise.internalPromiseData?.state, "rejected");
  assert.equal(promise.internalPromiseData?.result, undefined);
  assert.equal(modules.evaluateModule(root, f.hooks), promise);
});
test("an async cycle shares its root capability with already executed members", () => {
  const f = fixture(),
    unused = f.make("unused"),
    a = f.make("a", [unused], true),
    b = f.make("b", [a]);
  a.loaded[0] = b;
  const promise = f.evaluate(a);
  assert.deepEqual(f.log, ["b", "a:start"]);
  assert.equal(modules.evaluateModule(b, f.hooks), promise);
  f.finish("a");
  f.drain();
  assert.equal(promise.internalPromiseData?.state, "fulfilled");
  assert.equal(b.cycleRoot, a);
  assert.equal(b.status, "evaluated");
});
test("a synchronous ancestor error rejects later available ancestors without running them", () => {
  const f = fixture(),
    // Thrown values are JavaScript values: ordinary objects of the realm.
    error = objects.createObject<ScriptPropertyKey, unknown>(
      f.realm.objectPrototype,
    ),
    leaf = f.make("leaf", [], true),
    a = f.make("a", [leaf], false, () => {
      f.log.push("a");
      throw error;
    }),
    b = f.make("b", [leaf]),
    root = f.make("root", [a, b]),
    promise = f.evaluate(root);
  f.finish("leaf");
  f.drain();
  assert.deepEqual(f.log, ["leaf:start", "leaf:finish", "a", "b"]);
  assert.equal(promise.internalPromiseData?.state, "rejected");
  assert.equal(promise.internalPromiseData?.result, error);
});

test("a five-module async cycle respects dependency order as independent leaves finish", () => {
  const f = fixture(),
    unused = f.make("unused"),
    a = f.make("a", [unused, unused], true),
    d = f.make("d", [a], true),
    b = f.make("b", [d], true),
    e = f.make("e", [], true),
    c = f.make("c", [d, e], true);
  a.loaded[0] = b;
  a.loaded[1] = c;
  const promise = f.evaluate(a);
  assert.deepEqual(f.log, ["d:start", "e:start"]);
  assert.deepEqual(
    [
      d.asyncEvaluationOrder,
      b.asyncEvaluationOrder,
      e.asyncEvaluationOrder,
      c.asyncEvaluationOrder,
      a.asyncEvaluationOrder,
    ],
    [0, 1, 2, 3, 4],
  );
  f.finish("e");
  f.drain();
  assert.equal(c.pendingAsyncDependencies, 1);
  f.finish("d");
  f.drain();
  assert.deepEqual(f.log.slice(-3), ["d:finish", "b:start", "c:start"]);
  f.finish("c");
  f.drain();
  assert.equal(a.pendingAsyncDependencies, 1);
  f.finish("b");
  f.drain();
  assert.deepEqual(f.log.slice(-2), ["b:finish", "a:start"]);
  assert.equal(promise.internalPromiseData?.state, "pending");
  f.finish("a");
  f.drain();
  assert.equal(promise.internalPromiseData?.state, "fulfilled");
  assert.equal(modules.evaluateModule(b, f.hooks), promise);
});

test("a rejected async cycle remains rejected when another member later succeeds", () => {
  const f = fixture(),
    unused = f.make("unused"),
    a = f.make("a", [unused, unused], true),
    d = f.make("d", [a], true),
    b = f.make("b", [d], true),
    e = f.make("e", [], true),
    c = f.make("c", [d, e], true),
    error = objects.createObject<ScriptPropertyKey, unknown>(
      f.realm.objectPrototype,
    );
  a.loaded[0] = b;
  a.loaded[1] = c;
  const promise = f.evaluate(a);
  f.finish("e");
  f.drain();
  f.finish("d");
  f.drain();
  f.finish("c", { value: error });
  f.drain();
  assert.equal(promise.internalPromiseData?.state, "rejected");
  assert.equal(promise.internalPromiseData?.result, error);
  f.finish("b");
  f.drain();
  assert.equal(b.status, "evaluated");
  assert.equal(b.evaluationError, undefined);
  assert.equal(modules.evaluateModule(b, f.hooks), promise);
  assert.equal(f.log.includes("a:start"), false);
});

test("a synchronous async-entry host fault escapes without becoming a JavaScript rejection", () => {
  const f = fixture(),
    fault = { invariant: true },
    root = modules.createSourceTextModule(
      f.realm,
      {
        requests: [],
        imports: [],
        localExports: [],
        indirectExports: [],
        starExports: [],
        hasTopLevelAwait: true,
      },
      undefined,
      () => {},
      () => {},
      () => {},
      () => {
        throw fault;
      },
    );
  root.status = "unlinked";
  assert.throws(
    () => f.evaluate(root),
    (error) => error === fault,
  );
  assert.equal(root.evaluationError, undefined);
  assert.equal(f.realm.agent.activeContext, undefined);
});

test("an internal async reaction fault is retained separately from JavaScript evaluation errors", () => {
  const f = fixture(),
    leaf = f.make("leaf", [], true),
    root = f.make("root", [leaf]);
  f.evaluate(root);
  root.pendingAsyncDependencies = 0;
  f.finish("leaf");
  assert.throws(
    () => f.drain(),
    (error) => error === "PROMISE_INTERNAL_REACTION_INVARIANT",
  );
  assert.equal(leaf.executionFault?.error, "MODULE_ASYNC_DEPENDENCY_INVARIANT");
  assert.equal(root.evaluationError, undefined);
});
