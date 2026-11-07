import {
  epochDayFromGregorian,
  daysInGregorianMonth,
  isoWeekFromEpochDay,
  type GregorianDate,
} from "@tint/foundation/chrono/gregorian-calendar";
import { builtinAccessor, builtinFunction } from "./intrinsics.ts";
import type { OrdinaryObject, ObjectHooks } from "./operations.ts";
import { rejectUnsupportedExecution, type ErrorRealm } from "./errors.ts";
import { calendarFieldsFromISO } from "./calendar.ts";
import { temporalCalendarSlot } from "./temporal-coercion.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
/** Calendar getters share ISO storage; each constructor supplies its own brand check. */
export function installTemporalCalendarAccessors(
  prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  extract: (receiver: unknown) => GregorianDate,
  kind: "date" | "year-month" | "month-day" = "date",
): void {
  for (const name of [
    "year",
    "month",
    "monthCode",
    "day",
    "calendarId",
    "era",
    "eraYear",
    "dayOfWeek",
    "dayOfYear",
    "weekOfYear",
    "yearOfWeek",
    "daysInWeek",
    "daysInMonth",
    "daysInYear",
    "monthsInYear",
    "inLeapYear",
  ]) {
    if (name === undefined) throw "TEMPORAL_ACCESSOR_INVARIANT";
    if (
      kind === "month-day" &&
      name !== "monthCode" &&
      name !== "day" &&
      name !== "calendarId"
    )
      continue;
    if (
      kind === "year-month" &&
      (name === "day" ||
        name === "dayOfWeek" ||
        name === "dayOfYear" ||
        name === "weekOfYear" ||
        name === "yearOfWeek" ||
        name === "daysInWeek")
    )
      continue;
    builtinAccessor(
      prototype,
      name,
      builtinFunction(
        realm.functionPrototype,
        "get " + name,
        0,
        (receiver, args): unknown => {
          const date = extract(receiver);
          const calendar = temporalCalendarSlot(receiver, realm);
          if (name === "calendarId") return calendar;
          const fields = calendarFieldsFromISO(calendar, date);
          if (fields === undefined) return rejectUnsupportedExecution(realm);
          if (name === "year") return fields.year;
          if (name === "month") return fields.month;
          if (name === "day") return fields.day;
          if (name === "monthCode")
            return "M" + String(date.month).padStart(2, "0");
          if (name === "era") return fields.era;
          if (name === "eraYear") return fields.eraYear;
          if (name === "daysInWeek") return 7;
          if (name === "monthsInYear") return 12;
          const leap = daysInGregorianMonth(date.year, 2) === 29;
          if (name === "daysInYear") return leap ? 366 : 365;
          if (name === "inLeapYear") return leap;
          if (name === "daysInMonth")
            return daysInGregorianMonth(date.year, date.month);
          if (name === "dayOfYear") {
            let ordinal = date.day;
            for (let month = 1; month < date.month; month++)
              ordinal += daysInGregorianMonth(date.year, month);
            return ordinal;
          }
          if (
            calendar !== "iso8601" &&
            (name === "weekOfYear" || name === "yearOfWeek")
          )
            return undefined;
          const epoch = epochDayFromGregorian(date.year, date.month, date.day);
          if (epoch === undefined) throw "TEMPORAL_DATE_INVARIANT";
          const week = isoWeekFromEpochDay(epoch);
          if (week === undefined) throw "TEMPORAL_WEEK_INVARIANT";
          return name === "dayOfWeek"
            ? week.weekday
            : name === "weekOfYear"
              ? week.week
              : week.year;
        },
        hooks,
      ),
      undefined,
      hooks,
    );
  }
}
