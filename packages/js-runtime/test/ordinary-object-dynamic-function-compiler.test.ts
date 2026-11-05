import { test } from "node:test";
import assert from "node:assert/strict";
import * as object from "../src/objects/index.ts";

test("dynamic constructor compilation receives coerced source, kind and construction target", () => {
  const hooks: object.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = object.createObject<object.ScriptPropertyKey, unknown>(
      undefined,
    ),
    realm = object.createErrorRealm(root, hooks);
  object.installFunctionIntrinsics(root, realm, hooks);
  const created = object.createCallableObject<
    object.ScriptPropertyKey,
    unknown
  >(realm.functionPrototype, () => 42);
  const target = object.createConstructorObject<
    object.ScriptPropertyKey,
    unknown
  >(
    realm.functionPrototype,
    () => undefined,
    () => undefined,
  );
  let received: unknown[] = [];
  realm.dynamicFunctionCompiler = (kind, parameters, body, newTarget) => {
    received = [kind, parameters, body, newTarget];
    return created;
  };
  for (const [kind, prototype] of [
    ["normal", realm.functionPrototype],
    ["generator", realm.generatorFunctionPrototype],
    ["async", realm.asyncFunctionPrototype],
    ["async-generator", realm.asyncGeneratorFunctionPrototype],
  ] as const) {
    const constructor = object.getOwnProperty(prototype, "constructor")!
      .value as object.OrdinaryObject<object.ScriptPropertyKey, unknown>;
    assert.equal(
      constructor.internalCall!(undefined, ["a", 2, undefined]),
      created,
    );
    assert.deepEqual(received, [kind, ["a", "2"], "undefined", constructor]);
    assert.equal(
      constructor.internalConstruct!(["return 1;"], target),
      created,
    );
    assert.deepEqual(received, [kind, [], "return 1;", target]);
    assert.equal(constructor.internalCall!(undefined, []), created);
    assert.deepEqual(received, [kind, [], "", constructor]);
  }
  assert.equal(realm.unsupported, false);
  realm.dynamicFunctionCompiler = () => {
    throw 42;
  };
  const constructor = object.getOwnProperty(root, "Function")!
    .value as object.OrdinaryObject<object.ScriptPropertyKey, unknown>;
  assert.throws(
    () => constructor.internalCall!(undefined, []),
    (error) => error === 42,
  );
  assert.equal(realm.unsupported, false);
});
