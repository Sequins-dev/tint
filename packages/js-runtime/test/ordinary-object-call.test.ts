import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";

test("callable objects preserve identity, receiver, arguments and ordinary properties", () => {
  assert.equal(typeof objects.createCallableObject, "function");
  const receiver = { marker: 42 },
    args = [1, "two"];
  const fn = objects.createCallableObject<string, unknown>(
    undefined,
    (actualReceiver, actualArgs) => {
      assert.equal(actualReceiver, receiver);
      assert.equal(actualArgs, args);
      return actualReceiver;
    },
  );
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  assert.equal(objects.isCallableObject(fn), true);
  assert.equal(objects.createDataProperty(fn, "answer", 42, hooks), true);
  assert.equal(objects.getProperty(fn, "answer", fn, hooks), 42);
  const result = objects.callObject(fn, receiver, args, undefined);
  assert.deepEqual(result, { error: "none", value: receiver });
  objects.preventExtensions(fn);
  assert.equal(
    objects.callObject(fn, receiver, args, undefined).value,
    receiver,
  );
});

test("callability is an own internal slot, not an inherited slot or named property", () => {
  assert.equal(typeof objects.createCallableObject, "function");
  const parent = objects.createCallableObject<string, unknown>(
    undefined,
    () => 42,
  );
  const child = objects.createObject<string, unknown>(parent);
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  objects.createDataProperty(child, "call", parent, hooks);
  assert.equal(objects.isCallableObject(child), false);
  assert.deepEqual(objects.callObject(child, undefined, [], undefined), {
    error: "type",
    value: undefined,
  });
  assert.deepEqual(objects.callObject(undefined, undefined, [], undefined), {
    error: "type",
    value: undefined,
  });
  const thrown = {};
  const throwing = objects.createCallableObject<string, unknown>(
    undefined,
    () => {
      throw thrown;
    },
  );
  assert.throws(
    () => objects.callObject(throwing, undefined, [], undefined),
    (error) => error === thrown,
  );
});

test("call and construction enter an internal context and restore it after exceptions", () => {
  let active = "host";
  const context: objects.ObjectExecutionContext<unknown> = {
    run(action) {
      const previous = active;
      active = "callee";
      try {
        return action();
      } finally {
        active = previous;
      }
    },
  };
  const error = {};
  const fn = objects.createConstructorObject<string, unknown>(
    undefined,
    () => {
      assert.equal(active, "callee");
      throw error;
    },
    () => {
      assert.equal(active, "callee");
      return 42;
    },
    context,
  );
  assert.throws(
    () => objects.callObject(fn, undefined, [], undefined),
    (value) => value === error,
  );
  assert.equal(active, "host");
  assert.equal(
    objects.constructObject(fn, [], { object: fn, value: fn }, undefined).value,
    42,
  );
  assert.equal(active, "host");
});

test("bound functions retain their target context independently of prototype mutation", () => {
  let active = "host";
  const context: objects.ObjectExecutionContext<unknown> = {
    run(action) {
      const previous = active;
      active = "target";
      try {
        return action();
      } finally {
        active = previous;
      }
    },
  };
  const fn = objects.createCallableObject<string, unknown>(
    undefined,
    () => active,
    context,
  );
  const bound = objects.createBoundFunction(
    fn,
    undefined,
    [],
    undefined,
    (value) => value,
    Object.is,
  );
  objects.setPrototype(bound, objects.createObject(undefined));
  assert.equal(
    objects.callObject(bound, undefined, [], undefined).value,
    "target",
  );
  assert.equal(bound.internalExecutionContext, context);
  assert.equal(active, "host");
});
