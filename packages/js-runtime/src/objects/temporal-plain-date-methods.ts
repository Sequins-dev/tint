import {
  calendarFieldsFromISO,
  calendarDateFromFields,
  calendarMonthCode,
} from "./calendar.ts";
import { temporalTimeZoneLike } from "./temporal-time-zone.ts";
import { viewObjectValue } from "./values.ts";
import { interpretZonedOffset } from "./temporal-zoned-conversion.ts";
import { createTemporalZonedObject } from "./temporal-zoned-construction.ts";
import { plainTimeFrom } from "./temporal-time-conversion.ts";
import { combineTemporalDateTime } from "./temporal-date-time-conversion.ts";
import type { GregorianDate } from "@tint/foundation/chrono/gregorian-calendar";
import {
  createObject,
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { builtinProperty, builtinFunction } from "./intrinsics.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import {
  plainDateFrom,
  plainDateWith,
} from "./temporal-plain-date-conversion.ts";
import {
  requireCalendarAlgorithms,
  temporalCalendarIdentifier,
  temporalCalendarSlot,
} from "./temporal-coercion.ts";
import type { ScriptPropertyKey } from "./symbols.ts";

/** Copy/conversion methods always allocate their realm's intrinsic result class. */
export function installPlainDateCopyMethods(
  prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  extract: (receiver: unknown) => GregorianDate,
  create: (
    date: GregorianDate,
    calendar: string,
  ) => OrdinaryObject<ScriptPropertyKey, unknown>,
): void {
  for (const name of [
    "equals",
    "with",
    "withCalendar",
    "toPlainYearMonth",
    "toPlainMonthDay",
    "toPlainDateTime",
    "toZonedDateTime",
  ]) {
    if (name === undefined) throw "PLAIN_DATE_COPY_METHOD_INVARIANT";
    builtinProperty(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        name,
        name === "equals" ||
          name === "with" ||
          name === "withCalendar" ||
          name === "toZonedDateTime"
          ? 1
          : 0,
        (receiver, args): unknown => {
          const date = extract(receiver);
          const calendar = temporalCalendarSlot(receiver, realm);
          if (name === "toZonedDateTime") {
            const item = args[0],
              object = viewObjectValue(item, realm.objectPrototype);
            let zoneValue = item;
            let hasTime = false;
            if (object !== undefined) {
              const supplied = getProperty<ScriptPropertyKey, unknown>(
                object,
                "timeZone",
                item,
                hooks,
              );
              if (supplied !== undefined) {
                zoneValue = supplied;
                hasTime = true;
              }
            }
            const zone = temporalTimeZoneLike(zoneValue, realm);
            const timeValue =
              hasTime && object !== undefined
                ? getProperty<ScriptPropertyKey, unknown>(
                    object,
                    "plainTime",
                    item,
                    hooks,
                  )
                : undefined;
            const time =
              timeValue === undefined
                ? { hour: 0, minute: 0, second: 0, nanosecond: 0 }
                : plainTimeFrom(timeValue, undefined, realm, hooks);
            const local = combineTemporalDateTime(date, time, realm);
            const result = interpretZonedOffset(
              local,
              zone,
              undefined,
              "ignore",
              realm,
            );
            return createTemporalZonedObject(
              result.epoch,
              zone,
              realm.temporalZonedDateTimePrototype,
              realm,
              calendar,
            );
          }
          if (name === "with")
            return create(
              plainDateWith(date, args[0], args[1], realm, hooks, calendar),
              calendar,
            );
          if (name === "equals") {
            const other = plainDateFrom(args[0], undefined, realm, hooks);
            return (
              date.year === other.date.year &&
              date.month === other.date.month &&
              date.day === other.date.day &&
              calendar === other.calendar
            );
          }
          if (name === "withCalendar") {
            if (args[0] === undefined) throw createRuntimeError(realm, "type");
            const nextCalendar = requireCalendarAlgorithms(
              temporalCalendarIdentifier(args[0], realm),
              realm,
            );
            return create(date, nextCalendar);
          }
          if (name === "toPlainDateTime") {
            const time =
              args[0] === undefined
                ? { hour: 0, minute: 0, second: 0, nanosecond: 0 }
                : plainTimeFrom(args[0], undefined, realm, hooks);
            const data = combineTemporalDateTime(date, time, realm, calendar);
            const result = createObject<ScriptPropertyKey, unknown>(
              realm.temporalPlainDateTimePrototype,
            );
            result.internalTemporalPlainDateTime = data;
            result.internalTemporalCalendar = calendar;
            return result;
          }
          const yearMonth = name === "toPlainYearMonth";
          const result = createObject<ScriptPropertyKey, unknown>(
            yearMonth
              ? realm.temporalPlainYearMonthPrototype
              : realm.temporalPlainMonthDayPrototype,
          );
          result.internalTemporalCalendar = calendar;
          const fields = calendarFieldsFromISO(calendar, date);
          if (fields === undefined)
            throw "PLAIN_DATE_CALENDAR_FIELDS_INVARIANT";
          const converted = calendarDateFromFields(
            calendar,
            {
              year: fields.year,
              month: fields.month,
              monthCode: calendarMonthCode(calendar, date),
              day: fields.day,
              era: fields.era,
              eraYear: fields.eraYear,
            },
            yearMonth ? "year-month" : "month-day",
            "constrain",
          );
          if (converted.value === undefined)
            throw createRuntimeError(realm, "range");
          if (yearMonth)
            result.internalTemporalPlainYearMonth = converted.value;
          else result.internalTemporalPlainMonthDay = converted.value;
          return result;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
  }
}
