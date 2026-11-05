import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createObject,
  getOwnProperty,
  defineOwnProperty,
  type ObjectHooks,
} from "@tint/js-runtime/objects";
import { emptyUpdate } from "@tint/js-runtime/descriptors";
import {
  createDeclarativeEnvironment,
  createMutableBinding,
  initializeBinding,
} from "@tint/js-runtime/environments/records";
import * as runtime from "../src/environments/global/index.ts";

function setup() {
  assert.equal(typeof runtime.createGlobalScope, "function");
  const object = createObject<string, unknown>(undefined);
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => {
      throw new Error("unexpected call");
    },
  };
  const global = runtime.createGlobalEnvironment(
    object,
    object,
    object,
    (name: string) => name,
    hooks,
  );
  return { object, global, scope: runtime.createGlobalScope(global) };
}
function local(
  outer: runtime.EnvironmentScope<string, unknown>,
  name: string,
  value: unknown,
) {
  const record = createDeclarativeEnvironment<unknown>(undefined);
  createMutableBinding(record, name, false);
  initializeBinding(record, name, value);
  return runtime.createDeclarativeScope(outer, record);
}

test("runtime references retain their resolved environment across later shadowing", () => {
  const { scope } = setup();
  const parameters = local(scope, "a", 1);
  const captured = runtime.resolveBinding(parameters, "a", true);
  const body = local(parameters, "a", 2);
  const current = runtime.resolveBinding(body, "a", true);
  assert.equal(runtime.putBindingReference(current, 42), "none");
  assert.equal(runtime.getBindingReference(captured).value, 1);
  assert.equal(runtime.getBindingReference(current).value, 42);
});

test("TDZ shadows outer values and differs from an unresolvable reference", () => {
  const { scope } = setup();
  const outer = local(scope, "x", 42);
  const record = createDeclarativeEnvironment<unknown>(undefined);
  createMutableBinding(record, "x", false);
  const inner = runtime.createDeclarativeScope(outer, record);
  const tdz = runtime.resolveBinding(inner, "x", false);
  const absent = runtime.resolveBinding(inner, "missing", false);
  assert.notEqual(tdz.scope, undefined);
  assert.equal(absent.scope, undefined);
  assert.equal(runtime.getBindingReference(tdz).error, "reference");
  assert.equal(runtime.getBindingReference(absent).error, "reference");
  assert.equal(runtime.putBindingReference(tdz, 1), "reference");
  initializeBinding(record, "x", undefined);
  assert.deepEqual(runtime.getBindingReference(tdz), {
    error: "none",
    value: undefined,
  });
});

test("typeof reference access suppresses only unresolvable-name errors", () => {
  assert.equal(typeof runtime.getBindingReferenceForTypeof, "function");
  const { scope } = setup();
  const record = createDeclarativeEnvironment<unknown>(undefined);
  createMutableBinding(record, "pending", false);
  const inner = runtime.createDeclarativeScope(scope, record);
  const absent = runtime.resolveBinding(inner, "missing", true);
  assert.deepEqual(runtime.getBindingReferenceForTypeof(absent), {
    error: "none",
    value: undefined,
  });
  assert.equal(
    runtime.getBindingReferenceForTypeof(
      runtime.resolveBinding(inner, "pending", true),
    ).error,
    "reference",
  );
  initializeBinding(record, "pending", 42);
  assert.equal(
    runtime.getBindingReferenceForTypeof(
      runtime.resolveBinding(inner, "pending", true),
    ).value,
    42,
  );
});

test("unresolvable writes honor captured strictness and target the global object", () => {
  const { scope, global, object } = setup();
  const strict = runtime.resolveBinding(scope, "x", true);
  const sloppy = runtime.resolveBinding(scope, "x", false);
  createMutableBinding(global.lexical, "x", false);
  initializeBinding(global.lexical, "x", 9);
  assert.equal(runtime.putBindingReference(strict, 1), "reference");
  assert.equal(runtime.putBindingReference(sloppy, 42), "none");
  assert.equal(getOwnProperty(object, "x")?.value, 42);
  assert.equal(runtime.getGlobalBinding(global, "x", true).value, 9);
  assert.equal(runtime.getBindingReference(sloppy).error, "reference");
});

test("global accessor references defer calls until access and preserve the global receiver", () => {
  const object = createObject<string, unknown>(undefined);
  let reads = 0;
  let seen: unknown;
  let stored: unknown;
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: (callee, receiver, args) =>
      Reflect.apply(callee as Function, receiver, args),
  };
  defineOwnProperty(
    object,
    "x",
    {
      ...emptyUpdate<unknown>(undefined),
      fields: 12,
      get: function (this: unknown) {
        reads++;
        seen = this;
        return 42;
      },
      set: function (this: unknown, value: unknown) {
        seen = this;
        stored = value;
      },
    },
    hooks,
  );
  const global = runtime.createGlobalEnvironment(
    object,
    object,
    object,
    (name: string) => name,
    hooks,
  );
  const reference = runtime.resolveBinding(
    runtime.createGlobalScope(global),
    "x",
    true,
  );
  assert.equal(reads, 0);
  assert.equal(runtime.getBindingReference(reference).value, 42);
  assert.equal(reads, 1);
  assert.equal(seen, object);
  assert.equal(runtime.putBindingReference(reference, "stored"), "none");
  assert.equal(stored, "stored");
  assert.equal(seen, object);
  assert.equal(reads, 1);
});
test("delete references preserve resolution and do not read TDZ bindings", () => {
  assert.equal(typeof runtime.deleteBindingReference, "function");
  const { scope, global, object } = setup();
  const unresolved = runtime.resolveBinding(scope, "later", false);
  runtime.putBindingReference(unresolved, 42);
  assert.equal(runtime.deleteBindingReference(unresolved), true);
  assert.equal(getOwnProperty(object, "later")?.value, 42);
  assert.equal(
    runtime.deleteBindingReference(
      runtime.resolveBinding(scope, "absent", false),
    ),
    true,
  );
  runtime.putBindingReference(
    runtime.resolveBinding(scope, "temporary", false),
    42,
  );
  assert.equal(
    runtime.deleteBindingReference(
      runtime.resolveBinding(scope, "temporary", false),
    ),
    true,
  );
  assert.equal(getOwnProperty(object, "temporary"), undefined);
  const record = createDeclarativeEnvironment<unknown>(undefined);
  createMutableBinding(record, "tdz", false);
  const inner = runtime.createDeclarativeScope(scope, record);
  assert.equal(
    runtime.deleteBindingReference(runtime.resolveBinding(inner, "tdz", false)),
    false,
  );
  runtime.createGlobalVarBinding(global, "permanent", false);
  assert.equal(
    runtime.deleteBindingReference(
      runtime.resolveBinding(scope, "permanent", false),
    ),
    false,
  );
});
