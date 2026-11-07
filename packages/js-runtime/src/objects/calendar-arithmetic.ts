import {
  hebrewCalendarDateAdd,
  hebrewCalendarDateUntil,
} from "./calendar-hebrew.ts";
import {
  addGregorianDate,
  differenceGregorianDates,
  epochDayFromGregorianCoordinate,
  gregorianFromEpochDay,
  type GregorianDate,
  type GregorianDateDifference,
} from "@tint/foundation/chrono/gregorian-calendar";
import { isGregorianCalendar } from "./calendar-gregorian.ts";
import {
  calendarFieldsFromISO,
  calendarMonthsInYear,
  calendarDaysInMonth,
  calendarDateAt,
} from "./calendar-query.ts";
/** Balance a regular month sequence before regulating the day, then exact days. */
export function calendarDateAdd(
  calendar: string,
  date: GregorianDate,
  years: number,
  months: number,
  weeks: number,
  days: number,
  overflow: "constrain" | "reject",
): GregorianDate | undefined {
  if (calendar === "hebrew")
    return hebrewCalendarDateAdd(
      calendar,
      date,
      years,
      months,
      weeks,
      days,
      overflow,
    );
  if (isGregorianCalendar(calendar))
    return addGregorianDate(date, years, months, weeks, days, overflow);
  for (const value of [years, months, weeks, days])
    if (!Number.isSafeInteger(value)) return undefined;
  const fields = calendarFieldsFromISO(calendar, date);
  if (fields === undefined) return undefined;
  const count = calendarMonthsInYear(calendar, fields.year);
  if (count === undefined) return undefined;
  const monthIndex = fields.month - 1 + months;
  const year = fields.year + years + Math.floor(monthIndex / count),
    month = (((monthIndex % count) + count) % count) + 1;
  const maximum = calendarDaysInMonth(calendar, year, month);
  if (maximum === undefined || (overflow === "reject" && fields.day > maximum))
    return undefined;
  const base = calendarDateAt(
    calendar,
    year,
    month,
    Math.min(fields.day, maximum),
  );
  if (base === undefined) return undefined;
  const epoch = epochDayFromGregorianCoordinate(
    base.year,
    base.month,
    base.day,
  );
  if (epoch === undefined) return undefined;
  const result = epoch + weeks * 7 + days;
  return Number.isSafeInteger(result)
    ? gregorianFromEpochDay(result)
    : undefined;
}
/** Raw calendar-day comparison selects the prefix without clamping across it. */
export function calendarDateUntil(
  calendar: string,
  one: GregorianDate,
  two: GregorianDate,
  largestUnit: "year" | "month" | "week" | "day",
): GregorianDateDifference | undefined {
  if (calendar === "hebrew")
    return hebrewCalendarDateUntil(calendar, one, two, largestUnit);
  if (isGregorianCalendar(calendar))
    return differenceGregorianDates(one, two, largestUnit);
  const first = epochDayFromGregorianCoordinate(one.year, one.month, one.day),
    last = epochDayFromGregorianCoordinate(two.year, two.month, two.day);
  const a = calendarFieldsFromISO(calendar, one),
    b = calendarFieldsFromISO(calendar, two);
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
  if (sign !== 0 && (largestUnit === "year" || largestUnit === "month")) {
    const count = calendarMonthsInYear(calendar, a.year);
    if (count === undefined) return undefined;
    let span = (b.year - a.year) * count + b.month - a.month;
    if (sign * (a.day - b.day) > 0) span -= sign;
    years = largestUnit === "year" ? Math.trunc(span / count) : 0;
    months = span - years * count;
    const anchor = calendarDateAdd(
      calendar,
      one,
      years,
      months,
      0,
      0,
      "constrain",
    );
    if (anchor === undefined) return undefined;
    const epoch = epochDayFromGregorianCoordinate(
      anchor.year,
      anchor.month,
      anchor.day,
    );
    if (epoch === undefined) return undefined;
    days = last - epoch;
  } else if (largestUnit === "week") {
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
