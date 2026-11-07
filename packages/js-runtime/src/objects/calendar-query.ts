import {
  daysInGregorianMonth,
  gregorianYearStartEpochDay,
  epochDayFromGregorianCoordinate,
  gregorianCoordinateFromEpochDay,
  type GregorianDate,
} from "@tint/foundation/chrono/gregorian-calendar";
import {
  isGregorianCalendar,
  gregorianCalendarFields,
  gregorianCalendarDateFromFields,
  gregorianCalendarISOYear,
} from "./calendar-gregorian.ts";
import {
  isCopticCalendar,
  copticCalendarFields,
  copticCalendarDateFromFields,
  copticCalendarYearStart,
  copticCalendarDaysInMonth,
  copticCalendarEpochDay,
} from "./calendar-coptic.ts";
import type {
  CalendarDateFields,
  CalendarInputFields,
  CalendarDateConversion,
} from "./calendar-records.ts";
export function calendarAlgorithmsAvailable(calendar: string): boolean {
  return isGregorianCalendar(calendar) || isCopticCalendar(calendar);
}
export function calendarFieldsFromISO(
  calendar: string,
  date: GregorianDate,
): CalendarDateFields | undefined {
  if (isGregorianCalendar(calendar))
    return gregorianCalendarFields(calendar, date);
  return isCopticCalendar(calendar)
    ? copticCalendarFields(calendar, date)
    : undefined;
}
export function calendarDateFromFields(
  calendar: string,
  fields: CalendarInputFields,
  kind: "date" | "year-month" | "month-day",
  overflow: "constrain" | "reject",
): CalendarDateConversion {
  if (isGregorianCalendar(calendar))
    return gregorianCalendarDateFromFields(calendar, fields, kind, overflow);
  if (isCopticCalendar(calendar))
    return copticCalendarDateFromFields(calendar, fields, kind, overflow);
  return { value: undefined, error: "unsupported" };
}
export function calendarMonthsInYear(
  calendar: string,
  year: number,
): number | undefined {
  if (!Number.isSafeInteger(year)) return undefined;
  return isGregorianCalendar(calendar)
    ? 12
    : isCopticCalendar(calendar)
      ? 13
      : undefined;
}
export function calendarDaysInMonth(
  calendar: string,
  year: number,
  month: number,
): number | undefined {
  if (isGregorianCalendar(calendar)) {
    const isoYear = gregorianCalendarISOYear(calendar, year);
    const days =
      isoYear === undefined ? 0 : daysInGregorianMonth(isoYear, month);
    return days === 0 ? undefined : days;
  }
  return isCopticCalendar(calendar)
    ? copticCalendarDaysInMonth(calendar, year, month)
    : undefined;
}
export function calendarYearStartEpochDay(
  calendar: string,
  year: number,
): number | undefined {
  if (isGregorianCalendar(calendar)) {
    const isoYear = gregorianCalendarISOYear(calendar, year);
    return isoYear === undefined
      ? undefined
      : gregorianYearStartEpochDay(isoYear);
  }
  return isCopticCalendar(calendar)
    ? copticCalendarYearStart(calendar, year)
    : undefined;
}
export function calendarDaysInYear(
  calendar: string,
  year: number,
): number | undefined {
  const one = calendarYearStartEpochDay(calendar, year),
    two = calendarYearStartEpochDay(calendar, year + 1);
  return one === undefined || two === undefined ? undefined : two - one;
}
export function calendarDayOfYear(
  calendar: string,
  date: GregorianDate,
): number | undefined {
  const fields = calendarFieldsFromISO(calendar, date),
    epoch = epochDayFromGregorianCoordinate(date.year, date.month, date.day);
  if (fields === undefined || epoch === undefined) return undefined;
  const first = calendarYearStartEpochDay(calendar, fields.year);
  return first === undefined ? undefined : epoch - first + 1;
}
/** Exact coordinate conversion, without the final consumer's date-range clipping. */
export function calendarDateAt(
  calendar: string,
  year: number,
  month: number,
  day: number,
): GregorianDate | undefined {
  if (isGregorianCalendar(calendar)) {
    const isoYear = gregorianCalendarISOYear(calendar, year);
    if (
      isoYear === undefined ||
      epochDayFromGregorianCoordinate(isoYear, month, day) === undefined
    )
      return undefined;
    return { year: isoYear, month, day };
  }
  if (!isCopticCalendar(calendar)) return undefined;
  const epoch = copticCalendarEpochDay(calendar, year, month, day);
  return epoch === undefined
    ? undefined
    : gregorianCoordinateFromEpochDay(epoch);
}

export function calendarInLeapYear(
  calendar: string,
  year: number,
): boolean | undefined {
  const days = calendarDaysInYear(calendar, year);
  return days === undefined ? undefined : days === 366;
}
