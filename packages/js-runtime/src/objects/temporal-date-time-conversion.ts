import {
  parseISODateTime,
  type ISODateTime,
  type ISOTime,
} from "@tint/foundation/chrono/iso-date-time";
import {
  epochDayFromGregorian,
  type GregorianDate,
} from "@tint/foundation/chrono/gregorian-calendar";
import { type ObjectHooks } from "./operations.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { viewObjectValue } from "./values.ts";
import {
  requireISOCalendar,
  requireObjectTemporalCalendar,
} from "./temporal-coercion.ts";
import { temporalStringOption } from "./temporal-options.ts";
import {
  readTemporalDateFields,
  regulateISODateFields,
  mergeISODateFields,
} from "./temporal-date-fields.ts";
import { regulateTemporalTime } from "./temporal-time-conversion.ts";
import { requirePartialTemporalObject } from "./temporal-partial-object.ts";
/** Partial replacement keeps the receiver's clock fields until explicitly supplied. */
export function plainDateTimeWith(
  data: ISODateTime,
  item: unknown,
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): ISODateTime {
  const object = requirePartialTemporalObject(item, realm, hooks);
  const fields = readTemporalDateFields(
    object,
    item,
    "date-time",
    realm,
    hooks,
    data,
  );
  if (!fields.present) throw createRuntimeError(realm, "type");
  const policy = temporalStringOption(
    options,
    "overflow",
    "constrain",
    ["constrain", "reject"],
    realm,
    hooks,
  );
  return combineTemporalDateTime(
    regulateISODateFields(mergeISODateFields(data.date, fields), policy, realm),
    regulateTemporalTime(fields.time, policy, realm),
    realm,
  );
}
export function validateTemporalDateTime(
  data: ISODateTime,
  realm: ErrorRealm,
): ISODateTime {
  const epoch = epochDayFromGregorian(
    data.date.year,
    data.date.month,
    data.date.day,
  );
  if (
    epoch === undefined ||
    epoch < -100000001 ||
    epoch > 100000000 ||
    (epoch === -100000001 &&
      data.hour === 0 &&
      data.minute === 0 &&
      data.second === 0 &&
      data.nanosecond === 0)
  )
    throw createRuntimeError(realm, "range");
  return data;
}
/** Combine validated calendar/clock components under the date-time range policy. */
export function combineTemporalDateTime(
  date: GregorianDate,
  time: ISOTime,
  realm: ErrorRealm,
): ISODateTime {
  return validateTemporalDateTime(
    {
      date,
      hasTime: true,
      hour: time.hour,
      minute: time.minute,
      second: time.second,
      nanosecond: time.nanosecond,
      utc: false,
      offsetNanoseconds: undefined,
      timeZone: undefined,
      calendar: "iso8601",
    },
    realm,
  );
}
export function plainDateTimeFrom(
  item: unknown,
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): ISODateTime {
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
  if (object !== undefined) {
    const branded = object.internalTemporalPlainDateTime;
    if (branded !== undefined) {
      overflow();
      return branded;
    }
    const zoned = object.internalTemporalZonedDateTime;
    if (zoned !== undefined) {
      overflow();
      return zoned.dateTime;
    }
    const date = object.internalTemporalPlainDate;
    if (date !== undefined) {
      overflow();
      return combineTemporalDateTime(
        date,
        { hour: 0, minute: 0, second: 0, nanosecond: 0 },
        realm,
      );
    }
    requireObjectTemporalCalendar(object, item, realm, hooks);
    const fields = readTemporalDateFields(
      object,
      item,
      "date-time",
      realm,
      hooks,
    );
    const policy = overflow();
    const isoDate = regulateISODateFields(fields, policy, realm),
      time = regulateTemporalTime(fields.time, policy, realm);
    return combineTemporalDateTime(isoDate, time, realm);
  }
  if (typeof item !== "string") throw createRuntimeError(realm, "type");
  const parsed = parseISODateTime(item),
    data = parsed.value;
  if (parsed.error !== "none" || data === undefined || data.utc)
    throw createRuntimeError(realm, "range");
  requireISOCalendar(data.calendar, realm);
  overflow();
  return validateTemporalDateTime(data, realm);
}
