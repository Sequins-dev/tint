import { test } from "node:test";
import assert from "node:assert/strict";
import * as protocol from "../src/iterators/index.ts";

function adapter(iterator: Record<string, unknown>) {
  const jobs: (() => void)[] = [];
  const results: unknown[] = [];
  const record: protocol.IteratorRecord<unknown> = {
    iterator,
    nextMethod: iterator.next,
    done: false,
  };
  const hooks: protocol.AsyncIteratorHooks<unknown> = {
    undefinedValue: undefined,
    exceptionValue: (error) => error,
    get: (object, key) => Reflect.get(object as object, key),
    call: (method, receiver, args) =>
      Reflect.apply(method as Function, receiver, args),
    isObject: (value) =>
      value !== null &&
      (typeof value === "object" || typeof value === "function"),
    isCallable: (value) => typeof value === "function",
    isNullish: (value) => value == null,
    truthy: Boolean,
    typeError: () => new TypeError("iterator protocol"),
    iteratorResult: (value, done) => ({ value, done }),
    awaitValue: (value, resolve) => {
      jobs.push(() => resolve(value));
    },
  };
  const capability = {
    resolve: (value: unknown) => {
      results.push(value);
    },
    reject: (error: unknown) => {
      results.push({ error });
    },
  };
  function request(
    kind: protocol.GeneratorResumeKind,
    args: readonly unknown[] = [],
  ) {
    assert.equal(typeof protocol.resumeAsyncFromSyncIterator, "function");
    protocol.resumeAsyncFromSyncIterator(record, kind, args, capability, hooks);
  }
  function tick() {
    const job = jobs.shift();
    assert.ok(job);
    job();
  }
  return { record, hooks, results, jobs, request, tick };
}

test("async-from-sync caches next, preserves missing arguments and reads done before value", () => {
  const log: unknown[] = [];
  const original = {
    get done() {
      log.push("done");
      return false;
    },
    get value() {
      log.push("value");
      return 42;
    },
  };
  const iterator = {
    next(...args: unknown[]) {
      assert.ok(this === iterator);
      log.push(args);
      return original;
    },
  };
  const a = adapter(iterator);
  iterator.next = () => {
    assert.fail("next was read again");
  };
  a.request("next");
  a.request("next", [undefined]);
  assert.deepEqual(log, [[], "done", "value", [undefined], "done", "value"]);
  assert.deepEqual(a.results, []);
  a.tick();
  a.tick();
  assert.deepEqual(a.results, [
    { value: 42, done: false },
    { value: 42, done: false },
  ]);
  assert.notEqual(a.results[0], original);
});

test("missing return resolves immediately without unwrapping its argument", () => {
  const a = adapter({
    next() {
      return { done: false, value: 1 };
    },
  });
  const value = {
    then() {
      assert.fail("argument unwrapped");
    },
  };
  a.request("return", [value]);
  assert.deepEqual(a.results, [{ value, done: true }]);
  assert.equal(a.jobs.length, 0);
});

test("missing throw closes with no arguments and close errors take precedence", () => {
  let calls = 0;
  const a = adapter({
    next() {
      return {};
    },
    return(...args: unknown[]) {
      calls++;
      assert.deepEqual(args, []);
      return {};
    },
  });
  a.request("throw", [42]);
  assert.equal(calls, 1);
  assert.ok((a.results[0] as { error: unknown }).error instanceof TypeError);
  const b = adapter({
    next() {
      return {};
    },
    get return() {
      throw 19;
    },
  });
  b.request("throw", [42]);
  assert.deepEqual(b.results, [{ error: 19 }]);
});

for (const kind of ["next", "throw", "return"] as const)
  for (const done of [false, true])
    test(`rejected ${kind} values close only unfinished next/throw results (${done})`, () => {
      let closed = 0;
      const a = adapter({
        next() {
          return { done, value: 42 };
        },
        throw() {
          return { done, value: 42 };
        },
        return() {
          closed++;
          return { done, value: 42 };
        },
      });
      Object.assign(a.hooks, {
        awaitValue(
          value: unknown,
          _resolve: unknown,
          reject: (error: unknown) => void,
        ) {
          a.jobs.push(() => reject(value));
        },
      });
      a.request(kind);
      a.tick();
      assert.deepEqual(a.results, [{ error: 42 }]);
      assert.equal(closed, kind === "return" ? 1 : done ? 0 : 1);
    });

test("done/value getter failures reject without closing", () => {
  for (const key of ["done", "value"]) {
    let closed = 0;
    const result = { done: false, value: 42 };
    Object.defineProperty(result, key, {
      get() {
        throw 19;
      },
    });
    const a = adapter({
      next() {
        return result;
      },
      return() {
        closed++;
        return {};
      },
    });
    a.request("next");
    assert.deepEqual(a.results, [{ error: 19 }]);
    assert.equal(closed, 0);
  }
});

test("synchronous PromiseResolve failure closes while preserving the original error", () => {
  let closed = 0;
  const a = adapter({
    next() {
      return { done: false, value: 42 };
    },
    return() {
      closed++;
      throw 19;
    },
  });
  Object.assign(a.hooks, {
    awaitValue() {
      throw 42;
    },
  });
  a.request("next");
  assert.equal(closed, 1);
  assert.deepEqual(a.results, [{ error: 42 }]);
});

test("return and throw methods are fresh lookups and preserve argument presence", () => {
  const args: unknown[] = [];
  const iterator = {
    next() {
      return {};
    },
    return(...values: unknown[]) {
      args.push(values);
      return { done: true, value: 19 };
    },
  };
  const a = adapter(iterator);
  a.request("return");
  iterator.return = (...values) => {
    args.push(values);
    return { done: false, value: 42 };
  };
  a.request("return", [undefined]);
  a.tick();
  a.tick();
  assert.deepEqual(args, [[], [undefined]]);
  assert.deepEqual(a.results, [
    { done: true, value: 19 },
    { done: false, value: 42 },
  ]);
});
