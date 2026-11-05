import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getIteratorFromMethod,
  iteratorNext,
  iteratorStep,
  iteratorStepValue,
  iteratorClose,
  type IteratorHooks,
} from "../src/iterators/index.ts";
const hooks: IteratorHooks<unknown> = {
  undefinedValue: undefined,
  get: (value, key) => Reflect.get(value as object, key),
  call: (method, receiver, args) =>
    Reflect.apply(method as Function, receiver, args),
  isObject: (value) =>
    value !== null &&
    (typeof value === "object" || typeof value === "function"),
  isCallable: (value) => typeof value === "function",
  isNullish: (value) => value === null || value === undefined,
  truthy: Boolean,
  typeError: () => new TypeError("iterator protocol"),
};
test("acquisition caches next once and steps observe done before value", () => {
  const log: string[] = [];
  let n = 0;
  const iterator = {
    get next() {
      log.push("next");
      return function (this: unknown, ...args: unknown[]) {
        assert.equal(this, iterator);
        assert.equal(args.length, 0);
        n++;
        return {
          get done() {
            log.push("done");
            return n > 1;
          },
          get value() {
            log.push("value");
            return undefined;
          },
        };
      };
    },
  };
  const iterable = {};
  const record = getIteratorFromMethod(
    iterable,
    function (this: unknown) {
      assert.equal(this, iterable);
      return iterator;
    },
    hooks,
  );
  assert.deepEqual(iteratorStepValue(record, hooks), {
    done: false,
    value: undefined,
  });
  assert.deepEqual(iteratorStepValue(record, hooks), {
    done: true,
    value: undefined,
  });
  assert.equal(record.done, true);
  assert.deepEqual(log, ["next", "done", "value", "done"]);
});
test("elision steps do not read value and next preserves argument presence", () => {
  let values = 0;
  const lengths: number[] = [];
  const iterator = {
    next(...args: unknown[]) {
      lengths.push(args.length);
      return {
        done: false,
        get value() {
          values++;
          return 42;
        },
      };
    },
  };
  const record = getIteratorFromMethod(null, () => iterator, hooks);
  assert.equal(iteratorStep(record, hooks).done, false);
  assert.equal(values, 0);
  iteratorNext(record, [undefined], hooks);
  assert.deepEqual(lengths, [0, 1]);
});
test("invalid iterator/result contracts throw and next call validation is deferred", () => {
  for (const method of [undefined, null, 1, () => 1])
    assert.throws(() => getIteratorFromMethod({}, method, hooks), TypeError);
  const record = getIteratorFromMethod({}, () => ({ next: 1 }), hooks);
  assert.equal(record.done, false);
  assert.throws(() => iteratorStepValue(record, hooks), TypeError);
  assert.equal(record.done, true);
  const primitive = getIteratorFromMethod({}, () => ({ next: () => 1 }), hooks);
  assert.throws(() => iteratorNext(primitive, [], hooks), TypeError);
  assert.equal(primitive.done, true);
});
test("failures from next, done and value mark the record done without closing", () => {
  for (const phase of ["next", "done", "value"]) {
    const error = { phase };
    let closed = 0;
    const iterator = {
      next() {
        if (phase === "next") throw error;
        return {
          get done() {
            if (phase === "done") throw error;
            return false;
          },
          get value() {
            throw error;
          },
        };
      },
      return() {
        closed++;
        return {};
      },
    };
    const record = getIteratorFromMethod({}, () => iterator, hooks);
    assert.throws(
      () => iteratorStepValue(record, hooks),
      (caught) => caught === error,
    );
    assert.equal(record.done, true);
    assert.equal(closed, 0);
  }
});
test("close preserves an incoming throw while still getting and calling return", () => {
  for (const mode of [
    "getter",
    "call",
    "primitive",
    "noncallable",
    "absent",
    "success",
  ]) {
    const error = { mode };
    const log: string[] = [];
    const iterator = {
      next() {
        return { done: false };
      },
      get return() {
        log.push("get");
        if (mode === "getter") throw error;
        if (mode === "absent") return null;
        if (mode === "noncallable") return 1;
        return function (this: unknown, ...args: unknown[]) {
          log.push("call");
          assert.equal(this, iterator);
          assert.equal(args.length, 0);
          if (mode === "call") throw error;
          return mode === "primitive" ? 1 : {};
        };
      },
    };
    const record = getIteratorFromMethod({}, () => iterator, hooks);
    iteratorClose(record, true, hooks);
    assert.deepEqual(
      log,
      mode === "getter" || mode === "absent" || mode === "noncallable"
        ? ["get"]
        : ["get", "call"],
    );
    if (mode === "getter" || mode === "call")
      assert.throws(
        () => iteratorClose(record, false, hooks),
        (caught) => caught === error,
      );
    else if (mode === "primitive" || mode === "noncallable")
      assert.throws(() => iteratorClose(record, false, hooks), TypeError);
    else iteratorClose(record, false, hooks);
  }
});
