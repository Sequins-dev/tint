import {
  applyDescriptor,
  type Descriptor,
  type DescriptorUpdate,
} from "../descriptors/index.ts";
import { isCallableObject } from "./call.ts";
import {
  toPropertyDescriptor,
  fromPropertyDescriptorUpdate,
  type DescriptorKeys,
} from "./descriptors.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import {
  getOwnProperty,
  defineOwnProperty,
  isExtensible,
  type ObjectHooks,
  type PropertyDefinitionResult,
} from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import { scriptBoolean, viewObjectValue } from "./values.ts";
import type { ProxyAccess } from "./proxy-state.ts";
const keys: DescriptorKeys<ScriptPropertyKey> = {
  value: "value",
  writable: "writable",
  get: "get",
  set: "set",
  enumerable: "enumerable",
  configurable: "configurable",
};
export function proxyGetOwnProperty(
  access: ProxyAccess,
  key: ScriptPropertyKey,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): Descriptor<unknown> | undefined {
  const target = access.target;
  if (access.trap === undefined)
    return getOwnProperty<ScriptPropertyKey, unknown>(target, key);
  const value = hooks.call(access.trap, access.handler, [target, key]);
  const object = viewObjectValue(value, realm.objectPrototype);
  if (value !== undefined && object === undefined)
    throw createRuntimeError(realm, "type");
  const existing = getOwnProperty<ScriptPropertyKey, unknown>(target, key);
  if (value === undefined) {
    if (existing === undefined) return undefined;
    if (
      !existing.configurable ||
      !isExtensible<ScriptPropertyKey, unknown>(target)
    )
      throw createRuntimeError(realm, "type");
    return undefined;
  }
  const extensible = isExtensible<ScriptPropertyKey, unknown>(target);
  if (object === undefined) throw "PROXY_DESCRIPTOR_OBJECT_INVARIANT";
  const converted = toPropertyDescriptor<ScriptPropertyKey, unknown>(
    object,
    value,
    keys,
    hooks,
    (value): boolean => scriptBoolean(value, realm.objectPrototype),
    (value): boolean =>
      isCallableObject<ScriptPropertyKey, unknown>(
        viewObjectValue(value, realm.objectPrototype),
      ),
  );
  if (converted.error !== "none") throw createRuntimeError(realm, "type");
  const complete = applyDescriptor<unknown>(
    undefined,
    true,
    converted.update,
    undefined,
    hooks.sameValue,
  ).descriptor;
  if (complete === undefined) throw "PROXY_DESCRIPTOR_COMPLETE_INVARIANT";
  const update: DescriptorUpdate<unknown> = {
    fields: complete.accessor ? 60 : 51,
    value: complete.value,
    writable: complete.writable,
    get: complete.get,
    set: complete.set,
    enumerable: complete.enumerable,
    configurable: complete.configurable,
  };
  if (
    applyDescriptor<unknown>(
      existing,
      extensible,
      update,
      undefined,
      hooks.sameValue,
    ).status !== "accepted"
  )
    throw createRuntimeError(realm, "type");
  if (!complete.configurable) {
    if (existing === undefined || existing.configurable)
      throw createRuntimeError(realm, "type");
    if (
      !complete.accessor &&
      !complete.writable &&
      !existing.accessor &&
      existing.writable
    )
      throw createRuntimeError(realm, "type");
  }
  return complete;
}
export function proxyDefineProperty(
  access: ProxyAccess,
  key: ScriptPropertyKey,
  update: DescriptorUpdate<unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): PropertyDefinitionResult {
  const target = access.target;
  if (access.trap === undefined)
    return defineOwnProperty<ScriptPropertyKey, unknown>(
      target,
      key,
      update,
      hooks,
    );
  const descriptor = fromPropertyDescriptorUpdate<ScriptPropertyKey, unknown>(
    update,
    realm.objectPrototype,
    keys,
    hooks,
    (value): unknown => value,
  );
  if (
    !scriptBoolean(
      hooks.call(access.trap, access.handler, [target, key, descriptor]),
      realm.objectPrototype,
    )
  )
    return "rejected";
  const existing = getOwnProperty<ScriptPropertyKey, unknown>(target, key);
  const extensible = isExtensible<ScriptPropertyKey, unknown>(target);
  const fixed = (update.fields & 32) !== 0 && !update.configurable;
  if (existing === undefined) {
    if (!extensible || fixed) throw createRuntimeError(realm, "type");
  } else {
    if (
      applyDescriptor<unknown>(
        existing,
        extensible,
        update,
        undefined,
        hooks.sameValue,
      ).status !== "accepted" ||
      (fixed && existing.configurable)
    )
      throw createRuntimeError(realm, "type");
    if (
      !existing.configurable &&
      !existing.accessor &&
      existing.writable &&
      (update.fields & 2) !== 0 &&
      !update.writable
    )
      throw createRuntimeError(realm, "type");
  }
  return "accepted";
}
