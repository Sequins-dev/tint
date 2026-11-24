import { test } from "node:test";
import assert from "node:assert/strict";
import * as object from "@tint/js-runtime/objects";

const hooks: object.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call() {
    assert.fail("unexpected call");
  },
};
test("async generator objects have private lazy state and distinct prototype chains", () => {
  const root = object.createObject<object.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = object.createErrorRealm(root, hooks);
  assert.equal(typeof object.createAsyncGeneratorObject, "function");
  const generator = object.createAsyncGeneratorObject(
    () => {
      assert.fail("body entered");
    },
    realm,
    hooks,
  );
  assert.ok(generator.prototype === realm.asyncGeneratorPrototype);
  assert.ok(
    realm.asyncGeneratorPrototype.prototype === realm.asyncIteratorPrototype,
  );
  assert.ok(realm.asyncIteratorPrototype.prototype === root);
  assert.equal(generator.properties?.size ?? 0, 0);
  assert.equal(
    generator.internalExoticSlots?.internalAsyncGeneratorData?.record.state,
    "suspended-start",
  );
  assert.equal(generator.internalExoticSlots?.internalGeneratorData, undefined);
  assert.equal(
    realm.asyncGeneratorPrototype.internalExoticSlots
      ?.internalAsyncGeneratorData,
    undefined,
  );
});
test("async generator prototypes expose shared methods and correct descriptors", () => {
  const root = object.createObject<object.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = object.createErrorRealm(root, hooks);
  assert.ok(realm.asyncGeneratorPrototype);
  for (const name of ["next", "return", "throw"]) {
    const descriptor = object.getOwnProperty(
      realm.asyncGeneratorPrototype,
      name,
    );
    assert.ok(descriptor);
    assert.equal(descriptor.writable, true);
    assert.equal(descriptor.configurable, true);
    assert.equal(descriptor.enumerable, false);
    const method = descriptor.value as object.OrdinaryObject<
      object.ScriptPropertyKey,
      unknown
    >;
    assert.equal(object.getOwnProperty(method, "name")?.value, name);
    assert.equal(object.getOwnProperty(method, "length")?.value, 1);
    assert.equal(method.internalConstruct, undefined);
  }
  const tag = object.wellKnownSymbol(realm.symbolRegistry, "toStringTag");
  assert.equal(
    object.getOwnProperty(realm.asyncGeneratorPrototype, tag)?.value,
    "AsyncGenerator",
  );
  assert.equal(
    object.getOwnProperty(realm.asyncGeneratorFunctionPrototype, tag)?.value,
    "AsyncGeneratorFunction",
  );
  const key = object.wellKnownSymbol(realm.symbolRegistry, "asyncIterator");
  assert.ok(object.getOwnProperty(realm.asyncIteratorPrototype, key));
  assert.equal(
    object.getOwnProperty(
      realm.asyncIteratorPrototype,
      object.wellKnownSymbol(realm.symbolRegistry, "iterator"),
    ),
    undefined,
  );
});

test("AsyncGeneratorFunction has its own constructor and prototype identity", () => {
  const root = object.createObject<object.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = object.createErrorRealm(root, hooks);
  object.installFunctionIntrinsics(root, realm, hooks);
  const descriptor = object.getOwnProperty(
    realm.asyncGeneratorFunctionPrototype,
    "constructor",
  );
  assert.ok(descriptor);
  assert.equal(descriptor.writable, false);
  assert.equal(descriptor.configurable, true);
  const constructor = descriptor.value as object.OrdinaryObject<
    object.ScriptPropertyKey,
    unknown
  >;
  assert.equal(
    object.getOwnProperty(constructor, "name")?.value,
    "AsyncGeneratorFunction",
  );
  assert.equal(object.getOwnProperty(constructor, "length")?.value, 1);
  assert.ok(
    object.getOwnProperty(constructor, "prototype")?.value ===
      realm.asyncGeneratorFunctionPrototype,
  );
  assert.ok(
    constructor.prototype === object.getOwnProperty(root, "Function")?.value,
  );
  assert.equal(
    object.getOwnProperty(root, "AsyncGeneratorFunction"),
    undefined,
  );
});

test("source async generator functions are non-constructible with unique instance prototypes", () => {
  const root = object.createObject<object.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = object.createErrorRealm(root, hooks);
  const initialize = () => {
    assert.fail("initializer entered during function creation");
  };
  const fn = object.createSourceAsyncGeneratorFunction(
    initialize,
    realm,
    hooks,
    "g",
    2,
  );
  const other = object.createSourceAsyncGeneratorFunction(
    initialize,
    realm,
    hooks,
  );
  assert.ok(fn.prototype === realm.asyncGeneratorFunctionPrototype);
  assert.equal(fn.internalConstruct, undefined);
  assert.equal(object.getOwnProperty(fn, "name")?.value, "g");
  assert.equal(object.getOwnProperty(fn, "length")?.value, 2);
  const descriptor = object.getOwnProperty(fn, "prototype");
  assert.ok(descriptor);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.configurable, false);
  assert.ok(
    descriptor.value !== object.getOwnProperty(other, "prototype")?.value,
  );
});

test("async generator parameter errors propagate synchronously at invocation", () => {
  const root = object.createObject<object.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = object.createErrorRealm(root, hooks);
  const error = new Error("parameter initialization");
  const fn = object.createSourceAsyncGeneratorFunction(
    () => {
      throw error;
    },
    realm,
    hooks,
  );
  assert.throws(() => object.callObject(fn, undefined, [], undefined), error);
});
