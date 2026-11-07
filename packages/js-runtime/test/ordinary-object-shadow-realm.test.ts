import assert from "node:assert/strict";
import test from "node:test";
import type {
  OrdinaryObject,
  ErrorRealm,
  ObjectHooks,
  ScriptPropertyKey,
} from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
bindHostRecordViews();
const objects = await import("../src/objects/index.ts");
function fixture() {
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: (callee, receiver, args) => {
      const result = objects.callObjectValue(callee, receiver, args, root);
      assert.equal(result.error, "none");
      return result.value;
    },
  };
  const outer = objects.createErrorRealm(root, hooks);
  const inner = objects.createErrorRealm(
    root,
    hooks,
    outer.symbolRegistry,
    outer.agent,
  );
  const get = (
    value: OrdinaryObject<ScriptPropertyKey, unknown>,
    name: string,
  ) => objects.getProperty(value, name, value, hooks);
  return { root, hooks, outer, inner, get };
}
function typeError(realm: ErrorRealm) {
  return (error: unknown) =>
    (error as OrdinaryObject<ScriptPropertyKey, unknown>).prototype ===
    realm.prototypes.get("type");
}
test("ShadowRealm wrapping preserves primitives and rejects non-callable objects", () => {
  assert.equal(typeof objects.getShadowRealmWrappedValue, "function");
  const { outer, root } = fixture();
  for (const value of [undefined, null, true, 42, "x", NaN])
    assert.equal(objects.getShadowRealmWrappedValue(outer, value), value);
  assert.throws(
    () => objects.getShadowRealmWrappedValue(outer, root),
    typeError(outer),
  );
});
test("wrapped calls have fresh identities and wrap callable arguments, receiver and returns", () => {
  const { inner, outer, hooks, get } = fixture();
  const callback = objects.createCallableObject<ScriptPropertyKey, unknown>(
    outer.functionPrototype,
    () => 42,
    outer.executionContext,
  );
  const target = objects.createCallableObject<ScriptPropertyKey, unknown>(
    inner.functionPrototype,
    (receiver, args) => {
      const argument = objects.viewObjectValue(args[0], inner.objectPrototype)!;
      const wrappedThis = objects.viewObjectValue(
        receiver,
        inner.objectPrototype,
      )!;
      assert.notEqual(argument, callback);
      assert.equal(argument.prototype, inner.functionPrototype);
      assert.notEqual(wrappedThis, callback);
      assert.equal(wrappedThis.prototype, inner.functionPrototype);
      assert.equal(hooks.call(argument, undefined, []), 42);
      return argument;
    },
    inner.executionContext,
  );
  objects.createDataProperty(target, "name", "target", hooks);
  objects.createDataProperty(target, "length", 2.8, hooks);
  const wrapped = objects.getShadowRealmWrappedValue(
    outer,
    target,
  ) as OrdinaryObject<ScriptPropertyKey, unknown>;
  assert.notEqual(objects.getShadowRealmWrappedValue(outer, target), wrapped);
  assert.equal(wrapped.prototype, outer.functionPrototype);
  assert.equal(wrapped.internalConstruct, undefined);
  assert.equal(get(wrapped, "name"), "target");
  assert.equal(get(wrapped, "length"), 2);
  const returned = objects.viewObjectValue(
    hooks.call(wrapped, callback, [callback]),
    outer.objectPrototype,
  )!;
  assert.notEqual(returned, callback);
  assert.equal(returned.prototype, outer.functionPrototype);
});
test("wrapped failures copy TypeError into the wrapper realm without touching the exception", () => {
  const { inner, outer, hooks, root } = fixture();
  const failure = objects.createObject<ScriptPropertyKey, unknown>(
    inner.objectPrototype,
  );
  const target = objects.createCallableObject<ScriptPropertyKey, unknown>(
    inner.functionPrototype,
    () => {
      throw failure;
    },
    inner.executionContext,
  );
  const wrapped = objects.getShadowRealmWrappedValue(outer, target);
  assert.throws(() => hooks.call(wrapped, undefined, []), typeError(outer));
  assert.throws(() => hooks.call(wrapped, undefined, [root]), typeError(outer));
  assert.equal(outer.agent.activeContext, undefined);
});
test("name and length inspection errors are copied, inherited length is ignored", () => {
  const { inner, outer, hooks, get } = fixture();
  const parent = objects.createObject<ScriptPropertyKey, unknown>(
    inner.functionPrototype,
  );
  objects.createDataProperty(parent, "length", 10, hooks);
  const target = objects.createCallableObject<ScriptPropertyKey, unknown>(
    parent,
    () => undefined,
    inner.executionContext,
  );
  const wrapped = objects.getShadowRealmWrappedValue(
    outer,
    target,
  ) as OrdinaryObject<ScriptPropertyKey, unknown>;
  assert.equal(get(wrapped, "length"), 0);
  const getter = objects.createCallableObject<ScriptPropertyKey, unknown>(
    inner.functionPrototype,
    () => {
      throw 17;
    },
  );
  objects.defineOwnProperty(
    target,
    "name",
    {
      fields: 60,
      value: undefined,
      writable: false,
      get: getter,
      set: undefined,
      enumerable: false,
      configurable: true,
    },
    hooks,
  );
  assert.throws(
    () => objects.getShadowRealmWrappedValue(outer, target),
    typeError(outer),
  );
});

test("ShadowRealm construction and evaluate validate receivers before source and copy errors", () => {
  assert.equal(typeof objects.installShadowRealmIntrinsics, "function");
  const { root, hooks, inner, outer, get } = fixture();
  let created = 0;
  objects.installShadowRealmIntrinsics(root, outer, hooks, () => {
    created++;
    return {
      realm: inner,
      evaluate: (source: string) =>
        source === "bad"
          ? { error: "syntax", value: undefined }
          : source === "throw"
            ? { error: "throw", value: root }
            : { error: "none", value: source },
    };
  });
  const constructor = get(root, "ShadowRealm") as OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  assert.throws(() => hooks.call(constructor, undefined, []), typeError(outer));
  const result = objects.constructObject(
    constructor,
    [],
    { object: constructor, value: constructor },
    undefined,
  );
  assert.equal(result.error, "none");
  assert.equal(created, 1);
  const instance = result.value as OrdinaryObject<ScriptPropertyKey, unknown>;
  assert.equal(instance.prototype, outer.shadowRealmPrototype);
  const evaluate = get(instance, "evaluate");
  assert.equal(hooks.call(evaluate, instance, ["42"]), "42");
  assert.throws(() => hooks.call(evaluate, root, [42]), typeError(outer));
  assert.throws(() => hooks.call(evaluate, instance, [42]), typeError(outer));
  assert.throws(
    () => hooks.call(evaluate, instance, ["throw"]),
    typeError(outer),
  );
  assert.throws(
    () => hooks.call(evaluate, instance, ["bad"]),
    (error: unknown) =>
      (error as OrdinaryObject<ScriptPropertyKey, unknown>).prototype ===
      outer.prototypes.get("syntax"),
  );
  assert.equal(get(constructor, "name"), "ShadowRealm");
  assert.equal(get(constructor, "length"), 0);
});

test("legacy caller reflection cannot expose an object across the realm boundary", async () => {
  const { inner, outer, hooks, get } = fixture();
  const { createSourceFunction } = await import("../src/objects/functions.ts");
  let target: OrdinaryObject<ScriptPropertyKey, unknown>;
  target = createSourceFunction(
    () => {
      assert.equal(get(target, "caller"), null);
      return 42;
    },
    true,
    inner,
    hooks,
    "inner",
    0,
    undefined,
    "legacy",
  );
  const wrapped = objects.getShadowRealmWrappedValue(outer, target);
  const caller = createSourceFunction(
    () => hooks.call(wrapped, undefined, []),
    true,
    outer,
    hooks,
    "outer",
    0,
    undefined,
    "legacy",
  );
  assert.equal(hooks.call(caller, undefined, []), 42);
  assert.equal(outer.agent.activeSourceCall, undefined);
});

test("importValue uses the child module loader and returns an outer intrinsic promise", async () => {
  const { root, hooks, inner, outer, get } = fixture();
  const modules = await import("../src/modules/index.ts");
  const target = objects.createCallableObject<ScriptPropertyKey, unknown>(
    inner.functionPrototype,
    () => 42,
    inner.executionContext,
  );
  const module = modules.createSyntheticModule(
    inner,
    ["value", "object"],
    (current) => {
      modules.setSyntheticModuleExport(current, "value", target);
      modules.setSyntheticModuleExport(current, "object", root);
    },
    undefined,
  );
  let loads = 0;
  inner.moduleLoader = (referrer, request, _host, payload) => {
    assert.equal(referrer.realm, inner);
    loads++;
    modules.finishLoadingImportedModule(referrer, request, payload, {
      ok: true,
      module,
    });
  };
  objects.installShadowRealmIntrinsics(root, outer, hooks, () => ({
    realm: inner,
    evaluate: () => ({ error: "none", value: undefined }),
  }));
  const constructor = get(root, "ShadowRealm") as OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  const instance = objects.constructObject(
    constructor,
    [],
    { object: constructor, value: constructor },
    undefined,
  ).value as OrdinaryObject<ScriptPropertyKey, unknown>;
  const importValue = get(instance, "importValue");
  const result = hooks.call(importValue, instance, [
    "./entry.js",
    "value",
  ]) as OrdinaryObject<ScriptPropertyKey, unknown>;
  assert.equal(result.prototype, outer.promisePrototype);
  objects.drainScriptJobs(outer.agent, (error) => assert.fail(String(error)));
  assert.equal(result.internalPromiseData?.state, "fulfilled");
  const wrapped = result.internalPromiseData?.result as OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  assert.equal(wrapped.prototype, outer.functionPrototype);
  assert.notEqual(wrapped, target);
  assert.equal(hooks.call(wrapped, undefined, []), 42);
  for (const name of ["missing", "object"]) {
    const rejected = hooks.call(importValue, instance, [
      "./entry.js",
      name,
    ]) as OrdinaryObject<ScriptPropertyKey, unknown>;
    objects.drainScriptJobs(outer.agent, (error) => assert.fail(String(error)));
    assert.equal(rejected.internalPromiseData?.state, "rejected");
    assert.ok(typeError(outer)(rejected.internalPromiseData?.result));
  }
  assert.equal(loads, 3);
});
