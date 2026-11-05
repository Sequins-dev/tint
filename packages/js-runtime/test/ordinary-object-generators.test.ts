import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  OrdinaryObject,
  ObjectHooks,
  ScriptPropertyKey,
  GeneratorContinuation,
} from "@tint/js-runtime/objects";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
bindHostRecordViews();
const object = await import("@tint/js-runtime/objects");

const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => {
    throw new Error("unexpected hook call");
  },
};

test("generator creation installs private state without evaluating the body", () => {
  const root = object.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = object.createErrorRealm(root, hooks);
  const continuation = () => {
    assert.fail("body must not start");
  };
  const generator = object.createGeneratorObject(continuation, realm);
  assert.equal(generator.prototype, realm.generatorPrototype);
  assert.equal(realm.generatorPrototype.prototype, realm.iteratorPrototype);
  assert.equal(generator.properties.size, 0);
  assert.equal(generator.internalGeneratorData?.state, "suspended-start");
  assert.equal(
    typeof generator.internalGeneratorData?.continuation,
    "function",
  );
  assert.equal(realm.generatorPrototype.internalGeneratorData, undefined);
  const prototype = object.createObject<ScriptPropertyKey, unknown>(
    realm.generatorPrototype,
  );
  assert.equal(
    object.createGeneratorObject(continuation, realm, prototype).prototype,
    prototype,
  );
});

test("generator prototype installs shared non-enumerable methods and a fixed tag", () => {
  const root = object.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = object.createErrorRealm(root, hooks);
  for (const name of ["next", "return", "throw"]) {
    const descriptor = object.getOwnProperty(realm.generatorPrototype, name);
    assert.ok(descriptor);
    assert.equal(descriptor.writable, true);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.configurable, true);
    const method = descriptor.value as OrdinaryObject<
      ScriptPropertyKey,
      unknown
    >;
    assert.equal(method.prototype, realm.functionPrototype);
    assert.equal(object.getOwnProperty(method, "name")?.value, name);
    assert.equal(object.getOwnProperty(method, "length")?.value, 1);
  }
  const tag = object.getOwnProperty(
    realm.generatorPrototype,
    object.wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
  );
  assert.ok(tag);
  assert.equal(tag.value, "Generator");
  assert.equal(tag.writable, false);
  assert.equal(tag.enumerable, false);
  assert.equal(tag.configurable, true);
});

test("source generator functions have non-constructible identities and distinct instance prototypes", () => {
  const root = object.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = object.createErrorRealm(root, hooks);
  object.installFunctionIntrinsics(root, realm, hooks);
  const initialize = () => {
    throw new Error("must not initialize during creation");
  };
  const first = object.createSourceGeneratorFunction(
    initialize,
    realm,
    hooks,
    "g",
    2,
  );
  const second = object.createSourceGeneratorFunction(
    initialize,
    realm,
    hooks,
    "h",
    0,
  );
  assert.equal(first.prototype, realm.generatorFunctionPrototype);
  assert.equal(
    realm.generatorFunctionPrototype.prototype,
    realm.functionPrototype,
  );
  assert.equal(realm.generatorFunctionPrototype.internalCall, undefined);
  assert.ok(first.internalCall);
  assert.equal(first.internalConstruct, undefined);
  assert.equal(object.getOwnProperty(first, "name")?.value, "g");
  assert.equal(object.getOwnProperty(first, "length")?.value, 2);
  const descriptor = object.getOwnProperty(first, "prototype");
  assert.ok(descriptor);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.configurable, false);
  const instancePrototype = descriptor.value as OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  assert.equal(instancePrototype.prototype, realm.generatorPrototype);
  assert.equal(
    object.getOwnProperty(instancePrototype, "constructor"),
    undefined,
  );
  assert.notEqual(
    instancePrototype,
    object.getOwnProperty(second, "prototype")?.value,
  );
  assert.equal(
    object.getOwnProperty(realm.generatorPrototype, "constructor")?.value,
    realm.generatorFunctionPrototype,
  );
  assert.equal(
    object.getOwnProperty(realm.generatorPrototype, "constructor")?.writable,
    false,
  );
  const constructor = object.getOwnProperty(
    realm.generatorFunctionPrototype,
    "constructor",
  )?.value as OrdinaryObject<ScriptPropertyKey, unknown>;
  assert.equal(
    constructor.prototype,
    object.getOwnProperty(root, "Function")?.value,
  );
  assert.equal(
    object.getOwnProperty(constructor, "prototype")?.value,
    realm.generatorFunctionPrototype,
  );
  assert.equal(
    object.getOwnProperty(constructor, "name")?.value,
    "GeneratorFunction",
  );
  assert.equal(
    object.getOwnProperty(realm.generatorFunctionPrototype, "prototype")?.value,
    realm.generatorPrototype,
  );
  assert.equal(
    object.getOwnProperty(
      realm.generatorFunctionPrototype,
      object.wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    )?.value,
    "GeneratorFunction",
  );
});

test("source generator parameter initialization throws at call time", () => {
  const root = object.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = object.createErrorRealm(root, hooks);
  const marker = {};
  let calls = 0;
  const fn = object.createSourceGeneratorFunction(
    (receiver, args, callee) => {
      calls++;
      assert.equal(receiver, marker);
      assert.deepEqual(args, [42]);
      assert.equal(callee, fn);
      throw marker;
    },
    realm,
    hooks,
  );
  assert.equal(calls, 0);
  assert.throws(
    () => fn.internalCall!(marker, [42]),
    (error) => error === marker,
  );
  assert.equal(calls, 1);
});

test("a hidden generator transfers only an unstarted continuation and releases its record", () => {
  assert.equal(typeof object.takeGeneratorStart, "function");
  const realm = object.createErrorRealm(
    object.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  const identity = {},
    outside = {};
  let entered: unknown;
  const hidden = object.runScriptContext(
    realm.agent,
    { realm, scriptOrModule: identity },
    () =>
      object.createGeneratorObject((_kind, value) => {
        entered = realm.agent.activeContext?.scriptOrModule;
        return { kind: "return", value };
      }, realm),
  );
  const start = object.takeGeneratorStart(hidden, realm);
  assert.equal(hidden.internalGeneratorData?.state, "completed");
  assert.equal(hidden.internalGeneratorData?.continuation, undefined);
  const result = object.runScriptContext(
    realm.agent,
    { realm, scriptOrModule: outside },
    () => start("next", 42),
  );
  assert.deepEqual(result, { kind: "return", value: 42 });
  assert.equal(entered, identity);
  assert.throws(
    () => object.takeGeneratorStart(hidden, realm),
    (e) => e === "DYNAMIC_GENERATOR_CARRIER_INVARIANT",
  );
  for (const value of [
    undefined,
    7,
    {},
    object.createObject<ScriptPropertyKey, unknown>(undefined),
  ])
    assert.throws(
      () => object.takeGeneratorStart(value, realm),
      (e) => e === "DYNAMIC_GENERATOR_CARRIER_INVARIANT",
    );
  for (const state of ["suspended-yield", "executing", "completed"] as const) {
    const g = object.createGeneratorObject(
      () => ({ kind: "return", value: undefined }),
      realm,
    );
    g.internalGeneratorData!.state = state;
    assert.throws(
      () => object.takeGeneratorStart(g, realm),
      (e) => e === "DYNAMIC_GENERATOR_CARRIER_INVARIANT",
    );
  }
});
