import { getProperty, type ObjectHooks } from "./operations.ts";
import { viewObjectValue } from "./values.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import type { ScriptPropertyKey } from "./symbols.ts";

/** Optional options objects are validated before the single observable property read. */
export function optionValue(
  options: unknown,
  name: string,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  if (options === undefined) return undefined;
  const object = viewObjectValue(options, realm.objectPrototype);
  if (object === undefined) throw createRuntimeError(realm, "type");
  return getProperty<ScriptPropertyKey, unknown>(object, name, options, hooks);
}
