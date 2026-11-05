import { getIteratorFromMethod } from "../iterators/index.ts";
import { type ObjectHooks } from "./operations.ts";
import { viewObjectValue, getObjectValueProperty } from "./values.ts";
import { isCallableObject } from "./call.ts";
import { numberValue } from "./coercion.ts";
import { createScriptIteratorHooks, type ScriptIterator } from "./iteration.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { type ScriptPropertyKey } from "./symbols.ts";

export interface ScriptSetRecord {
  readonly object: unknown;
  readonly size: number;
  readonly has: unknown;
  readonly keys: unknown;
}
/** Capture the observable set-like contract once, in specification order. */
export function getScriptSetRecord(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): ScriptSetRecord {
  if (!createScriptIteratorHooks(realm, hooks).isObject(value))
    throw createRuntimeError(realm, "type");
  const raw = readSetProperty(value, "size", realm, hooks);
  const converted = numberValue(raw, hooks, realm);
  if (converted.error === "unsupported")
    return rejectUnsupportedExecution(realm);
  if (converted.error !== "none" || converted.value !== converted.value)
    throw createRuntimeError(realm, "type");
  const size = Math.trunc(converted.value);
  if (size < 0) throw createRuntimeError(realm, "range");
  const has = readSetProperty(value, "has", realm, hooks);
  if (
    !isCallableObject<ScriptPropertyKey, unknown>(
      viewObjectValue(has, realm.objectPrototype),
    )
  )
    throw createRuntimeError(realm, "type");
  const keys = readSetProperty(value, "keys", realm, hooks);
  if (
    !isCallableObject<ScriptPropertyKey, unknown>(
      viewObjectValue(keys, realm.objectPrototype),
    )
  )
    throw createRuntimeError(realm, "type");
  return { object: value, size, has, keys };
}
function readSetProperty(
  value: unknown,
  key: string,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  const result = getObjectValueProperty(value, key, hooks, realm);
  if (result.error === "unsupported") return rejectUnsupportedExecution(realm);
  if (result.error !== "none") throw createRuntimeError(realm, "type");
  return result.value;
}
export function getScriptSetKeys(
  record: ScriptSetRecord,
  realm: ErrorRealm,
  objectHooks: ObjectHooks<unknown>,
): ScriptIterator {
  const hooks = createScriptIteratorHooks(realm, objectHooks);
  return {
    record: getIteratorFromMethod<unknown>(record.object, record.keys, hooks),
    hooks,
  };
}
