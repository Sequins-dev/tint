import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  ErrorRealm,
  ObjectHooks,
  OrdinaryObject,
  ScriptPropertyKey,
} from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";

// Object-level generator adapters driven through their public methods, intrinsic
// Promise reactions and the agent job queue. Handwritten continuations follow the
// lowering contract: source yield/return perform their implicit Await first.
bindHostRecordViews();
const object = await import("../src/objects/index.ts");
const { builtinFunction } = await import("../src/objects/intrinsics.ts");

type ScriptObject = OrdinaryObject<ScriptPropertyKey, unknown>;

function createRealmFixture(
  agent = object.createScriptAgent(true),
  symbols = object.createSymbolRegistry(),
) {
  const root: ScriptObject = object.createObject<ScriptPropertyKey, unknown>(
    undefined,
  );
  const fixture: { realm: ErrorRealm | undefined } = { realm: undefined };
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: (callee, receiver, args) => {
      const result = object.callObjectValue(callee, receiver, args, root);
      if (result.error !== "none") {
        if (fixture.realm === undefined) throw "FIXTURE_REALM_INVARIANT";
        throw object.createRuntimeError(fixture.realm, "type");
      }
      return result.value;
    },
  };
  const realm = object.createErrorRealm(root, hooks, symbols, agent);
  fixture.realm = realm;
  object.installErrorIntrinsics(root, realm, hooks);
  object.installFunctionIntrinsics(root, realm, hooks);
  object.installPromiseIntrinsics(root, realm, hooks, () => {});
  const fn = (implementation: (args: readonly unknown[]) => unknown) =>
    builtinFunction(
      realm.functionPrototype,
      "",
      1,
      (_receiver, args) => implementation(args),
      hooks,
    );
  const get = (value: unknown, key: ScriptPropertyKey): unknown => {
    const target = object.viewObjectValue(value, root);
    assert.ok(target, "expected an object");
    return object.getProperty<ScriptPropertyKey, unknown>(
      target,
      key,
      value,
      hooks,
    );
  };
  const invoke = (value: unknown, key: string, args: unknown[]): unknown =>
    hooks.call(get(value, key), value, args);
  const getter = (target: ScriptObject, key: string, read: () => unknown) =>
    assert.equal(
      object.defineOwnProperty<ScriptPropertyKey, unknown>(
        target,
        key,
        {
          fields: 4 | 16 | 32,
          value: undefined,
          writable: false,
          get: fn(read),
          set: undefined,
          enumerable: false,
          configurable: true,
        },
        hooks,
      ),
      "accepted",
    );
  const settle = (
    promise: unknown,
    log: string[],
    label: string,
    describe: (result: unknown) => string = (result) =>
      `${String(get(result, "value"))}/${String(get(result, "done"))}`,
  ) =>
    invoke(promise, "then", [
      fn((args) => log.push(`${label} ok ${describe(args[0])}`)),
      fn((args) => log.push(`${label} err ${String(args[0])}`)),
    ]);
  const promiseConstructor = get(root, "Promise");
  const tick = (log: string[], count: number) => {
    let promise = invoke(promiseConstructor, "resolve", [0]);
    for (let i = 1; i <= count; i++)
      promise = invoke(promise, "then", [fn(() => log.push(`tick ${i}`))]);
  };
  const drain = () =>
    object.drainScriptJobs(agent, (error) => {
      throw error;
    });
  return {
    agent,
    root,
    hooks,
    realm,
    fn,
    get,
    invoke,
    getter,
    settle,
    tick,
    drain,
    promiseConstructor,
  };
}

function asyncGeneratorState(generator: ScriptObject) {
  const slot = generator.internalExoticSlots?.internalAsyncGeneratorData;
  assert.ok(slot);
  return slot.record;
}

test("async generator yield return awaits a thenable once before resuming the body", () => {
  // Mirrors language/statements/async-generator/yield-return-then-getter-ticks.js.
  const fixture = createRealmFixture();
  const log: string[] = [];
  let step = 0;
  const generator = object.createAsyncGeneratorObject(
    (kind, value) => {
      step++;
      if (step === 1) {
        log.push("start");
        return { kind: "await", value: 123 };
      }
      if (step === 2) return { kind: "yield", value };
      log.push(`resumed ${kind}`);
      if (kind !== "return") throw "UNEXPECTED_RESUMPTION";
      return { kind: "return", value };
    },
    fixture.realm,
    fixture.hooks,
  );
  fixture.tick(log, 3);
  fixture.invoke(generator, "next", []);
  const thenable = object.createObject<ScriptPropertyKey, unknown>(
    fixture.root,
  );
  fixture.getter(thenable, "then", () => {
    log.push("get then");
    return undefined;
  });
  fixture.settle(
    fixture.invoke(generator, "return", [thenable]),
    log,
    "return",
    (result) =>
      `${String(fixture.get(result, "value") === thenable)}/${String(fixture.get(result, "done"))}`,
  );
  fixture.drain();
  assert.deepEqual(log, [
    "start",
    "tick 1",
    "get then",
    "tick 2",
    "resumed return",
    "tick 3",
    "return ok true/true",
  ]);
  const record = asyncGeneratorState(generator);
  assert.equal(record.state, "completed");
  assert.equal(record.continuation, undefined);
});

test("a request made while a yield settles is queued and resumes without suspension", () => {
  // AsyncGeneratorYield completes the step while the state is still executing.
  // The reentrant next only enqueues; the yield then consumes it directly. V8
  // instead resumes the body inside the reentrant call.
  const fixture = createRealmFixture();
  const log: string[] = [];
  let step = 0;
  const box: { generator: ScriptObject | undefined } = { generator: undefined };
  const generator = object.createAsyncGeneratorObject(
    (kind, value) => {
      step++;
      log.push(`body ${step} ${kind} ${String(value)}`);
      if (step === 1) return { kind: "await", value: "a" };
      if (step === 2) return { kind: "yield", value };
      if (step === 3) return { kind: "await", value: "b" };
      if (step === 4) return { kind: "yield", value };
      return { kind: "return", value: undefined };
    },
    fixture.realm,
    fixture.hooks,
  );
  box.generator = generator;
  let reads = 0;
  fixture.getter(fixture.root, "then", () => {
    reads++;
    log.push(`get then ${reads}`);
    if (reads === 1) {
      assert.equal(asyncGeneratorState(generator).state, "executing");
      fixture.settle(fixture.invoke(box.generator, "next", ["B"]), log, "p2");
      log.push("reentrant returned");
    }
    return undefined;
  });
  fixture.settle(fixture.invoke(generator, "next", ["A"]), log, "p1");
  log.push("outer returned");
  fixture.drain();
  assert.deepEqual(log, [
    "body 1 next undefined",
    "outer returned",
    "body 2 next a",
    "get then 1",
    "reentrant returned",
    "body 3 next B",
    "p1 ok a/false",
    "body 4 next b",
    "get then 2",
    "p2 ok b/false",
  ]);
  const record = asyncGeneratorState(generator);
  assert.equal(record.state, "suspended-yield");
  assert.equal(record.head, undefined);
});

test("requests queued during an await settle in order across throw and completion", () => {
  const fixture = createRealmFixture();
  const log: string[] = [];
  let step = 0;
  const generator = object.createAsyncGeneratorObject(
    (kind, value) => {
      step++;
      log.push(`body ${step} ${kind} ${String(value)}`);
      if (step === 1) return { kind: "await", value: 1 };
      if (step === 2) return { kind: "yield", value: "y" };
      if (kind === "throw") throw value;
      throw "UNEXPECTED_RESUMPTION";
    },
    fixture.realm,
    fixture.hooks,
  );
  const requests: [string, unknown][] = [
    ["next", undefined],
    ["throw", "E"],
    ["return", "R"],
    ["next", undefined],
    ["throw", "T"],
  ];
  requests.forEach(([kind, value], index) => {
    fixture.settle(
      fixture.invoke(generator, kind, [value]),
      log,
      `${index} ${kind}`,
    );
    assert.equal(step, 1, "queued requests do not enter the body");
  });
  fixture.drain();
  assert.deepEqual(log, [
    "body 1 next undefined",
    "body 2 next 1",
    "body 3 throw E",
    "0 next ok y/false",
    "1 throw err E",
    "2 return ok R/true",
    "3 next ok undefined/true",
    "4 throw err T",
  ]);
  const record = asyncGeneratorState(generator);
  assert.equal(record.state, "completed");
  assert.equal(record.continuation, undefined);
  assert.equal(record.head, undefined);
  assert.equal(record.tail, undefined);
});

test("return before start never enters the body and propagates PromiseResolve failures", () => {
  const fixture = createRealmFixture();
  const log: string[] = [];
  const broken = fixture.invoke(fixture.promiseConstructor, "resolve", [1]);
  const brokenObject = object.viewObjectValue(broken, fixture.root);
  assert.ok(brokenObject);
  fixture.getter(brokenObject, "constructor", () => {
    log.push("get constructor");
    throw "C";
  });
  const entered = () => {
    throw "BODY_ENTERED";
  };
  const first = object.createAsyncGeneratorObject(
    entered,
    fixture.realm,
    fixture.hooks,
  );
  const failed = fixture.invoke(first, "return", [broken]);
  log.push("return returned");
  fixture.settle(failed, log, "broken");
  fixture.settle(fixture.invoke(first, "next", []), log, "after");
  const second = object.createAsyncGeneratorObject(
    entered,
    fixture.realm,
    fixture.hooks,
  );
  const rejected = fixture.invoke(fixture.promiseConstructor, "reject", ["R"]);
  fixture.settle(fixture.invoke(second, "return", [rejected]), log, "rejected");
  fixture.settle(fixture.invoke(second, "throw", ["T"]), log, "throw");
  fixture.drain();
  assert.deepEqual(log, [
    "get constructor",
    "return returned",
    "broken err C",
    "after ok undefined/true",
    "rejected err R",
    "throw err T",
  ]);
  for (const generator of [first, second]) {
    const record = asyncGeneratorState(generator);
    assert.equal(record.state, "completed");
    assert.equal(record.continuation, undefined);
  }
});

test("borrowed async generator methods use the method realm for promises and results", () => {
  const home = createRealmFixture();
  const other = createRealmFixture(home.agent, home.realm.symbolRegistry);
  let step = 0;
  const generator = object.createAsyncGeneratorObject(
    (kind, value) => {
      step++;
      if (step === 1) return { kind: "yield", value: 1 };
      return { kind: "return", value: 2 };
    },
    home.realm,
    home.hooks,
  );
  const next = other.get(other.realm.asyncGeneratorPrototype, "next");
  const results: unknown[] = [];
  for (let i = 0; i < 2; i++) {
    const promise = object.viewObjectValue(
      home.hooks.call(next, generator, []),
      home.root,
    );
    assert.ok(promise);
    assert.ok(promise.prototype === other.realm.promisePrototype);
    home.invoke(promise, "then", [home.fn((args) => results.push(args[0]))]);
  }
  const foreign = home.hooks.call(next, home.root, []);
  const rejection: unknown[] = [];
  home.invoke(foreign, "then", [
    undefined,
    home.fn((args) => rejection.push(args[0])),
  ]);
  home.drain();
  assert.equal(results.length, 2);
  for (const result of results)
    assert.ok(
      object.viewObjectValue(result, home.root)?.prototype === other.root,
    );
  assert.equal(other.get(results[1], "value"), 2);
  assert.equal(rejection.length, 1);
  assert.ok(
    object.viewObjectValue(rejection[0], home.root)?.prototype ===
      other.realm.prototypes.get("type"),
  );
});

test("a reentrant generator call throws without disturbing the running generator", () => {
  const fixture = createRealmFixture();
  const box: { generator: ScriptObject | undefined } = { generator: undefined };
  const errors: unknown[] = [];
  let step = 0;
  const generator = object.createGeneratorObject((kind, value) => {
    step++;
    if (step === 1) {
      for (const method of ["next", "return", "throw"])
        try {
          fixture.invoke(box.generator, method, [0]);
        } catch (error) {
          errors.push(error);
        }
      return {
        kind: "yield",
        result: object.createIteratorResult(
          1,
          false,
          fixture.realm,
          fixture.hooks,
        ),
      };
    }
    return { kind: "return", value: `${kind}:${String(value)}` };
  }, fixture.realm);
  box.generator = generator;
  const first = fixture.invoke(generator, "next", []);
  assert.equal(fixture.get(first, "value"), 1);
  assert.equal(errors.length, 3);
  for (const error of errors)
    assert.ok(
      object.viewObjectValue(error, fixture.root)?.prototype ===
        fixture.realm.prototypes.get("type"),
    );
  const record = generator.internalExoticSlots?.internalGeneratorData;
  assert.ok(record);
  assert.equal(record.state, "suspended-yield");
  const last = fixture.invoke(generator, "return", ["x"]);
  assert.equal(fixture.get(last, "value"), "return:x");
  assert.equal(fixture.get(last, "done"), true);
  assert.equal(record.state, "completed");
  assert.equal(record.continuation, undefined);
  assert.throws(
    () => fixture.invoke(generator, "throw", ["after"]),
    (error) => error === "after",
  );
});

test("async function Await setup failures resume the body at the suspension point", () => {
  const fixture = createRealmFixture();
  const log: string[] = [];
  const broken = fixture.invoke(fixture.promiseConstructor, "resolve", [1]);
  const brokenObject = object.viewObjectValue(broken, fixture.root);
  assert.ok(brokenObject);
  fixture.getter(brokenObject, "constructor", () => {
    log.push("get constructor");
    throw "C";
  });
  const fn = object.createSourceAsyncContinuationFunction(
    () => {
      let step = 0;
      return (kind, value) => {
        step++;
        log.push(`segment ${step} ${kind} ${String(value)}`);
        if (step === 1) return { kind: "yield", result: broken };
        if (step === 2) return { kind: "yield", result: 7 };
        return { kind: "return", value: `${kind}:${String(value)}` };
      };
    },
    fixture.realm,
    fixture.hooks,
  );
  const promise = fixture.hooks.call(fn, undefined, []);
  log.push("call returned");
  fixture.settle(promise, log, "result", String);
  fixture.drain();
  assert.deepEqual(log, [
    "segment 1 next undefined",
    "get constructor",
    "segment 2 throw C",
    "call returned",
    "segment 3 next 7",
    "result ok next:7",
  ]);
});
