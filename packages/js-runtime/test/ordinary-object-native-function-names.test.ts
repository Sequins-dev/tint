import assert from "node:assert/strict";
import { test } from "node:test";
import * as objects from "../src/objects/index.ts";

test("native function initial names survive public name redefinition", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(root, hooks);
  objects.installSetIntrinsics(root, realm, hooks);
  objects.installErrorIntrinsics(root, realm, hooks);
  for (const [object, name] of [
    [objects.getOwnProperty(root, "Set")!.value, "Set"],
    [objects.getOwnProperty(root, "Error")!.value, "Error"],
    [objects.getOwnProperty(realm.setPrototype, "add")!.value, "add"],
    [realm.functionPrototype, ""],
    [realm.throwTypeError, ""],
  ] as const) {
    const fn = object as objects.OrdinaryObject<
      objects.ScriptPropertyKey,
      unknown
    >;
    assert.equal(objects.exoticSlots(fn).internalInitialName, name);
    if (fn !== realm.throwTypeError) {
      objects.defineOwnProperty(
        fn,
        "name",
        {
          fields: 1,
          value: "changed",
          writable: false,
          enumerable: false,
          configurable: true,
          get: undefined,
          set: undefined,
        },
        hooks,
      );
      assert.equal(objects.exoticSlots(fn).internalInitialName, name);
    }
  }
});

test("source methods retain source text without acquiring a built-in initial name", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const realm = objects.createErrorRealm(
    objects.createObject<objects.ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const method = objects.createClassMethod(
    realm.objectPrototype,
    "method",
    0,
    () => 42,
    realm,
    hooks,
    "method /* exact */ () { return 42; }",
  );
  assert.equal(objects.exoticSlots(method).internalInitialName, undefined);
  assert.equal(
    method.internalRareSlots?.internalExoticSlots?.internalSourceText,
    "method /* exact */ () { return 42; }",
  );
  assert.equal(objects.retainFunctionSource(method, "replacement"), method);
  assert.equal(
    method.internalRareSlots?.internalExoticSlots?.internalSourceText,
    "replacement",
  );
});

test("Function.prototype and the intrinsic thrower create length before name", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
      undefined,
    ),
    realm = objects.createErrorRealm(root, hooks);
  for (const fn of [realm.functionPrototype, realm.throwTypeError]) {
    const keys = objects.ownKeys(fn, () => -1),
      length = keys.indexOf("length");
    assert.ok(length >= 0);
    assert.equal(keys.indexOf("name"), length + 1);
  }
  assert.deepEqual(
    objects.ownKeys(realm.functionPrototype, () => -1).slice(0, 2),
    ["length", "name"],
  );
});
