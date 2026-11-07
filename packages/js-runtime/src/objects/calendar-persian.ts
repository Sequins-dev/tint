import {
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
import {
  persianEpochDay,
  persianLeapCorrectionYears,
} from "./calendar-data.ts";
/** The correction table moves a leap day to the following solar year. */
export function persianCalendarYearStart(
  calendar: string,
  year: number,
): number | undefined {
  if (calendar !== "persian" || !Number.isSafeInteger(year)) return undefined;
  const leapDays = Math.floor((8 * year + 21) / 33),
    bound =
      Math.abs(persianEpochDay) +
      365 * Math.abs(year - 1) +
      Math.abs(leapDays) +
      1;
  if (!Number.isSafeInteger(bound)) return undefined;
  const correction = persianLeapCorrectionYears.includes(
    "," + String(year - 1) + ",",
  )
    ? 1
    : 0;
  return persianEpochDay + 365 * (year - 1) + leapDays - correction;
}
export function persianCalendarDaysInMonth(
  calendar: string,
  year: number,
  month: number,
): number | undefined {
  if (
    calendar !== "persian" ||
    !Number.isSafeInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  )
    return undefined;
  if (month <= 6) return 31;
  if (month < 12) return 30;
  const one = persianCalendarYearStart(calendar, year),
    two = persianCalendarYearStart(calendar, year + 1);
  return one === undefined || two === undefined ? undefined : two - one - 336;
}
export function persianCalendarEpochDay(
  calendar: string,
  year: number,
  month: number,
  day: number,
): number | undefined {
  const start = persianCalendarYearStart(calendar, year),
    maximum = persianCalendarDaysInMonth(calendar, year, month);
  if (
    start === undefined ||
    maximum === undefined ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > maximum
  )
    return undefined;
  const ordinal = month <= 6 ? (month - 1) * 31 : 186 + (month - 7) * 30,
    epoch = start + ordinal + day - 1;
  return Number.isSafeInteger(epoch) ? epoch : undefined;
}
export function persianCalendarFieldsAtEpoch(
  calendar: string,
  epoch: number,
): CalendarDateFields | undefined {
  const delta = epoch - persianEpochDay;
  if (
    calendar !== "persian" ||
    !Number.isSafeInteger(epoch) ||
    !Number.isSafeInteger(delta) ||
    !Number.isSafeInteger(33 * delta + 3)
  )
    return undefined;
  let year = Math.floor((33 * delta + 3) / 12053) + 1,
    start = persianCalendarYearStart(calendar, year);
  const next = persianCalendarYearStart(calendar, year + 1);
  if (start === undefined || next === undefined) return undefined;
  if (epoch < start) {
    year--;
    start = persianCalendarYearStart(calendar, year);
  } else if (epoch >= next) {
    year++;
    start = next;
  }
  if (start === undefined) return undefined;
  const ordinal = epoch - start,
    month =
      ordinal < 186
        ? Math.floor(ordinal / 31) + 1
        : Math.floor((ordinal - 186) / 30) + 7,
    day = ordinal < 186 ? (ordinal % 31) + 1 : ((ordinal - 186) % 30) + 1;
  return { year, month, day, era: "ap", eraYear: year };
}
export function persianCalendarFields(
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
    : persianCalendarFieldsAtEpoch(calendar, epoch);
}
const algorithms: RegularCalendarAlgorithms = {
  months: 12,
  yearStart: persianCalendarYearStart,
  daysInMonth: persianCalendarDaysInMonth,
  maximumDaysInMonth: (month): number | undefined =>
    month >= 1 && month <= 12 ? (month <= 6 ? 31 : 30) : undefined,
  epochDay: persianCalendarEpochDay,
  fieldsAtEpoch: persianCalendarFieldsAtEpoch,
};
export function persianCalendarDateFromFields(
  calendar: string,
  fields: CalendarInputFields,
  kind: "date" | "year-month" | "month-day",
  overflow: "constrain" | "reject",
): CalendarDateConversion {
  if (calendar !== "persian") return { value: undefined, error: "unsupported" };
  return regularCalendarDateFromFields(
    calendar,
    fields,
    kind,
    overflow,
    algorithms,
  );
}
