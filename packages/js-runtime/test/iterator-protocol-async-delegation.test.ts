import { test } from "node:test";
import assert from "node:assert/strict";
import * as protocol from "../src/iterators/index.ts";

function delegate(iterator: Record<string, unknown>) {
  const hooks: protocol.IteratorHooks<unknown> = {
    undefinedValue: undefined,
    get: (object, key) => Reflect.get(object as object, key),
    call: (method, receiver, args) =>
      Reflect.apply(method as Function, receiver, args),
    isObject: (value) =>
      value !== null &&
      (typeof value === "object" || typeof value === "function"),
    isCallable: (value) => typeof value === "function",
    isNullish: (value) => value == null,
    truthy: Boolean,
    typeError: () => new TypeError("delegate protocol"),
  };
  assert.equal(typeof protocol.createAsyncYieldDelegate, "function");
  return protocol.createAsyncYieldDelegate<unknown>(
    { iterator, nextMethod: iterator.next, done: false },
    hooks,
  );
}

test("async delegation awaits method results but preserves yielded value identity", () => {
  const calls: unknown[] = [];
  const pending = {};
  const iterator = {
    next(...args: unknown[]) {
      calls.push(args);
      return pending;
    },
  };
  const step = delegate(iterator);
  iterator.next = () => {
    throw "must use cached next";
  };
  assert.deepEqual(step("next", undefined), { kind: "await", value: pending });
  assert.deepEqual(calls, [[undefined]]);
  const value = {};
  assert.deepEqual(step("next", { done: false, value }), {
    kind: "yield",
    value,
  });
  assert.deepEqual(step("next", 19), { kind: "await", value: pending });
  assert.deepEqual(calls, [[undefined], [19]]);
  assert.deepEqual(step("next", { done: true, value: 23 }), {
    kind: "normal",
    value: 23,
  });
});

test("async delegate method result rejection escapes without invoking throw", () => {
  const step = delegate({
    next() {
      return 0;
    },
    throw() {
      assert.fail("unexpected throw forwarding");
    },
  });
  step("next", undefined);
  assert.throws(
    () => step("throw", 42),
    (e) => e === 42,
  );
});

test("injected throw is forwarded after yielding", () => {
  const calls: unknown[] = [];
  const step = delegate({
    next() {
      return 0;
    },
    throw(value: unknown) {
      calls.push(value);
      return 1;
    },
  });
  step("next", undefined);
  step("next", { done: false, value: 19 });
  assert.deepEqual(step("throw", 42), { kind: "await", value: 1 });
  assert.deepEqual(calls, [42]);
  assert.deepEqual(step("next", { done: true, value: 23 }), {
    kind: "normal",
    value: 23,
  });
});

test("injected return retains abrupt completion after awaiting delegate result", () => {
  const calls: unknown[] = [];
  const step = delegate({
    return(value: unknown) {
      calls.push(value);
      return 19;
    },
  });
  assert.deepEqual(step("return", 42), { kind: "await", value: 19 });
  const value = {};
  assert.deepEqual(step("next", { done: true, value }), {
    kind: "return",
    value,
  });
  assert.deepEqual(calls, [42]);
});

test("a delegate return with done false yields and permits ordinary resumption", () => {
  const step = delegate({
    return() {
      return 0;
    },
    next() {
      return 1;
    },
  });
  step("return", 42);
  assert.deepEqual(step("next", { done: false, value: 19 }), {
    kind: "yield",
    value: 19,
  });
  assert.deepEqual(step("next", 23), { kind: "await", value: 1 });
  assert.deepEqual(step("next", { done: true, value: 23 }), {
    kind: "normal",
    value: 23,
  });
});

test("missing return awaits its argument again and preserves rejection", () => {
  const step = delegate({});
  assert.deepEqual(step("return", 42), { kind: "await", value: 42 });
  assert.deepEqual(step("next", 19), { kind: "return", value: 19 });
  const failing = delegate({});
  failing("return", 42);
  assert.throws(
    () => failing("throw", 23),
    (e) => e === 23,
  );
});

test("missing throw closes without arguments before raising TypeError", () => {
  const calls: unknown[] = [];
  const step = delegate({
    return(...args: unknown[]) {
      calls.push(args);
      return 19;
    },
  });
  assert.deepEqual(step("throw", 42), { kind: "await", value: 19 });
  assert.deepEqual(calls, [[]]);
  assert.throws(() => step("next", {}), TypeError);
});

test("missing throw cleanup failures take precedence", () => {
  const step = delegate({
    return() {
      return 19;
    },
  });
  step("throw", 42);
  assert.throws(
    () => step("throw", 23),
    (e) => e === 23,
  );
  assert.throws(
    () =>
      delegate({
        get return() {
          throw 19;
        },
      })("throw", 42),
    (e) => e === 19,
  );
  assert.throws(() => delegate({ return: 42 })("throw", 23), TypeError);
  assert.throws(() => delegate({})("throw", 42), TypeError);
});

test("result validation and getters run after awaiting, in done/value order", () => {
  const log: string[] = [];
  const step = delegate({
    next() {
      return 0;
    },
  });
  step("next", undefined);
  assert.deepEqual(
    step("next", {
      get done() {
        log.push("done");
        return true;
      },
      get value() {
        log.push("value");
        return 42;
      },
    }),
    { kind: "normal", value: 42 },
  );
  assert.deepEqual(log, ["done", "value"]);
  const invalid = delegate({
    next() {
      return 0;
    },
  });
  invalid("next", undefined);
  assert.throws(() => invalid("next", 42), TypeError);
});
