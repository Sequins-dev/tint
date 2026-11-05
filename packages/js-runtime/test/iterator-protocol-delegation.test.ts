import { test } from "node:test";
import assert from "node:assert/strict";
import * as protocol from "../src/iterators/index.ts";

const hooks: protocol.IteratorHooks<unknown> = {
  undefinedValue: undefined,
  get: (value, key) => Reflect.get(value as object, key),
  call: (method, receiver, args) =>
    Reflect.apply(method as Function, receiver, args),
  isObject: (value) =>
    (typeof value === "object" && value !== null) ||
    typeof value === "function",
  isCallable: (value) => typeof value === "function",
  isNullish: (value) => value === undefined || value === null,
  truthy: Boolean,
  typeError: () => new TypeError("iterator protocol"),
};
function record(iterator: object): protocol.IteratorRecord<unknown> {
  return { iterator, nextMethod: Reflect.get(iterator, "next"), done: false };
}

test("delegation forwards one argument, caches next and preserves yielded identity", () => {
  const events: unknown[] = [];
  const result = {
    get done() {
      events.push("done");
      return false;
    },
    get value() {
      return assert.fail("must not read yielded value");
    },
  };
  const iterator = {
    next(...args: unknown[]) {
      assert.equal(this, iterator);
      events.push(args);
      return result;
    },
  };
  const state = record(iterator);
  iterator.next = () => {
    assert.fail("next must be cached");
  };
  const outcome = protocol.resumeYieldDelegate(state, "next", undefined, hooks);
  assert.equal(outcome.kind, "yield");
  if (outcome.kind === "yield") assert.equal(outcome.result, result);
  assert.deepEqual(events, [[undefined], "done"]);
});

test("delegate completion distinguishes normal continuation from injected return", () => {
  for (const kind of ["next", "throw", "return"] as const) {
    const iterator = {
      next(value: unknown) {
        return { done: true, value };
      },
      throw(value: unknown) {
        return { done: true, value };
      },
      return(value: unknown) {
        return { done: true, value };
      },
    };
    assert.deepEqual(
      protocol.resumeYieldDelegate(record(iterator), kind, 42, hooks),
      { kind: kind === "return" ? "return" : "normal", value: 42 },
    );
  }
});

test("return may yield and subsequent requests do not retain the earlier return", () => {
  let calls = 0;
  const iterator = {
    next(value: unknown) {
      return { done: ++calls > 1, value };
    },
    return(value: unknown) {
      return { done: false, value };
    },
  };
  const state = record(iterator);
  assert.equal(
    protocol.resumeYieldDelegate(state, "next", undefined, hooks).kind,
    "yield",
  );
  assert.equal(
    protocol.resumeYieldDelegate(state, "return", 19, hooks).kind,
    "yield",
  );
  assert.deepEqual(protocol.resumeYieldDelegate(state, "next", 42, hooks), {
    kind: "normal",
    value: 42,
  });
});

test("missing throw closes with zero arguments and close failures override the protocol error", () => {
  const marker = {};
  for (const failure of [false, true]) {
    let calls = 0;
    const iterator = {
      return(...args: unknown[]) {
        calls++;
        assert.equal(this, iterator);
        assert.deepEqual(args, []);
        if (failure) throw marker;
        return {};
      },
    };
    assert.throws(
      () =>
        protocol.resumeYieldDelegate(
          record(iterator),
          "throw",
          "original",
          hooks,
        ),
      (error) => (failure ? error === marker : error instanceof TypeError),
    );
    assert.equal(calls, 1);
  }
});

test("return and throw methods are looked up on every request", () => {
  const iterator: { return?: (() => object) | null } = {
    return: () => ({ done: false }),
  };
  const state = record(iterator);
  assert.equal(
    protocol.resumeYieldDelegate(state, "return", 1, hooks).kind,
    "yield",
  );
  iterator.return = null;
  assert.deepEqual(protocol.resumeYieldDelegate(state, "return", 42, hooks), {
    kind: "return",
    value: 42,
  });
});

test("invalid methods, non-object results and throwing getters propagate without extra close", () => {
  const marker = {};
  for (const kind of ["next", "throw", "return"] as const) {
    for (const failure of ["method", "result", "done", "value"] as const) {
      let closeCalls = 0;
      const method =
        failure === "method"
          ? 3
          : () =>
              failure === "result"
                ? 3
                : {
                    get done() {
                      if (failure === "done") throw marker;
                      return true;
                    },
                    get value() {
                      throw marker;
                    },
                  };
      const iterator = {
        next: method,
        throw: method,
        return: () => {
          closeCalls++;
          return {};
        },
      };
      if (kind === "return")
        Object.defineProperty(iterator, "return", { value: method });
      assert.throws(
        () => protocol.resumeYieldDelegate(record(iterator), kind, 42, hooks),
        (error) =>
          failure === "done" || failure === "value"
            ? error === marker
            : error instanceof TypeError,
      );
      assert.equal(closeCalls, 0);
    }
  }
});

test("delegation completion and side effects match a JavaScript yield* expression", () => {
  for (const request of ["next", "return", "throw"] as const) {
    for (const returnYields of [false, true]) {
      const makeIterator = (events: unknown[]) => {
        let count = 0;
        return {
          [Symbol.iterator]() {
            return this;
          },
          next(value?: unknown) {
            events.push(["next", value]);
            return { done: count++ > 0, value: 42 };
          },
          return(value: unknown) {
            events.push(["return", value]);
            return { done: !returnYields, value: 19 };
          },
          throw(value: unknown) {
            events.push(["throw", value]);
            return { done: true, value: 23 };
          },
        };
      };
      const expectedEvents: unknown[] = [],
        actualEvents: unknown[] = [];
      const expectedIterator = makeIterator(expectedEvents);
      function* reference(): Generator<number, number, unknown> {
        return Number(yield* expectedIterator) + 100;
      }
      const expected = reference();
      const actualIterator = makeIterator(actualEvents);
      const state = record(actualIterator);
      const actual = protocol.createGeneratorRecord<unknown>((kind, value) => {
        const outcome = protocol.resumeYieldDelegate(state, kind, value, hooks);
        if (outcome.kind === "yield" || outcome.kind === "return")
          return outcome;
        return { kind: "return", value: Number(outcome.value) + 100 };
      });
      const generatorHooks: protocol.GeneratorHooks<unknown> = {
        undefinedValue: undefined,
        typeError: hooks.typeError,
        iteratorResult: (value, done) => ({ value, done }),
      };
      assert.deepEqual(
        protocol.resumeGenerator(actual, "next", 99, generatorHooks),
        expected.next(99),
      );
      assert.deepEqual(
        protocol.resumeGenerator(actual, request, 7, generatorHooks),
        expected[request](7),
      );
      assert.deepEqual(
        protocol.resumeGenerator(actual, "next", 9, generatorHooks),
        expected.next(9),
      );
      assert.deepEqual(actualEvents, expectedEvents);
    }
  }
});
