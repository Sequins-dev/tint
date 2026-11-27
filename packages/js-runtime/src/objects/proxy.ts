import { createArrayFromList } from "./array-like.ts";
import { callObject, constructObject } from "./call.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import {
  builtinFunctionMetadata,
  builtinFunction,
  builtinProperty,
} from "./intrinsics.ts";
import {
  ensureExoticSlots,
  exoticSlots,
  createObject,
  createExoticObject,
  createConstructorObject,
  createDataProperty,
  getProperty,
  setProperty,
  hasProperty,
  deleteProperty,
  getOwnProperty,
  getPrototype,
  setPrototype,
  isExtensible,
  preventExtensions,
  type ObjectInternalMethods,
  type ObjectCall,
  type ObjectConstruct,
  type OrdinaryObject,
  type ObjectHooks,
  type ProxyState,
} from "./operations.ts";
import { proxyAccess, proxyRealm } from "./proxy-state.ts";
import {
  proxyGetOwnProperty,
  proxyDefineProperty,
} from "./proxy-descriptors.ts";
import { proxyOwnKeys } from "./proxy-keys.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import { scriptBoolean, viewObjectValue } from "./values.ts";

export function createProxy(
  targetValue: unknown,
  handlerValue: unknown,
  creationRealm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const realm = proxyRealm(creationRealm);
  const target = viewObjectValue(targetValue, realm.objectPrototype),
    handler = viewObjectValue(handlerValue, realm.objectPrototype);
  if (target === undefined || handler === undefined)
    throw createRuntimeError(realm, "type");
  const state: ProxyState<ScriptPropertyKey, unknown> = { target, handler };
  const methods: ObjectInternalMethods<ScriptPropertyKey, unknown> = {
    get: (object, key, receiver, ignored): unknown => {
      const realm = proxyRealm(creationRealm);
      const access = proxyAccess(state, "get", realm, hooks);
      if (access.trap === undefined)
        return getProperty<ScriptPropertyKey, unknown>(
          access.target,
          key,
          receiver,
          hooks,
        );
      const result = hooks.call(access.trap, access.handler, [
        access.target,
        key,
        receiver,
      ]);
      const descriptor = getOwnProperty<ScriptPropertyKey, unknown>(
        access.target,
        key,
      );
      if (descriptor !== undefined && !descriptor.configurable) {
        if (
          !descriptor.accessor &&
          !descriptor.writable &&
          !hooks.sameValue(result, descriptor.value)
        )
          throw createRuntimeError(realm, "type");
        if (
          descriptor.accessor &&
          descriptor.get === undefined &&
          result !== undefined
        )
          throw createRuntimeError(realm, "type");
      }
      return result;
    },
    set: (object, key, value, receiver, ignored): boolean => {
      const realm = proxyRealm(creationRealm);
      const access = proxyAccess(state, "set", realm, hooks);
      if (access.trap === undefined)
        return setProperty<ScriptPropertyKey, unknown>(
          access.target,
          key,
          value,
          receiver,
          hooks,
        );
      if (
        !scriptBoolean(
          hooks.call(access.trap, access.handler, [
            access.target,
            key,
            value,
            receiver.value,
          ]),
          realm.objectPrototype,
        )
      )
        return false;
      const descriptor = getOwnProperty<ScriptPropertyKey, unknown>(
        access.target,
        key,
      );
      if (descriptor !== undefined && !descriptor.configurable) {
        if (
          !descriptor.accessor &&
          !descriptor.writable &&
          !hooks.sameValue(value, descriptor.value)
        )
          throw createRuntimeError(realm, "type");
        if (descriptor.accessor && descriptor.set === undefined)
          throw createRuntimeError(realm, "type");
      }
      return true;
    },
    hasProperty: (object, key): boolean => {
      const realm = proxyRealm(creationRealm);
      const access = proxyAccess(state, "has", realm, hooks);
      if (access.trap === undefined)
        return hasProperty<ScriptPropertyKey, unknown>(access.target, key);
      const result = scriptBoolean(
        hooks.call(access.trap, access.handler, [access.target, key]),
        realm.objectPrototype,
      );
      if (!result) {
        const descriptor = getOwnProperty<ScriptPropertyKey, unknown>(
          access.target,
          key,
        );
        if (
          descriptor !== undefined &&
          (!descriptor.configurable ||
            !isExtensible<ScriptPropertyKey, unknown>(access.target))
        )
          throw createRuntimeError(realm, "type");
      }
      return result;
    },
    deleteProperty: (object, key): boolean => {
      const realm = proxyRealm(creationRealm);
      const access = proxyAccess(state, "deleteProperty", realm, hooks);
      if (access.trap === undefined)
        return deleteProperty<ScriptPropertyKey, unknown>(access.target, key);
      if (
        !scriptBoolean(
          hooks.call(access.trap, access.handler, [access.target, key]),
          realm.objectPrototype,
        )
      )
        return false;
      const descriptor = getOwnProperty<ScriptPropertyKey, unknown>(
        access.target,
        key,
      );
      if (descriptor === undefined) return true;
      if (
        !descriptor.configurable ||
        !isExtensible<ScriptPropertyKey, unknown>(access.target)
      )
        throw createRuntimeError(realm, "type");
      return true;
    },
    getOwnProperty: (object, key) => {
      const realm = proxyRealm(creationRealm);
      return proxyGetOwnProperty(
        proxyAccess(state, "getOwnPropertyDescriptor", realm, hooks),
        key,
        realm,
        hooks,
      );
    },
    defineOwnProperty: (object, key, update, ignored) => {
      const realm = proxyRealm(creationRealm);
      return proxyDefineProperty(
        proxyAccess(state, "defineProperty", realm, hooks),
        key,
        update,
        realm,
        hooks,
      );
    },
    ownKeys: (object): ScriptPropertyKey[] => {
      const realm = proxyRealm(creationRealm);
      return proxyOwnKeys(
        proxyAccess(state, "ownKeys", realm, hooks),
        realm,
        hooks,
      );
    },
    getPrototype: (object) => {
      const realm = proxyRealm(creationRealm);
      const access = proxyAccess(state, "getPrototypeOf", realm, hooks);
      if (access.trap === undefined)
        return getPrototype<ScriptPropertyKey, unknown>(access.target);
      const value = hooks.call(access.trap, access.handler, [access.target]);
      const prototype = viewObjectValue(value, realm.objectPrototype);
      if (value !== null && prototype === undefined)
        throw createRuntimeError(realm, "type");
      if (
        !isExtensible<ScriptPropertyKey, unknown>(access.target) &&
        getPrototype<ScriptPropertyKey, unknown>(access.target) !== prototype
      )
        throw createRuntimeError(realm, "type");
      return prototype;
    },
    setPrototype: (object, prototype): boolean => {
      const realm = proxyRealm(creationRealm);
      const access = proxyAccess(state, "setPrototypeOf", realm, hooks);
      if (access.trap === undefined)
        return setPrototype<ScriptPropertyKey, unknown>(
          access.target,
          prototype,
        );
      if (
        !scriptBoolean(
          hooks.call(access.trap, access.handler, [
            access.target,
            prototype === undefined ? null : prototype,
          ]),
          realm.objectPrototype,
        )
      )
        return false;
      if (
        !isExtensible<ScriptPropertyKey, unknown>(access.target) &&
        getPrototype<ScriptPropertyKey, unknown>(access.target) !== prototype
      )
        throw createRuntimeError(realm, "type");
      return true;
    },
    isExtensible: (object): boolean => {
      const realm = proxyRealm(creationRealm);
      const access = proxyAccess(state, "isExtensible", realm, hooks);
      if (access.trap === undefined)
        return isExtensible<ScriptPropertyKey, unknown>(access.target);
      const result = scriptBoolean(
        hooks.call(access.trap, access.handler, [access.target]),
        realm.objectPrototype,
      );
      if (isExtensible<ScriptPropertyKey, unknown>(access.target) !== result)
        throw createRuntimeError(realm, "type");
      return result;
    },
    preventExtensions: (object): boolean => {
      const realm = proxyRealm(creationRealm);
      const access = proxyAccess(state, "preventExtensions", realm, hooks);
      if (access.trap === undefined)
        return preventExtensions<ScriptPropertyKey, unknown>(access.target);
      const result = scriptBoolean(
        hooks.call(access.trap, access.handler, [access.target]),
        realm.objectPrototype,
      );
      if (result && isExtensible<ScriptPropertyKey, unknown>(access.target))
        throw createRuntimeError(realm, "type");
      return result;
    },
  };
  const invoke: ObjectCall<unknown> | undefined =
    target.internalRareSlots?.internalCall === undefined
      ? undefined
      : (receiver, args): unknown => {
          const realm = proxyRealm(creationRealm);
          const access = proxyAccess(state, "apply", realm, hooks);
          if (access.trap === undefined) {
            const result = callObject<ScriptPropertyKey, unknown>(
              access.target,
              receiver,
              args,
              undefined,
            );
            if (result.error !== "none")
              throw createRuntimeError(realm, "type");
            return result.value;
          }
          const list = createArrayFromList(
            args,
            0,
            realm.arrayPrototype,
            realm,
            hooks,
          );
          return hooks.call(access.trap, access.handler, [
            access.target,
            receiver,
            list,
          ]);
        };
  const construct: ObjectConstruct<unknown> | undefined =
    target.internalRareSlots?.internalConstruct === undefined
      ? undefined
      : (args, newTarget): unknown => {
          const realm = proxyRealm(creationRealm);
          const access = proxyAccess(state, "construct", realm, hooks);
          if (access.trap === undefined) {
            const result = constructObject<ScriptPropertyKey, unknown>(
              access.target,
              args,
              {
                object: viewObjectValue(newTarget, realm.objectPrototype),
                value: newTarget,
              },
              undefined,
            );
            if (result.error !== "none")
              throw createRuntimeError(realm, "type");
            return result.value;
          }
          const list = createArrayFromList(
            args,
            0,
            realm.arrayPrototype,
            realm,
            hooks,
          );
          const result = hooks.call(access.trap, access.handler, [
            access.target,
            list,
            newTarget,
          ]);
          if (viewObjectValue(result, realm.objectPrototype) === undefined)
            throw createRuntimeError(realm, "type");
          return result;
        };
  const proxy = createExoticObject<ScriptPropertyKey, unknown>(
    undefined,
    methods,
    invoke,
    construct,
  );
  ensureExoticSlots(proxy).internalProxyData = state;
  return proxy;
}
export function installProxyIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, target): unknown => createProxy(args[0], args[1], realm, hooks),
  );
  builtinFunctionMetadata(constructor, "Proxy", 2, hooks);
  const revocable = builtinFunction(
    realm.functionPrototype,
    "revocable",
    2,
    (receiver, args): unknown => {
      const proxy = createProxy(args[0], args[1], realm, hooks);
      const state = exoticSlots(proxy).internalProxyData;
      if (state === undefined) throw "PROXY_STATE_INVARIANT";
      const revoke = builtinFunction(
        realm.functionPrototype,
        "",
        0,
        (receiver, args): unknown => {
          state.target = undefined;
          state.handler = undefined;
          return undefined;
        },
        hooks,
      );
      const result = createObject<ScriptPropertyKey, unknown>(
        realm.objectPrototype,
      );
      createDataProperty<ScriptPropertyKey, unknown>(
        result,
        "proxy",
        proxy,
        hooks,
      );
      createDataProperty<ScriptPropertyKey, unknown>(
        result,
        "revoke",
        revoke,
        hooks,
      );
      return result;
    },
    hooks,
  );
  builtinProperty(constructor, "revocable", revocable, true, true, hooks);
  builtinProperty(global, "Proxy", constructor, true, true, hooks);
}
