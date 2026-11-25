import assert from "node:assert/strict";
import { test } from "node:test";
import * as objects from "../src/objects/index.ts";

const hooks: objects.ObjectHooks<number> = {
  undefinedValue: 0,
  sameValue: (a, b) => a === b,
  call: () => {
    throw "unexpected callback";
  },
};

test("private fields use definition identities, ignore prototypes and survive non-extensibility", () => {
  assert.equal(typeof objects.createPrivateName, "function");
  const name = objects.createPrivateName("x"),
    other = objects.createPrivateName("x");
  const parent = objects.createObject<string, number>(undefined);
  const child = objects.createObject(parent);
  assert.equal(parent.internalRareSlots?.internalPrivateElements, undefined);
  assert.equal(objects.addPrivateField(parent, name, 41), "none");
  assert.equal(objects.addPrivateField(parent, name, 99), "type");
  // Existing private elements remain usable once extensions are prevented.
  objects.preventExtensions(parent);
  assert.equal(objects.hasPrivateElement(parent, name), true);
  assert.equal(objects.hasPrivateElement(parent, other), false);
  assert.equal(objects.hasPrivateElement(child, name), false);
  assert.deepEqual(
    objects.ownKeys(parent, () => -1),
    [],
  );
  assert.equal(objects.getOwnProperty(parent, "x"), undefined);
  assert.equal(
    objects.setPrivateElement({ value: 7, object: parent }, name, 42, hooks),
    "none",
  );
  assert.deepEqual(
    objects.getPrivateElement({ value: 7, object: parent }, name, hooks),
    { error: "none", value: 42 },
  );
  assert.equal(
    objects.getPrivateElement({ value: 8, object: child }, name, hooks).error,
    "type",
  );
  assert.equal(objects.addPrivateField(child, name, 17), "none");
  assert.equal(
    objects.getPrivateElement({ value: 8, object: child }, name, hooks).value,
    17,
  );
});

test("private methods are read-only and accessors call with the original receiver", () => {
  assert.equal(typeof objects.addPrivateMethod, "function");
  const object = objects.createObject<string, number>(undefined);
  const method = objects.createPrivateName("method"),
    accessor = objects.createPrivateName("accessor");
  assert.equal(objects.addPrivateMethod(object, method, 13), "none");
  assert.equal(
    objects.getPrivateElement({ value: 7, object }, method, hooks).value,
    13,
  );
  assert.equal(
    objects.setPrivateElement({ value: 7, object }, method, 99, hooks),
    "type",
  );
  const calls: number[][] = [];
  const accessorHooks: objects.ObjectHooks<number> = {
    ...hooks,
    call: (callee, receiver, args) => {
      calls.push([callee, receiver, ...args]);
      return 42;
    },
  };
  assert.equal(objects.addPrivateAccessor(object, accessor, 11, 12), "none");
  assert.equal(
    objects.getPrivateElement({ value: 7, object }, accessor, accessorHooks)
      .value,
    42,
  );
  assert.equal(
    objects.setPrivateElement(
      { value: 7, object },
      accessor,
      19,
      accessorHooks,
    ),
    "none",
  );
  assert.deepEqual(calls, [
    [11, 7],
    [12, 7, 19],
  ]);
  assert.equal(objects.addPrivateAccessor(object, accessor, 21, 22), "type");
});

test("private access rejects non-objects and absent accessor halves without calling hooks", () => {
  assert.equal(typeof objects.addPrivateAccessor, "function");
  const object = objects.createObject<string, number>(undefined);
  const readOnly = objects.createPrivateName("readOnly"),
    writeOnly = objects.createPrivateName("writeOnly");
  objects.addPrivateAccessor(object, readOnly, 11, undefined);
  objects.addPrivateAccessor(object, writeOnly, undefined, 12);
  assert.equal(
    objects.setPrivateElement({ value: 7, object }, readOnly, 42, hooks),
    "type",
  );
  assert.equal(
    objects.getPrivateElement({ value: 7, object }, writeOnly, hooks).error,
    "type",
  );
  assert.equal(
    objects.getPrivateElement({ value: 7, object: undefined }, readOnly, hooks)
      .error,
    "type",
  );
  assert.equal(
    objects.setPrivateElement(
      { value: 7, object: undefined },
      readOnly,
      42,
      hooks,
    ),
    "type",
  );
});

test("undefined private field values remain present and accessor exceptions propagate unchanged", () => {
  const object = objects.createObject<string, unknown>(undefined);
  const field = objects.createPrivateName("field"),
    getter = objects.createPrivateName("getter");
  const failure = {};
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => {
      throw failure;
    },
  };
  assert.equal(objects.addPrivateField(object, field, undefined), "none");
  assert.equal(objects.hasPrivateElement(object, field), true);
  assert.deepEqual(
    objects.getPrivateElement({ value: object, object }, field, hooks),
    { error: "none", value: undefined },
  );
  objects.addPrivateAccessor(object, getter, {}, undefined);
  assert.throws(
    () => objects.getPrivateElement({ value: object, object }, getter, hooks),
    (error) => error === failure,
  );
});

test("PrivateFieldAdd rejects non-extensible objects before the duplicate check", () => {
  const name = objects.createPrivateName("x"),
    later = objects.createPrivateName("y");
  const object = objects.createObject<string, number>(undefined);
  assert.equal(objects.addPrivateField(object, name, 1), "none");
  objects.preventExtensions(object);
  assert.equal(objects.addPrivateField(object, later, 2), "type");
  assert.equal(objects.hasPrivateElement(object, later), false);
  assert.equal(object.internalRareSlots?.internalPrivateElements?.length, 1);
  // A frozen object's existing private field is still writable.
  assert.equal(
    objects.setPrivateElement({ value: 3, object }, name, 5, hooks),
    "none",
  );
  assert.equal(
    objects.getPrivateElement({ value: 3, object }, name, hooks).value,
    5,
  );
});

test("PrivateFieldAdd observes [[IsExtensible]] once, even for duplicates, and propagates abrupt checks", () => {
  const name = objects.createPrivateName("x");
  const log: string[] = [];
  let mode: "extensible" | "sealed" | "throw" = "extensible";
  const exotic = objects.createExoticObject<string, number>(undefined, {
    isExtensible: () => {
      log.push("isExtensible");
      if (mode === "throw") throw "trap";
      return mode === "extensible";
    },
  });
  assert.equal(objects.addPrivateField(exotic, name, 1), "none");
  assert.deepEqual(log, ["isExtensible"]);
  // Duplicate additions still query extensibility first.
  assert.equal(objects.addPrivateField(exotic, name, 2), "type");
  assert.deepEqual(log, ["isExtensible", "isExtensible"]);
  mode = "throw";
  assert.throws(
    () => objects.addPrivateField(exotic, objects.createPrivateName("y"), 3),
    (error: unknown) => error === "trap",
  );
  mode = "sealed";
  const fresh = objects.createPrivateName("z");
  assert.equal(objects.addPrivateField(exotic, fresh, 4), "type");
  assert.equal(objects.hasPrivateElement(exotic, fresh), false);
  assert.equal(
    objects.getPrivateElement({ value: 9, object: exotic }, name, hooks).value,
    1,
  );
});

test("PrivateMethodOrAccessorAdd itself checks only duplicates", () => {
  const object = objects.createObject<string, number>(undefined);
  objects.preventExtensions(object);
  const method = objects.createPrivateName("m"),
    accessor = objects.createPrivateName("a");
  assert.equal(objects.addPrivateMethod(object, method, 1), "none");
  assert.equal(objects.addPrivateAccessor(object, accessor, 2, 3), "none");
  assert.equal(objects.addPrivateMethod(object, method, 1), "type");
});
