import {
  partialDateFrom,
  partialDateWith,
} from "./temporal-partial-date-conversion.ts";
import { installDateDifferenceMethods } from "./temporal-date-difference.ts";
import { plainYearMonthArithmetic } from "./temporal-date-arithmetic.ts";
import { durationFrom } from "./temporal-duration-conversion.ts";
import {
  epochDayFromGregorian,
  daysInGregorianMonth,
  type GregorianDate,
} from "@tint/foundation/chrono/gregorian-calendar";
import { formatISODate } from "@tint/foundation/chrono/iso-date-time";
import {
  getProperty,
  createObject,
  createConstructorObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import {
  temporalInteger,
  requireCalendarAlgorithms,
  temporalCalendarSlot,
} from "./temporal-coercion.ts";
import { calendarFieldsFromISO, calendarMonthCode } from "./calendar.ts";
import { temporalCalendarAnnotation } from "./temporal-date-time-format.ts";
import { installTemporalCalendarAccessors } from "./temporal-calendar-fields.ts";
import {
  readTemporalDateFields,
  regulateCalendarDateFields,
} from "./temporal-date-fields.ts";
import { temporalStringOption } from "./temporal-options.ts";
import {
  builtinProperty,
  builtinFunction,
  builtinFunctionMetadata,
} from "./intrinsics.ts";
import { constructorPrototype } from "./functions.ts";
import { viewObjectValue } from "./values.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";

/** Partial-date slots retain the reference ISO components, independently of exposed fields. */
export function installTemporalPartialDates(
  temporal: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  for (const yearMonth of [true, false]) {
    if (yearMonth === undefined) throw "TEMPORAL_PARTIAL_KIND_INVARIANT";
    const name = yearMonth ? "PlainYearMonth" : "PlainMonthDay";
    const prototype = yearMonth
      ? realm.temporalPlainYearMonthPrototype
      : realm.temporalPlainMonthDayPrototype;
    function extract(receiver: unknown): GregorianDate {
      const object = viewObjectValue(receiver, realm.objectPrototype);
      const date =
        object === undefined
          ? undefined
          : yearMonth
            ? object.internalTemporalPlainYearMonth
            : object.internalTemporalPlainMonthDay;
      if (date === undefined) throw createRuntimeError(realm, "type");
      return date;
    }
    const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
      realm.functionPrototype,
      (receiver, args): unknown => {
        throw createRuntimeError(realm, "type");
      },
      (args, target): unknown => {
        const first = temporalInteger(args[0], realm, hooks);
        const second = temporalInteger(args[1], realm, hooks);
        const calendar = requireCalendarAlgorithms(args[2], realm);
        const reference =
          args[3] === undefined
            ? yearMonth
              ? 1
              : 1972
            : temporalInteger(args[3], realm, hooks);
        const year = yearMonth ? first : reference;
        const month = yearMonth ? second : first;
        const day = yearMonth ? reference : second;
        const epoch = epochDayFromGregorian(year, month, day);
        if (
          yearMonth
            ? day < 1 ||
              day > daysInGregorianMonth(year, month) ||
              month < 1 ||
              month > 12 ||
              year < -271821 ||
              year > 275760 ||
              (year === -271821 && month < 4) ||
              (year === 275760 && month > 9)
            : epoch === undefined || epoch < -100000001 || epoch > 100000000
        )
          throw createRuntimeError(realm, "range");
        const object = createObject<ScriptPropertyKey, unknown>(
          constructorPrototype(
            target,
            yearMonth
              ? "temporal-plain-year-month"
              : "temporal-plain-month-day",
            realm,
            hooks,
          ),
        );
        const date: GregorianDate = { year, month, day };
        if (yearMonth) object.internalTemporalPlainYearMonth = date;
        else object.internalTemporalPlainMonthDay = date;
        object.internalTemporalCalendar = calendar;
        return object;
      },
    );
    builtinProperty(
      constructor,
      "from",
      builtinFunction(
        realm.functionPrototype,
        "from",
        1,
        (receiver, args): unknown => {
          const data = partialDateFrom(
            args[0],
            args[1],
            yearMonth,
            realm,
            hooks,
          );
          const object = createObject<ScriptPropertyKey, unknown>(prototype);
          if (yearMonth) object.internalTemporalPlainYearMonth = data.date;
          else object.internalTemporalPlainMonthDay = data.date;
          object.internalTemporalCalendar = data.calendar;
          return object;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
    builtinFunctionMetadata(constructor, name, 2, hooks);
    if (yearMonth)
      installDateDifferenceMethods(
        prototype,
        realm,
        hooks,
        extract,
        "year-month",
      );
    if (yearMonth)
      for (const method of ["add", "subtract"]) {
        if (method === undefined)
          throw "YEAR_MONTH_ARITHMETIC_METHOD_INVARIANT";
        builtinProperty(
          prototype,
          method,
          builtinFunction(
            realm.functionPrototype,
            method,
            1,
            (receiver, args): unknown => {
              const date = extract(receiver);
              const duration = durationFrom(args[0], realm, hooks);
              const policy = temporalStringOption(
                args[1],
                "overflow",
                "constrain",
                ["constrain", "reject"],
                realm,
                hooks,
              );
              const result = plainYearMonthArithmetic(
                date,
                duration,
                method === "subtract",
                policy,
                realm,
                temporalCalendarSlot(receiver, realm),
              );
              const object = createObject<ScriptPropertyKey, unknown>(
                prototype,
              );
              object.internalTemporalPlainYearMonth = result;
              object.internalTemporalCalendar = temporalCalendarSlot(
                receiver,
                realm,
              );
              return object;
            },
            hooks,
          ),
          true,
          true,
          hooks,
        );
      }
    if (yearMonth)
      builtinProperty(
        constructor,
        "compare",
        builtinFunction(
          realm.functionPrototype,
          "compare",
          2,
          (receiver, args): unknown => {
            const first = partialDateFrom(
              args[0],
              undefined,
              true,
              realm,
              hooks,
            );
            const second = partialDateFrom(
              args[1],
              undefined,
              true,
              realm,
              hooks,
            );
            return comparePartialDates(first.date, second.date);
          },
          hooks,
        ),
        true,
        true,
        hooks,
      );
    builtinProperty(constructor, "prototype", prototype, false, false, hooks);
    builtinProperty(prototype, "constructor", constructor, true, true, hooks);
    builtinProperty(
      prototype,
      wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
      "Temporal." + name,
      false,
      true,
      hooks,
    );
    installTemporalCalendarAccessors(
      prototype,
      realm,
      hooks,
      extract,
      yearMonth ? "year-month" : "month-day",
    );
    builtinProperty(
      prototype,
      "with",
      builtinFunction(
        realm.functionPrototype,
        "with",
        1,
        (receiver, args): unknown => {
          const date = extract(receiver);
          const result = partialDateWith(
            date,
            args[0],
            args[1],
            yearMonth,
            realm,
            hooks,
            temporalCalendarSlot(receiver, realm),
          );
          const object = createObject<ScriptPropertyKey, unknown>(prototype);
          if (yearMonth) object.internalTemporalPlainYearMonth = result;
          else object.internalTemporalPlainMonthDay = result;
          object.internalTemporalCalendar = temporalCalendarSlot(
            receiver,
            realm,
          );
          return object;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
    builtinProperty(
      prototype,
      "equals",
      builtinFunction(
        realm.functionPrototype,
        "equals",
        1,
        (receiver, args): unknown => {
          const first = extract(receiver);
          const second = partialDateFrom(
            args[0],
            undefined,
            yearMonth,
            realm,
            hooks,
          );
          return (
            comparePartialDates(first, second.date) === 0 &&
            temporalCalendarSlot(receiver, realm) === second.calendar
          );
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
    builtinProperty(
      prototype,
      "toPlainDate",
      builtinFunction(
        realm.functionPrototype,
        "toPlainDate",
        1,
        (receiver, args): unknown => {
          const date = extract(receiver);
          const calendar = temporalCalendarSlot(receiver, realm);
          const calendarDate = calendarFieldsFromISO(calendar, date);
          if (calendarDate === undefined)
            throw "PARTIAL_DATE_CALENDAR_INVARIANT";
          const item = args[0];
          const fields = viewObjectValue(item, realm.objectPrototype);
          if (fields === undefined) throw createRuntimeError(realm, "type");
          let year: number | undefined = calendarDate.year;
          let day = calendarDate.day;
          let era: string | undefined = undefined;
          let eraYear: number | undefined = undefined;
          if (yearMonth) {
            const supplied = getProperty<ScriptPropertyKey, unknown>(
              fields,
              "day",
              item,
              hooks,
            );
            if (supplied === undefined) throw createRuntimeError(realm, "type");
            day = temporalInteger(supplied, realm, hooks);
          } else {
            const input = readTemporalDateFields(
              fields,
              item,
              "year-only",
              realm,
              hooks,
              undefined,
              calendar,
            );
            year = input.year;
            era = input.era;
            eraYear = input.eraYear;
          }
          const result = regulateCalendarDateFields(
            {
              present: true,
              era,
              eraYear,
              year,
              month: undefined,
              monthCode: calendarMonthCode(calendar, date),
              day,
              time: [],
              offsetNanoseconds: undefined,
              timeZone: undefined,
            },
            calendar,
            "date",
            "constrain",
            realm,
          );
          const object = createObject<ScriptPropertyKey, unknown>(
            realm.temporalPlainDatePrototype,
          );
          object.internalTemporalPlainDate = result;
          object.internalTemporalCalendar = calendar;
          return object;
        },
        hooks,
      ),
      true,
      true,
      hooks,
    );
    // The core locale fallback uses intrinsic slots and ignores locale options.
    for (const method of ["toString", "toJSON", "toLocaleString", "valueOf"]) {
      if (method === undefined) throw "TEMPORAL_PARTIAL_METHOD_INVARIANT";
      builtinProperty(
        prototype,
        method,
        builtinFunction(
          realm.functionPrototype,
          method,
          0,
          (receiver, args): unknown => {
            if (method === "valueOf") throw createRuntimeError(realm, "type");
            const date = extract(receiver);
            const display =
              method === "toString"
                ? temporalStringOption(
                    args[0],
                    "calendarName",
                    "auto",
                    ["auto", "always", "never", "critical"],
                    realm,
                    hooks,
                  )
                : "auto";
            const full = formatISODate(date);
            const calendar = temporalCalendarSlot(receiver, realm);
            if (
              calendar !== "iso8601" ||
              display === "always" ||
              display === "critical"
            )
              return full + temporalCalendarAnnotation(display, calendar);
            return yearMonth
              ? full.slice(0, full.length - 3)
              : full.slice(full.length - 5);
          },
          hooks,
        ),
        true,
        true,
        hooks,
      );
    }
    builtinProperty(temporal, name, constructor, true, true, hooks);
  }
}

/** Reference components participate even when they are not exposed as fields. */
function comparePartialDates(
  first: GregorianDate,
  second: GregorianDate,
): number {
  if (first.year !== second.year) return first.year < second.year ? -1 : 1;
  if (first.month !== second.month) return first.month < second.month ? -1 : 1;
  if (first.day !== second.day) return first.day < second.day ? -1 : 1;
  return 0;
}
