import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";
import { emptyUpdate } from "@tint/js-runtime/descriptors";
const hooks: objects.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: (fn, receiver, args) => Reflect.apply(fn as Function, receiver, args),
};
function setup() {
  let parameter: unknown = 1;
  assert.equal(typeof objects.createAliasedObject, "function");
  const object = objects.createAliasedObject<string, unknown>(undefined);
  objects.createDataProperty(object, "0", parameter, hooks);
  objects.aliasDataProperty(object, "0", {
    get: () => parameter,
    set: (value) => {
      parameter = value;
    },
  });
  return {
    object,
    read: () => parameter,
    write: (value: unknown) => {
      parameter = value;
    },
  };
}
test("aliased properties remain data descriptors and synchronize both directions", () => {
  const x = setup();
  x.write(42);
  assert.equal(objects.getOwnProperty(x.object, "0")?.accessor, false);
  assert.equal(objects.getOwnProperty(x.object, "0")?.value, 42);
  assert.equal(objects.getProperty(x.object, "0", x.object, hooks), 42);
  assert.equal(
    objects.setProperty(
      x.object,
      "0",
      7,
      { value: x.object, object: x.object },
      hooks,
    ),
    true,
  );
  assert.equal(x.read(), 7);
  const child = objects.createObject<string, unknown>(x.object);
  assert.equal(
    objects.setProperty(
      x.object,
      "0",
      9,
      { value: child, object: child },
      hooks,
    ),
    true,
  );
  assert.equal(x.read(), 7);
  assert.equal(objects.getProperty(child, "0", child, hooks), 9);
});
test("making an alias read-only snapshots the current parameter before disconnecting", () => {
  const x = setup();
  x.write(42);
  assert.equal(
    objects.defineOwnProperty(
      x.object,
      "0",
      { ...emptyUpdate(undefined), fields: 2, writable: false },
      hooks,
    ),
    "accepted",
  );
  x.write(9);
  assert.equal(objects.getOwnProperty(x.object, "0")?.value, 42);
  assert.equal(
    objects.setProperty(
      x.object,
      "0",
      8,
      { value: x.object, object: x.object },
      hooks,
    ),
    false,
  );
  assert.equal(x.read(), 9);
  const y = setup();
  objects.defineOwnProperty(
    y.object,
    "0",
    { ...emptyUpdate(undefined), fields: 3, value: 7, writable: false },
    hooks,
  );
  assert.equal(y.read(), 7);
  y.write(8);
  assert.equal(objects.getOwnProperty(y.object, "0")?.value, 7);
});
test("deletion and accessor replacement disconnect aliases only after success", () => {
  const x = setup();
  objects.defineOwnProperty(
    x.object,
    "0",
    { ...emptyUpdate(undefined), fields: 32, configurable: false },
    hooks,
  );
  assert.equal(objects.deleteProperty(x.object, "0"), false);
  assert.equal(
    objects.defineOwnProperty(
      x.object,
      "0",
      { ...emptyUpdate(undefined), fields: 4, get: () => 5 },
      hooks,
    ),
    "rejected",
  );
  x.write(42);
  assert.equal(objects.getOwnProperty(x.object, "0")?.value, 42);
  const y = setup();
  assert.equal(objects.deleteProperty(y.object, "0"), true);
  objects.createDataProperty(y.object, "0", 9, hooks);
  assert.equal(y.read(), 1);
  const z = setup();
  objects.defineOwnProperty(
    z.object,
    "0",
    { ...emptyUpdate(undefined), fields: 4, get: () => 5 },
    hooks,
  );
  z.write(42);
  assert.equal(objects.getProperty(z.object, "0", z.object, hooks), 5);
});
test("freezing disconnects mapped values while sealing retains their aliases", () => {
  const x = setup();
  objects.setIntegrityLevel(x.object, false, hooks, (key): number => -1);
  x.write(42);
  assert.equal(objects.getOwnProperty(x.object, "0")?.value, 42);
  objects.setIntegrityLevel(x.object, true, hooks, (key): number => -1);
  x.write(7);
  assert.equal(objects.getOwnProperty(x.object, "0")?.value, 42);
  assert.equal(
    objects.testIntegrityLevel(x.object, true, (key): number => -1),
    true,
  );
});
