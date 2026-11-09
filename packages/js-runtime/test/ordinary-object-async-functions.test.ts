import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  ObjectHooks,
  ScriptPropertyKey,
  OrdinaryObject,
} from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
bindHostRecordViews();
const object = await import("../src/objects/index.ts");
test("source async functions are non-constructible and retain intrinsic prototype", () => {
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = object.createObject<ScriptPropertyKey, unknown>(undefined),
    realm = object.createErrorRealm(root, hooks);
  let calls = 0;
  const fn = object.createSourceAsyncFunction(
    () => {
      calls++;
      return 42;
    },
    realm,
    hooks,
    "f",
    2,
  );
  assert.equal(calls, 0);
  assert.equal(fn.prototype, realm.asyncFunctionPrototype);
  assert.equal(fn.internalConstruct, undefined);
  assert.equal(object.getOwnProperty(fn, "prototype"), undefined);
  assert.equal(object.getOwnProperty(fn, "name")?.value, "f");
  assert.equal(object.getOwnProperty(fn, "length")?.value, 2);
  assert.deepEqual(
    object.ownKeys(fn, () => -1),
    ["length", "name"],
  );
});

test("suspending async functions keep initialization lazy and non-constructible", () => {
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = object.createObject<ScriptPropertyKey, unknown>(undefined),
    realm = object.createErrorRealm(root, hooks);
  assert.equal(typeof object.createSourceAsyncContinuationFunction, "function");
  let initialized = false;
  const fn = object.createSourceAsyncContinuationFunction(
    () => {
      initialized = true;
      return () => ({ kind: "return", value: 42 });
    },
    realm,
    hooks,
    "f",
    1,
  );
  assert.equal(initialized, false);
  assert.ok(fn.prototype === realm.asyncFunctionPrototype);
  assert.equal(fn.internalConstruct, undefined);
  assert.deepEqual(
    object.ownKeys(fn, () => -1),
    ["length", "name"],
  );
});

test("async dispatch returns a delegated promise without adopting it", () => {
  assert.equal(typeof object.createSourceAsyncDispatchFunction, "function");
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const realm = object.createErrorRealm(
    object.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const promise = object.createPromiseObject(realm.promisePrototype);
  let calls = 0,
    callee: unknown;
  const fn = object.createSourceAsyncDispatchFunction(
    (receiver, args, fn) => {
      calls++;
      callee = fn;
      assert.equal(receiver, 7);
      assert.deepEqual(args, [42]);
      return promise;
    },
    () => {
      throw "UNEXPECTED_PROFILE";
    },
    realm,
    hooks,
    "f",
    1,
  );
  assert.equal(calls, 0);
  assert.equal(fn.internalCall?.(7, [42]), promise);
  assert.equal(callee, fn);
  assert.equal(calls, 1);
  assert.equal(fn.internalConstruct, undefined);
  assert.equal(fn.prototype, realm.asyncFunctionPrototype);
});
test("async dispatch rejects delegate throws and settles profile results", () => {
  assert.equal(typeof object.createSourceAsyncDispatchFunction, "function");
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const realm = object.createErrorRealm(
      object.createObject<ScriptPropertyKey, unknown>(undefined),
      hooks,
    ),
    // Thrown values are JavaScript values: ordinary objects of the realm.
    marker = object.createObject<ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    );
  for (const fail of [false, true]) {
    const fn = object.createSourceAsyncDispatchFunction(
      () => {
        if (fail) throw marker;
        return undefined;
      },
      () => 42,
      realm,
      hooks,
    );
    const value = fn.internalCall?.(undefined, []);
    assert.ok(value && typeof value === "object");
    const promise = value as OrdinaryObject<ScriptPropertyKey, unknown>;
    assert.equal(
      promise.internalPromiseData?.state,
      fail ? "rejected" : "fulfilled",
    );
    assert.equal(promise.internalPromiseData?.result, fail ? marker : 42);
  }
});
