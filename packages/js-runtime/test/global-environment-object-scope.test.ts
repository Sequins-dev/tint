import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createObject,
  defineOwnProperty,
  deleteProperty,
  type OrdinaryObject,
} from "@tint/js-runtime/objects";
import {
  emptyUpdate,
  valueField,
  writableField,
  configurableField,
  getField,
} from "@tint/js-runtime/descriptors";
import * as runtime from "../src/environments/global/index.ts";
type Key = string | symbol;
function setup(withEnvironment = true) {
  const objects = new Set<unknown>();
  function object(
    prototype: OrdinaryObject<Key, unknown> | undefined = undefined,
  ) {
    const result = createObject<Key, unknown>(prototype);
    objects.add(result);
    return result;
  }
  const hooks: runtime.ObjectEnvironmentHooks<Key, unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: (callee, receiver, args) =>
      Reflect.apply(callee as Function, receiver, args),
    keyForName: (name) => name,
    unscopablesKey: Symbol.unscopables,
    asObject: (value) =>
      objects.has(value) ? (value as OrdinaryObject<Key, unknown>) : undefined,
    truthy: Boolean,
  };
  function property(
    target: OrdinaryObject<Key, unknown>,
    key: Key,
    value: unknown,
    writable = true,
    configurable = true,
  ) {
    assert.ok(
      defineOwnProperty(
        target,
        key,
        {
          ...emptyUpdate<unknown>(undefined),
          fields: valueField | writableField | configurableField,
          value,
          writable,
          configurable,
        },
        hooks,
      ),
    );
  }
  function getter(
    target: OrdinaryObject<Key, unknown>,
    key: Key,
    get: () => unknown,
  ) {
    assert.ok(
      defineOwnProperty(
        target,
        key,
        {
          ...emptyUpdate<unknown>(undefined),
          fields: getField | configurableField,
          get,
          configurable: true,
        },
        hooks,
      ),
    );
  }
  const outer = object(),
    prototype = object(),
    inner = object(prototype);
  const global = runtime.createGlobalEnvironment(
    outer,
    outer,
    outer,
    (name) => name,
    hooks,
  );
  const root = runtime.createGlobalScope(global);
  assert.equal(typeof runtime.createObjectEnvironment, "function");
  const record = runtime.createObjectEnvironment(
    inner,
    inner,
    withEnvironment,
    hooks,
  );
  const scope = runtime.createObjectScope(root, record);
  return {
    object,
    inner,
    outer,
    prototype,
    hooks,
    property,
    getter,
    record,
    scope,
    root,
  };
}

test("object scopes resolve inherited bindings and provide an implicit call receiver", () => {
  const s = setup();
  s.property(s.prototype, "x", 42);
  const ref = runtime.resolveBinding(s.scope, "x", false);
  assert.deepEqual(runtime.getBindingReference(ref), {
    error: "none",
    value: 42,
  });
  assert.equal(runtime.getBindingThisValue(ref), s.inner);
  s.property(s.outer, "y", 19);
  assert.equal(
    runtime.getBindingThisValue(runtime.resolveBinding(s.scope, "y", false)),
    undefined,
  );
});
test("unscopables lookup follows HasProperty and never reads the bound value", () => {
  const s = setup();
  const log: string[] = [];
  s.getter(s.inner, "x", () => {
    log.push("value");
    return 42;
  });
  s.getter(s.inner, Symbol.unscopables, () => {
    log.push("filter");
    return 1;
  });
  assert.equal(runtime.hasObjectBinding(s.record, "absent"), false);
  assert.deepEqual(log, []);
  const ref = runtime.resolveBinding(s.scope, "x", false);
  assert.deepEqual(log, ["filter"]);
  assert.equal(runtime.getBindingReference(ref).value, 42);
  assert.deepEqual(log, ["filter", "value"]);
});
test("object-valued unscopables filter names through inherited properties", () => {
  const s = setup(),
    blockedPrototype = s.object(),
    blocked = s.object(blockedPrototype);
  s.property(s.inner, "x", 19);
  s.property(s.outer, "x", 42);
  s.property(blockedPrototype, "x", true);
  s.property(s.inner, Symbol.unscopables, blocked);
  assert.equal(
    runtime.getBindingReference(runtime.resolveBinding(s.scope, "x", false))
      .value,
    42,
  );
  s.property(blockedPrototype, "x", false);
  assert.equal(
    runtime.getBindingReference(runtime.resolveBinding(s.scope, "x", false))
      .value,
    19,
  );
});
test("resolved object references are not re-filtered after user code changes unscopables", () => {
  const s = setup(),
    blocked = s.object();
  s.property(s.inner, "x", 19);
  s.property(s.outer, "x", 99);
  const ref = runtime.resolveBinding(s.scope, "x", false);
  s.property(blocked, "x", true);
  s.property(s.inner, Symbol.unscopables, blocked);
  assert.equal(runtime.putBindingReference(ref, 42), "none");
  assert.equal(runtime.getBindingReference(ref).value, 42);
  assert.equal(runtime.deleteBindingReference(ref), true);
  assert.deepEqual(runtime.getBindingReference(ref), {
    error: "none",
    value: undefined,
  });
  assert.equal(
    runtime.getBindingReference(runtime.resolveBinding(s.scope, "x", false))
      .value,
    99,
  );
});
test("deleted object bindings reject strict writes but allow sloppy recreation", () => {
  const s = setup();
  s.property(s.inner, "x", 19);
  const ref = runtime.resolveBinding(s.scope, "x", true);
  deleteProperty(s.inner, "x");
  assert.equal(runtime.getBindingReference(ref).error, "reference");
  assert.equal(runtime.putBindingReference(ref, 42), "reference");
  assert.equal(
    runtime.putBindingReference({ ...ref, strict: false }, 42),
    "none",
  );
  assert.equal(runtime.getBindingReference(ref).value, 42);
});
test("non-writable object bindings respect strictness and deletion attributes", () => {
  const s = setup();
  s.property(s.inner, "x", 19, false, false);
  assert.equal(
    runtime.putBindingReference(
      runtime.resolveBinding(s.scope, "x", false),
      42,
    ),
    "none",
  );
  const strict = runtime.resolveBinding(s.scope, "x", true);
  assert.equal(runtime.putBindingReference(strict, 42), "type");
  assert.equal(runtime.deleteBindingReference(strict), false);
  assert.equal(runtime.getBindingReference(strict).value, 19);
});
test("ordinary object environments skip unscopables and have no implicit receiver", () => {
  const s = setup(false);
  s.property(s.inner, "x", 42);
  s.getter(s.inner, Symbol.unscopables, () => {
    throw 19;
  });
  const ref = runtime.resolveBinding(s.scope, "x", false);
  assert.equal(runtime.getBindingReference(ref).value, 42);
  assert.equal(runtime.getBindingThisValue(ref), undefined);
});
test("unscopables getter failures propagate from resolution", () => {
  const s = setup();
  s.property(s.inner, "x", 42);
  s.getter(s.inner, Symbol.unscopables, () => {
    throw 19;
  });
  assert.throws(
    () => runtime.resolveBinding(s.scope, "x", false),
    (e) => e === 19,
  );
});
