import {
  daysInGregorianMonth,
  epochDayFromGregorianCoordinate,
  gregorianCoordinateFromEpochDay,
  type GregorianDate,
} from "@tint/foundation/chrono/gregorian-calendar";
import {
  regularCalendarDateFromFields,
  type RegularCalendarAlgorithms,
} from "./calendar-regular-fields.ts";
import type {
  CalendarDateFields,
  CalendarInputFields,
  CalendarDateConversion,
} from "./calendar-records.ts";
/** The Shaka year starts on Gregorian March 21 in leap years, March 22 otherwise. */
export function indianCalendarYearStart(
  calendar: string,
  year: number,
): number | undefined {
  if (calendar !== "indian" || !Number.isSafeInteger(year)) return undefined;
  const isoYear = year + 78;
  return Number.isSafeInteger(isoYear)
    ? epochDayFromGregorianCoordinate(
        isoYear,
        3,
        daysInGregorianMonth(isoYear, 2) === 29 ? 21 : 22,
      )
    : undefined;
}
export function indianCalendarDaysInMonth(
  calendar: string,
  year: number,
  month: number,
): number | undefined {
  if (
    calendar !== "indian" ||
    !Number.isSafeInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  )
    return undefined;
  return month === 1
    ? daysInGregorianMonth(year + 78, 2) === 29
      ? 31
      : 30
    : month <= 6
      ? 31
      : 30;
}
export function indianCalendarEpochDay(
  calendar: string,
  year: number,
  month: number,
  day: number,
): number | undefined {
  const start = indianCalendarYearStart(calendar, year),
    maximum = indianCalendarDaysInMonth(calendar, year, month);
  if (
    start === undefined ||
    maximum === undefined ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > maximum
  )
    return undefined;
  const first = indianCalendarDaysInMonth(calendar, year, 1);
  if (first === undefined) return undefined;
  const ordinal =
    month === 1
      ? 0
      : first + Math.min(month - 2, 5) * 31 + Math.max(month - 7, 0) * 30;
  const epoch = start + ordinal + day - 1;
  return Number.isSafeInteger(epoch) ? epoch : undefined;
}
export function indianCalendarFieldsAtEpoch(
  calendar: string,
  epoch: number,
): CalendarDateFields | undefined {
  if (calendar !== "indian") return undefined;
  const iso = gregorianCoordinateFromEpochDay(epoch);
  if (iso === undefined) return undefined;
  let year = iso.year - 78,
    start = indianCalendarYearStart(calendar, year);
  if (start === undefined) return undefined;
  if (epoch < start) {
    year--;
    start = indianCalendarYearStart(calendar, year);
  }
  if (start === undefined) return undefined;
  let ordinal = epoch - start;
  const first = indianCalendarDaysInMonth(calendar, year, 1);
  if (first === undefined) return undefined;
  let month = 1,
    day = ordinal + 1;
  if (ordinal >= first) {
    ordinal -= first;
    if (ordinal < 155) {
      month = 2 + Math.floor(ordinal / 31);
      day = (ordinal % 31) + 1;
    } else {
      ordinal -= 155;
      month = 7 + Math.floor(ordinal / 30);
      day = (ordinal % 30) + 1;
    }
  }
  return { year, month, day, era: "shaka", eraYear: year };
}
export function indianCalendarFields(
  calendar: string,
  date: GregorianDate,
): CalendarDateFields | undefined {
  const epoch = epochDayFromGregorianCoordinate(
    date.year,
    date.month,
    date.day,
  );
  return epoch === undefined
    ? undefined
    : indianCalendarFieldsAtEpoch(calendar, epoch);
}
const algorithms: RegularCalendarAlgorithms = {
  months: 12,
  yearStart: indianCalendarYearStart,
  daysInMonth: indianCalendarDaysInMonth,
  maximumDaysInMonth: (month): number | undefined =>
    month >= 1 && month <= 12 ? (month <= 6 ? 31 : 30) : undefined,
  epochDay: indianCalendarEpochDay,
  fieldsAtEpoch: indianCalendarFieldsAtEpoch,
};
export function indianCalendarDateFromFields(
  calendar: string,
  fields: CalendarInputFields,
  kind: "date" | "year-month" | "month-day",
  overflow: "constrain" | "reject",
): CalendarDateConversion {
  if (calendar !== "indian") return { value: undefined, error: "unsupported" };
  return regularCalendarDateFromFields(
    calendar,
    fields,
    kind,
    overflow,
    algorithms,
  );
}
