import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyUpdate } from "@tint/js-runtime/descriptors";
import {
  createObject,
  defineOwnProperty,
  getOwnProperty,
  setProperty,
  setIntegrityLevel,
  testIntegrityLevel,
  type ObjectHooks,
} from "../src/objects/index.ts";
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: (fn, receiver, args) =>
    Reflect.apply(fn as (...args: unknown[]) => unknown, receiver, args),
};
test("ordinary object integrity levels agree with JavaScript descriptors", () => {
  for (const frozen of [false, true])
    for (let flags = 0; flags < 16; flags++) {
      const object = createObject<string | symbol, unknown>(undefined),
        reference = {};
      const key = Symbol("field");
      const accessor = (flags & 8) !== 0,
        writable = (flags & 1) !== 0,
        enumerable = (flags & 2) !== 0,
        configurable = (flags & 4) !== 0;
      const get = () => 7,
        set = (_value: unknown) => {};
      defineOwnProperty(
        object,
        key,
        {
          ...emptyUpdate(undefined),
          fields: accessor ? 60 : 51,
          value: 7,
          writable,
          get,
          set,
          enumerable,
          configurable,
        },
        hooks,
      );
      Object.defineProperty(
        reference,
        key,
        accessor
          ? { get, set, enumerable, configurable }
          : { value: 7, writable, enumerable, configurable },
      );
      assert.equal(
        testIntegrityLevel(object, false, (key): number => -1),
        Object.isSealed(reference),
      );
      assert.equal(
        testIntegrityLevel(object, true, (key): number => -1),
        Object.isFrozen(reference),
      );
      assert.equal(
        setIntegrityLevel(object, frozen, hooks, (key): number => -1),
        true,
      );
      if (frozen) Object.freeze(reference);
      else Object.seal(reference);
      assert.equal(
        testIntegrityLevel(object, false, (key): number => -1),
        Object.isSealed(reference),
      );
      assert.equal(
        testIntegrityLevel(object, true, (key): number => -1),
        Object.isFrozen(reference),
      );
      const actual = getOwnProperty(object, key)!;
      const expected = Object.getOwnPropertyDescriptor(reference, key)!;
      assert.equal(actual.configurable, expected.configurable);
      assert.equal(actual.enumerable, expected.enumerable);
      if (accessor) {
        assert.equal(actual.get, expected.get);
        assert.equal(actual.set, expected.set);
      } else {
        assert.equal(actual.value, expected.value);
        assert.equal(actual.writable, expected.writable);
      }
      assert.equal(
        setIntegrityLevel(object, frozen, hooks, (key): number => -1),
        true,
      );
    }
});
test("freezing is shallow and preserves accessor setters", () => {
  const parent = createObject<string, unknown>(undefined),
    object = createObject<string, unknown>(parent);
  let stored = 0;
  defineOwnProperty(
    object,
    "x",
    {
      ...emptyUpdate(undefined),
      fields: 40,
      set: (value: number) => {
        stored = value;
      },
      configurable: true,
    },
    hooks,
  );
  assert.equal(
    setIntegrityLevel(object, true, hooks, (key): number => -1),
    true,
  );
  assert.equal(
    setProperty(object, "x", 9, { value: object, object }, hooks),
    true,
  );
  assert.equal(stored, 9);
  assert.equal(
    testIntegrityLevel(object, true, (key): number => -1),
    true,
  );
  assert.equal((parent.internalFlags & 1) !== 0, true);
  assert.equal(
    setProperty(object, "new", 1, { value: object, object }, hooks),
    false,
  );
  const empty = createObject<string, unknown>(undefined);
  assert.equal(
    setIntegrityLevel(empty, false, hooks, (key): number => -1),
    true,
  );
  assert.equal(
    testIntegrityLevel(empty, true, (key): number => -1),
    true,
  );
});
