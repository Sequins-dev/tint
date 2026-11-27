import type { ScriptPropertyKey } from "@tint/js-runtime/objects";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";
test("Function prototype restricted accessors share the realm thrower", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const realm = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  for (const name of ["caller", "arguments"]) {
    const descriptor = objects.getOwnProperty(realm.functionPrototype, name);
    assert.ok(descriptor, name);
    assert.equal(descriptor.accessor, true);
    assert.equal(descriptor.get, realm.throwTypeError);
    assert.equal(descriptor.set, realm.throwTypeError);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.configurable, true);
  }
});
test("bound functions preserve arguments, receiver and construction target semantics", () => {
  assert.equal(typeof objects.createBoundFunction, "function");
  const prototype = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  let seen: unknown[] = [];
  const target = objects.createConstructorObject<ScriptPropertyKey, unknown>(
    prototype,
    (receiver, args) => {
      seen = [receiver, ...args];
      return 42;
    },
    (args, newTarget) => {
      seen = [newTarget, ...args];
      return newTarget;
    },
  );
  const bound = objects.createBoundFunction(
    target,
    7,
    [1, 2],
    undefined,
    (object) => object,
    Object.is,
  );
  assert.equal(bound.prototype, prototype);
  assert.equal(bound.internalRareSlots?.internalBoundTarget, target);
  assert.equal(bound.internalRareSlots!.internalCall!(99, [3]), 42);
  assert.deepEqual(seen, [7, 1, 2, 3]);
  assert.equal(bound.internalRareSlots!.internalConstruct!([4], bound), target);
  assert.deepEqual(seen, [target, 1, 2, 4]);
  const other = objects.createConstructorObject<ScriptPropertyKey, unknown>(
    prototype,
    () => 0,
    () => 0,
  );
  assert.equal(bound.internalRareSlots!.internalConstruct!([5], other), other);
  assert.deepEqual(seen, [other, 1, 2, 5]);
  const nested = objects.createBoundFunction(
    bound,
    8,
    [6],
    undefined,
    (object) => object,
    Object.is,
  );
  nested.internalRareSlots!.internalCall!(99, [7]);
  assert.deepEqual(seen, [7, 1, 2, 6, 7]);
  const callable = objects.createCallableObject<ScriptPropertyKey, unknown>(
    prototype,
    () => 42,
  );
  assert.equal(
    objects.createBoundFunction(
      callable,
      0,
      [],
      undefined,
      (object) => object,
      Object.is,
    ).internalRareSlots?.internalConstruct,
    undefined,
  );
});
test("Function installs call and bind with standard metadata", () => {
  assert.equal(typeof objects.installFunctionIntrinsics, "function");
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined),
    realm = objects.createErrorRealm(root, hooks);
  objects.installFunctionIntrinsics(root, realm, hooks);
  const constructor = objects.getOwnProperty(root, "Function")!
    .value as objects.OrdinaryObject<ScriptPropertyKey, unknown>;
  assert.equal(
    objects.getOwnProperty(constructor, "prototype")?.value,
    realm.functionPrototype,
  );
  for (const name of ["call", "bind"]) {
    const descriptor = objects.getOwnProperty(realm.functionPrototype, name)!;
    assert.equal(descriptor.enumerable, false);
    const fn = descriptor.value as objects.OrdinaryObject<
      ScriptPropertyKey,
      unknown
    >;
    assert.equal(objects.getOwnProperty(fn, "name")?.value, name);
    assert.equal(objects.getOwnProperty(fn, "length")?.value, 1);
  }
});
