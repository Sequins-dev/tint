import { parseISODateTime } from "@tint/foundation/chrono/iso-date-time";
import { primitiveValue } from "./coercion.ts";
import { createBigIntValue, type BigIntValue } from "./bigints.ts";
import { temporalDateTimeEpoch } from "./temporal-epoch.ts";
import { viewObjectValue } from "./values.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import type { ObjectHooks } from "./operations.ts";
function parseInstantString(value: unknown, realm: ErrorRealm): BigIntValue {
  if (typeof value !== "string") throw createRuntimeError(realm, "type");
  const parsed = parseISODateTime(value),
    data = parsed.value;
  if (
    parsed.error !== "none" ||
    data === undefined ||
    !data.hasTime ||
    (!data.utc && data.offsetNanoseconds === undefined)
  )
    throw createRuntimeError(realm, "range");
  const epoch = temporalDateTimeEpoch(
    data,
    data.utc ? 0 : (data.offsetNanoseconds ?? 0),
  );
  if (epoch === undefined) throw createRuntimeError(realm, "range");
  return createBigIntValue(epoch);
}
export function instantFrom(
  item: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): BigIntValue {
  const object = viewObjectValue(item, realm.objectPrototype);
  if (object !== undefined) {
    const epoch = object.internalTemporalInstant;
    if (epoch !== undefined) return epoch;
    const zoned = object.internalTemporalZonedDateTime;
    if (zoned !== undefined) return zoned.epoch;
    const primitive = primitiveValue(item, "string", hooks, realm);
    if (primitive.error === "unsupported")
      return rejectUnsupportedExecution(realm);
    if (primitive.error !== "none") throw createRuntimeError(realm, "type");
    return parseInstantString(primitive.value, realm);
  }
  return parseInstantString(item, realm);
}
