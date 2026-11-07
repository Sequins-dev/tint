import {
  epochDayFromGregorianCoordinate,
  gregorianCoordinateFromEpochDay,
  type GregorianDate,
} from "@tint/foundation/chrono/gregorian-calendar";
import { copticEpochDay, copticCalendarYearOffsets } from "./calendar-data.ts";
import { localeTableValue } from "./locale-canonicalization.ts";
import {
  resolveCalendarYear,
  resolveRegularCalendarMonth,
} from "./calendar-field-resolution.ts";
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
/** Every valid month/day appears within a four-year cycle before 1973. */
function monthDayReference(
  calendar: string,
  month: number,
  day: number,
): GregorianDate | undefined {
  const last = epochDayFromGregorianCoordinate(1972, 12, 31);
  if (last === undefined) throw "CALENDAR_REFERENCE_DATE_INVARIANT";
  const anchor = copticCalendarFieldsAtEpoch(calendar, last);
  if (anchor === undefined) return undefined;
  let selected: number | undefined = undefined;
  for (let years = 0; years <= 4; years++) {
    const candidate = copticCalendarEpochDay(
      calendar,
      anchor.year - years,
      month,
      day,
    );
    if (candidate === undefined) continue;
    const iso = gregorianCoordinateFromEpochDay(candidate);
    if (
      iso !== undefined &&
      iso.year >= 1900 &&
      iso.year <= 1972 &&
      (selected === undefined || candidate > selected)
    )
      selected = candidate;
  }
  return selected === undefined
    ? undefined
    : gregorianCoordinateFromEpochDay(selected);
}
export function copticCalendarDateFromFields(
  calendar: string,
  fields: CalendarInputFields,
  kind: "date" | "year-month" | "month-day",
  overflow: "constrain" | "reject",
): CalendarDateConversion {
  const failure = (
    error: "type" | "range" | "unsupported",
  ): CalendarDateConversion => ({ value: undefined, error });
  if (!isCopticCalendar(calendar)) return failure("unsupported");
  const resolvedYear = resolveCalendarYear(calendar, fields, kind);
  if (resolvedYear.error !== "none") return failure(resolvedYear.error);
  const year = resolvedYear.value;
  const resolvedMonth = resolveRegularCalendarMonth(fields, 13);
  if (resolvedMonth.error !== "none") return failure(resolvedMonth.error);
  let month = resolvedMonth.value;
  if (month === undefined) throw "CALENDAR_MONTH_RESOLUTION_INVARIANT";
  if (overflow === "constrain") month = Math.min(month, 13);
  if (month > 13) return failure("range");
  if (kind === "month-day" && year !== undefined) {
    const start = copticCalendarYearStart(calendar, year),
      next = copticCalendarYearStart(calendar, year + 1);
    if (
      start === undefined ||
      next === undefined ||
      next <= -100000001 ||
      start > 100000000
    )
      return failure("range");
  }
  let day = kind === "year-month" ? 1 : fields.day;
  if (day === undefined) return failure("type");
  if (!Number.isInteger(day) || day <= 0) return failure("range");
  const maximum =
    year === undefined
      ? month === 13
        ? 6
        : 30
      : copticCalendarDaysInMonth(calendar, year, month);
  if (maximum === undefined) return failure("range");
  if (overflow === "constrain") day = Math.min(day, maximum);
  if (day > maximum) return failure("range");
  if (kind === "month-day") {
    const date = monthDayReference(calendar, month, day);
    return date === undefined
      ? failure("range")
      : { value: date, error: "none" };
  }
  if (year === undefined) throw "CALENDAR_YEAR_RESOLUTION_INVARIANT";
  const epoch = copticCalendarEpochDay(calendar, year, month, day);
  if (epoch === undefined) return failure("range");
  const date = gregorianCoordinateFromEpochDay(epoch);
  if (date === undefined) return failure("range");
  if (kind === "date" && (epoch < -100000001 || epoch > 100000000))
    return failure("range");
  if (
    kind === "year-month" &&
    (date.year < -271821 ||
      date.year > 275760 ||
      (date.year === -271821 && date.month < 4) ||
      (date.year === 275760 && date.month > 9))
  )
    return failure("range");
  return { value: date, error: "none" };
}
