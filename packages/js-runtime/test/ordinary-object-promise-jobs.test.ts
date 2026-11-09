import { test } from "node:test";
import assert from "node:assert/strict";
import type * as Objects from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
bindHostRecordViews();
const runtime = await import("../src/objects/index.ts");
const intrinsics = await import("../src/objects/intrinsics.ts");

type ScriptObject = Objects.OrdinaryObject<Objects.ScriptPropertyKey, unknown>;
type Settle = (value: unknown) => void;

/** A realm with Promise installed, plus helpers that call through the same
 * Script-visible operations a program would use. Jobs drain explicitly. */
function harness() {
  const root = runtime.createObject<Objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  function call(callee: unknown, receiver: unknown, ...args: unknown[]) {
    const result = runtime.callObjectValue(callee, receiver, args, root);
    assert.equal(result.error, "none");
    return result.value;
  }
  const hooks: Objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: (callee, receiver, args) => call(callee, receiver, ...args),
  };
  const realm = runtime.createErrorRealm(root, hooks);
  runtime.installErrorIntrinsics(root, realm, hooks);
  runtime.installFunctionIntrinsics(root, realm, hooks);
  const Promise = runtime.installPromiseIntrinsics(
    root,
    realm,
    hooks,
    () => {},
  );
  function fn(body: (...args: any[]) => unknown, receivers?: unknown[]) {
    return intrinsics.builtinFunction(
      realm.functionPrototype,
      "",
      0,
      (receiver, args) => {
        receivers?.push(receiver);
        return body(...args);
      },
      hooks,
    );
  }
  function get(target: unknown, key: Objects.ScriptPropertyKey) {
    return runtime.getProperty(target as ScriptObject, key, target, hooks);
  }
  function method(target: unknown, key: string, ...args: unknown[]) {
    return call(get(target, key), target, ...args);
  }
  function then(
    promise: unknown,
    onFulfilled?: (value: any) => unknown,
    onRejected?: (reason: any) => unknown,
  ) {
    return method(
      promise,
      "then",
      onFulfilled && fn(onFulfilled),
      onRejected && fn(onRejected),
    );
  }
  function promiseTry(receiver: unknown, ...args: unknown[]) {
    return call(get(Promise, "try"), receiver, ...args);
  }
  /** A constructor following the Promise executor convention that records
   * construction and lets the test replace its resolving functions. */
  function customConstructor(
    log: unknown[],
    options: { throws?: unknown; reject?: Settle } = {},
  ) {
    const settled: unknown[] = [];
    const constructor: ScriptObject = runtime.createConstructorObject<
      Objects.ScriptPropertyKey,
      unknown
    >(realm.functionPrototype, undefined, (args) => {
      log.push("construct");
      if ("throws" in options) throw options.throws;
      const instance = runtime.createObject<Objects.ScriptPropertyKey, unknown>(
        root,
      );
      call(
        args[0],
        undefined,
        fn((value: unknown) => settled.push(["resolve", value])),
        fn((reason: unknown) => {
          settled.push(["reject", reason]);
          options.reject?.(reason);
        }),
      );
      return instance;
    });
    return { constructor, settled };
  }
  function thrown(action: () => unknown): unknown {
    try {
      action();
    } catch (error) {
      return error;
    }
    assert.fail("expected a throw");
  }
  function isError(value: unknown, kind: string) {
    const prototype = realm.prototypes.get(kind);
    assert.ok(prototype);
    assert.equal((value as ScriptObject).prototype, prototype);
  }
  const drain = () =>
    runtime.drainScriptJobs(realm.agent, (error) => {
      throw error;
    });
  return {
    root,
    hooks,
    realm,
    Promise,
    call,
    fn,
    get,
    method,
    then,
    promiseTry,
    customConstructor,
    thrown,
    isError,
    drain,
  };
}

test("Promise.try is a unary non-constructor static method", () => {
  const h = harness();
  const descriptor = runtime.getOwnProperty(h.Promise, "try");
  assert.ok(descriptor);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.configurable, true);
  const method = descriptor.value as ScriptObject;
  assert.equal(runtime.getOwnProperty(method, "length")?.value, 1);
  assert.equal(runtime.getOwnProperty(method, "name")?.value, "try");
  assert.equal(method.internalConstruct, undefined);
  assert.deepEqual([...method.properties.keys()].slice(0, 2), [
    "length",
    "name",
  ]);
});

test("Promise.try rejects non-object receivers before calling back", () => {
  const h = harness();
  let calls = 0;
  const callback = h.fn(() => calls++);
  for (const receiver of [undefined, null, 86, "string", true])
    h.isError(
      h.thrown(() => h.promiseTry(receiver, callback)),
      "type",
    );
  assert.equal(calls, 0);
});

test("Promise.try calls back synchronously with undefined this and forwarded arguments", () => {
  const h = harness();
  const log: unknown[] = [];
  const receivers: unknown[] = [];
  const sentinel = {};
  const promise = h.promiseTry(
    h.Promise,
    h.fn((...args: unknown[]) => {
      log.push(["callback", ...args]);
      return sentinel;
    }, receivers),
    1,
    2,
    sentinel,
  );
  log.push("returned");
  assert.deepEqual(receivers, [undefined]);
  assert.equal((promise as ScriptObject).prototype, h.realm.promisePrototype);
  h.then(promise, (value) => log.push(["fulfilled", value === sentinel]));
  h.drain();
  assert.deepEqual(log, [
    ["callback", 1, 2, sentinel],
    "returned",
    ["fulfilled", true],
  ]);
});

test("Promise.try returns a same-constructor promise without wrapping it", () => {
  const h = harness();
  const sentinel = h.method(h.Promise, "resolve", 1);
  assert.equal(
    h.promiseTry(
      h.Promise,
      h.fn(() => sentinel),
    ),
    sentinel,
  );
  // A different constructor still allocates and resolves its own capability.
  const log: unknown[] = [];
  const custom = h.customConstructor(log);
  const result = h.promiseTry(
    custom.constructor,
    h.fn(() => sentinel),
  );
  assert.notEqual(result, sentinel);
  assert.deepEqual(log, ["construct"]);
  assert.deepEqual(custom.settled, [["resolve", sentinel]]);
});

test("Promise.try consults the constructor only after the callback completes", () => {
  const h = harness();
  const log: unknown[] = [];
  const custom = h.customConstructor(log);
  h.promiseTry(
    custom.constructor,
    h.fn(() => {
      log.push("callback");
      return 7;
    }),
  );
  h.promiseTry(
    custom.constructor,
    h.fn(() => {
      log.push("throwing callback");
      throw 9;
    }),
  );
  assert.deepEqual(log, [
    "callback",
    "construct",
    "throwing callback",
    "construct",
  ]);
  assert.deepEqual(custom.settled, [
    ["resolve", 7],
    ["reject", 9],
  ]);
});

test("Promise.try turns a throwing or non-callable callback into a rejection", () => {
  const h = harness();
  const log: unknown[] = [];
  const error = runtime.createObject<Objects.ScriptPropertyKey, unknown>(
    h.realm.objectPrototype,
  );
  const thrown = h.promiseTry(
    h.Promise,
    h.fn(() => {
      throw error;
    }),
  );
  const notCallable = h.promiseTry(h.Promise, 42);
  h.then(thrown, undefined, (reason) => log.push(reason === error));
  h.then(notCallable, undefined, (reason) => {
    h.isError(reason, "type");
    log.push("type");
  });
  h.drain();
  assert.deepEqual(log, [true, "type"]);
});

test("Promise.try propagates abrupt constructor and reject completions", () => {
  const h = harness();
  const log: unknown[] = [];
  const constructorError = {};
  const failing = h.customConstructor(log, { throws: constructorError });
  // The constructor's completion replaces both normal and abrupt callbacks.
  assert.equal(
    h.thrown(() =>
      h.promiseTry(
        failing.constructor,
        h.fn(() => 1),
      ),
    ),
    constructorError,
  );
  assert.equal(
    h.thrown(() =>
      h.promiseTry(
        failing.constructor,
        h.fn(() => {
          throw 2;
        }),
      ),
    ),
    constructorError,
  );
  const rejectError = {};
  const rejecting = h.customConstructor(log, {
    reject: () => {
      throw rejectError;
    },
  });
  assert.equal(
    h.thrown(() =>
      h.promiseTry(
        rejecting.constructor,
        h.fn(() => {
          throw 3;
        }),
      ),
    ),
    rejectError,
  );
  // A non-constructor object receiver fails only after the callback ran.
  let calls = 0;
  h.isError(
    h.thrown(() =>
      h.promiseTry(
        h.fn(() => {}),
        h.fn(() => calls++),
      ),
    ),
    "type",
  );
  assert.equal(calls, 1);
  assert.deepEqual(log, ["construct", "construct", "construct"]);
});

test("Promise.try adopts a returned thenable through a later job", () => {
  const h = harness();
  const log: unknown[] = [];
  const thenable = runtime.createObject<Objects.ScriptPropertyKey, unknown>(
    h.root,
  );
  runtime.defineOwnProperty(
    thenable,
    "then",
    {
      fields: 60,
      value: undefined,
      writable: false,
      get: h.fn(() => {
        log.push("get then");
        return h.fn((resolve: unknown) => {
          log.push("call then");
          h.call(resolve, undefined, 5);
        });
      }),
      set: undefined,
      enumerable: false,
      configurable: true,
    },
    h.hooks,
  );
  const promise = h.promiseTry(
    h.Promise,
    h.fn(() => thenable),
  );
  log.push("returned");
  h.then(promise, (value) => log.push(["fulfilled", value]));
  h.drain();
  assert.deepEqual(log, [
    "get then",
    "returned",
    "call then",
    ["fulfilled", 5],
  ]);
});

/** Expected orders were derived from the specification's job sequence and
 * agree with Node; each `chain` step is one reaction job. */
function chain(h: ReturnType<typeof harness>, log: unknown[], steps: number) {
  let promise = h.method(h.Promise, "resolve", undefined);
  for (let step = 1; step <= steps; step++)
    promise = h.then(promise, () => log.push(step));
}
function construct(
  h: ReturnType<typeof harness>,
  executor: (resolve: Settle, reject: Settle) => void,
) {
  const result = runtime.constructObject(
    h.Promise,
    [
      h.fn((resolve: unknown, reject: unknown) =>
        executor(
          (value) => h.call(resolve, undefined, value),
          (reason) => h.call(reject, undefined, reason),
        ),
      ),
    ],
    { object: h.Promise, value: h.Promise },
    undefined,
  );
  assert.equal(result.error, "none");
  return result.value;
}
function thenable(
  h: ReturnType<typeof harness>,
  body: (resolve: Settle, reject: Settle) => void,
) {
  const object = runtime.createObject<Objects.ScriptPropertyKey, unknown>(
    h.root,
  );
  assert.ok(
    runtime.createDataProperty(
      object,
      "then",
      h.fn((resolve: unknown, reject: unknown) =>
        body(
          (value) => h.call(resolve, undefined, value),
          (reason) => h.call(reject, undefined, reason),
        ),
      ),
      h.hooks,
    ),
  );
  return object;
}

test("resolving with a native promise takes two extra jobs", () => {
  const h = harness();
  const log: unknown[] = [];
  const settled = h.method(h.Promise, "resolve", undefined);
  h.then(
    construct(h, (resolve) => resolve(settled)),
    () => log.push("adopted"),
  );
  h.then(
    h.then(
      h.then(settled, () => log.push(1)),
      () => log.push(2),
    ),
    () => log.push(3),
  );
  h.drain();
  assert.deepEqual(log, [1, 2, "adopted", 3]);
});

test("a thenable returned from a handler is called in its own job", () => {
  const h = harness();
  const log: unknown[] = [];
  const returned = thenable(h, (resolve) => {
    log.push("then");
    resolve(1);
  });
  h.then(
    h.then(h.method(h.Promise, "resolve", undefined), () => returned),
    (value) => log.push(["value", value]),
  );
  chain(h, log, 4);
  h.drain();
  assert.deepEqual(log, [1, "then", 2, ["value", 1], 3, 4]);
});

test("resolving functions settle once and ignore later abrupt completions", () => {
  const h = harness();
  const log: unknown[] = [];
  const settleTwice = thenable(h, (resolve, reject) => {
    resolve(1);
    reject(2);
    resolve(3);
    throw 4;
  });
  h.then(
    h.method(h.Promise, "resolve", settleTwice),
    (value) => log.push(["fulfilled", value]),
    (reason) => log.push(["rejected", reason]),
  );
  h.then(
    construct(h, (resolve) => {
      resolve(5);
      throw 6;
    }),
    (value) => log.push(["fulfilled", value]),
    (reason) => log.push(["rejected", reason]),
  );
  h.drain();
  assert.deepEqual(log, [
    ["fulfilled", 5],
    ["fulfilled", 1],
  ]);
});

test("finally preserves settlement unless its callback completes abruptly", () => {
  const h = harness();
  const log: unknown[] = [];
  const fin = (promise: unknown, body: () => unknown) =>
    h.method(promise, "finally", h.fn(body));
  h.then(
    fin(h.method(h.Promise, "resolve", 1), () => {}),
    (value) => log.push(["fulfilled", value]),
  );
  h.then(
    fin(h.method(h.Promise, "reject", 2), () => {}),
    undefined,
    (reason) => log.push(["rejected", reason]),
  );
  h.then(
    fin(h.method(h.Promise, "resolve", 3), () => {
      throw 9;
    }),
    undefined,
    (reason) => log.push(["overridden", reason]),
  );
  h.then(
    fin(h.method(h.Promise, "reject", 4), () =>
      h.method(h.Promise, "reject", 8),
    ),
    undefined,
    (reason) => log.push(["overridden", reason]),
  );
  h.then(
    fin(h.method(h.Promise, "resolve", 5), () => 7),
    (value) => log.push(["kept", value]),
  );
  chain(h, log, 6);
  h.drain();
  assert.deepEqual(log, [
    1,
    ["overridden", 9],
    2,
    3,
    ["fulfilled", 1],
    ["rejected", 2],
    ["overridden", 8],
    ["kept", 5],
    4,
    5,
    6,
  ]);
});

const jobs = await import("../src/objects/jobs.ts");

/** A second realm in the same agent plus a Proxy constructor in the first.
 * Spec job realms come from GetFunctionRealm(handler), which follows callable
 * Proxy targets; a revoked Proxy falls back to the enqueueing current realm. */
function crossRealm() {
  const h = harness();
  runtime.installProxyIntrinsics(h.root, h.realm, h.hooks);
  const otherRoot = runtime.createObject<Objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const other = runtime.createErrorRealm(
    otherRoot,
    h.hooks,
    h.realm.symbolRegistry,
    h.realm.agent,
  );
  runtime.installErrorIntrinsics(otherRoot, other, h.hooks);
  runtime.installFunctionIntrinsics(otherRoot, other, h.hooks);
  runtime.installProxyIntrinsics(otherRoot, other, h.hooks);
  /** A function owned by the other realm, entered through its own context. */
  function otherFn(body: (...args: any[]) => unknown) {
    return runtime.createCallableObject<Objects.ScriptPropertyKey, unknown>(
      other.functionPrototype,
      (_receiver, args) => body(...args),
      jobs.createSourceExecutionContext(other),
    );
  }
  function revocable(target: unknown, root: ScriptObject = h.root) {
    const pair = h.method(
      h.get(root, "Proxy"),
      "revocable",
      target,
      runtime.createObject<Objects.ScriptPropertyKey, unknown>(h.root),
    );
    return { proxy: h.get(pair, "proxy"), revoke: h.get(pair, "revoke") };
  }
  const prototypeOf = (value: unknown) => (value as ScriptObject).prototype;
  return { ...h, other, otherRoot, otherFn, revocable, prototypeOf };
}

test("thenable jobs create resolving functions in the realm behind a callable Proxy", () => {
  const h = crossRealm();
  const seen: unknown[] = [];
  const { proxy } = h.revocable(
    h.otherFn((resolve: unknown) => {
      seen.push(h.prototypeOf(resolve));
      h.call(resolve, undefined, 5);
    }),
  );
  const thenable = runtime.createObject<Objects.ScriptPropertyKey, unknown>(
    h.root,
  );
  runtime.createDataProperty(thenable, "then", proxy, h.hooks);
  const log: unknown[] = [];
  h.then(h.method(h.Promise, "resolve", thenable), (value) => log.push(value));
  h.drain();
  assert.deepEqual(seen, [h.other.functionPrototype]);
  assert.deepEqual(log, [5]);
});

test("a reaction Proxy revoked after enqueue still runs in its target's realm", () => {
  const h = crossRealm();
  const { proxy, revoke } = h.revocable(h.otherFn(() => "unreachable"));
  const derived = h.method(h.method(h.Promise, "resolve", 1), "then", proxy);
  h.call(revoke, undefined);
  const reasons: unknown[] = [];
  h.then(derived, undefined, (reason) => reasons.push(reason));
  h.drain();
  assert.equal(reasons.length, 1);
  assert.ok(h.prototypeOf(reasons[0]) === h.other.prototypes.get("type"));
});

test("an already revoked reaction Proxy uses the realm current at enqueue", () => {
  const h = crossRealm();
  // Created by the other realm's Proxy constructor: its creation realm is not
  // the job realm. GetFunctionRealm throws, so the job uses the realm current
  // inside this realm's Promise.prototype.then.
  const { proxy, revoke } = h.revocable(
    h.otherFn(() => "unreachable"),
    h.otherRoot,
  );
  h.call(revoke, undefined);
  const derived = h.method(h.method(h.Promise, "resolve", 1), "then", proxy);
  const reasons: unknown[] = [];
  h.then(derived, undefined, (reason) => reasons.push(reason));
  h.drain();
  assert.equal(reasons.length, 1);
  assert.ok(h.prototypeOf(reasons[0]) === h.realm.prototypes.get("type"));
});
