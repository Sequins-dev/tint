import {
  epochDayFromGregorianCoordinate,
  type GregorianDate,
} from "@tint/foundation/chrono/gregorian-calendar";
import {
  regularCalendarDateFromFields,
  type RegularCalendarAlgorithms,
} from "./calendar-regular-fields.ts";
import { localeTableValue } from "./locale-canonicalization.ts";
import type {
  CalendarDateFields,
  CalendarInputFields,
  CalendarDateConversion,
} from "./calendar-records.ts";
import {
  islamicCivilEpochDay,
  umalquraMonthLengthBits,
  umalquraYearStartDays,
} from "./calendar-data.ts";
export function isIslamicCalendar(calendar: string): boolean {
  return (
    calendar === "islamic-civil" ||
    calendar === "islamic-tbla" ||
    calendar === "islamic-umalqura"
  );
}
/** Umm al-Qura uses its complete published interval and civil reckoning outside it. */
export function islamicCalendarYearStart(
  calendar: string,
  year: number,
): number | undefined {
  if (!isIslamicCalendar(calendar) || !Number.isSafeInteger(year))
    return undefined;
  const epoch = islamicCivilEpochDay - (calendar === "islamic-tbla" ? 1 : 0);
  if (calendar === "islamic-umalqura" && year >= 1300 && year <= 1600) {
    const offset = localeTableValue(umalquraYearStartDays, String(year));
    return offset === undefined ? undefined : epoch + Number(offset);
  }
  const leapDays = Math.floor((3 + 11 * year) / 30),
    bound = Math.abs(epoch) + 354 * Math.abs(year - 1) + Math.abs(leapDays);
  return Number.isSafeInteger(bound)
    ? epoch + 354 * (year - 1) + leapDays
    : undefined;
}
export function islamicCalendarDaysInMonth(
  calendar: string,
  year: number,
  month: number,
): number | undefined {
  if (
    !isIslamicCalendar(calendar) ||
    !Number.isSafeInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  )
    return undefined;
  if (calendar === "islamic-umalqura" && year >= 1300 && year <= 1600)
    return umalquraMonthLengthBits.charCodeAt(
      (year - 1300) * 12 + month - 1,
    ) === 49
      ? 30
      : 29;
  if (month < 12) return month % 2 === 1 ? 30 : 29;
  const one = islamicCalendarYearStart(calendar, year),
    two = islamicCalendarYearStart(calendar, year + 1);
  return one === undefined || two === undefined ? undefined : two - one - 325;
}
export function islamicCalendarEpochDay(
  calendar: string,
  year: number,
  month: number,
  day: number,
): number | undefined {
  const start = islamicCalendarYearStart(calendar, year),
    maximum = islamicCalendarDaysInMonth(calendar, year, month);
  if (
    start === undefined ||
    maximum === undefined ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > maximum
  )
    return undefined;
  let epoch = start + day - 1;
  for (let m = 1; m < month; m++) {
    const days = islamicCalendarDaysInMonth(calendar, year, m);
    if (days === undefined) return undefined;
    epoch += days;
  }
  return Number.isSafeInteger(epoch) ? epoch : undefined;
}
export function islamicCalendarFieldsAtEpoch(
  calendar: string,
  epoch: number,
): CalendarDateFields | undefined {
  if (!isIslamicCalendar(calendar) || !Number.isSafeInteger(epoch))
    return undefined;
  const delta =
      epoch - islamicCivilEpochDay + (calendar === "islamic-tbla" ? 1 : 0),
    numerator = 30 * delta + 10646;
  if (!Number.isSafeInteger(delta) || !Number.isSafeInteger(numerator))
    return undefined;
  let year = Math.floor(numerator / 10631),
    start = islamicCalendarYearStart(calendar, year);
  const next = islamicCalendarYearStart(calendar, year + 1);
  if (start === undefined || next === undefined) return undefined;
  if (epoch < start) {
    year--;
    start = islamicCalendarYearStart(calendar, year);
  } else if (epoch >= next) {
    year++;
    start = next;
  }
  if (start === undefined) return undefined;
  let ordinal = epoch - start,
    month = 1;
  for (; month <= 12; month++) {
    const length = islamicCalendarDaysInMonth(calendar, year, month);
    if (length === undefined) return undefined;
    if (ordinal < length) break;
    ordinal -= length;
  }
  if (month > 12) return undefined;
  return {
    year,
    month,
    day: ordinal + 1,
    era: year > 0 ? "ah" : "bh",
    eraYear: year > 0 ? year : 1 - year,
  };
}
export function islamicCalendarFields(
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
    : islamicCalendarFieldsAtEpoch(calendar, epoch);
}
function tabularMaximumDays(month: number): number | undefined {
  return month >= 1 && month <= 12
    ? month % 2 === 1 || month === 12
      ? 30
      : 29
    : undefined;
}
const tabularAlgorithms: RegularCalendarAlgorithms = {
  months: 12,
  yearStart: islamicCalendarYearStart,
  daysInMonth: islamicCalendarDaysInMonth,
  maximumDaysInMonth: tabularMaximumDays,
  epochDay: islamicCalendarEpochDay,
  fieldsAtEpoch: islamicCalendarFieldsAtEpoch,
};
const umalquraAlgorithms: RegularCalendarAlgorithms = {
  months: 12,
  yearStart: islamicCalendarYearStart,
  daysInMonth: islamicCalendarDaysInMonth,
  maximumDaysInMonth: (month): number | undefined =>
    month >= 1 && month <= 12 ? 30 : undefined,
  epochDay: islamicCalendarEpochDay,
  fieldsAtEpoch: islamicCalendarFieldsAtEpoch,
};
export function islamicCalendarDateFromFields(
  calendar: string,
  fields: CalendarInputFields,
  kind: "date" | "year-month" | "month-day",
  overflow: "constrain" | "reject",
): CalendarDateConversion {
  if (!isIslamicCalendar(calendar))
    return { value: undefined, error: "unsupported" };
  return regularCalendarDateFromFields(
    calendar,
    fields,
    kind,
    overflow,
    calendar === "islamic-umalqura" ? umalquraAlgorithms : tabularAlgorithms,
  );
}
