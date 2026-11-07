import {
  epochDayFromGregorianCoordinate,
  gregorianFromEpochDay,
  type GregorianDate,
  type GregorianDateDifference,
} from "@tint/foundation/chrono/gregorian-calendar";
import type {
  CalendarDateFields,
  CalendarMonthCode,
} from "./calendar-records.ts";
export interface CalendarYearMonth {
  readonly year: number;
  readonly month: number;
}
/** Month serials span all years, while year additions retain stable month codes. */
export interface LunisolarCalendarAlgorithms {
  readonly fields: (
    calendar: string,
    date: GregorianDate,
  ) => CalendarDateFields | undefined;
  readonly monthsBeforeYear: (
    calendar: string,
    year: number,
  ) => number | undefined;
  readonly yearMonthAtIndex: (
    calendar: string,
    index: number,
  ) => CalendarYearMonth | undefined;
  readonly monthCode: (
    calendar: string,
    year: number,
    month: number,
  ) => CalendarMonthCode | undefined;
  readonly monthFromCode: (
    calendar: string,
    year: number,
    code: CalendarMonthCode,
    overflow: "constrain" | "reject",
  ) => number | undefined;
  readonly daysInMonth: (
    calendar: string,
    year: number,
    month: number,
  ) => number | undefined;
  readonly epochDay: (
    calendar: string,
    year: number,
    month: number,
    day: number,
  ) => number | undefined;
}
export function lunisolarDateAdd(
  calendar: string,
  date: GregorianDate,
  years: number,
  months: number,
  weeks: number,
  days: number,
  overflow: "constrain" | "reject",
  algorithms: LunisolarCalendarAlgorithms,
): GregorianDate | undefined {
  for (const value of [years, months, weeks, days])
    if (!Number.isSafeInteger(value)) return undefined;
  const fields = algorithms.fields(calendar, date);
  if (fields === undefined) return undefined;
  const code = algorithms.monthCode(calendar, fields.year, fields.month);
  if (code === undefined) return undefined;
  const year = fields.year + years,
    month = algorithms.monthFromCode(calendar, year, code, overflow),
    prefix = algorithms.monthsBeforeYear(calendar, year);
  if (month === undefined || prefix === undefined) return undefined;
  const index = prefix + month - 1 + months;
  if (!Number.isSafeInteger(index)) return undefined;
  const target = algorithms.yearMonthAtIndex(calendar, index);
  if (target === undefined) return undefined;
  const maximum = algorithms.daysInMonth(calendar, target.year, target.month);
  if (maximum === undefined || (overflow === "reject" && fields.day > maximum))
    return undefined;
  const anchor = algorithms.epochDay(
    calendar,
    target.year,
    target.month,
    Math.min(fields.day, maximum),
  );
  if (anchor === undefined) return undefined;
  const epoch = anchor + weeks * 7 + days;
  return Number.isSafeInteger(epoch) ? gregorianFromEpochDay(epoch) : undefined;
}
export function lunisolarDateUntil(
  calendar: string,
  one: GregorianDate,
  two: GregorianDate,
  largest: "year" | "month" | "week" | "day",
  algorithms: LunisolarCalendarAlgorithms,
): GregorianDateDifference | undefined {
  const first = epochDayFromGregorianCoordinate(one.year, one.month, one.day),
    last = epochDayFromGregorianCoordinate(two.year, two.month, two.day),
    a = algorithms.fields(calendar, one),
    b = algorithms.fields(calendar, two);
  if (
    first === undefined ||
    last === undefined ||
    a === undefined ||
    b === undefined
  )
    return undefined;
  const sign = last > first ? 1 : last < first ? -1 : 0;
  let years = 0,
    months = 0,
    weeks = 0,
    days = last - first;
  if (sign !== 0 && (largest === "year" || largest === "month")) {
    const code = algorithms.monthCode(calendar, a.year, a.month);
    if (code === undefined) return undefined;
    years = largest === "year" ? b.year - a.year : 0;
    let year = a.year + years;
    const initialMonth = algorithms.monthFromCode(
      calendar,
      year,
      code,
      "constrain",
    );
    if (initialMonth === undefined) return undefined;
    let month: number = initialMonth;
    const order =
      year !== b.year
        ? year < b.year
          ? -1
          : 1
        : month !== b.month
          ? month < b.month
            ? -1
            : 1
          : a.day !== b.day
            ? a.day < b.day
              ? -1
              : 1
            : 0;
    if (largest === "year" && order * sign > 0) {
      years -= sign;
      year = a.year + years;
      const adjustedMonth = algorithms.monthFromCode(
        calendar,
        year,
        code,
        "constrain",
      );
      if (adjustedMonth === undefined) return undefined;
      month = adjustedMonth;
    }
    const start = algorithms.monthsBeforeYear(calendar, year),
      end = algorithms.monthsBeforeYear(calendar, b.year);
    if (start === undefined || end === undefined) return undefined;
    months = end + b.month - start - month;
    if (sign * (a.day - b.day) > 0) months -= sign;
    const anchor = lunisolarDateAdd(
      calendar,
      one,
      years,
      months,
      0,
      0,
      "constrain",
      algorithms,
    );
    if (anchor === undefined) return undefined;
    const epoch = epochDayFromGregorianCoordinate(
      anchor.year,
      anchor.month,
      anchor.day,
    );
    if (epoch === undefined) return undefined;
    days = last - epoch;
  } else if (largest === "week") {
    weeks = Math.trunc(days / 7);
    days %= 7;
  }
  return {
    years: years === 0 ? 0 : years,
    months: months === 0 ? 0 : months,
    weeks: weeks === 0 ? 0 : weeks,
    days: days === 0 ? 0 : days,
  };
}
