import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";
const hooks: objects.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: (fn, receiver, args) => Reflect.apply(fn as Function, receiver, args),
};
const prototype = objects.createObject<string | symbol, unknown>(undefined);
const throwTypeError = () => {
  throw new TypeError();
};
const values = Array.prototype.values;
const intrinsics = {
  prototype,
  lengthKey: "length",
  calleeKey: "callee",
  iteratorKey: Symbol.iterator,
  values,
  throwTypeError,
  indexKey: (index: number): string | symbol => String(index),
  numberValue: (value: number): unknown => value,
};
function make(args: unknown[], names: string[] | undefined) {
  assert.equal(typeof objects.createArgumentsObject, "function");
  const parameters = new Map<string, unknown>();
  names?.forEach((name, i) => parameters.set(name, args[i]));
  const callee = () => {};
  const object = objects.createArgumentsObject<string | symbol, unknown>(
    args,
    names === undefined
      ? undefined
      : {
          names,
          callee,
          binding: (name: string) => ({
            get: (): unknown => parameters.get(name),
            set: (value: unknown): void => {
              parameters.set(name, value);
            },
          }),
        },
    intrinsics,
    hooks,
  );
  return { object, parameters, callee };
}
test("mapped arguments expose data properties and only alias the last duplicate", () => {
  const { object, parameters, callee } = make([1, 2, 3], ["a", "a"]);
  parameters.set("a", 42);
  assert.equal(objects.getOwnProperty(object, "0")?.value, 1);
  assert.equal(objects.getOwnProperty(object, "1")?.value, 42);
  assert.equal(objects.getOwnProperty(object, "2")?.value, 3);
  assert.deepEqual(objects.getOwnProperty(object, "callee"), {
    accessor: false,
    value: callee,
    writable: true,
    enumerable: false,
    configurable: true,
    get: undefined,
    set: undefined,
  });
  assert.equal(objects.getOwnProperty(object, "1")?.enumerable, true);
  objects.setProperty(object, "1", 7, { value: object, object }, hooks);
  assert.equal(parameters.get("a"), 7);
  assert.equal(objects.getOwnProperty(object, "length")?.value, 3);
  assert.equal(objects.getOwnProperty(object, Symbol.iterator)?.value, values);
  assert.equal(
    objects.getOwnProperty(object, Symbol.iterator)?.enumerable,
    false,
  );
  assert.equal(object.prototype, prototype);
  assert.equal(object.internalArgumentsData, true);
  assert.equal(prototype.internalArgumentsData, false);
});
test("an absent last duplicate prevents aliasing the earlier argument", () => {
  const { object, parameters } = make([1], ["a", "a"]);
  parameters.set("a", 42);
  assert.equal(objects.getOwnProperty(object, "0")?.value, 1);
  assert.equal(objects.getOwnProperty(object, "1"), undefined);
  objects.setProperty(object, "0", 7, { value: object, object }, hooks);
  assert.equal(parameters.get("a"), 42);
});
test("unmapped arguments copy values and use the shared poison callee accessor", () => {
  const args = [1, undefined];
  const { object } = make(args, undefined);
  args[0] = 42;
  assert.equal(object.internalArgumentsData, true);
  assert.equal(objects.getOwnProperty(object, "0")?.value, 1);
  assert.equal(objects.getOwnProperty(object, "1")?.value, undefined);
  assert.equal(objects.getOwnProperty(object, "length")?.value, 2);
  assert.deepEqual(objects.getOwnProperty(object, "callee"), {
    accessor: true,
    value: undefined,
    writable: false,
    enumerable: false,
    configurable: false,
    get: throwTypeError,
    set: throwTypeError,
  });
  assert.throws(
    () => objects.getProperty(object, "callee", object, hooks),
    TypeError,
  );
  assert.throws(
    () =>
      objects.setProperty(
        object,
        "callee",
        1,
        { value: object, object },
        hooks,
      ),
    TypeError,
  );
  assert.equal(objects.deleteProperty(object, "callee"), false);
  assert.equal(objects.getOwnProperty(object, Symbol.iterator)?.value, values);
  const empty = make([], undefined).object;
  assert.equal(objects.getOwnProperty(empty, "length")?.value, 0);
  assert.equal(objects.getOwnProperty(empty, "0"), undefined);
});
