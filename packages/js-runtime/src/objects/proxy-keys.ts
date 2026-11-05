import { lengthOfArrayLike } from "./array-like.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import {
  getProperty,
  getOwnProperty,
  ownKeys,
  isExtensible,
  type ObjectHooks,
} from "./operations.ts";
import {
  scriptPropertyKeyOrder,
  viewSymbolValue,
  type ScriptPropertyKey,
} from "./symbols.ts";
import { viewObjectValue } from "./values.ts";
import type { ProxyAccess } from "./proxy-state.ts";
export function proxyOwnKeys(
  access: ProxyAccess,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): ScriptPropertyKey[] {
  const target = access.target;
  if (access.trap === undefined)
    return ownKeys<ScriptPropertyKey, unknown>(target, scriptPropertyKeyOrder);
  const value = hooks.call(access.trap, access.handler, [target]);
  const object = viewObjectValue(value, realm.objectPrototype);
  if (object === undefined) throw createRuntimeError(realm, "type");
  const length = lengthOfArrayLike(object, realm, hooks),
    result: ScriptPropertyKey[] = [];
  const remaining = new Set<ScriptPropertyKey>();
  for (let index = 0; index < length; index++) {
    const item = getProperty<ScriptPropertyKey, unknown>(
      object,
      String(index),
      value,
      hooks,
    );
    const symbol = viewSymbolValue(item);
    if (typeof item !== "string" && symbol === undefined)
      throw createRuntimeError(realm, "type");
    const key = typeof item === "string" ? item : symbol;
    if (key === undefined) throw "PROXY_KEY_INVARIANT";
    result.push(key);
  }
  // Duplicate validation follows complete list conversion, so later getters
  // still run before an earlier duplicate is rejected.
  for (const key of result) {
    if (key === undefined) throw "PROXY_KEY_INVARIANT";
    if (remaining.has(key)) throw createRuntimeError(realm, "type");
    remaining.add(key);
  }
  const extensible = isExtensible<ScriptPropertyKey, unknown>(target);
  const targetKeys = ownKeys<ScriptPropertyKey, unknown>(
    target,
    scriptPropertyKeyOrder,
  );
  const configurable: ScriptPropertyKey[] = [],
    fixed: ScriptPropertyKey[] = [];
  for (const key of targetKeys) {
    if (key === undefined) throw "PROXY_KEY_INVARIANT";
    const descriptor = getOwnProperty<ScriptPropertyKey, unknown>(target, key);
    if (descriptor !== undefined && !descriptor.configurable) {
      fixed.push(key);
    } else configurable.push(key);
  }
  for (const key of fixed) {
    if (key === undefined) throw "PROXY_KEY_INVARIANT";
    if (!remaining.delete(key)) throw createRuntimeError(realm, "type");
  }
  if (extensible) return result;
  for (const key of configurable) {
    if (key === undefined) throw "PROXY_KEY_INVARIANT";
    if (!remaining.delete(key)) throw createRuntimeError(realm, "type");
  }
  if (remaining.size !== 0) throw createRuntimeError(realm, "type");
  return result;
}
