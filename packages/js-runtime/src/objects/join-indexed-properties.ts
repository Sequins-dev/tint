import {
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { getObjectValueProperty, viewObjectValue } from "./values.ts";
import { isCallableObject } from "./call.ts";
import { stringValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
function text(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  const result = stringValue(value, hooks, realm);
  if (result.error === "unsupported") return rejectUnsupportedExecution(realm);
  if (result.error !== "none") throw createRuntimeError(realm, "type");
  return result.value;
}
// Shared indexed joining preserves one length snapshot, ordinary Get (including
// holes/inheritance), and conversion immediately after each element's call.
export function joinIndexedProperties(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  length: number,
  separator: string,
  methodName: string | undefined,
  methodArgs: readonly unknown[],
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): string {
  let result = "";
  for (let index = 0; index < length; index++) {
    if (index > 0) result += separator;
    const element = getProperty<ScriptPropertyKey, unknown>(
      object,
      String(index),
      object,
      hooks,
    );
    if (element === undefined || element === null) continue;
    if (methodName === undefined) result += text(element, realm, hooks);
    else {
      const method = getObjectValueProperty(element, methodName, hooks, realm);
      if (method.error === "unsupported")
        return rejectUnsupportedExecution(realm);
      if (method.error !== "none") throw createRuntimeError(realm, "type");
      const callable = viewObjectValue(method.value, realm.objectPrototype);
      if (!isCallableObject<ScriptPropertyKey, unknown>(callable))
        throw createRuntimeError(realm, "type");
      result += text(
        hooks.call(method.value, element, methodArgs),
        realm,
        hooks,
      );
    }
  }
  return result;
}
