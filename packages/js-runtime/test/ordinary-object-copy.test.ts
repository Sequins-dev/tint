import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyUpdate } from "@tint/js-runtime/descriptors";
import * as objects from "../src/objects/index.ts";
import type { OrdinaryObject, ObjectHooks } from "../src/objects/index.ts";
type Key = string | symbol;
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: (fn, receiver, args) => Reflect.apply(fn as Function, receiver, args),
};
const order = (key: Key): number =>
  typeof key === "symbol"
    ? -2
    : /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < 4294967295
      ? Number(key)
      : -1;
const object = () => objects.createObject<Key, unknown>(undefined);
function data(
  target: OrdinaryObject<Key, unknown>,
  key: Key,
  value: unknown,
  enumerable = true,
) {
  assert.equal(
    objects.defineOwnProperty(
      target,
      key,
      {
        ...emptyUpdate(undefined),
        fields: 51,
        value,
        writable: true,
        enumerable,
        configurable: true,
      },
      hooks,
    ),
    "accepted",
  );
}
function getter(
  target: OrdinaryObject<Key, unknown>,
  key: Key,
  get: () => unknown,
) {
  assert.equal(
    objects.defineOwnProperty(
      target,
      key,
      {
        ...emptyUpdate(undefined),
        fields: 52,
        get,
        enumerable: true,
        configurable: true,
      },
      hooks,
    ),
    "accepted",
  );
}
test("copy snapshots ordered keys but rechecks descriptors after getters", () => {
  assert.equal(typeof objects.copyDataProperties, "function");
  const source = object(),
    target = object(),
    symbol = Symbol("tail");
  const visited: Key[] = [];
  getter(source, "2", function (this: unknown) {
    assert.equal(this, source);
    visited.push("2");
    return 2;
  });
  getter(source, "1", () => {
    visited.push("1");
    return 1;
  });
  getter(source, "first", () => {
    visited.push("first");
    objects.deleteProperty(source, "deleted");
    data(source, "hidden", 9, false);
    data(source, "added", 10);
    return 3;
  });
  data(source, "deleted", 4);
  data(source, "hidden", 5);
  getter(source, "excluded", () => {
    throw new Error("excluded getter");
  });
  getter(source, symbol, () => {
    visited.push(symbol);
    return 6;
  });
  assert.equal(
    objects.copyDataProperties(
      target,
      source,
      source,
      ["excluded"],
      order,
      hooks,
    ),
    true,
  );
  assert.deepEqual(visited, ["1", "2", "first", symbol]);
  assert.deepEqual(objects.ownKeys(target, order), ["1", "2", "first", symbol]);
  const copied = objects.getOwnProperty(target, "first")!;
  assert.equal(copied.accessor, false);
  assert.equal(copied.value, 3);
  assert.equal(
    copied.writable && copied.enumerable && copied.configurable,
    true,
  );
});
test("copy creates data properties without invoking inherited or own setters", () => {
  const parent = object(),
    target = objects.createObject<Key, unknown>(parent),
    source = object();
  for (const [owner, key] of [
    [parent, "inherited"],
    [target, "own"],
  ] as const) {
    objects.defineOwnProperty(
      owner,
      key,
      {
        ...emptyUpdate(undefined),
        fields: 56,
        set: () => {
          throw new Error("setter invoked");
        },
        enumerable: true,
        configurable: true,
      },
      hooks,
    );
    data(source, key, 42);
  }
  assert.equal(
    objects.copyDataProperties(target, source, source, [], order, hooks),
    true,
  );
  for (const key of ["inherited", "own"])
    assert.equal(objects.getOwnProperty(target, key)?.value, 42);
});
test("copy stops on rejected creation and preserves prior writes", () => {
  const source = object(),
    target = object();
  data(source, "first", 1);
  data(source, "blocked", 2);
  getter(source, "later", () => {
    throw new Error("must not visit");
  });
  objects.defineOwnProperty(
    target,
    "blocked",
    { ...emptyUpdate(undefined), fields: 1, value: 0 },
    hooks,
  );
  assert.equal(
    objects.copyDataProperties(target, source, source, [], order, hooks),
    false,
  );
  assert.equal(objects.getOwnProperty(target, "first")?.value, 1);
  assert.equal(objects.getOwnProperty(target, "blocked")?.value, 0);
});
test("copy propagates getter exceptions without copying later properties", () => {
  const source = object(),
    target = object(),
    error = new Error("getter");
  data(source, "first", 1);
  getter(source, "throws", () => {
    throw error;
  });
  data(source, "later", 3);
  assert.throws(
    () => objects.copyDataProperties(target, source, source, [], order, hooks),
    (caught) => caught === error,
  );
  assert.deepEqual(objects.ownKeys(target, order), ["first"]);
});
test("data creation agrees with Reflect.defineProperty across existing descriptors", () => {
  assert.equal(typeof objects.createDataProperty, "function");
  for (let flags = 0; flags < 16; flags++) {
    const target = object(),
      reference = {};
    const accessor = (flags & 8) !== 0,
      writable = (flags & 1) !== 0,
      enumerable = (flags & 2) !== 0,
      configurable = (flags & 4) !== 0;
    const get = () => 1;
    objects.defineOwnProperty(
      target,
      "x",
      {
        ...emptyUpdate(undefined),
        fields: accessor ? 52 : 51,
        value: 1,
        writable,
        enumerable,
        configurable,
        get,
      },
      hooks,
    );
    Object.defineProperty(
      reference,
      "x",
      accessor
        ? { get, enumerable, configurable }
        : { value: 1, writable, enumerable, configurable },
    );
    const expected = Reflect.defineProperty(reference, "x", {
      value: 42,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    assert.equal(objects.createDataProperty(target, "x", 42, hooks), expected);
    const actual = objects.getOwnProperty(target, "x")!,
      result = Object.getOwnPropertyDescriptor(reference, "x")!;
    assert.equal(actual.value, result.value);
    assert.equal(actual.accessor, "get" in result);
  }
  const target = object();
  objects.preventExtensions(target);
  assert.equal(objects.createDataProperty(target, "new", 42, hooks), false);
});
