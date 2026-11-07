import { calendarISODateConversion } from "./calendar-date-limits.ts";
import {
  epochDayFromGregorianCoordinate,
  gregorianCoordinateFromEpochDay,
  type GregorianDate,
} from "@tint/foundation/chrono/gregorian-calendar";
import {
  resolveCalendarYear,
  resolveRegularCalendarMonth,
} from "./calendar-field-resolution.ts";
import type {
  CalendarDateFields,
  CalendarInputFields,
  CalendarDateConversion,
} from "./calendar-records.ts";
/** Regular calendars have an unchanging sequence of non-leap month codes. */
export interface RegularCalendarAlgorithms {
  readonly months: number;
  readonly yearStart: (calendar: string, year: number) => number | undefined;
  readonly daysInMonth: (
    calendar: string,
    year: number,
    month: number,
  ) => number | undefined;
  readonly maximumDaysInMonth: (month: number) => number | undefined;
  readonly epochDay: (
    calendar: string,
    year: number,
    month: number,
    day: number,
  ) => number | undefined;
  readonly fieldsAtEpoch: (
    calendar: string,
    epoch: number,
  ) => CalendarDateFields | undefined;
}
function monthDayReference(
  calendar: string,
  month: number,
  day: number,
  algorithms: RegularCalendarAlgorithms,
): GregorianDate | undefined {
  for (const before of [true, false]) {
    const lower = epochDayFromGregorianCoordinate(before ? 1900 : 1973, 1, 1),
      upper = epochDayFromGregorianCoordinate(before ? 1972 : 2035, 12, 31);
    if (lower === undefined || upper === undefined)
      throw "CALENDAR_REFERENCE_DATE_INVARIANT";
    const first = algorithms.fieldsAtEpoch(calendar, lower),
      last = algorithms.fieldsAtEpoch(calendar, upper);
    if (first === undefined || last === undefined) return undefined;
    const direction = before ? -1 : 1,
      initial = before ? last.year : first.year,
      limit = before ? first.year : last.year;
    for (
      let year = initial;
      before ? year >= limit : year <= limit;
      year += direction
    ) {
      const epoch = algorithms.epochDay(calendar, year, month, day);
      if (epoch !== undefined && epoch >= lower && epoch <= upper)
        return gregorianCoordinateFromEpochDay(epoch);
    }
  }
  return undefined;
}
/** Resolve common required fields before calendar consistency and overflow. */
export function regularCalendarDateFromFields(
  calendar: string,
  fields: CalendarInputFields,
  kind: "date" | "year-month" | "month-day",
  overflow: "constrain" | "reject",
  algorithms: RegularCalendarAlgorithms,
): CalendarDateConversion {
  const failure = (error: "type" | "range"): CalendarDateConversion => ({
    value: undefined,
    error,
  });
  const resolvedYear = resolveCalendarYear(calendar, fields, kind);
  if (resolvedYear.error !== "none") return failure(resolvedYear.error);
  const year = resolvedYear.value,
    resolvedMonth = resolveRegularCalendarMonth(fields, algorithms.months);
  if (resolvedMonth.error !== "none") return failure(resolvedMonth.error);
  let month = resolvedMonth.value;
  if (month === undefined) throw "CALENDAR_MONTH_RESOLUTION_INVARIANT";
  if (overflow === "constrain") month = Math.min(month, algorithms.months);
  if (month > algorithms.months) return failure("range");
  if (kind === "month-day" && year !== undefined) {
    const start = algorithms.yearStart(calendar, year),
      next = algorithms.yearStart(calendar, year + 1);
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
      ? algorithms.maximumDaysInMonth(month)
      : algorithms.daysInMonth(calendar, year, month);
  if (maximum === undefined) return failure("range");
  if (overflow === "constrain") day = Math.min(day, maximum);
  if (day > maximum) return failure("range");
  if (kind === "month-day") {
    const date = monthDayReference(calendar, month, day, algorithms);
    return date === undefined
      ? failure("range")
      : { value: date, error: "none" };
  }
  if (year === undefined) throw "CALENDAR_YEAR_RESOLUTION_INVARIANT";
  const epoch = algorithms.epochDay(calendar, year, month, day);
  if (epoch === undefined) return failure("range");
  return calendarISODateConversion(epoch, kind);
}
