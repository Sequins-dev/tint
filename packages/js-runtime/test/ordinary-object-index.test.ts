import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyUpdate,
  type DescriptorUpdate,
} from "@tint/js-runtime/descriptors";
import {
  createObject,
  defineOwnProperty,
  getOwnProperty,
  getProperty,
  setProperty,
  deleteProperty,
  hasProperty,
  setPrototype,
  preventExtensions,
  ownKeys,
  type ObjectHooks,
} from "../src/objects/index.ts";
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: (fn, receiver, args) =>
    Reflect.apply(fn as (...args: unknown[]) => unknown, receiver, args),
};
const update = (
  value: unknown,
  writable = true,
  enumerable = true,
  configurable = true,
): DescriptorUpdate<unknown> => ({
  ...emptyUpdate<unknown>(undefined),
  fields: 51,
  value,
  writable,
  enumerable,
  configurable,
});
test("prototype reads and receiver writes preserve ordinary property semantics", () => {
  const parent = createObject<string, unknown>(undefined),
    child = createObject<string, unknown>(parent);
  assert.equal(defineOwnProperty(parent, "x", update(3), hooks), "accepted");
  assert.equal(getProperty(child, "x", child, hooks), 3);
  assert.equal(
    setProperty(parent, "x", 4, { value: child, object: child }, hooks),
    true,
  );
  assert.equal(getOwnProperty(parent, "x")?.value, 3);
  assert.equal(getOwnProperty(child, "x")?.value, 4);
  defineOwnProperty(parent, "frozen", update(1, false), hooks);
  assert.equal(
    setProperty(parent, "frozen", 2, { value: child, object: child }, hooks),
    false,
  );
  assert.equal(getOwnProperty(child, "frozen"), undefined);
  assert.equal(
    setProperty(parent, "x", 2, { value: 1, object: undefined }, hooks),
    false,
  );
});
test("accessors receive the original receiver and setters do not create own data properties", () => {
  const parent = createObject<string, unknown>(undefined),
    child = createObject<string, unknown>(parent);
  let receiver: unknown, argument: unknown;
  function get(this: unknown) {
    receiver = this;
    return 7;
  }
  function set(this: unknown, value: unknown) {
    receiver = this;
    argument = value;
  }
  defineOwnProperty(
    parent,
    "x",
    {
      ...emptyUpdate<unknown>(undefined),
      fields: 44,
      get,
      set,
      configurable: true,
    },
    hooks,
  );
  assert.equal(getProperty(child, "x", child, hooks), 7);
  assert.equal(receiver, child);
  assert.equal(
    setProperty(parent, "x", 8, { value: child, object: child }, hooks),
    true,
  );
  assert.equal(receiver, child);
  assert.equal(argument, 8);
  assert.equal(getOwnProperty(child, "x"), undefined);
  defineOwnProperty(
    parent,
    "x",
    { ...emptyUpdate<unknown>(undefined), fields: 8, set: undefined },
    hooks,
  );
  assert.equal(
    setProperty(child, "x", 9, { value: child, object: child }, hooks),
    false,
  );
});
test("receiver descriptors, deletion, extension and prototype cycles are enforced", () => {
  const parent = createObject<string, unknown>(undefined),
    child = createObject<string, unknown>(parent);
  defineOwnProperty(parent, "x", update(1), hooks);
  defineOwnProperty(
    child,
    "x",
    { ...emptyUpdate<unknown>(undefined), fields: 4, get: undefined },
    hooks,
  );
  assert.equal(
    setProperty(parent, "x", 2, { value: child, object: child }, hooks),
    false,
  );
  assert.equal(deleteProperty(child, "x"), false);
  assert.equal(deleteProperty(child, "absent"), true);
  assert.equal(setPrototype(parent, child), false);
  preventExtensions(child);
  assert.equal(setPrototype(child, parent), true);
  assert.equal(setPrototype(child, undefined), false);
  assert.equal(defineOwnProperty(child, "new", update(1), hooks), "rejected");
  assert.equal(hasProperty(child, "x"), true);
  assert.equal(hasProperty(child, "absent"), false);
});
test("own keys order indices, strings and symbols while retaining insertion order", () => {
  const object = createObject<string | symbol, unknown>(undefined),
    first = Symbol("first"),
    second = Symbol("second");
  for (const key of ["b", first, "10", "2", "a", second, "01", "4294967295"])
    defineOwnProperty(object, key, update(1), hooks);
  const classify = (key: string | symbol) =>
    typeof key === "symbol"
      ? -2
      : String(Number(key)) === key &&
          Number.isInteger(Number(key)) &&
          Number(key) >= 0 &&
          Number(key) < 4294967295
        ? Number(key)
        : -1;
  assert.deepEqual(ownKeys(object, classify), [
    "2",
    "10",
    "b",
    "a",
    "01",
    "4294967295",
    first,
    second,
  ]);
  deleteProperty(object, "b");
  defineOwnProperty(object, "b", update(2), hooks);
  assert.deepEqual(ownKeys(object, classify), [
    "2",
    "10",
    "a",
    "01",
    "4294967295",
    "b",
    first,
    second,
  ]);
});

test("ordinary assignment matches Reflect.set across source and receiver descriptors", () => {
  const setter = (_value: unknown) => {};
  for (let sourceKind = 0; sourceKind < 5; sourceKind++)
    for (let receiverKind = 0; receiverKind < 4; receiverKind++)
      for (const extensible of [false, true])
        for (const primitive of [false, true]) {
          const source = createObject<string, unknown>(undefined);
          const receiver = createObject<string, unknown>(source);
          const nativeSource = {};
          const nativeReceiver = Object.create(nativeSource);
          function install(
            kind: number,
            model: typeof source,
            nativeObject: object,
          ): void {
            if (kind === 0) return;
            const data = kind < 3;
            defineOwnProperty(
              model,
              "x",
              data
                ? update(3, kind === 2, false, true)
                : {
                    ...emptyUpdate<unknown>(undefined),
                    fields: 40,
                    set: kind === 3 ? setter : undefined,
                    configurable: true,
                  },
              hooks,
            );
            if (data)
              Object.defineProperty(nativeObject, "x", {
                value: 3,
                writable: kind === 2,
                enumerable: false,
                configurable: true,
              });
            else {
              const descriptor: PropertyDescriptor = { configurable: true };
              Reflect.set(descriptor, "set", kind === 3 ? setter : undefined);
              Object.defineProperty(nativeObject, "x", descriptor);
            }
          }
          install(sourceKind, source, nativeSource);
          install(receiverKind, receiver, nativeReceiver);
          if (!extensible) {
            preventExtensions(receiver);
            Object.preventExtensions(nativeReceiver);
          }
          const actual = setProperty(
            source,
            "x",
            5,
            {
              value: primitive ? 7 : nativeReceiver,
              object: primitive ? undefined : receiver,
            },
            hooks,
          );
          assert.equal(
            actual,
            Reflect.set(nativeSource, "x", 5, primitive ? 7 : nativeReceiver),
          );
          const ours = getOwnProperty(receiver, "x"),
            expected = Object.getOwnPropertyDescriptor(nativeReceiver, "x");
          if (ours === undefined) assert.equal(expected, undefined);
          else {
            assert.ok(expected);
            assert.equal(ours.enumerable, expected.enumerable);
            assert.equal(ours.configurable, expected.configurable);
            if (ours.accessor) {
              assert.equal(ours.get, expected.get);
              assert.equal(ours.set, expected.set);
            } else {
              assert.equal(ours.value, expected.value);
              assert.equal(ours.writable, expected.writable);
            }
          }
        }
});
