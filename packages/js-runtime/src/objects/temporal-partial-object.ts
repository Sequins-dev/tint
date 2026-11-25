import {
  exoticSlots,
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { viewObjectValue } from "./values.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
/** IsPartialTemporalObject checks brands before either observable property access.
 * Proxy targets do not contribute slots, and Instant/Duration are not excluded. */
export function requirePartialTemporalObject(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const object = viewObjectValue(value, realm.objectPrototype);
  if (
    object === undefined ||
    exoticSlots(object).internalTemporalPlainDate !== undefined ||
    exoticSlots(object).internalTemporalPlainDateTime !== undefined ||
    exoticSlots(object).internalTemporalPlainMonthDay !== undefined ||
    exoticSlots(object).internalTemporalPlainTime !== undefined ||
    exoticSlots(object).internalTemporalPlainYearMonth !== undefined ||
    exoticSlots(object).internalTemporalZonedDateTime !== undefined
  )
    throw createRuntimeError(realm, "type");
  if (
    getProperty<ScriptPropertyKey, unknown>(
      object,
      "calendar",
      value,
      hooks,
    ) !== undefined
  )
    throw createRuntimeError(realm, "type");
  if (
    getProperty<ScriptPropertyKey, unknown>(
      object,
      "timeZone",
      value,
      hooks,
    ) !== undefined
  )
    throw createRuntimeError(realm, "type");
  return object;
}
