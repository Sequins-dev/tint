import { test } from "node:test";
import assert from "node:assert/strict";
import { createJobQueue, enqueueJob, drainJobs } from "@tint/js-runtime/jobs";
import {
  createPromiseRecord,
  createResolvingFunctions,
  performPromiseThen,
  type PromiseCompletion,
  type PromiseHooks,
} from "../src/promises/index.ts";

function fixture() {
  const queue = createJobQueue<unknown>();
  const notifications: string[] = [];
  const callbacks: unknown[] = [];
  function completion(run: () => unknown): PromiseCompletion<unknown> {
    try {
      return { kind: "normal", value: run() };
    } catch (value) {
      return { kind: "throw", value };
    }
  }
  const hooks: PromiseHooks<unknown> = {
    sameValue: Object.is,
    isObject: (value) =>
      (typeof value === "object" && value !== null) ||
      typeof value === "function",
    isCallable: (value) => typeof value === "function",
    getThen: (value) =>
      completion(() => {
        if (
          (typeof value !== "object" || value === null) &&
          typeof value !== "function"
        )
          throw new TypeError();
        return Reflect.get(value, "then");
      }),
    callThen: (method, receiver, functions) =>
      completion(() => {
        if (typeof method !== "function") throw new TypeError();
        return Reflect.apply(method, receiver, [
          functions.resolve,
          functions.reject,
        ]);
      }),
    callHandler: (handler, value) =>
      completion(() => {
        if (typeof handler !== "function") throw new TypeError();
        return Reflect.apply(handler, undefined, [value]);
      }),
    typeError: () => new TypeError("self resolution"),
    enqueue: (job, callback) => {
      callbacks.push(callback);
      enqueueJob(queue, job, callback);
    },
    rejectionTracker: (_, operation) => {
      notifications.push(operation);
    },
  };
  function promise() {
    const identity = {};
    const record = createPromiseRecord<unknown>(identity, undefined);
    const resolving = createResolvingFunctions(record, hooks);
    return { identity, record, resolving };
  }
  return {
    queue,
    hooks,
    notifications,
    callbacks,
    promise,
    drain: () => drainJobs(queue, (job) => job()),
  };
}

test("settlement is synchronous but reactions wait for FIFO jobs", () => {
  const f = fixture(),
    p = f.promise(),
    first = f.promise(),
    second = f.promise();
  const seen: unknown[] = [];
  const handler = (value: unknown) => {
    seen.push(value);
    return 42;
  };
  performPromiseThen(p.record, handler, undefined, first.resolving, f.hooks);
  performPromiseThen(p.record, handler, undefined, second.resolving, f.hooks);
  p.resolving.resolve(19);
  assert.equal(p.record.state, "fulfilled");
  assert.equal(p.record.result, 19);
  assert.deepEqual(seen, []);
  assert.equal(p.record.fulfillReactions, undefined);
  assert.equal(p.record.rejectReactions, undefined);
  assert.equal(f.drain(), 2);
  assert.deepEqual(seen, [19, 19]);
  assert.equal(first.record.result, 42);
  assert.equal(second.record.result, 42);
  assert.deepEqual(f.callbacks, [handler, handler]);
});

test("resolve and reject share an already-resolved cell, even during a then getter", () => {
  const f = fixture(),
    p = f.promise();
  let reads = 0;
  p.resolving.resolve({
    get then() {
      reads++;
      p.resolving.reject(1);
      return undefined;
    },
  });
  p.resolving.reject(2);
  p.resolving.resolve({
    get then() {
      throw new Error("must not read");
    },
  });
  assert.equal(reads, 1);
  assert.equal(p.record.state, "fulfilled");
  assert.deepEqual(f.notifications, []);
});

test("then getters run synchronously while the captured then method runs as a job", () => {
  const f = fixture(),
    p = f.promise();
  const seen: string[] = [];
  let returnedThis: unknown;
  const method = function (this: unknown, resolve: (v: unknown) => void) {
    returnedThis = this;
    seen.push("call");
    resolve(42);
  };
  const thenable = {
    get then() {
      seen.push("get");
      return method;
    },
  };
  p.resolving.resolve(thenable);
  assert.equal(p.record.state, "pending");
  assert.deepEqual(seen, ["get"]);
  assert.equal(f.drain(), 1);
  assert.deepEqual(seen, ["get", "call"]);
  assert.equal(returnedThis, thenable);
  assert.equal(p.record.result, 42);
  assert.equal(f.callbacks[0], method);
});

test("thenable resolving functions ignore later calls and throws", () => {
  const f = fixture(),
    p = f.promise();
  p.resolving.resolve({
    then(resolve: (v: unknown) => void, reject: (v: unknown) => void) {
      resolve(42);
      reject(19);
      throw 1;
    },
  });
  f.drain();
  assert.equal(p.record.state, "fulfilled");
  assert.equal(p.record.result, 42);
});

test("throwing getters and then methods reject with the original value", () => {
  const f = fixture(),
    p = f.promise(),
    q = f.promise();
  const error = {};
  p.resolving.resolve({
    get then() {
      throw error;
    },
  });
  q.resolving.resolve({
    then() {
      throw error;
    },
  });
  assert.equal(p.record.state, "rejected");
  assert.equal(q.record.state, "pending");
  f.drain();
  assert.equal(q.record.state, "rejected");
  assert.equal(p.record.result, error);
  assert.equal(q.record.result, error);
});

test("self resolution rejects and non-callable then properties fulfill", () => {
  const f = fixture(),
    p = f.promise(),
    q = f.promise();
  p.resolving.resolve(p.identity);
  assert.equal(p.record.state, "rejected");
  assert.ok(p.record.result instanceof TypeError);
  const value = { then: 42 };
  q.resolving.resolve(value);
  assert.equal(q.record.state, "fulfilled");
  assert.equal(q.record.result, value);
  assert.equal(f.queue.size, 0);
});

test("absent handlers forward values and reasons; handler throws reject the derived promise", () => {
  const f = fixture(),
    p = f.promise(),
    q = f.promise(),
    r = f.promise();
  const error = {};
  performPromiseThen(p.record, 1, null, q.resolving, f.hooks);
  performPromiseThen(
    q.record,
    () => {
      throw error;
    },
    undefined,
    r.resolving,
    f.hooks,
  );
  p.resolving.resolve(42);
  f.drain();
  assert.equal(q.record.result, 42);
  assert.equal(r.record.state, "rejected");
  assert.equal(r.record.result, error);
  const forwarded = f.promise();
  performPromiseThen(
    r.record,
    undefined,
    undefined,
    forwarded.resolving,
    f.hooks,
  );
  f.drain();
  assert.equal(forwarded.record.state, "rejected");
  assert.equal(forwarded.record.result, error);
});

test("handling notifications occur once and adding a handler never calls it immediately", () => {
  const f = fixture(),
    p = f.promise(),
    q = f.promise();
  p.resolving.reject(42);
  assert.deepEqual(f.notifications, ["reject"]);
  let calls = 0;
  const handler = () => {
    calls++;
    return 19;
  };
  performPromiseThen(p.record, undefined, handler, q.resolving, f.hooks);
  performPromiseThen(p.record, undefined, handler, undefined, f.hooks);
  assert.deepEqual(f.notifications, ["reject", "handle"]);
  assert.equal(calls, 0);
  f.drain();
  assert.equal(calls, 2);
  assert.equal(q.record.result, 19);
});

test("nested thenables use fresh resolving cells and never recurse on the native stack", () => {
  const f = fixture(),
    p = f.promise();
  let calls = 0;
  function thenable(depth: number): object {
    return {
      then(resolve: (v: unknown) => void) {
        calls++;
        resolve(depth === 0 ? 42 : thenable(depth - 1));
      },
    };
  }
  p.resolving.resolve(thenable(9999));
  p.resolving.reject(19);
  assert.equal(p.record.state, "pending");
  assert.equal(f.drain(), 10000);
  assert.equal(calls, 10000);
  assert.equal(p.record.result, 42);
});

test("the then method is captured before mutation and its return value is ignored", () => {
  const f = fixture(),
    p = f.promise();
  let resolveLater: ((value: unknown) => void) | undefined;
  const thenable = {
    then(resolve: (value: unknown) => void) {
      resolveLater = resolve;
      return 19;
    },
  };
  p.resolving.resolve(thenable);
  thenable.then = () => {
    throw new Error("replacement must not run");
  };
  f.drain();
  assert.equal(p.record.state, "pending");
  assert.ok(resolveLater);
  resolveLater(42);
  assert.equal(p.record.result, 42);
});

test("a handler returning its derived promise rejects the cycle", () => {
  const f = fixture(),
    p = f.promise(),
    q = f.promise();
  performPromiseThen(
    p.record,
    () => q.identity,
    undefined,
    q.resolving,
    f.hooks,
  );
  p.resolving.resolve(42);
  f.drain();
  assert.equal(q.record.state, "rejected");
  assert.ok(q.record.result instanceof TypeError);
});

test("non-callable handlers mark the parent handled while forwarding an unhandled rejection", () => {
  const f = fixture(),
    p = f.promise(),
    q = f.promise();
  performPromiseThen(p.record, 1, 2, q.resolving, f.hooks);
  p.resolving.reject(42);
  assert.deepEqual(f.notifications, []);
  f.drain();
  assert.deepEqual(f.notifications, ["reject"]);
  assert.equal(q.record.result, 42);
});

test("custom capability exceptions propagate from the job without calling its reject function", () => {
  const f = fixture(),
    p = f.promise();
  const error = {};
  let rejected = false;
  performPromiseThen(
    p.record,
    undefined,
    undefined,
    {
      resolve() {
        throw error;
      },
      reject() {
        rejected = true;
      },
    },
    f.hooks,
  );
  p.resolving.resolve(42);
  assert.throws(f.drain, (value) => value === error);
  assert.equal(rejected, false);
  assert.equal(f.queue.draining, false);
});
