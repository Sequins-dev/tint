import {
  epochDayFromGregorian,
  daysInGregorianMonth,
  isoWeekFromEpochDay,
  type GregorianDate,
} from "@tint/foundation/chrono/gregorian-calendar";
import { builtinAccessor, builtinFunction } from "./intrinsics.ts";
import type { OrdinaryObject, ObjectHooks } from "./operations.ts";
import type { ErrorRealm } from "./errors.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
/** Shared ISO date getters; the constructor adapter supplies its own brand check. */
export function installISOCalendarAccessors(
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
          if (name === "year") return date.year;
          if (name === "month") return date.month;
          if (name === "day") return date.day;
          if (name === "monthCode")
            return "M" + String(date.month).padStart(2, "0");
          if (name === "calendarId") return "iso8601";
          if (name === "era" || name === "eraYear") return undefined;
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
