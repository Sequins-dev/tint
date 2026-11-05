import {
  parseISOTimeString,
  type ISOTime,
} from "@tint/foundation/chrono/iso-date-time";
import { requirePartialTemporalObject } from "./temporal-partial-object.ts";
import {
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { viewObjectValue } from "./values.ts";
import { temporalInteger } from "./temporal-coercion.ts";
import { temporalStringOption } from "./temporal-options.ts";
import type { ScriptPropertyKey } from "./symbols.ts";

/** ToTemporalTime shares slot conversion, string grammar, and object field ordering. */
export function plainTimeFrom(
  item: unknown,
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): ISOTime {
  function overflow(): string {
    return temporalStringOption(
      options,
      "overflow",
      "constrain",
      ["constrain", "reject"],
      realm,
      hooks,
    );
  }
  const object = viewObjectValue(item, realm.objectPrototype);
  if (object === undefined) {
    if (typeof item !== "string") throw createRuntimeError(realm, "type");
    const parsed = parseISOTimeString(item),
      data = parsed.value;
    if (parsed.error !== "none" || data === undefined || data.utc)
      throw createRuntimeError(realm, "range");
    overflow();
    return {
      hour: data.hour,
      minute: data.minute,
      second: data.second,
      nanosecond: data.nanosecond,
    };
  }
  const time = object.internalTemporalPlainTime;
  if (time !== undefined) {
    overflow();
    return time;
  }
  const dateTime = object.internalTemporalPlainDateTime;
  if (dateTime !== undefined) {
    overflow();
    return {
      hour: dateTime.hour,
      minute: dateTime.minute,
      second: dateTime.second,
      nanosecond: dateTime.nanosecond,
    };
  }
  const zoned = object.internalTemporalZonedDateTime;
  if (zoned !== undefined) {
    overflow();
    return {
      hour: zoned.dateTime.hour,
      minute: zoned.dateTime.minute,
      second: zoned.dateTime.second,
      nanosecond: zoned.dateTime.nanosecond,
    };
  }
  const fields = readTimeFields(object, item, [0, 0, 0, 0, 0, 0], realm, hooks);
  return regulateTemporalTime(fields, overflow(), realm);
}
export function plainTimeWith(
  time: ISOTime,
  item: unknown,
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): ISOTime {
  const object = requirePartialTemporalObject(item, realm, hooks);
  const fields = readTimeFields(
    object,
    item,
    [
      time.hour,
      time.minute,
      time.second,
      Math.floor(time.nanosecond / 1000000),
      Math.floor(time.nanosecond / 1000) % 1000,
      time.nanosecond % 1000,
    ],
    realm,
    hooks,
  );
  const policy = temporalStringOption(
    options,
    "overflow",
    "constrain",
    ["constrain", "reject"],
    realm,
    hooks,
  );
  return regulateTemporalTime(fields, policy, realm);
}
function readTimeFields(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  item: unknown,
  initial: readonly number[],
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): number[] {
  const names = [
    "hour",
    "microsecond",
    "millisecond",
    "minute",
    "nanosecond",
    "second",
  ];
  const indices = [0, 4, 3, 1, 5, 2];
  const fields = initial.slice();
  let present = false;
  for (let i = 0; i < names.length; i++) {
    const name = names[i],
      index = indices[i];
    if (name === undefined || index === undefined)
      throw "TEMPORAL_TIME_FIELD_INVARIANT";
    const value = getProperty<ScriptPropertyKey, unknown>(
      object,
      name,
      item,
      hooks,
    );
    if (value !== undefined) {
      present = true;
      fields[index] = temporalInteger(value, realm, hooks);
    }
  }
  if (!present) throw createRuntimeError(realm, "type");
  return fields;
}
/** Regulate six coerced fields; callers choose when options have been observed. */
export function regulateTemporalTime(
  fields: readonly number[],
  policy: string,
  realm: ErrorRealm,
): ISOTime {
  const regulated: number[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] ?? 0,
      maximum = i === 0 ? 23 : i < 3 ? 59 : 999;
    if (policy === "reject" && (field < 0 || field > maximum))
      throw createRuntimeError(realm, "range");
    regulated.push(Math.min(maximum, Math.max(0, field)));
  }
  return {
    hour: regulated[0] ?? 0,
    minute: regulated[1] ?? 0,
    second: regulated[2] ?? 0,
    nanosecond:
      (regulated[3] ?? 0) * 1000000 +
      (regulated[4] ?? 0) * 1000 +
      (regulated[5] ?? 0),
  };
}
