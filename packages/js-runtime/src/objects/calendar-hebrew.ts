import {
  epochDayFromGregorianCoordinate,
  gregorianCoordinateFromEpochDay,
  type GregorianDate,
  type GregorianDateDifference,
} from "@tint/foundation/chrono/gregorian-calendar";
import type {
  CalendarDateFields,
  CalendarMonthCode,
  CalendarInputFields,
  CalendarDateConversion,
} from "./calendar-records.ts";
import { hebrewEpochDay } from "./calendar-data.ts";
import { resolveCalendarYear } from "./calendar-field-resolution.ts";
import { calendarISODateConversion } from "./calendar-date-limits.ts";
import {
  lunisolarDateAdd,
  lunisolarDateUntil,
  type LunisolarCalendarAlgorithms,
  type CalendarYearMonth,
} from "./calendar-lunisolar-arithmetic.ts";
/** Normalize astronomical remainders for proleptic years before the epoch. */
function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
export function hebrewLeapYear(year: number): boolean {
  return mod(12 * year + 17, 19) >= 12;
}
export function hebrewMonthsBeforeYear(year: number): number | undefined {
  const numerator = 235 * year - 234;
  return Number.isSafeInteger(year) && Number.isSafeInteger(numerator)
    ? Math.floor(numerator / 19)
    : undefined;
}
export function hebrewCalendarYearStart(
  calendar: string,
  year: number,
): number | undefined {
  if (calendar !== "hebrew") return undefined;
  const months = hebrewMonthsBeforeYear(year);
  if (months === undefined) return undefined;
  const parts = months * 13753 + 12084;
  if (!Number.isSafeInteger(parts)) return undefined;
  const whole = Math.floor(parts / 25920),
    fraction = parts - whole * 25920;
  let day = months * 29 + whole,
    weekday = mod(day, 7);
  if (weekday === 2 || weekday === 4 || weekday === 6) {
    day++;
    weekday = mod(day, 7);
  }
  // Exact conjunction thresholds postpone too; strict comparisons create 356-day years.
  if (weekday === 1 && fraction >= 16404 && !hebrewLeapYear(year)) day += 2;
  else if (weekday === 0 && fraction >= 23269 && hebrewLeapYear(year - 1))
    day++;
  const result = hebrewEpochDay + day;
  return Number.isSafeInteger(result) ? result : undefined;
}
export function hebrewCalendarMonthsInYear(
  calendar: string,
  year: number,
): number | undefined {
  return calendar === "hebrew" && Number.isSafeInteger(year)
    ? hebrewLeapYear(year)
      ? 13
      : 12
    : undefined;
}
export function hebrewCalendarDaysInMonth(
  calendar: string,
  year: number,
  month: number,
): number | undefined {
  const count = hebrewCalendarMonthsInYear(calendar, year);
  if (
    count === undefined ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > count
  )
    return undefined;
  if (month === 1 || month === 5) return 30;
  if (month === 4) return 29;
  if (month === 2 || month === 3) {
    const first = hebrewCalendarYearStart(calendar, year),
      next = hebrewCalendarYearStart(calendar, year + 1);
    if (first === undefined || next === undefined) return undefined;
    const length = next - first;
    if (month === 2) return length % 10 === 5 ? 30 : 29;
    return length % 10 === 3 ? 29 : 30;
  }
  const leap = count === 13;
  if (leap && month === 6) return 30;
  const code = month - (leap && month > 6 ? 1 : 0);
  return code % 2 === 1 ? 30 : 29;
}
export function hebrewCalendarEpochDay(
  calendar: string,
  year: number,
  month: number,
  day: number,
): number | undefined {
  const first = hebrewCalendarYearStart(calendar, year),
    maximum = hebrewCalendarDaysInMonth(calendar, year, month);
  if (
    first === undefined ||
    maximum === undefined ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > maximum
  )
    return undefined;
  let epoch = first + day - 1;
  for (let m = 1; m < month; m++) {
    const length = hebrewCalendarDaysInMonth(calendar, year, m);
    if (length === undefined) return undefined;
    epoch += length;
  }
  return Number.isSafeInteger(epoch) ? epoch : undefined;
}
export function hebrewCalendarFieldsAtEpoch(
  calendar: string,
  epoch: number,
): CalendarDateFields | undefined {
  if (calendar !== "hebrew" || !Number.isSafeInteger(epoch)) return undefined;
  const delta = epoch - hebrewEpochDay,
    months = Math.floor((delta * 25920) / 765433),
    numerator = 19 * months + 234;
  if (!Number.isSafeInteger(delta * 25920) || !Number.isSafeInteger(numerator))
    return undefined;
  let year = Math.floor(numerator / 235) + 1;
  const initialStart = hebrewCalendarYearStart(calendar, year),
    initialNext = hebrewCalendarYearStart(calendar, year + 1);
  if (initialStart === undefined || initialNext === undefined) return undefined;
  let start: number = initialStart,
    next: number = initialNext;
  // The mean lunation estimate differs only by the postponement window.
  while (epoch < start) {
    year--;
    const previous = hebrewCalendarYearStart(calendar, year);
    if (previous === undefined) return undefined;
    next = start;
    start = previous;
  }
  while (epoch >= next) {
    year++;
    const following = hebrewCalendarYearStart(calendar, year + 1);
    if (following === undefined) return undefined;
    start = next;
    next = following;
  }
  let ordinal = epoch - start,
    month = 1;
  const count = hebrewCalendarMonthsInYear(calendar, year);
  if (count === undefined) return undefined;
  for (; month <= count; month++) {
    const length = hebrewCalendarDaysInMonth(calendar, year, month);
    if (length === undefined) return undefined;
    if (ordinal < length) break;
    ordinal -= length;
  }
  if (month > count) return undefined;
  return { year, month, day: ordinal + 1, era: "am", eraYear: year };
}
export function hebrewCalendarFields(
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
    : hebrewCalendarFieldsAtEpoch(calendar, epoch);
}

export function hebrewCalendarMonthCode(
  year: number,
  month: number,
): CalendarMonthCode | undefined {
  const count = hebrewCalendarMonthsInYear("hebrew", year);
  if (
    count === undefined ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > count
  )
    return undefined;
  return count === 13 && month === 6
    ? { month: 5, leap: true }
    : { month: month - (count === 13 && month > 6 ? 1 : 0), leap: false };
}
function validMonthCode(code: CalendarMonthCode): boolean {
  return (
    Number.isInteger(code.month) &&
    code.month >= 1 &&
    code.month <= 12 &&
    (!code.leap || code.month === 5)
  );
}
export function hebrewOrdinalFromMonthCode(
  year: number,
  code: CalendarMonthCode,
  overflow: "constrain" | "reject",
): number | undefined {
  if (!Number.isSafeInteger(year) || !validMonthCode(code)) return undefined;
  const leap = hebrewLeapYear(year);
  if (code.leap) return leap || overflow === "constrain" ? 6 : undefined;
  return code.month + (leap && code.month >= 6 ? 1 : 0);
}
function monthDayReference(
  code: CalendarMonthCode,
  day: number,
): GregorianDate | undefined {
  for (const before of [true, false]) {
    const lower = epochDayFromGregorianCoordinate(before ? 1900 : 1973, 1, 1),
      upper = epochDayFromGregorianCoordinate(before ? 1972 : 2035, 12, 31);
    if (lower === undefined || upper === undefined)
      throw "CALENDAR_REFERENCE_DATE_INVARIANT";
    const first = hebrewCalendarFieldsAtEpoch("hebrew", lower),
      last = hebrewCalendarFieldsAtEpoch("hebrew", upper);
    if (first === undefined || last === undefined) return undefined;
    const direction = before ? -1 : 1,
      initial = before ? last.year : first.year,
      limit = before ? first.year : last.year;
    for (
      let year = initial;
      before ? year >= limit : year <= limit;
      year += direction
    ) {
      const month = hebrewOrdinalFromMonthCode(year, code, "reject");
      if (month === undefined) continue;
      const epoch = hebrewCalendarEpochDay("hebrew", year, month, day);
      if (epoch !== undefined && epoch >= lower && epoch <= upper)
        return gregorianCoordinateFromEpochDay(epoch);
    }
  }
  return undefined;
}
export function hebrewCalendarDateFromFields(
  calendar: string,
  fields: CalendarInputFields,
  kind: "date" | "year-month" | "month-day",
  overflow: "constrain" | "reject",
): CalendarDateConversion {
  const failure = (
    error: "type" | "range" | "unsupported",
  ): CalendarDateConversion => ({ value: undefined, error });
  if (calendar !== "hebrew") return failure("unsupported");
  const resolved = resolveCalendarYear(calendar, fields, kind);
  if (resolved.error !== "none") return failure(resolved.error);
  const year = resolved.value;
  let month = fields.month,
    code = fields.monthCode;
  if (code !== undefined && !validMonthCode(code)) return failure("range");
  if (year === undefined) {
    if (code === undefined) return failure("type");
  } else {
    if (code !== undefined) {
      const ordinal = hebrewOrdinalFromMonthCode(year, code, overflow);
      if (ordinal === undefined || (month !== undefined && month !== ordinal))
        return failure("range");
      month = ordinal;
    }
    if (month === undefined) return failure("type");
    if (!Number.isInteger(month) || month <= 0) return failure("range");
    const count = hebrewCalendarMonthsInYear(calendar, year);
    if (count === undefined) return failure("range");
    if (overflow === "constrain") month = Math.min(month, count);
    if (month > count) return failure("range");
    code = hebrewCalendarMonthCode(year, month);
    if (kind === "month-day") {
      const first = hebrewCalendarYearStart(calendar, year),
        next = hebrewCalendarYearStart(calendar, year + 1);
      if (
        first === undefined ||
        next === undefined ||
        next <= -100000001 ||
        first > 100000000
      )
        return failure("range");
    }
  }
  if (code === undefined) throw "HEBREW_MONTH_CODE_INVARIANT";
  let day = kind === "year-month" ? 1 : fields.day;
  if (day === undefined) return failure("type");
  if (!Number.isInteger(day) || day <= 0) return failure("range");
  const maximum =
    year === undefined
      ? code.leap ||
        code.month === 2 ||
        code.month === 3 ||
        code.month % 2 === 1
        ? 30
        : 29
      : month === undefined
        ? undefined
        : hebrewCalendarDaysInMonth(calendar, year, month);
  if (maximum === undefined) return failure("range");
  if (overflow === "constrain") day = Math.min(day, maximum);
  if (day > maximum) return failure("range");
  if (kind === "month-day") {
    const date = monthDayReference(code, day);
    return date === undefined
      ? failure("range")
      : { value: date, error: "none" };
  }
  if (year === undefined || month === undefined)
    throw "HEBREW_DATE_FIELDS_INVARIANT";
  const epoch = hebrewCalendarEpochDay(calendar, year, month, day);
  return epoch === undefined
    ? failure("range")
    : calendarISODateConversion(epoch, kind);
}

export function hebrewYearMonthAtIndex(
  index: number,
): CalendarYearMonth | undefined {
  const numerator = 19 * index + 234;
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(numerator))
    return undefined;
  let year = Math.floor(numerator / 235) + 1;
  const initialStart = hebrewMonthsBeforeYear(year),
    initialNext = hebrewMonthsBeforeYear(year + 1);
  if (initialStart === undefined || initialNext === undefined) return undefined;
  let start: number = initialStart,
    next: number = initialNext;
  while (index < start) {
    year--;
    const previous = hebrewMonthsBeforeYear(year);
    if (previous === undefined) return undefined;
    next = start;
    start = previous;
  }
  while (index >= next) {
    year++;
    const following = hebrewMonthsBeforeYear(year + 1);
    if (following === undefined) return undefined;
    start = next;
    next = following;
  }
  return { year, month: index - start + 1 };
}
const arithmetic: LunisolarCalendarAlgorithms = {
  fields: hebrewCalendarFields,
  monthsBeforeYear: (calendar, year): number | undefined =>
    calendar === "hebrew" ? hebrewMonthsBeforeYear(year) : undefined,
  yearMonthAtIndex: (calendar, index): CalendarYearMonth | undefined =>
    calendar === "hebrew" ? hebrewYearMonthAtIndex(index) : undefined,
  monthCode: (calendar, year, month): CalendarMonthCode | undefined =>
    calendar === "hebrew" ? hebrewCalendarMonthCode(year, month) : undefined,
  monthFromCode: (calendar, year, code, overflow): number | undefined =>
    calendar === "hebrew"
      ? hebrewOrdinalFromMonthCode(year, code, overflow)
      : undefined,
  daysInMonth: hebrewCalendarDaysInMonth,
  epochDay: hebrewCalendarEpochDay,
};
export function hebrewCalendarDateAdd(
  calendar: string,
  date: GregorianDate,
  years: number,
  months: number,
  weeks: number,
  days: number,
  overflow: "constrain" | "reject",
): GregorianDate | undefined {
  return lunisolarDateAdd(
    calendar,
    date,
    years,
    months,
    weeks,
    days,
    overflow,
    arithmetic,
  );
}
export function hebrewCalendarDateUntil(
  calendar: string,
  one: GregorianDate,
  two: GregorianDate,
  largest: "year" | "month" | "week" | "day",
): GregorianDateDifference | undefined {
  return lunisolarDateUntil(calendar, one, two, largest, arithmetic);
}
