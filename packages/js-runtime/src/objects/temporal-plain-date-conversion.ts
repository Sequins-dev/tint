import {
  readTemporalDateFields,
  regulateISODateFields,
  mergeISODateFields,
} from "./temporal-date-fields.ts";
import { parseISODateTime } from "@tint/foundation/chrono/iso-date-time";
import {
  epochDayFromGregorian,
  type GregorianDate,
} from "@tint/foundation/chrono/gregorian-calendar";
import {
  requireISOCalendar,
  objectTemporalCalendarIdentifier,
} from "./temporal-coercion.ts";
import { temporalStringOption } from "./temporal-options.ts";
import { type ObjectHooks } from "./operations.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { viewObjectValue } from "./values.ts";
import { requirePartialTemporalObject } from "./temporal-partial-object.ts";
/** Merge partial ISO fields before overflow regulation. A supplied month or
 * monthCode replaces the original month pair; only supplied pairs must agree. */
export function plainDateWith(
  date: GregorianDate,
  item: unknown,
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): GregorianDate {
  const object = requirePartialTemporalObject(item, realm, hooks);
  const fields = readTemporalDateFields(object, item, "date", realm, hooks);
  if (!fields.present) throw createRuntimeError(realm, "type");
  const policy = temporalStringOption(
    options,
    "overflow",
    "constrain",
    ["constrain", "reject"],
    realm,
    hooks,
  );
  return regulateISODateFields(mergeISODateFields(date, fields), policy, realm);
}
/** ISO ToTemporalDate conversion. Other Temporal brands require separate slot paths. */
export function plainDateFrom(
  item: unknown,
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): GregorianDate {
  function validate(year: number, month: number, day: number): GregorianDate {
    const epoch = epochDayFromGregorian(year, month, day);
    if (epoch === undefined || epoch < -100000001 || epoch > 100000000)
      throw createRuntimeError(realm, "range");
    return { year, month, day };
  }
  function overflow(options: unknown): string {
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
    const zoned = object.internalTemporalZonedDateTime;
    if (zoned !== undefined) {
      overflow(options);
      return zoned.dateTime.date;
    }
    const dateTime = object.internalTemporalPlainDateTime;
    if (dateTime !== undefined) {
      overflow(options);
      return dateTime.date;
    }
    const branded = object.internalTemporalPlainDate;
    if (branded !== undefined) {
      overflow(options);
      return branded;
    }
    const target = object;
    const calendar = objectTemporalCalendarIdentifier(
      target,
      item,
      realm,
      hooks,
    );
    const fields = readTemporalDateFields(
      target,
      item,
      "date",
      realm,
      hooks,
      undefined,
      calendar,
    );
    const policy = overflow(options);
    requireISOCalendar(calendar, realm);
    return regulateISODateFields(fields, policy, realm);
  }
  if (typeof item !== "string") throw createRuntimeError(realm, "type");
  const parsed = parseISODateTime(item);
  const value = parsed.value;
  if (parsed.error !== "none" || value === undefined || value.utc)
    throw createRuntimeError(realm, "range");
  requireISOCalendar(value.calendar, realm);
  overflow(options);
  return validate(value.date.year, value.date.month, value.date.day);
}
