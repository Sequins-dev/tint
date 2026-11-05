import { test } from "node:test";
import assert from "node:assert/strict";
import type * as Objects from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
bindHostRecordViews();
const objects = await import("../src/objects/index.ts");
type Key = Objects.ScriptPropertyKey;
type ObjectValue = Objects.OrdinaryObject<Key, unknown>;

/** A realm with the intrinsics that Proxy, Reflect and their callers need. */
function createRealmHost(parent?: Objects.ErrorRealm) {
  const prototype = objects.createObject<Key, unknown>(undefined);
  const global = objects.createObject<Key, unknown>(prototype);
  const hooks: Objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: (callee, receiver, args) => {
      const result = objects.callObjectValue(callee, receiver, args, global);
      if (result.error !== "none") throw "INVALID_TEST_HOOK_CALL";
      return result.value;
    },
  };
  const realm =
    parent === undefined
      ? objects.createErrorRealm(prototype, hooks)
      : objects.createErrorRealm(
          prototype,
          hooks,
          parent.symbolRegistry,
          parent.agent,
        );
  objects.installErrorIntrinsics(global, realm, hooks);
  objects.installArrayIntrinsics(global, realm, hooks);
  objects.installObjectIntrinsics(global, realm, hooks);
  objects.installFunctionIntrinsics(global, realm, hooks);
  objects.installPrimitiveIntrinsics(global, realm, hooks);
  objects.installSymbolIntrinsics(global, realm, hooks);
  objects.installRegExpIntrinsics(global, realm, hooks);
  objects.installProxyIntrinsics(global, realm, hooks);
  objects.installReflectIntrinsics(global, realm, hooks);
  const intrinsic = (name: string): ObjectValue =>
    objects.getOwnProperty(global, name)!.value as ObjectValue;
  const method = (owner: string, name: string) => {
    const object = intrinsic(owner);
    const callee = objects.getOwnProperty(object, name)!.value;
    return (...args: unknown[]): unknown => {
      const result = objects.callObjectValue(callee, object, args, global);
      assert.equal(result.error, "none");
      return result.value;
    };
  };
  const proxy = (target: unknown, handler: unknown): ObjectValue => {
    const constructor = intrinsic("Proxy");
    const result = objects.constructObject<Key, unknown>(
      constructor,
      [target, handler],
      { object: constructor, value: constructor },
      undefined,
    );
    assert.equal(result.error, "none");
    return result.value as ObjectValue;
  };
  const object = (): ObjectValue =>
    objects.createObject<Key, unknown>(realm.objectPrototype);
  const constructor = (): ObjectValue =>
    objects.createConstructorObject<Key, unknown>(
      realm.functionPrototype,
      () => undefined,
      (args, newTarget) =>
        objects.createObject<Key, unknown>(
          objects.constructorPrototype(newTarget, "object", realm, hooks),
        ),
    );
  const typeError = (error: unknown): boolean =>
    (error as ObjectValue).prototype === realm.prototypes.get("type");
  return {
    realm,
    hooks,
    global,
    intrinsic,
    method,
    proxy,
    object,
    constructor,
    typeError,
  };
}
function createRealms(count: number) {
  const main = createRealmHost();
  const others = Array.from({ length: count }, () =>
    createRealmHost(main.realm),
  );
  return { main, others };
}

test("GetFunctionRealm follows nested cross-realm Proxy newTargets without traps", () => {
  // built-ins/Proxy/get-fn-realm.js and get-fn-realm-recursive.js without
  // dynamic Function construction.
  const {
    main,
    others: [first, second, third],
  } = createRealms(3);
  main.realm.executionContext.run(() => {
    const newTarget = first!.constructor();
    objects.createDataProperty(newTarget, "prototype", false, main.hooks);
    let traps = 0;
    const counting = main.object();
    objects.createDataProperty(
      counting,
      "getPrototypeOf",
      objects.createCallableObject<Key, unknown>(
        main.realm.functionPrototype,
        () => {
          traps++;
          return null;
        },
      ),
      main.hooks,
    );
    for (const proxy of [
      second!.proxy(newTarget, second!.object()),
      second!.proxy(third!.proxy(newTarget, counting), main.object()),
    ]) {
      const array = main.method("Reflect", "construct")(
        third!.intrinsic("Array"),
        main.method("Array", "of")(),
        proxy,
      ) as ObjectValue;
      assert.equal(array.prototype, first!.realm.arrayPrototype);
    }
    assert.equal(traps, 0);
  });
});

test("Proxy call and construct argument arrays use the caller's realm", () => {
  // built-ins/Proxy/{apply,construct}/arguments-realm.js: CreateArrayFromList
  // runs in the current Realm, not the Proxy's or the trap's creation realm.
  const {
    main,
    others: [other],
  } = createRealms(1);
  const handler = other!.object();
  const target = objects.createConstructorObject<Key, unknown>(
    other!.realm.functionPrototype,
    () => undefined,
    () => other!.object(),
  );
  const apply = objects.createCallableObject<Key, unknown>(
    other!.realm.functionPrototype,
    (receiver, args) => args[2],
  );
  const construct = objects.createCallableObject<Key, unknown>(
    other!.realm.functionPrototype,
    (receiver, args) => args[1],
  );
  objects.createDataProperty(handler, "apply", apply, main.hooks);
  objects.createDataProperty(handler, "construct", construct, main.hooks);
  const proxy = other!.realm.executionContext.run(() =>
    other!.proxy(target, handler),
  ) as ObjectValue;
  main.realm.executionContext.run(() => {
    const called = objects.callObjectValue(
      proxy,
      undefined,
      [1, 2],
      main.global,
    );
    assert.equal(called.error, "none");
    assert.equal(
      (called.value as ObjectValue).prototype,
      main.realm.arrayPrototype,
    );
    const constructed = objects.constructObject<Key, unknown>(
      proxy,
      [3],
      { object: proxy, value: proxy },
      undefined,
    );
    assert.equal(constructed.error, "none");
    assert.equal(
      (constructed.value as ObjectValue).prototype,
      main.realm.arrayPrototype,
    );
  });
});

test("Proxy construct without a trap selects fallback prototypes from newTarget's realm", () => {
  // built-ins/Proxy/construct/trap-is-undefined-proto-from-newtarget-realm.js
  const {
    main,
    others: [other],
  } = createRealms(1);
  main.realm.executionContext.run(() => {
    const newTarget = other!.constructor();
    objects.createDataProperty(newTarget, "prototype", null, main.hooks);
    const proxy = main.proxy(main.constructor(), main.object());
    const value = main.method("Reflect", "construct")(
      proxy,
      main.method("Array", "of")(),
      newTarget,
    ) as ObjectValue;
    assert.equal(value.prototype, other!.realm.objectPrototype);
    // A cross-realm Proxy newTarget with a primitive prototype follows the
    // Proxy target's realm, not the Proxy constructor's realm.
    const forwarded = other!.proxy(newTarget, other!.object());
    const nested = main.method("Reflect", "construct")(
      proxy,
      main.method("Array", "of")(),
      forwarded,
    ) as ObjectValue;
    assert.equal(nested.prototype, other!.realm.objectPrototype);
  });
});

test("revoked Proxy newTargets and targets throw TypeError from the active realm", () => {
  const {
    main,
    others: [other],
  } = createRealms(1);
  main.realm.executionContext.run(() => {
    const revocable = other!.method("Proxy", "revocable")(
      main.constructor(),
      main.object(),
    ) as ObjectValue;
    const revoked = objects.getOwnProperty(revocable, "proxy")!.value;
    objects.callObjectValue(
      objects.getOwnProperty(revocable, "revoke")!.value,
      revocable,
      [],
      main.global,
    );
    // IsConstructor still holds after revocation; the abrupt completion comes
    // from Get(newTarget, "prototype") inside the Array constructor's realm.
    assert.throws(
      () =>
        main.method("Reflect", "construct")(
          main.intrinsic("Array"),
          main.method("Array", "of")(),
          revoked,
        ),
      main.typeError,
    );
    // Proxy internal methods throw in the caller's realm, not the realm that
    // created the revoked Proxy.
    assert.throws(
      () => objects.hasProperty(revoked as ObjectValue, "x"),
      main.typeError,
    );
    // Reflect's own realm is the active realm while its algorithm runs.
    assert.throws(
      () => other!.method("Reflect", "has")(revoked, "x"),
      other!.typeError,
    );
  });
});

test("HasProperty forwards through nested trapless proxies and prototype chains", () => {
  // built-ins/Proxy/has/trap-is-missing-target-is-proxy.js
  const { main } = createRealms(0);
  main.realm.executionContext.run(() => {
    const regexp = main.intrinsic("RegExp");
    const pattern = objects.constructObject<Key, unknown>(
      regexp,
      ["(?:)", "m"],
      { object: regexp, value: regexp },
      undefined,
    ).value;
    const proxy = main.proxy(main.proxy(pattern, main.object()), main.object());
    assert.equal(main.method("Reflect", "has")(proxy, "ignoreCase"), true);
    assert.equal(
      objects.hasProperty(
        proxy,
        objects.wellKnownSymbol(main.realm.symbolRegistry, "replace"),
      ),
      true,
    );
    assert.equal(
      objects.hasProperty(
        objects.createObject<Key, unknown>(proxy),
        "lastIndex",
      ),
      true,
    );
    assert.equal(
      objects.hasProperty(objects.createObject<Key, unknown>(proxy), "missing"),
      false,
    );
  });
});
