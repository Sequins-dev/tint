import assert from "node:assert/strict";
import test from "node:test";
import type * as Objects from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
import { builtinAccessor, builtinFunction } from "../src/objects/intrinsics.ts";
bindHostRecordViews();
const o = await import("../src/objects/index.ts");
type ObjectValue = Objects.OrdinaryObject<Objects.ScriptPropertyKey, unknown>;
function fixture(parent?: Objects.ErrorRealm) {
  const root = o.createObject<Objects.ScriptPropertyKey, unknown>(undefined);
  const global = o.createObject(root);
  const hooks: Objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: (callee, receiver, args) => {
      const result = o.callObjectValue(callee, receiver, args, root);
      assert.equal(result.error, "none");
      return result.value;
    },
  };
  const realm = o.createErrorRealm(
    root,
    hooks,
    parent?.symbolRegistry,
    parent?.agent,
  );
  o.installErrorIntrinsics(global, realm, hooks);
  const prototype = realm.prototypes.get("error")!;
  const descriptor = () => {
    const value = o.getOwnProperty(prototype, "stack");
    assert.ok(value, "Error.prototype.stack accessor must exist");
    return value;
  };
  const call = (callee: unknown, receiver: unknown, args: unknown[] = []) =>
    hooks.call(callee, receiver, args);
  const get = (receiver: unknown) => call(descriptor().get, receiver);
  const set = (receiver: unknown, args: unknown[] = []) =>
    call(descriptor().set, receiver, args);
  const typeError = (error: unknown) =>
    (error as ObjectValue).prototype === realm.prototypes.get("type");
  return { realm, hooks, prototype, descriptor, call, get, set, typeError };
}

test("Error stack accessor metadata is realm-local and not constructible", () => {
  const a = fixture(),
    b = fixture(a.realm),
    d = a.descriptor();
  assert.equal(d.enumerable, false);
  assert.equal(d.configurable, true);
  assert.equal(d.value, undefined);
  for (const [value, name, length] of [
    [d.get, "get stack", 0],
    [d.set, "set stack", 1],
  ] as const) {
    const fn = value as ObjectValue;
    assert.ok(fn.internalCall);
    assert.equal(fn.internalConstruct, undefined);
    assert.equal(o.getOwnProperty(fn, "name")?.value, name);
    assert.equal(o.getOwnProperty(fn, "length")?.value, length);
    assert.equal(o.getOwnProperty(fn, "name")?.writable, false);
    assert.equal(o.getOwnProperty(fn, "length")?.configurable, true);
  }
  assert.notEqual(d.get, b.descriptor().get);
  assert.notEqual(d.set, b.descriptor().set);
});

test("Error stack getter checks the receiver slot without inheritance or traps", () => {
  const a = fixture(),
    b = fixture(a.realm);
  for (const kind of [
    "error",
    "type",
    "reference",
    "syntax",
    "range",
    "eval",
    "uri",
    "aggregate",
    "suppressed",
  ]) {
    const error = o.createRuntimeError(b.realm, kind);
    assert.equal(typeof a.get(error), "string");
    assert.equal(o.getOwnProperty(error, "stack"), undefined);
    assert.equal(a.get(error.prototype), undefined);
    assert.equal(a.get(o.createObject(error)), undefined);
  }
  const proxy = o.createExoticObject<Objects.ScriptPropertyKey, unknown>(
    a.prototype,
    {
      getOwnProperty: () =>
        assert.fail("getter must not query proxy descriptors"),
      get: () => assert.fail("getter must not perform property access"),
    },
  );
  proxy.internalProxyData = {
    target: o.createRuntimeError(a.realm, "error"),
    handler: a.prototype,
  };
  assert.equal(a.get(proxy), undefined);
  for (const value of [
    undefined,
    null,
    false,
    1,
    "",
    o.createBigIntLiteral("0"),
  ])
    assert.throws(() => a.get(value), a.typeError);
});

test("Error stack snapshots retain source invocation names after normal and abrupt exits", () => {
  const a = fixture();
  const origin = o.createSourceFunction(
    () => o.createRuntimeError(a.realm, "error"),
    false,
    a.realm,
    a.hooks,
    "origin",
  );
  const outer = o.createSourceFunction(
    () => a.call(origin, undefined),
    false,
    a.realm,
    a.hooks,
    "outer",
  );
  const error = a.call(outer, undefined) as ObjectValue;
  const trace = a.get(error);
  assert.equal(typeof trace, "string");
  assert.match(trace as string, /origin/);
  assert.match(trace as string, /outer/);
  a.set(error, ["overridden"]);
  assert.equal(o.getProperty(error, "stack", error, a.hooks), "overridden");
  assert.equal(
    a.get(error),
    trace,
    "own properties never replace captured data",
  );
  const failing = o.createSourceFunction(
    () => {
      throw error;
    },
    false,
    a.realm,
    a.hooks,
    "gone",
  );
  assert.throws(
    () => a.call(failing, undefined),
    (value) => value === error,
  );
  const later = a.get(o.createRuntimeError(a.realm, "error"));
  assert.doesNotMatch(later as string, /origin|outer|gone/);
  assert.equal(a.realm.agent.activeContext, undefined);
});

test("Error stack setter validates receiver and String before any object traps", () => {
  const a = fixture();
  let traps = 0;
  const exotic = o.createExoticObject<Objects.ScriptPropertyKey, unknown>(
    undefined,
    {
      getOwnProperty: () => {
        traps++;
        return undefined;
      },
    },
  );
  for (const value of [undefined, null, false, 1, ""])
    assert.throws(() => a.set(value, ["text"]), a.typeError);
  for (const value of [
    undefined,
    null,
    false,
    1,
    o.createObject(a.prototype),
    o.createBigIntLiteral("1"),
  ])
    assert.throws(() => a.set(exotic, [value]), a.typeError);
  assert.equal(traps, 0);
  assert.throws(() => a.set(a.prototype, [""]), a.typeError);
});

test("Error stack setter shadows inherited accessors on nonextensible prototypes and preserves own attributes", () => {
  const a = fixture();
  o.preventExtensions(a.prototype);
  const receiver = o.createObject(a.prototype);
  assert.equal(a.set(receiver, [""]), undefined);
  const d = o.getOwnProperty(receiver, "stack")!;
  assert.equal(d.value, "");
  assert.equal(d.writable, true);
  assert.equal(d.enumerable, true);
  assert.equal(d.configurable, true);
  o.defineOwnProperty(
    receiver,
    "stack",
    {
      fields: 48,
      enumerable: false,
      configurable: false,
      value: undefined,
      writable: false,
      get: undefined,
      set: undefined,
    },
    a.hooks,
  );
  a.set(receiver, ["next"]);
  assert.equal(o.getOwnProperty(receiver, "stack")?.value, "next");
  assert.equal(o.getOwnProperty(receiver, "stack")?.enumerable, false);
  assert.equal(o.getOwnProperty(receiver, "stack")?.configurable, false);
  const closed = o.createObject(a.prototype);
  o.preventExtensions(closed);
  assert.throws(() => a.set(closed, ["x"]), a.typeError);
  o.defineOwnProperty(
    receiver,
    "stack",
    {
      fields: 2,
      value: undefined,
      writable: false,
      get: undefined,
      set: undefined,
      enumerable: false,
      configurable: false,
    },
    a.hooks,
  );
  assert.throws(() => a.set(receiver, ["blocked"]), a.typeError);
});

test("Error stack setter dispatches existing accessors and propagates abrupt completion", () => {
  const a = fixture(),
    receiver = o.createObject(a.prototype);
  let observed: unknown;
  const own = builtinFunction(
    a.realm.functionPrototype,
    "set own",
    1,
    (self, args) => {
      assert.equal(self, receiver);
      observed = args[0];
      return undefined;
    },
    a.hooks,
  );
  builtinAccessor(receiver, "stack", undefined, own, a.hooks);
  a.set(receiver, ["value"]);
  assert.equal(observed, "value");
  builtinAccessor(receiver, "stack", undefined, undefined, a.hooks);
  assert.throws(() => a.set(receiver, ["value"]), a.typeError);
  const b = fixture(a.realm);
  assert.throws(() => a.set(b.prototype, ["value"]), b.typeError);
  const foreign = o.createRuntimeError(b.realm, "error");
  a.set(foreign, ["foreign"]);
  assert.equal(o.getOwnProperty(foreign, "stack")?.value, "foreign");
});

test("Error stack setter follows GetOwnProperty then DefineOwnProperty or Set and retains thrown values", () => {
  const a = fixture(),
    log: string[] = [],
    sentinel = {};
  let present = false,
    accepted = true;
  const exotic = o.createExoticObject<Objects.ScriptPropertyKey, unknown>(
    a.prototype,
    {
      getOwnProperty: (self, key) => {
        assert.equal(key, "stack");
        log.push("getOwn");
        return present ? a.descriptor() : undefined;
      },
      defineOwnProperty: (self, key, update) => {
        log.push("define");
        assert.equal(update.value, "text");
        return accepted ? "accepted" : "rejected";
      },
      set: (self, key, value, receiver) => {
        log.push("set");
        assert.equal(receiver.value, exotic);
        if (!accepted) throw sentinel;
        return true;
      },
    },
  );
  a.set(exotic, ["text"]);
  assert.deepEqual(log, ["getOwn", "define"]);
  log.length = 0;
  present = true;
  a.set(exotic, ["text"]);
  assert.deepEqual(log, ["getOwn", "set"]);
  accepted = false;
  assert.throws(
    () => a.set(exotic, ["text"]),
    (value) => value === sentinel,
  );
  present = false;
  assert.throws(() => a.set(exotic, ["text"]), a.typeError);
});
