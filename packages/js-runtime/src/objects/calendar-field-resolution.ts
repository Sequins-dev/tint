import { calendarSupportsEra, calendarYearForEra } from "./calendar-era.ts";
import type {
  CalendarInputFields,
  CalendarIntegerResolution,
} from "./calendar-records.ts";
/** Required fields precede era and month consistency, independently of arithmetic. */
export function resolveCalendarYear(
  calendar: string,
  fields: CalendarInputFields,
  kind: "date" | "year-month" | "month-day",
): CalendarIntegerResolution {
  const eras = calendarSupportsEra(calendar);
  const needsYear =
    kind !== "month-day" ||
    (calendar !== "iso8601" &&
      (fields.month !== undefined || fields.monthCode === undefined));
  const hasEra = fields.era !== undefined,
    hasEraYear = fields.eraYear !== undefined;
  if (
    needsYear &&
    fields.year === undefined &&
    (!eras || !hasEra || !hasEraYear)
  )
    return { value: undefined, error: "type" };
  if (eras && hasEra !== hasEraYear) return { value: undefined, error: "type" };
  if (kind !== "year-month" && fields.day === undefined)
    return { value: undefined, error: "type" };
  if (fields.month === undefined && fields.monthCode === undefined)
    return { value: undefined, error: "type" };
  let year = fields.year;
  if (eras && fields.era !== undefined && fields.eraYear !== undefined) {
    const fromEra = calendarYearForEra(calendar, fields.era, fields.eraYear);
    if (fromEra === undefined || (year !== undefined && year !== fromEra))
      return { value: undefined, error: "range" };
    year = fromEra;
  }
  if (year !== undefined && !Number.isSafeInteger(year))
    return { value: undefined, error: "range" };
  return { value: year, error: "none" };
}
/** Uniform solar/lunar month sequences have no leap month codes. */
export function resolveRegularCalendarMonth(
  fields: CalendarInputFields,
  monthsInYear: number,
): CalendarIntegerResolution {
  let month = fields.month;
  const code = fields.monthCode;
  if (code !== undefined) {
    if (
      code.leap ||
      !Number.isInteger(code.month) ||
      code.month < 1 ||
      code.month > monthsInYear ||
      (month !== undefined && month !== code.month)
    )
      return { value: undefined, error: "range" };
    month = code.month;
  }
  if (month === undefined) return { value: undefined, error: "type" };
  if (!Number.isInteger(month) || month <= 0)
    return { value: undefined, error: "range" };
  return { value: month, error: "none" };
}
