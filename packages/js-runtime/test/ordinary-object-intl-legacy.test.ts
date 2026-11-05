import { after, test } from "node:test";
import type {
  OrdinaryObject,
  ScriptPropertyKey,
  ObjectHooks,
} from "../src/objects/index.ts";
import assert from "node:assert/strict";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";

const hostViews = bindHostRecordViews();

after(() => hostViews.deregister());

const objects = await import("../src/objects/index.ts");
const legacy = await import("../src/objects/intl-legacy.ts");
type ObjectValue = OrdinaryObject<ScriptPropertyKey, unknown>;

function fixture() {
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call(callee, receiver, args) {
      const result = objects.callObjectValue(callee, receiver, args, root);
      assert.equal(result.error, "none");
      return result.value;
    },
  };
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(root, hooks);
  const prototype = objects.createObject<ScriptPropertyKey, unknown>(root);
  const constructor = objects.createConstructorObject<
    ScriptPropertyKey,
    unknown
  >(
    realm.functionPrototype,
    () => undefined,
    () => undefined,
  );
  assert.equal(
    objects.createDataProperty(constructor, "prototype", prototype, hooks),
    true,
  );
  const instance = objects.createObject<ScriptPropertyKey, unknown>(prototype);
  instance.internalErrorData = true;
  const branded = (object: ObjectValue): boolean => object.internalErrorData;
  const chain = (receiver: unknown) =>
    legacy.chainIntlLegacy(receiver, instance, constructor, realm, hooks);
  const unwrap = (receiver: unknown) =>
    legacy.unwrapIntlLegacy(receiver, constructor, branded, realm, hooks);
  return {
    hooks,
    realm,
    prototype,
    constructor,
    instance,
    branded,
    chain,
    unwrap,
  };
}

function typeError(
  f: () => unknown,
  context: ReturnType<typeof fixture>,
): void {
  assert.throws(
    f,
    (error) =>
      objects.viewObjectValue(error, context.realm.objectPrototype)
        ?.prototype === context.realm.prototypes.get("type"),
  );
}

test("legacy Intl chaining creates the immutable symbol property on eligible receivers", () => {
  const f = fixture();
  const receiver = objects.createObject<ScriptPropertyKey, unknown>(
    f.prototype,
  );
  assert.equal(f.chain(receiver), receiver);
  const descriptor = objects.getOwnProperty(
    receiver,
    f.realm.intlFallbackSymbol,
  );
  assert.ok(descriptor);
  assert.equal(descriptor.value, f.instance);
  assert.equal(descriptor.writable, false);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.configurable, false);
  assert.equal(f.unwrap(receiver), f.instance);
  const replacement = objects.createObject<ScriptPropertyKey, unknown>(
    f.prototype,
  );
  typeError(
    () =>
      legacy.chainIntlLegacy(
        receiver,
        replacement,
        f.constructor,
        f.realm,
        f.hooks,
      ),
    f,
  );
  const frozen = objects.createObject<ScriptPropertyKey, unknown>(f.prototype);
  objects.preventExtensions(frozen);
  typeError(() => f.chain(frozen), f);
});

test("legacy Intl receiver eligibility excludes primitives, the prototype and unrelated objects", () => {
  const f = fixture();
  for (const receiver of [
    undefined,
    null,
    1,
    "text",
    false,
    f.prototype,
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
  ])
    assert.equal(f.chain(receiver), f.instance);
  for (const receiver of [undefined, null, 1, "text", false])
    typeError(() => f.unwrap(receiver), f);
});

test("legacy Intl unwrap bypasses fallback access for directly branded objects", () => {
  const f = fixture();
  const sentinel = {};
  const getter = objects.createCallableObject<ScriptPropertyKey, unknown>(
    f.realm.functionPrototype,
    () => {
      throw sentinel;
    },
  );
  assert.equal(
    objects.createAccessorProperty(
      f.instance,
      f.realm.intlFallbackSymbol,
      getter,
      false,
      f.hooks,
    ),
    true,
  );
  assert.equal(f.unwrap(f.instance), f.instance);
  objects.setPrototype(f.instance, undefined);
  assert.equal(f.unwrap(f.instance), f.instance);
});

test("legacy Intl unwrap uses one observable inherited Get and leaves final brand validation to callers", () => {
  const f = fixture();
  const values: unknown[] = [f.instance, 42, undefined];
  for (const value of values) {
    let calls = 0;
    const parent = objects.createObject<ScriptPropertyKey, unknown>(
      f.prototype,
    );
    let receiver: ObjectValue;
    const getter = objects.createCallableObject<ScriptPropertyKey, unknown>(
      f.realm.functionPrototype,
      (actual) => {
        calls++;
        assert.equal(actual, receiver);
        return value;
      },
    );
    assert.equal(
      objects.createAccessorProperty(
        parent,
        f.realm.intlFallbackSymbol,
        getter,
        false,
        f.hooks,
      ),
      true,
    );
    receiver = objects.createObject<ScriptPropertyKey, unknown>(parent);
    assert.equal(f.unwrap(receiver), value);
    assert.equal(calls, 1);
  }
});

test("legacy Intl helpers bypass public hasInstance and preserve abrupt completion", () => {
  const f = fixture();
  const sentinel = {};
  const getter = objects.createCallableObject<ScriptPropertyKey, unknown>(
    f.realm.functionPrototype,
    () => {
      throw sentinel;
    },
  );
  assert.equal(
    objects.createAccessorProperty(
      f.constructor,
      objects.wellKnownSymbol(f.realm.symbolRegistry, "hasInstance"),
      getter,
      false,
      f.hooks,
    ),
    true,
  );
  const receiver = objects.createObject<ScriptPropertyKey, unknown>(
    f.prototype,
  );
  assert.equal(f.chain(receiver), receiver);
  assert.equal(f.unwrap(receiver), f.instance);
  const throwing = objects.createObject<ScriptPropertyKey, unknown>(
    f.prototype,
  );
  assert.equal(
    objects.createAccessorProperty(
      throwing,
      f.realm.intlFallbackSymbol,
      getter,
      false,
      f.hooks,
    ),
    true,
  );
  assert.throws(
    () => f.unwrap(throwing),
    (error) => error === sentinel,
  );
});

test("legacy Intl proxy unwrapping observes prototype lookup before its symbol Get", () => {
  const f = fixture();
  const events: string[] = [];
  const target = objects.createObject<ScriptPropertyKey, unknown>(f.prototype);
  const handler = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const getPrototype = objects.createCallableObject<ScriptPropertyKey, unknown>(
    f.realm.functionPrototype,
    () => {
      events.push("prototype");
      return f.prototype;
    },
  );
  let proxy: ObjectValue;
  const get = objects.createCallableObject<ScriptPropertyKey, unknown>(
    f.realm.functionPrototype,
    (receiver, args) => {
      assert.equal(args[0], target);
      assert.equal(args[1], f.realm.intlFallbackSymbol);
      assert.equal(args[2], proxy);
      events.push("symbol");
      return f.instance;
    },
  );
  assert.equal(
    objects.createDataProperty(
      handler,
      "getPrototypeOf",
      getPrototype,
      f.hooks,
    ),
    true,
  );
  assert.equal(objects.createDataProperty(handler, "get", get, f.hooks), true);
  proxy = objects.createProxy(target, handler, f.realm, f.hooks);
  assert.equal(f.unwrap(proxy), f.instance);
  assert.deepEqual(events, ["prototype", "symbol"]);
});

test("legacy Intl chaining preserves proxy definition rejection and thrown completion", () => {
  const f = fixture();
  const sentinel = {};
  for (const throws of [false, true]) {
    const target = objects.createObject<ScriptPropertyKey, unknown>(
      f.prototype,
    );
    const handler = objects.createObject<ScriptPropertyKey, unknown>(undefined);
    const define = objects.createCallableObject<ScriptPropertyKey, unknown>(
      f.realm.functionPrototype,
      (receiver, args) => {
        assert.equal(args[0], target);
        assert.equal(args[1], f.realm.intlFallbackSymbol);
        const descriptor = objects.viewObjectValue(
          args[2],
          f.realm.objectPrototype,
        );
        assert.ok(descriptor);
        for (const key of ["writable", "enumerable", "configurable"])
          assert.equal(
            objects.getProperty(descriptor, key, descriptor, f.hooks),
            false,
          );
        assert.equal(
          objects.getProperty(descriptor, "value", descriptor, f.hooks),
          f.instance,
        );
        if (throws) throw sentinel;
        return false;
      },
    );
    assert.equal(
      objects.createDataProperty(handler, "defineProperty", define, f.hooks),
      true,
    );
    const proxy = objects.createProxy(target, handler, f.realm, f.hooks);
    if (throws)
      assert.throws(
        () => f.chain(proxy),
        (error) => error === sentinel,
      );
    else typeError(() => f.chain(proxy), f);
  }
});

test("legacy Intl fallback keys are fresh even when realms share symbol registries", () => {
  const f = fixture();
  const foreign = objects.createErrorRealm(
    objects.createObject<ScriptPropertyKey, unknown>(undefined),
    f.hooks,
    f.realm.symbolRegistry,
    f.realm.agent,
  );
  assert.equal(
    f.realm.intlFallbackSymbol.description,
    "IntlLegacyConstructedSymbol",
  );
  assert.notEqual(f.realm.intlFallbackSymbol, foreign.intlFallbackSymbol);
});
