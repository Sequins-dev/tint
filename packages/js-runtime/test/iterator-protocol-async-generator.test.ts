import { test } from "node:test";
import assert from "node:assert/strict";
import * as protocol from "../src/iterators/index.ts";
import type { GeneratorResumeKind } from "../src/iterators/generator.ts";

function harness(
  continuation: protocol.AsyncGeneratorContinuation<unknown>,
  contracts?: protocol.AsyncGeneratorContracts<unknown>,
) {
  assert.equal(typeof protocol.createAsyncGeneratorRecord, "function");
  const record = protocol.createAsyncGeneratorRecord<unknown>(
    continuation,
    contracts,
  );
  const jobs: (() => void)[] = [];
  const events: unknown[] = [];
  const hooks: protocol.AsyncGeneratorHooks<unknown> = {
    undefinedValue: undefined,
    exceptionValue: (error) => error,
    iteratorResult: (value, done) => ({ value, done }),
    awaitValue(value, resolve) {
      jobs.push(() => resolve(value));
    },
  };
  function request(kind: GeneratorResumeKind, value?: unknown) {
    protocol.enqueueAsyncGenerator(
      record,
      kind,
      value,
      {
        resolve(result) {
          events.push(result);
        },
        reject(error) {
          events.push({ error });
        },
      },
      hooks,
    );
  }
  function tick() {
    const job = jobs.shift();
    assert.ok(job);
    job();
  }
  return { record, jobs, events, hooks, request, tick };
}

test("async generator is lazy, ignores first next input and releases its frame", () => {
  let calls = 0;
  const h = harness((kind, value) => {
    assert.equal(kind, "next");
    if (calls++ === 0) {
      assert.equal(value, undefined);
      return { kind: "yield", value: 19 };
    }
    return { kind: "return", value };
  });
  assert.equal(calls, 0);
  h.request("next", 99);
  h.request("next", 42);
  h.request("next", 100);
  assert.deepEqual(h.events, [
    { value: 19, done: false },
    { value: 42, done: true },
    { value: undefined, done: true },
  ]);
  assert.equal(h.record.continuation, undefined);
  assert.equal(h.record.state, "completed");
  assert.equal(h.record.head, undefined);
  assert.equal(h.record.tail, undefined);
});

test("await retains the active request and queued requests resume in order", () => {
  let step = 0;
  const seen: unknown[] = [];
  const h = harness((kind, value) => {
    seen.push([kind, value]);
    if (step++ === 0) return { kind: "await", value: 21 };
    if (step === 2) return { kind: "yield", value };
    return { kind: "return", value };
  });
  h.request("next");
  h.request("next", 42);
  assert.deepEqual(h.events, []);
  h.tick();
  assert.deepEqual(seen, [
    ["next", undefined],
    ["next", 21],
    ["next", 42],
  ]);
  assert.deepEqual(h.events, [
    { value: 21, done: false },
    { value: 42, done: true },
  ]);
});

test("async generator contracts check external resumptions and settled returns", () => {
  let stage = 0;
  const marker = new TypeError();
  const h = harness(
    (kind, value) => {
      if (stage++ === 0) return { kind: "await", value: 11 };
      if (stage === 2) {
        assert.equal(kind, "next");
        return { kind: "yield", value };
      }
      assert.equal(kind, "throw");
      assert.equal(value, marker);
      return { kind: "return", value: "wrong" };
    },
    {
      acceptsNext: (value) => typeof value === "string",
      acceptsReturn: (value) => typeof value === "number",
      typeError: () => marker,
    },
  );
  h.request("next", false);
  h.request("next", false);
  h.tick();
  assert.deepEqual(h.events, [{ value: 11, done: false }, { error: marker }]);
  assert.equal(h.record.state, "completed");
});

test("return before start awaits its input and blocks later requests without entering body", () => {
  const h = harness(() => {
    assert.fail("body entered");
  });
  h.request("return", 42);
  h.request("next");
  h.request("throw", 9);
  assert.deepEqual(h.events, []);
  h.tick();
  assert.deepEqual(h.events, [
    { value: 42, done: true },
    { value: undefined, done: true },
    { error: 9 },
  ]);
  assert.equal(h.record.state, "completed");
});

test("throw before start closes immediately and completed return still awaits", () => {
  const h = harness(() => {
    assert.fail("body entered");
  });
  h.request("throw", 7);
  h.request("return", 42);
  h.request("next");
  assert.deepEqual(h.events, [{ error: 7 }]);
  h.tick();
  assert.deepEqual(h.events, [
    { error: 7 },
    { value: 42, done: true },
    { value: undefined, done: true },
  ]);
});

test("return at yield awaits before injection and a rejected input can be caught", () => {
  let step = 0;
  const seen: unknown[] = [];
  const h = harness((kind, value) => {
    seen.push([kind, value]);
    if (step++ === 0) return { kind: "yield", value: 1 };
    assert.equal(kind, "throw");
    return { kind: "yield", value };
  });
  Object.assign(h.hooks, {
    awaitValue(
      value: unknown,
      _resolve: unknown,
      reject: (value: unknown) => void,
    ) {
      h.jobs.push(() => reject(value));
    },
  });
  h.request("next");
  h.request("return", 42);
  assert.equal(seen.length, 1);
  h.tick();
  assert.deepEqual(h.events, [
    { value: 1, done: false },
    { value: 42, done: false },
  ]);
  assert.equal(h.record.state, "suspended-yield");
});

test("synchronous await setup errors are injected at the suspension point", () => {
  let step = 0;
  const h = harness((kind, value) => {
    if (step++ === 0) return { kind: "await", value: 3 };
    assert.equal(kind, "throw");
    return { kind: "return", value };
  });
  Object.assign(h.hooks, {
    awaitValue() {
      throw 42;
    },
  });
  h.request("next");
  assert.deepEqual(h.events, [{ value: 42, done: true }]);
  assert.equal(h.jobs.length, 0);
});

test("reentrant requests enqueue and uncaught body errors drain remaining requests", () => {
  let step = 0;
  const h = harness(() => {
    if (step++ === 0) {
      h.request("next");
      h.request("next");
      return { kind: "yield", value: 1 };
    }
    throw 42;
  });
  h.request("next");
  assert.deepEqual(h.events, [
    { value: 1, done: false },
    { error: 42 },
    { value: undefined, done: true },
  ]);
});

test("draining a large completed request queue does not grow the call stack", () => {
  let step = 0;
  const h = harness(() =>
    step++ === 0 ? { kind: "await", value: 0 } : { kind: "return", value: 42 },
  );
  h.request("next");
  for (let i = 0; i < 20000; i++) h.request("next");
  h.tick();
  assert.equal(h.events.length, 20001);
  assert.deepEqual(h.events[0], { value: 42, done: true });
  assert.equal(h.record.head, undefined);
  assert.equal(h.record.tail, undefined);
});

test("queued return through a yielding finally matches JavaScript async generators", async () => {
  async function* reference(): AsyncGenerator<number, unknown, unknown> {
    try {
      yield 19;
    } finally {
      yield 23;
    }
    return undefined;
  }
  let step = 0;
  let pending: unknown;
  const h = harness((kind, value) => {
    switch (step++) {
      case 0:
        return { kind: "await", value: 19 };
      case 1:
        return { kind: "yield", value };
      case 2:
        assert.equal(kind, "return");
        pending = value;
        return { kind: "await", value: 23 };
      case 3:
        return { kind: "yield", value };
      default:
        return { kind: "return", value: pending };
    }
  });
  Object.assign(h.hooks, {
    awaitValue(
      value: unknown,
      resolve: (value: unknown) => void,
      reject: (reason: unknown) => void,
    ) {
      Promise.resolve(value).then(resolve, reject);
    },
  });
  function request(kind: GeneratorResumeKind, value?: unknown) {
    return new Promise((resolve, reject) => {
      protocol.enqueueAsyncGenerator(
        h.record,
        kind,
        value,
        { resolve, reject },
        h.hooks,
      );
    });
  }
  const original = reference();
  const expected = await Promise.all([
    original.next(99),
    original.return(42),
    original.next(),
    original.next(),
  ]);
  const actual = await Promise.all([
    request("next", 99),
    request("return", Promise.resolve(42)),
    request("next"),
    request("next"),
  ]);
  assert.deepEqual(actual, expected);
  assert.equal(h.record.continuation, undefined);
});

test("settlement reentrancy does not skip or settle the active request twice", () => {
  let step = 0;
  const h = harness(() =>
    step++ === 0 ? { kind: "yield", value: 19 } : { kind: "return", value: 42 },
  );
  protocol.enqueueAsyncGenerator(
    h.record,
    "next",
    undefined,
    {
      resolve(result) {
        h.events.push(result);
        h.request("next");
        h.request("throw", 7);
      },
      reject() {
        assert.fail("unexpected rejection");
      },
    },
    h.hooks,
  );
  assert.deepEqual(h.events, [
    { value: 19, done: false },
    { value: 42, done: true },
    { error: 7 },
  ]);
  assert.equal(h.record.state, "completed");
});

test("completed return rejection drains queued requests and allows another awaited return", () => {
  const h = harness(() => ({ kind: "return", value: 0 }));
  Object.assign(h.hooks, {
    awaitValue(
      value: unknown,
      _resolve: unknown,
      reject: (reason: unknown) => void,
    ) {
      h.jobs.push(() => reject(value));
    },
  });
  h.request("return", 1);
  h.request("next");
  h.request("return", 2);
  h.request("throw", 3);
  h.tick();
  assert.deepEqual(h.events, [{ error: 1 }, { value: undefined, done: true }]);
  h.tick();
  assert.deepEqual(h.events, [
    { error: 1 },
    { value: undefined, done: true },
    { error: 2 },
    { error: 3 },
  ]);
  assert.equal(h.record.state, "completed");
});

test("many synchronous await setup failures do not grow the call stack", () => {
  let remaining = 20000;
  const h = harness((kind, value) => {
    if (remaining-- > 0) return { kind: "await", value: 0 };
    assert.equal(kind, "throw");
    return { kind: "return", value };
  });
  Object.assign(h.hooks, {
    awaitValue() {
      throw 42;
    },
  });
  h.request("next");
  assert.deepEqual(h.events, [{ value: 42, done: true }]);
});

test("async native transfers retain await/yield distinctions without growing the stack", () => {
  assert.equal(typeof protocol.runAsyncGeneratorSteps, "function");
  let count = 0;
  function step(
    kind: GeneratorResumeKind,
    value: number,
  ): protocol.AsyncGeneratorStepOutcome<number> {
    count++;
    if (count === 100000) return { kind: "await", value };
    return { kind: "transfer", next: step, inputKind: kind, value: value + 1 };
  }
  assert.deepEqual(protocol.runAsyncGeneratorSteps(step("next", 1)), {
    kind: "await",
    value: 100000,
  });
  assert.deepEqual(
    protocol.runAsyncGeneratorSteps({ kind: "yield", value: 42 }),
    { kind: "yield", value: 42 },
  );
  assert.deepEqual(
    protocol.runAsyncGeneratorSteps({ kind: "return", value: 19 }),
    { kind: "return", value: 19 },
  );
});

test("nonsuspending async bodies Await return expressions and complete direct returns immediately", () => {
  assert.equal(typeof protocol.createAsyncReturnContinuation, "function");
  for (const kind of ["direct", "await"] as const) {
    let calls = 0;
    const h = harness(
      protocol.createAsyncReturnContinuation<unknown>(() => {
        calls++;
        return { kind, value: kind === "direct" ? undefined : 42 };
      }),
    );
    assert.equal(calls, 0);
    h.request("next", 99);
    assert.equal(calls, 1);
    if (kind === "await") {
      assert.deepEqual(h.events, []);
      assert.equal(h.jobs.length, 1);
      h.tick();
    } else assert.equal(h.jobs.length, 0);
    assert.deepEqual(h.events, [
      { value: kind === "direct" ? undefined : 42, done: true },
    ]);
    h.request("next");
    assert.equal(calls, 1);
    assert.equal(h.record.continuation, undefined);
  }
});

test("nonsuspending return continuations propagate Await rejection and synchronous body errors", () => {
  assert.equal(typeof protocol.createAsyncReturnContinuation, "function");
  const marker = {};
  const rejected = harness(
    protocol.createAsyncReturnContinuation<unknown>(() => ({
      kind: "await",
      value: marker,
    })),
  );
  Object.assign(rejected.hooks, {
    awaitValue(
      value: unknown,
      _resolve: unknown,
      reject: (reason: unknown) => void,
    ) {
      rejected.jobs.push(() => reject(value));
    },
  });
  rejected.request("next");
  assert.deepEqual(rejected.events, []);
  rejected.tick();
  assert.deepEqual(rejected.events, [{ error: marker }]);
  assert.equal(rejected.record.continuation, undefined);
  const failed = harness(
    protocol.createAsyncReturnContinuation<unknown>(() => {
      throw marker;
    }),
  );
  failed.request("next");
  assert.deepEqual(failed.events, [{ error: marker }]);
  assert.equal(failed.jobs.length, 0);
});
