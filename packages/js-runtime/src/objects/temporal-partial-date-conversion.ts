import {
  parseISOYearMonthString,
  parseISOMonthDayString,
} from "@tint/foundation/chrono/iso-date-time";
import {
  daysInGregorianMonth,
  epochDayFromGregorian,
  type GregorianDate,
} from "@tint/foundation/chrono/gregorian-calendar";
import {
  readTemporalDateFields,
  resolveISOFieldMonth,
  mergeISODateFields,
  mergeCalendarDateFields,
  regulateCalendarDateFields,
  type TemporalDateFields,
} from "./temporal-date-fields.ts";
import {
  canonicalTemporalCalendar,
  objectTemporalCalendarIdentifier,
  requireGregorianCalendar,
} from "./temporal-coercion.ts";
import { requirePartialTemporalObject } from "./temporal-partial-object.ts";
import { temporalStringOption } from "./temporal-options.ts";
import { viewObjectValue } from "./values.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import type { ObjectHooks } from "./operations.ts";
import type { CalendarISODate } from "./calendar.ts";
function yearMonthWithinLimits(year: number, month: number): boolean {
  return (
    year >= -271821 &&
    year <= 275760 &&
    !(year === -271821 && month < 4) &&
    !(year === 275760 && month > 9)
  );
}
/** Conversion preserves slots on copies and canonicalizes reference components otherwise. */
export function partialDateFrom(
  item: unknown,
  options: unknown,
  yearMonth: boolean,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): CalendarISODate {
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
    const branded = yearMonth
      ? object.internalTemporalPlainYearMonth
      : object.internalTemporalPlainMonthDay;
    if (branded !== undefined) {
      overflow();
      return {
        date: branded,
        calendar: canonicalTemporalCalendar(
          object.internalTemporalCalendar,
          realm,
        ),
      };
    }
    const calendar = objectTemporalCalendarIdentifier(
      object,
      item,
      realm,
      hooks,
    );
    const fields = readTemporalDateFields(
      object,
      item,
      yearMonth ? "year-month" : "month-day",
      realm,
      hooks,
      undefined,
      calendar,
    );
    const policy = overflow();
    requireGregorianCalendar(calendar, realm);
    return {
      date:
        calendar === "iso8601"
          ? regulatePartialDateFields(fields, yearMonth, policy, realm)
          : regulateCalendarDateFields(
              fields,
              calendar,
              yearMonth ? "year-month" : "month-day",
              policy,
              realm,
            ),
      calendar,
    };
  }
  if (typeof item !== "string") throw createRuntimeError(realm, "type");
  const parsed = yearMonth
      ? parseISOYearMonthString(item)
      : parseISOMonthDayString(item),
    data = parsed.value;
  if (parsed.error !== "none" || data === undefined || data.utc)
    throw createRuntimeError(realm, "range");
  const calendar = requireGregorianCalendar(data.calendar, realm);
  overflow();
  if (yearMonth) {
    if (!yearMonthWithinLimits(data.date.year, data.date.month))
      throw createRuntimeError(realm, "range");
    return {
      date: { year: data.date.year, month: data.date.month, day: 1 },
      calendar,
    };
  }
  if (calendar === "iso8601")
    return {
      date: { year: 1972, month: data.date.month, day: data.date.day },
      calendar,
    };
  const epoch = epochDayFromGregorian(
    data.date.year,
    data.date.month,
    data.date.day,
  );
  if (epoch === undefined || epoch < -100000001 || epoch > 100000000)
    throw createRuntimeError(realm, "range");
  return {
    date: { year: 1972, month: data.date.month, day: data.date.day },
    calendar,
  };
}

/** Resolve ISO partial fields without imposing PlainDate bounds on reference dates. */
export function regulatePartialDateFields(
  fields: TemporalDateFields,
  yearMonth: boolean,
  policy: string,
  realm: ErrorRealm,
): GregorianDate {
  const suppliedYear = fields.year,
    suppliedDay = fields.day;
  if (yearMonth ? suppliedYear === undefined : suppliedDay === undefined)
    throw createRuntimeError(realm, "type");
  let month = resolveISOFieldMonth(fields, realm);
  if (policy === "constrain") month = Math.min(month, 12);
  if (month > 12) throw createRuntimeError(realm, "range");
  if (yearMonth) {
    if (suppliedYear === undefined) throw "YEAR_MONTH_FIELD_INVARIANT";
    if (!yearMonthWithinLimits(suppliedYear, month))
      throw createRuntimeError(realm, "range");
    return { year: suppliedYear, month, day: 1 };
  }
  if (suppliedDay === undefined) throw "MONTH_DAY_FIELD_INVARIANT";
  let day = suppliedDay;
  const year = suppliedYear === undefined ? 1972 : suppliedYear;
  const maximum = daysInGregorianMonth(((year % 400) + 400) % 400, month);
  if (policy === "constrain") day = Math.min(day, maximum);
  if (day > maximum) throw createRuntimeError(realm, "range");
  return { year: 1972, month, day };
}
/** Partial updates retain exposed calendar fields, not hidden reference components. */
export function partialDateWith(
  date: GregorianDate,
  item: unknown,
  options: unknown,
  yearMonth: boolean,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  calendar: string = "iso8601",
): GregorianDate {
  const object = requirePartialTemporalObject(item, realm, hooks);
  const fields = readTemporalDateFields(
    object,
    item,
    yearMonth ? "year-month" : "month-day",
    realm,
    hooks,
    undefined,
    calendar,
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
  const reference = yearMonth
    ? { year: date.year, month: date.month, day: 1 }
    : { year: 1972, month: date.month, day: date.day };
  if (calendar === "iso8601")
    return regulatePartialDateFields(
      mergeISODateFields(reference, fields),
      yearMonth,
      policy,
      realm,
    );
  return regulateCalendarDateFields(
    mergeCalendarDateFields(
      reference,
      fields,
      calendar,
      realm,
      yearMonth ? "year-month" : "month-day",
    ),
    calendar,
    yearMonth ? "year-month" : "month-day",
    policy,
    realm,
  );
}
