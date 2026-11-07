import {
  epochDayFromGregorianCoordinate,
  type GregorianDate,
} from "@tint/foundation/chrono/gregorian-calendar";
import { copticEpochDay, copticCalendarYearOffsets } from "./calendar-data.ts";
import { localeTableValue } from "./locale-canonicalization.ts";
import {
  regularCalendarDateFromFields,
  type RegularCalendarAlgorithms,
} from "./calendar-regular-fields.ts";
import type {
  CalendarDateFields,
  CalendarInputFields,
  CalendarDateConversion,
} from "./calendar-records.ts";
function yearOffset(calendar: string): number | undefined {
  const value = localeTableValue(copticCalendarYearOffsets, calendar);
  return value === undefined ? undefined : Number(value);
}
export function isCopticCalendar(calendar: string): boolean {
  return yearOffset(calendar) !== undefined;
}
export function copticCalendarYearStart(
  calendar: string,
  year: number,
): number | undefined {
  const offset = yearOffset(calendar);
  if (offset === undefined || !Number.isSafeInteger(year)) return undefined;
  const commonYear = year - offset;
  if (!Number.isSafeInteger(commonYear)) return undefined;
  const leapDays = Math.floor(commonYear / 4);
  const bound =
    Math.abs(copticEpochDay) +
    365 * Math.abs(commonYear - 1) +
    Math.abs(leapDays);
  if (!Number.isSafeInteger(bound)) return undefined;
  return copticEpochDay + 365 * (commonYear - 1) + leapDays;
}
export function copticCalendarDaysInMonth(
  calendar: string,
  year: number,
  month: number,
): number | undefined {
  if (
    !isCopticCalendar(calendar) ||
    !Number.isSafeInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 13
  )
    return undefined;
  return month < 13 ? 30 : ((year % 4) + 4) % 4 === 3 ? 6 : 5;
}
export function copticCalendarEpochDay(
  calendar: string,
  year: number,
  month: number,
  day: number,
): number | undefined {
  const maximum = copticCalendarDaysInMonth(calendar, year, month),
    start = copticCalendarYearStart(calendar, year);
  if (
    maximum === undefined ||
    start === undefined ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > maximum
  )
    return undefined;
  const epoch = start + (month - 1) * 30 + day - 1;
  return Number.isSafeInteger(epoch) ? epoch : undefined;
}
export function copticCalendarFieldsAtEpoch(
  calendar: string,
  epoch: number,
): CalendarDateFields | undefined {
  const offset = yearOffset(calendar),
    delta = epoch - copticEpochDay;
  if (
    offset === undefined ||
    !Number.isSafeInteger(epoch) ||
    !Number.isSafeInteger(delta)
  )
    return undefined;
  const cycle = Math.floor(delta / 1461),
    remainder = delta - cycle * 1461;
  let commonYear = cycle * 4 + 1,
    ordinal = remainder;
  if (remainder >= 1096) {
    commonYear += 3;
    ordinal -= 1096;
  } else if (remainder >= 730) {
    commonYear += 2;
    ordinal -= 730;
  } else if (remainder >= 365) {
    commonYear++;
    ordinal -= 365;
  }
  const year = commonYear + offset,
    month = Math.floor(ordinal / 30) + 1,
    day = (ordinal % 30) + 1;
  if (!Number.isSafeInteger(year)) return undefined;
  const era =
    calendar === "ethioaa"
      ? "aa"
      : calendar === "ethiopic" && year <= 0
        ? "aa"
        : "am";
  const eraYear = calendar === "ethiopic" && year <= 0 ? year + 5500 : year;
  return { year, month, day, era, eraYear };
}
export function copticCalendarFields(
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
    : copticCalendarFieldsAtEpoch(calendar, epoch);
}
const algorithms: RegularCalendarAlgorithms = {
  months: 13,
  yearStart: copticCalendarYearStart,
  daysInMonth: copticCalendarDaysInMonth,
  maximumDaysInMonth: (month): number | undefined =>
    month >= 1 && month <= 13 ? (month === 13 ? 6 : 30) : undefined,
  epochDay: copticCalendarEpochDay,
  fieldsAtEpoch: copticCalendarFieldsAtEpoch,
};
export function copticCalendarDateFromFields(
  calendar: string,
  fields: CalendarInputFields,
  kind: "date" | "year-month" | "month-day",
  overflow: "constrain" | "reject",
): CalendarDateConversion {
  if (!isCopticCalendar(calendar))
    return { value: undefined, error: "unsupported" };
  return regularCalendarDateFromFields(
    calendar,
    fields,
    kind,
    overflow,
    algorithms,
  );
}
