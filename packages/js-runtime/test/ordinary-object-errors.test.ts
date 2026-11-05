import type { ScriptPropertyKey } from "@tint/js-runtime/objects";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";
const hooks: objects.ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => {
    throw new Error("unexpected user call");
  },
};
test("runtime errors use realm-local prototypes and non-enumerable inherited names", () => {
  assert.equal(typeof objects.createErrorRealm, "function");
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(root, hooks);
  const other = objects.createErrorRealm(root, hooks);
  for (const [kind, name] of [
    ["type", "TypeError"],
    ["reference", "ReferenceError"],
    ["syntax", "SyntaxError"],
  ]) {
    const error = objects.createRuntimeError(realm, kind!);
    const second = objects.createRuntimeError(realm, kind!);
    assert.notEqual(error, second);
    assert.equal(error.prototype, second.prototype);
    assert.notEqual(
      error.prototype,
      objects.createRuntimeError(other, kind!).prototype,
    );
    assert.equal(objects.getOwnProperty(error, "name"), undefined);
    assert.equal(objects.getProperty(error, "name", error, hooks), name);
    assert.equal(objects.getProperty(error, "message", error, hooks), "");
    const descriptor = objects.getOwnProperty(error.prototype!, "name")!;
    assert.equal(descriptor.writable, true);
    assert.equal(descriptor.configurable, true);
    assert.equal(descriptor.enumerable, false);
    assert.equal(error.prototype?.prototype?.prototype, root);
  }
});

test("unsupported execution remains an embedding outcome after a user catches the payload", () => {
  const realm = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
  assert.equal(typeof objects.rejectUnsupportedExecution, "function");
  try {
    objects.rejectUnsupportedExecution(realm);
  } catch {}
  assert.deepEqual(objects.finishScriptExecution(realm, "none", 42), {
    error: "unsupported",
    value: undefined,
  });
});

test("Error intrinsics expose realm-local constructors and standard property attributes", () => {
  assert.equal(typeof objects.installErrorIntrinsics, "function");
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(root, hooks);
  const global = objects.createObject<ScriptPropertyKey, unknown>(root);
  objects.installErrorIntrinsics(global, realm, hooks);
  const errorConstructor = realm.constructors.get("error")!;
  for (const [kind, name] of [
    ["error", "Error"],
    ["type", "TypeError"],
    ["reference", "ReferenceError"],
    ["syntax", "SyntaxError"],
    ["range", "RangeError"],
    ["eval", "EvalError"],
    ["uri", "URIError"],
  ]) {
    const constructor = realm.constructors.get(kind!)!;
    assert.equal(
      objects.getProperty(global, name!, global, hooks),
      constructor,
    );
    assert.equal(
      constructor.prototype,
      kind === "error" ? realm.functionPrototype : errorConstructor,
    );
    assert.equal(objects.getOwnProperty(constructor, "name")?.value, name);
    assert.equal(objects.getOwnProperty(constructor, "length")?.value, 1);
    const prototype = realm.prototypes.get(kind!)!;
    assert.equal(
      objects.getOwnProperty(constructor, "prototype")?.value,
      prototype,
    );
    assert.equal(
      objects.getOwnProperty(constructor, "prototype")?.writable,
      false,
    );
    assert.equal(
      objects.getOwnProperty(constructor, "prototype")?.configurable,
      false,
    );
    assert.equal(
      objects.getOwnProperty(prototype, "constructor")?.value,
      constructor,
    );
    assert.equal(objects.getOwnProperty(global, name!)?.enumerable, false);
    assert.equal(objects.getOwnProperty(global, name!)?.writable, true);
    assert.equal(
      objects.createRuntimeError(realm, kind!).internalErrorData,
      true,
    );
    assert.equal(prototype.internalErrorData, false);
  }
});

test("each realm owns one non-extensible ThrowTypeError intrinsic", () => {
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(root, hooks);
  const other = objects.createErrorRealm(root, hooks);
  assert.ok(realm.throwTypeError);
  assert.notEqual(realm.throwTypeError, other.throwTypeError);
  assert.equal(realm.throwTypeError.prototype, realm.functionPrototype);
  assert.equal(realm.throwTypeError.extensible, false);
  for (const [key, value] of [
    ["name", ""],
    ["length", 0],
  ] as const) {
    const descriptor = objects.getOwnProperty(realm.throwTypeError, key)!;
    assert.equal(descriptor.value, value);
    assert.equal(descriptor.writable, false);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.configurable, false);
  }
  let first: unknown;
  let second: unknown;
  try {
    realm.throwTypeError.internalCall!(undefined, []);
  } catch (error) {
    first = error;
  }
  try {
    realm.throwTypeError.internalCall!(42, [1]);
  } catch (error) {
    second = error;
  }
  assert.ok(first);
  assert.notEqual(first, second);
  assert.equal(
    (first as objects.OrdinaryObject<ScriptPropertyKey, unknown>).prototype,
    realm.prototypes.get("type"),
  );
  assert.equal(
    (first as objects.OrdinaryObject<ScriptPropertyKey, unknown>)
      .internalErrorData,
    true,
  );
});

test("Error.isError exposes a nonconstructible unary method", () => {
  const global = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(global, hooks);
  objects.installErrorIntrinsics(global, realm, hooks);
  const constructor = realm.constructors.get("error")!;
  const descriptor = objects.getOwnProperty(constructor, "isError");
  assert.ok(descriptor);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.configurable, true);
  const method = descriptor.value as objects.OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  assert.equal(objects.getOwnProperty(method, "length")?.value, 1);
  assert.equal(objects.getOwnProperty(method, "name")?.value, "isError");
  assert.equal(method.internalConstruct, undefined);
});

test("SuppressedError owns a ternary constructor and non-enumerable failure values", () => {
  const global = objects.createObject<ScriptPropertyKey, unknown>(undefined),
    realm = objects.createErrorRealm(global, hooks);
  objects.installErrorIntrinsics(global, realm, hooks);
  const constructor = realm.constructors.get("suppressed");
  assert.ok(constructor);
  assert.equal(objects.getOwnProperty(constructor, "length")?.value, 3);
  assert.equal(
    objects.getOwnProperty(constructor, "name")?.value,
    "SuppressedError",
  );
  assert.equal(constructor.prototype, realm.constructors.get("error"));
  assert.ok(constructor.internalCall);
  const error = constructor.internalCall(
    undefined,
    [19, 42],
  ) as objects.OrdinaryObject<ScriptPropertyKey, unknown>;
  assert.equal(error.prototype, realm.prototypes.get("suppressed"));
  assert.equal(error.internalErrorData, true);
  assert.equal(objects.getOwnProperty(error, "message"), undefined);
  assert.equal(objects.getOwnProperty(error, "cause"), undefined);
  for (const [key, value] of [
    ["error", 19],
    ["suppressed", 42],
  ] as const) {
    const descriptor = objects.getOwnProperty(error, key);
    assert.ok(descriptor);
    assert.equal(descriptor.value, value);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.writable, true);
    assert.equal(descriptor.configurable, true);
  }
});
