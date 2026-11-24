import { test } from "node:test";
import assert from "node:assert/strict";
import * as object from "../src/objects/index.ts";
import * as promises from "../src/objects/promises.ts";

test("promise state is a private capability and does not leak through inheritance", () => {
  const prototype = object.createObject<object.ScriptPropertyKey, unknown>(
    undefined,
  );
  const promise = promises.createPromiseObject(prototype);
  assert.ok(promise.internalPromiseData?.promise === promise);
  assert.equal(promise.internalPromiseData?.state, "pending");
  assert.equal(promise.properties?.size ?? 0, 0);
  assert.equal(object.createObject(promise).internalPromiseData, undefined);
});

test("Script resolving functions delegate settlement and have builtin descriptors", () => {
  const hooks: object.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = object.createObject<object.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = object.createErrorRealm(root, hooks);
  const seen: unknown[] = [];
  const pair = promises.createScriptResolvingFunctions(
    {
      resolve: (value) => {
        seen.push(value);
      },
      reject: (value) => {
        seen.push(value);
      },
    },
    realm,
    hooks,
  );
  for (const fn of [pair.resolve, pair.reject]) {
    assert.ok(fn.internalExecutionContext === realm.executionContext);
    assert.equal(object.getOwnProperty(fn, "name")?.value, "");
    assert.equal(object.getOwnProperty(fn, "length")?.value, 1);
  }
  assert.equal(
    object.callObject(pair.resolve, undefined, [42], undefined).value,
    undefined,
  );
  assert.equal(
    object.callObject(pair.reject, undefined, [19], undefined).value,
    undefined,
  );
  assert.deepEqual(seen, [42, 19]);
});

test("Promise intrinsics expose stable constructor and prototype identities", () => {
  const hooks: object.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = object.createObject<object.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = object.createErrorRealm(root, hooks);
  const constructor = object.installPromiseIntrinsics(
    root,
    realm,
    hooks,
    () => {},
  );
  assert.equal(object.getOwnProperty(root, "Promise")?.value, constructor);
  assert.equal(object.getOwnProperty(constructor, "length")?.value, 1);
  assert.equal(object.getOwnProperty(constructor, "name")?.value, "Promise");
  assert.equal(
    object.getOwnProperty(constructor, "prototype")?.value,
    realm.promisePrototype,
  );
  assert.equal(
    object.getOwnProperty(realm.promisePrototype, "constructor")?.value,
    constructor,
  );
  assert.equal(realm.promisePrototype.internalPromiseData, undefined);
  for (const name of ["then", "catch", "finally"]) {
    const descriptor = object.getOwnProperty(realm.promisePrototype, name);
    assert.ok(descriptor);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.writable, true);
  }
});

for (const name of ["all", "race", "allSettled", "any"])
  test(`Promise ${name} is a non-enumerable unary static method`, () => {
    const hooks: object.ObjectHooks<unknown> = {
      undefinedValue: undefined,
      sameValue: Object.is,
      call: () => undefined,
    };
    const root = object.createObject<object.ScriptPropertyKey, unknown>(
      undefined,
    );
    const realm = object.createErrorRealm(root, hooks);
    const constructor = object.installPromiseIntrinsics(
      root,
      realm,
      hooks,
      () => {},
    );
    const descriptor = object.getOwnProperty(constructor, name);
    assert.ok(descriptor);
    assert.equal(descriptor.enumerable, false);
    const method = descriptor.value as object.OrdinaryObject<
      object.ScriptPropertyKey,
      unknown
    >;
    assert.equal(object.getOwnProperty(method, "length")?.value, 1);
  });

test("AggregateError has its own prototype and binary constructor", () => {
  const hooks: object.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = object.createObject<object.ScriptPropertyKey, unknown>(
      undefined,
    ),
    realm = object.createErrorRealm(root, hooks);
  object.installErrorIntrinsics(root, realm, hooks);
  const constructor = realm.constructors.get("aggregate");
  assert.ok(constructor);
  assert.equal(
    object.getOwnProperty(root, "AggregateError")?.value,
    constructor,
  );
  assert.equal(object.getOwnProperty(constructor, "length")?.value, 2);
  assert.equal(constructor.prototype, realm.constructors.get("error"));
  const prototype = realm.prototypes.get("aggregate");
  assert.ok(prototype);
  assert.equal(prototype.prototype, realm.prototypes.get("error"));
  assert.equal(
    object.getOwnProperty(prototype, "name")?.value,
    "AggregateError",
  );
});

test("Promise.withResolvers exposes a non-constructible zero-argument method", () => {
  const hooks: object.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = object.createObject<object.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = object.createErrorRealm(root, hooks);
  const constructor = object.installPromiseIntrinsics(
    root,
    realm,
    hooks,
    () => {},
  );
  const method = object.getOwnProperty(constructor, "withResolvers")
    ?.value as object.OrdinaryObject<object.ScriptPropertyKey, unknown>;
  assert.ok(method);
  assert.equal(object.getOwnProperty(method, "length")?.value, 0);
  assert.equal(method.internalConstruct, undefined);
});
