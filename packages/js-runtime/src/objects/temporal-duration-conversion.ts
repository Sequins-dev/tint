import {
  createDuration,
  parseDuration,
  durationFields,
  type Duration,
} from "@tint/foundation/chrono/temporal-duration";
import { numberValue } from "./coercion.ts";
import { exoticSlots, getProperty, type ObjectHooks } from "./operations.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { viewObjectValue } from "./values.ts";
import type { ScriptPropertyKey } from "./symbols.ts";

/** Duration fields require integral numbers rather than truncating as date fields do. */
export function durationInteger(
  argument: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): number {
  const result = numberValue(argument, hooks, realm);
  if (result.error === "unsupported") return rejectUnsupportedExecution(realm);
  if (result.error !== "none") throw createRuntimeError(realm, "type");
  if (
    !Number.isFinite(result.value) ||
    Math.trunc(result.value) !== result.value
  )
    throw createRuntimeError(realm, "range");
  return result.value === 0 ? 0 : result.value;
}
/** ToTemporalDuration reads and converts duration-like properties in lexicographic order. */
export function durationFrom(
  item: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): Duration {
  const object = viewObjectValue(item, realm.objectPrototype);
  if (object === undefined) {
    if (typeof item !== "string") throw createRuntimeError(realm, "type");
    const result = parseDuration(item);
    if (result === undefined) throw createRuntimeError(realm, "range");
    return result;
  }
  const branded = exoticSlots(object).internalTemporalDuration;
  if (branded !== undefined) return branded;
  return durationWith(undefined, item, realm, hooks);
}
/** A partial record always reads named fields, even when the argument has Duration slots. */
export function durationWith(
  base: Duration | undefined,
  item: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): Duration {
  const object = viewObjectValue(item, realm.objectPrototype);
  if (object === undefined) throw createRuntimeError(realm, "type");
  const fields: number[] =
    base === undefined ? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] : durationFields(base);
  const indices = [3, 4, 8, 7, 5, 1, 9, 6, 2, 0];
  const names = [
    "days",
    "hours",
    "microseconds",
    "milliseconds",
    "minutes",
    "months",
    "nanoseconds",
    "seconds",
    "weeks",
    "years",
  ];
  let present = false;
  for (let i = 0; i < names.length; i++) {
    const name = names[i],
      index = indices[i];
    if (name === undefined || index === undefined)
      throw "DURATION_FIELD_INVARIANT";
    const value = getProperty<ScriptPropertyKey, unknown>(
      object,
      name,
      item,
      hooks,
    );
    if (value !== undefined) {
      present = true;
      fields[index] = durationInteger(value, realm, hooks);
    }
  }
  if (!present) throw createRuntimeError(realm, "type");
  const data = createDuration(fields);
  if (data === undefined) throw createRuntimeError(realm, "range");
  return data;
}
